"""Trees, bushes, rocks, ores, plants & forage - toon parts."""
import math, numpy as np
from PIL import Image, ImageChops
from toon import Canvas, ellipse_pts, capsule_pts, SS, lerp
from palette import ramp, hex2rgb, RAMPS

def circ(x, y, r, ry=None, rot=0, wob=0.06, seed=0, n=40): return ellipse_pts(x, y, r, ry or r, rot, n=n, wob=wob, seed=seed)

def trunk_poly(x0, y0, h, w0, w1, bend, seed, roots=True):
    """twisty tapered trunk from base (x0,y0) up h px; bend = lateral S amplitude."""
    rng = np.random.default_rng(seed); L, R = [], []
    n = 14
    for i in range(n + 1):
        t = i / n; y = y0 - h * t
        cx = x0 + bend * math.sin(t * math.pi * 1.3 + 0.4) * t
        w = w0 + (w1 - w0) * t ** 0.8
        if roots and t < 0.18: w += (0.18 - t) * 28
        L.append((cx - w / 2, y)); R.append((cx + w / 2, y))
    top = (x0 + bend * math.sin(1.3 * math.pi + 0.4), y0 - h)
    return L + R[::-1], top

def leaf_ticks(cv, x, y, r, rp, n=5, seed=0):
    rng = np.random.default_rng(seed); c = ramp(rp)
    for _ in range(n):
        a = rng.random() * 6.28; d = rng.random() * r * 0.65
        px, py = x + math.cos(a) * d, y + math.sin(a) * d * 0.8
        cv.line([(px - 1.2, py + 0.6), (px, py - 0.4), (px + 1.2, py + 0.6)], c[2] if py > y else c[0], 0.6, alpha=200)

def tree_oak(frame=0, seed=3, rp="leaf", fruit=None, W=96, H=128, base=118):
    cv = Canvas(W, H, seed=seed + frame)
    sway = [0, 1.0, 1.6, 1.0][frame % 4]
    cx = W / 2
    cv.shadow(cx + 2, base, 26, 9)
    poly, top = trunk_poly(cx, base, 60, 13, 7, 4, seed)
    cv.part(poly, "bark", lw=1.1, shade=0.35, hl=0.25)
    b = ramp("bark")
    for k in range(3):  # bark lines
        yy = base - 12 - k * 13
        cv.line([(cx - 3 + k, yy), (cx - 1 + k, yy - 7)], b[2], 0.6)
    cv.fill(circ(cx + 1, base - 22, 2.2, 3.0, wob=0.0), b[3])  # knot hole
    # branches
    for (sx, sy, ex, ey) in [(cx + 1, base - 42, cx + 17, base - 60), (cx - 1, base - 48, cx - 18, base - 64)]:
        cv.part(capsule_pts(sx, sy, ex + sway * 0.5, ey, 2.4, 1.4), "bark", lw=0.9, shade=0.3, hl=0.2)
    # crown clumps (back -> front), offsets sway with height
    clumps = [(-18, -72, 17, 2), (17, -74, 17, 2), (0, -92, 20, 1), (-21, -88, 14, 1), (19, -90, 14, 1),
              (-9, -70, 17, 0), (11, -68, 16, 0), (2, -80, 17, 0), (-6, -101, 13, 0), (9, -102, 12, 0)]
    c = ramp(rp)
    for i, (dx, dy, r, layer) in enumerate(clumps):
        k = (-dy - 60) / 45; x = cx + dx + sway * k; y = base + dy - 6
        shade_c = c[2] if layer == 2 else None
        cv.part(circ(x, y, r, r * 0.9, wob=0.09, seed=seed * 10 + i, n=56), rp, lw=1.1, shade=0.24, hl=0.12,
                base_col=shade_c, shade_col=c[3] if layer == 2 else None)
        leaf_ticks(cv, x, y, r, rp, 4, seed + i)
    if fruit:
        rng = np.random.default_rng(seed)
        for i in range(6):
            x = cx + rng.uniform(-24, 24) + sway; y = base - rng.uniform(64, 100)
            cv.part(circ(x, y, 2.6, wob=0.02), fruit, lw=0.7, shade=0.3, hl=0.0, gloss=[(x - 0.8, y - 0.9, 0.8, 0.6)])
    return cv.final()

