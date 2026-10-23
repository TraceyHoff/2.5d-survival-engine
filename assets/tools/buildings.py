"""Modular iso building pieces. Each piece = list of boxes (local coords, tiles; z in px) + decor callbacks.
Rendered for 4 rotations x 4 damage stages into 128x128 cells, pivot = footprint center on ground (64,96)."""
import math, numpy as np
from PIL import Image, ImageDraw
from iso import IsoCanvas, tex_planks, tex_cobble, tex_thatch, tex_flat, add_outline, damage, ramp_color, HW, HH
from toon import SS, downscale, Canvas, ellipse_pts, capsule_pts, lerp, INK
from palette import ramp, hex2rgb

def planksH(board=7): return lambda w, h, s: tex_planks(w, h, s, board=board)
def planksV(board=6): return lambda w, h, s: tex_planks(w, h, s, board=board, vertical=True)
def cobble(cell=7): return lambda w, h, s: tex_cobble(w, h, s, cell=cell)
def flat(amp=0.12): return lambda w, h, s: tex_flat(w, h, s, amp=amp)
def thatch(): return lambda w, h, s: tex_thatch(w, h, s)

class B:
    """box spec"""
    def __init__(self, x0, x1, y0, y1, z0, z1, rp, top=None, left=None, right=None, faces="tlr", edge=True):
        self.v = [x0, x1, y0, y1, z0, z1]; self.rp = rp; self.top, self.left, self.right = top, left, right; self.faces = faces; self.edge = edge

def xform(b, rot, mirror=False):
    x0, x1, y0, y1, z0, z1 = b.v
    pts = [(x0, y0), (x1, y1)]
    def f(x, y):
        if mirror: return (y, x)
        for _ in range(rot % 4): x, y = -y, x
        return (x, y)
    p = [f(*q) for q in pts]
    nb = B(min(p[0][0], p[1][0]), max(p[0][0], p[1][0]), min(p[0][1], p[1][1]), max(p[0][1], p[1][1]), z0, z1, b.rp, b.top, b.left, b.right, b.faces, b.edge)
    # textures: swap left/right generators when axes swap so planks stay horizontal on vertical faces
    return nb

def painter_sort(bs, eps=1e-6):
    n = len(bs); before = {i: set() for i in range(n)}
    def behind(a, b):
        A, Bv = a.v, b.v
        return A[1] <= Bv[0] + eps or A[3] <= Bv[2] + eps or A[5] <= Bv[4] + eps
    for i in range(n):
        for j in range(n):
            if i != j and behind(bs[i], bs[j]) and not behind(bs[j], bs[i]): before[j].add(i)
    key = lambda i: ((bs[i].v[0] + bs[i].v[1] + bs[i].v[2] + bs[i].v[3]) / 2, bs[i].v[4])
    out, done = [], set()
    while len(out) < n:
        ready = [i for i in range(n) if i not in done and before[i] <= done]
        if not ready: ready = [min((i for i in range(n) if i not in done), key=key)]
        i = min(ready, key=key); out.append(bs[i]); done.add(i)
    return out

def render_boxes(boxes, rot, mirror=False, seed=1, decor=None, footprint=(1, 1), shadow=True, cell=(128, 128), origin=(64, 96), lw=1.0):
    cv = IsoCanvas(cell[0], cell[1], origin[0], origin[1], seed)
    bs = [xform(b, rot, mirror) for b in boxes]
    bs = painter_sort(bs)
    quads = []
    for i, b in enumerate(bs):
        q = cv.box(*b.v, b.rp, b.top, b.left, b.right, seed=seed * 31 + i * 7, faces=b.faces)
        if b.edge: quads += q
        if decor:
            for (after, fn) in decor:
                if after == i: fn(cv, rot, mirror)
    cv.ink_edges(quads)
    if decor:
        for (after, fn) in decor:
            if after == -1: fn(cv, rot, mirror)
    return cv

