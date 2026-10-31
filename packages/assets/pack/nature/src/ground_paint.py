"""Per-material painters: paint(mat, season, var, tile, mask, ok, dens) — var None = shared edge field only (overlays);
ok(u, v) gates decoration placement (overlay regions); dens scales decoration counts."""
import math
import numpy as np
from ground_core import *
from ground_mats import *

SEED = {'grass': 11, 'dirt': 23, 'forest': 37, 'sand': 41, 'stone': 53, 'mud': 67, 'snow': 79}

def _sc(mat, season, var, ok, margin=.13):
    sc = Scatter(SEED[mat] * 1000 + SEASONS.index(season) * 100 + (0 if var is None else var), margin)
    return sc, (ok if ok else (lambda u, v: True))

def p_grass(season, var, t, mask, ok, dens):
    p = P['grass'][season]; sc, ok = _sc('grass', season, var, ok); rng = sc.rng; vv = 0 if var is None else var
    if season == 'winter':
        tone(t, mask, p['t'], 11, var, 2, 2)
        Pn = patches(var, 900, 2, (.08, .12))   # same snow-patch count/size on every variant: one tone, only placement varies
        sn = mask & (Pn > .5); t.fill(sn & ~np.roll(sn, -R(1.2), 0), p['snow'][2]); t.fill(sn & np.roll(sn, -R(1.2), 0), p['snow'][1])
        t.fill(sn & (Pn > .78), p['snow'][0])
        t.fill(mask & (vn(U, V, 22, 13) > .9), p['frost'])
        for (u, v) in sc.take(int(rng.integers(2, 5) * dens), .14, accept=ok):
            tuft(t, u, v, p['blade'], h=rng.uniform(3, 4.6), n=int(rng.integers(3, 6)), seed=int(rng.integers(1e6)))
        for (u, v) in sc.take(int(rng.integers(2, 6) * dens), .08, accept=ok): sparkle(t, u, v, '#ffffff', .8)
        return
    tone(t, mask, p['t'], 11, var, 3, 3, (.07, .1))   # one palette + equal highlight/shade coverage per variant (no hue patchwork); detail varies
    if var is None and dens < .5: return
    kind = vv % 6
    if season == 'summer':
        if kind in (1, 4):   # clover patch
            for (u, v) in sc.take(int(4 * dens), .1, .2, accept=ok):
                for k in range(3):
                    a = k * 2.09 + rng.uniform(0, 1); t.poly(uv_blob(u + math.cos(a) * .025, v + math.sin(a) * .025, .022, 10, .1, k), p['clover'])
        nfl = [1, 3, 0, 6, 2, 4][kind]
        cl = sc.take(1, accept=ok)
        for (cu, cv) in cl:
            for k in range(int(nfl * dens)):
                u, v = cu + rng.normal(0, .09), cv + rng.normal(0, .09)
                if not inside_uv(u, v, .12) or not ok(u, v): continue
                pe, ey = p['fl'][int(rng.integers(len(p['fl'])))] if kind != 3 else p['fl'][k % 2]
                flower(t, u, v, pe, ey, rng.uniform(.8, 1.05))
        if kind == 5 and ok(.55, .5): pebble(t, .55, .5, .04, P['dirt']['summer']['peb'], P['dirt']['summer']['ol'], 5)
    else:   # fall
        for (u, v) in sc.take(int(6 * dens), .07, .11, accept=ok):
            leaf(t, u, v, rng.uniform(1.3, 2.0), p['leaves'][int(rng.integers(4))], p['leafol'], rng.uniform(0, 6.28))
        if kind == 2 and ok(.5, .55): mushroom(t, .5, .55, '#d89a64', '#a8683e', '#f6ead2', s=.9)
        if kind == 4:
            for (u, v) in sc.take(int(3 * dens), .1, accept=ok): flower(t, u, v, *p['fl'][0], r=.85)
    for (u, v) in sc.take(int(rng.integers(1, 4) * dens), .15, .16, accept=ok):
        tuft(t, u, v, p['blade'], h=rng.uniform(3.2, 4.8), n=int(rng.integers(3, 6)), seed=int(rng.integers(1e6)))

