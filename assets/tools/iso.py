"""Iso box renderer with affine-mapped procedural material textures (supersampled), damage stages, ink outlines."""
import math, numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageChops
from toon import SS, smooth, blur, shift, noise, INK, lerp, downscale
from palette import ramp, hex2rgb, RAMPS

HW, HH = 32, 16   # half tile (1x)

def ramp_color(rp, t):
    """t continuous tone: 0 = highlight, 1 = base, 2 = shade, 3 = deep; <0 brighter, >3 to ink."""
    r = [np.array(c, np.float32) for c in ramp(rp)]
    warm = np.array((255, 248, 225), np.float32); ink = np.array(INK, np.float32)
    stops = [warm, r[0], r[1], r[2], r[3], ink]  # at t = -1,0,1,2,3,4
    t = np.clip(np.asarray(t, np.float32) + 1, 0, 5)
    i = np.minimum(np.floor(t).astype(int), 4); f = (t - i)[..., None]
    S = np.stack(stops)
    return S[i] * (1 - f) + S[i + 1] * f

# ---------------- material tone fields (return tone arrays, size h x w in SS pixels) ----------------
def tex_planks(w, h, seed, board=8, vertical=False, nails=True, gaps=True):
    rng = np.random.default_rng(seed)
    if vertical: w, h = h, w
    t = np.ones((h, w), np.float32)
    bh = board * SS; n = noise(w, h, 6 * SS, seed) ; n2 = noise(w, h, SS, seed + 1)
    yy, xx = np.mgrid[0:h, 0:w]
    row = yy // bh; tone_row = rng.normal(0, 0.18, h // bh + 2)[row]
    # stagger plank ends
    seg = 22 * SS; offs = rng.integers(0, seg, h // bh + 2)[row]
    end = ((xx + offs) % seg) < SS * 0.9
    grain = np.sin((xx / (7 * SS) + n * 3 + row * 1.7) * 2.2) * 0.12 + (n2 - 0.5) * 0.15
    t = 1.0 + tone_row + grain
    inb = yy % bh
    t = np.where(inb < SS * 0.8, t - 0.55, t)                 # lit top bevel
    t = np.where(inb > bh - SS * 1.4, t + 0.8, t)             # shade bottom
    if gaps: t = np.where(inb > bh - SS * 0.6, 3.1, t)
    t = np.where(end & (inb < bh - SS * 0.6), 2.6, t)
    if nails:
        for (cy, cx) in zip(*np.nonzero((((xx + offs) % seg) == 2 * SS) & (inb == bh // 2))):
            pass
    if vertical: t = t.T
    return t

def tex_cobble(w, h, seed, cell=7.0, mortar=1.2, flat=False):
    rng = np.random.default_rng(seed)
    cs = cell * SS
    n = int(w * h / (cs * cs) * 1.1) + 6
    pts = np.stack([rng.random(n) * w, rng.random(n) * h], 1)
    # tile pts around for no edge bias
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    d1 = np.full((h, w), 1e9, np.float32); d2 = np.full((h, w), 1e9, np.float32); idx = np.zeros((h, w), int)
    vx = np.zeros((h, w), np.float32); vy = np.zeros((h, w), np.float32)
    for i, (px, py) in enumerate(pts):
        dx = (xx - px); dy = (yy - py) * 1.25; d = np.sqrt(dx * dx + dy * dy)
        closer = d < d1
        d2 = np.where(closer, d1, np.minimum(d2, d)); idx = np.where(closer, i, idx)
        vx = np.where(closer, dx, vx); vy = np.where(closer, dy, vy); d1 = np.where(closer, d, d1)
    edge = d2 - d1
    tones = rng.normal(1.0, 0.22, n)
    t = tones[idx]
    lit = (-(vx + vy) / (cs * 0.7)); t = t - np.clip(lit, 0, 1) * 0.7 + np.clip(-lit, 0, 1) * 0.6
    t = np.where(edge < mortar * SS * 1.8, t + 0.7, t)
    t = np.where(edge < mortar * SS, 3.0, t)
    t += (noise(w, h, 2 * SS, seed) - 0.5) * 0.2
    return t

def tex_thatch(w, h, seed, row=7):
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    n = noise(w, h, SS, seed); rh = row * SS
    r = (yy // rh); f = (yy % rh) / rh
    scal = np.sin(xx / (3 * SS) + r * 1.3) * 0.12
    strands = np.sin(xx / (0.9 * SS) + n * 6) * 0.25
    t = 0.6 + f * 1.4 + strands + (n - 0.5) * 0.3
    t = np.where(f > 0.88 + scal, 3.0, t)
    return t

def tex_flat(w, h, seed, tone=1.0, amp=0.15, cell=4):
    return tone + (noise(w, h, cell * SS, seed) - 0.5) * amp * 2

# ---------------- canvas ----------------
class IsoCanvas:
    def __init__(self, w=128, h=128, ox=64, oy=96, seed=1):
        self.w, self.h, self.ox, self.oy = w, h, ox, oy; self.W, self.H = w * SS, h * SS
        self.img = Image.new("RGBA", (self.W, self.H), (0, 0, 0, 0)); self.seed = seed
        self.edges = []   # interior ink lines
    def P(self, x, y, z):  # world tile coords relative to footprint center, z in px
        return ((self.ox + (x - y) * HW) * SS, (self.oy + (x + y) * HH - z) * SS)
    def face(self, p0, eu, ev, tone, rp, face_shift=0.0, alpha=255, clip=None):
        """p0: screen SS origin; eu, ev: SS vectors for the full texture extent; tone: field (h,w)."""
        th, tw = tone.shape
        col = ramp_color(rp, tone + face_shift)
        tex = Image.fromarray(np.concatenate([col, np.full((th, tw, 1), alpha, np.float32)], 2).astype(np.uint8), "RGBA")
        # map: screen = p0 + u/tw*eu + v/th*ev  -> inverse
        a, b = eu[0] / tw, ev[0] / th; c, d = eu[1] / tw, ev[1] / th
        det = a * d - b * c
        ia, ib, ic, id_ = d / det, -b / det, -c / det, a / det
        coeffs = (ia, ib, -(ia * p0[0] + ib * p0[1]), ic, id_, -(ic * p0[0] + id_ * p0[1]))
        layer = tex.transform((self.W, self.H), Image.AFFINE, coeffs, resample=Image.BILINEAR)
        # crisp polygon mask
        m = Image.new("L", (self.W, self.H), 0)
        q = [p0, (p0[0] + eu[0], p0[1] + eu[1]), (p0[0] + eu[0] + ev[0], p0[1] + eu[1] + ev[1]), (p0[0] + ev[0], p0[1] + ev[1])]
        ImageDraw.Draw(m).polygon(q if clip is None else clip, fill=alpha)
        if clip is not None: q = clip
        layer.putalpha(ImageChops.multiply(layer.getchannel("A"), m))
        self.img = Image.alpha_composite(self.img, layer)
        self.edges.append(q)
        return q
    def box(self, x0, x1, y0, y1, z0, z1, rp, top=None, left=None, right=None, seed=0, faces="tlr", texscale=1.0, edge=True):
        """Faces: top (z1), left (+y side, lit), right (+x side, shaded). top/left/right: callables (w,h,seed)->tone."""
        S = SS
        def flat(w, h, s): return tex_flat(w, h, s)
        top = top or flat; left = left or flat; right = right or flat
        out = []
        if "l" in faces:  # +y face: from (x0,y1,z1) along +x, down z
            p0 = self.P(x0, y1, z1); p1 = self.P(x1, y1, z1); p3 = self.P(x0, y1, z0)
            eu = (p1[0] - p0[0], p1[1] - p0[1]); ev = (p3[0] - p0[0], p3[1] - p0[1])
            w = max(4, int(math.hypot(*eu) / 1.118)); h = max(4, int(abs(ev[1])))
            out.append(self.face(p0, eu, ev, left(w, h, seed + 1), rp, 0.0))
        if "r" in faces:  # +x face: from (x1,y1,z1) along -y (toward up-right), down z
            p0 = self.P(x1, y1, z1); p1 = self.P(x1, y0, z1); p3 = self.P(x1, y1, z0)
            eu = (p1[0] - p0[0], p1[1] - p0[1]); ev = (p3[0] - p0[0], p3[1] - p0[1])
            w = max(4, int(math.hypot(*eu) / 1.118)); h = max(4, int(abs(ev[1])))
            out.append(self.face(p0, eu, ev, right(w, h, seed + 2), rp, 0.85))
        if "t" in faces:  # top: origin (x0,y0,z1); u along +x, v along +y
            p0 = self.P(x0, y0, z1); p1 = self.P(x1, y0, z1); p3 = self.P(x0, y1, z1)
            eu = (p1[0] - p0[0], p1[1] - p0[1]); ev = (p3[0] - p0[0], p3[1] - p0[1])
            w = max(4, int((x1 - x0) * 36 * SS)); h = max(4, int((y1 - y0) * 36 * SS))
            out.append(self.face(p0, eu, ev, top(w, h, seed + 3), rp, -0.45))
        return out
    def poly(self, pts_ss, color, alpha=255):
        if isinstance(color, str): color = hex2rgb(color)
        m = Image.new("L", (self.W, self.H), 0); ImageDraw.Draw(m).polygon(pts_ss, fill=alpha)
        layer = Image.new("RGBA", (self.W, self.H), tuple(color) + (0,)); layer.putalpha(m)
        self.img = Image.alpha_composite(self.img, layer)
    def lines(self, pts_ss, color, width=0.7, alpha=255, closed=False):
        if isinstance(color, str): color = hex2rgb(color)
        m = Image.new("L", (self.W, self.H), 0); d = ImageDraw.Draw(m)
        pts = list(pts_ss) + ([pts_ss[0]] if closed else [])
        d.line(pts, fill=alpha, width=max(1, int(width * SS)), joint="curve")
        layer = Image.new("RGBA", (self.W, self.H), tuple(color) + (0,)); layer.putalpha(m)
        self.img = Image.alpha_composite(self.img, layer)
    def ink_edges(self, quads, color=None, width=0.55, alpha=170):
        color = color or lerp(INK, (90, 60, 70), 0.3)
        for q in quads: self.lines(q, color, width, alpha, closed=True)
    def paste_sprite(self, im_1x_or_ss, x, y, ss=True):
        full = Image.new("RGBA", (self.W, self.H), (0, 0, 0, 0)); full.paste(im_1x_or_ss, (int(x), int(y)))
        self.img = Image.alpha_composite(self.img, full)
    def shadow_poly(self, pts_ss, alpha=0.30, blur_r=2.0):
        m = Image.new("L", (self.W, self.H), 0); ImageDraw.Draw(m).polygon(pts_ss, fill=int(255 * alpha))
        m = m.filter(ImageFilter.GaussianBlur(blur_r * SS))
        layer = Image.new("RGBA", (self.W, self.H), hex2rgb("#2a1b2e") + (0,)); layer.putalpha(m)
        self.img = Image.alpha_composite(layer, self.img)   # under everything
    def ground_shadow(self, x0, x1, y0, y1, grow=0.12, alpha=0.30):
        q = [self.P(x0 - grow, y0 - grow, 0), self.P(x1 + grow, y0 - grow, 0), self.P(x1 + grow, y1 + grow, 0), self.P(x0 - grow, y1 + grow, 0)]
        self.shadow_poly(q, alpha)

def add_outline(img, lw=1.0, seed=3, color=None):
    """Ink outline around the silhouette of an SS RGBA image (wobbly, heavier bottom-right)."""
    a = np.asarray(img, np.float32) / 255.0; m = (a[..., 3] > 0.5).astype(np.float32)
    H, W = m.shape
    n1 = noise(W, H, 10 * SS, seed)
    mm = np.maximum(m, shift(m, -SS * 0.35 * lw, -SS * 0.35 * lw))
    D = blur(mm, lw * SS * 0.75)
    thr = np.maximum(0.07, 0.13 + 0.09 * (n1 - 0.5) * 2)
    ring = smooth(thr - 0.04, thr + 0.04, D) * (1 - a[..., 3])
    oc = np.array(color or lerp(INK, (40, 25, 40), 0.2), np.float32) / 255
    rgb = a[..., :3] * a[..., 3:4] + oc * ring[..., None]
    al = np.clip(a[..., 3] + ring, 0, 1)
    rgb = np.where(al[..., None] > 1e-4, rgb / np.maximum(al[..., None], 1e-4), 0)
    return Image.fromarray((np.concatenate([rgb, al[..., None]], 2) * 255).astype(np.uint8), "RGBA")

def damage(img, stage, seed=0, top_y=None):
    """Generic damage pass on an SS RGBA piece image: 0 intact, 1 scuffed, 2 cracked+chipped, 3 wrecked."""
    if stage <= 0: return img
    rng = np.random.default_rng(seed + stage * 13)
    a = np.asarray(img).copy(); al = a[..., 3]
    ys, xs = np.nonzero(al > 128)
    if len(xs) == 0: return img
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    im = Image.fromarray(a); d = ImageDraw.Draw(im)
    dark = lerp(INK, (60, 40, 50), 0.2) + (220,); light = (255, 240, 220, 120)
    # grime
    g = Image.new("RGBA", im.size, (70, 50, 60, 0)); gm = Image.new("L", im.size, 0); gd = ImageDraw.Draw(gm)
    for _ in range(4 * stage):
        cx, cy = rng.integers(x0, x1 + 1), rng.integers(y0 + (y1 - y0) // 3, y1 + 1); r = rng.integers(6, 18) * SS // 2
        gd.ellipse([cx - r, cy - r * 0.6, cx + r, cy + r * 0.6], fill=int(30 + 20 * stage))
    gm = ImageChops.multiply(gm.filter(ImageFilter.GaussianBlur(4 * SS)), im.getchannel("A")); g.putalpha(gm)
    im = Image.alpha_composite(im, g)
    crk = Image.new("RGBA", im.size, (0, 0, 0, 0)); d = ImageDraw.Draw(crk)
    # cracks
    for _ in range([0, 2, 4, 7][stage]):
        cx, cy = rng.integers(x0 + 8, max(x0 + 9, x1 - 8)), rng.integers(y0 + 6, max(y0 + 7, y1 - 10))
        pts = [(cx, cy)]; ang = rng.random() * 6.28
        for k in range(rng.integers(3, 6)):
            ang += rng.normal(0, 0.7); L = rng.integers(3, 8) * SS
            pts.append((pts[-1][0] + math.cos(ang) * L, pts[-1][1] + math.sin(ang) * L))
        d.line([(p[0] + SS * 0.5, p[1] + SS * 0.5) for p in pts], fill=light, width=int(SS * 0.6))
        d.line(pts, fill=dark, width=int(SS * 0.7))
    crk.putalpha(ImageChops.multiply(crk.getchannel("A"), Image.fromarray(np.where(al > 200, 255, 0).astype(np.uint8))))
    im = Image.alpha_composite(im, crk)
    # chips / bites
    if stage >= 2:
        cut = Image.new("L", im.size, 0); cd = ImageDraw.Draw(cut)
        nb = [0, 0, 2, 5][stage]
        for _ in range(nb):
            cx = rng.integers(x0, x1 + 1)
            col = np.nonzero(al[:, min(cx, al.shape[1] - 1)] > 128)[0]
            if not len(col): continue
            cy = col.min() + rng.integers(0, 6 * SS); r = rng.integers(4, 9 + stage * 2) * SS // 2
            cd.ellipse([cx - r, cy - r, cx + r, cy + r], fill=255)
        im.putalpha(ImageChops.subtract(im.getchannel("A"), cut))
    if stage == 3:   # darken + desaturate a bit
        arr = np.asarray(im).astype(np.float32); g_ = arr[..., :3].mean(-1, keepdims=True)
        arr[..., :3] = (arr[..., :3] * 0.75 + g_ * 0.25) * 0.86; im = Image.fromarray(arr.astype(np.uint8))
    return im
