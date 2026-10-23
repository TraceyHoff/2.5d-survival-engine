"""1. PvP combat effects: swing arcs (4 weapon classes x 8 facings), bonk stars, crit burst, parry/block sparks, dodge dust,
hit sparks, impact puff/flash, projectiles (+ tileable trails), KO puff, ghost wisp, downed overlay/ring, respawn sparkle."""
import math, numpy as np
from PIL import Image
from common import *

GOLD = [H(c) for c in RAMPS["gold"]]
STAR = [(255, 250, 214), (255, 222, 96), (240, 168, 52), (176, 112, 42)]
CLOUD = [(255, 252, 244), (246, 240, 240), (214, 204, 220), (160, 146, 178)]
DUST = [(255, 244, 214), (236, 214, 170), (204, 172, 128), (150, 116, 88)]
GHOST = [(255, 255, 255), (246, 242, 255), (214, 202, 242), (150, 132, 196)]
INKC = H("#3b2433")
CLASS_COL = {  # swing smear ramps (highlight, base, shade, deep)
    "blade": [(255, 255, 255), (214, 246, 255), (140, 206, 236), (64, 126, 178)],
    "blunt": [(255, 255, 240), (255, 236, 150), (246, 186, 74), (176, 110, 46)],
    "axe":   [(255, 252, 236), (255, 206, 140), (238, 132, 72), (170, 72, 52)],
    "spear": [(255, 255, 255), (220, 255, 226), (138, 222, 168), (52, 136, 110)],
}
def crescent(cx, cy, rx, ry, a0, a1, W, N=64, inner_bias=0.0):
    """smear crescent: outer edge on the ellipse, inner edge recedes; thin tail at a0, rounded fat head at a1."""
    outer, inner = [], []
    for k in range(N + 1):
        t = k / N; a = a0 + (a1 - a0) * t
        w = W * (min(1, t / 0.8) ** 1.3) * (1 if t < 0.93 else math.sqrt(max(0, 1 - ((t - 0.93) / 0.07) ** 2)) * 0.6 + 0.4)
        ca, sa = math.cos(a), math.sin(a)
        outer.append((cx + ca * (rx + w * inner_bias), cy + sa * (ry + w * inner_bias * 0.5)))
        inner.append((cx + ca * (rx - w), cy + sa * (ry - w * 0.5)))
    # rounded head cap
    ah = a1; hx0, hy0 = outer[-1]; hx1, hy1 = inner[-1]; mx, my = (hx0 + hx1) / 2, (hy0 + hy1) / 2
    rad = math.hypot(hx0 - hx1, hy0 - hy1) / 2; tang = (-math.sin(ah) * rx, math.cos(ah) * ry); tl = math.hypot(*tang) or 1
    sg = 1 if a1 > a0 else -1; tx, ty = tang[0] / tl * sg, tang[1] / tl * sg
    nx, ny = (hx0 - mx) / (rad or 1), (hy0 - my) / (rad or 1)
    cap = [(mx + (nx * math.cos(q) + tx * math.sin(q)) * rad, my + (ny * math.cos(q) + ty * math.sin(q)) * rad) for q in np.linspace(0, math.pi, 12)]
    return outer + cap + inner[::-1]

def ease_out(t): return 1 - (1 - t) ** 3

def eyes(cv, cx, cy, s=1.0, blush=True, closed=False):
    if closed:
        for dx in (-2.2 * s, 2.2 * s):
            cv.line([(cx + dx - 1.1 * s, cy), (cx + dx, cy - 0.9 * s), (cx + dx + 1.1 * s, cy)], INKC, 0.7 * s)
    else:
        for dx in (-2.2 * s, 2.2 * s):
            cv.fill(circle(cx + dx, cy, 0.95 * s, 16, 1.25 * s), INKC)
            cv.fill(circle(cx + dx - 0.3 * s, cy - 0.45 * s, 0.35 * s, 10), (255, 255, 255))
    if blush:
        for dx in (-3.9 * s, 3.9 * s): cv.fill(circle(cx + dx, cy + 1.5 * s, 1.1 * s, 14, 0.6 * s), (255, 140, 160), alpha=170)

def star(cv, cx, cy, r, rot=0.0, face=False, ramp_=STAR, lw=0.9, e=None):
    pts = rstar(cx, cy, r, r * 0.55, 5, -math.pi / 2 + rot, p=1.25)
    cv.part(pts, ramp_, lw=lw, shade=0.18, hl=0.12, gloss=[(cx - r * 0.3, cy - r * 0.35, r * 0.18, r * 0.12)])
    if e is not None: e.fill(pts, (255, 214, 90), alpha=200)
    if face and r >= 5: eyes(cv, cx, cy + r * 0.08, r / 7.5)

def twinkle(cv, cx, cy, r, col=(255, 255, 255), rot=0.0, e=None, ecol=None, ink=True):
    pts = sparkle(cx, cy, r, 0.2, rot)
    if ink: cv.part(pts, [col, col, lerp(col, (200, 170, 140), 0.25), (180, 120, 80)], lw=0.6, shade=0.1, hl=0, ink=lerp(INKC, col, 0.35))
    else: cv.fill(pts, col)
    if e is not None: e.fill(pts, ecol or col)

def puff(cv, cx, cy, r, seed, ramp_=CLOUD, k=1.0, lw=0.9, sq=0.85):
    if r < 0.8: return
    cv.part(cloud(cx, cy, r, r * sq, seed, 6, 0.5), ramp_, lw=lw, shade=0.22, hl=0.14)

