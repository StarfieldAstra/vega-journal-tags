#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Vega 图标生成器（位图素材版，取代 tools/make_logo.js 的矢量星标方案）

设计语言：深空行星环。与「黑底圆角方块」同源，但用超椭圆（squircle）遮罩
切出圆角，四角透明 —— 在浅色浏览器工具栏上不会糊成一个黑方块。

三个关键处理：
1. 光学裁切（optical crop）：小尺寸下把行星盘放大到画面主体，环退化为两条弧，
   避免「整幅缩略后糊成一团」；大尺寸保留完整环。
2. 超椭圆遮罩：|x/a|^n + |y/a|^n <= 1（n≈4），4 倍超采样 + LANCZOS 出抗锯齿边。
3. 小尺寸补偿：16/32px 提对比 + USM 锐化，把环的高光从辉光里拉出来。

用法：
    python tools/make_logo_bitmap.py            # 生成全部尺寸
    python tools/make_logo_bitmap.py --preview  # 另出预览核对图（浅底/深底 + 放大）
    python tools/make_logo_bitmap.py --sheet    # 另出候选裁切对比图
"""
import argparse
import os
import sys

import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXT = os.path.join(ROOT, 'extension')
REL = os.path.join(ROOT, 'release')

# 素材：深空行星环（1254x1254，已随仓库保存于 assets/）。可换源图，但需保持深色底 + 中心主体。
DEFAULT_SRC = os.path.join(ROOT, 'assets', 'logo-source.jpg')

# 不透明底色（store 徽标与 logo-black 用：商店要求无 alpha）
SOLID_BG = (14, 15, 20)

# 行星盘中心（画面比例坐标）—— 小尺寸裁切以此为锚
CENTER = (0.500, 0.470)


def load(src):
    im = Image.open(src).convert('RGB')
    return im


def crop_box(im, center, frac):
    """按画面比例中心做正方形裁切，frac = 裁切边长 / 原图边长"""
    w, h = im.size
    side = int(round(min(w, h) * frac))
    cx, cy = center[0] * w, center[1] * h
    x = min(max(cx - side / 2, 0), w - side)
    y = min(max(cy - side / 2, 0), h - side)
    return im.crop((int(round(x)), int(round(y)), int(round(x + side)), int(round(y + side))))


def squircle_mask(size, n=4.0, ss=4):
    """超椭圆遮罩：四角透明、边缘抗锯齿。n=2 为圆，n≈4 为 iOS 风格圆角方"""
    S = size * ss
    a = (np.arange(S) + 0.5) / S * 2 - 1          # [-1, 1]
    X, Y = np.meshgrid(a, a)
    d = np.abs(X) ** n + np.abs(Y) ** n
    m = np.clip((1.0 - d) * (S / 4.0), 0, 1)      # 过渡带宽度 ≈ 4 输出像素
    img = Image.fromarray((m * 255).astype(np.uint8), 'L')
    return img.resize((size, size), Image.LANCZOS)


def adjust(im, contrast=1.0, sharp=0.0, sat=1.0):
    """小尺寸补偿：提对比 → 提饱和 → USM 锐化"""
    if contrast != 1.0:
        arr = np.asarray(im).astype(np.float32)
        mean = arr.mean()
        arr = np.clip((arr - mean) * contrast + mean, 0, 255)
        im = Image.fromarray(arr.astype(np.uint8), 'RGB')
    if sat != 1.0:
        hsv = np.asarray(im.convert('HSV')).astype(np.float32)
        hsv[..., 1] = np.clip(hsv[..., 1] * sat, 0, 255)
        im = Image.fromarray(hsv.astype(np.uint8), 'HSV').convert('RGB')
    if sharp > 0:
        im = im.filter(ImageFilter.UnsharpMask(radius=1.0, percent=int(sharp * 100), threshold=2))
    return im


def render(im, size, center=CENTER, frac=1.0, contrast=1.0, sharp=0.0, sat=1.0, solid=False):
    out = crop_box(im, center, frac).resize((size, size), Image.LANCZOS)
    out = adjust(out, contrast, sharp, sat)
    out = out.convert('RGBA')
    if solid:
        # 实底版本直接输出 RGB：商店徽标要求无 alpha 通道，顺带省一层全 255 的 alpha
        bg = Image.new('RGBA', (size, size), SOLID_BG + (255,))
        bg.alpha_composite(out)
        out = bg.convert('RGB')
    else:
        out.putalpha(squircle_mask(size))
    return out


# size, 输出路径, 裁切比例, 对比, 锐化, 饱和, 不透明底
TARGETS = [
    (16,   os.path.join(EXT, 'icon16.png'),            0.64, 1.20, 1.2, 1.15, False),
    (32,   os.path.join(EXT, 'icon32.png'),            0.72, 1.10, 0.8, 1.08, False),
    (48,   os.path.join(EXT, 'icon48.png'),            0.84, 1.04, 0.3, 1.02, False),
    (128,  os.path.join(EXT, 'icon128.png'),           0.95, 1.00, 0.0, 1.00, False),
    (128,  os.path.join(EXT, 'icon-black-128.png'),    0.95, 1.00, 0.0, 1.00, True),
    (300,  os.path.join(EXT, 'store-logo-300.png'),    0.99, 1.00, 0.0, 1.00, True),
    (1024, os.path.join(REL, 'logo-1024.png'),         1.00, 1.00, 0.0, 1.00, False),
]


def build(src, targets=None):
    im = load(src)
    os.makedirs(EXT, exist_ok=True)
    os.makedirs(REL, exist_ok=True)
    for size, out, frac, contrast, sharp, sat, solid in (targets or TARGETS):
        img = render(im, size, frac=frac, contrast=contrast, sharp=sharp, sat=sat, solid=solid)
        img.save(out, 'PNG', optimize=True)
        rel = os.path.relpath(out, ROOT).replace('\\', '/')
        print('%-30s %5dpx  %6.1f KB  crop=%.2f contrast=%.2f sharp=%.1f %s'
              % (rel, size, os.path.getsize(out) / 1024, frac, contrast, sharp,
                 'solid' if solid else 'alpha'))


def preview(src, out):
    """核对图：每个尺寸在浅底与深底上各画一遍（1 倍与 6 倍放大）"""
    im = load(src)
    sizes = [16, 32, 48, 128]
    rendered = {s: render(im, s, **{'frac': f, 'contrast': c, 'sharp': sh, 'sat': sa})
                for s, (f, c, sh, sa) in zip(sizes, [(0.64, 1.20, 1.2, 1.15), (0.72, 1.10, 0.8, 1.08),
                                                    (0.84, 1.04, 0.3, 1.02), (0.95, 1.00, 0.0, 1.00)])}
    Z, PAD, GAP = 6, 18, 14
    W = PAD * 2 + sum(s * Z + GAP for s in sizes)
    H = PAD * 2 + 128 * Z + 40
    canvas = Image.new('RGB', (W, H), (244, 245, 247))
    dark = Image.new('RGB', (W, 90), (28, 29, 34))
    canvas.paste(dark, (0, H - 90))
    x = PAD
    for s in sizes:
        big = rendered[s].resize((s * Z, s * Z), Image.NEAREST)
        canvas.paste(big, (x, PAD + 128 * Z - s * Z), big)
        x += s * Z + GAP
    x = PAD
    for s in sizes:
        canvas.paste(rendered[s], (x, H - 90 + (90 - s) // 2), rendered[s])
        x += s * Z + GAP
    canvas.save(out, 'PNG')
    print('预览 ->', out)


def sheet(src, out):
    """候选裁切对比：不同 frac 并排（都渲染到 128 看构图）"""
    im = load(src)
    fracs = [0.60, 0.68, 0.72, 0.78, 0.88, 1.00]
    tiles = [render(im, 128, frac=f) for f in fracs]
    W = 128 * len(tiles) + 12 * (len(tiles) + 1)
    canvas = Image.new('RGB', (W, 128 + 24), (250, 250, 252))
    for i, t in enumerate(tiles):
        canvas.paste(t, (12 + i * (128 + 12), 12), t)
    canvas.save(out, 'PNG')
    print('候选 ->', out, ' frac =', fracs)


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', default=DEFAULT_SRC)
    ap.add_argument('--preview', action='store_true')
    ap.add_argument('--sheet', action='store_true')
    a = ap.parse_args()
    if not os.path.exists(a.src):
        sys.exit('找不到素材图：%s' % a.src)
    build(a.src)
    if a.preview:
        preview(a.src, os.path.join(REL, 'logo-check.png'))
    if a.sheet:
        sheet(a.src, os.path.join(REL, 'logo-crops.png'))
