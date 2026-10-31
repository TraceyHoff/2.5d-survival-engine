"""Seasons ground materials: palettes per season, base fields, decorations and skirts (see ground_core for the seamless rule)."""
import math
import numpy as np
from ground_core import *

SEASONS = ('summer', 'fall', 'winter')
OUTL = '#3b2433'

# ---- palettes: t0 highlight, t1 mid (dominant), t2 shade, t3 deep (cracks, specks, feature outlines) ----------------------
P = {
 'grass': {
  'summer': dict(t=['#b4e46e', '#8fd15c', '#72bd50', '#4f9a48'], blade=['#c4ec7a', '#64b04c', '#3f8a47'], ol='#3a7542',
                 fl=[('#fffaf0', '#ffd75e'), ('#ff9ec4', '#fff3b0'), ('#ffd75e', '#e8a93a'), ('#93c6ff', '#fffaf0')], clover='#a6dc6a'),
  'fall':   dict(t=['#e2d872', '#c6c257', '#a4a648', '#7c8540'], blade=['#ecd889', '#a8a24c', '#77783a'], ol='#5e5a32',
                 fl=[('#c9a8f0', '#ffd75e'), ('#fffaf0', '#f5c95c')], clover='#d6cd6c',
                 leaves=['#f4a74a', '#e07a3a', '#f0c24c', '#c8503c'], leafol='#8a3e2e'),
  'winter': dict(t=['#cfe0c6', '#a9c29a', '#8fa982', '#6e8a6c'], blade=['#e6dfb4', '#b8a676', '#8a7a58'], ol='#566a5a',
                 snow=['#ffffff', '#eef4fb', '#cdd9ec', '#9fb0cf'], frost='#f2f8ff'),
 },
 'dirt': {
  'summer': dict(t=['#e4b486', '#c99464', '#ab7a50', '#82593e'], peb=['#e4e0d8', '#b8b2b0', '#8a8494'], ol='#5c4034', sprout=['#8fd15c', '#4f9a48']),
  'fall':   dict(t=['#d8a678', '#bc8658', '#9c6a48', '#74503a'], peb=['#e4e0d8', '#b8b2b0', '#8a8494'], ol='#56392f',
                 leaves=['#f4a74a', '#e07a3a', '#f0c24c', '#b8483a'], leafol='#7e3a2c'),
  'winter': dict(t=['#c6ac98', '#a68a76', '#8a705f', '#66524a'], peb=['#e2e6ee', '#b4b8c4', '#868aa0'], ol='#4c3c3c',
                 snow=['#ffffff', '#eef4fb', '#cdd9ec', '#9fb0cf'], frost='#e8eff8'),
 },
 'forest': {
  'summer': dict(t=['#7fb85a', '#5f9c4a', '#4c8444', '#33623c'], soil=['#9a7650', '#7a5a40'], ol='#2a4a34',
                 leaves=['#a8a44c', '#c2924c', '#8a7a3c', '#6f8a40'], leafol='#4a4430', fern=['#7cc055', '#3d7f43']),
  'fall':   dict(t=['#e6a456', '#c98244', '#a8663a', '#7a4a30'], soil=['#9a7050', '#7e5a40'], ol='#5a2e26',
                 leaves=['#f6c84e', '#e8743a', '#c8443a', '#9a6a3a', '#f4a74a'], leafol='#6a2e26', fern=['#c8a050', '#8a6a34']),
  'winter': dict(t=['#ffffff', '#eaf1fa', '#cbd7ea', '#9fb0cf'], soil=['#8a7464', '#6a5850'], ol='#4a5470',
                 leaves=['#a8805a', '#8a6248', '#c49a6a'], leafol='#5a4038', needles=['#4f8a6e', '#2f6052'], twig='#6a4a3c'),
 },
 'sand': {
  'summer': dict(t=['#fff4cc', '#f6dfa4', '#e8c887', '#cfa86c'], ol='#9a7a52', shell=['#ffd6e8', '#ff9ec4', '#d47a96'],
                 peb=['#e4e0d8', '#b8b2b0', '#8a8494'], star=['#ffb070', '#ff8436', '#c8582e']),
  'fall':   dict(t=['#f8ecc4', '#eedb9e', '#dcc184', '#c0a26c'], ol='#8e7250', shell=['#ffe6cc', '#eba98a', '#b87a6a'],
                 peb=['#e4e0d8', '#b8b2b0', '#8a8494'], leaves=['#f4a74a', '#e07a3a', '#f0c24c'], leafol='#8a4a30'),
  'winter': dict(t=['#f4eee0', '#e2d8c0', '#cbbfa4', '#a99c84'], ol='#7a7064', shell=['#f2eef8', '#cfc4dc', '#9a8eae'],
                 peb=['#e2e6ee', '#b4b8c4', '#868aa0'], snow=['#ffffff', '#eef4fb', '#cdd9ec', '#9fb0cf'], frost='#ffffff'),
 },
 'stone': {
  'summer': dict(t=['#dcd8d0', '#b8b2b0', '#9d97a2', '#6f6a80'], ol='#4f4a60', moss=['#a8cc6a', '#7fa856'], lichen='#d8dc8a'),
  'fall':   dict(t=['#d8d2c8', '#b4aca8', '#98909a', '#6c6478'], ol='#4c445a', moss=['#b8b45a', '#8a8a44'], lichen='#f0a24a',
                 leaves=['#f4a74a', '#e07a3a', '#f0c24c'], leafol='#7e3a2c'),
  'winter': dict(t=['#d4d8e2', '#adb2c2', '#9296aa', '#666a84'], ol='#4a4c66', moss=['#8aa08a', '#647a6a'], lichen='#c8d0e0',
                 snow=['#ffffff', '#eef4fb', '#cdd9ec', '#9fb0cf']),
 },
 'mud': {
  'summer': dict(t=['#a98060', '#8c6448', '#74523c', '#553c30'], ol='#3e2c28', wet='#c39c7a', pud=['#d8f0f4', '#9cc8d8', '#6e9cb4'],
                 reed=['#a6c46a', '#6f8a44']),
  'fall':   dict(t=['#a47a5a', '#865e44', '#6e4c38', '#50382e'], ol='#3a2a26', wet='#bc9474', pud=['#f2e2c4', '#b8b4a4', '#7e8a90'],
                 leaves=['#f4a74a', '#d8703a', '#b8483a'], leafol='#5e2e26', reed=['#c8b062', '#8a7a44']),
  'winter': dict(t=['#9e8a7c', '#80695c', '#68544c', '#4c3e3c'], ol='#3a3036', wet='#b8a698', pud=['#ffffff', '#d4ecf6', '#a6cce2', '#7aa4c4'],
                 snow=['#ffffff', '#eef4fb', '#cdd9ec', '#9fb0cf']),
 },
 'snow': {
  'summer': dict(t=['#ffffff', '#eef4fb', '#d6e1f0', '#aebdd8'], ol='#7d8cae', peb=['#d4d8e2', '#a9aebc', '#7f8498'], spark='#ffffff', ice='#cfeaf6'),
  'fall':   dict(t=['#ffffff', '#eef4fb', '#d6e1f0', '#aebdd8'], ol='#7d8cae', peb=['#d4d8e2', '#a9aebc', '#7f8498'], spark='#ffffff', ice='#cfeaf6',
                 leaves=['#e07a3a', '#f0c24c'], leafol='#8a4a30'),
  'winter': dict(t=['#ffffff', '#f2f7fd', '#d4e0f0', '#a8b8d6'], ol='#7486aa', peb=['#d4d8e2', '#a9aebc', '#7f8498'], spark='#ffffff', ice='#cfeaf6'),
 },
}
SIDE = {   # skirt bands top->bottom: lip handled by the material; body t0..t3
 'soil':  {'summer': ['#b08058', '#946644', '#7a5038', '#5c3c2e'], 'fall': ['#a87852', '#8c5e40', '#724a36', '#56382c'],
           'winter': ['#a08878', '#846c60', '#6a564e', '#4e4040']},
 'sand':  {'summer': ['#ecd096', '#d8b47a', '#c09a64', '#9e7c52'], 'fall': ['#e2c890', '#ccac78', '#b29262', '#927652'],
           'winter': ['#dccfb4', '#c4b498', '#a89a82', '#8a7e6c']},
 'rock':  {'summer': ['#aaa4a6', '#8a8494', '#6f6a80', '#575266'], 'fall': ['#a69e9e', '#86808e', '#6c667a', '#545064'],
           'winter': ['#a4a8b8', '#868aa0', '#6c7088', '#54586e']},
}

