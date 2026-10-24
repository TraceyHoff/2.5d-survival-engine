"""ADR-120 sign sprites + ADR-119/120 item icons.
Signs: sign_wooden_post, sign_hanging, sign_wall_plaque, sign_metal_road, sign_arrow (48x64-ish cells, page nature_signs)
and sign_billboard (128x80-ish, page nature_billboard). Four facings per sign (Sign.rot 0..3): animations idle (rot 0),
idle_r1, idle_r2, idle_r3. Board plane per rotation: rot 0 faces the camera down-left (world +y), rot 1 down-right (+x),
rot 2 / 3 face away (back of the board; the post/mount in front). sign_arrow points along its rotation (+x, +y, -x, -y).
The board is left plain (wood grain / enamel) because the sign text is a DOM world label. Both pages stream with
placeholder null. Item icons (32x32, page nature_roadicons, resident): gravel, cement, asphalt + one icon per sign item;
the sign icons are keyed icon_<sign key> (the bare key is the world sprite) and mapped by sprite_fallbacks `icons`.
Painted with the items-pack painter (draw.C) so they match the 32px icon set."""
import os, sys, math
HERE = os.path.dirname(os.path.abspath(__file__)); ITEMS = os.path.normpath(os.path.join(HERE, "../../items/src"))
if ITEMS not in sys.path: sys.path.append(ITEMS)
from draw import C, lt, dk
from common import Frame, pack_grid, FRAG

WOOD, DWOOD, POST, IRON = '#c99558', '#7d5232', '#9a6a3e', '#8d97a6'

class T:
    """coordinate transform proxy over a draw.C (scale k, offset ox/oy) so one drawing serves sprite and icon."""
    def __init__(s, c, k=1.0, ox=0.0, oy=0.0): s.c, s.k, s.ox, s.oy = c, k, ox, oy
    def p(s, pts): return [(x * s.k + s.ox, y * s.k + s.oy) for x, y in pts]
    def poly(s, pts, col, **kw): s.c.poly(s.p(pts), col, **kw)
    def ell(s, x, y, rx, ry, col, **kw): s.c.ell(x * s.k + s.ox, y * s.k + s.oy, rx * s.k, ry * s.k, col, **kw)
    def stroke(s, pts, w, col, **kw): s.c.stroke(s.p(pts), w * s.k, col, **kw)
    def line(s, pts, w, col, a=255): s.c.line(s.p(pts), w * s.k, col, a)
    def dot(s, x, y, r, col, a=255): s.c.dot(x * s.k + s.ox, y * s.k + s.oy, r * s.k, col, a)

def quad(cx, cy, w, h, sl):
    """board face centred at (cx, cy), screen width w, height h, top/bottom edges sloped sl px per px (iso plane)."""
    hw, hh = w / 2, h / 2
    return [(cx - hw, cy - hh - sl * hw), (cx + hw, cy - hh + sl * hw), (cx + hw, cy + hh + sl * hw), (cx - hw, cy + hh - sl * hw)]

def board(t, cx, cy, w, h, sl, front, col=WOOD, rim=True, grain=True, thick=1.6, shape=None):
    """a slab: side (thickness) behind, then the visible face. front=False draws the plainer back face."""
    q = shape or quad(cx, cy, w, h, sl)
    off = (thick * .8 * (1 if sl > 0 else -1), -thick * .4) if front else (-thick * .8 * (1 if sl > 0 else -1), thick * .4)
    t.poly([(x + off[0], y + off[1]) for x, y in q], dk(col, .35), owf=.8)
    face = col if front else dk(col, .12)
    t.poly(q, face, shade=.22 if front else .12, owf=.8)
    if grain:
        for f in (.3, .55, .78):
            y0 = cy - h / 2 + h * f
            t.line([(cx - w / 2 + 1.5, y0 - sl * (w / 2 - 1.5) * 1), (cx + w / 2 - 1.5, y0 + sl * (w / 2 - 1.5))], .45, dk(face, .22), 150)
    if rim and front:
        inner = quad(cx, cy, w - 3.2, h - 3.2, sl) if shape is None else None
        if inner: t.line(inner + inner[:1], .55, lt(face, .35), 190)

