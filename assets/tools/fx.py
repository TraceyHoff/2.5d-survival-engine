"""FX frame sequences (32x32) + fog overlay (256x256 tileable)."""
import math, numpy as np
from PIL import Image, ImageFilter, ImageDraw
from toon import Canvas, ellipse_pts, capsule_pts, SS, smooth, noise, downscale
from palette import ramp, hex2rgb
from chars import star, poof as poof_draw

def C(x, y, r, ry=None, rot=0, wob=0.05, seed=0, n=32): return ellipse_pts(x, y, r, ry or r, rot, n=n, wob=wob, seed=seed)

def fade(im, a):
    arr = np.asarray(im).copy(); arr[..., 3] = (arr[..., 3] * a).astype(np.uint8); return Image.fromarray(arr)

def hit_sparkle(i, n=5):
    cv = Canvas(32, 32, seed=i); k = i / (n - 1)
    r = [5, 11, 13, 10, 6][i]
    star(cv, 16, 16, r, "gold", rot=k * 0.6)
    cv.fill(C(16, 16, r * 0.3, wob=0), (255, 255, 240))
    for j in range(6):
        a = j * math.pi / 3 + 0.3; d = 4 + k * 10
        x, y = 16 + math.cos(a) * d, 16 + math.sin(a) * d
        cv.part(C(x, y, 1.6 * (1 - k * 0.7), wob=0), "fire" if j % 2 else "gold", lw=0.5, shade=0.2, hl=0)
    return fade(cv.final(), 1 - max(0, k - 0.6) * 1.5)

def dust_puff(i, n=6):
    cv = Canvas(32, 32, seed=i); k = i / (n - 1)
    for j, (dx, dy, r) in enumerate([(-5, 2, 4), (5, 2, 4), (0, -1, 5), (-2, 4, 3.5)]):
        rr = r * (0.5 + k * 0.9); y = 22 - k * 4
        cv.part(C(16 + dx * (0.6 + k), y + dy * (0.5 + k * 0.5), rr, rr * 0.85, wob=0.12, seed=j), "dirt", lw=0.7, shade=0.25, hl=0.25,
                base_col=ramp("sand")[2], shade_col=ramp("dirt")[1], hl_col=ramp("sand")[0])
    return fade(cv.final(), 1 - k * 0.75)

def leaf(i, n=8, rp="leaf"):
    cv = Canvas(32, 32, seed=i); a = i / n * 2 * math.pi
    sx = math.cos(a); x = 16 + math.sin(a) * 4; y = 16 + math.sin(a * 2) * 2
    w = max(1.2, abs(sx) * 7)
    pts = [(x - w, y), (x, y - 4.6), (x + w, y), (x, y + 4.6)]
    pts = [(x + (px - x) * math.cos(a * 0.5) - (py - y) * math.sin(a * 0.5), y + (px - x) * math.sin(a * 0.5) + (py - y) * math.cos(a * 0.5)) for px, py in pts]
    cv.part(pts, rp, lw=0.8, shade=0.3, hl=0.25)
    cv.line([pts[0], pts[2]], ramp(rp)[3], 0.4)
    return cv.final()

