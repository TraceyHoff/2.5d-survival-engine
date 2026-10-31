"""Seasons ground tileset core: frame geometry, periodic noise, painters, downscale + cel snap.
Frames match terrainTiles.ts: 64x48 cell = 64x32 diamond + 16 px skirt, anchor (0.5, 1/3); rendered at RES x supersampling
(512x384) and boxed down to @2x (128x96) and 1x (64x48), then snapped to the colours actually painted (solid cel, binary alpha).
uv: u = +x (edge e at u=1, bottom-right), v = +y (edge s at v=1, bottom-left); n = v=0 (top-right), w = u=0 (top-left).
Seamless rule: everything that touches a tile edge is a function of (u mod 1, v mod 1) shared by every variant; variant-only
fields fade in past the EB edge band and decorations keep a margin, so any variant can sit next to any other."""
import math
import numpy as np
from PIL import Image, ImageDraw

RES = 8
FW, FH, HW, HH, SK = 64, 48, 32, 16, 16
W2, H2 = FW * RES, FH * RES
_ys, _xs = np.mgrid[0:H2, 0:W2].astype(np.float64)
SX = (_xs + .5) / RES - HW
SY = (_ys + .5) / RES - HH
U = (SX / HW + SY / HH) / 2 + .5
V = (SY / HH - SX / HW) / 2 + .5
TOP = (np.abs(SX) / HW + np.abs(SY) / HH) <= 1 + 0.6 / HH
_dl = SY - (HH + SX / 2); _dr = SY - (HH - SX / 2)
LFACE = (~TOP) & (SX < 0) & (SX >= -HW) & (_dl > -1) & (_dl <= SK)
RFACE = (~TOP) & (SX >= 0) & (SX <= HW) & (_dr > -1) & (_dr <= SK)
FACE_T = np.where(SX < 0, (SX + HW) / HW, 1 - SX / HW)      # param along the face edge (u for the s face, v for the e face)
FACE_D = np.clip(np.where(SX < 0, _dl, _dr), 0, SK)           # depth below the rim, px
UC, VC = np.clip(U, 0, 1), np.clip(V, 0, 1)
EDGE_D = np.minimum(np.minimum(UC, 1 - UC), np.minimum(VC, 1 - VC))
EB = 0.16
def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t)
WIN = smooth(0.015, EB, EDGE_D)                                # 0 at the edges, 1 inside: variant weight

def hx(c):
    c = c.lstrip('#'); return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))
def mix(a, b, t):
    a, b = hx(a) if isinstance(a, str) else a, hx(b) if isinstance(b, str) else b
    return '#%02x%02x%02x' % tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))

_LAT = {}
def _lat(n, seed):
    k = (n, seed)
    if k not in _LAT: _LAT[k] = np.random.default_rng(seed * 7919 + n).random((n, n))
    return _LAT[k]
def vn(u, v, n, seed):
    """Periodic (period 1 in u and v) value noise on an n x n lattice, quintic fade."""
    g = _lat(n, seed); x, y = (u % 1.0) * n, (v % 1.0) * n
    i, j = np.floor(x).astype(int) % n, np.floor(y).astype(int) % n
    fx, fy = x - np.floor(x), y - np.floor(y)
    fx = fx * fx * fx * (fx * (fx * 6 - 15) + 10); fy = fy * fy * fy * (fy * (fy * 6 - 15) + 10)
    i1, j1 = (i + 1) % n, (j + 1) % n
    a = g[i, j] * (1 - fx) + g[i1, j] * fx; b = g[i, j1] * (1 - fx) + g[i1, j1] * fx
    return a * (1 - fy) + b * fy
def fbm(u, v, seed, octs=((3, .5), (6, .3), (12, .2))):
    s = 0; t = 0
    for k, (n, w) in enumerate(octs): s = s + vn(u, v, n, seed + 31 * k) * w; t += w
    return s / t
def vn1(t, n, seed):
    """Periodic 1D value noise (period 1)."""
    g = np.random.default_rng(seed * 104729 + n).random(n); x = (t % 1.0) * n
    i = np.floor(x).astype(int) % n; f = x - np.floor(x); f = f * f * (3 - 2 * f)
    return g[i] * (1 - f) + g[(i + 1) % n] * f

def to_px(u, v):
    """uv -> supersampled frame pixel."""
    return ((u - v) * HW + HW) * RES, ((u + v - 1) * HH + HH) * RES

