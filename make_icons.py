# -*- coding: utf-8 -*-
"""
依存ゼロのPNGアイコン生成（PIL不要・zlibのみ）。
ダーク単色背景＋シンプルな白マイク。192/512を出力。
3xスーパーサンプリングでエッジを滑らかに。
"""
import struct, zlib, math, os

BG  = (16, 18, 24)     # #101218 ダーク背景（manifestのbackground_colorと一致）
MIC = (240, 243, 250)  # ほぼ白のマイク
SS  = 3                # スーパーサンプリング倍率

def rounded_rect(x, y, w, h, r):
    def inside(px, py):
        # 角丸長方形の内側判定
        cx = min(max(px, x + r), x + w - r)
        cy = min(max(py, y + r), y + h - r)
        return (px - cx) ** 2 + (py - cy) ** 2 <= r * r
    return inside

def make(size, path):
    S = size * SS
    # 各ピクセルの色を計算（背景→マイク要素を重ねる）
    buf = bytearray()
    cx = S / 2.0

    # マイク本体（角丸カプセル）
    body_w = S * 0.30
    body_h = S * 0.40
    body_x = cx - body_w / 2.0
    body_y = S * 0.16
    body_r = body_w / 2.0
    body = rounded_rect(body_x, body_y, body_w, body_h, body_r)

    # クレードル（U字アーク）
    arc_cx = cx
    arc_cy = body_y + body_h * 0.55
    arc_r_out = body_w * 0.95
    arc_r_in  = body_w * 0.72
    arc_thick_top = arc_cy  # アークは下半分のみ

    # スタンド（縦棒）と土台（横棒）
    stand_top = arc_cy + arc_r_out
    stand_bot = S * 0.84
    stand_w   = S * 0.045
    base_y    = stand_bot
    base_h    = S * 0.04
    base_w    = S * 0.26

    # 角丸背景（全面塗り＋外周だけ角丸でクリップ）
    bg_r = S * 0.22
    bg_clip = rounded_rect(0, 0, S, S, bg_r)

    for py in range(S):
        for px in range(S):
            if not bg_clip(px + 0.5, py + 0.5):
                # キャンバス外（角丸の外側）は透明
                buf += b'\x00\x00\x00\x00'
                continue
            x = px + 0.5
            y = py + 0.5
            color = BG
            is_mic = False
            if body(x, y):
                is_mic = True
            else:
                # 下向きU字アーク
                dx = x - arc_cx
                dy = y - arc_cy
                d = math.hypot(dx, dy)
                if y >= arc_thick_top and arc_r_in <= d <= arc_r_out:
                    is_mic = True
                # 縦棒
                elif stand_top <= y <= stand_bot and abs(x - cx) <= stand_w / 2.0:
                    is_mic = True
                # 土台（横棒・角丸）
                elif rounded_rect(cx - base_w / 2.0, base_y, base_w, base_h, base_h / 2.0)(x, y):
                    is_mic = True
            color = MIC if is_mic else BG
            buf += bytes((color[0], color[1], color[2], 255))

    # SSダウンサンプリング（ボックス平均, RGBA）
    out = bytearray()
    for oy in range(size):
        row = bytearray()
        for ox in range(size):
            r = g = b = a = 0
            for sy in range(SS):
                for sx in range(SS):
                    i = (((oy * SS + sy) * S) + (ox * SS + sx)) * 4
                    r += buf[i]; g += buf[i+1]; b += buf[i+2]; a += buf[i+3]
            n = SS * SS
            row += bytes((r // n, g // n, b // n, a // n))
        out += b'\x00' + row  # 各行先頭にフィルタbyte(0)

    raw = bytes(out)
    comp = zlib.compress(raw, 9)

    def chunk(typ, data):
        c = typ + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)

    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))  # 8bit RGBA
    png += chunk(b'IDAT', comp)
    png += chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)
    print('wrote', path, size, 'x', size)

here = os.path.dirname(os.path.abspath(__file__))
make(192, os.path.join(here, 'icons', 'icon-192.png'))
make(512, os.path.join(here, 'icons', 'icon-512.png'))