def poof(i, n=8):
    cv = Canvas(32, 32, seed=i); k = i / (n - 1)
    if i == 0:
        star(cv, 16, 16, 6, "glow")
    else:
        for j, (dx, dy, r) in enumerate([(-6, 1, 5), (6, 0, 5), (0, -5, 5.5), (-3, 5, 4.5), (4, 5, 4)]):
            rr = r * (0.7 + k * 0.5) * (1 - max(0, k - 0.7) * 1.5)
            if rr > 0.6: cv.part(C(16 + dx * (0.7 + k * 0.5), 17 + dy * (0.7 + k * 0.5) - k * 3, rr, rr * 0.9, wob=0.12, seed=j), "smoke", lw=0.9, shade=0.25, hl=0.25)
        for j in range(3):
            a = j * 2.1 + k * 3; star(cv, 16 + math.cos(a) * (6 + k * 7), 14 + math.sin(a) * (4 + k * 4), 2.4 * (1.1 - k * 0.6), "gold", rot=k * 2)
        if False:  # little wisp ghost floats up (cute)
            y = 12 - k * 8
            cv.part([(13, y + 4)] + [(16 + math.cos(math.pi + t / 10 * math.pi) * 3, y + math.sin(math.pi + t / 10 * math.pi) * 3.4) for t in range(11)] + [(19, y + 4), (18, y + 3), (17, y + 4.5), (15.5, y + 3), (14.5, y + 4.5)],
                    "snow", lw=0.6, shade=0.2, hl=0.1)
            for dx in (-1, 1): cv.fill(C(16 + dx, y - 0.4, 0.45, 0.6, wob=0), ramp("ink")[3])
    return fade(cv.final(), 1 - max(0, k - 0.75) * 3)

