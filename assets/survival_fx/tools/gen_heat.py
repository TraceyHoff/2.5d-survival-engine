"""Heat sources: campfires (S/M/L), torch, brazier, stone fireplace, wood stove (+ emissive), fire particles,
light cookies, heat-radius ring, heat-shimmer RG noise."""
import math, os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from fxlib import *

FIRE = ramp("fire")   # hl, base, shade, deep
EMB = (255, 150, 60)

def flame(cv, em, cx, by, h, w, t, seed=0, eyes=False, lean=0.0):
    """layered cartoon flame; base at (cx,by); t=0..1 loop phase."""
    ph = t * 2 * math.pi
    def tongue(dx, hh, ww, rp, sd, lw=0.9, outline=True, sh=0.18):
        sway = math.sin(ph + sd) * 1.4 + lean
        squash = 1 + 0.10 * math.sin(ph * 2 + sd)
        pts = drop_pts(cx + dx, by - ww * 0.9, ww, hh * squash, tilt=sway / max(4, hh) * 2.2)
        cv.part(pts, rp, lw=lw, shade=sh, hl=0.0, outline=outline)
        return pts
    outer = [FIRE[1], FIRE[2], FIRE[3], lerp(FIRE[3], (150, 40, 50), 0.4)]
    mid = [FIRE[0], FIRE[1], FIRE[2], FIRE[3]]
    core = [(255, 255, 240), FIRE[0], FIRE[1], FIRE[2]]
    # side tongues + main
    for dx, hk, wk, sd in ((-w * 0.45, 0.55, 0.45, 1.3), (w * 0.45, 0.62, 0.42, 2.6), (0, 1.0, 0.62, 0.0)):
        hh = h * hk * (1 + 0.12 * math.sin(ph * (1 + abs(dx) * 0.05) + sd)); ww = w * wk
        p = tongue(dx, hh, ww, outer, sd)
        em.fill(p, FIRE[2])
    p = tongue(0, h * 0.68, w * 0.42, mid, 0.7, outline=False, sh=0.25); em.fill(p, FIRE[1])
    p = tongue(w * 0.05, h * 0.36, w * 0.24, core, 1.9, outline=False, sh=0.0); em.fill(p, FIRE[0])
    if eyes:  # tiny happy closed eyes ^^ (cute idle) – only on the big fire
        ey = by - h * 0.28
        for s in (-1, 1):
            ex = cx + s * w * 0.17 + math.sin(ph) * 0.5
            cv.line([(ex - 1.1, ey + 0.6), (ex, ey - 0.6), (ex + 1.1, ey + 0.6)], lerp(FIRE[3], INK, 0.5), 0.75)
        cv.fill(circ(cx - w * 0.33, ey + 1.6, 1.1, 0.7, wob=0), FIRE[3], alpha=150)
        cv.fill(circ(cx + w * 0.33, ey + 1.6, 1.1, 0.7, wob=0), FIRE[3], alpha=150)

def embers(cv, em, cx, by, h, t, n=4, seed=0, spread=8):
    rng = np.random.default_rng(seed)
    for i in range(n):
        ph = (t + rng.random()) % 1.0
        x = cx + (rng.random() - 0.5) * spread + math.sin(ph * 6 + i) * 1.5
        y = by - h * 0.5 - ph * h * 0.9
        r = 0.75 * (1 - ph * 0.6)
        a = int(255 * (1 - ph) ** 0.7)
        if y < 4.5: continue  # keep the 2px frame margin (the ember particle VFX carries them higher)
        cv.fill(circ(x, y, r + 0.3, wob=0), FIRE[0], alpha=a)
        em.fill(circ(x, y, r + 0.6, wob=0), FIRE[1], alpha=a)

def stone(cv, x, y, rx, ry, seed, rp="stone"):
    cv.part(circ(x, y, rx, ry, rot=(seed % 5 - 2) * 0.12, wob=0.12, seed=seed), rp, lw=0.85, shade=0.3, hl=0.18)
    if seed % 3 == 0: cv.fill(circ(x - rx * 0.3, y - ry * 0.1, rx * 0.25, ry * 0.2, wob=0), R("grass", 2), alpha=200)  # moss speck

def log(cv, x0, y0, x1, y1, r, seed, char=0.0):
    rp = ramp("wood_dark")
    cv.part(capsule_pts(x0, y0, x1, y1, r), rp, lw=0.85, shade=0.28, hl=0.15)
    # end grain on the near end
    ex, ey = (x1, y1) if y1 > y0 else (x0, y0)
    cv.part(circ(ex, ey, r * 0.95, r * 0.8, wob=0.05, seed=seed), "wood", lw=0.7, shade=0.15, hl=0.0)
    cv.line([(ex - r * 0.35, ey), (ex + r * 0.3, ey - r * 0.05)], R("wood", 2), 0.45)
    if char > 0: cv.fill(capsule_pts(x0, y0, x1, y1, r * 0.55), (60, 28, 30), alpha=int(170 * char))

