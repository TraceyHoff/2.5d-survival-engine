#!/usr/bin/env python3
"""ADR-108/109 art merge (main pack + items pack), in place in ENGINE/packages/assets/pack:
 - zombie_snuffer: new atlas zombies_snuffer (48x64, 17 cols, dirStride 34): idle/walk/run/attack/hurt/death/swim x 8 dirs,
   blue-skinned goofy zombie wearing a brass candle-snuffer cone as a hat. No masks (VRAM).
 - defenses (96x96 cells, no masks): barbed_wire, spike_trap + bear_trap (states armed/sprung), arrow_turret / bolt_turret
   (8-dir `aim` + 2-frame 8-dir `fire`) and flame_turret aim frames.
 - defenses_glow (96x96 cells + emissive): flame_turret_fire vfx, the flame jet (8 dirs x 3).
 - lantern: reused from assets/survival_fx (surv_lantern: lit flicker + unlit, emissive), which claims the key.
 - items pack: vehicle_key icon (items_icons cell 199, 1x + @2x). wood / coal (main pack) and crude_oil (items pack) already
   exist and are reused, not duplicated.
Usage: python3 adr108_art.py ENGINE_DIR [--preview OUT.png]"""
import sys, os, json, math, zlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from PIL import Image
from concurrent.futures import ProcessPoolExecutor
import palette
palette.RAMPS.setdefault("zomb_blue", ["#d6ecff", "#9cc6f2", "#6a94d2", "#4a64a6"])
from palette import ramp
from toon import Canvas, ellipse_pts, capsule_pts, downscale
from iso import damage
from atlas import warm_glow_pred
import chars, swimfx

ENG = sys.argv[1]; P = os.path.join(ENG, "packages/assets/pack")
# ------------------------------------------------------------------ snuffer
SNUFFER = dict(skin="zomb_blue", top="cloth_blue", bottom="cloth_denim", shoe="leather", hat="snuffer", hatc="copper",
               body=0.9, head=1.12, lean=2.0, belly=1.1, frame=(48, 64), feet=59, scale=0.94)
_orig_hat = chars.zombie_hat
def zombie_hat(cv, rig, c3, hr, spec, rot, hm=None):
    if spec.get("hat") != "snuffer": return _orig_hat(cv, rig, c3, hr, spec, rot, hm)
    # candle-snuffer bell, worn slightly askew like a party hat, with a curly handle and a smoke wisp
    b, _ = rig.proj(c3[0] + 1.0, c3[1] - 0.5, c3[2] + hr * 0.62); t, _ = rig.proj(c3[0] + 3.5, c3[1] - 0.5, c3[2] + hr * 1.75)
    w = hr * 0.95
    cone = [(b[0] - w, b[1] + 1), (t[0] - 1.6, t[1]), (t[0] + 1.6, t[1]), (b[0] + w, b[1] + 1)]
    cv.part(cone, "copper", lw=1.0, shade=0.28, hl=0.22, gloss=[(b[0] - w * 0.35, b[1] - 4, 1.2, 3.0)])
    cv.part(ellipse_pts(b[0], b[1] + 1, w + 0.8, 1.8, n=20), "gold", lw=0.8, shade=0.3, hl=0.25)
    cv.part(ellipse_pts(t[0], t[1] - 0.8, 1.9, 1.6, n=12), "gold", lw=0.7, shade=0.3, hl=0.3)
    hx = b[0] + w * 0.9 * (1 if math.cos(rig.p) >= 0 else -1)
    cv.line([(hx, b[1] - 3), (hx + 3.5, b[1] - 5.5), (hx + 5, b[1] - 3.5), (hx + 3.6, b[1] - 2)], ramp("copper")[3], 0.9)
    cv.line([(t[0], t[1] - 2.5), (t[0] - 1.2, t[1] - 5), (t[0] + 0.8, t[1] - 7.5), (t[0] - 0.5, t[1] - 10)], ramp("stone")[1], 0.8, alpha=170)
chars.zombie_hat = zombie_hat
Z_ANIMS = [("idle", 4, 4, True), ("walk", 6, 7, True), ("run", 6, 12, True), ("attack", 4, 10, False), ("hurt", 2, 10, False),
           ("death", 6, 10, False), ("swim", 6, 6, True)]
ZN = sum(n for _, n, _, _ in Z_ANIMS)   # 34 per direction

