"""Food decay icons: 10 foods x 4 stages (fresh, stale, spoiling, rotten) at 32x32 (+2x), plus universal
stage badges, fuzz/stink overlays and a tiny flies anim. Rotten = cute mint fuzz + stink wiggles, never gross."""
import math
import numpy as np
from PIL import Image, ImageDraw
from fxlib import *
from gen_status import mask_circles

STAGES = ["fresh", "stale", "spoiling", "rotten"]
FOODS = ["berries", "mushroom", "carrot", "raw_meat", "cooked_meat", "fish", "bread", "apple", "stew_bowl", "egg"]
STINK = [(225, 245, 170), (175, 210, 110), (125, 170, 80), (80, 120, 60)]
FUZZ = [(240, 255, 235), (200, 240, 200), (150, 205, 165), (95, 150, 130)]

def tint(rp, stage):
    r = ramp(rp) if isinstance(rp, str) else rp
    if stage == 0: return r
    tgt = [(205, 175, 125), (160, 150, 90), (125, 135, 95)][stage - 1]; k = [0.16, 0.30, 0.45][stage - 1]; ds = [0.12, 0.28, 0.42][stage - 1]
    out = []
    for c in r:
        l = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]
        c2 = tuple(c[i] * (1 - ds) + l * ds for i in range(3))
        out.append(tuple(int(c2[i] * (1 - k) + tgt[i] * k) for i in range(3)))
    return out

ORANGE = [(255, 200, 120), (250, 145, 60), (215, 100, 45), (160, 65, 40)]
MEAT_RAW = [(255, 190, 190), (240, 125, 130), (200, 85, 100), (140, 55, 75)]
COOKED = [(240, 170, 100), (200, 115, 60), (150, 75, 45), (100, 50, 35)]
FISHC = [(190, 235, 245), (110, 185, 215), (70, 135, 185), (50, 90, 140)]
STEW = [(255, 200, 120), (230, 140, 70), (190, 95, 55), (130, 60, 45)]

def gl(stage, pts): return pts if stage == 0 else (None if stage >= 2 else [(x, y, rx * 0.7, ry * 0.7) for x, y, rx, ry in pts])

