"""Fire / light pieces that only had stand-ins (ADR-110 sprite_fallbacks): campfire, torch_stand, fireplace, wood_stove,
lantern (sprite `dec_lantern`, piece `lantern`: the lantern item already uses the dec_lantern_hanging art).

Animated like the main pack's bonfire/furnace: `animations.idle` = lit loop, `animations.unlit` = cold look, building
frames = the first lit frame ([f,f,f,f], damage via bld_crack) with `states.unlit`. The client's fireFrame() picks
idle/unlit from Fuel.lit, and the free-standing campfire station draws the sprite keyed `campfire` (resolveSprite), so
the keys are the bare piece keys. Bodies are decor/lib box geometry (solid cel, scrappy survivor bits: tin cans, rag
ties, riveted patch plates); flames are toon drawings per frame. An emissive page (flames + glowing coals only) lets
them read at night. Own page `hearth_<cell>` (1x + @2x + tintmask + emissive), `residency: "stream"`.
Called at the end of build.py; standalone: cd src && python3 hearths.py .. [preview_dir]
"""
import math, os, sys, json
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from decor.lib import B, flat, planksH, planksV, cobble, toon_at, ellipse_pts, render, CELLS, RAMPS

RAMPS.setdefault('rust', ['#e8a070', '#b86a44', '#8a4a34', '#5e3328'])
RAMPS.setdefault('char', ['#6a5a52', '#4a3e3a', '#342c2c', '#221c1e'])
RAMPS.setdefault('ash', ['#e6e2dc', '#c4beb8', '#9a948e', '#6e6a68'])
RAMPS.setdefault('tin', ['#f4f8fa', '#c8d2da', '#94a2b0', '#66727f'])
RAMPS.setdefault('ember', ['#fff2b0', '#ffb040', '#e8602a', '#a83420'])
NF = 6   # lit frames per loop

