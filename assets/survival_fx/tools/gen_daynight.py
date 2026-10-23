"""Day/night: grading keyframes JSON, per-keyframe 256x16 LUT strips, 256x8 time-of-day ramp, stars tile, moon,
fireflies, glow mushrooms (emissive), window glow decals (emissive), cozy night vignette."""
import json, math, os
import numpy as np
from PIL import Image, ImageFilter
from fxlib import *

def h2f(h): h = h.lstrip("#"); return [round(int(h[i:i + 2], 16) / 255, 4) for i in (0, 2, 4)]

# --- keyframes. ambient = linear light multiplier (same meaning as render/timeOfDay.ts AMBIENT; >1 allowed).
KEYS = [
 dict(name="deep_night", hour=2.0, ambient=[0.33, 0.31, 0.58], sun="#9fb0ff", sunIntensity=0.22, sunElevationDeg=-30, moonlight=True,
      shadowTint="#2a2350", fogTint="#3a3f6e", sky="#141a3a", saturation=0.86, contrast=1.02, lift=[0.030, 0.016, 0.060], gain=[0.95, 0.94, 1.08], vignette=0.55, splitShadow=0.18, splitHighlight=0.04),
 dict(name="dawn", hour=5.8, ambient=[0.84, 0.66, 0.72], sun="#ffb08a", sunIntensity=0.5, sunElevationDeg=4, shadowTint="#5a3c6e", fogTint="#d9a8b8", sky="#f0a890",
      saturation=1.04, contrast=1.0, lift=[0.035, 0.012, 0.035], gain=[1.05, 0.96, 1.0], vignette=0.25, splitShadow=0.14, splitHighlight=0.10),
 dict(name="morning", hour=8.5, ambient=[0.96, 0.95, 0.90], sun="#fff0d0", sunIntensity=0.9, sunElevationDeg=30, shadowTint="#5a5a8a", fogTint="#cfe0ec", sky="#a8d4f0",
      saturation=1.05, contrast=1.02, lift=[0.0, 0.004, 0.012], gain=[1.0, 1.0, 0.99], vignette=0.1, splitShadow=0.08, splitHighlight=0.05),
 dict(name="noon", hour=12.5, ambient=[1.02, 1.0, 0.97], sun="#fffaf0", sunIntensity=1.0, sunElevationDeg=68, shadowTint="#4c5a8c", fogTint="#d8e8f0", sky="#8cc8f0",
      saturation=1.08, contrast=1.03, lift=[0.0, 0.0, 0.010], gain=[1.0, 1.0, 0.99], vignette=0.08, splitShadow=0.07, splitHighlight=0.03),
 dict(name="golden_hour", hour=17.3, ambient=[1.0, 0.76, 0.62], sun="#ffb070", sunIntensity=0.85, sunElevationDeg=12, shadowTint="#6a4a7a", fogTint="#f0c890", sky="#ffc890",
      saturation=1.04, contrast=1.04, lift=[0.030, 0.0, 0.025], gain=[1.06, 0.95, 0.97], vignette=0.18, splitShadow=0.16, splitHighlight=0.06),
 dict(name="dusk", hour=19.0, ambient=[0.72, 0.52, 0.70], sun="#ff8a70", sunIntensity=0.35, sunElevationDeg=1, shadowTint="#4a3268", fogTint="#a07aa8", sky="#b06a8a",
      saturation=1.05, contrast=1.02, lift=[0.035, 0.010, 0.055], gain=[1.02, 0.92, 1.04], vignette=0.32, splitShadow=0.18, splitHighlight=0.10),
 dict(name="night", hour=21.5, ambient=[0.43, 0.41, 0.70], sun="#b0c0ff", sunIntensity=0.3, sunElevationDeg=-15, moonlight=True, shadowTint="#2e2a5c", fogTint="#4a5088", sky="#1e2450",
      saturation=0.92, contrast=1.02, lift=[0.030, 0.018, 0.065], gain=[0.97, 0.95, 1.08], vignette=0.48, splitShadow=0.18, splitHighlight=0.05),
]

