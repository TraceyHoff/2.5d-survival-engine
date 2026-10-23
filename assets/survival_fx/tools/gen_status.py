"""Character status particles + emote bubbles (renderer spawns/attaches them; no baked wet/frost overlays)."""
import math
import numpy as np
from PIL import Image, ImageDraw
from fxlib import *

WATER = ramp("water"); SNOW = ramp("snow"); FIRE = ramp("fire")
SWEAT = [(240, 252, 255), (170, 225, 245), (110, 180, 225), (70, 130, 190)]
CREAM = ramp("cloth_cream")

def mask_circles(cv, circles):
    m = Image.new("L", (cv.W, cv.H), 0); d = ImageDraw.Draw(m); S = cv.SS
    for (x, y, rx, ry) in circles: d.ellipse([(x - rx) * S, (y - ry) * S, (x + rx) * S, (y + ry) * S], fill=255)
    return m

def drop(cv, x, y, r, h, rp, tilt=0.0, alpha=255):
    p = drop_pts(x, y, r, h, tilt)
    cv.part(p, rp, lw=0.8, shade=0.3, hl=0.0, gloss=[(x - r * 0.35, y - r * 0.25, r * 0.28, r * 0.42)])

def drip(cv, em, i, n):
    t = i / n; y = 9 + t * 12; st = 1 + 0.35 * math.sin(t * math.pi)   # stretch while falling
    p = drop_pts(16, y, 2.2, 3.8 * st)
    cv.part(p, WATER, lw=0.8, shade=0.32, hl=0.0, gloss=[(15.2, y - 0.7, 0.6, 1.0)])

def sweat(cv, em, i, n):
    t = i / n; x = 16 + t * 5; y = 12 + t * t * 10; rot = t * 0.8
    drop(cv, x, y, 2.6, 4.6, SWEAT, tilt=-0.5 + rot)
    if i == 0:  # fling lines
        for a in (-0.6, -0.2): cv.line([(x - 4 + a * 3, y - 6), (x - 6 + a * 3, y - 8.5)], SWEAT[2], 0.7)

def breath(cv, em, i, n):
    t = i / n; k = 0.45 + t * 0.85; a = int(255 * (1 - t) ** 0.8)
    x = 10 + t * 10; y = 18 - t * 4
    circles = [(x, y, 3.0 * k, 2.6 * k), (x + 3.2 * k, y - 1.4 * k, 2.6 * k, 2.4 * k), (x + 5.4 * k, y + 0.6 * k, 2.2 * k, 1.9 * k), (x + 1.8 * k, y + 1.4 * k, 2.4 * k, 1.8 * k)]
    lay = Canvas(32, 32, seed=3, k=cv.k)
    lay.part(None, [(255, 255, 255), (238, 246, 255), (205, 220, 240), (160, 175, 210)], lw=0.7, shade=0.25, hl=0.0, mask=mask_circles(lay, circles),
             ink=(150, 160, 200))
    arr = np.asarray(lay.img).copy(); arr[..., 3] = (arr[..., 3].astype(np.float32) * a / 255).astype(np.uint8)
    cv.img = Image.alpha_composite(cv.img, Image.fromarray(arr))

