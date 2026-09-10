/* QUANTA 移动端数据层：无后端时（APK / 静态托管）用 JSONP 直连行情接口。
   通过替换 window.fetch 实现，前端逻辑无需改动。 */
(function () {
  "use strict";

  // 桌面版（本地后端）直接跳过；加 ?jsonp=1 可强制使用直连模式（调试用）
  var force = location.search.indexOf("jsonp=1") >= 0;
  var IS_LOCAL_BACKEND = !force &&
    (location.protocol === "http:" || location.protocol === "https:") &&
    (location.hostname === "127.0.0.1" || location.hostname === "localhost");
  if (IS_LOCAL_BACKEND) return;

  var EM_PUSH = ["https://push2.eastmoney.com", "https://push2delay.eastmoney.com"];
  var EM_HIS = ["https://push2his.eastmoney.com", "https://push2delay.eastmoney.com"];
  var cbSeq = 0;

  function jsonp(url, cbParam) {
    return new Promise(function (resolve, reject) {
      var name = "__quanta_cb" + (++cbSeq) + "_" + Date.now();
      var s = document.createElement("script");
      var timer = setTimeout(function () {
        cleanup();
        reject(new Error("timeout"));
      }, 12000);
      function cleanup() {
        clearTimeout(timer);
        try { delete window[name]; } catch (e) { window[name] = undefined; }
        if (s.parentNode) s.parentNode.removeChild(s);
      }
      window[name] = function (data) { cleanup(); resolve(data); };
      s.onerror = function () { cleanup(); reject(new Error("network")); };
      s.src = url + (url.indexOf("?") < 0 ? "?" : "&") + (cbParam || "cb") + "=" + name;
      document.head.appendChild(s);
    });
  }

  function anyJsonp(hosts, path, cbParam) {
    var i = 0;
    function next() {
      if (i >= hosts.length) return Promise.reject(new Error("all sources failed"));
      var url = hosts[i++] + path;
      return jsonp(url, cbParam).catch(next);
    }
    return next();
  }

  function num(v, d) {
    if (v === null || v === undefined || v === "" || v === "-") return d === undefined ? 0 : d;
    var f = parseFloat(v);
    return isNaN(f) ? (d === undefined ? 0 : d) : f;
  }
  function diff(data) {
    var d = (data && data.data && data.data.diff) || [];
    if (!Array.isArray(d)) {
      d = Object.keys(d).map(function (k) { return d[k]; });
    }
    return d;
  }

  /* ---------------- 股票 ---------------- */
  function fmtQuote(d) {
    return {
      secid: d.f13 + "." + d.f12, code: d.f12, name: d.f14,
      price: num(d.f2), pct: num(d.f3), change: num(d.f4),
      volume: num(d.f5), amount: num(d.f6), amplitude: num(d.f7),
      high: num(d.f15), low: num(d.f16), open: num(d.f17), preClose: num(d.f18),
      turnover: num(d.f8), pe: num(d.f9), mktcap: num(d.f20), floatcap: num(d.f21),
      mainInflow: num(d.f62)
    };
  }

  var TX_PERIOD = { day: "day", week: "week", month: "month", 5: "m5", 15: "m15", 30: "m30", 60: "m60" };
  var KLT = { day: 101, week: 102, month: 103, 5: 5, 15: 15, 30: 30, 60: 60 };
  function txCode(secid) {
    var p = secid.split(".");
    return (p[0] === "1" ? "sh" : "sz") + p[1];
  }

  function txQuote(secids) {
    var codes = secids.map(txCode).join(",");
    return new Promise(function (resolve) {
      var name = "__quanta_tx" + Date.now();
      var s = document.createElement("script");
      var timer = setTimeout(function () { cleanup(); resolve([]); }, 10000);
      function cleanup() {
        clearTimeout(timer);
        if (s.parentNode) s.parentNode.removeChild(s);
      }
      window[name] = function () { cleanup(); resolve(parseTx()); };
      s.onerror = function () { cleanup(); resolve([]); };
      s.src = "https://qt.gtimg.cn/q=" + codes;
      document.head.appendChild(s);

      function parseTx() {
        var out = [];
        var vars = window;
        ["sh", "sz"].forEach(function (mk) {
          secids.forEach(function (sid) {
            var code = txCode(sid);
            var v = vars["v_" + code];
            if (!v || typeof v !== "string") return;
            var p = v.split("~");
            if (p.length < 40) return;
            out.push({
              secid: sid, code: p[2], name: p[1], price: num(p[3]), pct: num(p[32]),
              change: num(p[31]), volume: num(p[6]), amount: num(p[37]) * 10000,
              amplitude: num(p[43]), high: num(p[33]), low: num(p[34]), open: num(p[5]),
              preClose: num(p[4]), turnover: num(p[38]), pe: num(p[39]),
              mktcap: num(p[45]) * 1e8, floatcap: num(p[44]) * 1e8, mainInflow: 0
            });
          });
        });
        return out;
      }
    });
  }

  function quote(secids) {
    var fields = "f1,f2,f3,f4,f5,f6,f7,f8,f9,f12,f13,f14,f15,f16,f17,f18,f20,f21,f62";
    var path = "/api/qt/ulist.np/get?secids=" + secids.join(",") + "&fltt=2&invt=2&fields=" + fields;
    return anyJsonp(EM_PUSH, path).then(function (data) {
      var rows = diff(data).map(fmtQuote);
      if (rows.length) return rows;
      return txQuote(secids);
    }).catch(function () { return txQuote(secids); });
  }

  function kline(secid, period, fqt, limit) {
    period = period || "day";
    limit = limit || 320;
    var fields2 = "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61";
    var path = "/api/qt/stock/kline/get?secid=" + secid + "&klt=" + (KLT[period] || 101) +
      "&fqt=" + (fqt === undefined ? 1 : fqt) + "&beg=19900101&end=20500101" +
      "&fields1=f1,f2,f3,f4,f5,f6&fields2=" + fields2;
    return anyJsonp(EM_HIS, path).then(function (data) {
      var kl = (data && data.data && data.data.klines) || [];
      if (!kl.length) return txKline(secid, period, limit);
      var rows = kl.slice(-limit).map(function (line) {
        var p = line.split(",");
        return {
          t: p[0], o: num(p[1]), c: num(p[2]), h: num(p[3]), l: num(p[4]),
          v: num(p[5]), amt: num(p[6]), pct: num(p[8]), turn: num(p[10])
        };
      });
      return { rows: rows, name: data.data.name || "", code: data.data.code || "", preClose: num(data.data.preKPrice) };
    }).catch(function () { return txKline(secid, period, limit); });
  }

  function txKline(secid, period, limit) {
    var per = TX_PERIOD[period] || "day";
    var url = "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=" +
      txCode(secid) + "," + per + ",,," + limit + ",qfq";
    return jsonp(url, "_var").then(function (data) {
      var node = (data && data.data && data.data[txCode(secid)]) || {};
      var arr = node["qfq" + per] || node[per] || [];
      var rows = arr.slice(-limit).map(function (p, i, a) {
        var o = num(p[1]), c = num(p[2]), h = num(p[3]), l = num(p[4]);
        var pre = i > 0 ? num(a[i - 1][2]) : o;
        return { t: p[0], o: o, c: c, h: h, l: l, v: num(p[5]), amt: 0, pct: pre ? (c - pre) / pre * 100 : 0, turn: 0 };
      });
      return { rows: rows, name: "", code: secid.split(".")[1], preClose: rows.length ? rows[rows.length - 1].c : 0 };
    }).catch(function () { return { rows: [], name: "", code: secid.split(".")[1], preClose: 0 }; });
  }

  function trend(secid, ndays) {
    ndays = ndays || 1;
    var path = "/api/qt/stock/trends2/get?secid=" + secid +
      "&fields1=f1,f2,f3,f4,f5,f6,f7,f8&fields2=f51,f52,f53,f54,f55,f56,f57,f58&iscr=0&ndays=" + ndays;
    return anyJsonp(EM_HIS, path).then(function (data) {
      var d = (data && data.data) || {};
      if (!d.trends) return txTrend(secid);
      var rows = d.trends.map(function (line) {
        var p = line.split(",");
        return { t: p[0], o: num(p[1]), c: num(p[2]), h: num(p[3]), l: num(p[4]), v: num(p[5]), amt: num(p[6]), avg: num(p[7]) };
      });
      return { rows: rows, name: d.name || "", preClose: num(d.preClose) };
    }).catch(function () { return txTrend(secid); });
  }

  function txTrend(secid) {
    var url = "https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=" + txCode(secid);
    return jsonp(url, "_var").then(function (data) {
      var node = (data && data.data && data.data[txCode(secid)]) || {};
      var raw = ((node.data || {}).data || []);
      var date = (node.data || {}).date || "";
      var rows = raw.map(function (line) {
        var p = line.split(/\s+/);
        return {
          t: date.slice(0, 4) + "-" + date.slice(4, 6) + "-" + date.slice(6) + " " + p[0].slice(0, 2) + ":" + p[0].slice(2),
          o: num(p[1]), c: num(p[1]), h: num(p[1]), l: num(p[1]),
          v: num(p[2]), amt: num(p[3]), avg: 0
        };
      });
      var cv = 0, ca = 0;
      rows.forEach(function (r) {
        cv += r.v; ca += r.amt;
        r.avg = cv ? ca / (cv * 100) : r.c;
      });
      return { rows: rows, name: "", preClose: rows.length ? rows[0].c : 0 };
    }).catch(function () { return { rows: [], name: "", preClose: 0 }; });
  }

  var FS_STOCK = "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048";
  function clist(fs, fid, pz, fields) {
    var path = "/api/qt/clist/get?pn=1&pz=" + (pz || 20) + "&po=1&np=1&fltt=2&invt=2&fid=" +
      (fid || "f3") + "&fs=" + encodeURIComponent(fs) + "&fields=" + (fields || "f2,f3,f4,f5,f6,f12,f13,f14,f62");
    return anyJsonp(EM_PUSH, path).then(function (data) {
      return diff(data).map(function (d) {
        return {
          secid: d.f13 + "." + d.f12, code: d.f12, name: d.f14,
          price: num(d.f2), pct: num(d.f3), change: num(d.f4),
          amount: num(d.f6), mainInflow: num(d.f62), mainPct: num(d.f184)
        };
      });
    }).catch(function () { return []; });
  }

  function plates(kind, limit) {
    var fs = kind === "concept" ? "m:90+t:3" : "m:90+t:2";
    var fields = "f2,f3,f12,f13,f14,f62,f104,f105,f128,f136,f140";
    return clist(fs, "f3", limit || 20, fields).then(function (rows) {
      return rows;
    });
  }

  /* ---------------- 资讯 ---------------- */
  function news(column, size) {
    var url = "https://newsapi.eastmoney.com/kuaixun/v1/getlist_102_ajaxResult_50_1_.html";
    return new Promise(function (resolve) {
      var prev = window.ajaxResult;
      var s = document.createElement("script");
      var timer = setTimeout(function () { cleanup(); resolve([]); }, 12000);
      function cleanup() {
        clearTimeout(timer);
        if (s.parentNode) s.parentNode.removeChild(s);
      }
      s.onload = function () {
        cleanup();
        var data = window.ajaxResult || prev;
        var list = (data && data.LivesList) || [];
        resolve(list.slice(0, size || 30).map(function (n) {
          return {
            id: n.id || "", time: n.showtime || "", title: n.title || "",
            source: n.source || "东方财富", summary: (n.digest || "").replace(/<[^>]+>/g, ""),
            url: (n.url_w || n.url || "")
          };
        }));
      };
      s.onerror = function () { cleanup(); resolve([]); };
      s.src = url;
      document.head.appendChild(s);
    });
  }

  /* ---------------- 基金 ---------------- */
  function fundInfo(code) {
    var url = "https://fundmobapi.eastmoney.com/FundMNewApi/FundMNBasicInformation?FCODE=" +
      code + "&deviceid=1&plat=Android&product=EFund&version=1";
    return jsonp(url, "callback").then(function (data) {
      var d = (data && data.Datas) || null;
      if (!d) return null;
      return {
        code: d.FCODE || code, name: d.SHORTNAME || "", type: d.FTYPE || "",
        company: d.JJGS || "", manager: d.JJJL || "", nav: num(d.DWJZ), accNav: num(d.LJJZ),
        navDate: d.FSRQ || "", dayPct: num(d.RZDF), scale: d.ENDNAV || "",
        establish: d.ISSBDATE || d.PLTDATE || "", buyStatus: d.SGZT || "", sellStatus: d.SHZT || "",
        fee: d.SOURCERATE || "", r1w: num(d.SYL_Z), r1m: num(d.SYL_Y), r3m: num(d.SYL_3Y),
        r6m: num(d.SYL_6Y), r1y: num(d.SYL_1N), r2y: num(d.SYL_2N), r3y: num(d.SYL_3N),
        rThisYear: num(d.SYL_JN), rSince: num(d.SYL_LN)
      };
    }).catch(function () { return null; });
  }

  function fundNav(code, size) {
    var url = "https://api.fund.eastmoney.com/f10/lsjz?fundCode=" + code +
      "&pageIndex=1&pageSize=" + (size || 120);
    return jsonp(url, "callback").then(function (data) {
      var lst = ((data && data.Data && data.Data.LSJZList) || []).map(function (r) {
        return { date: r.FSRQ, nav: num(r.DWJZ), accNav: num(r.LJJZ), pct: num(r.JZZZL), buy: r.SGZT, sell: r.SHZT };
      });
      lst.reverse();
      return lst;
    }).catch(function () { return []; });
  }

  var RANK_FT = { all: "all", gp: "gp", hh: "hh", zq: "zq", zs: "zs", qdii: "qdii" };
  function fundRank(kind, limit) {
    var ft = RANK_FT[kind] || "all";
    var url = "https://fund.eastmoney.com/data/rankhandler.aspx?op=ph&dt=kf&ft=" + ft +
      "&rs=&gs=0&sc=1nzf&st=desc&pi=1&pn=" + (limit || 30) + "&dx=1";
    return new Promise(function (resolve) {
      var s = document.createElement("script");
      var timer = setTimeout(function () { cleanup(); resolve([]); }, 15000);
      function cleanup() {
        clearTimeout(timer);
        if (s.parentNode) s.parentNode.removeChild(s);
      }
      var prev = window.rankData;
      s.onload = function () {
        cleanup();
        var data = window.rankData || prev;
        var arr = (data && data.datas) || [];
        resolve(arr.map(function (seg) {
          var p = seg.split(",");
          return {
            code: p[0], name: p[1], date: p[3], nav: num(p[4]), accNav: num(p[5]),
            dayPct: num(p[6]), r1w: num(p[7]), r1m: num(p[8]), r3m: num(p[9]),
            r6m: num(p[10]), r1y: num(p[11]), r2y: num(p[12]), r3y: num(p[13]),
            rThisYear: num(p[14]), rSince: num(p[15]), fee: p[18] || ""
          };
        }));
      };
      s.onerror = function () { cleanup(); resolve([]); };
      s.src = url;
      document.head.appendChild(s);
    });
  }

  function search(kw, limit) {
    var url = "https://searchapi.eastmoney.com/api/suggest/get?input=" + encodeURIComponent(kw) +
      "&type=14&token=D43BF722C8E33BDC906FB84D85E326E8&count=" + (limit || 12);
    return jsonp(url, "cb").then(function (data) {
      var rows = ((data && data.QuotationCodeTable && data.QuotationCodeTable.Data) || []);
      return rows.filter(function (r) { return r.QuoteID; }).map(function (r) {
        return {
          code: r.Code, name: r.Name, secid: r.QuoteID, market: r.QuoteID.split(".")[0],
          type: r.Classify, typeName: r.SecurityTypeName
        };
      });
    }).catch(function () { return []; });
  }

  /* ---------------- 自选（本地存储） ---------------- */
  var WL_KEY = "quanta_watchlist";
  function wlGet() {
    try { return JSON.parse(localStorage.getItem(WL_KEY)) || { stocks: [], funds: [] }; }
    catch (e) { return { stocks: [], funds: [] }; }
  }
  function wlSet(v) {
    try { localStorage.setItem(WL_KEY, JSON.stringify(v)); } catch (e) { }
  }

  /* ---------------- fetch 适配 ---------------- */
  function makeResponse(obj) {
    return {
      ok: true, status: 200,
      json: function () { return Promise.resolve(obj); },
      text: function () { return Promise.resolve(JSON.stringify(obj)); }
    };
  }

  function handle(path, params, method, body) {
    if (path === "watchlist") {
      if (method === "POST") {
        var v = wlGet();
        var key = body && body.secid ? "stocks" : "funds";
        var idKey = body && body.secid ? "secid" : "code";
        var exists = v[key].some(function (x) { return x[idKey] === body[idKey]; });
        if (!exists && body) v[key].push(body);
        wlSet(v);
        return Promise.resolve(makeResponse({ ok: true, data: { items: v[key], added: !exists } }));
      }
      if (method === "DELETE") {
        var w = wlGet();
        var k = params.secid ? "stocks" : "funds";
        var ik = params.secid ? "secid" : "code";
        var val = params.secid || params.code;
        var before = w[k].length;
        w[k] = w[k].filter(function (x) { return x[ik] !== val; });
        wlSet(w);
        return Promise.resolve(makeResponse({ ok: true, data: { items: w[k], removed: w[k].length !== before } }));
      }
      return Promise.resolve(makeResponse({ ok: true, data: wlGet() }));
    }

    if (path === "ping") return Promise.resolve(makeResponse({ ok: true, data: { ts: Date.now() / 1000 } }));

    var p = params || {};
    var task;
    if (path === "indexes") {
      task = quote(["1.000001", "0.399001", "0.399006", "1.000688", "1.000300"]).then(function (rows) {
        var names = {
          "1.000001": "上证指数", "0.399001": "深证成指", "0.399006": "创业板指",
          "1.000688": "科创50", "1.000300": "沪深300"
        };
        return rows.map(function (r) { r.name = names[r.secid] || r.name; return r; });
      });
    } else if (path === "search") task = search(p.kw || "", parseInt(p.limit || 12, 10));
    else if (path === "quote") task = quote((p.secids || "").split(",").filter(Boolean));
    else if (path === "kline") task = kline(p.secid, p.period, parseInt(p.fqt || 1, 10), parseInt(p.limit || 320, 10));
    else if (path === "trend") task = trend(p.secid, parseInt(p.ndays || 1, 10));
    else if (path === "rank") task = clist(FS_STOCK, p.sort || "f3", parseInt(p.limit || 20, 10));
    else if (path === "plates") task = plates(p.kind, parseInt(p.limit || 20, 10));
    else if (path === "plate-stocks") task = clist("b:" + String(p.secid).split(".").pop(), "f3", parseInt(p.limit || 12, 10));
    else if (path === "fundflow") task = clist(FS_STOCK, "f62", parseInt(p.limit || 15, 10));
    else if (path === "news") task = news(p.column, parseInt(p.size || 30, 10));
    else if (path === "fund/info") task = fundInfo(p.code);
    else if (path === "fund/nav") task = fundNav(p.code, parseInt(p.size || 120, 10));
    else if (path === "fund/rank") task = fundRank(p.kind, parseInt(p.limit || 30, 10));
    else task = Promise.resolve(null);

    return task.then(function (data) { return makeResponse({ ok: true, data: data }); })
      .catch(function (e) { return makeResponse({ ok: false, msg: String(e && e.message || e) }); });
  }

  var nativeFetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : (input && input.url);
    if (typeof url !== "string" || url.indexOf("/api/") !== 0) {
      return nativeFetch ? nativeFetch(input, init) : Promise.reject(new Error("no fetch"));
    }
    var method = (init && init.method) || "GET";
    var qIndex = url.indexOf("?");
    var path = url.slice(5, qIndex < 0 ? url.length : qIndex);
    var params = {};
    if (qIndex >= 0) {
      url.slice(qIndex + 1).split("&").forEach(function (kv) {
        var pair = kv.split("=");
        if (pair[0]) params[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1] || "");
      });
    }
    var body = null;
    if (init && init.body) {
      try { body = JSON.parse(init.body); } catch (e) { body = null; }
    }
    return handle(path, params, method, body);
  };
})();
