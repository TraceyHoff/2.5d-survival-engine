#!/usr/bin/env python3
"""ADR-239 seasonal art: `<key>_fall` / `<key>_winter` twins (+ tree_pine_winter), winter snow-laden building pieces,
and weather FX (fx_snowflake, fx_blizzard, fx_heat_haze).

Twins are recoloured + snow-capped from the shipped summer frame, so frames, anchors, footprint, sway, building
frames/rotation tables are identical (the loader picks `<key>_<season>` when the registry has it, ADR-239 SeasonArt).
  - cel: foliage is re-banded (1-D k-means on value -> 4 hard bands -> seasonal 4-step ramp), a second ramp on
    low-frequency noise islands for mixed canopies, binary-alpha snow caps (fill + 1 hard shade + soft-ink rim) on
    every upward edge; shadows / outlines untouched.
  - winter: no fruit (berries / apples / acorns are replaced by canopy), frosted canopy, snow caps.
  - buildings: `<piece>_winter` for every roof_* / wall* piece of the 4 tiers: snow blanket on roof planes,
    snow caps on wall tops, cool winter light; building.piece is `<piece>@winter` (tier: `<piece>@tierN~winter`) so the
    piece->sprite index ("first declared wins") keeps the summer art as default.
Atlases: season_* (residency "stream", sprite placeholder = the summer key on its resident sheet).
Re-runnable; run from repo root after pets145.py, then ktx2 / gen_icon_css / lock:ids:pack.
  python3 packages/assets/pack/nature/src/seasons_art.py [--no-manifest]
"""
import json, math, os, sys
import numpy as np
from PIL import Image, ImageDraw

R = 'packages/assets/pack/'
PAD = 2                   # transparent border inside every cell (1x px; x k on the @2x page)
PAGE1 = 1024              # max 1x page side, so the @2x page stays <= 2048
CACHE = os.environ.get('SEASONS_SRC', '/workspace/seasons_final/src_cache')
KS = (1, 2)

def load(p): return json.load(open(p))
def hx(s): s = s.lstrip('#'); return np.array([int(s[i:i + 2], 16) for i in (0, 2, 4)], np.float32)

MAIN = load(R + 'manifest.json')
SEASON_ATLAS = lambda k: k.startswith('season_')
MAIN['atlases'] = [a for a in MAIN['atlases'] if not SEASON_ATLAS(a['key'])]          # re-runnable
MAIN['sprites'] = [s for s in MAIN['sprites'] if not SEASON_ATLAS(s['atlas'])]
AT = {a['key']: a for a in MAIN['atlases']}; SP = {s['key']: s for s in MAIN['sprites']}
_img = {}
def sheet(path):
    if path not in _img: _img[path] = np.array(Image.open(R + path).convert('RGBA'), np.float32)
    return _img[path]
