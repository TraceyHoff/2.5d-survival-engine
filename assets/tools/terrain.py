"""Seamless 2:1 iso terrain tiles (64x48: 64x32 top diamond + 16px side skirt). Periodic noise -> tiles seamlessly."""
import math, numpy as np
from PIL import Image, ImageDraw, ImageFilter
from toon import SS, Canvas, smooth, downscale, lerp, ellipse_pts, INK
from iso import ramp_color
from palette import ramp, hex2rgb

TW, TH, SK = 64, 32, 16

def pnoise(u, v, seed, kmax=4, amp=1.0):
    """periodic (seamless on the unit tile) noise from integer-frequency waves."""
    rng = np.random.default_rng(seed); out = np.zeros_like(u)
    for k in range(1, kmax + 1):
        for _ in range(3):
            a, b = rng.integers(-k, k + 1, 2)
            if a == 0 and b == 0: a = k
            out += np.sin(2 * math.pi * (a * u + b * v) + rng.random() * 6.28) / k
    return out / (kmax * 1.2) * amp

def uv_grid(W=TW, H=TH):
    ys, xs = np.mgrid[0:H * SS, 0:W * SS].astype(np.float32)
    sx = (xs + 0.5) / SS - W / 2; sy = (ys + 0.5) / SS - H / 2
    u = (sx / (W / 2) + sy / (H / 2)) / 2 + 0.5; v = (sy / (H / 2) - sx / (W / 2)) / 2 + 0.5
    inside = (np.abs(sx) / (W / 2) + np.abs(sy) / (H / 2)) <= 1.0 + 0.6 / (H / 2)
    return u, v, inside, sx, sy

def to_screen(u, v):
    """tile uv (0..1) -> 1x screen coords within the 64x48 frame."""
    sx = (u - v) * TW / 2; sy = (u + v - 1) * TH / 2
    return TW / 2 + sx, TH / 2 + sy

def top_image(tone, rp, inside):
    col = ramp_color(rp, tone)
    a = inside.astype(np.float32) * 255
    return Image.fromarray(np.concatenate([col, a[..., None]], 2).astype(np.uint8), "RGBA")

def skirt(img, rp_side, lip_rp=None, seed=0, water=False):
    """Draw the two camera-facing side faces below the diamond (16px)."""
    d = Image.new("RGBA", img.size, (0, 0, 0, 0)); W = TW * SS
    full = Image.new("RGBA", (TW * SS, (TH + SK) * SS), (0, 0, 0, 0)); full.paste(img, (0, 0))
    L = [(0, TH / 2 * SS), (TW / 2 * SS, TH * SS), (TW / 2 * SS, (TH + SK) * SS), (0, (TH / 2 + SK) * SS)]
    R = [(TW / 2 * SS, TH * SS), (TW * SS, TH / 2 * SS), (TW * SS, (TH / 2 + SK) * SS), (TW / 2 * SS, (TH + SK) * SS)]
    rng = np.random.default_rng(seed)
    for poly, sh in ((L, 0.1), (R, 0.95)):
        m = Image.new("L", full.size, 0); ImageDraw.Draw(m).polygon(poly, fill=255)
        ys, xs = np.mgrid[0:full.size[1], 0:full.size[0]].astype(np.float32)
        # strata bands
        t = 1.0 + sh + 0.25 * np.sin(ys / (3.2 * SS) + np.sin(xs / (5 * SS)) * 0.8) + (rng.random(xs.shape) - 0.5) * 0.12
        col = ramp_color(rp_side, t)
        lay = Image.fromarray(np.concatenate([col, np.zeros(col.shape[:2] + (1,))], 2).astype(np.uint8), "RGBA"); lay.putalpha(m)
        full = Image.alpha_composite(full, lay)
    dd = ImageDraw.Draw(full)
    # pebbles
    for _ in range(6):
        side = rng.integers(0, 2); t = rng.uniform(0.1, 0.9); h = rng.uniform(0.35, 0.9)
        x = (t * TW / 2 + side * TW / 2) * SS
        ytop = (TH / 2 + t * TH / 2) if side == 0 else (TH - t * TH / 2)
        y = (ytop + h * SK) * SS; r = rng.uniform(0.8, 1.6) * SS
        c = ramp("stone")[1 + side]
        dd.ellipse([x - r, y - r * 0.7, x + r, y + r * 0.7], fill=c + (255,))
    # grass lip overhang
    if lip_rp:
        c = ramp(lip_rp)
        for side in (0, 1):
            for i in range(17):
                t = i / 16; x = (t * TW / 2 + side * TW / 2) * SS
                y = ((TH / 2 + t * TH / 2) if side == 0 else (TH - t * TH / 2)) * SS
                hgt = (1.5 + 1.8 * abs(math.sin(i * 1.7 + side))) * SS; w = 2.2 * SS
                dd.polygon([(x - w, y - SS), (x + w, y - SS), (x + w * 0.2, y + hgt)], fill=c[2 + side * 0] + (255,) if side == 0 else c[3] + (255,))
    # edge line where top meets sides (soft ink)
    return full

