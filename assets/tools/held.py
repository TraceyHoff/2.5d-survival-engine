"""In-world held equipment: one sprite per tool, 8 baked facings (+ 4 flame frames for the torch).
Frame 48x48, pivot = grip point (24, 36) -> anchor (0.5, 0.75). Tools are drawn pointing UP from the grip; the renderer
attaches the pivot to the character's per-frame hand anchor and rotates by hand.angle (deg, clockwise from up)."""
import math
from toon import Canvas, ellipse_pts, capsule_pts, SS
from palette import ramp
from chars import DIR_PHI

GX, GY = 24, 36
def C(x, y, r, ry=None, rot=0, wob=0.03, n=24): return ellipse_pts(x, y, r, ry or r, rot, n=n, wob=wob, seed=3)
def P(cv, pts, rp, **k): k.setdefault("lw", 1.0); k.setdefault("shade", 0.3); k.setdefault("hl", 0.22); return cv.part(pts, rp, **k)

def facing(d):
    phi = math.radians(DIR_PHI[d]); s = math.sin(phi)
    side = 1 if s >= 0 else -1          # which screen side the "business end" points to
    w = max(0.38, abs(s))               # foreshortening of flat heads when seen edge-on
    away = math.cos(phi) < -0.3         # facing away from camera -> slightly shaded
    return side, w, away

def handle(cv, L, rp="wood", r=1.6, below=4):
    P(cv, capsule_pts(GX, GY + below, GX, GY - L, r, r * 0.9), rp, lw=0.9)
    cv.line([(GX - 0.5, GY + below - 1), (GX - 0.5, GY - L + 2)], ramp(rp)[0], 0.5, alpha=150)
    P(cv, capsule_pts(GX, GY - 1.5, GX, GY + 2.5, r + 0.5), "leather", lw=0.8)   # grip wrap

def axe(cv, d, mat):
    side, w, away = facing(d); handle(cv, 22)
    hx, hy = GX, GY - 19; rp = {"stone": "stone", "bronze": "copper", "iron": "iron"}[mat]
    blade = [(hx, hy - 3), (hx + side * 7 * w, hy - 6.5), (hx + side * 9.5 * w, hy - 1), (hx + side * 7.5 * w, hy + 5), (hx, hy + 3)]
    P(cv, blade, rp, gloss=[(hx + side * 5 * w, hy - 3, 1.2, 0.8)])
    cv.line([(hx + side * 8.8 * w, hy - 5), (hx + side * 9.8 * w, hy - 0.5), (hx + side * 8 * w, hy + 4)], ramp(rp)[0], 0.6)
    if mat == "stone": P(cv, capsule_pts(GX - 2, hy - 1, GX + 2, hy + 2, 1.4), "thatch", lw=0.7)
    else: P(cv, C(GX, hy, 1.6, wob=0), "wood_dark", lw=0.6)
    if mat != "stone": P(cv, [(hx, hy - 2), (hx - side * 3.5 * w, hy - 1), (hx - side * 3.5 * w, hy + 1.5), (hx, hy + 2)], rp, lw=0.8)

def pickaxe(cv, d, mat):
    side, w, away = facing(d); handle(cv, 22)
    hx, hy = GX, GY - 20; rp = {"stone": "stone", "bronze": "copper", "iron": "iron"}[mat]
    head = [(hx - side * 11 * w, hy + 5), (hx - side * 6 * w, hy - 1.5), (hx, hy - 3), (hx + side * 6 * w, hy - 1.5), (hx + side * 11 * w, hy + 5),
            (hx + side * 5 * w, hy + 1), (hx, hy + 0.5), (hx - side * 5 * w, hy + 1)]
    P(cv, head, rp, gloss=[(hx - side * 2, hy - 1.5, 1.6, 0.6)])
    if mat == "stone": P(cv, capsule_pts(GX - 1.5, hy - 1, GX + 1.5, hy + 3, 1.3), "thatch", lw=0.7)
    else: P(cv, C(GX, hy, 1.5, wob=0), "wood_dark", lw=0.6)

def spear(cv, d, mat="stone"):
    side, w, away = facing(d); handle(cv, 30, r=1.25, below=6)
    tx, ty = GX, GY - 30
    P(cv, [(tx, ty - 8), (tx + 2.8 * max(w, 0.6), ty - 1), (tx, ty + 2), (tx - 2.8 * max(w, 0.6), ty - 1)], "stone" if mat == "stone" else "iron", gloss=[(tx - 0.8, ty - 3, 0.6, 1.4)])
    P(cv, capsule_pts(tx - 1.6, ty + 2.5, tx + 1.6, ty + 4.5, 1.2), "thatch", lw=0.7)
    for k in (-1, 1): P(cv, C(tx + k * 2.2, ty + 6.5, 0.9, 2.0, rot=k * 0.4), "cloth_red", lw=0.5)   # little tassels

