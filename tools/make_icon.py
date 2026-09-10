# -*- coding: utf-8 -*-
"""生成 QUANTA 终端高清图标：圆角深色底板 + 霓虹 K 线 + 上升趋势线。"""
import os

from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "..", "assets")
S = 1024
SS = 3
N = S * SS

UP = (255, 77, 79)
DOWN = (0, 224, 143)
CYAN = (0, 229, 255)
MAGENTA = (255, 45, 120)

CANDLES = [
    (206, 700, 646, 622, 726),
    (330, 646, 692, 618, 712),
    (454, 692, 566, 540, 704),
    (578, 566, 604, 528, 626),
    (702, 604, 456, 432, 616),
    (826, 456, 322, 300, 470),
]
VOLUMES = [0.30, 0.46, 0.62, 0.48, 0.78, 1.0]


def r(v):
    return int(round(v * SS))


def radial_glow(color, center, radius, strength):
    g = Image.new("L", (256, 256), 0)
    px = g.load()
    cx, cy = center
    for y in range(256):
        fy = (y / 255.0 - cy) ** 2
        for x in range(256):
            d = ((x / 255.0 - cx) ** 2 + fy) ** 0.5
            v = 1 - d / radius
            if v > 0:
                px[x, y] = int(255 * (v ** 2) * strength)
    layer = Image.new("RGBA", (N, N), color + (0,))
    layer.putalpha(g.resize((N, N), Image.BICUBIC))
    return layer


def linear_bg(c1, c2):
    g = Image.new("RGB", (256, 256))
    px = g.load()
    for y in range(256):
        t = y / 255.0
        col = tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3))
        for x in range(256):
            px[x, y] = col
    return g.resize((N, N), Image.BICUBIC).convert("RGBA")


def rounded_mask(radius):
    m = Image.new("L", (N, N), 0)
    ImageDraw.Draw(m).rounded_rectangle(
        [0, 0, N - 1, N - 1], radius=r(radius), fill=255)
    return m


def draw_candle(d, cx, o, c, h, l, w):
    col = UP if c < o else DOWN
    top, bot = min(o, c), max(o, c)
    d.rounded_rectangle([cx - w / 2, h, cx + w / 2, l], radius=r(10), fill=col)
    d.rounded_rectangle([cx - w / 2, top, cx + w / 2, bot], radius=r(8), fill=col)
    return col


