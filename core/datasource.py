# -*- coding: utf-8 -*-
"""行情数据源：东方财富多节点 + 腾讯行情兜底（仅依赖标准库）。"""
import json
import re
import time
import urllib.parse
import urllib.request

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")
# 基金移动端接口会拒绝含 AppleWebKit 的桌面 UA
FUND_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122 Safari/537.36"

PUSH_HOSTS = ["https://push2.eastmoney.com", "https://push2delay.eastmoney.com"]
HIS_HOSTS = ["https://push2his.eastmoney.com", "https://push2delay.eastmoney.com"]
SEARCH = "https://searchapi.eastmoney.com/api/suggest/get"
NEWS = "https://np-listapi.eastmoney.com/comm/web/getNewsByColumns"
FUND_API = "https://fundmobapi.eastmoney.com/FundMNewApi"
FUND_F10 = "https://api.fund.eastmoney.com/f10/lsjz"
FUND_RANK = "https://fund.eastmoney.com/data/rankhandler.aspx"
TX_QUOTE = "https://qt.gtimg.cn/q="
TX_KLINE = "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get"
TX_MINUTE = "https://web.ifzq.gtimg.cn/appstock/app/minute/query"

_cache = {}
_host_fail = {}
FAIL_TTL = 45


def _cache_get(key, ttl):
    item = _cache.get(key)
    if item and time.time() - item[0] < ttl:
        return item[1]
    return None


def _cache_set(key, val):
    _cache[key] = (time.time(), val)
    if len(_cache) > 400:
        for k in list(_cache.keys())[:150]:
            _cache.pop(k, None)


def http_get(url, referer=None, timeout=10, encoding="utf-8", ua=None):
    headers = {"User-Agent": ua or UA, "Accept": "*/*"}
    if referer:
        headers["Referer"] = referer
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode(encoding, "ignore")


def _host_ok(url):
    host = urllib.parse.urlparse(url).netloc
    return time.time() - _host_fail.get(host, 0) > FAIL_TTL


def _mark_fail(url):
    _host_fail[urllib.parse.urlparse(url).netloc] = time.time()


def multi_get(urls, referer=None, timeout=10, encoding="utf-8", ua=None):
    """按优先级依次尝试多个数据源。"""
    err = None
    for url in urls:
        if not _host_ok(url):
            continue
        try:
            return http_get(url, referer, timeout, encoding, ua)
        except Exception as exc:                       # noqa: BLE001
            err = exc
            _mark_fail(url)
    raise RuntimeError("所有数据源均不可用" + ("（%s）" % err if err else ""))


def get_json_any(urls, referer=None, timeout=10, ttl=0, encoding="utf-8", ua=None):
    key = urls[0] if isinstance(urls, (list, tuple)) else urls
    if ttl:
        hit = _cache_get(key, ttl)
        if hit is not None:
            return hit
    if isinstance(urls, str):
        text = http_get(urls, referer, timeout, encoding, ua)
    else:
        text = multi_get(urls, referer, timeout, encoding, ua)
    data = json.loads(text)
    if ttl:
        _cache_set(key, data)
    return data


def _push(path):
    return [h + "/api/qt/" + path for h in PUSH_HOSTS]


def _his(path):
    return [h + "/api/qt/" + path for h in HIS_HOSTS]


def _num(v, default=0.0):
    if v is None or v == "" or v == "-":
        return default
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def _diff(data):
    d = ((data or {}).get("data") or {}).get("diff") or []
    if isinstance(d, dict):
        d = list(d.values())
    return d


def _tx_code(secid):
    market, code = (secid.split(".") + [""])[:2]
    return ("sh" if market == "1" else "sz") + code


# ---------------------------------------------------------------- 搜索
def search(keyword, count=12):
    kw = (keyword or "").strip()
    if not kw:
        return []
    url = ("%s?input=%s&type=14&token=D43BF722C8E33BDC906FB84D85E326E8&count=%d"
           % (SEARCH, urllib.parse.quote(kw), count))
    try:
        data = get_json_any(url, ttl=60)
    except Exception:
        return []
    rows = (data.get("QuotationCodeTable") or {}).get("Data") or []
    out = []
    for r in rows:
        qid = r.get("QuoteID") or ""
        if not qid:
            continue
        out.append({
            "code": r.get("Code", ""),
            "name": r.get("Name", ""),
            "secid": qid,
            "market": qid.split(".")[0],
            "type": r.get("Classify", ""),
            "typeName": r.get("SecurityTypeName", ""),
        })
    return out


