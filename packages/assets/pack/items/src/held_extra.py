# Incremental: (re)render only items_held_c (held_<key> for bonetools.BONE) and merge it into the existing
# manifest.items.json without touching the other items atlases. build.py renders the same atlas on a full rebuild.
# Run: cd src && python3 held_extra.py ..   (then ktx2.py on the manifest and lock:ids:pack)
import json, sys
sys.argv = sys.argv[:2] + ['/tmp/items_held_preview']
import build
from build import held, sheet, HELD_C
OUT = sys.argv[1]; MF = f'{OUT}/manifest.items.json'
man = json.load(open(MF)); hc = [held(k) for k in HELD_C]; key = 'items_held_c'
a1, rows = sheet([f for h in hc for f in h[1]], 48, 16); a2, _ = sheet([f for h in hc for f in h[0]], 96, 16)
a1.save(f'{OUT}/atlases/{key}.png', optimize=True); a2.save(f'{OUT}/atlases/{key}@2x.png', optimize=True)
man['atlases'] = [a for a in man['atlases'] if a['key'] != key] + [{"key": key, "image": f"atlases/{key}.png", "frameW": 48, "frameH": 48, "columns": 16, "rows": rows, "pages": [{"scale": 2, "image": f"atlases/{key}@2x.png"}]}]
names = {f'held_{k}' for k in HELD_C}; man['sprites'] = [s for s in man['sprites'] if s['key'] not in names]
for i, k in enumerate(HELD_C):
    man['sprites'].append({"key": f"held_{k}", "category": "equipment", "atlas": key, "anchor": {"x": 0.5, "y": 0.75}, "animations": {"idle": {"frames": [8*i], "fps": 1, "directions": 8, "dirStride": 1}}})
json.dump(man, open(MF, 'w'), indent=1); open(MF, 'a').write('\n')
from PIL import Image, ImageDraw
im = Image.new('RGBA', (8*104, len(hc)*112), (104, 150, 98, 255)); d = ImageDraw.Draw(im)
for r, (k, h) in enumerate(zip(HELD_C, hc)):
    for c in range(8): im.alpha_composite(h[0][c], (c*104+4, r*112+4)); d.text((c*104+3, r*112+100), f'{k[:12]} d{c}', fill=(255, 255, 240))
im.convert('RGB').save('/workspace/assets/items/preview/items_held_c_2x.png'); print('held_c', HELD_C)
