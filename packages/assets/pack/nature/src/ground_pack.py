"""Pack the seasons ground tileset into streamed `gt_` atlases in pack/manifest.json (alongside the shipped tile_* terrain).
python3 ground_pack.py            renders missing tiles into $GROUND_CACHE (pool of 8), packs 1x + @2x pages, merges the manifest.
Cells: 64x48 art (64x32 diamond + 16 px skirt) padded 2 px -> 68x52 (1x) / 136x104 (@2x); anchor keeps the diamond centre
(0.5, 18/52). Pages are per season (gt_<season>_p<N>), 15x19 cells -> <=1020x988 (1x), <=2040x1976 (@2x). Re-runnable."""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from PIL import Image
import ground_preview as GPV
from ground_tiles import BLOB47

R = 'packages/assets/pack/'; PAD = 2; FW, FH = 64, 48; CW, CH = FW + 2 * PAD, FH + 2 * PAD; COLS, ROWS = 15, 19
ANCHOR = {'x': 0.5, 'y': round((FH / 3 + PAD) / CH, 6)}
MATS = ['grass', 'dirt', 'forest', 'sand', 'stone', 'mud', 'snow']
NAME = {'stone': 'rock'}
PH = {'grass': 'tile_grass', 'dirt': 'tile_dirt', 'forest': 'tile_forest', 'sand': 'tile_sand', 'stone': 'tile_rock', 'mud': 'tile_dirt', 'snow': 'tile_snow'}
INV = ['sand', 'dirt', 'mud', 'forest', 'grass', 'snow']
MASKS = [m for m in BLOB47 if m]            # mask 0 = no overlay
SUF = ['', '_b', '_c', '_d', '_e', '_f']
SEAS = ['summer', 'fall', 'winter']; TW = {'summer': '', 'fall': '_fall', 'winter': '_winter'}

def plan():
    """[(sprite_key, season_page, [render keys], fps, placeholder)] in manifest order."""
    S = []
    for mat in MATS:
        for v in range(6):
            base = f'gt_{NAME.get(mat, mat)}{SUF[v]}'
            for se in SEAS: S.append((base + TW[se], se, [f'base|{mat}|{se}|{v}'], 1, PH[mat]))
    for w in ('gt_water', 'gt_water_shallow'):
        ph = w.replace('gt_', 'tile_')
        S.append((w, 'summer', [f'w|summer|{f}' for f in range(4)], 4, ph))
        S.append((w + '_winter', 'winter', ['ice|0'], 1, ph))
    for v in range(6): S.append((f'gt_ice{SUF[v]}', 'winter', [f'ice|{v}'], 1, 'tile_water'))
    for v in range(3): S.append((f'gt_water_leaves_{"abc"[v]}', 'fall', [f'lv|{v}'], 1, None))
    for inv in INV:
        for m in MASKS:
            for se in SEAS: S.append((f'gt_{NAME.get(inv, inv)}_edge_{m}{TW[se]}', se, [f'ov|{inv}|{se}|{m}'], 1, None))
    for style, nm in (('sand', 'shore'), ('bank', 'bank')):
        for m in MASKS:
            for se in SEAS:
                fr = [f'sh|{style}|{se}|{m}|0'] if se == 'winter' else [f'sh|{style}|{se}|{m}|{f}' for f in range(4)]
                S.append((f'gt_{nm}_{m}{TW[se]}', se, fr, 4 if len(fr) > 1 else 1, None))
    return S

def main():
    S = plan(); keys = sorted({k for s in S for k in s[2]})
    print('sprites', len(S), 'unique cells', len(keys), 'cache', GPV.CACHE, flush=True)
    GPV.ensure(keys, 8)
    # assign cells to per-season pages (an animated sprite never straddles two pages); dedup render keys per season
    per = COLS * ROWS; pages = {}; amap = {}
    for key, se, fr, _, _ in S:
        pl = pages.setdefault(se, [[]]); new = [k for k in dict.fromkeys(fr) if (se, k) not in amap]
        if len(pl[-1]) + len(new) > per: pl.append([])
        for k in new: pl[-1].append(k); amap[(se, k)] = (f'gt_{se}_p{len(pl) - 1}', len(pl[-1]) - 1)
    atlases = []
    for se in SEAS:
        for pi, chunk in enumerate(pages[se]):
            name = f'gt_{se}_p{pi}'; cols = min(COLS, len(chunk)); rows = -(-len(chunk) // cols)
            for sc in (1, 2):
                im = Image.new('RGBA', (cols * CW * sc, rows * CH * sc), (0, 0, 0, 0))
                for i, k in enumerate(chunk):
                    t = np.asarray(GPV.get(k, sc)).copy(); t[..., 3] = np.where(t[..., 3] >= 128, 255, 0); t[t[..., 3] == 0] = 0
                    im.paste(Image.fromarray(t, 'RGBA'), ((i % cols * CW + PAD) * sc, (i // cols * CH + PAD) * sc))
                im.save(R + f'atlases/{name}{"" if sc == 1 else "@2x"}.png', optimize=True)
            atlases.append({'key': name, 'image': f'atlases/{name}.png', 'frameW': CW, 'frameH': CH, 'columns': cols, 'rows': rows,
                            'pages': [{'scale': 2, 'image': f'atlases/{name}@2x.png'}], 'residency': 'stream'})
    sprites = []
    for key, se, fr, fps, ph in S:
        at = {amap[(se, k)][0] for k in fr}; assert len(at) == 1, key
        d = {'key': key, 'category': 'tile', 'atlas': at.pop(), 'anchor': dict(ANCHOR),
             'animations': {'idle': {'frames': [amap[(se, k)][1] for k in fr], 'fps': fps}}}
        if ph: d['placeholder'] = ph
        sprites.append(d)
    m = json.load(open(R + 'manifest.json'))
    m['atlases'] = [a for a in m['atlases'] if not a['key'].startswith('gt_')]
    m['sprites'] = [s for s in m['sprites'] if not s['key'].startswith('gt_')]
    ia = next(i for i, a in enumerate(m['atlases']) if a['key'] == 'tiles') + 1
    m['atlases'][ia:ia] = atlases
    isp = max(i for i, s in enumerate(m['sprites']) if s['atlas'] == 'tiles') + 1
    m['sprites'][isp:isp] = sprites
    open(R + 'manifest.json', 'w').write(json.dumps(m, indent=2, ensure_ascii=False) + '\n')
    print('atlases', [(a['key'], a['columns'], a['rows']) for a in atlases]); print('sprites', len(sprites))

if __name__ == '__main__': main()