def grade(rgb, k):
    """grading only (applied after lighting): sat, contrast, split-tone, gain/lift. rgb float [...,3] 0..1"""
    l = (rgb * np.array([0.299, 0.587, 0.114])).sum(-1, keepdims=True)
    c = l + (rgb - l) * k["saturation"]
    c = (c - 0.5) * k["contrast"] + 0.5
    st = np.array(h2f(k["shadowTint"])); sn = np.array(h2f(k["sun"]))
    sat = (rgb.max(-1, keepdims=True) - rgb.min(-1, keepdims=True)) / np.maximum(rgb.max(-1, keepdims=True), 1e-3)
    protect = 1 - 0.75 * sat * np.clip(rgb.max(-1, keepdims=True) * 1.5, 0, 1)   # keep fire / glow colours vivid
    ws = (1 - np.clip(l, 0, 1)) ** 2 * k["splitShadow"] * protect; wh = np.clip(l, 0, 1) ** 2 * k["splitHighlight"] * protect
    c = c * (1 - ws) + (c * 0.6 + st * 0.8) * ws        # cool plum shadows
    c = c * (1 - wh) + (c * sn) * wh + 0 * wh             # warm (sun-tinted) highlights
    c = c * np.array(k["gain"]) + np.array(k["lift"])
    return np.clip(c, 0, 1)