def zjob(a):
    d, an, i, n = a; s = SNUFFER; fw, fh = s["frame"]
    im, meta = chars.render_frame_meta(s, d, an, i, n, True, fw, fh, s["feet"], s["scale"])
    x = np.asarray(im.convert("RGBA")).copy()
    if an == "swim":
        wz = chars.SWIM_Z * (0.9 + 0.1 * s["body"]) * s["scale"]; WL = s["feet"] - 2; sh = int(round(WL - (s["feet"] - wz)))
        x = swimfx.sink(x, sh, WL); b, f = swimfx.ripple(fw, fh, fw / 2, WL, 12.5 * s["scale"], 3.6 * s["scale"], i, 1); x = swimfx.apply_base(x, b, f)
    x[:2] = 0; x[-2:] = 0; x[:, :2] = 0; x[:, -2:] = 0
    return x

# ------------------------------------------------------------------ defenses (96x96, pivot 48,72)
CW = CH = 128; CX, CY = 64, 96   # building cells must be 128 (pack.test)
GW = GH = 96   # flame jet vfx cells
def plinth(cv, rp_top="wood", rp_side="wood_dark", rx=17, ry=8.5, h=9):
    cv.shadow(CX, CY + 1, rx + 4, ry + 2)
    L = [(CX - rx, CY - h), (CX, CY + ry - h), (CX, CY + ry), (CX - rx, CY)]
    R = [(CX, CY + ry - h), (CX + rx, CY - h), (CX + rx, CY), (CX, CY + ry)]
    cv.part(L, rp_side, lw=1.0, shade=0.15, hl=0.1); cv.part(R, rp_side, lw=1.0, shade=0.35, hl=0.05, base_col=ramp(rp_side)[2])
    top = [(CX - rx, CY - h), (CX, CY - ry - h), (CX + rx, CY - h), (CX, CY + ry - h)]
    m = cv.part(top, rp_top, lw=1.0, shade=0.2, hl=0.2)
    for k in (-1, 0, 1): cv.line([(CX - rx * 0.5 + k * 6, CY - h - ry * 0.5 + k * 3), (CX + rx * 0.5 + k * 6 - 12, CY - h + ry * 0.5 + k * 3 - 6)], ramp(rp_top)[2], 0.5, clip=m, alpha=150)

def eyes(cv, x, y, fx, fy, r=2.1):
    """goofy googly eyes on a turret head, pupils looking along the aim."""
    for s in (-1, 1):
        ex, ey = x + s * r * 1.15 * (1 - abs(fx) * 0.4), y
        cv.part(ellipse_pts(ex, ey, r, r * 1.1, n=14), "cloth_cream", lw=0.7, shade=0.1, hl=0.0)
        cv.fill(ellipse_pts(ex + fx * r * 0.45, ey + fy * r * 0.45, r * 0.5, r * 0.55, n=10), ramp("ink")[3])

