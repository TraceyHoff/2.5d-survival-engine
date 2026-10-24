"""ADR-110 item icons (98 keys from gameplay sprite_fallbacks.json `icons`): meats, seeds, saplings, produce, animal
materials, bone/antler tools, leather/wool clothing, farm tools and dishes. Painted with the items pack painter
(packages/assets/pack/items/src: draw.C + icons.py helpers) so they match the existing 32px icon set exactly:
soft gradient fills, bold darker outline, drop shadow, art inside a 2px gutter. pine_sapling and pumpkin already
exist in the base pack and are reused (not redrawn). Page: nature_icons (32px cells, 16 cols, 1x + @2x)."""
import os, sys, math, json, importlib.util
HERE = os.path.dirname(os.path.abspath(__file__)); ITEMS = os.path.normpath(os.path.join(HERE, "../../items/src"))
if ITEMS not in sys.path: sys.path.append(ITEMS)
from draw import C, lt, dk, mix
_spec = importlib.util.spec_from_file_location("items_icons", os.path.join(ITEMS, "icons.py")); I = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(I)
M, sh = I.M, I.sh
from PIL import Image
from common import FRAG
from bonetools import pick_antler   # shared with the items build (held_antler_pickaxe)

# ---------------- meat
def steak(c, col, fat, cooked=False, bone=False, marble=False):
    sh(c, 12); base = '#8a4a2a' if cooked else col
    c.poly([(5, 17), (8, 11), (15, 8), (23, 9), (27, 14), (26, 21), (19, 25), (10, 25), (6, 22)], base, shade=.35)
    c.poly([(23, 9), (27, 14), (26, 21), (24.5, 20), (25, 14.5), (22, 10.5)], fat if not cooked else '#c98a4a', ol=False)
    if marble and not cooked:
        for pts in (((10, 14), (13, 16), (16, 15)), ((12, 20), (16, 19), (19, 21)), ((17, 12), (20, 14))): c.line(list(pts), .5, '#f6d8c8', 210)
    if bone: c.ell(13, 17, 2.4, 2.4, M['bone'], owf=.6); c.dot(13, 17, .9, '#d9c8a8')
    if cooked:
        for i in range(3): c.line([(9 + i * 4.5, 22), (14 + i * 4.5, 11)], 1.0, '#4a2616', 220)
        c.shine(11, 12, .9, 170)
    else: c.shine(10, 12, 1.1, 200)
def drumstick(c, col, cooked=False, small=False):
    sh(c, 10 if small else 12); s = .8 if small else 1.0; ox, oy = (3, 3) if small else (0, 0)
    c.stroke([(8 + ox, 25 - oy), (14 + ox, 19 - oy)], 2.2 * s, M['bone'])
    for x, y in ((6.5 + ox, 24.5 - oy), (8.5 + ox, 26.5 - oy)): c.ell(x, y, 1.7 * s, 1.7 * s, M['bone'])
    meat = ('#b8642e' if cooked else col)
    c.poly([(12 + ox, 21 - oy), (11 + ox, 15 - oy), (15 + ox, 9 - oy), (21 + ox * .5, 6 + oy * .3), (26 - ox * .5, 9 + oy * .5), (25 - ox * .5, 15), (19 + ox * .3, 19), (15 + ox, 22 - oy)], meat, shade=.35)
    if cooked: c.line([(14 + ox, 14 - oy), (20, 9 + oy * .3)], .8, '#7a3a1a', 210); c.line([(16 + ox, 18 - oy), (23, 12)], .8, '#7a3a1a', 210); c.shine(17, 10 + oy * .3, .9, 200)
    else: c.shine(17, 10 + oy * .3, 1.0, 200); c.dot(21, 14, .6, lt(col, .4), 200)
# ---------------- seeds
def seedbag(c, col, seed, mark=None):
    sh(c, 11)
    c.poly([(8, 27), (7, 12), (9, 9), (23, 9), (25, 12), (24, 27)], '#e9d3a4', shade=.3)
    c.poly([(9, 9), (11, 6.5), (21, 6.5), (23, 9)], '#d8bd86'); c.line([(10, 9.2), (22, 9.2)], .5, dk('#e9d3a4', .35), 170)
    c.ell(16, 17, 5.2, 4.6, col, owf=.6); (mark or (lambda c: None))(c)
    for x, y in ((6.5, 27.5), (25.5, 26.5), (22, 28.5)): c.ell(x, y, 1.3, .9, seed, owf=.5)
