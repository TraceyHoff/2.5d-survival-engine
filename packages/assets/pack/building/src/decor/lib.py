"""ADR-112/113 decor build library: iso box pieces (assets/tools toolkit) -> colour frame + tintmask frame at 1x and @2x.

Conventions (same as the building pack): pivot = footprint centre on the ground, 1 tile = 64x32, rotation rows
1 (symmetric, `mirror`) / 2 drawn rows as [r0,r1,r0,r1] (`unique4`, axis pieces) / 4 rows (asymmetric). Damage stages
are not baked per piece: every row is [f,f,f,f] and the shared `bld_crack` overlay shows damage (keeps VRAM down).
Tintmask: R = BuildPiece.paint (primary), G = secondary (pattern/trim); black = untinted. Ramps 'paint'/'paint2' and the
two-tone rug ramps mark those regions; everything else (wood, metal, decor callbacks) is black in the mask.
"""
import os, sys, zlib, math
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../../../../../assets/tools'))
import iso
from palette import RAMPS
from buildings import B, render_boxes, planksH, planksV, flat, cobble, thatch, toon_at, lw_fn
from iso import add_outline, IsoCanvas, tex_planks, tex_flat, tex_cobble
from toon import downscale, SS, noise, Canvas, ellipse_pts, capsule_pts

# tintable ramps (authored desaturated so the palette multiply reads cleanly)
RAMPS.setdefault('paint', ['#ffffff', '#ebe6de', '#c4bcb2', '#948a80'])     # R: primary paint (fabric, painted wood)
RAMPS.setdefault('paint2', ['#f2f0ec', '#cdc8c0', '#a49c92', '#766e66'])    # G: secondary (trim / pattern)
RAMPS.setdefault('rugbase', ['#ffffff', '#efe9df', '#cfc6b8', '#a49a8c'])   # two-tone: tone < 1.6 -> R, else G (pattern)
RAMPS.setdefault('fur_pale', ['#f4e8d4', '#dcc8a8', '#b49a78', '#86704f'])
RAMPS.setdefault('marble', ['#ffffff', '#ece8ea', '#cbc4cc', '#9c94a4'])
RAMPS.setdefault('black_iron', ['#8a90a0', '#5a6070', '#3e4252', '#2a2c38'])
RAMPS.setdefault('enamel', ['#ffffff', '#e8eef0', '#c0ccd4', '#8a9aa8'])
RAMPS.setdefault('silver', ['#ffffff', '#dfe6ee', '#b0bccb', '#7c889c'])
RAMPS.setdefault('hay', ['#fff0a8', '#ecd078', '#c8a650', '#94763a'])
R_RAMPS = {'paint'}; G_RAMPS = {'paint2'}; TWO = {'rugbase': 1.6}
MASK = [False]
_ramp_color = iso.ramp_color
def _mask_ramp(rp, t):
    t = np.asarray(t, np.float32); z = np.zeros(t.shape + (3,), np.float32)
    if rp in TWO: z[..., 0] = np.where(t < TWO[rp], 255, 0); z[..., 1] = 255 - z[..., 0]
    elif rp in R_RAMPS: z[..., 0] = 255
    elif rp in G_RAMPS: z[..., 1] = 255
    return z
iso.ramp_color = lambda rp, t: _mask_ramp(rp, t) if MASK[0] else _ramp_color(rp, t)

# cell classes: (w, h, ox, oy) at 1x; @2x pages are rendered from the same supersampled canvas
CELLS = {'S': (64, 88, 32, 70),      # 1x1 small/low (chairs, stools, tabletop decor)
         'T': (72, 120, 36, 102),    # 1x1 tall (bookcases, clocks, lamps, wall mounts)
         'W': (104, 120, 52, 94),    # 2x1 / 1x2
         'WT': (104, 144, 52, 118),  # 2x1 / 1x2 tall (wardrobes)
         'L': (136, 152, 68, 116),   # 2x2
         'R1': (72, 40, 36, 20), 'R2': (104, 56, 52, 28), 'R4': (136, 72, 68, 36), 'R6': (168, 88, 84, 44)}  # flat (rugs, paths)

