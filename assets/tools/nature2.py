"""Wave 2 resources: tree growth tiers, big oak, ore veins (copper/tin/gold/coal), clay, sand dune, hide bundle, more forage."""
import math, numpy as np
from PIL import Image
from toon import Canvas, ellipse_pts, capsule_pts, SS
from palette import ramp
import nature
from nature import circ, rock, bush, leaf_ticks, scallop, trunk_poly

def scaled(im, k, W, H, base_src, base_dst):
    """shrink a rendered prop around its foot point (keeps pivot)."""
    w, h = im.size; s = im.resize((max(1, int(w * k)), max(1, int(h * k))), Image.LANCZOS)
    out = Image.new("RGBA", (W, H), (0, 0, 0, 0)); out.alpha_composite(s, (int(W / 2 - s.width / 2), int(base_dst - base_src * k)))
    return out

def tree_young(kind="oak"):
    im = nature.tree_oak(0, seed=8) if kind == "oak" else nature.tree_pine(0, seed=7)
    return scaled(im, 0.68, 96, 128, 118, 118)

def sapling(kind="oak", W=96, H=128, base=118, seed=31):
    cv = Canvas(W, H, seed=seed); cx = W / 2
    cv.shadow(cx, base, 9, 3)
    cv.part(capsule_pts(cx, base, cx + 1.5, base - 22, 1.6, 1.0), "bark", lw=0.9, shade=0.3, hl=0.2)
    cv.part(circ(cx, base + 0.5, 6, 2, wob=0.2), "dirt", lw=0.7, shade=0.2, hl=0.1)
    if kind == "oak":
        for (dx, dy, r, a) in [(-5, -16, 4.2, 0.5), (5.5, -19, 4.4, -0.5), (1.5, -25, 4.6, 0.0), (-3, -9, 3.2, 0.7), (4, -11, 3.2, -0.6)]:
            cv.part(circ(cx + dx, base + dy, r, r * 0.62, rot=a, wob=0.05), "leaf", lw=0.8, shade=0.3, hl=0.25)
            cv.line([(cx + dx - r * 0.6 * math.cos(a), base + dy - r * 0.6 * math.sin(a)), (cx + dx + r * 0.6 * math.cos(a), base + dy + r * 0.6 * math.sin(a))], ramp("leaf")[2], 0.5)
    else:
        for i, (yb, hw) in enumerate([(8, 8), (14, 6.5), (20, 5), (25, 3.2)]):
            y = base - yb
            cv.part([(cx - hw, y + 3), (cx + 1, y - 6), (cx + hw, y + 3), (cx, y + 4.5)], "pine", lw=0.8, shade=0.3, hl=0.25)
    # tiny ribbon tag: "planted by someone"
    cv.part(capsule_pts(cx - 0.5, base - 6, cx + 4, base - 4, 0.9), "cloth_red", lw=0.5, shade=0.2, hl=0.2)
    return cv.final()