def seeds_loose(c, seed, n=6, shape=(1.4, 1.0)):
    sh(c, 11)
    pts = [(11, 20), (16, 17), (21, 20), (13, 24), (19, 24), (16, 21), (24, 23), (8, 24)][:n]
    for x, y in pts: c.ell(x, y, shape[0], shape[1], seed, owf=.55); c.dot(x - .4, y - .3, .35, lt(seed, .5), 200)
def SEED(col, seed, emblem=None): return lambda c: seedbag(c, col, seed, emblem)
def em_leaf(c): c.poly([(14, 19), (16, 13.5), (18.5, 15.5), (17, 19.5)], M['green'], owf=.5)
def em_berry(col): return lambda c: [c.ell(x, y, 1.6, 1.6, col, owf=.5) for x, y in ((14.5, 16), (17.5, 16), (16, 18.5))]
# ---------------- saplings
def sapling(c, leaf, kind="round", fruit=None):
    sh(c, 10)
    c.poly([(10, 21), (22, 21), (23, 25), (20, 28), (12, 28), (9, 25)], '#a87a4a', shade=.3)  # burlap root ball
    c.line([(10, 23.5), (22, 23.5)], .5, '#7a5530', 180); c.line([(14, 21), (13, 27.5)], .4, '#7a5530', 150); c.line([(18, 21), (19, 27.5)], .4, '#7a5530', 150)
    c.stroke([(16, 21), (16, 10)], 1.2, M['dwood'])
    if kind == "palm":
        for a in (-150, -115, -65, -30, -95):
            r = math.radians(a); x1, y1 = 16 + math.cos(r) * 9, 10 + math.sin(r) * 6 + 4
            c.poly([(16, 9.5), (16 + math.cos(r) * 4.5, 8.5 + math.sin(r) * 3 - 1), (x1, y1), (16 + math.cos(r) * 4.5 + 1, 10.5 + math.sin(r) * 3)], leaf, owf=.6)
    elif kind == "willow":
        for x in (10, 13, 16, 19, 22): c.stroke([(16, 7), (x, 9), (x + (x - 16) * .15, 17)], .9, leaf, owf=.5)
        c.ell(16, 8, 5, 2.5, leaf, owf=.6)
    elif kind == "pointy":
        c.poly([(10, 14), (16, 4), (22, 14), (16, 16)], leaf, shade=.35)
    else:
        for x, y, r in ((12, 12, 3.6), (20, 11.5, 3.6), (16, 8, 4.0)): c.ell(x, y, r, r * .85, leaf, shade=.35, owf=.7)
    if fruit:
        for x, y in ((12.5, 13.5), (19.5, 13)): c.ell(x, y, 1.3, 1.3, fruit, owf=.5); c.dot(x - .4, y - .4, .35, (255, 255, 255), 200)
    c.shine(14, 7.5, .7, 170)
# ---------------- produce
def fruit(c, col, r=7, leaf=True, stem=True, cy=18, spots=None, hi=None):
    sh(c, r + 2); c.ell(16, cy, r, r * .95, col, shade=.35)
    if spots: [c.dot(x, y, .4, spots, 200) for x, y in ((13, cy - 2), (18, cy), (15, cy + 3), (19, cy - 3))]
    if stem: c.stroke([(16, cy - r + 1), (17, cy - r - 2.5)], .9, M['dwood'])
    if leaf: c.poly([(17, cy - r - 1), (21, cy - r - 3.5), (23, cy - r - 1), (19, cy - r)], M['green'], owf=.6)
    c.shine(13, cy - r * .45, 1.2 if r > 5 else .7, 210)
def pear(c):
    sh(c, 9); col = '#b7cf4a'
    c.ell(16, 21, 7, 6.2, col, shade=.35); c.ell(16, 13.5, 4, 4.5, col, shade=.3, ol=False)
    c.poly([(12, 14), (20, 14), (22, 19), (10, 19)], col, ol=False, shade=.3)
    c.stroke([(16, 9.5), (17, 6)], .9, M['dwood']); c.poly([(17, 7.5), (21.5, 5), (22.5, 8)], M['green'], owf=.6); c.shine(13, 13.5, 1, 200); c.dot(19, 22, .5, '#8a9a3a')
def cherry(c):
    sh(c, 10); r = '#d8283a'
    c.stroke([(11, 18), (16, 6)], .7, '#5a7a2a', owf=.5); c.stroke([(21, 19), (16, 6)], .7, '#5a7a2a', owf=.5)
    c.poly([(16, 6), (21, 4), (23, 7), (19, 8)], M['green'], owf=.6)
    for x, y in ((11, 21), (21, 22)): c.ell(x, y, 4.3, 4.1, r, shade=.35); c.shine(x - 1.5, y - 1.6, .8, 220)
