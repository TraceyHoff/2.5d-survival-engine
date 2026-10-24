"""Trees, bushes, logs/stumps (ADR-110 group 1). Canvas conventions follow assets/tools/nature.py: trees 96x128 base 118,
small props 64x64 base 56; everything is re-trimmed around the feet pivot by common.pack_grid."""
import math, numpy as np
import common  # noqa: F401  (sets up paths + ramps + 2x final)
from toon import Canvas, capsule_pts, ellipse_pts
from palette import ramp
import nature
from nature import circ, scallop, trunk_poly, leaf_ticks

TW, TH, TB = 96, 128, 118
PW, PH, PB = 64, 64, 56

# ------------------------------------------------------------------ trees
def crown(cv, cx, base, rp, blobs, seed, inner=None):
    c = ramp(rp)
    back = cv.mask_from([scallop(cx + dx + 3, base + dy - 2, r, bumps=8, seed=seed + i) for i, (dx, dy, r) in enumerate(blobs[:max(3, len(blobs) // 2)])])
    cv.part(None, rp, mask=back, lw=1.15, shade=0.2, hl=0.0, base_col=c[2], shade_col=c[3])
    m = cv.mask_from([scallop(cx + dx, base + dy, r, bumps=9, seed=seed + i * 3) for i, (dx, dy, r) in enumerate(blobs)])
    cv.part(None, rp, mask=m, lw=1.2, shade=0.16, hl=0.06)
    for i, (dx, dy, r) in enumerate(inner or []):
        x, y = cx + dx, base + dy
        cv.fill(scallop(x, y, r, r * 0.75, bumps=6, depth=0.12, seed=i), c[0] if (dy < -85 or dx < -8) else c[1], clip=m, alpha=230)
        arc = [(x + math.cos(a) * r * 0.95, y + math.sin(a) * r * 0.72) for a in np.linspace(0.2, math.pi - 0.2, 10)]
        cv.line(arc, c[2], 0.7, clip=m, alpha=210)
        leaf_ticks(cv, x, y - 1, r * 0.8, rp, 3, seed + i)
    return m

def fruits(cv, m, cx, base, fruit, seed, n=8, r=2.6, box=(-24, 24, 62, 98), pair=False):
    rng = np.random.default_rng(seed)
    for i in range(n):
        x = cx + rng.uniform(box[0], box[1]); y = base - rng.uniform(box[2], box[3])
        for j in range(2 if pair else 1):
            fx = x + j * 2.6; fy = y + j * 0.8
            cv.line([(x + 1.2, y - 4.5), (fx, fy - r)], ramp("bark")[2], 0.5)
            cv.part(circ(fx, fy, r, r * (1.15 if fruit == "pear" else 1), wob=0.02), fruit, lw=0.7, shade=0.3, hl=0.0, gloss=[(fx - 0.8, fy - 0.9, 0.8, 0.6)])

def tree_round(seed, rp, fruit=None, trunk="bark", h=62, scale=1.0, blossom=False, pair=False, fr=2.6):
    cv = Canvas(TW, TH, seed=seed); cx = TW / 2; base = TB
    cv.shadow(cx + 2, base, 26 * scale, 9 * scale)
    poly, top = trunk_poly(cx, base, h * scale, 14 * scale, 7 * scale, 5, seed)
    cv.part(poly, trunk, lw=1.15, shade=0.35, hl=0.25)
    b = ramp(trunk)
    for k in range(4):
        yy = base - 10 - k * 11 * scale; xx = cx - 3 + k * 1.2 + (k % 2) * 3
        cv.line([(xx, yy), (xx + 1, yy - 6 * scale)], b[2], 0.6)
    for (sx, sy, ex, ey) in [(cx + 1, base - 44 * scale, cx + 19 * scale, base - 60 * scale), (cx - 1, base - 50 * scale, cx - 19 * scale, base - 64 * scale)]:
        cv.part(capsule_pts(sx, sy, ex, ey, 2.6 * scale, 1.5 * scale), trunk, lw=0.95, shade=0.3, hl=0.2)
    s = scale
    blobs = [(-22 * s, -70 * s, 15 * s), (22 * s, -72 * s, 15 * s), (-12 * s, -88 * s, 17 * s), (12 * s, -90 * s, 17 * s), (0, -101 * s, 15 * s),
             (0, -74 * s, 18 * s), (-25 * s, -84 * s, 11 * s), (25 * s, -86 * s, 11 * s), (-8 * s, -64 * s, 13 * s), (10 * s, -64 * s, 13 * s)]
    inner = [(-14 * s, -92 * s, 9 * s), (6 * s, -98 * s, 8 * s), (-20 * s, -76 * s, 8 * s), (2 * s, -80 * s, 10 * s), (17 * s, -84 * s, 8 * s), (-6 * s, -68 * s, 7 * s), (14 * s, -68 * s, 7 * s)]
    m = crown(cv, cx, base, rp, blobs, seed, inner)
    if blossom:  # little five-dot blossoms
        rng = np.random.default_rng(seed + 5)
        for i in range(14):
            x = cx + rng.uniform(-26, 26) * s; y = base - rng.uniform(62, 106) * s
            for a in range(5):
                cv.fill(circ(x + math.cos(a * 1.257) * 1.3, y + math.sin(a * 1.257) * 1.1, 1.0, wob=0), (255, 250, 252), clip=m)
            cv.fill(circ(x, y, 0.6, wob=0), ramp("flower_yel")[1], clip=m)
    if fruit: fruits(cv, m, cx, base, fruit, seed, n=8, r=fr, box=(-24 * s, 24 * s, 62 * s, 98 * s), pair=pair)
    return cv.final()

def tree_birch(seed=41):
    cv = Canvas(TW, TH, seed=seed); cx = TW / 2; base = TB
    cv.shadow(cx + 2, base, 20, 7)
    for (dx, h, w, bend) in [(-5, 82, 8, 3), (6, 70, 7, -4)]:
        poly, top = trunk_poly(cx + dx, base, h, w, 4, bend, seed + dx, roots=False)
        m = cv.part(poly, "birch_bark", lw=1.1, shade=0.3, hl=0.2)
        rng = np.random.default_rng(seed + dx)
        for k in range(7):  # dark lenticels
            y = base - 6 - k * h / 8 - rng.uniform(0, 3); x = cx + dx + bend * math.sin((base - y) / h * math.pi * 1.3 + 0.4) * (base - y) / h
            cv.line([(x - w * 0.4, y), (x + rng.uniform(-0.5, 1.5), y - 0.6)], ramp("hair_black")[1], 0.8, clip=m)
    blobs = [(-16, -78, 12), (14, -74, 11), (-6, -96, 13), (10, -92, 12), (0, -106, 10), (-20, -92, 9), (20, -86, 9), (2, -80, 12)]
    inner = [(-10, -98, 7), (6, -100, 6), (-14, -82, 6), (8, -80, 7)]
    crown(cv, cx, base, "grass", blobs, seed, inner)
    return cv.final()

def tree_willow(seed=43):
    cv = Canvas(TW, TH, seed=seed); cx = TW / 2; base = TB
    cv.shadow(cx + 2, base, 30, 9)
    poly, top = trunk_poly(cx, base, 58, 16, 9, 6, seed)
    cv.part(poly, "bark", lw=1.15, shade=0.35, hl=0.25)
    blobs = [(-20, -72, 15), (20, -74, 15), (-8, -88, 18), (12, -88, 17), (0, -98, 14), (0, -70, 16), (-28, -80, 11), (28, -80, 11)]
    m = crown(cv, cx, base, "willow", blobs, seed, [(-10, -92, 8), (8, -90, 7), (-18, -76, 7)])
    c = ramp("willow"); rng = np.random.default_rng(seed)
    for i in range(16):  # hanging fronds
        x0 = cx - 34 + i * 4.4 + rng.uniform(-1, 1); y0 = base - 74 + abs(i - 7.5) * 1.6 - rng.uniform(0, 4)
        L = rng.uniform(24, 40); sw = rng.uniform(-3, 3)
        pts = [(x0 - 2.0, y0), (x0 + sw * 0.5 - 1.6, y0 + L * 0.6), (x0 + sw, y0 + L), (x0 + sw * 0.5 + 1.6, y0 + L * 0.6), (x0 + 2.0, y0)]
        cv.part(pts, "willow", lw=0.7, shade=0.3, hl=0.2, base_col=c[1] if i % 2 else c[2])
        for t in (0.35, 0.6, 0.82): cv.line([(x0 + sw * t - 1.2, y0 + L * t), (x0 + sw * t + 1.2, y0 + L * t + 1)], c[3], 0.5, alpha=180)
    return cv.final()

def tree_palm(seed=45):
    cv = Canvas(TW, TH, seed=seed); cx = TW / 2; base = TB
    cv.shadow(cx + 4, base, 18, 6)
    segs = 9; pts = [(cx + 10 * (t / segs) ** 2 * 1.8 - 2, base - 84 * t / segs) for t in range(segs + 1)]
    for i, (a, b) in enumerate(zip(pts, pts[1:])):
        w = 6.0 - i * 0.28
        cv.part(capsule_pts(a[0], a[1], b[0], b[1], w, w - 0.3), "palm_bark", lw=0.95, shade=0.3, hl=0.2)
        cv.line([(a[0] - w + 0.6, a[1] - 1), (a[0] + w - 0.6, a[1] + 1)], ramp("palm_bark")[3], 0.6)
    tx, ty = pts[-1]
    for (dx, dy) in [(-3, 3), (2, 4), (0, 6)]:
        cv.part(circ(tx + dx, ty + dy, 3.2, wob=0.02), "wood_dark", lw=0.8, shade=0.35, hl=0.1, gloss=[(tx + dx - 1, ty + dy - 1, 0.9, 0.7)])
    for i, ang in enumerate([-170, -140, -110, -70, -40, -10, 150, 30]):
        a = math.radians(ang); L = 30 if i < 6 else 22
        ex, ey = tx + math.cos(a) * L, ty + math.sin(a) * L * 0.45 + 12
        mx, my = tx + math.cos(a) * L * 0.5, ty + math.sin(a) * L * 0.45 * 0.5 - 6
        nx, ny = -math.sin(a) * 3.6, math.cos(a) * 3.6
        frond = [(tx, ty), (mx + nx, my + ny), (ex, ey), (mx - nx, my - ny)]
        m = cv.part(frond, "palm", lw=0.9, shade=0.25, hl=0.2, base_col=ramp("palm")[2] if i >= 6 else None)
        cv.line([(tx, ty), (mx, my), (ex, ey)], ramp("palm")[3], 0.6, clip=m)
        for t in np.linspace(0.25, 0.9, 5):
            px, py = tx + (ex - tx) * t, ty + (ey - ty) * t - 6 * math.sin(t * math.pi)
            cv.line([(px, py), (px + nx * 0.9, py + ny * 0.9 + 1.5)], ramp("palm")[3], 0.5, clip=m)
    return cv.final()

def tree_pine(seed=47): return nature.tree_pine(0, seed=seed)

TREES = {  # key: (idle fn, depleted fn or None)
    "pine_tree":   (lambda: tree_pine(47), None),
    "birch_tree":  (lambda: tree_birch(41), None),
    "maple_tree":  (lambda: tree_round(49, "leaf_autumn"), None),
    "willow_tree": (lambda: tree_willow(43), None),
    "palm_tree":   (lambda: tree_palm(45), None),
    "apple_tree":  (lambda: tree_round(51, "leaf", "berry", scale=0.86), lambda: tree_round(51, "leaf", None, scale=0.86)),
    "pear_tree":   (lambda: tree_round(53, "grass_deep", "pear", scale=0.86, fr=2.8), lambda: tree_round(53, "grass_deep", None, scale=0.86)),
    "cherry_tree": (lambda: tree_round(55, "blossom", "cherry", scale=0.84, pair=True, fr=1.9), lambda: tree_round(55, "blossom", None, scale=0.84, blossom=True)),
    "orange_tree": (lambda: tree_round(57, "pine", "orange", scale=0.84, fr=2.9), lambda: tree_round(57, "pine", None, scale=0.84, blossom=True)),
    "peach_tree":  (lambda: tree_round(59, "leaf", "peach", scale=0.84, fr=2.9), lambda: tree_round(59, "leaf", None, scale=0.84)),
}

# ------------------------------------------------------------------ bushes
def strawberry_patch(full=True, seed=61):
    cv = Canvas(PW, PH, seed=seed); cx = PW / 2; base = PB
    cv.shadow(cx, base, 17, 5)
    rng = np.random.default_rng(seed)
    for i in range(11):  # trefoil leaves
        x = cx + rng.uniform(-14, 14); y = base - rng.uniform(2, 12)
        cv.line([(x, base - 1), (x, y)], ramp("grass")[3], 0.8)
        for a in (-0.9, 0, 0.9):
            cv.part(scallop(x + math.sin(a) * 3.4, y - math.cos(a) * 2.4, 3.0, 2.2, bumps=7, depth=0.1, seed=i), "leaf", lw=0.6, shade=0.3, hl=0.2)
    if full:
        for (dx, dy) in [(-10, -3), (-2, -1), (7, -4), (12, 0), (-6, 2), (3, 3)]:
            x, y = cx + dx, base + dy - 1
            cv.part([(x - 2.4, y - 2), (x + 2.4, y - 2), (x + 0.3, y + 3), (x - 0.3, y + 3)], "berry", lw=0.6, shade=0.3, hl=0.1, gloss=[(x - 0.8, y - 0.8, 0.6, 0.6)])
            for sx in (-1, 0.8): cv.fill(circ(x + sx, y, 0.35, wob=0), ramp("flower_yel")[0])
            cv.part(circ(x, y - 2.4, 1.9, 0.8, wob=0), "leaf", lw=0.4, shade=0.2, hl=0.1)
    else:
        for (dx, dy) in [(-8, -6), (6, -8)]: cv.fill(circ(cx + dx, base + dy, 1.5, wob=0), (255, 252, 246))
    return cv.final()

def fiber_bush(seed=63):
    cv = Canvas(PW, PH, seed=seed); cx = PW / 2; base = PB
    cv.shadow(cx, base, 17, 5)
    rng = np.random.default_rng(seed)
    for i in range(20):
        x = cx + rng.uniform(-14, 14); h = rng.uniform(18, 34); lean = (x - cx) * 0.7 + rng.uniform(-3, 3)
        pts = [(x - 1.8, base), (x + lean * 0.5, base - h * 0.6), (x + lean, base - h), (x + lean * 0.5 + 0.7, base - h * 0.55), (x + 1.8, base)]
        cv.part(pts, ["grass", "cloth_green", "grass_deep"][i % 3], lw=0.8, shade=0.3, hl=0.25)
    for i in range(5):
        x = cx + rng.uniform(-9, 9); y = base - rng.uniform(28, 34)
        cv.part(circ(x, y, 1.5, 3.6, rot=0.3, wob=0.05), "thatch", lw=0.7, shade=0.3, hl=0.2)
    return cv.final()

def dry_shrub(seed=65):
    cv = Canvas(PW, PH, seed=seed); cx = PW / 2; base = PB
    cv.shadow(cx, base, 15, 4)
    rng = np.random.default_rng(seed); w = ramp("wood_dark")
    def br(x, y, a, L, d):
        if d == 0 or L < 2: return
        ex, ey = x + math.cos(a) * L, y + math.sin(a) * L
        cv.line([(x, y), (ex, ey)], w[2] if d > 2 else w[1], 0.5 + d * 0.35)
        for s in (-1, 1): br(ex, ey, a + s * rng.uniform(0.35, 0.7), L * 0.7, d - 1)
    for a in (-2.2, -1.75, -1.35, -0.95): br(cx + rng.uniform(-3, 3), base, a, 9, 4)
    for i in range(9):
        x = cx + rng.uniform(-14, 14); y = base - rng.uniform(10, 24)
        cv.part(circ(x, y, 2.2, 1.3, rot=rng.uniform(-1, 1), wob=0.05), "dry", lw=0.5, shade=0.3, hl=0.2)
    for i in range(6):
        x = cx + rng.uniform(-12, 12)
        cv.part([(x - 1, base), (x + rng.uniform(-4, 4), base - rng.uniform(6, 11)), (x + 1, base)], "dry", lw=0.5, shade=0.3, hl=0.25)
    return cv.final()

BUSHES = {
    "raspberry_bush":  (lambda: nature.bush(81, berries="raspberry", rp="leaf"), lambda: nature.bush(81, None, rp="leaf")),
    "blackberry_bush": (lambda: nature.bush(83, berries="blackberry", rp="grass_deep"), lambda: nature.bush(83, None, rp="grass_deep")),
    "strawberry_bush": (lambda: strawberry_patch(True), lambda: strawberry_patch(False)),
    "fiber_bush":      (lambda: fiber_bush(), None),
    "dry_shrub":       (lambda: dry_shrub(), None),
}

# ------------------------------------------------------------------ logs / stumps
def log(seed=71, moss=False):
    cv = Canvas(PW, PH, seed=seed); cx = PW / 2; base = PB
    cv.shadow(cx, base - 2, 22, 6)
    x0, y0, x1, y1, r = cx - 18, base - 10, cx + 17, base - 4, 6.0
    m = cv.part(capsule_pts(x0, y0, x1, y1, r, r * 0.92), "rotwood" if moss else "bark", lw=1.1, shade=0.3, hl=0.2)
    b = ramp("bark")
    for t in (0.2, 0.45, 0.7):
        x = x0 + (x1 - x0) * t; y = y0 + (y1 - y0) * t
        cv.line([(x - 4, y - 3.5), (x + 3, y - 2.5)], b[2], 0.6, clip=m)
    cv.part(circ(x1 + 0.5, y1, 3.6, r * 0.95, wob=0.04), "wood", lw=0.9, shade=0.1, hl=0.1)
    for rr in (2.4, 1.2): cv.line(circ(x1 + 0.5, y1, rr, rr * 1.5, wob=0.08, n=20) + [circ(x1 + 0.5, y1, rr, rr * 1.5, wob=0.08, n=20)[0]], ramp("wood")[2], 0.45)
    cv.part(capsule_pts(x0 + 8, y0 - 4, x0 + 3, y0 - 11, 1.6, 1.0), "bark", lw=0.8, shade=0.3, hl=0.2)  # branch stub
    if moss:
        for i, (t, w) in enumerate([(0.15, 7), (0.5, 9), (0.8, 6)]):
            x = x0 + (x1 - x0) * t; y = y0 + (y1 - y0) * t - r * 0.75
            cv.part(scallop(x, y, w, 2.6, bumps=7, depth=0.2, seed=seed + i), "moss", lw=0.7, shade=0.3, hl=0.25, clip=None)
        nature_caps(cv, x0 + 2, y0 + 4, 2.6); nature_caps(cv, x0 + 7, y0 + 6, 1.8)
        for (dx, dy) in [(-20, 1), (20, 2)]:
            for j in range(3): cv.line([(cx + dx + j * 1.8, base + dy), (cx + dx + j * 1.8 - 1 + j, base + dy - 4)], ramp("moss")[2], 0.8)
    return cv.final()

def nature_caps(cv, x, y, r):
    cv.part(capsule_pts(x, y + r, x, y - r * 0.2, r * 0.35, r * 0.3), "cloth_cream", lw=0.6, shade=0.3, hl=0.2)
    pts = [(x + math.cos(math.pi + t / 10 * math.pi) * r, y + math.sin(math.pi + t / 10 * math.pi) * r * 0.8) for t in range(11)]
    m = cv.part(pts, "mush_red", lw=0.7, shade=0.3, hl=0.2)
    cv.fill(circ(x - r * 0.35, y - r * 0.35, r * 0.22, wob=0), (255, 248, 240), clip=m)

def rotten_stump(seed=73):
    cv = Canvas(PW, PH, seed=seed); cx = PW / 2; base = PB
    cv.shadow(cx + 1, base, 15, 5)
    poly, _ = trunk_poly(cx, base, 18, 16, 14, 1, seed)
    m = cv.part(poly, "rotwood", lw=1.1, shade=0.35, hl=0.2)
    top = [(cx - 7.5, base - 17), (cx - 4, base - 21), (cx - 1, base - 18), (cx + 2, base - 23), (cx + 5, base - 19), (cx + 7.5, base - 18), (cx + 7, base - 15), (cx - 7, base - 15)]
    cv.part(top, "wood_dark", lw=0.9, shade=0.2, hl=0.1)
    cv.fill(circ(cx - 1, base - 9, 2.6, 3.4, wob=0.05), ramp("ink")[3])              # hollow
    for dx in (-2, 0.4): cv.fill(circ(cx - 1 + dx, base - 9.5, 0.55, 0.75, wob=0), ramp("eerie")[1])   # peeking eyes
    cv.part(scallop(cx + 5, base - 15, 4.5, 2.0, bumps=6, depth=0.2, seed=2), "moss", lw=0.6, shade=0.3, hl=0.25)
    nature_caps(cv, cx + 9, base - 3, 2.6); nature_caps(cv, cx + 12, base - 1, 1.7)
    for dx in (-9, -6): cv.part(ellipse_pts(cx + dx, base - 6 - dx * 0.2, 2.6, 1.0, rot=0.1, n=12), "fur_brown", lw=0.6, shade=0.3, hl=0.2)  # shelf fungus
    return cv.final()

LOGS = {
    "fallen_log":   (lambda: log(71, False), None),
    "mossy_log":    (lambda: log(75, True), None),
    "rotten_stump": (lambda: rotten_stump(), None),
}
