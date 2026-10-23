"""32x32 item & equipment icons (drawn at 4x on a 32 canvas). Thick soft outline + tiny drop shadow."""
import zlib
import math, numpy as np
from PIL import Image
from toon import Canvas, ellipse_pts, capsule_pts, SS, lerp
from palette import ramp, hex2rgb

def C(x, y, r, ry=None, rot=0, wob=0.04, seed=0, n=36): return ellipse_pts(x, y, r, ry or r, rot, n=n, wob=wob, seed=seed)
def P(cv, pts, rp, **k): k.setdefault("lw", 1.25); k.setdefault("shade", 0.28); k.setdefault("hl", 0.2); return cv.part(pts, rp, **k)
def rot_pts(pts, cx, cy, a):
    ca, sa = math.cos(a), math.sin(a); return [(cx + (x - cx) * ca - (y - cy) * sa, cy + (x - cx) * sa + (y - cy) * ca) for x, y in pts]

def icon_shadow(cv): cv.shadow(16, 27.5, 9, 2.2, alpha=0.22)

def wood(cv):
    icon_shadow(cv)
    for (y, dx) in [(21, 1), (14, -1)]:
        P(cv, capsule_pts(6 + dx, y, 24 + dx, y - 4, 4.2), "bark")
        P(cv, C(25 + dx, y - 4, 3.3, 3.8, wob=0.02), "wood", hl=0.1)
        cv.line([(23.6 + dx, y - 5), (25.4 + dx, y - 3)], ramp("wood")[2], 0.5)
        cv.line([(10 + dx, y - 2.5), (17 + dx, y - 4)], ramp("bark")[2], 0.6)

def stone(cv):
    icon_shadow(cv)
    P(cv, [(5, 22), (8, 12), (16, 7), (24, 10), (27, 20), (21, 26), (10, 26)], "stone", gloss=[(12, 12, 2.5, 1.5)])
    cv.line([(16, 8), (14, 17), (22, 21)], ramp("stone")[2], 0.6)

def fiber(cv):
    icon_shadow(cv)
    for i, a in enumerate((-0.5, -0.2, 0.15, 0.45)):
        pts = rot_pts([(15, 27), (13.6, 15), (16, 4), (18.2, 15), (17, 27)], 16, 26, a)
        P(cv, pts, "grass" if i % 2 else "cloth_green", lw=1.0)
    P(cv, capsule_pts(11, 20, 21, 20, 1.8), "thatch", lw=1.0)

def flint(cv):
    icon_shadow(cv)
    P(cv, [(8, 24), (11, 10), (19, 5), (25, 14), (22, 25)], "ink", base_col=(90, 80, 110), shade_col=(60, 52, 80), hl_col=(170, 160, 200), gloss=[(15, 11, 2, 1)])
    cv.line([(12, 12), (17, 20), (21, 13)], (130, 120, 160), 0.6)

def iron_ore(cv):
    icon_shadow(cv)
    P(cv, [(5, 21), (9, 10), (17, 7), (25, 11), (27, 21), (19, 26), (9, 26)], "cobble")
    for (x, y, r) in [(12, 14, 2.8), (19, 18, 2.4), (14, 21, 1.8), (21, 11, 1.6)]:
        P(cv, C(x, y, r, r * 0.8, n=6, wob=0), "leaf_autumn", lw=0.7)

def iron_ingot(cv):
    icon_shadow(cv)
    P(cv, [(5, 22), (9, 14), (24, 14), (27, 22)], "iron", shade=0.35)
    P(cv, [(9, 14), (12, 9), (21, 9), (24, 14)], "iron", base_col=ramp("iron")[0], hl=0.1)
    cv.fill(C(14, 11, 3, 0.8, wob=0), (255, 255, 255), alpha=200)

def berries(cv):
    icon_shadow(cv)
    for (x, y) in [(11, 19), (19, 20), (15, 13), (21, 13), (13, 25) if False else (16, 23)]:
        P(cv, C(x, y, 4.2, wob=0.02), "berry", lw=1.1, gloss=[(x - 1.4, y - 1.5, 1.2, 0.9)])
    P(cv, C(17, 7, 4, 1.8, rot=-0.4), "leaf", lw=1.0)
    cv.line([(16, 9), (15, 12)], ramp("leaf")[3], 0.8)

