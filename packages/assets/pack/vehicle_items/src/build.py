# Builds the vehicle_items sub-manifest: inventory icons (fuels, parts, repair kits, vehicle kits, reeds/flax) + piece_garage
# (4 rotations x 4 damage stages, tiers 1-3, crack overlay). 1x + @2x pages, <=2048px, art kept >=2px inside every cell.
# Usage: cd src && python3 build.py .. <preview dir>
import json, os, sys
from concurrent.futures import ProcessPoolExecutor
from PIL import Image, ImageDraw, ImageFont
from draw import C
import vicons, kits, garage
OUT, PREV = sys.argv[1], sys.argv[2]; os.makedirs(OUT+'/atlases', exist_ok=True); os.makedirs(PREV, exist_ok=True)
ICONS = list(vicons.T) + [f'item_vehicle_kit_{k}' for k in kits.KITS]
def icon(k):
    if k.startswith('item_vehicle_kit_'): c = kits.kit(k[len('item_vehicle_kit_'):])
    else: c = C(32, 8); vicons.T[k](c)
    return c.out(64), c.out(32)
def gframe(a): return garage.build(*a)
def sheet(frames, cell, cols):
    rows = (len(frames)+cols-1)//cols; im = Image.new('RGBA', (cell*cols, cell*rows), (0, 0, 0, 0))
    for i, f in enumerate(frames): im.paste(f, ((i % cols)*cell, (i//cols)*cell))
    return im, rows
if __name__ == '__main__':
    with ProcessPoolExecutor(8) as ex:
        ic = list(ex.map(icon, ICONS))
        G = {t: list(ex.map(gframe, [(r, s, t) for r in range(4) for s in range(4)])) for t in (1, 2, 3)}
        CR = list(ex.map(garage.crack, (1, 2, 3)))
    man = {"version": 1, "name": "vehicle_items", "atlases": [], "sprites": []}
    def atlas(key, f1, f2, cell, cols):
        a1, rows = sheet(f1, cell, cols); a2, _ = sheet(f2, cell*2, cols); assert max(a2.size) <= 2048, (key, a2.size)
        a1.save(f'{OUT}/atlases/{key}.png', optimize=True); a2.save(f'{OUT}/atlases/{key}@2x.png', optimize=True)
        man["atlases"].append({"key": key, "image": f"atlases/{key}.png", "frameW": cell, "frameH": cell, "columns": cols, "rows": rows, "pages": [{"scale": 2, "image": f"atlases/{key}@2x.png"}]})
    atlas('vitems_icons', [x[1] for x in ic], [x[0] for x in ic], 32, 16)
    for i, k in enumerate(ICONS):
        man["sprites"].append({"key": k, "category": "item", "atlas": "vitems_icons", "anchor": {"x": 0.5, "y": 0.5}, "animations": {"idle": {"frames": [i], "fps": 1}}})
    # Survival's vehicle_items.json has no `sprite` overrides, so InventorySlotView.icon is the bare item key (plant_oil);
    # ART_KEYS_VEHICLES.md lists item_<key>. Emit both: item_<key> plus a bare-key alias wherever the bare key is free in the merge.
    taken = set()
    for f in ('../../manifest.json', '../../items/manifest.items.json', '../../vehicles/manifest.vehicles.json', '../../customization/manifest.customization.json', '../../../../../assets/ui/kit/manifest.ui.kit.json', '../../../../../assets/ui/branding/manifest.branding.json'):
        if os.path.exists(f): taken |= {x['key'] for x in json.load(open(f)).get('sprites', [])}
    ALIASED = []
    for i, k in enumerate(ICONS):
        b = k[5:]
        if k in ('item_reeds', 'item_flax') or b in taken: continue
        ALIASED.append(b); man["sprites"].append({"key": b, "category": "item", "atlas": "vitems_icons", "anchor": {"x": 0.5, "y": 0.5}, "animations": {"idle": {"frames": [i], "fps": 1}}})
    print('aliases', len(ALIASED), 'skipped (bare key taken):', [k[5:] for k in ICONS if k[5:] in taken and k not in ('item_reeds', 'item_flax')])
    G1 = [f for f in G[1]] + CR
    atlas('vitems_garage', [f[1] for f in G1], [f[0] for f in G1], garage.CELL, 5)
    for t in (2, 3): atlas(f'vitems_garage_t{t}', [f[1] for f in G[t]], [f[0] for f in G[t]], garage.CELL, 5)
    anchor = {"x": garage.PX/garage.CELL, "y": garage.PY/garage.CELL}
    man["sprites"].append({"key": "piece_garage_crack", "category": "vfx", "atlas": "vitems_garage", "anchor": anchor,
                           "animations": {f"stage{s}": {"frames": [15+s], "fps": 1} for s in (1, 2, 3)}})
    for t, key, atl in ((1, "piece_garage", "vitems_garage"), (2, "piece_garage_tier2", "vitems_garage_t2"), (3, "piece_garage_tier3", "vitems_garage_t3")):
        man["sprites"].append({"key": key, "category": "building", "atlas": atl, "anchor": anchor, "animations": {"idle": {"frames": [0], "fps": 1}},
            "building": {"piece": "garage" if t == 1 else f"garage@tier{t}", "footprint": {"w": 3, "h": 2}, "layer": 2,
                         "frames": [[r*4+s for s in range(4)] for r in range(4)], "crackOverlay": "piece_garage_crack"},
            "rotationArt": "unique4", "attach": {"craft_station": {"x": 0.0, "y": -30.0}, "door": {"x": -32.0, "y": 8.0}}})
    json.dump(man, open(f'{OUT}/manifest.vehicle_items.json', 'w'), indent=1); open(f'{OUT}/manifest.vehicle_items.json', 'a').write('\n')
    font = ImageFont.load_default()
    def contact(name, items, cell, cols, label_h=12):
        rows = (len(items)+cols-1)//cols; W, H = cell+8, cell+8+label_h
        im = Image.new('RGBA', (cols*W, rows*H), (104, 150, 98, 255)); d = ImageDraw.Draw(im)
        for i, (k, f) in enumerate(items):
            x, y = (i % cols)*W, (i//cols)*H; im.alpha_composite(f, (x+4, y+4)); d.text((x+3, y+cell+6), k[:int(W/6)], fill=(255, 255, 240), font=font)
        im.convert('RGB').save(f'{PREV}/{name}.png')
    contact('vehicle_items_icons_2x', [(k.replace('item_vehicle_kit_', 'kit_').replace('item_', ''), x[0]) for k, x in zip(ICONS, ic)], 64, 12)
    contact('piece_garage_2x', [(f't{t} r{i//4} d{i%4}', f[0]) for t in (1, 2, 3) for i, f in enumerate(G[t])], 352, 4)
    print(len(ICONS), 'icons;', 'garage frames', sum(len(v) for v in G.values()), '+ crack 3')
