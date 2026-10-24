# Builds the items sub-manifest: icon / node / held atlases (1x + @2x pages) + manifest.items.json + contact sheets.
import json, math, os, sys
from concurrent.futures import ProcessPoolExecutor
from PIL import Image, ImageDraw, ImageFont
from draw import C
from table import T, HELD
from bonetools import BONE
HELD_C = list(BONE)  # held-only keys (icons live in the nature pack)
from nodes import N, SWAY
OUT = sys.argv[1]; PREV = sys.argv[2]
os.makedirs(OUT+'/atlases', exist_ok=True); os.makedirs(PREV, exist_ok=True)
import new8, vehicle_key
# icon cells: table.T (0-190), then the follow-up icons in commit order: new8 (191-198, 64357f1), vehicle_key (199, 29ef4c0)
EXTRA = list(new8.NEW8) + ['vehicle_key']
ICONS = list(T) + EXTRA; NODES = list(N)
def icon(k):
    if k == 'vehicle_key': return vehicle_key.render()
    c = C(32, 8); (T.get(k) or new8.NEW8[k])(c); out = c.out(64), c.out(32)
    if k in T: return out
    def comp(im): b = Image.new('RGBA', im.size, (0, 0, 0, 0)); b.alpha_composite(im); return b  # new8 cells were alpha-composited in (alpha-0 RGB zeroed)
    return tuple(comp(im) for im in out)
TILT = [0, -22, -38, -22, 0, 22, 38, 22]; SQ = [.62, .85, 1, .85, .62, .85, 1, .85]; DIM = [1, 1, 1, .9, .82, .9, 1, 1]
def held(k):
    import icons; icons.NOSHADOW[0] = True
    c = C(32, 8); (T.get(k) or BONE[k])(c); icons.NOSHADOW[0] = False
    src = Image.new('RGBA', (768, 768), (0, 0, 0, 0)); src.paste(c.img, (256, 256))  # padded so tilted rotations never clip
    gx, gy = 256+7.5*8, 256+24.5*8; res = []
    for scale, cell in ((2, 96), (1, 48)):
        frames = []
        for d in range(8):
            im = src.rotate(45 + TILT[d], resample=Image.BICUBIC, center=(gx, gy))  # diagonal -> vertical (+ facing tilt)
            if d in (1, 2, 3): im = im.transpose(Image.FLIP_LEFT_RIGHT); px = 768-gx
            else: px = gx
            f = 28*scale/256  # 32 units -> 28px at 1x
            W = max(1, int(768*f*SQ[d])); H = int(768*f)
            im = im.resize((W, H), Image.LANCZOS)
            if DIM[d] < 1:
                r, g, b, a = im.split(); r, g, b = [ch.point(lambda v, m=DIM[d]: int(v*m)) for ch in (r, g, b)]; im = Image.merge('RGBA', (r, g, b, a))
            fr = Image.new('RGBA', (cell, cell), (0, 0, 0, 0)); ax, ay = cell*.5, cell*.75
            fr.paste(im, (int(round(ax - px*f*SQ[d])), int(round(ay - gy*f))), im)  # crop via negative offsets is not allowed -> paste
            frames.append(fr)
        res.append(frames)
    return res
def node(k):
    out = []
    for d in (False, True):
        c = C(64, 4); N[k](c, d); out.append((c.out(128), c.out(64)))
    return out
