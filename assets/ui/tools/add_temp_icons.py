#!/usr/bin/env python3
"""Append the temperature HUD icons (icon_temp, icon_temp_hot, icon_temp_cold) to the TP UI atlas.

Source art: packages/assets/pack/items/atlases/items_temp(@2x).png (built by items/src/temps.py,
3 x 32px cells at 1x, 64px at @2x; frame indices read from manifest.items.json).
Append-only: places frames in free, fully transparent space (2px padding) of the existing
ui_atlas(.png/.json) and @2x at identical 2x coordinates; never moves existing frames. Idempotent.
Run after gen_kit.py if the kit is regenerated:  python3 assets/ui/tools/add_temp_icons.py
"""
import json, os
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
ATL = os.path.join(ROOT, 'assets/ui/atlas')
SRC = os.path.join(ROOT, 'packages/assets/pack/items')
PAD = 2
KEYS = ['icon_temp', 'icon_temp_hot', 'icon_temp_cold']


def src_frames():
    m = json.load(open(os.path.join(SRC, 'manifest.items.json')))
    sp = {s['key']: s for s in m['sprites']}
    at = {a['key']: a for a in m['atlases']}
    out = {1: {}, 2: {}}
    for k in KEYS:
        s = sp[k]; a = at[s['atlas']]; i = s['animations']['idle']['frames'][0] if 'animations' in s else s['frame']
        for sc in (1, 2):
            rel = a['image'] if sc == 1 else next(pg['image'] for pg in a['pages'] if pg['scale'] == 2)
            img = Image.open(os.path.join(SRC, rel)).convert('RGBA')
            fw, fh = a['frameW'] * sc, a['frameH'] * sc
            cols = a['columns']
            out[sc][k] = img.crop(((i % cols) * fw, (i // cols) * fh, (i % cols + 1) * fw, (i // cols + 1) * fh))
    return out


def main():
    srcs = src_frames()
    j1 = json.load(open(os.path.join(ATL, 'ui_atlas.json')))
    j2 = json.load(open(os.path.join(ATL, 'ui_atlas@2x.json')))
    p1 = Image.open(os.path.join(ATL, 'ui_atlas.png')).convert('RGBA')
    p2 = Image.open(os.path.join(ATL, 'ui_atlas@2x.png')).convert('RGBA')
    W, H = p1.size
    occ = bytearray(W * H)
    def mark(x, y, w, h):
        for yy in range(max(0, y - PAD), min(H, y + h + PAD)):
            occ[yy * W + max(0, x - PAD): yy * W + min(W, x + w + PAD)] = b'\x01' * (min(W, x + w + PAD) - max(0, x - PAD))
    for k, f in j1['frames'].items():
        if k in KEYS: continue
        r = f['frame']; mark(r['x'], r['y'], r['w'], r['h'])
    alpha = p1.getchannel('A').load()
    def free(x, y, w, h):
        for yy in range(y - PAD, y + h + PAD):
            if any(occ[yy * W + x - PAD: yy * W + x + w + PAD]): return False
        return all(alpha[xx, yy] == 0 for yy in range(y, y + h) for xx in range(x, x + w))
    for k in KEYS:
        w, h = srcs[1][k].size
        if k in j1['frames']:
            r = j1['frames'][k]['frame']; x, y = r['x'], r['y']
        else:
            x = y = None
            for yy in range(PAD, H - h - PAD):
                for xx in range(PAD, W - w - PAD):
                    if free(xx, yy, w, h): x, y = xx, yy; break
                if x is not None: break
            if x is None: raise SystemExit('no free space for ' + k)
        mark(x, y, w, h)
        for sc, j, p in ((1, j1, p1), (2, j2, p2)):
            im = srcs[sc][k]; X, Y = x * sc, y * sc; ww, hh = im.size
            p.paste((0, 0, 0, 0), (X, Y, X + ww, Y + hh)); p.alpha_composite(im, (X, Y))
            j['frames'][k] = {"frame": {"x": X, "y": Y, "w": ww, "h": hh}, "rotated": False, "trimmed": False,
                              "spriteSourceSize": {"x": 0, "y": 0, "w": ww, "h": hh}, "sourceSize": {"w": ww, "h": hh},
                              "pivot": {"x": 0.5, "y": 0.5}, "tags": ["icon", "hud", "temperature"]}
        print(k, (x, y))
    p1.save(os.path.join(ATL, 'ui_atlas.png'), optimize=True); p2.save(os.path.join(ATL, 'ui_atlas@2x.png'), optimize=True)
    json.dump(j1, open(os.path.join(ATL, 'ui_atlas.json'), 'w'), indent=1)
    json.dump(j2, open(os.path.join(ATL, 'ui_atlas@2x.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
