"""5. Raiding: crack overlays (1x1/2x1/2x2 + tileable), hit fx (splinters/chips/dust), collapse poof, fire loops (S/L + emissive),
embers, smoke, smoldering rubble, repair hammer sparkle."""
import math, numpy as np
from PIL import Image, ImageDraw, ImageFilter
from common import *
from fx_combat import twinkle, star, puff, heart_, CLOUD, DUST, capsule, round_poly
from toon import capsule_pts

RP = lambda n: [H(c) for c in RAMPS[n]]
INKC = H("#3b2433")
FIRE = [(255, 250, 214), (255, 214, 84), (255, 140, 46), (226, 74, 46)]
SMOKE = [(246, 242, 246), (214, 206, 220), (172, 160, 186), (122, 110, 140)]

# ------------------------------------------------------------------ cracks
def crack_paths(rng, x0, x1, y0, y1, n, depth=3):
    paths = []
    for _ in range(n):
        p = [(x0 + (x1 - x0) * rng.random(), y0 + (y1 - y0) * (0.1 + 0.7 * rng.random()))]; a = rng.random() * 6.28
        for k in range(rng.integers(4, 7)):
            a += rng.normal(0, 0.6); L = 3 + rng.random() * 5
            p.append((p[-1][0] + math.cos(a) * L, p[-1][1] + math.sin(a) * L * 0.9))
        paths.append(p)
        if depth > 1 and rng.random() < 0.7:   # branches
            q = p[len(p) // 2]; b = [q]; aa = a + 1.2
            for k in range(3): aa += rng.normal(0, 0.5); b.append((b[-1][0] + math.cos(aa) * 3, b[-1][1] + math.sin(aa) * 3))
            paths.append(b)
    return paths

def crack_overlay(W, Hh, region, stage, seed):
    """region: (x0, x1, y0, y1) box in 1x px where the building faces usually are."""
    cv = blank(W, Hh, seed); rng = np.random.default_rng(seed + stage * 7)
    n = [0, 3, 6, 10][stage] * max(1, int((region[1] - region[0]) / 40))
    for p in crack_paths(rng, *region, n):
        cv.line([(x + 0.6, y + 0.6) for x, y in p], (255, 244, 226), 0.7, alpha=150)    # lit lip
        cv.line(p, lerp(INKC, (70, 50, 60), 0.2), 0.9 + 0.25 * stage, alpha=235)
    if stage >= 2:   # chipped spots (darker dents)
        for _ in range(stage * 3):
            x = region[0] + (region[1] - region[0]) * rng.random(); y = region[2] + (region[3] - region[2]) * rng.random()
            cv.fill(wobbly(x, y, 2.4, 1.8, int(x * 7), 0.2), lerp(INKC, (90, 70, 80), 0.3), alpha=150)
            cv.fill(wobbly(x - 0.6, y - 0.6, 1.4, 1.0, int(y * 3), 0.2), (255, 244, 226), alpha=90)
    if stage == 3:   # soot smudges
        for _ in range(4):
            x = region[0] + (region[1] - region[0]) * rng.random(); y = region[2] + (region[3] - region[2]) * (0.4 + 0.6 * rng.random())
            glow(cv, x, y, 7, (70, 50, 70), 0.35)
    return cv

def crack_tile(stage, n=64):
    """tileable crack texture (wrap-around drawing)."""
    cv = blank(n, n, 2000 + stage); rng = np.random.default_rng(stage * 13)
    for p in crack_paths(rng, 0, n, 0, n, [0, 3, 6, 10][stage]):
        for ox in (-n, 0, n):
            for oy in (-n, 0, n):
                q = [(x + ox, y + oy) for x, y in p]
                cv.line([(x + 0.6, y + 0.6) for x, y in q], (255, 244, 226), 0.7, alpha=150); cv.line(q, lerp(INKC, (70, 50, 60), 0.2), 0.9 + 0.25 * stage, alpha=235)
    return cv

# ------------------------------------------------------------------ hit fx (64x64, center pivot)
def splinters(k, n=6, stone=False, dust=False):
    cv = blank(64, 64, 2100 + k); cx, cy = 32, 32; t = k / (n - 1); rng = np.random.default_rng(5 if stone else 3)
    if dust:
        for j in range(5):
            a = j / 5 * 6.28 + 0.4; d = 4 + t * 16; r = (3 + t * 5) * (1 - t * 0.6)
            puff(cv, cx + math.cos(a) * d, cy + math.sin(a) * d * 0.6 - t * 6, r, j, DUST if j % 2 else CLOUD, lw=0.7)
        return cv, None
    if k <= 1: puff(cv, cx, cy, 4 + k * 3, 1, DUST if not stone else CLOUD, lw=0.7)
    for j in range(7):
        a = -math.pi / 2 + (rng.random() - 0.5) * 2.6; v = 10 + rng.random() * 14
        x = cx + math.cos(a) * v * t * 1.3; y = cy + math.sin(a) * v * t + 22 * t * t
        if stone:
            r = 1.6 + rng.random() * 1.8; poly = wobbly(x, y, r, r * 0.8, j, 0.25, rot=k * 0.7 + j)
            cv.part(poly, RP("stone" if j % 2 else "cobble"), lw=0.6, shade=0.3, hl=0.2)
        else:
            L = 3 + rng.random() * 4; ang = k * 0.9 + j
            cv.part(capsule_pts(x - math.cos(ang) * L / 2, y - math.sin(ang) * L / 2, x + math.cos(ang) * L / 2, y + math.sin(ang) * L / 2, 0.9, 0.5), RP("wood"), lw=0.6, shade=0.2)
    if k in (0, 1): star(cv, cx + 8, cy - 8 - k * 3, 3 - k * 0.5)
    return cv, None

def ember(k, n=4):
    cv = blank(64, 64, 2200); e = blank(64, 64); s = [1.0, 1.25, 0.9, 0.7][k]
    for j, (dx, dy, r) in enumerate(((0, 0, 2.6), (-7, 6, 1.6), (6, -5, 1.4))):
        p = circle(32 + dx, 32 + dy, r * s, 14); cv.fill(p, FIRE[1 if j else 0]); cv.fill(circle(32 + dx, 32 + dy, r * s * 0.5, 10), (255, 255, 230))
        e.fill(circle(32 + dx, 32 + dy, r * s * 1.4, 14), FIRE[1]); None
    return cv, e

def smoke(k, n=6):
    cv = blank(64, 64, 2300 + k); t = k / (n - 1)
    r = 5 + t * 9; puff(cv, 32 + math.sin(t * 3) * 3, 40 - t * 14, r, 3, SMOKE, lw=0.8)
    if t > 0.3: puff(cv, 26, 46 - t * 10, r * 0.5, 4, SMOKE, lw=0.7)
    cv.img = fade(cv.img, 1 - max(0, t - 0.6) / 0.5)
    return cv, None

def repair(k, n=8):
    cv = blank(64, 64, 2400 + k); e = blank(64, 64); t = k / n
    ang = [-0.9, -1.2, -0.2, 0.4, 0.1, -0.5, -0.9, -1.1][k]; hx, hy = 30, 34
    # hammer
    hpts = capsule_pts(hx, hy, hx + 14, hy - 4, 1.4); head = rrect(hx + 11, hy - 11, hx + 17, hy + 1, 1.5)
    cv.part(rot_pts(hpts, ang, hx, hy), RP("wood"), lw=0.8, shade=0.25); cv.part(rot_pts(head, ang, hx, hy), RP("iron"), lw=0.9, shade=0.25, hl=0.25)
    if k in (3, 4, 5):   # bonk! sparkles, plus signs, a heart
        ix, iy = 40, 42
        for j in range(5):
            a = -math.pi / 2 + (j - 2) * 0.6; d = 5 + (k - 3) * 4
            twinkle(cv, ix + math.cos(a) * d, iy + math.sin(a) * d, 2.6 - (k - 3) * 0.5, (255, 246, 190), rot=j, e=e, ecol=(255, 236, 160))
    for j in range(3):   # green "+" pluses float up
        tt = (t + j / 3) % 1; x = 18 + j * 14; y = 48 - tt * 34; s = 3.4 * math.sin(tt * math.pi)
        if s > 0.4:
            for p in (rrect(x - s, y - s * 0.32, x + s, y + s * 0.32, 0.5), rrect(x - s * 0.32, y - s, x + s * 0.32, y + s, 0.5)):
                cv.part(p, RP("leaf"), lw=0.6, shade=0.05, hl=0); e.fill(p, (180, 255, 150), alpha=160)
    if k in (4, 5, 6): heart_(cv, 46, 22 - (k - 4) * 3, 3.2 - (k - 4) * 0.4, e)
    return cv, e

# ------------------------------------------------------------------ fire (64x96, feet pivot)
def flame(cv, e, cx, by, w, h, ph, seed):
    pts = []
    for j in range(40):
        t = j / 39; side = -1 if t < 0.5 else 1; u = t * 2 if t < 0.5 else (1 - t) * 2   # u: 0 bottom .. 1 tip
        y = by - h * (1 - u) if False else by - h * (u ** 0.9)
        wid = w * math.sin(min(1, (1 - u) * 1.15) * math.pi / 2) ** 0.8 * (1 - u * 0.15)
        wob = math.sin(u * 7 + ph + seed) * w * 0.18 * u
        pts.append((cx + side * wid * (1 - u) ** 0.35 + wob, by - h * u + (1 - u) * 0 ))
    # build closed teardrop: left up, right down
    left = [(cx - w * math.sin(math.pi * (1 - v) / 2) ** 0.7 * (1 - v) ** 0.4 + math.sin(v * 6 + ph + seed) * w * 0.22 * v, by - h * v) for v in np.linspace(0, 1, 24)]
    right = [(cx + w * math.sin(math.pi * (1 - v) / 2) ** 0.7 * (1 - v) ** 0.4 + math.sin(v * 6 + ph + seed + 0.6) * w * 0.22 * v, by - h * v) for v in np.linspace(1, 0, 24)]
    bottom = [(cx + math.cos(a) * w, by + math.sin(a) * w * 0.35) for a in np.linspace(0, math.pi, 12)]
    poly = left + right[1:] + bottom
    return poly

def fire_frame(size, k, n=8):
    cv = blank(64, 96, 2500 + k); e = blank(64, 96); ph = k / n * 6.283; by = 88
    S = 1.0 if size == "large" else 0.62
    None
    layers = [(0, 15, 46, FIRE, 0), (-9, 9, 28, FIRE, 1.7), (9, 9, 32, FIRE, 3.1)]
    for dx, w, h, rp, sd in layers:
        hh = h * S * (1 + 0.12 * math.sin(ph * (1 + sd * 0.3) + sd)); poly = flame(cv, e, 32 + dx * S, by, w * S, hh, ph, sd)
        cv.part(poly, rp, lw=0.8, shade=0.18, hl=0.12, ink=H(RAMPS["fire"][3])); e.fill(poly, (255, 170, 70))
    core = flame(cv, e, 32, by - 1, 8 * S, 30 * S * (1 + 0.1 * math.sin(ph * 1.3)), ph + 1, 5)
    cv.fill(core, FIRE[0]); e.fill(core, (255, 240, 180))
    for j in range(3):   # licks / sparks
        t = (k / n + j / 3) % 1; x = 32 + math.sin(j * 2.2 + t * 4) * 12 * S; y = by - (40 + t * 30) * S; r = 1.8 * S * (1 - t) + 0.3
        cv.fill(circle(x, y, r, 12), FIRE[1]); e.fill(circle(x, y, r + 0.6, 12), FIRE[1])
    return cv, e

def rubble(k, n=6):
    pc_cv = blank(96, 128, 2600); e = blank(96, 128); ph = k / n * 6.283; cx, by = 48, 112
    rng = np.random.default_rng(4)
    pile = wobbly(cx, by - 2, 30, 11, 3, 0.08); pc_cv.part(pile, RP("dirt"), lw=1.0, shade=0.25)
    items = []
    for j in range(16):
        a = rng.random() * 6.28; d = rng.random() ** 0.6; x = cx + math.cos(a) * d * 24; y = by - 4 + math.sin(a) * d * 7 - (1 - d) * 8
        items.append((y, x, j))
    for y, x, j in sorted(items):
        if j % 3 == 0: pc_cv.part(capsule_pts(x - 7, y, x + 7, y - 3 + (j % 2) * 5, 1.8), RP("wood_dark" if j % 2 else "wood"), lw=0.7, shade=0.25)
        elif j % 3 == 1: pc_cv.part(wobbly(x, y, 4, 3, j, 0.15), RP("cobble"), lw=0.7, shade=0.3, hl=0.2)
        else: pc_cv.part(rrect(x - 4, y - 2.5, x + 4, y + 2.5, 1), RP("stone"), lw=0.7, shade=0.3)
    # iron band bent + a little sad flag poking out (cozy)
    pc_cv.part(capsule_pts(cx + 6, by - 8, cx + 16, by - 30, 1.0), RP("wood_dark"), lw=0.5)
    pc_cv.part([(cx + 16, by - 30), (cx + 25, by - 25), (cx + 15.5, by - 23)], NEUTRAL, lw=0.6, shade=0.1)
    tm = blank(96, 128); mask_paint(tm, [[(cx + 16, by - 30), (cx + 25, by - 25), (cx + 15.5, by - 23)]], 255, 0, 0.3)
    # embers glow between pieces (emissive pulsing)
    for j, (x, y) in enumerate(((cx - 10, by - 6), (cx + 3, by - 9), (cx + 14, by - 4), (cx - 18, by - 2))):
        s = 0.6 + 0.4 * math.sin(ph + j * 1.7)
        pc_cv.fill(wobbly(x, y, 2.4, 1.3, j, 0.2), lerp(FIRE[3], FIRE[1], s)); e.fill(wobbly(x, y, 2.6, 1.5, j, 0.2), lerp(FIRE[3], FIRE[1], s)); None
    # smoke wisps rising
    for j in range(3):
        t = (k / n + j / 3) % 1; x = cx - 12 + j * 12 + math.sin(t * 5 + j) * 3; y = by - 12 - t * 46; r = 3 + t * 6
        c2 = blank(96, 128, 7); puff(c2, x, y, r, j, SMOKE, lw=0.7); pc_cv.img = Image.alpha_composite(pc_cv.img, fade(c2.img, math.sin(t * math.pi) * 0.85))
    return pc_cv, e, tm

def collapse(k, n=10):
    cv = blank(128, 128, 2700 + k); t = k / (n - 1); cx, by = 64, 104; rng = np.random.default_rng(11)
    # debris flying (behind cloud early)
    for j in range(8):
        a = -math.pi / 2 + (rng.random() - 0.5) * 2.4; v = 20 + rng.random() * 24
        x = cx + math.cos(a) * v * t * 1.4; y = by - 20 + math.sin(a) * v * t * 1.2 + 40 * t * t
        if y > by + 4 or t < 0.1: continue
        if j % 2: cv.part(capsule_pts(x - 5, y, x + 5, y - 2, 1.4), RP("wood"), lw=0.6, shade=0.25)
        else: cv.part(wobbly(x, y, 2.6, 2.0, j, 0.2, rot=k), RP("cobble"), lw=0.6, shade=0.3)
    R_ = [10, 22, 30, 34, 35, 34, 30, 24, 16, 8][k]
    if R_ > 0:
        cl = cloud(cx, by - R_ * 0.7, R_ * 1.25, R_ * 0.8, 3, 9, 0.48)
        c2 = blank(128, 128, 9); c2.part(cl, DUST if k < 3 else CLOUD, lw=1.1, shade=0.22, hl=0.14)
        for j in range(4): puff(c2, cx + (j - 1.5) * R_ * 0.6, by - 3 - (j % 2) * 4, R_ * 0.35, 20 + j, DUST, lw=0.8)
        cv.img = Image.alpha_composite(cv.img, fade(c2.img, 1 if k < 7 else 1 - (k - 6) / 4))
    if 2 <= k <= 7:
        for j in range(4):
            a = -math.pi / 2 + (j - 1.5) * 0.7; d = R_ + 6
            star(cv, cx + math.cos(a) * d * 1.2, by - R_ * 0.7 + math.sin(a) * d * 0.8, 4.2 - abs(j - 1.5) * 0.6, rot=k * 0.5 + j)
    return cv, None

# ------------------------------------------------------------------ build
def build():
    out = {}
    # crack overlays
    cr = Sheet("raid_cracks", 96, 128, 3, category="vfx", pivot=(0.5, 120 / 128), sharpen=False); spr = []
    for s in (1, 2, 3): cr.add(f"crack_1x1/stage{s}", crack_overlay(96, 128, (26, 70, 58, 116), s, 31).img, idx=s - 1)
    spr.append({"key": "crack_1x1", "category": "vfx", "atlas": "raid_cracks", "anchor": {"x": 0.5, "y": 0.9375},
                "animations": {"stage1": {"frames": [0], "fps": 1}, "stage2": {"frames": [1], "fps": 1}, "stage3": {"frames": [2], "fps": 1}}})
    cr.sprites = spr; out["cracks"] = cr
    crl = Sheet("raid_cracks_large", 160, 256, 3, category="vfx", pivot=(0.5, 248 / 256), sharpen=False); spr = []
    for i, (fp, reg) in enumerate((("2x1", (22, 120, 168, 238)), ("2x2", (20, 140, 100, 238)))):
        fr = []
        for s in (1, 2, 3): fr.append(crl.add(f"crack_{fp}/stage{s}", crack_overlay(160, 256, reg, s, 41 + i).img, idx=i * 3 + s - 1))
        spr.append({"key": f"crack_{fp}", "category": "vfx", "atlas": "raid_cracks_large", "anchor": {"x": 0.5, "y": round(248 / 256, 5)},
                    "animations": {f"stage{s}": {"frames": [fr[s - 1]], "fps": 1} for s in (1, 2, 3)}})
    crl.sprites = spr; out["cracks_large"] = crl
    for s in (1, 2, 3):
        c = crack_tile(s); downscale(c.img, (64, 64), False).save(os.path.join(TEX, f"crack_tile_s{s}.png")); downscale(c.img, (128, 128), False).save(os.path.join(TEX, f"crack_tile_s{s}@2x.png"))
    # small fx
    fx = Sheet("raid_fx", 64, 64, 12, category="vfx"); spr = []; idx = 0
    for key, fn, n, fps, loop in [("fx_hit_wood", lambda k, n: splinters(k, n), 6, 16, False), ("fx_hit_stone", lambda k, n: splinters(k, n, stone=True), 6, 16, False),
                                  ("fx_hit_dust", lambda k, n: splinters(k, n, dust=True), 6, 14, False), ("fx_raid_ember", ember, 4, 8, True),
                                  ("fx_raid_smoke", smoke, 6, 8, False), ("fx_repair_sparkle", repair, 8, 12, False)]:
        if idx % 12 + n > 12: idx = (idx // 12 + 1) * 12
        fr = []
        for k in range(n):
            cv, e = fn(k, n); fr.append(fx.add(f"{key}/idle/{k}", cv.img, e.img if e else None, idx=idx)); idx += 1
        spr.append({"key": key, "category": "vfx", "atlas": "raid_fx", "anchor": {"x": 0.5, "y": 0.5}, "animations": {"idle": {"frames": fr, "fps": fps, "loop": loop}}})
    fx.sprites = spr; out["fx"] = fx
    fi = Sheet("raid_fire", 64, 96, 8, category="vfx", pivot=(0.5, 88 / 96)); spr = []
    for r, size in enumerate(("small", "large")):
        fr = []
        for k in range(8):
            cv, e = fire_frame(size, k); fr.append(fi.add(f"fx_fire_{size}/idle/{k}", cv.img, e.img, idx=r * 8 + k))
        spr.append({"key": f"fx_fire_{size}", "category": "vfx", "atlas": "raid_fire", "anchor": {"x": 0.5, "y": round(88 / 96, 4)}, "animations": {"idle": {"frames": fr, "fps": 12}}})
    fi.sprites = spr; out["fire"] = fi
    rb = Sheet("raid_rubble", 96, 128, 6, category="building", pivot=(0.5, 120 / 128)); fr = []
    for k in range(6):
        cv, e, tm = rubble(k); fr.append(rb.add(f"rubble_smoldering/idle/{k}", cv.img, e.img, tm.img, idx=k))
    rb.sprites = [{"key": "rubble_smoldering", "category": "vfx", "atlas": "raid_rubble", "anchor": {"x": 0.5, "y": 0.9375},
                   "animations": {"idle": {"frames": fr, "fps": 6}}}]
    out["rubble"] = rb
    cb = Sheet("raid_fx_big", 128, 128, 5, category="vfx", pivot=(0.5, 104 / 128)); fr = []
    for k in range(10): cv, e = collapse(k); fr.append(cb.add(f"fx_collapse_poof/idle/{k}", cv.img, idx=k))
    cb.sprites = [{"key": "fx_collapse_poof", "category": "vfx", "atlas": "raid_fx_big", "anchor": {"x": 0.5, "y": round(104 / 128, 4)}, "animations": {"idle": {"frames": fr, "fps": 14, "loop": False}}}]
    out["big"] = cb
    return out

if __name__ == "__main__":
    for s in build().values(): print(s.save(), s.warnings[:3])