# ------------------------------------------------------------------ swings
def swing_frame(cls, d, k, fw=96, fh=96):
    cv = blank(fw, fh, seed=100 + d * 7 + k); px, py = fw / 2, fh * 0.70
    ramp_ = CLASS_COL[cls]; phi = d * math.pi / 4
    if cls == "spear":
        sx, sy, ang = dir_vec(d)
        ext = [0.45, 1.0, 1.0, 0.8, 0.5][k]; L0, L = 6, 6 + 34 * ext; z = 16
        w = [3.5, 7, 6, 4, 2.5][k]
        ox, oy = px, py - z
        def P(l, off): return (ox + sx * l - sy * off, oy + sy * l * 0.92 + sx * off)
        prof = lambda t: w * (t ** 1.2) * (1 - max(0, (t - 0.82) / 0.18) ** 1.5)
        body = [P(L0 + (L - L0) * t, prof(t)) for t in np.linspace(0, 1, 30)] + [P(L + 6, 0)] + [P(L0 + (L - L0) * t, -prof(t)) for t in np.linspace(1, 0, 30)]
        if k < 4:
            cv.part(body, ramp_, lw=1.0, shade=0.15, hl=0.25)
            cv.fill([P(L0 + (L - L0) * t, prof(t) * 0.35) for t in np.linspace(0.3, 1, 20)] + [P(L + 3, 0)] + [P(L0 + (L - L0) * t, -prof(t) * 0.35) for t in np.linspace(1, 0.3, 20)], (255, 255, 255), alpha=230)
        for j, off in enumerate((-8, 7, -4)):          # speed lines
            if k in (1, 2, 3):
                a0 = L0 - 4 + j * 5 + k * 3; cv.line([P(a0, off), P(a0 + 12 - k * 2, off)], ramp_[2], 1.1, alpha=int(230 - k * 50))
        if k in (1, 2): twinkle(cv, *P(L + 5, 0), 4.5 - k, rot=0.3 * k)
        if k >= 3:
            for j in range(3): twinkle(cv, *P(L - 6 - j * 9, (j - 1) * 4), 2.6 - j * 0.5, ramp_[1], rot=j)
        return cv
    r = {"blade": 0.84, "blunt": 0.72, "axe": 0.78}[cls]; rx, ry = r * 45.25, r * 22.6
    span = {"blade": 1.35, "blunt": 1.05, "axe": 1.2}[cls]
    a_start, a_end = phi + math.pi / 4 + span, phi + math.pi / 4 - span      # ellipse params (sweep clockwise on screen)
    head_t = [0.35, 0.75, 1.0, 1.0, 1.0][k]; tail_t = [0.0, 0.0, 0.12, 0.5, 0.82][k]
    W = {"blade": 10, "blunt": 13, "axe": 14}[cls] * [0.75, 1.0, 1.0, 0.8, 0.5][k]
    z = 18
    if head_t - tail_t > 0.04:
        a0 = a_start + (a_end - a_start) * tail_t; a1 = a_start + (a_end - a_start) * head_t
        band = crescent(px, py - z, rx, ry, a0, a1, W)
        cv.part(band, ramp_, lw=1.0, shade=0.16, hl=0.22)
        inner = crescent(px, py - z, rx - W * 0.18, ry - W * 0.09, a0 + (a1 - a0) * 0.25, a1, W * 0.45, inner_bias=0.2)
        cv.fill(inner, ramp_[2] if cls == "axe" else ramp_[1], alpha=200)
        core = crescent(px, py - z, rx - W * 0.06, ry - W * 0.03, a0 + (a1 - a0) * 0.35, a1, W * 0.22)
        cv.fill(core, (255, 255, 255), alpha=240)
        hx, hy = px + math.cos(a1) * (rx - W * 0.35), py + math.sin(a1) * (ry - W * 0.17) - z
        if k in (1, 2): twinkle(cv, hx, hy, 5 if k == 2 else 3.6, rot=0.4 * k)
        if cls == "blunt" and k in (1, 2, 3):        # whoosh lines outside the arc
            for j in range(3):
                aa = a0 + (a1 - a0) * (0.2 + 0.25 * j); rr = 1.16 + 0.06 * j; sg = np.sign(a1 - a0)
                cv.line([(px + math.cos(aa) * rx * rr, py + math.sin(aa) * ry * rr - z), (px + math.cos(aa + 0.22 * sg) * rx * rr, py + math.sin(aa + 0.22 * sg) * ry * rr - z)], ramp_[3], 1.2, alpha=210 - 40 * (k - 1))
        if cls == "axe" and k in (1, 2):             # chunky wood-chip sparkles at the head
            for j in range(2): star(cv, hx + (j * 2 - 1) * 6, hy - 6 - j * 2, 2.6, rot=j + k)
    if k >= 3:   # tail dissolves into little sparkles
        rng = np.random.default_rng(d * 31 + k)
        for j in range(4 if k == 3 else 3):
            t = tail_t - 0.08 - 0.12 * j - rng.random() * 0.05
            if t < 0: continue
            a = a_start + (a_end - a_start) * t; rr = 1 + (rng.random() - 0.5) * 0.15
            twinkle(cv, px + math.cos(a) * rx * rr, py + math.sin(a) * ry * rr - z - (k - 3) * 3, 2.6 - 0.4 * j, ramp_[1], rot=j)
    return cv

