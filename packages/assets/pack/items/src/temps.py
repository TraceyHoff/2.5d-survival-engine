#!/usr/bin/env python3
# Seasons: temperature gauge icons for the health-stats HUD (items_temp atlas, 32px + @2x, resident, category ui).
#   icon_temp       neutral thermometer (mid red column)        CSS alias data-icon="temp"
#   icon_temp_hot   full orange-red column + heat rays, sweat   CSS alias data-icon="temp_hot"
#   icon_temp_cold  low blue column + frost crystal, icicles    CSS alias data-icon="temp_cold"
# Chunky silhouette (bulb >= 12 px, 3 px tube) so it reads at 16 px on mobile and from the sofa on TV; solid cel (CEL=1).
# Idempotent; run from repo root after adr224.py: python3 packages/assets/pack/items/src/temps.py [preview dir]
#   then assets/tools/ktx2.py packages/assets/pack/items/manifest.items.json, gen_icon_css.py, lock:ids:pack.
import json, math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from PIL import Image, ImageDraw, ImageFont
from draw import C
R = 'packages/assets/pack/items/'; PREV = sys.argv[1] if len(sys.argv) > 1 else '/workspace/assets/preview'
AK = 'items_temp'
GLASS, RIM = '#f4f1ea', '#5a3b4a'
COL = {'': ('#e0484a', 0.55), 'hot': ('#f2622e', 0.97), 'cold': ('#4fa6e8', 0.22)}

def thermo(c, kind):
    col, lvl = COL[kind]
    x0 = 11.5 if kind else 13  # gauge shifts left when a badge sits on the right
    cx = x0 + 3.5
    c.rect(x0, 2.5, x0 + 7, 22, GLASS, r=3.5, shade=.22, olc=RIM)            # glass tube
    c.ell(cx, 23.5, 6.4, 6.4, col, shade=.32, olc=RIM)                         # bulb
    top = 21 - (21 - 6) * lvl
    c.rect(cx - 1.6, top, cx + 1.6, 22.5, col, r=1.4, ol=False, shade=.25)    # mercury column
    for i, y in enumerate((6.5, 10, 13.5, 17)):                               # scale ticks (bold for TV)
        c.line([(x0 + 4.9, y), (x0 + 6.4 - (0.6 if i % 2 else 0), y)], 1.0, RIM)
    c.ell(cx - 2.2, 21.4, 1.5, 1.1, '#ffffff', ol=False, shade=0)             # bulb glint
    c.line([(x0 + 1.6, 5), (x0 + 1.6, 18)], 0.9, '#ffffff')                   # tube glint
    if kind == 'hot':
        sx, sy = 25, 9
        c.ell(sx, sy, 3.6, 3.6, '#ffc23a', shade=.25, olc='#9a4a1e')
        for a in range(8):
            r = math.radians(a * 45)
            c.stroke([(sx + math.cos(r) * 5.2, sy + math.sin(r) * 5.2), (sx + math.cos(r) * 6.9, sy + math.sin(r) * 6.9)], 1.4, '#ffc23a', owf=.6, olc='#9a4a1e')
        for k, dx in enumerate((23.8, 27.8)):                                  # heat wiggles
            pts = [(dx + 0.9 * math.sin(t * 1.6), 28.8 - t * 1.25) for t in range(5)]
            c.stroke(pts, 1.3, '#ff8a4a', owf=.55, olc='#9a4a1e')
        c.poly([(9.2, 9.5), (10.6, 12.6), (9.2, 13.9), (7.8, 12.6)], '#8fd8ff', owf=.6, olc='#2c5c86')  # sweat drop
    elif kind == 'cold':
        sx, sy = 25.2, 9.5
        for a in range(0, 180, 60):
            r = math.radians(a + 90)
            c.stroke([(sx + math.cos(r) * 5.6, sy + math.sin(r) * 5.6), (sx - math.cos(r) * 5.6, sy - math.sin(r) * 5.6)], 1.5, '#dff4ff', owf=.7, olc='#2c5c86')
        c.ell(sx, sy, 1.8, 1.8, '#ffffff', owf=.6, olc='#2c5c86')
        for x, h in ((12.2, 3.4), (14.6, 2.2), (17.2, 3.0)):                    # icicles hanging off the tube cap
            c.poly([(x - 1.1, 3.0), (x + 1.1, 3.0), (x, 3.0 + h)], '#cdeeff', owf=.5, olc='#2c5c86')
        c.ell(cx - 3.5, 28.6, 2.4, 1.2, '#ffffff', owf=.5, olc='#6aa0c8')      # snow tuft at the base

KEYS = [('icon_temp', ''), ('icon_temp_hot', 'hot'), ('icon_temp_cold', 'cold')]
if __name__ == '__main__':
    ic = []
    for k, kind in KEYS:
        c = C(32, 8); thermo(c, kind); ic.append((c.out(64), c.out(32)))
    man = json.load(open(R + 'manifest.items.json'))
    man['atlases'] = [a for a in man['atlases'] if a['key'] != AK]; man['sprites'] = [s for s in man['sprites'] if s['atlas'] != AK]
    n = len(KEYS); a1 = Image.new('RGBA', (32 * n, 32), (0,) * 4); a2 = Image.new('RGBA', (64 * n, 64), (0,) * 4)
    for i, (b, s) in enumerate(ic): a1.paste(s, (32 * i, 0)); a2.paste(b, (64 * i, 0))
    a1.save(f'{R}atlases/{AK}.png', optimize=True); a2.save(f'{R}atlases/{AK}@2x.png', optimize=True)
    man['atlases'].append({"key": AK, "image": f"atlases/{AK}.png", "frameW": 32, "frameH": 32, "columns": n, "rows": 1, "residency": "resident",
                           "pages": [{"scale": 2, "image": f"atlases/{AK}@2x.png", "ktx2": f"atlases/{AK}@2x.ktx2"}], "ktx2": f"atlases/{AK}.ktx2"})
    for i, (k, _) in enumerate(KEYS): man['sprites'].append({"key": k, "category": "ui", "atlas": AK, "anchor": {"x": 0.5, "y": 0.5}, "animations": {"idle": {"frames": [i], "fps": 1}}})
    json.dump(man, open(R + 'manifest.items.json', 'w'), indent=1); open(R + 'manifest.items.json', 'a').write('\n')
    # preview: 2x + 1x + 16px (mobile HUD) on light and dark plaques
    os.makedirs(PREV, exist_ok=True); font = ImageFont.load_default(); W = 150
    im = Image.new('RGBA', (W * n, 190), (246, 234, 210, 255)); d = ImageDraw.Draw(im)
    d.rectangle([0, 95, W * n, 190], fill=(59, 36, 51, 255))
    for i, ((k, _), (b, s)) in enumerate(zip(KEYS, ic)):
        for y0 in (4, 99):
            im.alpha_composite(b, (i * W + 4, y0)); im.alpha_composite(s, (i * W + 74, y0 + 16)); im.alpha_composite(s.resize((16, 16), Image.LANCZOS), (i * W + 112, y0 + 24))
            im.alpha_composite(b.resize((128, 128), Image.NEAREST).crop((0, 0, 128, 128)).resize((24, 24), Image.LANCZOS), (i * W + 112, y0 + 46))
        d.text((i * W + 4, 172), k, fill=(255, 250, 240), font=font)
    im.convert('RGB').save(f'{PREV}/seasons_temp_icons.png'); print(AK, [k for k, _ in KEYS])