def citrus(c): fruit(c, '#f39a22', 8, spots=dk('#f39a22', .25))
def peach(c):
    fruit(c, '#f6b07a', 8); c.line([(16, 11), (14.5, 18), (16, 25)], .5, '#d9785a', 170); c.ell(20, 20, 3.5, 3, '#ef8a6a', ol=False, shade=.1)
def coconut(c):
    sh(c, 11); c.ell(16, 18, 9, 8.5, '#7a4a2a', shade=.35)
    for i in range(6): c.line([(9 + i * 2.6, 12 + (i % 2)), (8 + i * 2.8, 24)], .45, '#4a2a18', 170)
    for x, y in ((13.5, 14), (18.5, 14), (16, 17.5)): c.ell(x, y, 1.2, 1.1, '#3a2014', ol=False)
def berries(c, col, kind):
    sh(c, 11)
    if kind == "blue":
        for x, y in ((11, 19), (17, 17), (21, 22), (14, 23.5), (19.5, 12.5)): c.ell(x, y, 3.4, 3.2, col, shade=.35); c.ell(x, y - 1.6, 1.0, .6, dk(col, .5), ol=False); c.shine(x - 1.3, y - .8, .6, 200)
        c.poly([(16, 10), (12, 6), (17, 7), (20, 5)], M['green'], owf=.6)
    else:
        for bx, by in ((11.5, 19), (20.5, 20)):
            c.ell(bx, by, 4.2, 4.8, col, shade=.35, owf=.8)
            for dx, dy in ((-1.6, -2), (1.4, -2), (0, 0), (-1.8, 1.8), (1.6, 1.8), (0, 3.2), (0, -3.4)): c.ell(bx + dx, by + dy, 1.2, 1.2, lt(col, .1), owf=.35)
            c.shine(bx - 1.6, by - 2.2, .5, 210)
        c.poly([(13, 14), (16, 8), (20, 14.5), (16, 12)], M['green'], owf=.6)
def strawberry(c):
    sh(c, 10); col = '#e5303c'
    c.poly([(8, 13), (24, 13), (22, 21), (16, 28), (10, 21)], col, shade=.35)
    for x, y in ((12, 16), (16, 15.5), (20, 16), (14, 20), (18, 20), (16, 24)): c.ell(x, y, .5, .7, '#f7e07a', ol=False)
    c.poly([(9, 13), (12, 8.5), (14, 11), (16, 7), (18, 11), (20, 8.5), (23, 13), (16, 14.5)], M['green'], owf=.7); c.shine(11.5, 15, .8, 200)
def tomato(c): fruit(c, '#e8402e', 8.5, leaf=False, stem=False); c.poly([(11, 11), (14, 9.5), (16, 7), (18, 9.5), (21, 11), (16, 12)], M['green'], owf=.6)
def squash(c):
    sh(c, 10); col = '#f2b33a'
    c.ell(18.5, 20, 7.5, 6.8, col, shade=.35); c.ell(13, 13, 4.2, 5.4, col, shade=.3); c.poly([(10, 14), (16, 12), (21, 17), (14, 20)], col, ol=False, shade=.3)
    c.stroke([(11, 8.5), (9.5, 5)], 1.4, '#6a8a3a'); c.line([(16, 21), (23, 24)], .5, dk(col, .3), 160); c.shine(12, 11, .9, 200)
def beans(c):
    sh(c, 12); col = '#7cbf4a'
    for k in range(2):
        o = k * 5
        c.poly([(5 + o, 22 - o), (8 + o, 17 - o), (14 + o, 14 - o), (21 + o, 12 - o), (25 + o * .5, 13 - o), (22 + o, 16 - o), (15 + o, 19 - o), (9 + o, 23 - o)], col if k else dk(col, .08), shade=.35)
        for i in range(4): c.dot(10 + o + i * 3.5, 19 - o - i * 1.6, .9, lt(col, .25), 200)
        c.stroke([(25 + o * .5, 13 - o), (27 + o * .3, 10 - o)], .6, '#5a8a3a', owf=.4)
def cabbage(c):
    sh(c, 12); col = '#8fcf6a'
    c.ell(16, 19, 11, 8, dk(col, .1), shade=.35); c.ell(16, 18, 8, 6.5, col, shade=.3); c.ell(16, 17, 5, 4.2, lt(col, .15), shade=.25)
    for a in (-60, 0, 60): r = math.radians(a - 90); c.line([(16, 20), (16 + math.cos(r) * 9, 20 + math.sin(r) * 6)], .5, lt(col, .45), 180)