def campfire(size):
    S = {"small": (0.68, 10, 4), "medium": (1.0, 16, 6), "large": (1.32, 24, 9)}[size]
    k, fh, ne = S
    def draw(cv, em, i, n, state="idle"):
        cx, by = 32, 53; t = i / n
        kr = min(k, 1.12)  # ring/shadow capped so the large fire fits the shared 64px frame + anchor
        rx, ry = 13 * kr, 5.7 * kr
        cv.shadow(cx, by - 1, rx + 3, ry + 1.5)
        # ash bed
        cv.part(circ(cx, by - 2, rx * 0.8, ry * 0.75, wob=0.08, seed=3), [(170, 160, 170), (130, 118, 132), (100, 88, 108), (70, 60, 80)], lw=0.6, shade=0.25, hl=0.1)
        if state != "unlit": em.fill(circ(cx, by - 2, rx * 0.55, ry * 0.5, wob=0), FIRE[3], alpha=160 if state == "idle" else 110)
        ns = 9 if size != "small" else 7
        ring = [(cx + math.cos(a) * rx, by - 2 + math.sin(a) * ry, a) for a in [j / ns * 2 * math.pi + 0.3 for j in range(ns)]]
        for x, y, a in ring:
            if math.sin(a) < 0: stone(cv, x, y, 3.3 * kr ** 0.6, 2.4 * kr ** 0.6, int(a * 10))
        # logs (teepee-ish crossed)
        L = 9 * k; r = 1.9 * k ** 0.7
        char = 0.0 if state == "unlit" else 0.6
        log(cv, cx - L, by - 2.5, cx + L * 0.5, by - 6 * k, r, 1, char)
        log(cv, cx + L, by - 2.0, cx - L * 0.4, by - 6.5 * k, r, 2, char)
        log(cv, cx - L * 0.2, by + 0.5, cx + L * 0.1, by - 7 * k, r * 0.9, 3, char)
        if state == "idle":
            flame(cv, em, cx, by - 3 * k, fh + 2 * math.sin(t * 2 * math.pi), 9 * k, t, eyes=(size == "large"))
            embers(cv, em, cx, by - 4, fh * 1.6, t, n=ne, seed=11 + len(size), spread=10 * k)
        elif state == "embers":  # dying: little blue-orange flicker + glowing coals
            flame(cv, em, cx, by - 3 * k, fh * 0.35 * (1 + 0.15 * math.sin(t * 6.28)), 6 * k, t)
            for j in range(5):
                x = cx + (j - 2) * 2.6 * k; y = by - 3 + (j % 2)
                a = int(160 + 90 * math.sin(t * 6.28 + j))
                cv.fill(circ(x, y, 1.0 * k, wob=0), FIRE[1], alpha=a); em.fill(circ(x, y, 1.3 * k, wob=0), FIRE[2], alpha=a)
        for x, y, a in ring:
            if math.sin(a) >= 0: stone(cv, x, y, 3.5 * kr ** 0.6, 2.6 * kr ** 0.6, int(a * 10) + 5)
    return draw

def torch(cv, em, i, n, state="idle"):
    cx, by = 32, 58; t = i / n
    cv.shadow(cx, by, 4, 1.8)
    cv.part(capsule_pts(cx, by - 1, cx + 0.6, by - 30, 1.5, 1.8), "wood_dark", lw=0.85, shade=0.3, hl=0.2)
    # cloth wrap
    cv.part([(cx - 3.3, by - 29), (cx + 4.0, by - 30), (cx + 3.5, by - 36), (cx - 2.8, by - 35.5)], "leather", lw=0.85, shade=0.3, hl=0.2)
    for yy in (-31.5, -33.8): cv.line([(cx - 3, by + yy), (cx + 3.6, by + yy - 0.5)], R("leather", 3), 0.5)
    cv.line([(cx + 3.6, by - 31), (cx + 5.5, by - 27.5)], R("leather", 2), 0.8)  # dangling strip
    if state == "unlit":  # charred cap + one lazy smoke curl
        cv.part(circ(cx + 0.4, by - 37, 3.2, 2.0, wob=0.1), [(110, 90, 100), (70, 55, 70), (50, 40, 55), (35, 28, 40)], lw=0.7, shade=0.3, hl=0.1)
        return
    flame(cv, em, cx + 0.5, by - 35, 14 + 1.5 * math.sin(t * 6.28), 5.2, t)
    embers(cv, em, cx, by - 38, 14, t, n=2, seed=5, spread=5)

