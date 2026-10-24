# Vehicle part / fuel / repair icon recipes (32-unit space, art inside 2..30, same painter + style as pack/items icons).
import math
from draw import C, lt, dk, mix
def sh(c, w=10): c.shadow(16, 28.2, w, 2.2)
STEEL, IRON, DARK, RUB, CU, RED, WOOD = '#c9d3df', '#8d97a6', '#4a4f5c', '#3a3a44', '#e08a45', '#e2504a', '#b5743d'
def jug(c, col, label, mark, cap='#3c3f49'):
    sh(c, 9); c.poly([(9, 9), (21, 9), (24, 12), (24, 27), (8, 27), (8, 10)], col, shade=0.35)
    c.rect(19, 4.5, 23, 9.5, cap, r=1); c.stroke([(10, 9), (13, 5.5), (17, 5.5)], 1.6, dk(col, .15))
    c.rect(10.5, 14, 21.5, 23, label, r=1.5, owf=.6); mark(c); c.shine(10.5, 12, 1)
def drop(c, x, y, col, s=1.0): c.poly([(x, y-4*s), (x+2.6*s, y+0.5*s), (x, y+2.8*s), (x-2.6*s, y+0.5*s)], col, owf=.6); c.ell(x, y+0.6*s, 2.5*s, 2.3*s, col, ol=False)
def leaf(c, x, y, col): c.poly([(x-3.5, y+2.5), (x-2, y-2), (x+3, y-3.5), (x+1.5, y+1.5)], col, owf=.6); c.line([(x-3, y+2), (x+2, y-2.5)], .5, dk(col, .4))
def tire(c, cx, cy, r, w=None, col=RUB, hub=None):
    c.ell(cx, cy, r, r, col, shade=.3); 
    for a in range(0, 360, 30):
        t = math.radians(a); c.line([(cx+math.cos(t)*(r-1.6), cy+math.sin(t)*(r-1.6)), (cx+math.cos(t)*(r-.3), cy+math.sin(t)*(r-.3))], .7, dk(col, .5), 200)
    if hub: c.ell(cx, cy, r*.55, r*.55, hub, shade=.4); c.ell(cx, cy, r*.18, r*.18, dk(hub, .3), owf=.5); c.shine(cx-r*.25, cy-r*.3, .8)
    else: c.ell(cx, cy, r*.5, r*.5, '#79a86a', ol=True, owf=.8); c._paint(c._mask(lambda d: d.ellipse([(cx-r*.5)*c.S, (cy-r*.5)*c.S, (cx+r*.5)*c.S, (cy+r*.5)*c.S], fill=255)), '#000000', ol=False) if False else None
def ring(c, cx, cy, r, w, col):
    c.stroke([(cx+math.cos(math.radians(a))*r, cy+math.sin(math.radians(a))*r) for a in range(0, 365, 10)], w, col)
def spokes(c, cx, cy, r, n=12, col='#dfe5ee'):
    for i in range(n): t = math.pi*2*i/n; c.line([(cx, cy), (cx+math.cos(t)*r, cy+math.sin(t)*r)], .45, col)
T = {}
def k(n): 
    def d(f): T[n] = f; return f
    return d
# fuels
@k('item_plant_oil')
def _(c): jug(c, '#e9c440', '#f7ead1', lambda c: leaf(c, 16, 18.5, '#6fbf4e'), cap='#7d4a2b')
@k('item_gasoline')
def _(c): jug(c, RED, '#f7ead1', lambda c: drop(c, 16, 18.5, '#f2a922'))
@k('item_diesel')
def _(c): jug(c, '#3f8a4a', '#f7ead1', lambda c: drop(c, 16, 18.5, '#3c3f49'))
@k('item_biofuel')
def _(c): jug(c, '#5ab3a0', '#f7ead1', lambda c: (drop(c, 14.5, 18.5, '#9bd24a'), leaf(c, 18.5, 19.5, '#3f9a3a')))
# raw parts
@k('item_rubber')
def _(c): sh(c); c.rect(6, 15, 26, 25, '#3d3d47', r=3); c.rect(8, 9, 24, 17, '#56565f', r=3); c.line([(10, 12), (22, 12)], .6, '#8a8a94'); c.shine(10, 11, .9)
@k('item_copper_wire')
def _(c):
    sh(c, 9); c.ell(16, 17, 9, 9, '#a85f2c', shade=.3)
    for r in (7.5, 6, 4.5): ring(c, 16, 17, r, 1.1, CU)
    c.ell(16, 17, 2.6, 2.6, '#7d4a2b'); c.stroke([(23, 21), (27, 26), (24.5, 28)], 1.2, CU); c.shine(12, 12, 1)