def food(name, stage):
    def d(cv, em, i, n):
        s = stage; T = lambda rp: tint(rp, s)
        if name == "berries":
            pos = [(12, 19, 5.2), (20, 19.5, 5.0), (16, 24, 5.0), (16, 14.5, 4.6)]
            for j, (x, y, r) in enumerate(pos):
                r *= [1, 0.95, 0.88, 0.8][s]
                rp = T("berry") if not (s >= 2 and j in (1, 3)) else tint([(200, 140, 110), (150, 85, 75), (110, 60, 60), (80, 45, 50)], s)
                cv.part(circ(x, y, r, wob=0.05 + 0.05 * s, seed=j), rp, lw=0.9, shade=0.3, hl=0.15, gloss=gl(s, [(x - r * 0.35, y - r * 0.35, r * 0.25, r * 0.25)]))
                cv.fill(star_pts(x + r * 0.15, y + r * 0.2, 1.0, 0.4, n=5), rp[3], alpha=200)
            lv = [(16, 10), (22, 6.5), (25, 9), (19, 11.5)]
            cv.part(lv if s < 2 else [(16, 10), (21, 9), (22, 12.5), (18, 12)], T("leaf"), lw=0.8, shade=0.3, hl=0.2)
            cv.line([(16, 10), (15, 7)], T("bark")[2], 0.8)
        elif name == "mushroom":
            dr = [0, 0.8, 1.8, 3.0][s]
            cv.part([(13, 27), (19, 27), (18.5, 17), (13.5, 17)], T("cloth_cream"), lw=0.9, shade=0.3, hl=0.2)
            cap = [(16 + math.cos(a) * 11, 17 + dr * 0.4 - math.sin(a) * (9 - dr) - (dr * (1 - abs(math.cos(a))) * 0)) for a in np.linspace(0, math.pi, 22)]
            cap = [(5 - dr * 0.3, 18 + dr)] + cap[::-1] + [(27 + dr * 0.3, 18 + dr)]
            cap = cap[::-1]
            cv.part(cap + [(16, 20 + dr * 0.5)], T("mush_red"), lw=1.0, shade=0.28, hl=0.15, gloss=gl(s, [(11, 11, 2, 1.3)]))
            for (x, y, r) in ((10.5, 15, 1.7), (16, 11, 2.1), (21.5, 14.5, 1.6), (18.5, 16.5, 1.0)):
                cv.part(circ(x, y + dr * 0.7, r, r * 0.8, wob=0.1), T("cloth_cream"), lw=0.5, shade=0.15, hl=0, outline=False)
            cv.line([(14.5, 21), (14.5, 25)], T("cloth_cream")[2], 0.5)
        elif name == "carrot":
            lean = [0, 1, 2.5, 4][s]
            body = [(11, 10), (21, 10.5), (17 + lean, 28), (15.5 + lean, 28)]
            cv.part([(10.5, 10), (21.5, 10.5), (21, 13), (19 + lean * 0.5, 21), (16.5 + lean, 28), (15 + lean * 0.6, 27), (12 + lean * 0.3, 18)], T(ORANGE), lw=0.95, shade=0.3, hl=0.18)
            for y in (14, 18, 22): cv.line([(13 + lean * (y - 10) / 40, y), (15.5 + lean * (y - 10) / 30, y + 0.4)], T(ORANGE)[3], 0.5, alpha=200)
            droop = [0, 2, 5, 8][s]
            for j, (dx, h) in enumerate(((-3, 5.5), (0, 7), (3.5, 6))):
                tip = (16 + dx * 1.4 + (droop if dx >= 0 else -droop) * 0.6, 10 - h + droop * (1.1 if j != 1 else 0.7))
                cv.part(capsule_pts(16 + dx * 0.5, 11.5, tip[0], tip[1] + 1.5, 1.4, 1.9), T("leaf") if s < 3 else tint("leaf_autumn", 2), lw=0.75, shade=0.25, hl=0.2)
        elif name == "raw_meat":
            sh = [1, 0.97, 0.93, 0.9][s]
            cv.part(capsule_pts(18, 13, 24.5, 7.5, 1.6), T("cloth_cream"), lw=0.8, shade=0.25, hl=0.2)
            cv.part(circ(25, 6.5, 2.2, wob=0), T("cloth_cream"), lw=0.7); cv.part(circ(26.4, 8.5, 2.0, wob=0), T("cloth_cream"), lw=0.7)
            cv.part(circ(14, 19, 10 * sh, 8 * sh, rot=-0.5, wob=0.08, seed=3), T(MEAT_RAW), lw=1.0, shade=0.25, hl=0.12, gloss=gl(s, [(9.5, 15.5, 2, 1.2)]))
            for pts in (((8, 20), (12, 17), (16, 19), (19, 15)), ((10, 24), (14, 22), (18, 23))):
                cv.line(list(pts), T("cloth_cream")[0], 0.9, alpha=220)
        elif name == "cooked_meat":
            sh = [1, 0.97, 0.93, 0.9][s]
            cv.part(capsule_pts(19, 13, 25, 7, 1.7), T("cloth_cream"), lw=0.8, shade=0.25, hl=0.2)
            cv.part(circ(25.5, 6, 2.3, wob=0), T("cloth_cream"), lw=0.7); cv.part(circ(27, 8.2, 2.1, wob=0), T("cloth_cream"), lw=0.7)
            cv.part(circ(13.5, 19, 9.5 * sh, 8.5 * sh, rot=-0.6, wob=0.1, seed=5), T(COOKED), lw=1.0, shade=0.3, hl=0.15, gloss=gl(s, [(9.5, 15, 2.2, 1.4)]))
            for (x, y) in ((10, 20), (14, 16), (16, 22)):  # grill marks
                cv.line([(x - 2, y + 1.5), (x + 2, y - 1.5)], T(COOKED)[3], 0.8, alpha=200)
            if s == 0:  # steam
                for x in (9, 14):
                    cv.line([(x + math.sin(v) * 1.2, 9 - v * 1.1) for v in np.linspace(0, 5, 12)], (255, 255, 255), 0.8, alpha=200)
        elif name == "fish":
            sh = [1, 0.97, 0.94, 0.9][s]
            body = circ(15, 17, 10 * sh, 5.8 * sh, rot=-0.15, wob=0.03, seed=2)
            cv.part([(23, 16), (29, 11), (28, 17), (29.5, 23)], T(FISHC), lw=0.85, shade=0.3, hl=0.1)   # tail
            cv.part([(11, 12.5), (15, 8), (18, 12)], T(FISHC), lw=0.7, shade=0.3, hl=0.1)   # fin
            cv.part(body, T(FISHC), lw=1.0, shade=0.3, hl=0.18, gloss=gl(s, [(12, 14, 2.4, 1.2)]))
            cv.part(circ(15, 19.5, 7.5 * sh, 2.4 * sh, rot=-0.15, wob=0), T("cloth_cream"), lw=0, shade=0.2, hl=0, outline=False)
            for x in (16, 18.5): cv.line([(x, 14), (x - 1.2, 17), (x, 20)], T(FISHC)[3], 0.5, alpha=180)
            if s < 3:
                cv.fill(circ(9, 15.5, 1.7, wob=0), (255, 255, 255)); cv.fill(circ(9.2, 15.6, 1.0, wob=0), INK)
                if s == 0: cv.fill(circ(8.8, 15.1, 0.35, wob=0), (255, 255, 255))
            else:  # cartoon x_x eye
                cv.line([(7.8, 14.4), (10.2, 16.8)], INK, 0.75); cv.line([(10.2, 14.4), (7.8, 16.8)], INK, 0.75)
            cv.line([(5.6, 18), (7, 18.6)], INK, 0.6)
        elif name == "bread":
            sh = [1, 0.98, 0.95, 0.93][s]
            cv.part(circ(16, 18, 12 * sh, 7.5 * sh, rot=-0.2, wob=0.06, seed=4), T("thatch") if s == 0 else T("wood"), lw=1.0, shade=0.3, hl=0.15)
            cv.part(circ(16, 16.5, 11 * sh, 5.6 * sh, rot=-0.2, wob=0.06, seed=4), T("wood"), lw=0.0, shade=0.25, hl=0.25, outline=False, gloss=gl(s, [(11, 14, 2.5, 1.2)]))
            for x in (10, 15, 20):
                cv.part(circ(x, 16.5 - (x - 15) * 0.2, 2.4, 1.0, rot=-0.9, wob=0), T("thatch"), lw=0.5, shade=0, hl=0)
            if s >= 1:  # crumbs / hard crust cracks
                cv.line([(7, 20), (9, 19), (10, 21)], T("wood")[3], 0.55)
        elif name == "apple":
            sh = [1, 0.96, 0.92, 0.86][s]
            body = circ(16, 18.5, 10 * sh, 9.2 * sh, wob=0.04 + 0.04 * s, seed=8)
            cv.part(body, T("berry"), lw=1.0, shade=0.3, hl=0.15, gloss=gl(s, [(11.5, 14.5, 2.2, 3.0)]))
            cv.fill(circ(16, 10.5 + (1 - sh) * 10, 2.4, 1.0, wob=0), T("berry")[3], alpha=200)
            cv.line([(16, 11 + (1 - sh) * 10), (17.5, 6 + (1 - sh) * 10)], T("bark")[2], 1.1)
            lf = [(17.5, 7.5), (22, 4.5), (25, 6.5), (20.5, 9)] if s < 2 else [(17.5, 8), (21, 9), (21.5, 12.5), (18, 10.5)]
            cv.part([(x, y + (1 - sh) * 10) for x, y in lf], T("leaf"), lw=0.75, shade=0.3, hl=0.2)
        elif name == "stew_bowl":
            cv.part([(4, 16)] + [(16 + math.cos(a) * 12, 16 + math.sin(a) * 11) for a in np.linspace(0, math.pi, 20)] + [(28, 16)], T("wood"), lw=1.0, shade=0.3, hl=0.12)
            cv.part(circ(16, 16, 12, 4.2, wob=0.01), T("wood"), lw=0.9, shade=0, hl=0)
            cv.part(circ(16, 16.3, 10.3, 3.2, wob=0.04), T(STEW), lw=0.6, shade=0.2, hl=0.2)
            for (x, y, rp, r) in ((12, 16, ORANGE, 1.4), (17, 15.5, "leaf", 1.2), (20.5, 16.6, ORANGE, 1.2), (14.5, 17.2, "cloth_cream", 1.1)):
                cv.part(circ(x, y, r, r * 0.8, wob=0.1), T(rp), lw=0.5, shade=0.2, hl=0.2)
            cv.line([(8, 22), (24, 22)], T("wood")[3], 0.6, alpha=150)
            if s == 0:
                for x in (11, 16, 21):
                    cv.line([(x + math.sin(v * 1.3 + x) * 1.3, 11 - v * 1.0) for v in np.linspace(0, 6, 14)], (255, 255, 255), 0.85, alpha=210)
        elif name == "egg":
            sh = [1, 1, 0.98, 0.96][s]
            egg = [(16 + math.cos(a) * 7.5 * sh * (1 - 0.15 * math.sin(a) * -1 if math.sin(a) < 0 else 1), 18 + math.sin(a) * (9.5 if math.sin(a) < 0 else 7.5) * sh) for a in np.linspace(0, 2 * math.pi, 40, endpoint=False)]
            cv.part(egg, T("cloth_cream"), lw=1.0, shade=0.3, hl=0.2, gloss=gl(s, [(13, 13, 1.4, 2.4)]))
            for (x, y) in ((18, 15), (14, 21), (19.5, 21)): cv.fill(circ(x, y, 0.6, wob=0), T("dirt")[1], alpha=170)
            if s >= 2:
                cv.line([(10, 16), (12.5, 18), (14, 16), (16, 18.5), (18, 16.5)], INK_SOFT, 0.6)
        if s == 0 and name not in ("stew_bowl", "cooked_meat"):
            cv.fill(star_pts(25.5, 7.5, 2.6, 0.7, n=4), (255, 255, 255)); cv.fill(star_pts(28, 11, 1.4, 0.4, n=4), (255, 255, 240))
        # ---- decay dressing ----
        body = Image.fromarray(np.asarray(cv.img)[..., 3])
        rng = np.random.default_rng(FOODS.index(name) * 7 + 1)
        if s >= 1:  # wrinkles
            for _ in range(2 + s):
                for _try in range(20):
                    x, y = 8 + rng.random() * 16, 9 + rng.random() * 16
                    if np.asarray(body)[int(y * cv.SS), int(x * cv.SS)] > 250: break
                cv.line([(x - 1.4, y), (x, y - 0.6), (x + 1.4, y + 0.1)], (90, 70, 70), 0.45, alpha=120 + 30 * s, clip=body)
        if s >= 2:  # soft brown spots
            for _ in range(2 * s - 2):
                x, y = 9 + rng.random() * 14, 11 + rng.random() * 13
                cv.fill(circ(x, y, 1.6 + rng.random(), 1.2 + rng.random() * 0.6, wob=0.2, seed=int(x * 10)), (120, 95, 60), alpha=150, clip=body, blur_r=0.3)
        fz = {2: [(0.62, 0.4, 1.8)], 3: [(0.3, 0.45, 2.3), (0.7, 0.35, 2.0), (0.58, 0.75, 1.6)]}.get(s, [])
        bb = body.getbbox()
        if fz and bb:
            x0, y0, x1, y1 = [v / cv.SS for v in bb]
            for (u, v, r) in fz:
                x, y = x0 + (x1 - x0) * u, y0 + (y1 - y0) * v
                cs = [(x + math.cos(a) * r * 0.75, y + math.sin(a) * r * 0.55, r * 0.6, r * 0.55) for a in np.linspace(0, 2 * math.pi, 6, endpoint=False)] + [(x, y, r * 0.8, r * 0.7)]
                cv.part(None, FUZZ, lw=0.6, shade=0.25, hl=0.2, mask=mask_circles(cv, cs), ink=lerp(FUZZ[3], INK, 0.3))
                for a in np.linspace(0.3, 6.0, 4): cv.fill(circ(x + math.cos(a) * r * 0.5, y + math.sin(a) * r * 0.35, 0.35, wob=0), (255, 255, 255))
        if s >= 2:  # stink wiggles
            for j in range(1 if s == 2 else 2):
                x = [21, 11][j]; yb = 10 + j % 2
                pts = [(x + math.sin(v * 1.6 + j) * 1.2, yb - v * 0.95) for v in np.linspace(0, 5.5, 14)]
                cv.line(pts, lerp(STINK[3], INK, 0.3), 1.6, alpha=230); cv.line(pts, STINK[1], 0.8)
    return d