def lantern(cv, em, i, n, state="idle"):
    """little iron-and-glass candle lantern (decor layer: sits on the floor/table/shelf). 64x64, base at (32,56)."""
    cx, by = 32, 56; t = i / n
    fl = 0.8 + 0.2 * math.sin(t * 2 * math.pi) * math.cos(t * 4 * math.pi + 0.7)
    ir = [(150, 140, 165), (96, 86, 112), (68, 58, 84), (46, 38, 58)]
    cv.shadow(cx, by, 9, 3)
    lit = state != "unlit"
    # glass body (behind the frame), warm inside when lit
    glass = [(cx - 8, by - 6), (cx + 8, by - 6), (cx + 7.2, by - 24), (cx - 7.2, by - 24)]
    gcol = [(255, 248, 205), lerp((255, 205, 120), (255, 228, 150), fl), (240, 160, 85), (200, 110, 70)] if lit else \
           [(225, 240, 245), (175, 200, 215), (140, 160, 185), (110, 125, 150)]
    cv.part(glass, gcol, lw=0.0, shade=0.32, hl=0.0, outline=False)
    if lit:
        em.fill(glass, lerp((255, 180, 95), (255, 215, 135), fl), alpha=210)
        em.fill(circ(cx, by - 13, 6, 6, wob=0), (255, 230, 160), alpha=170, blur_r=2)
    # candle + flame
    cv.part([(cx - 2.2, by - 7), (cx + 2.2, by - 7), (cx + 2.0, by - 13), (cx - 2.0, by - 13)], "cloth_cream", lw=0.6, shade=0.25, hl=0.25)
    cv.fill(circ(cx + 1.4, by - 11.5, 0.7, 1.4, wob=0), (255, 250, 235), alpha=200)  # wax drip
    cv.line([(cx, by - 13), (cx, by - 14.3)], INK, 0.5)
    if lit:
        hh = 5.2 + 0.7 * math.sin(t * 6.28)
        p = drop_pts(cx + 0.3 * math.sin(t * 6.28), by - 15, 1.7, hh)
        cv.part(p, [(255, 255, 240), FIRE[0], FIRE[1], FIRE[2]], lw=0.5, shade=0.2, hl=0.0, ink=lerp(FIRE[3], INK, 0.3)); em.fill(p, FIRE[0])
    # glass shine
    cv.line([(cx - 5.5, by - 9), (cx - 4.8, by - 21)], (255, 255, 255), 0.9, alpha=150)
    # iron frame: base plate, 4 posts, roof cap + ring handle
    cv.part(circ(cx, by - 5, 10, 3.4, wob=0.02), ir, lw=0.85, shade=0.25, hl=0.2)
    for dx in (-8, 8): cv.part(capsule_pts(cx + dx, by - 6, cx + dx * 0.9, by - 24, 0.9), ir, lw=0.6, shade=0.2, hl=0.2)
    cv.part(capsule_pts(cx, by - 6, cx, by - 24, 0.55), ir, lw=0.45, shade=0.0, hl=0.1)
    roof = [(cx - 10, by - 23.5), (cx + 10, by - 23.5), (cx + 4, by - 30), (cx - 4, by - 30)]
    cv.part(roof, ir, lw=0.85, shade=0.3, hl=0.25)
    cv.part(circ(cx, by - 31, 2.4, 1.6), ir, lw=0.6, shade=0.2, hl=0.2)
    ring = [(cx + math.cos(a) * 3.6, by - 35.5 + math.sin(a) * 3.6) for a in np.linspace(0, 2 * math.pi, 24)]
    cv.line(ring + [ring[0]], ir[2], 1.3); cv.line(ring[13:22], ir[0], 0.5)
    # cute heart cut-out on the roof that glows
    hx, hy = cx, by - 26.5
    heart = [(hx + 16 * math.sin(a) ** 3 * 0.12, hy - (13 * math.cos(a) - 5 * math.cos(2 * a) - 2 * math.cos(3 * a) - math.cos(4 * a)) * 0.12) for a in np.linspace(0, 2 * math.pi, 30)]
    cv.fill(heart, (255, 220, 140) if lit else (50, 40, 60)); (em.fill(heart, (255, 200, 120)) if lit else None)
    if lit: em.fill(circ(cx, by - 2, 9, 2.5, wob=0), FIRE[2], alpha=70, blur_r=1.5)  # warm spill on the floor

