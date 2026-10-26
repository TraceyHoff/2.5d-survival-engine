#!/usr/bin/env python3
# ADR-135 art (docs/DECISIONS.md "Art needs"), appended to the items sub-manifest (idempotent; rerun after items/src/build.py,
# which rewrites manifest.items.json):
#   held   -> items_held_d: held_stone_knife (same painter family + held() projection as held_bone_knife / items_held_c) and
#             offhand_<knife> for the six off-hand knives (stone/bronze/iron/steel/alloy/bone), 8 directions each.
#             Off-hand = reverse grip, blade down: frame d is the main-hand projection of the mirrored facing (8-d)%8,
#             flipped (left hand), rotated 180 deg about the grip. Pivot (grip) at cell (0.5, 0.25) -> tracks the body
#             frame's `handL` anchor (renderer: atlas.handOf(body, "handL"), the same path as handR / held_<item>).
#   xp     -> items_xp: icon_xp (toast "+N XP" icon, category ui; gen_icon_css aliases it to [data-icon="xp"]) and
#             items_xp_chip: ui_xp_chip_frame (9-slice pill for #xp-chip).
# Run from repo root: python3 packages/assets/pack/items/src/adr135.py [held|xp|all] [preview dir]
#   then python3 assets/tools/ktx2.py packages/assets/pack/items/manifest.items.json, gen_icon_css.py, lock:ids:pack.
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from PIL import Image, ImageDraw
from draw import C, CEL, cel_snap
import icons
from icons import M, knife
from bonetools import BONE
from table import T
R = 'packages/assets/pack/items/'; MODE = sys.argv[1] if len(sys.argv) > 1 else 'all'; PREV = sys.argv[2] if len(sys.argv) > 2 else '/workspace/assets/preview'
PAINT = dict(T); PAINT.update(BONE)
PAINT['stone_knife'] = lambda c: knife(c, M['flint'], M['wood'], .8, guard=False, shape='leaf')
KNIVES = ['stone_knife', 'bronze_knife', 'iron_knife', 'steel_knife', 'alloy_knife', 'bone_knife']
TILT = [0, -22, -38, -22, 0, 22, 38, 22]; SQ = [.62, .85, 1, .85, .62, .85, 1, .85]; DIM = [1, 1, 1, .9, .82, .9, 1, 1]

def project(k, off):
    """items/src/build.py held() projection; off=True -> off-hand reverse grip (pivot at cell y .25)."""
    icons.NOSHADOW[0] = True; c = C(32, 8); PAINT[k](c); icons.NOSHADOW[0] = False
    src = Image.new('RGBA', (768, 768), (0, 0, 0, 0)); src.paste(c.img, (256, 256))
    gx, gy = 256 + 7.5 * 8, 256 + 24.5 * 8; res = []
    for scale, cell in ((2, 96), (1, 48)):
        frames = []
        for d in range(8):
            m = (8 - d) % 8 if off else d
            im = src.rotate(45 + TILT[m] + (180 if off else 0), resample=Image.BICUBIC, center=(gx, gy))
            if m in (1, 2, 3): im = im.transpose(Image.FLIP_LEFT_RIGHT); px = 768 - gx
            else: px = gx
            if off: im = im.transpose(Image.FLIP_LEFT_RIGHT); px = 768 - px
            f = 28 * scale / 256; W = max(1, int(768 * f * SQ[m])); H = int(768 * f)
            im = im.resize((W, H), Image.LANCZOS)
            if CEL: im = cel_snap(im, c.pal)   # projection resample -> back to flat palette + binary alpha
            if DIM[m] < 1:
                r, g, b, a = im.split(); r, g, b = [ch.point(lambda v, q=DIM[m]: int(v * q)) for ch in (r, g, b)]; im = Image.merge('RGBA', (r, g, b, a))
            fr = Image.new('RGBA', (cell, cell), (0, 0, 0, 0)); ax, ay = cell * .5, cell * (.25 if off else .75)
            fr.paste(im, (int(round(ax - px * f * SQ[m])), int(round(ay - gy * f))), im)
            frames.append(fr)
        res.append(frames)
    return res  # [[2x frames], [1x frames]]

