"""Wind: drifting leaves/petals, dust gusts, smoke puffs (particles; bending via particle params), wind streak,
windsock + flag props (intrinsic flap anims only; sway is a renderer vertex shader)."""
import math
import numpy as np
from PIL import Image
from fxlib import *
from gen_status import mask_circles

def leaf_shape(cx, cy, L, W, rot, sx):
    pts = []
    for q in np.linspace(0, 2 * math.pi, 28, endpoint=False):
        x = math.cos(q) * L; y = math.sin(q) * W * (1 - 0.35 * math.cos(q))   # pointy tip
        x *= 1; y *= sx
        pts.append((cx + x * math.cos(rot) - y * math.sin(rot), cy + x * math.sin(rot) + y * math.cos(rot)))
    return pts

def leaf(rp):
    def d(cv, em, i, n):
        t = i / n; rot = t * 2 * math.pi * 0.5 + 0.4; sx = math.cos(t * 2 * math.pi)
        sxa = max(0.18, abs(sx))
        col = ramp(rp)
        if sx < 0: col = [col[1], col[2], col[3], col[3]]   # back side darker
        p = leaf_shape(16, 16, 6.5, 3.2, rot, sxa)
        cv.part(p, col, lw=0.8, shade=0.25, hl=0.15)
        cv.line([(16 - math.cos(rot) * 5.5, 16 - math.sin(rot) * 5.5), (16 + math.cos(rot) * 5.5, 16 + math.sin(rot) * 5.5)], col[3], 0.5, alpha=200)
        cv.line([(16 - math.cos(rot) * 6, 16 - math.sin(rot) * 6), (16 - math.cos(rot) * 8, 16 - math.sin(rot) * 8 + 0.6)], ramp("bark")[2], 0.7)
    return d

def petal(rp):
    def d(cv, em, i, n):
        t = i / n; rot = t * math.pi + 0.3; sx = max(0.25, abs(math.cos(t * 2 * math.pi)))
        p = []
        for q in np.linspace(0, 2 * math.pi, 24, endpoint=False):
            r = 3.6 * (0.75 + 0.25 * math.cos(q)) ; x = math.cos(q) * r * 1.2; y = math.sin(q) * r * sx
            if abs(q - math.pi) < 0.35: x += 0.8   # little notch
            p.append((16 + x * math.cos(rot) - y * math.sin(rot), 16 + x * math.sin(rot) + y * math.cos(rot)))
        cv.part(p, ramp(rp), lw=0.7, shade=0.25, hl=0.2)
    return d

def dust(cv, em, i, n):
    t = i / n; a = math.sin(t * math.pi) ** 0.8
    col = ramp("dirt"); light = [lerp(c, (255, 240, 220), 0.45) for c in col]
    lay = Canvas(32, 32, seed=5, k=cv.k)
    cs = []
    for j in range(5):
        x = 5 + j * 4.0 + t * 4; y = 20 - math.sin(j * 1.3) * 2 - t * 4
        r = (2.0 + j * 0.5) * (0.6 + 0.6 * t)
        cs.append((x, y, r, r * 0.8))
    lay.part(None, light, lw=0.6, shade=0.3, hl=0.1, mask=mask_circles(lay, cs), ink=lerp(col[3], (120, 90, 100), 0.4))
    for j in range(3):  # little swoosh curls
        q = np.linspace(0, 1.4 * math.pi, 16)
        lay.line([(8 + j * 6 + t * 8 + math.cos(v) * 2.5, 12 + j * 1.5 + math.sin(v) * 1.6 - v * 0.6) for v in q], light[0], 0.6)
    arr = np.asarray(lay.img).copy(); arr[..., 3] = (arr[..., 3] * a).astype(np.uint8)
    cv.img = Image.alpha_composite(cv.img, Image.fromarray(arr))

def smoke(cv, em, i, n):
    """puff that swells and fades; renderer emits several with drift = wind (see render_tuning.json)."""
    t = i / n; k = 0.45 + 0.75 * t; a = 1 - t ** 1.5
    col = ramp("smoke")
    lay = Canvas(32, 32, seed=2 + i, k=cv.k)
    cs = [(16, 18, 4.2 * k, 3.8 * k), (16 - 3.4 * k, 19.5, 2.9 * k, 2.6 * k), (16 + 3.6 * k, 19, 3.1 * k, 2.8 * k), (16 + 0.8 * k, 15 - 0.2 * k, 3.2 * k, 3 * k)]
    lay.part(None, col, lw=0.75, shade=0.28, hl=0.15, mask=mask_circles(lay, cs), ink=lerp(col[3], INK, 0.25))
    arr = np.asarray(lay.img).copy(); arr[..., 3] = (arr[..., 3] * a).astype(np.uint8)
    cv.img = Image.alpha_composite(cv.img, Image.fromarray(arr))