def p_dirt(season, var, t, mask, ok, dens):
    p = P['dirt'][season]; sc, ok = _sc('dirt', season, var, ok); rng = sc.rng; vv = 0 if var is None else var
    tone(t, mask, p['t'], 23, var, [2, 3, 2, 1, 3, 2][vv % 6], [2, 2, 3, 3, 1, 2][vv % 6], (.05, .11))
    if var is None and dens < .5: return
    kind = vv % 6
    for (u, v) in sc.take(int([2, 4, 1, 3, 5, 2][kind] * dens), .1, accept=ok):
        pebble(t, u, v, rng.uniform(.018, .034), p['peb'], p['ol'], int(rng.integers(1e6)), rng.uniform(.7, 1))
    if kind in (2, 5):
        for (u, v) in sc.take(1, accept=ok, margin=.3): crack(t, u, v, .22, p['t'][3], int(rng.integers(1e6)))
    if season == 'summer' and kind in (1, 3):
        for (u, v) in sc.take(int(2 * dens), .1, accept=ok): tuft(t, u, v, ['#a6dc6a', '#64b04c', '#3f8a47'], h=2.6, n=3, seed=int(rng.integers(1e6)), spread=1.8)
    if season == 'fall':
        for (u, v) in sc.take(int(rng.integers(1, 5) * dens), .08, accept=ok):
            leaf(t, u, v, rng.uniform(1.2, 1.8), p['leaves'][int(rng.integers(4))], p['leafol'], rng.uniform(0, 6.28))
    if season == 'winter':
        t.fill(mask & (vn(U, V, 26, 29) > .9), p['frost'])
        if var is not None:
            for (u, v) in sc.take(int([1, 2, 0, 1, 3, 2][kind]), .25, .22, accept=ok): snowpatch(t, u, v, rng.uniform(.06, .1), p['snow'], int(rng.integers(1e6)))
        if kind in (0, 3) and var is not None and ok(.5, .5):
            puddle(t, .5, .5, .09, ['#ffffff', '#d4ecf6', '#a6cce2'], p['t'][3], 3)
            crack(t, .5, .5, .1, '#ffffff', 9, 1)

def p_forest(season, var, t, mask, ok, dens):
    p = P['forest'][season]; sc, ok = _sc('forest', season, var, ok); rng = sc.rng; vv = 0 if var is None else var
    tone(t, mask, p['t'], 37, var, 3, 3, (.05, .12))
    soil = patches(var, 310, [3, 2, 4, 2, 3, 1][vv % 6], (.05, .11)); so = mask & (soil > .5)
    if season == 'winter':
        t.fill(so & (soil < .62), p['t'][2]); t.fill(so & (soil > .78), p['soil'][0])
    else: t.fill(so, p['soil'][0]); t.fill(so & (soil > .75), p['soil'][1])
    # leaf litter in the shared field: periodic lattice of leaves so it continues across tiles
    nl = {'summer': 30, 'fall': 60, 'winter': 12}[season]
    for src, (lo_, hi_) in ((np.random.default_rng(3700 + SEASONS.index(season)), (.06, .15)),
                            (np.random.default_rng(3800 + SEASONS.index(season) * 50 + (0 if var is None else var)), (.15, 1))):
        lr = src
        for k in range(nl):
            u, v = lr.random(2); ed = min(u, 1 - u, v, 1 - v)
            if not (lo_ <= ed < hi_) or not ok(u, v): continue
            if var is None and ed >= .15: continue
            if season == 'winter':
                if k % 2: twig(t, u, v, lr.uniform(1.4, 2.4), p['twig'], lr.uniform(0, 3.14))
                else:
                    x, y = to_px(u, v)
                    for j in range(3): t.line([(x, y), (x + R(1.6) * math.cos(j * 1.2 - .4), y + R(.9) * math.sin(j * 1.2 - .4))], p['needles'][j % 2], R(.45))
            else: leaf(t, u, v, lr.uniform(1.2, 2.0), p['leaves'][int(lr.integers(len(p['leaves'])))], p['leafol'], lr.uniform(0, 6.28))
    if var is None and dens < .5: return
    kind = vv % 6
    if season != 'winter' and kind in (1, 4):
        for (u, v) in sc.take(1, margin=.25, accept=ok):   # fern
            x, y = to_px(u, v)
            for j in range(5):
                a = -2.6 + j * .55; L = R(4.2 - abs(j - 2) * .5)
                t.line([(x, y), (x + math.cos(a) * L, y + math.sin(a) * L * .7)], p['fern'][1], R(1.0))
                t.line([(x, y - R(.2)), (x + math.cos(a) * L * .85, y + math.sin(a) * L * .6 - R(.2))], p['fern'][0], R(.6))
    if kind == 5 and season != 'winter':
        for (u, v) in sc.take(int(rng.integers(1, 3)), .08, .2, accept=ok):
            if season == 'summer': mushroom(t, u, v, '#ec5a4d', '#c03d41', '#fffaf0', s=rng.uniform(.8, 1.0))
            else: mushroom(t, u, v, '#e0a868', '#a8683e', None, s=rng.uniform(.8, 1.0))
    if kind in (0, 3):
        for (u, v) in sc.take(1, margin=.2, accept=ok): twig(t, u, v, 3.2, '#6a4632' if season != 'winter' else p['twig'], rng.uniform(0, 3.14))
    if kind == 3:
        for (u, v) in sc.take(1, margin=.22, accept=ok): pebble(t, u, v, .04, ['#cdd0c8', '#9aa094', '#6e7468'], p['ol'], 7)
    if season == 'winter':
        for (u, v) in sc.take(int(4 * dens), .08, accept=ok): sparkle(t, u, v, '#ffffff', .8)
        if kind == 4:   # little bird tracks
            for k in range(4):
                u, v = .3 + k * .1, .4 + k * .06; x, y = to_px(u, v)
                for j in (-1, 0, 1): t.line([(x, y), (x + R(.8 * j), y - R(.8))], p['t'][3], R(.35))