def splash_feet(cv, em, i, n):
    """crown splash + ring at the feet; anchor (0.5, 0.84)."""
    t = i / n; cx, cy = 16, 24
    rx = 3 + t * 9.5; ry = rx * 0.45; a = int(230 * (1 - t))
    lay = Canvas(32, 32, seed=1, k=cv.k)
    lay.line([(cx + math.cos(q) * rx, cy + math.sin(q) * ry) for q in np.linspace(0, 2 * math.pi, 40)], WATER[0], 1.0)
    lay.line([(cx + math.cos(q) * rx, cy + math.sin(q) * ry) for q in np.linspace(0.2, math.pi - 0.2, 20)], WATER[2], 0.8)
    if t < 0.75:
        for j in range(5):
            ang = math.pi * (0.1 + 0.8 * j / 4)
            hgt = math.sin(min(1, t * 1.5) * math.pi) * (4 + (j % 2) * 3)
            x = cx - math.cos(ang) * (3 + t * 9); y = cy - hgt - 1 - math.sin(ang) * 1.5
            lay.part(circ(x, y, 1.15, 1.25, wob=0), WATER, lw=0.6, shade=0.2, hl=0.0, gloss=[(x - 0.3, y - 0.4, 0.35, 0.35)])
    arr = np.asarray(lay.img).copy(); arr[..., 3] = (arr[..., 3].astype(np.float32) * a / 230).astype(np.uint8)
    cv.img = Image.alpha_composite(cv.img, Image.fromarray(arr))

def icicles(cv, em, i, n):
    """cute snow cap that sits on the head/hat top (anchor (0.5, 0.25) = head-top attach) with tiny icicles hanging
    at the sides (over the ears, never over the eyes); frame 1 = twinkle."""
    ice = [(250, 255, 255), (200, 236, 250), (140, 195, 230), (90, 140, 190)]
    cap = circ(16, 9.5, 11.5, 4.2, wob=0.12, seed=4)
    lump = circ(13, 6.5, 5.5, 3.2, wob=0.1, seed=5); lump2 = circ(19.5, 7.2, 4.2, 2.6, wob=0.1, seed=6)
    from PIL import ImageChops
    m = ImageChops.lighter(ImageChops.lighter(cv.mask_from(cap), cv.mask_from(lump)), cv.mask_from(lump2))
    cv.part(None, SNOW, lw=0.75, shade=0.28, hl=0.15, mask=m, ink=lerp(SNOW[3], INK, 0.4))
    for (x, L) in ((5.5, 5.5), (8, 3.5), (24, 4), (26.5, 6)):
        cv.part([(x - 1.4, 11.5), (x + 1.4, 11.5), (x + 0.2, 11.5 + L), (x - 0.2, 11.5 + L)], ice, lw=0.6, shade=0.35, hl=0.25)
    for x in (11, 17, 21): cv.fill(circ(x, 6.5 + (x % 3) * 0.6, 0.7, wob=0), (255, 255, 255))
    if i == 1:
        cv.fill(star_pts(22, 5, 2.6, 0.7, n=4), (255, 255, 255))

def spiral(cv, em, i, n):
    """dizzy/tired spiral above the head; anchor bottom (0.5, 0.9)."""
    t = i / n; cx, cy = 16, 16
    pts = []
    for q in np.linspace(0, 3.2 * math.pi, 60):
        r = 0.8 + q * 0.85; a = q + t * 2 * math.pi
        pts.append((cx + math.cos(a) * r, cy + math.sin(a) * r * 0.62))
    cv.line(pts, lerp(R("cloth_purple", 3), INK, 0.4), 2.0)
    cv.line(pts, R("cloth_purple", 0), 1.0)
    for j in range(3):  # orbiting tiny stars
        a = t * 2 * math.pi + j * 2.094
        x, y = cx + math.cos(a) * 10.5, cy + math.sin(a) * 5.5
        cv.part(star_pts(x, y, 2.4, 1.0), "gold", lw=0.6, shade=0.2, hl=0.0)

def sweat_swirl(cv, em, i, n):
    """exhausted: 3 sweat drops orbiting + tiny steam swirl; anchor bottom."""
    t = i / n
    for j in range(3):
        a = t * 2 * math.pi + j * 2.094
        x, y = 16 + math.cos(a) * 10, 18 + math.sin(a) * 4.5
        if math.sin(a) < 0: drop(cv, x, y, 1.7 * 0.85, 3.0 * 0.85, SWEAT, tilt=-math.cos(a) * 0.4)
    q = np.linspace(0, 2.2 * math.pi, 30)
    cv.line([(16 + math.sin(v + t * 6.28) * 2.2, 15 - v * 1.4) for v in q], (230, 240, 250), 1.0, alpha=200)
    for j in range(3):
        a = t * 2 * math.pi + j * 2.094
        x, y = 16 + math.cos(a) * 10, 18 + math.sin(a) * 4.5
        if math.sin(a) >= 0: drop(cv, x, y, 1.7, 3.0, SWEAT, tilt=-math.cos(a) * 0.4)

