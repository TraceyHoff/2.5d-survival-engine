"""Icons (32x32 @1x), equipment silhouettes, building categories and cursors."""
from __future__ import annotations
import math
from .draw import hexc, lighten, darken, alpha, mix, rrect, blob, heart, drop, star, regular, jitter
from .icon import Ink
from .kit import sprite, P, INK, leaf

ICONS = []


def icon(name, w=32, h=32, tags=('icon',), hotspot=None):
    def deco(fn):
        def run(sc):
            c = Ink(w, h, sc)
            fn(c)
            return c.out()
        sprite(name, w, h, tags=list(tags), hotspot=hotspot)(run)
        ICONS.append(name)
        return fn
    return deco


def T(pts, dx=0, dy=0, s=1.0, cx=16, cy=16):
    return [(cx + (x - cx) * s + dx, cy + (y - cy) * s + dy) for x, y in pts]


# ------------------------------- vitals (expressive) -------------------------------
@icon('vital_health')
def _(c):
    c.part(heart(16, 17, 27, wob=0.5, seed=1), P['berry-500'])
    c.shine(10.5, 11, 2.6, 1.8, 210)
    c.face(16, 16.5, 1.0, 'happy')


@icon('vital_health_low')
def _(c):
    c.part(heart(16, 17, 27, wob=0.5, seed=1), P['berry-700'])
    # crack
    c.line([(16, 8.5), (14, 13), (17.5, 15.5), (15, 21)], INK, 1.3)
    c.face(16, 17.5, 1.0, 'worried', blush=False)


@icon('vital_hunger')
def _(c):
    # cute stomach: bean/kidney shape
    pts = []
    for i in range(64):
        t = i / 64 * 2 * math.pi
        r = 10.5 + 1.6 * math.cos(2 * t) - 2.2 * max(0, math.sin(t + 0.6)) ** 3
        pts.append((16 + r * math.cos(t) * 1.05, 17.5 + r * math.sin(t) * 0.86))
    pts = jitter(pts, 0.5, 4)
    c.line([(12, 4.5), (13.5, 9)], INK, 4.2); c.line([(12, 4.5), (13.5, 9)], P['rose-500'], 2.0)  # esophagus
    c.line([(25, 22), (27.5, 27)], INK, 4.2); c.line([(25, 22), (27.5, 27)], P['rose-500'], 2.0)
    c.part(pts, P['pumpkin-500'])
    c.shine(10.5, 12, 2.6, 1.6, 200)
    c.face(16, 16.5, 1.0, 'happy')


@icon('vital_hunger_low')
def _(c):
    pts = [(16 + 10 * math.cos(i / 64 * 6.283) * 1.05, 17.5 + 8.6 * math.sin(i / 64 * 6.283) * (0.75 + 0.1 * math.sin(i / 64 * 6.283 * 3))) for i in range(64)]
    c.part(jitter(pts, 0.8, 5), P['pumpkin-700'])
    c.face(16, 16, 1.0, 'o', blush=False)
    for x, y in ((25, 8), (28, 5)):
        c.line([(x - 1.2, y), (x + 1.2, y)], INK, 1.0)


@icon('vital_thirst')
def _(c):
    c.part(drop(16, 16, 27, wob=0.4, seed=2), P['sky-500'])
    c.shine(12, 14, 1.8, 3.0, 220)
    c.face(16, 20, 1.0, 'happy')


@icon('vital_thirst_low')
def _(c):
    c.part(drop(16, 18, 22, wob=0.6, seed=3), P['sky-700'])
    c.face(16, 21, 0.9, 'worried', blush=False)


@icon('vital_stamina')
def _(c):
    bolt = [(18.5, 2.5), (7, 18), (14.5, 18), (12, 29.5), (25, 12.5), (17.5, 12.5), (21, 2.5)]
    c.part(jitter(bolt, 0.3, 6), P['sun-500'])
    c.shine(16.5, 7.5, 1.4, 2.2, 220)
    c.face(16.6, 16.5, 0.72, 'happy', eye_gap=2.6)


@icon('vital_stamina_low')
def _(c):
    bolt = [(18.5, 4.5), (8, 18), (14.5, 18), (12.5, 28.5), (24, 13.5), (17.5, 13.5), (21, 4.5)]
    c.part(bolt, P['sun-700'])
    c.face(16.6, 17, 0.72, 'sleepy', blush=False, eye_gap=2.6)


@icon('vital_temp')
def _(c):
    c.part(rrect(12, 2.5, 20, 22, 4, wob=0.3, seed=7), P['parchment-50'])
    c.part(blob(16, 23.5, 6.6, 6.6, wob=0.3, seed=8), P['berry-500'])
    c.paint(c.poly_mask(rrect(14.6, 9, 17.4, 21, 1.4)), P['berry-500'])
    for y in (6, 9, 12, 15):
        c.line([(18.2, y), (19.6, y)], INK, 0.8)
    c.face(16, 23, 0.7, 'happy', eye_gap=2.4)