# ------------------------------------------------------------------ small fx (64x64, center pivot)
def bonk_stars(k, n=6):
    cv = blank(64, 64, 11 + k); e = blank(64, 64); cx, cy = 32, 36; t = k / (n - 1)
    if k <= 1:  # impact ring
        rr = 8 + k * 8
        if k == 0: cv.part(rstar(cx, cy, 9, 5, 8, 0.2, p=1.0), [(255, 255, 255), (255, 250, 220), (255, 226, 140), (220, 160, 80)], lw=0.7, shade=0.1, hl=0); e.fill(rstar(cx, cy, 9, 5, 8, 0.2), (255, 240, 180))
        else: cv.fill(arc_band(cx, cy, rr, rr * 0.55, 0, 6.2832, 1.6, 1.6, 50), (255, 250, 230), alpha=220)
        for j in range(6):
            a = j / 6 * 6.28 + 0.3; cv.line([(cx + math.cos(a) * (rr + 2), cy + math.sin(a) * (rr + 2) * 0.6), (cx + math.cos(a) * (rr + 7), cy + math.sin(a) * (rr + 7) * 0.6)], (255, 236, 150), 1.4)
    for j, (ang, dist, rr) in enumerate(((-90, 15, 9.5), (-155, 15, 6.8), (-25, 16, 6.8))):
        dd = dist * ease_out(min(1, t * 1.6)); a = math.radians(ang)
        lift = -4 * t if k > 2 else 0
        scale = [0.45, 1.15, 1.0, 0.95, 0.8, 0.55][k]
        x, y = cx + math.cos(a) * dd * 1.25, cy + math.sin(a) * dd + lift
        star(cv, x, y, rr * scale, rot=(t * 1.8 + j) * (1 if j % 2 else -1), face=(j == 0), e=e)
    if k in (2, 3, 4):
        for j in range(3): twinkle(cv, cx + (j - 1) * 17, cy - 22 + (j % 2) * 8 - k, 2.4, (255, 250, 220), rot=k + j, e=e, ecol=(255, 240, 180))
    return cv, e

def crit_burst(k, n=6):
    cv = blank(64, 64, 21 + k); e = blank(64, 64); cx, cy = 32, 32
    s = [0.5, 1.12, 1.0, 0.92, 0.75, 0.0][k]
    if s > 0:
        out = rstar(cx, cy, 26 * s, 17 * s, 10, -math.pi / 2 + k * 0.08, p=0.9)
        cv.part(out, [(255, 236, 170), (255, 170, 80), (236, 98, 70), (168, 54, 64)], lw=1.1, shade=0.14, hl=0.1)
        mid = rstar(cx, cy, 19 * s, 12.5 * s, 10, -math.pi / 2 + 0.31 + k * 0.08, p=0.9)
        cv.part(mid, [(255, 255, 230), (255, 224, 110), (246, 176, 64), (190, 110, 44)], lw=0.8, shade=0.12, hl=0.12)
        e.fill(mid, (255, 210, 110)); e.fill(out, (255, 140, 70), alpha=140)
        core = wobbly(cx, cy, 9 * s, 8.5 * s, 3, 0.05)
        cv.part(core, [(255, 255, 255), (255, 252, 230), (255, 230, 160), (220, 160, 80)], lw=0.6, shade=0.1, hl=0.1)
        e.fill(core, (255, 255, 230))
        if s > 0.7:  # chunky "!" in the middle
            cv.part(capsule(cx, cy - 6 * s, cx, cy + 1 * s, 2.1 * s), [(255, 140, 120), (232, 71, 95), (184, 48, 79), (126, 33, 64)], lw=0.7, shade=0.1, hl=0.1)
            cv.part(circle(cx, cy + 5 * s, 1.9 * s, 18), [(255, 140, 120), (232, 71, 95), (184, 48, 79), (126, 33, 64)], lw=0.7, shade=0.1, hl=0)
    if k >= 3:
        for j in range(8):
            a = j / 8 * 6.283 + 0.2; rr = 20 + (k - 3) * 6
            twinkle(cv, cx + math.cos(a) * rr, cy + math.sin(a) * rr * 0.9, [3.4, 2.8, 2.2][k - 3], (255, 236, 160), rot=j, e=e, ecol=(255, 220, 140))
    return cv, e

def capsule(x0, y0, x1, y1, r):
    from toon import capsule_pts
    return capsule_pts(x0, y0, x1, y1, r)

def parry_spark(k, n=5):
    cv = blank(64, 64, 31 + k); e = blank(64, 64); cx, cy = 32, 30
    BL = [(255, 255, 255), (220, 248, 255), (150, 214, 240), (70, 130, 190)]
    if k < 4:
        r = [10, 18, 15, 9][k]
        twinkle(cv, cx, cy, r, (250, 254, 255), rot=0, e=e, ecol=(200, 245, 255))
        twinkle(cv, cx, cy, r * 0.55, (255, 255, 255), rot=math.pi / 4, e=e, ecol=(255, 255, 255))
    for j in range(7):   # sparks flying in an upward fan
        a = math.radians(-160 + j * 23); d0 = 4 + k * 5; d1 = d0 + [5, 7, 6, 4, 2][k]
        if k == 0: continue
        p0 = (cx + math.cos(a) * d0, cy + math.sin(a) * d0 * 0.9 + k * k * 0.5); p1 = (cx + math.cos(a) * d1, cy + math.sin(a) * d1 * 0.9 + k * k * 0.5)
        cv.line([p0, p1], (255, 236, 150) if j % 2 else (200, 240, 255), 1.4 - k * 0.15)
        e.line([p0, p1], (255, 236, 150) if j % 2 else (200, 240, 255), 1.4)
    if k in (1, 2, 3):
        rr = 9 + k * 5; cv.part(arc_band(cx, cy, rr, rr * 0.8, 3.4, 6.0, 2.0 - k * 0.4, 2.0 - k * 0.4, 30), BL, lw=0.5, shade=0, hl=0)
    return cv, e

