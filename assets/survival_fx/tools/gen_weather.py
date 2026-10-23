"""Weather: rain streak texture, splashes, iso puddles (+ripples), wet-ground / snow-cover / frost overlay tiles
(tileable across 64x32 iso tiles), snow transition autotile (16), snowflakes, fog noise, lightning bolts,
rainbow, cloud shadows, screen frost vignette."""
import math, os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from fxlib import *

WATER = ramp("water"); SNOW = ramp("snow")
TW, TH, FH = 64, 32, 48   # overlay frames match terrain tiles: 64x48, diamond in the top 32 px, anchor (0.5, 1/3)

# ---------------- tile overlays (computed per pixel at 4x then box-downscaled) ----------------
NOISE = {s: pnoise(128, 3, s, octaves=4) for s in (1, 2, 3, 4, 5)}

def tile_px(fn, k):
    """fn(tx, ty) -> (rgb[H,W,3] 0..255, a[H,W] 0..1) on the diamond; returns 64k x 48k RGBA."""
    ss = 4; tx, ty = iso_coords(TW, TH, k, ss)
    rgb, a = fn(tx, ty)
    inside = ((np.abs(tx) <= 0.5) & (np.abs(ty) <= 0.5)).astype(np.float32)
    a = a * inside
    pm = np.concatenate([rgb * a[..., None], a[..., None] * 255], -1).astype(np.float32)
    H, W = a.shape; out = pm.reshape(H // ss, ss, W // ss, ss, 4).mean((1, 3))
    al = out[..., 3:4] / 255; col = np.where(al > 1e-4, out[..., :3] / np.maximum(al, 1e-4), 0)
    img = to_img(col, al[..., 0])
    full = Image.new("RGBA", (TW * k, FH * k), (0, 0, 0, 0)); full.paste(img, (0, 0)); return full

def tile_frame(fn):
    return {k: (tile_px(fn, k), None) for k in (1, 2)}

def N(seed, tx, ty, f=1.0): return sample_wrap(NOISE[seed], tx * f, ty * f)

def wet_ground(tx, ty):
    n = N(1, tx, ty, 2.0); n2 = N(2, tx, ty, 4.0)
    a = 0.30 + 0.16 * (n - 0.5)   # darkening (cool plum-blue film)
    rgb = np.zeros(tx.shape + (3,), np.float32) + np.array([40, 46, 92], np.float32)
    # specular dots: sparse bright glints, mostly on raised (noise-high) spots
    rng = NOISE[3]; sp = sample_wrap(rng, tx * 7.0, ty * 7.0)
    dots = smooth(0.80, 0.86, sp) * smooth(0.45, 0.6, n2)
    rgb = rgb * (1 - dots[..., None]) + np.array([235, 248, 255], np.float32) * dots[..., None]
    a = np.maximum(a, dots * 0.85)
    # puddle-y sheen streaks along iso axis (light from top-left)
    sh = smooth(0.62, 0.7, N(4, tx * 0.5 + ty * 1.5, ty, 3.0)) * 0.35
    rgb = rgb * (1 - sh[..., None]) + np.array([150, 190, 230], np.float32) * sh[..., None]
    a = np.maximum(a, sh * 0.5)
    return rgb, a

def snow_cover(tx, ty, cover=None):
    n = N(1, tx, ty, 2.0); n2 = N(5, tx, ty, 5.0)
    base = np.array(SNOW[1], np.float32); shade = np.array(SNOW[2], np.float32); hl = np.array(SNOW[0], np.float32)
    # soft drift lumps lit from top-left: use noise gradient
    g = np.gradient(sample_wrap(NOISE[2], tx * 2.0, ty * 2.0))
    lit = np.clip(0.5 - (g[0] + g[1]) * 22, 0, 1)
    t = 0.45 + 0.55 * smooth(0.3, 0.7, lit + (n2 - 0.5) * 0.2)
    rgb = shade[None, None] * (1 - t[..., None]) + base[None, None] * t[..., None]
    hh = smooth(0.72, 0.8, lit) * 0.6
    rgb = rgb * (1 - hh[..., None]) + hl * hh[..., None]
    sp = smooth(0.86, 0.9, sample_wrap(NOISE[3], tx * 9, ty * 9)) * smooth(0.5, 0.6, n)   # sparkles
    rgb = rgb * (1 - sp[..., None]) + np.array([255, 255, 255], np.float32) * sp[..., None]
    sp2 = smooth(0.88, 0.92, sample_wrap(NOISE[4], tx * 8, ty * 8)) * 0.6   # cool blue glints
    rgb = rgb * (1 - sp2[..., None]) + np.array([170, 205, 255], np.float32) * sp2[..., None]
    a = np.ones_like(tx) if cover is None else cover
    return rgb, a

def snow_edge(mask):
    """autotile for a NON-snow tile next to snow; bit0 +x(SE edge) bit1 +y(SW) bit2 -x(NW) bit3 -y(NE)."""
    def f(tx, ty):
        wob = (N(4, tx, ty, 3.0) - 0.5) * 0.16 + (N(5, tx, ty, 7.0) - 0.5) * 0.06
        c = np.zeros_like(tx)
        for bit, d in ((1, 0.5 - tx), (2, 0.5 - ty), (4, tx + 0.5), (8, ty + 0.5)):
            if mask & bit: c = np.maximum(c, smooth(0.40 + wob, 0.26 + wob, d))
        # corners: where two adjacent bits meet, round out
        rgb, _ = snow_cover(tx, ty)
        # soft blue shade along the snow lip (reads as thickness)
        lip = smooth(0.0, 0.5, c) * (1 - smooth(0.5, 1.0, c))
        rgb = rgb * (1 - 0.35 * lip[..., None]) + np.array(SNOW[3], np.float32) * 0.35 * lip[..., None]
        return rgb, smooth(0.45, 0.6, c)
    return f

def frost(tx, ty):
    """feathery frost crystals (tileable): white/ice-blue lines, alpha = frost amount."""
    n = N(1, tx, ty, 3.0)
    # ridged noise = crystal veins
    r1 = 1 - np.abs(sample_wrap(NOISE[2], tx * 4, ty * 4) * 2 - 1)
    r2 = 1 - np.abs(sample_wrap(NOISE[4], tx * 8 + 0.3, ty * 8) * 2 - 1)
    veins = smooth(0.86, 0.95, r1) * 0.9 + smooth(0.88, 0.96, r2) * 0.6
    film = 0.22 + 0.18 * n
    a = np.clip(np.maximum(film, veins), 0, 0.95)
    col = np.array([225, 240, 255], np.float32)[None, None] * (1 - veins[..., None] * 0.0) + 0
    col = col * (1 - veins[..., None]) + np.array([255, 255, 255], np.float32) * veins[..., None]
    return col, a

def puddle(size, ripple_t=None):
    sc = {"s": 0.27, "m": 0.37, "l": 0.47}[size]
    def f(tx, ty):
        # puddle blob in tile space (circle in tile space = iso ellipse on screen), wobbly edge
        ang = np.arctan2(ty, tx); rr = np.hypot(tx, ty)
        wob = 1 + 0.07 * np.sin(ang * 2 + 1.0) + 0.06 * np.sin(ang * 3 + 2.0) + (N(4, tx, ty, 2) - 0.5) * 0.12
        d = rr / (sc * wob)
        if ripple_t is not None:
            # expanding rings (2 staggered drops), white, alpha only inside puddle
            a = np.zeros_like(tx); col = np.zeros(tx.shape + (3,), np.float32) + 255
            for (ox, oy, ph) in ((-0.08 * sc / 0.34, -0.05, 0.0), (0.09 * sc / 0.34, 0.06, 0.5)):
                t = (ripple_t + ph) % 1.0
                r = np.hypot(tx - ox, ty - oy) / sc
                ring = np.exp(-((r - t * 0.75) / 0.045) ** 2) * (1 - t) ** 1.2
                a = np.maximum(a, ring * 0.85)
            return col, a * smooth(1.0, 0.85, d)
        inner = smooth(1.0, 0.9, d)
        rim = smooth(1.15, 1.0, d) * (1 - inner)
        rgb = np.zeros(tx.shape + (3,), np.float32)
        w0, w1, w2, w3 = [np.array(c, np.float32) for c in WATER]
        depth = np.clip(1 - d, 0, 1)
        rgb[:] = w1 * (1 - depth[..., None]) + w2 * depth[..., None]
        # sky reflection band (top-left lit) + cel highlight edge on bottom-right inside
        # soft sky reflection on the far (top-left) half, cel-stepped
        refl = smooth(0.1, -0.15, (tx + ty) / sc + (N(2, tx, ty, 2) - 0.5) * 0.3) * inner
        rgb = rgb * (1 - refl[..., None] * 0.55) + w0 * refl[..., None] * 0.55
        edge = smooth(0.78, 0.92, d) * inner
        rgb = rgb * (1 - edge[..., None] * 0.6) + w3 * edge[..., None] * 0.6
        # glints
        gl = np.exp(-(((tx + sc * 0.35) / (sc * 0.12)) ** 2 + ((ty + sc * 0.05) / (sc * 0.07)) ** 2))
        gl2 = np.exp(-(((tx + sc * 0.05) / (sc * 0.06)) ** 2 + ((ty + sc * 0.3) / (sc * 0.06)) ** 2))
        g = np.clip(gl + gl2, 0, 1) * inner
        rgb = rgb * (1 - g[..., None]) + np.array([255, 255, 255], np.float32) * g[..., None]
        # outline ring (ink-plum, soft) + damp dark rim
        ol = smooth(0.94, 1.0, d) * smooth(1.08, 1.0, d)
        ink = np.array(lerp(WATER[3], INK, 0.55), np.float32)
        rgb = rgb * (1 - rim[..., None]) + np.array([60, 50, 80], np.float32) * rim[..., None]
        rgb = rgb * (1 - ol[..., None]) + ink * ol[..., None]
        a = np.clip(inner * 0.92 + rim * 0.28 + ol * 0.9, 0, 1)
        return rgb, a
    return f

# ---------------- particles ----------------
def rain_splash(cv, em, i, n):
    t = i / n; cx, cy = 16, 24
    rx = 2 + t * 7; ry = rx * 0.45; a = int(255 * (1 - t) ** 0.8)
    cv.line([(cx + math.cos(q) * rx, cy + math.sin(q) * ry) for q in np.linspace(0, 2 * math.pi, 30)], WATER[0], 0.8, alpha=a)
    if t < 0.7:
        for j, s in enumerate((-1, 1, -0.4, 0.5)):
            h = math.sin(min(1, t * 1.6) * math.pi) * (3 + j)
            x = cx + s * (1.5 + t * 5); y = cy - h
            cv.fill(circ(x, y, 0.9, 1.1, wob=0), WATER[0], alpha=a)
            cv.fill(circ(x + 0.2, y + 0.3, 0.6, 0.6, wob=0), WATER[2], alpha=a)

def snowflake(cv, em, i, n):
    c = 16; rot = i * 0.4
    kinds = i % 6
    if kinds in (0, 3):  # classic 6-arm star with tips
        r = 5.5 if kinds == 0 else 4
        for a in range(6):
            q = rot + a * math.pi / 3; ex, ey = c + math.cos(q) * r, c + math.sin(q) * r
            cv.line([(c, c), (ex, ey)], SNOW[3], 1.6); cv.line([(c, c), (ex, ey)], SNOW[0], 0.8)
            for b in (-1, 1):
                mx, my = c + math.cos(q) * r * 0.6, c + math.sin(q) * r * 0.6
                cv.line([(mx, my), (mx + math.cos(q + b * 0.8) * r * 0.32, my + math.sin(q + b * 0.8) * r * 0.32)], SNOW[0], 0.6)
        cv.fill(circ(c, c, 1.2, wob=0), (255, 255, 255))
    elif kinds in (1, 4):  # puffy round flake (cute)
        r = 2.6 if kinds == 1 else 1.8
        cv.part(circ(c, c, r, wob=0.1, seed=i), SNOW, lw=0.6, shade=0.3, hl=0.2, ink=lerp(SNOW[3], INK, 0.3))
    elif kinds == 2:  # 6-petal flower flake
        for a in range(6):
            q = rot + a * math.pi / 3
            cv.part(circ(c + math.cos(q) * 2.6, c + math.sin(q) * 2.6, 1.5, 1.0, rot=q, wob=0), SNOW, lw=0.5, shade=0.2, hl=0.1, ink=lerp(SNOW[3], INK, 0.3))
        cv.fill(circ(c, c, 1.3, wob=0), (220, 235, 255))
    else:  # tiny sparkle cross
        cv.fill(star_pts(c, c, 3.0, 0.8, n=4, rot=rot), (255, 255, 255)); cv.fill(circ(c, c, 0.9, wob=0), SNOW[2])

def bolt(seed):
    def d(cv, em, i, n):
        rng = np.random.default_rng(seed)
        pts = [(48 + rng.normal(0, 4), 8.0)]
        while pts[-1][1] < 246:
            x, y = pts[-1]; pts.append((float(np.clip(x + rng.normal(0, 7), 22, 74)), y + 10 + rng.random() * 14))
        pts[-1] = (pts[-1][0], 246)
        branches = []
        for j in rng.choice(range(2, len(pts) - 3), 3, replace=False):
            bx, by = pts[j]; br = [(bx, by)]; dirx = rng.choice([-1, 1])
            for _ in range(rng.integers(2, 5)):
                bx = float(np.clip(bx + dirx * (5 + rng.random() * 9), 8, 88)); by += 8 + rng.random() * 10; br.append((bx, by))
            branches.append(br)
        k = [1.0, 0.7, 0.35][i]  # strike, hold, fade
        glow = (210, 220, 255); core = (255, 255, 250)
        for br in branches: em.line(br, glow, 6 * k, alpha=int(200 * k)); cv.line(br, (190, 200, 255), 3.4 * k, alpha=int(255 * k)); cv.line(br, core, 1.6 * k, alpha=int(255 * k))
        em.line(pts, glow, 10 * k, alpha=int(230 * k))
        cv.line(pts, lerp((120, 110, 200), INK, 0.2), 6.6 * k, alpha=int(220 * k))  # plum-violet rim (never black)
        cv.line(pts, (200, 210, 255), 4.6 * k, alpha=int(255 * k))
        cv.line(pts, core, 2.3 * k, alpha=255)
        em.line(pts, core, 2.0 * k)
        if i == 0:  # little cartoon zap star at the impact
            cv.part(star_pts(pts[-1][0], 244, 7, 3.0, n=6), [(255, 255, 255), (255, 250, 200), (255, 220, 120), (220, 160, 80)], lw=0.8, shade=0.15, hl=0)
            em.fill(star_pts(pts[-1][0], 244, 7, 3.0, n=6), (255, 250, 210))
    return d

def rainbow(cv, em, i, n):
    cols = ["#ff8c8c", "#ffb870", "#ffe680", "#a8e07a", "#86c8f2", "#b49cf0"]
    cx, cy = 128, 118; r0 = 106
    for j, c in enumerate(cols):
        r = r0 - j * 7
        pts = [(cx + math.cos(a) * r, cy - math.sin(a) * r * 0.92) for a in np.linspace(0.02, math.pi - 0.02, 120)]
        cv.line(pts, c, 7.4, alpha=170)
    # soft fade toward both feet: done in post (alpha ramp)
    # cute little clouds at the feet
    for x in (22, 234):
        for (dx, dy, r) in ((-9, 0, 7), (0, -5, 9), (10, 0, 7), (0, 3, 8)):
            cv.part(circ(x + dx, cy - 6 + dy, r, r * 0.8, wob=0.05), [(255, 255, 255), (250, 250, 255), (215, 220, 240), (170, 175, 210)], lw=0.8, shade=0.25, hl=0.1, outline=False)
        cv.part(circ(x, cy - 7, 12, 7, wob=0.08), [(255, 255, 255), (250, 250, 255), (215, 220, 240), (170, 175, 210)], lw=0.8, shade=0.25, hl=0.1, ink=(170, 160, 200))

# ---------------- big textures ----------------
def textures():
    out = []
    # rain streak layer 128x256 (tileable both ways): thin bluish-white streaks, alpha varies
    W, H = 128, 256; ss = 4; img = Image.new("L", (W * ss, H * ss), 0); col = Image.new("L", (W * ss, H * ss), 0)
    d = ImageDraw.Draw(img); rng = np.random.default_rng(3)
    for _ in range(80):
        x = rng.random() * W; y = rng.random() * H; L = 14 + rng.random() * 22; a = int(120 + rng.random() * 135)
        for ox in (-W, 0, W):
            for oy in (-H, 0, H):
                d.line([((x + ox) * ss, (y + oy) * ss), ((x + ox) * ss, (y + oy + L) * ss)], fill=a, width=int(ss * (0.9 + rng.random() * 0.6)))
    a = np.asarray(img.resize((W, H), Image.LANCZOS), np.float32) / 255
    # streak head brighter: vertical gradient per streak approximated by noise-free; colour constant
    rgba = np.stack([np.full_like(a, 220), np.full_like(a, 236), np.full_like(a, 255), a * 255], -1).astype(np.uint8)
    Image.fromarray(rgba, "RGBA").save(os.path.join(OUT_TEX, "rain_streak_tile_128x256.png")); out.append("textures/rain_streak_tile_128x256.png")
    # fog noise 256 soft tileable
    f = pnoise(256, 3, 77, octaves=5, persist=0.55); f = smooth(0.15, 0.9, f)
    gray(f).save(os.path.join(OUT_TEX, "fog_noise_256.png")); out.append("textures/fog_noise_256.png")
    # cloud shadows 1024 tileable: white = shadow density; soft puffy blobs
    c = pnoise(1024, 3, 55, octaves=6, persist=0.5); c = smooth(0.52, 0.72, c)
    c = np.asarray(gray(c).filter(ImageFilter.GaussianBlur(6)), np.float32) / 255
    gray(c).save(os.path.join(OUT_TEX, "cloud_shadow_1024.png")); out.append("textures/cloud_shadow_1024.png")
    # screen frost vignette 512 (cold status / blizzard): RGBA, frost creeping from edges
    S = 512; y, x = np.mgrid[0:S, 0:S].astype(np.float32) / S
    e = np.minimum(np.minimum(x, 1 - x), np.minimum(y, 1 - y))
    nn = pnoise(S, 6, 9, octaves=5)
    r1 = 1 - np.abs(pnoise(S, 10, 12, octaves=3) * 2 - 1)
    m = smooth(0.17, 0.02, e + (nn - 0.5) * 0.08)
    veins = smooth(0.9, 0.97, r1) * smooth(0.26, 0.08, e)
    al = np.clip(m * 0.75 + veins * 0.8, 0, 0.95)
    rgb = np.stack([200 + 55 * veins, 228 + 27 * veins, np.full_like(al, 255)], -1)
    to_img(rgb, al).save(os.path.join(OUT_TEX, "screen_frost_vignette_512.png")); out.append("textures/screen_frost_vignette_512.png")
    return out

if __name__ == "__main__":
    T = Atlas("surv_tiles", TW, FH, category="tile", pad_check=False)
    an = (0.5, 1 / 3)
    for sz in ("s", "m", "l"):
        T.add(f"tile_ov_puddle_{sz}", "idle", [tile_frame(puddle(sz))], fps=1, anchor=an)
        T.add(f"tile_ov_puddle_{sz}", "ripple", [tile_frame(puddle(sz, ripple_t=i / 6)) for i in range(6)], fps=8, anchor=an)
    T.add("tile_ov_wet_ground", "idle", [tile_frame(wet_ground)], fps=1, anchor=an)
    T.add("tile_ov_snow_cover", "idle", [tile_frame(snow_cover)], fps=1, anchor=an)
    T.add("tile_ov_snow_edge", "idle", [tile_frame(snow_edge(m)) for m in range(16)], fps=1, anchor=an)
    T.add("tile_ov_frost", "idle", [tile_frame(frost)], fps=1, anchor=an)
    P = Atlas("surv_weather_particles", 32, 32, category="vfx")
    P.addfn("fx_rain_splash_crown", "idle", 5, rain_splash, fps=14, loop=False, anchor=(0.5, 0.75))
    P.addfn("fx_snowflake", "idle", 6, snowflake, fps=1)
    L = Atlas("surv_lightning", 96, 256, category="vfx", emissive=True)
    for j, s in enumerate((4, 9, 23)):
        L.addfn("fx_lightning_bolt", "strike_" + "abc"[j], 3, bolt(s), fps=14, loop=False, anchor=(0.5, 0.97))
    Rb = Atlas("surv_rainbow", 256, 128, category="vfx")
    Rb.addfn("fx_rainbow", "idle", 1, rainbow, fps=1, anchor=(0.5, 0.97))
    save_build("weather", {"parts": [T.write(), P.write(), L.write(), Rb.write()], "textures": textures()})
    print("weather done")
