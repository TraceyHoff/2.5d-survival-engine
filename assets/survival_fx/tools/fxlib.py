"""Shared helpers for the survival FX pack: toon canvas (vendored, k-scalable), grid atlases with
1x + 2x + emissive pages, TexturePacker JSON-hash export, periodic noise, iso tile sampling."""
import json, math, os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from ftoon import Canvas, ellipse_pts, capsule_pts, downscale, smooth, blur, noise, lerp, outline_col, SS
from vpalette import RAMPS, hex2rgb

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT_ATLAS = os.path.join(ROOT, "atlases"); OUT_TEX = os.path.join(ROOT, "textures"); OUT_BUILD = os.path.join(ROOT, "build")
for d in (OUT_ATLAS, OUT_TEX, OUT_BUILD): os.makedirs(d, exist_ok=True)
PAD = 2  # transparent margin inside every frame (= 4 px gutter between neighbouring frames' content)
MAXTEX = 2048

def R(name, i=1):
    """ramp colour as rgb tuple; i 0=hl 1=base 2=shade 3=deep"""
    return hex2rgb(RAMPS[name][i])
def ramp(name): return [hex2rgb(c) for c in RAMPS[name]]
INK = R("ink", 2); INK_SOFT = R("ink", 1)

def circ(x, y, r, ry=None, rot=0, wob=0.05, seed=0, n=40): return ellipse_pts(x, y, r, ry or r, rot, n=n, wob=wob, seed=seed)

def drop_pts(cx, cy, r, h, tilt=0.0, n=32):
    """teardrop: round bottom at (cx,cy) radius r, tip at height h above."""
    pts = []
    for i in range(n):
        a = i / n * 2 * math.pi
        if math.sin(a) < 0:   # upper half -> pinch to tip
            t = -math.sin(a)
            x = cx + math.cos(a) * r * (1 - t) ** 0.9 + tilt * t * h
            y = cy - t * h
        else:
            x = cx + math.cos(a) * r; y = cy + math.sin(a) * r
        pts.append((x, y))
    return pts

def star_pts(cx, cy, r0, r1, n=5, rot=-math.pi / 2):
    return [(cx + math.cos(rot + i * math.pi / n) * (r0 if i % 2 == 0 else r1), cy + math.sin(rot + i * math.pi / n) * (r0 if i % 2 == 0 else r1)) for i in range(2 * n)]

def soft(cv, x, y, r, color, alpha=255, ry=None, blur_r=None):
    """soft blob, flat colour, blurred edge (no outline)."""
    cv.fill(circ(x, y, r, ry, wob=0.0), color, alpha=alpha, blur_r=r * 0.5 if blur_r is None else blur_r)

def blank(cv): return cv.img.getbbox() is None

def render(fn, w, h, seed=1, emissive=False):
    """fn(cv, em) draws in 1x coordinates. Returns dict scale->(rgba, emissive or None) for 1x and 2x."""
    out = {}
    for k in (1, 2):
        cv = Canvas(w, h, seed=seed, k=k); em = Canvas(w, h, seed=seed, k=k)
        fn(cv, em)
        img = cv.final()
        e = em.final(sharpen=False) if emissive and em.img.getbbox() else None
        if e is not None:  # engine composite: emissive = 'ignore darkness' weight on the scene colour -> must stay inside the sprite
            ea = np.asarray(e).copy(); ia = np.asarray(img)[..., 3]
            ea[..., 3] = np.minimum(ea[..., 3], ia); e = Image.fromarray(ea)
        out[k] = (img, e)
    return out

