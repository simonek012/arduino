#!/usr/bin/env python3
"""Nakreslí ikonu aplikácie Riskuj (ikona-192.png, ikona-512.png) – zlaté „R?“ na tmavomodrom pozadí.
Obsah je v strede (80 %), aby sa ikona dala orezať do kruhu (Android) aj zaobliť (iPhone)."""
import pathlib
from PIL import Image, ImageDraw, ImageFont

D = pathlib.Path(__file__).resolve().parent.parent
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'


def ikona(n):
    im = Image.new('RGB', (n, n), '#050920')
    d = ImageDraw.Draw(im)
    # modrá „tabuľa“ s políčkami ako v hre
    m, g = n * 0.16, n * 0.025
    w = (n - 2 * m - 2 * g) / 3
    for r in range(3):
        for c in range(3):
            x, y = m + c * (w + g), m + r * (w + g)
            d.rounded_rectangle([x, y, x + w, y + w], radius=n * 0.03, fill='#1d3bc4' if (r + c) % 2 else '#2448d8')
    # zlaté R s tieňom
    f = ImageFont.truetype(FONT, int(n * 0.52))
    t = 'R'
    bx = d.textbbox((0, 0), t, font=f)
    x, y = (n - (bx[2] - bx[0])) / 2 - bx[0], (n - (bx[3] - bx[1])) / 2 - bx[1]
    d.text((x + n * 0.025, y + n * 0.025), t, font=f, fill='#0b1a6e')
    d.text((x, y), t, font=f, fill='#ffcf3f')
    return im


for n in (192, 512):
    ikona(n).save(D / f'ikona-{n}.png', optimize=True)
print('ok')