def water_flask(cv):
    icon_shadow(cv)
    P(cv, C(16, 19, 8.5, 8, wob=0.02), "leather")
    m = P(cv, C(16, 20, 6, 5.6, wob=0.02), "water", lw=0.7, gloss=[(13.5, 17, 1.6, 2)])
    P(cv, [(13, 6), (19, 6), (19, 11), (13, 11)], "wood", lw=1.0)
    P(cv, [(12.5, 4), (19.5, 4), (19.5, 6.5), (12.5, 6.5)], "wood_dark", lw=1.0)
    cv.line([(8, 13), (24, 13)], ramp("leather")[3], 0.8)

def axe(cv, head="stone"):
    icon_shadow(cv)
    P(cv, capsule_pts(8, 27, 22, 5, 1.9), "wood", lw=1.1)
    if head == "stone":
        P(cv, [(15, 6), (24, 3), (28, 10), (25, 16), (17, 12)], "stone", gloss=[(22, 6, 1.8, 1)])
        P(cv, capsule_pts(15, 9, 21, 12, 1.6), "thatch", lw=0.9)
    else:
        P(cv, [(15, 5), (22, 6), (27, 3), (29, 13), (24, 15), (17, 12)], "iron", gloss=[(25, 6, 1.5, 2.5)])
        P(cv, C(17.5, 9, 2, wob=0), "wood_dark", lw=0.8)

def pickaxe(cv, head="stone"):
    icon_shadow(cv)
    P(cv, capsule_pts(9, 27, 21, 8, 1.9), "wood", lw=1.1)
    rp = "stone" if head == "stone" else "iron"
    P(cv, [(4, 11), (10, 5), (19, 4), (27, 8), (28, 12), (20, 9), (12, 9), (6, 14)], rp, gloss=[(14, 6, 2.5, 0.9)])
    if head == "stone": P(cv, capsule_pts(17, 6, 21, 11, 1.4), "thatch", lw=0.9)

def campfire_kit(cv):
    icon_shadow(cv)
    for (x, y) in [(8, 23), (24, 23), (16, 26)]: P(cv, C(x, y, 3.5, 2.6), "stone", lw=1.0)
    P(cv, capsule_pts(7, 20, 24, 12, 2.6), "bark", lw=1.0); P(cv, capsule_pts(8, 12, 25, 20, 2.6), "bark", lw=1.0)
    P(cv, [(16, 5), (20, 11), (19, 17), (13, 17), (12, 11)], "fire", lw=0.9, shade=0.35)
    P(cv, [(16, 10), (18, 14), (14, 14)], "fire", lw=0, outline=False, base_col=ramp("fire")[0])

def workbench_kit(cv):
    icon_shadow(cv)
    P(cv, [(5, 13), (16, 8), (27, 13), (16, 18)], "wood", base_col=ramp("wood")[0])
    P(cv, [(5, 13), (16, 18), (16, 21), (5, 16)], "wood"); P(cv, [(16, 18), (27, 13), (27, 16), (16, 21)], "wood", base_col=ramp("wood")[2])
    for x in (7, 15, 25): P(cv, capsule_pts(x, 17, x, 26, 1.4), "wood_dark", lw=0.9)
    P(cv, capsule_pts(10, 11, 18, 8, 1.0), "iron", lw=0.8)

def sword(cv):
    icon_shadow(cv)
    P(cv, [(20, 3), (25, 6), (14, 20), (11, 17)], "iron", gloss=[(21, 6, 1.2, 2)])
    P(cv, capsule_pts(8, 15, 17, 24, 1.6), "gold", lw=1.0)
    P(cv, capsule_pts(6, 26, 11, 21, 1.8), "leather", lw=1.0)
    P(cv, C(5.5, 26.5, 2, wob=0), "gold", lw=0.8)

def spear(cv):
    icon_shadow(cv)
    P(cv, capsule_pts(5, 27, 23, 9, 1.5), "wood", lw=1.0)
    P(cv, [(21, 11), (24, 3), (29, 1), (27, 7), (23, 13)], "stone")
    P(cv, capsule_pts(19, 11, 23, 15, 1.4), "thatch", lw=0.8)

