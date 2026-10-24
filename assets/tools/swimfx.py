"""ADR-107 swim helpers shared by the paper-doll and main-pack swim merges.
Swim frames self-clip (the renderer only clips its walk-based fallback): every layer is sunk by the same amount so the
chest waterline sits at the feet pivot, everything at/below the waterline row is cleared, and the BASE layer only
(body / whole character / animal) gets a cute ripple ring: back arc drawn behind, filled foam front half in front."""
import numpy as np
from PIL import Image, ImageDraw

def sink(a, shift, wl):
    """a: HxWxC uint8 frame; move content down by `shift` px, clear rows >= wl."""
    o = np.zeros_like(a)
    if shift < a.shape[0]: o[shift:] = a[:a.shape[0] - shift]
    o[wl:] = 0
    return o

def ripple(w, h, cx, wl, rx, ry, fi, s, ss=4):
    """(back, front) RGBA uint8 layers, size (w*s, h*s); centre (cx, wl) in 1x px; frame fi animates the ring."""
    k = s * ss; W, H = w * k, h * k
    ph = fi % 4; rxp = rx + [0, .6, 1.0, .6][ph]; ryp = ry + [0, .2, .35, .2][ph]
    box = [(cx - rxp) * k, (wl - ryp) * k, (cx + rxp) * k, (wl + ryp) * k]
    lw = max(1, int(1.1 * k))
    back = Image.new("RGBA", (W, H)); db = ImageDraw.Draw(back)
    db.arc(box, 180, 360, fill=(70, 140, 170, 255), width=lw)                       # soft ink back arc
    db.arc([box[0] + lw, box[1] + lw, box[2] - lw, box[3] - lw], 180, 360, fill=(215, 245, 255, 230), width=max(1, lw // 2))
    front = Image.new("RGBA", (W, H)); df = ImageDraw.Draw(front)
    df.pieslice(box, 0, 180, fill=(150, 215, 235, 205))                             # translucent water/foam skirt
    df.arc(box, 0, 180, fill=(70, 140, 170, 255), width=lw)
    df.line([(box[0] + 2 * lw, wl * k + lw * .6), (box[2] - 2 * lw, wl * k + lw * .6)], fill=(235, 252, 255, 240), width=max(1, lw // 2 * 2))  # foam line
    for j, (dx, dy) in enumerate([(-rxp * .75, -ryp - 2.2), (rxp * .8, -ryp - 1.2)]):  # bobbing droplets
        if (ph + j) % 2 == 0:
            x, y = (cx + dx) * k, (wl + dy - .4 * ph) * k; r = .9 * k
            df.ellipse([x - r, y - r, x + r, y + r], fill=(225, 248, 255, 255), outline=(70, 140, 170, 255), width=max(1, lw // 2))
    f = lambda im: np.asarray(im.resize((w * s, h * s), Image.LANCZOS)).copy()
    b, fr = f(back), f(front); b[b[..., 3] < 8] = 0; fr[fr[..., 3] < 8] = 0
    return b, fr

def over(dst, src):
    """alpha-composite src over dst (both RGBA uint8, straight alpha)."""
    sa = src[..., 3:4].astype(np.float32) / 255; da = dst[..., 3:4].astype(np.float32) / 255
    oa = sa + da * (1 - sa); rgb = (src[..., :3] * sa + dst[..., :3] * da * (1 - sa)) / np.maximum(oa, 1e-6)
    o = np.concatenate([rgb, oa * 255], -1); o = np.clip(o + .5, 0, 255).astype(np.uint8); o[o[..., 3] == 0] = 0
    return o

def apply_base(a, back, front):
    return over(over(back, a), front)