@k('item_sulfuric_acid')
def _(c):
    sh(c, 8); c.poly([(13, 4), (19, 4), (19, 10), (25, 21), (24, 27), (8, 27), (7, 21), (13, 10)], '#e9f3f7', shade=.2)
    c.poly([(9.5, 18), (22.5, 18), (24, 22), (23, 25.5), (9, 25.5), (8, 22)], '#c8e64a', ol=False); c.rect(12.5, 3, 19.5, 6, '#e2504a', r=1)
    c.poly([(16, 19), (19, 24.5), (13, 24.5)], '#f2c84b', owf=.5); c.dot(16, 22.8, .5, '#3c3f49'); c.line([(16, 20.5), (16, 22)], .5, '#3c3f49'); c.shine(11, 13, .9)
# bike
def frame(c, col):
    c.stroke([(8, 22), (14, 12), (23, 12), (17, 22), (8, 22)], 1.8, col); c.stroke([(14, 12), (13, 9)], 1.6, col); c.stroke([(23, 12), (25, 22)], 1.6, col)
    c.stroke([(11, 8.5), (15.5, 8.5)], 1.6, '#3c3f49'); c.stroke([(22, 12), (23, 8), (26, 7.5)], 1.4, '#3c3f49'); c.ell(17, 22, 1.8, 1.8, '#9aa3b0')
@k('item_bike_frame')
def _(c): sh(c, 11); frame(c, '#3fa8d8')
@k('item_bike_tire')
def _(c): sh(c, 10); ring(c, 16, 16, 9.5, 3.4, RUB); ring(c, 16, 16, 9.5, .5, '#5a5a66')
@k('item_bike_wheel')
def _(c): sh(c, 10); ring(c, 16, 16, 10, 2.6, RUB); ring(c, 16, 16, 8.3, 1, '#c9d3df'); spokes(c, 16, 16, 8); c.ell(16, 16, 1.8, 1.8, '#9aa3b0')
@k('item_bike_chain')
def _(c):
    sh(c, 10)
    for i in range(7):
        x = 6+i*3.3; y = 22-i*2.3; c.rect(x-2, y-1.4, x+2, y+1.4, IRON if i % 2 else STEEL, r=1.3, owf=.7); c.dot(x, y, .5, DARK)
    c.ell(24, 9, 4.5, 4.5, '#9aa3b0'); c.ell(24, 9, 1.5, 1.5, DARK, owf=.5)
