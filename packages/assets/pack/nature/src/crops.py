"""Crops (crop_<plant>_0..3 + mature crop_<plant>), farm_soil, saplings (sapling_<key>_0..2), wild_<plant> nodes,
fish_shoal and the 16 clutter_* decor sprites (ADR-110 group 2). Crop canvas 48x48, feet at (24, 40)."""
import math, numpy as np
import common  # noqa: F401
from toon import Canvas, capsule_pts, ellipse_pts
from palette import ramp
import nature
from nature import circ, scallop, trunk_poly, leaf_ticks

CW, CH, CB = 48, 56, 48

WILDMODE = [False]
def rng_(s): return np.random.default_rng(s)

# ------------------------------------------------------------------ primitives
def mound(cv, cx, base, wet=False, w=15):
    cv.shadow(cx, base, w + 1, 5, alpha=0.18)
    m = cv.part(circ(cx, base - 2, w, w * 0.37, wob=0.1, seed=3), "dirt", lw=0.9, shade=0.25, hl=0.15)
    d = ramp("dirt")
    for k in (-1, 0, 1):
        cv.line([(cx - w * 0.6, base - 2 + k * 2.4 - 0.5), (cx + w * 0.6, base - 2 + k * 2.4 + 0.5)], d[2], 0.6, clip=m, alpha=170)
    for (dx, dy) in [(-8, -1), (6, -3), (9, 0)]: cv.fill(circ(cx + dx, base + dy - 2, 0.7, wob=0), d[0], clip=m)
    return m

def leaf(cv, x, y, L, ang, rp="leaf", w=0.38, vein=True):
    """pointed leaf from (x,y) along angle (rad, 0 = right, -pi/2 = up)."""
    ca, sa = math.cos(ang), math.sin(ang); nx, ny = -sa, ca
    tip = (x + ca * L, y + sa * L); mid = (x + ca * L * 0.45, y + sa * L * 0.45)
    pts = [(x, y), (mid[0] + nx * L * w, mid[1] + ny * L * w), tip, (mid[0] - nx * L * w, mid[1] - ny * L * w)]
    m = cv.part(pts, rp, lw=0.6, shade=0.3, hl=0.25)
    if vein and L > 4: cv.line([(x, y), (x + ca * L * 0.8, y + sa * L * 0.8)], ramp(rp)[2], 0.45, clip=m, alpha=200)
    return m

def stem(cv, x0, y0, x1, y1, rp="grass", w=0.8):
    cv.line([(x0, y0), ((x0 + x1) / 2 + (x1 - x0) * 0.1, (y0 + y1) / 2), (x1, y1)], ramp(rp)[3], w)

def sprout(cv, cx, base, g, rp="leaf"):
    h = 3 + 5 * g
    stem(cv, cx, base - 2, cx, base - 2 - h, rp)
    leaf(cv, cx, base - 2 - h, 3 + 3 * g, -2.5, rp, vein=False); leaf(cv, cx, base - 2 - h, 3 + 3 * g, -0.6, rp, vein=False)

def blob(cv, x, y, r, rp, ry=None, gloss=True, lw=0.7):
    return cv.part(circ(x, y, r, ry or r, wob=0.03), rp, lw=lw, shade=0.3, hl=0.1, gloss=[(x - r * 0.35, y - r * 0.4, r * 0.3, r * 0.25)] if gloss else None)

# ------------------------------------------------------------------ plant drawers: f(cv, cx, base, g, ripe, seed)
def grain(head_rp, stalk_rp="grass", n=7, H=30, heads="ear"):
    def f(cv, cx, base, g, ripe, seed):
        r = rng_(seed)
        for i in range(n):
            x = cx + (i - (n - 1) / 2) * 3.2 + r.uniform(-1, 1); y0 = base - 2 + r.uniform(-1.5, 1.5)
            h = H * g * r.uniform(0.8, 1.05); lean = r.uniform(-3, 3) * g
            rp = ("thatch" if ripe and stalk_rp == "grass" else stalk_rp)
            stem(cv, x, y0, x + lean, y0 - h, rp, 0.9)
            leaf(cv, x + lean * 0.3, y0 - h * 0.4, 4 + 4 * g, -0.5 if i % 2 else -2.6, rp, w=0.22, vein=False)
            if g > 0.6:
                tx, ty = x + lean, y0 - h
                if heads == "ear": cv.part(circ(tx, ty - 2, 1.5, 3.6, rot=lean * 0.05, wob=0.04), head_rp if ripe or g > 0.85 else "grass", lw=0.6, shade=0.3, hl=0.2)
                elif heads == "flower" and (ripe or g > 0.85):
                    for a in range(5): cv.fill(circ(tx + math.cos(a * 1.26) * 1.4, ty + math.sin(a * 1.26) * 1.2, 1.1, wob=0), ramp(head_rp)[1])
                    cv.fill(circ(tx, ty, 0.6, wob=0), ramp("flower_yel")[0])
                elif heads == "palm":
                    for a in (-2.4, -1.57, -0.75): leaf(cv, tx, ty + 2, 5, a, stalk_rp, w=0.2, vein=False)
    return f