def draw_tufts(img, n, rp, seed, flowers=None, margin=0.12):
    rng = np.random.default_rng(seed); d = ImageDraw.Draw(img); c = ramp(rp)
    for i in range(n):
        u, v = rng.uniform(margin, 1 - margin, 2); x, y = to_screen(u, v); x *= SS; y *= SS
        h = rng.uniform(2.2, 3.6) * SS
        for k, dx in enumerate((-1.3, 0, 1.3)):
            col = c[3] if k == 2 else (c[0] if k == 0 else c[2])
            d.polygon([(x + dx * SS - 0.6 * SS, y), (x + dx * SS + 0.6 * SS, y), (x + dx * SS * 1.6, y - h * (1 if k == 1 else 0.75))], fill=col + (255,))
    if flowers:
        for i in range(len(flowers)):
            u, v = rng.uniform(0.18, 0.82, 2); x, y = to_screen(u, v); x *= SS; y *= SS
            fc = ramp(flowers[i]); r = 1.25 * SS
            for a in range(5):
                ang = a * 1.2566; px, py = x + math.cos(ang) * r, y + math.sin(ang) * r * 0.7
                d.ellipse([px - r * 0.8, py - r * 0.6, px + r * 0.8, py + r * 0.6], fill=fc[1] + (255,))
            d.ellipse([x - r * 0.5, y - r * 0.4, x + r * 0.5, y + r * 0.4], fill=ramp("flower_yel")[0] + (255,))
            d.ellipse([x + r * 0.3, y + r * 0.6, x + r * 1.0, y + r * 0.9], fill=fc[3] + (180,))
    return img

def grass(variant=0, seed=1):
    u, v, inside, sx, sy = uv_grid()
    t = 1.0 + pnoise(u, v, seed, 4, 0.55) + pnoise(u * 3, v * 3, seed + 5, 3, 0.18)
    t = np.round(t * 3) / 3     # posterize: crisp Stardew-like tone patches
    img = top_image(t, "grass", inside)
    img = draw_tufts(img, [5, 7, 4][variant], "grass", seed + 10,
                     flowers=[None, None, ["flower_pink", "flower_blue", "flower_yel"]][variant])
    if variant == 1:  # clover dots
        d = ImageDraw.Draw(img); rng = np.random.default_rng(seed)
        for _ in range(4):
            x, y = to_screen(*rng.uniform(0.2, 0.8, 2)); x *= SS; y *= SS
            for a in range(3):
                px, py = x + math.cos(a * 2.1) * SS, y + math.sin(a * 2.1) * SS * 0.6
                d.ellipse([px - SS, py - SS * 0.7, px + SS, py + SS * 0.7], fill=ramp("grass")[0] + (255,))
    return skirt(img, "dirt", "grass", seed)

def dirt(seed=2):
    u, v, inside, _, _ = uv_grid()
    t = 1.0 + pnoise(u, v, seed, 4, 0.5)
    t = np.round(t * 3) / 3
    img = top_image(t, "dirt", inside); d = ImageDraw.Draw(img); rng = np.random.default_rng(seed)
    for _ in range(9):
        x, y = to_screen(*rng.uniform(0.1, 0.9, 2)); x *= SS; y *= SS; r = rng.uniform(0.7, 1.5) * SS
        d.ellipse([x - r, y - r * 0.6, x + r, y + r * 0.6], fill=ramp("dirt")[2] + (255,))
        d.ellipse([x - r * 0.6, y - r * 0.7, x + r * 0.3, y - r * 0.1], fill=ramp("dirt")[0] + (255,))
    return skirt(img, "dirt", None, seed)

def sand(seed=3):
    u, v, inside, _, _ = uv_grid()
    ripple = np.sin(2 * math.pi * (3 * u + 1 * v) + pnoise(u, v, seed, 2, 2.0)) * 0.3
    t = 0.9 + ripple + pnoise(u, v, seed + 1, 3, 0.25); t = np.round(t * 3) / 3
    img = top_image(t, "sand", inside); d = ImageDraw.Draw(img); rng = np.random.default_rng(seed)
    for _ in range(3):  # tiny shells
        x, y = to_screen(*rng.uniform(0.2, 0.8, 2)); x *= SS; y *= SS
        d.pieslice([x - 1.5 * SS, y - 1.2 * SS, x + 1.5 * SS, y + 1.2 * SS], 180, 360, fill=ramp("flower_pink")[0] + (255,))
    return skirt(img, "sand", None, seed)

def stone(seed=4):
    from iso import tex_cobble
    u, v, inside, _, _ = uv_grid()
    # cobble in uv space (periodic approx by tiling small texture)
    t = 1.0 + pnoise(u, v, seed, 3, 0.4)
    cracks = np.abs(np.sin(2 * math.pi * (2 * u + v) + pnoise(u, v, seed + 3, 2, 3)))
    t = np.where(cracks < 0.06, 2.8, t); t = np.where((cracks >= 0.06) & (cracks < 0.12), t + 0.6, t)
    t = np.round(t * 3) / 3
    img = top_image(t, "stone", inside)
    return skirt(img, "stone", None, seed)

