"""3. Clans in the world: tintable flags (S/M/L, idle + flap), wall banner (2 facings), claim totem (emissive rune),
territory border tiles + tileable strip, 24 emblem masks (+ outline page), clan palettes, outline colors."""
import math, json, os, numpy as np
from PIL import Image, ImageDraw, ImageFilter
from common import *
from fx_combat import twinkle, star, heart_, eyes, capsule, round_poly

RP = lambda n: [H(c) for c in RAMPS[n]]
PY = 120   # ground/pivot line in 64x128 cells

# ------------------------------------------------------------------ palettes / outline colors
CLAN_PALETTES = [
    ("berry_cream", "Berry & Cream", "#E8475F", "#F6EAD2"), ("sky_sun", "Sky & Sunbeam", "#4F8FD6", "#FFD45A"),
    ("meadow", "Meadow", "#72C45C", "#FFFAF0"), ("plum_gold", "Plum & Gold", "#9B72D6", "#FFD45A"),
    ("pumpkin_cocoa", "Pumpkin & Cocoa", "#F4A74A", "#87563A"), ("teal_rose", "Teal & Rose", "#3FB3A6", "#FF9EC4"),
    ("honey_bark", "Honey & Bark", "#F7C844", "#74432C"), ("denim_cream", "Denim & Cream", "#5A6FB0", "#F6EAD2"),
    ("rose_mint", "Rose & Mint", "#FF9EC4", "#94DCA8"), ("pine_gold", "Pine & Gold", "#4FA37A", "#FFD45A"),
    ("brick_sand", "Brick & Sand", "#D0705A", "#F6DFA4"), ("lilac_teal", "Lilac & Teal", "#BBA4F0", "#3FB3A6"),
    ("mint_plum", "Mint & Plum", "#94DCA8", "#7452AD"), ("ember_sky", "Ember & Sky", "#FF8A2A", "#5CC6DC"),
    ("pebble_berry", "Pebble & Berry", "#A9A094", "#E8475F"), ("midnight_star", "Midnight & Star", "#3A66A8", "#FFF2A8"),
]
def clan_palettes():
    return {"note": "primary -> tintmask R, secondary -> tintmask G. Colors are multiplied onto neutral near-white cloth/trim, "
                    "so use them as-is for BuildPiece.tint (0xRRGGBB00). All swatches come from palette.json ramps.",
            "palettes": [{"index": i, "key": k, "name": n, "primary": p, "secondary": s} for i, (k, n, p, s) in enumerate(CLAN_PALETTES)]}

def _lin(c): c = np.asarray(c, float) / 255; return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
def _lab(rgb):
    r, g, b = _lin(rgb); X = 0.4124 * r + 0.3576 * g + 0.1805 * b; Y = 0.2126 * r + 0.7152 * g + 0.0722 * b; Z = 0.0193 * r + 0.1192 * g + 0.9505 * b
    f = lambda t: np.where(t > 0.008856, np.cbrt(t), 7.787 * t + 16 / 116)
    fx, fy, fz = f(X / 0.9505), f(Y), f(Z / 1.089); return np.array([116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)])
