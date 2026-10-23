"""Sprite registries for the input atlases (kept separate from the UI kit atlas)."""
from __future__ import annotations
import json, os
from PIL import Image, ImageDraw, ImageFont
from uikit.draw import Canvas, hexc, lighten, darken, alpha, mix, rrect, blob, regular, star, jitter
from uikit.icon import Ink

HERE = os.path.dirname(__file__)
UI = os.path.abspath(os.path.join(HERE, '..', '..'))
THEME = json.load(open(os.path.join(UI, 'theme.json')))
P = THEME['palette']
INK = P['ink']
PALJ = json.load(open(os.path.join(UI, '..', 'palette.json')))['ramps']
FONT = os.path.join(UI, 'fonts', 'Fredoka.ttf')

REG: dict[str, dict[str, dict]] = {"glyphs": {}, "touch": {}}


def sprite(atlas, name, w, h, nine=None, tags=(), pivot=(0.5, 0.5), meta=None):
    def deco(fn):
        REG[atlas][name] = dict(name=name, w=w, h=h, nine=nine, tags=list(tags), pivot=pivot, fn=fn, meta=meta or {})
        return fn
    return deco


_fc = {}


def font(px, wght=700, wdth=100):
    k = (round(px), wght, wdth)
    if k not in _fc:
        f = ImageFont.truetype(FONT, max(1, round(px)))
        try: f.set_variation_by_axes([wght, wdth])
        except Exception: pass
        _fc[k] = f
    return _fc[k]


def text(c: Canvas, s, cx, cy, size, color=INK, wght=700, wdth=100, stroke=0, stroke_color=None):
    """Centered text in design units on a supersampled canvas."""
    f = font(size * c.S, wght, wdth)
    layer = Image.new('RGBA', c.img.size, (0, 0, 0, 0)); d = ImageDraw.Draw(layer)
    col = hexc(color) if isinstance(color, str) else color
    sc = hexc(stroke_color) if isinstance(stroke_color, str) else stroke_color
    d.text((cx * c.S, cy * c.S), s, font=f, fill=col, anchor='mm', stroke_width=int(stroke * c.S), stroke_fill=sc)
    c.img.alpha_composite(layer)


def fit_size(s, max_w, size):
    """Shrink font size until the label fits max_w design px (and squeeze width axis first)."""
    wd = 100
    while size > 5:
        f = font(size * 4, 700, wd)
        w = f.getlength(s) / 4
        if w <= max_w: return size, wd
        if wd > 80: wd -= 10
        else: size -= 0.5
    return size, wd
