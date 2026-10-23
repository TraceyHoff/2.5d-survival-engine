"""Toon rendering kit: supersampled (SS=4) layered parts with hand-drawn wobbly, weight-varying soft outlines,
3-tone cel shading (light from top-left), rim highlights, contact shadows. All geometry in 1x pixel units."""
import math, numpy as np
from PIL import Image, ImageDraw, ImageFilter
from palette import ramp, RAMPS, hex2rgb, SHADOW, SHADOW_ALPHA

SS = 4
INK = hex2rgb(RAMPS["ink"][2])
_rng = np.random.default_rng(7)

def lerp(a, b, t): return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))
def outline_col(r): return lerp(r[3], INK, 0.55)

def noise(w, h, cell, seed):
    g = np.random.default_rng(seed).random((max(2, h // cell + 3), max(2, w // cell + 3)))
    im = Image.fromarray((g * 255).astype(np.uint8)).resize(((g.shape[1]) * cell, (g.shape[0]) * cell), Image.BICUBIC)
    return np.asarray(im, dtype=np.float32)[:h, :w] / 255.0

def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t)

def blur(a, r):
    if r <= 0: return a
    im = Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(r))
    return np.asarray(im, dtype=np.float32) / 255.0

def shift(a, dx, dy):
    """value at p = a[p + (dx,dy)] (zero outside)."""
    out = np.zeros_like(a); H, W = a.shape; dx, dy = int(round(dx)), int(round(dy))
    ys0, ys1 = max(0, -dy), min(H, H - dy); xs0, xs1 = max(0, -dx), min(W, W - dx)
    if ys1 > ys0 and xs1 > xs0: out[ys0:ys1, xs0:xs1] = a[ys0 + dy:ys1 + dy, xs0 + dx:xs1 + dx]
    return out

# ---------- shapes (return polygons in 4x coords) ----------
def ellipse_pts(cx, cy, rx, ry, rot=0.0, n=48, wob=0.0, seed=0):
    r = np.random.default_rng(abs(int(seed))); ph = r.random(3) * 6.28
    pts = []
    for i in range(n):
        a = i / n * 2 * math.pi
        k = 1 + wob * (0.5 * math.sin(3 * a + ph[0]) + 0.3 * math.sin(5 * a + ph[1]) + 0.2 * math.sin(7 * a + ph[2]))
        x, y = math.cos(a) * rx * k, math.sin(a) * ry * k
        pts.append((cx + x * math.cos(rot) - y * math.sin(rot), cy + x * math.sin(rot) + y * math.cos(rot)))
    return pts

def capsule_pts(x0, y0, x1, y1, r0, r1=None, n=20):
    r1 = r0 if r1 is None else r1
    a = math.atan2(y1 - y0, x1 - x0); pts = []
    for i in range(n + 1):
        t = a + math.pi / 2 + math.pi * i / n; pts.append((x0 + math.cos(t) * r0, y0 + math.sin(t) * r0))
    for i in range(n + 1):
        t = a - math.pi / 2 + math.pi * i / n; pts.append((x1 + math.cos(t) * r1, y1 + math.sin(t) * r1))
    return pts

def blob_pts(points, r, n=12):
    """union hull-ish: just returns list of circle polys (draw each)."""
    return [ellipse_pts(x, y, rr, rr * 0.95, n=n * 3) for (x, y, rr) in points]

class Canvas:
    """Supersampled canvas. Coordinates passed to draw methods are 1x pixels."""
    def __init__(self, w, h, seed=1, wobble=1.0):
        self.w, self.h = w, h; self.W, self.H = w * SS, h * SS
        self.img = Image.new("RGBA", (self.W, self.H), (0, 0, 0, 0)); self.seed = seed
        self.wobble = wobble
        self._n1 = noise(self.W, self.H, 10 * SS, seed) ; self._n2 = noise(self.W, self.H, 3 * SS, seed + 99)

    def S(self, pts): return [(x * SS, y * SS) for x, y in pts]

    def mask_from(self, polys):
        m = Image.new("L", (self.W, self.H), 0); d = ImageDraw.Draw(m)
        if polys and isinstance(polys[0], tuple): polys = [polys]
        for p in polys: d.polygon(self.S(p), fill=255)
        return m

    # core cel part
    def part(self, polys, rp, lw=1.0, shade=0.22, hl=0.10, outline=True, flat=False, gloss=None, mask=None,
             shade_col=None, base_col=None, clip=None, hl_col=None, ink=None):
        """polys: polygon or list (1x coords). rp: ramp name or list of 4 rgb tuples."""
        r = ramp(rp) if isinstance(rp, str) else rp
        m_im = mask if mask is not None else self.mask_from(polys)
        if clip is not None: m_im = Image.fromarray(np.minimum(np.asarray(m_im), np.asarray(clip)))
        bb = m_im.getbbox()
        if not bb: return m_im
        pad = int((lw + 2) * SS * 2) + 4
        x0, y0 = max(0, bb[0] - pad), max(0, bb[1] - pad); x1, y1 = min(self.W, bb[2] + pad), min(self.H, bb[3] + pad)
        m = np.asarray(m_im.crop((x0, y0, x1, y1)), dtype=np.float32) / 255.0
        n1 = self._n1[y0:y1, x0:x1]; n2 = self._n2[y0:y1, x0:x1]
        size = max(4.0, min(bb[2] - bb[0], bb[3] - bb[1]))
        base = np.array(base_col or r[1], np.float32); sh = np.array(shade_col or r[2], np.float32); hc = np.array(hl_col or r[0], np.float32)
        col = np.ones(m.shape + (3,), np.float32) * base
        if not flat:
            o = max(2, shade * size)
            s = m * (1 - blur(shift(m, o, o * 1.1), o * 0.35))
            s = smooth(0.42, 0.58, s + (n2 - 0.5) * 0.12)
            col = col * (1 - s[..., None]) + sh * s[..., None]
            if hl > 0:
                h = max(1.5, hl * size)
                t = m * (1 - blur(shift(m, -h, -h * 1.2), h * 0.4))
                t = smooth(0.5, 0.62, t) * (1 - s)
                col = col * (1 - t[..., None]) + hc * t[..., None]
        if gloss is not None:
            for (gx, gy, grx, gry) in gloss:
                gm = Image.new("L", (x1 - x0, y1 - y0), 0)
                ImageDraw.Draw(gm).ellipse([gx * SS - grx * SS - x0, gy * SS - gry * SS - y0, gx * SS + grx * SS - x0, gy * SS + gry * SS - y0], fill=200)
                g = np.asarray(gm.filter(ImageFilter.GaussianBlur(SS * 0.5)), np.float32) / 255 * m
                col = col * (1 - g[..., None]) + np.array(r[0], np.float32) * g[..., None]
        alpha = m
        if outline:
            oc = np.array(ink or outline_col(r), np.float32)
            rad = lw * SS * 0.75
            mm = np.maximum(m, shift(m, -SS * 0.35 * lw, -SS * 0.35 * lw))   # heavier line bottom-right
            D = blur(mm, rad)
            thr = np.maximum(0.07, 0.13 + 0.09 * (n1 - 0.5) * 2 * self.wobble + 0.04 * (n2 - 0.5))
            ring = smooth(thr - 0.04, thr + 0.04, D)
            ring = np.maximum(ring, m)
            col = col * m[..., None] + oc * (1 - m[..., None])
            alpha = ring
        arr = np.concatenate([np.clip(col, 0, 255), (alpha * 255)[..., None]], axis=2).astype(np.uint8)
        layer = Image.fromarray(arr, "RGBA")
        full = Image.new("RGBA", (self.W, self.H), (0, 0, 0, 0)); full.paste(layer, (x0, y0))
        self.img = Image.alpha_composite(self.img, full)
        return m_im

    def fill(self, polys, color, alpha=255, clip=None, blur_r=0):
        """Flat detail without outline. color rgb tuple or hex."""
        if isinstance(color, str): color = hex2rgb(color)
        m = self.mask_from(polys)
        if clip is not None: m = Image.fromarray(np.minimum(np.asarray(m), np.asarray(clip)))
        if blur_r: m = m.filter(ImageFilter.GaussianBlur(blur_r * SS))
        if alpha != 255: m = m.point(lambda v: v * alpha // 255)
        layer = Image.new("RGBA", (self.W, self.H), tuple(color) + (0,)); layer.putalpha(m)
        self.img = Image.alpha_composite(self.img, layer)

    def line(self, pts, color, width=1.0, clip=None, alpha=255):
        if isinstance(color, str): color = hex2rgb(color)
        m = Image.new("L", (self.W, self.H), 0); d = ImageDraw.Draw(m)
        sp = self.S(pts); d.line(sp, fill=alpha, width=max(1, int(width * SS)), joint="curve")
        for p in (sp[0], sp[-1]):
            rr = width * SS / 2; d.ellipse([p[0] - rr, p[1] - rr, p[0] + rr, p[1] + rr], fill=alpha)
        if clip is not None: m = Image.fromarray(np.minimum(np.asarray(m), np.asarray(clip)))
        layer = Image.new("RGBA", (self.W, self.H), tuple(color) + (0,)); layer.putalpha(m)
        self.img = Image.alpha_composite(self.img, layer)

    def shadow(self, cx, cy, rx, ry, alpha=SHADOW_ALPHA):
        m = Image.new("L", (self.W, self.H), 0)
        ImageDraw.Draw(m).ellipse([(cx - rx) * SS, (cy - ry) * SS, (cx + rx) * SS, (cy + ry) * SS], fill=int(255 * alpha))
        m = m.filter(ImageFilter.GaussianBlur(SS * 1.2))
        layer = Image.new("RGBA", (self.W, self.H), hex2rgb(SHADOW) + (0,)); layer.putalpha(m)
        self.img = Image.alpha_composite(self.img, layer)

    def paste(self, other_img_ss, x=0, y=0):
        full = Image.new("RGBA", (self.W, self.H), (0, 0, 0, 0)); full.paste(other_img_ss, (int(x * SS), int(y * SS)))
        self.img = Image.alpha_composite(self.img, full)

    def final(self, sharpen=True):
        return downscale(self.img, (self.w, self.h), sharpen)

def downscale(img, size, sharpen=True):
    a = np.asarray(img, np.float32) / 255.0
    pm = a.copy(); pm[..., :3] *= pm[..., 3:4]
    ch = [np.asarray(Image.fromarray(np.ascontiguousarray(pm[..., i]), "F").resize(size, Image.LANCZOS), np.float32) for i in range(4)]
    r = np.stack(ch, -1); r = np.clip(r, 0, 1)
    al = r[..., 3:4]; rgb = np.where(al > 1e-4, r[..., :3] / np.maximum(al, 1e-4), 0)
    if sharpen:  # crispness at 1x (pixel-art adjacent)
        al = smooth(0.06, 0.94, al)
    out = np.concatenate([np.clip(rgb, 0, 1), al], -1)
    im = Image.fromarray((out * 255 + 0.5).astype(np.uint8), "RGBA")
    if sharpen: im = im.filter(ImageFilter.UnsharpMask(radius=0.6, percent=60, threshold=1))
    return im
