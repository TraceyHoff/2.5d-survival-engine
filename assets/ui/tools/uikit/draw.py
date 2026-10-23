"""Supersampled drawing helpers for the Cozy Camp UI kit.

All coordinates are in 1x design pixels; a Canvas renders at S = 4 * scale px per unit and is
downsampled with LANCZOS (Pillow premultiplies alpha on resize, so no dark fringes).
Shapes are polygons with optional seeded "wobble" (hand-inked, Don't-Starve-ish edges).
"""
from __future__ import annotations
import math, random
from PIL import Image, ImageDraw, ImageChops, ImageFilter

SS = 4  # supersample factor


def hexc(h: str, a: int | None = None) -> tuple[int, int, int, int]:
    h = h.lstrip('#')
    if len(h) == 8:
        r, g, b, al = (int(h[i:i + 2], 16) for i in (0, 2, 4, 6))
    else:
        r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4)); al = 255
    return (r, g, b, al if a is None else a)


def mix(c1, c2, t):
    c1 = hexc(c1) if isinstance(c1, str) else c1
    c2 = hexc(c2) if isinstance(c2, str) else c2
    return tuple(int(round(c1[i] + (c2[i] - c1[i]) * t)) for i in range(4))


def lighten(c, t):
    return mix(c, (255, 246, 200, 255), t)  # warm highlight hue-shift


def darken(c, t):
    return mix(c, (42, 27, 46, 255), t)  # plum shade hue-shift (ink.deep)


def alpha(c, a):
    c = hexc(c) if isinstance(c, str) else c
    return (c[0], c[1], c[2], int(a))


class Noise1D:
    """Smooth periodic value noise for wobbly outlines."""
    def __init__(self, seed: int, n: int = 24):
        r = random.Random(seed)
        self.v = [r.uniform(-1, 1) for _ in range(n)]
        self.n = n

    def __call__(self, t: float) -> float:  # t in [0,1) periodic
        x = (t % 1.0) * self.n
        i = int(x); f = x - i
        a = self.v[i % self.n]; b = self.v[(i + 1) % self.n]
        f = f * f * (3 - 2 * f)
        return a + (b - a) * f


class Canvas:
    def __init__(self, w: float, h: float, scale: int = 1):
        self.w, self.h, self.scale = w, h, scale
        self.S = SS * scale
        self.img = Image.new('RGBA', (int(round(w * self.S)), int(round(h * self.S))), (0, 0, 0, 0))

    # -- coordinate helpers
    def p(self, v):
        return v * self.S

    def pts(self, pts):
        return [(x * self.S, y * self.S) for x, y in pts]

    def mask(self):
        return Image.new('L', self.img.size, 0)

    # -- masks
    def poly_mask(self, pts, m=None):
        m = m or self.mask()
        ImageDraw.Draw(m).polygon(self.pts(pts), fill=255)
        return m

    def ellipse_mask(self, box, m=None):
        m = m or self.mask()
        ImageDraw.Draw(m).ellipse([self.p(v) for v in box], fill=255)
        return m

    def dilate(self, m, r):
        """Dilate a mask by r design px (rounded, via blur+threshold for smooth result)."""
        px = r * self.S
        if px <= 0:
            return m
        b = m.filter(ImageFilter.GaussianBlur(px * 0.5))
        # threshold low to grow
        grow = b.point(lambda v: 255 if v > 8 else int(v * 255 / 8))
        k = int(px) | 1
        if k > 1:
            grow = ImageChops.lighter(grow, m.filter(ImageFilter.MaxFilter(min(k, 31))))
        if k > 31:
            for _ in range(k // 31):
                grow = grow.filter(ImageFilter.MaxFilter(31))
        return grow

    # -- painting
    def paint(self, m, color):
        """Composite a flat colour or an RGBA image through mask m."""
        if isinstance(color, Image.Image):
            src = color.copy()
        else:
            c = hexc(color) if isinstance(color, str) else color
            src = Image.new('RGBA', self.img.size, c)
        a = ImageChops.multiply(src.getchannel('A'), m)
        src.putalpha(a)
        self.img.alpha_composite(src)

    def vgrad(self, top, bottom, y0=0, y1=None):
        """Vertical gradient image (design-unit y0..y1)."""
        top = hexc(top) if isinstance(top, str) else top
        bottom = hexc(bottom) if isinstance(bottom, str) else bottom
        y1 = self.h if y1 is None else y1
        W, H = self.img.size
        col = Image.new('RGBA', (1, H))
        for y in range(H):
            t = min(1, max(0, (y / self.S - y0) / max(1e-6, (y1 - y0))))
            col.putpixel((0, y), tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(4)))
        return col.resize((W, H), Image.NEAREST)

    def hgrad(self, stops):
        """Horizontal multi-stop gradient: [(t, color), ...]."""
        W, H = self.img.size
        row = Image.new('RGBA', (W, 1))
        st = [(t, hexc(c) if isinstance(c, str) else c) for t, c in stops]
        for x in range(W):
            t = x / max(1, W - 1)
            for i in range(len(st) - 1):
                if st[i][0] <= t <= st[i + 1][0]:
                    a, ca = st[i]; b, cb = st[i + 1]
                    f = (t - a) / max(1e-6, b - a)
                    row.putpixel((x, 0), tuple(int(ca[k] + (cb[k] - ca[k]) * f) for k in range(4)))
                    break
        return row.resize((W, H), Image.NEAREST)

    def line(self, pts, color, width, joint=True):
        d = ImageDraw.Draw(self.img)
        c = hexc(color) if isinstance(color, str) else color
        layer = Image.new('RGBA', self.img.size, (0, 0, 0, 0))
        ld = ImageDraw.Draw(layer)
        P = self.pts(pts)
        w = max(1, int(width * self.S))
        ld.line(P, fill=c, width=w, joint='curve' if joint else None)
        r = w / 2
        for x, y in (P[0], P[-1]):
            ld.ellipse([x - r, y - r, x + r, y + r], fill=c)
        self.img.alpha_composite(layer)
        del d

    def ellipse(self, box, color):
        self.paint(self.ellipse_mask(box), color)

    def poly(self, pts, color):
        self.paint(self.poly_mask(pts), color)

    def arc(self, box, start, end, color, width):
        layer = Image.new('RGBA', self.img.size, (0, 0, 0, 0))
        c = hexc(color) if isinstance(color, str) else color
        ImageDraw.Draw(layer).arc([self.p(v) for v in box], start, end, fill=c, width=max(1, int(width * self.S)))
        self.img.alpha_composite(layer)

    def out(self):
        return self.img.resize((int(round(self.w * self.scale)), int(round(self.h * self.scale))), Image.LANCZOS)