def zzz(cv, em, i, n):
    t = i / n
    for j in range(3):
        ph = (t + j / 3) % 1
        s = 1.4 + ph * 2.6; x = 9 + ph * 13 + math.sin(ph * 6) * 1.2; y = 26 - ph * 19; a = int(255 * min(1, 2.2 * math.sin(ph * math.pi)))
        pts = [(x - s, y - s), (x + s, y - s), (x - s, y + s), (x + s, y + s)]
        cv.line(pts, INK, 1.9, alpha=a); cv.line(pts, R("cloth_blue", 0), 0.9, alpha=a)

# ---------------- emote bubbles ----------------
def bubble(cv, shake=0.0):
    """cream thought-bubble with tail (down-left); returns icon centre."""
    cx, cy = 16 + shake, 12.5
    m = mask_circles(cv, [(cx, cy, 11.5, 9), (cx - 6.5, cy + 2, 5.5, 5.5), (cx + 6.5, cy + 2.3, 5.5, 5.2), (cx - 3, cy - 4.2, 6.5, 5.2), (cx + 4, cy - 4.2, 6.5, 4.8)])
    cv.part(None, CREAM, lw=0.95, shade=0.12, hl=0.0, mask=m, ink=INK_SOFT)
    cv.part(circ(cx - 6, cy + 12.5, 2.0, 1.7, wob=0), CREAM, lw=0.8, shade=0.0, hl=0, ink=INK_SOFT)
    cv.part(circ(cx - 8.6, cy + 15.6, 1.2, 1.0, wob=0), CREAM, lw=0.7, shade=0.0, hl=0, ink=INK_SOFT)
    return cx, cy

def face(cv, cx, cy, r, rp, mood, t):
    cv.part(circ(cx, cy, r, r * 0.95, wob=0.03), rp, lw=0.8, shade=0.25, hl=0.12)
    if mood == "cold":
        for s in (-1, 1): cv.fill(circ(cx + s * r * 0.38, cy - r * 0.15, 0.85, 1.1, wob=0), INK)
        # chattering teeth
        w = r * 0.9; yy = cy + r * 0.38 + (0.35 if t % 2 else -0.15)
        cv.part([(cx - w / 2, yy - 1.2), (cx + w / 2, yy - 1.2), (cx + w / 2, yy + 1.2), (cx - w / 2, yy + 1.2)], CREAM, lw=0.6, shade=0, hl=0)
        for j in range(1, 4): cv.line([(cx - w / 2 + j * w / 4, yy - 1.0), (cx - w / 2 + j * w / 4, yy + 1.0)], INK_SOFT, 0.35)
        cv.line([(cx - w / 2, yy), (cx + w / 2, yy)], INK_SOFT, 0.35)
        for s in (-1, 1): cv.fill(circ(cx + s * r * 0.62, cy + r * 0.2, 1.4, 0.9, wob=0), (150, 190, 245), alpha=200)
    else:
        for s in (-1, 1):  # squinty > < eyes
            ex = cx + s * r * 0.38; ey = cy - r * 0.12
            cv.line([(ex - s * 1.2, ey - 1.0), (ex + s * 0.3, ey), (ex - s * 1.2, ey + 1.0)], INK, 0.65)
        cv.part(circ(cx, cy + r * 0.45, 1.6, 1.3 + 0.3 * (t % 2), wob=0), [(255, 150, 150), (200, 80, 90), (150, 50, 70), (110, 40, 60)], lw=0.5, shade=0, hl=0)
        for s in (-1, 1): cv.fill(circ(cx + s * r * 0.62, cy + r * 0.2, 1.5, 0.95, wob=0), (255, 110, 110), alpha=220)