def big_oak(seed=12, W=128, H=160, base=150):
    """ancient hardwood oak: bigger crown, gnarled roots, a knot-hole with peeking glowing eyes (eerie touch)."""
    cv = Canvas(W, H, seed=seed); cx = W / 2; c = ramp("leaf"); rng = np.random.default_rng(seed)
    cv.shadow(cx + 3, base, 36, 12)
    poly, top = trunk_poly(cx, base, 84, 22, 11, 7, seed)
    cv.part(poly, "bark", lw=1.25, shade=0.35, hl=0.25)
    b = ramp("bark")
    for k in range(6):
        yy = base - 12 - k * 12; xx = cx - 5 + k * 1.3 + (k % 2) * 5
        cv.line([(xx, yy), (xx + 1.5, yy - 8)], b[2], 0.7)
    cv.part(circ(cx + 2, base - 34, 4.0, 5.2, wob=0.05), "ink", lw=0.8, shade=0.1, hl=0.0, flat=True)
    for dx in (-1.3, 1.6): cv.fill(circ(cx + 2 + dx, base - 35, 0.9, 1.2, wob=0), ramp("eerie")[1])
    for (sx, sy, ex, ey) in [(cx + 2, base - 60, cx + 28, base - 82), (cx - 2, base - 66, cx - 28, base - 86), (cx, base - 74, cx + 6, base - 100)]:
        cv.part(capsule_pts(sx, sy, ex, ey, 3.6, 2.0), "bark", lw=1.0, shade=0.3, hl=0.2)
    blobs = [(-30, -92, 19), (30, -95, 19), (-16, -116, 22), (16, -118, 22), (0, -132, 18), (0, -98, 24), (-34, -110, 14), (34, -112, 14), (-12, -84, 16), (13, -84, 16)]
    back = cv.mask_from([scallop(cx + dx + 4, base + dy + 6, r, bumps=8, seed=seed + i) for i, (dx, dy, r) in enumerate(blobs[:5])])
    cv.part(None, "leaf", mask=back, lw=1.2, shade=0.2, hl=0.0, base_col=c[2], shade_col=c[3])
    crown = cv.mask_from([scallop(cx + dx, base + dy + 9, r, bumps=10, seed=seed + i * 3) for i, (dx, dy, r) in enumerate(blobs)])
    cv.part(None, "leaf", mask=crown, lw=1.25, shade=0.16, hl=0.06)
    for i, (dx, dy, r) in enumerate([(-18, -120, 12), (8, -128, 10), (-26, -100, 10), (3, -104, 13), (22, -110, 10), (-8, -88, 9), (18, -88, 9), (-30, -116, 7)]):
        x, y = cx + dx, base + dy + 9; up = dy < -112 or dx < -14
        cv.fill(scallop(x, y, r, r * 0.75, bumps=6, depth=0.12, seed=i), c[0] if up else c[1], clip=crown, alpha=235)
        cv.line([(x + math.cos(a) * r * 0.95, y + math.sin(a) * r * 0.72) for a in np.linspace(0.2, math.pi - 0.2, 10)], c[2], 0.7, clip=crown, alpha=210)
        leaf_ticks(cv, x, y - 1, r * 0.8, "leaf", 4, seed + i)
    for i in range(5):   # acorns
        x = cx + rng.uniform(-30, 30); y = base - rng.uniform(80, 116)
        cv.part(circ(x, y + 1, 2.0, 2.4, wob=0), "wood", lw=0.6, shade=0.3, hl=0.2); cv.part(circ(x, y - 1, 2.4, 1.3, wob=0), "bark", lw=0.6, shade=0.3, hl=0.2)
    return cv.final()

ORE = {"copper_vein": ("copper", "stone", 41), "tin_vein": ("slate", "stone", 43), "gold_vein": ("gold", "cobble", 47), "coal_seam": ("hair_black", "stone", 53)}
def ore_vein(key):
    ore, rp, seed = ORE[key]
    im = rock(True, seed=seed, rp=rp, ore=ore)
    if key in ("copper_vein", "gold_vein"):   # sparkle / patina accents
        cv = Canvas(64, 64, seed=seed)
        if key == "copper_vein":
            for (x, y, r) in [(22, 34, 1.6), (40, 28, 1.3), (30, 46, 1.2)]: cv.part(circ(x, y, r, r * 0.8, wob=0.1), "patina", lw=0.5, shade=0.3, hl=0.2)
        else:
            from chars import star
            for (x, y, r) in [(24, 27, 2.0), (41, 37, 1.6)]: star(cv, x, y, r, "glow")
        im = Image.alpha_composite(im, cv.final())
    return im

def clay_deposit(seed=61, W=64, H=64, base=56):
    cv = Canvas(W, H, seed=seed); cx = W / 2
    cv.shadow(cx, base, 22, 6)
    cv.part(circ(cx + 12, base - 1, 9, 3.2, wob=0.15, seed=2), "water", lw=0.8, shade=0.2, hl=0.3, gloss=[(cx + 9, base - 2, 2.5, 0.7)])   # wet puddle
    for i, (dx, dy, rx, ry) in enumerate([(-8, -8, 13, 8), (6, -11, 12, 9), (-2, -17, 9, 7)]):
        m = cv.part(circ(cx + dx, base + dy, rx, ry, wob=0.12, seed=seed + i), "clay", lw=1.1, shade=0.3, hl=0.15, gloss=[(cx + dx - rx * 0.4, base + dy - ry * 0.5, rx * 0.25, ry * 0.15)])
        for k in range(3):   # smooth scoop marks (someone dug here)
            y = base + dy - ry * 0.2 + k * 2.5
            cv.line([(cx + dx - rx * 0.5, y), (cx + dx, y + 1.2), (cx + dx + rx * 0.5, y)], ramp("clay")[2], 0.55, clip=m, alpha=180)
    cv.part(capsule_pts(cx - 16, base - 3, cx - 12, base - 6, 1.6), "clay", lw=0.6, shade=0.3, hl=0.2)
    for k in range(4):
        x = cx - 20 + k * 12; g = ramp("grass")
        cv.line([(x, base + 1), (x - 1, base - 4)], g[2], 0.9); cv.line([(x + 1.5, base + 1), (x + 2.5, base - 3)], g[3], 0.8)
    return cv.final()