class Atlas:
    """Uniform grid atlas (engine manifest v1) + TexturePacker JSON hash; writes 1x, 2x and emissive pages."""
    def __init__(self, key, fw, fh, category="vfx", emissive=False, pad_check=True):
        self.key, self.fw, self.fh, self.category, self.emissive, self.pad_check = key, fw, fh, category, emissive, pad_check
        self.frames = []   # list of render() dicts
        self.sprites = {}  # key -> dict(anchor, anims{name:{frames,fps,loop}})
        self.warn = []
    def add(self, sprite, anim, frames, fps=8, loop=True, anchor=(0.5, 0.5)):
        idx = []
        for f in frames:
            idx.append(len(self.frames)); self.frames.append(f)
        s = self.sprites.setdefault(sprite, {"anchor": anchor, "animations": {}})
        s["animations"][anim] = {"frames": idx, "fps": fps, "loop": loop}
        return idx
    def addfn(self, sprite, anim, n, fn, fps=8, loop=True, anchor=(0.5, 0.5), seed=1):
        """fn(cv, em, i, n)"""
        frames = [render(lambda cv, em, i=i: fn(cv, em, i, n), self.fw, self.fh, seed=seed + i, emissive=self.emissive) for i in range(n)]
        return self.add(sprite, anim, frames, fps, loop, anchor)
    def write(self):
        n = len(self.frames); cols = max(1, min(n, MAXTEX // self.fw)); rows = math.ceil(n / cols)
        assert rows * self.fh <= MAXTEX, f"{self.key} too large"
        man = {"key": self.key, "image": f"{self.key}.png", "frameW": self.fw, "frameH": self.fh, "columns": cols, "rows": rows}
        if self.emissive: man["emissive"] = True
        for k in (1, 2):
            fw, fh = self.fw * k, self.fh * k
            page = Image.new("RGBA", (cols * fw, rows * fh), (0, 0, 0, 0)); epage = Image.new("RGBA", page.size, (0, 0, 0, 0))
            tp = {}
            names = {}
            for sk, s in self.sprites.items():
                for an, a in s["animations"].items():
                    for j, f in enumerate(a["frames"]): names[f] = (f"{sk}/{an}/{j}", s["anchor"], 1000.0 / a["fps"])
            for i, fr in enumerate(self.frames):
                img, em = fr[k]
                if self.pad_check and k == 1:
                    a = np.asarray(img)[..., 3]; p = PAD
                    if a[:p].max() > 8 or a[-p:].max() > 8 or a[:, :p].max() > 8 or a[:, -p:].max() > 8:
                        self.warn.append(f"{self.key} frame {i} ({names.get(i, ('?',))[0]}) touches the {PAD}px margin")
                x, y = (i % cols) * fw, (i // cols) * fh
                page.alpha_composite(img, (x, y))
                if em is not None: epage.alpha_composite(em, (x, y))
                nm, anc, dur = names[i]
                tp[nm] = {"frame": {"x": x, "y": y, "w": fw, "h": fh}, "rotated": False, "trimmed": False,
                          "spriteSourceSize": {"x": 0, "y": 0, "w": fw, "h": fh}, "sourceSize": {"w": fw, "h": fh},
                          "pivot": {"x": anc[0], "y": anc[1]}, "duration": round(dur, 2)}
            base = self.key if k == 1 else f"{self.key}_2x"
            page.save(os.path.join(OUT_ATLAS, base + ".png"), optimize=True)
            if self.emissive: epage.save(os.path.join(OUT_ATLAS, base + "_emissive.png"), optimize=True)
            json.dump({"frames": tp, "meta": {"app": "survival_fx/tools", "version": "1", "image": base + ".png", "format": "RGBA8888",
                       "size": {"w": page.width, "h": page.height}, "scale": str(k), "padding": PAD,
                       "note": f"uniform grid {fw}x{fh}; {PAD}px transparent margin inside each frame"}},
                      open(os.path.join(OUT_ATLAS, base + ".json"), "w"), indent=1)
        sprites = []
        for sk, s in self.sprites.items():
            sprites.append({"key": sk, "category": self.category, "atlas": self.key, "anchor": {"x": s["anchor"][0], "y": s["anchor"][1]},
                            "animations": {an: ({"frames": a["frames"], "fps": a["fps"]} | ({} if a["loop"] else {"loop": False})) for an, a in s["animations"].items()}})
        for w in self.warn: print("WARN", w)
        return {"atlas": man, "sprites": sprites, "hiDpi": {self.key: f"{self.key}_2x.png"}}

def save_build(name, data): json.dump(data, open(os.path.join(OUT_BUILD, name + ".json"), "w"), indent=1)

# ---------------- noise ----------------
def pnoise(P, cells, seed, octaves=4, persist=0.5):
    """periodic fbm on a PxP torus, values ~0..1."""
    rng = np.random.default_rng(seed); acc = np.zeros((P, P), np.float32); amp = 1.0; tot = 0
    for o in range(octaves):
        c = max(2, int(cells * 2 ** o))
        g = rng.random((c, c)).astype(np.float32)
        t = np.tile(g, (3, 3))
        im = Image.fromarray(t, "F").resize((3 * P, 3 * P), Image.BICUBIC)
        a = np.asarray(im)[P:2 * P, P:2 * P]
        acc += a * amp; tot += amp; amp *= persist
    acc /= tot
    return (acc - acc.min()) / (acc.max() - acc.min() + 1e-6)

def sample_wrap(field, u, v):
    """bilinear sample of periodic field at u,v in period units."""
    P = field.shape[0]; x = (u % 1.0) * P; y = (v % 1.0) * P
    x0 = np.floor(x).astype(int); y0 = np.floor(y).astype(int); fx = x - x0; fy = y - y0
    x0 %= P; y0 %= P; x1 = (x0 + 1) % P; y1 = (y0 + 1) % P
    return (field[y0, x0] * (1 - fx) * (1 - fy) + field[y0, x1] * fx * (1 - fy) + field[y1, x0] * (1 - fx) * fy + field[y1, x1] * fx * fy)

def iso_coords(w=64, h=32, k=1, ss=1):
    """tile coords (tx, ty) for each pixel of a w*k x h*k diamond tile; diamond = |tx|,|ty|<=0.5"""
    W, H = w * k * ss, h * k * ss
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
    x = (xs + 0.5) / (k * ss) - w / 2; y = (ys + 0.5) / (k * ss) - h / 2
    tx = x / w + y / h; ty = y / h - x / w
    return tx, ty

def diamond_alpha(w=64, h=32, k=1, ss=4):
    tx, ty = iso_coords(w, h, k, ss)
    m = ((np.abs(tx) <= 0.5) & (np.abs(ty) <= 0.5)).astype(np.float32)
    im = Image.fromarray(m, "F").resize((w * k, h * k), Image.BOX)
    return np.asarray(im)

def to_img(rgb, a):
    arr = np.concatenate([np.clip(rgb, 0, 255), np.clip(a, 0, 1)[..., None] * 255], -1).astype(np.uint8)
    return Image.fromarray(arr, "RGBA")

def gray(a): return Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8), "L")
