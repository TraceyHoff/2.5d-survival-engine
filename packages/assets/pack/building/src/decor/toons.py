"""Small toon drawings (assets/tools toon.Canvas) for organic decor shapes: heads, statues, vessels, plants.
Each draw fn paints on a size x size canvas whose ground point is (size/2, size*0.75)."""
import math
from .lib import Canvas, ellipse_pts, capsule_pts, toon_at, SS

def at(x, y, z, draw, size=32, role=None, flip_odd=False):
    """decor entry drawn after all boxes; flip_odd mirrors the drawing on rot 1/3 (side-facing art follows the wall)."""
    def fn(cv, r, m):
        if flip_odd and r % 2:
            toon_at(cv, x, y, z, r, m, lambda c: (draw(c), setattr(c, 'img', c.img.transpose(0))), size)
        else: toon_at(cv, x, y, z, r, m, draw, size)
    return (-1, fn, role)

def vessel(profile, rp, band=None, band_rp=None, handles=False):
    """profile: list of (half-width, y) from the base up (canvas 32 units, base at y=24)."""
    def d(c):
        L = [(16 - w, y) for w, y in profile]; R = [(16 + w, y) for w, y in reversed(profile)]
        c.part(L + R, rp, shade=0.3)
        if handles: [c.part(capsule_pts(16 + s * profile[-2][0], profile[-2][1], 16 + s * (profile[-2][0] + 3), profile[len(profile) // 2][1], 1.0), rp) for s in (-1, 1)]
    return d

def vessel_band(profile, y0, y1, rp):
    def d(c):
        pts = [p for p in profile if y1 <= p[1] <= y0] or profile[:2]
        w = max(p[0] for p in pts); c.part([(16 - w, y0), (16 + w, y0), (16 + w, y1), (16 - w, y1)], rp, shade=0.2, outline=False)
    return d

def head(kind):
    """mounted animal head facing left (side 3/4 view)."""
    col = {'deer': 'fur_brown', 'elk': 'fur_brown', 'moose': 'hide', 'boar': 'hair_black', 'wolf': 'smoke', 'bear': 'fur_brown', 'bison': 'hair_brown', 'rabbit': 'fur_pale'}[kind]
    def d(c):
        if kind in ('deer', 'elk'):
            n = 3 if kind == 'deer' else 4
            for s in (-1, 1):
                x = 16 + s * 3; c.part(capsule_pts(x, 12, x + s * 6, 2, .9), 'bone' if False else 'fur_pale', shade=.1)
                for i in range(n): yy = 10 - i * 2.4; c.part(capsule_pts(x + s * (1 + i * 1.5), yy, x + s * (i * 1.5 - 1), yy - 3, .7), 'fur_pale', shade=.1)
        if kind == 'moose':
            for s in (-1, 1): c.part(ellipse_pts(16 + s * 8, 8, 5.5, 3.2, rot=s * .4), 'fur_pale', shade=.15)
        if kind == 'bison':
            for s in (-1, 1): c.part(capsule_pts(16 + s * 5, 12, 16 + s * 8, 8, 1.2, .6), 'fur_pale', shade=.1)
        if kind in ('wolf', 'rabbit'):
            L = 7 if kind == 'rabbit' else 4
            for s in (-1, 1): c.part(ellipse_pts(16 + s * 3.5, 11 - L / 2, 1.8, L, rot=s * .25), col)
        if kind == 'bear':
            for s in (-1, 1): c.part(ellipse_pts(16 + s * 5, 11, 2.4, 2.4), col)
        big = 1.25 if kind in ('bison', 'bear', 'moose') else 1.0
        c.part(ellipse_pts(16, 15, 5.5 * big, 5.5 * big), col)
        sn = {'boar': (16, 21, 3.4, 2.6), 'wolf': (16, 20, 2.6, 3.4), 'bear': (16, 19, 3.0, 2.6), 'rabbit': (16, 18, 2.0, 1.8)}.get(kind, (16, 21, 2.6, 3.6))
        c.part(ellipse_pts(*sn), col)
        c.part(ellipse_pts(sn[0], sn[1] + sn[3] - 1.2, 1.3, .9), 'ink', outline=False, flat=True)
        for s in (-1, 1): c.part(ellipse_pts(16 + s * 2.4, 14, .9, .9), 'ink', outline=False, flat=True)
        if kind == 'boar':
            for s in (-1, 1): c.part(capsule_pts(16 + s * 2.6, 22, 16 + s * 3.8, 19, .6), 'snow', shade=0)
    return d

def statue_fig(kind, rp):
    def d(c):
        if kind == 'bust':
            c.part([(9, 27), (23, 27), (21, 19), (11, 19)], rp); c.part(ellipse_pts(16, 13, 4.5, 5.5), rp)
        elif kind == 'warrior':
            c.part(capsule_pts(13, 26, 13, 18, 1.6), rp); c.part(capsule_pts(19, 26, 19, 18, 1.6), rp)
            c.part([(10, 19), (22, 19), (21, 9), (11, 9)], rp); c.part(ellipse_pts(16, 6, 3, 3.2), rp)
            c.part(capsule_pts(23, 24, 23, 0, .7), rp); c.part(ellipse_pts(9, 14, 3.4, 4.5), rp)
        elif kind == 'angel':
            for s in (-1, 1): c.part([(16, 10), (16 + s * 13, 2), (16 + s * 11, 14), (16 + s * 4, 18)], rp, shade=.15)
            c.part([(12, 27), (20, 27), (18, 10), (14, 10)], rp); c.part(ellipse_pts(16, 7, 2.8, 3), rp)
        elif kind in ('deer', 'bear'):
            k = kind == 'bear'; c.part(ellipse_pts(16, 17, 9 if k else 8, 5 if k else 4), rp)
            for x in (10, 13, 19, 22): c.part(capsule_pts(x, 19, x, 27, 1.4 if k else 1.0), rp)
            c.part(ellipse_pts(7 if not k else 6, 12 if not k else 15, 3, 2.6 if not k else 3.2), rp)
            if not k:
                c.part(capsule_pts(8, 15, 7, 11, 1.3), rp); c.part(capsule_pts(7, 10, 4, 3, .6), rp); c.part(capsule_pts(7, 10, 10, 3, .6), rp)
        elif kind == 'abstract':
            c.part([(12, 27), (20, 27), (24, 14), (16, 2), (9, 12), (14, 18)], rp, shade=.3); c.part(ellipse_pts(17, 13, 2.5, 2.5), 'ink', outline=False, flat=True)
        elif kind == 'hero':
            c.part(capsule_pts(13, 27, 13, 17, 1.8), rp); c.part(capsule_pts(19, 27, 19, 17, 1.8), rp)
            c.part([(10, 18), (22, 18), (21, 7), (11, 7)], rp); c.part(ellipse_pts(16, 4.5, 2.8, 3), rp); c.part(capsule_pts(21, 8, 26, 0, 1.2), rp)
        elif kind == 'horse':
            c.part(ellipse_pts(15, 15, 10, 5), rp); [c.part(capsule_pts(x, 17, x, 27, 1.4), rp) for x in (8, 11, 19, 22)]
            c.part(capsule_pts(24, 13, 27, 5, 2.4), rp); c.part(ellipse_pts(28, 5, 3.5, 2.2, rot=.4), rp); c.part(capsule_pts(13, 10, 14, 1, 1.6), rp)
    return d

def plant(kind):
    def d(c):
        if kind in ('fern', 'boston', 'maidenhair'):
            fine = kind == 'maidenhair'
            for i in range(9):
                a = -math.pi * (.1 + .8 * i / 8); L = 11 + 3 * math.sin(i * 1.7)
                c.part(capsule_pts(16, 22, 16 + math.cos(a) * L, 22 + math.sin(a) * L * .8, 1.6 if not fine else 1.1, .4), 'leaf' if i % 2 else 'grass', shade=.2)
        elif kind == 'palm':
            c.part(capsule_pts(16, 24, 16, 10, 1.2), 'bark')
            for i in range(7): a = -math.pi * (i / 6); c.part(capsule_pts(16, 10, 16 + math.cos(a) * 12, 10 + math.sin(a) * 6 + 5, 1.8, .3), 'leaf', shade=.2)
        elif kind == 'ficus':
            c.part(capsule_pts(16, 24, 16, 12, 1.0), 'bark'); [c.part(ellipse_pts(16 + dx, 9 + dy, 6, 5), 'leaf') for dx, dy in ((-4, 2), (4, 2), (0, -2))]
        elif kind == 'monstera':
            for i, (dx, dy) in enumerate(((-7, 10), (6, 8), (0, 4), (-3, 14), (8, 15))): c.part(capsule_pts(16, 23, 16 + dx, dy + 3, .5), 'grass_deep'); c.part(ellipse_pts(16 + dx, dy, 5, 3.6, rot=dx * .05), 'leaf_dark' if False else 'grass_deep', shade=.25)
        elif kind == 'snake_plant':
            for i, dx in enumerate((-5, -2, 1, 4, 6)): c.part([(16 + dx - 1.6, 24), (16 + dx + 1.6, 24), (16 + dx * 1.3, 3 + (i % 3) * 3)], 'leaf' if i % 2 else 'grass_deep', shade=.2)
        elif kind in ('barrel', 'saguaro', 'prickly', 'flowering'):
            if kind == 'saguaro':
                c.part(capsule_pts(16, 24, 16, 4, 3.4), 'grass_deep'); c.part(capsule_pts(12, 16, 9, 9, 1.8), 'grass_deep'); c.part(capsule_pts(20, 14, 23, 7, 1.8), 'grass_deep')
            elif kind == 'prickly':
                for dx, dy, r in ((0, 18, 5), (-5, 10, 4), (5, 9, 4), (0, 4, 3.4)): c.part(ellipse_pts(16 + dx, dy, r, r * 1.2), 'grass_deep')
            else:
                c.part(ellipse_pts(16, 17, 7, 7), 'grass_deep');
                if kind == 'flowering': [c.part(ellipse_pts(16 + dx, 10 + dy, 2, 2), 'flower_pink') for dx, dy in ((-3, 0), (2, -1), (0, 2))]
        elif kind in ('rose', 'tulip', 'daisy', 'lavender', 'sunflower'):
            colr = {'rose': 'cloth_red', 'tulip': 'flower_pink', 'daisy': 'snow', 'lavender': 'flower_blue', 'sunflower': 'flower_yel'}[kind]
            n = 1 if kind == 'sunflower' else 5
            for i in range(n):
                dx = (i - (n - 1) / 2) * 3.4; top = 6 + (i % 2) * 3 if n > 1 else 1
                c.part(capsule_pts(16 + dx * .4, 23, 16 + dx, top + 3, .6), 'grass')
                if kind == 'lavender': c.part(capsule_pts(16 + dx, top + 3, 16 + dx, top - 3, 1.3), colr, shade=.1)
                elif kind == 'sunflower': c.part(ellipse_pts(16, 5, 6, 6), colr); c.part(ellipse_pts(16, 5, 2.6, 2.6), 'bark', outline=False)
                else: c.part(ellipse_pts(16 + dx, top + 1, 2.2, 2.0), colr); 
            c.part(ellipse_pts(13, 17, 2.5, 1.4, rot=-.5), 'leaf'); c.part(ellipse_pts(19, 16, 2.5, 1.4, rot=.5), 'leaf')
        elif kind in ('ivy', 'spider', 'pearls'):
            for i in range(7):
                a = math.pi * (.15 + .7 * i / 6); x1 = 16 + math.cos(a) * 9; y1 = 12 + math.sin(a) * (14 + (i % 3) * 3)
                if kind == 'pearls':
                    for t in range(4): c.part(ellipse_pts(16 + (x1 - 16) * t / 3.5, 12 + (y1 - 12) * t / 3.5, 1.2, 1.2), 'grass', shade=0)
                else: c.part(capsule_pts(16, 12, x1, y1, .9 if kind == 'ivy' else 1.3, .3), 'leaf' if kind == 'ivy' else 'grass', shade=.2)
            if kind == 'ivy': [c.part(ellipse_pts(16 + dx, 15 + dy, 1.8, 1.5), 'leaf') for dx, dy in ((-6, 8), (5, 9), (-2, 14), (7, 3))]
        elif kind in ('pine', 'maple'):
            c.part([(14, 24), (18, 24), (17, 15), (21, 9), (19, 8), (16, 12), (12, 7), (10, 9), (15, 15)], 'bark', shade=.2)
            cc = 'pine' if kind == 'pine' else 'leaf_autumn'
            for dx, dy, rx in ((-6, 7, 5), (5, 6, 5), (0, 3, 4)): c.part(ellipse_pts(16 + dx, dy, rx, rx * .55), cc)
        elif kind == 'herbs':
            for i, dx in enumerate((-7, -3, 1, 5, 8)): c.part(ellipse_pts(16 + dx, 18 - (i % 2) * 2, 3, 3.6), 'leaf' if i % 2 else 'grass')
        elif kind == 'shrub':
            for dx, dy, r in ((-6, 15, 6), (6, 15, 6), (0, 9, 7), (0, 17, 7)): c.part(ellipse_pts(16 + dx, dy, r, r * .85), 'leaf')
    return d
