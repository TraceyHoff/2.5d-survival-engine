"""Shared kit for the PvP / clan / raid pack: grid atlas sheets (1x + @2x, emissive + two-tone tint masks,
TexturePacker JSON-hash), cute shape primitives and iso helpers. All geometry in 1x pixel units, drawn at SS=4."""
import json, math, os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageChops
from toon import Canvas, SS, downscale, smooth, blur, shift, noise, lerp, INK, outline_col
from palette import ramp, RAMPS, hex2rgb

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
ATL = os.path.join(ROOT, "atlases")
TEX = os.path.join(ROOT, "textures")
PREV = os.path.join(ROOT, "preview")
MAX_PAGE = 2048
MARGIN = 2           # transparent padding inside every grid cell (engine grids have no spacing field)
DIRS8 = ["E", "SE", "S", "SW", "W", "NW", "N", "NE"]

def H(c): return hex2rgb(c) if isinstance(c, str) else tuple(c)
def R(name, i): return hex2rgb(RAMPS[name][i])
# neutral, tint-friendly cloth ramp: near-white with plum-cool shading so multiply-tint keeps form shading
NEUTRAL = [(255, 255, 255), (238, 233, 236), (196, 186, 204), (140, 126, 150)]
NEUTRAL_METAL = [(250, 250, 252), (222, 220, 228), (176, 170, 190), (124, 116, 140)]

# ------------------------------------------------------------------ iso helpers
HW, HH = 32, 16
def iso(wx, wy, wz=0.0, ox=0.0, oy=0.0):
    """world tile offset -> screen px offset (z in px)."""
    return (ox + (wx - wy) * HW, oy + (wx + wy) * HH - wz)
def dir_vec(i):
    """screen-space unit vector + angle for facing index i (world angle i*45deg; 0 = +x = down-right)."""
    a = i * math.pi / 4; sx, sy = (math.cos(a) - math.sin(a)) * HW, (math.cos(a) + math.sin(a)) * HH
    L = math.hypot(sx, sy); return sx / L, sy / L, math.atan2(sy, sx)

# ------------------------------------------------------------------ shapes (1x coords)
def rstar(cx, cy, ro, ri, n=5, rot=-math.pi / 2, p=1.4, N=140, sq=1.0):
    """chubby rounded star"""
    pts = []
    for k in range(N):
        a = k / N * 2 * math.pi; f = ((1 + math.cos(n * (a - rot))) / 2) ** p
        r = ri + (ro - ri) * f; pts.append((cx + math.cos(a) * r, cy + math.sin(a) * r * sq))
    return pts
def sparkle(cx, cy, r, thin=0.16, rot=0.0, n=4, N=96):
    pts = []
    for k in range(N):
        a = k / N * 2 * math.pi; f = abs(math.cos(n / 2 * (a - rot))) ** 8
        rr = r * (thin + (1 - thin) * f); pts.append((cx + math.cos(a) * rr, cy + math.sin(a) * rr))
    return pts
def circle(cx, cy, r, n=40, ry=None): 
    ry = r if ry is None else ry
    return [(cx + math.cos(k / n * 6.2832) * r, cy + math.sin(k / n * 6.2832) * ry) for k in range(n)]
def wobbly(cx, cy, rx, ry, seed=0, wob=0.06, n=48, rot=0.0):
    from toon import ellipse_pts
    return ellipse_pts(cx, cy, rx, ry, rot=rot, n=n, wob=wob, seed=seed)
def cloud(cx, cy, rx, ry, seed=0, lobes=7, lr=0.45):
    """union of circles around an ellipse -> list of polys (puffy cloud)"""
    rng = np.random.default_rng(seed); polys = [wobbly(cx, cy, rx * 0.8, ry * 0.75, seed)]
    for k in range(lobes):
        a = k / lobes * 2 * math.pi + rng.random() * 0.4
        r = min(rx, ry) * lr * (0.8 + 0.4 * rng.random())
        polys.append(circle(cx + math.cos(a) * rx * 0.62, cy + math.sin(a) * ry * 0.6, r, 28))
    return polys
def rot_pts(pts, ang, cx, cy):
    c, s = math.cos(ang), math.sin(ang)
    return [(cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c) for x, y in pts]