def p_sand(season, var, t, mask, ok, dens):
    p = P['sand'][season]; sc, ok = _sc('sand', season, var, ok); rng = sc.rng; vv = 0 if var is None else var
    tone(t, mask, p['t'], 41, var, 2, 2, (.06, .13))
    rip = np.sin((U * 2 + V * 3) * 6.2832 + fbm(U, V, 412, ((3, 1),)) * 9)      # periodic ripples (integer wave vector)
    t.fill(mask & (rip > .93) & (fbm(U, V, 413, ((4, 1),)) > .45), p['t'][2])
    if var is None and dens < .5: return
    kind = vv % 6
    if kind in (1, 3, 5):
        for (u, v) in sc.take(int((1 + (kind == 3)) * dens), .2, accept=ok):    # shell
            x, y = to_px(u, v); s = rng.uniform(.9, 1.2); c = p['shell']
            t.ellipse(x, y, R(1.8 * s), R(1.2 * s), c[2]); t.ellipse(x, y - R(.15), R(1.45 * s), R(.95 * s), c[1])
            for j in (-1, 0, 1): t.line([(x, y + R(.6 * s)), (x + R(j * .9 * s), y - R(.7 * s))], c[0], R(.35))
    if kind in (0, 2, 4):
        for (u, v) in sc.take(int(rng.integers(1, 4) * dens), .12, accept=ok): pebble(t, u, v, rng.uniform(.016, .03), p['peb'], p['ol'], int(rng.integers(1e6)), .75)
    if kind == 4 and season == 'summer' and ok(.5, .52):
        x, y = to_px(.5, .52); c = p['star']
        for j in range(5):
            a = j * 1.2566 - 1.57; t.line([(x, y), (x + math.cos(a) * R(2.1), y + math.sin(a) * R(1.3))], c[2], R(1.2))
        for j in range(5):
            a = j * 1.2566 - 1.57; t.line([(x, y), (x + math.cos(a) * R(1.8), y + math.sin(a) * R(1.1))], c[1], R(.7))
    if kind == 2 and season != 'winter':
        for (u, v) in sc.take(1, margin=.25, accept=ok): tuft(t, u, v, ['#cfe08a', '#a6b85a', '#7d8a44'] if season == 'summer' else ['#e8d48a', '#c4a85a', '#8e7a44'], h=4.5, n=4, seed=3, spread=2.2)
    if season == 'fall':
        for (u, v) in sc.take(int(rng.integers(0, 3) * dens), .1, accept=ok): leaf(t, u, v, 1.5, p['leaves'][int(rng.integers(3))], p['leafol'], rng.uniform(0, 6.3))
    if season == 'winter':
        t.fill(mask & (vn(U, V, 24, 47) > .91), p['frost'])
        if var is not None:
            for (u, v) in sc.take([1, 0, 2, 1, 1, 2][kind], .25, .22, accept=ok): snowpatch(t, u, v, rng.uniform(.06, .1), p['snow'], int(rng.integers(1e6)))
    for (u, v) in sc.take(int(rng.integers(1, 4) * dens), .1, accept=ok): sparkle(t, u, v, '#ffffff', .6)