# ---------- water_flask (freshness stages + fill levels) and rot ----------
WATER = [[(225, 248, 255), (150, 215, 245), (95, 170, 225), (60, 120, 185)],    # 0 fresh: clear blue
         [(235, 240, 220), (180, 205, 200), (130, 170, 175), (95, 130, 145)],   # 1 stale: cloudy, a little tea-tinted
         [(215, 230, 175), (160, 190, 120), (115, 150, 95), (80, 110, 75)],     # 2 spoiling: murky green
         [(205, 225, 150), (140, 175, 85), (100, 135, 65), (70, 100, 55)]]      # 3 rotten: pond-soup
def flask(stage=0, fill=1.0):
    def d(cv, em, i, n):
        cx, cy, r = 16, 20.5, 8.2
        body = circ(cx, cy, r, r * 0.95, wob=0.02, seed=3)
        neck = [(cx - 2.6, cy - r + 1.5), (cx + 2.6, cy - r + 1.5), (cx + 2.3, 7), (cx - 2.3, 7)]
        glass = [(235, 248, 255), (200, 225, 240), (165, 190, 215), (120, 140, 175)]
        cv.part(neck, glass, lw=0.85, shade=0.2, hl=0.2)
        cv.part(body, glass, lw=0.95, shade=0.22, hl=0.1)
        bm = cv.mask_from(body)
        if fill > 0:  # water inside, clipped to the body, with a little meniscus line
            wl = cy + r - 2 * r * fill * 0.92
            wc = WATER[stage]
            wpoly = [(cx - r - 1, wl), (cx + r + 1, wl), (cx + r + 1, cy + r + 1), (cx - r - 1, cy + r + 1)]
            cv.part(wpoly, wc, lw=0.0, shade=0.3, hl=0.0, outline=False, clip=bm)
            cv.line([(cx - r, wl), (cx + r, wl)], wc[0], 0.7, alpha=230, clip=bm)
            if stage >= 1:  # bubbles / specks
                rng = np.random.default_rng(stage)
                for _ in range(2 + stage * 2):
                    x, y = cx - 5 + rng.random() * 10, max(wl + 1.5, cy - 3) + rng.random() * 7
                    if stage == 1: cv.fill(circ(x, y, 0.55, wob=0), (255, 255, 255), alpha=180, clip=bm)
                    else: cv.fill(circ(x, y, 0.6 + rng.random() * 0.4, wob=0.2), wc[3], alpha=200, clip=bm)
            if stage == 3 and fill > 0.4:  # cute algae fuzz floating on top
                for x in (cx - 3.5, cx + 2.5):
                    cs = [(x + dx, wl + 0.3, 1.3, 0.9) for dx in (-1.1, 0, 1.1)]
                    cv.part(None, FUZZ, lw=0.5, shade=0.2, hl=0.2, mask=mask_circles(cv, cs), ink=lerp(FUZZ[3], INK, 0.3))
        # glass shines
        cv.line([(cx - 5.3, cy - 3.5), (cx - 6.0, cy + 1.0), (cx - 4.6, cy + 4.4)], (255, 255, 255), 0.9, alpha=200)
        cv.fill(circ(cx + 4.4, cy - 4.2, 0.8, wob=0), (255, 255, 255), alpha=220)
        # cork + leather strap
        cv.part([(cx - 2.4, 7.5), (cx + 2.4, 7.5), (cx + 2.0, 3.6), (cx - 2.0, 3.6)], "wood", lw=0.75, shade=0.3, hl=0.2)
        cv.part([(cx - 3.3, cy - r + 2.6), (cx + 3.3, cy - r + 2.6), (cx + 3.1, cy - r + 0.6), (cx - 3.1, cy - r + 0.6)], "leather", lw=0.7, shade=0.3, hl=0.2)
        cv.line([(cx + 3.0, cy - r + 1.6), (cx + 6.5, cy - r - 2.5), (cx + 8.5, cy - r - 1.0)], R("leather", 2), 0.9)
        if stage == 0 and fill >= 1: cv.fill(star_pts(25.5, 8.5, 2.5, 0.7, n=4), (255, 255, 255))
        if stage >= 2:
            for j in range(1 if stage == 2 else 2):
                x = [22.5, 9.5][j]
                pts = [(x + math.sin(v * 1.6 + j) * 1.1, 9 - v * 0.9) for v in np.linspace(0, 5.0, 12)]
                cv.line(pts, lerp(STINK[3], INK, 0.3), 1.5, alpha=230); cv.line(pts, STINK[1], 0.75)
    return d

