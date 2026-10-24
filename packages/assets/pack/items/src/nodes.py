# Gatherable world nodes: 64x64 cell, 2:1 iso footprint (64x32 tile) centred at x=32, feet/pivot at y=56 (anchor 0.5,0.875).
import math, random
from draw import C, lt, dk, mix
from icons import M
GX, GY = 32, 56
def ground(c, col='#7fb35a', rx=22, ry=9, a=80):
    c.shadow(GX, GY-1, rx, ry, a)
def tuftg(c, x, y, col='#6fbf4e', h=5):
    for d in (-1.5, 0, 1.5): c.stroke([(x, y), (x+d*1.4, y-h+abs(d))], 1, col, owf=.5)
def reed_bed(c, dep):
    ground(c); c.ell(GX, GY-2, 20, 7, '#5f9fd0', shade=.2); c.ell(GX-4, GY-3, 7, 2, '#a9d6f2', ol=False)
    R = random.Random(1)
    for i in range(14):
        x = GX-16+i*2.4+R.uniform(-1, 1); h = (6 if dep else 24)+R.uniform(0, 8 if not dep else 2); lean = R.uniform(-4, 4)
        c.stroke([(x, GY-2), (x+lean*.4, GY-2-h*.6), (x+lean, GY-2-h)], 1.3, mix('#7fbf4a', '#b8c460', R.random()), owf=.6)
        if not dep and i % 3 == 0: c.rect(x+lean-1.2, GY-2-h-1, x+lean+1.2, GY-2-h+5, '#8a5a35', r=1.2, owf=.6)
def patch(c, dep, flower, stem='#5ea844', leafy=False, n=11, seed=0):
    ground(c); c.ell(GX, GY-1, 21, 8, '#8a5a3a', shade=.2)
    R = random.Random(seed)  # was hash(flower) % 99 (PYTHONHASHSEED-dependent); seeds recovered from the committed atlas
    for i in range(n):
        a = i/n*math.tau; x = GX+math.cos(a)*14*R.uniform(.3, 1); y = GY-1+math.sin(a)*5*R.uniform(.3, 1); h = 4 if dep else R.uniform(12, 18)
        if leafy:
            for d in (-1, 1): c.poly([(x, y), (x+d*5, y-h*.6), (x+d*1, y-h)], mix(stem, '#9be06a', R.random()*.5), owf=.7)
            if not dep: c.ell(x, y-h, 1.4, 1.4, flower, owf=.5)
        else:
            c.stroke([(x, y), (x+R.uniform(-2, 2), y-h)], .9, stem, owf=.5)
            if not dep: c.ell(x, y-h, 2, 1.8, flower, owf=.6); c.dot(x, y-h, .6, '#fff4b0')
    if dep: [tuftg(c, GX+d, GY-2, '#6a9a48', 3) for d in (-8, 0, 8)]
def cotton_bush(c, dep):
    ground(c); 
    for x, y, r in ((GX-9, GY-10, 9), (GX+9, GY-10, 9), (GX, GY-16, 10), (GX, GY-7, 10)): c.ell(x, y, r, r*.8, '#4f9a45', shade=.35)
    if not dep:
        for x, y in ((GX-10, GY-14), (GX+4, GY-22), (GX+11, GY-12), (GX-3, GY-9), (GX+2, GY-14), (GX-7, GY-21)):
            c.ell(x-1.3, y, 2.4, 2.2, '#fdfcf6', owf=.6); c.ell(x+1.3, y, 2.4, 2.2, '#ffffff', owf=.6)
    else: [c.dot(x, y, 1, '#7a5030') for x, y in ((GX-8, GY-14), (GX+5, GY-20), (GX+10, GY-12))]
def wild_garden(c, dep):
    ground(c, rx=24); c.poly([(GX-24, GY-4), (GX, GY-15), (GX+24, GY-4), (GX, GY+7)], '#9a6a44', shade=.25)
    for i in range(3): c.line([(GX-18+i*6, GY-6+i*3+1), (GX+2+i*6, GY-16+i*3+1+4)], .8, '#7a4e30', 200)
    c.stroke([(GX+18, GY-4), (GX+18, GY-20)], 1.5, M['dwood']); c.stroke([(GX+14, GY-16), (GX+22, GY-16)], 1.2, M['dwood'])
    if not dep:
        c.ell(GX-10, GY-6, 5, 4, '#f08a2c', shade=.4); c.stroke([(GX-10, GY-10), (GX-9, GY-12)], 1, '#5ea844')
        for x, y in ((GX+2, GY-10), (GX+8, GY-5), (GX-3, GY-2)):
            for d in (-1, 1): c.poly([(x, y), (x+d*4, y-6), (x+d, y-9)], '#6fbf4e', owf=.7)
        c.ell(GX+6, GY-13, 2, 1.6, '#e2504a'); c.ell(GX+10, GY-11, 2, 1.6, '#e2504a')
        tuftg(c, GX-18, GY-6, '#7fbf4a', 8); tuftg(c, GX+14, GY+1, '#7fbf4a', 7)
    else: tuftg(c, GX-6, GY-6, '#7a9a48', 3); tuftg(c, GX+6, GY-2, '#7a9a48', 3)
