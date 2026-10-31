#!/usr/bin/env python3
# Missing-art pass (pt102u audit), appended to the items sub-manifest (idempotent; rerun after items/src/build.py, which
# rewrites manifest.items.json):
#   icons -> items_missing (32 px, category item):
#            lantern            hurricane lantern (dented cap, twine-wrapped bail). Picked by resolveIcon(itemKey) for the
#                               `lantern` item, whose spriteKey points at a building decor sprite.
#            icon_pine_sapling  pine seedling in a twine-tied burlap root ball (`pine_sapling` is already the world
#                               resource sprite, so the icon gets its own key; sprite_fallbacks.json icons maps it).
#   held  -> items_held_e (48 px, 8 directions, category equipment; renderer key held_<item>, off hand falls back to it):
#            held_stone_shovel  flint blade lashed to a stick: same painter + project() as held_<metal>_shovel (grip .75).
#            held_lantern, held_patch_kit, held_repair_kit
#                               hang from the hand by the bail/strap: pivot (grip) at cell (.5, .25), upright, no tilt.
#            held_tallow_candle tin-lid dish carried upright: grip at (.5, .75).
# Run from repo root: python3 packages/assets/pack/items/src/missing_art.py [preview dir]
#   then python3 assets/tools/ktx2.py packages/assets/pack/items/manifest.items.json, gen_icon_css.py, lock:ids:pack.
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from PIL import Image, ImageDraw
from draw import C, CEL, cel_snap, lt, dk
import icons
from icons import M, shovel, sh
import adr135
from adr135 import sheet
R = 'packages/assets/pack/items/'; PREV = sys.argv[1] if len(sys.argv) > 1 else '/workspace/assets/preview'
TWINE = '#c9a86a'; BURLAP = '#b8935f'; TIN = '#a7adb5'; RUST = '#b0643a'; FLAME = '#ffb347'; GLOW = '#fff2a8'; TALLOW = '#efe2c0'

def stone_shovel(c):
    shovel(c, M['flint'], M['wood'])
    for i in range(3): c.line([(16.2 + i * 1.1, 14.6 - i * 1.1), (18.6 + i * 1.1, 16.4 - i * 1.1)], .7, TWINE, 230)   # twine lashing
    c.line([(20, 8), (24.5, 12)], .5, lt(M['flint'], .5), 170)   # knapped ridge

def lantern(c, cx=16, top=3, k=1.0, bail=True):
    """hurricane lantern; bail apex at (cx, top), ~26*k units tall."""
    y = lambda v: top + v * k; X = lambda v: cx + v * k
    if bail:
        c.stroke([(X(-6.5), y(12)), (X(-5), y(3)), (X(0), y(0)), (X(5), y(3)), (X(6.5), y(12))], .9 * k, '#6d727b', ol=True, owf=.6)
        c.stroke([(X(-1.6), y(.6)), (X(1.6), y(.6))], 2 * k, TWINE, owf=.6)   # twine-wrapped grip
    c.rect(X(-4), y(5), X(4), y(8.5), M['red'], r=1.2 * k)                 # cap (chipped paint)
    c.dot(X(2.2), y(6.4), .7 * k, TIN)
    c.rect(X(-1.5), y(3.5), X(1.5), y(5.4), dk(M['red'], .2), r=.5)
    c.ell(X(0), y(14.5), 5.6 * k, 6.2 * k, '#d9eef0', shade=.15, owf=.8)  # globe
    c.ell(X(0), y(15.5), 2.6 * k, 3.6 * k, FLAME, ol=False); c.ell(X(0), y(16.3), 1.4 * k, 2.1 * k, GLOW, ol=False)
    for s in (-1, 1): c.line([(X(4.5 * s), y(8.5)), (X(5.3 * s), y(20))], .6 * k, '#6d727b', 220)   # guard wires
    c.line([(X(-3.2), y(10.5)), (X(-3.6), y(17))], .7 * k, (255, 255, 255), 170)
    c.rect(X(-5.5), y(20), X(5.5), y(25), M['red'], r=1.5 * k, shade=.35)   # fuel tank
    c.line([(X(-3.5), y(22.4)), (X(-1), y(23.2))], .6 * k, dk(M['red'], .4), 200)   # dent
    c.dot(X(3.4), y(22), .8 * k, RUST)

def lantern_icon(c): sh(c, 8); lantern(c, 16, 3)