def rrect(x0, y0, x1, y1, r, n=8):
    pts = []
    for (cx, cy, a0) in ((x1 - r, y0 + r, -90), (x1 - r, y1 - r, 0), (x0 + r, y1 - r, 90), (x0 + r, y0 + r, 180)):
        for k in range(n + 1):
            a = math.radians(a0 + 90 * k / n); pts.append((cx + math.cos(a) * r, cy + math.sin(a) * r))
    return pts
def arc_band(cx, cy, rx, ry, a0, a1, w0, w1, N=60, z=0.0):
    """crescent band along an ellipse from angle a0..a1 with width tapering w0->w1 (radial, 1x px)."""
    outer, inner = [], []
    for k in range(N + 1):
        t = k / N; a = a0 + (a1 - a0) * t; w = w0 + (w1 - w0) * t
        ca, sa = math.cos(a), math.sin(a)
        outer.append((cx + ca * (rx + w / 2), cy + sa * (ry + w / 4) - z))
        inner.append((cx + ca * (rx - w / 2), cy + sa * (ry - w / 4) - z))
    return outer + inner[::-1]

# ------------------------------------------------------------------ canvas helpers
def glow(cv, cx, cy, r, color, alpha=1.0, ry=None):
    ry = r if ry is None else ry
    m = Image.new("L", (cv.W, cv.H), 0)
    ImageDraw.Draw(m).ellipse([(cx - r) * SS, (cy - ry) * SS, (cx + r) * SS, (cy + ry) * SS], fill=int(255 * alpha))
    m = m.filter(ImageFilter.GaussianBlur(r * SS * 0.45))
    layer = Image.new("RGBA", (cv.W, cv.H), H(color) + (0,)); layer.putalpha(m)
    cv.img = Image.alpha_composite(cv.img, layer)
def mask_paint(cv, polys, value=255, channel=0, blur_r=0.6):
    """paint into a tint-mask canvas (RGBA SS image): channel 0 = R (primary), 1 = G (secondary). Feathered."""
    m = cv.mask_from(polys)
    if blur_r: m = m.filter(ImageFilter.GaussianBlur(blur_r * SS))
    a = np.asarray(cv.img).copy(); mm = np.asarray(m, np.float32) / 255 * value
    a[..., channel] = np.maximum(a[..., channel], mm).astype(np.uint8)
    other = 1 - channel
    a[..., other] = (a[..., other] * (1 - mm / 255)).astype(np.uint8)   # later paint wins
    cv.img = Image.fromarray(a)
def blank(w, h, seed=1): return Canvas(w, h, seed=seed)

def apply_alpha_from(img, ref):
    """multiply img alpha by ref alpha (both SS RGBA)"""
    a = np.asarray(img).copy(); r = np.asarray(ref)[..., 3].astype(np.float32) / 255
    a[..., 3] = (a[..., 3] * r).astype(np.uint8); return Image.fromarray(a)

def fade(img, k):
    if k >= 1: return img
    a = np.asarray(img).copy(); a[..., 3] = (a[..., 3] * max(0, k)).astype(np.uint8); return Image.fromarray(a)

def clip_to(e, ref):
    """emissive keeps only the sprite's own pixels: alpha = min(emissive alpha, sprite alpha)."""
    a = np.asarray(e).copy(); r = np.asarray(ref)[..., 3]
    a[..., 3] = np.minimum(a[..., 3], r); a[a[..., 3] < 8] = 0; return Image.fromarray(a)

def tint_down(img_ss, size):
    a = np.asarray(img_ss, np.float32)
    ch = [np.asarray(Image.fromarray(np.ascontiguousarray(a[..., i])).resize(size, Image.LANCZOS), np.float32) for i in range(2)]
    out = np.zeros((size[1], size[0], 3), np.uint8)
    out[..., 0] = np.clip(ch[0], 0, 255); out[..., 1] = np.clip(ch[1], 0, 255)
    return Image.fromarray(out, "RGB")