def beehive(c, dep):
    ground(c); c.poly([(GX-10, GY-1), (GX-9, GY-14), (GX+9, GY-14), (GX+10, GY-1)], '#8a5a35', shade=.3); c.ell(GX, GY-14, 9, 3.5, '#d9b07a'); c.ell(GX, GY-14, 5, 1.8, '#b5844e', ol=False)
    c.stroke([(GX+6, GY-14), (GX+14, GY-26)], 2, '#8a5a35')
    if not dep:
        for i in range(4): c.ell(GX+12, GY-22-i*2.8 + 0, 6-i*.9, 2.2, '#f0b440', shade=.3, owf=.7)
        c.ell(GX+12, GY-17, 1.3, 1.1, '#3a2a1e', ol=False)
        for x, y in ((GX-6, GY-28), (GX+2, GY-34), (GX+22, GY-30), (GX+20, GY-16)):
            c.ell(x, y, 1.6, 1.2, '#f7d23a', owf=.5); c.line([(x-.6, y-1), (x-.6, y+1)], .4, '#2a2020'); c.dot(x-.8, y-1.6, .9, '#ffffff', 200); c.dot(x+.8, y-1.6, .9, '#ffffff', 200)
    else: c.poly([(GX+9, GY-20), (GX+15, GY-21), (GX+13, GY-17)], '#c9963a')
def resin_tree(c, dep):
    ground(c, rx=16, ry=6)
    if not dep:
        for i, (w, y) in enumerate(((17, GY-14), (14, GY-24), (11, GY-34), (7, GY-43))): c.poly([(GX-w, y), (GX, y-15), (GX+w, y)], mix('#3f8a4a', '#62b05a', i*.25), shade=.35)
    c.rect(GX-3.5, GY-16, GX+3.5, GY-1, '#8a5632', r=1); c.ell(GX, GY-1, 5, 1.8, '#7a4a2a')
    c.poly([(GX-2.5, GY-10), (GX+2.5, GY-12), (GX+2, GY-9)], '#5a3420', ol=False)
    c.ell(GX+1, GY-6.5 if dep else GY-6, 1.6, 2.4 if not dep else 1, '#f0a22e', owf=.6); c.shine(GX+.5, GY-7, .5)
    if dep:  # stump with fresh cut top
        c.ell(GX, GY-16, 3.5, 1.4, '#e6c08a')
def salt_flat(c, dep):
    c.poly([(GX-26, GY-3), (GX, GY-16), (GX+26, GY-3), (GX, GY+8)], '#c7ab82', shade=.2)
    if not dep:
        c.poly([(GX-20, GY-3), (GX, GY-13), (GX+21, GY-3), (GX, GY+6)], '#f6f4ec', shade=.18)
        for p in ([(GX-10, GY-8), (GX-2, GY-4), (GX+4, GY-9)], [(GX-2, GY-4), (GX, GY+3)], [(GX+4, GY-9), (GX+13, GY-5)], [(GX-14, GY-3), (GX-6, GY+1)]): c.line(p, .5, '#c9c4b8', 230)
        for x, y in ((GX-6, GY-10), (GX+9, GY-7), (GX-12, GY-5)): c.poly([(x, y), (x+2, y-4), (x+4, y)], '#ffffff', owf=.5)
    else:
        for x, y in ((GX-8, GY-4), (GX+7, GY-1)): c.ell(x, y, 4, 1.8, '#efece2', owf=.6)
def rubble(c, dep):
    ground(c, rx=22)
    R = random.Random(5); blocks = 9 if not dep else 4
    for i in range(blocks):
        x, y = GX+R.uniform(-15, 15)*(1 if not dep else .6), GY-3-R.uniform(0, 10 if not dep else 3)-(i*1.2 if not dep else 0); w = R.uniform(4, 7)
        c.poly([(x-w, y), (x-w*.6, y-w*.8), (x+w*.7, y-w*.9), (x+w, y-.5), (x+w*.2, y+w*.3)], mix('#a3a1a8', '#c7b39a', R.random()), shade=.35, owf=.8)
    if not dep:
        c.stroke([(GX-6, GY-14), (GX-2, GY-25), (GX+4, GY-22)], 1.5, '#b0683d'); c.stroke([(GX+8, GY-10), (GX+16, GY-20)], 1.3, '#8d97a6'); c.dot(GX+15, GY-19, .8, '#d58a4a')