def bubble_hungry(cv, em, i, n):
    shake = [0, -0.6, 0.6, 0][i]
    cx, cy = bubble(cv, shake * 0.3)
    # cute empty bowl + rumbling tummy squiggles
    bw = [(cx - 6, cy), (cx + 6, cy), (cx + 4.5, cy + 4.5), (cx - 4.5, cy + 4.5)]
    cv.part([(cx - 6.5 + shake, cy - 0.5)] + [(cx + shake + math.cos(a) * 6.5, cy - 0.5 + math.sin(a) * 5.2) for a in np.linspace(0, math.pi, 16)] + [(cx + 6.5 + shake, cy - 0.5)], "wood", lw=0.8, shade=0.3, hl=0.1)
    cv.part(circ(cx + shake, cy - 0.5, 6.5, 1.8, wob=0), [(170, 110, 80), (120, 70, 50), (90, 50, 40), (70, 40, 35)], lw=0.6, shade=0, hl=0)
    cv.part(capsule_pts(cx + 2 + shake, cy - 1, cx + 7 + shake, cy - 7, 0.7), "wood_dark", lw=0.5)  # spoon
    # rumble zig-zags
    a = 255 if i % 2 == 0 else 160
    for s in (-1, 1):
        x0 = cx + s * 9.5
        cv.line([(x0, cy - 6), (x0 + s * 1.2, cy - 4.5), (x0, cy - 3), (x0 + s * 1.2, cy - 1.5)], R("berry", 2), 0.8, alpha=a)
    # tiny "grr" stomach rumble
    cv.line([(cx - 3.5, cy - 6.5), (cx - 2, cy - 7.5 + (i % 2)), (cx - 0.5, cy - 6.5), (cx + 1, cy - 7.5 + (i % 2)), (cx + 2.5, cy - 6.5)], R("berry", 2), 0.75)

def bubble_freezing(cv, em, i, n):
    shake = [-0.5, 0.5, -0.5, 0.5][i]
    cx, cy = bubble(cv)
    face(cv, cx - 1.5 + shake, cy + 1, 6, [(225, 240, 255), (190, 215, 250), (150, 180, 230), (100, 120, 180)], "cold", i)
    # knit hat stripe + snowflake
    cv.part([(cx - 7.5 + shake, cy - 2.5), (cx + 4.5 + shake, cy - 2.5), (cx + 3 + shake, cy - 7), (cx - 6 + shake, cy - 7)], "cloth_blue", lw=0.7, shade=0.3, hl=0.1)
    cv.part(circ(cx - 1.5 + shake, cy - 8, 1.6, wob=0), "cloth_cream", lw=0.5)
    sx, sy = cx + 7.5, cy - 5
    for k_ in range(3):
        a = k_ * math.pi / 3 + i * 0.2
        cv.line([(sx - math.cos(a) * 3, sy - math.sin(a) * 3), (sx + math.cos(a) * 3, sy + math.sin(a) * 3)], R("cloth_blue", 1), 0.8)

def bubble_overheating(cv, em, i, n):
    cx, cy = bubble(cv)
    melt = [0, 0.4, 0.8, 0.4][i]
    face(cv, cx - 1.5, cy + 1 + melt * 0.3, 6, [(255, 205, 180), (255, 160, 140), (230, 110, 100), (170, 70, 70)], "hot", i)
    # sweat drop on brow + mini sun
    drop(cv, cx + 3.5, cy - 2 + melt, 1.4, 2.6, SWEAT)
    sx, sy = cx + 7.5, cy - 5
    for k_ in range(8):
        a = k_ / 8 * 2 * math.pi + i * 0.2
        cv.line([(sx + math.cos(a) * 3.0, sy + math.sin(a) * 3.0), (sx + math.cos(a) * 4.4, sy + math.sin(a) * 4.4)], FIRE[2], 0.7)
    cv.part(circ(sx, sy, 2.4, wob=0), [FIRE[0], FIRE[1], FIRE[2], FIRE[3]], lw=0.6, shade=0.2, hl=0)

