"""Spring ground tileset (Summer -> Fall -> Winter -> Spring): renders ONLY `spring` keys and packs NEW pages gt_spring_pN,
then surgically inserts those atlases + every `*_spring` sprite into pack/manifest.json. Never rewrites gt_summer_* /
gt_fall_* / gt_winter_* pages or their manifest records (ground_pack.py main() would). Also extends gt_grazed from 3 to 4
columns: cells 0-2 are copied pixel-for-pixel from the shipped page, only cell 3 (spring) is painted.
Run from the repo root:  python3 packages/assets/pack/nature/src/artpass_spring_ground.py"""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from PIL import Image
import ground_preview as GPV
from ground_pack import (R, PAD, CW, CH, COLS, ROWS, ANCHOR, MATS, NAME, PH, INV, MASKS, SUF, bleed, dilate)
from ground_core import TOP, Tile, out1, out2
from ground_mats import P, tuft, tone, patches, vn, U, V
from ground_paint import blossom, sprout

SE = 'spring'; TW = '_spring'

def plan():
    S = []
    for mat in MATS:
        for v in range(6): S.append((f'gt_{NAME.get(mat, mat)}{SUF[v]}{TW}', [f'base|{mat}|{SE}|{v}'], 1, PH[mat]))
    S.append(('gt_water' + TW, [f'w|{SE}|{f}' for f in range(4)], 4, 'tile_water'))
    S.append(('gt_water_shallow' + TW, [f'ws|{SE}|{f}' for f in range(4)], 4, 'tile_water_shallow'))
    for inv in INV:
        for m in MASKS:
            k0 = f'gt_{NAME.get(inv, inv)}_edge_{m}'; S.append((k0 + TW, [f'ov|{inv}|{SE}|{m}'], 1, k0))
    for style, nm in (('sand', 'shore'), ('bank', 'bank')):
        for m in MASKS: S.append((f'gt_{nm}_{m}{TW}', [f'sh|{style}|{SE}|{m}|{f}' for f in range(4)], 4, f'gt_{nm}_{m}'))
    for mat in MATS:
        k0 = f'gt_side_{NAME.get(mat, mat)}'
        S.append((k0 + TW, [f'side|{mat}|{SE}'], 1, k0))
        S.append((k0 + '_low' + TW, [f'sidel|{mat}|{SE}'], 1, k0 + TW))
    return S

