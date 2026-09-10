# -*- coding: utf-8 -*-
"""由主图标生成 Android 各密度 launcher 图标。"""
import os

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
SRC = os.path.join(ROOT, "assets", "icon.png")
RES = os.path.join(ROOT, "android", "app", "src", "main", "res")

SIZES = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}


def main():
    img = Image.open(SRC).convert("RGBA")
    for folder, size in SIZES.items():
        out_dir = os.path.join(RES, folder)
        os.makedirs(out_dir, exist_ok=True)
        out = os.path.join(out_dir, "ic_launcher.png")
        img.resize((size, size), Image.LANCZOS).save(out)
        print(out)


if __name__ == "__main__":
    main()