def frame(atlas, i, mask=None):
    a = AT[atlas]; w, h, c = a['frameW'], a['frameH'], a['columns']
    src = sheet(a['image'] if mask is None else a['masks'][mask])
    return src[i // c * h:(i // c + 1) * h, i % c * w:(i % c + 1) * w].copy()
def src(atlas, i, k):
    """summer frame at scale k, re-rendered by seasons_src.py (k=1 is bit-identical to the shipped frame)."""
    p = f'{CACHE}/k{k}/{atlas}__{i}.png'
    if not os.path.exists(p): sys.exit(f'missing {p}: run seasons_src.py {CACHE} first')
    return np.array(Image.open(p).convert('RGBA'), np.float32)
def binary(img):
    """solid cel: binary alpha, RGB 0 under alpha 0 (drops the baked soft contact shadow; the renderer draws its own)."""
    o = img.copy(); m = o[..., 3] >= 128; o[..., 3] = np.where(m, 255, 0); o[~m, :3] = 0; return o

# ------------------------------------------------------------------ noise
def vnoise(h, w, cell, seed):
    rng = np.random.default_rng(seed); gh, gw = h // cell + 2, w // cell + 2
    g = rng.random((gh, gw)).astype(np.float32)
    y = np.arange(h) / cell; x = np.arange(w) / cell
    yi = y.astype(int); xi = x.astype(int); fy = (y - yi)[:, None]; fx = (x - xi)[None, :]
    fy = fy * fy * (3 - 2 * fy); fx = fx * fx * (3 - 2 * fx)
    a = g[yi][:, xi]; b = g[yi][:, xi + 1]; c = g[yi + 1][:, xi]; d = g[yi + 1][:, xi + 1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy
def fbm(h, w, cell, seed, oct=3):
    t = np.zeros((h, w), np.float32); s = 0; amp = 1
    for o in range(oct): t += amp * vnoise(h, w, max(1, cell >> o), seed + o * 7); s += amp; amp *= .5
    return t / s
def hash1(x, seed): return ((np.sin(x * 12.9898 + seed * 78.233) * 43758.5453) % 1 + 1) % 1

# ------------------------------------------------------------------ classification
def hsv(img):
    c = img[..., :3] / 255; mx = c.max(-1); mn = c.min(-1); d = mx - mn + 1e-6
    r, g, b = c[..., 0], c[..., 1], c[..., 2]
    h = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
    s = np.where(mx > 0, (mx - mn) / (mx + 1e-6), 0); return h, s, mx
def classes(img, flower=False):
    h, s, v = hsv(img); op = img[..., 3] > 200
    fol = op & (h >= 55) & (h <= 185) & (s > .16) & (v > .3)
    fruit = op & ((h < 20) | (h > 335)) & (s > .42) & (v > .42)
    petal = np.zeros_like(fol)
    if flower: petal = op & ~fol & (v > .5) & ~((h > 15) & (h < 45) & (v < .7))
    return op, fol, fruit, petal, v
def bands(v, m, k=4):
    """1-D k-means of value inside mask m -> band index 0 (dark) .. k-1 (light)."""
    vals = v[m]
    if vals.size == 0: return np.zeros(v.shape, int)
    c = np.quantile(vals, np.linspace(.1, .9, k))
    for _ in range(12):
        lab = np.argmin(np.abs(vals[:, None] - c[None]), 1)
        for j in range(k):
            if (lab == j).any(): c[j] = vals[lab == j].mean()
    c = np.sort(c); out = np.argmin(np.abs(v[..., None] - c[None, None]), -1); return out

def ramp(p): return np.stack([hx(x) for x in p])
def paint(img, m, rgb): img[m, :3] = rgb[m] if rgb.ndim == 3 else rgb

# ------------------------------------------------------------------ snow
SNOW = hx('#f6faff'); SNOW_SH = hx('#c9d7ee'); SNOW_DEEP = hx('#9fb1d3'); SNOW_INK = hx('#4f5878')
def up_edges(solid, under):
    """pixels of `under` whose pixel above is not solid-under (transparent or an outline/ink row)."""
    above = np.zeros_like(under); above[1:] = under[:-1]
    return under & ~above
def shift_dn(m, d):
    o = np.zeros_like(m); o[d:] = m[:-d]; return o
def shift_up(m, d):
    o = np.zeros_like(m); o[:-d] = m[d:]; return o
def snow_caps(img, surf, seed, thick=(2, 4), ink=True, sc=1):
    """Binary snow caps on every upward edge of `surf` (mask of paintable pixels), thickness lumpy along x.
    sc = render scale: thickness, lump width, hard-shade band and ink rim are sc px per 1x px."""
    H, W = surf.shape; op = img[..., 3] > 200
    edge = up_edges(op, surf)
    x = np.arange(W); t = thick[0] + (thick[1] - thick[0] + .999) * hash1(np.floor(x / (2 * sc)), seed)
    t = np.floor(t).astype(int) * sc
    cap = np.zeros_like(surf)
    ys, xs = np.nonzero(edge)
    for y, xx in zip(ys, xs):
        n = t[xx]
        for d in range(n):
            if y + d < H and surf[y + d, xx]: cap[y + d, xx] = True
            else: break
    cap2 = cap.copy()
    for d in range(1, sc + 1):   # no slivers narrower than one 1x px
        c = np.zeros_like(cap); c[:, d:-d] = cap[:, :-2 * d] & cap[:, 2 * d:]; cap2 |= c & surf
    cap = cap2 & surf
    bottom = np.zeros_like(cap)
    for d in range(1, sc + 1): bottom |= cap & ~shift_up(cap, d)          # lowest sc rows -> one hard shade
    img[cap, :3] = SNOW; img[bottom, :3] = SNOW_SH
    if ink:  # bold soft-ink rim (sc rows) just under the drift
        rim = np.zeros_like(cap)
        for d in range(1, sc + 1): rim |= shift_dn(bottom & ~shift_up(cap, 1), d)
        rim &= surf & ~cap
        img[rim, :3] = img[rim, :3] * .35 + SNOW_INK * .65
    return cap

def cool(img, m, amt):
    g = img[..., :3] @ np.array([.299, .587, .114], np.float32)
    tgt = g[..., None] * (np.array([.93, .98, 1.08], np.float32))
    img[m, :3] = img[m, :3] * (1 - amt) + np.clip(tgt[m], 0, 255) * amt

# ------------------------------------------------------------------ foliage recipes
FALL = {
    'tree':       (['#8e3f26', '#cf6a2c', '#f09a3c', '#ffd27a'], ['#7a2a2a', '#b8402f', '#e0663a', '#f7a463'], .34),
    'tree_apple': (['#856224', '#c39a30', '#e9c447', '#fff09c'], ['#8e4a24', '#c9702e', '#ec9c42', '#ffd27a'], .28),
    'oak_tree':   (['#74282a', '#b0403a', '#dc6a3e', '#f6ab66'], ['#7a4a22', '#b9782e', '#e2a640', '#fbd57c'], .38),
    'bush':       (['#7f4428', '#bb6236', '#e39749', '#f6cd7e'], ['#6c5426', '#a3843a', '#cfae4e', '#efd98a'], .3),
    'berry_bush': (['#5e4c26', '#93773a', '#c4a24c', '#ead58a'], ['#7f4428', '#bb6236', '#e39749', '#f6cd7e'], .3),
    'fiber_grass':(['#80612e', '#b48e44', '#dcbc66', '#f6e4a0'], ['#6f6a2e', '#9e9840', '#c9c25c', '#ece49a'], .35),
    'flowers':    (['#5d5a26', '#8c8236', '#b9ab4c', '#e2d688'], ['#7f4428', '#bb6236', '#e39749', '#f6cd7e'], .25),
}
WINTER = {  # frosted canopy (deciduous) -> cool sage-grey + snow; grass dry tan + frost
    'tree':       ['#3a5560', '#5b7f8a', '#97adbd', '#cfdfea'],
    'tree_apple': ['#3d5660', '#5e808a', '#98abba', '#d0dee8'],
    'oak_tree':   ['#40506a', '#61758e', '#9ea4b8', '#d3d8e6'],
    'bush':       ['#37565c', '#58807f', '#93acb6', '#cddfe6'],
    'berry_bush': ['#3a5560', '#5b7d86', '#97abb8', '#cfdde8'],
    'fiber_grass':['#5e4a34', '#87683f', '#ad8c55', '#d2b77c'],
    'flowers':    ['#6a5c4c', '#937f66', '#bba98c', '#e4dccb'],
    'tree_pine':  ['#1d4646', '#2c655e', '#4a8676', '#7cae9d'],
}
PETAL_WINTER = hx('#e4ecfa'); PETAL_WINTER_SH = hx('#b4c4e2')

FRUITZONE = [None]
SNOWY = {'tree', 'tree_apple', 'oak_tree', 'bush', 'berry_bush'}
def enclosed_bits(img, op, fol, maxpx=90):
    """small non-foliage blobs (fruit, acorns, berries + their ink rings) enclosed by canopy -> canopy in winter."""
    from scipy import ndimage
    other = op & ~fol
    lab, n = ndimage.label(other)
    out = np.zeros_like(fol)
    if n == 0: return out
    sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
    ring = ndimage.binary_dilation(fol, iterations=1)
    for i in range(1, n + 1):
        if sizes[i - 1] > maxpx: continue
        comp = lab == i; border = ndimage.binary_dilation(comp, iterations=1) & ~comp
        if border.any() and (fol[border].mean() > .6) and not (~op[border]).any(): out |= comp
    return out

def recolour(key, src, season, seed, k=1):
    img = src.copy(); H, W = img.shape[:2]
    op, fol, fruit, petal, v = classes(img, flower=key == 'flowers')
    if season == 'winter' and key != 'flowers':
        fruitm = enclosed_bits(img, op, fol, 90 * k * k) | fruit
        v = np.where(fruitm, np.quantile(v[fol], .6) if fol.any() else .7, v)
        fol = fol | fruitm
        FRUITZONE[0] = fruitm
    b = bands(v, fol)
    if season == 'winter' and FRUITZONE[0] is not None and FRUITZONE[0].any():
        from scipy import ndimage   # heal the fruit scars (shadow rings under fruit) with the surrounding canopy band
        z = ndimage.binary_dilation(FRUITZONE[0], iterations=3 * k) & fol
        med = ndimage.median_filter(np.where(fol & ~z, b, -1), size=7 * k)
        med2 = ndimage.median_filter(np.where(fol, b, 0), size=7 * k)
        b = np.where(z, np.where(med >= 0, med, med2), b)
    FRUITZONE[0] = None
    if season == 'fall':
        p1, p2, share = FALL[key]
        r1, r2 = ramp(p1), ramp(p2)
        n = fbm(H, W, (12 if W > 64 * k else 8) * k, seed)
        mixm = n > np.quantile(n[fol], 1 - share) if fol.any() else np.zeros_like(fol)
        col = np.where(mixm[..., None], r2[b], r1[b]); paint(img, fol, col)
        if key == 'flowers':  # petals warm up a touch
            img[petal, :3] = img[petal, :3] * .8 + hx('#f2a24a') * .2
        trunk = op & ~fol & ~fruit & ~petal; img[trunk, :3] = img[trunk, :3] * .94 + hx('#a0603a') * .06
    else:
        r = ramp(WINTER[key])
        if key in SNOWY:  # snow-laden canopy: lit bands are snow, shade bands cool slate
            r = np.stack([r[0], r[1], SNOW_SH, SNOW])
        col = r[b]; paint(img, fol, col)
        rest = op & ~fol
        if key == 'flowers':
            pb = bands(v, petal, 2); pc = np.where((pb == 1)[..., None], PETAL_WINTER, PETAL_WINTER_SH); paint(img, petal, pc)
            rest &= ~petal
        cool(img, rest, .3)
        thick = {'tree_pine': (3, 5), 'fiber_grass': (1, 2), 'flowers': (1, 2), 'bush': (2, 4), 'berry_bush': (2, 4)}.get(key, (3, 6))
        surf = fol | (petal if key == 'flowers' else np.zeros_like(fol))
        snow_caps(img, surf, seed, thick, ink=key not in ('fiber_grass', 'flowers'), sc=k)
    return img

# ------------------------------------------------------------------ buildings
def roof_blanket(img, seed, k=1):
    """snow blanket on a roof piece: the lit (upper-facing) planes, with an eave margin of the roof material kept."""
    H, W = img.shape[:2]; op = img[..., 3] > 200
    g = img[..., :3] @ np.array([.299, .587, .114], np.float32)
    from PIL import ImageFilter
    gb = np.array(Image.fromarray(np.clip(g, 0, 255).astype(np.uint8)).filter(ImageFilter.BoxBlur(3 * k)), np.float32)
    ink = op & (g < 60)
    body = op & ~ink
    if not body.any(): return np.zeros_like(op)
    thr = np.quantile(gb[body], .42)
    plane = body & (gb >= thr)
    # eave margin: drop pixels within 3px above transparent/ink below
    m = plane.copy()
    for d in range(1, 3 * k + 1):
        lower = np.zeros_like(op); lower[:-d] = (~op | ink)[d:]; m &= ~lower
    n = fbm(H, W, 10 * k, seed) ; m &= n > .28           # a few bare patches -> not a flat sticker
    # fill small holes (morph close 1px)
    c = m.copy(); c[1:-1, 1:-1] |= (m[:-2, 1:-1] & m[2:, 1:-1]) | (m[1:-1, :-2] & m[1:-1, 2:]); m = c & body
    return m

def winter_piece(key, src, seed, k=1):
    img = src.copy(); op = img[..., 3] > 200
    g = img[..., :3] @ np.array([.299, .587, .114], np.float32); ink = op & (g < 60)
    cool(img, op & ~ink, .28)
    roof = key.startswith('roof')
    if roof:
        m = roof_blanket(img, seed, k)
        below = np.zeros_like(m); below[:-1] = m[1:]
        bottom = m & ~below; bottom2 = np.zeros_like(m)
        for d in range(1, 2 * k): bottom2 |= shift_up(bottom, d) & m       # 2 (x k) rows of hard shade
        edgeL = m.copy(); edgeL[:, 1:] &= ~m[:, :-1]
        img[m, :3] = SNOW
        n = fbm(*m.shape, 6 * k, seed + 3); img[m & (n > .62), :3] = hx('#e6eefb')  # soft drifts (flat second tone)
        img[bottom | bottom2, :3] = SNOW_SH
        rim = np.zeros_like(m)
        for d in range(1, k + 1): rim |= shift_dn(bottom, d)
        rim &= op & ~m & ~ink
        img[rim, :3] = img[rim, :3] * .4 + SNOW_INK * .6
    body = op & ~ink
    if not roof:  # walls: snow only on the silhouette top (wall-top face), never on plank/stone ledges of the face
        depth = np.cumsum(op, axis=0)  # opaque pixels seen so far from the top, per column
        body = body & (depth <= 9 * k)
    snow_caps(img, body, seed + 11, (3, 6), sc=k)
    return img

# ------------------------------------------------------------------ FX (binary alpha, cel; drawn per scale, never upscaled)
def fx_snowflake(k=1):
    """4 frames of a chunky 6-arm flake (rotating), 32x32 @1x; drawn at 8x and point-sampled to k."""
    out = []
    for f in range(4):
        S = 8; N = 32 * S; im = Image.new('RGBA', (N, N), (0, 0, 0, 0))
        d = ImageDraw.Draw(im); cx = cy = N / 2; a0 = f * math.pi / 12
        def arms(r, w, col, tw):
            for j in range(6):
                a = a0 + j * math.pi / 3; ex, ey = cx + math.cos(a) * r, cy + math.sin(a) * r
                d.line([(cx, cy), (ex, ey)], fill=col, width=w)
                bx, by = cx + math.cos(a) * r * .55, cy + math.sin(a) * r * .55
                for sg in (-1, 1):
                    b = a + sg * .75; d.line([(bx, by), (bx + math.cos(b) * r * .36, by + math.sin(b) * r * .36)], fill=col, width=tw)
                d.ellipse([ex - w * .7, ey - w * .7, ex + w * .7, ey + w * .7], fill=col)
        arms(12.5 * S, int(4.2 * S), (79, 88, 120, 255), int(3.6 * S))       # bold soft ink
        arms(12.5 * S, int(2.2 * S), (246, 250, 255, 255), int(1.8 * S))
        d.ellipse([cx - 3.2 * S, cy - 3.2 * S, cx + 3.2 * S, cy + 3.2 * S], fill=(201, 215, 238, 255))
        d.ellipse([cx - 1.6 * S, cy - 2.2 * S, cx + 0.6 * S, cy - 0.2 * S], fill=(255, 255, 255, 255))
        out.append(downs(im, S // k))
    return out

def downs(im, S):
    a = np.array(im.resize((im.width // S, im.height // S), Image.NEAREST), np.float32)
    a[..., 3] = np.where(a[..., 3] > 127, 255, 0); return a

def _dot(im, x, y, k, col):
    """one 1x 'pixel' at float 1x coords (x, y) drawn as a k x k block at its own k-grid position (wraps)."""
    H, W = im.shape[:2]; X, Y = int(math.floor(x * k)), int(math.floor(y * k))
    for dy in range(k):
        for dx in range(k): im[(Y + dy) % H, (X + dx) % W] = [*col, 255]

def fx_blizzard(k=1):
    """6-frame wind-driven snow gust, 128x64 @1x: streaks + clumps moving right-down (tileable horizontally per frame).
    Streaks are stepped at 1/k px so the @2x page gets smoother diagonals rather than doubled pixels."""
    W, H = 128, 64; frames = []; rng = np.random.default_rng(7)
    parts = [(rng.random() * W, rng.random() * H, rng.integers(0, 3), rng.random()) for _ in range(46)]
    for f in range(6):
        im = np.zeros((H * k, W * k, 4), np.float32)
        for x0, y0, kind, ph in parts:
            x = (x0 + f * W / 6 * 1.0) % W; y = (y0 + f * H / 6 * .5 + math.sin(ph * 6 + f) * 2) % H
            L = 3 + kind * 5
            for tk in range(L * k):
                t = tk / k
                col = SNOW if t < L * .6 else SNOW_SH
                _dot(im, int(x) - t, int(y) - t * .35, k, col)
                if kind == 2 and t < 3: _dot(im, int(x) - t, int(y) - t * .35 + 1, k, SNOW_SH)
            if kind == 0:  # clump
                for dy in (0, 1):
                    for dx in (0, 1): _dot(im, int(x) + dx, int(y) + dy, k, SNOW)
        frames.append(im)
    return frames

def fx_heat_haze(k=1):
    """6-frame heat shimmer, 64x64 @1x: thin rising wavy warm-white strokes (binary alpha, sparse; the renderer blends)."""
    W, H = 64, 64; frames = []
    for f in range(6):
        im = np.zeros((H * k, W * k, 4), np.float32)
        for j, x0 in enumerate((10, 24, 37, 51)):
            for yk in range(6 * k, 58 * k):
                y = yk / k
                if ((int(y) + f * 3 + j * 7) // 9) % 2: continue
                x = x0 + 2.2 * math.sin((y + f * 4) * .32 + j)
                col = hx('#fff3d6') if (int(y) // 3) % 2 else hx('#ffd9a0')
                X = int(round(x * k))
                for dx in range(k): im[yk, X + dx] = [*col, 255]
        frames.append(im)
    return frames

# ------------------------------------------------------------------ packing / manifest
def padded(fr, k, pad=PAD):
    h, w = fr.shape[:2]; p = pad * k
    o = np.zeros((h + 2 * p, w + 2 * p, 4), np.float32); o[p:p + h, p:p + w] = fr; return o
def pad_anchor(anc, fw, fh, pad=PAD):
    if not pad: return dict(anc)
    return {"x": (anc['x'] * fw + pad) / (fw + 2 * pad), "y": (anc['y'] * fh + pad) / (fh + 2 * pad)}

def pack_grid(name, frames, fw, fh, sway=None, pad=PAD):
    """frames: {k: [frame arrays at scale k, unpadded fw*k x fh*k]} -> 1x + @2x pages (cell = frame + PAD each side),
    sway mask (1x layout, sampled by UV for every page). pad=0: the art must already keep a >= PAD px clear border
    (buildings: frameW stays 128 for buildingFrame). Returns the atlas json."""
    cw, ch = fw + 2 * pad, fh + 2 * pad; n = len(frames[1])
    assert cw % 4 == 0 and ch % 4 == 0, (name, cw, ch)
    cols = max(1, min(n, PAGE1 // cw)); rows = math.ceil(n / cols); assert rows * ch <= PAGE1, (name, rows)
    os.makedirs(R + 'atlases', exist_ok=True)
    for k in KS:
        sh = np.zeros((rows * ch * k, cols * cw * k, 4), np.uint8)
        for i, fr in enumerate(frames[k]):
            assert fr.shape[:2] == (fh * k, fw * k), (name, k, fr.shape)
            y, x = i // cols * ch * k, i % cols * cw * k
            cell = np.clip(binary(padded(fr, k, pad)), 0, 255).astype(np.uint8); e = PAD * k; al = cell[..., 3]
            assert not (al[:e].any() or al[-e:].any() or al[:, :e].any() or al[:, -e:].any()), (name, k, i, 'border')
            sh[y:y + ch * k, x:x + cw * k] = cell
        Image.fromarray(sh).save(R + f'atlases/{name}{"" if k == 1 else f"@{k}x"}.png', optimize=True)
    a = {"key": name, "image": f"atlases/{name}.png", "frameW": cw, "frameH": ch, "columns": cols, "rows": rows,
         "pages": [{"scale": k, "image": f"atlases/{name}@{k}x.png"} for k in KS if k != 1]}
    if sway is not None and any(x is not None for x in sway):
        sw = np.zeros((rows * ch, cols * cw, 4), np.uint8)
        for i, m in enumerate(sway):
            if m is None: continue
            y, x = i // cols * ch, i % cols * cw; sw[y:y + ch, x:x + cw] = padded(m, 1, pad).astype(np.uint8)
        Image.fromarray(sw).save(R + f'atlases/{name}_sway.png', optimize=True); a["masks"] = {"sway": f"atlases/{name}_sway.png"}
    a["residency"] = "stream"
    return a

FOLIAGE = ['tree', 'tree_apple', 'oak_tree', 'bush', 'berry_bush', 'fiber_grass', 'flowers']
GROUPS = {'resources': 'season_res', 'resources_tall': 'season_tall', 'resources_huge': 'season_huge'}
BLD = ('buildings', 'buildings_twig', 'buildings_stone', 'buildings_metal')
PER_PAGE = None  # computed per tier from the cell size

def bld_sprites(src_atlas):
    return [s for s in MAIN['sprites'] if s['atlas'] == src_atlas and 'building' in s and (s['key'].startswith('roof') or s['key'].startswith('wall'))]
def sprite_frames(s):
    b = s['building']; f = {x for row in b['frames'] for x in row} | {x for an in s['animations'].values() for x in an['frames']}
    for st in b.get('states', {}).values(): f |= {x for row in st for x in row}
    return f

def build():
    atl, sprites, previews = [], [], {}
    # ---- foliage twins
    per = {}
    for key in FOLIAGE + ['tree_pine']:
        for season in (['winter'] if key == 'tree_pine' else ['fall', 'winter']): per.setdefault(SP[key]['atlas'], []).append((key, season))
    for src_atlas, items in per.items():
        a = AT[src_atlas]; frames = {k: [] for k in KS}; sways, defs = [], []
        for key, season in items:
            s = SP[key]; anims = {}
            for an, ad in s['animations'].items():
                idx = []
                for fi in ad['frames']:
                    si = s['animations']['depleted']['frames'][0] if (key == 'berry_bush' and season == 'winter') else fi  # no berries in winter
                    for k in KS:
                        out = recolour(key, src(src_atlas, si, k), season, seed=sum(map(ord, key)) * 7 + fi, k=k); frames[k].append(out)
                        if k == 1: previews.setdefault(key, {}).setdefault(season, []).append(binary(out))
                        if k == 2: previews.setdefault(key + '@2x', {}).setdefault(season, []).append(binary(out))
                    sways.append(frame(src_atlas, fi, 'sway') if 'sway' in a.get('masks', {}) else None)
                    idx.append(len(frames[1]) - 1)
                anims[an] = {**ad, "frames": idx}
            d = json.loads(json.dumps(s))
            d.update(key=f'{key}_{season}', atlas=GROUPS[src_atlas], anchor=pad_anchor(s['anchor'], a['frameW'], a['frameH']),
                     animations=anims, placeholder=key)
            defs.append((key, d))
        atl.append(pack_grid(GROUPS[src_atlas], frames, a['frameW'], a['frameH'], sways)); sprites += defs
    # ---- buildings winter: one tier -> pages of <= PAGE1 1x px; sprites sharing frames stay on one page
    for src_atlas in BLD:
        a = AT[src_atlas]; keys = bld_sprites(src_atlas); cw, ch = a['frameW'], a['frameH']
        cap = (PAGE1 // cw) * (PAGE1 // ch)
        groups = []                                   # union of sprites with shared frames
        for s in keys:
            fs = sprite_frames(s); hit = [g for g in groups if g[1] & fs]
            for g in hit: groups.remove(g)
            groups.append(([s] + [x for g in hit for x in g[0]], fs.union(*[g[1] for g in hit])))
        pages = []
        for g in groups:                              # first fit, declaration order kept
            for p in pages:
                if len(p[1] | g[1]) <= cap: p[0].extend(g[0]); p[1] |= g[1]; break
            else: pages.append([list(g[0]), set(g[1])])
        tier = src_atlas[len('buildings'):]
        for pi, (pk, pf) in enumerate(pages):
            used = sorted(pf); remap = {f: i for i, f in enumerate(used)}
            name = f'season_bld{tier}_winter_p{pi}'
            owner = {f: next(s['key'] for s in pk if f in sprite_frames(s)) for f in used}
            frames = {k: [winter_piece(owner[f], src(src_atlas, f, k), f, k) for f in used] for k in KS}
            atl.append(pack_grid(name, frames, a['frameW'], a['frameH'], pad=0))
            for s in sorted(pk, key=lambda s: keys.index(s)):
                d = json.loads(json.dumps(s)); d['key'] = s['key'] + '_winter'; d['atlas'] = name; d['placeholder'] = s['key']
                d['anchor'] = pad_anchor(s['anchor'], a['frameW'], a['frameH'], 0)
                for an in d['animations'].values(): an['frames'] = [remap[f] for f in an['frames']]
                b = d['building']; b['frames'] = [[remap[f] for f in row] for row in b['frames']]
                if 'states' in b: b['states'] = {st: [[remap[f] for f in row] for row in v] for st, v in b['states'].items()}
                p = b['piece']; b['piece'] = (p + '~winter') if '@' in p else (p + '@winter')
                sprites.append((s['key'], d))
                i0 = s['animations']['idle']['frames'][0]
                previews.setdefault('bld', {}).setdefault(s['key'], (binary(src(src_atlas, i0, 1)), binary(frames[1][remap[i0]]), binary(frames[2][remap[i0]])))
    # ---- FX
    fx = [('fx_snowflake', fx_snowflake, 32, 32, 8, 0.5), ('fx_blizzard', fx_blizzard, 128, 64, 10, 0.5), ('fx_heat_haze', fx_heat_haze, 64, 64, 8, 0.85)]
    for key, fn, fw, fh, fps, ay in fx:
        frs = {k: fn(k) for k in KS}
        at = pack_grid('season_' + key[3:], frs, fw, fh); atl.append(at)
        sprites.append((None, {"key": key, "category": "vfx", "atlas": at['key'], "anchor": pad_anchor({"x": .5, "y": ay}, fw, fh),
                               "animations": {"idle": {"frames": list(range(len(frs[1]))), "fps": fps, "loop": True}}}))
        previews.setdefault('fx', {})[key] = (frs[1], frs[2])
    return atl, sprites, previews

def merge_manifest(atl, sprites):
    """into pack/manifest.json (the summer keys' manifest, so `placeholder` resolves in-file): each twin right after
    its summer sprite, season atlases after the last summer atlas they derive from, FX at the end."""
    p = R + 'manifest.json'; m = load(p)
    m['atlases'] = [a for a in m['atlases'] if not SEASON_ATLAS(a['key'])]
    m['sprites'] = [s for s in m['sprites'] if not SEASON_ATLAS(s['atlas'])]
    src_of = {'season_res': 'resources', 'season_tall': 'resources_tall', 'season_huge': 'resources_huge'}
    for a in atl:
        base = src_of.get(a['key']) or next((b for b in sorted(BLD, key=len, reverse=True) if a['key'].startswith('season_bld' + b[len('buildings'):] + '_winter')), None)
        keys = [x['key'] for x in m['atlases']]
        if base and base in keys:
            j = keys.index(base) + 1
            while j < len(keys) and m['atlases'][j]['key'].startswith('season_'): j += 1
            m['atlases'].insert(j, a)
        else: m['atlases'].append(a)
    after = {}
    for parent, d in sprites: after.setdefault(parent, []).append(d)
    out = []
    for s in m['sprites']: out.append(s); out += after.pop(s['key'], [])
    out += after.pop(None, []); assert not after, list(after)
    m['sprites'] = out
    with open(p, 'w') as fh: fh.write(json.dumps(m, indent=2, ensure_ascii=False) + '\n')

if __name__ == '__main__':
    atl, sprites, prev = build()
    if '--no-manifest' not in sys.argv: merge_manifest(atl, sprites)
    import pickle; pickle.dump(prev, open('/tmp/seasons_prev.pkl', 'wb'))
    print('atlases', [(a['key'], a['columns'], a['rows'], a['frameW'], a['frameH']) for a in atl]); print('sprites', len(sprites))
