# ADR-128 art (docs/ART_LIST_ADR128.md): 18 cooked-food icons + canteen / water_bottle (nature_adr128, 32px cells, 2px inset,
# 1x + @2x), wood / stone / leaf chip particles (nature_adr128_fx, 4 frames each, 8x8 art in 12px cells = 2px gutter),
# node health bar frame (nature_adr128_hpbar, 9-slice 32x4) and pickup toast background (nature_adr128_toast, 9-slice).
# Replaces the ADR-128 alias sprites (4856b051) in pack/manifest.json + nature/manifest.nature.json; lives in the nature pack because the sprite_fallbacks icon test wants base|nature (keys move, never duplicate).
# Run from repo root: python3 packages/assets/pack/nature/src/adr128.py [preview dir]
#   then python3 assets/tools/ktx2.py packages/assets/pack/nature/manifest.nature.json, gen_icon_css.py, lock:ids:pack.
import json, math, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../items/src'))  # shared icon painter
from PIL import Image, ImageDraw, ImageFont
from draw import C, lt, dk, mix
from icons import M, sh, bowl, bottle
R = 'packages/assets/pack/'; OUT = R + 'nature/'; PREV = sys.argv[1] if len(sys.argv) > 1 else '/workspace/assets/preview'
# ---------- cooked foods
def steam(c, xs=(12, 16, 20), y=9):
    for x in xs: c.line([(x, y), (x + 1.2, y - 2.6), (x - .4, y - 5), (x + .6, y - 7)], .7, (255, 255, 255), 160)
def stewed(fruit, soup, bits):
    def f(c):
        bowl(c, soup, [], steam=True)
        for x, y, col, r in bits: c.ell(x, y, r, r * .8, col, owf=.5); c.dot(x - r * .35, y - r * .3, r * .3, lt(col, .6), 200)
    return f
BERRY = {'berries': ('#a8336b', [(11.5, 15.6, '#3f4fb0', 1.4), (16, 15.2, '#d8344a', 1.4), (20.5, 15.8, '#5b2a6e', 1.4), (14, 17, '#e0465a', 1.1)]),
         'blueberry': ('#4a4ea8', [(11.5, 15.6, '#2f3f9e', 1.4), (16, 15.0, '#3b52b8', 1.5), (20.5, 15.8, '#2a3588', 1.4), (17.8, 17.1, '#4762c4', 1.1)]),
         'raspberry': ('#d8456a', [(12, 15.6, '#e8476a', 1.5), (16.5, 15.2, '#f05c7c', 1.4), (20.5, 16, '#d63a5e', 1.4), (14.5, 17.1, '#ef5877', 1.1)]),
         'blackberry': ('#4a2050', [(11.5, 15.6, '#2e1838', 1.5), (16, 15.2, '#3d1f4a', 1.5), (20.5, 15.8, '#2a1534', 1.4), (17.5, 17.1, '#47255a', 1.1)]),
         'strawberry': ('#e04450', [(12, 15.6, '#f0434a', 1.6), (17, 15.2, '#e8323c', 1.6), (21, 16.2, '#f25a5a', 1.2)]),
         'cherry': ('#a3203a', [(12, 15.6, '#c4203a', 1.5), (16.5, 15.3, '#b01530', 1.5), (20.5, 16, '#d0283f', 1.4)])}
def stewed_k(k):
    soup, bits = BERRY[k]; base = stewed(k, soup, bits)
    def f(c):
        base(c)
        if k == 'strawberry':
            for x, y in ((11.6, 15.3), (12.5, 16), (16.6, 14.8), (17.5, 15.6), (20.7, 16)): c.dot(x, y, .3, '#ffe68a', 230)
            c.poly([(16, 13.4), (17, 12.4), (18.2, 13.6), (17, 14.2)], M['green'], owf=.5)
        if k == 'cherry': c.stroke([(16.5, 14), (17.5, 10.5), (19.5, 8.5)], .5, '#5e7a2e', owf=.4); c.ell(20, 8.3, 1.4, .7, '#6fbf4e', owf=.4)
        if k == 'raspberry':
            for x, y in ((12, 15.6), (16.5, 15.2), (20.5, 16)): c.dot(x + .5, y + .4, .35, dk('#e8476a', .3), 200)
    return f