def brazier(cv, em, i, n):
    cx, by = 32, 58; t = i / n
    cv.shadow(cx, by, 11, 3.5)
    iron = ramp("iron"); ir = [lerp(c, (90, 80, 100), 0.35) for c in iron]
    for dx in (-7, 7, 0):
        lx = cx + dx; ly = by - (0 if dx else -1)
        cv.part(capsule_pts(lx * 0.75 + cx * 0.25, by - 12, lx, ly - 1, 1.0, 1.2), ir, lw=0.8, shade=0.3, hl=0.2)
        cv.part(circ(lx, ly - 0.5, 1.8, 1.0), ir, lw=0.7, shade=0.2, hl=0.1)
    # bowl
    bowl = [(cx - 12, by - 20)] + [(cx + math.cos(a) * 12, by - 20 + math.sin(a) * 9) for a in np.linspace(0, math.pi, 20)] + [(cx + 12, by - 20)]
    cv.part(bowl, ir, lw=0.95, shade=0.3, hl=0.15)
    for a in np.linspace(0.4, math.pi - 0.4, 5):  # rivets
        cv.fill(circ(cx + math.cos(a) * 9.5, by - 18 + math.sin(a) * 5, 0.7, wob=0), ir[0])
    cv.part(circ(cx, by - 20, 12, 3.6, wob=0.02), ir, lw=0.9, shade=0.0, hl=0.0)
    cv.fill(circ(cx, by - 20, 10.5, 2.6, wob=0), (90, 50, 50))
    cv.fill(circ(cx, by - 20, 9, 2.0, wob=0.1), FIRE[3]); em.fill(circ(cx, by - 20, 9, 2.0, wob=0.1), FIRE[3])
    for j in range(5):  # coals
        x = cx - 7 + j * 3.5; y = by - 20.5 + (j % 2)
        cv.part(circ(x, y, 1.8, 1.2, seed=j), [(255, 170, 90), (200, 80, 60), (140, 50, 60), (90, 40, 50)], lw=0.6, shade=0.3, hl=0.2)
    flame(cv, em, cx, by - 21, 18 + 2 * math.sin(t * 6.28), 8.5, t)
    embers(cv, em, cx, by - 22, 18, t, n=4, seed=9, spread=10)
    cv.part(circ(cx, by - 18.2, 12.2, 3.2, wob=0.02), ir, lw=0.0, outline=False, shade=0.0, hl=0.0, clip=None) if False else None
    cv.line([(cx - 11.5, by - 18.5), (cx - 5, by - 16.6), (cx + 5, by - 16.6), (cx + 11.5, by - 18.5)], ir[0], 0.7, alpha=200)  # front lip highlight