def fine(seed):
    """Shared high-frequency field (period 1): the only thing every variant has at its edges."""
    return vn(U, V, 8, seed) * .45 + vn(U, V, 16, seed + 1) * .35 + vn(U, V, 32, seed + 2) * .2
def patches(var, seed, n, rr=(.05, .12), margin=.035, sq=1.0):
    """Organic islands fully inside the tile (centre margin >= radius): value > .5 inside an island."""
    if var is None or n <= 0: return np.zeros(U.shape)
    rng = np.random.default_rng(seed * 31 + var * 977 + 5); Pf = np.zeros(U.shape)
    nz = vn(U, V, 12, seed + 3 + var)
    for k in range(n):
        r = rng.uniform(*rr); m = r * 1.25 + margin
        if m >= .5: continue
        cu, cv = rng.uniform(m, 1 - m, 2); el = rng.uniform(.7, 1.3)
        d2 = ((U - cu) / el) ** 2 + ((V - cv) * el) ** 2
        Pf = np.maximum(Pf, np.exp(-d2 / (r * r) * .69) * (.8 + .45 * nz))
    return Pf
def tone(t, mask, pal4, seed, var, n_hi=3, n_sh=3, rr=(.05, .12), lo=.33, hi=.67, lip=False, speck=True):
    """Mid tone dominant; shared fine specks; per-variant highlight / shade islands kept inside the tile."""
    Ff = fine(seed)
    Ph = patches(var, seed + 50, n_hi, rr); Ps = patches(var, seed + 60, n_sh, rr)
    H = mask & (Ph > .5); Sd = mask & (Ps > .5) & ~H
    t.fill(mask, pal4[1]); t.fill(Sd, pal4[2]); t.fill(H, pal4[0])
    if speck:
        t.fill(mask & ~H & ~Sd & (Ff < lo), pal4[2]); t.fill(mask & ~H & ~Sd & (Ff > hi), pal4[0])
        t.fill(Sd & (Ff < lo + .04), pal4[3]); t.fill(H & (Ff < lo + .02), pal4[1])
    if lip:
        sh = np.roll(Ph > .5, -R(1.6), 0); t.fill(mask & sh & ~(Ph > .5), pal4[2])
    return Ff

