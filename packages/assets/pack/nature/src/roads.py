"""ADR-119 road tiles: road_<path|gravel|paved> + road_<surface>_m0..m15 (auto-connect bits N1 E2 S4 W8, world -y/+x/+y/-x,
i.e. screen up-right / down-right / down-left / up-left edges). Flat 64x32 iso ground decals (anchor = diamond centre).
Seamless by construction: everything is a function of tile-local world coords (u, v) in [0,1)^2 that is periodic with
period 1 (wrapped noise + wrapped pebble/tuft scatter) and the road is a union of capsules whose arms run past the tile
edge, so the signed distance at an edge depends only on the across-road coordinate -> identical on both neighbours.
Coverage is the diamond grown by ~0.7px so adjacent tiles overlap instead of leaving an AA seam. Soft alpha falloff +
grass tufts blend the edges into the terrain grass. Page: nature_roads (64x32 cells, 8 cols, 1x + @2x), resident."""
import os, math
import numpy as np
from PIL import Image
from common import FRAG

SURF = ("path", "gravel", "paved")
W = 0.30          # road half width (tile units)
SS = 4            # supersample over @2x
TW, TH = 64, 32

def _hash(ix, iy, s):
    h = (ix * 374761393 + iy * 668265263 + s * 2147483647) & 0xffffffff
    h = ((h ^ (h >> 13)) * 1274126177) & 0xffffffff
    return (h ^ (h >> 16)) / 4294967296.0

def pnoise(u, v, n, seed):
    """periodic value noise, n cells per tile (wraps at 1)."""
    x, y = u * n, v * n; x0, y0 = np.floor(x), np.floor(y); fx, fy = x - x0, y - y0
    fx, fy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    tab = np.array([[_hash(i, j, seed) for j in range(n)] for i in range(n)])
    i0, j0 = x0.astype(int) % n, y0.astype(int) % n; i1, j1 = (i0 + 1) % n, (j0 + 1) % n
    a, b, c, d = tab[i0, j0], tab[i1, j0], tab[i0, j1], tab[i1, j1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy

def fbm(u, v, seed, octs=((4, .55), (8, .3), (16, .15))):
    return sum(pnoise(u, v, n, seed + k) * a for k, (n, a) in enumerate(octs))

def scatter(n, seed):
    """n x n jittered points per tile (periodic): list of (pu, pv, r01, rnd2)."""
    pts = []
    for i in range(n):
        for j in range(n):
            pts.append(((i + .15 + .7 * _hash(i, j, seed)) / n, (j + .15 + .7 * _hash(i, j, seed + 1)) / n, _hash(i, j, seed + 2), _hash(i, j, seed + 3)))
    return pts

def wrapd(a): return (a + .5) % 1.0 - .5

def seg_d(u, v, ax, ay, bx, by):
    px, py = u - ax, v - ay; dx, dy = bx - ax, by - ay
    t = np.clip((px * dx + py * dy) / (dx * dx + dy * dy), 0, 1)
    return np.hypot(px - t * dx, py - t * dy)

def smin(a, b, k=.07):
    h = np.clip(.5 + .5 * (b - a) / k, 0, 1); return b * (1 - h) + a * h - k * h * (1 - h)

ARMS = {1: (.5, -.6), 2: (1.6, .5), 4: (.5, 1.6), 8: (-.6, .5)}

def road_sdf(u, v, mask):
    d = np.hypot(u - .5, v - .5) - W * (1.08 if mask == 0 else 1.0)
    for bit, (bx, by) in ARMS.items():
        if mask & bit: d = smin(d, seg_d(u, v, .5, .5, bx, by) - W)
    return d

def hexa(h): h = h.lstrip('#'); return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], np.float32)

def grid(scale):
    """pixel centres of the (TW*scale*SS) x (TH*scale*SS) supersampled cell -> (u, v, diamond coverage)."""
    w, h = TW * scale * SS, TH * scale * SS
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    X = (xs + .5) / (scale * SS) - TW / 2; Y = (ys + .5) / (scale * SS) - TH / 2   # 1x px from centre
    a, b = X / (TW / 2), Y / (TH / 2)
    u = (a + b) / 2 + .5; v = (b - a) / 2 + .5
    grow = .7 / 14.31                               # ~0.7 1x-px outward along the diamond normal
    cov = (np.abs(a) + np.abs(b) <= 1 + grow).astype(np.float32)
    return u, v, cov

