#!/usr/bin/env python3
"""Paint leaf-out/blossoms from summer SOURCE silhouettes, never finished seasonal art.

Run from repo root; SEASONS_SRC may override the existing source cache.
Only owns season_{tall,res,huge}_spring pages and eight *_spring plant keys.
Imports packing/classification helpers only: never calls seasons_art build/merge.
"""
import copy
import json

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

import seasons_art as art
from artpass_spring_common import encode_atlas, merge_owned

KEYS = ['tree', 'tree_apple', 'tree_pine', 'oak_tree', 'bush', 'berry_bush', 'fiber_grass', 'flowers']
GROUPS = {'resources_tall': 'season_tall_spring', 'resources': 'season_res_spring', 'resources_huge': 'season_huge_spring'}
# A new three-step cel ramp (hard shade / fill / highlight), not an HSV shift.
RAMPS = {
    'tree': ['#548540', '#94c953', '#d8ed88'],
    'tree_apple': ['#577d3e', '#a0ca58', '#e2ed96'],
    'tree_pine': ['#315f43', '#548d49', '#90b95d'],
    'oak_tree': ['#55783b', '#a6c951', '#dce98b'],
    'bush': ['#4d7b3b', '#9bc84d', '#d5e97e'],
    'berry_bush': ['#507a3c', '#94c64e', '#d8e98b'],
    'fiber_grass': ['#57843b', '#a3ce4c', '#dfeb89'],
    'flowers': ['#517d3c', '#9ec64e', '#d8e98a'],
}
BLOOMS = [('#a85c7a', '#f3b8d0', '#fff4e8'), ('#8c7185', '#fce5e7', '#fffbed'), ('#80603c', '#eacb55', '#fff294')]


def blossom(d, x, y, radius, palette):
    """Five round petals with a hard lower shade, highlight, and pollen centre."""
    ink, fill, light = palette
    for j in range(5):
        a = j * np.pi * 2 / 5 - np.pi / 2
        cx, cy = x + np.cos(a) * radius * .63, y + np.sin(a) * radius * .63
        r = radius * .57
        box = (cx - r, cy - r, cx + r, cy + r)
        d.ellipse(box, fill=ink)
        d.ellipse((cx - r, cy - r, cx + r * .65, cy + r * .4), fill=fill)
    d.ellipse((x - radius * .38, y - radius * .55, x + radius * .12, y - radius * .1), fill=light)
    r = max(.5, radius * .23)
    d.ellipse((x - r, y - r, x + r, y + r), fill='#f4d66d')