# ---------------------------------------------------------------- 实时报价
def _fmt_quote(d):
    price = _num(d.get("f2"))
    pct = _num(d.get("f3"))
    return {
        "secid": "%s.%s" % (d.get("f13"), d.get("f12")),
        "code": d.get("f12", ""),
        "name": d.get("f14", ""),
        "price": price,
        "pct": pct,
        "change": _num(d.get("f4")),
        "volume": _num(d.get("f5")),
        "amount": _num(d.get("f6")),
        "amplitude": _num(d.get("f7")),
        "high": _num(d.get("f15")),
        "low": _num(d.get("f16")),
        "open": _num(d.get("f17")),
        "preClose": _num(d.get("f18")),
        "turnover": _num(d.get("f8")),
        "pe": _num(d.get("f9")),
        "mktcap": _num(d.get("f20")),
        "floatcap": _num(d.get("f21")),
        "mainInflow": _num(d.get("f62")),
    }


def _tx_quote(secids):
    """腾讯行情兜底（GBK 文本，字段按 ~ 分隔）。"""
    codes = [_tx_code(s) for s in secids]
    try:
        text = multi_get([TX_QUOTE + ",".join(codes)],
                         referer="https://gu.qq.com/", encoding="gbk")
    except Exception:
        return []
    out = []
    for seg in text.split(";"):
        seg = seg.strip()
        if not seg.startswith("v_"):
            continue
        body = seg.split('="')
        if len(body) < 2:
            continue
        p = body[1].strip('"\n ').split("~")
        if len(p) < 46:
            continue
        code = p[2]
        market = "1" if body[0].replace("v_", "").startswith("sh") else "0"
        price = _num(p[3])
        pre = _num(p[4])
        out.append({
            "secid": "%s.%s" % (market, code),
            "code": code,
            "name": p[1],
            "price": price,
            "pct": _num(p[32]),
            "change": _num(p[31]),
            "volume": _num(p[6]),
            "amount": _num(p[37]) * 10000,
            "amplitude": _num(p[43]),
            "high": _num(p[33]),
            "low": _num(p[34]),
            "open": _num(p[5]),
            "preClose": pre,
            "turnover": _num(p[38]),
            "pe": _num(p[39]),
            "mktcap": _num(p[45]) * 1e8,
            "floatcap": _num(p[44]) * 1e8,
            "mainInflow": 0.0,
        })
    return out


def quote(secids):
    ids = [s for s in (secids or "").split(",") if s]
    if not ids:
        return []
    fields = "f1,f2,f3,f4,f5,f6,f7,f8,f9,f12,f13,f14,f15,f16,f17,f18,f20,f21,f62,f115,f152"
    path = "ulist.np/get?secids=%s&fltt=2&invt=2&fields=%s" % (",".join(ids), fields)
    try:
        data = get_json_any(_push(path), ttl=3)
        rows = [_fmt_quote(d) for d in _diff(data)]
        if rows:
            return rows
    except Exception:
        pass
    return _tx_quote(ids)


MARKET_INDEX = ["1.000001", "0.399001", "0.399006", "1.000688", "1.000300"]
INDEX_NAME = {"1.000001": "上证指数", "0.399001": "深证成指", "0.399006": "创业板指",
              "1.000688": "科创50", "1.000300": "沪深300"}


def index_quotes():
    fields = "f1,f2,f3,f4,f6,f12,f13,f14"
    path = "ulist.np/get?secids=%s&fltt=2&invt=2&fields=%s" % (",".join(MARKET_INDEX), fields)
    try:
        data = get_json_any(_push(path), ttl=5)
        rows = _diff(data)
        if rows:
            out = []
            for d in rows:
                secid = "%s.%s" % (d.get("f13"), d.get("f12"))
                out.append({
                    "secid": secid,
                    "name": INDEX_NAME.get(secid, d.get("f14", "")),
                    "price": _num(d.get("f2")),
                    "pct": _num(d.get("f3")),
                    "change": _num(d.get("f4")),
                    "amount": _num(d.get("f6")),
                })
            return out
    except Exception:
        pass
    qmap = {q["secid"]: q for q in _tx_quote(MARKET_INDEX)}
    return [{"secid": s, "name": INDEX_NAME.get(s, s),
             "price": qmap.get(s, {}).get("price", 0),
             "pct": qmap.get(s, {}).get("pct", 0),
             "change": qmap.get(s, {}).get("change", 0),
             "amount": qmap.get(s, {}).get("amount", 0)} for s in MARKET_INDEX]


# ---------------------------------------------------------------- K线 / 分时
KLT_MAP = {"day": 101, "week": 102, "month": 103, "5": 5, "15": 15, "30": 30, "60": 60}
TX_PERIOD = {"day": "day", "week": "week", "month": "month",
             "5": "m5", "15": "m15", "30": "m30", "60": "m60"}


