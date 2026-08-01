#!/usr/bin/env python3
"""Generate Cineprompt's favicon and PWA icons from the in-app reel logo.

The logo lives as inline SVG in `client/src/components/layout.tsx`; this keeps
the raster icons a byte-for-byte reproducible derivative of the same geometry
rather than a hand-drawn lookalike that drifts out of sync.

Writes into client/public/:
    favicon.svg          scalable, what browsers actually use
    icon-192.png         PWA manifest / Android home screen
    icon-512.png         PWA manifest / splash
    apple-touch-icon.png iOS home screen (opaque background, no transparency)

Pure stdlib — no Pillow or cairosvg in the build image.

    python script/make_icons.py
"""
from __future__ import annotations

import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
PUBLIC = os.path.join(HERE, "..", "client", "public")

# hsl(240 6% 6%) and hsl(38 55% 60%) — --background and --primary in index.css.
BG = (15, 15, 16)
FG = (209, 168, 97)

# Reel geometry in the SVG's 32x32 viewBox.
RING_R, RING_STROKE = 14.5, 1.5
HUB_R = 3.4
CARDINAL = [(16, 6.6), (16, 25.4), (6.6, 16), (25.4, 16)]
CARDINAL_R = 2.1
DIAGONAL = [(9.4, 9.4), (22.6, 22.6), (22.6, 9.4), (9.4, 22.6)]
DIAGONAL_R = 1.7

SS = 4  # supersampling factor per axis -> 16 samples/pixel


def coverage(x: float, y: float) -> float:
    """Ink coverage of the logo at a point in 32x32 logo space (0.0-1.0)."""
    cx, cy = x - 16.0, y - 16.0
    d = (cx * cx + cy * cy) ** 0.5
    # Outer ring: a stroked circle is the band RING_R +/- half the stroke.
    if abs(d - RING_R) <= RING_STROKE / 2:
        return 1.0
    if d <= HUB_R:
        return 1.0
    for px, py in CARDINAL:
        if (x - px) ** 2 + (y - py) ** 2 <= CARDINAL_R**2:
            return 1.0
    for px, py in DIAGONAL:
        if (x - px) ** 2 + (y - py) ** 2 <= DIAGONAL_R**2:
            return 1.0
    return 0.0


def render(size: int, padding: float = 0.0) -> bytes:
    """Render to raw RGB rows, antialiased by supersampling."""
    span = 32.0 / (1.0 - 2 * padding)
    origin = -padding * span
    rows = []
    for py in range(size):
        row = bytearray()
        for px in range(size):
            acc = 0.0
            for sy in range(SS):
                y = origin + ((py + (sy + 0.5) / SS) / size) * span
                for sx in range(SS):
                    x = origin + ((px + (sx + 0.5) / SS) / size) * span
                    acc += coverage(x, y)
            a = acc / (SS * SS)
            row += bytes(round(BG[i] + (FG[i] - BG[i]) * a) for i in range(3))
        rows.append(bytes(row))
    return b"".join(b"\x00" + r for r in rows)  # filter byte 0 per scanline


def write_png(path: str, size: int, padding: float = 0.0) -> None:
    raw = render(size, padding)

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    png = b"\x89PNG\r\n\x1a\n"
    # 8-bit truecolour RGB, no interlace.
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as fh:
        fh.write(png)
    print(f"{os.path.basename(path):24s} {size}x{size}  {len(png) / 1024:.1f} KB")


SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <rect width="32" height="32" rx="6" fill="#0f0f10"/>
  <g fill="#d1a861">
    <circle cx="16" cy="16" r="14.5" fill="none" stroke="#d1a861" stroke-width="1.5"/>
    <circle cx="16" cy="16" r="3.4"/>
    <circle cx="16" cy="6.6" r="2.1"/>
    <circle cx="16" cy="25.4" r="2.1"/>
    <circle cx="6.6" cy="16" r="2.1"/>
    <circle cx="25.4" cy="16" r="2.1"/>
    <circle cx="9.4" cy="9.4" r="1.7"/>
    <circle cx="22.6" cy="22.6" r="1.7"/>
    <circle cx="22.6" cy="9.4" r="1.7"/>
    <circle cx="9.4" cy="22.6" r="1.7"/>
  </g>
</svg>
"""


def main() -> None:
    os.makedirs(PUBLIC, exist_ok=True)
    with open(os.path.join(PUBLIC, "favicon.svg"), "w", encoding="utf-8") as fh:
        fh.write(SVG)
    print("favicon.svg")
    write_png(os.path.join(PUBLIC, "icon-192.png"), 192)
    write_png(os.path.join(PUBLIC, "icon-512.png"), 512)
    # iOS crops to a rounded rect and ignores transparency, so inset the reel.
    write_png(os.path.join(PUBLIC, "apple-touch-icon.png"), 180, padding=0.12)


if __name__ == "__main__":
    main()