def shade_surface(surf, u, v, d, mask):
    """rgb + alpha for one surface. d: signed distance (tile units, <0 inside)."""
    wob = (fbm(u, v, 71) - .5) * .05; dd = d + wob
    n1 = fbm(u, v, 11 + SURF.index(surf) * 40); n2 = pnoise(u, v, 32, 23 + SURF.index(surf))
    if surf == "path":
        base = hexa('#c9a26e'); dark = hexa('#9c764c'); lite = hexa('#e2c08c')
        rgb = base[None, None] * (1 - .25 * (n1[..., None] - .5)) + (lite - base) * np.clip(n2 - .62, 0, 1)[..., None] * 1.4
        rim = np.clip((dd + .07) / .07, 0, 1)[..., None]; rgb = rgb * (1 - rim * .35) + dark * rim * .35
        # wheel ruts / footworn centre: lighter worn strip along the arms
        a = np.clip(1 - (-dd) / .9, 0, 1)
        alpha = np.clip(1 - (dd + .02) / .075, 0, 1)
    elif surf == "gravel":
        base = hexa('#b9ad9b'); rgb = base[None, None] * (1 - .18 * (n1[..., None] - .5))
        rim = np.clip((dd + .05) / .05, 0, 1)[..., None]; rgb = rgb * (1 - rim * .25) + hexa('#8a7c68') * rim * .25
        alpha = np.clip(1 - (dd + .01) / .05, 0, 1)
    else:
        base = hexa('#6a6c74'); rgb = base[None, None] * (1 - .14 * (n1[..., None] - .5)) + 18 * (n2[..., None] - .5)
        kerb = ((dd > -.045) & (dd < -.012)).astype(np.float32)[..., None]
        rgb = rgb * (1 - kerb) + hexa('#c9c3b4') * kerb
        edge = np.clip((dd + .012) / .012, 0, 1)[..., None]; rgb = rgb * (1 - edge) + hexa('#8f8a7e') * edge
        alpha = np.clip(1 - (dd - .004) / .02, 0, 1)
    return rgb, alpha

def pebbles(rgb, alpha, u, v, d, n, seed, rmin, rmax, cols, inside=-.01, a_max=1.0):
    for pu, pv, r, q in scatter(n, seed):
        rr = rmin + (rmax - rmin) * r
        du, dv = wrapd(u - pu), wrapd(v - pv)
        sx, sy = du - dv, (du + dv) * .5             # screen units (1 = 32 px @1x): round on screen
        dist = np.hypot(sx, sy)
        m = (dist < rr) & (d < inside)
        if not m.any(): continue
        col = cols[int(q * len(cols)) % len(cols)]
        t = np.clip((sy[m] + sx[m] * .3) / rr * .5 + .5, 0, 1)[..., None]
        c = col * (1.15 - .35 * t); c = np.where((dist[m] > rr * .78)[..., None], col * .8, c)
        rgb[m] = c; alpha[m] = np.maximum(alpha[m], a_max)

def tufts(rgb, alpha, u, v, d, mask, seed):
    """grass tufts straddling the road edge (blend into terrain grass)."""
    g = [hexa('#7fb65a'), hexa('#5f9a46'), hexa('#9ccc6e')]
    for pu, pv, r, q in scatter(7, seed):
        dc = float(road_sdf(np.array([pu]), np.array([pv]), mask)[0])
        if not (-.05 < dc < .03) or r < .3: continue
        du, dv = wrapd(u - pu), wrapd(v - pv)
        sx, sy = du - dv, (du + dv) * .5
        for k in range(3):
            ang = (k - 1) * .55 + (q - .5) * .5; L = .085 + .035 * ((k + int(q * 7)) % 2)
            t = seg_d(sx, sy, 0, 0, math.sin(ang) * L, -math.cos(ang) * L) - .013
            m = t < 0
            if m.any(): rgb[m] = np.minimum(g[(k + int(q * 3)) % 3] * (1 + .2 * np.clip(-sy[m] / L, 0, 1)[..., None]), 255); alpha[m] = 1.0