# ---- decoration painters (screen space at RES; positions given in uv) ------------------------------------------------------
def R(px): return px * RES                      # 1x px -> supersampled
def tuft(t, u, v, cols, h=4.0, n=5, seed=0, w=1.5, spread=2.6):
    rng = np.random.default_rng(seed); bx, by = to_px(u, v)
    t.ellipse(bx, by + R(.3), R(spread * .55 + .6), R(.75), cols[2])
    for k in range(n):
        f = (k / (n - 1) - .5) if n > 1 else 0
        x0 = bx + R(f * spread); lean = f * 1.6 + rng.uniform(-.4, .4); hh = h * (1 - abs(f) * .45) * rng.uniform(.85, 1.1)
        col = cols[1] if k % 2 == 0 else cols[2]
        if abs(f) < .2: col = cols[0]
        t.poly([(x0 - R(w / 2), by), (x0 + R(w / 2), by), (x0 + R(lean), by - R(hh))], col)
def flower(t, u, v, petal, eye, r=1.0, stem=None):
    x, y = to_px(u, v)
    if stem: t.line([(x, y + R(1.2)), (x, y)], stem, R(.6))
    for k in range(5):
        a = 6.2832 * k / 5 - 1.57; t.ellipse(x + math.cos(a) * R(r * .9), y + math.sin(a) * R(r * .6), R(r * .62), R(r * .5), petal)
    t.ellipse(x, y, R(r * .45), R(r * .38), eye)
def pebble(t, u, v, r, cols, ol, seed=0, sq=1.0):
    pts = uv_blob(u, v, r, 14, .22, seed, sq)
    t.poly(grow(pts, R(.55)), ol); t.poly(pts, cols[1])
    t.poly(scale_pts(pts, .62, dx=-R(r * 9), dy=-R(r * 5)), cols[0])
    hl = scale_pts(pts, .3, dx=-R(r * 12), dy=-R(r * 7)); t.poly(hl, mix(cols[0], '#ffffff', .5))
def leaf(t, u, v, size, col, ol, rot, seed=0):
    x, y = to_px(u, v); L = R(size); Wd = L * .42; ca, sa = math.cos(rot), math.sin(rot)
    def P(a, b): return (x + a * ca - b * sa, y + (a * sa + b * ca) * .62)
    shape = [P(-L, 0), P(-L * .4, -Wd), P(L * .35, -Wd * .9), P(L, 0), P(L * .35, Wd * .9), P(-L * .4, Wd)]
    t.poly(grow(shape, R(.45)), ol); t.poly(shape, col)
    t.line([P(-L * .8, 0), P(L * .7, 0)], mix(col, ol, .45), R(.4))