def rot_icon(cv, em, i, n):
    """item 'rot': a cute sleepy compost lump with a sprout (what a fully spoiled stack turns into)."""
    cx, by = 16, 27
    soil = [(175, 135, 100), (130, 92, 68), (95, 66, 52), (66, 45, 40)]
    lump = [(cx - 11, by), (cx - 10, by - 5), (cx - 6.5, by - 9.5), (cx - 1, by - 11.5), (cx + 4.5, by - 10.5), (cx + 9, by - 7), (cx + 11, by - 2), (cx + 10, by + 0.5)]
    lump = [(x + cx, by - 5.5 - 6.2 * math.sin(a) * (1.0 if math.sin(a) > 0 else 0.55) + 0.6 * math.sin(a * 5)) for a in np.linspace(0, 2 * math.pi, 48, endpoint=False) for x in [10.8 * math.cos(a)]]
    cv.part(lump, soil, lw=1.0, shade=0.3, hl=0.15)
    bm = cv.mask_from(lump)
    rng = np.random.default_rng(7)
    for _ in range(7):  # clumps + little bits (leaf flecks, eggshell)
        x, y = cx - 8 + rng.random() * 16, by - 8 + rng.random() * 7
        cv.fill(circ(x, y, 1.0 + rng.random() * 0.8, 0.8, wob=0.25, seed=int(x * 9)), soil[2], alpha=170, clip=bm)
    cv.fill(circ(cx + 6.5, by - 3.5, 1.3, 0.8, rot=0.5, wob=0.1), (245, 235, 215), clip=bm)          # eggshell fleck
    cv.fill(circ(cx - 7.5, by - 4.0, 1.5, 0.7, rot=-0.4, wob=0.1), (190, 160, 70), clip=bm)          # old leaf bit
    for (x, y, r) in ((cx - 5.5, by - 8.2, 1.6), (cx + 7.2, by - 6.4, 1.3)):                          # mint fuzz
        cs = [(x + math.cos(a) * r * 0.7, y + math.sin(a) * r * 0.5, r * 0.6, r * 0.55) for a in np.linspace(0, 2 * math.pi, 5, endpoint=False)]
        cv.part(None, FUZZ, lw=0.5, shade=0.2, hl=0.2, mask=mask_circles(cv, cs), ink=lerp(FUZZ[3], INK, 0.3))
    # sprout on top
    cv.line([(cx + 0.5, by - 11), (cx + 0.2, by - 15.5)], R("leaf", 3), 0.9)
    cv.part([(cx + 0.2, by - 15), (cx + 5.0, by - 18.5), (cx + 6.0, by - 16), (cx + 2.0, by - 14.5)], "leaf", lw=0.7, shade=0.3, hl=0.2)
    cv.part([(cx + 0.2, by - 14.6), (cx - 4.0, by - 17), (cx - 4.5, by - 14.8), (cx - 1.2, by - 13.8)], "leaf", lw=0.7, shade=0.3, hl=0.2)
    # sleepy happy face + blush
    for s_ in (-1, 1):
        ex, ey = cx + s_ * 3.4, by - 5.2
        cv.line([(ex - 1.1, ey - 0.3), (ex, ey + 0.5), (ex + 1.1, ey - 0.3)], INK, 0.6)
        cv.fill(circ(cx + s_ * 5.6, by - 3.6, 1.2, 0.7, wob=0), (230, 130, 120), alpha=150)
    cv.line([(cx - 0.9, by - 3.4), (cx, by - 2.8), (cx + 0.9, by - 3.4)], INK, 0.5)
    # one stink wiggle (it IS rot, but a friendly one)
    pts = [(cx - 9 + math.sin(v * 1.6) * 1.0, by - 11 - v * 0.9) for v in np.linspace(0, 5.0, 12)]
    cv.line(pts, lerp(STINK[3], INK, 0.3), 1.5, alpha=220); cv.line(pts, STINK[1], 0.75)