def _flame_poly(cx, by, w, h, ph, k=3, seed=0):
    """flame outline with k tongues swaying with phase ph (0..1)."""
    pts = []; n = 2 * k + 1
    for i in range(n + 1):
        t = i / n; x = cx - w / 2 + w * t
        sway = math.sin(2 * math.pi * (ph + t * .7 + seed * .13)) * w * .12
        if i % 2 == 1:   # tongue tip
            j = (i // 2); lift = .75 + .25 * math.sin(2 * math.pi * (ph * (1 + j % 2) + j * .37 + seed * .21))
            hh = h * (1.0 if j == k // 2 else .7) * lift
            pts.append((x + sway * 1.6, by - hh))
        else:
            hv = h * (.28 + .1 * math.sin(2 * math.pi * (ph + i * .19)))
            pts.append((x + sway, by - (hv if 0 < i < n else h * .18)))
    base = [(cx + w / 2 * math.cos(a), by + w * .16 * math.sin(a)) for a in np.linspace(0, math.pi, 9)]
    return pts + base

def flame_draw(w, h, ph, k=3, seed=0, cy=24):
    def d(c):
        c.part(_flame_poly(16, cy, w, h, ph, k, seed), 'fire', lw=.7, shade=.18, hl=.15)
        c.part(_flame_poly(16, cy, w * .55, h * .55, ph + .3, max(1, k - 1), seed + 1), 'fire', outline=False, flat=True, base_col=(255, 236, 140))
        c.part(ellipse_pts(16, cy - h * .12, w * .14, h * .12), 'fire', outline=False, flat=True, base_col=(255, 252, 220))
    return d

def flame_cb(x, y, z, w, h, ph, k=3, seed=0, size=32):
    return (-1, lambda cv, r, m: toon_at(cv, x, y, z, r, m, flame_draw(w, h, ph, k, seed), size=size))

def ember_cb(x, y, z, ph, n=3, size=32):
    def d(c):
        for i in range(n):
            t = (ph + i / n) % 1; ex = 16 + math.sin(2 * math.pi * (t + i * .3)) * 4 + (i - 1) * 3; ey = 22 - t * 18
            if t < .85: c.part(ellipse_pts(ex, ey, .9, .9, n=8), 'ember', outline=False, flat=True, base_col=(255, 200, 90))
    return (-1, lambda cv, r, m: toon_at(cv, x, y, z, r, m, d, size=size))

# ---------------------------------------------------------------- pieces: fn(state, ph) -> (boxes, decor)
def campfire(st, ph):
    bx, dec = [], []
    R = .3
    for i in range(9):   # stone ring (survivor touch: one stone is a dented tin can)
        a = 2 * math.pi * i / 9 + .2; x, y = R * math.cos(a), R * math.sin(a); s = .065 + .015 * ((i * 7) % 3)
        bx.append(B(x - s, x + s, y - s * .9, y + s * .9, 0, 4 + (i * 5) % 3, 'tin' if i == 6 else 'stone', flat(.1), flat(.1), flat(.1)))
    lw = 'char' if st == 'unlit' else 'wood_dark'
    bx += [B(-.2, .2, -.04, .04, 0, 4, lw, planksH(4), flat(), flat()), B(-.04, .04, -.2, .2, 3, 7, lw, planksV(4), flat(), flat())]
    if st == 'unlit':
        bx.insert(0, B(-.16, .16, -.16, .16, 0, 2, 'ash', flat(.2), flat(.2), flat(.2), edge=False))
        return bx, dec
    bx.insert(0, B(-.15, .15, -.15, .15, 0, 2, 'ember', flat(.3), flat(.3), flat(.3), edge=False))
    dec += [flame_cb(0, 0, 4, 18, 24, ph, 3), ember_cb(0, 0, 22, ph)]
    return bx, dec

def torch_stand(st, ph):
    bx = [B(-.1, .1, -.1, .1, 0, 3, 'stone', flat(.1), flat(.1), flat(.1)),            # rock footing
          B(-.035, .035, -.035, .035, 0, 46, 'wood_dark', flat(), planksV(3), planksV(3)),
          B(-.05, .05, -.05, .05, 30, 33, 'cloth_red', flat(.05), flat(.05), flat(.05)),   # rag tie
          B(-.07, .07, -.07, .07, 44, 52, 'tin', flat(.05), flat(.08), flat(.08)),          # tin-can cup
          B(-.075, .075, -.075, .075, 51, 52, 'rust', flat(.05), flat(.05), flat(.05))]
    if st == 'unlit': return bx + [B(-.05, .05, -.05, .05, 52, 54, 'char', flat(), flat(), flat())], []
    return bx + [B(-.05, .05, -.05, .05, 52, 53, 'ember', flat(), flat(), flat(), edge=False)], [flame_cb(0, 0, 52, 11, 18, ph, 2), ember_cb(0, 0, 66, ph, 2)]

def fireplace(st, ph):
    H = 44   # front = +y (the camera-facing side at rot 0)
    bx = [B(-.8, .8, -.18, .24, 0, 3, 'stone', cobble(5), cobble(5), cobble(5)),                 # hearth slab
          B(-.75, -.34, -.2, .14, 3, H, 'stone', cobble(6), cobble(6), cobble(6)),              # left jamb
          B(.34, .75, -.2, .14, 3, H, 'stone', cobble(6), cobble(6), cobble(6)),                # right jamb
          B(-.34, .34, -.2, -.08, 3, H, 'char', flat(.1), flat(.1), flat(.1)),                  # firebox back (recessed)
          B(-.82, .82, -.22, .2, H, H + 4, 'wood_dark', planksH(5), planksH(4), planksH(4)),     # mantel beam
          B(-.6, .6, -.2, .06, H + 4, H + 30, 'brick', cobble(4), cobble(4), cobble(4)),        # chimney breast
          B(-.3, .3, -.2, -.02, H + 30, H + 46, 'brick', cobble(4), cobble(4), cobble(4)),
          B(-.6, -.48, .07, .17, H + 4, H + 12, 'tin', flat(.05), flat(.08), flat(.08)),        # tin can on the mantel
          B(.46, .52, .1, .16, H + 4, H + 10, 'snow', flat(.05), flat(.05), flat(.05)),         # stub candle
          B(.14, .3, .08, .16, H + 4, H + 6, 'rust', flat(.05), flat(.05), flat(.05)),          # a spare plate
          B(-.04, .04, .14, .15, H - 14, H, 'black_iron', edge=False),                          # pot hook
          B(-.1, .1, .05, .2, H - 22, H - 14, 'black_iron', flat(.05), flat(.08), flat(.08))]   # hanging billy can
    lw = 'char' if st == 'unlit' else 'wood_dark'
    bx += [B(-.24, .24, -.06, .04, 3, 7, lw, planksH(4), flat(), flat()), B(-.16, .2, -.04, .08, 7, 10, lw, planksH(4), flat(), flat())]
    if st == 'unlit': return [B(-.3, .3, -.08, .12, 3, 4, 'ash', flat(.2), flat(.2), flat(.2), edge=False)] + bx, []
    bx = [B(-.3, .3, -.08, .12, 3, 4, 'ember', flat(.3), flat(.3), flat(.3), edge=False)] + bx
    return bx, [flame_cb(-.08, .02, 8, 14, 18, ph, 3), flame_cb(.14, .02, 8, 10, 13, ph + .4, 2, seed=2)]

def wood_stove(st, ph):
    bx = [B(-.22, .22, -.22, .22, 0, 3, 'rust', flat(.05), flat(.05), flat(.05)),          # scrap plate base
          B(-.17, -.12, -.17, -.12, 3, 8, 'black_iron'), B(.12, .17, -.17, -.12, 3, 8, 'black_iron'),
          B(-.17, -.12, .12, .17, 3, 8, 'black_iron'), B(.12, .17, .12, .17, 3, 8, 'black_iron'),
          B(-.2, .2, -.2, .2, 8, 28, 'black_iron', flat(.08), flat(.1), flat(.1)),       # drum body
          B(-.22, .22, -.22, .22, 28, 31, 'black_iron', flat(.05), flat(.05), flat(.05)),  # cooktop lip
          B(.2, .215, -.16, .02, 15, 25, 'rust', flat(.1), flat(.1), flat(.1), edge=False),  # riveted patch plate (+x side)
          B(-.12, .12, .2, .215, 11, 23, 'char' if st == 'unlit' else 'ember', flat(.2), flat(.2), flat(.2), edge=False),  # door window (+y front)
          B(-.14, .14, .215, .23, 10, 11.5, 'black_iron', edge=False), B(-.14, .14, .215, .23, 22.5, 24, 'black_iron', edge=False),
          B(.13, .14, .215, .235, 15, 19, 'gold', edge=False),                              # latch
          B(-.1, -.02, -.12, -.04, 31, 60, 'tin', flat(.05), flat(.08), flat(.08)),         # stovepipe
          B(-.12, 0, -.14, -.02, 44, 46, 'rust'),                                           # pipe collar
          B(.02, .14, .0, .12, 31, 37, 'tin', flat(.05), flat(.08), flat(.08))]             # kettle can on top
    if st == 'unlit': return bx, []
    return bx, [ember_cb(-.06, -.08, 60, ph, 2)]

def lantern(st, ph):
    """ground hurricane lantern: tin base, back glass panes, wire cage + bail handle, a rag knotted on the handle."""
    bx = [B(-.13, .13, -.13, .13, 0, 4, 'tin', flat(.05), flat(.08), flat(.08)),
          B(-.11, .11, -.11, .11, 4, 6, 'rust', flat(.05), flat(.05), flat(.05)),
          B(-.08, .08, -.09, -.08, 6, 18, 'glass', edge=False), B(-.09, -.08, -.08, .08, 6, 18, 'glass', edge=False),
          B(-.03, .03, -.03, .03, 6, 9, 'gold', edge=False),   # burner
          B(-.1, -.08, -.1, -.08, 4, 20, 'black_iron', edge=False), B(.08, .1, .08, .1, 4, 20, 'black_iron', edge=False),
          B(-.1, -.08, .08, .1, 4, 20, 'black_iron', edge=False), B(.08, .1, -.1, -.08, 4, 20, 'black_iron', edge=False),
          B(-.11, .11, -.11, .11, 18, 21, 'tin', flat(.05), flat(.08), flat(.08)),
          B(-.05, .05, -.05, .05, 21, 24, 'tin', flat(.05), flat(.08), flat(.08)),
          B(-.12, -.1, -.01, .01, 21, 31, 'black_iron', edge=False), B(.1, .12, -.01, .01, 21, 31, 'black_iron', edge=False),
          B(-.12, .12, -.01, .01, 31, 32, 'black_iron', edge=False),
          B(.04, .1, -.02, .02, 27, 31, 'cloth_red', flat(.05), flat(.05), flat(.05))]
    if st == 'unlit': return bx, []
    s = 1 + .12 * math.sin(2 * math.pi * ph); dx = .25 * math.sin(2 * math.pi * (ph + .3))
    def d(c):
        c.part(ellipse_pts(16 + dx, 21 - (s - 1) * 2, 1.5, 2.7 * s), 'fire', lw=0.4, shade=0.1)
        c.part(ellipse_pts(16 + dx * .5, 22, .7, 1.3 * s), 'glow', outline=False, flat=True)
    return bx, [(-1, lambda cv, r, m: toon_at(cv, 0, 0, 9, r, m, d, size=32))]

PIECES = {   # key: (fn, footprint, layer, rows, cell, light-colour emissive)
    'campfire': (campfire, (1, 1), 2, 1, 'S'),
    'torch_stand': (torch_stand, (1, 1), 2, 1, 'T'),
    'fireplace': (fireplace, (2, 1), 2, 2, 'WT'),
    'wood_stove': (wood_stove, (1, 1), 2, 1, 'T'),
    'lantern': (lantern, (1, 1), 3, 1, 'S'),
}
SKEY = {'lantern': 'dec_lantern'}   # sprite key != piece key where an item already owns the bare key

def _emissive(lit, cold):
    """emissive = where the lit frame differs from the same frame with no fire (flames, coals, door glow)."""
    a = np.asarray(lit, np.float32); b = np.asarray(cold, np.float32)
    d = np.abs(a[..., :3] - b[..., :3]).sum(-1) + np.abs(a[..., 3] - b[..., 3])
    warm = (a[..., 0] > 150) & (a[..., 0] >= a[..., 2])
    m = ((d > 60) & warm & (a[..., 3] > 40)).astype(np.float32)[..., None]
    return Image.fromarray(np.concatenate([a[..., :3] * m, (m * 255)], -1).astype(np.uint8), 'RGBA')

def frames(key):
    fn, fp, layer, rows, cls = PIECES[key]; seed = sum(map(ord, key)) % 1000
    out = {}
    for r in range(rows):
        cold = render((fn('unlit', 0)[0], []), r, cls, fp, seed)
        out[(r, 'unlit')] = (cold[0], cold[1], tuple(Image.new('RGBA', im.size) for im in cold[0]))
        for f in range(NF):
            bx, dec = fn('lit', f / NF)
            col, msk, _ = render((bx, dec), r, cls, fp, seed)
            nofire, _, _ = render((bx, []), r, cls, fp, seed)
            out[(r, f)] = (col, msk, tuple(_emissive(c, n) for c, n in zip(col, nofire)))
    return out

def apply(man, out, prev=None):
    from concurrent.futures import ProcessPoolExecutor
    with ProcessPoolExecutor() as ex: R = dict(zip(PIECES, ex.map(frames, PIECES)))
    man['atlases'] = [a for a in man['atlases'] if not a['key'].startswith('hearth_')]
    man['sprites'] = [s for s in man['sprites'] if s['key'] not in {SKEY.get(k, k) for k in PIECES}]
    stats = []
    for cls in dict.fromkeys(p[4] for p in PIECES.values()):
        ks = [k for k in PIECES if PIECES[k][4] == cls]; w, h, ox, oy = CELLS[cls]
        cells = [(k, j) for k in ks for j in R[k]]; cols = min(len(cells), 2048 // (2 * w)); nrows = (len(cells) + cols - 1) // cols
        akey = f'hearth_{cls.lower()}'
        ims = {suf: Image.new('RGBA' if suf != '.tintmask' and suf != '.tintmask@2x' else 'RGB', (cols * w * s, nrows * h * s), (0, 0, 0, 0) if 'tint' not in suf else (0, 0, 0))
               for suf, s in (('', 1), ('@2x', 2), ('.tintmask', 1), ('.tintmask@2x', 2), ('_emissive', 1), ('_emissive@2x', 2))}
        idx = {}
        for i, (k, j) in enumerate(cells):
            col, msk, em = R[k][j]; x, y = i % cols, i // cols; idx[(k, j)] = i
            for suf, im, s in (('', col[0], 1), ('@2x', col[1], 2), ('.tintmask', msk[0], 1), ('.tintmask@2x', msk[1], 2), ('_emissive', em[0], 1), ('_emissive@2x', em[1], 2)):
                ims[suf].paste(im, (x * w * s, y * h * s))
        for suf, im in ims.items(): im.save(f'{out}/atlases/{akey}{suf}.png', optimize=True)
        man['atlases'].append({"key": akey, "image": f"atlases/{akey}.png", "frameW": w, "frameH": h, "columns": cols, "rows": nrows,
                               "pages": [{"scale": 2, "image": f"atlases/{akey}@2x.png"}],
                               "masks": {"tintmask": f"atlases/{akey}.tintmask.png", "emissive": f"atlases/{akey}_emissive.png"}, "residency": "stream"})
        stats.append((akey, ims[''].size, len(cells)))
        for k in ks:
            fn, fp, layer, rows, _ = PIECES[k]
            lit = [[idx[(k, (r, f))] for f in range(NF)] for r in range(rows)]; cold = [idx[(k, (r, 'unlit'))] for r in range(rows)]
            rr = lambda xs: [[x] * 4 for x in xs] if rows == 1 else [[x] * 4 for x in xs] * 2
            anim = {"idle": {"frames": lit[0], "fps": 10, "loop": True}, "unlit": {"frames": [cold[0]], "fps": 1}}
            if rows > 1: anim["idle"]["rotations"] = lit + lit; anim["unlit"]["rotations"] = [[c] for c in cold + cold]
            man['sprites'].append({"key": SKEY.get(k, k), "category": "building", "atlas": akey, "anchor": {"x": ox / w, "y": oy / h}, "animations": anim,
                                   "building": {"piece": k, "footprint": {"w": fp[0], "h": fp[1]}, "layer": layer, "frames": rr([l[0] for l in lit]),
                                                "states": {"unlit": rr(cold)}, "crackOverlay": "bld_crack"},
                                   "rotationArt": "mirror" if rows == 1 else "unique4"})
    if prev: contact(R, prev)
    return stats

def contact(R, prev):
    os.makedirs(prev, exist_ok=True); tiles = [(k, j, v[0][1]) for k in R for j, v in R[k].items()]
    cw = max(t.size[0] for *_, t in tiles) + 6; ch = max(t.size[1] for *_, t in tiles) + 6; cols = NF + 1
    rows = {}
    for k, j, t in tiles: rows.setdefault((k, j[0] if isinstance(j, tuple) else j), []).append(t)
    sheet = Image.new('RGB', (cw * cols, ch * len(rows)), (104, 150, 98))
    for y, (rk, ts) in enumerate(rows.items()):
        for x, t in enumerate(ts): sheet.paste(t, (x * cw + 3, y * ch + ch - 3 - t.size[1]), t)
    sheet.save(f'{prev}/hearths_2x.png')

if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else '..'
    p = f'{out}/manifest.building.json'; man = json.load(open(p))
    for a in apply(man, out, sys.argv[2] if len(sys.argv) > 2 else None): print(*a)
    json.dump(man, open(p, 'w'), indent=1); open(p, 'a').write('\n')