@k('item_saddle')
def _(c): sh(c, 9); c.stroke([(16, 18), (16, 27)], 2, IRON); c.poly([(6, 12), (10, 9), (19, 10), (27, 13), (26, 16), (18, 18), (9, 17)], '#7d4a2b', shade=.35); c.line([(10, 11), (22, 12.5)], .6, lt('#7d4a2b', .4)); c.shine(10, 11, .9)
# wheels
@k('item_tire')
def _(c): sh(c, 11); c.ell(16, 16, 11, 11, RUB, shade=.3); c.ell(16, 16, 5.6, 5.6, '#6b9e5e', owf=.8); [c.line([(16+math.cos(math.radians(a))*7, 16+math.sin(math.radians(a))*7), (16+math.cos(math.radians(a))*10.3, 16+math.sin(math.radians(a))*10.3)], .8, '#5a5a66') for a in range(0, 360, 24)]; c.shine(10, 10, 1)
@k('item_wheel_rim')
def _(c):
    sh(c, 10); c.ell(16, 16, 10, 10, STEEL, shade=.35); c.ell(16, 16, 7.5, 7.5, IRON, ol=False)
    for a in range(0, 360, 72): t = math.radians(a); c.poly([(16+math.cos(t-.3)*2, 16+math.sin(t-.3)*2), (16+math.cos(t-.15)*7.5, 16+math.sin(t-.15)*7.5), (16+math.cos(t+.15)*7.5, 16+math.sin(t+.15)*7.5), (16+math.cos(t+.3)*2, 16+math.sin(t+.3)*2)], STEEL, owf=.5)
    c.ell(16, 16, 2.4, 2.4, '#dfe5ee'); c.shine(12, 11, 1)
@k('item_wheel')
def _(c): sh(c, 11); tire(c, 16, 16, 11, hub=STEEL)
@k('item_axle')
def _(c): sh(c, 12); c.stroke([(6, 20), (26, 12)], 2.4, IRON); c.ell(6, 20, 3.2, 3.2, STEEL); c.ell(26, 12, 3.2, 3.2, STEEL); c.ell(16, 16, 2.8, 2.4, '#d9903f'); c.shine(5, 19, .7)
@k('item_steering_column')
def _(c): sh(c, 9); c.stroke([(19, 27), (14, 15)], 2.2, IRON); ring(c, 13, 11, 7, 2.4, DARK); c.stroke([(13, 11), (13, 4.5)], 1.4, DARK); c.stroke([(13, 11), (7, 14)], 1.4, DARK); c.stroke([(13, 11), (19, 14)], 1.4, DARK); c.ell(13, 11, 2, 2, RED)
def chassis(c, w, col, wheels=4, beams=2):
    sh(c, w); x0, x1 = 16-w, 16+w
    c.stroke([(x0, 14), (x1, 14)], 2, col); c.stroke([(x0, 20), (x1, 20)], 2, col)
    for i in range(beams+2): x = x0+(x1-x0)*i/(beams+1); c.stroke([(x, 14), (x, 20)], 1.6, dk(col, .1))
    xs = [x0+2.5, x1-2.5] if wheels == 4 else [x0+2.5, x1-6, x1-2.2]
    for x in xs: c.ell(x, 22.5, 2.8, 2.8, RUB); c.ell(x, 22.5, 1.1, 1.1, STEEL, owf=.5)