def sapling_icon(c):
    sh(c, 9)
    c.stroke([(16, 20), (16, 6)], 1.4, M['dwood'])
    for yy, w in ((15.5, 7), (11.5, 5.5), (7.5, 3.8)):
        c.poly([(16, yy - 5), (16 + w, yy + 1.5), (16 + w * .4, yy + .6), (16, yy + 1.4), (16 - w * .4, yy + .6), (16 - w, yy + 1.5)], '#3f8f5a', shade=.3)
    c.dot(13, 12, .6, '#9fd8a8', 200); c.dot(18.5, 15.8, .6, '#9fd8a8', 200)
    c.poly([(9, 22), (11, 19), (21, 19), (23, 22), (22, 27.5), (10, 27.5)], BURLAP, shade=.35)   # root ball
    c.stroke([(10.5, 21.3), (21.5, 21.3)], 1, TWINE); c.stroke([(15, 21.3), (13.5, 24.5)], .7, TWINE, ol=False)
    for x in (12, 15, 18, 21): c.line([(x, 23), (x - .5, 27)], .4, dk(BURLAP, .3), 150)
    c.rect(18, 23.5, 21, 26, '#8f6f45', r=.4)   # patch

def candle_held(c):   # grip (16, 24.5): finger loop under a tin-lid dish, stubby tallow candle, drips
    c.stroke([(16, 22), (16, 25.5)], 1.6, TIN)
    c.ell(16, 21, 7.5, 2, TIN, shade=.3); c.ell(16, 20.4, 6, 1.2, dk(TIN, .15), ol=False)
    c.rect(13, 10.5, 19, 20.6, TALLOW, r=1.2, shade=.25)
    c.line([(18, 11.5), (18.3, 15)], 1, lt(TALLOW, .4), 230); c.dot(14, 12, .9, lt(TALLOW, .3)); c.dot(14, 19.8, 1.2, TALLOW)
    c.line([(16, 10.6), (16, 8.4)], .6, '#3c3f49')
    c.ell(16, 6, 2, 3.2, FLAME, ol=False); c.ell(16, 6.8, 1, 1.8, GLOW, ol=False)

def patch_kit(c):   # strap top at (16, 3): canvas roll-up pouch, safety-pinned patches, rubber cement tube poking out
    c.stroke([(12, 10), (16, 3.5), (20, 10)], 1.3, M['leather'], owf=.6)
    c.rect(7.5, 10, 24.5, 25, '#7f8a55', r=3, shade=.35)
    c.rect(7.5, 10, 24.5, 14, dk('#7f8a55', .12), r=2)
    c.rect(10, 16, 15, 21, M['red'], r=.6); c.rect(17, 17, 22, 22.5, '#5c8fe0', r=.6)
    c.line([(11, 18.5), (14, 18.5)], .4, '#f7ead1', 220); c.line([(18, 19.6), (21, 19.6)], .4, '#f7ead1', 220)
    c.rect(21, 7, 23.5, 12, M['steel'], r=.6); c.rect(21.3, 5.8, 23.2, 7.2, M['red'], r=.3)   # glue tube
    c.line([(9, 23.5), (13, 23.5)], .5, TWINE, 230)   # stitched repair

def repair_kit(c):  # handle top at (16, 3): dented tin toolbox, rust spot, wrench strapped across the lid
    c.stroke([(11, 9), (11, 5), (21, 5), (21, 9)], 1.4, '#6d727b', owf=.6)
    c.rect(13, 3.6, 19, 6.2, M['leather'], r=1)
    c.rect(5.5, 9, 26.5, 25, '#d96b3a', r=1.5, shade=.35)
    c.rect(5.5, 9, 26.5, 13.5, dk('#d96b3a', .15), r=1.2)
    c.rect(14.5, 12.5, 17.5, 15.5, TIN, r=.5)   # latch
    c.stroke([(8, 19), (24, 19)], 1.6, '#8d97a6'); c.ell(8, 19, 1.8, 1.8, '#8d97a6'); c.ell(24, 19, 1.8, 1.8, '#8d97a6')
    c.rect(19, 17, 21, 21, '#6b4a30', r=.3)    # strap over wrench
    c.dot(10, 23, 1.1, RUST); c.line([(22, 21.5), (24, 23.5)], .6, dk('#d96b3a', .45), 200)

SQ = [.7, .85, 1, .85, .7, .85, 1, .85]; DIM = [1, 1, 1, .9, .82, .9, 1, 1]
def upright(painter, gy, k, ay, box=True):
    """non-tilting held sprite: 32-unit drawing with grip at (16, gy), scaled k px per unit at 1x, mirrored for facings 1-3."""
    icons.NOSHADOW[0] = True; c = C(32, 8); painter(c); icons.NOSHADOW[0] = False; src = c.img
    res = []
    for scale, cell in ((2, 96), (1, 48)):
        frames = []
        for d in range(8):
            im = src.transpose(Image.FLIP_LEFT_RIGHT) if d in (1, 2, 3) else src
            f = k * scale / 8; sq = SQ[d] if box else 1; W = max(1, int(256 * f * sq)); H = int(256 * f)
            im = im.resize((W, H), Image.LANCZOS)
            if CEL: im = cel_snap(im, c.pal)
            if DIM[d] < 1:
                r, g, b, a = im.split(); r, g, b = [ch.point(lambda v, q=DIM[d]: int(v * q)) for ch in (r, g, b)]; im = Image.merge('RGBA', (r, g, b, a))
            fr = Image.new('RGBA', (cell, cell)); fr.paste(im, (int(round(cell * .5 - 16 * 8 * f * sq)), int(round(cell * ay - gy * 8 * f))), im)
            frames.append(fr)
        res.append(frames)
    return res