def cls_for(fp, tall=False, flat_=False):
    w, h = fp
    if flat_: return {(1, 1): 'R1', (2, 1): 'R2', (1, 2): 'R2', (2, 2): 'R4', (3, 1): 'R4', (3, 2): 'R6'}[(w, h)]
    if (w, h) == (1, 1): return 'T' if tall else 'S'
    if w * h == 2: return 'WT' if tall else 'W'
    return 'L'

def wrap_decor(dec):
    """decor callbacks (toon drawings): drawn normally, in the mask pass composited as black (or role colour)."""
    if not dec: return dec
    out = []
    for d in dec:
        after, fn = d[0], d[1]; role = d[2] if len(d) > 2 else None
        def g(cv, r, m, fn=fn, role=role):
            if not MASK[0]: return fn(cv, r, m)
            tmp = IsoCanvas(cv.w, cv.h, cv.ox, cv.oy, cv.seed); MASK[0] = False; fn(tmp, r, m); MASK[0] = True
            a = tmp.img.getchannel('A'); col = {'R': (255, 0, 0), 'G': (0, 255, 0)}.get(role, (0, 0, 0))
            layer = Image.new('RGBA', a.size, col + (0,)); layer.putalpha(a); cv.img = Image.alpha_composite(cv.img, layer)
        out.append((after, g))
    return out

def render(geom, rot, cls, fp, seed, shadow=True):
    """geom: (boxes, decor). -> ((col1x, col2x), (mask1x, mask2x), clipped)"""
    bx, dec = geom; w, h, ox, oy = CELLS[cls]
    for b in bx:   # thin facings (doors, drawers, trims) get no ink edges: the toolkit inks every edge, so they would show through bodies from behind
        if min(b.v[1] - b.v[0], b.v[3] - b.v[2]) < .035: b.edge = False
    fw, fh = (fp[1], fp[0]) if rot % 2 else fp
    res = []
    for mask in (False, True):
        MASK[0] = mask; _ink = IsoCanvas.ink_edges
        if mask: IsoCanvas.ink_edges = lambda self, *a, **k: None
        try: cv = render_boxes(bx, rot, seed=seed, decor=wrap_decor(dec), cell=(w, h), origin=(ox, oy))
        finally: MASK[0] = False; IsoCanvas.ink_edges = _ink
        res.append(cv)
    img = add_outline(res[0].img, 1.0, seed + rot)
    if shadow:
        sh = IsoCanvas(w, h, ox, oy); sh.ground_shadow(-fw / 2 - .05, fw / 2 + .05, -fh / 2 - .05, fh / 2 + .05); img = Image.alpha_composite(sh.img, img)
    bb = img.getchannel('A').point(lambda a: 255 if a > 90 else 0).getbbox(); clip = bool(bb and (bb[0] <= 0 or bb[1] <= 0 or bb[2] >= img.size[0] or bb[3] >= img.size[1]))
    col = (downscale(img, (w, h)), downscale(img, (2 * w, 2 * h)))
    m = res[1].img; ma = np.asarray(m, np.float32)
    rgb = Image.fromarray((ma[..., :3] * (ma[..., 3:4] / 255.0)).astype(np.uint8), 'RGB')
    msk = tuple(rgb.resize(s, Image.BOX).point(lambda v: 0 if v < 24 else v) for s in ((w, h), (2 * w, 2 * h)))
    return col, msk, clip