def tree_pine(frame=0, seed=5, W=96, H=128, base=118):
    cv = Canvas(W, H, seed=seed + frame)
    sway = [0, 1.0, 1.6, 1.0][frame % 4]
    cx = W / 2
    cv.shadow(cx + 2, base, 22, 8)
    poly, top = trunk_poly(cx, base, 34, 10, 6, 2, seed)
    cv.part(poly, "bark", lw=1.1, shade=0.35, hl=0.25)
    tiers = [(0, 30, 28, 22), (1, 50, 23, 20), (2, 68, 18, 18), (3, 84, 12, 15)]
    for (i, yb, hw, th) in tiers:
        k = yb / 90; ox = cx + sway * k * 1.2; y = base - yb
        pts = []
        # droopy rounded tier with scalloped bottom
        for j in range(9):
            t = j / 8; x = ox - hw + 2 * hw * t; pts.append((x, y + 3.5 * math.sin(t * math.pi * 4) ** 2 * 0.6 + 2 * math.sin(t * math.pi)))
        tip = (ox + (1.5 if i == 3 else 0.5), y - th - (6 if i == 3 else 0))
        pts = [tip] + [(ox + hw * 0.45, y - th * 0.45)] + pts[::-1] + [(ox - hw * 0.45, y - th * 0.45)]
        pts = [(ox - hw * 0.5, y - th * 0.5), tip, (ox + hw * 0.5, y - th * 0.5)] + pts[2:-1][::-1][::-1]
        poly = [tip, (ox + hw * 0.55, y - th * 0.45), (ox + hw, y)]
        for j in range(8, -1, -1):
            t = j / 8; x = ox - hw + 2 * hw * t
            poly.append((x, y + 2.5 * abs(math.sin(t * math.pi * 3.5)) + 1.5 * math.sin(t * math.pi)))
        poly += [(ox - hw, y), (ox - hw * 0.55, y - th * 0.45)]
        cv.part(poly, "pine", lw=1.1, shade=0.24, hl=0.14)
        p = ramp("pine")
        for s in (-1, 1):
            cv.line([(ox + s * hw * 0.3, y - th * 0.25), (ox + s * hw * 0.55, y - 1)], p[2] if s > 0 else p[0], 0.7, alpha=200)
    # curly tip (whimsy)
    t3 = (cx + sway * 1.2 + 1.5, base - 84 - 21)
    cv.line([t3, (t3[0] + 2, t3[1] - 3), (t3[0] + 4.5, t3[1] - 2.5), (t3[0] + 4, t3[1] - 0.5)], ramp("pine")[3], 1.1)
    return cv.final()

def tree_twisty(seed=9, W=96, H=128, base=118):
    """Don't-Starve-ish spooky-cute twisted tree with lilac leaves and glowing hanging lanterns (fruit)."""
    cv = Canvas(W, H, seed=seed)
    cx = W / 2
    cv.shadow(cx + 2, base, 22, 8)
    poly, top = trunk_poly(cx, base, 66, 12, 5, 10, seed)
    cv.part(poly, "bark", lw=1.1, shade=0.35, hl=0.25, base_col=ramp("wood_dark")[1], shade_col=ramp("wood_dark")[2])
    # curly branches
    for (sx, sy, pts) in [(cx + 6, base - 52, [(14, -8), (22, -6), (24, -12), (20, -15)]), (cx + 2, base - 60, [(-12, -10), (-20, -8), (-23, -14), (-19, -17)])]:
        p = [(sx, sy)] + [(sx + dx, sy + dy) for dx, dy in pts]
        for a, b in zip(p, p[1:]): cv.part(capsule_pts(a[0], a[1], b[0], b[1], 2.0, 1.4), "wood_dark", lw=0.9, shade=0.3, hl=0.2)
    clumps = [(-14, -78, 14), (14, -80, 13), (0, -94, 16), (-5, -73, 12), (8, -104, 10)]
    for i, (dx, dy, r) in enumerate(clumps):
        cv.part(circ(cx + dx + 3, base + dy, r, r * 0.85, wob=0.14, seed=seed + i, n=60), "cloth_purple", lw=1.1, shade=0.26, hl=0.14,
                base_col=ramp("zomb_lilac")[1], shade_col=ramp("zomb_lilac")[2], hl_col=ramp("zomb_lilac")[0])
        leaf_ticks(cv, cx + dx + 3, base + dy, r, "zomb_lilac", 3, seed + i)
    for (x, y) in [(cx + 22, base - 64), (cx - 19, base - 70), (cx + 8, base - 80)]:
        cv.line([(x, y - 6), (x, y - 1)], ramp("ink")[1], 0.6)
        cv.part(circ(x, y + 1.5, 2.6, 3.0, wob=0.02), "eerie", lw=0.7, shade=0.2, hl=0.0, gloss=[(x - 0.8, y + 0.6, 0.9, 0.9)])
    return cv.final()