def block_shield(k, n=5):
    cv = blank(64, 64, 41 + k); cx, cy = 32, 32 - [0, 2, 3, 3, 4][k]
    s = [0.6, 1.15, 1.0, 1.0, 0.85][k]; al = [1, 1, 1, 0.85, 0.45][k]
    sh = [(cx - 9 * s, cy - 9 * s), (cx + 9 * s, cy - 9 * s), (cx + 9 * s, cy + 1 * s), (cx, cy + 11 * s), (cx - 9 * s, cy + 1 * s)]
    from toon import ellipse_pts
    shp = [(x, y) for x, y in sh]
    c2 = blank(64, 64, 41)
    c2.part(round_poly(shp, 3 * s), [H(c) for c in RAMPS["wood"]], lw=1.0)
    c2.part(round_poly([(cx - 6 * s, cy - 6.5 * s), (cx + 6 * s, cy - 6.5 * s), (cx + 6 * s, cy + 0.5 * s), (cx, cy + 7.5 * s), (cx - 6 * s, cy + 0.5 * s)], 2 * s), [H(c) for c in RAMPS["iron"]], lw=0.7)
    c2.fill(circle(cx, cy - 1 * s, 2 * s, 16), H(RAMPS["gold"][1]))
    cv.img = fade(c2.img, al)
    for j in range(4):
        if k in (1, 2, 3):
            a = math.radians(-130 + j * 27); d0 = 14 * s + k; d1 = d0 + 5
            cv.line([(cx + math.cos(a) * d0, cy + math.sin(a) * d0), (cx + math.cos(a) * d1, cy + math.sin(a) * d1)], (255, 246, 210), 1.3)
    return cv, None

def round_poly(pts, r, n=6):
    """round the corners of a polygon"""
    out = []; N = len(pts)
    for i in range(N):
        p0, p1, p2 = np.array(pts[i - 1]), np.array(pts[i]), np.array(pts[(i + 1) % N])
        v0 = (p0 - p1) / (np.linalg.norm(p0 - p1) + 1e-6); v2 = (p2 - p1) / (np.linalg.norm(p2 - p1) + 1e-6)
        a = p1 + v0 * r; b = p1 + v2 * r
        for t in np.linspace(0, 1, n): out.append(tuple((1 - t) ** 2 * a + 2 * (1 - t) * t * p1 + t * t * b))
    return out

def dodge_dust(k, n=6):
    cv = blank(64, 64, 51 + k); cx, cy = 32, 46
    for j in range(4):
        age = k - j * 0.6
        if age < 0: continue
        r = 3.2 + age * 1.3 - max(0, age - 3) * 1.8
        x = cx + 14 - j * 9 - age * 1.0; y = cy - age * 1.6 + (j % 2) * 2
        if r > 0.8: puff(cv, x, y, r, 5 + j, DUST, lw=0.8)
    if k <= 2:
        for j in range(3): cv.line([(cx - 2 - j * 5, cy - 6 + j * 4), (cx - 10 - j * 5 - k * 2, cy - 6 + j * 4)], (236, 214, 170), 1.0, alpha=200)
    return cv, None

def hit_spark(k, n=5):
    cv = blank(64, 64, 61 + k); e = blank(64, 64); cx, cy = 32, 32
    for j in range(8):
        a = j / 8 * 6.283 + (0.2 if j % 2 else 0); long_ = 1.0 if j % 2 == 0 else 0.65
        d0 = 3 + k * 4.5; d1 = d0 + (9 - k * 1.6) * long_
        if d1 <= d0 + 0.5: continue
        w = (4.2 - k * 0.6) * long_
        a0, a1 = (cx + math.cos(a) * d0, cy + math.sin(a) * d0), (cx + math.cos(a) * d1, cy + math.sin(a) * d1)
        poly = [(a0[0] - math.sin(a) * w / 2, a0[1] + math.cos(a) * w / 2), (a1[0], a1[1]), (a0[0] + math.sin(a) * w / 2, a0[1] - math.cos(a) * w / 2)]
        cv.part(poly, [(255, 255, 255), (255, 244, 180), (255, 200, 90), (220, 130, 60)], lw=0.5, shade=0, hl=0)
        e.fill(poly, (255, 230, 150))
    if k <= 1:
        g = circle(cx, cy, 5 - k * 2, 20); cv.part(g, [(255, 255, 255)] * 3 + [(255, 210, 120)], lw=0.5, shade=0, hl=0); e.fill(g, (255, 255, 240))
    for j in range(3):
        if k >= 2: twinkle(cv, cx + math.cos(j * 2.1) * (10 + k * 3), cy + math.sin(j * 2.1) * (10 + k * 3), 2.0, (255, 244, 190), e=e)
    return cv, e

def impact_puff(k, n=6):
    cv = blank(64, 64, 71 + k); cx, cy = 32, 34
    R_ = [6, 11, 13, 12, 9, 5][k]
    if k < 4: puff(cv, cx, cy - k, R_, 7, CLOUD)
    else:
        for j in range(4): puff(cv, cx + math.cos(j * 1.6) * (8 + k * 2), cy - 3 - k * 2 + math.sin(j * 1.6) * 6, R_ * 0.45, 8 + j, CLOUD, lw=0.7)
    if 1 <= k <= 4:
        star(cv, cx - 13 - k, cy - 9 - k * 1.5, 3.4, rot=k * 0.5); star(cv, cx + 14 + k, cy - 5 - k * 2, 2.8, rot=-k * 0.5)
    return cv, None

