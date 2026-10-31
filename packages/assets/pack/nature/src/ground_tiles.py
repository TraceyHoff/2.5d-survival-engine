"""Seasons ground: transition overlays (blob-47), shores, water/ice, floating leaves. Mask bits follow the decal autotile
convention (packages/assets/src/manifest.ts): N=1 (-y, v=0), E=2 (+x, u=1), S=4 (+y, v=1), W=8 (-x, u=0),
NE=16, SE=32, SW=64, NW=128; a corner bit only counts when neither of its edges is set (blob-47 reduction)."""
import math
import numpy as np
from ground_core import *
from ground_mats import *
from ground_paint import PAINT, land_tile, SEED

N, E, S, W, NE, SE, SW, NW = 1, 2, 4, 8, 16, 32, 64, 128
CORNERS = {NE: (N, E, (1., 0.)), SE: (S, E, (1., 1.)), SW: (S, W, (0., 1.)), NW: (N, W, (0., 0.))}
def reduce(m):
    for c, (a, b, _) in CORNERS.items():
        if m & a or m & b: m &= ~c
    return m
BLOB47 = sorted({reduce(m) for m in range(256)})
assert len(BLOB47) == 47
PRIORITY = ['stone', 'sand', 'dirt', 'mud', 'forest', 'grass', 'snow']      # later invades earlier
INVADERS = PRIORITY[1:]

D = 0.5   # fringe falloff: band depth ~ D/2 uv
def fringe(m, u=U, v=V):
    """Union field of the set edges/corners in [0,1]; shared by every overlay so neighbouring cells meet."""
    uc, vc = np.clip(u, 0, 1), np.clip(v, 0, 1); I = np.zeros(np.shape(u))
    for bit, d in ((N, vc), (E, 1 - uc), (S, 1 - vc), (W, uc)):
        if m & bit: I = np.maximum(I, 1 - d / D)
    for c, (_, _, (cu, cv)) in CORNERS.items():
        if m & c: I = np.maximum(I, 1 - np.hypot(uc - cu, vc - cv) / D)
    return I
WOB = {'sand': (.5, ((2, .4), (5, .35), (11, .25))), 'dirt': (.66, ((2, .4), (6, .3), (14, .3))), 'mud': (.56, ((2, .45), (4, .35), (9, .2))),
       'forest': (.66, ((2, .4), (5, .3), (12, .3))), 'grass': (.62, ((2, .4), (6, .3), (16, .3))), 'snow': (.56, ((2, .45), (3, .35), (7, .2))),
       'water': (.42, ((2, .45), (3, .35), (7, .2)))}
def wob(inv):
    a, o = WOB[inv]; return (fbm(U, V, 4000 + len(inv) * 13 + ord(inv[0]), o) - .5) * a
RIM = {'grass': 1, 'forest': 1, 'dirt': 1, 'mud': 1, 'sand': 1, 'snow': 1}   # soft boundary band: a mid tone, never a dark rim

def land_overlay(inv, season, m):
    t = Tile(); I = fringe(m) + wob(inv); reg = TOP & (I > .5)
    def ok(u, v):
        if min(u, 1 - u, v, 1 - v) < .1: return False
        iu = fringe(m, np.array([u]), np.array([v]))[0]; return iu > .72
    PAINT[inv](season, None, t, reg, ok, .7)
    pal = P[inv][season]['t']; rimc = pal[RIM[inv]]
    if inv == 'grass' and season == 'winter': rimc = P['grass']['winter']['t'][1]
    t.fill(reg & (I < .5 + .065), rimc)
    if inv in ('snow',): t.fill(reg & (I >= .565) & (I < .6), pal[2])          # soft drift lip inside the snow edge
    if inv in ('grass',):   # tufts poking out along the boundary
        rng = np.random.default_rng(m * 7 + SEASONS.index(season)); blade = P['grass'][season]['blade']
        for _ in range(26):
            u, v = rng.uniform(.12, .88, 2); iu = (fringe(m, np.array([u]), np.array([v])) + 0)[0]
            if .45 < iu < .62: tuft(t, u, v, blade, h=rng.uniform(2.6, 3.6), n=3, seed=int(rng.integers(1e6)), spread=1.6)
    return t.finish(TOP & (np.asarray(t.alpha)))