def club(cv):
    icon_shadow(cv)
    P(cv, capsule_pts(8, 26, 21, 9, 2.0, 4.8), "wood", lw=1.1)
    for (x, y) in [(20, 7), (24, 11), (18, 13)]: P(cv, C(x, y, 1.3, wob=0), "iron", lw=0.6)

def shield(cv):
    icon_shadow(cv)
    m = P(cv, [(6, 6), (16, 3), (26, 6), (25, 17), (16, 28), (7, 17)], "wood")
    cv.line([(16, 4), (16, 27)], ramp("wood")[2], 0.8, clip=m); cv.line([(11, 5), (11, 22)], ramp("wood")[2], 0.6, clip=m); cv.line([(21, 5), (21, 22)], ramp("wood")[2], 0.6, clip=m)
    P(cv, C(16, 14, 3.6, wob=0), "iron", lw=0.9, gloss=[(15, 13, 1, 1)])

def helmet(cv):
    icon_shadow(cv)
    pts = [(5, 21)] + [(16 + math.cos(math.pi + t / 16 * math.pi) * 11, 20 + math.sin(math.pi + t / 16 * math.pi) * 12) for t in range(17)] + [(27, 21)]
    m = P(cv, pts, "leather", gloss=[(11, 12, 2.5, 1.5)])
    P(cv, capsule_pts(5, 21, 27, 21, 2.2), "leather", base_col=ramp("leather")[2], lw=1.0)
    for x in (10, 16, 22): P(cv, C(x, 21, 0.9, wob=0), "gold", lw=0.5)
    P(cv, C(22, 8, 1.8, 3.6, rot=0.6), "cloth_red", lw=0.8)

def armor_chest(cv):
    icon_shadow(cv)
    m = P(cv, [(6, 8), (11, 5), (16, 8), (21, 5), (26, 8), (28, 15), (23, 15), (23, 27), (9, 27), (9, 15), (4, 15)], "leather")
    cv.line([(16, 8), (16, 27)], ramp("leather")[3], 0.7, clip=m)
    for y in (13, 18, 23): P(cv, C(16, y, 1.0, wob=0), "gold", lw=0.5)
    cv.line([(9, 21), (23, 21)], ramp("leather")[2], 1.0, clip=m)

def boots(cv):
    icon_shadow(cv)
    for dx in (0, 9):
        P(cv, [(6 + dx, 6), (12 + dx, 6), (12 + dx, 19), (16 + dx, 22), (16 + dx, 26), (5 + dx, 26)], "leather", lw=1.0)
        P(cv, capsule_pts(5 + dx, 8, 13 + dx, 8, 1.8), "cloth_cream", lw=0.8)

def mushroom(cv):
    icon_shadow(cv)
    P(cv, capsule_pts(16, 26, 16, 15, 3.4, 3.0), "cloth_cream")
    pts = [(5, 17)] + [(16 + math.cos(math.pi + t / 16 * math.pi) * 11.5, 17 + math.sin(math.pi + t / 16 * math.pi) * 10) for t in range(17)] + [(27, 17), (16, 19)]
    m = P(cv, pts, "mush_red")
    for (x, y, r) in [(11, 11, 1.8), (18, 9, 1.5), (22, 14, 1.3), (14, 15, 1.1)]: cv.fill(C(x, y, r, wob=0), (255, 248, 240), clip=m)

def cooked_meat(cv):
    icon_shadow(cv)
    P(cv, capsule_pts(19, 15, 26, 8, 1.8), "cloth_cream", lw=1.0)
    P(cv, C(26.5, 6.5, 2.4, wob=0.1), "cloth_cream", lw=0.9)
    P(cv, C(13, 18, 9, 7.5, rot=-0.6, wob=0.08), "brick", base_col=ramp("leaf_autumn")[3], shade_col=ramp("wood_dark")[2], hl_col=ramp("leaf_autumn")[1], gloss=[(10, 15, 2.5, 1.2)])
    for k in range(3): cv.line([(8 + k * 4, 21 - k), (12 + k * 4, 15 - k)], ramp("wood_dark")[3], 0.6, alpha=160)