@icon('vital_cold')
def _(c):
    for a in range(0, 180, 60):
        r = math.radians(a)
        p1 = (16 + 12 * math.cos(r), 16 + 12 * math.sin(r)); p2 = (16 - 12 * math.cos(r), 16 - 12 * math.sin(r))
        c.line([p1, p2], INK, 4.6)
    for a in range(0, 360, 60):
        r = math.radians(a)
        for d in (7.5,):
            bx, by = 16 + d * math.cos(r), 16 + d * math.sin(r)
            for s in (-1, 1):
                rr = r + s * 0.8
                c.line([(bx, by), (bx + 3.6 * math.cos(rr), by + 3.6 * math.sin(rr))], INK, 3.6)
    for a in range(0, 180, 60):
        r = math.radians(a)
        c.line([(16 + 12 * math.cos(r), 16 + 12 * math.sin(r)), (16 - 12 * math.cos(r), 16 - 12 * math.sin(r))], P['sky-300'], 2.2)
    for a in range(0, 360, 60):
        r = math.radians(a)
        bx, by = 16 + 7.5 * math.cos(r), 16 + 7.5 * math.sin(r)
        for s in (-1, 1):
            rr = r + s * 0.8
            c.line([(bx, by), (bx + 3.6 * math.cos(rr), by + 3.6 * math.sin(rr))], P['sky-300'], 1.6)
    c.part(blob(16, 16, 5.6, 5.6), P['sky-300'], ow=1.3)
    c.face(16, 15.5, 0.62, 'worried', blush=False, eye_gap=2.2)


@icon('vital_hot')
def _(c):
    rays = star(16, 16, 14.5, 9.5, 10, wob=0.4, seed=9)
    c.part(rays, P['pumpkin-500'], shade=False)
    c.part(blob(16, 16, 8.8, 8.8, wob=0.3, seed=10), P['sun-500'])
    c.face(16, 15.6, 0.85, 'happy')
    c.line([(25, 4), (25, 7)], alpha(P['sky-500'], 255), 1.5)


@icon('vital_xp')
def _(c):
    c.part(star(16, 17, 14, 6.8, 5, wob=0.4, seed=11), P['plum-500'])
    c.shine(12.5, 11.5, 1.6, 1.4, 200)
    c.face(16, 17, 0.85, 'happy', eye_gap=2.8)


# ------------------------------- status effects -------------------------------
def cloud(c, cx, cy, s, col):
    pts = []
    for i in range(72):
        t = i / 72 * 2 * math.pi
        r = 1 + 0.18 * abs(math.sin(t * 2.5))
        pts.append((cx + math.cos(t) * 10 * s * r, cy + math.sin(t) * 5.8 * s * r))
    c.part(jitter(pts, 0.4, 3), col)


@icon('st_wet')
def _(c):
    cloud(c, 16, 11, 1.1, P['slate-300'])
    c.face(16, 10.5, 0.7, 'sad', blush=False, eye_gap=2.4)
    for x, y in ((9, 23), (16, 26), (23, 23)):
        c.part(drop(x, y, 8), P['sky-500'], ow=1.2)


@icon('st_cold')
def _(c):
    c.part(blob(16, 17, 10.5, 10.5, wob=0.6, seed=21), P['sky-300'])
    c.part(rrect(5, 4, 27, 11, 3.5, wob=0.4, seed=22), P['berry-500'])  # beanie
    c.part(blob(16, 4, 3, 3), P['parchment-50'], ow=1.2)
    c.face(16, 18, 0.9, 'worried')
    c.line([(9, 25), (11, 24), (13, 25.4)], INK, 0.8)


@icon('st_hot')
def _(c):
    c.part(blob(16, 17, 11, 10.5, wob=0.5, seed=23), P['pumpkin-300'])
    c.face(16, 17, 0.9, 'o')
    c.part(drop(26.5, 9, 9), P['sky-300'], ow=1.2)


@icon('st_well_fed')
def _(c):
    c.part(rrect(15, 15, 22, 27, 3, wob=0.3, seed=24), P['parchment-50'])  # bone
    c.part(blob(15.5, 26.5, 2.6, 2.6), P['parchment-50'], ow=1.2); c.part(blob(21.5, 26.5, 2.6, 2.6), P['parchment-50'], ow=1.2)
    c.part(blob(14, 12, 9.5, 8.6, wob=0.6, seed=25, rot=-0.5), P['pumpkin-700'])  # meat
    c.shine(10.5, 9.5, 2.6, 1.6, 170)
    c.part(star(26, 6, 4.4, 1.6, 4, rot=0), P['sun-300'], ow=1.0, shade=False)


@icon('st_bleeding')
def _(c):
    c.part(drop(13, 15, 20, wob=0.4, seed=26), P['berry-500'])
    c.part(drop(23, 22, 11, wob=0.3, seed=27), P['berry-700'], ow=1.3)
    c.shine(10, 14, 1.4, 2.4, 200)


@icon('st_infected')
def _(c):
    c.part(blob(16, 16.5, 11.5, 11, wob=0.9, seed=28), P['moss-500'])
    c.line([(9, 9), (12.5, 11)], INK, 1.0)
    c.ellipse((10, 13, 14.5, 17.5), P['parchment-50']); c.ellipse((11.6, 14.6, 13.4, 16.4), INK)
    c.ellipse((18.5, 14, 21.5, 17), INK)
    c.line([(11, 22), (13, 21), (15, 22.4), (17, 21), (19, 22.4), (21, 21)], INK, 1.0)
    c.part(blob(24.5, 8, 2.5, 2.5), P['moss-300'], ow=1.0)