def fire(i, n=6, W=32, H=32, tongues=None, size=None):
    """Rich cartoon flame: several licking tongues unioned into one inked silhouette, 4 nested heat layers,
    a white-hot core, pinching-off wisps and embers. Seamless loop over n frames."""
    size = size or min(W / 32, H / 32 * 1.0)
    cv = Canvas(W, H, seed=40 + i); ph = 2 * math.pi * i / n
    cx, by = W / 2, H - 6 * size
    nt = tongues or (3 if size < 1.4 else 5)
    rng = np.random.default_rng(7 + nt)
    specs = []
    for k in range(nt):
        u = (k - (nt - 1) / 2) / max(1, (nt - 1) / 2)       # -1..1 across the base
        hk = (1.0 - 0.38 * abs(u)) * (0.92 + 0.16 * rng.random())
        specs.append((u * 6.6 * size, hk, rng.integers(1, 3), rng.random() * 6.28))
    def tongue(dx, hk, f, p0, scale, w0):
        h = 23 * size * hk * scale * (1 + 0.12 * math.sin(ph * f + p0))
        w = w0 * size * scale * (0.9 + 0.1 * math.cos(ph * f + p0))
        lean = math.sin(ph * f + p0) * 2.4 * size * scale + dx * 0.25
        pts = []
        for t in range(13):
            a = t / 12; y = by - h * a
            curl = math.sin(a * 7 + ph * f + p0) * 0.9 * size * a
            pts.append((cx + dx - w * (1 - a) ** 0.6 + lean * a ** 1.6 + curl, y))
        for t in range(13):
            a = 1 - t / 12; y = by - h * a
            curl = math.sin(a * 6 + ph * f + p0 + 1.3) * 0.8 * size * a
            pts.append((cx + dx + w * (1 - a) ** 0.6 + lean * a ** 1.6 + curl, y))
        pts.append((cx + dx + w * 0.8, by + 1.6 * size)); pts.append((cx + dx - w * 0.8, by + 1.6 * size))
        return pts
    r = ramp("fire")
    layers = [  # scale, width, base, shade, hl, outline
        (1.0, 3.9, r[3], r[3], r[2], True),
        (0.8, 3.1, r[2], r[3], r[1], False),
        (0.58, 2.3, r[1], r[2], r[0], False),
        (0.34, 1.7, r[0], r[1], (255, 255, 240), False),
    ]
    for li, (sc, w0, base, sh, hl, ol) in enumerate(layers):
        polys = [tongue(dx * (1 - li * 0.18), hk, f, p0, sc, w0) for (dx, hk, f, p0) in specs]
        if li == 3: polys = polys[len(polys) // 2: len(polys) // 2 + 1] + ([polys[0]] if nt > 3 else [])
        if ol: cv.part(polys, "fire", lw=0.9 * max(1, size * 0.8), base_col=base, shade_col=sh, hl_col=hl, shade=0.12, hl=0.2, ink=ramp("brick")[3])
        else: cv.part(polys, "fire", outline=False, base_col=base, shade_col=sh, hl_col=hl, shade=0.2, hl=0.25)
    # white-hot core at the base
    cv.fill(C(cx, by - 1.6 * size, 2.4 * size, 1.1 * size, wob=0.1), (255, 252, 230), alpha=200)
    # pinching-off wisps rising from the tallest tongues
    for j in range(1 if size < 1.4 else 2):
        f = ((i / n) + j * 0.5) % 1.0
        top = by - 23 * size * (1.0 + f * 0.65); x = cx + math.sin(ph + j * 2) * 3 * size + (j - 0.5) * 4 * size * (size >= 1.4)
        rr = 1.7 * size * (1 - f) + 0.3
        if rr > 0.7:
            wisp = [(x, top - rr * 2.2), (x + rr, top), (x, top + rr * 0.9), (x - rr, top)]
            cv.part(wisp, "fire", lw=0.6, base_col=r[2] if f < 0.5 else r[3], shade_col=r[3], hl_col=r[1], shade=0.2, hl=0.25, ink=ramp("brick")[3])
    for j in range(2 + int(size * 2)):  # embers
        a = ((i / n) + j / (2 + int(size * 2))) % 1.0
        y = by - 10 * size - a * 16 * size; x = cx + math.sin(a * 6.28 * 2 + j * 1.7) * 7 * size
        cv.fill(C(x, y, 0.8 * (1 - a * 0.5) * max(1, size * 0.7), wob=0), r[0] if j % 2 else r[1], alpha=int(255 * (1 - a * 0.6)))
    return cv.final()

def fire_big(i, n=8): return fire(i, n, 48, 64, size=1.9)
def fire_huge(i, n=8): return fire(i, n, 64, 96, size=2.8, tongues=7)

def smoke(i, n=8):
    cv = Canvas(32, 32, seed=60 + i); k = i / (n - 1)
    r = 3 + k * 7; x = 16 + math.sin(k * 4) * 3; y = 26 - k * 16
    cv.part(C(x, y, r, r * 0.9, wob=0.12, seed=i), "smoke", lw=0.6, shade=0.25, hl=0.25, ink=ramp("smoke")[3])
    if r > 5: cv.part(C(x - r * 0.5, y + r * 0.3, r * 0.6, wob=0.12, seed=i + 9), "smoke", lw=0.6, shade=0.25, hl=0.25, ink=ramp("smoke")[3])
    return fade(cv.final(), 0.85 * (1 - k * 0.8))

def rain_streak():
    cv = Canvas(32, 32, seed=1)
    cv.line([(19, 4), (13, 24)], ramp("water")[0], 1.1, alpha=230); cv.line([(19.5, 4), (16, 15)], (255, 255, 255), 0.5, alpha=200)
    return cv.final(sharpen=False)

def rain_splash(i, n=4):
    cv = Canvas(32, 32, seed=i); k = (i + 1) / n
    m = Image.new("L", (cv.W, cv.H), 0); d = ImageDraw.Draw(m)
    rx, ry = 3 + k * 8, 1.2 + k * 3
    d.ellipse([(16 - rx) * SS, (27 - ry) * SS, (16 + rx) * SS, (27 + ry) * SS], outline=int(255 * (1 - k * 0.7)), width=int(SS * 0.9))
    cv.img.paste(Image.new("RGBA", cv.img.size, ramp("water")[0] + (255,)), mask=m)
    for j in (-1, 1):
        x = 16 + j * (2 + k * 5); y = 26 - math.sin(k * math.pi) * 7
        if i < n - 1: cv.part(C(x, y, 1.1, 1.4, wob=0), "water", lw=0.5, shade=0.1, hl=0.1)
    return cv.final(sharpen=False)

def snowflake(i):
    cv = Canvas(32, 32, seed=i); r = [3.2, 2.4, 4.0, 2.0][i]
    if i in (0, 2):
        for a in range(6):
            ang = a * math.pi / 3 + i * 0.3
            cv.line([(16, 16), (16 + math.cos(ang) * r * 1.4, 16 + math.sin(ang) * r * 1.4)], (255, 255, 255), 0.8)
        cv.part(C(16, 16, r * 0.45, wob=0), "snow", lw=0.5, shade=0.2, hl=0)
    else:
        cv.part(C(16, 16, r, wob=0.1, seed=i), "snow", lw=0.6, shade=0.3, hl=0.0, ink=ramp("snow")[3])
    return cv.final(sharpen=False)

def firefly(i, n=4):
    cv = Canvas(32, 32, seed=i); g = [0.6, 1.0, 0.75, 0.4][i]
    gl = Image.new("L", (cv.W, cv.H), 0); ImageDraw.Draw(gl).ellipse([(16 - 7 * g) * SS, (16 - 7 * g) * SS, (16 + 7 * g) * SS, (16 + 7 * g) * SS], fill=int(150 * g))
    gl = gl.filter(ImageFilter.GaussianBlur(3 * SS))
    lay = Image.new("RGBA", cv.img.size, ramp("glow")[1] + (0,)); lay.putalpha(gl); cv.img = Image.alpha_composite(cv.img, lay)
    cv.part(C(16, 16, 1.6, wob=0), "glow", lw=0.5, shade=0.1, hl=0, base_col=ramp("glow")[0], ink=ramp("glow")[3])
    cv.part(C(14.2, 14.6, 1.3, 0.8, rot=0.5, wob=0), "snow", lw=0.3, outline=False)
    cv.part(C(17.8, 14.6, 1.3, 0.8, rot=-0.5, wob=0), "snow", lw=0.3, outline=False)
    return cv.final(sharpen=False)

def shadow_blob():
    cv = Canvas(32, 32, seed=1); cv.shadow(16, 16, 12, 5, alpha=0.4); return cv.final(sharpen=False)

def fog_tile(layer=0, S=256):
    """tileable soft fog (white with alpha), via periodic noise."""
    ys, xs = np.mgrid[0:S, 0:S].astype(np.float32) / S
    rng = np.random.default_rng(100 + layer); f = np.zeros_like(xs)
    for k in range(1, 6):
        for _ in range(3):
            a, b = rng.integers(-k, k + 1, 2)
            if a == 0 and b == 0: a = k
            f += np.sin(2 * math.pi * (a * xs + b * ys) + rng.random() * 6.28) / k ** 1.1
    f = (f - f.min()) / (f.max() - f.min())
    al = smooth(0.35, 0.85, f) * (0.55 if layer == 0 else 0.4)
    col = np.array(hex2rgb("#eef0f8") if layer == 0 else hex2rgb("#d8d0ec"), np.float32)
    arr = np.concatenate([np.ones((S, S, 3)) * col, al[..., None] * 255], 2).astype(np.uint8)
    return Image.fromarray(arr, "RGBA")

FX = {  # key: (frames list builder, fps, loop)
  "fx_spark": (lambda: [hit_sparkle(i) for i in range(5)], 14, False),
  "fx_smoke": (lambda: [smoke(i) for i in range(8)], 8, True),
  "fx_dust": (lambda: [dust_puff(i) for i in range(6)], 14, False),
  "fx_leaf": (lambda: [leaf(i) for i in range(8)], 10, True),
  "fx_leaf_autumn": (lambda: [leaf(i, rp="leaf_autumn") for i in range(8)], 10, True),
  "fx_poof": (lambda: [poof(i) for i in range(8)], 14, False),
  "fx_fire": (lambda: [fire(i) for i in range(6)], 10, True),
  "fx_rain": (lambda: [rain_streak()], 1, True),
  "fx_rain_splash": (lambda: [rain_splash(i) for i in range(4)], 16, False),
  "fx_snow": (lambda: [snowflake(i) for i in range(4)], 1, True),
  "fx_firefly": (lambda: [firefly(i) for i in range(4)], 6, True),
  "fx_shadow_blob": (lambda: [shadow_blob()], 1, True),
}
