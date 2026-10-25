# ADR-132 skill tree tabs (91ebc860): skill_branch_perks shield + 7 category tab badges (items_skill_tabs, 32px + @2x).
# Same painter / frame conventions as skills.py (ADR-113). Tab keys: the client has no dedicated tab keys yet
# (gen-skills.mjs categories[].icon reuse branch icons), so these are skill_tab_<category key>.
# Run from repo root: python3 packages/assets/pack/items/src/adr132.py [preview dir]
#   then python3 assets/tools/ktx2.py packages/assets/pack/items/manifest.items.json, gen_icon_css.py, lock:ids:pack.
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from PIL import Image, ImageDraw, ImageFont
from draw import C, lt, dk
import skills as S
OUT = 'packages/assets/pack/items/'; PREV = sys.argv[1] if len(sys.argv) > 1 else '/workspace/assets/preview'
PERK = '#c0508a'
# category tab: (colour, [(glyph spec, scale, dx, dy)])  dx/dy in fractions of the cell
TABS = {
 'perks': (PERK, [('star', .62, 0, 0)]),
 'survival': (S.BR['survival'], [('flame', .5, -.12, .02), ('T:steel_axe', .5, .14, .02)]),
 'homestead': (S.BR['farming'], [('N:wheat', .46, -.15, -.06), ('paw', .36, .17, -.08), ('T:stew_bowl', .44, 0, .14)]),
 'medicine': (S.BR['medicine'], [('heartcross', .62, 0, 0)]),
 'crafting': (S.BR['crafting'], [('hammer', .5, -.13, 0), ('house', .46, .14, .04)]),
 'combat': (S.BR['combat'], [('T:steel_sword', .52, -.12, 0), ('shield', .44, .14, .05)]),
 'vehicles': (S.BR['vehicles'], [('wheel', .5, -.11, .05), ('wrench', .46, .14, -.06)]),
}
def star(c, col=S.GOLD):
    import math
    pts = [(16 + (11 if i % 2 == 0 else 4.8) * math.cos(-math.pi / 2 + i * math.pi / 5), 16.5 + (11 if i % 2 == 0 else 4.8) * math.sin(-math.pi / 2 + i * math.pi / 5)) for i in range(10)]
    c.poly(pts, col, shade=.35); c.dot(20.5, 9, 1.2, '#ffffff', 220)
    for x, y in ((6, 7), (26.5, 24)): c.poly([(x, y - 2.4), (x + .7, y - .7), (x + 2.4, y), (x + .7, y + .7), (x, y + 2.4), (x - .7, y + .7), (x - 2.4, y), (x - .7, y - .7)], '#fff4b0', owf=.5)
S.G['star'] = star
def tab_frame(c, col):  # rounded tab badge: rim, dark inset, top gloss, little bottom notch like a folder tab
    c.rect(2.5, 3, 29.5, 29, col, r=6, shade=.35)
    c.rect(5, 5.5, 27, 26.5, dk(col, .55), r=4.2, ol=False, shade=.3)
    c.rect(7, 6.5, 25, 9, lt(col, .4), r=1.2, ol=False, shade=.1); c.shine(7.5, 7.5, 1, 200)
def render(key):
    if key == 'skill_branch_perks':
        res = []
        for px in (64, 32):
            c = C(32, 8); S.frame(c, PERK, True, False); base = c.out(px); g = S.glyph_img('star', int(round(px * .62)))
            base.alpha_composite(g, ((px - g.size[0]) // 2, int(round((px - g.size[1]) / 2 - px * .05)))); res.append(base)
        return tuple(res)
    col, parts = TABS[key[10:]]; res = []
    for px in (64, 32):
        c = C(32, 8); tab_frame(c, col); base = c.out(px)
        for spec, sc, dx, dy in parts:
            g = S.glyph_img(spec, int(round(px * sc))); base.alpha_composite(g, (int(round((px - g.size[0]) / 2 + dx * px)), int(round((px - g.size[1]) / 2 + dy * px))))
        res.append(base)
    return tuple(res)
KEYS = ['skill_branch_perks'] + [f'skill_tab_{k}' for k in TABS]
if __name__ == '__main__':
    ic = [render(k) for k in KEYS]; man = json.load(open(OUT + 'manifest.items.json')); AK = 'items_skill_tabs'
    man['atlases'] = [a for a in man['atlases'] if a['key'] != AK]; man['sprites'] = [s for s in man['sprites'] if s['atlas'] != AK]
    cols = 8; a1 = Image.new('RGBA', (32 * cols, 32), (0,) * 4); a2 = Image.new('RGBA', (64 * cols, 64), (0,) * 4)
    for i, (b, s) in enumerate(ic): a1.paste(s, (32 * i, 0)); a2.paste(b, (64 * i, 0))
    a1.save(f'{OUT}atlases/{AK}.png', optimize=True); a2.save(f'{OUT}atlases/{AK}@2x.png', optimize=True)
    man['atlases'].append({"key": AK, "image": f"atlases/{AK}.png", "frameW": 32, "frameH": 32, "columns": cols, "rows": 1, "residency": "resident",
                           "pages": [{"scale": 2, "image": f"atlases/{AK}@2x.png", "ktx2": f"atlases/{AK}@2x.ktx2"}], "ktx2": f"atlases/{AK}.ktx2"})
    for i, k in enumerate(KEYS): man['sprites'].append({"key": k, "category": "ui", "atlas": AK, "anchor": {"x": 0.5, "y": 0.5}, "animations": {"idle": {"frames": [i], "fps": 1}}})
    json.dump(man, open(OUT + 'manifest.items.json', 'w'), indent=1); open(OUT + 'manifest.items.json', 'a').write('\n')
    os.makedirs(PREV, exist_ok=True); font = ImageFont.load_default(); W = 96
    im = Image.new('RGBA', (W * len(KEYS), 112), (104, 150, 98, 255)); d = ImageDraw.Draw(im)
    for i, (k, (b, s)) in enumerate(zip(KEYS, ic)): im.alpha_composite(b, (i * W + 4, 4)); im.alpha_composite(s, (i * W + 60, 36)); d.text((i * W + 3, 92), k.replace('skill_', '')[:15], fill=(255, 255, 240), font=font)
    im.convert('RGB').save(f'{PREV}/adr132_skill_tabs_2x.png'); print(KEYS)