def bubble_exhausted(cv, em, i, n):
    cx, cy = bubble(cv)
    r = 6; fx, fy = cx - 1, cy + 1
    cv.part(circ(fx, fy, r, r * 0.95, wob=0.03), [(255, 235, 220), (240, 215, 200), (205, 180, 175), (160, 130, 140)], lw=0.8, shade=0.25, hl=0.1)
    for s in (-1, 1):  # droopy half-lidded eyes
        ex = fx + s * 2.3; ey = fy - 0.8 + (0.3 if i % 2 else 0)
        cv.part([(ex - 1.5, ey - 0.3), (ex + 1.5, ey - 0.3), (ex + 1.2, ey + 0.9), (ex - 1.2, ey + 0.9)], [(255, 255, 255), (250, 250, 255), (210, 210, 230), (150, 150, 170)], lw=0.45, shade=0, hl=0)
        cv.line([(ex - 1.7, ey - 0.4), (ex + 1.7, ey - 0.4)], INK, 0.7)
        cv.fill(circ(ex, ey + 0.4, 0.55, 0.45, wob=0), INK)
        cv.line([(ex - 1.3, ey + 1.9), (ex + 1.3, ey + 1.9)], (170, 150, 200), 0.5)  # eye bags
    cv.line([(fx - 1.6, fy + 3), (fx + 1.6, fy + 2.6)], INK, 0.6)
    # battery-low icon
    bx, by = cx + 7, cy - 5
    cv.part([(bx - 2, by - 3.5), (bx + 2, by - 3.5), (bx + 2, by + 3.5), (bx - 2, by + 3.5)], "cloth_cream", lw=0.6, shade=0, hl=0)
    cv.fill([(bx - 0.8, by - 4.6), (bx + 0.8, by - 4.6), (bx + 0.8, by - 3.5), (bx - 0.8, by - 3.5)], INK)
    cv.fill([(bx - 1.3, by + 1.3), (bx + 1.3, by + 1.3), (bx + 1.3, by + 2.9), (bx - 1.3, by + 2.9)], R("berry", 1) if i % 2 else R("cloth_red", 0))

if __name__ == "__main__":
    A = Atlas("surv_status", 32, 32, category="vfx")
    A.addfn("fx_drip", "idle", 4, drip, fps=10, loop=False)
    A.addfn("fx_sweat_drop", "idle", 4, sweat, fps=10, loop=False)
    A.addfn("fx_breath_puff", "idle", 6, breath, fps=10, loop=False, anchor=(0.31, 0.56))
    A.addfn("fx_splash_feet", "idle", 5, splash_feet, fps=12, loop=False, anchor=(0.5, 0.75))
    A.addfn("fx_icicles", "idle", 2, icicles, fps=1.5, anchor=(0.5, 0.25))
    A.addfn("fx_tired_spiral", "idle", 6, spiral, fps=8, anchor=(0.5, 0.9))
    A.addfn("fx_sweat_swirl", "idle", 6, sweat_swirl, fps=8, anchor=(0.5, 0.9))
    A.addfn("fx_zzz", "idle", 6, zzz, fps=5, anchor=(0.3, 0.9))
    for k, f in (("hungry", bubble_hungry), ("freezing", bubble_freezing), ("overheating", bubble_overheating), ("exhausted", bubble_exhausted)):
        A.addfn(f"fx_bubble_{k}", "idle", 4, f, fps=6, anchor=(0.25, 0.97))
    save_build("status", {"parts": [A.write()], "textures": []})
    print("status done")