def snow(seed=6):
    u, v, inside, _, _ = uv_grid()
    t = 0.7 + pnoise(u, v, seed, 3, 0.5); t = np.round(t * 3) / 3
    return skirt(top_image(t, "snow", inside), "stone", "snow", seed)

def forest(seed=7):
    u, v, inside, _, _ = uv_grid()
    t = 1.2 + pnoise(u, v, seed, 4, 0.6); t = np.round(t * 3) / 3
    img = top_image(t, "grass_deep", inside)
    d = ImageDraw.Draw(img); rng = np.random.default_rng(seed)
    for _ in range(5):  # fallen leaves + twigs
        x, y = to_screen(*rng.uniform(0.15, 0.85, 2)); x *= SS; y *= SS
        c = ramp("leaf_autumn")[rng.integers(0, 3)]
        d.ellipse([x - 1.4 * SS, y - 0.8 * SS, x + 1.4 * SS, y + 0.8 * SS], fill=c + (255,))
    img = draw_tufts(img, 4, "grass_deep", seed + 3)
    return skirt(img, "dirt", "grass_deep", seed)

def water(frame=0, n=4, seed=8, shallow=False):
    u, v, inside, sx, sy = uv_grid()
    ph = 2 * math.pi * frame / n
    w1 = np.sin(2 * math.pi * (2 * u + 1 * v) + ph) ; w2 = np.sin(2 * math.pi * (1 * u - 2 * v) - ph + 1.3)
    w3 = np.sin(2 * math.pi * (3 * u + 2 * v) + 2 * ph)
    h = (w1 + w2) * 0.5 + w3 * 0.25 + pnoise(u, v, seed, 3, 0.3)
    rp = "water" if shallow else "water_deep"
    t = 1.25 - h * 0.35
    t = np.round(t * 3) / 3
    crest = (h > 0.9)
    t = np.where(crest, -0.2, t)
    img = top_image(t, rp, inside); d = ImageDraw.Draw(img)
    rng = np.random.default_rng(seed + frame)
    for _ in range(3):  # sparkles
        x, y = to_screen(*rng.uniform(0.15, 0.85, 2)); x *= SS; y *= SS; r = 1.4 * SS
        d.polygon([(x - r, y), (x, y - r * 0.5), (x + r, y), (x, y + r * 0.5)], fill=(255, 255, 255, 230))
    full = Image.new("RGBA", (TW * SS, (TH + SK) * SS), (0, 0, 0, 0)); full.paste(img, (0, 0))
    return full

def shore(edge_mask_fn, frame=0, n=4, seed=9):
    """sand tile with water where edge_mask_fn(u,v) > 0.5 (wet transition with foam)."""
    u, v, inside, _, _ = uv_grid()
    s = sand(seed); w = water(frame, n, seed, shallow=True)
    wet = edge_mask_fn(u, v) + pnoise(u, v, seed + 4, 3, 0.07) + 0.04 * math.sin(2 * math.pi * frame / n)
    a_w = smooth(0.48, 0.52, wet) * inside
    foam = (smooth(0.40, 0.44, wet) - smooth(0.47, 0.5, wet)) * inside
    damp = (smooth(0.30, 0.40, wet) - smooth(0.40, 0.44, wet)) * inside
    S = np.asarray(s, np.float32)[:TH * SS]; Wt = np.asarray(w, np.float32)[:TH * SS]
    dampc = np.array(ramp("sand")[3], np.float32)
    rgb = S[..., :3] * (1 - damp[..., None] * 0.6) + dampc * damp[..., None] * 0.6
    rgb = rgb * (1 - a_w[..., None]) + Wt[..., :3] * a_w[..., None]
    rgb = rgb * (1 - foam[..., None]) + np.array((244, 255, 253), np.float32) * foam[..., None]
    out = np.asarray(s).copy(); out[:TH * SS, :, :3] = rgb.astype(np.uint8)
    return Image.fromarray(out, "RGBA")

# edges: water on the NE/SE/SW/NW side of the diamond (u small = up-left NW edge, etc.)
SHORE_EDGES = {
  "n": lambda u, v: 1 - v * 2.2,          # water along top-right edge (v=0)
  "e": lambda u, v: (u - 0.55) * 2.2 + 0.5 if False else u * 2.2 - 1.2,  # bottom-right edge (u=1)
  "s": lambda u, v: v * 2.2 - 1.2,        # bottom-left edge (v=1)
  "w": lambda u, v: 1 - u * 2.2,          # top-left edge (u=0)
}
SHORE_CORNERS = {
  "ne": lambda u, v: 1.3 - np.hypot(u - 1, v) * 2.4,
  "se": lambda u, v: 1.3 - np.hypot(u - 1, v - 1) * 2.4,
  "sw": lambda u, v: 1.3 - np.hypot(u, v - 1) * 2.4,
  "nw": lambda u, v: 1.3 - np.hypot(u, v) * 2.4,
}

def final(img): return downscale(img, (TW, TH + SK))