def onion_y(c):
    sh(c, 10); col = '#d99a45'
    c.poly([(16, 6), (19, 12), (24, 17), (23, 24), (16, 27), (9, 24), (8, 17), (13, 12)], col, shade=.35)
    for x in (12.5, 16, 19.5): c.line([(16 + (x - 16) * .3, 9), (x, 18), (16 + (x - 16) * .5, 26)], .5, dk(col, .35), 160)
    c.line([(14, 27.5), (18, 27.5)], .8, '#e5dcc4'); c.shine(12, 15, 1, 180)
def garlic(c, roast=False, clove=False):
    sh(c, 10 if not clove else 8); col = '#c58a4a' if roast else '#f4efe2'
    if clove:
        c.poly([(12, 26), (11, 19), (14, 12), (17, 8), (19, 13), (21, 20), (20, 26), (16, 27.5)], col, shade=.3); c.line([(16, 10), (15, 26)], .4, dk(col, .25), 150); c.shine(14, 16, .8, 200); return
    for x, s in ((11, .85), (21, .85), (16, 1.0)):
        c.poly([(x - 5 * s, 22), (x - 4 * s, 16), (x, 10 * s + 3), (x + 4 * s, 16), (x + 5 * s, 22), (x, 26)], col if x != 16 else lt(col, .1), shade=.3, owf=.8)
    c.stroke([(16, 12), (16, 5)], 1.4, '#d8cdb0' if not roast else '#8a5a2a')
    if roast:
        c.ell(16, 18, 3, 3.5, '#f6c86a', owf=.5); c.line([(5, 29), (27, 29)], 0, (0, 0, 0), 0)
    c.shine(13, 16, .8, 200)
def leafy(c, col, kind):
    sh(c, 10)
    if kind == "hemp":
        for a in (-80, -45, -10, 25, 60, -115, -150):
            r = math.radians(a - 90 + 90); r = math.radians(a - 90)
            x1, y1 = 16 + math.cos(r) * 11, 18 + math.sin(r) * 11
            c.poly([(16, 18), (16 + math.cos(r + .2) * 6, 18 + math.sin(r + .2) * 6), (x1, y1), (16 + math.cos(r - .2) * 6, 18 + math.sin(r - .2) * 6)], col, owf=.6)
        c.stroke([(16, 18), (16, 28)], 1.1, '#5a7a2a')
    elif kind == "aloe":
        for a in (-60, -30, 0, 30, 60):
            r = math.radians(a); c.poly([(13, 26), (16 + math.sin(r) * 13, 26 - math.cos(r) * 18), (19, 26)], col if a % 60 else lt(col, .1), shade=.35, owf=.7)
        c.ell(16, 26.5, 6, 1.6, '#a8784a')
    elif kind == "yarrow":
        c.stroke([(16, 28), (16, 13)], .9, '#6a9a4a'); c.stroke([(16, 20), (11, 14)], .7, '#6a9a4a'); c.stroke([(16, 18), (21, 12)], .7, '#6a9a4a')
        for cx, cy in ((11, 12), (16, 10), (21, 10.5)):
            for dx, dy in ((-1.4, 0), (1.4, 0), (0, -1.2), (0, 1.0), (0, 0)): c.ell(cx + dx, cy + dy, 1.3, 1.2, '#fbf6ea', owf=.45)
            c.dot(cx, cy, .45, '#e8d07a')
        c.poly([(16, 24), (11, 21), (13, 25)], '#7aaf4a', owf=.5); c.poly([(16, 23), (21, 20), (19, 24.5)], '#7aaf4a', owf=.5)
    elif kind == "ginseng":
        col = '#e8c890'
        c.poly([(15, 9), (18, 9), (19, 16), (22, 22), (25, 27), (20, 24), (17, 27), (15, 22), (10, 26), (12, 20), (14, 15)], col, shade=.3)
        for y in (12, 15, 18): c.line([(14.5, y), (18.5, y + .5)], .4, dk(col, .3), 160)
        c.poly([(16, 9), (12, 3), (15, 4.5), (17, 2), (19, 5), (21, 3.5)], M['green'], owf=.6); c.ell(16, 4.5, 1.2, 1.2, '#e2504a', owf=.4)