def sheet(frames, cell, cols):
    rows = (len(frames)+cols-1)//cols; im = Image.new('RGBA', (cell*cols, cell*rows), (0, 0, 0, 0))
    for i, f in enumerate(frames): im.paste(f, ((i % cols)*cell, (i//cols)*cell))
    return im, rows
def paste_safe(dst, im, xy): dst.alpha_composite(im, xy)
if __name__ == '__main__':
    # fix negative paste offsets in held(): Image.alpha_composite requires dest>=0, so pad source instead
    with ProcessPoolExecutor(8) as ex:
        ic = list(ex.map(icon, ICONS)); hd = list(ex.map(held, HELD)); hc = list(ex.map(held, HELD_C)); nd = list(ex.map(node, NODES))
    man = {"version": 1, "name": "items", "atlases": [], "sprites": []}
    def atlas(key, f1, f2, cell, cols):
        a1, rows = sheet(f1, cell, cols); a2, _ = sheet(f2, cell*2, cols)
        assert max(a2.size) <= 2048, (key, a2.size)
        a1.save(f'{OUT}/atlases/{key}.png', optimize=True); a2.save(f'{OUT}/atlases/{key}@2x.png', optimize=True)
        man["atlases"].append({"key": key, "image": f"atlases/{key}.png", "frameW": cell, "frameH": cell, "columns": cols, "rows": rows, "pages": [{"scale": 2, "image": f"atlases/{key}@2x.png", "ktx2": f"atlases/{key}@2x.ktx2"}], "ktx2": f"atlases/{key}.ktx2"})  # ktx2 twins: assets/tools/ktx2.py
    atlas('items_icons', [x[1] for x in ic], [x[0] for x in ic], 32, 16)
    EQ = ('_axe', '_pickaxe', '_shovel', '_knife', '_helmet', '_cuirass', '_greaves', '_boots', '_gauntlets', '_hat', '_cap', '_hood', '_shirt', '_jacket', '_coat', 'raincoat', '_trousers', '_leggings', '_sandals', '_gloves', '_mittens', '_cloak', '_satchel', '_backpack', '_pack')
    for i, k in enumerate(T):
        cat = "equipment" if (k in HELD or any(k.endswith(s) for s in EQ)) else "item"
        man["sprites"].append({"key": k, "category": cat, "atlas": "items_icons", "anchor": {"x": 0.5, "y": 0.5}, "animations": {"idle": {"frames": [i], "fps": 1}}})
    atlas('items_nodes', [f for n in nd for f in (n[0][1], n[1][1])], [f for n in nd for f in (n[0][0], n[1][0])], 64, 8)
    for i, k in enumerate(NODES):
        s = {"key": k, "category": "resource", "atlas": "items_nodes", "anchor": {"x": 0.5, "y": 0.875}, "animations": {"idle": {"frames": [2*i], "fps": 1}, "depleted": {"frames": [2*i+1], "fps": 1}}}
        man["sprites"].append(s)
    half = (len(HELD)+1)//2
    for part, ks, hs in (('a', HELD[:half], hd[:half]), ('b', HELD[half:], hd[half:])):
        key = f'items_held_{part}'; atlas(key, [f for h in hs for f in h[1]], [f for h in hs for f in h[0]], 48, 16)
        for i, k in enumerate(ks):
            man["sprites"].append({"key": f"held_{k}", "category": "equipment", "atlas": key, "anchor": {"x": 0.5, "y": 0.75}, "animations": {"idle": {"frames": [8*i], "fps": 1, "directions": 8, "dirStride": 1}}})
    for k in EXTRA:  # sprite order matches the follow-up commits (appended after the held sprites)
        man["sprites"].append({"key": k, "category": "item", "atlas": "items_icons", "anchor": {"x": 0.5, "y": 0.5}, "animations": {"idle": {"frames": [ICONS.index(k)], "fps": 1}}})
    atlas('items_held_c', [f for h in hc for f in h[1]], [f for h in hc for f in h[0]], 48, 16)
    for i, k in enumerate(HELD_C):
        man["sprites"].append({"key": f"held_{k}", "category": "equipment", "atlas": 'items_held_c', "anchor": {"x": 0.5, "y": 0.75}, "animations": {"idle": {"frames": [8*i], "fps": 1, "directions": 8, "dirStride": 1}}})
    json.dump(man, open(f'{OUT}/manifest.items.json', 'w'), indent=1); open(f'{OUT}/manifest.items.json', 'a').write('\n')
    # contact sheets
    font = ImageFont.load_default()
    def contact(name, items, cell, cols, label_h=12):
        rows = (len(items)+cols-1)//cols; W, H = cell+8, cell+8+label_h
        im = Image.new('RGBA', (cols*W, rows*H), (104, 150, 98, 255)); d = ImageDraw.Draw(im)
        for i, (k, f) in enumerate(items):
            x, y = (i % cols)*W, (i//cols)*H; im.alpha_composite(f, (x+4, y+4)); d.text((x+3, y+cell+6), k[:int(W/6)], fill=(255, 255, 240), font=font)
        im.convert('RGB').save(f'{PREV}/{name}.png')
    contact('items_icons_2x', [(k, x[0]) for k, x in zip(ICONS, ic)], 64, 16)
    contact('items_nodes_2x', [(k+(' (dep)' if d else ''), n[d][0]) for k, n in zip(NODES, nd) for d in (0, 1)], 128, 8)
    contact('items_held_2x', [(k, h[0][d]) for k, h in zip(HELD + HELD_C, hd + hc) for d in (0, 2, 4, 6)], 96, 16)
    print(len(ICONS), len(NODES), len(HELD))