def finalize(cv, stage, seed, shadow_rect=None):
    img = damage(cv.img, stage, seed)
    img = add_outline(img, 1.0, seed)
    if shadow_rect is not None:
        sh = IsoCanvas(cv.w, cv.h, cv.ox, cv.oy); sh.ground_shadow(*shadow_rect); img = Image.alpha_composite(sh.img, img)
    return downscale(img, (cv.w, cv.h))

# ---------------------------------------------------------------- pieces (rot0 local geometry)
T = 0.14   # half wall thickness (tiles)
WALL_H = 48

def wall_wood(kind="plain"):
    L = 1.0  # half length (2x1 footprint, along x)
    bx = [B(-L, L, -T - 0.04, T + 0.04, 0, 7, "cobble", top=cobble(5), left=cobble(5), right=cobble(5))]
    if kind == "plain":
        bx.append(B(-L + 0.12, L - 0.12, -T, T, 7, 43, "wood", left=planksH(7), right=planksH(7), top=flat()))
    elif kind == "window":
        bx += [B(-L + 0.12, L - 0.12, -T, T, 7, 19, "wood", left=planksH(6), right=planksH(6)),
               B(-L + 0.12, -0.42, -T, T, 19, 37, "wood", left=planksH(6), right=planksH(6)),
               B(0.42, L - 0.12, -T, T, 19, 37, "wood", left=planksH(6), right=planksH(6)),
               B(-0.42, 0.42, -0.02, 0.02, 19, 37, "glass", left=flat(0.3), right=flat(0.3), faces="lr", edge=False),
               B(-0.42, 0.42, -T, T, 37, 43, "wood", left=planksH(6), right=planksH(6)),
               # frame
               B(-0.48, 0.48, -T - 0.03, T + 0.03, 36, 39, "wood_dark"),
               B(-0.48, 0.48, -T - 0.03, T + 0.03, 17, 20, "wood_dark"),
               B(-0.48, -0.40, -T - 0.03, T + 0.03, 20, 36, "wood_dark"),
               B(0.40, 0.48, -T - 0.03, T + 0.03, 20, 36, "wood_dark"),
               B(-0.03, 0.03, -0.04, 0.04, 20, 36, "wood_dark", faces="lr"),
               # flower box (camera side)
               B(-0.5, 0.5, T + 0.02, T + 0.2, 12, 18, "wood", left=planksH(3), right=planksH(3))]
    elif kind == "door":
        bx += [B(-L + 0.12, -0.36, -T, T, 7, 43, "wood", left=planksH(7), right=planksH(7)),
               B(0.36, L - 0.12, -T, T, 7, 43, "wood", left=planksH(7), right=planksH(7)),
               B(-0.36, 0.36, -T, T, 38, 43, "wood", left=planksH(5), right=planksH(5)),
               B(-0.42, 0.42, -T - 0.03, T + 0.03, 36, 40, "wood_dark"),
               B(-0.42, -0.34, -T - 0.03, T + 0.03, 7, 36, "wood_dark"),
               B(0.34, 0.42, -T - 0.03, T + 0.03, 7, 36, "wood_dark")]
    # posts + beam
    for sx in (-1, 1):
        bx.append(B(sx * L - (0.16 if sx > 0 else 0), sx * L + (0.16 if sx < 0 else 0), -T - 0.05, T + 0.05, 0, 47, "wood_dark", left=planksV(4), right=planksV(4)))
    bx.append(B(-L, L, -T - 0.06, T + 0.06, 43, 48, "wood_dark", left=planksH(5), right=planksH(5), top=flat()))
    return bx

def wall_stone():
    L = 1.0
    return [B(-L, L, -T - 0.03, T + 0.03, 0, 42, "cobble", top=cobble(6), left=cobble(6), right=cobble(6)),
            B(-L, L, -T - 0.06, T + 0.06, 42, 48, "wood_dark", left=planksH(6), right=planksH(6), top=flat())]

