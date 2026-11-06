#!/usr/bin/env python3
"""Spring-only road pass: fresh verges, damp surfaces and wrapped blossom petals.

Run from repo root. Owns only season_roads_spring and its 51 sprite definitions.
Summer alpha, frame layout, anchors and autotile metadata are copied exactly.
"""
import copy
import json
from pathlib import Path

import numpy as np
from PIL import Image

from roads_seasons import FRAG, TW, TH, SURF, uvgrid, green_mask, lum, ramp, scatter, wrapd, hexa
from artpass_spring_common import encode_atlas, merge_owned

NAME = 'season_roads_spring'
VERGE = [hexa(c) for c in ('#527e36', '#96c84a', '#d5e982')]
DAMP = {
    'path': ['#6e5941', '#a28560', '#cbb386'],
    'gravel': ['#626a66', '#929d93', '#c0c7b2'],
    'paved': ['#3f4e50', '#637475', '#91a09a'],
}
PETALS = [('#f5bed5', '#c880a3'), ('#fff0dc', '#d6b8a7'), ('#f4df81', '#bbaa54')]


def spring(rgb, alpha, u, v, scale, surf):
    """All new marks are periodic in world u/v; never add alpha at an arm edge."""
    g = green_mask(rgb) & (alpha > 0)
    l = lum(rgb)
    # Repaint in a damp spring cel palette while retaining each material's marks.
    out = ramp(l, [hexa(c) for c in DAMP[surf]], [100, 150] if surf != 'paved' else [95, 125])
    if surf == 'paved':
        dash = (rgb[..., 0] > 200) & (rgb[..., 1] > 180) & (rgb[..., 2] < 190)
        out[dash] = hexa('#eee0a2')
        out[(l > 175) & ~dash] = hexa('#d1d7c6')
    out[g] = ramp(l[g], VERGE, [110, 150])
    # Curved, broad pale petals (not angular fall leaves or white winter snow).
    for pu, pv, r, q in scatter(5, 31415):
        if r > {'path': .62, 'gravel': .52, 'paved': .40}[surf]:
            continue
        du, dv = wrapd(u - pu), wrapd(v - pv)
        sx, sy = du - dv, (du + dv) * .5
        angle = q * np.pi
        x = sx * np.cos(angle) + sy * np.sin(angle)
        y = -sx * np.sin(angle) + sy * np.cos(angle)
        ellipse = (x / (.055 + .018 * r))**2 + (y / .031)**2
        m = (ellipse < 1) & (alpha >= 128)
        light, shade = PETALS[int(q * 97) % 3]
        out[m] = hexa(light)
        out[m & (y > .008)] = hexa(shade)
    out[alpha == 0] = 0
    return out


def main():
    base = Path(FRAG)
    mf = base / 'manifest.nature.json'
    m = json.loads(mf.read_text())
    road = next(a for a in m['atlases'] if a['key'] == 'nature_roads')
    for scale in (1, 2):
        image = road['image'] if scale == 1 else next(p['image'] for p in road['pages'] if p['scale'] == scale)
        src = np.asarray(Image.open(base / image).convert('RGBA'))
        out = src.copy()
        u, v = uvgrid(scale)
        w, h = TW * scale, TH * scale
        for i in range(48):
            x, y = i % road['columns'] * w, i // road['columns'] * h
            cell = src[y:y+h, x:x+w]
            out[y:y+h, x:x+w, :3] = np.clip(np.round(spring(cell[..., :3].astype(np.float32), cell[..., 3], u, v, scale, SURF[i // 16])), 0, 255).astype(np.uint8)
        assert np.array_equal(src[..., 3], out[..., 3])
        Image.fromarray(out).save(base / f'atlases/{NAME}{"@2x" if scale == 2 else ""}.png', optimize=True)
    atlas = {k: road[k] for k in ('frameW', 'frameH', 'columns', 'rows')}
    atlas.update(key=NAME, image=f'atlases/{NAME}.png', pages=[{'scale': 2, 'image': f'atlases/{NAME}@2x.png'}], residency='stream')
    sprites = []
    for s in m['sprites']:
        if s['atlas'] != 'nature_roads':
            continue
        twin = copy.deepcopy(s)
        twin.update(key=s['key'] + '_spring', atlas=NAME, placeholder=s['key'])
        sprites.append(twin)
    assert len(sprites) == 51
    encode_atlas(base, atlas)
    merge_owned(mf, [atlas], sprites, 2)
    print('spring roads:', NAME, len(sprites), 'sprites')


if __name__ == '__main__':
    main()