def impact_flash(k, n=3):
    cv = blank(64, 64, 81 + k); e = blank(64, 64); cx, cy = 32, 32
    if k == 0:
        glow(cv, cx, cy, 16, (255, 240, 180), 0.9); cv.fill(wobbly(cx, cy, 9, 9, 1, 0.04), (255, 255, 245)); None; e.fill(wobbly(cx, cy, 9, 9, 1), (255, 255, 240))
    elif k == 1:
        glow(cv, cx, cy, 20, (255, 214, 120), 0.6)
        cv.part(arc_band(cx, cy, 13, 13, 0, 6.2832, 3.5, 3.5, 50), [(255, 255, 240), (255, 246, 200), (255, 220, 120), (230, 150, 70)], lw=0.5, shade=0, hl=0)
        e.fill(arc_band(cx, cy, 13, 13, 0, 6.2832, 3.5, 3.5, 50), (255, 230, 150)); None
    else:
        cv.fill(arc_band(cx, cy, 19, 19, 0, 6.2832, 1.4, 1.4, 60), (255, 236, 170), alpha=170)
        e.fill(arc_band(cx, cy, 19, 19, 0, 6.2832, 1.4, 1.4, 60), (255, 220, 140), alpha=150)
    return cv, e

def downed_ring(k, n=8):
    cv = blank(64, 64, 91 + k); e = blank(64, 64); cx, cy = 32, 34
    for j in range(10):
        a0 = j / 10 * 6.283 + k / n * 6.283 / 10 * 1.0
        band = arc_band(cx, cy, 24, 12, a0, a0 + 0.38, 2.2, 2.2, 10)
        cv.part(band, [(255, 250, 220), (255, 226, 120), (240, 170, 60), (180, 110, 40)], lw=0.5, shade=0, hl=0)
        e.fill(band, (255, 220, 120), alpha=170)
    for j in range(4):   # little hearts drifting
        t = ((k / n) + j / 4) % 1
        heart_(cv, cx + math.cos(j * 1.57 + 0.6) * 18, cy + math.sin(j * 1.57 + 0.6) * 9 - t * 14, 2.6 * (1 - abs(t - 0.5)), e)
    return cv, e

def heart_(cv, cx, cy, s, e=None, ramp_=None):
    if s < 0.6: return
    pts = []
    for k in range(60):
        t = k / 60 * 2 * math.pi
        x = 16 * math.sin(t) ** 3; y = -(13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t))
        pts.append((cx + x / 16 * s, cy + y / 16 * s))
    cv.part(pts, ramp_ or [H(c) for c in RAMPS["berry"]], lw=0.7, shade=0.15, hl=0.15)
    if e is not None: e.fill(pts, (255, 150, 170), alpha=160)

# ------------------------------------------------------------------ tall fx (64x96, feet pivot at (32,88))
FX, FY = 32, 88
def ghost(cv, cx, cy, s=1.0, ph=0.0, alpha=1.0, e=None):
    pts = []
    for k in range(40):  # head dome
        a = math.pi + k / 39 * math.pi; pts.append((cx + math.cos(a) * 7 * s, cy + math.sin(a) * 7 * s))
    for k in range(25):  # right side down to a wavy tail curling left
        t = k / 24; pts.append((cx + (7 - 3 * t) * s + math.sin(t * 3 + ph) * 1.2 * s, cy + t * 11 * s))
    for k in range(25):
        t = k / 24; x = cx + (4 - 9 * t) * s + math.sin(ph) * 1.0 * s; pts.append((x, cy + 11 * s + math.sin(t * 9.4 + ph * 2) * 1.5 * s - t * 1 * s))
    for k in range(25):
        t = 1 - k / 24; pts.append((cx - (7 - 2 * t) * s + math.sin(t * 3 + ph + 1) * 1.0 * s, cy + t * 10 * s))
    c2 = blank(cv.w, cv.h, 5)
    c2.part(pts, GHOST, lw=0.9, shade=0.2, hl=0.12)
    eyes(c2, cx, cy - 0.5 * s, 0.85 * s)
    c2.fill(circle(cx, cy + 2.6 * s, 1.0 * s, 12, 0.7 * s), INKC)  # little "o" mouth
    cv.img = Image.alpha_composite(cv.img, fade(c2.img, alpha))
    if e is not None: None

def orbit_stars(cv, cx, cy, rx, ry, ph, n=3, r=3.4, e=None, behind=None):
    items = []
    for j in range(n):
        a = ph + j / n * 6.283; z = math.sin(a)
        items.append((z, cx + math.cos(a) * rx, cy + math.sin(a) * ry, r * (0.8 + 0.25 * z), j))
    for z, x, y, rr, j in sorted(items):
        star(cv, x, y, rr, rot=ph * 2 + j, e=e)