def corn(cv, cx, base, g, ripe, seed):
    for i, dx in enumerate((-6, 5)):
        x = cx + dx; h = 38 * g; y0 = base - 2 - (i * 1.5)
        cv.part(capsule_pts(x, y0, x + 0.8, y0 - h, 1.5, 1.0), "thatch" if ripe else "grass", lw=0.7, shade=0.3, hl=0.2)
        for k in range(int(2 + 3 * g)):
            yy = y0 - h * (0.25 + k * 0.17); s = 1 if (k + i) % 2 else -1
            leaf(cv, x, yy, 6 + 6 * g, -0.4 if s > 0 else -2.75, "thatch" if ripe else "grass", w=0.18, vein=True)
        if g > 0.75:
            cy = y0 - h * 0.52
            m = cv.part(circ(x + 2.2, cy, 1.9, 4.2, rot=0.25, wob=0.03), "gold" if (ripe or g > 0.9) else "grass", lw=0.6, shade=0.3, hl=0.2)
            leaf(cv, x + 1, cy + 3, 6, -1.2, "grass" if not ripe else "thatch", w=0.25, vein=False)
        cv.line([(x + 0.8, y0 - h), (x + 2.5, y0 - h - 4)], ramp("thatch")[2], 0.6)

def bushy(fruit_fn=None, rp="leaf", flower=None, H=14, W=11):
    def f(cv, cx, base, g, ripe, seed):
        r = rng_(seed)
        for i in range(int(4 + 6 * g)):
            a = -math.pi / 2 + r.uniform(-1.1, 1.1); x = cx + r.uniform(-W, W) * g
            leaf(cv, x, base - 2, (5 + H * 0.6 * g) * r.uniform(0.7, 1), a, rp, w=0.42)
        if flower and g > 0.7 and not ripe:
            for i in range(3): cv.fill(circ(cx + r.uniform(-8, 8), base - 6 - H * 0.7 * g + r.uniform(-2, 2), 1.2, wob=0), ramp(flower)[0])
        if fruit_fn and g > 0.85: fruit_fn(cv, cx, base, g, ripe, r)
    return f

def potato_fruit(cv, cx, base, g, ripe, r):
    if ripe:
        for (dx, dy, s) in [(-7, 0, 3.2), (5, 1, 2.8), (0, 2, 2.4)]: cv.part(circ(cx + dx, base + dy - 2, s, s * 0.75, wob=0.08), "hide", lw=0.6, shade=0.3, hl=0.2)