def kline(secid, period="day", fqt=1, limit=320):
    klt = KLT_MAP.get(period, 101)
    fields1 = "f1,f2,f3,f4,f5,f6"
    fields2 = "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61"
    path = ("stock/kline/get?secid=%s&klt=%d&fqt=%d&beg=19900101&end=20500101"
            "&fields1=%s&fields2=%s" % (secid, klt, fqt, fields1, fields2))
    try:
        data = get_json_any(_his(path), ttl=30)
        kl = ((data or {}).get("data") or {}).get("klines") or []
        if kl:
            rows = []
            for line in kl[-limit:]:
                p = line.split(",")
                if len(p) < 7:
                    continue
                rows.append({
                    "t": p[0],
                    "o": _num(p[1]), "c": _num(p[2]), "h": _num(p[3]), "l": _num(p[4]),
                    "v": _num(p[5]), "amt": _num(p[6]),
                    "pct": _num(p[8]) if len(p) > 8 else 0.0,
                    "turn": _num(p[10]) if len(p) > 10 else 0.0,
                })
            meta = data.get("data") or {}
            return {"rows": rows, "name": meta.get("name", ""), "code": meta.get("code", ""),
                    "preClose": _num(meta.get("preKPrice"))}
    except Exception:
        pass
    return _tx_kline(secid, period, limit)


def _tx_kline(secid, period, limit):
    code = _tx_code(secid)
    per = TX_PERIOD.get(period, "day")
    url = "%s?param=%s,%s,,,%d,qfq" % (TX_KLINE, code, per, limit)
    try:
        data = get_json_any(url, referer="https://gu.qq.com/", ttl=30)
    except Exception:
        return {"rows": [], "name": "", "code": secid.split(".")[-1], "preClose": 0}
    node = ((data or {}).get("data") or {}).get(code) or {}
    arr = node.get("qfq" + per) or node.get(per) or []
    rows = []
    for p in arr[-limit:]:
        if len(p) < 6:
            continue
        o, c, h, l = _num(p[1]), _num(p[2]), _num(p[3]), _num(p[4])
        pre = rows[-1]["c"] if rows else o
        rows.append({
            "t": p[0], "o": o, "c": c, "h": h, "l": l,
            "v": _num(p[5]), "amt": 0.0,
            "pct": ((c - pre) / pre * 100) if pre else 0.0,
            "turn": 0.0,
        })
    return {"rows": rows, "name": node.get("qtname", "") or "",
            "code": secid.split(".")[-1], "preClose": rows[-1]["c"] if rows else 0}


def trend(secid, ndays=1):
    path = ("stock/trends2/get?secid=%s&fields1=f1,f2,f3,f4,f5,f6,f7,f8"
            "&fields2=f51,f52,f53,f54,f55,f56,f57,f58&iscr=0&ndays=%d" % (secid, ndays))
    try:
        data = get_json_any(_his(path), ttl=8)
        d = (data or {}).get("data") or {}
        if d.get("trends"):
            rows = []
            for line in d["trends"]:
                p = line.split(",")
                if len(p) < 7:
                    continue
                rows.append({
                    "t": p[0], "o": _num(p[1]), "c": _num(p[2]),
                    "h": _num(p[3]), "l": _num(p[4]),
                    "v": _num(p[5]), "amt": _num(p[6]),
                    "avg": _num(p[7]) if len(p) > 7 else 0.0,
                })
            return {"rows": rows, "name": d.get("name", ""), "preClose": _num(d.get("preClose"))}
    except Exception:
        pass
    return _tx_trend(secid)


def _tx_trend(secid):
    code = _tx_code(secid)
    url = "%s?code=%s" % (TX_MINUTE, code)
    pre = 0.0
    try:
        q = _tx_quote([secid])
        if q:
            pre = q[0]["preClose"]
    except Exception:
        pass
    try:
        data = get_json_any(url, referer="https://gu.qq.com/", ttl=8)
    except Exception:
        return {"rows": [], "name": "", "preClose": pre}
    node = ((data or {}).get("data") or {}).get(code) or {}
    raw = ((node.get("data") or {}).get("data") or [])
    date = (node.get("data") or {}).get("date", "")
    rows = []
    for line in raw:
        p = line.split()
        if len(p) < 3:
            continue
        hh, mm = p[0][:2], p[0][2:]
        rows.append({
            "t": "%s-%s-%s %s:%s" % (date[:4], date[4:6], date[6:], hh, mm),
            "o": _num(p[1]), "c": _num(p[1]), "h": _num(p[1]), "l": _num(p[1]),
            "v": _num(p[2]), "amt": _num(p[3]) if len(p) > 3 else 0.0,
            "avg": 0.0,
        })
    # 腾讯分时无均价，用累计成交额/累计成交量近似
    cum_v = 0.0
    cum_a = 0.0
    for r in rows:
        cum_v += r["v"]
        cum_a += r["amt"]
        r["avg"] = (cum_a / cum_v) if cum_v else r["c"]
    return {"rows": rows, "name": "", "preClose": pre}