def lut_strip(k):
    """256x16: 16 slices of 16x16; red along x within a slice, green along y, blue across slices."""
    x = np.arange(256); y = np.arange(16)
    X, Y = np.meshgrid(x, y)
    r = (X % 16) / 15; g = Y / 15; b = (X // 16) / 15
    rgb = np.stack([r, g, b], -1)
    return Image.fromarray((grade(rgb, k) * 255 + 0.5).astype(np.uint8), "RGB")

def apply_lut(img_rgb01, lut):
    """reference trilinear LUT lookup (used by previews). img float HxWx3."""
    L = np.asarray(lut, np.float32) / 255
    cube = np.zeros((16, 16, 16, 3), np.float32)  # [b][g][r]
    for b in range(16): cube[b] = L[:, b * 16:(b + 1) * 16]
    p = np.clip(img_rgb01, 0, 1) * 15
    i0 = np.floor(p).astype(int); i1 = np.minimum(i0 + 1, 15); f = p - i0
    def at(ri, gi, bi): return cube[bi, gi, ri]
    out = 0
    for dr in (0, 1):
        for dg in (0, 1):
            for db in (0, 1):
                w = (f[..., 0] if dr else 1 - f[..., 0]) * (f[..., 1] if dg else 1 - f[..., 1]) * (f[..., 2] if db else 1 - f[..., 2])
                out = out + at((i1 if dr else i0)[..., 0], (i1 if dg else i0)[..., 1], (i1 if db else i0)[..., 2]) * w[..., None]
    return out

def sample_keys(h):
    ks = sorted(KEYS, key=lambda k: k["hour"])
    ext = [dict(k, hour=k["hour"] - 24) for k in ks[-1:]] + ks + [dict(k, hour=k["hour"] + 24) for k in ks[:1]]
    for a, b in zip(ext, ext[1:]):
        if a["hour"] <= h <= b["hour"]:
            t = (h - a["hour"]) / (b["hour"] - a["hour"]); t = t * t * (3 - 2 * t); return a, b, t
    return ext[0], ext[1], 0.0

def mix(a, b, t):
    if isinstance(a, str): a, b = h2f(a), h2f(b)
    if isinstance(a, list): return [x + (y - x) * t for x, y in zip(a, b)]
    return a + (b - a) * t

def tod_ramp():
    """256x8: column = hour*256/24. Rows: 0 ambient/1.25, 1 sun colour*intensity, 2 shadow tint, 3 fog tint, 4 sky,
    5 lift*4 (+0), 6 gain/1.25, 7 (R saturation/1.25, G contrast/1.25, B vignette)."""
    img = np.zeros((8, 256, 3), np.float32)
    for x in range(256):
        h = x * 24 / 256; a, b, t = sample_keys(h)
        img[0, x] = np.array(mix(a["ambient"], b["ambient"], t)) / 1.25
        img[1, x] = np.array(mix(a["sun"], b["sun"], t)) * mix(a["sunIntensity"], b["sunIntensity"], t)
        img[2, x] = mix(a["shadowTint"], b["shadowTint"], t); img[3, x] = mix(a["fogTint"], b["fogTint"], t); img[4, x] = mix(a["sky"], b["sky"], t)
        img[5, x] = np.array(mix(a["lift"], b["lift"], t)) * 4; img[6, x] = np.array(mix(a["gain"], b["gain"], t)) / 1.25
        img[7, x] = [mix(a["saturation"], b["saturation"], t) / 1.25, mix(a["contrast"], b["contrast"], t) / 1.25, mix(a["vignette"], b["vignette"], t)]
    Image.fromarray((np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8), "RGB").save(os.path.join(ROOT, "lut", "tod_ramp_256x8.png"))

# ---------------- sprites ----------------
def moon(cv, em, i, n):
    """moon phases (full, gibbous, half, crescent) with a sleepy face; emissive."""
    cx, cy, r = 32, 32, 20
    col = [(255, 252, 230), (250, 238, 190), (225, 210, 170), (180, 160, 140)]
    full = circ(cx, cy, r, wob=0.01)
    m = cv.mask_from(full)
    if i > 0:
        off = [0, 32, 24, 15][i]
        from PIL import ImageDraw
        cut = Image.new("L", (cv.W, cv.H), 0); S = cv.SS
        ImageDraw.Draw(cut).ellipse([(cx + off - r) * S, (cy - r - 2) * S, (cx + off + r) * S, (cy + r + 2) * S], fill=255)
        m = Image.fromarray(np.minimum(np.asarray(m), 255 - np.asarray(cut)).astype(np.uint8))
    cv.part(None, col, lw=1.1, shade=0.2, hl=0.1, mask=m, ink=lerp(col[3], INK, 0.5))
    em.part(None, col, lw=0, shade=0, hl=0, outline=False, mask=m)
    for (x, y, rr) in ((cx - 8, cy - 7, 3), (cx - 12, cy + 7, 2), (cx - 3, cy + 11, 2.5)):
        cv.fill(circ(x, y, rr, wob=0.1), col[2], alpha=150, clip=m)
    fx = cx - [0, 2, 6, 11][i]
    for s in (-1, 1):  # sleepy closed eyes
        ex = fx + s * 4.5 - 2
        cv.line([(ex - 2, cy - 1), (ex, cy + 0.6), (ex + 2, cy - 1)], (120, 90, 100), 0.9, clip=m)
    cv.fill(circ(fx - 8.5, cy + 3.5, 2.0, 1.2, wob=0), (255, 170, 170), alpha=160, clip=m)
    cv.line([(fx - 3.5, cy + 5), (fx - 2, cy + 6), (fx - 0.5, cy + 5)], (120, 90, 100), 0.8, clip=m)

def firefly(cv, em, i, n):
    t = i / n; p = 0.5 + 0.5 * math.sin(t * 2 * math.pi)
    c = 8
    cv.fill(circ(c, c + 1, 3.5 + 1.5 * p, wob=0), (210, 255, 140), alpha=int(60 + 90 * p), blur_r=1.4)
    em.fill(circ(c, c + 1, 3.5 + 1.5 * p, wob=0), (210, 255, 140), alpha=int(90 + 120 * p), blur_r=1.4)
    cv.fill(circ(c, c + 1.2, 1.5, wob=0), lerp((220, 255, 150), (150, 200, 90), 1 - p))
    em.fill(circ(c, c + 1.2, 1.5, wob=0), (240, 255, 170), alpha=int(140 + 115 * p))
    cv.fill(circ(c, c - 0.6, 1.0, 0.9, wob=0), (80, 60, 70))
    w = 0.9 if i % 2 else 0.4
    cv.fill(circ(c - 1.3, c - 1.4, 1.1, w, wob=0), (235, 245, 255), alpha=200); cv.fill(circ(c + 1.3, c - 1.4, 1.1, w, wob=0), (235, 245, 255), alpha=200)

GLOW = ramp("mush_glow"); EER = ramp("eerie")
def glow_mushroom(variant):
    def d(cv, em, i, n):
        t = i / n; p = 0.5 + 0.5 * math.sin(t * 2 * math.pi)
        cv.shadow(32, 56, 12, 3.5)
        spec = {"a": [(32, 56, 14, 1.0, 0)], "b": [(26, 56, 11, 0.85, 1), (38, 56, 8, 0.65, 2)], "c": [(24, 57, 7, 0.6, 3), (33, 56, 13, 0.95, 4), (42, 57, 6, 0.5, 5)]}[variant]
        for (x, by, h, k, sd) in spec:
            stem = [(x - 2.4 * k, by), (x + 2.4 * k, by), (x + 1.6 * k + math.sin(sd) * 1.0, by - h), (x - 1.6 * k + math.sin(sd) * 1.0, by - h)]
            cv.part(stem, [(240, 250, 245), (205, 225, 225), (160, 185, 195), (110, 130, 150)], lw=0.85, shade=0.3, hl=0.2)
            tx = x + math.sin(sd) * 1.0
            cap = [(tx + math.cos(a) * 9 * k, by - h + 1.5 * k - math.sin(a) * 7 * k) for a in np.linspace(0, math.pi, 20)] + [(tx - 9 * k, by - h + 2 * k), (tx + 9 * k, by - h + 2 * k)][::-1]
            cv.part(cap, GLOW, lw=0.95, shade=0.25, hl=0.2)
            em.fill(cap, lerp(GLOW[2], GLOW[1], p), alpha=int(150 + 80 * p))
            for (dx, dy, rr) in ((-4, -3, 1.4), (2, -5.2, 1.6), (5, -2, 1.1)):
                cv.fill(circ(tx + dx * k, by - h + dy * k, rr * k, wob=0), (250, 255, 250)); em.fill(circ(tx + dx * k, by - h + dy * k, rr * k, wob=0), (250, 255, 250))
            if k >= 0.95:  # cute sleepy face on the big one
                fy = by - h + 2.6 * k + 3
                for s in (-1, 1): cv.fill(circ(tx + s * 2.2, fy, 0.75, 0.9, wob=0), INK)
                cv.line([(tx - 0.9, fy + 1.7), (tx, fy + 2.2), (tx + 0.9, fy + 1.7)], INK, 0.55)
                cv.fill(circ(tx - 3.6, fy + 1.2, 1.1, 0.6, wob=0), (255, 160, 190), alpha=170); cv.fill(circ(tx + 3.6, fy + 1.2, 1.1, 0.6, wob=0), (255, 160, 190), alpha=170)
        # spore motes
        for j in range(3):
            ph = (t + j / 3) % 1
            x = 22 + j * 10 + math.sin(ph * 6 + j) * 2; y = 36 - ph * 20
            a = int(255 * math.sin(ph * math.pi))
            cv.fill(circ(x, y, 0.8, wob=0), EER[0], alpha=a); em.fill(circ(x, y, 1.4, wob=0), EER[1], alpha=a)
    return d

def window_glow(face, kind="glass", state="closed"):
    """Lit-window emissive variants for the gameplay opening pieces window_glass / window_shutters / window_bars
    (they fit wall_window). face 'left' = window on the +y (down-left facing) wall, 'right' = on the +x wall.
    Skewed 2:1 like the walls. Pivot = window bottom-centre. Drawn over the wall_window opening at night."""
    def d(cv, em, i, n):
        t = i / n; fl = 0.85 + 0.15 * math.sin(t * 2 * math.pi) * math.cos(t * 4 * math.pi + 1)
        sk = 0.5 if face == "left" else -0.5
        w, h = 13, 15; cx, by = 16, 23
        def P(u, v): return (cx + (u - 0.5) * w, by - v * h + (u - 0.5) * w * sk)
        frame = [P(0, 0), P(1, 0), P(1, 1), P(0, 1)]
        cv.part(frame, "wood_dark" if kind != "bars" else "stone", lw=0.9, shade=0.2, hl=0.2)
        inner = [P(0.12, 0.1), P(0.88, 0.1), P(0.88, 0.9), P(0.12, 0.9)]
        warm = [(255, 245, 190), lerp((255, 200, 110), (255, 225, 140), fl), (240, 150, 80), (190, 100, 70)]
        glow = lerp((255, 190, 100), (255, 220, 140), fl)
        closed = kind == "shutters" and state == "closed"
        if closed:   # warm light leaking through slats + heart cut-out
            cv.part(inner, [(80, 45, 45), (60, 32, 38), (45, 25, 32), (35, 20, 28)], lw=0.0, shade=0, hl=0, outline=False)
            em.fill(inner, glow, alpha=60)
        else:
            cv.part(inner, warm, lw=0.0, shade=0.3, hl=0.0, outline=False); em.fill(inner, glow)
        if kind == "glass":
            cv.line([P(0.5, 0.1), P(0.5, 0.9)], R("wood_dark", 2), 0.9); cv.line([P(0.12, 0.5), P(0.88, 0.5)], R("wood_dark", 2), 0.9)
            cv.line([P(0.22, 0.78), P(0.4, 0.6)], (255, 255, 245), 0.6, alpha=170)   # pane glint
            # little curtains (cozy)
            cv.part([P(0.12, 0.9), P(0.32, 0.9), P(0.2, 0.45), P(0.12, 0.4)], "cloth_red", lw=0.6, shade=0.3, hl=0.2)
            cv.part([P(0.88, 0.9), P(0.68, 0.9), P(0.8, 0.45), P(0.88, 0.4)], "cloth_red", lw=0.6, shade=0.3, hl=0.2)
            for poly in ([P(0.12, 0.9), P(0.32, 0.9), P(0.2, 0.45), P(0.12, 0.4)], [P(0.88, 0.9), P(0.68, 0.9), P(0.8, 0.45), P(0.88, 0.4)]):
                em.fill(poly, (90, 40, 30))   # curtains: faint warm transmission only
            for q in (capsule_pts(*P(0.5, 0.1), *P(0.5, 0.9), 0.5), capsule_pts(*P(0.12, 0.5), *P(0.88, 0.5), 0.5)): em.fill(q, (0, 0, 0))
        elif kind == "bars":   # iron bars: hard silhouettes against the glow
            for u in (0.31, 0.5, 0.69):
                cv.part(capsule_pts(*P(u, 0.08), *P(u, 0.92), 0.65), "iron", lw=0.55, shade=0.2, hl=0.25)
                em.fill(capsule_pts(*P(u, 0.08), *P(u, 0.92), 0.9), (0, 0, 0))   # bars block the glow
            cv.part(capsule_pts(*P(0.1, 0.62), *P(0.9, 0.62), 0.5), "iron", lw=0.5, shade=0.2, hl=0.25)
            em.fill(capsule_pts(*P(0.1, 0.62), *P(0.9, 0.62), 0.75), (0, 0, 0))
        else:  # shutters
            if closed:
                for v in (0.27, 0.44, 0.61, 0.78):   # slats: thin lit gaps between boards
                    cv.part([P(0.13, v - 0.07), P(0.87, v - 0.07), P(0.87, v + 0.07), P(0.13, v + 0.07)], "wood", lw=0.55, shade=0.3, hl=0.2)
                    gap = [P(0.15, v + 0.075), P(0.85, v + 0.075), P(0.85, v + 0.095), P(0.15, v + 0.095)]
                    cv.fill(gap, warm[1]); em.fill(gap, glow, alpha=230)
                cv.line([P(0.5, 0.1), P(0.5, 0.9)], R("wood_dark", 2), 0.8)
                hx, hy = P(0.5, 0.5)
                heart = [(hx + 16 * math.sin(a_) ** 3 * 0.1, hy - (13 * math.cos(a_) - 5 * math.cos(2 * a_) - 2 * math.cos(3 * a_) - math.cos(4 * a_)) * 0.1) for a_ in np.linspace(0, 2 * math.pi, 30)]
                cv.fill(heart, warm[0]); em.fill(heart, (255, 225, 150))
            else:  # open: boards folded out to both sides, panes lit
                cv.line([P(0.5, 0.1), P(0.5, 0.9)], R("wood_dark", 2), 0.8)
                for u0, u1 in ((-0.3, -0.02), (1.02, 1.3)):
                    cv.part([P(u0, 0.0), P(u1, 0.0), P(u1, 1.0), P(u0, 1.0)], "wood", lw=0.7, shade=0.3, hl=0.2)
                    for v in (0.3, 0.55, 0.8): cv.line([P(u0 + 0.05, v), P(u1 - 0.05, v)], R("wood", 3), 0.5, alpha=200)
        # flower box (cozy) on every variant
        cv.part([P(-0.05, 0.02), P(1.05, 0.02), P(1.0, -0.18), P(0.0, -0.18)], "wood", lw=0.7, shade=0.3, hl=0.2)
        for j, u in enumerate((0.15, 0.4, 0.62, 0.85)):
            x, y = P(u, 0.06)
            cv.part(circ(x, y, 1.6, wob=0.1), ["flower_pink", "flower_yel", "flower_blue", "flower_pink"][j], lw=0.5, shade=0.2, hl=0.2)
        # light spill below (emissive only, soft)
        em.fill([P(0.1, 0.0), P(0.9, 0.0), P(1.1, -0.35), P(-0.1, -0.35)], (255, 180, 90), alpha=25 if closed else 60, blur_r=1.5)
    return d

def textures():
    out = []
    # stars tile 512 RGBA (tileable): tiny dots + a few cute 4-point sparkles; alpha encodes brightness,
    # G channel low bits irrelevant; twinkle phase is in a separate R8 map so the shader can animate.
    S = 512; rng = np.random.default_rng(42); cv = Canvas(S, S, seed=1)
    phase = np.zeros((S, S), np.float32)
    for _ in range(260):
        x, y = rng.random() * S, rng.random() * S; r = 0.4 + rng.random() ** 3 * 1.2
        col = [(255, 255, 255), (255, 240, 200), (210, 225, 255), (255, 220, 240)][rng.integers(0, 4)]
        for ox in (-S, 0, S):
            for oy in (-S, 0, S):
                if -4 < x + ox < S + 4 and -4 < y + oy < S + 4:
                    cv.fill(circ(x + ox, y + oy, r, wob=0), col, alpha=int(150 + 105 * rng.random()))
        phase[int(y) % S, int(x) % S] = rng.random()
    for _ in range(18):
        x, y = 8 + rng.random() * (S - 16), 8 + rng.random() * (S - 16); s = 2.5 + rng.random() * 2.5
        cv.fill(star_pts(x, y, s, s * 0.28, n=4), (255, 250, 225)); cv.fill(circ(x, y, s * 0.9, wob=0), (255, 240, 200), alpha=60, blur_r=1.2)
    cv.final(sharpen=False).save(os.path.join(OUT_TEX, "stars_tile_512.png")); out.append("textures/stars_tile_512.png")
    ph = np.asarray(Image.fromarray((phase * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(5)))
    Image.fromarray(ph).save(os.path.join(OUT_TEX, "stars_twinkle_phase_512.png")); out.append("textures/stars_twinkle_phase_512.png")
    # cozy night vignette 512: plum-indigo colour, alpha radial (slightly oval for 16:9), RGBA, normal blend
    S = 512; y, x = np.mgrid[0:S, 0:S].astype(np.float32) / (S - 1) - 0.5
    d = np.sqrt((x * 1.0) ** 2 + (y * 1.15) ** 2) / 0.72
    a = smooth(0.55, 1.05, d) ** 1.3 * 0.75
    rgb = np.zeros((S, S, 3), np.float32) + np.array([30, 22, 58], np.float32)
    to_img(rgb, a).save(os.path.join(OUT_TEX, "night_vignette_512.png")); out.append("textures/night_vignette_512.png")
    return out

if __name__ == "__main__":
    os.makedirs(os.path.join(ROOT, "lut"), exist_ok=True)
    luts = {}
    for k in KEYS:
        p = f"lut/lut_{k['name']}.png"; lut_strip(k).save(os.path.join(ROOT, p)); luts[k["name"]] = p
    # identity LUT for reference / testing
    lut_strip(dict(saturation=1, contrast=1, shadowTint="#000000", sun="#ffffff", splitShadow=0, splitHighlight=0, gain=[1, 1, 1], lift=[0, 0, 0])).save(os.path.join(ROOT, "lut", "lut_identity.png"))
    tod_ramp()
    data = {
        "version": 1,
        "doc": "Cozy-Wild day/night grading keyframes. ambient = linear light multiplier (replaces render/timeOfDay.ts AMBIENT), "
               "sun = key-light colour (moon at night), shadowTint = colour projected/blob shadows and the cool split-tone go toward, "
               "fogTint = StyleConfig.fogColor, sky = clear colour. saturation/contrast/lift/gain map 1:1 to StyleConfig.grading. "
               "LUTs bake grading only (sat, contrast, split-tone, gain, lift) and are applied AFTER lighting/fog, so do not also apply "
               "StyleConfig.grading when a LUT is bound. Interpolate keyframes by hour with smoothstep, wrapping at 24h; blend the two "
               "neighbouring LUTs with the same weight.",
        "lutFormat": {"size": [256, 16], "cube": 16, "layout": "16 slices of 16x16; red along x within a slice, green along y (top row = green 0), blue = slice index (left = blue 0)", "colorSpace": "sRGB in / sRGB out (gamma-space, like the composite shader)", "identity": "lut/lut_identity.png"},
        "todRamp": {"image": "lut/tod_ramp_256x8.png", "x": "hour * 256 / 24", "rows": ["ambient / 1.25", "sun colour * intensity", "shadowTint", "fogTint", "sky", "lift * 4", "gain / 1.25", "R saturation/1.25, G contrast/1.25, B vignette"]},
        "styleSuggestions": {"lightBands": 4, "bandMix": 0.55, "nightMinBrightness": 0.30, "nightTint": [0.55, 0.58, 0.95], "emissiveStrength": 1.15, "daylightLightScale": 0.25, "blobShadow": {"alpha": 0.3}},
        "keyframes": [dict(k, lut=luts[k["name"]], sun=k["sun"], ambientHex="#%02x%02x%02x" % tuple(int(min(1, v) * 255) for v in k["ambient"])) for k in KEYS],
    }
    json.dump(data, open(os.path.join(ROOT, "daynight_grading.json"), "w"), indent=1)
    A = Atlas("surv_night", 64, 64, category="resource", emissive=True)
    for v in "abc": A.addfn(f"prop_glow_mushroom_{v}", "idle", 6, glow_mushroom(v), fps=4, anchor=(0.5, 0.875))
    M = Atlas("surv_moon", 64, 64, category="vfx", emissive=True)
    M.add("fx_moon", "phases", [render(lambda cv, em, i=i: moon(cv, em, i, 4), 64, 64, seed=3, emissive=True) for i in range(4)], fps=1)
    F = Atlas("surv_night_particles", 16, 16, category="vfx", emissive=True)
    F.addfn("fx_firefly_glow", "idle", 6, firefly, fps=8)
    W = Atlas("surv_window_glow", 32, 32, category="building", emissive=True)
    for kind in ("glass", "shutters", "bars"):
        for face in ("left", "right"):
            W.addfn(f"window_{kind}_lit", face, 4, window_glow(face, kind, "closed"), fps=4, anchor=(0.5, 0.71875))
        if kind == "shutters":
            for face in ("left", "right"):
                W.addfn("window_shutters_lit", f"{face}_open", 4, window_glow(face, kind, "open"), fps=4, anchor=(0.5, 0.71875))
    save_build("daynight", {"parts": [A.write(), M.write(), F.write(), W.write()], "textures": textures() + list(luts.values()) + ["lut/lut_identity.png", "lut/tod_ramp_256x8.png"]})
    print("daynight done")
