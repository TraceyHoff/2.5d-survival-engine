#!/usr/bin/env python3
"""Restore opaque G-channel hair tips in existing packed sheets, without repainting.
Same trim-invariant recipe as Ctx.out; preserves all color pages and manifest rects.
Usage: python3 restore_cel_hair_tint.py ENGINE_DIR
"""
import sys, os
from PIL import Image
import numpy as np
import rerender
from rig import cel_hair_tips


def main(engine):
    root = os.path.join(engine, 'packages/assets/pack/customization')
    m = rerender.czm.load(os.path.join(root, 'manifest.customization.json'))
    sprites = {s['key']: s for s in m['sprites']}
    atlases = {a['key']: a for a in m['atlases']}
    keys = {s['key'] for s in m['sprites'] if s['key'].startswith('cz_hair_')}
    pages, visited = {}, set()
    for key in sorted(keys):
        for an in sprites[key]['animations'].values():
            for entry in an.get('dirFrames', []):
                ak, r = entry['atlas'], entry['rect']
                rect = tuple(r[k] for k in ('x', 'y', 'w', 'h'))
                if (ak, rect) in visited:
                    continue
                visited.add((ak, rect))
                path = atlases[ak]['masks']['tintmask']
                if path not in pages:
                    pages[path] = np.array(Image.open(os.path.join(root, path)).convert('RGB'))
                x, y, w, h = rect
                pages[path][y:y+h, x:x+w] = cel_hair_tips(pages[path][y:y+h, x:x+w])
    for path, array in sorted(pages.items()):
        Image.fromarray(array, 'RGB').save(os.path.join(root, path), optimize=True)
    print('Restored solid secondary hair tips:', len(keys), 'sprites,', len(pages), 'packed masks')


if __name__ == '__main__':
    main(sys.argv[1])