# ---------- universal overlays ----------
def badge(kind):
    def d(cv, em, i, n):
        cx, cy, r = 24.5, 24.5, 4.3
        col = {"fresh": "cloth_green", "stale": "cloth_yellow", "spoiling": "leaf_autumn", "rotten": [(220, 240, 170), (160, 190, 100), (115, 145, 75), (75, 100, 60)]}[kind]
        cv.part(circ(cx, cy, r, wob=0.03), col, lw=0.8, shade=0.25, hl=0.15)
        if kind == "fresh":
            cv.fill(star_pts(cx, cy, 3.2, 1.1, n=4), (255, 255, 255))
        elif kind == "stale":
            cv.fill(circ(cx, cy, 2.6, wob=0), (255, 250, 230)); cv.line([(cx, cy - 1.8), (cx, cy), (cx + 1.4, cy + 0.6)], INK, 0.6)
        elif kind == "spoiling":
            p = drop_pts(cx, cy + 1, 1.7, 3.6); cv.fill(p, (255, 245, 220))
        else:
            for j in range(2):
                x = cx - 1.2 + j * 2.4
                cv.line([(x + math.sin(v * 2 + j) * 0.7, cy + 2.2 - v * 0.8) for v in np.linspace(0, 5.5, 10)], (255, 255, 230), 0.7)
    return d