# ---- water ----------------------------------------------------------------------------------------------------------------
# ADR-251: the gt_water shader path (terrainTiles.ts, art == 1) uses the baked colour directly: no tint palette, no detail
# term; shore -> deep is only a brightness ramp c * mix(0.80, 1.06, k) + a +-0.035 shimmer. So the art carries full colour.
# Solid cel bands (trough / mid / lite / ripple / spark), tuned so x0.80 (open deep) .. x1.06 (shore) stays cute and
# saturated without clipping (see ground_water_fullcolour preview: day / dusk / night through the graded ADR-251 path).
WGREY = {'trough': '#5e5e5e', 'mid': '#737373', 'lite': '#8c8c8c', 'ripple': '#a6a6a6', 'spark': '#ebebeb'}   # legacy grey (tint() reference)
WCOL = {'trough': '#2378a8', 'mid': '#2b8dba', 'lite': '#3aa2c8', 'ripple': '#82d2e2', 'spark': '#e4f9ff'}     # gt_water: deep teal-blue
WSHAL = {'trough': '#33a0b6', 'mid': '#3dabc0', 'lite': '#50bccb', 'ripple': '#96e2e6', 'spark': '#f0fffd'}    # gt_water_shallow: lighter teal
SHORE_K = 1.06   # the shader's shallow end (k = 1 next to land): shore-overlay water is baked at this brightness so it meets the tile
def _mul(c, k): return '#%02x%02x%02x' % tuple(min(255, int(round(x * k))) for x in hx(c))
WSHORE = {k: _mul(v, SHORE_K) for k, v in WSHAL.items()}   # shore / bank overlays sit next to the shallow ring (generator: tile 8)
def water_art(t, mask, f, nf=4, pal=None):
    pal = pal or WCOL; ph = f / nf
    F = fbm(U + ph, V + ph * .5, 7001, ((6, .55), (12, .45)))
    G = fbm(U - ph * .5, V + ph, 7002, ((5, .5), (10, .5)))
    t.fill(mask, pal['mid']); t.fill(mask & (F < .38), pal['trough']); t.fill(mask & (F > .62), pal['lite'])
    rip = np.abs(G - .5) < .018; t.fill(mask & rip & (F > .42), pal['ripple'])
    sp = vn(U + ph * 2, V, 18, 7003 + f) > .955; t.fill(mask & sp & (F > .5), pal['spark'])
def tint(rgb, k):
    """Legacy terrainTiles.ts grey tile_water recolour (not used for gt_water since ADR-251): k=1 shallow, k=0 deep."""
    c = rgb.astype(np.float32) / 255; lum = (c * [.299, .587, .114]).sum(-1, keepdims=True); det = c - lum
    deep = np.array([.09, .27, .56]) + det * .7 + (lum - .45) * .35
    sh = np.array([.36, .82, .82]) + det * .6 + (lum - .45) * .4
    k = np.asarray(k, np.float32)[..., None] if np.ndim(k) else k
    return (np.clip(deep * (1 - k) + sh * k, 0, 1) * 255 + .5).astype(np.uint8)
def shade(rgb, k):
    """ADR-251 gt_water shader on the CPU (no shimmer): c * mix(0.80, 1.06, smoothstep(k))."""
    k = np.asarray(k, np.float32); k = k * k * (3 - 2 * k); m = .80 + (1.06 - .80) * k
    m = m[..., None] if np.ndim(m) else m
    return (np.clip(rgb.astype(np.float32) / 255 * m, 0, 1) * 255 + .5).astype(np.uint8)
def water_tile(season, f, shallow=False):
    t = Tile()
    if season == 'winter': ice_art(t, TOP, 0)
    else: water_art(t, TOP, f, pal=WSHAL if shallow else WCOL)
    return t.finish(TOP)
