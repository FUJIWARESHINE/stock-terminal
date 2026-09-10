# -*- coding: utf-8 -*-
"""自选股 / 自选基金持久化存储。"""
import json
import os
import threading

APP_NAME = "StockTerminal"

_lock = threading.RLock()


def data_dir():
    base = os.environ.get("APPDATA") or os.path.expanduser("~")
    path = os.path.join(base, APP_NAME)
    try:
        os.makedirs(path, exist_ok=True)
    except OSError:
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
        os.makedirs(path, exist_ok=True)
    return path


def _file():
    return os.path.join(data_dir(), "watchlist.json")


def _load():
    try:
        with open(_file(), "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        data = {}
    data.setdefault("stocks", [])
    data.setdefault("funds", [])
    return data


def _save(data):
    with open(_file(), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def get_all():
    with _lock:
        return _load()


def list_stocks():
    with _lock:
        return _load().get("stocks", [])


def add_stock(item):
    with _lock:
        data = _load()
        for it in data["stocks"]:
            if it.get("secid") == item.get("secid"):
                return data["stocks"], False
        data["stocks"].append(item)
        _save(data)
        return data["stocks"], True


def remove_stock(secid):
    with _lock:
        data = _load()
        before = len(data["stocks"])
        data["stocks"] = [x for x in data["stocks"] if x.get("secid") != secid]
        _save(data)
        return data["stocks"], len(data["stocks"]) != before


def list_funds():
    with _lock:
        return _load().get("funds", [])


def add_fund(item):
    with _lock:
        data = _load()
        for it in data["funds"]:
            if it.get("code") == item.get("code"):
                return data["funds"], False
        data["funds"].append(item)
        _save(data)
        return data["funds"], True


def remove_fund(code):
    with _lock:
        data = _load()
        before = len(data["funds"])
        data["funds"] = [x for x in data["funds"] if x.get("code") != code]
        _save(data)
        return data["funds"], len(data["funds"]) != before