@k('item_chassis_small')
def _(c): chassis(c, 8, '#e2504a', beams=1)
@k('item_chassis_medium')
def _(c): chassis(c, 10, '#3f86d8', beams=2)
@k('item_chassis_large')
def _(c): chassis(c, 12, '#5aa04a', beams=3)
@k('item_chassis_heavy')
def _(c): chassis(c, 13, '#f2a922', wheels=6, beams=3)
@k('item_trailer_frame')
def _(c): sh(c, 12); c.poly([(4, 17), (24, 13), (28, 16), (8, 20)], 'none' if False else '#8d97a6', shade=.3); c.poly([(7, 17), (23, 14), (25, 15.6), (9, 18.8)], '#5c6270', ol=False); c.stroke([(4, 17.5), (1.8, 19.5)], 1.6, DARK); c.ell(17, 21, 2.8, 2.8, RUB)
@k('item_hitch_coupler')
def _(c): sh(c, 9); c.rect(5, 17, 20, 22, IRON, r=1); c.ell(23, 14.5, 4.2, 4.2, STEEL); c.rect(19, 16, 24, 22, DARK, r=1); c.stroke([(6, 22), (6, 26)], 1.4, DARK); c.shine(21.5, 12.5, .9)
@k('item_body_panel')
def _(c): sh(c, 11); c.poly([(5, 10), (24, 6), (27, 20), (8, 25)], '#e2504a', shade=.35); c.line([(8, 12), (24, 8.5)], .7, lt('#e2504a', .6), 220); c.rect(18, 15, 22, 16.6, '#3c3f49', r=.8, owf=.4)
@k('item_windshield')
def _(c): sh(c, 11); c.poly([(7, 9), (25, 9), (28, 23), (4, 23)], '#9fd8f0', shade=.25, olc='#3c3f49'); c.line([(9, 21), (14, 11)], 1, '#ffffff', 170); c.line([(13, 21), (16, 15)], .6, '#ffffff', 140)
@k('item_headlight')
def _(c): sh(c, 9); c.ell(16, 16, 9.5, 9.5, STEEL, shade=.4); c.ell(16, 16, 7, 7, '#fbf3c4', shade=.2); c.ell(16, 16, 3, 3, '#ffe066', ol=False); c.line([(11, 13), (14, 11)], 1, '#ffffff', 220)
@k('item_seat')
def _(c): sh(c, 9); c.poly([(9, 4), (19, 4), (20, 18), (10, 19)], '#3f86d8', shade=.35); c.poly([(8, 18), (24, 17), (26, 23), (9, 25)], '#2f6cb8', shade=.35); c.line([(14.5, 6), (15, 17)], .6, dk('#3f86d8', .3)); c.rect(11, 1.8, 17, 4.8, DARK, r=1)
@k('item_fuel_tank')
def _(c): sh(c, 11); c.rect(4, 11, 28, 25, '#d9534a', r=5); c.line([(6, 18), (26, 18)], .7, dk('#d9534a', .3)); c.rect(20, 7.5, 24, 11.5, DARK, r=1); c.shine(8, 14, 1.1)
@k('item_battery')
def _(c): sh(c, 10); c.rect(5, 10, 27, 26, '#40444f', r=2); c.rect(5, 10, 27, 14, '#f2c84b', r=1.5, owf=.7); c.rect(8, 6.5, 11.5, 10, RED, r=.7); c.rect(20.5, 6.5, 24, 10, DARK, r=.7); c.line([(13.5, 18), (16, 22), (15, 19.5), (18.5, 23.5)], .9, '#f2c84b')
@k('item_radiator')
def _(c):
    sh(c, 11); c.rect(5, 6, 27, 25, '#8d97a6', r=1.5)
    for i in range(9): x = 7.5+i*2.25; c.line([(x, 8), (x, 23)], .6, '#4a4f5c')
    c.rect(4, 4.5, 28, 7.5, STEEL, r=1); c.rect(4, 23.5, 28, 26.5, STEEL, r=1); c.ell(24, 4, 1.8, 1.4, DARK, owf=.5)
@k('item_gearbox')
def _(c): sh(c, 10); c.poly([(5, 12), (21, 10), (27, 14), (27, 23), (9, 26), (5, 21)], '#9aa3b0', shade=.35); c.ell(10, 14, 4.8, 4.8, '#d9903f'); c.ell(10, 14, 1.6, 1.6, DARK, owf=.5); c.stroke([(21, 10), (24, 3.5)], 1.4, DARK); c.ell(24, 3.5, 2, 2, '#2f2f38'); [c.dot(10+math.cos(a)*4.8, 14+math.sin(a)*4.8, .9, '#d9903f') for a in [i*math.pi/4 for i in range(8)]]
def engine(c, col, cyl, wide=1.0, diesel=False):
    sh(c, 12); w = 9*wide
    c.rect(16-w, 13, 16+w, 25, col, r=2); 
    for i in range(cyl):
        x = 16-w+2+i*(2*w-4)/max(1, cyl-1) if cyl > 1 else 16
        c.rect(x-1.6, 8.5, x+1.6, 13.5, dk(col, .15), r=.8, owf=.6)
    c.rect(16-w+1, 6.5, 16+w-1, 9.5, '#3c3f49' if not diesel else '#f2a922', r=1.2); c.ell(16-w-0.5, 20, 2.6, 2.6, DARK); c.ell(16-w-.5, 20, 1, 1, STEEL, owf=.4)
    c.line([(16-w+2, 17), (16+w-2, 17)], .6, lt(col, .5), 180); c.shine(16-w+2, 15, .9)