CVD = {"protan": [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
       "deutan": [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
       "tritan": [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]]}
def _sim(rgb, m):
    l = _lin(rgb); s = np.clip(np.array(m) @ l, 0, 1); s = np.where(s <= 0.0031308, s * 12.92, 1.055 * s ** (1 / 2.4) - 0.055); return s * 255
def outline_colors():
    cols = {"self": ("#FFE680", "solid", "Your own character: warm sunny yellow, brightest."),
            "party": ("#7FE0EE", "solid + party crown/star pip", "Party members: bright sky-cyan."),
            "clan": ("#4F8FD6", "solid", "Clan mates / allies: true blue."),
            "neutral": ("#B8B0C8", "thin, 60% alpha", "Neutral / unflagged players: soft lilac-grey (darker than self, so tritan eyes still split them)."),
            "enemy": ("#E8492E", "solid, +0.5px width, slow pulse", "Hostile / enemy clan: vermillion (reads dark-olive to red-blind eyes, never confused with blue).")}
    keys = list(cols); rows = {}
    for kind, m in [("normal", None)] + list(CVD.items()):
        mins = []
        for i in range(len(keys)):
            for j in range(i + 1, len(keys)):
                a, b = [hex2rgb(cols[k][0]) for k in (keys[i], keys[j])]
                if m: a, b = _sim(a, m), _sim(b, m)
                mins.append((float(np.linalg.norm(_lab(a) - _lab(b))), keys[i] + "/" + keys[j]))
        mins.sort(); rows[kind] = {"minDeltaE": round(mins[0][0], 1), "closestPair": mins[0][1]}
    return {"note": "World outline colors for player silhouettes / nameplate trims. Blue-vs-vermillion axis (Okabe-Ito style) keeps friend/foe "
                    "separable for protan/deutan/tritan; self and neutral differ by luminance. Pair color with a shape cue (enemy pulse, party pip) "
                    "for accessibility. Ink under-stroke for all: #3B2433 at 1px.",
            "ink": "#3B2433", "colors": {k: {"color": v[0], "style": v[1], "desc": v[2]} for k, v in cols.items()},
            "cvdCheck_CIELAB_dE76": rows, "highContrastAlt": {"self": "#FFFFFF", "party": "#00E5FF", "clan": "#2F6BFF", "neutral": "#C9C2B8", "enemy": "#FF3B1F"}}

# ------------------------------------------------------------------ cloth
def cloth_poly(x0, y0, W, Hh, phase, amp, shape="rect", skew=0.0, hang=False, N=24):
    """flag attached at x0 (pole side), top y0. returns (polygon, function(u,v)->point)."""
    def P(u, v):
        if hang:  # vertical banner: ripple sideways with v
            dx = amp * v * math.sin(2 * math.pi * (v * 0.9 - phase)); return (x0 + u * W + dx, y0 + v * Hh + u * W * skew)
        wave = amp * u * math.sin(2 * math.pi * (u * 1.1 - phase)); sag = u * u * Hh * 0.08
        return (x0 + u * W * (1 - 0.06 * abs(math.sin(2 * math.pi * (u - phase)))), y0 + v * Hh + wave + sag)
    top = [P(i / N, 0) for i in range(N + 1)]; bot = [P(i / N, 1) for i in range(N, -1, -1)]
    if shape == "pennant":
        pts = [P(i / N, 0.5 * (i / N)) for i in range(N + 1)] + [P(i / N, 1 - 0.5 * (i / N)) for i in range(N, -1, -1)]
    elif shape == "swallow":
        right = [P(1, 0), P(0.78, 0.5), P(1, 1)]; pts = top[:-1] + right + bot[1:]
    elif shape == "banner":   # hanging, pointed bottom
        pts = [P(0, 0), P(1, 0), P(1, 0.82), P(0.5, 1.0), P(0, 0.82)]
        pts = [P(u, 0) for u in np.linspace(0, 1, 8)] + [P(1, v) for v in np.linspace(0, 0.82, 12)] + [P(0.5, 1.0)] + [P(0, v) for v in np.linspace(0.82, 0, 12)]
    else: pts = top + bot
    return pts, P

def fold_shading(cv, pts, P, N=14, hang=False, strength=0.55):
    cl = cv.mask_from(pts)
    for i in range(N):
        u0, u1 = i / N, (i + 1) / N
        if hang:
            a, b, c, d = P(0, u0), P(1, u0), P(1, u1), P(0, u1); q0, q1 = P(0.5, u0), P(0.5, u1); slope = (q1[0] - q0[0])
        else:
            a, b, c, d = P(u0, -0.05), P(u1, -0.05), P(u1, 1.05), P(u0, 1.05); slope = (b[1] - a[1])
        if slope > 0.15: cv.fill([a, b, c, d], NEUTRAL[2], alpha=int(min(1, slope / 2.2) * 255 * strength), clip=cl)
        elif slope < -0.3: cv.fill([a, b, c, d], (255, 255, 255), alpha=int(min(1, -slope / 3) * 160), clip=cl)

def pole(cv, x, top, base=PY, r=1.7):
    cv.part(rrect(x - 5, base - 5, x + 5, base + 1, 2), RP("stone"), lw=0.9, shade=0.25)                  # stone footing
    cv.part(capsule(x, base - 2, x, top + 2, r), RP("wood_dark"), lw=0.9, shade=0.3, hl=0.25)
    for y in (base - 9, top + 10): cv.part(rrect(x - r - 0.8, y - 1.2, x + r + 0.8, y + 1.2, 0.6), RP("iron"), lw=0.6, shade=0.2)
    cv.part(circle(x, top, 2.8, 20), RP("gold"), lw=0.7, shade=0.25, gloss=[(x - 0.9, top - 0.9, 0.8, 0.6)])     # finial ball

def default_emblem(cv, tm, cx, cy, s):
    """baked default emblem (little paw) in secondary channel; renderer can overlay clan_emblems at emblemAnchor."""
    polys = [wobbly(cx, cy + 1.6 * s, 2.6 * s, 2.1 * s, 1, 0.05)] + [circle(cx + dx * s, cy + dy * s, 1.05 * s, 14) for dx, dy in ((-2.4, -1.3), (-0.8, -2.6), (0.9, -2.6), (2.5, -1.3))]
    cv.part(polys, NEUTRAL, lw=0.5, shade=0.1, hl=0.1); mask_paint(tm, polys, 255, 1, 0.3)

def flag(size, k, n, flap=True):
    cv = blank(64, 128, 801 + k); tm = blank(64, 128)
    cfg = {"small": (34, 18, 13, "pennant", 52), "medium": (34, 23, 17, "swallow", 80), "large": (34, 27, 21, "swallow", 106)}[size]
    px, W, Hh, shape, ph_ = cfg; top = PY - ph_
    phase = (k / n) if flap else 0.12; amp = {"small": 2.0, "medium": 2.6, "large": 3.2}[size] * (1.0 if flap else 0.6)
    pxx = 32 - (2 if size == "small" else 0)   # pole sits on the pivot
    pole(cv, pxx, top - 3)
    pts, P = cloth_poly(pxx + 1.5, top + 1, W, Hh, phase, amp, shape)
    cv.part(pts, NEUTRAL, lw=1.0, shade=0.12, hl=0.1); mask_paint(tm, pts, 255, 0)
    fold_shading(cv, pts, P)
    # secondary trim: stripe along the bottom/top edge
    if shape != "pennant":
        stripe = [P(u, 0.78) for u in np.linspace(0, 0.8 if shape == "swallow" else 1, 16)] + [P(u, 0.9) for u in np.linspace(0.8 if shape == "swallow" else 1, 0, 16)]
        cl = cv.mask_from(pts); cv.fill(stripe, NEUTRAL[1], clip=cl); mask_paint(tm, stripe, 255, 1, 0.3)
        tm.img = apply_alpha_from(tm.img.convert("RGBA"), cv.img) if False else tm.img
        e = P(0.42, 0.4); default_emblem(cv, tm, e[0], e[1], {"medium": 1.6, "large": 2.1}[size])
    else:
        dot = P(0.3, 0.5); c = circle(dot[0], dot[1], 2.2, 16); cv.part(c, NEUTRAL, lw=0.5, shade=0.05); mask_paint(tm, c, 255, 1, 0.3)
    # rope ties to pole
    for v in (0.1, 0.9 if shape != "pennant" else 0.5):
        q = P(0, v); cv.part(rrect(q[0] - 2.2, q[1] - 1, q[0] + 1.2, q[1] + 1, 0.8), RP("leather"), lw=0.5)
    return cv, tm

def wall_banner(facing, k, n, flap=True):
    cv = blank(64, 128, 851 + k); tm = blank(64, 128)
    sk = 0.5 if facing == 0 else -0.5
    W, Hh = 22, 40; x0 = 32 - W / 2; y0 = PY - 72 - (W / 2) * sk
    phase = k / n if flap else 0.1; amp = 1.1 if flap else 0.5
    # wooden rod with gold end knobs
    a = (x0 - 4, y0 - 2 - 4 * sk); b = (x0 + W + 4, y0 - 2 + (W + 4) * sk)
    pts, P = cloth_poly(x0, y0, W, Hh, phase, amp, "banner", skew=sk, hang=True)
    cv.part(pts, NEUTRAL, lw=1.0, shade=0.14, hl=0.1); mask_paint(tm, pts, 255, 0)
    fold_shading(cv, pts, P, hang=True, strength=0.4)
    cl = cv.mask_from(pts)
    for v0, v1 in ((0.06, 0.13), (0.7, 0.77)):
        band = [P(u, v0) for u in np.linspace(0, 1, 8)] + [P(u, v1) for u in np.linspace(1, 0, 8)]
        cv.fill(band, NEUTRAL[1], clip=cl); mask_paint(tm, band, 255, 1, 0.3)
    e = P(0.5, 0.4); default_emblem(cv, tm, e[0], e[1], 2.0)
    tip = P(0.5, 1.0)
    cv.part(capsule(tip[0], tip[1], tip[0], tip[1] + 4, 1.1), RP("gold"), lw=0.5)
    cv.part(circle(tip[0], tip[1] + 5, 1.8, 14), RP("gold"), lw=0.5)
    cv.part(capsule(a[0], a[1], b[0], b[1], 1.6), RP("wood_dark"), lw=0.8, shade=0.25)
    for p in (a, b): cv.part(circle(p[0], p[1], 2.3, 16), RP("gold"), lw=0.6, shade=0.25)
    mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
    cv.line([a, (mid[0], mid[1] - 9), b], H(RAMPS["leather"][2]), 0.8)      # hanging cord
    cv.part(circle(mid[0], mid[1] - 9.5, 1.4, 12), RP("iron"), lw=0.5)          # nail
    return cv, tm

def totem(k, n=6):
    cv = blank(64, 128, 901); tm = blank(64, 128); e = blank(64, 128); ph = k / n * 6.283; cx = 32
    # little moss/flower base
    base = wobbly(cx, PY - 3, 20, 6, 3, 0.07); cv.part(base, RP("grass"), lw=0.9, shade=0.25)
    # stone body: chubby rounded menhir
    body = []
    for j in range(60):
        a = j / 60 * 6.283; x = math.cos(a); y = math.sin(a)
        wd = 13 * (1 - 0.18 * (-y if y < 0 else 0)); body.append((cx + x * wd, PY - 30 + y * (28 if y < 0 else 26)))
    cv.part(body, RP("stone"), lw=1.1, shade=0.24, hl=0.14)
    cl = cv.mask_from(body)
    for (x, y, r) in ((cx - 7, PY - 12, 3), (cx + 8, PY - 40, 2.2), (cx - 9, PY - 46, 1.8)):   # moss spots
        cv.fill(wobbly(x, y, r, r * 0.7, int(x), 0.2), H(RAMPS["leaf"][1]), clip=cl)
    # carved rune ring + rune (emissive; tintable in R)
    pulse = 0.7 + 0.3 * math.sin(ph)
    rune = [circle(cx, PY - 32, 7.2, 40)]
    ring = arc_band(cx, PY - 32, 7, 7, 0, 6.2832, 1.6, 1.6, 50)
    cv.fill(ring, H(RAMPS["stone"][3]))
    glyph = [sparkle(cx, PY - 32, 5.2, 0.24)] + [circle(cx + math.cos(a) * 4.3, PY - 32 + math.sin(a) * 4.3, 0.8, 10) for a in (0.785, 2.356, 3.927, 5.498)]
    for g in glyph + [ring]:
        cv.fill(g, lerp((255, 250, 235), (255, 255, 255), pulse)); e.fill(g, (int(200 + 55 * pulse), int(240 + 15 * pulse), 255))
        mask_paint(tm, g, 255, 0, 0.3)
    None
    # wooden cap with sash (secondary tint) + little flag sprigs
    cap = rrect(cx - 12, PY - 60, cx + 12, PY - 54, 2.5); cv.part(cap, RP("wood"), lw=0.9, shade=0.25)
    sash = [(cx - 13, PY - 22), (cx + 13, PY - 17), (cx + 13, PY - 13), (cx - 13, PY - 18)]
    cv.part(sash, NEUTRAL, lw=0.8, shade=0.15, clip=cl); mask_paint(tm, sash, 255, 1, 0.3)
    knot = wobbly(cx + 10, PY - 16, 2.6, 2.2, 4, 0.1); cv.part(knot, NEUTRAL, lw=0.6); mask_paint(tm, knot, 255, 1, 0.3)
    for dx, h_ in ((-7, 14), (7, 11)):
        cv.part(capsule(cx + dx, PY - 58, cx + dx, PY - 58 - h_, 0.8), RP("wood_dark"), lw=0.5)
        fl = [(cx + dx + 0.6, PY - 58 - h_), (cx + dx + 7 + math.sin(ph + dx) * 0.8, PY - 58 - h_ + 2.5 + math.sin(ph + dx)), (cx + dx + 0.6, PY - 58 - h_ + 5)]
        cv.part(fl, NEUTRAL, lw=0.5, shade=0.1); mask_paint(tm, fl, 255, 0 if dx < 0 else 1, 0.3)
    cv.part(circle(cx, PY - 62, 3.2, 20), RP("gold"), lw=0.7, gloss=[(cx - 1, PY - 63, 0.9, 0.7)])
    # floating rune motes
    for j in range(3):
        t = (k / n + j / 3) % 1; x = cx + math.cos(j * 2.1) * 15; y = PY - 30 - t * 34
        s = math.sin(t * math.pi) * 2.0
        if s > 0.3: cv.fill(sparkle(x, y, s + 0.6, 0.25), (240, 250, 255)); e.fill(sparkle(x, y, s + 1.0, 0.25), (190, 236, 255)); mask_paint(tm, [sparkle(x, y, s + 0.6, 0.25)], 200, 0, 0.2)
    # flowers at the base
    for x in (cx - 15, cx + 14, cx + 4):
        cv.part(rstar(x, PY - 3, 2.6, 1.3, 5, 0.2, p=0.8), RP("flower_pink" if x != cx + 4 else "flower_yel"), lw=0.5)
    return cv, tm, e

# ------------------------------------------------------------------ territory border (64x32 overlay tiles)
CORN = {"N": (32, 0), "E": (64, 16), "S": (32, 32), "W": (0, 16)}
EDGES = {"ne": ("N", "E"), "se": ("E", "S"), "sw": ("S", "W"), "nw": ("W", "N")}
def territory(kind, k):
    cv = blank(64, 32, 950); tm = blank(64, 32)
    C = (32, 16)
    if kind in EDGES:
        a, b = (np.array(CORN[c], float) for c in EDGES[kind])
        inward = (np.array(C) - (a + b) / 2); inward /= np.linalg.norm(inward)
        # soft wash fading inward (clipped to the diamond)
        dia = [CORN[c] for c in "NESW"]; cl = cv.mask_from(dia)
        for j, (d, al) in enumerate(((0, 120), (2.2, 80), (4.4, 45), (6.6, 20))):
            band = [tuple(a + inward * d), tuple(b + inward * d), tuple(b + inward * (d + 2.4)), tuple(a + inward * (d + 2.4))]
            cv.fill(band, (255, 255, 255), alpha=al, clip=cl)
        # solid edge rope line
        cv.fill([tuple(a + inward * 0.2), tuple(b + inward * 0.2), tuple(b + inward * 1.5), tuple(a + inward * 1.5)], (255, 255, 255), alpha=235, clip=cl)
        # stitched dashes (2 per edge -> tileable; animated march by half a period)
        L = np.linalg.norm(b - a); u = (b - a) / L; per = L / 3
        for j in range(4):
            s0 = (j - 1) * per + (k / 2) * per + per * 0.2; s1 = s0 + per * 0.45
            s0, s1 = max(0, s0), min(L, s1)
            if s1 - s0 < 0.5: continue
            p0 = a + u * s0 + inward * 3.4; p1 = a + u * s1 + inward * 3.4
            cv.line([tuple(p0), tuple(p1)], (255, 255, 255), 0.9, clip=cl)
        cv.img = cv.img; tm.img = Image.new("RGBA", (cv.W, cv.H)); a_ = np.asarray(cv.img)[..., 3]
        t = np.zeros((cv.H, cv.W, 4), np.uint8); t[..., 0] = 255; t[..., 3] = 255; t[..., 0] = np.minimum(255, a_.astype(int) * 2); tm.img = Image.fromarray(t)
    elif kind.startswith("in_"):   # inner (concave) corner nub at a diamond corner
        c = np.array(CORN[kind[3:].upper()], float); dia = [CORN[x] for x in "NESW"]; cl = cv.mask_from(dia)
        cv.fill(circle(c[0], c[1], 4.5, 24, 2.6), (255, 255, 255), alpha=150, clip=cl)
        cv.fill(circle(c[0], c[1], 2.0, 16, 1.3), (255, 255, 255), alpha=235, clip=cl)
        a_ = np.asarray(cv.img)[..., 3]; t = np.zeros((cv.H, cv.W, 4), np.uint8); t[..., 0] = np.minimum(255, a_.astype(int) * 2); tm.img = Image.fromarray(t)
    else:  # fill: faint territory wash
        dia = [CORN[x] for x in "NESW"]; cv.fill(dia, (255, 255, 255), alpha=34)
        a_ = np.asarray(cv.img)[..., 3]; t = np.zeros((cv.H, cv.W, 4), np.uint8); t[..., 0] = np.where(a_ > 0, 255, 0); tm.img = Image.fromarray(t)
    return cv, tm

def territory_strip(w=64, h=16):
    cv = blank(w, h, 960)
    cv.fill([(0, 0), (w, 0), (w, 1.6), (0, 1.6)], (255, 255, 255), alpha=235)
    for j, al in enumerate((120, 80, 45, 20)): cv.fill([(0, 1.6 + j * 2.4), (w, 1.6 + j * 2.4), (w, 4 + j * 2.4), (0, 4 + j * 2.4)], (255, 255, 255), alpha=al)
    for j in range(4):
        x = j * 16 + 3; cv.line([(x, 4.2), (x + 7, 4.2)], (255, 255, 255), 0.9)
    return cv

# ------------------------------------------------------------------ emblems (32x32 single-channel masks)
EMBLEMS = ["paw", "star", "heart", "acorn", "mushroom", "leaf", "flower", "moon", "sun", "crown", "shield", "hammer",
           "fish", "bunny", "cat", "bear", "frog", "bee", "cloud", "carrot", "pine", "clover", "bell", "ghost"]
def emblem_mask(name):
    S = SS; m = Image.new("L", (32 * S, 32 * S), 0); d = ImageDraw.Draw(m)
    P = lambda pts: [(x * S, y * S) for x, y in pts]
    def poly(p, f=255): d.polygon(P(p), fill=f)
    def ell(cx, cy, rx, ry, f=255): d.ellipse([(cx - rx) * S, (cy - ry) * S, (cx + rx) * S, (cy + ry) * S], fill=f)
    def ln(p, w, f=0): d.line(P(p), fill=f, width=int(w * S), joint="curve")
    def cap(x0, y0, x1, y1, r, f=255): poly(capsule(x0, y0, x1, y1, r), f)
    c = 16
    if name == "paw":
        ell(c, 19.5, 7, 5.6)
        for dx, dy in ((-6.5, -3.5), (-2.3, -7.5), (2.3, -7.5), (6.5, -3.5)): ell(c + dx, 16 + dy, 2.7, 3.1)
    elif name == "star": poly(rstar(c, 16.8, 13, 6.4, 5, -math.pi / 2, p=1.2)); ell(c - 3, 15.5, 1.1, 1.5, 0); ell(c + 3, 15.5, 1.1, 1.5, 0)
    elif name == "heart":
        pts = []
        for k in range(80):
            t = k / 80 * 6.283; x = 16 * math.sin(t) ** 3; y = -(13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t))
            pts.append((c + x * 0.8, 15 + y * 0.8))
        poly(pts); ln([(c - 6, 10), (c - 8, 13)], 1.4)
    elif name == "acorn":
        ell(c, 19, 7.5, 8.5); poly(rrect(c - 9.5, 7, c + 9.5, 14, 4)); cap(c, 7.5, c + 1.5, 3.5, 1.3)
        ln([(c - 8, 14.2), (c + 8, 14.2)], 1.2)
        for x in (-5, 0, 5): ln([(c + x - 1.5, 9), (c + x + 1.5, 12)], 0.9)
    elif name == "mushroom":
        pts = [(c + math.cos(a) * 13, 15 + math.sin(a) * 10) for a in np.linspace(math.pi, 2 * math.pi, 30)]; poly(pts + [(c + 13, 16), (c - 13, 16)])
        poly(rrect(c - 4.5, 15, c + 4.5, 27, 3))
        for x, y, r in ((-6, 9.5, 2.2), (2, 7.5, 2.6), (8, 12, 1.8)): ell(c + x, y, r, r * 0.85, 0)
    elif name == "leaf":
        pts = [(c + 11 * math.sin(t) * math.sin(t / 2) ** 0.6 * 0.9, 27 - 22 * t / math.pi) for t in np.linspace(0, math.pi, 30)]
        pts += [(c - 11 * math.sin(t) * math.sin(t / 2) ** 0.6 * 0.9, 27 - 22 * t / math.pi) for t in np.linspace(math.pi, 0, 30)]
        poly(rot_pts(pts, 0.35, c, 16)); ln(rot_pts([(c, 28), (c, 9)], 0.35, c, 16), 1.2)
        for t in (13, 17, 21): ln(rot_pts([(c, t + 2), (c + 4.5, t - 1.5)], 0.35, c, 16), 0.9); ln(rot_pts([(c, t + 2), (c - 4.5, t - 1.5)], 0.35, c, 16), 0.9)
    elif name == "flower":
        for k in range(6):
            a = k / 6 * 6.283; ell(c + math.cos(a) * 7, 16 + math.sin(a) * 7, 5, 5)
        ell(c, 16, 4.2, 4.2, 0); ell(c, 16, 3, 3)
    elif name == "moon":
        ell(c, 16, 12, 12); ell(c + 6, 12, 10, 10, 0); ell(c - 5, 17, 1.0, 1.4, 0)
        poly(sparkle(c + 9, 21, 4, 0.22))
    elif name == "sun":
        poly(rstar(c, 16, 14, 9.5, 10, 0, p=0.8)); ell(c, 16, 7.5, 7.5, 0); ell(c, 16, 6.2, 6.2)
        ell(c - 2.4, 15, 0.9, 1.2, 0); ell(c + 2.4, 15, 0.9, 1.2, 0); ln([(c - 2, 18.5), (c, 19.5), (c + 2, 18.5)], 0.9)
    elif name == "crown":
        poly([(4, 24), (5, 9), (11, 16), (16, 6), (21, 16), (27, 9), (28, 24)]); poly(rrect(4, 22, 28, 27, 1.5))
        for x, y in ((5, 9), (16, 6), (27, 9)): ell(x, y, 2.2, 2.2)
        ln([(5, 22), (27, 22)], 1.0); ell(c, 18, 1.8, 1.8, 0)
    elif name == "shield":
        poly(round_poly([(5, 5), (27, 5), (27, 15), (16, 28), (5, 15)], 3)); poly(round_poly([(8.5, 8), (23.5, 8), (23.5, 14.5), (16, 24), (8.5, 14.5)], 2), 0)
        poly(round_poly([(11, 10.5), (21, 10.5), (21, 14), (16, 20.5), (11, 14)], 1.5))
    elif name == "hammer":
        cap(10, 26, 19, 13, 2.0); poly(rot_pts(rrect(9, 5, 27, 12, 2), 0.6, 18, 9)); ln(rot_pts([(18, 5), (18, 12)], 0.6, 18, 9), 1.0)
    elif name == "fish":
        ell(c - 1, 16, 10, 6.5); poly([(c + 7, 16), (c + 14, 9), (c + 13, 16), (c + 14, 23)]); ell(c - 6, 14.5, 1.3, 1.3, 0)
        ln([(c - 2, 11.5), (c - 2, 20.5)], 0.9); ln([(c + 2, 12), (c + 2, 20)], 0.9)
    elif name in ("bunny", "cat", "bear", "frog"):
        if name == "bunny": cap(c - 4.5, 13, c - 5.5, 3, 2.8); cap(c + 4.5, 13, c + 6, 3.5, 2.8); ell(c, 19, 10, 8.5)
        if name == "cat": poly([(c - 10, 16), (c - 9, 4), (c - 2, 10)]); poly([(c + 10, 16), (c + 9, 4), (c + 2, 10)]); ell(c, 18, 11, 9)
        if name == "bear": ell(c - 8, 9, 4, 4); ell(c + 8, 9, 4, 4); ell(c, 17.5, 11, 9.5); ell(c - 8, 9, 1.7, 1.7, 0); ell(c + 8, 9, 1.7, 1.7, 0)
        if name == "frog": ell(c - 6.5, 9, 4.5, 4.5); ell(c + 6.5, 9, 4.5, 4.5); ell(c, 18, 12, 8)
        ey = 9 if name == "frog" else 17.5
        ell(c - 4.2 - (2.3 if name == "frog" else 0), ey, 1.4, 1.8, 0); ell(c + 4.2 + (2.3 if name == "frog" else 0), ey, 1.4, 1.8, 0)
        my = 22 if name != "frog" else 20
        if name == "frog": ln([(c - 5, my), (c, my + 2.2), (c + 5, my)], 1.1)
        else: ell(c, my - 1.6, 1.4, 1.0, 0); ln([(c - 2.6, my + 0.3), (c, my + 1.5), (c + 2.6, my + 0.3)], 0.9)
        if name == "cat":
            for s_ in (-1, 1): ln([(c + s_ * 6, 21), (c + s_ * 12, 20)], 0.7); ln([(c + s_ * 6, 22.5), (c + s_ * 12, 23.5)], 0.7)
    elif name == "bee":
        ell(c - 6, 9, 5, 4); ell(c + 6, 9, 5, 4); ell(c, 18, 10, 8)
        for x in (-2.5, 2.5): ln([(c + x, 10.5), (c + x, 25.5)], 2.0)
        ell(c - 6, 17, 1.0, 1.3, 0); poly([(c + 9.5, 18), (c + 14, 18), (c + 9.5, 20)])
    elif name == "cloud":
        for x, y, r in ((-6, 18, 6), (0, 13, 7.5), (6.5, 17, 6), (0, 20, 6)): ell(c + x, y, r, r)
        ell(c - 3, 16.5, 0.9, 1.2, 0); ell(c + 3, 16.5, 0.9, 1.2, 0); ln([(c - 1.5, 19.5), (c, 20.3), (c + 1.5, 19.5)], 0.8)
    elif name == "carrot":
        poly([(c - 6, 10), (c + 6, 10), (c + 1, 29), (c - 1, 29)]); ell(c, 10.5, 6, 2.5)
        for a in (-0.5, 0, 0.5): cap(c, 9, c + math.sin(a) * 7, 9 - math.cos(a) * 7, 1.7)
        for y in (15, 20, 24): ln([(c - 4, y), (c - 1, y + 1)], 0.9)
    elif name == "pine":
        for y, w in ((5, 4), (10, 7), (15, 10), (20, 13)): poly(round_poly([(c, y - 2), (c + w, y + 6), (c - w, y + 6)], 1.5))
        poly(rrect(c - 2.5, 25, c + 2.5, 30, 1)); poly(sparkle(c, 3.5, 3.5, 0.25))
    elif name == "clover":
        for a in (-math.pi / 2, math.pi / 6 - 0.1, 5 * math.pi / 6 + 0.1):
            for s_ in (-1, 1): ell(c + math.cos(a) * 6.5 + math.cos(a + s_ * 1.2) * 2.5, 14 + math.sin(a) * 6.5 + math.sin(a + s_ * 1.2) * 2.5, 4.4, 4.4)
        cap(c, 15, c + 4, 29, 1.4)
    elif name == "bell":
        pts = [(c - 3.5, 7)] + [(c - 3.5 - 7.5 * (t ** 1.6), 7 + 17 * t) for t in np.linspace(0, 1, 15)] + [(c + 3.5 + 7.5 * (t ** 1.6), 7 + 17 * t) for t in np.linspace(1, 0, 15)] + [(c + 3.5, 7)]
        poly(pts); ell(c, 7, 4, 2.6); poly(rrect(c - 12, 22, c + 12, 25.5, 1.5)); ell(c, 27.5, 2.6, 2.6); ln([(c - 8, 20), (c + 8, 20)], 1.0)
        d.arc([(c - 2.5) * S, 1.5 * S, (c + 2.5) * S, 7 * S], 180, 360, fill=255, width=int(1.5 * S))
    elif name == "ghost":
        pts = [(c + math.cos(a) * 10, 14 + math.sin(a) * 10) for a in np.linspace(math.pi, 2 * math.pi, 20)]
        pts += [(c + 10, 26)] + [(c + 10 - 20 * t, 26 + 2.5 * math.sin(t * 3 * 6.283)) for t in np.linspace(0, 1, 30)] + [(c - 10, 14)]
        poly(pts); ell(c - 3.6, 14, 1.4, 1.9, 0); ell(c + 3.6, 14, 1.4, 1.9, 0); ell(c, 19, 1.3, 1.5, 0)
    return m