def apple(cv):
    icon_shadow(cv)
    P(cv, C(16, 18, 9, 8.5, wob=0.03), "berry", gloss=[(12, 14, 2.4, 1.8)])
    cv.line([(16, 10), (17, 5)], ramp("bark")[2], 1.2)
    P(cv, C(20.5, 7, 3.5, 1.8, rot=-0.4), "leaf", lw=0.9)

def carrot(cv):
    icon_shadow(cv)
    P(cv, [(9, 10), (16, 7), (22, 12), (8, 27)], "leaf_autumn")
    for k in range(3): cv.line([(10 + k * 2.5, 14 + k * 4), (14 + k * 2, 14 + k * 4)], ramp("leaf_autumn")[2], 0.6)
    for a in (-0.4, 0.0, 0.4): P(cv, rot_pts([(16, 8), (15, 1), (17.5, 1), (17, 8)], 16, 8, a + 0.5), "leaf", lw=0.8)

def bandage(cv):
    icon_shadow(cv)
    P(cv, C(16, 17, 9, 7, wob=0.02), "cloth_cream")
    P(cv, C(16, 17, 3.2, 2.5, wob=0.02), "cloth_cream", base_col=ramp("cloth_cream")[2])
    P(cv, [(22, 18), (29, 22), (27, 26), (21, 22)], "cloth_cream", lw=1.0)
    cv.fill([(8, 12), (11, 12), (11, 15), (8, 15)], ramp("berry")[1])

ITEMS = [("wood", wood), ("stone", stone), ("fiber", fiber), ("flint", flint), ("iron_ore", iron_ore), ("iron_ingot", iron_ingot),
         ("berries", berries), ("water_flask", water_flask), ("mushroom", mushroom), ("cooked_meat", cooked_meat), ("apple", apple),
         ("carrot", carrot), ("bandage", bandage), ("campfire_kit", campfire_kit), ("workbench_kit", workbench_kit)]
EQUIPMENT = [("stone_axe", lambda c: axe(c, "stone")), ("stone_pickaxe", lambda c: pickaxe(c, "stone")), ("sword", sword), ("shield", shield),
             ("iron_axe", lambda c: axe(c, "iron")), ("iron_pickaxe", lambda c: pickaxe(c, "iron")), ("spear", spear), ("club", club),
             ("helmet_leather", helmet), ("armor_leather", armor_chest), ("boots_leather", boots)]

def render_icon(fn, seed=1):
    cv = Canvas(32, 32, seed=seed); fn(cv); return cv.final()

def _icon(key):
    d = dict(ITEMS + EQUIPMENT); return render_icon(d[key], seed=zlib.crc32(key.encode()) % 97)

# ---------------------------------------------------------------- wave 2 icons (keys = gameplay items.json keys where they exist)
def ore_icon(rp, base="cobble"):
    def f(cv):
        icon_shadow(cv)
        P(cv, [(5, 21), (9, 10), (17, 7), (25, 11), (27, 21), (19, 26), (9, 26)], base)
        for (x, y, r) in [(12, 14, 2.8), (19, 18, 2.4), (14, 21, 1.8), (21, 11, 1.6)]:
            P(cv, C(x, y, r, r * 0.8, n=6, wob=0), rp, lw=0.7, gloss=[(x - r * 0.3, y - r * 0.3, r * 0.3, r * 0.25)])
    return f

def ingot_icon(rp, stack=False):
    def f(cv):
        icon_shadow(cv)
        for k in ([1, 0] if stack else [0]):
            dy = -k * 6; dx = k * 1
            P(cv, [(5 + dx, 22 + dy), (9 + dx, 14 + dy), (24 + dx, 14 + dy), (27 + dx, 22 + dy)], rp, shade=0.35)
            P(cv, [(9 + dx, 14 + dy), (12 + dx, 9 + dy), (21 + dx, 9 + dy), (24 + dx, 14 + dy)], rp, base_col=ramp(rp)[0], hl=0.1)
            cv.fill(C(14 + dx, 11 + dy, 3, 0.8, wob=0), (255, 255, 255), alpha=200)
    return f