def paint(key, source, fi, scale):
    img = art.binary(source)
    op, fol, fruit, petal, v = art.classes(source, flower=key == 'flowers')
    # Warm bark can also pass the red-fruit HSV test. Restrict fruit removal to
    # the canopy envelope; never paint trunk/roots into lime foliage.
    yy = np.indices(op.shape)[0]
    canopy_bottom = np.max(np.nonzero(fol)[0]) if fol.any() else 0
    fruit &= yy <= canopy_bottom
    # Remove fruit AND the enclosed dark fruit rims without changing bark/outline.
    scars = art.enclosed_bits(source, op, fol, 90 * scale * scale) | fruit if key in ('tree_apple', 'berry_bush', 'oak_tree') else np.zeros_like(fol)
    if scars.any():
        # Heal fruit rims and cast shadows into neighbouring leaf fill, not pockmarks.
        scars |= ndimage.binary_dilation(fruit, iterations=3 * scale) & ndimage.binary_erosion(op, iterations=scale)
        scars |= ndimage.binary_dilation(scars, iterations=2 * scale) & fol
        scars &= yy <= canopy_bottom
    fol |= scars
    band = art.bands(v, fol, 3)
    if scars.any():
        _, indices = ndimage.distance_transform_edt(~(fol & ~scars), return_indices=True)
        band[scars] = band[tuple(i[scars] for i in indices)]
    img[fol, :3] = art.ramp(RAMPS[key])[band[fol]]
    if key == 'fiber_grass':
        # Immature spring seed heads, not the summer's ripe golden cattails.
        yy = np.indices(op.shape)[0]
        head = op & ~fol & (v > .42) & (yy < 29 * scale)
        hb = art.bands(v, head, 3)
        img[head, :3] = art.ramp(['#718c43', '#bdd86b', '#eceda2'])[hb[head]]
    # Fresh crocus/daffodil/pink clumps replace the summer petal colours entirely.
    if petal.any():
        labels, n = ndimage.label(petal)
        for label in range(1, n + 1):
            m = labels == label
            palette = [('#765699', '#b79bd9', '#e5d6ef'), BLOOMS[2], BLOOMS[0]][label % 3]
            pb = art.bands(v, m, 3)
            img[m, :3] = art.ramp(palette)[pb[m]]
    layer = Image.new('RGB', (img.shape[1], img.shape[0]))
    draw = ImageDraw.Draw(layer)
    cover = Image.new('1', layer.size)
    mark = ImageDraw.Draw(cover)
    # Pick locations from the 1x source so both scales have the same arrangement.
    base = art.src(art.SP[key]['atlas'], fi, 1)
    _, basefol, basefruit, _, _ = art.classes(base)
    eligible = basefol if key == 'fiber_grass' else ndimage.binary_erosion(basefol | basefruit, iterations=1 if key == 'flowers' else 2)
    ys, xs = np.nonzero(eligible)
    rng = np.random.default_rng(sum(map(ord, key)) * 19 + fi)
    spacing = 10 if key in ('tree', 'tree_apple', 'oak_tree') else 6
    count = {'tree': 11, 'tree_apple': 18, 'oak_tree': 21, 'bush': 5, 'berry_bush': 9, 'fiber_grass': 4, 'flowers': 6, 'tree_pine': 16}[key]
    chosen = []
    for idx in rng.permutation(len(xs)):
        x, y = int(xs[idx]), int(ys[idx])
        if any((x - px)**2 + (y - py)**2 < spacing**2 for px, py in chosen):
            continue
        chosen.append((x, y))
        if len(chosen) >= count:
            break
    for j, (x, y) in enumerate(chosen):
        x, y = (x + .5) * scale, (y + .5) * scale
        if key in ('tree_pine', 'fiber_grass'):
            # New-growth candles/shoots: upright lime spear with a hard light tip.
            points = [(x - scale, y + 2 * scale), (x, y - 3 * scale), (x + 1.5 * scale, y + scale)]
            draw.polygon(points, fill='#b5d969')
            draw.line((x, y - 2 * scale, x, y + scale), fill='#edf1a1', width=scale)
            mark.polygon(points, fill=1)
        else:
            radius = (3 if key == 'oak_tree' else 2.5 if key == 'tree_apple' else 2) * scale
            palette = BLOOMS[j % 2] if key != 'flowers' else [BLOOMS[2], ('#765699', '#b79bd9', '#e5d6ef'), BLOOMS[0]][j % 3]
            blossom(draw, x, y, radius, palette)
            # Use the exact rendered shape, not its bounding box, as the paint mask.
            temp = Image.new('RGB', layer.size)
            blossom(ImageDraw.Draw(temp), x, y, radius, palette)
            cover = Image.fromarray(np.asarray(cover) | np.any(np.asarray(temp) > 0, axis=-1))
            mark = ImageDraw.Draw(cover)
    mask = np.asarray(cover).astype(bool) & fol  # no bark/outline or silhouette damage
    img[mask, :3] = np.asarray(layer)[mask]
    return art.binary(img)


def main():
    # Always reload the true manifest; seasons_art's in-memory summer lookup is not merged.
    mf = art.R + 'manifest.json'
    m = json.load(open(mf))
    at = {a['key']: a for a in m['atlases']}
    sp = {s['key']: s for s in m['sprites']}
    atlases, sprites = [], []
    for source_atlas, name in GROUPS.items():
        a = at[source_atlas]
        frames, sways = {1: [], 2: []}, []
        for key in KEYS:
            if sp[key]['atlas'] != source_atlas:
                continue
            s = sp[key]
            twin = copy.deepcopy(s)
            twin.update(key=key + '_spring', atlas=name, placeholder=key, anchor=art.pad_anchor(s['anchor'], a['frameW'], a['frameH']))
            for anim, ad in s['animations'].items():
                indices = []
                for fi in ad['frames']:
                    indices.append(len(frames[1]))
                    for scale in (1, 2):
                        frames[scale].append(paint(key, art.src(source_atlas, fi, scale), fi, scale))
                    sways.append(art.frame(source_atlas, fi, 'sway'))
                twin['animations'][anim]['frames'] = indices
            sprites.append(twin)
        atlas = art.pack_grid(name, frames, a['frameW'], a['frameH'], sways)
        encode_atlas(art.R, atlas)
        atlases.append(atlas)
    merge_owned(mf, atlases, sprites, 2)
    print('spring foliage:', [a['key'] for a in atlases], len(sprites), 'sprites')


if __name__ == '__main__':
    main()