def stump(seed=11, W=96, H=128, base=118):
    cv = Canvas(W, H, seed=seed); cx = W / 2
    cv.shadow(cx + 2, base, 15, 6)
    poly, _ = trunk_poly(cx, base, 14, 15, 14, 0, seed)
    cv.part(poly, "bark", lw=1.1, shade=0.35, hl=0.2)
    m = cv.part(circ(cx, base - 14, 8.3, 3.4, wob=0.05), "wood", lw=0.9, shade=0.1, hl=0.1)
    for r in (5.5, 3.0): cv.line([(p[0], p[1]) for p in circ(cx + 0.5, base - 14, r, r * 0.4, wob=0.08, n=24)] + [circ(cx + 0.5, base - 14, r, r * 0.4, wob=0.08, n=24)[0]], ramp("wood")[2], 0.5)
    cv.part(circ(cx + 7, base - 4, 2.2, 1.6), "mush_red", lw=0.7, shade=0.3, hl=0.2)
    return cv.final()

def rock(big=True, seed=13, W=64, H=64, base=56, rp="stone", ore=None, moss=True):
    cv = Canvas(W, H, seed=seed); cx = W / 2
    s = 1.0 if big else 0.55
    cv.shadow(cx + 1, base, 22 * s, 7 * s)
    # chunky faceted blob
    pts = []
    rng = np.random.default_rng(seed)
    n = 9
    for i in range(n):
        a = math.pi + i / (n - 1) * math.pi
        rr = (20 if big else 11) * rng.uniform(0.85, 1.05)
        pts.append((cx + math.cos(a) * rr * 1.1, base - 3 * s - abs(math.sin(a)) * rr * 1.15 + rng.uniform(-1, 1)))
    pts += [(cx + 22 * s, base - 2 * s), (cx + 10 * s, base + 1.5 * s), (cx - 12 * s, base + 1.2 * s), (cx - 22 * s, base - 2 * s)]
    m = cv.part(pts, rp, lw=1.2, shade=0.3, hl=0.16)
    c = ramp(rp)
    # facet lines
    cv.line([(cx - 6 * s, base - 30 * s), (cx + 2 * s, base - 14 * s), (cx + 14 * s, base - 9 * s)], c[2], 0.7, clip=m)
    cv.line([(cx + 2 * s, base - 14 * s), (cx - 3 * s, base - 2 * s)], c[2], 0.6, clip=m)
    cv.fill(circ(cx - 9 * s, base - 26 * s, 4 * s, 2.2 * s, rot=-0.5), c[0], clip=m, alpha=220)
    if ore:
        o = ramp(ore)
        for (dx, dy, r) in [(-8, -15, 3.2), (6, -22, 2.6), (10, -8, 2.2), (-2, -6, 1.8)]:
            x, y = cx + dx * s * 1.1, base + dy * s
            cv.part(ellipse_pts(x, y, r * 1.1, r * 0.8, rot=0.6, n=6), ore, lw=0.7, shade=0.3, hl=0.25, clip=m)
            cv.fill(circ(x - r * 0.3, y - r * 0.3, r * 0.3, wob=0), (255, 255, 255), alpha=200, clip=m)
    if moss:
        g = ramp("grass")
        cv.part(circ(cx - 5 * s, base - 25 * s if big else base - 13, 9 * s, 3.0 * s, wob=0.2, seed=seed), "grass", lw=0.8, shade=0.3, hl=0.2, clip=None)
        for k in range(4):
            x = cx - 18 * s + k * 10 * s
            cv.line([(x, base), (x - 1, base - 4)], g[2], 0.9); cv.line([(x + 1.5, base), (x + 2.5, base - 3)], g[3], 0.8)
    return cv.final()