def pack(S):
    per = COLS * ROWS; pages = [[]]; amap = {}
    for _, fr, _, _ in S:
        new = [k for k in dict.fromkeys(fr) if k not in amap]
        if len(pages[-1]) + len(new) > per: pages.append([])
        for k in new: pages[-1].append(k); amap[k] = (f'gt_{SE}_p{len(pages) - 1}', len(pages[-1]) - 1)
    atlases = []
    for pi, chunk in enumerate(pages):
        name = f'gt_{SE}_p{pi}'; cols = min(COLS, len(chunk)); rows = -(-len(chunk) // cols)
        for sc in (1, 2):
            im = Image.new('RGBA', (cols * CW * sc, rows * CH * sc), (0, 0, 0, 0))
            for i, k in enumerate(chunk):
                t = np.asarray(GPV.get(k, sc)).copy(); t[..., 3] = np.where(t[..., 3] >= 128, 255, 0); t[t[..., 3] == 0] = 0
                if k.startswith(('base|', 'w|', 'ws|')): im.paste(Image.fromarray(bleed(t, sc), 'RGBA'), (i % cols * CW * sc, i // cols * CH * sc)); continue
                im.paste(Image.fromarray(t, 'RGBA'), ((i % cols * CW + PAD) * sc, (i // cols * CH + PAD) * sc))
            im = dilate(im); im.save(R + f'atlases/{name}{"" if sc == 1 else "@2x"}.png', optimize=True)
        atlases.append({'key': name, 'image': f'atlases/{name}.png', 'frameW': CW, 'frameH': CH, 'columns': cols, 'rows': rows,
                        'pages': [{'scale': 2, 'image': f'atlases/{name}@2x.png', 'ktx2': f'atlases/{name}@2x.ktx2'}],
                        'ktx2': f'atlases/{name}.ktx2'})
    sprites = []
    for key, fr, fps, ph in S:
        at = {amap[k][0] for k in fr}; assert len(at) == 1, key
        sprites.append({'key': key, 'category': 'tile', 'atlas': at.pop(), 'anchor': dict(ANCHOR),
                        'animations': {'idle': {'frames': [amap[k][1] for k in fr], 'fps': fps}}, 'placeholder': ph})
    return atlases, sprites

def grazed_spring():
    """Spring grazed lawn: short lime stubs, more damp soil showing, a couple of leftover blossom scraps."""
    p = P['grass'][SE]; d = P['dirt'][SE]; t = Tile()
    tone(t, TOP, [p['t'][1], p['t'][2], p['t'][2], p['t'][3]], 72, 0, 2, 3, (.06, .1))
    soil = patches(0, 1460, 4, (.05, .1)); so = TOP & (soil > .55)
    t.fill(so, d['t'][1]); t.fill(so & (soil > .76), d['t'][2])
    rng = np.random.default_rng(7190)
    for _ in range(9):
        u, v = float(rng.uniform(.18, .82)), float(rng.uniform(.22, .78))
        tuft(t, u, v, p['blade'], h=float(rng.uniform(1.2, 2.0)), n=int(rng.integers(2, 4)), seed=int(rng.integers(1e6)), spread=1.1)
    for (u, v) in ((.36, .42), (.62, .6)): blossom(t, u, v, *p['fl'][0 if u < .5 else 2], r=.6)
    sprout(t, .5, .3, d['sprout'], .8)
    return t.finish(TOP)

def grazed_atlas(m):
    t = grazed_spring(); cells = {1: np.asarray(out1(t)), 2: np.asarray(out2(t))}
    for sc in (1, 2):
        suf = '' if sc == 1 else '@2x'; path = R + f'atlases/gt_grazed{suf}.png'
        old = Image.open(path).convert('RGBA')
        assert old.size == (3 * CW * sc, CH * sc), old.size   # idempotent guard: only extend the shipped 3-column page
        im = Image.new('RGBA', (4 * CW * sc, CH * sc), (0, 0, 0, 0)); im.paste(old, (0, 0))   # cells 0-2 pixel-for-pixel
        src = cells[sc].copy(); src[..., 3] = np.where(src[..., 3] >= 128, 255, 0); src[src[..., 3] == 0] = 0
        cell = dilate(Image.fromarray(bleed(src, sc), 'RGBA'))
        im.paste(cell, (3 * CW * sc, 0)); im.save(path, optimize=True)
    a = next(a for a in m['atlases'] if a['key'] == 'gt_grazed'); a['columns'] = 4
    sp = {'key': 'gt_grass_grazed_spring', 'category': 'tile', 'atlas': 'gt_grazed', 'anchor': dict(ANCHOR),
          'animations': {'idle': {'frames': [3], 'fps': 1}}, 'placeholder': 'gt_grass_spring'}
    i = next(i for i, s in enumerate(m['sprites']) if s['key'] == 'gt_grass_grazed_winter') + 1
    m['sprites'][i:i] = [sp]

def main():
    S = plan(); keys = sorted({k for s in S for k in s[1]})
    print('render', len(keys), 'spring tiles'); GPV.ensure(keys)
    atlases, sprites = pack(S)
    m = json.load(open(R + 'manifest.json'))
    m['atlases'] = [a for a in m['atlases'] if not a['key'].startswith('gt_spring_')]   # re-runnable: only our own records
    m['sprites'] = [s for s in m['sprites'] if not (s['key'].startswith('gt_') and s['key'].endswith('_spring') and s['key'] != 'gt_grass_grazed_spring')]
    ia = max(i for i, a in enumerate(m['atlases']) if a['key'].startswith('gt_winter_p')) + 1
    m['atlases'][ia:ia] = atlases
    isp = max(i for i, s in enumerate(m['sprites']) if s['atlas'].startswith('gt_winter_p')) + 1
    m['sprites'][isp:isp] = sprites
    if not any(s['key'] == 'gt_grass_grazed_spring' for s in m['sprites']): grazed_atlas(m)
    open(R + 'manifest.json', 'w').write(json.dumps(m, indent=2, ensure_ascii=False) + '\n')
    print('atlases', [(a['key'], a['columns'], a['rows']) for a in atlases]); print('sprites', len(sprites) + 1)

if __name__ == '__main__': main()
