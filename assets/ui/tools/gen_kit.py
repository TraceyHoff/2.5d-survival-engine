#!/usr/bin/env python3
"""Generate the Cozy Camp UI kit.

Outputs (relative to assets/ui):
  atlas/ui_atlas.png, atlas/ui_atlas@2x.png, atlas/ui_atlas.json, atlas/ui_atlas@2x.json  (TexturePacker JSON hash, 2px padding)
  atlas/engine/ui_kit_<w>x<h>.png (+@2x)  + atlas/engine/manifest.ui.json  (@engine/assets manifest v1 grid atlases + nineSlice)
  atlas/frames/<name>.png (1x, handy for CSS/DOM prototypes)
Run:  python3 tools/gen_kit.py   (Pillow >= 10)
"""
import json, math, os, sys
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
from uikit import kit  # noqa

UI = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT = os.path.join(UI, 'atlas')
PAD = 2
MAX = 2048


def pack(sizes, pad=PAD, max_w=MAX):
    """Skyline-ish shelf packer: sort by height desc, fill shelves; picks smallest POT-ish width that fits."""
    order = sorted(sizes, key=lambda k: (-sizes[k][1], -sizes[k][0], k))
    for W in (256, 512, 768, 1024, 1536, 2048):
        if W > max_w:
            break
        pos = {}; x = pad; y = pad; shelf = 0; ok = True
        for k in order:
            w, h = sizes[k]
            if w + 2 * pad > W:
                ok = False; break
            if x + w + pad > W:
                x = pad; y += shelf + pad; shelf = 0
            pos[k] = (x, y); x += w + pad; shelf = max(shelf, h)
        H = y + shelf + pad
        if ok and H <= max_w and H <= W * 1.25:
            return pos, W, (H + 3) // 4 * 4
    raise SystemExit('atlas overflow: split into pages')