# ---------------- materials
def bark(c, col, mark, curl=True):
    sh(c, 12)
    c.poly([(6, 21), (10, 11), (22, 7), (26, 11), (23, 22), (11, 26)], col, shade=.3)
    if curl: c.ell(24, 10.5, 3, 4, dk(col, .1), owf=.7); c.ell(24, 10.5, 1.6, 2.4, '#c8a878' if col != '#f2eee4' else '#d9c7a8', ol=False)
    for (x0, y0, x1, y1) in ((9, 16, 14, 14), (13, 21, 18, 19), (16, 13, 19, 12), (11, 19, 13, 18.5), (18, 17, 22, 15.5)): c.line([(x0, y0), (x1, y1)], .8 if mark == '#2a2626' else .5, mark, 220)
def strips(c, col):
    sh(c, 11)
    for i, o in enumerate((-4, 0, 4)): c.poly([(6 + o * .5, 25 + o * .3), (9 + o, 22 + o * .2), (24 + o * .3, 6 + o * .5), (27 + o * .2, 8 + o), (12 + o, 26), (8 + o * .4, 27)], col if i != 1 else lt(col, .1), shade=.3, owf=.8)
    c.stroke([(10, 20), (17, 19), (15, 13)], .9, M['reed'], owf=.5)
def frond(c):
    sh(c, 11); col = '#5fae4a'
    c.stroke([(5, 27), (26, 6)], 1.0, '#7a9a3a')
    for i in range(7):
        t = .15 + i * .12; x, y = 5 + 21 * t, 27 - 21 * t
        c.poly([(x, y), (x - 6 + i * .3, y - 2.5 + i * .2), (x - 1, y - .6)], col, owf=.5); c.poly([(x, y), (x + 2.5 - i * .2, y + 6 - i * .3), (x + .6, y + 1)], dk(col, .08), owf=.5)
def pinecone(c):
    sh(c, 9); col = '#a0663a'
    c.ell(16, 17, 6.5, 9.5, dk(col, .1), shade=.35)
    for row in range(5):
        y = 10 + row * 3.4; n = 2 + (row % 2); w = 6 - abs(row - 2) * .9
        for j in range(n): x = 16 - w * .6 + j * (w * 1.2 / max(1, n - 1)) if n > 1 else 16; c.poly([(x - 2, y), (x, y + 2.6), (x + 2, y)], lt(col, .1), shade=.3, owf=.55)
    c.stroke([(16, 7.5), (17, 4)], 1.0, M['dwood'])
def antler(c):
    sh(c, 12); col = '#e8d8b8'
    c.stroke([(8, 27), (11, 18), (17, 11), (25, 5)], 2.4, col, shade=.3)
    for a, b in (((11, 18), (6, 11)), ((14, 14), (13, 6)), ((19, 9.5), (21, 3.5))): c.stroke([a, b], 1.6, col, shade=.3)
    c.ell(8, 27, 2.6, 1.6, '#b89a72'); c.line([(10, 22), (16, 12.5)], .5, (255, 255, 255), 150)
def snakeskin(c):
    sh(c, 12); col = '#7aa64a'
    c.stroke([(5, 24), (10, 18), (16, 22), (22, 16), (27, 10)], 4.4, col, shade=.3)
    for x, y in ((7.5, 21.5), (12.5, 19.5), (18.5, 19.5), (23.5, 13.5)): c.poly([(x - 1.4, y), (x, y - 1.3), (x + 1.4, y), (x, y + 1.3)], '#e8d36a', ol=False)
    for x, y in ((10, 18), (16, 22), (21, 17)): c.dot(x, y, .5, dk(col, .4), 200)
def candle(c):
    sh(c, 8); col = '#f4ead0'
    c.ell(16, 25, 7.5, 2.4, '#a87a4a'); c.rect(12, 11, 20, 25, col, r=1.5, shade=.3); c.ell(16, 11, 4, 1.4, lt(col, .2), ol=False)
    c.ell(14, 13, 1.1, 2, col, owf=.5); c.line([(16, 10.5), (16, 8)], .6, '#3a2a20')
    c.poly([(16, 2.5), (18, 6.5), (16, 8.5), (14, 6.5)], '#ffb22e', ol=False); c.poly([(16, 4.5), (17, 7), (16, 8), (15, 7)], '#fff1a0', ol=False); c.line([(13, 14), (13, 23)], .6, (255, 255, 255), 150)
def needle(c):
    sh(c, 8); col = M['bone']
    c.poly([(6, 27), (24.5, 5.5), (26.5, 7.5)], col, shade=.3); c.ell(23.8, 7.8, 1.0, 1.6, '#c9b590', ol=False)
    c.stroke([(24, 7), (20, 14), (24, 19), (18, 25)], .5, '#e6d8a8', owf=.4)
