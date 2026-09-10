# -*- coding: utf-8 -*-
"""本地行情服务：HTTP 接口 + 静态前端资源。"""
import json
import os
import sys
import threading
import urllib.parse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from . import datasource as ds
from . import store


def web_root():
    """定位前端目录（开发环境与 PyInstaller 打包后均可用）。"""
    base = getattr(sys, "_MEIPASS", None)
    if base:
        cand = os.path.join(base, "web")
        if os.path.isdir(cand):
            return cand
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(here, "..", "web")


class Handler(SimpleHTTPRequestHandler):
    root = None

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=self.root, **kwargs)

    # ---------------------------------------------------------- utils
    def _send(self, obj, status=200):
        raw = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            self.wfile.write(raw)
        except (BrokenPipeError, ConnectionAbortedError):
            pass

    def _ok(self, data):
        self._send({"ok": True, "data": data})

    def _err(self, msg, status=500):
        self._send({"ok": False, "msg": str(msg)}, status)

    def _query(self):
        q = urllib.parse.urlparse(self.path).query
        return {k: v[0] for k, v in urllib.parse.parse_qs(q).items()}

    def _body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return {}
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except ValueError:
            return {}

    def log_message(self, fmt, *args):
        pass

    # ---------------------------------------------------------- routes
    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if not path.startswith("/api/"):
            return super().do_GET()
        q = self._query()
        try:
            self._route_get(path, q)
        except Exception as exc:                       # noqa: BLE001
            self._err("%s: %s" % (type(exc).__name__, exc))

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        body = self._body()
        try:
            if path == "/api/watchlist/stocks":
                items, added = store.add_stock(body or {})
                self._ok({"items": items, "added": added})
            elif path == "/api/watchlist/funds":
                items, added = store.add_fund(body or {})
                self._ok({"items": items, "added": added})
            else:
                self._err("not found", 404)
        except Exception as exc:                       # noqa: BLE001
            self._err("%s: %s" % (type(exc).__name__, exc))

    def do_DELETE(self):
        path = urllib.parse.urlparse(self.path).path
        q = self._query()
        try:
            if path == "/api/watchlist/stocks":
                items, removed = store.remove_stock(q.get("secid", ""))
                self._ok({"items": items, "removed": removed})
            elif path == "/api/watchlist/funds":
                items, removed = store.remove_fund(q.get("code", ""))
                self._ok({"items": items, "removed": removed})
            else:
                self._err("not found", 404)
        except Exception as exc:                       # noqa: BLE001
            self._err("%s: %s" % (type(exc).__name__, exc))

    def _route_get(self, path, q):
        if path == "/api/indexes":
            self._ok(ds.index_quotes())
        elif path == "/api/search":
            self._ok(ds.search(q.get("kw", ""), int(q.get("limit", 12))))
        elif path == "/api/quote":
            self._ok(ds.quote(q.get("secids", "")))
        elif path == "/api/kline":
            self._ok(ds.kline(q.get("secid", "1.000001"),
                              q.get("period", "day"),
                              int(q.get("fqt", 1)),
                              int(q.get("limit", 320))))
        elif path == "/api/trend":
            self._ok(ds.trend(q.get("secid", "1.000001"), int(q.get("ndays", 1))))
        elif path == "/api/rank":
            self._ok(ds.rank_stocks(q.get("sort", "f3"), int(q.get("limit", 20))))
        elif path == "/api/plates":
            self._ok(ds.plates(q.get("kind", "industry"), int(q.get("limit", 20))))
        elif path == "/api/plate-stocks":
            self._ok(ds.plate_stocks(q.get("secid", ""), int(q.get("limit", 12))))
        elif path == "/api/fundflow":
            self._ok(ds.fund_flow(int(q.get("limit", 15))))
        elif path == "/api/news":
            self._ok(ds.news(q.get("column", "flash"), int(q.get("size", 30))))
        elif path == "/api/fund/info":
            self._ok(ds.fund_info(q.get("code", "")))
        elif path == "/api/fund/nav":
            self._ok(ds.fund_nav(q.get("code", ""), int(q.get("page", 1)),
                                 int(q.get("size", 120))))
        elif path == "/api/fund/rank":
            self._ok(ds.fund_rank(q.get("kind", "all"), int(q.get("limit", 30))))
        elif path == "/api/watchlist":
            self._ok(store.get_all())
        elif path == "/api/ping":
            self._ok({"ts": __import__("time").time()})
        else:
            self._err("not found", 404)


def create_server(port=0, host="127.0.0.1"):
    handler = type("BoundHandler", (Handler,), {"root": os.path.abspath(web_root())})
    httpd = ThreadingHTTPServer((host, port), handler)
    httpd.daemon_threads = True
    return httpd


def start_server(port=0, host="127.0.0.1"):
    httpd = create_server(port, host)
    t = threading.Thread(target=httpd.serve_forever, name="stock-http", daemon=True)
    t.start()
    return httpd, httpd.server_address[1], t