def sand_dune(seed=63, W=64, H=64, base=56):
    cv = Canvas(W, H, seed=seed); cx = W / 2
    cv.shadow(cx, base, 24, 6, alpha=0.2)
    m = cv.part([(cx - 26, base), (cx - 12, base - 13), (cx + 2, base - 18), (cx + 16, base - 10), (cx + 27, base)], "sand", lw=1.0, shade=0.3, hl=0.15)
    for k in range(4):
        y = base - 4 - k * 3.5; cv.line([(cx - 18 + k * 3, y), (cx - 4 + k * 2, y - 2), (cx + 12 - k * 2, y)], ramp("sand")[2], 0.55, clip=m, alpha=170)
    for (x, y) in [(cx - 14, base - 9), (cx + 14, base - 6)]:
        for a in (-0.5, 0, 0.5): cv.line([(x, y), (x + math.sin(a) * 6, y - 7 + abs(a) * 2)], ramp("grass")[2], 0.9)
    cv.part(circ(cx + 6, base - 3, 3, 2, wob=0.1), "flower_pink", lw=0.6, shade=0.3, hl=0.25)   # seashell-ish
    cv.line([(cx + 4, base - 3), (cx + 6, base - 4.6), (cx + 8, base - 3)], ramp("flower_pink")[2], 0.4)
    return cv.final()

def hide_bundle(seed=65, W=64, H=64, base=56):
    """animal_carcass node (blood-free): a rolled hide tied with twine + a cartoon bone + feather."""
    cv = Canvas(W, H, seed=seed); cx = W / 2
    cv.shadow(cx, base, 20, 5)
    m = cv.part(scallop(cx - 2, base - 9, 16, 9, bumps=7, depth=0.1, seed=3), "hide", lw=1.1, shade=0.3, hl=0.15)
    for (x, y, r) in [(cx - 9, base - 12, 2.2), (cx + 4, base - 7, 2.6), (cx - 2, base - 15, 1.8)]: cv.fill(circ(x, y, r, r * 0.7, wob=0.2), ramp("hide")[2], clip=m, alpha=170)
    cv.part(capsule_pts(cx - 4, base - 18, cx - 1, base - 1, 1.3), "thatch", lw=0.6, shade=0.2, hl=0.2)
    bx, by = cx + 13, base - 4
    cv.part(capsule_pts(bx - 7, by + 1, bx + 6, by - 3, 1.5), "cloth_cream", lw=0.8, shade=0.25, hl=0.25)
    for (x, y) in [(bx - 7, by + 1), (bx + 6, by - 3)]:
        for d in (-1.3, 1.3): cv.part(circ(x, y + d, 1.6, wob=0), "cloth_cream", lw=0.7, shade=0.25, hl=0.25)
    cv.part([(cx - 14, base - 16), (cx - 20, base - 26), (cx - 16, base - 25), (cx - 12, base - 17)], "cloth_teal", lw=0.6, shade=0.3, hl=0.3)
    return cv.final()

def carrot_patch(seed=67, W=64, H=64, base=56):
    cv = Canvas(W, H, seed=seed); cx = W / 2
    cv.shadow(cx, base, 18, 5, alpha=0.2)
    cv.part(circ(cx, base - 2, 18, 6, wob=0.12), "dirt", lw=0.9, shade=0.25, hl=0.15)
    for i, (dx, dy) in enumerate([(-9, -3), (0, -5), (9, -2), (-4, 1), (6, 2)]):
        x, y = cx + dx, base + dy - 2
        cv.part(circ(x, y + 0.5, 2.6, 1.6, wob=0), "carrot", lw=0.7, shade=0.3, hl=0.25)
        for a in (-0.5, 0.0, 0.5):
            tip = (x + math.sin(a) * 7, y - 10 + abs(a) * 3)
            cv.part([(x - 0.8, y), (tip[0] - 1.6, tip[1] + 2), tip, (tip[0] + 1.6, tip[1] + 2), (x + 0.8, y)], "leaf", lw=0.6, shade=0.3, hl=0.25)
    return cv.final()