def vein(c, dep, rock, vein_col, crust=False, cubic=False, sheen=None):
    ground(c, rx=21)
    if dep:
        for x, y, w in ((GX-8, GY-3, 7), (GX+7, GY-2, 6), (GX, GY-7, 5)): c.poly([(x-w, y), (x-w*.5, y-w), (x+w*.6, y-w*.9), (x+w, y)], rock, shade=.35)
        c.dot(GX-6, GY-5, 1, vein_col); return
    c.poly([(GX-20, GY-2), (GX-17, GY-16), (GX-8, GY-27), (GX+6, GY-28), (GX+17, GY-20), (GX+21, GY-4), (GX+8, GY+2), (GX-10, GY+2)], rock, shade=.4)
    c.poly([(GX-17, GY-16), (GX-8, GY-27), (GX+6, GY-28), (GX+17, GY-20), (GX+4, GY-18), (GX-6, GY-15)], lt(rock, .15), ol=False, shade=.1)
    pts = [(GX-17, GY-6), (GX-8, GY-12), (GX, GY-10), (GX+8, GY-18), (GX+16, GY-14)]
    c.line(pts, 3.2 if not crust else 4.5, dk(vein_col, .35)); c.line(pts, 2.2 if not crust else 3.5, vein_col)
    if cubic:
        for x, y in ((GX-9, GY-13), (GX+7, GY-19), (GX+1, GY-11)): c.poly([(x, y), (x+3, y-1), (x+3.8, y+2), (x+.8, y+3)], lt(vein_col, .3), owf=.6); c.shine(x+1.5, y+.5, .5)
    if crust:
        for x, y in ((GX-12, GY-9), (GX+4, GY-14), (GX+13, GY-16)): c.ell(x, y, 2.4, 1.8, lt(vein_col, .3), owf=.6)
    if sheen: c.line([(GX-10, GY-13), (GX-4, GY-12)], .8, sheen, 230); c.line([(GX+6, GY-18), (GX+11, GY-17)], .8, sheen, 230)
    c.line([(GX-6, GY-24), (GX+3, GY-25)], 1, (255, 255, 255), 110)
def sulfur_vent(c, dep):
    vein(c, False, '#8f8578', '#f7dc2f', crust=True) if not dep else vein(c, True, '#8f8578', '#f7dc2f')
    if not dep:
        c.ell(GX+1, GY-22, 4, 1.6, '#3a3330'); 
        for i, (x, y, r) in enumerate(((GX+1, GY-29, 4), (GX+4, GY-36, 5), (GX-1, GY-44, 5.5), (GX+3, GY-52, 4))): c.dot(x, y, r, (240, 240, 230), 150-i*25)
def oil_seep(c, dep):
    c.poly([(GX-24, GY-3), (GX, GY-14), (GX+24, GY-3), (GX, GY+8)], '#8a6a48', shade=.2)
    rx, ry = (17, 6.5) if not dep else (8, 3)
    c.ell(GX, GY-3, rx, ry, '#1d1a22', shade=.15); c.ell(GX-rx*.35, GY-4.5, rx*.35, ry*.25, '#5a5470', ol=False); c.dot(GX+rx*.3, GY-3.5, 1, '#8a7fb0', 200)
    if not dep:
        for x, y in ((GX+6, GY-6), (GX-3, GY-1)): c.ell(x, y, 1.5, 1.1, '#2e2a36', owf=.4); c.shine(x-.5, y-.4, .4, 180)
        tuftg(c, GX-20, GY-3, '#6a8a40', 6); tuftg(c, GX+19, GY-1, '#6a8a40', 5)
N = {
    'reed_bed': reed_bed, 'flax_patch': lambda c, d: patch(c, d, '#6d8fe8', seed=15), 'cotton_bush': cotton_bush,
    'herb_patch': lambda c, d: patch(c, d, '#e9f0a0', '#4f9a45', leafy=True, n=9, seed=83), 'wild_garden': wild_garden, 'beehive': beehive, 'resin_tree': resin_tree,
    'salt_flat': salt_flat, 'rubble_pile': rubble, 'saltpeter_deposit': lambda c, d: vein(c, d, '#7f7a80', '#f4f6f8', crust=True),
    'sulfur_vent': sulfur_vent, 'galena_vein': lambda c, d: vein(c, d, '#8a8a92', '#b9c0ca', cubic=True), 'oil_seep': oil_seep,
    'chromite_vein': lambda c, d: vein(c, d, '#6b6670', '#2a2a32', sheen='#c8d4e4'),
}
SWAY = {'reed_bed': (1.8, .7, .3), 'flax_patch': (1.5, .8, .3), 'cotton_bush': (.9, .5, .7), 'herb_patch': (1.0, .8, .4), 'wild_garden': (.8, .6, .6), 'resin_tree': (.6, .4, .8)}