def crack(t, u, v, length, col, seed=0, branches=2):
    rng = np.random.default_rng(seed); a = rng.uniform(0, 6.28); pts = [(u, v)]; cu, cv = u, v
    for k in range(5):
        a += rng.uniform(-.7, .7); cu += math.cos(a) * length / 5; cv += math.sin(a) * length / 5; pts.append((cu, cv))
    t.line([to_px(*p) for p in pts], col, R(.55))
    for b in range(branches):
        i = rng.integers(1, 4); bu, bv = pts[i]; ba = a + rng.choice([-1, 1]) * 1.1
        t.line([to_px(bu, bv), to_px(bu + math.cos(ba) * length * .3, bv + math.sin(ba) * length * .3)], col, R(.45))
def puddle(t, u, v, r, cols, rim, seed=0, sheen=True):
    pts = uv_blob(u, v, r, 20, .25, seed, .8)
    t.poly(grow(pts, R(.6)), rim); t.poly(pts, cols[1])
    t.poly(scale_pts(pts, .7, dy=R(r * 6)), cols[2])
    if sheen:
        x, y = to_px(u - r * .3, v - r * .3); t.line([(x - R(1.2), y), (x + R(1.4), y - R(.4))], cols[0], R(.6))
def mushroom(t, u, v, cap, capd, spot, stem='#f6ead2', s=1.0):
    x, y = to_px(u, v)
    t.ellipse(x, y + R(.4 * s), R(1.6 * s), R(.6 * s), '#4a3a34')
    t.poly([(x - R(.6 * s), y), (x + R(.6 * s), y), (x + R(.5 * s), y - R(2 * s)), (x - R(.5 * s), y - R(2 * s))], stem)
    t.ellipse(x, y - R(2.3 * s), R(1.9 * s), R(1.25 * s), capd); t.ellipse(x - R(.25 * s), y - R(2.6 * s), R(1.6 * s), R(1.0 * s), cap)
    if spot: t.ellipse(x - R(.7 * s), y - R(2.8 * s), R(.4 * s), R(.3 * s), spot); t.ellipse(x + R(.6 * s), y - R(2.5 * s), R(.3 * s), R(.25 * s), spot)
def sparkle(t, u, v, col, s=1.0):
    x, y = to_px(u, v); t.poly([(x - R(1.1 * s), y), (x, y - R(.35 * s)), (x + R(1.1 * s), y), (x, y + R(.35 * s))], col)
    t.poly([(x, y - R(1.1 * s)), (x + R(.3 * s), y), (x, y + R(1.1 * s)), (x - R(.3 * s), y)], col)
def snowpatch(t, u, v, r, snow, seed=0):
    pts = uv_blob(u, v, r, 22, .3, seed, .9)
    t.poly(grow(pts, R(.5)), snow[2]); t.poly(pts, snow[1])
    t.poly(scale_pts(pts, .55, dx=-R(r * 5), dy=-R(r * 3)), snow[0])
def twig(t, u, v, L, col, rot, seed=0):
    x, y = to_px(u, v); ca, sa = math.cos(rot) * R(L), math.sin(rot) * R(L) * .55
    t.line([(x - ca, y - sa), (x + ca, y + sa)], col, R(.7)); t.line([(x + ca * .2, y + sa * .2), (x + ca * .5, y + sa * .5 - R(1))], col, R(.5))

def flat_ok(F_ok):
    return F_ok

# ---- skirts ----------------------------------------------------------------------------------------------------------------
def skirt(t, season, kind, lip=None, lipdepth=2.2, seed=3):
    S = SIDE[kind][season]; faces = LFACE | RFACE
    T = FACE_T; D = FACE_D
    wob = (vn1(T, 8, seed) - .5) * 2.2 + (vn1(T, 24, seed + 1) - .5) * .8
    band = np.clip(((D + wob) / SK * 3.2).astype(int), 0, 3)
    dark = RFACE
    for k in range(4):
        c = S[k] if k < 3 else S[3]
        t.fill(faces & (band == k) & ~dark, c)
        t.fill(faces & (band == k) & dark, mix(c, '#2a1b2e', .16))
    if kind == 'soil':      # embedded pebbles / roots
        st = vn(T * 1.0, D / SK, 10, seed + 4) > .8
        t.fill(faces & st & (D > 4) & (D < 13), S[0])
    if kind == 'rock':
        st = vn(T, D / SK * .6, 6, seed + 5); t.fill(faces & (np.abs(st - .5) < .03), S[3])
    if lip:
        ld = lipdepth + (vn1(T, 14, seed + 2) - .5) * 2.4 + (vn1(T, 40, seed + 3) > .7) * 1.5
        t.fill(faces & (D < ld), lip[1]); t.fill(faces & (D < ld) & (D > ld - .9), lip[2]); t.fill(faces & (D < .9), lip[0])