def hoe(c):
    sh(c); I.handle_diag(c, (6, 27), (22, 9), 2.4, M['wood'])
    c.poly([(19, 6), (22, 9), (26, 6), (28.5, 9.5), (26, 13), (22, 11.5)], M['iron'], shade=.4); c.poly([(25, 6), (28.5, 9.5), (29.5, 14), (27, 15)], M['iron'], shade=.4); I.gloss(c, M['iron'], 26.5, 8)
def watering_can(c):
    sh(c, 12); col = '#7fb0c8'
    c.stroke([(21, 18), (28, 9)], 2.0, col); c.ell(28.5, 8.5, 2.2, 1.4, dk(col, .1))
    c.poly([(7, 14), (21, 14), (22, 26), (6, 26)], col, shade=.35); c.ell(14, 14, 7, 2.2, dk(col, .15))
    c.stroke([(9, 13), (11, 6), (18, 6), (20, 13)], 1.2, dk(col, .1)); c.line([(8, 17), (8, 24)], .7, (255, 255, 255), 150)
    for x in (27, 29.5, 28.2): c.dot(x, 12 + (x - 27) * 1.5, .5, '#9fd8f0', 220)
def candle_k(c): candle(c)
def milk(c): I.bottle(c, '#e6f2f7', '#ffffff', cork='#7fb0c8', fat=True, label='#7fb0c8'); c.ell(16, 20.5, 2.2, 1.5, '#ffffff', ol=False)
def meal_sack(c, col, dust, mark=None):
    I.sack(c, col, label=mark, dust=dust)
def bonemeal(c): I.sack(c, '#e9dcc0', label=None, dust='#ffffff'); c.ell(16, 20, 4, 1.8, M['bone'], owf=.5); [c.ell(x, 20, 1.3, 1.3, M['bone'], owf=.5) for x in (12, 20)]
def fertilizer(c): I.sack(c, '#8a6a3a', label='#6fbf4e', dust='#5a4028'); c.poly([(14.5, 21), (16, 17.5), (17.5, 21)], '#e8f6c8', ol=False)
def sweater(c): I.shirt(c, '#d8b8e0'); [c.line([(10, y), (22, y)], .5, '#b490c0', 190) for y in (13, 16, 19, 22)]; c.rect(9, 23, 23, 25, '#b490c0', ol=False)
def wool_hat(c):
    sh(c, 12); col = '#e07a5a'
    c.poly([(7, 22), (8, 14), (12, 9), (20, 9), (24, 14), (25, 22)], col, shade=.3); c.rect(6, 19, 26, 24, lt(col, .2), r=1.5)
    for x in range(9, 24, 3): c.line([(x, 19.5), (x, 23.5)], .45, dk(col, .25), 170)
    c.ell(16, 7.5, 3, 2.8, '#f4ead0', owf=.6)
def vest(c):
    I.shirt(c, '#8a5a3a', long=False, accent='#e9d8b8')
def stew(c): I.bowl(c, '#c8783a', [(11.5, 16, '#f08a2c'), (16, 15.4, '#6fbf4e'), (20.5, 16.2, '#f2e2b4'), (14, 17.2, '#e8402e'), (18.5, 17.3, '#f08a2c')])
def fruit_salad(c): I.bowl(c, '#f6e6c8', [(11, 15.6, '#e5303c'), (14.5, 16.6, '#f39a22'), (17.5, 15.2, '#b7cf4a'), (20.5, 16.4, '#5a6fd0'), (16, 17.2, '#f6b07a')], steam=False)
def baked_beans(c): I.bowl(c, '#c0502a', [(x, y, '#e08a4a') for x, y in ((11, 15.8), (13.5, 16.8), (16, 15.4), (18.5, 16.6), (21, 15.8), (15, 17.4), (19.5, 17.4))])
def willow_tea(c): I.bottle(c, '#d8ecc8', '#b5a04a', steam=True); c.poly([(14, 20), (16, 17.5), (18, 20), (16, 22.5)], '#7aaf4a', ol=False)
def maple_syrup(c): I.bottle(c, '#e6a24a', '#a8541e', fat=True, cork='#8a5a2a', label='#f7ead1'); c.poly([(16, 18.6), (17, 20), (18.5, 19.5), (17.5, 21), (16, 22.5), (14.5, 21), (13.5, 19.5), (15, 20)], '#d8402e', ol=False)
def maple_sap(c):
    sh(c, 10); col = '#9a9aa3'
    c.poly([(8, 12), (24, 12), (22, 27), (10, 27)], col, shade=.35); c.ell(16, 12, 8, 2.4, dk(col, .15)); c.ell(16, 12.2, 6.8, 1.7, '#f6e8b8', ol=False)
    c.stroke([(8.5, 13), (16, 5), (23.5, 13)], .7, dk(col, .2), owf=.5); c.dot(16, 9, 1.0, '#f6e8b8', 230); c.line([(10, 15), (11, 25)], .6, (255, 255, 255), 140)