def plate_icon(rp, rivets=True):
    def f(cv):
        icon_shadow(cv)
        P(cv, [(4, 17), (16, 10), (28, 15), (16, 23)], rp, base_col=ramp(rp)[0], gloss=[(13, 14, 3, 1)])
        P(cv, [(4, 17), (16, 23), (16, 26), (4, 20)], rp); P(cv, [(16, 23), (28, 15), (28, 18), (16, 26)], rp, base_col=ramp(rp)[2])
        if rivets:
            for (x, y) in [(8, 17), (16, 13), (24, 15), (16, 20)]: cv.fill(C(x, y, 0.9, wob=0), ramp(rp)[3])
    return f

def logs_icon(rp_bark, rp_wood):
    def f(cv):
        icon_shadow(cv)
        for (y, dx) in [(21, 1), (14, -1)]:
            P(cv, capsule_pts(6 + dx, y, 24 + dx, y - 4, 4.2), rp_bark)
            P(cv, C(25 + dx, y - 4, 3.3, 3.8, wob=0.02), rp_wood, hl=0.1)
            for rr in (1.2, 2.3): cv.line([(25 + dx + rr * math.cos(a), y - 4 + rr * 1.1 * math.sin(a)) for a in np.linspace(0, 6.2, 12)], ramp(rp_wood)[2], 0.4)
    return f

def planks_icon(rp):
    def f(cv):
        icon_shadow(cv)
        for k in range(3):
            y = 22 - k * 5; x = 5 + k
            P(cv, [(x, y), (x + 19, y - 6), (x + 22, y - 4), (x + 3, y + 2)], rp, base_col=ramp(rp)[0 if k == 2 else 1])
            cv.line([(x + 5, y - 1), (x + 15, y - 4)], ramp(rp)[2], 0.45)
    return f

def sticks(cv):
    icon_shadow(cv)
    for (x0, y0, x1, y1) in [(6, 25, 25, 7), (9, 26, 22, 6), (5, 20, 27, 14)]: P(cv, capsule_pts(x0, y0, x1, y1, 1.4), "bark", lw=0.9)
    P(cv, capsule_pts(12, 18, 19, 15, 1.6), "thatch", lw=0.8)

def clay(cv):
    icon_shadow(cv)
    P(cv, C(16, 19, 10, 7.5, wob=0.08, seed=2), "clay", gloss=[(12, 15, 3, 1.3)])
    for k in range(2): cv.line([(10 + k * 4, 20 + k), (14 + k * 4, 22 + k)], ramp("clay")[2], 0.6)

def sand(cv):
    icon_shadow(cv)
    P(cv, [(4, 25), (11, 14), (16, 10), (22, 14), (28, 25)], "sand")
    for (x, y) in [(12, 19), (17, 15), (21, 21), (15, 23)]: cv.fill(C(x, y, 0.6, wob=0), ramp("sand")[3])

def hide(cv):
    icon_shadow(cv)
    m = P(cv, [(6, 8), (12, 10), (16, 6), (20, 10), (26, 8), (24, 16), (27, 24), (20, 23), (16, 27), (12, 23), (5, 24), (8, 16)], "hide")
    for (x, y, r) in [(12, 15, 2), (19, 18, 2.4), (15, 21, 1.4)]: cv.fill(C(x, y, r, r * 0.7, wob=0.2), ramp("hide")[2], clip=m)

def coal(cv):
    icon_shadow(cv)
    for (x, y, r) in [(11, 20, 6), (20, 19, 5.5), (16, 13, 5)]:
        P(cv, C(x, y, r, r * 0.85, n=7, wob=0.05), "hair_black", gloss=[(x - 1.5, y - 2, 1.2, 0.8)])

def charcoal(cv):
    icon_shadow(cv)
    for (y, dx) in [(22, 0), (15, 2)]:
        P(cv, capsule_pts(6 + dx, y, 24 + dx, y - 4, 3.6), "hair_black")
        for k in range(3): cv.line([(9 + dx + k * 5, y - 2 - k), (11 + dx + k * 5, y + 1 - k)], ramp("fire")[2], 0.5, alpha=180)