def ko_puff(k, n=12):
    cv = blank(64, 96, 201 + k); e = blank(64, 96); cx, cy = FX, FY - 20
    if k == 0:
        glow(cv, cx, cy, 15, (255, 250, 220), 0.9); cv.part(wobbly(cx, cy, 10, 12, 2, 0.05), CLOUD, lw=0.9); None
    elif k <= 5:
        R_ = [0, 14, 18, 19, 17, 13][k]
        cv.part(cloud(cx, cy - (k - 1), R_, R_ * 0.92, 3, 8, 0.5), CLOUD, lw=1.0, shade=0.22, hl=0.14)
        if k >= 2:  # lilac inner puffs for depth
            for j in range(2): puff(cv, cx + (j * 2 - 1) * R_ * 0.5, cy - (k - 1) + R_ * 0.45, R_ * 0.3, 10 + j, [(250, 244, 255), (232, 222, 248), (196, 180, 232), (140, 120, 190)], lw=0.7)
        for j in range(5):   # stars popping out
            a = -math.pi / 2 + (j - 2) * 0.62; d = 8 + k * 4.2
            if k >= 2: star(cv, cx + math.cos(a) * d * 1.1, cy - 4 + math.sin(a) * d * 0.85, 3.6 - 0.25 * abs(j - 2) - max(0, k - 4) * 0.6, rot=k * 0.4 + j, e=e)
    else:
        t = (k - 6) / (n - 7)
        for j in range(5):   # leftover puffs drift up and shrink
            r = (7 - j * 0.6) * (1 - t * 0.85)
            if r > 1: puff(cv, cx + math.cos(j * 1.3) * (12 + t * 6), cy + 4 - t * 10 + math.sin(j * 1.9) * 7, r, 20 + j, CLOUD, lw=0.8)
        if k <= 9:  # dizzy stars orbit where the head was
            orbit_stars(cv, cx, cy - 6, 13, 4.5, k * 0.9, 3, 3.3 * (1 - max(0, k - 8) * 0.3), e)
        # ghost wisp floats up with a little sway
        gy = cy + 2 - t * 52; ghost(cv, cx + math.sin(t * 6) * 3, gy, 0.75 + 0.25 * min(1, t * 3), ph=k * 0.9, alpha=min(1, (1 - t) * 3.2), e=e)
    return cv, e

def ghost_loop(k, n=6):
    cv = blank(64, 96, 301 + k); e = blank(64, 96); ph = k / n * 6.283
    ghost(cv, FX + math.sin(ph) * 2, FY - 48 + math.sin(ph) * 2.5, 1.0, ph=ph, e=e)
    twinkle(cv, FX + 12, FY - 62 + math.sin(ph + 1) * 3, 2.2 * (0.6 + 0.4 * math.sin(ph)), (240, 236, 255), e=e)
    return cv, e

def downed_overlay(k, n=8):
    cv = blank(64, 96, 401 + k); e = blank(64, 96); ph = k / n * 6.283
    # swirly dizzy spiral + orbiting stars above the head (head top ~ 46px above feet)
    sp = []
    for j in range(40):
        t = j / 39; a = ph * 0.5 + t * 9; r = 1 + t * 6
        sp.append((FX + math.cos(a) * r, FY - 58 + math.sin(a) * r * 0.5))
    cv.line(sp, (196, 180, 232), 1.2, alpha=220)
    orbit_stars(cv, FX, FY - 56, 15, 5, ph, 3, 3.4, e)
    return cv, e

def respawn(k, n=10):
    cv = blank(64, 96, 501 + k); e = blank(64, 96); t = k / (n - 1)
    # ground ring expanding
    rr = 6 + t * 20; al = int(255 * (1 - t) ** 0.6)
    if k < n - 1:
        band = arc_band(FX, FY - 2, rr, rr * 0.5, 0, 6.2832, 2.4 * (1 - t) + 0.6, 2.4 * (1 - t) + 0.6, 60)
        cv.fill(band, (255, 236, 160), alpha=al); e.fill(band, (255, 226, 140), alpha=al)
    # soft light column (fades)
    colA = max(0, math.sin(min(1, t * 1.4) * math.pi)) * 0.55
    if colA > 0.02:
        m = blank(64, 96); m.fill(rrect(FX - 9, 8, FX + 9, FY, 8), (255, 246, 210)); m.img = m.img.filter(__import__('PIL.ImageFilter', fromlist=['x']).GaussianBlur(5 * SS))
        cv.img = Image.alpha_composite(cv.img, fade(m.img, colA)); e.img = Image.alpha_composite(e.img, fade(m.img, colA))
    rng = np.random.default_rng(9)
    for j in range(9):  # spiral of twinkles rising
        st = j * 0.07; tt = (t - st) / 0.75
        if not (0 <= tt <= 1): continue
        a = j * 2.4 + tt * 4; y = FY - 4 - tt * 70; x = FX + math.cos(a) * (12 - tt * 5)
        col = [(255, 240, 160), (255, 214, 230), (200, 240, 255)][j % 3]
        twinkle(cv, x, y, 3.4 * math.sin(tt * math.pi) + 0.8, col, rot=a, e=e)
    if 2 <= k <= 6: heart_(cv, FX, FY - 50 - k * 2, 3.8, e)
    return cv, e