# ------------------------------------------------------------------ grid sheet
def edge_fade(img, m):
    a = np.asarray(img).copy(); h, w = a.shape[:2]
    ry = np.minimum(np.arange(h), np.arange(h)[::-1]); rx = np.minimum(np.arange(w), np.arange(w)[::-1])
    wy = np.clip(ry / m, 0, 1); wx = np.clip(rx / m, 0, 1)
    a[..., 3] = (a[..., 3] * np.minimum(wy[:, None], wx[None, :])).astype(np.uint8); return Image.fromarray(a, "RGBA")

class Sheet:
    """Uniform grid atlas (engine AtlasJson) + TexturePacker JSON-hash, @2x page set, emissive page, tint mask."""
    def __init__(self, key, fw, fh, cols, category="vfx", pivot=(0.5, 0.5), make2x=True, sharpen=True):
        self.key, self.fw, self.fh, self.cols, self.category = key, fw, fh, cols, category
        self.pivot, self.make2x, self.sharpen = pivot, make2x, sharpen
        self.frames = {}; self.n = 0; self.has_emis = False; self.has_tint = False; self.sprites = []; self.warnings = []
        self.edge_fade = True   # feather alpha to 0 inside the 2px cell margin (no bleed with linear filtering); off for tiling strips
    def add_raw(self, name, i1, i2=None, t1=None, t2=None, idx=None, pivot=None):
        """pre-rendered 1x / 2x images (e.g. derived from the UI kit frames)."""
        idx = self.n if idx is None else idx; self.n = max(self.n, idx + 1)
        f = {"name": name, "pivot": pivot or self.pivot, "i1": i1}
        if self.make2x: f["i2"] = i2 if i2 is not None else i1.resize((self.fw * 2, self.fh * 2), Image.LANCZOS)
        if t1 is not None:
            self.has_tint = True; f["t1"] = t1
            if self.make2x: f["t2"] = t2 if t2 is not None else t1.resize((self.fw * 2, self.fh * 2), Image.LANCZOS)
        self.frames[idx] = f; return idx
    def add(self, name, img_ss, emis=None, tint=None, idx=None, pivot=None, sharpen=None):
        idx = self.n if idx is None else idx; self.n = max(self.n, idx + 1)
        sh = self.sharpen if sharpen is None else sharpen
        size1 = (self.fw, self.fh); size2 = (self.fw * 2, self.fh * 2)
        f = {"name": name, "pivot": pivot or self.pivot, "i1": downscale(img_ss, size1, sh)}
        if self.make2x: f["i2"] = downscale(img_ss, size2, sh)
        if emis is not None:
            self.has_emis = True; f["e1"] = clip_to(downscale(emis, size1, False), f["i1"])
            if self.make2x: f["e2"] = clip_to(downscale(emis, size2, False), f["i2"])
        if tint is not None:
            self.has_tint = True; f["t1"] = tint_down(tint, size1)
            if self.make2x: f["t2"] = tint_down(tint, size2)
        a = np.asarray(f["i1"])[..., 3]; m = MARGIN
        if a[:m].max() > 24 or a[-m:].max() > 24 or a[:, :m].max() > 24 or a[:, -m:].max() > 24:
            self.warnings.append(f"{self.key}:{name} touches the {m}px cell margin" + (" (feathered)" if self.edge_fade else ""))
            if self.edge_fade:
                for k in ("i1", "i2", "e1", "e2"):
                    if k in f: f[k] = edge_fade(f[k], m * (2 if k.endswith("2") else 1))
        self.frames[idx] = f; return idx
    @property
    def rows(self): return max(1, math.ceil(self.n / self.cols))
    def _pages(self, scale):
        fw, fh = self.fw * scale, self.fh * scale
        assert self.cols * fw <= MAX_PAGE, f"{self.key} too wide at {scale}x"
        rows = self.rows
        assert rows * fh <= MAX_PAGE, f"{self.key}: {scale}x page taller than {MAX_PAGE}px (engine pages must keep the same grid on one image)"
        return [(0, list(range(rows)))]
    def save(self):
        os.makedirs(ATL, exist_ok=True); out = []
        for scale in ([1, 2] if self.make2x else [1]):
            fw, fh = self.fw * scale, self.fh * scale; pages = self._pages(scale)
            for p, rows in pages:
                suffix = ("" if scale == 1 else "@2x") if len(pages) == 1 else (f"_p{p}" + ("" if scale == 1 else "@2x"))
                base = f"{self.key}{suffix}"; W, Hh = self.cols * fw, len(rows) * fh
                pg = {k: Image.new(m, (W, Hh), c) for k, m, c in (("i", "RGBA", (0, 0, 0, 0)), ("e", "RGBA", (0, 0, 0, 0)), ("t", "RGB", (0, 0, 0)))}
                tp = {}
                for idx, f in sorted(self.frames.items()):
                    r = idx // self.cols
                    if r not in rows: continue
                    x, y = (idx % self.cols) * fw, (r - rows[0]) * fh; k = str(scale)
                    pg["i"].paste(f[f"i{k}"], (x, y))
                    if f"e{k}" in f: pg["e"].paste(f[f"e{k}"], (x, y))
                    if f"t{k}" in f: pg["t"].paste(f[f"t{k}"], (x, y))
                    tp[f["name"]] = {"frame": {"x": x, "y": y, "w": fw, "h": fh}, "rotated": False, "trimmed": False,
                                     "spriteSourceSize": {"x": 0, "y": 0, "w": fw, "h": fh}, "sourceSize": {"w": fw, "h": fh},
                                     "pivot": {"x": f["pivot"][0], "y": f["pivot"][1]}, "index": idx}
                pg["i"].save(os.path.join(ATL, base + ".png"), optimize=True)
                if self.has_emis: pg["e"].save(os.path.join(ATL, base.replace("@2x", "") + "_emissive" + ("@2x" if "@2x" in base else "") + ".png"), optimize=True)
                if self.has_tint: pg["t"].save(os.path.join(ATL, base.replace("@2x", "") + "_tintmask" + ("@2x" if "@2x" in base else "") + ".png"), optimize=True)
                meta = {"app": "pvp_clan/tools (procedural)", "version": "1.0", "image": base + ".png", "format": "RGBA8888",
                        "size": {"w": W, "h": Hh}, "scale": str(scale), "grid": {"frameW": fw, "frameH": fh, "columns": self.cols, "rows": len(rows), "firstRow": rows[0], "margin": MARGIN * scale},
                        "emissive": (base.replace("@2x", "") + "_emissive" + ("@2x" if scale == 2 else "") + ".png") if self.has_emis else None,
                        "tintmask": (base.replace("@2x", "") + "_tintmask" + ("@2x" if scale == 2 else "") + ".png") if self.has_tint else None}
                json.dump({"frames": tp, "meta": meta}, open(os.path.join(ATL, base + ".json"), "w"), indent=1)
                out.append(base)
        return out
    def atlas_json(self):
        p = f"pvp_clan/atlases/{self.key}"
        a = {"key": self.key, "image": p + ".png", "frameW": self.fw, "frameH": self.fh, "columns": self.cols, "rows": self.rows}
        if self.make2x: a["pages"] = [{"scale": 2, "image": p + "@2x.png"}]
        masks = {}
        if self.has_emis: masks["emissive"] = True                      # -> <image>_emissive.png
        if self.has_tint: masks["tintmask"] = p + "_tintmask.png"      # R = clan primary, G = clan secondary
        if masks: a["masks"] = masks
        if getattr(self, "nine", None): a["nineSlice"] = self.nine
        return a
    def frame(self, idx, scale=1): return self.frames[idx][f"i{scale}"]

def apply_tint(img, mask, primary, secondary=None):
    """preview helper: multiply-tint by two-tone mask (R primary, G secondary) as the shader would."""
    a = np.asarray(img, np.float32) / 255; m = np.asarray(mask, np.float32) / 255
    p = np.array(H(primary), np.float32) / 255; s = np.array(H(secondary or primary), np.float32) / 255
    rgb = a[..., :3]
    rgb = rgb * (1 - m[..., 0:1]) + rgb * p * m[..., 0:1]
    rgb = rgb * (1 - m[..., 1:2]) + a[..., :3] * s * m[..., 1:2]
    return Image.fromarray((np.concatenate([np.clip(rgb, 0, 1), a[..., 3:4]], -1) * 255).astype(np.uint8), "RGBA")