@icon('st_sheltered')
def _(c):
    c.part(rrect(7, 14, 25, 28, 2, wob=0.3, seed=29), P['parchment-100'])
    c.part([(3.5, 15.5), (16, 4), (28.5, 15.5)], P['berry-500'])
    c.part(rrect(13.5, 19, 18.5, 28, 1.5), P['wood-500'], ow=1.2)
    c.part(rrect(20, 17, 23.4, 20.4, 0.6), P['sun-300'], ow=1.0, shade=False)


@icon('st_exhausted')
def _(c):
    c.part(blob(14, 18, 10.5, 10, wob=0.5, seed=30), P['parchment-200'])
    c.face(14, 18.5, 0.9, 'sleepy')
    for x, y, s in ((22, 10, 1.0), (26.5, 5.5, 0.7)):
        z = [(x - 2.5 * s, y - 2.5 * s), (x + 2.5 * s, y - 2.5 * s), (x - 2.5 * s, y + 2.5 * s), (x + 2.5 * s, y + 2.5 * s)]
        c.line(z, INK, 2.8 * s); c.line(z, P['sky-300'], 1.2 * s)


@icon('st_warm')
def _(c):
    c.part(jitter([(16, 2.5), (24, 13), (25, 21), (20.5, 28), (11.5, 28), (7, 21), (8.5, 13.5), (12, 17), (12.5, 9)], 0.4, 31), P['pumpkin-500'])
    c.part([(16, 13), (20.5, 20), (19, 26), (13, 26), (11.5, 21)], P['sun-500'], ow=1.2)
    c.face(16, 22, 0.6, 'happy', blush=False, eye_gap=2.0)


@icon('st_starving')
def _(c):
    c.part(rrect(4, 15, 28, 18, 1.5), P['wood-400'])
    pts = [(4.5, 17), (27.5, 17), (24, 26), (8, 26)]
    c.part(pts, P['wood-500'])
    c.line([(9, 20.5), (23, 20.5)], alpha(P['wood-900'], 140), 0.8)
    c.face(16, 9, 0.8, 'sad', blush=False)


@icon('st_poisoned')
def _(c):
    c.part(rrect(11, 3, 21, 9, 2), P['wood-500'])
    c.part(blob(16, 19, 10, 10, wob=0.4, seed=32), P['plum-500'])
    c.part(rrect(12.5, 8, 19.5, 12, 1.5), P['plum-500'], ow=1.4)
    c.face(16, 19.5, 0.8, 'dead', blush=False)


# ------------------------------- ui glyphs -------------------------------
@icon('ic_gear')
def _(c):
    c.part(star(16, 16, 13.5, 10.5, 8, rot=0, wob=0.2, seed=40), P['slate-300'])
    c.part(blob(16, 16, 4.4, 4.4), P['wood-700'], ow=1.4)


@icon('ic_map')
def _(c):
    pts = [(4, 7), (11, 4.5), (21, 7.5), (28, 5), (28, 25), (21, 27.5), (11, 24.5), (4, 27)]
    c.part(jitter(pts, 0.3, 41), P['parchment-100'])
    c.paint(c.poly_mask([(11, 4.5), (21, 7.5), (21, 27.5), (11, 24.5)]), alpha(P['parchment-300'], 255))
    c.line([(11, 5), (11, 24.5)], alpha(INK, 160), 0.8); c.line([(21, 7.5), (21, 27)], alpha(INK, 160), 0.8)
    c.line([(7, 20), (12, 16), (17, 19), (22, 13)], P['berry-500'], 1.2)
    c.line([(22, 10), (25, 13)], P['berry-700'], 1.4); c.line([(25, 10), (22, 13)], P['berry-700'], 1.4)


@icon('ic_chat')
def _(c):
    c.part(rrect(3, 4, 29, 22, 8, wob=0.5, seed=42) , P['parchment-50'])
    c.part([(8, 20), (14, 20), (7, 28)], P['parchment-50'], ow=1.4)
    c.paint(c.poly_mask([(8.5, 19), (13.5, 19), (8, 25)]), P['parchment-50'])
    for x in (10, 16, 22):
        c.ellipse((x - 1.6, 11.4, x + 1.6, 14.6), INK)


@icon('ic_players')
def _(c):
    c.part(blob(21, 11, 5, 5), P['sky-300']); c.part(rrect(14, 17, 28, 28, 6), P['sky-500'])
    c.part(blob(11, 12, 5.5, 5.5), P['pumpkin-300']); c.part(rrect(3.5, 18.5, 18.5, 29, 6.5), P['leaf-500'])
    c.face(11, 12, 0.55, 'happy', blush=False, eye_gap=2)


@icon('ic_bag')
def _(c):
    c.part(rrect(10, 3, 22, 12, 4.5, wob=0.2), P['wood-700'])
    c.paint(c.poly_mask(rrect(13, 6, 19, 12, 2)), (0, 0, 0, 0))
    c.part(rrect(5, 9, 27, 29, 7, wob=0.5, seed=43), P['wood-400'])
    c.part(rrect(9, 17, 23, 26, 3, wob=0.3, seed=44), P['wood-500'], ow=1.3)
    c.part(rrect(14, 15, 18, 20, 1.2), P['sun-500'], ow=1.1, shade=False)