if __name__ == '__main__':
    man = json.load(open(R + 'manifest.items.json'))
    def atlas(key, f1, f2, cw, cols):
        a1, rows = sheet(f1, cw, cols); a2, _ = sheet(f2, cw * 2, cols); assert max(a2.size) <= 2048
        a1.save(f'{R}atlases/{key}.png', optimize=True); a2.save(f'{R}atlases/{key}@2x.png', optimize=True)
        man['atlases'] = [a for a in man['atlases'] if a['key'] != key]; man['sprites'] = [s for s in man['sprites'] if s['atlas'] != key]
        man['atlases'].append({"key": key, "image": f"atlases/{key}.png", "frameW": cw, "frameH": cw, "columns": cols, "rows": rows,
                               "pages": [{"scale": 2, "image": f"atlases/{key}@2x.png", "ktx2": f"atlases/{key}@2x.ktx2"}], "ktx2": f"atlases/{key}.ktx2"})
    os.makedirs(PREV, exist_ok=True)
    ic = []
    for key, p in (('lantern', lantern_icon), ('icon_pine_sapling', sapling_icon)):
        c = C(32, 8); p(c); ic.append((key, c.out(32), c.out(64)))
    atlas('items_missing', [x[1] for x in ic], [x[2] for x in ic], 32, len(ic))
    for i, (key, *_ ) in enumerate(ic):
        man['sprites'].append({"key": key, "category": "item", "atlas": "items_missing", "anchor": {"x": 0.5, "y": 0.5}, "animations": {"idle": {"frames": [i], "fps": 1}}})
    adr135.PAINT['stone_shovel'] = stone_shovel
    sets = [('held_stone_shovel', adr135.project('stone_shovel', False), .75),
            ('held_lantern', upright(lambda c: lantern(c, 16, 3), 3.6, .72, .25, box=False), .25),
            ('held_tallow_candle', upright(candle_held, 24.5, .6, .75, box=False), .75),
            ('held_patch_kit', upright(patch_kit, 4, .62, .25), .25),
            ('held_repair_kit', upright(repair_kit, 4.5, .62, .25), .25)]
    atlas('items_held_e', [f for _, p, _ in sets for f in p[1]], [f for _, p, _ in sets for f in p[0]], 48, 8)
    for i, (key, _, ay) in enumerate(sets):
        man['sprites'].append({"key": key, "category": "equipment", "atlas": "items_held_e", "anchor": {"x": 0.5, "y": ay}, "animations": {"idle": {"frames": [8 * i], "fps": 1, "directions": 8, "dirStride": 1}}})
    json.dump(man, open(R + 'manifest.items.json', 'w'), indent=1, ensure_ascii=False); open(R + 'manifest.items.json', 'a').write('\n')
    # previews
    pv = Image.new('RGB', (300, 140), (104, 150, 98)); d = ImageDraw.Draw(pv)
    for i, (key, a, b) in enumerate(ic):
        pv.paste(b.resize((128, 128), Image.NEAREST), (10 + i * 150, 6), b.resize((128, 128), Image.NEAREST)); d.text((10 + i * 150, 128), key, fill=(255, 255, 240))
    pv.save(f'{PREV}/missing_art_icons.png')
    CW = 110; pv = Image.new('RGB', (CW * 8, 120 * len(sets)), (104, 150, 98)); d = ImageDraw.Draw(pv)
    for r, (key, p, ay) in enumerate(sets):
        for dd in range(8):
            X, Y = dd * CW + 55, r * 120 + 70
            d.ellipse([X - 14, Y - 40, X + 14, Y + 45], fill=(200, 180, 150)); d.text((X - 50, Y - 64), f'{key[5:]} d{dd}', fill=(255, 255, 240))
            fr = p[0][dd]; pv.paste(fr, (int(X + 16 - 48), int(Y + 6 - 96 * ay)), fr); d.ellipse([X + 13, Y + 3, X + 19, Y + 9], outline=(220, 60, 60))
    pv.save(f'{PREV}/missing_art_held.png'); print('icons', [x[0] for x in ic], 'held', [s[0] for s in sets])