def loose_rocks(seed=15, W=64, H=64, base=56):
    cv = Canvas(W, H, seed=seed); cx = W / 2
    cv.shadow(cx, base - 1, 16, 5)
    for i, (dx, dy, r) in enumerate([(-8, -3, 6), (6, -2, 5), (0, -6, 5.5), (10, -6, 3.5), (-12, -1, 3)]):
        cv.part(circ(cx + dx, base + dy - r * 0.4, r * 1.1, r * 0.8, wob=0.12, seed=seed + i, n=10), "stone", lw=1.0, shade=0.3, hl=0.2)
    return cv.final()

def bush(seed=17, berries=None, W=64, H=64, base=56, rp="leaf", eyes=False):
    cv = Canvas(W, H, seed=seed); cx = W / 2
    cv.shadow(cx + 1, base, 21, 6)
    c = ramp(rp)
    for i, (dx, dy, r, back) in enumerate([(-12, -12, 10, 1), (11, -13, 10, 1), (0, -22, 12, 1), (-8, -9, 11, 0), (9, -9, 11, 0), (0, -16, 11, 0)]):
        cv.part(circ(cx + dx, base + dy - 2, r, r * 0.88, wob=0.1, seed=seed + i, n=50), rp, lw=1.1, shade=0.26, hl=0.12,
                base_col=c[2] if back else None, shade_col=c[3] if back else None)
        leaf_ticks(cv, cx + dx, base + dy - 2, r, rp, 3, seed + i)
    if berries:
        rng = np.random.default_rng(seed)
        for (dx, dy) in [(-12, -14), (-4, -26), (6, -20), (13, -12), (-2, -10), (8, -6), (-14, -6), (2, -18)]:
            x, y = cx + dx, base + dy
            for j in range(3):
                bx, by = x + (j - 1) * 2.2, y + (j % 2) * 1.6
                cv.part(circ(bx, by, 2.0, wob=0.0, n=16), berries, lw=0.6, shade=0.35, hl=0.0, gloss=[(bx - 0.6, by - 0.7, 0.6, 0.5)])
            cv.part(circ(x + 0.2, y - 2.6, 1.6, 0.8, rot=0.4, wob=0), "leaf", lw=0.4, shade=0.2, hl=0.1)
    if eyes:  # night-peeking eyes (eerie, decorative)
        for dx in (-3, 3):
            cv.fill(circ(cx + dx, base - 14, 1.4, 1.8, wob=0), ramp("eerie")[1])
    return cv.final()

def fiber_grass(seed=19, W=64, H=64, base=56):
    cv = Canvas(W, H, seed=seed); cx = W / 2
    cv.shadow(cx, base, 14, 4)
    rng = np.random.default_rng(seed); c = ramp("grass")
    for i in range(13):
        x = cx + rng.uniform(-12, 12); h = rng.uniform(16, 30); lean = rng.uniform(-8, 8)
        pts = [(x - 1.6, base), (x + lean * 0.5, base - h * 0.6), (x + lean, base - h), (x + lean * 0.5 + 0.6, base - h * 0.55), (x + 1.6, base)]
        rp = "grass" if i % 3 else "cloth_green"
        cv.part(pts, rp, lw=0.8, shade=0.3, hl=0.25)
    for i in range(3):  # seed heads
        x = cx + rng.uniform(-8, 8); y = base - rng.uniform(26, 32)
        cv.part(circ(x, y, 1.6, 3.4, rot=0.3, wob=0.05), "thatch", lw=0.7, shade=0.3, hl=0.2)
    return cv.final()