def rope(cv):
    icon_shadow(cv)
    for r in (9, 6, 3):
        P(cv, C(16, 17, r, r * 0.75, wob=0.02), "thatch", lw=0.9 if r == 9 else 0.6)
    P(cv, capsule_pts(22, 19, 28, 26, 1.4), "thatch", lw=0.8)

def cloth(cv):
    icon_shadow(cv)
    P(cv, [(5, 12), (24, 7), (27, 21), (8, 26)], "cloth_cream", gloss=[(12, 12, 3, 1)])
    P(cv, [(5, 12), (24, 7), (24, 10), (6, 15)], "cloth_cream", base_col=ramp("cloth_cream")[2])
    for k in range(3): cv.line([(9 + k * 5, 14 - k), (12 + k * 5, 24 - k)], ramp("cloth_cream")[2], 0.4)

def leather(cv):
    icon_shadow(cv)
    m = P(cv, [(5, 11), (23, 6), (27, 21), (9, 26)], "leather", gloss=[(12, 12, 3, 1)])
    for k in range(6): cv.fill(C(8 + k * 3.2, 11.5 - k * 0.8, 0.5, wob=0), ramp("cloth_cream")[1])

def brick_icon(rp):
    def f(cv):
        icon_shadow(cv)
        for (dx, dy) in [(0, 0), (8, -4), (4, -9)] if rp != "stone" else [(0, 0), (8, -4)]:
            P(cv, [(6 + dx, 22 + dy), (14 + dx, 18 + dy), (21 + dx, 21 + dy), (13 + dx, 25 + dy)], rp, base_col=ramp(rp)[0])
            P(cv, [(6 + dx, 22 + dy), (13 + dx, 25 + dy), (13 + dx, 28 + dy), (6 + dx, 25 + dy)], rp)
            P(cv, [(13 + dx, 25 + dy), (21 + dx, 21 + dy), (21 + dx, 24 + dy), (13 + dx, 28 + dy)], rp, base_col=ramp(rp)[2])
    return f

def mortar(cv):
    icon_shadow(cv)
    P(cv, C(16, 21, 11, 5.5, wob=0.02), "wood")
    P(cv, C(16, 19, 9, 3.6, wob=0.08), "cobble", base_col=ramp("cloth_cream")[2], gloss=[(13, 18, 2.5, 0.8)])
    P(cv, [(19, 18), (27, 6), (29, 8), (21, 19)], "iron", lw=0.8)

def nails(cv):
    icon_shadow(cv)
    for (x, y, a) in [(10, 22, -0.4), (16, 20, 0.2), (21, 23, 0.6)]:
        pts = rot_pts([(x - 0.9, y - 12), (x + 0.9, y - 12), (x + 0.9, y), (x, y + 2.5), (x - 0.9, y)], x, y, a)
        P(cv, pts, "iron", lw=0.8)
        hx, hy = rot_pts([(x, y - 12)], x, y, a)[0]
        P(cv, C(hx, hy, 2.6, 1.1, rot=a, wob=0), "iron", lw=0.7)

def glass(cv):
    icon_shadow(cv)
    m = P(cv, [(7, 6), (25, 6), (25, 26), (7, 26)], "glass", gloss=[(11, 10, 1.5, 4)])
    cv.line([(18, 9), (22, 13)], (255, 255, 255), 0.8, clip=m); cv.line([(10, 19), (14, 23)], (255, 255, 255), 0.6, clip=m)

def dye(cv):
    icon_shadow(cv)
    P(cv, C(16, 20, 8, 7, wob=0.02), "glass", base_col=ramp("glass")[0])
    for (rp, dx) in [("cloth_red", -3), ("cloth_blue", 2), ("cloth_yellow", -0.5)]:
        P(cv, C(16 + dx, 22 - abs(dx) * 0.3, 3.4, 2.4, wob=0.1), rp, lw=0.5)
    P(cv, [(13, 8), (19, 8), (19, 13), (13, 13)], "wood", lw=0.8)

