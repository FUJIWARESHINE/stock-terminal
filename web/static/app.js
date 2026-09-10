/* QUANTA 智能行情终端 - 前端逻辑 */
(function () {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.prototype.slice.call(document.querySelectorAll(s));
  const UP = "#ff4d4f", DOWN = "#00e08f", FLAT = "#7b8ba6";

  const state = {
    view: "market",
    cur: { secid: "1.000001", code: "000001", name: "上证指数", type: "指数" },
    period: "day",
    fqt: 1,
    watch: [],
    funds: [],
    rankSort: "f3",
    plateKind: "industry",
    hotPlateKind: "industry",
    newsCol: "flash",
    fund: { code: "110022", nav: [], range: 180 },
    cmpRange: 60,
    charts: {},
  };

  /* ------------------------------ 工具 ------------------------------ */
  async function api(path, opts) {
    const r = await fetch("/api/" + path, opts);
    const j = await r.json();
    if (!j.ok) throw new Error(j.msg || "请求失败");
    return j.data;
  }
  const get = (p) => api(p);
  const post = (p, body) => api(p, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  });
  const del = (p) => api(p, { method: "DELETE" });

  function cls(v) { return v > 0 ? "up" : (v < 0 ? "down" : "flat"); }
  function sign(v, digits) {
    const d = digits === undefined ? 2 : digits;
    const s = Number(v || 0).toFixed(d);
    return (v > 0 ? "+" : "") + s;
  }
  function pct(v) { return sign(v, 2) + "%"; }
  function money(v) {
    v = Number(v || 0);
    if (Math.abs(v) >= 1e8) return (v / 1e8).toFixed(2) + "亿";
    if (Math.abs(v) >= 1e4) return (v / 1e4).toFixed(2) + "万";
    return v.toFixed(0);
  }
  function price(v) {
    v = Number(v || 0);
    return v ? v.toFixed(v >= 100 ? 2 : 3) : "--";
  }
  let toastTimer = null;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 1800);
  }

  function chart(id) {
    if (!state.charts[id]) {
      const el = document.getElementById(id);
      if (!el) return null;
      state.charts[id] = echarts.init(el, null, { renderer: "canvas" });
    }
    return state.charts[id];
  }
  function resizeCharts() {
    Object.keys(state.charts).forEach((k) => {
      const el = document.getElementById(k);
      if (el && el.offsetParent !== null) state.charts[k].resize();
    });
  }
  window.addEventListener("resize", resizeCharts);

  const AXIS = {
    axisLine: { lineStyle: { color: "rgba(0,229,255,.18)" } },
    axisTick: { show: false },
    axisLabel: { color: "#7b8ba6", fontSize: 10 },
    splitLine: { lineStyle: { color: "rgba(255,255,255,.045)" } },
  };

  /* ------------------------------ 顶部 ------------------------------ */
  function tickClock() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    $("#clock").textContent = p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
  }

  async function loadIndexes() {
    const list = await get("indexes");
    $("#indexTape").innerHTML = list.map((i) => `
      <div class="tape-item" data-secid="${i.secid}" style="cursor:pointer">
        <span class="nm">${i.name}</span>
        <span class="pv ${cls(i.pct)}">${i.price ? i.price.toFixed(2) : "--"}</span>
        <span class="pc ${cls(i.pct)}">${pct(i.pct)}</span>
      </div>`).join("");
    $$("#indexTape .tape-item").forEach((el) => {
      el.onclick = () => {
        const it = list.find((x) => x.secid === el.dataset.secid);
        openSymbol({ secid: it.secid, name: it.name, code: it.secid.split(".")[1] });
      };
    });
  }

  /* ------------------------------ 搜索 ------------------------------ */
  let searchTimer = null;
  $("#globalSearch").addEventListener("input", (e) => {
    const kw = e.target.value.trim();
    clearTimeout(searchTimer);
    if (!kw) { $("#suggest").classList.remove("show"); return; }
    searchTimer = setTimeout(async () => {
      const res = await get("search?kw=" + encodeURIComponent(kw));
      const box = $("#suggest");
      if (!res.length) {
        box.innerHTML = '<div class="sg"><span>无匹配结果</span></div>';
      } else {
        box.innerHTML = res.map((r) => `
          <div class="sg" data-secid="${r.secid}" data-name="${r.name}" data-code="${r.code}" data-type="${r.type}">
            <span>${r.name}</span>
            <span style="display:flex;gap:8px;align-items:center">
              <span class="c">${r.code}</span><span class="t">${r.typeName || (r.type === "Fund" ? "基金" : "股票")}</span>
            </span>
          </div>`).join("");
        $$("#suggest .sg[data-secid]").forEach((el) => {
          el.onclick = async () => {
            box.classList.remove("show");
            $("#globalSearch").value = "";
            const item = {
              secid: el.dataset.secid, code: el.dataset.code,
              name: el.dataset.name, type: el.dataset.type
            };
            if (item.type === "Fund") {
              await addFund({ code: item.code, name: item.name });
              openFund(item.code);
              switchView("fund");
            } else {
              openSymbol(item);
              switchView("market");
            }
          };
        });
      }
      box.classList.add("show");
    }, 260);
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".search-wrap")) $("#suggest").classList.remove("show");
  });

  /* ------------------------------ 视图切换 ------------------------------ */
  function switchView(v) {
    state.view = v;
    $$("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.view === v));
    $$(".view").forEach((s) => s.classList.toggle("active", s.id === "view-" + v));
    setTimeout(resizeCharts, 60);
    if (v === "hot") loadHot();
    if (v === "focus") loadFocus();
    if (v === "fund" && !state.funds.length) loadFundWatch();
  }
  $$("#tabs button").forEach((b) => b.onclick = () => switchView(b.dataset.view));

  /* ------------------------------ 自选 ------------------------------ */
  async function loadWatch() {
    const data = await get("watchlist");
    state.watch = data.stocks || [];
    state.funds = data.funds || [];
    renderWatch();
    $("#wlCount").textContent = state.watch.length + " 支";
    $("#focusCount").textContent = state.watch.length + " 支";
    $("#fundWlCount").textContent = state.funds.length + " 支";
    renderFundWatch();
  }

  function renderWatch() {
    const box = $("#watchList");
    if (!state.watch.length) {
      box.innerHTML = '<div class="empty">暂无自选<br>用右上角搜索添加，或点击「+ 加自选」</div>';
      return;
    }
    box.innerHTML = state.watch.map((w) => `
      <div class="row ${w.secid === state.cur.secid ? "sel" : ""}" data-secid="${w.secid}"
           style="grid-template-columns:1fr auto auto">
        <div>
          <div class="nm">${w.name}</div>
          <div class="cd">${w.code}</div>
        </div>
        <div class="num" data-px="${w.secid}">--</div>
        <div class="num" data-pc="${w.secid}">--</div>
      </div>`).join("");
    $$("#watchList .row").forEach((el) => {
      el.onclick = () => {
        const w = state.watch.find((x) => x.secid === el.dataset.secid);
        openSymbol(w);
      };
      el.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        removeWatch(el.dataset.secid);
      });
    });
  }

  async function refreshWatchQuotes() {
    if (!state.watch.length) return;
    const ids = state.watch.map((w) => w.secid).join(",");
    const list = await get("quote?secids=" + ids);
    list.forEach((q) => {
      const px = document.querySelector('[data-px="' + q.secid + '"]');
      const pc = document.querySelector('[data-pc="' + q.secid + '"]');
      if (px) { px.textContent = price(q.price); px.className = "num " + cls(q.pct); }
      if (pc) { pc.textContent = pct(q.pct); pc.className = "num " + cls(q.pct); }
    });
  }

  async function addWatch(item) {
    const r = await post("watchlist/stocks", item);
    state.watch = r.items;
    renderWatch();
    $("#wlCount").textContent = state.watch.length + " 支";
    $("#focusCount").textContent = state.watch.length + " 支";
    toast(r.added ? "已加入聚焦：" + item.name : "已在聚焦池中");
    updateFavBtn();
    if (state.view === "focus") loadFocus();
  }
  async function removeWatch(secid) {
    const r = await del("watchlist/stocks?secid=" + encodeURIComponent(secid));
    state.watch = r.items;
    renderWatch();
    $("#wlCount").textContent = state.watch.length + " 支";
    $("#focusCount").textContent = state.watch.length + " 支";
    updateFavBtn();
    if (state.view === "focus") loadFocus();
    toast("已移出聚焦池");
  }
  function updateFavBtn() {
    const inList = state.watch.some((w) => w.secid === state.cur.secid);
    $("#favBtn").textContent = inList ? "★ 已聚焦" : "+ 加自选";
    $("#favBtn").classList.toggle("active", inList);
  }
  $("#favBtn").onclick = () => {
    const inList = state.watch.some((w) => w.secid === state.cur.secid);
    if (inList) removeWatch(state.cur.secid);
    else addWatch({ secid: state.cur.secid, code: state.cur.code, name: state.cur.name });
  };

  /* ------------------------------ 行情主图 ------------------------------ */
  function openSymbol(item) {
    if (!item || !item.secid) return;
    state.cur = { secid: item.secid, code: item.code || item.secid.split(".")[1], name: item.name };
    $$("#watchList .row").forEach((el) => el.classList.toggle("sel", el.dataset.secid === item.secid));
    updateFavBtn();
    loadChart();
    loadQuote();
    if (state.view === "focus") switchView("market");
  }

  async function loadQuote() {
    $("#qhName").textContent = state.cur.name;
    $("#qhCode").textContent = state.cur.code;
    const list = await get("quote?secids=" + state.cur.secid);
    const q = list[0];
    if (!q) return;
    state.cur.name = q.name || state.cur.name;
    $("#qhName").textContent = q.name;
    $("#qhPrice").textContent = price(q.price);
    $("#qhPrice").className = "qh-price " + cls(q.pct);
    $("#qhDelta").innerHTML = `
      <span class="${cls(q.change)}">${sign(q.change)}</span>
      <span class="${cls(q.pct)}">${pct(q.pct)}</span>`;
    $("#qhMetrics").innerHTML = [
      ["今开", price(q.open)], ["最高", price(q.high)], ["最低", price(q.low)],
      ["昨收", price(q.preClose)], ["振幅", q.amplitude ? q.amplitude.toFixed(2) + "%" : "--"],
      ["换手", q.turnover ? q.turnover.toFixed(2) + "%" : "--"],
      ["成交量", money(q.volume) + "手"], ["成交额", money(q.amount)],
      ["主力净额", money(q.mainInflow)], ["总市值", money(q.mktcap)],
    ].map((m) => `<div><span>${m[0]}</span><b>${m[1]}</b></div>`).join("");
  }

  function loadChart() {
    if (state.period === "trend" || state.period === "trend5") {
      loadTrend(state.period === "trend5" ? 5 : 1);
    } else {
      loadKline();
    }
  }

  $$("#periodChips .chip").forEach((b) => b.onclick = () => {
    $$("#periodChips .chip").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    state.period = b.dataset.p;
    loadChart();
  });

  function ma(rows, n) {
    const out = [];
    let sum = 0;
    rows.forEach((r, i) => {
      sum += r.c;
      if (i >= n) sum -= rows[i - n].c;
      out.push(i >= n - 1 ? +(sum / n).toFixed(3) : "-");
    });
    return out;
  }

  async function loadKline() {
    const c = chart("mainChart");
    if (!c) return;
    c.showLoading("default", { text: "", color: "#00e5ff", maskColor: "rgba(5,7,13,.5)" });
    const d = await get(`kline?secid=${state.cur.secid}&period=${state.period}&fqt=${state.fqt}&limit=320`);
    c.hideLoading();
    if (!d.rows.length) { c.clear(); return; }
    const rows = d.rows;
    const dates = rows.map((r) => r.t);
    const ohlc = rows.map((r) => [r.o, r.c, r.l, r.h]);
    const vol = rows.map((r, i) => ({
      value: r.v,
      itemStyle: { color: (r.c >= r.o ? UP : DOWN) + "66" }
    }));
    const mas = [[5, "#ffb84d"], [10, "#00e5ff"], [20, "#8b5cff"], [60, "#ff2d78"]];

    c.setOption({
      animation: false,
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis", axisPointer: { type: "cross", link: [{ xAxisIndex: "all" }],
          crossStyle: { color: "rgba(0,229,255,.5)" } },
        backgroundColor: "rgba(8,14,26,.94)", borderColor: "rgba(0,229,255,.35)",
        textStyle: { color: "#dbe6f5", fontSize: 11 },
        formatter: (ps) => {
          const r = rows[ps[0].dataIndex];
          if (!r) return "";
          return `<b>${r.t}</b><br/>开 ${r.o.toFixed(2)}　高 ${r.h.toFixed(2)}<br/>低 ${r.l.toFixed(2)}　收 ${r.c.toFixed(2)}<br/>
            <span style="color:${r.pct >= 0 ? UP : DOWN}">涨跌 ${pct(r.pct)}</span><br/>量 ${money(r.v)}手　额 ${money(r.amt)}`;
        }
      },
      axisPointer: { link: [{ xAxisIndex: "all" }] },
      grid: [
        { left: 56, right: 20, top: 16, height: "62%" },
        { left: 56, right: 20, top: "76%", height: "16%" }
      ],
      xAxis: [
        { type: "category", data: dates, boundaryGap: true, ...AXIS,
          axisLabel: { color: "#7b8ba6", fontSize: 10 }, splitLine: { show: false },
          axisLine: { lineStyle: { color: "rgba(0,229,255,.18)" } } },
        { type: "category", gridIndex: 1, data: dates, boundaryGap: true,
          axisLabel: { show: false }, axisLine: { lineStyle: { color: "rgba(0,229,255,.18)" } } }
      ],
      yAxis: [
        { scale: true, ...AXIS, axisLabel: { color: "#7b8ba6", fontSize: 10, formatter: (v) => v.toFixed(2) } },
        { gridIndex: 1, scale: true, splitNumber: 2, ...AXIS,
          axisLabel: { color: "#7b8ba6", fontSize: 9, formatter: (v) => money(v) } }
      ],
      dataZoom: [
        { type: "inside", xAxisIndex: [0, 1], start: Math.max(0, 100 - Math.min(100, 9000 / rows.length)), end: 100 },
        { type: "slider", xAxisIndex: [0, 1], height: 14, bottom: 4, borderColor: "rgba(0,229,255,.2)",
          backgroundColor: "rgba(0,0,0,.2)", fillerColor: "rgba(0,229,255,.10)",
          handleStyle: { color: "#00e5ff" }, textStyle: { color: "#7b8ba6", fontSize: 9 } }
      ],
      series: [
        { name: "K线", type: "candlestick", data: ohlc,
          itemStyle: { color: UP, color0: DOWN, borderColor: UP, borderColor0: DOWN } },
        ...mas.map((m) => ({
          name: "MA" + m[0], type: "line", data: ma(rows, m[0]), smooth: true,
          symbol: "none", lineStyle: { width: 1, color: m[1] }, itemStyle: { color: m[1] }, z: 3
        })),
        { name: "成交量", type: "bar", xAxisIndex: 1, yAxisIndex: 1, data: vol }
      ]
    }, true);
  }

  async function loadTrend(ndays) {
    const c = chart("mainChart");
    if (!c) return;
    c.showLoading("default", { text: "", color: "#00e5ff", maskColor: "rgba(5,7,13,.5)" });
    const d = await get(`trend?secid=${state.cur.secid}&ndays=${ndays}`);
    c.hideLoading();
    if (!d.rows.length) { c.clear(); toast("暂无分时数据"); return; }
    const rows = d.rows;
    const pre = d.preClose || rows[0].c;
    const times = rows.map((r) => r.t.slice(5));
    const px = rows.map((r) => r.c);
    const avg = rows.map((r) => r.avg);
    const vol = rows.map((r, i) => ({
      value: r.v,
      itemStyle: { color: (i > 0 && r.c < rows[i - 1].c ? DOWN : UP) + "66" }
    }));
    const maxDev = Math.max(...px.map((p) => Math.abs(p - pre)), 0.01);

    c.setOption({
      animation: false,
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis", axisPointer: { type: "cross", crossStyle: { color: "rgba(0,229,255,.5)" } },
        backgroundColor: "rgba(8,14,26,.94)", borderColor: "rgba(0,229,255,.35)",
        textStyle: { color: "#dbe6f5", fontSize: 11 },
        formatter: (ps) => {
          const i = ps[0].dataIndex, r = rows[i];
          const dp = pre ? ((r.c - pre) / pre * 100) : 0;
          return `<b>${r.t}</b><br/>价 ${r.c.toFixed(2)}　<span style="color:${dp >= 0 ? UP : DOWN}">${pct(dp)}</span><br/>均 ${r.avg.toFixed(2)}　量 ${money(r.v)}手`;
        }
      },
      grid: [
        { left: 56, right: 56, top: 16, height: "62%" },
        { left: 56, right: 56, top: "76%", height: "16%" }
      ],
      xAxis: [
        { type: "category", data: times, boundaryGap: false, ...AXIS, splitLine: { show: false } },
        { type: "category", gridIndex: 1, data: times, boundaryGap: false,
          axisLabel: { show: false }, axisLine: { lineStyle: { color: "rgba(0,229,255,.18)" } } }
      ],
      yAxis: [
        { min: +(pre - maxDev * 1.1).toFixed(2), max: +(pre + maxDev * 1.1).toFixed(2),
          ...AXIS, axisLabel: { color: "#7b8ba6", fontSize: 10, formatter: (v) => v.toFixed(2) } },
        { position: "right", min: -+(maxDev / pre * 110).toFixed(2), max: +(maxDev / pre * 110).toFixed(2),
          axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false },
          axisLabel: { color: "#7b8ba6", fontSize: 10, formatter: (v) => v.toFixed(2) + "%" } },
        { gridIndex: 1, scale: true, splitNumber: 2, ...AXIS,
          axisLabel: { color: "#7b8ba6", fontSize: 9, formatter: (v) => money(v) } }
      ],
      series: [
        { name: "价格", type: "line", data: px, symbol: "none", smooth: false,
          lineStyle: { width: 1.6, color: "#00e5ff", shadowColor: "rgba(0,229,255,.6)", shadowBlur: 8 },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: "rgba(0,229,255,.28)" }, { offset: 1, color: "rgba(0,229,255,0)" }])
          },
          markLine: {
            symbol: "none", silent: true,
            data: [{ yAxis: pre, lineStyle: { color: "rgba(255,255,255,.35)", type: "dashed" } }]
          }
        },
        { name: "均价", type: "line", data: avg, symbol: "none",
          lineStyle: { width: 1, color: "#ffb84d" } },
        { name: "成交量", type: "bar", xAxisIndex: 1, yAxisIndex: 2, data: vol }
      ]
    }, true);
  }

  /* ------------------------------ 榜单 ------------------------------ */
  async function loadRanks() {
    const list = await get(`rank?sort=${state.rankSort}&limit=30`);
    const tbody = $("#rankBody");
    const maxAmt = Math.max(...list.map((r) => r.amount), 1);
    tbody.innerHTML = list.slice(0, 20).map((r, i) => `
      <tr data-secid="${r.secid}" data-name="${r.name}" data-code="${r.code}">
        <td><span style="color:${i < 3 ? "#ffb84d" : "#7b8ba6"};font-family:var(--mono);margin-right:6px">${i + 1}</span>${r.name}</td>
        <td class="num">${price(r.price)}</td>
        <td class="num ${cls(r.pct)}">${pct(r.pct)}</td>
      </tr>`).join("");
    bindRows(tbody);
    if (state.view === "hot") renderHotTables(list, maxAmt);
  }
  function bindRows(tbody) {
    if (!tbody) return;
    Array.prototype.forEach.call(tbody.querySelectorAll("tr[data-secid]"), (tr) => {
      tr.onclick = () => {
        openSymbol({ secid: tr.dataset.secid, code: tr.dataset.code, name: tr.dataset.name });
        if (state.view !== "market") switchView("market");
      };
    });
  }
  $$("#rankChips .chip").forEach((b) => b.onclick = () => {
    $$("#rankChips .chip").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    state.rankSort = b.dataset.sort;
    loadRanks();
  });

  function renderHotTables(list, maxAmt) {
    const row = (r, i) => `
      <tr data-secid="${r.secid}" data-name="${r.name}" data-code="${r.code}">
        <td>${r.name}<div class="bar-wrap" style="margin-top:3px">
          <i style="width:${Math.max(2, Math.abs(r.amount) / maxAmt * 100)}%;background:${r.pct >= 0 ? UP : DOWN}"></i></div></td>
        <td class="num">${price(r.price)}</td>
        <td class="num ${cls(r.pct)}">${pct(r.pct)}</td>
        <td class="num">${money(r.amount)}</td>
      </tr>`;
    $("#hotRankBody").innerHTML = list.slice(0, 20).map(row).join("");
    bindRows($("#hotRankBody"));
  }

  async function loadHotLosers() {
    const all = await get("rank?sort=f3&limit=300").catch(() => []);
    const down = all.slice(-20).reverse();
    $("#hotLoserBody").innerHTML = down.map((r) => `
      <tr data-secid="${r.secid}" data-name="${r.name}" data-code="${r.code}">
        <td>${r.name}</td><td class="num">${price(r.price)}</td>
        <td class="num ${cls(r.pct)}">${pct(r.pct)}</td>
        <td class="num">${money(r.amount)}</td>
      </tr>`).join("");
    bindRows($("#hotLoserBody"));
  }

  /* ------------------------------ 板块 ------------------------------ */
  async function loadPlates() {
    const list = await get(`plates?kind=${state.plateKind}&limit=18`);
    const max = Math.max(...list.map((p) => Math.abs(p.pct)), 0.5);
    $("#plateList").innerHTML = list.map((p) => `
      <div class="row" data-secid="${p.secid}" style="grid-template-columns:1fr 54px 62px">
        <div>
          <div class="nm">${p.name}</div>
          <div class="cd">领涨 ${p.leader || "--"} ${p.leaderPct ? pct(p.leaderPct) : ""}</div>
          <div class="bar-wrap" style="margin-top:4px">
            <i style="width:${Math.max(2, Math.abs(p.pct) / max * 100)}%;background:linear-gradient(90deg,${p.pct >= 0 ? UP : DOWN},rgba(255,255,255,.1))"></i>
          </div>
        </div>
        <div class="num ${cls(p.pct)}">${pct(p.pct)}</div>
        <div class="num ${cls(p.mainInflow)}">${money(p.mainInflow)}</div>
      </div>`).join("");
    $$("#plateList .row").forEach((el) => {
      el.onclick = async () => {
        const st = await get(`plate-stocks?secid=${encodeURIComponent(el.dataset.secid)}&limit=1`);
        if (st.length) openSymbol({ secid: st[0].secid, code: st[0].code, name: st[0].name });
      };
    });
    if (state.view === "hot") renderHotPlate(list);
  }
  $$("#plateKind .chip").forEach((b) => b.onclick = () => {
    $$("#plateKind .chip").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    state.plateKind = b.dataset.kind;
    loadPlates();
  });

  function renderHotPlate(list) {
    const c = chart("hotPlateChart");
    if (!c) return;
    const data = list.slice(0, 16).reverse();
    c.setOption({
      animation: true,
      backgroundColor: "transparent",
      grid: { left: 96, right: 62, top: 10, bottom: 22 },
      tooltip: {
        trigger: "axis", axisPointer: { type: "shadow" },
        backgroundColor: "rgba(8,14,26,.94)", borderColor: "rgba(0,229,255,.35)",
        textStyle: { color: "#dbe6f5", fontSize: 11 },
        formatter: (ps) => {
          const d = data[ps[0].dataIndex];
          return `<b>${d.name}</b><br/>涨跌幅 ${pct(d.pct)}<br/>主力净额 ${money(d.mainInflow)}<br/>领涨股 ${d.leader || "--"}`;
        }
      },
      xAxis: { type: "value", ...AXIS, axisLabel: { color: "#7b8ba6", fontSize: 10, formatter: "{value}%" } },
      yAxis: {
        type: "category", data: data.map((d) => d.name), ...AXIS, splitLine: { show: false },
        axisLabel: { color: "#c3d1e4", fontSize: 11 }
      },
      series: [{
        type: "bar", data: data.map((d) => ({
          value: d.pct,
          itemStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
              { offset: 0, color: (d.pct >= 0 ? UP : DOWN) + "55" },
              { offset: 1, color: d.pct >= 0 ? UP : DOWN }])
          }
        })),
        barWidth: "58%",
        label: {
          show: true, position: "right", color: "#dbe6f5", fontSize: 10,
          formatter: (p) => p.value.toFixed(2) + "%"
        }
      }]
    }, true);
  }
  $$("#hotPlateKind .chip").forEach((b) => b.onclick = () => {
    $$("#hotPlateKind .chip").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    state.plateKind = b.dataset.kind;
    loadPlates();
  });

  async function loadFlow() {
    const list = await get("fundflow?limit=20");
    $("#flowBody").innerHTML = list.map((r) => `
      <tr data-secid="${r.secid}" data-name="${r.name}" data-code="${r.code}">
        <td>${r.name}</td><td class="num">${price(r.price)}</td>
        <td class="num ${cls(r.pct)}">${pct(r.pct)}</td>
        <td class="num ${cls(r.mainInflow)}">${money(r.mainInflow)}</td>
      </tr>`).join("");
    bindRows($("#flowBody"));
  }

  /* ------------------------------ 资讯 ------------------------------ */
  async function loadNews() {
    const list = await get(`news?column=${state.newsCol}&size=40`);
    const html = list.map((n) => `
      <div class="news-item" data-url="${n.url}">
        <div class="t">${n.title}</div>
        <div class="s">${n.summary || ""}</div>
        <div class="m"><span>${n.source || "东方财富"}</span><span>${(n.time || "").slice(5, 16)}</span></div>
      </div>`).join("");
    $("#newsList").innerHTML = html || '<div class="empty">暂无资讯</div>';
    if (state.view === "hot") $("#hotNewsList").innerHTML = html || '<div class="empty">暂无资讯</div>';
    $("#newsTime").textContent = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    bindNews();
  }
  function bindNews() {
    $$(".news-item").forEach((el) => {
      el.onclick = () => {
        const u = el.dataset.url;
        if (u) window.open(u, "_blank");
      };
    });
  }
  $$("#newsKind .chip").forEach((b) => b.onclick = () => {
    $$("#newsKind .chip").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    state.newsCol = b.dataset.col;
    loadNews();
  });

  /* ------------------------------ 热点视图 ------------------------------ */
  let hotLoaded = false;
  async function loadHot() {
    if (hotLoaded) { resizeCharts(); return; }
    hotLoaded = true;
    await Promise.all([loadRanks(), loadPlates(), loadFlow(), loadNews(), loadHotLosers()]);
    resizeCharts();
  }

  /* ------------------------------ 聚焦视图 ------------------------------ */
  let focusBusy = false;
  async function loadFocus() {
    if (focusBusy) return;
    focusBusy = true;
    const grid = $("#focusGrid");
    if (!state.watch.length) {
      grid.innerHTML = '<div class="empty" style="grid-column:1/-1">聚焦池为空<br>在顶部搜索框输入股票名称/代码，回车即可加入聚焦池</div>';
      const c = chart("cmpChart"); if (c) c.clear();
      focusBusy = false;
      return;
    }
    const ids = state.watch.map((w) => w.secid).join(",");
    const quotes = await get("quote?secids=" + ids);
    const qmap = {};
    quotes.forEach((q) => qmap[q.secid] = q);

    grid.innerHTML = state.watch.map((w) => {
      const q = qmap[w.secid] || {};
      return `
      <div class="fcard" data-secid="${w.secid}" data-code="${w.code}" data-name="${w.name}">
        <div class="glow"></div>
        <button class="del" title="移出聚焦">×</button>
        <div class="top">
          <div>
            <div class="nm">${w.name}</div>
            <div class="cd">${w.code}</div>
          </div>
        </div>
        <div class="px ${cls(q.pct)}">${price(q.price)}</div>
        <div class="ch ${cls(q.pct)}">${sign(q.change)}　${pct(q.pct)}</div>
        <div class="spark" id="spark-${w.secid.replace(".", "_")}"></div>
      </div>`;
    }).join("");

    $$("#focusGrid .fcard").forEach((el) => {
      el.onclick = (e) => {
        if (e.target.classList.contains("del")) {
          removeWatch(el.dataset.secid);
          return;
        }
        openSymbol({ secid: el.dataset.secid, code: el.dataset.code, name: el.dataset.name });
        switchView("market");
      };
    });

    // 迷你走势
    state.watch.forEach(async (w) => {
      const id = "spark-" + w.secid.replace(".", "_");
      const el = document.getElementById(id);
      if (!el) return;
      const d = await get(`kline?secid=${w.secid}&period=day&fqt=1&limit=60`);
      if (!el.isConnected) return;
      const old = echarts.getInstanceByDom(el);
      if (old) old.dispose();
      const inst = echarts.init(el);
      const vals = d.rows.map((r) => r.c);
      const up = vals.length > 1 && vals[vals.length - 1] >= vals[0];
      inst.setOption({
        animation: false, grid: { left: 2, right: 2, top: 4, bottom: 2 },
        xAxis: { type: "category", show: false, data: d.rows.map((r) => r.t), boundaryGap: false },
        yAxis: { show: false, scale: true },
        series: [{
          type: "line", data: vals, symbol: "none", smooth: true,
          lineStyle: { width: 1.5, color: up ? UP : DOWN },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: (up ? UP : DOWN) + "55" }, { offset: 1, color: "rgba(0,0,0,0)" }])
          }
        }]
      });
    });

    await loadCompare();
    focusBusy = false;
  }

  async function loadCompare() {
    const c = chart("cmpChart");
    if (!c || !state.watch.length) return;
    const n = state.cmpRange;
    const palette = ["#00e5ff", "#ff2d78", "#ffb84d", "#8b5cff", "#00e08f", "#ff8a3d", "#4dd0ff", "#ff6ec7"];
    const tasks = state.watch.map((w) =>
      get(`kline?secid=${w.secid}&period=day&fqt=1&limit=${n + 1}`).then((d) => ({ w, d }))
    );
    const res = await Promise.all(tasks);
    const series = [];
    let dates = [];
    res.forEach(({ w, d }, idx) => {
      if (!d.rows.length) return;
      const base = d.rows[0].c || 1;
      dates = d.rows.map((r) => r.t);
      series.push({
        name: w.name, type: "line", symbol: "none", smooth: true,
        data: d.rows.map((r) => +((r.c / base - 1) * 100).toFixed(2)),
        lineStyle: { width: 1.8, color: palette[idx % palette.length] },
        itemStyle: { color: palette[idx % palette.length] }
      });
    });
    c.setOption({
      animation: false,
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis", backgroundColor: "rgba(8,14,26,.94)",
        borderColor: "rgba(0,229,255,.35)", textStyle: { color: "#dbe6f5", fontSize: 11 },
        valueFormatter: (v) => (v === null || v === undefined ? "--" : v.toFixed(2) + "%")
      },
      legend: { top: 4, textStyle: { color: "#7b8ba6", fontSize: 10 }, icon: "roundRect", itemWidth: 10, itemHeight: 4 },
      grid: { left: 56, right: 24, top: 40, bottom: 40 },
      xAxis: { type: "category", data: dates, boundaryGap: false, ...AXIS, splitLine: { show: false } },
      yAxis: {
        type: "value", scale: true, ...AXIS,
        axisLabel: { color: "#7b8ba6", fontSize: 10, formatter: "{value}%" }
      },
      dataZoom: [
        { type: "inside" },
        { type: "slider", height: 14, bottom: 4, borderColor: "rgba(0,229,255,.2)",
          backgroundColor: "rgba(0,0,0,.2)", fillerColor: "rgba(0,229,255,.10)",
          handleStyle: { color: "#00e5ff" }, textStyle: { color: "#7b8ba6", fontSize: 9 } }
      ],
      series: series
    }, true);
  }
  $$("#cmpRange .chip").forEach((b) => b.onclick = () => {
    $$("#cmpRange .chip").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    state.cmpRange = parseInt(b.dataset.r, 10);
    loadCompare();
  });

  /* ------------------------------ 基金 ------------------------------ */
  async function loadFundWatch() {
    const data = await get("watchlist");
    state.funds = data.funds || [];
    renderFundWatch();
  }
  function renderFundWatch() {
    const box = $("#fundWatchList");
    $("#fundWlCount").textContent = state.funds.length + " 支";
    if (!state.funds.length) {
      box.innerHTML = '<div class="empty">暂无自选基金<br>在顶部搜索基金代码/名称，或点击排行列表</div>';
      return;
    }
    box.innerHTML = state.funds.map((f) => `
      <div class="wl-row ${f.code === state.fund.code ? "sel" : ""}" data-code="${f.code}">
        <div>
          <div class="nm">${f.name}</div>
          <div class="cd">${f.code}</div>
        </div>
        <span class="x">×</span>
      </div>`).join("");
    $$("#fundWatchList .wl-row").forEach((el) => {
      el.onclick = (e) => {
        if (e.target.classList.contains("x")) {
          del("watchlist/funds?code=" + el.dataset.code).then(() => {
            loadFundWatch(); toast("已移出自选基金");
          });
          return;
        }
        openFund(el.dataset.code);
      };
    });
  }
  async function addFund(item) {
    const r = await post("watchlist/funds", item);
    state.funds = r.items;
    renderFundWatch();
    if (r.added) toast("已加入自选基金");
  }
  $("#fundFavBtn").onclick = () => {
    if (!state.fund.code) return;
    const inList = state.funds.some((f) => f.code === state.fund.code);
    if (inList) {
      del("watchlist/funds?code=" + state.fund.code).then(() => { loadFundWatch(); toast("已移出"); });
    } else {
      addFund({ code: state.fund.code, name: $("#fundName").textContent });
    }
  };

  async function openFund(code) {
    state.fund.code = code;
    renderFundWatch();
    const info = await get("fund/info?code=" + code);
    if (info) {
      $("#fundName").textContent = info.name || code;
      $("#fundSub").textContent = `${info.code} · ${info.type || "--"} · ${info.company || ""} · 基金经理 ${info.manager || "--"}`;
      const k = (label, v, p, extra) => `<div class="kpi"><span>${label}</span>
        <b class="${p === undefined ? "" : cls(p)}">${v}</b>
        ${extra ? `<small class="${cls(p)}">${extra}</small>` : ""}</div>`;
      $("#fundKpi").innerHTML = [
        k("单位净值", info.nav ? info.nav.toFixed(4) : "--", info.dayPct, pct(info.dayPct) + " (" + (info.navDate || "") + ")"),
        k("累计净值", info.accNav ? info.accNav.toFixed(4) : "--"),
        k("近1周", pct(info.r1w), info.r1w),
        k("近1月", pct(info.r1m), info.r1m),
        k("近3月", pct(info.r3m), info.r3m),
        k("近1年", pct(info.r1y), info.r1y),
        k("今年来", pct(info.rThisYear), info.rThisYear),
        k("成立来", pct(info.rSince), info.rSince),
      ].join("");
      $("#fundFavBtn").textContent = state.funds.some((f) => f.code === code) ? "★ 已自选" : "+ 自选基金";
      $("#fundFavBtn").classList.toggle("active", state.funds.some((f) => f.code === code));
    }
    const nav = await get("fund/nav?code=" + code + "&size=400");
    state.fund.nav = nav || [];
    renderFundChart();
  }

  function renderFundChart() {
    const c = chart("fundChart");
    if (!c) return;
    const rows = state.fund.nav;
    if (!rows.length) { c.clear(); return; }
    const r = state.fund.range;
    const data = r > 0 ? rows.slice(-r) : rows;
    const first = data[0].nav || 1;
    const last = data[data.length - 1].nav || 1;
    const up = last >= first;
    const color = up ? UP : DOWN;
    c.setOption({
      animation: false,
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis", backgroundColor: "rgba(8,14,26,.94)",
        borderColor: "rgba(0,229,255,.35)", textStyle: { color: "#dbe6f5", fontSize: 11 },
        formatter: (ps) => {
          const d = data[ps[0].dataIndex];
          return `<b>${d.date}</b><br/>单位净值 ${d.nav.toFixed(4)}<br/>
            <span style="color:${d.pct >= 0 ? UP : DOWN}">日涨跌 ${pct(d.pct)}</span><br/>累计净值 ${d.accNav.toFixed(4)}`;
        }
      },
      grid: { left: 58, right: 26, top: 24, bottom: 46 },
      xAxis: { type: "category", data: data.map((d) => d.date), boundaryGap: false, ...AXIS, splitLine: { show: false } },
      yAxis: { type: "value", scale: true, ...AXIS, axisLabel: { color: "#7b8ba6", fontSize: 10, formatter: (v) => v.toFixed(3) } },
      dataZoom: [
        { type: "inside" },
        { type: "slider", height: 14, bottom: 4, borderColor: "rgba(0,229,255,.2)",
          backgroundColor: "rgba(0,0,0,.2)", fillerColor: "rgba(0,229,255,.10)",
          handleStyle: { color: "#00e5ff" }, textStyle: { color: "#7b8ba6", fontSize: 9 } }
      ],
      series: [{
        type: "line", data: data.map((d) => d.nav), symbol: "none", smooth: true,
        lineStyle: { width: 1.8, color: color, shadowColor: color + "99", shadowBlur: 10 },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: color + "44" }, { offset: 1, color: "rgba(0,0,0,0)" }])
        },
        markPoint: {
          symbolSize: 42,
          data: [{ type: "max", itemStyle: { color: UP + "cc" } }, { type: "min", itemStyle: { color: DOWN + "cc" } }],
          label: { fontSize: 9, color: "#fff" }
        }
      }]
    }, true);
  }
  $$("#fundNavRange .chip").forEach((b) => b.onclick = () => {
    $$("#fundNavRange .chip").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    state.fund.range = parseInt(b.dataset.r, 10);
    renderFundChart();
  });

  async function loadFundRank() {
    const kind = $("#fundRankKind .chip.active").dataset.k;
    const list = await get(`fund/rank?kind=${kind}&limit=40`);
    $("#fundRankBody").innerHTML = list.map((f) => `
      <tr data-code="${f.code}" data-name="${f.name}">
        <td>${f.name}<div class="cd" style="font-size:10px;color:var(--muted)">${f.code}</div></td>
        <td class="num">${f.nav ? f.nav.toFixed(4) : "--"}</td>
        <td class="num ${cls(f.dayPct)}">${pct(f.dayPct)}</td>
        <td class="num ${cls(f.r1y)}">${pct(f.r1y)}</td>
      </tr>`).join("");
    $$("#fundRankBody tr").forEach((tr) => {
      tr.onclick = () => openFund(tr.dataset.code);
    });
  }
  $$("#fundRankKind .chip").forEach((b) => b.onclick = () => {
    $$("#fundRankKind .chip").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    loadFundRank();
  });

  /* ------------------------------ 启动 ------------------------------ */
  async function boot() {
    tickClock();
    setInterval(tickClock, 1000);
    await loadWatch();
    await Promise.all([
      loadIndexes(), loadQuote(), loadChart(), loadRanks(),
      loadPlates(), loadNews(), loadFundRank(), openFund("110022")
    ]);
    refreshWatchQuotes();

    setInterval(() => {
      loadIndexes();
      loadQuote();
      refreshWatchQuotes();
      if (state.view === "market") loadRanks();
    }, 6000);

    setInterval(() => {
      if (state.view === "market") loadPlates();
      if (state.view === "hot") { loadPlates(); loadFlow(); loadRanks(); }
    }, 30000);

    setInterval(loadNews, 90000);
    setInterval(() => { if (state.view === "focus") loadFocus(); }, 20000);
    setInterval(() => { if (state.view === "market" && state.period === "trend") loadChart(); }, 30000);
  }

  boot().catch((e) => {
    console.error(e);
    $("#newsList").innerHTML = '<div class="empty">初始化失败：' + e.message + '</div>';
  });
})();