@icon('ic_hammer')
def _(c):
    c.line([(9, 27), (19, 13)], INK, 5.4); c.line([(9, 27), (19, 13)], P['wood-400'], 3.0)
    head = T([(10, 6), (24, 6), (27, 10), (24, 14), (10, 14)], 0, 0)
    import math as _m
    a = -0.62
    head = [(16 + (x - 17) * _m.cos(a) - (y - 10) * _m.sin(a) + 3, 10 + (x - 17) * _m.sin(a) + (y - 10) * _m.cos(a) - 1) for x, y in head]
    c.part(head, P['slate-300'])


@icon('ic_craft')
def _(c):
    # crossed hammer + saw-ish wrench on a little anvil
    c.part([(5, 17), (27, 17), (24, 21), (20, 21), (21, 26), (11, 26), (12, 21), (8, 21)], P['slate-500'])
    c.part(rrect(8, 26, 24, 29.5, 1.5), P['slate-700'], ow=1.3)
    c.line([(9, 4), (21, 15)], INK, 4.8); c.line([(9, 4), (21, 15)], P['wood-400'], 2.6)
    c.part(rrect(17, 3, 27, 9, 2, wob=0.2), P['pumpkin-500'], ow=1.4)
    c.part(star(8, 12, 3.4, 1.2, 4, rot=0), P['sun-300'], ow=1.0, shade=False)


@icon('ic_rotate')
def _(c):
    c.arc((5, 5, 27, 27), 200, 470, INK, 6.2)
    c.arc((5, 5, 27, 27), 200, 470, P['sky-500'], 3.2)
    c.part([(4, 7), (12.5, 9), (5.5, 16)], P['sky-500'], ow=1.4)


@icon('ic_skull')
def _(c):
    c.part(blob(16, 13.5, 11, 10, wob=0.5, seed=45), P['parchment-50'])
    c.part(rrect(10, 19, 22, 27.5, 3.5), P['parchment-50'], ow=1.5)
    c.paint(c.poly_mask(blob(16, 13.5, 10.8, 9.8)), P['parchment-50'])
    c.ellipse((8.5, 11, 14.5, 17.5), INK); c.ellipse((17.5, 11, 23.5, 17.5), INK)
    c.ellipse((10, 12.4, 11.8, 14.2), (255, 255, 255, 230))
    c.poly([(16, 17.5), (14.5, 20.5), (17.5, 20.5)], INK)
    for x in (13, 16, 19):
        c.line([(x, 23.5), (x, 27)], INK, 0.9)


@icon('ic_sun')
def _(c):
    c.part(star(16, 16, 14.5, 10, 12, wob=0.3, seed=46), P['sun-300'], shade=False)
    c.part(blob(16, 16, 8.6, 8.6, wob=0.3, seed=47), P['sun-500'])
    c.face(16, 15.6, 0.8, 'happy')


@icon('ic_moon')
def _(c):
    m = c.poly_mask(blob(15, 16, 12, 12, wob=0.3, seed=48))
    cut = c.poly_mask(blob(21, 11, 10, 10))
    from PIL import ImageChops
    c.part(ImageChops.subtract(m, cut), P['sun-300'])
    c.face(11, 18, 0.65, 'sleepy', blush=True, eye_gap=2.2)
    c.part(star(25, 22, 3.4, 1.3, 4, rot=0), P['parchment-50'], ow=1.0, shade=False)


@icon('ic_clock')
def _(c):
    c.part(blob(16, 16, 12.5, 12.5, wob=0.3, seed=49), P['parchment-50'])
    c.line([(16, 16), (16, 8.5)], INK, 1.8); c.line([(16, 16), (21, 18.5)], INK, 1.8)
    for a in range(0, 360, 90):
        r = math.radians(a)
        c.ellipse((16 + 9.5 * math.cos(r) - .9, 16 + 9.5 * math.sin(r) - .9, 16 + 9.5 * math.cos(r) + .9, 16 + 9.5 * math.sin(r) + .9), INK)


@icon('ic_day')
def _(c):
    c.part(rrect(3, 7, 29, 28, 4, wob=0.4, seed=50), P['parchment-50'])
    c.part(rrect(3, 7, 29, 13, 3), P['berry-500'], ow=1.4)
    c.line([(10, 4), (10, 10)], INK, 2.4); c.line([(22, 4), (22, 10)], INK, 2.4)


@icon('ic_lock')
def _(c):
    c.arc((9, 3.5, 23, 19), 180, 360, INK, 5.2); c.arc((9, 3.5, 23, 19), 180, 360, P['slate-300'], 2.6)
    c.part(rrect(6, 13, 26, 29, 4, wob=0.3, seed=51), P['sun-500'])
    c.ellipse((14, 17.5, 18, 21.5), INK); c.poly([(15, 20), (17, 20), (17.6, 25), (14.4, 25)], INK)


@icon('ic_check')
def _(c):
    pts = [(5.5, 16), (13, 24), (27, 7)]
    c.line(pts, INK, 8.0); c.line(pts, P['leaf-500'], 4.4)
    c.line([(6.8, 15.6), (12.5, 21.4)], alpha(P['leaf-300'], 220), 1.4)


@icon('ic_cross')
def _(c):
    for a, b in (((7, 7), (25, 25)), ((25, 7), (7, 25))):
        c.line([a, b], INK, 8.0)
    for a, b in (((7, 7), (25, 25)), ((25, 7), (7, 25))):
        c.line([a, b], P['berry-500'], 4.4)