def post(t, x, top, bot, w=1.7, col=POST):
    t.poly([(x - w, top), (x + w, top), (x + w, bot), (x - w, bot)], col, shade=.3, owf=.8)
    t.poly([(x - w - .6, bot - 1.2), (x + w + .6, bot - 1.2), (x + w + .9, bot + .4), (x - w - .9, bot + .4)], dk(col, .2), owf=.7)

SL = {0: .5, 1: -.5, 2: .5, 3: -.5}   # board edge slope per rotation
FRONT = {0: True, 1: True, 2: False, 3: False}

def wooden_post(t, r):
    sl, fr = SL[r], FRONT[r]
    if fr: post(t, 32, 22, 60); board(t, 32, 24, 30, 15, sl, True)
    else: board(t, 32, 24, 30, 15, sl, False); post(t, 32, 22, 60)
    t.dot(32 - 11, 24 - sl * 11, .7, '#d8d0c0') if fr else None; t.dot(32 + 11, 24 + sl * 11, .7, '#d8d0c0') if fr else None

def hanging(t, r):
    sl, fr = SL[r], FRONT[r]; px = 32 - 11 * (1 if sl > 0 else -1)   # post on the far end of the arm
    ax0, ax1 = px, 32 + 11 * (1 if sl > 0 else -1)
    arm = lambda: t.stroke([(ax0, 14 + sl * (ax0 - 32)), (ax1 + 1.5 * (1 if sl > 0 else -1), 14 + sl * (ax1 - 32))], 1.6, DWOOD, owf=.7)
    brace = lambda: t.stroke([(px, 21), (px + 6 * (1 if sl > 0 else -1), 14 + sl * (px + 6 * (1 if sl > 0 else -1) - 32))], .9, DWOOD, owf=.6)
    post(t, px, 11, 60, w=1.6); arm(); brace()
    for dx in (-7, 7):
        x = 32 + dx * (1 if sl > 0 else -1) * 0 + dx; y0 = 14 + sl * (x - 32)
        t.line([(x, y0), (x, y0 + 6)], .5, '#5a5048', 230)
    board(t, 32, 27, 22, 12, sl, fr, col='#d6a868')
    if fr: t.ell(32, 27 + 0, 2.2, 2.0, '#e8c27a', owf=.5)   # little painted emblem (lantern-like dot)

def wall_plaque(t, r):
    sl, fr = SL[r], FRONT[r]
    if fr:
        board(t, 32, 30, 26, 16, sl, True, col='#b07a46', grain=False, thick=2.2)
        board(t, 32, 30, 21, 11, sl, True, col='#e7d3a8', rim=False, thick=.6)
        for dx in (-9.5, 9.5): t.dot(32 + dx, 30 + sl * dx - 5, .75, '#d9b25a'); t.dot(32 + dx, 30 + sl * dx + 5, .75, '#d9b25a')
    else:   # away-facing: just the back plate and its hanging cleat
        board(t, 32, 30, 26, 16, sl, False, col='#9a6a3e', grain=True, thick=2.2)
        t.poly(quad(32, 26, 14, 2.4, sl), DWOOD, owf=.6)

def metal_road(t, r):
    sl, fr = SL[r], FRONT[r]; pole = '#a9b2bd'
    def plate():
        board(t, 32, 22, 30, 14, sl, fr, col='#3f86c8' if fr else '#9aa4ae', grain=False, thick=1.0)
        if fr:
            inner = quad(32, 22, 26.5, 10.5, sl); t.line(inner + inner[:1], .8, '#f4f6f8', 255)
            t.dot(32 - 12, 22 - sl * 12, .6, '#e6eaee'); t.dot(32 + 12, 22 + sl * 12, .6, '#e6eaee')
    if fr: post(t, 32, 18, 60, w=1.2, col=pole); plate()
    else:
        plate(); post(t, 32, 18, 60, w=1.2, col=pole)
        for yy in (18.5, 25.5): t.poly(quad(32, yy, 6, 1.6, sl), '#7c8590', owf=.5)   # clamp brackets
    t.ell(32, 16.6 if fr else 17.2, 1.3, .8, '#c9d1da', owf=.5)