def fireplace(cv, em, i, n):
    """stone fireplace + chimney, 128x128, base at (64,112). iso-facing: front face looks down-left."""
    t = i / n; cx, by = 64, 115
    cv.shadow(cx, by - 4, 40, 14)
    st = ramp("cobble"); stl = [lerp(c, (255, 240, 220), 0.06) for c in st]
    # hearth slab (iso)
    slab = [(cx - 40, by - 10), (cx, by - 30), (cx + 40, by - 10), (cx, by + 8)]
    cv.part(slab, "stone", lw=1.0, shade=0.12, hl=0.08)
    # main body: left face (lit), right face (shade) -- box from footprint
    L = [(cx - 34, by - 16), (cx - 2, by), (cx - 2, by - 50), (cx - 34, by - 66)]
    Rf = [(cx - 2, by), (cx + 30, by - 16), (cx + 30, by - 66), (cx - 2, by - 50)]
    T = [(cx - 34, by - 66), (cx - 2, by - 50), (cx + 30, by - 66), (cx - 2, by - 82)]
    cv.part(Rf, [st[1], st[2], st[3], st[3]], lw=1.0, shade=0.1, hl=0.0)
    cv.part(L, stl, lw=1.0, shade=0.12, hl=0.06)
    # chimney
    ch = [(cx - 18, by - 74), (cx - 4, by - 67), (cx - 4, by - 96), (cx - 18, by - 103)]
    chr_ = [(cx - 4, by - 67), (cx + 10, by - 74), (cx + 10, by - 103), (cx - 4, by - 96)]
    cv.part(T, [st[0], st[0], st[1], st[3]], lw=1.0, shade=0.0, hl=0.0)
    cv.part(chr_, [st[1], st[2], st[3], st[3]], lw=0.9, shade=0.1, hl=0.0)
    cv.part(ch, stl, lw=0.9, shade=0.12, hl=0.06)
    cv.part([(cx - 18, by - 103), (cx - 4, by - 96), (cx + 10, by - 103), (cx - 4, by - 110)], [st[0], st[0], st[1], st[3]], lw=0.9, shade=0, hl=0)
    cv.fill(circ(cx - 4, by - 103, 5.5, 2.6, wob=0), (60, 40, 55))
    # stone blocks on the faces (rows of rounded stones skewed to the face)
    rng = np.random.default_rng(4)
    def face_stones(p0, eu, ev, rows, cols, tone):
        for r_ in range(rows):
            off = (r_ % 2) * 0.5
            for c_ in range(cols):
                u = (c_ + off + 0.5) / cols; v = (r_ + 0.5) / rows
                if u > 1: continue
                x = p0[0] + eu[0] * u + ev[0] * v; y = p0[1] + eu[1] * u + ev[1] * v
                ww = abs(eu[0]) / cols * 0.42; hh = abs(ev[1]) / rows * 0.4
                col = lerp(tone, (255, 245, 230) if rng.random() > 0.5 else (120, 110, 140), rng.random() * 0.18)
                cv.part(circ(x, y + eu[1] / cols * 0.0, ww, hh, rot=math.atan2(eu[1], eu[0]), wob=0.15, seed=int(rng.random() * 99)),
                        [lerp(col, (255, 255, 255), 0.2), col, lerp(col, (80, 70, 100), 0.3), lerp(col, (50, 40, 60), 0.5)], lw=0.55, shade=0.25, hl=0.12, ink=lerp(st[3], INK, 0.4))
    face_stones((cx - 34, by - 66), (32, 16), (0, 50), 6, 4, st[1])
    face_stones((cx - 2, by - 50), (32, -16), (0, 50), 6, 4, st[2])
    face_stones((cx - 18, by - 103), (14, 7), (0, 29), 4, 2, st[1])
    # firebox arch on the left face
    u0, u1, vtop, vbot = 0.18, 0.86, 0.36, 0.98
    def P(u, v): return (cx - 34 + 32 * u, by - 66 + 16 * u + 50 * v)
    arch = [P(u0, vbot)] + [P(u0 + (u1 - u0) * (0.5 - 0.5 * math.cos(a)), vtop + 0.16 - 0.16 * math.sin(a)) for a in np.linspace(0, math.pi, 18)] + [P(u1, vbot)]
    cv.part(arch, [(70, 40, 50), (50, 28, 40), (40, 22, 34), (30, 18, 28)], lw=1.1, shade=0, hl=0)
    m = cv.mask_from(arch)
    g = [(255, 220, 140), (255, 160, 70), (230, 90, 50), (150, 50, 50)]
    cv.fill(circ(*P(0.52, 0.85), 11, 7, wob=0.1), g[2], alpha=160, clip=m, blur_r=3)
    em.fill(circ(*P(0.52, 0.85), 11, 7, wob=0.1), g[2], alpha=150, clip=None, blur_r=3)
    # keystone + mantel
    cv.part([P(0.45, vtop - 0.03), P(0.6, vtop - 0.03 + 0.0), P(0.58, vtop + 0.08), P(0.47, vtop + 0.08)], "stone", lw=0.7)
    mant = [P(0.03, 0.29), P(0.97, 0.29), (P(0.97, 0.29)[0], P(0.97, 0.29)[1] + 4.5), (P(0.03, 0.29)[0], P(0.03, 0.29)[1] + 4.5)]
    cv.part(mant, "wood_dark", lw=0.9, shade=0.3, hl=0.2)
    mx, my = P(0.25, 0.3); cv.part(circ(mx, my - 3, 2.2, 2.6), "mush_red", lw=0.7)  # tiny candle-ish mushroom decor
    cv.part(capsule_pts(*P(0.75, 0.27), *P(0.78, 0.18), 1.2), "cloth_cream", lw=0.6); em.fill(circ(*P(0.78, 0.16), 1.2, wob=0), FIRE[0])
    cv.fill(circ(*P(0.78, 0.16), 0.9, 1.4, wob=0), FIRE[1])
    # logs + fire inside
    fx, fy = P(0.52, 0.93)
    log(cv, fx - 9, fy, fx + 6, fy - 3, 1.8, 5, 0.6); log(cv, fx + 9, fy - 1, fx - 5, fy - 3.5, 1.8, 6, 0.6)
    flame(cv, em, fx, fy - 2, 16 + 2 * math.sin(t * 6.28), 7.5, t)
    embers(cv, em, fx, fy - 3, 12, t, n=2, seed=3, spread=6)
    # hearth fender stones front
    for j in range(4): stone(cv, *P(0.1 + j * 0.27, 1.05), 2.6, 1.8, 40 + j, "cobble")
    # chimney smoke wisp is a separate particle (fx_smoke_puff)