def turret(kind, d, fire=-1, cell=None):
    global CX, CY
    CX, CY = (cell // 2, cell * 3 // 4) if cell else (CW // 2, CH * 3 // 4)
    cv = Canvas(cell or CW, cell or CH, seed=11 + d)
    rig = chars.Rig(cv, chars.DIR_PHI[d], CX, CY, 1.0)
    plinth(cv, "wood" if kind != "bolt" else "stone", "wood_dark" if kind != "bolt" else "stone")
    cv.part(capsule_pts(CX, CY - 9, CX, CY - 21, 3.0, 2.4), "iron", lw=0.9, shade=0.3, hl=0.25)
    z = 24; recoil = -2.0 if fire == 1 else 0.0
    def P(f, side=0.0, dz=0.0): return rig.proj(side, f + recoil, z + dz)[0]
    fwd = rig.proj(0, 1, z)[0]; o = rig.proj(0, 0, z)[0]; fx, fy = fwd[0] - o[0], fwd[1] - o[1]; nn = math.hypot(fx, fy) or 1; fx, fy = fx / nn, fy / nn
    facing_away = rig.nv(0, 1) < -0.2
    def body():
        if kind == "arrow":
            cv.part(capsule_pts(*P(-7), *P(9), 3.2, 2.6), "wood", lw=1.0, shade=0.3, hl=0.25)
            a, b, c = P(7, -11, 1), P(10.5, 0, 0), P(7, 11, 1)
            cv.line([a, b, c], ramp("wood_dark")[2], 2.6); cv.line([a, b, c], ramp("wood")[1], 1.4)
            sb = P(-4) if fire != 0 else P(7)
            cv.line([a, sb, c], ramp("cloth_cream")[2], 0.6)
            if fire != 0: cv.line([P(-3), P(14)], ramp("wood_dark")[1], 1.0); cv.part(ellipse_pts(*P(14.5), 1.6, 1.2, n=8), "iron", lw=0.5)
        elif kind == "bolt":
            cv.part(capsule_pts(*P(-9), *P(10), 4.6, 3.8), "iron", lw=1.1, shade=0.32, hl=0.25)
            for s in (-1, 1): cv.part(capsule_pts(*P(8, s * 2), *P(9, s * 13, 2), 1.8, 1.2), "wood_dark", lw=0.8, shade=0.3, hl=0.2)
            cv.line([P(9, -13, 2), P(-5) if fire != 0 else P(8), P(9, 13, 2)], ramp("ink")[1], 0.7)
            if fire != 0: cv.part(capsule_pts(*P(-4), *P(16), 1.3, 1.0), "iron", lw=0.6); cv.part([P(16, -2), P(19.5), P(16, 2)], "iron", lw=0.6)
        else:
            cv.part(ellipse_pts(*P(-4, 0, 1), 6.5, 6.0, n=24), "cloth_red", lw=1.0, shade=0.3, hl=0.25, gloss=[(P(-4)[0] - 2, P(-4)[1] - 3, 1.5, 1.2)])
            cv.part(capsule_pts(*P(0), *P(11), 2.0, 1.6), "iron", lw=0.9, shade=0.3, hl=0.25)
            cv.part(ellipse_pts(*P(11.5), 2.5, 2.2, n=12), "iron", lw=0.8, shade=0.3, hl=0.2)
            cv.fill(ellipse_pts(*P(-4, 0, 1), 2.3, 1.2, n=10), ramp("gold")[1])
    def face():
        hx, hy = P(-1, 0, 6.5)
        cv.part(ellipse_pts(hx, hy, 5.5, 4.6, n=20), "wood" if kind == "arrow" else ("iron" if kind == "bolt" else "copper"), lw=0.9, shade=0.3, hl=0.25)
        if not facing_away: eyes(cv, hx, hy, fx, fy * 0.6 + 0.1)
    def jet():
        if kind != "flame" or fire < 0: return
        base = P(13); ph = fire * 2.1
        for k in range(9, -1, -1):
            t = k / 9.0; f = 13 + 3.2 * k; wob = math.sin(ph + k * 1.3) * (1.2 + 2.2 * t)
            x, y = P(f, wob, math.sin(ph * 0.7 + k) * t * 1.5)
            r = 2.2 + 5.0 * t ** 0.8
            cv.part(ellipse_pts(x, y, r, r * 0.85, n=16, wob=0.1, seed=k + fire * 7), "fire", lw=0.8, shade=0.25, hl=0.3,
                    base_col=ramp("fire")[1 if t < 0.6 else 2], hl_col=ramp("fire")[0])
            if t < 0.7: cv.fill(ellipse_pts(x, y - r * 0.15, r * 0.45, r * 0.38, n=10), (255, 252, 230))
        cv.fill(ellipse_pts(*base, 3.0, 2.6, n=12), (255, 250, 220))
    if facing_away: jet(); body(); face()
    else: face(); body(); jet()
    if fire == 0 and kind != "flame":   # snap lines + tiny dust puff
        for s in (-1, 1): cv.line([P(-6, s * 6), P(-10, s * 9)], ramp("cloth_cream")[1], 0.6, alpha=200)
    return cv

def ground_ring(cv, rx, ry, rp="wood", h=1.6):
    cv.shadow(CX, CY, rx + 3, ry + 1.5)
    cv.part(ellipse_pts(CX, CY, rx, ry, n=28, wob=0.04, seed=3), rp, lw=1.0, shade=0.25, hl=0.2)

def spike_trap(sprung):
    cv = Canvas(CW, CH, seed=21); rx, ry = 20, 10
    cv.shadow(CX, CY, rx + 3, ry + 2)
    top = [(CX - rx, CY), (CX, CY - ry), (CX + rx, CY), (CX, CY + ry)]
    m = cv.part(top, "wood", lw=1.0, shade=0.2, hl=0.2)
    for k in range(-2, 3): cv.line([(CX - rx * 0.5 + k * 5, CY - ry * 0.5 + k * 2.5), (CX + rx * 0.5 + k * 5, CY + ry * 0.5 + k * 2.5)], ramp("wood")[2], 0.5, clip=m)
    pts = [(CX + (i - j) * 6, CY + (i + j) * 3) for i in (-1, 0, 1) for j in (-1, 0, 1)]
    for (x, y) in sorted(pts, key=lambda p: p[1]):
        if sprung:
            hgt = 15 + ((int(x) * 7 + int(y)) % 5)
            cv.part([(x - 2.0, y), (x - 0.3, y - hgt), (x + 0.3, y - hgt), (x + 2.0, y)], "wood_dark", lw=0.8, shade=0.3, hl=0.25)
            cv.part([(x - 1.0, y - hgt + 5), (x - 0.2, y - hgt - 0.5), (x + 0.2, y - hgt - 0.5), (x + 1.0, y - hgt + 5)], "stone", lw=0.5, shade=0.2, hl=0.3)
        else:
            cv.fill(ellipse_pts(x, y, 2.0, 1.0, n=10), ramp("ink")[2]); cv.part([(x - 0.8, y), (x, y - 2.2), (x + 0.8, y)], "stone", lw=0.4, shade=0.2, hl=0.3)
    return cv

def bear_trap(state):   # 0 armed (open, flat), 1 snapping, 2 sprung (closed, upright jaws)
    cv = Canvas(CW, CH, seed=31); rx, ry = 15, 7.5
    cv.shadow(CX, CY, rx + 4, ry + 2)
    cv.line([(CX + rx - 2, CY + 2), (CX + rx + 7, CY + 5), (CX + rx + 11, CY + 3)], ramp("iron")[3], 0.8)   # chain + stake
    cv.part(capsule_pts(CX + rx + 11, CY + 3, CX + rx + 11, CY - 2, 1.4, 1.0), "wood_dark", lw=0.6)
    cv.part(ellipse_pts(CX, CY, rx, ry, n=28), "iron", lw=1.0, shade=0.3, hl=0.25)
    cv.fill(ellipse_pts(CX, CY - 0.6, rx - 2.5, ry - 1.6, n=28), ramp("ink")[1])
    cv.part(ellipse_pts(CX, CY, 4.5, 2.4, n=16), "gold", lw=0.7, shade=0.3, hl=0.3)   # pressure plate
    lift = [0.0, 0.6, 1.0][state]
    for s in (-1, 1):
        pts = []
        for k in range(15):
            a = math.pi * k / 14; x = CX + math.cos(a) * rx * 0.95
            yf = CY + s * math.sin(a) * ry * 0.95; yu = CY - math.sin(a) * 13 * (1 if s < 0 else 0.92)
            pts.append((x, yf * (1 - lift) + yu * lift + (s * -0.8 if lift == 1 else 0)))
        teeth = []
        for k in range(1, 14):
            x, y = pts[k]; tl = 2.6
            dy = -s * tl * (1 - lift) + tl * lift * (1 if s < 0 else -1) * 0.0 + (tl if lift > 0.5 and s < 0 else 0) - (tl if lift > 0.5 and s > 0 else 0) * 0
            teeth += [(x - 0.9, y), (x, y + (dy if lift < 0.5 else (tl if s < 0 else -tl) * 0.0 + tl * (1 if s < 0 else -1) * -1))]
        for k in range(1, 14, 2):
            x, y = pts[k]; tip = (x, y + (-s * 2.6 if lift < 0.5 else 2.6 * (1 if s < 0 else -1)))
            cv.part([(x - 1.0, y), tip, (x + 1.0, y)], "iron", lw=0.4, shade=0.2, hl=0.3)
        cv.line(pts, ramp("iron")[3], 2.0); cv.line(pts, ramp("iron")[1], 1.0)
    return cv

def barbed_wire():
    cv = Canvas(CW, CH, seed=41)
    a, b = (CX - 26, CY + 6), (CX + 26, CY - 6)
    cv.shadow(CX, CY + 1, 28, 6)
    for (x, y) in (a, b): cv.part(capsule_pts(x, y, x, y - 18, 1.8, 1.5), "wood_dark", lw=0.8, shade=0.3, hl=0.2)
    n = 7
    for i in range(n):   # coil loops, back halves first
        t = (i + 0.5) / n; x, y = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - 8
        back = [(x + math.cos(u) * 4.5, y + math.sin(u) * 7.5) for u in np.linspace(math.pi * 0.5, math.pi * 1.5, 10)]
        cv.line(back, ramp("iron")[3], 0.8)
    for z in (-4, -12): cv.line([(a[0], a[1] + z), (b[0], b[1] + z)], ramp("iron")[2], 0.7)
    for i in range(n):
        t = (i + 0.5) / n; x, y = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - 8
        front = [(x + math.cos(u) * 4.5, y + math.sin(u) * 7.5) for u in np.linspace(-math.pi * 0.5, math.pi * 0.5, 10)]
        cv.line(front, ramp("iron")[3], 1.3); cv.line(front, ramp("iron")[0], 0.5)
        for u in (0.0, 1.2):   # barbs
            bx, by = x + math.cos(u) * 4.5, y + math.sin(u) * 7.5
            cv.line([(bx - 1.4, by - 1.4), (bx + 1.4, by + 1.4)], ramp("iron")[3], 0.6); cv.line([(bx - 1.4, by + 1.4), (bx + 1.4, by - 1.4)], ramp("iron")[3], 0.6)
    return cv

def fin(cv, st=0, key="x"):
    img = damage(cv.img, st, zlib.crc32(key.encode()) % 1000) if st else cv.img
    a = np.asarray(downscale(img, (cv.w, cv.h))).copy(); a[:2] = 0; a[-2:] = 0; a[:, :2] = 0; a[:, -2:] = 0; return a

def piece_job(job):
    name, args, st = job
    cv = {"turret": lambda: turret(*args), "spike": lambda: spike_trap(*args), "bear": lambda: bear_trap(*args),
          "wire": barbed_wire, "turretg": lambda: turret(*args, cell=GW)}[name]()
    return fin(cv, st, name + str(args))

# ------------------------------------------------------------------ vehicle key icon
def key_icon(S):
    k = S / 32; cv = Canvas(S, S, seed=7)
    hx, hy = 11 * k, 12 * k
    cv.part(capsule_pts(hx + 5 * k, hy + 4 * k, 23 * k, 20 * k, 2.2 * k), "gold", lw=1.0 * k, shade=0.3, hl=0.3)
    for t in (0.55, 0.78): x, y = hx + 5 * k + (12 * k) * t, hy + 4 * k + 8 * k * t + 1.2 * k; cv.part([(x - 1 * k, y), (x + 1.6 * k, y + 0.4 * k), (x + 1.2 * k, y + 3 * k), (x - 1.2 * k, y + 2.6 * k)], "gold", lw=0.8 * k, shade=0.3, hl=0.2)
    m = cv.part(ellipse_pts(hx, hy, 7.5 * k, 7 * k, n=28), "cloth_red", lw=1.0 * k, shade=0.3, hl=0.3, gloss=[(hx - 2.5 * k, hy - 2.5 * k, 1.6 * k, 1.1 * k)])
    cv.fill(ellipse_pts(hx - 2.4 * k, hy - 1.6 * k, 2.3 * k, 1.6 * k, n=12), ramp("ink")[2])   # tiny car window
    cv.fill(ellipse_pts(hx + 2.4 * k, hy - 1.6 * k, 2.3 * k, 1.6 * k, n=12), ramp("ink")[2])
    cv.part(ellipse_pts(hx, hy + 3 * k, 3.2 * k, 1.3 * k, n=12), "cloth_cream", lw=0.5 * k, shade=0.1)
    cv.part(ellipse_pts(hx + 6 * k, hy - 6 * k, 2.6 * k, 2.6 * k, n=14), "iron", lw=0.8 * k, shade=0.3, hl=0.3)   # ring
    cv.fill(ellipse_pts(hx + 6 * k, hy - 6 * k, 1.2 * k, 1.2 * k, n=10), ramp("ink")[1])
    return np.asarray(cv.final()).copy()

# ------------------------------------------------------------------ assembly
def sheet(cells, fw, fh, cols):
    rows = -(-len(cells) // cols); S = np.zeros((rows * fh, cols * fw, 4), np.uint8)
    for g, c in enumerate(cells): S[(g // cols) * fh:(g // cols + 1) * fh, (g % cols) * fw:(g % cols + 1) * fw] = c
    return S, rows

def save(a, rel): Image.fromarray(a, "RGBA").save(os.path.join(P, rel), optimize=True)

def main():
    MP = os.path.join(P, "manifest.json"); m = json.load(open(MP)); S = {s["key"] for s in m["sprites"]}
    for k in ("zombie_snuffer", "barbed_wire", "spike_trap", "bear_trap", "arrow_turret", "bolt_turret", "flame_turret"): assert k not in S, k
    assert "wood" in S and "coal" in S
    pool = ProcessPoolExecutor(8)
    # snuffer
    jobs = [(d, an, i, n) for d in range(8) for an, n, _, _ in Z_ANIMS for i in range(n)]
    zc = list(pool.map(zjob, jobs, chunksize=4)); ZS, zr = sheet(zc, 48, 64, 17); save(ZS, "atlases/zombies_snuffer.png")
    m["atlases"].append({"key": "zombies_snuffer", "image": "atlases/zombies_snuffer.png", "frameW": 48, "frameH": 64, "columns": 17, "rows": zr})
    anims, off = {}, 0
    for an, n, fps, loop in Z_ANIMS:
        anims[an] = {"frames": list(range(off, off + n)), "fps": fps, "directions": 8, "dirStride": ZN, **({} if loop else {"loop": False})}; off += n
    anims["shamble"] = dict(anims["walk"])
    tints = next(s for s in m["sprites"] if s["key"] == "zombie_runner").get("tints")
    m["sprites"].append({"key": "zombie_snuffer", "category": "zombie", "atlas": "zombies_snuffer", "anchor": {"x": 0.5, "y": 0.9219}, "animations": anims, **({"tints": tints} if tints else {})})
    # defenses (no masks)
    D, idx = [], {}
    def add(tag, job): idx[tag] = len(D); D.append(job)
    for st in range(4): add(f"wire{st}", ("wire", (), st))
    for sp in (0, 1):
        for st in range(4): add(f"spike{sp}_{st}", ("spike", (bool(sp),), st))
    for sp in (0, 2):
        for st in range(4): add(f"bear{sp}_{st}", ("bear", (sp,), st))
    add("bear_snap", ("bear", (1,), 0))
    for kind in ("arrow", "bolt", "flame"):
        for d in range(8): add(f"{kind}_aim{d}", ("turret", (kind, d, -1), 0))
        for st in (1, 2, 3): add(f"{kind}_dmg{st}", ("turret", (kind, 0, -1), st))
        if kind != "flame":
            for d in range(8):
                for f in (0, 1): add(f"{kind}_fire{d}_{f}", ("turret", (kind, d, f), 0))
    G, gidx = [], {}
    def gadd(tag, job): gidx[tag] = len(G); G.append(job)
    for d in range(8):
        for f in range(3): gadd(f"flame_fire{d}_{f}", ("turretg", ("flame", d, f), 0))
    dc = list(pool.map(piece_job, D, chunksize=2)); gc = list(pool.map(piece_job, G, chunksize=2))
    DS, dr = sheet(dc, CW, CH, 12); save(DS, "atlases/defenses.png")
    GS, gr = sheet(gc, GW, GH, 8); save(GS, "atlases/defenses_glow.png")
    a = GS.astype(np.float32); em = a.copy(); em[..., 3] *= warm_glow_pred(a); save(em.astype(np.uint8), "atlases/defenses_glow_emissive.png")
    m["atlases"].append({"key": "defenses", "image": "atlases/defenses.png", "frameW": CW, "frameH": CH, "columns": 12, "rows": dr})
    m["atlases"].append({"key": "defenses_glow", "image": "atlases/defenses_glow.png", "frameW": GW, "frameH": GH, "columns": 8, "rows": gr, "masks": {"emissive": "atlases/defenses_glow_emissive.png"}})
    pieces = {p["key"]: p for p in json.load(open(os.path.join(ENG, "packages/gameplay/data/pieces.json")))["pieces"]}
    def bspr(key, atlas, frames, anims, states=None):
        p = pieces[key]; fp = p.get("footprint", {"w": 1, "h": 1})
        b = {"piece": key, "footprint": {"w": fp.get("w", 1), "h": fp.get("h", 1)} if isinstance(fp, dict) else {"w": fp[0], "h": fp[1]}, "layer": p["layer"], "frames": [frames]}
        if states: b["states"] = {k: [v] for k, v in states.items()}
        m["sprites"].append({"key": key, "category": "building", "atlas": atlas, "anchor": {"x": 0.5, "y": 0.75}, "animations": anims, "building": b, "rotationArt": "mirror"})
    I = lambda *t: [idx[x] for x in t]; J = lambda *t: [gidx[x] for x in t]
    one = lambda f: {"frames": [f], "fps": 1}
    bspr("barbed_wire", "defenses", I("wire0", "wire1", "wire2", "wire3"), {"idle": one(idx["wire0"])})
    for k, a0, a1 in (("spike_trap", "spike0", "spike1"), ("bear_trap", "bear0", "bear2")):
        arm = I(*[f"{a0}_{s}" for s in range(4)]); spr = I(*[f"{a1}_{s}" for s in range(4)])
        an = {"idle": one(arm[0]), "sprung": one(spr[0])}
        if k == "bear_trap": an["snap"] = {"frames": [idx["bear_snap"], spr[0]], "fps": 12, "loop": False}
        bspr(k, "defenses", arm, an, {"armed": arm, "sprung": spr})
    # lantern: NOT added here. assets/survival_fx already ships surv_lantern (lit idle flicker + unlit, emissive) and claims
    # the "lantern" key once the main pack leaves it free (pack.test "survival_fx keys yielded"), so reuse it.
    for kind in ("arrow", "bolt", "flame"):
        key = f"{kind}_turret"; aim = [idx[f"{kind}_aim{d}"] for d in range(8)]
        frames = [aim[0]] + [idx[f"{kind}_dmg{s}"] for s in (1, 2, 3)]
        an = {"idle": one(aim[0]), "aim": {"frames": [aim[0]], "fps": 1, "directions": 8, "dirStride": 1}}
        if kind == "flame":
            # fire frames live on defenses_glow; an extra sprite (same piece) is not allowed, so the flame jet is a separate vfx-category sprite
            pass
        else:
            f0 = idx[f"{kind}_fire0_0"]; an["fire"] = {"frames": [f0, f0 + 1], "fps": 10, "directions": 8, "dirStride": 2, "loop": False}
        bspr(key, "defenses", frames, an)
    f0 = gidx["flame_fire0_0"]
    m["sprites"].append({"key": "flame_turret_fire", "category": "vfx", "atlas": "defenses_glow", "anchor": {"x": 0.5, "y": 0.75},
                         "animations": {"fire": {"frames": [f0, f0 + 1, f0 + 2], "fps": 12, "directions": 8, "dirStride": 3, "loop": True}}})
    json.dump(m, open(MP, "w"), indent=2); open(MP, "a").write("\n")
    # items pack: vehicle_key
    IP = os.path.join(P, "items/manifest.items.json"); im = json.load(open(IP)); assert not any(s["key"] == "vehicle_key" for s in im["sprites"])
    at = next(a for a in im["atlases"] if a["key"] == "items_icons"); used = {f for s in im["sprites"] if s["atlas"] == "items_icons" for an in s["animations"].values() for f in an["frames"]}
    cell = next(c for c in range(at["columns"] * at["rows"]) if c not in used)
    for sc, rel in ((1, at["image"]), (2, at["pages"][0]["image"])):
        p = os.path.join(P, "items", rel); A = np.asarray(Image.open(p).convert("RGBA")).copy(); s = 32 * sc
        x, y = (cell % at["columns"]) * s, (cell // at["columns"]) * s; A[y:y + s, x:x + s] = key_icon(s); Image.fromarray(A).save(p, optimize=True)
    im["sprites"].append({"key": "vehicle_key", "category": "item", "atlas": "items_icons", "anchor": {"x": 0.5, "y": 0.5}, "animations": {"idle": {"frames": [cell], "fps": 1}}})
    pretty = open(IP).read(3).startswith("{\n"); json.dump(im, open(IP, "w"), indent=1 if pretty else None); 
    print("snuffer rows", zr, "defenses", len(D), "rows", dr, "glow", len(G), "rows", gr, "key cell", cell)

if __name__ == "__main__": main()