def xp_icon(c):  # chunky gold star with a mint "XP" plate: reads at 16 px in the toast
    import math
    pts = [(16 + (13 if i % 2 == 0 else 6) * math.cos(-math.pi / 2 + i * math.pi / 5), 15 + (13 if i % 2 == 0 else 6) * math.sin(-math.pi / 2 + i * math.pi / 5)) for i in range(10)]
    c.poly(pts, '#f6c945', shade=.3); c.ell(12, 10, 2.2, 1.6, '#fff6c8')
    c.rect(8, 19, 24, 28, '#5fc79a', r=3); c.line([(10.5, 21), (14, 26)], 1.3, '#ffffff'); c.line([(14, 21), (10.5, 26)], 1.3, '#ffffff')
    c.line([(16.5, 26), (16.5, 21)], 1.3, '#ffffff'); c.stroke([(16.5, 21), (19.5, 21), (20.5, 22.4), (19.5, 23.6), (16.5, 23.6)], 1.2, '#ffffff')

def chip(k):  # 40x20 cell: dark plum pill rim, translucent cocoa fill, gold top glint; 9-slice l/r 10, t/b 9
    w, h = 40 * k, 20 * k; S = 8 * k; im = Image.new('RGBA', (w * 8, h * 8)); d = ImageDraw.Draw(im)
    d.rounded_rectangle([S, 2 * S, w * 8 - S, h * 8 - 1], radius=int(9 * S), fill=(30, 18, 22, 90))
    d.rounded_rectangle([0, 0, w * 8 - 2 * S, h * 8 - 3 * S], radius=int(8.5 * S), fill=(74, 46, 52, 255))
    d.rounded_rectangle([1.5 * S, 1.5 * S, w * 8 - 3.5 * S, h * 8 - 4.5 * S], radius=int(7 * S), fill=(36, 26, 24, 200))
    d.rounded_rectangle([4 * S, 2.6 * S, w * 8 - 6 * S, 4.2 * S], radius=int(1 * S), fill=(246, 201, 69, 200))
    return im.resize((w, h), Image.LANCZOS)