def stove(cv, em, i, n):
    """cute pot-belly wood stove, 128x128, base at (64,112). """
    t = i / n; cx, by = 64, 110
    cv.shadow(cx, by, 22, 8)
    ir = [(150, 150, 170), (92, 88, 110), (66, 60, 84), (44, 38, 58)]
    for dx in (-13, 13, -6, 6):  # feet
        cv.part(capsule_pts(cx + dx * 0.9, by - 9, cx + dx, by - (2 if abs(dx) > 10 else 0), 2.0, 2.4), ir, lw=0.8, shade=0.25, hl=0.2)
    # stove pipe
    cv.part(capsule_pts(cx + 1, by - 52, cx + 1, by - 100, 4.2), ir, lw=0.95, shade=0.35, hl=0.25)
    cv.part(circ(cx + 1, by - 78, 5.4, 2.2), ir, lw=0.8, shade=0.1, hl=0.0)
    cv.part(circ(cx + 1, by - 100, 5.6, 2.4), ir, lw=0.8, shade=0.1, hl=0.0)
    cv.fill(circ(cx + 1, by - 100.4, 3.6, 1.4, wob=0), (40, 30, 45))
    # belly
    belly = circ(cx, by - 26, 18, 20, wob=0.03, seed=2)
    cv.part(belly, ir, lw=1.1, shade=0.26, hl=0.14, gloss=[(cx - 9, by - 34, 2.4, 4.5)])
    # top plate + kettle
    cv.part(circ(cx, by - 44, 15, 5, wob=0.02), ir, lw=0.95, shade=0.15, hl=0.2)
    cv.part(circ(cx, by - 48, 19, 6, wob=0.02), [lerp(c, (120, 80, 70), 0.15) for c in ir], lw=0.95, shade=0.3, hl=0.25)
    ktl = [(cx - 15, by - 50), (cx - 6, by - 50), (cx - 5, by - 57), (cx - 10.5, by - 61), (cx - 16, by - 57)]
    cv.part(ktl, "cloth_teal", lw=0.85, shade=0.3, hl=0.2, gloss=[(cx - 13, by - 57, 1, 1.4)])
    cv.part(capsule_pts(cx - 16, by - 55, cx - 20, by - 59, 0.9), "cloth_teal", lw=0.6)
    cv.line([(cx - 14, by - 60), (cx - 10.5, by - 64), (cx - 7, by - 60)], INK, 0.7)
    # base band + rivets
    cv.part([(cx - 17, by - 14), (cx + 17, by - 14), (cx + 14, by - 8), (cx - 14, by - 8)], [lerp(c, (150, 90, 70), 0.25) for c in ir], lw=0.9, shade=0.3, hl=0.2)
    for j in range(7): cv.fill(circ(cx - 13 + j * 4.3, by - 11, 0.7, wob=0), ir[0])
    # door with glowing heart-shaped vent window (cute!)
    door = circ(cx - 1.5, by - 26, 9, 8.4, wob=0.03, seed=5)
    cv.part(door, [lerp(c, (90, 60, 60), 0.2) for c in ir], lw=0.9, shade=0.2, hl=0.25)
    fl = 0.75 + 0.25 * math.sin(t * 6.28) * math.sin(t * 12.56 + 1)
    hx, hy = cx - 1.5, by - 27
    heart = [(hx + 16 * math.sin(a) ** 3 * 0.33, hy - (13 * math.cos(a) - 5 * math.cos(2 * a) - 2 * math.cos(3 * a) - math.cos(4 * a)) * 0.33) for a in np.linspace(0, 2 * math.pi, 40)]
    cv.part(heart, [(255, 250, 200), lerp(FIRE[1], FIRE[2], 1 - fl), FIRE[2], FIRE[3]], lw=0.8, shade=0.35, hl=0.0, ink=(60, 30, 40))
    em.fill(heart, lerp(FIRE[2], FIRE[1], fl))
    for j in range(3):
        cv.line([(hx - 3 + j * 3, hy - 4), (hx - 3 + j * 3, hy + 3)], (60, 30, 40), 0.55, alpha=170)
    cv.part(capsule_pts(cx + 7, by - 26, cx + 10, by - 26, 1.0), "gold", lw=0.6)  # handle
    # warm glow spill under the door
    em.fill(circ(cx - 1, by - 2, 10, 3, wob=0), FIRE[3], alpha=90, blur_r=2)

