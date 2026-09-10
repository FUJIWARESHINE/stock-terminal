# -*- coding: utf-8 -*-
"""QUANTA 智能行情终端 - 程序入口。"""
import os
import socket
import sys
import time
import webbrowser

from .server import start_server

TITLE = "QUANTA · 智能行情终端"
DEFAULT_PORT = 8765


def find_free_port(start=DEFAULT_PORT, tries=60):
    for i in range(tries):
        port = start + i
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    return start


def wait_forever():
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        pass


def main():
    argv = sys.argv[1:]
    use_browser = "--browser" in argv or os.environ.get("STOCK_BROWSER") == "1"
    port = find_free_port()
    httpd, port, thread = start_server(port)
    url = "http://127.0.0.1:%d/index.html" % port

    if not use_browser:
        try:
            import webview
            window = webview.create_window(
                TITLE, url,
                width=1560, height=960, min_size=(1180, 720),
                background_color="#05070d", text_select=False,
            )
            window.events.closed += lambda: httpd.shutdown()
            webview.start(debug=False)
            return
        except Exception:                              # noqa: BLE001
            pass

    webbrowser.open(url)
    print("QUANTA running at %s" % url)
    try:
        wait_forever()
    finally:
        httpd.shutdown()


if __name__ == "__main__":
    main()