def sheet(frames, cell, cols, ch=None):
    ch = ch or cell; rows = (len(frames) + cols - 1) // cols; im = Image.new('RGBA', (cell * cols, ch * rows))
    for i, f in enumerate(frames): im.paste(f, ((i % cols) * cell, (i // cols) * ch))
    return im, rows

if __name__ == '__main__':
    man = json.load(open(R + 'manifest.items.json'))
    def atlas(key, f1, f2, cw, cols, ch=None, extra={}):
        ch = ch or cw; a1, rows = sheet(f1, cw, cols, ch); a2, _ = sheet(f2, cw * 2, cols, ch * 2); assert max(a2.size) <= 2048
        a1.save(f'{R}atlases/{key}.png', optimize=True); a2.save(f'{R}atlases/{key}@2x.png', optimize=True)
        man['atlases'] = [a for a in man['atlases'] if a['key'] != key]; man['sprites'] = [s for s in man['sprites'] if s['atlas'] != key]
        man['atlases'].append({"key": key, "image": f"atlases/{key}.png", "frameW": cw, "frameH": ch, "columns": cols, "rows": rows, **extra,
                               "pages": [{"scale": 2, "image": f"atlases/{key}@2x.png", "ktx2": f"atlases/{key}@2x.ktx2"}], "ktx2": f"atlases/{key}.ktx2"})
    os.makedirs(PREV, exist_ok=True)
    if MODE in ('held', 'all'):
        sets = [('held_stone_knife', project('stone_knife', False), .75)] + [(f'offhand_{k}', project(k, True), .25) for k in KNIVES]
        atlas('items_held_d', [f for _, p, _ in sets for f in p[1]], [f for _, p, _ in sets for f in p[0]], 48, 16)
        for i, (key, _, ay) in enumerate(sets):
            man['sprites'].append({"key": key, "category": "equipment", "atlas": "items_held_d", "anchor": {"x": 0.5, "y": ay}, "animations": {"idle": {"frames": [8 * i], "fps": 1, "directions": 8, "dirStride": 1}}})
        # preview: per row a knife; per facing the main-hand (right) and off-hand (left) sprite pivoted on a stick figure's hands
        ref = {k: project(k, False) for k in KNIVES if k != 'stone_knife'}; ref['stone_knife'] = sets[0][1]
        CW = 120; pv = Image.new('RGB', (CW * 8, 130 * len(KNIVES)), (104, 150, 98)); d = ImageDraw.Draw(pv)
        for r, k in enumerate(KNIVES):
            for dd in range(8):
                X, Y = dd * CW + 60, r * 130 + 70; hx = 14 if dd in (0, 1, 7) else -14 if dd in (3, 4, 5) else 0
                d.ellipse([X - 14, Y - 40, X + 14, Y + 50], fill=(200, 180, 150)); d.text((X - 55, Y - 66), f'{k[:-6]} d{dd}', fill=(255, 255, 240))
                mh = ref[k][0][dd]; oh = sets[1 + r][1][0][dd]
                pv.paste(mh, (X - hx - 48, Y + 10 - 72), mh); pv.paste(oh, (X + hx - 48, Y + 10 - 24), oh)
                d.ellipse([X - hx - 3, Y + 7, X - hx + 3, Y + 13], fill=(220, 60, 60)); d.ellipse([X + hx - 3, Y + 7, X + hx + 3, Y + 13], fill=(60, 90, 220))
        pv.save(f'{PREV}/adr135_offhand_knives_2x.png'); print('preview', f'{PREV}/adr135_offhand_knives_2x.png', [s[0] for s in sets])
    if MODE in ('xp', 'all'):
        c = C(32, 8); xp_icon(c); atlas('items_xp', [c.out(32)], [c.out(64)], 32, 1)
        man['sprites'].append({"key": "icon_xp", "category": "ui", "atlas": "items_xp", "anchor": {"x": 0.5, "y": 0.5}, "animations": {"idle": {"frames": [0], "fps": 1}}})
        atlas('items_xp_chip', [chip(1)], [chip(2)], 40, 1, 20, {"nineSlice": {"0": {"l": 10, "t": 9, "r": 10, "b": 9}}})
        man['sprites'].append({"key": "ui_xp_chip_frame", "category": "ui", "atlas": "items_xp_chip", "anchor": {"x": 0.5, "y": 0.5}, "animations": {"idle": {"frames": [0], "fps": 1}}})
        pv = Image.new('RGB', (360, 90), (104, 150, 98)); ic = c.out(64); pv.paste(ic, (8, 12), ic); cp = chip(2).resize((240, 60), Image.LANCZOS)
        st = chip(2); pv.paste(st, (90, 4), st); wide = Image.new('RGBA', (240, 40)); # 9-slice stretch demo
        L, T_, Rr, B = 20, 18, 20, 18; W2, H2 = 80, 40; src = chip(2)
        for (sx0, sx1, dx0, dx1) in ((0, L, 0, L), (L, W2 - Rr, L, 240 - Rr), (W2 - Rr, W2, 240 - Rr, 240)):
            wide.paste(src.crop((sx0, 0, sx1, H2)).resize((dx1 - dx0, H2)), (dx0, 0))
        pv.paste(wide, (90, 46), wide); pv.save(f'{PREV}/adr135_xp_2x.png'); print('preview', f'{PREV}/adr135_xp_2x.png')
    json.dump(man, open(R + 'manifest.items.json', 'w'), indent=1, ensure_ascii=False); open(R + 'manifest.items.json', 'a').write('\n')