def door_leaf(open_):
    if not open_: return [B(-0.34, 0.34, -0.05, 0.05, 7, 36, "cloth_red", left=planksV(5), right=planksV(5))]
    # open: swung 90deg around hinge at x=-0.34, toward +y (camera)
    return [B(-0.40, -0.32, 0.05, 0.72, 7, 36, "cloth_red", left=planksV(5), right=planksV(5))]

def door_decor(open_):
    def f(cv, rot, mirror):
        pass
    return f

def wall_corner():
    """L corner on a 1x1 footprint: arms toward -x... local: arm along +x half and +y half from center."""
    bx = [B(-0.5, T + 0.04, -T - 0.04, T + 0.04, 0, 7, "cobble", top=cobble(5), left=cobble(5), right=cobble(5)),
          B(-T - 0.04, T + 0.04, -0.5, -T - 0.04, 0, 7, "cobble", top=cobble(5), left=cobble(5), right=cobble(5)),
          B(-0.5, -T, -T, T, 7, 43, "wood", left=planksH(7), right=planksH(7)),
          B(-T, T, -0.5, -T, 7, 43, "wood", left=planksH(7), right=planksH(7)),
          B(-T - 0.05, T + 0.05, -T - 0.05, T + 0.05, 0, 47, "wood_dark", left=planksV(4), right=planksV(4)),
          B(-0.5, T + 0.06, -T - 0.06, T + 0.06, 43, 48, "wood_dark", left=planksH(5), right=planksH(5)),
          B(-T - 0.06, T + 0.06, -0.5, -T - 0.06, 43, 48, "wood_dark", left=planksH(5), right=planksH(5))]
    return bx

def pillar():
    return [B(-0.24, 0.24, -0.24, 0.24, 0, 8, "cobble", top=cobble(4), left=cobble(4), right=cobble(4)),
            B(-0.15, 0.15, -0.15, 0.15, 8, 52, "wood_dark", left=planksV(4), right=planksV(4)),
            B(-0.2, 0.2, -0.2, 0.2, 52, 56, "wood_dark")]

def floor(kind="wood"):
    if kind == "wood":
        return [B(-1, 1, -1, 1, 0, 4, "wood", top=lambda w, h, s: tex_planks(w, h, s, board=12), left=planksH(4), right=planksH(4))]
    return [B(-1, 1, -1, 1, 0, 4, "cobble", top=cobble(9), left=cobble(4), right=cobble(4))]

def fence():
    bx = []
    for x in (-0.95, 0.0, 0.95):
        bx.append(B(x - 0.07, x + 0.07, -0.07, 0.07, 0, 24, "wood", left=planksV(3), right=planksV(3)))
    bx += [B(-1, 1, -0.04, 0.04, 15, 19, "wood", left=planksH(4), right=planksH(4)),
           B(-1, 1, -0.04, 0.04, 7, 11, "wood", left=planksH(4), right=planksH(4))]
    return bx

def roof_boxes():
    return []   # roofs drawn by roof_piece()

ROT_COUNT = 4

# ---------------------------------------------------------------- local->world helpers for decor
def lw_fn(rot, mirror):
    def f(x, y):
        if mirror: return (y, x)
        for _ in range(rot % 4): x, y = -y, x
        return (x, y)
    return f

def toon_at(cv, x, y, z, rot, mirror, draw, size=32):
    """draw a small toon sprite (fn(Canvas) on a size x size canvas centered at (size/2, size*0.75)) at local pos."""
    f = lw_fn(rot, mirror); wx, wy = f(x, y); px, py = cv.P(wx, wy, z)
    c = Canvas(size, size, seed=int(abs(x * 100 + y * 10)) + 1); draw(c)
    cv.paste_sprite(c.img, px - size * SS / 2, py - size * 0.75 * SS)