def char_spots(c, pts, col='#5a2e1a'):
    for x, y, r in pts: c.dot(x, y, r, col, 150)
def baked_apple(c):
    sh(c, 10); c.ell(16, 26, 10, 2.6, '#e9dcc4')  # plate
    c.ell(16, 18.5, 8.5, 7.5, '#b8402e', shade=.4); c.ell(16, 12.3, 3, 1.2, '#f0b25a', owf=.6)  # cored, caramel filling
    c.poly([(9, 17), (11, 22), (13, 25), (10, 23)], '#e89a3a', ol=False, shade=.2)  # glaze drip
    c.stroke([(16, 12), (16.6, 8)], .9, '#6b4226', owf=.5); c.ell(18.6, 8.6, 2, .9, '#6fbf4e', owf=.5)
    char_spots(c, [(20, 21, .8), (12.5, 20, .6), (19, 15.5, .5)]); c.shine(12, 15, 1.1, 210); steam(c, (11, 21), 8)
def baked_pear(c):
    sh(c, 9); c.ell(16, 26.3, 9.5, 2.4, '#e9dcc4')
    c.ell(16, 21, 7, 5.5, '#c9a23a', shade=.4); c.ell(16, 14.5, 4.2, 4.6, '#c9a23a', shade=.35); c.ell(16, 20, 6.4, 5, '#c9a23a', ol=False, shade=.35)
    c.poly([(11, 19), (12, 24), (14, 26)], '#d98a3a', ol=False, shade=.2); c.ell(16, 24.3, 5, 1.2, '#b8642a', ol=False)
    c.stroke([(16, 10.5), (17, 7)], .9, '#6b4226', owf=.5); char_spots(c, [(19.5, 21, .7), (13.5, 16, .5)]); c.shine(13.5, 13.8, 1, 210); steam(c, (10, 22), 9)
def baked_orange(c):
    sh(c, 11); c.ell(16, 25.8, 10.5, 2.6, '#e9dcc4')
    c.ell(16, 19, 9, 6.2, '#e8862a', shade=.35)  # half shell
    c.ell(16, 15.5, 8, 3.2, '#f6b04a', shade=.2)  # cut face
    for i in range(8):
        a = i * math.pi / 4; c.line([(16, 15.5), (16 + 7 * math.cos(a), 15.5 + 2.8 * math.sin(a))], .4, '#fbe3a8', 200)
    c.ell(16, 15.5, 2.6, 1.1, '#c9601c', ol=False); char_spots(c, [(12, 15, .6), (20, 16, .7), (16, 17.5, .5)], '#7a3a16')
    c.shine(10, 19, .9, 190); steam(c, (12, 20), 9)
def baked_peach(c):
    sh(c, 10); c.ell(16, 26, 10, 2.6, '#e9dcc4')
    c.ell(16, 19, 8.5, 6.5, '#f08a5a', shade=.4); c.ell(16, 16.2, 7, 3, '#f7b04a', shade=.2)  # halved
    c.ell(16, 16.2, 2.6, 1.6, '#8a3a2a', owf=.5); c.ell(16, 15.7, 2.2, 1, '#f0d27a', ol=False)  # pit + honey
    c.ell(13, 21.5, 3, 2, '#e06050', ol=False, shade=.2); char_spots(c, [(20.5, 20.5, .7), (11, 18.3, .5)]); c.shine(11.5, 19, .9, 190); steam(c, (11, 21), 9)
def baked_coconut(c):
    sh(c, 11); c.ell(16, 21, 10, 6, '#7a4a2a', shade=.4)  # husk half
    for x in (10, 14, 18, 22): c.line([(x, 19), (x - .6, 25)], .5, '#5a3418', 170)
    c.ell(16, 17, 9, 3.4, '#f6eedd', shade=.15); c.ell(16, 17, 6.8, 2.2, '#e9b56a', ol=False, shade=.25)  # toasted flesh
    c.ell(16, 17, 6.8, 2.2, '#e9b56a', ol=False); char_spots(c, [(13, 16.8, .5), (18.5, 17.4, .5), (16, 16.3, .4)], '#8a5226')
    c.shine(9.5, 20, .8, 160); steam(c, (12, 20), 12)