# ---------------------------------------------------------------- 榜单 / 热点
FS_STOCK = "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048"
FS_PLATE_IND = "m:90+t:2"
FS_PLATE_CON = "m:90+t:3"


def _clist(fs, fid="f3", pz=20, fields="f2,f3,f4,f5,f6,f12,f13,f14,f62,f184", po=1):
    path = ("clist/get?pn=1&pz=%d&po=%d&np=1&fltt=2&invt=2&fid=%s&fs=%s&fields=%s"
            % (pz, po, fid, urllib.parse.quote(fs, safe=":,+"), fields))
    try:
        data = get_json_any(_push(path), ttl=10)
    except Exception:
        return []
    return _diff(data)


def rank_stocks(sort="f3", limit=20):
    out = []
    for d in _clist(FS_STOCK, fid=sort, pz=limit):
        out.append({
            "secid": "%s.%s" % (d.get("f13"), d.get("f12")),
            "code": d.get("f12", ""),
            "name": d.get("f14", ""),
            "price": _num(d.get("f2")),
            "pct": _num(d.get("f3")),
            "change": _num(d.get("f4")),
            "amount": _num(d.get("f6")),
            "mainInflow": _num(d.get("f62")),
            "mainPct": _num(d.get("f184")),
        })
    return out


def plates(kind="industry", limit=20):
    fs = FS_PLATE_IND if kind == "industry" else FS_PLATE_CON
    fields = "f2,f3,f12,f13,f14,f62,f104,f105,f128,f136,f140,f141,f207,f222"
    out = []
    for d in _clist(fs, fid="f3", pz=limit, fields=fields):
        out.append({
            "secid": "%s.%s" % (d.get("f13"), d.get("f12")),
            "code": d.get("f12", ""),
            "name": d.get("f14", ""),
            "price": _num(d.get("f2")),
            "pct": _num(d.get("f3")),
            "mainInflow": _num(d.get("f62")),
            "upCount": _num(d.get("f104")),
            "downCount": _num(d.get("f105")),
            "leader": d.get("f128", ""),
            "leaderCode": d.get("f140", ""),
            "leaderPct": _num(d.get("f136")),
        })
    return out


def plate_stocks(plate_secid, limit=12):
    code = plate_secid.split(".")[-1]
    out = []
    for d in _clist("b:%s" % code, fid="f3", pz=limit,
                    fields="f2,f3,f12,f13,f14,f62"):
        out.append({
            "secid": "%s.%s" % (d.get("f13"), d.get("f12")),
            "code": d.get("f12", ""),
            "name": d.get("f14", ""),
            "price": _num(d.get("f2")),
            "pct": _num(d.get("f3")),
            "mainInflow": _num(d.get("f62")),
        })
    return out


def fund_flow(limit=15):
    out = []
    for d in _clist(FS_STOCK, fid="f62", pz=limit,
                    fields="f2,f3,f12,f13,f14,f62,f184"):
        out.append({
            "secid": "%s.%s" % (d.get("f13"), d.get("f12")),
            "code": d.get("f12", ""),
            "name": d.get("f14", ""),
            "price": _num(d.get("f2")),
            "pct": _num(d.get("f3")),
            "mainInflow": _num(d.get("f62")),
            "mainPct": _num(d.get("f184")),
        })
    return out


# ---------------------------------------------------------------- 资讯
NEWS_COLUMNS = {"flash": "347", "yaowen": "350", "stock": "348"}
NEWS_MIRROR = [
    "https://np-listapi.eastmoney.com/comm/web/getNewsByColumns",
    "https://np-listapi.eastmoney.com/comm/web/getListInfo",
]


def news(column="flash", size=30):
    col = NEWS_COLUMNS.get(column, "347")
    q = ("?client=web&biz=web_news_col&column=%s&order=1&needInteractData=0"
         "&page_index=1&page_size=%d&req_trace=1"
         "&fields=code,showTime,title,mediaName,summary,url,uniqueUrl,NPageIndex&types=1,20"
         % (col, size))
    try:
        data = get_json_any([NEWS + q], ttl=60)
    except Exception:
        return []
    lst = ((data or {}).get("data") or {}).get("list") or []
    out = []
    for n in lst:
        out.append({
            "id": n.get("code", ""),
            "time": n.get("showTime", ""),
            "title": n.get("title", ""),
            "source": n.get("mediaName", ""),
            "summary": n.get("summary", ""),
            "url": n.get("uniqueUrl") or n.get("url") or "",
        })
    return out