# ---------------- textures
def tx_rug(pattern, seed_shift=0):
    """two-tone rug top: base tone ~0.7 (R), pattern tone ~2.2 (G). Normalised uv patterns."""
    def f(w, h, s):
        yy, xx = np.mgrid[0:h, 0:w].astype(np.float32); u = xx / max(1, w - 1); v = yy / max(1, h - 1)
        cu, cv_ = np.abs(u - .5) * 2, np.abs(v - .5) * 2; d = np.maximum(cu, cv_)
        pat = np.zeros_like(u, bool)
        if pattern == 'striped': pat = (np.floor(u * 9) % 2 == 0) & (d < .9)
        elif pattern == 'checker': pat = ((np.floor(u * 6) + np.floor(v * 6 * h / max(1, w) * (w / max(1, h)))) % 2 == 0) & (d < .9)
        elif pattern == 'diamond':
            k = 4; a = (u * k) % 1 - .5; b = (v * k) % 1 - .5; pat = (np.abs(a) + np.abs(b) < .34) & (d < .86)
        elif pattern == 'floral':
            k = 4; a = (u * k) % 1 - .5; b = (v * k) % 1 - .5; r = np.hypot(a, b); th = np.arctan2(b, a)
            pat = ((r < .14 + .1 * np.cos(5 * th)) | (d > .8) & (d < .88)) & (d < .9)
        elif pattern == 'border': pat = ((d > .62) & (d < .74)) | ((d > .82) & (d < .9)) | (cu + cv_ < .35)
        elif pattern == 'tribal':
            z = (np.abs(((u * 5) % 1) - .5) * 2 + cv_ * 1.2) % .5 < .2; pat = (z & (d < .8)) | ((d > .84) & (d < .9))
        elif pattern == 'braided':
            r = np.maximum(cu, cv_); pat = (np.floor(r * 7) % 2 == 0) & (np.sin((u + v) * 40) > -0.3)
        t = np.where(pat, 2.2, 0.7) + np.where(d > .93, .5, 0) + (noise(w, h, SS, s + seed_shift) - .5) * .25
        return t
    return f

def tx_woven(w, h, s):
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    return 1.0 + .35 * np.sin(xx / SS * 2.2) * np.sin(yy / SS * 2.2) + (noise(w, h, SS, s) - .5) * .2

def tx_tile(cell=6):
    def f(w, h, s):
        yy, xx = np.mgrid[0:h, 0:w].astype(np.float32); c = cell * SS
        g = ((xx % c) < SS * .6) | ((yy % c) < SS * .6)
        return np.where(g, 2.4, .8 + (noise(w, h, c, s) - .5) * .5)
    return f

def tx_quilt(w, h, s):
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32); c = 7 * SS
    a = (xx % c) / c - .5; b = (yy % c) / c - .5
    return .5 + 1.6 * (np.abs(a) + np.abs(b)) + (noise(w, h, SS, s) - .5) * .15

def tx_books(w, h, s):
    rng = np.random.default_rng(s); yy, xx = np.mgrid[0:h, 0:w]
    bw = max(2, int(2.2 * SS)); idx = xx // bw; tones = rng.uniform(-.4, 2.2, size=idx.max() + 2)
    return tones[idx] + np.where((xx % bw) < SS * .4, 1.2, 0)

# ---------------- piece registry
class Piece:
    def __init__(s, key, fp, layer, rows, cls, geom, variants, group, shadow=True):
        s.key, s.fp, s.layer, s.rows, s.cls, s.geom, s.variants, s.group, s.shadow = key, fp, layer, rows, cls, geom, variants, group, shadow
REG = {}
def piece(key, fp, layer, rows, variants, group, tall=False, flat_=False, shadow=None):
    """decorator: fn(variant) -> boxes | (boxes, decor)"""
    def deco(fn):
        def geom(v):
            g = fn(v); return g if isinstance(g, tuple) else (g, [])
        REG[key] = Piece(key, tuple(fp), layer, rows, cls_for(fp, tall, flat_), geom, variants, group, (not flat_) if shadow is None else shadow)
        return fn
    return deco

def jobs(groups):
    for k, p in REG.items():
        if p.group not in groups: continue
        for v in p.variants:
            for r in range(p.rows): yield (k, v, r)

def render_job(job):
    k, v, r = job; p = REG[k]; seed = zlib.crc32(f'{k}@{v}'.encode()) % 1000
    return job, render(p.geom(v), r, p.cls, p.fp, seed, p.shadow)

GROUP_ORDER = []   # atlas emission order (stable across commits: groups appended, never reordered)

