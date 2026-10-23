"""Layered, auto-outlined, soft-shaded cartoon shapes (icons, cursors, ornaments)."""
from __future__ import annotations
from PIL import ImageChops, ImageFilter, Image
from .draw import Canvas, hexc, lighten, darken, alpha, blob, mix

INK = '#3B2433'


class Ink(Canvas):
    def __init__(self, w, h, scale=1, ink=INK, ow=1.6):
        super().__init__(w, h, scale)
        self.ink = ink; self.ow = ow

    def part(self, m, color, outline=True, shade=True, ow=None, grad=False, gloss=True):
        """m: mask (L) or polygon list. Paint ink outline then soft-shaded fill."""
        if isinstance(m, list):
            m = self.poly_mask(m)
        ow = self.ow if ow is None else ow
        if outline and ow > 0:
            # ink line a bit heavier on the bottom-right (shadow side), per STYLE_GUIDE
            d = max(1, int(self.S * 0.4))
            self.paint(ImageChops.lighter(self.dilate(m, ow), ImageChops.offset(self.dilate(m, ow), d, d)), self.ink)
        c = hexc(color) if isinstance(color, str) else color
        if grad:
            self.paint(m, self.vgrad(lighten(c, 0.22), darken(c, 0.12)))
        else:
            self.paint(m, c)
        if shade:
            d = max(1, int(self.S * 2.0))
            sh = ImageChops.subtract(m, ImageChops.offset(m, -d, -d))
            sh = sh.filter(ImageFilter.GaussianBlur(self.S * 0.25)).point(lambda v: 255 if v > 110 else int(v * 2.3))
            self.paint(ImageChops.multiply(sh, m), alpha(darken(c, 0.28), 220))
            if gloss:
                hl = ImageChops.subtract(m, ImageChops.offset(m, d, d))
                hl = hl.filter(ImageFilter.GaussianBlur(self.S * 0.3))
                self.paint(ImageChops.multiply(hl, m), alpha(lighten(c, 0.5), 170))
        return m

    def shine(self, cx, cy, rx, ry, a=200):
        self.paint(self.poly_mask(blob(cx, cy, rx, ry, steps=24)), (255, 255, 248, a))

    def face(self, cx, cy, s=1.0, mood='happy', blush=True, eye_gap=None):
        """Tiny expressive face. s ~ 1 for a 32px icon."""
        g = (eye_gap or 3.2) * s
        er = 1.15 * s
        for ex in (cx - g, cx + g):
            if mood in ('happy', 'worried', 'sad', 'o', 'cool'):
                self.ellipse((ex - er, cy - er * 1.25, ex + er, cy + er * 1.25), self.ink)
                self.ellipse((ex - er * 0.2 + er * 0.25, cy - er * 0.9, ex + er * 0.55, cy - er * 0.2), (255, 255, 255, 235))
            elif mood == 'sleepy':
                self.arc((ex - er * 1.3, cy - er, ex + er * 1.3, cy + er * 1.2), 200, 340, self.ink, 0.9 * s)
            elif mood == 'dead':
                self.line([(ex - er, cy - er), (ex + er, cy + er)], self.ink, 0.8 * s)
                self.line([(ex - er, cy + er), (ex + er, cy - er)], self.ink, 0.8 * s)
        my = cy + 2.6 * s
        if mood == 'happy' or mood == 'cool':
            self.arc((cx - 1.9 * s, my - 2.0 * s, cx + 1.9 * s, my + 0.9 * s), 20, 160, self.ink, 0.9 * s)
        elif mood == 'worried' or mood == 'sad':
            self.arc((cx - 1.7 * s, my - 0.2 * s, cx + 1.7 * s, my + 2.2 * s), 200, 340, self.ink, 0.85 * s)
        elif mood == 'o':
            self.ellipse((cx - 0.9 * s, my - 1.2 * s, cx + 0.9 * s, my + 0.8 * s), self.ink)
        elif mood == 'sleepy':
            self.line([(cx - 1.2 * s, my), (cx + 1.2 * s, my)], self.ink, 0.8 * s)
        if blush:
            for bx in (cx - g - 1.6 * s, cx + g + 1.6 * s):
                self.ellipse((bx - 1.3 * s, my - 1.6 * s, bx + 1.3 * s, my - 0.3 * s), (255, 120, 140, 120))