def fuzz_overlay(level):
    def d(cv, em, i, n):
        rng = np.random.default_rng(level)
        for _ in range(2 + level * 2):
            x, y, r = 8 + rng.random() * 16, 10 + rng.random() * 14, 1.6 + rng.random() * 1.2
            cs = [(x + math.cos(a) * r * 0.75, y + math.sin(a) * r * 0.55, r * 0.6, r * 0.55) for a in np.linspace(0, 2 * math.pi, 6, endpoint=False)] + [(x, y, r * 0.8, r * 0.7)]
            cv.part(None, FUZZ, lw=0.6, shade=0.25, hl=0.2, mask=mask_circles(cv, cs), ink=lerp(FUZZ[3], INK, 0.3))
    return d

def stink(cv, em, i, n):
    t = i / n
    for j in range(3):
        x = [10, 16, 22][j]; ph = t * 2 * math.pi + j * 1.7
        pts = [(x + math.sin(v * 1.5 + ph) * 1.5, 14 - v * 1.4 + (j % 2)) for v in np.linspace(0, 7, 18)]
        a = int(255 * (0.6 + 0.4 * math.sin(ph)))
        cv.line(pts, lerp(STINK[3], INK, 0.3), 1.7, alpha=a); cv.line(pts, STINK[1], 0.85, alpha=a)