# ------------------------------------------------------------------ projectiles (48x48, center pivot)
def proj_frame(kind, d, k=0):
    cv = blank(48, 48, 601 + d); cx, cy = 24, 24
    if kind == "stone":
        ang = k * math.pi / 2
        poly = wobbly(cx, cy, 4.2, 3.6, 4, 0.12, rot=ang)
        cv.part(poly, [H(c) for c in RAMPS["stone"]], lw=0.9, shade=0.3, hl=0.25)
        cv.fill(circle(cx + math.cos(ang + 2) * 1.5, cy + math.sin(ang + 2) * 1.2, 0.7, 10), H(RAMPS["stone"][3]))
        return cv
    sx, sy, a = dir_vec(d)
    # raise so arc reads as "in flight": draw along screen dir with slight foreshortening
    if kind == "arrow":
        L = 22
        shaft = capsule(cx - sx * L / 2, cy - sy * L / 2, cx + sx * L / 2 - sx * 3, cy + sy * L / 2 - sy * 3, 0.9)
        cv.part(shaft, [H(c) for c in RAMPS["wood"]], lw=0.7, shade=0.2, hl=0.2)
        tip = [(cx + sx * (L / 2 + 3), cy + sy * (L / 2 + 3)), (cx + sx * (L / 2 - 3) - sy * 2.6, cy + sy * (L / 2 - 3) + sx * 2.6), (cx + sx * (L / 2 - 2), cy + sy * (L / 2 - 2)), (cx + sx * (L / 2 - 3) + sy * 2.6, cy + sy * (L / 2 - 3) - sx * 2.6)]
        cv.part(tip, [H(c) for c in RAMPS["iron"]], lw=0.7, shade=0.2, hl=0.2)
        for side in (-1, 1):   # pink+cream fletching
            b0 = (cx - sx * (L / 2 - 1), cy - sy * (L / 2 - 1)); b1 = (cx - sx * (L / 2 - 6), cy - sy * (L / 2 - 6))
            f = [b1, (b0[0] + side * -sy * 3.4 - sx * 1.5, b0[1] + side * sx * 3.4 - sy * 1.5), b0]
            cv.part(f, [H(c) for c in (RAMPS["flower_pink"] if side < 0 else RAMPS["cloth_cream"])], lw=0.6, shade=0.1, hl=0.2)
    else:  # spear
        L = 34
        shaft = capsule(cx - sx * L / 2, cy - sy * L / 2, cx + sx * (L / 2 - 4), cy + sy * (L / 2 - 4), 1.2)
        cv.part(shaft, [H(c) for c in RAMPS["wood"]], lw=0.8, shade=0.2, hl=0.2)
        for t in (-0.15, -0.05):  # leather grip wraps
            p = (cx + sx * L * t, cy + sy * L * t)
            cv.line([(p[0] - sy * 1.6, p[1] + sx * 1.6), (p[0] + sy * 1.6, p[1] - sx * 1.6)], H(RAMPS["leather"][2]), 1.0)
        tipb = (cx + sx * (L / 2 - 5), cy + sy * (L / 2 - 5)); tipf = (cx + sx * (L / 2 + 5), cy + sy * (L / 2 + 5))
        tip = [tipf, (tipb[0] - sy * 3.4, tipb[1] + sx * 3.4), (tipb[0] - sx * 1.5, tipb[1] - sy * 1.5), (tipb[0] + sy * 3.4, tipb[1] - sx * 3.4)]
        cv.part(tip, [H(c) for c in RAMPS["stone"]], lw=0.8, shade=0.25, hl=0.2)
        rib = (cx + sx * (L / 2 - 7), cy + sy * (L / 2 - 7))
        cv.part(circle(rib[0] - sy * 2.2, rib[1] + sx * 2.2, 1.6, 14), [H(c) for c in RAMPS["cloth_red"]], lw=0.5)   # tiny ribbon
    return cv

def trail_tex(kind, w=64, h=16):
    """trail strip, tileable along u (x). White-ish so the renderer can tint; alpha carries the shape."""
    cv = blank(w, h, 701)
    def wrap_fill(pts, col, alpha=255):
        polys = pts if isinstance(pts[0], list) else [pts]
        for off in (-w, 0, w): cv.fill([[(x + off, y) for x, y in p] for p in polys], col, alpha)
    cy = h / 2
    if kind == "arrow":
        wrap_fill([(0, cy - 1.6), (w, cy - 1.6), (w, cy + 1.6), (0, cy + 1.6)], (255, 252, 240), 200)
        for j in range(4):
            x = j * w / 4 + 6; wrap_fill(sparkle(x, cy + (2.5 if j % 2 else -2.5), 2.4, 0.22), (255, 246, 210), 230)
        for j in range(2): wrap_fill([(j * 32 + 14, cy - 0.4), (j * 32 + 26, cy - 0.4), (j * 32 + 26, cy + 0.4), (j * 32 + 14, cy + 0.4)], (255, 255, 255), 255)
    elif kind == "stone":
        for j in range(4):
            x = j * w / 4 + 8; r = 3.4 + (j % 2) * 1.2
            wrap_fill(cloud(x, cy, r, r * 0.85, j, 5, 0.5), (236, 222, 200), 190)
    else:  # spear: wind ribbons
        import numpy as _n
        for j, (amp, ph, wd) in enumerate(((3.2, 0, 1.3), (2.4, 2.1, 1.0))):
            pts_t = [(x, cy + amp * math.sin(x / w * 2 * math.pi * 2 + ph) - wd) for x in _n.linspace(0, w, 40)]
            pts_b = [(x, cy + amp * math.sin(x / w * 2 * math.pi * 2 + ph) + wd) for x in _n.linspace(w, 0, 40)]
            wrap_fill(pts_t + pts_b, (240, 255, 246), 210 - j * 50)
    return cv