def p_stone(season, var, t, mask, ok, dens):
    """Weathered bedrock: island tones + raised bevelled slabs + hairline cracks, all inside the tile."""
    p = P['stone'][season]; sc, ok = _sc('stone', season, var, ok); rng = sc.rng; vv = 0 if var is None else var
    c = p['t']; kind = vv % 6
    tone(t, mask, c, 53, var, [1, 2, 3, 2, 1, 2][vv % 6], [2, 1, 2, 3, 1, 2][vv % 6], (.07, .16))
    if var is None and dens < .5:
        if season == 'winter': t.fill(mask & (fine(57) > .72), p['snow'][1])
        return
    # slabs
    for (u, v) in sc.take([0, 2, 1, 0, 3, 1][kind], .2, .2, accept=ok):
        r = rng.uniform(.07, .11); pts = uv_blob(u, v, r, 9, .18, int(rng.integers(1e6)), .85)
        t.poly(grow(scale_pts(pts, 1.0, dy=R(1.4)), R(.6)), c[3]); t.poly(scale_pts(pts, 1.0, dy=R(1.4)), c[2])
        t.poly(grow(pts, R(.5)), c[3]); t.poly(pts, c[1] if rng.random() < .5 else c[0]); t.poly(scale_pts(pts, .55, dy=-R(.5)), c[0])
        if season == 'winter': t.poly(scale_pts(pts, .8, dy=-R(.6)), p['snow'][1]); t.poly(scale_pts(pts, .5, dy=-R(1)), p['snow'][0])
        elif kind in (1, 3) : t.poly(scale_pts(pts, .45, dy=R(.3)), p['moss'][1])
    for (u, v) in sc.take([1, 0, 2, 1, 0, 1][kind], .2, .14, accept=ok): crack(t, u, v, rng.uniform(.08, .14), c[3], int(rng.integers(1e6)), int(rng.integers(1, 3)))
    if season != 'winter':
        if kind in (1, 3, 5):
            Pm = patches(var, 560, 2, (.04, .08)); mm = mask & (Pm > .5); t.fill(mm, p['moss'][1]); t.fill(mm & (Pm > .7), p['moss'][0])
        if kind in (0, 2, 4):
            Pl = patches(var, 570, 3, (.02, .04)); t.fill(mask & (Pl > .5), p['lichen'])
    else:
        Pn = patches(var, 580, [1, 2, 0, 3, 1, 0][kind], (.06, .14)); sn = mask & (Pn > .5)
        t.fill(sn, p['snow'][1]); t.fill(sn & (Pn > .7), p['snow'][0]); t.fill(sn & ~np.roll(sn, R(1.2), 0), p['snow'][2])
    for (u, v) in sc.take(int(rng.integers(1, 4) * dens), .12, accept=ok): pebble(t, u, v, rng.uniform(.018, .03), c, p['ol'], int(rng.integers(1e6)))
    if season == 'fall':
        for (u, v) in sc.take(int(rng.integers(1, 4) * dens), .1, accept=ok): leaf(t, u, v, 1.5, p['leaves'][int(rng.integers(3))], p['leafol'], rng.uniform(0, 6.3))
    if season == 'summer' and kind == 4:
        for (u, v) in sc.take(1, margin=.25, accept=ok): tuft(t, u, v, ['#b4e46e', '#72bd50', '#4f9a48'], h=3.2, n=4, seed=5, spread=1.8)

def p_mud(season, var, t, mask, ok, dens):
    p = P['mud'][season]; sc, ok = _sc('mud', season, var, ok); rng = sc.rng; vv = 0 if var is None else var
    F = tone(t, mask, p['t'], 67, var, 3, 3, (.05, .12))
    sheen = patches(var, 680, 3, (.03, .06)); t.fill(mask & (sheen > .55), p['wet'])
    if season == 'winter': t.fill(mask & (vn(U, V, 26, 69) > .9), '#e8eff8')
    if var is None and dens < .5: return
    kind = vv % 6
    if kind in (0, 3, 5):
        r = [.11, 0, 0, .14, 0, .07][kind]; m = r * 1.3 + .07
        pu, pv = np.random.default_rng(690 + vv).uniform(m, 1 - m, 2)
        if ok(pu, pv):
            if season == 'winter':
                puddle(t, pu, pv, r, p['pud'][1:], p['t'][3], vv)
                crack(t, pu - .02, pv, r * .9, p['pud'][0], vv + 3, 2); crack(t, pu + .02, pv - .02, r * .7, p['pud'][3], vv + 5, 1)
            else: puddle(t, pu, pv, r, p['pud'], p['t'][3], vv)
    if kind in (1, 4):   # hoof / boot prints
        for k in range(3):
            u, v = .32 + k * .14, .38 + k * .1 + (k % 2) * .06
            if not ok(u, v): continue
            pts = uv_blob(u, v, .03, 12, .1, k, .7, .6); t.poly(grow(pts, R(.4)), p['t'][3]); t.poly(pts, p['t'][2])
    for (u, v) in sc.take(int(rng.integers(1, 4) * dens), .1, accept=ok):
        x, y = to_px(u, v); t.ellipse(x, y, R(.9), R(.6), p['t'][3]); t.ellipse(x - R(.2), y - R(.15), R(.45), R(.3), p['wet'])
    if season == 'summer' and kind in (2, 4):
        for (u, v) in sc.take(1, margin=.25, accept=ok): tuft(t, u, v, [p['reed'][0], p['reed'][1], '#4a6030'], h=5.5, n=4, seed=8, w=1.2, spread=2)
    if season == 'fall':
        for (u, v) in sc.take(int(rng.integers(1, 4) * dens), .1, accept=ok): leaf(t, u, v, 1.5, p['leaves'][int(rng.integers(3))], p['leafol'], rng.uniform(0, 6.3))
    if season == 'winter' and var is not None:
        for (u, v) in sc.take([1, 2, 0, 0, 2, 1][kind], .25, .22, accept=ok): snowpatch(t, u, v, rng.uniform(.05, .08), p['snow'], int(rng.integers(1e6)))