def roasted_garlic(c): garlic(c, roast=True)
def tallow(c): I.block(c, '#efe4c4', '#fbf4de')
def wool(c): I.tuft(c, '#f4efe6')
def wool_cloth(c): I.cloth(c, '#e8e0d0', pattern='weave')
def pie_pumpkin(c): I.pie(c, '#e8862a', lattice=False)

def k(name, fn, *a, **kw): T[name] = (lambda c: fn(c, *a, **kw))
T = {}
k('raw_venison', steak, '#b8433a', '#f2dcc8'); k('cooked_venison', steak, '#b8433a', '#f2dcc8', cooked=True)
k('raw_poultry', drumstick, '#f2b8a0'); k('cooked_poultry', drumstick, '#f2b8a0', cooked=True)
k('raw_small_game', drumstick, '#d0705a', small=True); k('cooked_small_game', drumstick, '#d0705a', cooked=True, small=True)
k('raw_prime_cut', steak, '#d8504a', '#f6e6d6', bone=True, marble=True); k('cooked_prime_cut', steak, '#d8504a', '#f6e6d6', cooked=True, bone=True)
SEEDS = {'wheat_seeds': ('#e5c25a', '#d9b65a'), 'corn_seeds': ('#f2c84b', '#f2c84b'), 'carrot_seeds': ('#f08a2c', '#a07a4a'), 'tomato_seeds': ('#e8402e', '#f2e2b4'),
         'pumpkin_seeds': ('#e8862a', '#f6ecd0'), 'squash_seeds': ('#f2b33a', '#f6ecd0'), 'beans_seeds': ('#7cbf4a', '#e6d0a0'), 'cabbage_seeds': ('#8fcf6a', '#5a4030'),
         'onion_seeds': ('#d99a45', '#3a3030'), 'cotton_seeds': ('#fbfaf3', '#5a4a3a'), 'flax_seeds': ('#5c8fe0', '#a8703a'), 'hemp_seeds': ('#5fae4a', '#8a7a5a'),
         'herbs_seeds': ('#6dae4a', '#6a5a3a'), 'yarrow_seeds': ('#fbf6ea', '#7a6a4a'), 'ginseng_seeds': ('#e2504a', '#e2504a'), 'aloe_seeds': ('#6fae7a', '#3a3030'),
         'blueberry_seeds': ('#5a6fd0', '#7a5a3a'), 'raspberry_seeds': ('#e04a6a', '#c89a6a'), 'blackberry_seeds': ('#4a2a5a', '#7a5a3a'), 'strawberry_seeds': ('#e5303c', '#f7e07a')}
for name, (col, seed) in SEEDS.items(): k(name, seedbag, col, seed, em_berry(lt(col, .1)) if 'berry' in name else em_leaf)
k('seed_potato', lambda c: (I.potato(c), [c.stroke([(x, y), (x + dx, y - 3)], .8, '#9fd06a', owf=.5) for x, y in ((12, 13), (19, 12), (21, 18)) for dx in (1.5,)]))
k('garlic_clove', garlic, clove=True)
k('mushroom_spores', lambda c: (I.pouch(c, '#c9a8d8', tie='#8a5a35'), [c.dot(x, y, .6, '#f4ead0', 230) for x, y in ((12, 8), (16, 5.5), (20, 8), (14, 3.5), (18.5, 3.2))]))
SAP = {'oak_sapling': ('#5fa84a', 'round', None), 'birch_sapling': ('#9ccf5a', 'round', None), 'maple_sapling': ('#e0603a', 'round', None), 'willow_sapling': ('#8fbf5a', 'willow', None),
       'palm_sapling': ('#5fae4a', 'palm', None), 'apple_sapling': ('#5fa84a', 'round', '#e2504a'), 'pear_sapling': ('#6aae4a', 'round', '#b7cf4a'), 'cherry_sapling': ('#f2a8c0', 'round', '#d8283a'),
       'orange_sapling': ('#4f9a3e', 'round', '#f39a22'), 'peach_sapling': ('#6aae4a', 'round', '#f6b07a')}