def flowers_in_box(c):
    import math as m_
    for i, (dx, col) in enumerate([(-9, "flower_pink"), (-3, "flower_yel"), (3, "flower_blue"), (9, "flower_pink")]):
        x, y = 16 + dx, 22 - (i % 2) * 1.5
        c.line([(x, 25), (x, y)], ramp("grass")[3], 0.8)
        c.part(ellipse_pts(x + 1.6, y + 2.0, 1.6, 0.8, -0.5, n=12), "leaf", lw=0.5, shade=0.2, hl=0.2)
        for a in range(5):
            ang = a * 1.2566 + i
            c.part(ellipse_pts(x + m_.cos(ang) * 1.5, y + m_.sin(ang) * 1.3, 1.25, 1.1, n=12), col, lw=0.5, shade=0.2, hl=0.1)
        c.fill(ellipse_pts(x, y, 0.8, 0.8, n=10), ramp("flower_yel")[0])

def window_piece():
    bx = wall_wood("window")
    dec = [(-1, lambda cv, r, m: toon_at(cv, 0.0, T + 0.11, 18, r, m, flowers_in_box))]
    return bx, dec

def door_piece(open_):
    bx = wall_wood("door") + door_leaf(open_)
    def knob(cv, r, m):
        def k(c):
            c.part(ellipse_pts(16, 24, 1.3, 1.3, n=12), "gold", lw=0.6, shade=0.3, hl=0.2)
        if not open_: toon_at(cv, 0.22, 0.06, 22, r, m, k)
    def hinges(cv, r, m):
        def h(c):
            for dy in (0, -14): c.part([(13, 23 + dy), (19, 23 + dy), (19, 25 + dy), (13, 25 + dy)], "iron", lw=0.5, shade=0.3, hl=0.2)
        if not open_: toon_at(cv, -0.24, 0.06, 13, r, m, h)
    return bx, [(-1, knob), (-1, hinges)]

def roof_piece(rot, mirror=False, seed=3, rp="thatch"):
    cv = IsoCanvas(128, 128, 64, 96, seed)
    o = 0.0; Hh = 30; ez = -3
    along_x = (rot % 2 == 0)
    q = []
    if along_x:
        x0, x1 = -1 - o, 1 + o
        p0 = cv.P(x0, 0, Hh); eu = (cv.P(x1, 0, Hh)[0] - p0[0], cv.P(x1, 0, Hh)[1] - p0[1])
        pb = cv.P(x0, -1 - o, ez); ev_b = (pb[0] - p0[0], pb[1] - p0[1])
        q += [cv.face(p0, eu, ev_b, tex_thatch(260, 120, seed), rp, 0.9)]
        tri = [cv.P(x1, -1 - o, ez), cv.P(x1, 1 + o, ez), cv.P(x1, 0, Hh)]
        tri_in = [cv.P(x1 - 0.05, -1 + 0.1, ez + 2), cv.P(x1 - 0.05, 1 - 0.1, ez + 2), cv.P(x1 - 0.05, 0, Hh - 4)]
        q += [cv.face(tri[0], (tri[1][0] - tri[0][0], tri[1][1] - tri[0][1]), (0, -(Hh - ez) * SS), tex_planks(120, 140, seed, board=6, vertical=True), "wood", 0.6, clip=tri_in)]
        pf = cv.P(x0, 1 + o, ez); ev_f = (pf[0] - p0[0], pf[1] - p0[1])
        q += [cv.face(p0, eu, ev_f, tex_thatch(260, 120, seed + 1), rp, -0.1)]
        a, b = cv.P(x0, 0, Hh + 1), cv.P(x1, 0, Hh + 1)
    else:
        y0, y1 = -1 - o, 1 + o
        p0 = cv.P(0, y0, Hh); eu = (cv.P(0, y1, Hh)[0] - p0[0], cv.P(0, y1, Hh)[1] - p0[1])
        pb = cv.P(-1 - o, y0, ez); ev_b = (pb[0] - p0[0], pb[1] - p0[1])
        q += [cv.face(p0, eu, ev_b, tex_thatch(260, 120, seed), rp, 0.3)]
        tri = [cv.P(1 + o, y1, ez), cv.P(-1 - o, y1, ez), cv.P(0, y1, Hh)]
        tri_in = [cv.P(1 - 0.1, y1 - 0.05, ez + 2), cv.P(-1 + 0.1, y1 - 0.05, ez + 2), cv.P(0, y1 - 0.05, Hh - 4)]
        q += [cv.face(tri[1], (tri[0][0] - tri[1][0], tri[0][1] - tri[1][1]), (0, -(Hh - ez) * SS), tex_planks(120, 140, seed, board=6, vertical=True), "wood", 0.0, clip=tri_in)]
        pf = cv.P(1 + o, y0, ez); ev_f = (pf[0] - p0[0], pf[1] - p0[1])
        q += [cv.face(p0, eu, ev_f, tex_thatch(260, 120, seed + 1), rp, 0.6)]
        a, b = cv.P(0, y0, Hh + 1), cv.P(0, y1, Hh + 1)
    cv.ink_edges(q)
    cv.lines([a, b], ramp("wood_dark")[1], 3.2); cv.lines([(a[0], a[1] - SS * 0.8), (b[0], b[1] - SS * 0.8)], ramp("wood_dark")[0], 1.0)
    return cv