def raw_meat(cv):
    icon_shadow(cv)
    P(cv, capsule_pts(19, 15, 26, 8, 1.8), "cloth_cream", lw=1.0)
    P(cv, C(26.5, 6.5, 2.4, wob=0.1), "cloth_cream", lw=0.9)
    m = P(cv, C(13, 18, 9, 7.5, rot=-0.6, wob=0.08), "berry", base_col=ramp("flower_pink")[2], gloss=[(10, 15, 2.5, 1.2)])
    cv.line([(8, 20), (12, 16), (17, 15)], ramp("cloth_cream")[1], 0.8, clip=m)

def rot(cv):
    icon_shadow(cv)
    P(cv, C(16, 20, 9, 6.5, wob=0.15, seed=5), "frog", base_col=ramp("wood_dark")[1], shade_col=ramp("wood_dark")[3], hl_col=ramp("frog")[2])
    for (x, y) in [(12, 9), (20, 7)]: P(cv, C(x, y, 2.2, wob=0.2), "smoke", lw=0.6)
    for (x, y) in [(11, 19), (19, 18)]: cv.fill(C(x, y, 1.2, wob=0), ramp("frog")[1])

def shovel(cv):
    icon_shadow(cv)
    P(cv, capsule_pts(22, 5, 12, 20, 1.6), "wood", lw=1.0)
    P(cv, capsule_pts(20, 4, 25, 7, 1.4), "wood_dark", lw=0.8)
    P(cv, [(13, 17), (7, 21), (5, 28), (11, 27), (16, 21)], "stone", gloss=[(9, 22, 1, 1.5)])
    P(cv, capsule_pts(12, 18, 15, 21, 1.3), "thatch", lw=0.7)

def knife(cv):
    icon_shadow(cv)
    P(cv, [(14, 16), (24, 4), (27, 6), (18, 19)], "stone", gloss=[(22, 8, 0.8, 2)])
    P(cv, capsule_pts(7, 26, 15, 18, 2.0), "leather", lw=1.0)

def sword_of(rp):
    def f(cv):
        icon_shadow(cv)
        P(cv, [(20, 3), (25, 6), (14, 20), (11, 17)], rp, gloss=[(21, 6, 1.2, 2)])
        P(cv, capsule_pts(8, 15, 17, 24, 1.6), "gold" if rp != "copper" else "leather", lw=1.0)
        P(cv, capsule_pts(6, 26, 11, 21, 1.8), "leather", lw=1.0)
        P(cv, C(5.5, 26.5, 2, wob=0), "gold", lw=0.8)
    return f

def bow_icon(cv):
    icon_shadow(cv)
    pts = [(9 + 13 * math.sin(t * math.pi) * 0.5, 4 + t * 23) for t in np.linspace(0, 1, 12)]
    for a, b in zip(pts, pts[1:]): P(cv, capsule_pts(a[0], a[1], b[0], b[1], 1.6), "wood", lw=0.9)
    cv.line([pts[0], pts[-1]], ramp("cloth_cream")[1], 0.6)
    P(cv, capsule_pts(13, 14, 13, 18, 2), "leather", lw=0.8)

def arrow(cv):
    icon_shadow(cv)
    P(cv, capsule_pts(6, 26, 24, 8, 0.9), "wood", lw=0.8)
    P(cv, [(22, 7), (28, 3), (25, 10)], "stone", lw=0.8)
    for d in (-1, 1): P(cv, [(6, 26), (6 + d * 3.5, 25 - d * 0.5), (10, 21), (8, 24)], "cloth_red", lw=0.6)

def torch_item(cv):
    icon_shadow(cv)
    P(cv, capsule_pts(12, 27, 19, 11, 1.8), "wood_dark", lw=1.0)
    P(cv, C(19.5, 10, 3.4, 2.6, rot=-0.4), "leather", lw=0.8)
    P(cv, [(20, 1), (25, 7), (23, 11), (17, 11), (16, 6)], "fire", lw=0.8, shade=0.3, base_col=ramp("fire")[2], hl_col=ramp("fire")[0])
    P(cv, [(20, 5), (22, 9), (18, 9)], "fire", outline=False, base_col=ramp("fire")[0])