def main():
    os.makedirs(os.path.join(OUT, 'frames'), exist_ok=True)
    os.makedirs(os.path.join(OUT, 'engine'), exist_ok=True)
    names = list(kit.SPRITES)
    imgs = {1: {}, 2: {}}
    for n in names:
        for sc in (1, 2):
            im = kit.render(n, sc)
            s = kit.SPRITES[n]
            assert im.size == (s['w'] * sc, s['h'] * sc), (n, im.size)
            imgs[sc][n] = im
        imgs[1][n].save(os.path.join(OUT, 'frames', f'{n}.png'))
    sizes = {n: imgs[1][n].size for n in names}
    pos, W, H = pack(sizes)
    for sc in (1, 2):
        sheet = Image.new('RGBA', (W * sc, H * sc), (0, 0, 0, 0))
        frames = {}
        for n in names:
            x, y = pos[n]; s = kit.SPRITES[n]
            sheet.alpha_composite(imgs[sc][n], (x * sc, y * sc))
            w, h = s['w'] * sc, s['h'] * sc
            f = {"frame": {"x": x * sc, "y": y * sc, "w": w, "h": h}, "rotated": False, "trimmed": False,
                 "spriteSourceSize": {"x": 0, "y": 0, "w": w, "h": h}, "sourceSize": {"w": w, "h": h},
                 "pivot": {"x": s['pivot'][0], "y": s['pivot'][1]}}
            if s['nine']:
                l, t, r, b = [v * sc for v in s['nine']]
                f["nineSlice"] = {"l": l, "t": t, "r": r, "b": b}
                # Phaser/TexturePacker-style alias
                f["scale9Borders"] = {"x": l, "y": t, "w": w - l - r, "h": h - t - b}
            if s['hotspot']:
                f["hotspot"] = {"x": s['hotspot'][0] * sc, "y": s['hotspot'][1] * sc}
            if s['tags']:
                f["tags"] = s['tags']
            frames[n] = f
        suffix = '' if sc == 1 else '@2x'
        img_name = f'ui_atlas{suffix}.png'
        sheet.save(os.path.join(OUT, img_name), optimize=True)
        meta = {"app": "cozy-camp ui/tools/gen_kit.py (TexturePacker JSON hash compatible)", "version": "1.0",
                "image": img_name, "format": "RGBA8888", "size": {"w": W * sc, "h": H * sc}, "scale": str(sc),
                "padding": PAD * sc, "nineSliceEdgeMode": "stretch", "theme": "../theme.json",
                "note": "frames[*].nineSlice = {l,t,r,b} px insets (same shape as @engine/assets NineSlice)."}
        json.dump({"frames": frames, "meta": meta}, open(os.path.join(OUT, f'ui_atlas{suffix}.json'), 'w'), indent=1)
    print('TP atlas', W, 'x', H, 'frames', len(names))

    # ---------- @engine/assets manifest v1: one grid atlas per frame size ----------
    # 9-slice frames must be exact-size cells (stretching a padded cell would stretch transparency);
    # non-9-slice frames are centred in the smallest standard cell they fit, to keep the page count low.
    CELLS = [(32, 32), (48, 48), (176, 176)]
    groups = {}; place = {}
    for n in names:
        s = kit.SPRITES[n]; w, h = sizes[n]
        cell = (w, h)
        if not s['nine']:
            cell = next(((cw, ch) for cw, ch in CELLS if w <= cw and h <= ch), (w, h))
        groups.setdefault(cell, []).append(n)
        place[n] = ((cell[0] - w) // 2, (cell[1] - h) // 2)
    atlases, sprites, index = [], [], {}
    for (w, h), members in sorted(groups.items(), key=lambda kv: (-kv[0][0] * kv[0][1])):
        n = len(members)
        cols = max(1, min(n, MAX // (w * 2), math.ceil(math.sqrt(n * h / w))))
        rows = math.ceil(n / cols)
        key = f'ui_kit_{w}x{h}'
        for sc in (1, 2):
            page = Image.new('RGBA', (cols * w * sc, rows * h * sc), (0, 0, 0, 0))
            for i, m in enumerate(members):
                ox, oy = place[m]
                page.alpha_composite(imgs[sc][m], (((i % cols) * w + ox) * sc, ((i // cols) * h + oy) * sc))
            page.save(os.path.join(OUT, 'engine', f'{key}{"" if sc == 1 else "@2x"}.png'), optimize=True)
        at = {"key": key, "image": f'{key}.png', "frameW": w, "frameH": h, "columns": cols, "rows": rows, "pages": [{"scale": 2, "image": f"{key}@2x.png"}]}
        ns = {str(i): dict(zip("ltrb", kit.SPRITES[m]['nine'])) for i, m in enumerate(members) if kit.SPRITES[m]['nine']}
        if ns:
            at["nineSlice"] = ns
        atlases.append(at)
        for i, m in enumerate(members):
            s = kit.SPRITES[m]; ox, oy = place[m]; sw, sh = sizes[m]
            ax = round((ox + s['pivot'][0] * sw) / w, 4); ay = round((oy + s['pivot'][1] * sh) / h, 4)
            sprites.append({"key": f'ui_{m}', "category": "ui", "atlas": key, "anchor": {"x": ax, "y": ay},
                            "animations": {"idle": {"frames": [i], "fps": 1}}})
            index[m] = {"atlas": key, "frame": i, "offset": [ox, oy], "size": [sw, sh]}
    manifest = {"version": 1, "name": "ui-cozy-camp", "atlases": atlases, "sprites": sprites}
    json.dump(manifest, open(os.path.join(OUT, 'engine', 'manifest.ui.json'), 'w'), indent=1)
    extra = {n: {"hotspot": [kit.SPRITES[n]['hotspot'][0] + place[n][0], kit.SPRITES[n]['hotspot'][1] + place[n][1]]} for n in names if kit.SPRITES[n]['hotspot']}
    json.dump({"hiDpi": {"suffix": "@2x", "scale": 2, "note": "identical grid layout at 2x; insets x2"},
               "cursors": extra, "index": index}, open(os.path.join(OUT, 'engine', 'manifest.ui.extras.json'), 'w'), indent=1)
    print('engine atlases', [(a['key'], a['columns'], a['rows']) for a in atlases])


if __name__ == '__main__':
    main()