def fallen_branches(seed=21, W=64, H=64, base=56):
    cv = Canvas(W, H, seed=seed); cx = W / 2
    cv.shadow(cx, base - 2, 18, 5)
    for (x0, y0, x1, y1, r) in [(-16, -2, 14, -8, 2.6), (-12, -9, 16, -1, 2.2), (-4, -12, 6, -4, 1.8)]:
        cv.part(capsule_pts(cx + x0, base + y0, cx + x1, base + y1, r, r * 0.7), "bark", lw=0.9, shade=0.35, hl=0.25)
    cv.part(circ(cx + 14, base - 9, 3.0, 1.6, rot=0.6), "leaf", lw=0.7, shade=0.3, hl=0.2)
    cv.part(circ(cx - 14, base - 4, 2.6, 1.4, rot=-0.5), "leaf_autumn", lw=0.7, shade=0.3, hl=0.2)
    return cv.final()

def mushrooms(seed=23, glow=False, W=64, H=64, base=56):
    cv = Canvas(W, H, seed=seed); cx = W / 2
    cv.shadow(cx, base, 13, 4)
    caps = "mush_glow" if glow else "mush_red"
    for i, (dx, h, r) in enumerate([(-7, 10, 6.5), (6, 15, 8.5), (12, 6, 4.0), (-1, 5, 3.6)]):
        x = cx + dx; y = base - h
        cv.part(capsule_pts(x, base - 1, x + 0.6 * (i % 2), y, 2.2 * (r / 7), 1.8 * (r / 7)), "cloth_cream", lw=0.9, shade=0.3, hl=0.2)
        pts = [(x - r, y + 1)] + [(x + math.cos(math.pi + t / 12 * math.pi) * r, y + 1 + math.sin(math.pi + t / 12 * math.pi) * r * (0.75 if not glow else 0.95)) for t in range(13)] + [(x + r, y + 1), (x, y + 2.4)]
        m = cv.part(pts, caps, lw=1.0, shade=0.3, hl=0.2)
        for (sx, sy, sr) in [(-0.45, -0.35, 0.22), (0.25, -0.55, 0.16), (0.45, -0.1, 0.13)]:
            cv.fill(circ(x + sx * r, y + sy * r, sr * r, sr * r * 0.8, wob=0), (255, 248, 240) if not glow else ramp("mush_glow")[0], clip=m)
    return cv.final()

def flowers(seed=25, W=64, H=64, base=56):
    cv = Canvas(W, H, seed=seed); cx = W / 2
    rng = np.random.default_rng(seed)
    cols = ["flower_pink", "flower_yel", "flower_blue", "flower_pink", "berry"]
    for i in range(6):
        x = cx + rng.uniform(-14, 14); h = rng.uniform(8, 16); y = base - h
        cv.line([(x, base), (x + rng.uniform(-1.5, 1.5), y)], ramp("grass")[3], 1.0)
        cv.part(circ(x + 2, base - h * 0.45, 2.2, 1.0, rot=-0.5, wob=0), "leaf", lw=0.5, shade=0.2, hl=0.2)
        rp = cols[i % len(cols)]
        for a in range(5):
            ang = a * 1.2566 + i; px, py = x + math.cos(ang) * 2.3, y + math.sin(ang) * 2.0
            cv.part(circ(px, py, 1.8, 1.6, wob=0, n=14), rp, lw=0.55, shade=0.2, hl=0.1)
        cv.fill(circ(x, y, 1.2, wob=0), ramp("flower_yel")[0])
    return cv.final()

def berry_bush(full=True, seed=27):
    return bush(seed, berries="berry" if full else None)