def flies(cv, em, i, n):
    t = i / n
    for j in range(3):
        a = t * 2 * math.pi * (1 if j != 1 else -1) + j * 2.1
        x = 16 + math.cos(a) * (8 - j) + math.sin(a * 2) * 1.5; y = 9 + math.sin(a) * 3.5 + j
        cv.line([(16 + math.cos(a - 0.6) * (8 - j), 9 + math.sin(a - 0.6) * 3.5 + j), (x, y)], (90, 80, 110), 0.4, alpha=110)  # buzz trail
        cv.fill(circ(x, y, 1.15, 1.0, wob=0), (70, 55, 80))
        wf = 1 if (i + j) % 2 else 0.5
        cv.fill(circ(x - 0.8, y - 1.0 * wf, 0.9, 0.6 * wf + 0.2, wob=0), (230, 245, 255), alpha=220)
        cv.fill(circ(x + 0.8, y - 1.0 * wf, 0.9, 0.6 * wf + 0.2, wob=0), (230, 245, 255), alpha=220)
        cv.fill(circ(x + 0.5, y + 0.1, 0.3, wob=0), (255, 255, 255))

if __name__ == "__main__":
    A = Atlas("surv_food", 32, 32, category="item")
    def staged(key, fns):
        """'stages' = 4 frames, frame index == gameplay spoil stage (0 fresh .. 3 rotten); fps 1, no loop, so
        registry.frame(id, 'stages', 0, stage) returns stage. Named per-stage anims alias the same frames."""
        idx = [A.addfn(key, st, 1, fn, fps=1, seed=5)[0] for st, fn in zip(STAGES, fns)]
        sp = A.sprites[key]; sp["animations"] = {"stages": {"frames": idx, "fps": 1, "loop": False}, **sp["animations"]}
    for f in FOODS: staged(f"food_{f}", [food(f, si) for si in range(4)])
    staged("food_water_flask", [flask(si, 1.0) for si in range(4)])
    for j, fl in enumerate((1.0, 0.66, 0.33, 0.0)):   # 'fill': 0 full .. 3 empty (fresh water)
        A.addfn("food_water_flask", f"fill_{j}", 1, flask(0, fl), fps=1, seed=5)
    fi = [A.sprites["food_water_flask"]["animations"][f"fill_{j}"]["frames"][0] for j in range(4)]
    A.sprites["food_water_flask"]["animations"]["fill"] = {"frames": fi, "fps": 1, "loop": False}
    A.addfn("rot", "idle", 1, rot_icon, fps=1, seed=5)
    for k in STAGES: A.addfn(f"food_badge_{k}", "idle", 1, badge(k), fps=1)
    A.addfn("food_overlay_fuzz", "light", 1, fuzz_overlay(1), fps=1); A.addfn("food_overlay_fuzz", "heavy", 1, fuzz_overlay(2), fps=1)
    A.addfn("food_overlay_stink", "idle", 6, stink, fps=6)
    A.addfn("fx_flies", "idle", 4, flies, fps=12)
    save_build("food", {"parts": [A.write()], "textures": []})
    print("food done")