def arrow(t, r):
    sl = SL[r]; sgn = {0: 1, 1: -1, 2: -1, 3: 1}[r]   # screen x direction of the tip
    tip = 32 + 17 * sgn; tail = 32 - 13 * sgn; cy = 24
    y = lambda x: cy + sl * (x - 32)
    neck = 32 + 8 * sgn
    shape = [(tail, y(tail) - 4.5), (neck, y(neck) - 4.5), (neck, y(neck) - 8), (tip, y(tip)), (neck, y(neck) + 8), (neck, y(neck) + 4.5), (tail, y(tail) + 4.5)]
    front_first = r in (0, 1)
    if not front_first: board(t, 0, 0, 0, 0, sl, True, col='#e0a24e', shape=shape, grain=False); post(t, 32 - 4 * sgn, 22, 60)
    else: post(t, 32 - 4 * sgn, 22, 60); board(t, 0, 0, 0, 0, sl, True, col='#e0a24e', shape=shape, grain=False)
    t.line([(tail + 2 * sgn, y(tail + 2 * sgn)), (neck + 3 * sgn, y(neck + 3 * sgn))], .6, lt('#e0a24e', .4), 200)

def billboard(t, r):   # 128-unit canvas, feet at (64, 76)
    sl, fr = SL[r] * .5, FRONT[r]
    legs = lambda: [post(t, 64 + dx, 34 + sl * dx, 76 + sl * dx * .2, w=2.0, col=POST) for dx in (-30, 30)]
    def face():
        board(t, 64, 34, 92, 40, sl, fr, col='#8a5a34' if fr else '#7a5030', grain=not fr, thick=2.4)
        if fr:
            board(t, 64, 34, 84, 32, sl, True, col='#f2e6c6', rim=False, grain=False, thick=.5)
            for dx in (-28, 0, 28):   # little hood lamps
                x = 64 + dx; yy = 34 - 20 + sl * dx
                t.stroke([(x, yy), (x + 2, yy - 4)], .8, '#4a4a52'); t.ell(x + 2.5, yy - 4.5, 2.2, 1.3, '#5a5a62', owf=.6); t.dot(x + 2.5, yy - 3.6, .9, '#ffe08a', 230)
        else:
            for dx in (-30, 30): t.stroke([(64 + dx, 34 + sl * dx - 16), (64 + dx, 34 + sl * dx + 16)], 1.6, dk('#7a5030', .25))
            t.stroke([(64 - 40, 34 - sl * 40), (64 + 40, 34 + sl * 40)], 1.4, dk('#7a5030', .25))
    if fr: legs(); face()
    else: face(); legs()

SIGNS = [("sign_wooden_post", wooden_post), ("sign_hanging", hanging), ("sign_wall_plaque", wall_plaque), ("sign_metal_road", metal_road), ("sign_arrow", arrow)]

def _draw(fn, r, n, px):
    c = C(n, 4); fn(T(c), r); return c.out(px), c.out(px * 2)

def icon_gravel(c):
    c.shadow(16, 25, 11, 3) if hasattr(c, 'shadow') else None
    c.poly([(4, 25), (9, 15), (16, 11), (23, 15), (28, 25)], '#b9ad9b', shade=.3)
    for x, y, rr, col in ((10, 21, 2.2, '#d8cfbf'), (15, 17, 2.4, '#a39888'), (20, 21, 2.3, '#c8bca8'), (16, 23, 2.0, '#8d8478'), (12, 16.5, 1.6, '#cfc6b8'), (22, 17, 1.7, '#b4a48c'), (7, 24, 1.6, '#a39888'), (25, 24, 1.7, '#d8cfbf')):
        c.ell(x, y, rr, rr * .8, col, owf=.5); c.dot(x - rr * .3, y - rr * .3, rr * .3, '#f4f0e8', 200)
def icon_cement(c):
    c.shadow(16, 27, 11, 2.6) if hasattr(c, 'shadow') else None
    c.poly([(6, 26), (5, 11), (8, 7), (24, 7), (27, 11), (26, 26)], '#c9c6be', shade=.3)
    c.poly([(8, 7), (11, 4.5), (21, 4.5), (24, 7)], '#b4b0a6')
    c.rect(9, 13, 23, 21, '#e0703a', r=1.2, owf=.6); c.rect(11, 15.5, 21, 18.5, '#f6efe2', r=.6, ol=False)
    c.dot(25, 27.5, 1.3, '#c9c6be'); c.dot(22, 28.2, .9, '#c9c6be')
