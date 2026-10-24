# ADR-113 animal_feed icon (items_icons cell 200): burlap feed sack with spilled grain + a carrot top.
from icons import M, sh
from draw import lt, dk
def animal_feed(c):
    sh(c, 11)
    c.poly([(8, 27), (6.5, 16), (9, 9.5), (12, 7.5), (20, 7.5), (23, 9.5), (25.5, 16), (24, 27)], '#c9a46a', shade=.32)
    c.poly([(11, 8.5), (21, 8.5), (22.5, 5), (18.5, 6.5), (16, 4.5), (13.5, 6.5), (9.5, 5)], '#b28c52', owf=.8)
    c.stroke([(10.5, 9.6), (21.5, 9.6)], 1.3, '#7d4a2b', owf=.6)
    c.rect(11, 15, 21, 22, '#e9dfc4', r=1, owf=.6); c.ell(16, 18.5, 2.6, 2.1, '#e5c25a', owf=.5)
    for x, y in ((5, 27.5), (7.6, 28.6), (26, 28), (24, 29), (28, 27.2)): c.ell(x, y, 1.3, .9, '#e5c25a', owf=.4)
    c.poly([(23, 22), (29, 24), (24.5, 26)], '#f08a2c', owf=.6); c.stroke([(23.5, 22.5), (22, 19.5)], .9, '#6fbf4e', owf=.4)