for name, (leaf, kind, fr) in SAP.items(): k(name, sapling, leaf, kind, fr)
k('milk', milk); k('tallow', tallow); k('antler', antler); k('wool', wool); k('snake_skin', snakeskin); k('bone_meal', bonemeal); k('tallow_candle', candle)
k('bone_needle', needle); k('bone_knife', I.knife, M['bone'], M['leather'], .85, guard=False, shape='leaf'); k('bone_axe', I.axe, M['bone'], M['wood'])
k('antler_pickaxe', pick_antler); k('bone_arrow', I.arrow, M['bone']); k('wool_cloth', wool_cloth)
k('leather_cap', I.hat, 'cap', '#9a5a32'); k('leather_jacket', I.shirt, '#9a5a32', accent='#6d3f25'); k('leather_trousers', I.trousers, '#8a4f2c', pocket=True)
k('wool_sweater', sweater); k('wool_hat', wool_hat); k('fur_vest', vest); k('snakeskin_boots', I.boots, '#7aa64a', sole='#4a3326', tall=True)
k('hoe', hoe); k('watering_can', watering_can); k('fertilizer', fertilizer)
k('wheat', I.stalks, '#c9a84a', top='#e5c25a'); k('tomato', tomato); k('squash', squash); k('beans', beans); k('cabbage', cabbage); k('onion', onion_y); k('garlic', garlic)
k('hemp', leafy, '#5fae4a', 'hemp'); k('yarrow', leafy, None, 'yarrow'); k('ginseng', leafy, None, 'ginseng'); k('aloe', leafy, '#6fae7a', 'aloe')
k('blueberry', berries, '#5a6fd0', 'blue'); k('raspberry', berries, '#e04a6a', 'drupe'); k('blackberry', berries, '#4a2a5a', 'drupe'); k('strawberry', strawberry)
k('pear', pear); k('cherry', cherry); k('orange', citrus); k('peach', peach)
k('birch_bark', bark, '#f2eee4', '#2a2626'); k('maple_sap', maple_sap); k('willow_bark', strips, '#8a6a4a'); k('palm_frond', frond); k('coconut', coconut)
k('maple_syrup', maple_syrup); k('pine_cone', pinecone); k('vegetable_stew', stew); k('pumpkin_pie', pie_pumpkin); k('fruit_salad', fruit_salad)
k('baked_beans', baked_beans); k('roasted_garlic', roasted_garlic); k('willow_tea', willow_tea)
REUSED = ('pine_sapling', 'pumpkin')   # already in the base pack
EQUIP = ('bone_knife', 'bone_axe', 'antler_pickaxe', 'hoe', 'leather_cap', 'leather_jacket', 'leather_trousers', 'wool_sweater', 'wool_hat', 'fur_vest', 'snakeskin_boots')

def _icon(key):
    c = C(32, 8); T[key](c); return c.out(32), c.out(64)

def g(b):
    keys = list(T); cols = 16; rows = math.ceil(len(keys) / cols); rows += rows % 2   # 32*rows stays 16-aligned anyway; even rows keep @2x tidy
    p1 = Image.new("RGBA", (32 * cols, 32 * rows), (0, 0, 0, 0)); p2 = Image.new("RGBA", (64 * cols, 64 * rows), (0, 0, 0, 0)); prev = []
    for i, key in enumerate(keys):
        i1, i2 = _icon(key); x, y = i % cols, i // cols; p1.alpha_composite(i1, (x * 32, y * 32)); p2.alpha_composite(i2, (x * 64, y * 64)); prev.append((key, i2))
    os.makedirs(os.path.join(FRAG, "atlases"), exist_ok=True)
    p1.save(os.path.join(FRAG, "atlases/nature_icons.png"), optimize=True); p2.save(os.path.join(FRAG, "atlases/nature_icons@2x.png"), optimize=True)
    b.atlases.append({"key": "nature_icons", "image": "atlases/nature_icons.png", "frameW": 32, "frameH": 32, "columns": cols, "rows": rows, "pages": [{"scale": 2, "image": "atlases/nature_icons@2x.png"}]})
    for i, key in enumerate(keys):
        b.sprites.append({"key": key, "category": "equipment" if key in EQUIP else "item", "atlas": "nature_icons", "anchor": {"x": 0.5, "y": 0.5}, "animations": {"idle": {"frames": [i], "fps": 1}}})
    b.previews["nature_icons"] = prev

GROUPS = [g]