def main():
    mask = rounded_mask(224)

    # 外发光
    canvas = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    halo = Image.new("RGBA", (N, N), CYAN + (0,))
    halo.putalpha(mask.filter(ImageFilter.GaussianBlur(r(26))))
    canvas.alpha_composite(halo.point(lambda a: int(a * 0.55)))

    # 底板
    board = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    board.alpha_composite(linear_bg((11, 18, 32), (4, 6, 12)))
    board.alpha_composite(radial_glow(CYAN, (0.22, 0.18), 0.85, 0.70))
    board.alpha_composite(radial_glow(MAGENTA, (0.86, 0.92), 0.70, 0.42))
    board.putalpha(ImageChops_mult(mask))
    canvas.alpha_composite(board)

    d = ImageDraw.Draw(canvas)

    # 网格
    for i in range(1, 5):
        y = 250 + i * 100
        d.line([(r(120), r(y)), (r(912), r(y))], fill=(120, 200, 230, 26), width=r(2))
    for i in range(5):
        x = 160 + i * 176
        d.line([(r(x), r(250)), (r(x), r(650))], fill=(120, 200, 230, 18), width=r(2))

    # 成交量柱
    for (cx, _, _, _, _), v in zip(CANDLES, VOLUMES):
        h = 96 * v
        d.rounded_rectangle(
            [cx - 26, 872 - h, cx + 26, 872], radius=r(6),
            fill=(0, 229, 255, 90))

    # K 线发光层
    glow_up = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    glow_dn = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    gu, gd = ImageDraw.Draw(glow_up), ImageDraw.Draw(glow_dn)
    for cx, o, c, h, l in CANDLES:
        target = gu if c < o else gd
        col = UP if c < o else DOWN
        top, bot = min(o, c), max(o, c)
        # 仅对实体做发光，避免影线顶端形成散斑
        target.rounded_rectangle(
            [r(cx - 30), r(top) - r(2), r(cx + 30), r(bot) + r(2)], radius=r(12), fill=col)
    canvas.alpha_composite(glow_up.filter(ImageFilter.GaussianBlur(r(14))).point(lambda a: int(a * 0.65)))
    canvas.alpha_composite(glow_dn.filter(ImageFilter.GaussianBlur(r(14))).point(lambda a: int(a * 0.65)))

    # K 线本体
    body = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    bd = ImageDraw.Draw(body)
    for cx, o, c, h, l in CANDLES:
        draw_candle(bd, r(cx), r(o), r(c), r(h), r(l), r(60))
    canvas.alpha_composite(body)

    # 趋势线（Catmull-Rom 平滑曲线）
    ctrl = [(140, 760)] + [(cx, c) for cx, _, c, _, _ in CANDLES] + [(880, 270)]
    smooth = []
    steps = 28
    for i in range(len(ctrl) - 1):
        p0 = ctrl[i - 1] if i > 0 else ctrl[i]
        p1 = ctrl[i]
        p2 = ctrl[i + 1]
        p3 = ctrl[i + 2] if i + 2 < len(ctrl) else ctrl[i + 1]
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        for s in range(steps):
            u = s / steps
            x = (1 - u) ** 3 * p1[0] + 3 * (1 - u) ** 2 * u * c1[0] + \
                3 * (1 - u) * u * u * c2[0] + u ** 3 * p2[0]
            y = (1 - u) ** 3 * p1[1] + 3 * (1 - u) ** 2 * u * c1[1] + \
                3 * (1 - u) * u * u * c2[1] + u ** 3 * p2[1]
            smooth.append((x, y))
    smooth.append(ctrl[-1])

    line_layer = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    ImageDraw.Draw(line_layer).line(
        [(r(x), r(y)) for x, y in smooth], fill=CYAN, width=r(13))
    canvas.alpha_composite(
        line_layer.filter(ImageFilter.GaussianBlur(r(18))).point(lambda a: int(a * 0.85)))
    d.line([(r(x), r(y)) for x, y in smooth], fill=CYAN, width=r(13))
    d.line([(r(x), r(y - 3)) for x, y in smooth], fill=(210, 250, 255), width=r(4))

    # 箭头
    ax, ay = 826, 300
    d.polygon([(r(ax - 96), r(ay - 8)), (r(ax + 44), r(ay - 8)), (r(ax - 26), r(ay - 128))],
              fill=CYAN)
    arrow_glow = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    ImageDraw.Draw(arrow_glow).polygon(
        [(r(ax - 96), r(ay - 8)), (r(ax + 44), r(ay - 8)), (r(ax - 26), r(ay - 128))], fill=CYAN)
    canvas.alpha_composite(arrow_glow.filter(ImageFilter.GaussianBlur(r(24))).point(lambda a: int(a * 0.8)))
    d.polygon([(r(ax - 96), r(ay - 8)), (r(ax + 44), r(ay - 8)), (r(ax - 26), r(ay - 128))],
              fill=CYAN)

    # 边框
    edge = ImageDraw.Draw(canvas)
    edge.rounded_rectangle([r(14), r(14), N - r(14), N - r(14)],
                           radius=r(212), outline=(0, 229, 255, 190), width=r(9))

    icon = canvas.resize((S, S), Image.LANCZOS)

    os.makedirs(OUT_DIR, exist_ok=True)
    png = os.path.abspath(os.path.join(OUT_DIR, "icon.png"))
    icon.save(png)
    ico = os.path.abspath(os.path.join(OUT_DIR, "icon.ico"))
    icon.save(ico, sizes=[(256, 256), (128, 128), (96, 96), (64, 64), (48, 48), (32, 32), (16, 16)])
    print("PNG:", png)
    print("ICO:", ico)


def ImageChops_mult(mask):
    from PIL import ImageChops
    return ImageChops.multiply(mask, Image.new("L", (N, N), 255))


if __name__ == "__main__":
    main()