def fire_particle(kind):
    def d(cv, em, i, n):
        c = 8; t = i / n
        if kind == "ember":
            r = 1.5 - t * 0.6
            cv.fill(circ(c, c, r + 1.4, wob=0), FIRE[2], alpha=int(90 * (1 - t * 0.5)), blur_r=0.9)
            em.fill(circ(c, c, r + 1.4, wob=0), FIRE[2], alpha=int(150 * (1 - t * 0.5)), blur_r=0.9)
            cv.fill(circ(c, c, r + 0.4, wob=0), FIRE[2]); cv.fill(circ(c - 0.3, c - 0.3, r * 0.6, wob=0), FIRE[0])
            em.fill(circ(c, c, r + 0.4, wob=0), FIRE[1])
        else:  # spark: little 4-point star that twinkles
            s = [3.6, 4.6, 3.0, 2.2][i % 4]
            pts = star_pts(c, c, s, s * 0.32, n=4, rot=t * 1.5)
            cv.fill(pts, FIRE[0]); em.fill(pts, FIRE[0]); em.fill(circ(c, c, s * 0.8, wob=0), FIRE[1], alpha=120, blur_r=1)
    return d

def heat_ring(cv, em, i, n):
    """subtle dashed warm ring (iso ellipse) with tiny flame pips; renderer scales to the heat radius."""
    t = i / n; cx, cy, rx, ry = 128, 64, 118, 57
    pulse = 0.5 + 0.5 * math.sin(t * 2 * math.pi)
    col = lerp(FIRE[1], FIRE[2], 0.4)
    cv.fill(circ(cx, cy, rx, ry, wob=0), FIRE[1], alpha=int(18 + 10 * pulse), blur_r=0)
    cv.fill(circ(cx, cy, rx - 8, ry - 4, wob=0), (0, 0, 0), alpha=0)
    segs = 28
    for j in range(segs):
        a0 = (j + t) / segs * 2 * math.pi; a1 = a0 + 0.6 * 2 * math.pi / segs
        pts = [(cx + math.cos(a) * rx, cy + math.sin(a) * ry) for a in np.linspace(a0, a1, 6)]
        cv.line(pts, col, 2.2, alpha=int(150 + 60 * pulse))
    for j in range(4):
        a = j / 4 * 2 * math.pi + math.pi / 4
        x, y = cx + math.cos(a) * rx, cy + math.sin(a) * ry
        p = drop_pts(x, y + 2, 3.2, 7)
        cv.part(p, [FIRE[0], FIRE[1], FIRE[2], FIRE[3]], lw=0.8, shade=0.2, hl=0)

def light_cookies():
    out = []
    for s in (64, 128, 256, 512):
        y, x = np.mgrid[0:s, 0:s].astype(np.float32); d = np.hypot(x - s / 2 + 0.5, y - s / 2 + 0.5) / (s / 2)
        d2 = np.clip(d, 0, 1) ** 2
        a = (1 - d2) ** 2 * 0.82 + np.exp(-d2 * 9) * 0.18      # same family as the renderer's analytic falloff
        a *= smooth(1.0, 0.92, d)
        # cel-friendly soft steps (very gentle) so banding in the renderer lands on pleasant rings
        gray(a).save(os.path.join(OUT_TEX, f"light_cookie_{s}.png")); out.append(f"textures/light_cookie_{s}.png")
    # campfire cookie: soft round with flickery lobes (use as a second rotating layer)
    s = 256; y, x = np.mgrid[0:s, 0:s].astype(np.float32); ang = np.arctan2(y - s / 2, x - s / 2)
    d = np.hypot(x - s / 2, y - s / 2) / (s / 2)
    lob = 1 + 0.08 * np.sin(ang * 5) + 0.05 * np.sin(ang * 9 + 1)
    a = np.clip(1 - (d / lob) ** 2, 0, 1) ** 2; gray(a).save(os.path.join(OUT_TEX, "light_cookie_fire_256.png")); out.append("textures/light_cookie_fire_256.png")
    # window cookie: 4-pane window light patch (iso-skewed by the renderer)
    s = 256; img = np.zeros((s, s), np.float32); yy, xx = np.mgrid[0:s, 0:s] / s
    pane = ((np.abs(xx - 0.5) < 0.34) & (np.abs(yy - 0.5) < 0.34)).astype(np.float32)
    pane *= ((np.abs(xx - 0.5) > 0.025) & (np.abs(yy - 0.5) > 0.025))
    img = np.asarray(gray(pane).filter(ImageFilter.GaussianBlur(7)), np.float32) / 255
    gray(img).save(os.path.join(OUT_TEX, "light_cookie_window_256.png")); out.append("textures/light_cookie_window_256.png")
    return out