def grill(c, pts, col='#4a2416'):
    for a, b in pts: c.line([a, b], 1.0, col, 200)
def roasted_carrot(c):
    sh(c, 11); c.poly([(5, 25), (23, 9), (26, 11.5), (8, 27.5)], '#e8782a', shade=.35)
    c.poly([(23, 9), (25, 5), (27, 4.5), (26, 7.5), (29, 8), (26, 11.5)], '#6fa83e', owf=.6)
    grill(c, [((10, 21), (13, 24)), ((14, 17.5), (17, 20.5)), ((18, 14), (21, 17))]); c.shine(12, 20, .7, 170); steam(c, (10, 16), 14)
def roasted_tomato(c):
    sh(c, 10); c.ell(16, 18.5, 9, 8, '#d93a2a', shade=.4)
    for x, y, r in ((11.5, 17, 1.6), (19.5, 21, 1.4), (17, 15, 1.1), (13, 22, 1.0)): c.ell(x, y, r, r * .8, '#3a1a14', ol=False, shade=.1)  # blisters
    c.poly([(16, 11), (13, 9), (15.3, 10.6), (16, 8), (16.7, 10.6), (19, 9)], '#5a7a2e', owf=.5)
    c.line([(16, 11), (16, 7)], .6, '#5a7a2e'); c.poly([(9, 20), (11, 25), (14, 26.5)], '#f07050', ol=False); c.shine(12, 14, 1.2, 210); steam(c, (21, 24), 8)
def roasted_pumpkin(c):
    sh(c, 11); c.poly([(5, 24), (16, 7), (27, 24), (16, 27)], '#f08a2a', shade=.35)  # wedge
    c.poly([(5, 24), (16, 27), (27, 24), (16, 25.4)], '#5a8a3a', ol=False)  # skin rim
    c.poly([(16, 8.5), (24, 22), (16, 24)], '#f7a84a', ol=False, shade=.2)
    grill(c, [((10, 18), (14, 22)), ((14, 13), (18, 17)), ((18, 18.5), (21, 21.5))]); c.dot(12, 21, .5, '#fff2c0', 200); c.dot(18, 14.5, .5, '#fff2c0', 200); steam(c, (22, 26), 10)
def roasted_squash(c):
    sh(c, 11); c.ell(16, 18.5, 10, 7.5, '#e9c24a', shade=.35); c.ell(16, 17.5, 8, 5.3, '#f4b23a', shade=.2)
    c.ell(16, 17.5, 3.4, 2.4, '#d98a2a', ol=False); c.dot(15, 17, .5, '#fff0c0'); c.dot(17, 18, .5, '#fff0c0')
    grill(c, [((9, 15), (11, 21)), ((21, 15), (23, 21))], '#7a3a16'); char_spots(c, [(12, 23, .7), (20, 23.3, .6)]); c.shine(10, 14.5, .8, 180); steam(c, (12, 20), 9)
def roasted_cabbage(c):
    sh(c, 11); c.poly([(4, 22), (8, 11), (16, 7.5), (24, 11), (28, 22), (16, 26)], '#8cc65a', shade=.35)  # wedge
    c.poly([(16, 26), (12, 15), (16, 9), (20, 15)], '#f0f0c0', ol=False, shade=.2)  # core
    for i in range(3): c.line([(7 + i * 2, 21 - i), (11 + i * 1.5, 12 + i)], .6, '#5e9a3a', 190); c.line([(25 - i * 2, 21 - i), (21 - i * 1.5, 12 + i)], .6, '#5e9a3a', 190)
    grill(c, [((6, 15), (12, 19)), ((20, 19), (26, 15))]); char_spots(c, [(9, 12, .9), (23, 12, .9)], '#3a2010'); steam(c, (12, 20), 8)