def emblem_rgba(m):
    """white RGB, alpha = mask (single channel) at SS -> later downscaled."""
    out = Image.new("RGBA", m.size, (255, 255, 255, 0)); out.putalpha(m); return out
def emblem_outline(m):
    a = np.asarray(m, np.float32) / 255; D = blur(a, SS * 0.9)
    ring = smooth(0.06, 0.2, D) * (1 - a)
    rgb = np.zeros(a.shape + (3,), np.float32) + np.array(H("#3b2433"), np.float32)
    return Image.fromarray(np.concatenate([rgb, (ring * 255)[..., None]], -1).astype(np.uint8))

# ------------------------------------------------------------------ build
def build():
    json.dump(clan_palettes(), open(os.path.join(ROOT, "clan_palettes.json"), "w"), indent=1)
    json.dump(outline_colors(), open(os.path.join(ROOT, "outline_colors.json"), "w"), indent=1)
    sh = Sheet("clan_banners", 64, 128, 14, category="building", pivot=(0.5, PY / 128)); sprites = []; idx = 0
    ap = {"x": 0.5, "y": round(PY / 128, 4)}
    sway = {"small": {"amp": 1.2, "freq": 0.9, "stiffness": 0.55}, "medium": {"amp": 1.6, "freq": 0.8, "stiffness": 0.5}, "large": {"amp": 2.0, "freq": 0.7, "stiffness": 0.45}}
    for size in ("small", "medium", "large"):
        key = {"small": "banner_small", "medium": "banner", "large": "banner_large"}[size]
        cv, tm = flag(size, 0, 6, flap=False); i0 = sh.add(f"{key}/idle/0", cv.img, None, tm.img, idx=idx); idx += 1
        fr = []
        for k in range(6):
            cv, tm = flag(size, k, 6); fr.append(sh.add(f"{key}/flap/{k}", cv.img, None, tm.img, idx=idx)); idx += 1
        key = {"small": "banner_small", "medium": "banner", "large": "banner_large"}[size]
        sprites.append({"key": key, "category": "building", "atlas": "clan_banners", "anchor": ap, "sway": sway[size], "rotationArt": "mirror",
                        "animations": {"idle": {"frames": [i0], "fps": 1}, "flap": {"frames": fr, "fps": 10}},
                        "building": {"piece": "banner", "footprint": {"w": 1, "h": 1}, "layer": 3, "frames": [[i0, i0, i0, i0]]}})
    idx = 28; wb = []
    for f_ in (0, 1):
        cv, tm = wall_banner(f_, 0, 4, flap=False); i0 = sh.add(f"banner_wall/idle/r{f_}", cv.img, None, tm.img, idx=idx); idx += 1
        fr = []
        for k in range(4):
            cv, tm = wall_banner(f_, k, 4); fr.append(sh.add(f"banner_wall/flap{'_r1' if f_ else ''}/{k}", cv.img, None, tm.img, idx=idx)); idx += 1
        wb.append((i0, fr))
    (a0, fa), (a1, fb) = wb
    sprites.append({"key": "banner_wall", "category": "building", "atlas": "clan_banners", "anchor": ap, "rotationArt": "mirror",
                    "sway": {"amp": 0.7, "freq": 0.6, "stiffness": 0.75},
                    "animations": {"idle": {"frames": [a0], "fps": 1}, "flap": {"frames": fa, "fps": 6}, "flap_r1": {"frames": fb, "fps": 6}},
                    "building": {"piece": "banner_wall", "footprint": {"w": 1, "h": 1}, "layer": 3, "frames": [[a0] * 4, [a1] * 4, [a0] * 4, [a1] * 4]}})
    idx = 42; fr = []
    for k in range(6):
        cv, tm, e = totem(k); fr.append(sh.add(f"claim_totem/idle/{k}", cv.img, e.img, tm.img, idx=idx)); idx += 1
    sprites.append({"key": "claim_totem", "category": "building", "atlas": "clan_banners", "anchor": ap, "rotationArt": "mirror",
                    "animations": {"idle": {"frames": fr, "fps": 6}},
                    "building": {"piece": "claim_totem", "footprint": {"w": 1, "h": 1}, "layer": 2, "frames": [[fr[0], fr[0], fr[0], fr[0]]]}})
    sh.sprites = sprites
    # territory
    tt = Sheet("clan_territory", 64, 32, 9, category="tile", pivot=(0.5, 0.5), make2x=True, sharpen=False); spr = []; i = 0; tt.edge_fade = False
    for kind in list(EDGES) + ["in_n", "in_e", "in_s", "in_w", "fill"]:
        fr = []
        for k in range(2):
            cv, tm = territory(kind, k); fr.append(tt.add(f"territory_{kind}/idle/{k}", cv.img, None, tm.img, idx=i + k * 9))
        i += 1
        spr.append({"key": f"territory_{kind}", "category": "tile", "atlas": "clan_territory", "anchor": {"x": 0.5, "y": 0.5}, "animations": {"idle": {"frames": fr, "fps": 2}}})
    tt.sprites = spr; tt.warnings = []
    st = territory_strip(); downscale(st.img, (64, 16), False).save(os.path.join(TEX, "territory_edge_strip.png")); downscale(st.img, (128, 32), False).save(os.path.join(TEX, "territory_edge_strip@2x.png"))
    # emblems
    em = Sheet("clan_emblems", 32, 32, 8, category="ui", pivot=(0.5, 0.5), sharpen=True); eo = Sheet("clan_emblems_outline", 32, 32, 8, category="ui", sharpen=False); spr = []
    for i, nme in enumerate(EMBLEMS):
        m = emblem_mask(nme); em.add(f"emblem_{nme}", emblem_rgba(m), idx=i); eo.add(f"emblem_{nme}", emblem_outline(m), idx=i)
        spr.append({"key": f"emblem_{nme}", "category": "ui", "atlas": "clan_emblems", "anchor": {"x": 0.5, "y": 0.5}, "animations": {"idle": {"frames": [i], "fps": 1}}})
    em.sprites = spr; eo.sprites = []
    return {"banners": sh, "territory": tt, "emblems": em, "emblems_outline": eo}

if __name__ == "__main__":
    o = build()
    for s in o.values(): print(s.save(), s.warnings[:4])