def icon_asphalt(c):
    c.shadow(16, 27, 11, 2.6) if hasattr(c, 'shadow') else None
    c.poly([(5, 24), (6, 15), (12, 10), (21, 10), (27, 15), (27, 24), (20, 27), (11, 27)], '#45474e', shade=.35)
    c.poly([(6, 15), (12, 10), (21, 10), (27, 15), (20, 18), (11, 18)], '#5a5d66', owf=.6)
    for x, y in ((10, 21), (15, 23), (21, 21), (18, 14), (13, 14.5), (24, 23)): c.dot(x, y, .8, '#8a8c92', 220)
    c.shine(14, 12.5, 1.0, 170)

def _icon_sign(fn, k, ox, oy, n=64):
    def f(c): fn(T(c, k, ox, oy), 0)
    return f

ICONS = [("gravel", icon_gravel), ("cement", icon_cement), ("asphalt", icon_asphalt)] + \
        [(f"icon_{k}", _icon_sign(fn, .52, -.6, -3.0)) for k, fn in SIGNS] + [("icon_sign_billboard", _icon_sign(billboard, .26, -.6, 2.0))]

def g(b):
    from PIL import Image
    # --- small signs
    frames, idx = [], []
    for key, fn in SIGNS:
        ids = []
        for r in range(4): frames.append(Frame(_draw(fn, r, 64, 64), 32, 60)); ids.append(len(frames) - 1)
        idx.append((key, ids))
    for key, n, px, base, fn in (("nature_signs", 64, 64, 60, None),):
        aj, anchor, _ = pack_grid("nature_signs", frames, 8, FRAG); aj["residency"] = "stream"; aj["placeholder"] = None; b.atlases.append(aj)
    for key, ids in idx:
        b.sprites.append({"key": key, "category": "resource", "atlas": "nature_signs", "anchor": anchor,
                          "animations": {"idle": {"frames": [ids[0]], "fps": 1}, **{f"idle_r{r}": {"frames": [ids[r]], "fps": 1} for r in (1, 2, 3)}}})
    b.previews["nature_signs"] = [(f"{k} r{r}", frames[i].i2) for k, ids in idx for r, i in enumerate(ids)]
    # --- billboard
    bf = [Frame(_draw(billboard, r, 128, 128), 64, 76) for r in range(4)]
    aj, anchor, _ = pack_grid("nature_billboard", bf, 2, FRAG); aj["residency"] = "stream"; aj["placeholder"] = None; b.atlases.append(aj)
    b.sprites.append({"key": "sign_billboard", "category": "resource", "atlas": "nature_billboard", "anchor": anchor,
                      "animations": {"idle": {"frames": [0], "fps": 1}, **{f"idle_r{r}": {"frames": [r], "fps": 1} for r in (1, 2, 3)}}})
    b.previews["nature_billboard"] = [(f"sign_billboard r{r}", f.i2) for r, f in enumerate(bf)]
    # --- item icons
    cols = len(ICONS); p1 = Image.new("RGBA", (32 * cols, 32)); p2 = Image.new("RGBA", (64 * cols, 64)); prev = []
    for i, (key, fn) in enumerate(ICONS):
        c = C(32, 8); fn(c); i1, i2 = c.out(32), c.out(64); p1.alpha_composite(i1, (i * 32, 0)); p2.alpha_composite(i2, (i * 64, 0)); prev.append((key, i2))
    p1.save(os.path.join(FRAG, "atlases/nature_roadicons.png"), optimize=True); p2.save(os.path.join(FRAG, "atlases/nature_roadicons@2x.png"), optimize=True)
    b.atlases.append({"key": "nature_roadicons", "image": "atlases/nature_roadicons.png", "frameW": 32, "frameH": 32, "columns": cols, "rows": 1, "pages": [{"scale": 2, "image": "atlases/nature_roadicons@2x.png"}]})
    for i, (key, _) in enumerate(ICONS):
        b.sprites.append({"key": key, "category": "item", "atlas": "nature_roadicons", "anchor": {"x": 0.5, "y": 0.5}, "animations": {"idle": {"frames": [i], "fps": 1}}})
    b.previews["nature_roadicons"] = prev

GROUPS = [g]