@k('item_engine_small')
def _(c): engine(c, '#8fb2c9', 2, .7)
@k('item_engine_medium')
def _(c): engine(c, '#5c8fe0', 3, .9)
@k('item_engine_large')
def _(c): engine(c, '#e2504a', 4, 1.15)
@k('item_engine_diesel')
def _(c): engine(c, '#4a4f5c', 4, 1.15, diesel=True)
@k('item_camper_interior')
def _(c): sh(c, 11); c.poly([(5, 13), (16, 9), (27, 13), (27, 25), (16, 28), (5, 25)], '#c8874a', shade=.3); c.poly([(5, 13), (16, 9), (27, 13), (16, 17)], '#e8b77a', owf=.6); c.line([(16, 17), (16, 27.5)], .7, dk('#c8874a', .4)); c.rect(8, 18, 13, 23, '#5ab3a0', r=1, owf=.5); c.rect(18.5, 18, 24, 21, '#f2c84b', r=1, owf=.5)
@k('item_tank_shell')
def _(c): sh(c, 12); c.rect(3, 9, 29, 23, '#dfe5ee', r=7); c.line([(10, 9.5), (10, 22.5)], .8, '#8d97a6'); c.line([(22, 9.5), (22, 22.5)], .8, '#8d97a6'); c.rect(14, 5.5, 18, 9.5, IRON, r=1); c.shine(7, 13, 1.2)
# repair
@k('item_patch_kit')
def _(c): sh(c, 10); c.rect(4, 11, 24, 25, '#f2c84b', r=2); c.rect(4, 11, 24, 15, '#e2504a', r=1.5, owf=.7); c.ell(17, 20, 3.4, 3.4, RUB, owf=.6); c.poly([(21, 22), (27, 15), (29, 17), (23, 24)], '#ececec', owf=.6); c.rect(25.5, 13, 29.5, 17.5, '#3f86d8', r=1, owf=.5)
@k('item_repair_kit')
def _(c):
    sh(c, 12); c.rect(3, 12, 29, 26, '#e2504a', r=2); c.rect(3, 12, 29, 16, dk('#e2504a', .15), r=1.5, owf=.7); c.stroke([(12, 12), (12, 8), (20, 8), (20, 12)], 1.6, DARK)
    c.rect(14, 18, 18, 21, '#f2c84b', r=.8, owf=.5); c.stroke([(7, 24), (11, 19)], 1.3, STEEL); c.ell(11.5, 18.5, 1.7, 1.7, STEEL, owf=.5)
# plain resource icons requested by Survival (9291c99)
@k('item_reeds')
def _(c):
    sh(c, 8)
    for x0, x1, col in ((11, 8, '#9cbf4e'), (14, 13, '#c9b265'), (17, 19, '#8fb446'), (19, 24, '#c9b265'), (15.5, 16, '#a9c95a')):
        c.stroke([(x0+2, 26), (x1, 6)], 1.4, col); c.ell(x1, 7.5, 1.3, 3.2, '#8a5a34', owf=.6)
    c.rect(11, 19, 21, 22, '#b5743d', r=1, owf=.7)
@k('item_flax')
def _(c):
    sh(c, 8)
    for x0, x1 in ((12, 8), (15, 14), (18, 20), (20, 25)):
        c.stroke([(x0+1, 27), (x1, 9)], 1.1, '#7bb24a')
        for dx, dy in ((-1.6, 0), (1.6, 0), (0, -1.6), (0, 1.6)): c.ell(x1+dx, 8+dy, 1.5, 1.5, '#6f9be8', owf=.5)
        c.dot(x1, 8, .8, '#f2e27a')
    c.stroke([(12, 20), (21, 20)], 1.6, '#e9dfc4')