def tile(surf, mask, scale):
    u, v, cov = grid(scale)
    d = road_sdf(u, v, mask)
    rgb, alpha = shade_surface(surf, u, v, d, mask)
    if surf == "path":
        pebbles(rgb, alpha, u, v, d, 4, 301, .026, .042, [hexa('#d8c9b0'), hexa('#c8b89c'), hexa('#b8a68a')], inside=-.05)
        tufts(rgb, alpha, u, v, d, mask, 401)
    elif surf == "gravel":
        pebbles(rgb, alpha, u, v, d, 8, 311, .024, .036, [hexa('#ddd5c6'), hexa('#c4b8a6'), hexa('#b0a593'), hexa('#e6dece'), hexa('#c8b69a')], inside=-.01)
        pebbles(rgb, alpha, u, v, d, 5, 331, .026, .04, [hexa('#a89c8a'), hexa('#d0c6b4')], inside=-.01)
        tufts(rgb, alpha, u, v, d, mask, 411)
    else:
        # cream centre dashes along each arm (period 0.5 from the tile edge so they meet the neighbour's)
        for bit, (axis, sgn) in {1: ('v', -1), 4: ('v', 1), 2: ('u', 1), 8: ('u', -1)}.items():
            if not mask & bit: continue
            along = (v if axis == 'v' else u); across = (u if axis == 'v' else v)
            side = (along < .5 - W * .2) if sgn < 0 else (along > .5 + W * .2)
            if (mask in (5, 10)): side = np.ones_like(side, bool)
            dash = ((along * 4) % 1.0 < .5) & (np.abs(across - .5) < .015) & side
            rgb[dash] = hexa('#f3e3a6')
        crack = (np.abs(pnoise(u, v, 6, 361) - .5) < .012) & (d < -.06); rgb[crack] = rgb[crack] * .82   # soft hairline cracks
    a = alpha * cov
    w, h = TW * scale, TH * scale
    pm = np.concatenate([rgb * a[..., None], a[..., None] * 255], -1).reshape(h, SS, w, SS, 4).mean((1, 3))
    out = np.zeros_like(pm); al = pm[..., 3:4]
    out[..., :3] = np.where(al > 0, pm[..., :3] / np.maximum(al / 255, 1e-6), 0); out[..., 3:] = al
    return Image.fromarray(np.clip(np.round(out), 0, 255).astype(np.uint8), "RGBA")

def g(b):
    frames = [(s, m) for s in SURF for m in range(16)]
    cols = 8; rows = math.ceil(len(frames) / cols)
    p1 = Image.new("RGBA", (TW * cols, TH * rows)); p2 = Image.new("RGBA", (TW * 2 * cols, TH * 2 * rows)); prev = []
    for i, (s, m) in enumerate(frames):
        x, y = i % cols, i // cols
        i2 = tile(s, m, 2); i1 = tile(s, m, 1)
        p1.alpha_composite(i1, (x * TW, y * TH)); p2.alpha_composite(i2, (x * TW * 2, y * TH * 2)); prev.append((f"road_{s}_m{m}", i2))
    os.makedirs(os.path.join(FRAG, "atlases"), exist_ok=True)
    p1.save(os.path.join(FRAG, "atlases/nature_roads.png"), optimize=True); p2.save(os.path.join(FRAG, "atlases/nature_roads@2x.png"), optimize=True)
    b.atlases.append({"key": "nature_roads", "image": "atlases/nature_roads.png", "frameW": TW, "frameH": TH, "columns": cols, "rows": rows,
                      "pages": [{"scale": 2, "image": "atlases/nature_roads@2x.png"}]})
    an = {"x": 0.5, "y": 0.5}
    for si, s in enumerate(SURF):
        f0 = si * 16
        b.sprites.append({"key": f"road_{s}", "category": "decal", "atlas": "nature_roads", "anchor": an, "animations": {"idle": {"frames": [f0], "fps": 1}},
                          "autotile": {"neighbors": 4, "group": "road", "rules": [{"mask": m, "frame": f0 + m} for m in range(16)] + [{"mask": 0, "care": 0, "frame": f0}]}})
        for m in range(16):
            b.sprites.append({"key": f"road_{s}_m{m}", "category": "decal", "atlas": "nature_roads", "anchor": an, "animations": {"idle": {"frames": [f0 + m], "fps": 1}}})
    b.previews["nature_roads"] = prev

GROUPS = [g]