@icon('ic_plus')
def _(c):
    for a, b in (((16, 5), (16, 27)), ((5, 16), (27, 16))):
        c.line([a, b], INK, 8.0)
    for a, b in (((16, 5), (16, 27)), ((5, 16), (27, 16))):
        c.line([a, b], P['leaf-500'], 4.4)


@icon('ic_minus')
def _(c):
    c.line([(5, 16), (27, 16)], INK, 8.0); c.line([(5, 16), (27, 16)], P['berry-500'], 4.4)


@icon('ic_arrow_left')
def _(c):
    c.part(jitter([(4, 16), (16, 5), (16, 11), (27, 11), (27, 21), (16, 21), (16, 27)], 0.3, 52), P['parchment-50'])


@icon('ic_arrow_right')
def _(c):
    c.part(jitter([(28, 16), (16, 5), (16, 11), (5, 11), (5, 21), (16, 21), (16, 27)], 0.3, 53), P['parchment-50'])


@icon('ic_info')
def _(c):
    c.part(blob(16, 16, 12, 12, wob=.3, seed=54), P['parchment-50'])
    c.ellipse((14.2, 7.2, 17.8, 10.8), INK)
    c.line([(16, 14), (16, 23)], INK, 3.4)


@icon('ic_warn')
def _(c):
    c.part(jitter([(16, 3), (29, 27), (3, 27)], 0.3, 55), P['sun-500'])
    c.line([(16, 11), (16, 19)], INK, 3.2); c.ellipse((14.3, 21.5, 17.7, 24.9), INK)


def mouse(c, left):
    c.part(rrect(8, 3, 24, 29, 8, wob=0.3, seed=56), P['parchment-50'])
    side = [(8.5, 4), (16, 4), (16, 14), (8.5, 14)] if left else [(16, 4), (23.5, 4), (23.5, 14), (16, 14)]
    from PIL import ImageChops
    m = ImageChops.multiply(c.poly_mask(rrect(8, 3, 24, 29, 8)), c.poly_mask(side))
    c.paint(m, P['sun-500'])
    c.line([(16, 3.5), (16, 14)], INK, 1.2); c.line([(8.5, 14), (23.5, 14)], INK, 1.2)


@icon('ic_mouse_left')
def _(c):
    mouse(c, True)


@icon('ic_mouse_right')
def _(c):
    mouse(c, False)


@icon('ic_trash')
def _(c):
    c.part(rrect(7, 9, 25, 29, 3, wob=.3, seed=57), P['slate-300'])
    c.part(rrect(4.5, 6, 27.5, 10, 1.6), P['slate-500'], ow=1.4)
    c.part(rrect(12.5, 3, 19.5, 6.5, 1.4), P['slate-500'], ow=1.2)
    for x in (12, 16, 20):
        c.line([(x, 13), (x, 25)], alpha(INK, 170), 1.0)


@icon('ic_star')
def _(c):
    c.part(star(16, 16.5, 13.5, 6.2, 5, wob=.3, seed=58), P['sun-500'])
    c.shine(12.5, 11.5, 1.6, 1.3, 210)


@icon('ic_weight')
def _(c):
    c.arc((11, 3, 21, 13), 180, 360, INK, 4); c.arc((11, 3, 21, 13), 180, 360, P['slate-500'], 2)
    c.part(jitter([(9, 9), (23, 9), (28, 28), (4, 28)], 0.3, 59), P['slate-500'])
    c.line([(12, 21), (12, 15), (14.5, 18), (17, 15), (17, 21)], P['parchment-50'], 1.4)


@icon('ic_signal')
def _(c):
    for i, h in enumerate((6, 11, 16, 21)):
        x = 4.5 + i * 6.4
        c.part(rrect(x, 27 - h, x + 4.4, 27, 1.4), P['leaf-500'] if i < 3 else P['slate-300'], ow=1.4)


@icon('ic_crown')
def _(c):
    c.part(jitter([(4, 24), (4, 9), (10, 15), (16, 6), (22, 15), (28, 9), (28, 24)], .3, 60), P['sun-500'])
    for x, col in ((10, P['berry-500']), (16, P['sky-500']), (22, P['leaf-500'])):
        c.part(blob(x, 19.5, 1.9, 1.9), col, ow=1.0, shade=False)


@icon('ic_pin')
def _(c):
    c.part(drop(16, 16, 26) and [(x, 32 - y) for x, y in drop(16, 16, 26, wob=0.3, seed=61)], P['berry-500'])
    c.part(blob(16, 11.5, 4, 4), P['parchment-50'], ow=1.2, shade=False)


@icon('ic_home')
def _(c):
    c.part(rrect(7, 14, 25, 28, 1.5, wob=.3, seed=62), P['wood-400'])
    c.part([(3, 16), (16, 4), (29, 16)], P['leaf-700'])
    c.part(rrect(13.5, 19, 18.5, 28, 1.6), P['wood-700'], ow=1.2)