def bed():
    # footprint 1x2 (w along x = 1, h along y = 2); headboard at -y
    return [B(-0.45, 0.45, -0.95, 0.95, 0, 9, "wood", left=planksH(4), right=planksH(4), top=flat()),
            B(-0.4, 0.4, -0.85, 0.9, 9, 14, "cloth_cream", left=flat(0.08), right=flat(0.08), top=flat(0.08)),
            B(-0.42, 0.42, -0.1, 0.92, 14, 16, "cloth_red", left=planksH(3), right=planksH(3), top=lambda w, h, s: tex_planks(w, h, s, board=5, gaps=False)),
            B(-0.3, 0.3, -0.82, -0.45, 14, 19, "snow", top=flat(0.1)),
            B(-0.5, 0.5, -1.0, -0.88, 0, 30, "wood_dark", left=planksV(5), right=planksV(5)),
            B(-0.5, 0.5, 0.86, 0.98, 0, 16, "wood_dark", left=planksV(5), right=planksV(5))]

def chest():
    return [B(-0.36, 0.36, -0.26, 0.26, 0, 16, "wood", left=planksH(5), right=planksH(5)),
            B(-0.38, 0.38, -0.28, 0.28, 16, 23, "wood", left=planksH(4), right=planksH(4), top=planksH(5)),
            B(-0.38, -0.30, -0.29, 0.29, 0, 23, "iron"), B(0.30, 0.38, -0.29, 0.29, 0, 23, "iron"),
            B(-0.07, 0.07, 0.28, 0.31, 12, 19, "gold")]

def workbench():
    # 2x1 along x; vise at +x end, tools on top
    bx = [B(-0.9, 0.9, -0.4, 0.4, 20, 25, "wood", left=planksH(5), right=planksH(5), top=lambda w, h, s: tex_planks(w, h, s, board=9))]
    for sx in (-0.8, 0.72):
        for sy in (-0.32, 0.25):
            bx.append(B(sx, sx + 0.08, sy, sy + 0.08, 0, 20, "wood_dark"))
    bx += [B(-0.85, 0.85, -0.35, 0.35, 5, 8, "wood_dark", top=planksH(4)),
           B(0.65, 0.85, -0.12, 0.12, 25, 31, "iron"),
           B(-0.5, -0.1, -0.15, 0.05, 25, 27, "iron"), B(-0.2, -0.1, -0.15, 0.25, 25, 26, "wood_dark"),
           B(0.1, 0.4, 0.05, 0.25, 25, 30, "stone")]
    return bx