class Tile:
    """One 64x48 cell being painted at RES. img: HxWx3 uint8, alpha: bool."""
    def __init__(self):
        self.img = np.zeros((H2, W2, 3), np.uint8); self.alpha = np.zeros((H2, W2), bool); self.pal = set()
        self._pil = None
    def fill(self, mask, col):
        c = hx(col); self.sync(); self.img[mask] = c; self.alpha |= mask; self.pal.add(c)
    def sync(self):
        if self._pil is not None:
            self.img[:] = np.asarray(self._pil.convert('RGB')); self.alpha |= np.asarray(self._am) > 0; self._pil = None
    def draw(self):
        if self._pil is None:
            self._pil = Image.fromarray(self.img, 'RGB'); self._am = Image.new('L', (W2, H2), 0)
            self._d = ImageDraw.Draw(self._pil); self._da = ImageDraw.Draw(self._am)
        return self._d, self._da
    def poly(self, pts, col, clip=None):
        d, da = self.draw(); c = hx(col); self.pal.add(c)
        if len(pts) >= 3: d.polygon(pts, fill=c); da.polygon(pts, fill=255)
    def ellipse(self, cx, cy, rx, ry, col):
        d, da = self.draw(); c = hx(col); self.pal.add(c)
        d.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=c); da.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=255)
    def line(self, pts, col, w):
        d, da = self.draw(); c = hx(col); self.pal.add(c)
        d.line(pts, fill=c, width=max(1, int(round(w))), joint='curve'); da.line(pts, fill=255, width=max(1, int(round(w))), joint='curve')
        r = w / 2
        for p in (pts[0], pts[-1]): d.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=c); da.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=255)
    def finish(self, clipmask=None):
        self.sync()
        if clipmask is not None: self.alpha &= clipmask
        return self

def _snap(rgb, a, pal):
    P = np.array(sorted(pal), np.float32)
    out = np.zeros(rgb.shape[:2] + (4,), np.uint8)
    q = P[((rgb[..., None, :] - P[None, None]) ** 2).sum(-1).argmin(-1)]
    m = a >= .5; out[m, :3] = q[m]; out[m, 3] = 255
    return out
def downs(tile, f):
    """Box down by f (RES/f output scale), premultiplied, snapped to the painted palette, binary alpha."""
    a = tile.alpha.astype(np.float32); rgb = tile.img.astype(np.float32) * a[..., None]
    h, w = H2 // f, W2 // f
    A = a.reshape(h, f, w, f).mean((1, 3)); C = rgb.reshape(h, f, w, f, 3).mean((1, 3)) / np.maximum(A, 1e-6)[..., None]
    return Image.fromarray(_snap(C, A, tile.pal), 'RGBA')
def out2(tile): return downs(tile, RES // 2)
def out1(tile): return downs(tile, RES)

# ---- uv-space shape helpers (flat on the ground: circles in uv read as 2:1 iso ellipses) -----------------------------------
def uv_blob(cu, cv, r, n=18, wob=0.18, seed=0, sq=1.0, rot=0.0):
    rng = np.random.default_rng(seed); ph = rng.random(3) * 6.28
    pts = []
    for k in range(n):
        a = 6.2832 * k / n
        rr = r * (1 + wob * (0.6 * math.sin(2 * a + ph[0]) + 0.4 * math.sin(3 * a + ph[1])))
        x, y = math.cos(a) * rr, math.sin(a) * rr * sq
        x, y = x * math.cos(rot) - y * math.sin(rot), x * math.sin(rot) + y * math.cos(rot)
        pts.append(to_px(cu + x, cv + y))
    return pts
def scale_pts(pts, k, cx=None, cy=None, dx=0, dy=0):
    if cx is None: cx = sum(p[0] for p in pts) / len(pts); cy = sum(p[1] for p in pts) / len(pts)
    return [(cx + (x - cx) * k + dx, cy + (y - cy) * k + dy) for x, y in pts]
def grow(pts, px):
    """Offset a roughly convex polygon outward by px (supersampled px)."""
    cx = sum(p[0] for p in pts) / len(pts); cy = sum(p[1] for p in pts) / len(pts); o = []
    for x, y in pts:
        dx, dy = x - cx, y - cy; L = math.hypot(dx, dy) or 1; o.append((x + dx / L * px, y + dy / L * px))
    return o
def inside_uv(u, v, m):
    return m <= u <= 1 - m and m <= v <= 1 - m

class Scatter:
    """Poisson-ish point scatter in uv for one tile variant, with margin from the edges."""
    def __init__(self, seed, margin=0.12):
        self.rng = np.random.default_rng(seed); self.pts = []; self.m = margin
    def take(self, n, mind=0.08, margin=None, accept=None, tries=60):
        m = self.m if margin is None else margin; out = []
        for _ in range(n):
            for _t in range(tries):
                u, v = self.rng.uniform(m, 1 - m, 2)
                if any((u - a) ** 2 + (v - b) ** 2 < mind * mind for a, b in self.pts): continue
                if accept is not None and not accept(u, v): continue
                self.pts.append((u, v)); out.append((u, v)); break
        return out