def wild_herbs(seed=69, W=64, H=64, base=56):
    cv = Canvas(W, H, seed=seed); cx = W / 2; rng = np.random.default_rng(seed)
    cv.shadow(cx, base, 14, 4)
    for i in range(9):
        x = cx + rng.uniform(-11, 11); h = rng.uniform(9, 18)
        cv.line([(x, base), (x + rng.uniform(-2, 2), base - h)], ramp("grass")[3], 0.9)
        for j in range(3):
            y = base - h * (0.35 + j * 0.25); s = 1 if j % 2 else -1
            cv.part(circ(x + s * 2.2, y, 2.4, 1.3, rot=s * 0.6, wob=0), "cloth_green" if i % 2 else "leaf", lw=0.5, shade=0.3, hl=0.25)
        if i % 3 == 0:
            for k in range(3): cv.fill(circ(x + (k - 1) * 1.2, base - h - 1 - (k % 2), 1.0, wob=0), ramp("flower_blue")[1])
    return cv.final()

def blueberry_bush(full=True, seed=71): return bush(seed, berries="berry_blue" if full else None, rp="pine")

def reeds(seed=73, W=64, H=64, base=56):
    cv = Canvas(W, H, seed=seed); cx = W / 2; rng = np.random.default_rng(seed)
    cv.part(circ(cx, base - 1, 17, 5, wob=0.1), "water", lw=0.8, shade=0.2, hl=0.3, gloss=[(cx - 6, base - 2, 3, 0.8)])
    for i in range(10):
        x = cx + rng.uniform(-12, 12); h = rng.uniform(22, 36); lean = rng.uniform(-4, 4)
        cv.part([(x - 1.2, base), (x + lean, base - h), (x + 1.2, base)], "grass_deep" if i % 2 else "grass", lw=0.6, shade=0.3, hl=0.25)
        if i % 3 == 0: cv.part(capsule_pts(x + lean * 0.8, base - h * 0.75, x + lean * 0.9, base - h * 0.95, 1.8), "bark", lw=0.6, shade=0.3, hl=0.25)
    cv.part(circ(cx + 9, base - 3, 3.0, 1.2, wob=0), "frog", lw=0.5, shade=0.3, hl=0.2)    # lily pad
    return cv.final()

def pumpkin_patch(seed=75, W=64, H=64, base=56):
    cv = Canvas(W, H, seed=seed); cx = W / 2
    cv.shadow(cx, base, 20, 6)
    for (x0, y0, x1, y1) in [(-18, -2, 2, -6), (0, -4, 18, -1)]:
        cv.line([(cx + x0, base + y0), (cx + (x0 + x1) / 2, base + y0 - 4), (cx + x1, base + y1)], ramp("leaf")[3], 1.1)
    for (dx, dy, r) in [(-14, -6, 6), (13, -4, 4.5)]: cv.part(scallop(cx + dx, base + dy, r, r * 0.7, bumps=5, depth=0.15), "leaf", lw=0.8, shade=0.3, hl=0.2)
    m = cv.part(circ(cx, base - 9, 11, 8.5, wob=0.03), "pumpkin", lw=1.1, shade=0.28, hl=0.16)
    for dx in (-6, -2, 2, 6): cv.line([(cx + dx * 0.6, base - 17), (cx + dx * 1.3, base - 9), (cx + dx * 0.6, base - 1.5)], ramp("pumpkin")[2], 0.6, clip=m)
    cv.part(capsule_pts(cx, base - 16, cx + 1.5, base - 21, 1.6, 1.1), "bark", lw=0.7, shade=0.3, hl=0.2)
    cv.line([(cx + 1.5, base - 20), (cx + 5, base - 23), (cx + 6.5, base - 20.5)], ramp("leaf")[3], 0.6)
    cv.part(circ(cx - 11, base - 3, 4, 3.2, wob=0.03), "pumpkin", lw=0.8, shade=0.3, hl=0.2)
    return cv.final()

def flax(seed=77, W=64, H=64, base=56):
    cv = Canvas(W, H, seed=seed); cx = W / 2; rng = np.random.default_rng(seed)
    cv.shadow(cx, base, 13, 4)
    for i in range(11):
        x = cx + rng.uniform(-11, 11); h = rng.uniform(18, 30); lean = rng.uniform(-3, 3)
        cv.line([(x, base), (x + lean, base - h)], ramp("cloth_green")[2], 0.8)
        cv.part(circ(x + lean, base - h - 1.2, 1.8, 1.6, wob=0), "flower_blue", lw=0.5, shade=0.25, hl=0.25)
        cv.fill(circ(x + lean, base - h - 1.2, 0.6, wob=0), ramp("flower_yel")[0])
    return cv.final()