def table():
    bx = [B(-0.42, 0.42, -0.42, 0.42, 18, 22, "wood", left=planksH(4), right=planksH(4), top=lambda w, h, s: tex_planks(w, h, s, board=8))]
    for sx in (-0.36, 0.28):
        for sy in (-0.36, 0.28): bx.append(B(sx, sx + 0.08, sy, sy + 0.08, 0, 18, "wood_dark"))
    bx += [B(-0.08, 0.08, -0.08, 0.08, 22, 28, "cloth_teal"), B(0.15, 0.27, -0.25, -0.13, 22, 26, "cloth_cream")]
    return bx

def chair():
    bx = [B(-0.25, 0.25, -0.25, 0.25, 12, 15, "wood", left=planksH(3), right=planksH(3), top=planksH(4))]
    for sx in (-0.23, 0.17):
        for sy in (-0.23, 0.17): bx.append(B(sx, sx + 0.06, sy, sy + 0.06, 0, 12, "wood_dark"))
    bx += [B(-0.25, 0.25, -0.29, -0.23, 15, 32, "wood_dark", left=planksV(3), right=planksV(3))]
    return bx

def planter():
    bx = [B(-0.4, 0.4, -0.2, 0.2, 0, 9, "wood", left=planksH(3), right=planksH(3), top=flat())]
    return bx, [(-1, lambda cv, r, m: toon_at(cv, 0.0, 0.0, 9, r, m, flowers_in_box))]

def campfire_frame(i, n=6, stage=0, lit=True):
    from fx import fire
    cv = Canvas(128, 128, seed=5)
    cx, cy = 64, 96
    import math as m_
    stones = [(m_.cos(a) * 19, m_.sin(a) * 9.5) for a in [k * 2 * m_.pi / 9 + 0.2 for k in range(9)]]
    back = [s for s in stones if s[1] < 0]; front = [s for s in stones if s[1] >= 0]
    for (dx, dy) in back: cv.part(ellipse_pts(cx + dx, cy + dy - 2, 4.2, 3.2, n=10, wob=0.1, seed=int(dx * 10)), "stone", lw=1.0, shade=0.3, hl=0.2)
    cv.part(ellipse_pts(cx, cy, 15, 7, n=30), "dirt", lw=0.6, shade=0.1, hl=0, base_col=ramp("wood_dark")[3], shade_col=ramp("ink")[3])
    logc = "bark" if stage < 3 else "ink"
    for (x0, y0, x1, y1) in [(-13, 3, 10, -7), (-10, -7, 13, 3), (-2, -10, 1, 5)]:
        cv.part(capsule_pts(cx + x0, cy + y0 - 3, cx + x1, cy + y1 - 3, 3.4, 2.8), logc, lw=0.9, shade=0.35, hl=0.25)
    if lit:
        fl = fire(i, n, 48, 48)
        cv.paste(fl.resize((60 * SS, 60 * SS), Image.LANCZOS), cx - 30, cy - 58)
    elif stage < 3:
        for k in range(4): cv.fill(ellipse_pts(cx - 4 + k * 3, cy - 4 + (k % 2), 1.3, 1, n=10), ramp("fire")[2])
    for (dx, dy) in front: cv.part(ellipse_pts(cx + dx, cy + dy - 2, 4.4, 3.3, n=10, wob=0.1, seed=int(dx * 10)), "stone", lw=1.0, shade=0.3, hl=0.2)
    return cv

def torch_frame(i, n=4):
    from fx import fire
    cv = Canvas(128, 128, seed=7); cx, cy = 64, 96
    cv.part(capsule_pts(cx, cy, cx, cy - 34, 1.8, 1.6), "wood_dark", lw=1.0, shade=0.3, hl=0.2)
    cv.part(ellipse_pts(cx, cy - 36, 4.5, 3.5, n=20), "iron", lw=1.0, shade=0.3, hl=0.2)
    cv.part(capsule_pts(cx - 3, cy - 34, cx + 3, cy - 34, 1.2), "leather", lw=0.7, shade=0.3, hl=0.2)
    fl = fire((i * 3) % 6, 6, 32, 32).resize((24 * SS, 24 * SS), Image.LANCZOS)
    cv.paste(fl, cx - 12, cy - 59)
    return cv