@icon('ic_zombie')
def _(c):
    c.part(blob(16, 17, 12, 11.5, wob=1.0, seed=63), P['moss-500'])
    c.paint(c.poly_mask([(6, 9), (9, 4), (12, 8), (15, 3), (18, 8), (22, 4), (26, 10), (16, 9)]), P['moss-700'])
    c.ellipse((8.5, 12.5, 14, 18), P['parchment-50']); c.ellipse((10.5, 14.5, 12.5, 16.5), INK)
    c.ellipse((18, 13.5, 22.5, 17.5), INK)
    c.poly([(10.5, 22), (22, 21), (20, 25), (13, 25.2)], P['moss-700'])
    c.poly([(14, 21.6), (16, 21.5), (15, 24)], P['parchment-50'])
    c.line([(23, 7), (23.5, 10)], alpha(P['berry-700'], 255), 1.0)


@icon('ic_campfire')
def _(c):
    c.line([(5, 26), (27, 21)], INK, 6); c.line([(5, 21), (27, 26)], INK, 6)
    c.line([(5, 26), (27, 21)], P['wood-500'], 3.4); c.line([(5, 21), (27, 26)], P['wood-400'], 3.4)
    c.part(jitter([(16, 3), (23, 12), (23, 18), (19, 22), (13, 22), (9, 18), (9.5, 12), (12.5, 14), (13, 8)], .4, 64), P['pumpkin-500'])
    c.part([(16, 11), (19.5, 16), (18.5, 20.5), (13.5, 20.5), (12.5, 16)], P['sun-500'], ow=1.1)


@icon('ic_workbench')
def _(c):
    c.part(rrect(3, 11, 29, 17, 2, wob=.3, seed=65), P['wood-400'])
    c.part(rrect(5, 17, 9, 29, 1.2), P['wood-600'], ow=1.4); c.part(rrect(23, 17, 27, 29, 1.2), P['wood-600'], ow=1.4)
    c.part(rrect(16, 5, 24, 11, 1.5), P['slate-300'], ow=1.4)
    c.line([(7, 6), (13, 10)], INK, 3); c.line([(7, 6), (13, 10)], P['wood-700'], 1.4)


@icon('ic_book')
def _(c):
    c.part(rrect(5, 4, 27, 28, 3, wob=.3, seed=66), P['leaf-700'])
    c.part(rrect(8, 6.5, 25, 25.5, 2), P['parchment-100'], ow=1.3)
    c.paint(c.poly_mask(rrect(5, 4, 11, 28, 2.5)), P['leaf-700'])
    c.part(leaf_poly(17, 15), P['leaf-500'], ow=1.1)


def leaf_poly(cx, cy):
    return [(cx + 6 * math.cos(t), cy + 3.4 * math.sin(t) * math.sin(t / 2) * 2) for t in [i / 30 * 2 * math.pi for i in range(30)]]


@icon('ic_person')
def _(c):
    c.part(rrect(7, 17, 25, 29, 7, wob=.3, seed=67), P['leaf-500'])
    c.part(blob(16, 11, 7, 7, wob=.3, seed=68), P['pumpkin-300'])
    c.paint(c.poly_mask([(9, 9), (12, 4), (20, 4), (23, 9), (16, 7)]), P['wood-700'])
    c.face(16, 11.5, 0.6, 'happy', eye_gap=2.2)


@icon('ic_door')
def _(c):
    c.part(rrect(7, 3, 25, 29, 7, wob=.3, seed=69), P['wood-500'])
    c.ellipse((19.5, 15.5, 22.5, 18.5), P['sun-500'])


# ------------------------------- equipment silhouettes -------------------------------
SIL = alpha(P['parchment-500'], 150)


def sil(name):
    def deco(fn):
        def run(sc):
            c = Ink(32, 32, sc, ink=alpha(P['parchment-500'], 0), ow=0)
            fn(c)
            return c.out()
        sprite(name, 32, 32, tags=['equip'])(run)
        ICONS.append(name)
        return fn
    return deco


@sil('eq_head')
def _(c):
    c.part(rrect(8, 6, 24, 20, 8), SIL, outline=False, shade=False, grad=False)
    c.part(rrect(3, 18, 29, 23, 2.5), SIL, outline=False, shade=False, grad=False)


@sil('eq_chest')
def _(c):
    c.poly([(9, 4), (13, 4), (16, 7), (19, 4), (23, 4), (29, 10), (25, 15), (23, 13), (23, 28), (9, 28), (9, 13), (7, 15), (3, 10)], SIL)


@sil('eq_legs')
def _(c):
    c.poly([(8, 4), (24, 4), (26, 28), (19, 28), (16, 12), (13, 28), (6, 28)], SIL)


@sil('eq_feet')
def _(c):
    c.poly([(5, 6), (12, 6), (12, 18), (19, 21), (19, 27), (5, 27)], SIL)
    c.poly([(16, 4), (22, 4), (22, 15), (29, 18), (29, 24), (22, 24), (21, 20), (16, 19)], alpha(P['parchment-500'], 110))


@sil('eq_hands')
def _(c):
    c.part(rrect(8, 11, 24, 28, 6), SIL, outline=False, shade=False, grad=False)
    for x in (8.5, 13, 17.5):
        c.part(rrect(x, 4, x + 4.2, 15, 2.1), SIL, outline=False, shade=False, grad=False)
    c.part(rrect(21, 12, 28, 17, 2.4), SIL, outline=False, shade=False, grad=False)


@sil('eq_back')
def _(c):
    c.part(rrect(6, 7, 26, 29, 7), SIL, outline=False, shade=False, grad=False)
    c.arc((11, 2, 21, 12), 180, 360, SIL, 2.6)