def emit(man, out, groups, prev=None, workers=None):
    """Render the given groups, write decor atlases (+@2x, +tintmask) and append atlases/sprites to `man`."""
    from concurrent.futures import ProcessPoolExecutor
    js = list(jobs(groups))
    with ProcessPoolExecutor(workers or os.cpu_count()) as ex: R = dict(ex.map(render_job, js, chunksize=2))
    clipped = sorted({f'{k}@{v}' for (k, v, r), x in R.items() if x[2]})
    stats = []
    for g in groups:
        keys = [k for k, p in REG.items() if p.group == g]
        for cls in CELLS:
            ks = [k for k in keys if REG[k].cls == cls]
            if not ks: continue
            w, h, ox, oy = CELLS[cls]; cols = 2048 // (2 * w); maxrows = 2048 // (2 * h)
            per = cols * maxrows; pages = [[]]   # whole pieces per page (a sprite's frames must share one atlas)
            for k in ks:
                fk = [(k, v, r) for v in REG[k].variants for r in range(REG[k].rows)]
                assert len(fk) <= per, k
                if len(pages[-1]) + len(fk) > per: pages.append([])
                pages[-1] += fk
            for n, fr in enumerate(pages):
                akey = f'decor_{g}_{cls.lower()}' + (f'_{n + 1}' if len(pages) > 1 else '')
                rows = (len(fr) + cols - 1) // cols; cols_used = min(cols, len(fr))
                ims = [Image.new(m, (cols_used * w * s, rows * h * s), (0, 0, 0, 0) if m == 'RGBA' else (0, 0, 0)) for s in (1, 2) for m in ('RGBA', 'RGB')]
                idx = {}
                for i, j in enumerate(fr):
                    (c1, c2), (m1, m2), _ = R[j]; x, y = i % cols_used, i // cols_used; idx[j] = i
                    ims[0].paste(c1, (x * w, y * h)); ims[1].paste(m1, (x * w, y * h)); ims[2].paste(c2, (x * w * 2, y * h * 2)); ims[3].paste(m2, (x * w * 2, y * h * 2))
                for im, suf in zip(ims, ('', '.tintmask', '@2x', '.tintmask@2x')): im.save(f'{out}/atlases/{akey}{suf}.png', optimize=True)
                man['atlases'].append({"key": akey, "image": f"atlases/{akey}.png", "frameW": w, "frameH": h, "columns": cols_used, "rows": rows,
                                       "pages": [{"scale": 2, "image": f"atlases/{akey}@2x.png"}], "masks": {"tintmask": f"atlases/{akey}.tintmask.png"}, "residency": "stream"})
                stats.append((akey, ims[0].size, len(fr)))
                anchor = {"x": ox / w, "y": oy / h}
                for k in dict.fromkeys(k for k, _, _ in fr):
                    p = REG[k]
                    for vi, v in enumerate(p.variants):
                        if (k, v, 0) not in idx: continue
                        rr = [[idx[(k, v, r)]] * 4 for r in range(p.rows)]
                        fr4 = rr if p.rows == 1 else (rr + rr if p.rows == 2 else rr)
                        for skey, pc in ([(f'dec_{k}', k)] if vi == 0 else []) + [(f'dec_{k}__{v}', f'{k}@{v}')]:
                            man['sprites'].append({"key": skey, "category": "building", "atlas": akey, "anchor": anchor,
                                                   "animations": {"idle": {"frames": [fr4[0][0]], "fps": 1}},
                                                   "building": {"piece": pc, "footprint": {"w": p.fp[0], "h": p.fp[1]}, "layer": p.layer, "frames": fr4, "crackOverlay": "bld_crack"},
                                                   "rotationArt": "mirror" if p.rows == 1 else "unique4"})
    if prev: contact(R, groups, prev)
    return stats, clipped

def contact(R, groups, prev):
    from PIL import ImageDraw, ImageFont
    os.makedirs(prev, exist_ok=True); font = ImageFont.load_default()
    for g in groups:
        items = [(f'{k}@{v} r{r}', R[(k, v, r)][0][1]) for k, p in REG.items() if p.group == g for v in p.variants for r in range(p.rows)]
        if not items: continue
        cw = max(im.size[0] for _, im in items) + 8; ch = max(im.size[1] for _, im in items) + 20; cols = max(1, 2400 // cw)
        rows = (len(items) + cols - 1) // cols; sheet = Image.new('RGB', (cols * cw, rows * ch), (104, 150, 98)); d = ImageDraw.Draw(sheet)
        for i, (lab, im) in enumerate(items):
            x, y = (i % cols) * cw, (i // cols) * ch; sheet.paste(im, (x + 4 + (cw - 8 - im.size[0]) // 2, y + 4 + (ch - 20 - im.size[1])), im)
            d.text((x + 3, y + ch - 14), lab[:cw // 6], fill=(255, 255, 240), font=font)
        sheet.save(f'{prev}/decor_{g}_2x.png')
