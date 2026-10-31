"""Preview scenes for the seasons ground tileset: composes tiles exactly like terrainTiles.ts would with the proposed
overlay pass (variant hash, blob-47 overlays in priority order, shore overlays, ADR-251 water brightness ramp).
python3 ground_preview.py <out dir>  (renders with a worker pool; tile cache in $GROUND_CACHE or /tmp/ground_cache)."""
import os, sys, math, json, hashlib
import numpy as np
from PIL import Image
from multiprocessing import Pool

CACHE = os.environ.get('GROUND_CACHE', '/tmp/ground_cache'); os.makedirs(CACHE, exist_ok=True)
NF = 4
def _fn(key): return os.path.join(CACHE, key.replace('|', '__') + '.png')

def render_key(key):
    from ground_core import out1, out2
    import ground_tiles as G, ground_paint as GP
    p = key.split('|')
    if p[0] == 'base': t = GP.land_tile(p[1], p[2], int(p[3]))
    elif p[0] == 'ov': t = G.land_overlay(p[1], p[2], int(p[3]))
    elif p[0] == 'sh': t = G.shore_overlay(p[1], p[2], int(p[3]), int(p[4]))
    elif p[0] == 'w': t = G.water_tile(p[1], int(p[2]))
    elif p[0] == 'ws': t = G.water_tile(p[1], int(p[2]), shallow=True)   # gt_water_shallow (lighter teal)
    elif p[0] == 'ice': t = G.ice_tile(int(p[1]))
    elif p[0] == 'lv': t = G.water_leaves(int(p[1]))
    elif p[0] == 'side': t = GP.land_side(p[1], p[2])
    elif p[0] == 'sidel': t = GP.land_side(p[1], p[2], False)
    a, b = out1(t), out2(t)
    im = Image.new('RGBA', (64 + 128, 96)); im.paste(a, (0, 0)); im.paste(b, (64, 0)); im.save(_fn(key))
    return key
def ensure(keys, procs=8):
    todo = sorted({k for k in keys if not os.path.exists(_fn(k))})
    if todo:
        with Pool(procs) as pool:
            for i, _ in enumerate(pool.imap_unordered(render_key, todo, chunksize=2)):
                if i % 100 == 0: print('  rendered', i, '/', len(todo), flush=True)
_IM = {}
def get(key, scale):
    k = (key, scale)
    if k not in _IM:
        im = Image.open(_fn(key)).convert('RGBA'); _IM[k] = im.crop((0, 0, 64, 48)) if scale == 1 else im.crop((64, 0, 192, 96))
    return _IM[k]

VARS = 6
def vhash(x, y, n):
    h = ((x * 374761393) & 0xffffffff) ^ ((y * 668265263) & 0xffffffff)
    return (h % 997) % n
PRIO = ['stone', 'sand', 'dirt', 'mud', 'forest', 'grass', 'snow']
DIRS = [(0, -1, 1), (1, 0, 2), (0, 1, 4), (-1, 0, 8), (1, -1, 16), (1, 1, 32), (-1, 1, 64), (-1, -1, 128)]
def reduce(m):
    for c, a, b in ((16, 1, 2), (32, 4, 2), (64, 4, 8), (128, 1, 8)):
        if m & a or m & b: m &= ~c
    return m
def is_water(c): return c in ('water', 'deep', 'shallow')

def tile_layers(M, x, y, season, f):
    """Sprite keys for one cell, bottom to top."""
    H, Wd = M.shape; c = M[y, x]
    def at(xx, yy): return M[min(max(yy, 0), H - 1), min(max(xx, 0), Wd - 1)]
    if is_water(c):
        if season == 'winter': return [f'ice|{vhash(x, y, 6)}']
        L = [f'{"ws" if c == "shallow" else "w"}|{season}|{f}']
        return L
    L = [f'base|{c}|{season}|{vhash(x, y, VARS)}']
    pc = PRIO.index(c)
    for inv in PRIO[pc + 1:]:
        m = 0
        for dx, dy, bit in DIRS:
            if at(x + dx, y + dy) == inv: m |= bit
        m = reduce(m)
        if m: L.append(f'ov|{inv}|{season}|{m}')
    m = 0
    for dx, dy, bit in DIRS:
        if is_water(at(x + dx, y + dy)): m |= bit
    m = reduce(m)
    if m: L.append(f'sh|{"sand" if c == "sand" else "bank"}|{season}|{m}|{0 if season == "winter" else f}')
    return L