def pumpkin(cv):
    icon_shadow(cv)
    m = P(cv, C(16, 19, 11, 8.5, wob=0.03), "pumpkin", gloss=[(11, 15, 2.5, 1.5)])
    for dx in (-6, -2, 2, 6): cv.line([(16 + dx * 0.6, 11), (16 + dx * 1.3, 19), (16 + dx * 0.6, 27)], ramp("pumpkin")[2], 0.6, clip=m)
    P(cv, capsule_pts(16, 11, 18, 5, 1.6, 1.1), "bark", lw=0.8)
    P(cv, C(22, 7, 3, 1.6, rot=-0.4), "leaf", lw=0.7)

def blueberries(cv):
    icon_shadow(cv)
    for (x, y) in [(11, 19), (19, 20), (15, 13), (21, 13), (16, 23)]:
        P(cv, C(x, y, 4.0, wob=0.02), "berry_blue", lw=1.1, gloss=[(x - 1.4, y - 1.5, 1.2, 0.9)])
        cv.line([(x - 0.8, y - 2.8), (x + 0.8, y - 2.8)], ramp("berry_blue")[3], 0.5)
    P(cv, C(17, 7, 4, 1.8, rot=-0.4), "pine", lw=1.0)

def herbs(cv):
    icon_shadow(cv)
    for i, a in enumerate((-0.45, -0.15, 0.15, 0.45)):
        x0, y0 = 16, 26; x1, y1 = 16 + math.sin(a) * 16, 26 - math.cos(a) * 18
        cv.line([(x0, y0), (x1, y1)], ramp("grass")[3], 1.0)
        for t in (0.45, 0.7, 0.92): P(cv, C(x0 + (x1 - x0) * t + (1.8 if i % 2 else -1.8), y0 + (y1 - y0) * t, 2.6, 1.4, rot=a + (0.6 if i % 2 else -0.6), wob=0), "leaf", lw=0.6)
    P(cv, capsule_pts(12, 22, 20, 22, 1.4), "cloth_red", lw=0.7)

ITEMS += [("hardwood", logs_icon("wood_dark", "leaf_autumn")), ("sticks", sticks), ("planks", planks_icon("wood")), ("hardwood_planks", planks_icon("wood_dark")),
          ("clay", clay), ("sand", sand), ("hide", hide), ("copper_ore", ore_icon("copper")), ("tin_ore", ore_icon("slate", "stone")), ("coal", coal),
          ("gold_ore", ore_icon("gold")), ("rope", rope), ("cloth", cloth), ("leather", leather), ("stone_brick", brick_icon("stone")), ("clay_brick", brick_icon("brick")),
          ("mortar", mortar), ("charcoal", charcoal), ("copper_ingot", ingot_icon("copper")), ("tin_ingot", ingot_icon("slate")), ("bronze_ingot", ingot_icon("leaf_autumn")),
          ("steel_ingot", ingot_icon("metal_teal")), ("gold_ingot", ingot_icon("gold")), ("nails", nails), ("iron_plate", plate_icon("iron")), ("steel_plate", plate_icon("metal_teal")),
          ("glass", glass), ("dye", dye), ("raw_meat", raw_meat), ("rot", rot), ("pumpkin", pumpkin), ("blueberries", blueberries), ("herbs", herbs), ("arrow", arrow)]
EQUIPMENT += [("stone_shovel", shovel), ("stone_knife", knife), ("bronze_axe", lambda c: axe(c, "iron") if False else _bronze(axe, c)),
              ("bronze_pickaxe", lambda c: _bronze(pickaxe, c)), ("bronze_sword", sword_of("copper")), ("iron_sword", sword_of("iron")),
              ("bow", bow_icon), ("torch", torch_item)]

def _bronze(fn, cv):
    """draw an iron tool then recolor its head from the iron ramp to bronze."""
    fn(cv, "iron")
    a = np.asarray(cv.img).astype(np.int32).copy()
    src, dst = ramp("iron"), ramp("copper")
    for s, d in zip(src, dst):
        m = (np.abs(a[..., :3] - np.array(s)).sum(-1) < 40) & (a[..., 3] > 0)
        a[m, :3] = d
    cv.img = Image.fromarray(a.astype(np.uint8))