def p_snow(season, var, t, mask, ok, dens):
    p = P['snow'][season]; sc, ok = _sc('snow', season, var, ok); rng = sc.rng; vv = 0 if var is None else var
    F = tone(t, mask, p['t'], 79, var, 4, 1, (.07, .15), lo=.3, hi=.7, lip=True)
    if var is None and dens < .5: return
    kind = vv % 6
    if kind in (1, 4):
        for (u, v) in sc.take(1, margin=.25, accept=ok):   # rock peeking out with a snow cap
            pebble(t, u, v, .055, p['peb'], p['ol'], vv * 3 + 1, .8)
            pts = uv_blob(u - .012, v - .012, .045, 14, .2, vv, .7); t.poly(pts, p['t'][1])
    if kind in (2, 5):
        for k in range(5):   # bunny tracks
            u, v = .28 + k * .1, .62 - k * .06
            if ok(u, v):
                x, y = to_px(u, v); t.ellipse(x, y, R(.7), R(.45), p['t'][3]); t.ellipse(x + R(1.1), y - R(.4), R(.5), R(.35), p['t'][3])
    if kind == 3 and season != 'winter':
        for (u, v) in sc.take(1, margin=.25, accept=ok): tuft(t, u, v, ['#d8e8c8', '#9ab48a', '#6e8a6c'], h=3.5, n=3, seed=2)
    if season == 'fall':
        for (u, v) in sc.take(int(rng.integers(0, 3) * dens), .1, accept=ok): leaf(t, u, v, 1.4, p['leaves'][int(rng.integers(2))], p['leafol'], rng.uniform(0, 6.3))
    for (u, v) in sc.take(int(rng.integers(2, 6) * dens), .08, .1, accept=ok): sparkle(t, u, v, '#ffffff' if kind % 2 else p['ice'], rng.uniform(.6, .9))

PAINT = {'grass': p_grass, 'dirt': p_dirt, 'forest': p_forest, 'sand': p_sand, 'stone': p_stone, 'mud': p_mud, 'snow': p_snow}
SKIRT = {'grass': ('soil', 'grass'), 'dirt': ('soil', 'dirt'), 'forest': ('soil', 'forest'), 'sand': ('sand', 'sand'),
         'stone': ('rock', 'stone'), 'mud': ('soil', 'mud'), 'snow': ('rock', 'snow')}

def land_tile(mat, season, var):
    """Base ground: the top diamond only. No skirt / lip / rim on base frames, so the ground tiles with no visible cell
    edge (a skirt sits right under the diamond in the page, and filtering / downscaled pages bleed it into the edge)."""
    t = Tile(); PAINT[mat](season, var, t, TOP, None, 1.0)
    return t.finish(TOP)
def land_side(mat, season, lipped=True):
    """One height level (16 px) of camera-facing side faces (left = +y face, right = +x face) for a cliff/drop under a
    `mat` top: strata + top-material lip; drawn by the engine only where a neighbour is lower (stack per level)."""
    t = Tile(); kind, lm = SKIRT[mat]; pal = P[lm][season]['t']
    if mat == 'grass' and season == 'winter': lip = [P['grass']['winter']['t'][0], P['grass']['winter']['t'][1], P['grass']['winter']['t'][2]]
    else: lip = [pal[0], pal[1], pal[2]]
    if mat in ('stone',) or not lipped: lip = None   # lip-less = the level(s) below the top one in a multi-level drop
    skirt(t, season, kind, lip, 2.6 if mat in ('grass', 'forest', 'snow') else 1.6, seed=SEED[mat])
    return t.finish(LFACE | RFACE)