def compose(M, season, scale=2, f=0, leaves=None, tints=None):
    H, Wd = M.shape; s = scale
    Wpx = (Wd + H) * 32 * s; Hpx = (Wd + H) * 16 * s + 48 * s
    img = Image.new('RGBA', (Wpx, Hpx), (0, 0, 0, 0)); ox = H * 32
    if tints is None: tints = water_tints(M)
    for d in range(Wd + H - 1):
        for x in range(max(0, d - H + 1), min(Wd, d + 1)):
            y = d - x; c = M[y, x]; X = ((x - y) * 32 + ox - 32) * s; Y = ((x + y) * 16) * s
            if is_water(c): Y += 4 * s
            for k in tile_layers(M, x, y, season, f):
                im = get(k, s)
                if k.startswith(('w|', 'ws|')): im = tint_tile(im, tints, x, y, s)
                img.alpha_composite(im, (X, Y))
            if leaves is not None and is_water(c) and season == 'fall' and leaves[y, x] >= 0:
                img.alpha_composite(get(f'lv|{leaves[y, x]}', s), (X, Y))
    return img
def water_tints(M):
    H, Wd = M.shape; land = ~np.vectorize(is_water)(M); d = np.where(land, 0, 99)
    for _ in range(8):
        dd = d.copy()
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1): dd = np.minimum(dd, np.roll(np.roll(d, dy, 0), dx, 1) + 1)
        d = dd
    k = np.clip(1 - (d - 1) / 4.0, 0, 1); k[land] = 1; k[M == 'shallow'] = 1   # waterShoreTint: shallow tiles = 1
    kp = np.pad(k, 1, mode='edge'); C = (kp[:-1, :-1] + kp[1:, :-1] + kp[:-1, 1:] + kp[1:, 1:]) / 4   # corner (y, x) grid
    return C
_UV = {}
def tint_tile(im, C, x, y, s):
    import ground_tiles as G
    if s not in _UV:
        h, w = 48 * s, 64 * s; ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
        sx = (xs + .5) / s - 32; sy = (ys + .5) / s - 16; _UV[s] = (np.clip((sx / 32 + sy / 16) / 2 + .5, 0, 1), np.clip((sy / 16 - sx / 32) / 2 + .5, 0, 1))
    u, v = _UV[s]; c00, c10, c01, c11 = C[y, x], C[y, x + 1], C[y + 1, x], C[y + 1, x + 1]
    k = (c00 * (1 - u) + c10 * u) * (1 - v) + (c01 * (1 - u) + c11 * u) * v
    a = np.asarray(im).copy(); a[..., :3] = G.shade(a[..., :3], k); return Image.fromarray(a, 'RGBA')   # ADR-251 brightness ramp

def all_keys(M, season, leaves=None, frames=(0,)):
    ks = set(); H, Wd = M.shape
    for y in range(H):
        for x in range(Wd):
            for f in frames: ks.update(tile_layers(M, x, y, season, f))
            if leaves is not None and season == 'fall' and leaves[y, x] >= 0: ks.add(f'lv|{leaves[y, x]}')
    return ks

# ---- grading (assets/survival_fx/daynight_grading.json keyframes) --------------------------------------------------------
GRADE = {'day': dict(amb=(1.02, 1.0, .97), sat=1.08), 'golden': dict(amb=(1.0, .76, .62), sat=1.05),
         'dusk': dict(amb=(.72, .52, .7), sat=1.0, lift=(.035, .01, .055), gain=(1.02, .92, 1.04)),
         'night': dict(amb=(.43, .41, .7), sat=.92, lift=(.03, .018, .065), gain=(.97, .95, 1.08))}
def grade(img, mode, bg=(34, 28, 46)):
    g = GRADE[mode]; a = np.asarray(img.convert('RGBA')).astype(np.float32) / 255; c = a[..., :3]
    o = c * np.array(g['amb']); lum = (o * [.299, .587, .114]).sum(-1, keepdims=True); o = lum + (o - lum) * g['sat']
    o = o * np.array(g.get('gain', (1, 1, 1))) + np.array(g.get('lift', (0, 0, 0)))
    if mode == 'night':   # composite nightMinBrightness 0.3 toward nightTint
        l0 = (c * [.299, .587, .114]).sum(-1, keepdims=True); o = np.maximum(o, l0 * .3 * np.array([.55, .55, .8]) / .633 + 0 * o)
    out = np.dstack([np.clip(o, 0, 1), a[..., 3:]]); im = Image.fromarray((out * 255 + .5).astype(np.uint8), 'RGBA')
    b = Image.new('RGBA', im.size, bg + (255,)); b.alpha_composite(im); return b

def crop_diamond_rect(img, M, scale):
    """Axis-aligned rect inscribed in the iso map (no ragged edges)."""
    n = min(M.shape); s = scale
    return img.crop((n * 16 * s, n * 8 * s + 8 * s, n * 48 * s, n * 24 * s))