def streak(cv, em, i, n):
    """stylized wind swoosh (white with soft plum edge) that draws on then dissolves; 64x32 area in a 64x64 frame."""
    t = i / n
    q = np.linspace(0, 1, 60)
    path = [(4 + 54 * v, 32 + math.sin(v * 5.0) * 3.0 - (8 * max(0, v - 0.72) / 0.28) * math.sin((v - 0.72) / 0.28 * math.pi) ** 1) for v in q]
    # curl at the end
    cx, cy = path[-1]
    curl = [(cx + math.sin(a) * 3.2 - 0.0, cy - 3.2 + math.cos(a) * 3.2) for a in np.linspace(0, 1.6 * math.pi, 14)]
    full = path + curl
    N = len(full); head = min(1, t * 1.8) ; tail = max(0, t * 1.8 - 0.8)
    seg = full[int(tail * N):max(int(tail * N) + 2, int(head * N))]
    if len(seg) > 1:
        cv.line(seg, (160, 150, 190), 2.2, alpha=110)
        cv.line(seg, (255, 255, 255), 1.2, alpha=235)
    path2 = [(10 + 40 * v, 40 + math.sin(v * 4 + 1) * 2) for v in q]
    seg2 = path2[int(max(0, t * 1.8 - 0.95) * 60):max(2, int(min(1, t * 1.8 - 0.15) * 60))]
    if len(seg2) > 1 and t > 0.08: cv.line(seg2, (255, 255, 255), 0.8, alpha=170)

def flagpole(cv, top=10, base=58, x=20):
    cv.part(capsule_pts(x, base, x, top, 1.2, 1.0), "wood_dark", lw=0.8, shade=0.3, hl=0.2)
    cv.part(circ(x, top - 1, 1.8, wob=0), "gold", lw=0.7, shade=0.2, hl=0.2)
    cv.shadow(x, base, 4, 1.6)

def windsock(state):
    def d(cv, em, i, n):
        t = i / n; flagpole(cv)
        st = {"gust": 1.0, "breeze": 0.6, "calm": 0.0}[state]
        L = 30; segs = 5
        def P(u, side):
            ang = (1 - st) * (1.2 * u) + st * 0.05 * math.sin(t * 2 * math.pi * 1 + u * 4)
            droop = (1 - st) * u * u * 18
            x = 21 + u * L * (0.45 + 0.55 * st) + math.sin(ang) * 0
            wav = math.sin(t * 2 * math.pi + u * 5) * (1.4 * st + 0.3)
            r = 4.6 * (1 - 0.55 * u)
            return (x, 14 + droop + wav + side * r)
        for s in range(segs):
            u0, u1 = s / segs, (s + 1) / segs
            rp = "cloth_red" if s % 2 == 0 else "cloth_cream"
            cv.part([P(u0, -1), P(u1, -1), P(u1, 1), P(u0, 1)], rp, lw=0.8, shade=0.3, hl=0.2)
        e0, e1 = P(1, -1), P(1, 1)
        cv.part(circ((e0[0] + e1[0]) / 2, (e0[1] + e1[1]) / 2, 1.0, abs(e1[1] - e0[1]) / 2, wob=0), [(120, 60, 70)] * 4, lw=0.6, shade=0, hl=0)
        cv.part(circ(21, 14, 1.3, 4.8, wob=0), "iron", lw=0.7, shade=0.2, hl=0.1)
    return d

def flag(cv, em, i, n):
    t = i / n; flagpole(cv)
    W, H = 22, 13; segs = 10
    def P(u, v):
        wav = math.sin(t * 2 * math.pi - u * 5.5) * 2.2 * u
        return (21 + u * W, 11 + v * H + wav + u * 1.5)
    top = [P(u / segs, 0) for u in range(segs + 1)]; bot = [P(u / segs, 1) for u in range(segs, -1, -1)]
    # swallow-tail notch
    nt = P(0.82, 0.5); poly = top + [nt] + bot
    cv.part(poly, "cloth_teal", lw=0.85, shade=0.3, hl=0.15)
    # cute leaf emblem that rides the wave
    ex, ey = P(0.38, 0.5)
    cv.part(leaf_shape(ex, ey, 3.6, 2.0, -0.6, 1.0), "cloth_yellow", lw=0.6, shade=0.2, hl=0.1)
    for u in (0.3, 0.6):  # fold shading lines
        cv.line([P(u + 0.05 * math.sin(t * 6.28), 0.1), P(u + 0.05 * math.sin(t * 6.28), 0.9)], R("cloth_teal", 3), 0.5, alpha=120)

if __name__ == "__main__":
    A = Atlas("surv_wind_particles", 32, 32, category="vfx")
    A.addfn("fx_wind_leaf_green", "idle", 8, leaf("leaf"), fps=10)
    A.addfn("fx_wind_leaf_autumn", "idle", 8, leaf("leaf_autumn"), fps=10)
    A.addfn("fx_wind_petal_pink", "idle", 6, petal("flower_pink"), fps=8)
    A.addfn("fx_wind_petal_white", "idle", 6, petal("cloth_cream"), fps=8)
    A.addfn("fx_dust_gust", "idle", 6, dust, fps=10, loop=False, anchor=(0.5, 0.75))
    A.addfn("fx_smoke_puff", "idle", 8, smoke, fps=6, loop=False, anchor=(0.5, 0.6))
    B = Atlas("surv_wind", 64, 64, category="vfx")
    B.addfn("fx_wind_streak", "idle", 8, streak, fps=12, loop=False)
    C = Atlas("surv_wind_props", 64, 64, category="building")
    for st in ("calm", "breeze", "gust"):
        C.addfn("windsock", st, 1 if st == "calm" else 6, windsock(st), fps={"calm": 1, "breeze": 6, "gust": 12}[st], anchor=(0.3125, 0.906))
    C.addfn("prop_flag", "idle", 6, flag, fps=8, anchor=(0.3125, 0.906))
    save_build("wind", {"parts": [A.write(), B.write(), C.write()], "textures": []})
    print("wind done")
