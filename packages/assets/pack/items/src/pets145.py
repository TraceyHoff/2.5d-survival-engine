# ADR-145/146: pet treat icons (32px + @2x) on items_pets, same soft-outline painter as the item icons.
# Run from the repo root: python3 packages/assets/pack/items/src/pets145.py [preview_dir]
import json, os, sys, math
sys.path.insert(0, os.path.dirname(__file__))
from PIL import Image
from draw import C
R = 'packages/assets/pack/items/'; PREV = sys.argv[1] if len(sys.argv) > 1 else '/workspace/assets/nature/preview'

def dog_biscuit(c):  # bone-shaped biscuit
    for x, y in ((8, 12), (8, 20), (24, 12), (24, 20)): c.ell(x, y, 4.2, 4.2, '#d9a35b')
    c.rect(8, 12.5, 24, 19.5, '#d9a35b', r=2, ol=False)
    for x, y in ((13, 15), (17, 17), (20, 14.5)): c.dot(x, y, .8, '#a8703a')
    c.shine(7, 10.5)

def meaty_chew(c):  # twisted rawhide stick with a meaty end
    c.stroke([(7, 25), (24, 8)], 6, '#e9d2a6')
    for t in (.25, .45, .65): c.line([(7 + 17 * t - 2.5, 25 - 17 * t - 2.5), (7 + 17 * t + 2.5, 25 - 17 * t + 2.5)], .9, '#b8935e')
    c.ell(24, 8, 5, 4.5, '#b9473a'); c.ell(23, 7, 2, 1.5, '#e07a63', ol=False); c.shine(22, 6.5, .7)

def fish_treat(c):
    c.poly([(5, 10), (10, 16), (5, 22)], '#e9963c')
    c.ell(17, 16, 10, 6.5, '#f2b14e'); c.dot(23, 14.5, 1.3, '#2b1d2a'); c.shine(22.6, 14, .45)
    c.line([(14, 11), (12, 16), (14, 21)], 1, '#c07a2c'); c.line([(18, 11.5), (16.5, 16), (18, 20.5)], .8, '#c07a2c'); c.shine(15, 12, .8)

def egg_crunch(c):  # crunchy egg-yolk nugget
    c.ell(16, 17, 11, 9, '#f4e7c8'); c.ell(16, 17.5, 6, 5, '#f3b12e')
    for x, y in ((9, 14), (22, 21), (12, 22), (21, 12.5)): c.dot(x, y, .7, '#c9b27c')
    c.shine(14, 15.5, .9)

def seed_mix(c):  # little sack with seeds spilling
    c.poly([(9, 27), (8, 14), (12, 9), (20, 9), (24, 14), (23, 27)], '#c8a271'); c.rect(11, 8, 21, 11, '#9c7449', r=1)
    c.ell(16, 17, 7, 3, '#4f3a2a', ol=False)
    for i, (x, y) in enumerate(((12, 16.5), (15, 15.5), (18, 16.5), (20, 17.5), (14, 18), (17, 18.4))):
        c.ell(x, y, 1.3, .8, ('#f2e2a8', '#8a5a2e', '#d4b24c')[i % 3], ol=False)
    for x, y in ((26, 26), (28, 23.5), (5, 27)): c.ell(x, y, 1.4, .9, '#f2e2a8', owf=.6)

def veggie_bites(c):  # carrot coin + lettuce + pea bites
    c.ell(11, 11, 6.5, 6, '#6cbf4a'); c.line([(11, 6), (11, 16)], .8, '#3f8a2d')
    c.ell(21, 13, 5.5, 5.5, '#f08a2c'); c.ell(21, 13, 2.5, 2.5, '#f6b05a', ol=False)
    c.ell(14, 23, 5, 4.6, '#f08a2c'); c.ell(14, 23, 2.2, 2, '#f6b05a', ol=False)
    c.ell(24, 23, 3.2, 3.2, '#7fd04f'); c.shine(23, 22, .6); c.shine(19.5, 11.3, .6)

ICONS = [dog_biscuit, meaty_chew, fish_treat, egg_crunch, seed_mix, veggie_bites]
if __name__ == '__main__':
    man = json.load(open(R + 'manifest.items.json')); key = 'items_pets'
    f1, f2 = [], []
    for fn in ICONS: c = C(32, 8); fn(c); f1.append(c.out(32)); f2.append(c.out(64))
    a1 = Image.new('RGBA', (32 * 6, 32)); a2 = Image.new('RGBA', (64 * 6, 64))
    for i in range(6): a1.paste(f1[i], (32 * i, 0)); a2.paste(f2[i], (64 * i, 0))
    a1.save(f'{R}atlases/{key}.png', optimize=True); a2.save(f'{R}atlases/{key}@2x.png', optimize=True)
    names = [f.__name__ for f in ICONS]
    man['atlases'] = [a for a in man['atlases'] if a['key'] != key]; man['sprites'] = [s for s in man['sprites'] if s['atlas'] != key and s['key'] not in names]
    man['atlases'].append({"key": key, "image": f"atlases/{key}.png", "frameW": 32, "frameH": 32, "columns": 6, "rows": 1,
                           "pages": [{"scale": 2, "image": f"atlases/{key}@2x.png", "ktx2": f"atlases/{key}@2x.ktx2"}], "ktx2": f"atlases/{key}.ktx2"})
    for i, n in enumerate(names):
        man['sprites'].append({"key": n, "category": "item", "atlas": key, "anchor": {"x": 0.5, "y": 0.5}, "animations": {"idle": {"frames": [i], "fps": 1}}})
    json.dump(man, open(R + 'manifest.items.json', 'w'), indent=1, ensure_ascii=False); open(R + 'manifest.items.json', 'a').write('\n')
    os.makedirs(PREV, exist_ok=True); pv = Image.new('RGB', (6 * 80 + 8, 80 + 40), (104, 150, 98))
    for i in range(6): pv.paste(f2[i], (8 + i * 80, 8), f2[i]); pv.paste(f1[i], (8 + i * 80 + 16, 80), f1[i])
    pv.save(f'{PREV}/pets145_treat_icons.png'); print('preview', f'{PREV}/pets145_treat_icons.png')