# ---------------------------------------------------------------- 基金
def fund_info(code):
    url = ("%s/FundMNBasicInformation?FCODE=%s&deviceid=ST&plat=Android"
           "&product=EFund&version=1.0" % (FUND_API, code))
    try:
        data = get_json_any(url, ttl=120, ua=FUND_UA)
    except Exception:
        return None
    d = (data or {}).get("Datas") or {}
    if not d:
        return None
    return {
        "code": d.get("FCODE", code),
        "name": d.get("SHORTNAME", ""),
        "type": d.get("FTYPE", ""),
        "company": d.get("JJGS", "") or "",
        "manager": d.get("JJJL", "") or "",
        "nav": _num(d.get("DWJZ")),
        "accNav": _num(d.get("LJJZ")),
        "navDate": d.get("FSRQ", ""),
        "dayPct": _num(d.get("RZDF")),
        "scale": d.get("ENDNAV", "") or "",
        "establish": d.get("ISSBDATE", "") or d.get("PLTDATE", "") or "",
        "buyStatus": d.get("SGZT", ""),
        "sellStatus": d.get("SHZT", ""),
        "fee": d.get("SOURCERATE", ""),
        "r1w": _num(d.get("SYL_Z")),
        "r1m": _num(d.get("SYL_Y")),
        "r3m": _num(d.get("SYL_3Y")),
        "r6m": _num(d.get("SYL_6Y")),
        "r1y": _num(d.get("SYL_1N")),
        "r2y": _num(d.get("SYL_2N")),
        "r3y": _num(d.get("SYL_3N")),
        "rThisYear": _num(d.get("SYL_JN")),
        "rSince": _num(d.get("SYL_LN")),
    }


def fund_nav(code, page=1, size=120):
    url = "%s?fundCode=%s&pageIndex=%d&pageSize=%d" % (FUND_F10, code, page, size)
    try:
        data = get_json_any(url, referer="https://fundf10.eastmoney.com/jjjz_%s.html" % code,
                            ttl=300)
    except Exception:
        return []
    lst = (((data or {}).get("Data") or {}).get("LSJZList")) or []
    rows = []
    for r in lst:
        rows.append({
            "date": r.get("FSRQ", ""),
            "nav": _num(r.get("DWJZ")),
            "accNav": _num(r.get("LJJZ")),
            "pct": _num(r.get("JZZZL")),
            "buy": r.get("SGZT", ""),
            "sell": r.get("SHZT", ""),
        })
    rows.reverse()
    return rows


def fund_rank(kind="all", limit=30):
    ft = {"all": "all", "gp": "gp", "hh": "hh", "zq": "zq",
          "zs": "zs", "qdii": "qdii", "hb": "hb"}.get(kind, "all")
    url = ("%s?op=ph&dt=kf&ft=%s&rs=&gs=0&sc=1nzf&st=desc&pi=1&pn=%d&dx=1"
           % (FUND_RANK, ft, limit))
    try:
        text = http_get(url, referer="https://fund.eastmoney.com/data/fundranking.html")
    except Exception:
        return []
    m = re.search(r"datas:\[(.*?)\],allRecords", text, re.S) or \
        re.search(r"datas:\[(.*?)\]", text, re.S)
    if not m:
        return []
    out = []
    for seg in re.findall(r'"(.*?)"', m.group(1)):
        p = seg.split(",")
        if len(p) < 10:
            continue
        out.append({
            "code": p[0],
            "name": p[1],
            "date": p[3],
            "nav": _num(p[4]),
            "accNav": _num(p[5]),
            "dayPct": _num(p[6]),
            "r1w": _num(p[7]),
            "r1m": _num(p[8]),
            "r3m": _num(p[9]),
            "r6m": _num(p[10]) if len(p) > 10 else 0.0,
            "r1y": _num(p[11]) if len(p) > 11 else 0.0,
            "r2y": _num(p[12]) if len(p) > 12 else 0.0,
            "r3y": _num(p[13]) if len(p) > 13 else 0.0,
            "rThisYear": _num(p[14]) if len(p) > 14 else 0.0,
            "rSince": _num(p[15]) if len(p) > 15 else 0.0,
            "fee": p[18] if len(p) > 18 else "",
        })
    return out