def club(cv, d, mat="wood"):
    side, w, away = facing(d)
    P(cv, capsule_pts(GX, GY + 4, GX + side * 1.2, GY - 18, 1.7, 4.6), "wood", lw=1.0)
    cv.line([(GX - 1, GY - 4), (GX - 0.5 + side, GY - 15)], ramp("wood")[0], 0.6, alpha=150)
    for (dx, dy) in [(-3.2, -15), (3.4, -12.5), (0.5, -19.5), (-2.4, -9.5)]: P(cv, C(GX + dx * side, GY + dy, 1.1, wob=0), "iron", lw=0.5)
    P(cv, capsule_pts(GX, GY - 1.5, GX, GY + 2.5, 2.0), "leather", lw=0.8)

def sword(cv, d, mat):
    side, w, away = facing(d); rp = {"bronze": "copper", "iron": "iron"}[mat]
    bw = 2.4 * max(w, 0.55)
    P(cv, [(GX - bw, GY - 5), (GX - bw * 0.9, GY - 22), (GX, GY - 27), (GX + bw * 0.9, GY - 22), (GX + bw, GY - 5)], rp, gloss=[(GX - bw * 0.4, GY - 16, 0.5, 4)])
    cv.line([(GX, GY - 6), (GX, GY - 24)], ramp(rp)[2], 0.5, alpha=170)
    P(cv, capsule_pts(GX - 6 * max(w, 0.5), GY - 4, GX + 6 * max(w, 0.5), GY - 4, 1.4), "gold", lw=0.8)
    P(cv, capsule_pts(GX, GY - 3, GX, GY + 3, 1.5), "leather", lw=0.8)
    P(cv, C(GX, GY + 4.2, 1.6, wob=0), "gold", lw=0.6)

def bow(cv, d, mat="wood"):
    side, w, away = facing(d)
    # bow held vertically at the grip; limbs curve away from the string (string toward the character)
    k = side * max(w, 0.35)
    pts_up = [(GX + k * (7.5 * math.sin(t * math.pi / 2)), GY - t * 18) for t in [i / 8 for i in range(9)]]
    pts_dn = [(GX + k * (7.5 * math.sin(t * math.pi / 2)), GY + t * 10) for t in [i / 6 for i in range(7)]]
    for pts in (pts_up, pts_dn):
        for a, b in zip(pts, pts[1:]): P(cv, capsule_pts(a[0], a[1], b[0], b[1], 1.5, 1.4), "wood", lw=0.8, hl=0.15)
    cv.line([pts_up[-1], (GX - k * 1.5, GY - 3), pts_dn[-1]], ramp("cloth_cream")[1], 0.6)
    P(cv, capsule_pts(GX, GY - 2, GX, GY + 2, 2.0), "leather", lw=0.8)
    for p in (pts_up[-1], pts_dn[-1]): P(cv, C(p[0], p[1], 1.2, wob=0), "cloth_red", lw=0.5)

def torch(cv, d, i=0):
    from fx import fire
    from PIL import Image
    handle(cv, 18, rp="wood_dark", r=1.5)
    P(cv, C(GX, GY - 19, 3.4, 2.6), "iron", lw=0.8)
    P(cv, capsule_pts(GX - 2.5, GY - 18.5, GX + 2.5, GY - 18.5, 1.0), "leather", lw=0.6)
    fl = fire(i, 4, 32, 32).resize((20 * SS, 20 * SS), Image.LANCZOS)
    cv.paste(fl, GX - 10, GY - 38)

HELD = [  # (sprite key, drawer, mat)  -> key = "held_" + gameplay item key
    ("stone_axe", axe, "stone"), ("bronze_axe", axe, "bronze"), ("iron_axe", axe, "iron"),
    ("stone_pickaxe", pickaxe, "stone"), ("bronze_pickaxe", pickaxe, "bronze"), ("iron_pickaxe", pickaxe, "iron"),
    ("stone_spear", spear, "stone"), ("wooden_club", club, "wood"), ("bronze_sword", sword, "bronze"), ("iron_sword", sword, "iron"),
    ("bow", bow, "wood"),
]

def render(key, d, i=0):
    cv = Canvas(48, 48, seed=5 + d)
    if key == "torch": torch(cv, d, i)
    else:
        fn, mat = {k: (f, m) for k, f, m in HELD}[key]
        fn(cv, d, mat)
    return cv.final()
