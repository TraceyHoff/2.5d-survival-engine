#!/usr/bin/env python3
"""Append status-effect HUD icons painted with the uikit (same Ink style as the st_* icons in uikit/icons.py)
to the UI atlas: `broken_leg` (fall of 5+ tiles; healed by a Leg Splint).

Append-only, like add_temp_icons.py: free fully-transparent space with 2px padding in ui_atlas(.png/.json),
@2x at identical 2x coordinates; never moves existing frames. Idempotent (repaints in place).
Run after gen_kit.py if the kit is regenerated:  python3 assets/ui/tools/add_status_icons.py
"""
import json, os, sys
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from uikit.icon import Ink
from uikit.kit import P, INK
from uikit.draw import blob, star

ATL = os.path.join(HERE, '..', 'atlas')
PAD = 2


def broken_leg(c):
    """Chunky cartoon leg whose shin kinks the wrong way: zigzag crack, puffy bruise, ouch-star. Body-part crop, no gore."""
    skin = '#FFC9A0'
    c.part([(4.5, 1.5), (13.5, 1.5), (13.0, 8.5), (5.0, 9.5)], P['blue-500'])                         # shorts
    c.part([(5.6, 8.0), (12.8, 7.4), (13.4, 15.2), (18.6, 17.4), (15.8, 23.6), (7.6, 18.2)], skin)       # thigh + knee + upper shin
    c.part([(13.4, 15.2), (20.2, 15.0), (26.4, 25.4), (20.4, 27.6), (15.4, 23.0)], skin)                               # lower shin, bent off-axis
    c.part([(20.4, 24.6), (25.8, 24.0), (30.2, 27.2), (29.8, 30.2), (20.8, 30.2)], P['red-500'])          # sneaker
    c.line([(21.2, 29.0), (29.6, 29.0)], P['white'], 1.0)
    c.part(blob(16.4, 18.6, 3.4, 2.8, wob=0.3, seed=51), P['berry-300'], ow=1.2)                         # swollen bump
    zz = [(13.8, 15.6), (16.2, 17.0), (14.8, 18.6), (18.0, 19.8), (16.8, 21.6)]
    c.line(zz, INK, 1.5); c.line(zz, P['white'], 0.6)                                                     # crack
    c.part(star(25.5, 8.5, 6.4, 2.9, 5, wob=0.2, seed=52), P['sun-300'], ow=1.2)                          # ouch!
    c.line([(20.0, 14.6), (21.8, 13.0)], INK, 1.0); c.line([(22.2, 16.6), (24.2, 15.8)], INK, 1.0)
    c.shine(7.4, 4.5, 1.0, 1.6, 190); c.shine(8.6, 12.0, 0.9, 1.6, 170)


ICONS = {'broken_leg': broken_leg}


def render(fn, sc):
    c = Ink(32, 32, sc); fn(c); return c.out()


def main():
    j1 = json.load(open(os.path.join(ATL, 'ui_atlas.json'))); j2 = json.load(open(os.path.join(ATL, 'ui_atlas@2x.json')))
    p1 = Image.open(os.path.join(ATL, 'ui_atlas.png')).convert('RGBA'); p2 = Image.open(os.path.join(ATL, 'ui_atlas@2x.png')).convert('RGBA')
    W, H = p1.size; occ = bytearray(W * H)
    def mark(x, y, w, h):
        for yy in range(max(0, y - PAD), min(H, y + h + PAD)):
            a, b = max(0, x - PAD), min(W, x + w + PAD); occ[yy * W + a: yy * W + b] = b'\x01' * (b - a)
    for k, f in j1['frames'].items():
        if k in ICONS: continue
        r = f['frame']; mark(r['x'], r['y'], r['w'], r['h'])
    al = p1.getchannel('A').load()
    def free(x, y, w, h):
        for yy in range(y - PAD, y + h + PAD):
            if any(occ[yy * W + x - PAD: yy * W + x + w + PAD]): return False
        return all(al[xx, yy] == 0 for yy in range(y, y + h) for xx in range(x, x + w))
    for k, fn in ICONS.items():
        ims = {1: render(fn, 1), 2: render(fn, 2)}; w, h = ims[1].size
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
            im = ims[sc]; X, Y = x * sc, y * sc; ww, hh = im.size
            p.paste((0, 0, 0, 0), (X, Y, X + ww, Y + hh)); p.alpha_composite(im, (X, Y))
            j['frames'][k] = {"frame": {"x": X, "y": Y, "w": ww, "h": hh}, "rotated": False, "trimmed": False,
                              "spriteSourceSize": {"x": 0, "y": 0, "w": ww, "h": hh}, "sourceSize": {"w": ww, "h": hh},
                              "pivot": {"x": 0.5, "y": 0.5}, "tags": ["icon", "hud", "status"]}
        print(k, (x, y))
    p1.save(os.path.join(ATL, 'ui_atlas.png'), optimize=True); p2.save(os.path.join(ATL, 'ui_atlas@2x.png'), optimize=True)
    json.dump(j1, open(os.path.join(ATL, 'ui_atlas.json'), 'w'), indent=1); json.dump(j2, open(os.path.join(ATL, 'ui_atlas@2x.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
