# Missing item icons (vehicle/food follow-up): rot, coin, fish, cooked_fish, wild_grain, bread, stew_bowl, egg.
# Same painter + conventions as icons.py (32px cells, 2px inset, soft drop shadow, bold darker outline).
import math
from draw import C, lt, dk
from icons import M, sh, bowl
def rot(c):
    sh(c, 11); col = '#7d8a3c'
    c.poly([(5, 24), (7, 18), (11, 15), (15, 12), (20, 13), (24, 17), (27, 22), (25, 26), (16, 27.5), (8, 27)], col, shade=.4)
    c.ell(12, 20, 3.4, 2.4, '#5f6b2c', owf=.5); c.ell(20, 19, 2.6, 2, '#9aa04a', owf=.5); c.ell(17, 24, 3, 1.8, '#6b5a34', owf=.5)
    c.dot(13, 19.2, .7, '#c9d27a', 200); c.dot(21, 18.4, .5, '#d9dd8a', 200)
    for x, ph in ((10, 0), (16, 1), (22, 0)):   # stink wiggles
        c.line([(x, 12 - ph), (x + 1.4, 9.5 - ph), (x - .4, 7 - ph), (x + .8, 5 - ph)], .8, '#9bbf5a', 190)
    for x, y in ((25.5, 9), (7, 9.5)):            # tiny flies
        c.dot(x, y, 1.0, '#33303a'); c.dot(x - .9, y - .9, .7, (240, 248, 255), 190); c.dot(x + .9, y - .9, .7, (240, 248, 255), 190)
def coin(c):
    sh(c, 9); g = '#f2c23a'
    c.ell(16, 18.5, 9.5, 9.5, dk(g, .25), shade=.3)              # rim/thickness
    c.ell(15.5, 17, 9.5, 9.5, g, shade=.35); c.ell(15.5, 17, 6.8, 6.8, lt(g, .12), ol=False, shade=.25)
    st = [(15.5 + math.cos(-math.pi / 2 + i * math.pi / 5) * (4 if i % 2 == 0 else 1.8), 17 + math.sin(-math.pi / 2 + i * math.pi / 5) * (4 if i % 2 == 0 else 1.8)) for i in range(10)]
    c.poly(st, '#e0a52a', owf=.5, shade=.2); c.shine(11.5, 12.5, 1.3, 230); c.shine(13.5, 11.3, .6, 200)
def _fish(c, col, belly, cooked=False):
    sh(c, 12)
    c.poly([(23, 16), (28.5, 10.5), (27.5, 16.5), (28.5, 22.5)], dk(col, .1) if not cooked else '#b8692e', shade=.3)  # tail
    c.poly([(12, 11.5), (15, 8.5), (19, 10.5)], dk(col, .15), owf=.7)                                                  # dorsal fin
    c.ell(14, 16.5, 10.5, 6, col, shade=.35); c.ell(14, 18.8, 8, 2.6, belly, ol=False, shade=.15)
    c.poly([(13, 19), (16, 23.5), (17.5, 19.5)], dk(col, .1), owf=.6)                                                   # pectoral
    c.line([(8.5, 12.5), (7.5, 16.5), (8.5, 20.5)], .6, dk(col, .35), 180)                                              # gill
    if cooked:
        for i in range(3): c.line([(11 + i * 4, 12), (9 + i * 4, 21)], 1.0, '#6b3a1e', 210)
        c.dot(5.6, 15.2, .9, '#3a2418'); c.shine(13, 12.5, .9, 170)
    else:
        c.dot(6.2, 15.2, 1.2, '#ffffff'); c.dot(6.0, 15.2, .7, '#2a2a33'); c.shine(12, 12.5, 1.1, 210)
        for x, y in ((14, 14.5), (17, 15.5), (20, 14.5), (16, 17.5)): c.ell(x, y, 1.1, .8, lt(col, .25), ol=False)
def fish(c): _fish(c, '#6fa8d8', '#e6f1f7')
def cooked_fish(c): _fish(c, '#d98a3c', '#f2c27b', cooked=True)
def wild_grain(c):
    sh(c, 10); col = '#d9b65a'; n = 7
    for i in range(n):
        x0 = 13 + i * 1.0; x1 = 6 + i * 3.3; y1 = 6 + abs(i - n / 2) * 1.1
        c.stroke([(x0, 28), (x0 + .2, 18), (x1, y1)], 1.0, '#a8b04a', owf=.6)
        for k in range(3): c.ell(x1 + (k - 1) * .3, y1 - 1.6 + k * 1.6, 1.0, 1.4, col, owf=.5)
        c.line([(x1, y1 - 3.2), (x1 - .4, y1 - 5.6)], .35, lt(col, .2), 200)
    c.rect(12, 19, 20.5, 22, M['green'], r=1)
def bread(c):
    sh(c, 12); col = '#d98f45'
    c.poly([(4, 22), (5, 16), (9, 11.5), (16, 10), (23, 11.5), (27, 16), (28, 22), (24, 25), (8, 25)], col, shade=.35)
    c.ell(16, 15, 10, 4.2, lt(col, .12), ol=False, shade=.25)
    for x in (10, 15, 20): c.line([(x, 17), (x + 3, 12.5)], 1.1, '#f7dfa6', 230); c.line([(x + .5, 17.4), (x + 3.5, 12.9)], .45, dk(col, .35), 150)
    c.shine(9, 14, 1.0, 200)
def stew_bowl(c): bowl(c, '#b8582e', [(11.5, 16, '#7a3a26'), (16, 15.4, '#f08a2c'), (20.5, 16.2, '#f2e2b4'), (14, 17.2, '#6fbf4e'), (18.5, 17.3, '#7a3a26')])
def egg(c):
    sh(c, 11)
    c.poly([(21.5 + 5 * math.sin(a), 18.5 - 6.5 * math.cos(a) * (1.08 if math.cos(a) > 0 else 1)) for a in [i * math.pi / 14 for i in range(28)]], '#f0d2a8', shade=.25)
    c.poly([(12 + 6 * math.sin(a), 16.5 - 7.6 * math.cos(a) * (1.1 if math.cos(a) > 0 else 1)) for a in [i * math.pi / 14 for i in range(28)]], '#fffaf0', shade=.2)
    c.shine(9.6, 12, 1.2, 230); c.dot(14.5, 19, .5, '#e6d8c4'); c.dot(23, 21, .45, '#c9a87e')
NEW8 = {'rot': rot, 'coin': coin, 'fish': fish, 'cooked_fish': cooked_fish, 'wild_grain': wild_grain, 'bread': bread, 'stew_bowl': stew_bowl, 'egg': egg}
def render(k): c = C(32, 8); NEW8[k](c); return c.out(64), c.out(32)