# ---------------- shape generators (return polygons in design units) ----------------

def rrect(x0, y0, x1, y1, r, wob=0.0, seed=0, steps=10, wob_corners_only=False):
    """Rounded rectangle polygon; wob = max perpendicular displacement (design px)."""
    r = max(0.01, min(r, (x1 - x0) / 2, (y1 - y0) / 2))
    pts = []
    corners = [(x1 - r, y0 + r, -90), (x1 - r, y1 - r, 0), (x0 + r, y1 - r, 90), (x0 + r, y0 + r, 180)]
    for cx, cy, a0 in corners:
        for i in range(steps + 1):
            a = math.radians(a0 + 90 * i / steps)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    if wob:
        nz = Noise1D(seed, 40)
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        out = []
        n = len(pts)
        for i, (x, y) in enumerate(pts):
            dx, dy = x - cx, y - cy
            L = math.hypot(dx, dy) or 1
            d = nz(i / n) * wob
            out.append((x + dx / L * d, y + dy / L * d))
        pts = out
    return pts


def blob(cx, cy, rx, ry, wob=0.0, seed=0, steps=48, rot=0.0):
    nz = Noise1D(seed, 12)
    pts = []
    for i in range(steps):
        t = i / steps; a = t * 2 * math.pi
        k = 1 + (nz(t) * wob / max(rx, ry) if wob else 0)
        x, y = rx * math.cos(a) * k, ry * math.sin(a) * k
        c, s = math.cos(rot), math.sin(rot)
        pts.append((cx + x * c - y * s, cy + x * s + y * c))
    return pts


def heart(cx, cy, s, wob=0.0, seed=0):
    pts = []
    for i in range(80):
        t = i / 80 * 2 * math.pi
        x = 16 * math.sin(t) ** 3
        y = -(13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t))
        pts.append((cx + x * s / 32, cy + y * s / 32))
    return jitter(pts, wob, seed)


def drop(cx, cy, s, wob=0.0, seed=0):
    """Water drop: point at top, round bottom (s = height)."""
    r = s * 0.36
    by = cy + s * 0.5 - r
    pts = [(cx, cy - s * 0.5)]
    for i in range(41):
        a = math.radians(-30 + 240 * i / 40)  # from right-top around bottom to left-top
        a = math.radians(-35) + (math.radians(250)) * i / 40
        pts.append((cx + r * math.cos(a), by + r * math.sin(a)))
    return jitter(pts, wob, seed)


def star(cx, cy, ro, ri, n=5, rot=-90, wob=0.0, seed=0, round_pts=0):
    pts = []
    for i in range(n * 2):
        r = ro if i % 2 == 0 else ri
        a = math.radians(rot + 180 / n * i)
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return jitter(pts, wob, seed)


def jitter(pts, wob, seed):
    if not wob:
        return pts
    nz = Noise1D(seed, 16)
    cx = sum(p[0] for p in pts) / len(pts); cy = sum(p[1] for p in pts) / len(pts)
    out = []
    for i, (x, y) in enumerate(pts):
        dx, dy = x - cx, y - cy; L = math.hypot(dx, dy) or 1
        d = nz(i / len(pts)) * wob
        out.append((x + dx / L * d, y + dy / L * d))
    return out


def regular(cx, cy, r, n, rot=0):
    return [(cx + r * math.cos(math.radians(rot + 360 * i / n)), cy + r * math.sin(math.radians(rot + 360 * i / n))) for i in range(n)]


def offset_poly(pts, d):
    """Crude inset/outset towards/away from centroid (fine for convex-ish shapes)."""
    cx = sum(p[0] for p in pts) / len(pts); cy = sum(p[1] for p in pts) / len(pts)
    out = []
    for x, y in pts:
        dx, dy = x - cx, y - cy; L = math.hypot(dx, dy) or 1
        out.append((x + dx / L * d, y + dy / L * d))
    return out