# ------------------------------------------------------------------ build
def build():
    out = {}
    # swings: two atlases (blade+blunt, axe+spear) so the @2x page stays one 2048 image; 10 columns, dirStride 10
    for sk, classes in (("pvp_swing_a", ["blade", "blunt"]), ("pvp_swing_b", ["axe", "spear"])):
        sw = Sheet(sk, 96, 96, 10, pivot=(0.5, 0.70)); sprites = []
        for ci, cls in enumerate(classes):
            base = ci * 5
            for d in range(8):
                for k in range(5):
                    sw.add(f"fx_swing_{cls}/swing/{DIRS8[d]}/{k}", swing_frame(cls, d, k).img, idx=base + d * 10 + k)
            sprites.append({"key": f"fx_swing_{cls}", "category": "vfx", "atlas": sk, "anchor": {"x": 0.5, "y": 0.70},
                            "animations": {"swing": {"frames": list(range(base, base + 5)), "fps": 20, "directions": 8, "dirStride": 10, "loop": False}}})
        sw.sprites = sprites; out[sk] = sw

    fx = Sheet("pvp_fx", 64, 64, 16, pivot=(0.5, 0.5))
    groups = [("fx_bonk_stars", bonk_stars, 6, 18, False), ("fx_crit_burst", crit_burst, 6, 18, False), ("fx_parry_spark", parry_spark, 5, 20, False),
              ("fx_block_shield", block_shield, 5, 16, False), ("fx_dodge_dust", dodge_dust, 6, 14, False), ("fx_hit_spark", hit_spark, 5, 24, False),
              ("fx_impact_puff", impact_puff, 6, 16, False), ("fx_impact_flash", impact_flash, 3, 24, False), ("fx_downed_ring", downed_ring, 8, 8, True)]
    idx = 0; sprites = []
    for key, fn, n, fps, loop in groups:
        idx = math.ceil(idx / 8) * 8 if idx % 16 > 8 or (idx % 16 and idx % 16 + n > 16) else idx
        if idx % 16 + n > 16: idx = (idx // 16 + 1) * 16
        frames = []
        for k in range(n):
            cv, e = fn(k, n); fx.add(f"{key}/idle/{k}", cv.img, e.img if e else None, idx=idx); frames.append(idx); idx += 1
        sprites.append({"key": key, "category": "vfx", "atlas": "pvp_fx", "anchor": {"x": 0.5, "y": 0.5}, "animations": {"idle": {"frames": frames, "fps": fps, "loop": loop}}})
    fx.sprites = sprites; out["fx"] = fx

    tall = Sheet("pvp_fx_tall", 64, 96, 12, pivot=(0.5, FY / 96))
    idx = 0; sprites = []
    for key, fn, n, fps, loop in [("fx_ko_puff", ko_puff, 12, 12, False), ("fx_ko_ghost", ghost_loop, 6, 8, True),
                                  ("fx_downed_overlay", downed_overlay, 8, 10, True), ("fx_respawn_sparkle", respawn, 10, 14, False)]:
        if idx % 12 + n > 12: idx = (idx // 12 + 1) * 12
        frames = []
        for k in range(n):
            cv, e = fn(k, n); tall.add(f"{key}/idle/{k}", cv.img, e.img, idx=idx); frames.append(idx); idx += 1
        sprites.append({"key": key, "category": "vfx", "atlas": "pvp_fx_tall", "anchor": {"x": 0.5, "y": round(FY / 96, 4)}, "animations": {"idle": {"frames": frames, "fps": fps, "loop": loop}}})
    tall.sprites = sprites; out["tall"] = tall

    pj = Sheet("pvp_projectiles", 48, 48, 8, pivot=(0.5, 0.5))
    for d in range(8): pj.add(f"proj_arrow/idle/{DIRS8[d]}/0", proj_frame("arrow", d).img, idx=d)
    for d in range(8): pj.add(f"proj_spear/idle/{DIRS8[d]}/0", proj_frame("spear", d).img, idx=8 + d)
    for k in range(4): pj.add(f"proj_sling_stone/idle/{k}", proj_frame("stone", 0, k).img, idx=16 + k)
    pj.sprites = [
        {"key": "proj_arrow", "category": "vfx", "atlas": "pvp_projectiles", "anchor": {"x": 0.5, "y": 0.5}, "animations": {"idle": {"frames": [0], "fps": 1, "directions": 8, "dirStride": 1}}},
        {"key": "proj_spear", "category": "vfx", "atlas": "pvp_projectiles", "anchor": {"x": 0.5, "y": 0.5}, "animations": {"idle": {"frames": [8], "fps": 1, "directions": 8, "dirStride": 1}}},
        {"key": "proj_sling_stone", "category": "vfx", "atlas": "pvp_projectiles", "anchor": {"x": 0.5, "y": 0.5}, "animations": {"idle": {"frames": [16, 17, 18, 19], "fps": 16}}}]
    out["proj"] = pj

    tr = Sheet("pvp_trails", 64, 16, 1, pivot=(1.0, 0.5), sharpen=False); tr.edge_fade = False
    os.makedirs(TEX, exist_ok=True); sprites = []
    for i, kind in enumerate(["arrow", "stone", "spear"]):
        cv = trail_tex(kind); tr.add(f"trail_{kind}/idle/0", cv.img, idx=i)
        downscale(cv.img, (64, 16), False).save(os.path.join(TEX, f"trail_{kind}.png"))
        downscale(cv.img, (128, 32), False).save(os.path.join(TEX, f"trail_{kind}@2x.png"))
        sprites.append({"key": f"trail_{kind}", "category": "vfx", "atlas": "pvp_trails", "anchor": {"x": 1.0, "y": 0.5}, "animations": {"idle": {"frames": [i], "fps": 1}}})
    tr.sprites = sprites; out["trails"] = tr
    return out

if __name__ == "__main__":
    import time; t = time.time(); o = build()
    for s in o.values(): print(s.save(), s.warnings[:5])
    print("t", time.time() - t)