def scallop(x, y, r, ry=None, bumps=9, depth=0.08, seed=0, n=72, rot=0.0):
    ry = ry or r * 0.9; rng = np.random.default_rng(abs(seed)); ph = rng.random() * 6.28
    pts = []
    for i in range(n):
        a = i / n * 2 * math.pi
        k = 1 + depth * (abs(math.sin(a * bumps / 2 + ph)) - 0.5) * 2 + 0.04 * math.sin(3 * a + ph)
        pts.append((x + math.cos(a + rot) * r * k, y + math.sin(a + rot) * ry * k))
    return pts

def tree_oak(frame=0, seed=3, rp="leaf", fruit=None, W=96, H=128, base=118):
    """Unified leafy crown mass + inner highlight clusters (Stardew-like readability, DS-like wobbly ink)."""
    cv = Canvas(W, H, seed=seed + frame)
    cx = W / 2; c = ramp(rp); rng = np.random.default_rng(seed)
    cv.shadow(cx + 2, base, 26, 9)
    poly, top = trunk_poly(cx, base, 62, 14, 7, 5, seed)
    cv.part(poly, "bark", lw=1.15, shade=0.35, hl=0.25)
    b = ramp("bark")
    for k in range(4):
        yy = base - 10 - k * 11; xx = cx - 3 + k * 1.2 + (k % 2) * 3
        cv.line([(xx, yy), (xx + 1, yy - 6)], b[2], 0.6)
    cv.fill(circ(cx + 1.5, base - 24, 2.0, 2.8, wob=0.0), b[3])
    for (sx, sy, ex, ey) in [(cx + 1, base - 44, cx + 19, base - 60), (cx - 1, base - 50, cx - 19, base - 64)]:
        cv.part(capsule_pts(sx, sy, ex, ey, 2.6, 1.5), "bark", lw=0.95, shade=0.3, hl=0.2)
    blobs = [(-22, -70, 15), (22, -72, 15), (-12, -88, 17), (12, -90, 17), (0, -101, 15), (0, -74, 18), (-25, -84, 11), (25, -86, 11), (-8, -64, 13), (10, -64, 13)]
    crown_back = cv.mask_from([scallop(cx + dx + 3, base + dy - 2, r, bumps=8, seed=seed + i) for i, (dx, dy, r) in enumerate(blobs[:5])])
    cv.part(None, rp, mask=crown_back, lw=1.15, shade=0.2, hl=0.0, base_col=c[2], shade_col=c[3])
    crown = cv.mask_from([scallop(cx + dx, base + dy, r, bumps=9, seed=seed + i * 3) for i, (dx, dy, r) in enumerate(blobs)])
    cv.part(None, rp, mask=crown, lw=1.2, shade=0.16, hl=0.06)
    # inner clusters: light lumps with a soft dark lower lip
    for i, (dx, dy, r) in enumerate([(-14, -92, 9), (6, -98, 8), (-20, -76, 8), (2, -80, 10), (17, -84, 8), (-6, -68, 7), (14, -68, 7)]):
        x, y = cx + dx, base + dy
        up = (dy < -85) or dx < -10
        cv.fill(scallop(x, y, r, r * 0.75, bumps=6, depth=0.12, seed=i), c[0] if up else c[1], clip=crown, alpha=235)
        arc = [(x + math.cos(a) * r * 0.95, y + math.sin(a) * r * 0.72) for a in np.linspace(0.2, math.pi - 0.2, 10)]
        cv.line(arc, c[2], 0.7, clip=crown, alpha=210)
        leaf_ticks(cv, x, y - 1, r * 0.8, rp, 3, seed + i)
    if fruit:
        for i in range(7):
            x = cx + rng.uniform(-24, 24); y = base - rng.uniform(64, 98)
            cv.part(circ(x, y, 2.6, wob=0.02), fruit, lw=0.7, shade=0.3, hl=0.0, gloss=[(x - 0.8, y - 0.9, 0.8, 0.6)])
            cv.line([(x, y - 2.4), (x + 0.6, y - 4)], ramp("bark")[2], 0.5)
    return cv.final()