def roasted_onion(c):
    sh(c, 11)
    for cx in (11, 21):
        c.ell(cx, 18.5, 6.5, 7, '#c9853a', shade=.35)
        for r in (5.2, 3.8, 2.4): c.ell(cx, 17.8, r, r * .95, '#f0c26a' if r != 3.8 else '#d9984a', owf=.4, shade=.15)
        c.dot(cx, 17.8, 1, '#8a4a1a', 200)
    char_spots(c, [(8, 22, .8), (23.5, 22.5, .8), (11.5, 14, .5)], '#4a2410'); c.shine(8, 14.5, .7, 170); steam(c, (11, 21), 10)
def roasted_wild_onion(c):
    sh(c, 11)
    for i, (x, y) in enumerate(((10, 21), (15.5, 22.5), (21, 21))):
        c.stroke([(x, y - 3), (x - 3 + i * 3, 5)], 1.0, '#5e8a2e', owf=.5)  # scallion leaves (charred tips)
        c.dot(x - 3 + i * 3, 5.5, .7, '#3a2a14')
        c.ell(x, y, 3.2, 3.6, '#e9d8c0', shade=.3); c.dot(x - .8, y - 1, .6, '#ffffff', 170)
        grill(c, [((x - 2.5, y + .5), (x + 2.5, y - .5))], '#5a2e14')
    c.stroke([(8, 16), (24, 16)], 1.3, '#a26a3a', owf=.5)  # twine tie
def canteen(c):
    sh(c, 10)
    c.stroke([(7, 13), (5, 6), (12, 3), (20, 3)], 1.0, '#8a5a35', owf=.5)  # strap
    c.ell(16, 18, 9.5, 9, '#7d8a52', shade=.4)  # cloth cover
    c.ell(16, 18, 7.2, 6.8, '#8d9a5e', ol=False, shade=.3); c.line([(7, 18), (25, 18)], .5, dk('#7d8a52', .35), 170)
    for y in (12, 24): c.line([(10, y), (22, y)], .4, dk('#7d8a52', .3), 120)
    c.rect(13.5, 6, 18.5, 9.5, M['steel'], r=1); c.rect(13, 4.5, 19, 6.5, '#4a4f5a', r=1)  # neck + cap
    c.stroke([(19, 5.5), (22, 4), (21, 3)], .5, '#9aa2ae', owf=.4)  # cap chain
    c.ell(16, 18, 2.6, 2, '#c9a24a', owf=.5); c.shine(11.5, 13.5, 1.1, 190)
def water_bottle(c):
    bottle(c, '#a9dcef', liquid='#3f9fe0', cork='#3a78c8', label='#e9f6fb')
    c.dot(16, 20.5, 1.3, '#3f9fe0', 230); c.poly([(16, 18.6), (17, 20.4), (15, 20.4)], '#3f9fe0', ol=False)  # drop mark
    c.shine(12.5, 16, .9, 220)
ICON = {f'stewed_{k}': stewed_k(k) for k in BERRY}
ICON.update(baked_apple=baked_apple, baked_pear=baked_pear, baked_orange=baked_orange, baked_peach=baked_peach, baked_coconut=baked_coconut,
            roasted_carrot=roasted_carrot, roasted_tomato=roasted_tomato, roasted_pumpkin=roasted_pumpkin, roasted_squash=roasted_squash,
            roasted_cabbage=roasted_cabbage, roasted_onion=roasted_onion, roasted_wild_onion=roasted_wild_onion, canteen=canteen, water_bottle=water_bottle)