def roots(top="feather", root_rp="carrot", n=3, H=14):
    def f(cv, cx, base, g, ripe, seed):
        r = rng_(seed)
        for i in range(n):
            x = cx + (i - (n - 1) / 2) * 7 + r.uniform(-1, 1); y = base - 2 + (i % 2) * 1.5
            if g > 0.6:
                if root_rp in ("carrot",): cv.part([(x - 2.4, y - 1), (x + 2.4, y - 1), (x + 0.4, y + 2 + ripe * 2), (x - 0.4, y + 2 + ripe * 2)], root_rp, lw=0.6, shade=0.3, hl=0.2)
                else: cv.part(circ(x, y - 1.5 - ripe, 2.2 + ripe * 1.4, 2.0 + ripe * 1.2, wob=0.04), root_rp, lw=0.6, shade=0.3, hl=0.25)
            for a in (-0.45, 0.0, 0.45) if top != "tube" else (-0.25, 0.08, 0.3):
                L = (5 + H * g) * r.uniform(0.8, 1.05)
                ang = -math.pi / 2 + a
                if top == "feather":
                    stem(cv, x, y - 1, x + math.cos(ang) * L, y - 1 + math.sin(ang) * L, "leaf", 0.7)
                    for t in (0.5, 0.75, 1.0): cv.part(scallop(x + math.cos(ang) * L * t, y - 1 + math.sin(ang) * L * t, 1.8, 1.4, bumps=6, depth=0.25, seed=i), "leaf", lw=0.45, shade=0.3, hl=0.2)
                elif top == "tube": cv.part(capsule_pts(x, y - 2, x + math.cos(ang) * L, y - 2 + math.sin(ang) * L, 1.0, 0.5), "grass_deep", lw=0.55, shade=0.3, hl=0.25)
                elif top == "flat": leaf(cv, x, y - 1, L, ang, "cloth_green", w=0.16, vein=False)
                elif top == "palmate":
                    stem(cv, x, y - 1, x + math.cos(ang) * L * 0.6, y - 1 + math.sin(ang) * L * 0.6, "leaf", 0.6)
                    for b in (-0.6, 0, 0.6): leaf(cv, x + math.cos(ang) * L * 0.6, y - 1 + math.sin(ang) * L * 0.6, L * 0.4, ang + b, "leaf", w=0.35, vein=False)
            if top == "palmate" and g > 0.85 and (ripe or g >= 0.9):
                for k in range(4): cv.part(circ(x + (k % 2) * 1.6 - 0.8, y - 3 - H * g * 0.8 - (k // 2) * 1.6, 1.1, wob=0), "cherry", lw=0.4, shade=0.3, hl=0.1)
    return f

def staked(fruit_rp, pods=False):
    def f(cv, cx, base, g, ripe, seed):
        r = rng_(seed); H = 34 * g + 6
        if not WILDMODE[0]: cv.part(capsule_pts(cx + 3, base, cx + 3, base - max(14, H + 4), 0.9, 0.8), "wood", lw=0.6, shade=0.3, hl=0.2)
        if g < 0.3: return
        pts = [(cx + 3 + math.sin(t * 1.1 + seed) * 4 * g, base - 2 - H * t / 6) for t in range(7)]
        for a, b in zip(pts, pts[1:]): cv.line([a, b], ramp("grass")[3], 0.9)
        for i, (x, y) in enumerate(pts[1:]):
            leaf(cv, x, y, 4 + 3 * g, -0.4 if i % 2 else -2.7, "leaf", w=0.42)
        if g > 0.85:
            for i, (x, y) in enumerate(pts[1:-1:1]):
                if i % 2: continue
                if pods: cv.part(capsule_pts(x - 2, y + 1, x - 2.6, y + 7, 1.0, 0.8), "cloth_green" if ripe else "grass", lw=0.5, shade=0.3, hl=0.2)
                else: blob(cv, x + (2 if i % 4 else -2.5), y + 2, 2.2 if ripe else 1.5, fruit_rp if (ripe or i == 0) else "grass")
    return f

def ground_fruit(fruit_rp, shape="round"):
    def f(cv, cx, base, g, ripe, seed):
        r = rng_(seed)
        for (x0, y0, x1, y1) in [(-14, -2, 0, -4), (0, -4, 14, -1)]:
            if g > 0.3: cv.line([(cx + x0 * g, base + y0), (cx + (x0 + x1) / 2 * g, base + y0 - 3), (cx + x1 * g, base + y1)], ramp("leaf")[3], 0.9)
        for (dx, dy, rr) in [(-10, -5, 4.5), (9, -4, 4), (-2, -9, 5), (12, -8, 3.4)][: int(1 + 3 * g)]:
            cv.part(scallop(cx + dx * g, base + dy * g - 2, rr * (0.5 + g * 0.5), rr * 0.7 * (0.5 + g * 0.5), bumps=5, depth=0.15, seed=int(dx)), "leaf", lw=0.7, shade=0.3, hl=0.2)
        if g > 0.75:
            k = 1.0 if ripe else 0.6; rp = fruit_rp if (ripe or g > 0.9) else "grass"
            if shape == "round":
                m = cv.part(circ(cx + 1, base - 6 * k - 1, 8 * k, 6 * k, wob=0.03), rp, lw=0.9, shade=0.28, hl=0.16)
                for dx in (-4, -1.3, 1.3, 4): cv.line([(cx + 1 + dx * 0.6 * k, base - 11.5 * k - 1), (cx + 1 + dx * 1.3 * k, base - 6 * k - 1), (cx + 1 + dx * 0.6 * k, base - 0.5 - 1)], ramp(rp)[2], 0.55, clip=m)
                cv.part(capsule_pts(cx + 1, base - 11 * k - 1, cx + 2, base - 14 * k - 1, 1.2, 0.9), "bark", lw=0.5, shade=0.3, hl=0.2)
            else:  # squash: butternut
                cv.part(capsule_pts(cx - 5 * k, base - 3, cx + 6 * k, base - 6 * k - 1, 3.6 * k, 2.4 * k), rp, lw=0.8, shade=0.28, hl=0.2)
                cv.part(capsule_pts(cx + 6 * k, base - 6 * k - 1, cx + 8 * k, base - 8 * k - 1, 0.8, 0.6), "bark", lw=0.5, shade=0.3, hl=0.2)
    return f

def rosette(rp, spiky=False, H=12):
    def f(cv, cx, base, g, ripe, seed):
        n = int(5 + 5 * g)
        if spiky:
            for i in range(n):
                a = -math.pi / 2 + (i - (n - 1) / 2) * (2.4 / n)
                leaf(cv, cx, base - 3, (5 + H * g) * (1 - abs(a + math.pi / 2) * 0.25), a, rp, w=0.16, vein=False)
                if g > 0.6:
                    L = (5 + H * g) * (1 - abs(a + math.pi / 2) * 0.25)
                    for t in (0.4, 0.65): cv.fill(circ(cx + math.cos(a) * L * t, base - 3 + math.sin(a) * L * t, 0.4, wob=0), (255, 255, 240))
            if ripe:
                cv.line([(cx, base - 6), (cx + 1, base - 22)], ramp("cloth_green")[3], 0.8)
                for k in range(4): cv.fill(circ(cx + 1 + (k % 2) * 1.2, base - 18 - k * 1.5, 1.0, 1.4, wob=0), ramp("carrot")[1])
            return
        rr = 4 + 8 * g
        for i in range(n):  # outer leaves
            a = i / n * 6.283
            cv.part(scallop(cx + math.cos(a) * rr * 0.7, base - 4 - g * 2 + math.sin(a) * rr * 0.3, rr * 0.5, rr * 0.35, bumps=6, depth=0.15, seed=i), rp, lw=0.7, shade=0.3, hl=0.15, base_col=ramp(rp)[2])
        if g > 0.5:
            hr = rr * (0.55 if not ripe else 0.68)
            m = cv.part(circ(cx, base - 5 - hr * 0.4, hr, hr * 0.85, wob=0.03), rp, lw=0.8, shade=0.25, hl=0.2, base_col=ramp(rp)[0])
            for a in (-0.6, 0.4): cv.line([(cx, base - 5), (cx + math.sin(a) * hr, base - 5 - hr * 1.0)], ramp(rp)[2], 0.5, clip=m)
    return f

def herbs_f(flower_rp=None, cluster=False):
    def f(cv, cx, base, g, ripe, seed):
        r = rng_(seed)
        for i in range(int(4 + 6 * g)):
            x = cx + r.uniform(-9, 9) * (0.5 + g * 0.5); h = (5 + 14 * g) * r.uniform(0.7, 1.0)
            stem(cv, x, base - 2, x + r.uniform(-2, 2), base - 2 - h, "grass", 0.7)
            for j in range(int(1 + 2 * g)):
                y = base - 2 - h * (0.35 + j * 0.25); s = 1 if (i + j) % 2 else -1
                cv.part(circ(x + s * 2.0, y, 2.2, 1.2, rot=s * 0.6, wob=0), "cloth_green" if i % 2 else "leaf", lw=0.45, shade=0.3, hl=0.25)
            if flower_rp and g > 0.85 and (ripe or i % 3 == 0):
                if cluster:
                    for k in range(5): cv.fill(circ(x + (k - 2) * 1.0, base - 3 - h - abs(k - 2) * -0.4, 1.0, wob=0), ramp(flower_rp)[0] if flower_rp != "snow" else (255, 255, 255))
                    cv.line([(x - 2.4, base - 1.6 - h), (x + 2.4, base - 1.6 - h)], ramp(flower_rp)[2], 0.4, alpha=150)
                else:
                    for k in range(3): cv.fill(circ(x + (k - 1) * 1.2, base - 3 - h - (k % 2), 1.0, wob=0), ramp(flower_rp)[1])
    return f

def cotton(cv, cx, base, g, ripe, seed):
    r = rng_(seed)
    for i, dx in enumerate((-7, 0, 7)):
        x = cx + dx; h = (6 + 18 * g) * (0.9 + 0.1 * (i % 2)); y0 = base - 2 - (i % 2)
        stem(cv, x, y0, x, y0 - h, "bark" if ripe else "grass", 0.9)
        for k in range(int(1 + 2 * g)):
            leaf(cv, x, y0 - h * (0.3 + k * 0.25), 3 + 3 * g, -0.4 if (k + i) % 2 else -2.7, "leaf" if not ripe else "leaf_autumn", w=0.4, vein=False)
        if g > 0.8:
            for (bx, by) in [(0, -h), (2.5, -h * 0.7), (-2.4, -h * 0.55)][: 3 if ripe else 1]:
                if ripe:
                    cv.part(scallop(x + bx, y0 + by, 2.6, 2.2, bumps=4, depth=0.25, seed=i), "wool", lw=0.6, shade=0.25, hl=0.1)
                else: cv.part(circ(x + bx, y0 + by, 1.6, 1.9, wob=0.02), "grass_deep", lw=0.5, shade=0.3, hl=0.2)

def mushroom_bed(cv, cx, base, g, ripe, seed):
    cv.part(capsule_pts(cx - 12, base - 3, cx + 11, base - 4, 3.2, 3.0), "rotwood", lw=0.8, shade=0.3, hl=0.2)  # little log bed
    for i, (dx, s) in enumerate([(-8, 0.9), (0, 1.2), (8, 0.8), (4, 0.6), (-4, 0.7)][: int(1 + 4 * g)]):
        r = (1.2 + 3 * g) * s; x = cx + dx; y = base - 6 - r * 0.6
        cv.part(capsule_pts(x, base - 4, x, y, r * 0.35, r * 0.3), "cloth_cream", lw=0.5, shade=0.3, hl=0.2)
        pts = [(x + math.cos(math.pi + t / 10 * math.pi) * r, y + math.sin(math.pi + t / 10 * math.pi) * r * 0.75) for t in range(11)]
        m = cv.part(pts, "hide" if not ripe else "fur_brown", lw=0.6, shade=0.3, hl=0.2)
        cv.fill(circ(x - r * 0.3, y - r * 0.3, r * 0.2, wob=0), (255, 248, 236), clip=m)

def cabbage_f(): return rosette("cloth_green")

PLANTS = {  # key: (drawer, produce rp for the wild version tint)
    "wheat":    grain("thatch", n=8, H=26),
    "corn":     corn,
    "potato":   bushy(potato_fruit, flower="snow", H=14),
    "carrot":   roots("feather", "carrot"),
    "tomato":   staked("cherry"),
    "pumpkin":  ground_fruit("pumpkin", "round"),
    "squash":   ground_fruit("cloth_yellow", "long"),
    "beans":    staked("cloth_green", pods=True),
    "cabbage":  rosette("cloth_green"),
    "onion":    roots("tube", "flower_pink"),
    "garlic":   roots("flat", "snow"),
    "cotton":   cotton,
    "flax":     grain("flower_blue", stalk_rp="cloth_green", n=8, H=26, heads="flower"),
    "hemp":     grain("grass_deep", stalk_rp="grass_deep", n=5, H=30, heads="palm"),
    "herbs":    herbs_f("flower_blue"),
    "mushroom": mushroom_bed,
    "yarrow":   herbs_f("snow", cluster=True),
    "ginseng":  roots("palmate", "hide", n=2, H=12),
    "aloe":     rosette("metal_teal", spiky=True),
}
STAGE_G = [0.12, 0.38, 0.68, 0.9]

def crop(key, stage):
    """stage 0..3 growing (no produce), 4 = mature crop_<key>."""
    cv = Canvas(CW, CH, seed=7 + stage); cx, base = CW / 2, CB
    mound(cv, cx, base)
    g = 1.0 if stage == 4 else STAGE_G[stage]
    if stage == 0: sprout(cv, cx, base, 0.2)
    else: PLANTS[key](cv, cx, base, g, stage == 4, hash(key) % 1000 if False else sum(map(ord, key)))
    return cv.final()

def farm_soil():
    cv = Canvas(64, 40, seed=5); cx, base = 32, 34
    cv.shadow(cx, base - 6, 25, 9, alpha=0.15)
    dia = [(cx, base - 22), (cx + 28, base - 8), (cx, base + 4), (cx - 28, base - 8)]
    dia = [(x + (cx - x) * 0.08, y + (base - 9 - y) * 0.08) for x, y in dia]
    m = cv.part(dia, "dirt", lw=1.0, shade=0.15, hl=0.08)
    d = ramp("dirt")
    for k in range(-3, 4):  # furrows along one iso axis
        x0, y0 = cx - 24 + 0 + k * 3.6 + 12, base - 8 - 12 + k * 1.8 + 6
        cv.line([(x0 - 12, y0 + 6), (x0 + 12, y0 - 6)], d[2], 0.9, clip=m, alpha=200)
        cv.line([(x0 - 12, y0 + 5), (x0 + 12, y0 - 7)], d[0], 0.5, clip=m, alpha=160)
    for (dx, dy) in [(-10, -6), (8, -2), (2, -12), (-4, 2)]: cv.part(circ(cx + dx, base - 8 + dy, 1.2, 0.8), "stone", lw=0.4, shade=0.3, hl=0.2)
    return cv.final()

# ------------------------------------------------------------------ saplings
SAP = {  # key: (crown ramp, kind, fruit ramp)
    "blueberry_bush": ("pine", "bush", "berry_blue"), "raspberry_bush": ("leaf", "bush", "raspberry"),
    "blackberry_bush": ("grass_deep", "bush", "blackberry"), "strawberry_bush": ("leaf", "patch", "berry"),
    "oak_tree": ("leaf", "tree", None), "pine_tree": ("pine", "pine", None), "birch_tree": ("grass", "birch", None),
    "maple_tree": ("leaf_autumn", "tree", None), "willow_tree": ("willow", "willow", None), "palm_tree": ("palm", "palm", None),
    "apple_tree": ("leaf", "tree", "berry"), "pear_tree": ("grass_deep", "tree", "pear"), "cherry_tree": ("blossom", "tree", None),
    "orange_tree": ("pine", "tree", None), "peach_tree": ("leaf", "tree", None),
}
SW, SH, SB = 48, 72, 64

def sapling(key, stage):
    rp, kind, fruit = SAP[key]
    cv = Canvas(SW, SH, seed=11 + stage); cx, base = SW / 2, SB
    mound(cv, cx, base, w=11 if stage < 2 else 13)
    if stage == 0:
        stem(cv, cx, base - 2, cx + 0.5, base - 9, "bark", 1.0)
        leaf(cv, cx + 0.5, base - 9, 4.5, -2.5, rp, w=0.4); leaf(cv, cx + 0.5, base - 9, 4.5, -0.6, rp, w=0.4)
        cv.part(capsule_pts(cx - 0.5, base - 5, cx + 3.5, base - 3.5, 0.8), "cloth_red", lw=0.4, shade=0.2, hl=0.2)  # planted tag
        return cv.final()
    k = 1.0 if stage == 1 else 1.7
    trunk = "birch_bark" if kind == "birch" else ("palm_bark" if kind == "palm" else "bark")
    if kind in ("bush", "patch"):
        r = 4.5 * k
        for i, (dx, dy) in enumerate([(-4, -3), (4, -3.5), (0, -7), (-2, -2), (3, -1.5)]):
            cv.part(scallop(cx + dx * k, base - 4 + dy * k, r, r * 0.85, bumps=7, depth=0.12, seed=i), rp, lw=0.8, shade=0.25, hl=0.12, base_col=ramp(rp)[2] if i < 3 else None)
        if stage == 2 and fruit:
            for (dx, dy) in [(-5, -6), (3, -10), (6, -4)]: blob(cv, cx + dx, base + dy - 2, 1.4, fruit, lw=0.5)
        return cv.final()
    h = 14 * k
    cv.part(capsule_pts(cx, base - 2, cx + 1, base - 2 - h, 1.4 * k, 0.9 * k), trunk, lw=0.8, shade=0.3, hl=0.2)
    top = (cx + 1, base - 2 - h)
    if kind == "pine":
        for i, (yb, hw) in enumerate([(0.15, 8), (0.45, 6.5), (0.75, 5), (1.0, 3)]):
            y = base - 2 - h * yb - 2; hw *= k * 0.85
            cv.part([(cx - hw, y + 3), (cx + 1, y - 6 * k * 0.7), (cx + hw, y + 3), (cx, y + 4)], "pine", lw=0.8, shade=0.3, hl=0.25)
    elif kind == "palm":
        for a in (-2.6, -2.0, -1.2, -0.5):
            leaf(cv, top[0], top[1], 8 * k, a, "palm", w=0.22)
    else:
        R = 5.5 * k
        blobs = [(-R * 0.8, R * 0.2, R * 0.75), (R * 0.8, R * 0.1, R * 0.75), (0, -R * 0.6, R * 0.85), (0, R * 0.25, R * 0.8)]
        mm = cv.mask_from([scallop(top[0] + dx, top[1] + dy, r, bumps=8, seed=i) for i, (dx, dy, r) in enumerate(blobs)])
        cv.part(None, rp, mask=mm, lw=0.9, shade=0.2, hl=0.1)
        leaf_ticks(cv, top[0], top[1], R, rp if rp in ("leaf", "pine", "grass", "leaf_autumn", "grass_deep") else "leaf", 3, 3)
        if kind == "willow":
            for i in range(6): cv.line([(top[0] - R + i * R * 0.4, top[1]), (top[0] - R + i * R * 0.4 + 0.5, top[1] + R * 1.3)], ramp("willow")[2], 1.0)
        if stage == 2 and fruit:
            for (dx, dy) in [(-3, -1), (3, -3), (0, 2)]: blob(cv, top[0] + dx * k * 0.8, top[1] + dy, 1.5, fruit, lw=0.5)
    return cv.final()

# ------------------------------------------------------------------ wild plants (resource nodes)
WILD = ["wheat", "corn", "potato", "carrot", "tomato", "pumpkin", "squash", "beans", "cabbage", "garlic", "hemp", "mushroom", "yarrow", "ginseng", "aloe"]

def wild(key, full=True):
    cv = Canvas(CW, CH, seed=17); cx, base = CW / 2, CB
    cv.shadow(cx, base - 1, 14, 4)
    g = ramp("grass")
    r = rng_(sum(map(ord, key)))
    for i in range(7):  # grass tuft base
        x = cx + r.uniform(-14, 14)
        cv.part([(x - 1.2, base), (x + r.uniform(-3, 3), base - r.uniform(4, 8)), (x + 1.2, base)], "grass" if i % 2 else "grass_deep", lw=0.5, shade=0.3, hl=0.25)
    if key == "mushroom":
        if full: nature_caps_cluster(cv, cx, base)
        else: cv.part(capsule_pts(cx - 10, base - 3, cx + 9, base - 4, 3, 2.8), "rotwood", lw=0.8, shade=0.3, hl=0.2)
        return cv.final()
    WILDMODE[0] = True
    try: PLANTS[key](cv, cx, base + 1, 0.95 if full else 0.55, full, sum(map(ord, key)) + 3)
    finally: WILDMODE[0] = False
    return cv.final()

def nature_caps_cluster(cv, cx, base):
    for i, (dx, h, rr) in enumerate([(-6, 7, 4.5), (4, 10, 5.5), (10, 4, 2.6)]):
        x = cx + dx; y = base - h
        cv.part(capsule_pts(x, base - 1, x, y, 1.4 * rr / 5, 1.2 * rr / 5), "cloth_cream", lw=0.7, shade=0.3, hl=0.2)
        pts = [(x - rr, y + 1)] + [(x + math.cos(math.pi + t / 12 * math.pi) * rr, y + 1 + math.sin(math.pi + t / 12 * math.pi) * rr * 0.75) for t in range(13)] + [(x + rr, y + 1)]
        m = cv.part(pts, "fur_brown", lw=0.8, shade=0.3, hl=0.2)
        cv.fill(circ(x - rr * 0.4, y - rr * 0.3, rr * 0.2, wob=0), (255, 248, 236), clip=m)

# ------------------------------------------------------------------ fish shoal
def fish_shoal(frame=0, full=True):
    cv = Canvas(56, 32, seed=21); cx, base = 28, 22
    w = ramp("water")
    for k, rr in enumerate((16, 10.5, 5)):
        r2 = rr + frame * 1.6
        pts = circ(cx, base - 2, r2, r2 * 0.42, wob=0.04, seed=k, n=36)
        cv.line(pts + [pts[0]], w[0], 0.9, alpha=220 - k * 30 - frame * 25)
    if full:
        for i, (dx, dy, a) in enumerate([(-6, -3, 0.3), (5, -1, 2.9), (1, -6, 1.6)]):
            a += frame * 0.35; x, y = cx + dx, base + dy - 2
            ca, sa = math.cos(a), math.sin(a) * 0.5
            body = ellipse_pts(x, y, 3.6, 1.4, rot=math.atan2(sa, ca), n=16)
            cv.fill(body, w[3], alpha=170)
            cv.fill([(x - ca * 3.2, y - sa * 3.2), (x - ca * 5.6 - sa * 2, y - sa * 5.6 + ca * 1), (x - ca * 5.6 + sa * 2, y - sa * 5.6 - ca * 1)], w[3], alpha=170)
        for (dx, dy) in [(4, -9), (-8, -7)]: cv.line(circ(cx + dx, base + dy - frame, 0.9, wob=0, n=10) + [circ(cx + dx, base + dy - frame, 0.9, wob=0, n=10)[0]], (255, 255, 255), 0.4, alpha=200)
    return cv.final()

# ------------------------------------------------------------------ clutter (32x32, feet at (16, 26))
KW, KH, KB = 32, 32, 26
def clutter(key):
    cv = Canvas(KW, KH, seed=sum(map(ord, key))); cx, base = KW / 2, KB; r = rng_(sum(map(ord, key)))
    def tuft(n, rpA, rpB, h0, h1, spread):
        for i in range(n):
            x = cx + r.uniform(-spread, spread); lean = r.uniform(-3, 3)
            cv.part([(x - 1.1, base), (x + lean, base - r.uniform(h0, h1)), (x + 1.1, base)], rpA if i % 2 else rpB, lw=0.5, shade=0.3, hl=0.25)
    if key == "clutter_pebbles":
        for i, (dx, dy, s) in enumerate([(-4, 0, 2.6), (3, -1, 2.0), (0, 1.5, 1.6), (6, 1, 1.3)]): cv.part(circ(cx + dx, base + dy - s * 0.4, s * 1.1, s * 0.75, wob=0.12, seed=i, n=10), "stone", lw=0.6, shade=0.3, hl=0.25)
    elif key == "clutter_shell":
        pts = [(cx - 4, base), (cx - 5, base - 3), (cx - 2, base - 6), (cx + 2, base - 6), (cx + 5, base - 3), (cx + 4, base)]
        m = cv.part(pts, "flower_pink", lw=0.6, shade=0.25, hl=0.25)
        for dx in (-2.5, 0, 2.5): cv.line([(cx, base), (cx + dx * 1.3, base - 5.5)], ramp("flower_pink")[2], 0.45, clip=m)
    elif key == "clutter_reeds":
        cv.part(circ(cx, base - 0.5, 7, 2, wob=0.1), "water", lw=0.5, shade=0.2, hl=0.3)
        for i in range(5):
            x = cx + r.uniform(-5, 5); h = r.uniform(10, 16); lean = r.uniform(-2, 2)
            cv.part([(x - 0.9, base), (x + lean, base - h), (x + 0.9, base)], "grass_deep" if i % 2 else "grass", lw=0.5, shade=0.3, hl=0.25)
            if i % 2 == 0: cv.part(capsule_pts(x + lean * 0.8, base - h * 0.72, x + lean * 0.9, base - h * 0.92, 1.1), "bark", lw=0.45, shade=0.3, hl=0.25)
    elif key == "clutter_driftwood":
        cv.part(capsule_pts(cx - 8, base - 1, cx + 8, base - 3, 2.0, 1.4), "sand", lw=0.7, shade=0.3, hl=0.2, base_col=ramp("smoke")[1], shade_col=ramp("smoke")[2])
        cv.part(capsule_pts(cx + 2, base - 2.5, cx + 5, base - 7, 0.9, 0.6), "sand", lw=0.5, shade=0.3, hl=0.2, base_col=ramp("smoke")[1], shade_col=ramp("smoke")[2])
    elif key in ("clutter_grass_tuft_a", "clutter_grass_tuft_b"):
        tuft(8 if key.endswith("a") else 11, "grass", "grass_deep" if key.endswith("a") else "cloth_green", 4, 9 if key.endswith("a") else 12, 5 if key.endswith("a") else 7)
    elif key.startswith("clutter_flower_"):
        rp = {"a": "flower_pink", "b": "flower_yel", "c": "flower_blue"}[key[-1]]
        tuft(4, "grass", "grass_deep", 3, 6, 5)
        for i, (dx, h) in enumerate([(-3, 8), (2, 10), (5, 6)][: 3 if key[-1] != "c" else 2]):
            x = cx + dx; y = base - h
            cv.line([(x, base), (x, y)], ramp("grass")[3], 0.7)
            for a in range(5): cv.part(circ(x + math.cos(a * 1.257) * 1.6, y + math.sin(a * 1.257) * 1.4, 1.3, wob=0, n=12), rp, lw=0.4, shade=0.2, hl=0.1)
            cv.fill(circ(x, y, 0.8, wob=0), ramp("flower_yel")[0] if rp != "flower_yel" else ramp("leaf_autumn")[2])
    elif key == "clutter_twigs":
        for (x0, y0, x1, y1) in [(-7, -1, 6, -3), (-4, -4, 7, 0), (-2, 1, 3, -5)]: cv.part(capsule_pts(cx + x0, base + y0, cx + x1, base + y1, 0.9, 0.6), "bark", lw=0.5, shade=0.3, hl=0.2)
    elif key == "clutter_leaves":
        for i, (dx, dy, rp) in enumerate([(-5, -1, "leaf_autumn"), (3, 0, "leaf_autumn"), (0, -3, "pumpkin"), (6, -3, "leaf"), (-2, 1.5, "carrot")]):
            leaf(cv, cx + dx - 2, base + dy, 5, r.uniform(-0.6, 0.6), rp, w=0.4)
    elif key == "clutter_fern":
        for a in np.linspace(-2.6, -0.5, 5):
            L = 11; ex, ey = cx + math.cos(a) * L, base - 1 + math.sin(a) * L * 0.9
            stem(cv, cx, base - 1, ex, ey, "grass_deep", 0.7)
            for t in np.linspace(0.3, 0.95, 4):
                px, py = cx + (ex - cx) * t, base - 1 + (ey - base + 1) * t
                for s in (-1, 1): leaf(cv, px, py, 2.6 * (1.15 - t), a + s * 1.0, "grass_deep", w=0.4, vein=False)
    elif key == "clutter_mushroom":
        for (dx, h, rr) in [(-2, 6, 3.6), (3, 4, 2.4)]:
            x = cx + dx; y = base - h
            cv.part(capsule_pts(x, base - 0.5, x, y, rr * 0.3, rr * 0.25), "cloth_cream", lw=0.5, shade=0.3, hl=0.2)
            pts = [(x + math.cos(math.pi + t / 10 * math.pi) * rr, y + math.sin(math.pi + t / 10 * math.pi) * rr * 0.8) for t in range(11)]
            m = cv.part(pts, "mush_red", lw=0.6, shade=0.3, hl=0.2)
            cv.fill(circ(x - rr * 0.35, y - rr * 0.35, rr * 0.22, wob=0), (255, 248, 240), clip=m)
    elif key in ("clutter_moss_rock", "clutter_rock_small"):
        cv.shadow(cx, base, 7, 2)
        pts = [(cx - 6, base), (cx - 6.5, base - 3), (cx - 3, base - 7), (cx + 2, base - 7.5), (cx + 6, base - 4), (cx + 6, base), (cx, base + 1)]
        m = cv.part(pts, "stone", lw=0.8, shade=0.3, hl=0.2)
        cv.line([(cx - 1, base - 7), (cx + 1, base - 3), (cx + 5, base - 2)], ramp("stone")[2], 0.5, clip=m)
        if key == "clutter_moss_rock": cv.part(scallop(cx - 1, base - 6.5, 4.5, 1.8, bumps=6, depth=0.2, seed=1), "moss", lw=0.5, shade=0.3, hl=0.25)
    elif key == "clutter_dry_grass":
        tuft(9, "dry", "thatch", 4, 10, 6)
    return cv.final()

CLUTTER = ["clutter_pebbles", "clutter_shell", "clutter_reeds", "clutter_driftwood", "clutter_grass_tuft_a", "clutter_grass_tuft_b", "clutter_flower_a", "clutter_flower_b",
           "clutter_flower_c", "clutter_twigs", "clutter_leaves", "clutter_fern", "clutter_mushroom", "clutter_moss_rock", "clutter_rock_small", "clutter_dry_grass"]

# ------------------------------------------------------------------ build group
def group_crops(b):
    P = list(PLANTS)
    small = [(f"crop_{k}_{s}", {"idle": [lambda k=k, s=s: crop(k, s)]}, (0.5, 0.7, 0.5)) for k in P for s in (0, 1)]
    small += [(f"sapling_{k}_0", {"idle": [lambda k=k: sapling(k, 0)]}, (0.5, 0.7, 0.5)) for k in SAP]
    b.static_atlas("nature_sprouts", small, 16, canvas=(CW, CH, CB))
    big = [(f"crop_{k}_{s}", {"idle": [lambda k=k, s=s: crop(k, s)]}, (0.6, 0.7, 0.5)) for k in P for s in (2, 3)]
    big += [(f"crop_{k}", {"idle": [lambda k=k: crop(k, 4)]}, (0.6, 0.7, 0.5)) for k in P]
    big += [(f"wild_{k}", {"idle": [lambda k=k: wild(k, True)], "depleted": [lambda k=k: wild(k, False)]}, (0.6, 0.7, 0.5)) for k in WILD]
    b.static_atlas("nature_crops", big, 16, canvas=(CW, CH, CB))
    saps = [(f"sapling_{k}_{s}", {"idle": [lambda k=k, s=s: sapling(k, s)]}, (0.8, 0.5, 0.6)) for k in SAP for s in (1, 2)]
    b.static_atlas("nature_saplings", saps, 16, canvas=(SW, SH, SB))
    b.static_atlas("nature_ground", [("farm_soil", {"idle": [farm_soil]}, None)], 1, canvas=(64, 40, 34), want_sway_mask=False)
    b.static_atlas("nature_shoal", [("fish_shoal", {"idle": [lambda f=f: fish_shoal(f) for f in range(3)], "depleted": [lambda: fish_shoal(1, False)]}, None)], 4, canvas=(56, 32, 22), want_sway_mask=False)
    b.static_atlas("nature_clutter", [(k, {"idle": [lambda k=k: clutter(k)]}, None) for k in CLUTTER], 8, category="resource", canvas=(KW, KH, KB), want_sway_mask=False)

GROUPS = [group_crops]