@sil('eq_mainhand')
def _(c):
    c.line([(7, 27), (25, 7)], SIL, 4)
    c.poly([(18, 4), (28, 4), (28, 13), (22, 10)], SIL)


@sil('eq_offhand')
def _(c):
    c.poly([(6, 5), (16, 3), (26, 5), (25, 18), (16, 29), (7, 18)], SIL)


@sil('eq_trinket')
def _(c):
    c.arc((7, 9, 25, 27), 0, 360, SIL, 3.4)
    c.poly([(12, 9), (16, 3), (20, 9), (16, 12)], SIL)


# ------------------------------- build categories -------------------------------
@icon('bc_walls')
def _(c):
    for y, xs in ((5, (3, 15.5)), (13, (3, 9, 22)), (21, (3, 15.5))):
        for i, x in enumerate(xs):
            w = 12 if len(xs) == 2 else (6 if i == 0 else 12.5)
            if len(xs) == 3 and i == 2:
                w = 7
            c.part(rrect(x, y, min(29, x + w), y + 7, 1.6, wob=.25, seed=int(x * y)), P['wood-400'], ow=1.3)


@icon('bc_floors')
def _(c):
    c.part([(16, 5), (29, 12), (16, 19), (3, 12)], P['wood-300'])
    c.paint(c.poly_mask([(3, 12), (16, 19), (16, 25), (3, 18)]), P['wood-600'])
    c.paint(c.poly_mask([(29, 12), (16, 19), (16, 25), (29, 18)]), P['wood-500'])
    c.line([(3, 12), (3, 18), (16, 25), (29, 18), (29, 12)], INK, 1.5)
    c.line([(16, 19), (16, 25)], INK, 1.2)
    for k in (0.33, 0.66):
        c.line([(3 + 13 * k, 12 - 7 * k), (16 + 13 * k, 19 - 7 * k)], alpha(P['wood-700'], 180), 0.8)


@icon('bc_doors')
def _(c):
    c.part(rrect(5, 3, 27, 29, 3, wob=.3, seed=70), P['wood-700'])
    c.part(rrect(8.5, 6, 23.5, 29, 6), P['wood-400'], ow=1.3)
    c.ellipse((18.6, 16, 21.4, 18.8), P['sun-500'])


@icon('bc_roofs')
def _(c):
    c.part([(2, 22), (16, 6), (30, 22)], P['berry-500'])
    for k in (0.4, 0.7):
        c.line([(2 + 14 * (1 - k), 22 - 16 * (1 - k) * 1), (30 - 14 * (1 - k), 22 - 16 * (1 - k))], alpha(P['berry-700'], 200), 0.9)
    c.part(rrect(7, 22, 25, 28, 1), P['wood-400'], ow=1.3)


@icon('bc_stations')
def _(c):
    SPRITES_icon_campfire(c)


def SPRITES_icon_campfire(c):
    c.line([(5, 26), (27, 21)], INK, 6); c.line([(5, 21), (27, 26)], INK, 6)
    c.line([(5, 26), (27, 21)], P['wood-500'], 3.4); c.line([(5, 21), (27, 26)], P['wood-400'], 3.4)
    c.part(jitter([(16, 3), (23, 12), (23, 18), (19, 22), (13, 22), (9, 18), (9.5, 12), (12.5, 14), (13, 8)], .4, 64), P['pumpkin-500'])
    c.part([(16, 11), (19.5, 16), (18.5, 20.5), (13.5, 20.5), (12.5, 16)], P['sun-500'], ow=1.1)


@icon('bc_storage')
def _(c):
    c.part(rrect(4, 12, 28, 28, 2.5, wob=.3, seed=71), P['wood-400'])
    c.part(rrect(4, 6, 28, 14, 4, wob=.3, seed=72), P['wood-500'])
    c.part(rrect(14, 11, 18, 17, 1.2), P['sun-500'], ow=1.2)
    for x in (8, 24):
        c.line([(x, 7), (x, 27)], alpha(P['wood-900'], 200), 1.2)


@icon('bc_defense')
def _(c):
    for i, x in enumerate((7, 16, 25)):
        c.part([(x - 4, 28), (x, 3 + (i % 2) * 4), (x + 4, 28)], P['wood-300'], ow=1.4)
    c.part(rrect(2, 18, 30, 23, 1.5), P['wood-600'], ow=1.3)


@icon('bc_decor')
def _(c):
    c.part([(9, 18), (23, 18), (21, 29), (11, 29)], P['pumpkin-700'])
    c.line([(16, 18), (16, 10)], INK, 2.6); c.line([(16, 18), (16, 10)], P['leaf-700'], 1.2)
    for a in range(0, 360, 72):
        r = math.radians(a)
        c.part(blob(16 + 4 * math.cos(r), 8 + 4 * math.sin(r), 3, 3), P['rose-500'], ow=1.1, shade=False)
    c.part(blob(16, 8, 2.4, 2.4), P['sun-500'], ow=1.0, shade=False)
    leaf(c, 16, 15, 3.4, -30)