# ---------- FX: 8x8 art in a 12px cell (2px gutter), 4 tumble frames each
FX = {'particle_wood_chip': '#c08040', 'particle_stone_chip': '#a4a4b0', 'particle_leaf': '#6fbf4e'}
def fx_frame(k, i, scale):
    c = C(12, 24 * scale // 2 if False else 16); col = FX[k]; a = i * math.pi / 4
    def R(pts): return [(6 + (x * math.cos(a) - y * math.sin(a)), 6 + (x * math.sin(a) + y * math.cos(a))) for x, y in pts]
    c.ow = .45
    if k == 'particle_wood_chip': c.poly(R([(-3.3, -1.2), (3.3, -1.8), (3, 1.4), (-3, 1.6)]), col, shade=.35); c.line(R([(-2.4, 0), (2.4, -.3)]), .35, dk(col, .4), 200)
    elif k == 'particle_stone_chip': c.poly(R([(-2.6, -1.6), (.5, -3), (3, -.6), (1.8, 2.4), (-2, 2.2)]), col, shade=.4); c.dot(*R([(-.8, -.9)])[0], .5, (255, 255, 255), 170)
    else: c.poly(R([(-3.4, 0), (-1.5, -2), (1.6, -1.6), (3.4, 0), (1.6, 1.6), (-1.5, 2)]), col, shade=.35); c.line(R([(-3.4, 0), (3, 0)]), .3, dk(col, .4), 210)
    return c.out(12 * scale)
def hpbar(scale):  # 32x4 frame: dark rounded rim, transparent interior (fill drawn by the engine)
    w, h = 32 * scale, 4 * scale; im = Image.new('RGBA', (w * 8, h * 8), (0, 0, 0, 0)); d = ImageDraw.Draw(im); S = 8 * scale
    d.rounded_rectangle([0, 0, w * 8 - 1, h * 8 - 1], radius=2 * S, fill=(58, 34, 40, 255))
    d.rounded_rectangle([S, S, w * 8 - 1 - S, h * 8 - 1 - S], radius=1 * S, fill=(0, 0, 0, 0))
    d.line([(2 * S, S * .5), (w * 8 - 2 * S, S * .5)], fill=(150, 110, 96, 255), width=max(1, S // 3))
    return im.resize((w, h), Image.LANCZOS)
def toast(scale):  # 48x24 parchment pill, 9-slice 10/8/10/8
    w, h = 48 * scale, 24 * scale; S = 8 * scale; im = Image.new('RGBA', (w * 8, h * 8), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.rounded_rectangle([S, 2 * S, w * 8 - S, h * 8 - 1], radius=9 * S, fill=(40, 24, 30, 90))  # soft drop shadow
    d.rounded_rectangle([0, 0, w * 8 - 2 * S, h * 8 - 3 * S], radius=9 * S, fill=(74, 46, 42, 255))  # bold outline
    d.rounded_rectangle([1.5 * S, 1.5 * S, w * 8 - 3.5 * S, h * 8 - 4.5 * S], radius=7.5 * S, fill=(250, 238, 208, 245))
    d.rounded_rectangle([3 * S, 3 * S, w * 8 - 5 * S, 7 * S], radius=3 * S, fill=(255, 250, 232, 160))  # top gloss
    return im.resize((w, h), Image.LANCZOS)
def sheet(frames, cw, ch, cols):
    rows = (len(frames) + cols - 1) // cols; im = Image.new('RGBA', (cw * cols, ch * rows), (0, 0, 0, 0))
    for i, f in enumerate(frames): im.paste(f, ((i % cols) * cw, (i // cols) * ch))
    return im, rows
def render(k): c = C(32, 8); ICON[k](c); return c.out(64), c.out(32)
if __name__ == '__main__':
    man = json.load(open(OUT + 'manifest.nature.json')); MINE = ('nature_adr128', 'nature_adr128_fx', 'nature_adr128_hpbar', 'nature_adr128_toast')
    man['atlases'] = [a for a in man['atlases'] if a['key'] not in MINE]; man['sprites'] = [s for s in man['sprites'] if s['atlas'] not in MINE]
    def atlas(key, f1, f2, cw, ch, cols, extra={}):
        a1, rows = sheet(f1, cw, ch, cols); a2, _ = sheet(f2, cw * 2, ch * 2, cols); assert max(a2.size) <= 2048
        a1.save(f'{OUT}atlases/{key}.png', optimize=True); a2.save(f'{OUT}atlases/{key}@2x.png', optimize=True)
        man['atlases'].append({"key": key, "image": f"atlases/{key}.png", "frameW": cw, "frameH": ch, "columns": cols, "rows": rows, "residency": "resident", **extra,
                               "pages": [{"scale": 2, "image": f"atlases/{key}@2x.png", "ktx2": f"atlases/{key}@2x.ktx2"}], "ktx2": f"atlases/{key}.ktx2"})
        return a2
    keys = list(ICON); ic = [render(k) for k in keys]
    big = atlas('nature_adr128', [x[1] for x in ic], [x[0] for x in ic], 32, 32, 16)
    for i, k in enumerate(keys): man['sprites'].append({"key": k, "category": "item", "atlas": "nature_adr128", "anchor": {"x": 0.5, "y": 0.5}, "animations": {"idle": {"frames": [i], "fps": 1}}})
    fk = list(FX); f1 = [fx_frame(k, i, 1) for k in fk for i in range(4)]; f2 = [fx_frame(k, i, 2) for k in fk for i in range(4)]
    fxa = atlas('nature_adr128_fx', f1, f2, 12, 12, 4)
    for j, k in enumerate(fk): man['sprites'].append({"key": k, "category": "vfx", "atlas": "nature_adr128_fx", "anchor": {"x": 0.5, "y": 0.5}, "animations": {"idle": {"frames": [4 * j + i for i in range(4)], "fps": 12, "loop": True}}})
    atlas('nature_adr128_hpbar', [hpbar(1)], [hpbar(2)], 32, 4, 1, {"nineSlice": {"0": {"l": 2, "t": 1, "r": 2, "b": 1}}})
    man['sprites'].append({"key": "ui_node_hpbar_frame", "category": "ui", "atlas": "nature_adr128_hpbar", "anchor": {"x": 0.5, "y": 0.5}, "animations": {"idle": {"frames": [0], "fps": 1}}})
    atlas('nature_adr128_toast', [toast(1)], [toast(2)], 48, 24, 1, {"nineSlice": {"0": {"l": 10, "t": 8, "r": 10, "b": 8}}})
    man['sprites'].append({"key": "ui_pickup_toast_bg", "category": "ui", "atlas": "nature_adr128_toast", "anchor": {"x": 0.5, "y": 0.5}, "animations": {"idle": {"frames": [0], "fps": 1}}})
        # drop the 4856b051 alias sprites (same keys now live here)
    gone = set(keys) | set(fk)
    man['sprites'] = [s for s in man['sprites'] if s['key'] not in gone or s['atlas'] in MINE]
    json.dump(man, open(OUT + 'manifest.nature.json', 'w'), indent=1, ensure_ascii=False); open(OUT + 'manifest.nature.json', 'a').write('\n')
    for f, ind in (('manifest.json', 2),):
        m = json.load(open(R + f)); n = len(m['sprites']); m['sprites'] = [s for s in m['sprites'] if s['key'] not in gone]
        if len(m['sprites']) != n: json.dump(m, open(R + f, 'w'), indent=ind, ensure_ascii=False); open(R + f, 'a').write('\n'); print(f, 'dropped', n - len(m['sprites']))
    # previews
    os.makedirs(PREV, exist_ok=True); font = ImageFont.load_default(); W, H = 72, 86; cols = 10
    im = Image.new('RGBA', (cols * W, 2 * H + 110), (104, 150, 98, 255)); d = ImageDraw.Draw(im)
    for i, (k, x) in enumerate(zip(keys, ic)):
        X, Y = (i % cols) * W, (i // cols) * H; im.alpha_composite(x[0], (X + 4, Y + 4)); im.alpha_composite(x[1], (X + 38, Y + 40)); d.text((X + 2, Y + 72), k.replace('stewed_', 's_').replace('roasted_', 'r_').replace('baked_', 'b_')[:11], fill=(255, 255, 240), font=font)
    Y = 2 * H + 4
    for i, f in enumerate(f2): im.alpha_composite(f.resize((48, 48), Image.NEAREST), (4 + i * 52, Y))
    hb = hpbar(2).resize((256, 32), Image.NEAREST); im.alpha_composite(hb, (4, Y + 56)); im.alpha_composite(toast(2), (300, Y + 50))
    im.convert('RGB').save(f'{PREV}/adr128_items_2x.png'); print('preview', f'{PREV}/adr128_items_2x.png', len(keys), fk)