ICE = ['#f4fbff', '#d6eef8', '#b4dcef', '#8cc0e0', '#6a9cc8']
def ice_art(t, mask, var):
    """Calm frozen surface: shared fine frost specks, per-variant clear (darker) and frosted (lighter) islands, a few cracks."""
    Ff = fine(7101); vv = 0 if var is None else var
    t.fill(mask, ICE[2]); t.fill(mask & (Ff > .69), ICE[1]); t.fill(mask & (Ff < .3), ICE[3])
    if var is None: return
    Pc = patches(var, 7120, [2, 1, 3, 1, 2, 0][vv % 6], (.07, .15)); Pf = patches(var, 7130, [1, 3, 1, 2, 0, 2][vv % 6], (.06, .13))
    cl = mask & (Pc > .5); t.fill(cl, ICE[3]); t.fill(cl & np.roll(~cl, R(1), 0), ICE[1]); t.fill(cl & (Pc > .8) & (Ff > .55), ICE[1])
    fr = mask & (Pf > .5) & ~cl; t.fill(fr, ICE[1]); t.fill(fr & (Pf > .75), ICE[0])
    rng = np.random.default_rng(7110 + var)
    for k in range([1, 2, 0, 1, 2, 1][vv % 6]):
        u, v = rng.uniform(.3, .7, 2); crack(t, u, v, rng.uniform(.12, .2), ICE[4], int(rng.integers(1e6)), int(rng.integers(1, 3)))
    for k in range(int(rng.integers(1, 4))):
        u, v = rng.uniform(.2, .8, 2); x, y = to_px(u, v); t.ellipse(x, y, R(.6), R(.4), '#ffffff')
def ice_tile(var):
    t = Tile(); ice_art(t, TOP, var); return t.finish(TOP)

BANK = {'sand': {'summer': ['#d8bc86', '#c4a070'], 'fall': ['#d0b482', '#ba986c'], 'winter': ['#cfc4ae', '#b4a68e']},
        'bank': {'summer': ['#b08c64', '#a07e5a'], 'fall': ['#a8865e', '#9a7a56'], 'winter': ['#d4e0f0', '#a8b8d6']}}
def shore_overlay(style, season, m, f, nf=4):
    """Water invading land. Water baked in the shallow palette at the shader's shore brightness (SHORE_K) so it meets the
    gt_water / gt_water_shallow tiles; foam laps per frame."""
    t = Tile(); I = fringe(m) + wob('water')
    lap = .5 + .022 * math.sin(6.2832 * f / nf)
    bank = TOP & (I > .5 - .085) & (I <= lap); wat = TOP & (I > lap)
    b = BANK[style][season]; t.fill(bank, b[0]); t.fill(bank & (I > .5 - .03), b[1])   # damp band toward the water (close tone: no dark rim)
    if season == 'winter':
        ice_art(t, wat, None); t.fill(wat & (I < lap + .05), '#ffffff'); t.fill(wat & (I >= lap + .05) & (I < lap + .07), ICE[1])
        fm = (RFACE if m & E else np.zeros_like(TOP)) | (LFACE if m & S else np.zeros_like(TOP))
        if fm.any(): ice_art(t, fm, None)
        return t.finish(t.alpha)
    water_art(t, wat, f, nf, WSHORE)   # full colour at the shader's shore brightness (ADR-251)
    foam = wat & (I < lap + .045); t.fill(foam, '#f4ffff')
    # skirt faces toward the water neighbour: the land rim drops into water, so the visible strip reads as water too
    fm = np.zeros_like(TOP)
    if m & E: fm |= RFACE
    if m & S: fm |= LFACE
    if fm.any():
        water_art(t, fm, f, nf, WSHORE)
    f2 = .5 + .11 + .02 * math.sin(6.2832 * f / nf + 1.7)
    l2 = wat & (np.abs(I - f2) < .012) & (vn(U, V, 10, 7201) > .4); t.fill(l2, '#d2fbfa')
    return t.finish(t.alpha)

LEAFC = ['#f4a74a', '#e07a3a', '#f0c24c', '#c8503c']
def water_leaves(var):
    """Fall decal over water (drawn after the water tint): a few floating leaves + ripple rings."""
    t = Tile(); rng = np.random.default_rng(7300 + var); sc = Scatter(7300 + var, .16)
    for (u, v) in sc.take(int(rng.integers(2, 5)), .16):
        x, y = to_px(u, v); t.ellipse(x, y + R(.4), R(3), R(1.4), '#bff7f4'); t.ellipse(x, y + R(.4), R(2.4), R(1.0), '#5cd1d1')
        leaf(t, u, v, rng.uniform(1.5, 2.1), LEAFC[int(rng.integers(4))], '#8a3e2e', rng.uniform(0, 6.3))
    return t.finish(TOP & t.alpha)