@icon('bc_farming')
def _(c):
    c.part(rrect(3, 20, 29, 28, 3, wob=.3, seed=73), P['wood-600'])
    for x in (9, 16, 23):
        c.line([(x, 21), (x, 13)], INK, 2.4); c.line([(x, 21), (x, 13)], P['leaf-700'], 1.0)
        leaf(c, x, 14, 3.2, -45); leaf(c, x, 15, 3.0, 225, P['leaf-300'])


# ------------------------------- cursors -------------------------------
def cursor(name, hotspot):
    def deco(fn):
        def run(sc):
            c = Ink(32, 32, sc, ow=1.8)
            fn(c)
            return c.out()
        sprite(name, 32, 32, tags=['cursor'], hotspot=hotspot, pivot=(hotspot[0] / 32, hotspot[1] / 32))(run)
        ICONS.append(name)
        return fn
    return deco


@cursor('cursor_default', (3, 2))
def _(c):
    pts = [(3.5, 2.5), (3.5, 24), (9, 19), (13, 28), (17, 26.2), (13.2, 17.6), (20.5, 17)]
    c.paint(c.dilate(c.poly_mask([(x + 1.2, y + 1.6) for x, y in pts]), 1.8), alpha(P['choc-800'], 90))
    c.part(pts, P['parchment-50'])
    c.line([(5.5, 6), (5.5, 18)], alpha(P['sun-300'], 220), 1.0)


@cursor('cursor_pointer', (10, 2))
def _(c):
    col = P['parchment-50']
    c.paint(c.dilate(c.poly_mask(rrect(6, 14, 26, 30, 6)), 1.8), INK)
    c.part(rrect(7.5, 2, 12.5, 18, 2.5, wob=.2), col)
    for i, x in enumerate((12.5, 17, 21.5)):
        c.part(rrect(x, 11 + i * 0.5, x + 4.6, 20, 2.3), col, ow=1.4)
    c.part(rrect(6, 15, 26, 30, 6, wob=.3, seed=80), col)
    c.part(rrect(2.5, 15, 8.5, 22, 3), col, ow=1.4)
    c.paint(c.poly_mask(rrect(7.4, 16, 25, 22, 3)), col)
    c.line([(8.6, 14.2), (8.6, 17)], alpha(INK, 0), 1)


@cursor('cursor_grab', (16, 14))
def _(c):
    col = P['parchment-50']
    for i, x in enumerate((7, 11.5, 16, 20.5)):
        c.part(rrect(x, 8, x + 4.8, 16, 2.4), col, ow=1.4)
    c.part(rrect(6, 12, 26, 28, 7, wob=.3, seed=81), col)
    for x in (11.5, 16, 20.5):
        c.line([(x, 13), (x, 15.5)], alpha(INK, 170), 0.9)
    c.part(rrect(3, 15, 10, 22, 3.4), col, ow=1.4)


@cursor('cursor_attack', (16, 16))
def _(c):
    c.arc((5, 5, 27, 27), 0, 360, INK, 5); c.arc((5, 5, 27, 27), 0, 360, P['berry-500'], 2.4)
    for a, b in (((16, 1.5), (16, 9)), ((16, 23), (16, 30.5)), ((1.5, 16), (9, 16)), ((23, 16), (30.5, 16))):
        c.line([a, b], INK, 4.4); c.line([a, b], P['parchment-50'], 2)
    c.ellipse((14, 14, 18, 18), INK); c.ellipse((15, 15, 17, 17), P['berry-300'])


@cursor('cursor_gather', (5, 5))
def _(c):
    c.line([(26, 28), (9, 9)], INK, 5.2); c.line([(26, 28), (9, 9)], P['wood-400'], 2.8)
    c.part([(4, 13), (8, 4), (17, 3.5), (13, 9), (10, 14)], P['slate-300'])
    c.line([(6, 10), (13, 5)], alpha(P['parchment-50'], 220), 1.0)


@cursor('cursor_build', (6, 6))
def _(c):
    c.line([(26, 28), (12, 12)], INK, 5.2); c.line([(26, 28), (12, 12)], P['wood-400'], 2.8)
    c.part([(3, 9.5), (10.5, 2), (19.5, 9.5), (14.5, 14.5), (11, 11), (7.5, 14)], P['slate-300'])


@cursor('cursor_forbidden', (16, 16))
def _(c):
    c.arc((4, 4, 28, 28), 0, 360, INK, 6.4); c.arc((4, 4, 28, 28), 0, 360, P['berry-500'], 3.4)
    c.line([(8.5, 23.5), (23.5, 8.5)], INK, 6.4); c.line([(8.5, 23.5), (23.5, 8.5)], P['berry-500'], 3.4)


@cursor('cursor_text', (16, 16))
def _(c):
    for p in ([(11, 4), (21, 4)], [(11, 28), (21, 28)], [(16, 4), (16, 28)]):
        c.line(p, INK, 4.2)
    for p in ([(11, 4), (21, 4)], [(11, 28), (21, 28)], [(16, 4), (16, 28)]):
        c.line(p, P['parchment-50'], 1.8)


@cursor('cursor_loading', (16, 16))
def _(c):
    c.part(blob(16, 16, 12, 12, wob=.3, seed=82), P['parchment-50'])
    c.part([(16, 16), (16, 6.5), (24, 11)], P['sun-500'], ow=1.2, shade=False)
    c.line([(16, 16), (16, 8)], INK, 1.8); c.line([(16, 16), (21, 18)], INK, 1.8)