def heat_shimmer():
    """tileable RG offset noise (128 = 0). Vertically stretched cells: the renderer scrolls it upward."""
    P = 128; out = []
    n1 = pnoise(P, 4, 101, octaves=3); n2 = pnoise(P, 4, 202, octaves=3)
    # stretch vertically: average along y of a torus field = resample with period kept
    a = np.asarray(Image.fromarray(np.tile(n1, (1, 1)), "F").resize((P, P // 2), Image.BICUBIC).resize((P, P), Image.BICUBIC))
    gx = (np.roll(n1, -1, 1) - np.roll(n1, 1, 1)); gy = (np.roll(n2, -1, 0) - np.roll(n2, 1, 0))
    gx = gx / (np.abs(gx).max() + 1e-6); gy = gy / (np.abs(gy).max() + 1e-6)
    rg = np.stack([128 + gx * 127, 128 + gy * 127, np.full_like(gx, 128), np.full_like(gx, 255)], -1)
    Image.fromarray(np.clip(rg, 0, 255).astype(np.uint8), "RGBA").convert("RGB").save(os.path.join(OUT_TEX, "heat_shimmer_rg_128.png"))
    # column mask: where to apply shimmer above a fire (white = full), 64x128 (pivot bottom-center)
    y, x = np.mgrid[0:128, 0:64].astype(np.float32)
    m = np.exp(-((x - 31.5) / (10 + y * 0.0 + (127 - y) * 0.08)) ** 2) * smooth(127, 100, y) * smooth(0, 60, y)
    gray(m).save(os.path.join(OUT_TEX, "heat_shimmer_mask_64x128.png"))
    return ["textures/heat_shimmer_rg_128.png", "textures/heat_shimmer_mask_64x128.png"]

if __name__ == "__main__":
    from PIL import ImageFilter
    import fxlib; fxlib.ImageFilter = ImageFilter
    # Sprite keys = gameplay piece keys (packages/gameplay/data/pieces.json); see build_manifest.KEY_CLAIMS for collisions.
    A = Atlas("surv_heat", 64, 64, category="building", emissive=True)
    for sz in ("medium", "small", "large"):   # medium first => "idle" is the default anim
        d = campfire(sz); suf = "" if sz == "medium" else "_" + sz
        A.addfn("campfire", "idle" + suf, 6, d, fps=10, anchor=(0.5, 0.828), seed=10)
        A.addfn("campfire", "embers" + suf, 4, lambda cv, em, i, n, d=d: d(cv, em, i, n, "embers"), fps=5, anchor=(0.5, 0.828), seed=20)
        A.addfn("campfire", "unlit" + suf, 1, lambda cv, em, i, n, d=d: d(cv, em, i, n, "unlit"), fps=1, anchor=(0.5, 0.828), seed=30)
    A.addfn("torch_stand", "idle", 4, torch, fps=10, anchor=(0.5, 0.906))
    A.addfn("torch_stand", "unlit", 1, lambda cv, em, i, n: torch(cv, em, i, n, "unlit"), fps=1, anchor=(0.5, 0.906))
    A.addfn("lantern", "idle", 4, lantern, fps=6, anchor=(0.5, 0.875))
    A.addfn("lantern", "unlit", 1, lambda cv, em, i, n: lantern(cv, em, i, n, "unlit"), fps=1, anchor=(0.5, 0.875))
    A.addfn("heat_brazier", "idle", 6, brazier, fps=10, anchor=(0.5, 0.906))
    B = Atlas("surv_heat_large", 128, 128, category="building", emissive=True)
    B.addfn("fireplace", "idle", 6, fireplace, fps=10, anchor=(0.5, 0.898))
    B.addfn("wood_stove", "idle", 6, stove, fps=8, anchor=(0.5, 0.86))
    C = Atlas("surv_fire_particles", 16, 16, category="vfx", emissive=True)
    C.addfn("fx_ember", "idle", 4, fire_particle("ember"), fps=8)
    C.addfn("fx_fire_spark", "idle", 4, fire_particle("spark"), fps=14)
    D = Atlas("surv_heat_ring", 256, 128, category="vfx", emissive=False, pad_check=False)
    D.addfn("fx_heat_ring", "idle", 4, heat_ring, fps=3)
    parts = [A.write(), B.write(), C.write(), D.write()]
    tex = light_cookies() + heat_shimmer()
    save_build("heat", {"parts": parts, "textures": tex})
    print("heat done")
