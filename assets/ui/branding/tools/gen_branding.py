#!/usr/bin/env python3
"""Cozy-Wild branding generator: logo, main-menu backdrop (+parallax), menu buttons, loading bar.
Usage:  python3 gen_branding.py [--title "My Game"] [--tagline "..."]
Title defaults to branding.json "title" (currently "SurVivaZ"). Everything is regenerated
under ui/branding/ (1x + @2x), plus engine atlases + manifest fragment in ui/branding/engine/.
Python3 + Pillow + numpy. Drawn supersampled, LANCZOS downscaled. Palette: /workspace/assets/palette.json.
"""
import json, math, random, argparse, os
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageEnhance, ImageChops
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.dirname(HERE)
UI = os.path.dirname(OUT)
FONT_D = os.path.join(UI, "fonts", "Fredoka.ttf")
FONT_B = os.path.join(UI, "fonts", "Nunito.ttf")
PAL = json.load(open(os.path.join(os.path.dirname(UI), "palette.json")))["ramps"]
def R(name, i): return PAL[name][i]
INK, INK_S, INK_D = "#3b2433", "#4a2f3d", "#2a1b2e"

def rgba(h, a=255):
    h = h.lstrip("#"); return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)

def font(size, w=700, wd=100, path=FONT_D):
    f = ImageFont.truetype(path, int(size))
    try: f.set_variation_by_axes([w, wd] if path == FONT_D else [w])
    except Exception: pass
    return f

# ---------- shape helpers ----------
def blob(cx, cy, rx, ry, seed=0, amp=0.04, n=90, rot=0.0):
    rnd = random.Random(seed); ph = [rnd.uniform(0, 6.28) for _ in range(4)]
    pts = []
    for i in range(n):
        t = i / n * 2 * math.pi
        k = 1 + amp * (math.sin(2 * t + ph[0]) * .5 + math.sin(3 * t + ph[1]) * .3 + math.sin(5 * t + ph[2]) * .2)
        x, y = math.cos(t) * rx * k, math.sin(t) * ry * k
        c, s = math.cos(rot), math.sin(rot)
        pts.append((cx + x * c - y * s, cy + x * s + y * c))
    return pts

def wobble_poly(pts, seed=0, amp=2.0, sub=6):
    rnd = random.Random(seed); out = []
    for i in range(len(pts)):
        (x0, y0), (x1, y1) = pts[i], pts[(i + 1) % len(pts)]
        for j in range(sub):
            t = j / sub; out.append((x0 + (x1 - x0) * t + rnd.uniform(-amp, amp), y0 + (y1 - y0) * t + rnd.uniform(-amp, amp)))
    return out

def rrect(x0, y0, x1, y1, r, n=10):
    pts = []
    for cx, cy, a0 in ((x1 - r, y0 + r, -90), (x1 - r, y1 - r, 0), (x0 + r, y1 - r, 90), (x0 + r, y0 + r, 180)):
        for i in range(n + 1):
            a = math.radians(a0 + 90 * i / n); pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts

def centroid(p): return (sum(x for x, _ in p) / len(p), sum(y for _, y in p) / len(p))
def scale_pts(p, k, c=None, dx=0, dy=0):
    cx, cy = c or centroid(p); return [(cx + (x - cx) * k + dx, cy + (y - cy) * k + dy) for x, y in p]

def part(d, pts, ramp, ow=4, hl=True, ink=INK):
    """3-tone cel part: shade body, base inset toward top-left, warm highlight, ink outline heavier bottom-right."""
    xs = [x for x, _ in pts]; ys = [y for _, y in pts]; r = max(max(xs) - min(xs), max(ys) - min(ys)) / 2
    d.polygon([(x + ow * .45, y + ow * .45) for x, y in pts], fill=ink)
    d.polygon(pts, fill=ramp[2], outline=ink, width=int(ow))
    d.polygon(scale_pts(pts, .84, dx=-r * .06, dy=-r * .08), fill=ramp[1])
    if hl:
        cx, cy = centroid(pts)
        d.polygon(blob(cx - r * .38, cy - r * .42, r * .22, r * .13, rot=-.6, seed=3), fill=ramp[0])
    d.line(pts + [pts[0]], fill=ink, width=int(ow), joint="curve")

def leaf(d, cx, cy, L, ang, ramp, ow=3):
    c, s = math.cos(ang), math.sin(ang); pts = []
    for i in range(41):
        t = i / 40; x = t * L; y = math.sin(t * math.pi) * L * .28
        pts.append((x, y))
    pts += [(x, -y * 0.9) for x, y in reversed(pts)]
    P = [(cx + x * c - y * s, cy + x * s + y * c) for x, y in pts]
    part(d, P, ramp, ow, hl=False)
    d.line([(cx, cy), (cx + L * .85 * c, cy + L * .85 * s)], fill=ramp[3], width=max(1, int(ow * .6)))

def flame(d, cx, by, w, h, seed=0, ow=4, phase=0.0):
    # three nested teardrops (fire ramp, outside-in deep->highlight)
    rnd = random.Random(seed)
    for k, col in ((1.0, R("fire", 3)), (.78, R("fire", 2)), (.55, R("fire", 1)), (.32, R("fire", 0))):
        ww, hh = w * k, h * k * (1 + .08 * math.sin(phase * 2 + k * 5))
        sway = w * .12 * math.sin(phase + k * 3)
        pts = []
        for i in range(48):
            t = i / 47 * math.pi
            x = math.sin(t) ** 1.2 * ww / 2
            y = -(1 - math.cos(t)) / 2 * hh
            pts.append((cx + x + sway * (-y / hh) ** 2, by + y))
        pts += [(2 * cx - x + 2 * sway * ((by - y) / hh) ** 2 * 0, y) for x, y in reversed(pts)]
        # mirrored left side with same sway
        pts = pts[:48] + [(cx - (x - cx) + 2 * sway * ((by - y) / hh) ** 2, y) for x, y in reversed(pts[:48])]
        d.polygon(pts, fill=col, outline=INK if k == 1.0 else None, width=int(ow) if k == 1.0 else 0)

def campfire(img, cx, by, s, phase=0.0, glow=True):
    """campfire at base center (cx,by), s = scale (1 ≈ 120 px wide)."""
    if glow:
        g = Image.new("RGBA", img.size, (0, 0, 0, 0)); gd = ImageDraw.Draw(g)
        gd.ellipse([cx - 150 * s, by - 120 * s, cx + 150 * s, by + 40 * s], fill=rgba(R("fire", 1), 90))
        g = g.filter(ImageFilter.GaussianBlur(40 * s)); img.alpha_composite(g)
    d = ImageDraw.Draw(img); ow = max(2, 5 * s)
    d.ellipse([cx - 70 * s, by - 14 * s, cx + 70 * s, by + 14 * s], fill=rgba(INK_D, 80))
    # logs
    for a in (-0.35, 0.35):
        c, sn = math.cos(a), math.sin(a); L, t = 62 * s, 13 * s
        P = [(-L, -t), (L, -t), (L, t), (-L, t)]
        P = [(cx + x * c - y * sn, by - 10 * s + x * sn + y * c) for x, y in P]
        part(d, wobble_poly(P, 7, 1.2 * s, 4), PAL["bark"], ow, hl=False)
    flame(d, cx, by - 10 * s, 64 * s, 110 * s, ow=ow, phase=phase)
    # stones
    for i, (dx, rr) in enumerate(((-66, 14), (-40, 12), (40, 12), (66, 14), (0, 11))):
        yy = by + (6 if dx else 12) * s
        part(d, blob(cx + dx * s, yy, rr * s, rr * .75 * s, seed=i), PAL["stone"], ow * .8)

def zombie_head(d, cx, cy, s, seed=1, skin="zomb_mint", tongue=True, hat=True, look=0.0, blink=False):
    ow = max(2, 6 * s)
    head = blob(cx, cy, 70 * s, 62 * s, seed=seed, amp=.06)
    part(d, head, PAL[skin], ow)
    # stitches across forehead
    d.line([(cx - 40 * s, cy - 34 * s), (cx - 6 * s, cy - 44 * s)], fill=INK, width=int(ow * .6))
    for i in range(4):
        x = cx - 36 * s + i * 10 * s; y = cy - 35 * s - i * 2.7 * s
        d.line([(x, y - 7 * s), (x + 2 * s, y + 7 * s)], fill=INK, width=int(ow * .5))
    # mismatched googly eyes
    for ex, er, pr in ((-24, 22, 9), (26, 15, 7)):
        x = cx + ex * s; y = cy - 4 * s
        if blink and ex > 0:
            d.arc([x - er * s, y - er * .5 * s, x + er * s, y + er * .5 * s], 0, 180, fill=INK, width=int(ow)); continue
        d.ellipse([x - er * s, y - er * s, x + er * s, y + er * s], fill="#fffaf0", outline=INK, width=int(ow * .8))
        px = x + (look * 6 + (3 if ex < 0 else -2)) * s; py = y + 4 * s
        d.ellipse([px - pr * s, py - pr * s, px + pr * s, py + pr * s], fill=INK)
        d.ellipse([px - pr * .35 * s - 2 * s, py - pr * .55 * s, px - 2 * s + pr * .25 * s, py - pr * .05 * s], fill="#ffffff")
    # cheeks
    for ex in (-46, 46):
        d.ellipse([cx + ex * s - 9 * s, cy + 14 * s, cx + ex * s + 9 * s, cy + 22 * s], fill=rgba(R("berry", 0), 200))
    # goofy mouth + tongue
    m = [(cx - 22 * s, cy + 24 * s), (cx + 20 * s, cy + 22 * s)]
    d.arc([cx - 24 * s, cy + 6 * s, cx + 22 * s, cy + 36 * s], 20, 160, fill=INK, width=int(ow * .8))
    if tongue:
        part(d, blob(cx + 6 * s, cy + 40 * s, 9 * s, 10 * s, seed=4), PAL["berry"], ow * .7, hl=False)
    d.polygon([(cx - 8 * s, cy + 34 * s), (cx - 2 * s, cy + 34 * s), (cx - 5 * s, cy + 41 * s)], fill="#fffaf0", outline=INK)
    if hat:  # droopy little beanie
        hat_pts = blob(cx - 4 * s, cy - 56 * s, 54 * s, 24 * s, seed=seed + 9, amp=.05, rot=-.12)
        part(d, hat_pts, PAL["cloth_purple"], ow)
        part(d, blob(cx + 46 * s, cy - 76 * s, 12 * s, 12 * s, seed=2), PAL["cloth_yellow"], ow * .8)

def zombie_hand(d, cx, cy, s, ang=0, skin="zomb_mint"):
    ow = max(2, 5 * s); c, sn = math.cos(ang), math.sin(ang)
    for fx in (-13, 0, 13):
        fy = -16 if fx == 0 else -12
        x, y = cx + (fx * c - fy * sn) * s, cy + (fx * sn + fy * c) * s
        part(d, blob(x, y, 7.5 * s, 11 * s, seed=fx + 20, rot=ang), PAL[skin], ow, hl=False)
    part(d, blob(cx, cy, 22 * s, 15 * s, seed=11, rot=ang), PAL[skin], ow, hl=False)

def zombie_full(img, cx, by, s, frame=0, nframes=6, skin="zomb_mint"):
    """chubby goofy zombie walking right; frame drives shamble."""
    d = ImageDraw.Draw(img); ow = max(2, 6 * s); t = frame / nframes * 2 * math.pi
    bob = abs(math.sin(t)) * 6 * s; lean = math.sin(t) * .06
    d.ellipse([cx - 44 * s, by - 9 * s, cx + 44 * s, by + 9 * s], fill=rgba(INK_D, 77))
    # legs
    for k, ph in ((-1, 0), (1, math.pi)):
        st = math.sin(t + ph) * 16 * s; lift = max(0, math.cos(t + ph)) * 8 * s
        x = cx + k * 14 * s + st
        part(d, rrect(x - 11 * s, by - 46 * s - lift, x + 11 * s, by - 4 * s - lift, 9 * s), PAL["cloth_denim"], ow, hl=False)
        part(d, blob(x + 6 * s, by - 6 * s - lift, 16 * s, 9 * s, seed=k + 5), PAL["leather"], ow, hl=False)
    # body
    body = blob(cx, by - 74 * s - bob, 40 * s, 38 * s, seed=8, amp=.05, rot=lean)
    part(d, body, PAL["cloth_teal"], ow)
    # patch
    part(d, rrect(cx - 22 * s, by - 76 * s - bob, cx - 6 * s, by - 60 * s - bob, 3 * s), PAL["cloth_yellow"], ow * .6, hl=False)
    # outstretched arms (classic zombie reach)
    for k, yo in ((0, -8), (1, 6)):
        sw = math.sin(t + k) * 4 * s
        ax0, ay0 = cx + 18 * s, by - 88 * s - bob + yo * s + sw
        part(d, rrect(ax0, ay0 - 9 * s, ax0 + 46 * s, ay0 + 9 * s, 8 * s), PAL[skin], ow, hl=False)
    zombie_head(d, cx + 8 * s, by - 140 * s - bob, s * .78, seed=3, skin=skin, look=1.0)

def sparkle(d, x, y, r, col="#fff2a8"):
    d.polygon([(x, y - r), (x + r * .25, y - r * .25), (x + r, y), (x + r * .25, y + r * .25), (x, y + r), (x - r * .25, y + r * .25), (x - r, y), (x - r * .25, y - r * .25)], fill=col)

def firefly(img, x, y, r):
    g = Image.new("RGBA", (int(r * 10), int(r * 10)), (0, 0, 0, 0)); gd = ImageDraw.Draw(g); c = r * 5
    gd.ellipse([c - r * 3, c - r * 3, c + r * 3, c + r * 3], fill=rgba("#fff2a8", 90))
    g = g.filter(ImageFilter.GaussianBlur(r * 1.2)); gd = ImageDraw.Draw(g)
    gd.ellipse([c - r, c - r, c + r, c + r], fill=rgba("#fffac8", 255))
    img.alpha_composite(g, (int(x - c), int(y - c)))

def down(img, w, h=None):
    h = h or round(img.height * w / img.width)
    # premultiplied LANCZOS
    a = np.asarray(img).astype(np.float32) / 255.0
    pm = a.copy(); pm[..., :3] *= pm[..., 3:4]
    pim = Image.fromarray((pm * 255 + .5).astype(np.uint8), "RGBA").resize((w, h), Image.LANCZOS)
    b = np.asarray(pim).astype(np.float32) / 255.0
    al = b[..., 3:4]; rgb = np.where(al > 1e-4, b[..., :3] / np.maximum(al, 1e-4), 0)
    return Image.fromarray((np.clip(np.concatenate([rgb, al], -1), 0, 1) * 255 + .5).astype(np.uint8), "RGBA")

# ---------- title lettering ----------
def split_title(title):
    w = title.split()
    if len(title) <= 11 or len(w) == 1: return [title]
    best = min(range(1, len(w)), key=lambda i: abs(len(" ".join(w[:i])) - len(" ".join(w[i:]))))
    return [" ".join(w[:best]), " ".join(w[best:])]

def letter_img(ch, f, stroke_in, stroke_out, face_ramp, seed):
    bb = f.getbbox(ch, stroke_width=stroke_out); W, H = bb[2] - bb[0] + 20, bb[3] - bb[1] + 20
    ox, oy = -bb[0] + 10, -bb[1] + 10
    def m(sw):
        im = Image.new("L", (W, H), 0); ImageDraw.Draw(im).text((ox, oy), ch, font=f, fill=255, stroke_width=sw, stroke_fill=255); return im
    face, cream, ink = m(0), m(stroke_in), m(stroke_out)
    out = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sh = int(stroke_out * .45)
    out.paste(Image.new("RGBA", (W, H), rgba(INK_D)), (0, 0), ImageChops.offset(ink, sh, sh))
    out.paste(Image.new("RGBA", (W, H), rgba(INK)), (0, 0), ink)
    out.paste(Image.new("RGBA", (W, H), rgba("#fffaf0")), (0, 0), cream)
    # banded face: highlight top, base middle, shade bottom-right
    fb = face.getbbox() or (0, 0, W, H); fy0, fy1 = fb[1], fb[3]
    grad = Image.new("RGBA", (W, H), rgba(face_ramp[1])); gd = ImageDraw.Draw(grad)
    gd.rectangle([0, 0, W, fy0 + (fy1 - fy0) * .30], fill=face_ramp[0])
    gd.rectangle([0, fy0 + (fy1 - fy0) * .70, W, H], fill=face_ramp[2])
    out.paste(grad, (0, 0), face)
    # gloss dot
    rnd = random.Random(seed); gx = fb[0] + (fb[2] - fb[0]) * .28; gy = fy0 + (fy1 - fy0) * .16
    gl = Image.new("L", (W, H), 0); ImageDraw.Draw(gl).ellipse([gx - 9, gy - 5, gx + 9, gy + 5], fill=230)
    out.paste(Image.new("RGBA", (W, H), (255, 255, 255, 255)), (0, 0), ImageChops.multiply(gl, face))
    return out, ox, oy

ACCENT = ["#d8ffd0", "#8fe0a0", "#4f9f7a"]

def title_block(title, S, ramps):
    """returns RGBA image of hand-lettered title (supersampled px)."""
    lines = split_title(title if any(c.islower() for c in title) else title.upper())
    mixed = any(c.islower() for c in title)
    sizes = [int(230 * S) if len(lines) == 1 else int(210 * S), int(230 * S)]
    imgs = []
    for li, line in enumerate(lines):
        f = font(sizes[li] if len(lines) > 1 else sizes[0] * min(1, 9 / max(1, len(line))) ** .6, 700, 112)
        sin_, sout = int(f.size * .07), int(f.size * .14)
        letters = []; x = 0
        for i, ch in enumerate(line):
            if ch == " ": x += f.size * .3; continue
            accent = mixed and ch.isupper() and i > 0   # mid-word capitals (e.g. SurVivaZ's V and Z) become zombie-mint showpiece letters
            fi = font(f.size * 1.24, 700, 112) if accent else (font(f.size * 1.1, 700, 112) if mixed and ch.isupper() else f)
            warm = ramps[:2] if mixed else ramps
            ramp = ACCENT if accent else warm[(i + li) % len(warm)]
            im, ox, oy = letter_img(ch, fi, int(fi.size * .07), int(fi.size * .14), ramp, i)
            ang = (-9 if (i % 2) else 9) if accent else random.Random(i * 7 + li).uniform(-6, 6)
            im = im.rotate(ang, Image.BICUBIC, expand=True)
            if accent: sparkle(ImageDraw.Draw(im), im.width * .82, im.height * .2, fi.size * .07)
            adv = fi.getlength(ch) * (1.02 if accent else 1)
            dy = math.sin(i * 1.3 + li) * f.size * .05 - (f.size * .06 if accent else 0)
            letters.append((im, x, dy)); x += adv * .93
        lw = int(x + sout * 4); lh = max(im.height for im, _, _ in letters) + int(f.size * .12)
        L = Image.new("RGBA", (lw, lh), (0, 0, 0, 0))
        for im, lx, dy in letters: L.alpha_composite(im, (int(lx), int(lh / 2 - im.height / 2 + dy)))
        imgs.append(L)
    W = max(i.width for i in imgs); H = sum(i.height for i in imgs) - int(40 * S) * (len(imgs) - 1)
    B = Image.new("RGBA", (W, H), (0, 0, 0, 0)); y = 0
    for i in imgs: B.alpha_composite(i, ((W - i.width) // 2, y)); y += i.height - int(40 * S)
    return B

def make_logo(title, tagline, S=2):
    """Logo drawn at 2048 wide (S=2 => 2x of 1024)."""
    W = 1024 * S; PADX = 120 * S
    ramps = [["#fff2a8", "#ffd45a", "#f4a74a"], ["#ffd27a", "#f4a74a", "#d7743a"], ["#c8f5c8", "#94dca8", "#62b48e"]]
    T = title_block(title, S, ramps)
    k = min(1.0, (W * .74) / T.width); T = T.resize((int(T.width * k), int(T.height * k)), Image.LANCZOS)
    H = int(T.height + 300 * S)
    W2 = W + 2 * PADX; img = Image.new("RGBA", (W2, H), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    tx, ty = (W2 - T.width) // 2 + int(20 * S), int(120 * S)
    # wooden plank behind title (signboard)
    px0, py0, px1, py1 = tx - 60 * S, ty + T.height * .18, tx + T.width + 30 * S, ty + T.height * .95
    plank = wobble_poly(rrect(px0, py0, px1, py1, 40 * S, 8), 3, 3 * S, 2)
    part(d, plank, PAL["wood"], 8 * S, hl=False)
    for yy in (py0 + (py1 - py0) * .36, py0 + (py1 - py0) * .68):
        d.line([(px0 + 30 * S, yy), (px1 - 30 * S, yy + 4 * S)], fill=R("wood", 3), width=int(4 * S))
    for nx, ny in ((px0 + 34 * S, py0 + 28 * S), (px1 - 34 * S, py0 + 28 * S), (px0 + 34 * S, py1 - 28 * S), (px1 - 34 * S, py1 - 28 * S)):
        part(d, blob(nx, ny, 9 * S, 9 * S), PAL["cloth_yellow"], 3 * S)
    # zombie peeking from behind the top-right of the sign
    zx, zy = tx + T.width * (.66 if any(c.islower() for c in title) else 1) - (0 if any(c.islower() for c in title) else 150 * S), ty - 18 * S
    zombie_head(d, zx, zy, 1.25 * S, seed=5, look=-1.0)
    # leaf sprigs left + right of sign
    for i, (lx, ly, a, rmp) in enumerate(((px0 + 10 * S, py0 + 20 * S, -2.5, "leaf"), (px0 - 5 * S, py0 + 70 * S, 3.0, "leaf_autumn"),
                                         (px0 + 40 * S, py0 - 5 * S, -1.9, "grass"), (px1 - 10 * S, py1 - 20 * S, 0.5, "leaf"),
                                         (px1 + 5 * S, py1 - 70 * S, -0.2, "leaf_autumn"), (px1 - 60 * S, py1 + 4 * S, 1.2, "grass"))):
        leaf(d, lx, ly, 78 * S, a, PAL[rmp], 4 * S)
    # title on top
    img.alpha_composite(T, (int(tx), int(ty)))
    # zombie hands gripping the plank top edge (in front)
    d = ImageDraw.Draw(img)
    zombie_hand(d, zx - 95 * S, ty + T.height * .18 + 8 * S, 1.2 * S, 0)
    zombie_hand(d, zx + 95 * S, ty + T.height * .18 + 4 * S, 1.2 * S, .15)
    # campfire bottom-left, sitting on the sign's corner
    campfire(img, int(px0 + 60 * S), int(py1 + 62 * S), 0.95 * S, glow=False)
    d = ImageDraw.Draw(img)
    for sx, sy, r in ((px0 + 40 * S, py1 - 180 * S, 10 * S), (px0 + 120 * S, py1 - 150 * S, 7 * S), (px1 - 120 * S, ty + 10 * S, 9 * S)):
        sparkle(d, sx, sy, r)
    if tagline:
        f = font(46 * S, 700, 100)
        tw = f.getlength(tagline); bx = W2 / 2 + 60 * S - tw / 2; by = py1 + 34 * S
        rib = rrect(bx - 40 * S, by - 8 * S, bx + tw + 40 * S, by + 64 * S, 30 * S)
        part(d, rib, PAL["cloth_red"], 6 * S, hl=False)
        d.text((bx, by), tagline, font=f, fill="#fffaf0", stroke_width=int(4 * S), stroke_fill=INK)
    bb = img.getbbox(); img = img.crop((max(0, bb[0] - 8 * S), max(0, bb[1] - 8 * S), min(W2, bb[2] + 8 * S), min(H, bb[3] + 8 * S)))
    return img

# ---------- background ----------
def iso_tile(d, cx, cy, tw, th, side, top, left, right, seed=0):
    top_p = [(cx, cy - th / 2), (cx + tw / 2, cy), (cx, cy + th / 2), (cx - tw / 2, cy)]
    d.polygon([(cx - tw / 2, cy), (cx, cy + th / 2), (cx, cy + th / 2 + side), (cx - tw / 2, cy + side)], fill=left)
    d.polygon([(cx + tw / 2, cy), (cx, cy + th / 2), (cx, cy + th / 2 + side), (cx + tw / 2, cy + side)], fill=right)
    d.polygon(top_p, fill=top)

def pine(d, x, by, h, ramp, ow, seed=0):
    rnd = random.Random(seed)
    part(d, rrect(x - h * .05, by - h * .25, x + h * .05, by, h * .02), PAL["bark"], ow, hl=False)
    for i in range(3):
        w = h * (.42 - i * .1); y1 = by - h * (.15 + i * .24); y0 = y1 - h * .38
        tri = wobble_poly([(x, y0), (x + w, y1), (x - w, y1)], seed + i, ow * .6, 5)
        part(d, tri, ramp, ow, hl=(i == 2))

def round_tree(d, x, by, h, ramp, ow, seed=0):
    part(d, rrect(x - h * .06, by - h * .45, x + h * .06, by, h * .03), PAL["bark"], ow, hl=False)
    for i, (dx, dy, r) in enumerate(((-.18, -.55, .26), (.18, -.58, .26), (0, -.78, .3))):
        part(d, blob(x + dx * h, by + dy * h, r * h, r * h * .9, seed=seed + i, amp=.08), ramp, ow)

def make_background(W=1920, H=1080, S=3):
    """S = supersample of 1920. Returns dict of layers (RGBA, W*S x H*S)."""
    w, h = W * S, H * S; u = S  # 1 unit = 1px@1080p
    ow = 4 * u
    # --- sky layer ---
    sky = Image.new("RGBA", (w, h), rgba("#2a1b2e")); d = ImageDraw.Draw(sky)
    bands = ["#3a2a52", "#523a80", "#7452ad", "#9b72d6", "#c77fb0", "#f48fb1", "#f4a74a", "#ffd27a"]
    for i, c in enumerate(bands):
        y0 = int(h * (.0 + i * .085)); d.rectangle([0, y0, w, h], fill=c)
    rnd = random.Random(4)
    for _ in range(160):
        x, y = rnd.uniform(0, w), rnd.uniform(0, h * .42); r = rnd.choice([1, 1, 1.5, 2.5]) * u
        if r > 2 * u: sparkle(d, x, y, r * 2, "#fff6c2")
        else: d.ellipse([x - r, y - r, x + r, y + r], fill="#fffaf0")
    mx, my = 1560 * u, 170 * u
    g = Image.new("RGBA", (w, h), (0, 0, 0, 0)); ImageDraw.Draw(g).ellipse([mx - 140 * u, my - 140 * u, mx + 140 * u, my + 140 * u], fill=rgba("#fff2a8", 70))
    sky.alpha_composite(g.filter(ImageFilter.GaussianBlur(30 * u))); d = ImageDraw.Draw(sky)
    part(d, blob(mx, my, 68 * u, 68 * u, seed=2, amp=.02), ["#fffaf0", "#fff2a8", "#ffd27a", "#e0a032"], ow)
    for cx_, cy_, r_ in ((-20, -18, 12), (18, 14, 9), (-8, 26, 6)):
        d.ellipse([mx + (cx_ - r_) * u, my + (cy_ - r_) * u, mx + (cx_ + r_) * u, my + (cy_ + r_) * u], fill="#ffd27a")
    for i, (cx_, cy_, cw) in enumerate(((300, 210, 220), (1150, 120, 180), (1720, 330, 200), (700, 300, 160))):
        for j in range(3):
            part(d, blob((cx_ + (j - 1) * cw * .35) * u, (cy_ - (j == 1) * 18) * u, cw * .3 * u, cw * .16 * u, seed=i * 3 + j), ["#e4d4ff", "#c9a8f0", "#9b72d6", "#7452ad"], ow * .8, hl=False)
    # --- far hills + trees layer ---
    far = Image.new("RGBA", (w, h), (0, 0, 0, 0)); d = ImageDraw.Draw(far)
    pts = [(0, h)] + [(x, h * .58 - 40 * u * math.sin(x / w * 7 + 1) - 25 * u * math.sin(x / w * 17)) for x in range(0, w + 1, 8 * u)] + [(w, h)]
    d.polygon(pts, fill="#523a80")
    rnd = random.Random(9)
    for i in range(46):
        x = rnd.uniform(0, w); yb = h * .6 - 30 * u * math.sin(x / w * 7 + 1)
        pine(d, x, yb, rnd.uniform(90, 160) * u, ["#7452ad", "#65539e", "#523a80", "#3a2a52"], ow * .7, seed=i)
    pts = [(0, h)] + [(x, h * .66 - 30 * u * math.sin(x / w * 5 + 3)) for x in range(0, w + 1, 8 * u)] + [(w, h)]
    d.polygon(pts, fill="#34806a")
    for i in range(30):
        x = rnd.uniform(0, w)
        if 620 * u < x < 1300 * u: continue
        yb = h * .67 - 30 * u * math.sin(x / w * 5 + 3)
        (pine if i % 3 else round_tree)(d, x, yb, rnd.uniform(140, 220) * u, PAL["pine"] if i % 3 else PAL["leaf"], ow, seed=i + 50)
    # distant goofy zombie on the right hill, near glow mushrooms
    zombie_full(far, int(1500 * u), int(h * .69), .55 * u, frame=1)
    d = ImageDraw.Draw(far)
    for i, (x, y) in enumerate(((1430, 760), (1585, 770), (1610, 752))):
        part(d, blob(x * u, y * u, 10 * u, 7 * u, seed=i), PAL["mush_glow"], ow * .6, hl=False)
    # --- near ground: iso grass plateau with camp ---
    near = Image.new("RGBA", (w, h), (0, 0, 0, 0)); d = ImageDraw.Draw(near)
    tw, th, sd = 128 * u, 64 * u, 36 * u
    tiles = []
    for gx in range(-10, 12):
        for gy in range(-10, 12):
            cx = 960 * u + (gx - gy) * tw / 2; cy = 820 * u + (gx + gy) * th / 2
            if cy < 740 * u or cy > h + th or cx < -tw or cx > w + tw: continue
            tiles.append((cy, cx, gx, gy))
    for cy, cx, gx, gy in sorted(tiles):
        rr = random.Random(gx * 31 + gy)
        dirt = (gx + gy) % 7 == 0 and abs(gx - gy) < 3
        top = PAL["dirt"][1] if dirt else (PAL["grass"][1] if (gx + gy) % 2 else PAL["grass"][0] if rr.random() < .25 else "#86c856")
        iso_tile(d, cx, cy, tw + 1, th + 1, sd, top, PAL["grass"][2], PAL["grass"][3])
    # dusk tint over ground (cool shadow side)
    tint = Image.new("RGBA", (w, h), rgba("#523a80", 70)); near.alpha_composite(Image.composite(tint, Image.new("RGBA", (w, h), (0, 0, 0, 0)), near.split()[3]))
    d = ImageDraw.Draw(near)
    rnd = random.Random(12)
    for i in range(120):
        x, y = rnd.uniform(0, w), rnd.uniform(770 * u, h)
        if 640 * u < x < 1280 * u and y < 1000 * u: continue
        for k in (-1, 0, 1): d.line([(x, y), (x + k * 6 * u, y - 14 * u)], fill=PAL["grass"][3], width=int(2.5 * u))
    # tent (iso box roof) left
    tx, ty = 300 * u, 830 * u
    d.ellipse([tx - 150 * u, ty - 20 * u, tx + 150 * u, ty + 40 * u], fill=rgba(INK_D, 80))
    part(d, wobble_poly([(tx - 130 * u, ty + 10 * u), (tx - 10 * u, ty - 170 * u), (tx + 20 * u, ty + 30 * u)], 1, 2 * u, 4), PAL["cloth_red"], ow)
    part(d, wobble_poly([(tx + 20 * u, ty + 30 * u), (tx - 10 * u, ty - 170 * u), (tx + 150 * u, ty - 20 * u)], 2, 2 * u, 4), ["#ff8c78", "#bb3f45", "#862d3b", "#5a1f2b"], ow, hl=False)
    d.polygon([(tx - 40 * u, ty + 14 * u), (tx - 10 * u, ty - 90 * u), (tx + 8 * u, ty + 24 * u)], fill=INK_D)
    # log seats + lantern
    for lx, ly in ((520 * u, 930 * u), (180 * u, 1000 * u)):
        part(d, rrect(lx - 70 * u, ly - 22 * u, lx + 70 * u, ly + 22 * u, 20 * u), PAL["bark"], ow, hl=False)
        part(d, blob(lx + 68 * u, ly, 16 * u, 20 * u, seed=1), PAL["wood"], ow * .8, hl=False)
    campfire(near, int(400 * u), int(985 * u), 1.4 * u)
    d = ImageDraw.Draw(near)
    # right foreground trees + bushes framing
    round_tree(d, 1800 * u, 1060 * u, 380 * u, PAL["leaf"], ow, seed=3)
    pine(d, 1640 * u, 1080 * u, 300 * u, PAL["pine"], ow, seed=8)
    round_tree(d, 60 * u, 790 * u, 300 * u, PAL["leaf_autumn"], ow, seed=6)
    for i, (bx, by) in enumerate(((1450, 1050), (700, 1075), (1260, 1080), (90, 1080))):
        part(d, blob(bx * u, by * u, 70 * u, 40 * u, seed=i + 30, amp=.1), PAL["grass_deep"], ow)
        for j in range(3): part(d, blob((bx - 30 + j * 28) * u, (by - 20 - (j % 2) * 10) * u, 8 * u, 8 * u, seed=j), PAL["berry"], ow * .6, hl=False)
    # signpost toward the zombie
    part(d, rrect(1370 * u, 820 * u, 1384 * u, 940 * u, 4 * u), PAL["wood"], ow, hl=False)
    part(d, wobble_poly([(1320 * u, 820 * u), (1450 * u, 812 * u), (1478 * u, 842 * u), (1450 * u, 870 * u), (1320 * u, 866 * u)], 4, 1.5 * u, 3), PAL["wood"], ow, hl=False)
    d.text((1338 * u, 822 * u), "zzz...", font=font(30 * u), fill=INK)
    # --- fireflies layer ---
    fx = Image.new("RGBA", (w, h), (0, 0, 0, 0)); rnd = random.Random(21)
    for _ in range(46):
        x, y = rnd.uniform(0, w), rnd.uniform(380 * u, 1060 * u)
        firefly(fx, x, y, rnd.uniform(2.2, 4.2) * u)
    # warm vignette edges keeps centre calm for logo + buttons
    vg = Image.new("L", (w, h), 0); ImageDraw.Draw(vg).ellipse([-w * .15, -h * .25, w * 1.15, h * 1.2], fill=255)
    vg = ImageChops.invert(vg.filter(ImageFilter.GaussianBlur(120 * u))).point(lambda v: int(v * .5))
    vig = Image.new("RGBA", (w, h), rgba(INK_D)); vig.putalpha(vg)
    return {"sky": sky, "far": far, "near": near, "fireflies": fx, "vignette": vig}

# ---------- buttons ----------
BTN = {
    "singleplayer": ("Singleplayer", ["#b4ea80", "#72c45c", "#479b55", "#2d7050"], "#fffaf0"),
    "multiplayer": ("Multiplayer", ["#bdf2f0", "#5cc6dc", "#3a9ccc", "#2d70a8"], "#fffaf0"),
    "settings": ("Settings", ["#f0b878", "#d08c52", "#a2633a", "#74432c"], "#fffaf0"),
    "quit": ("Quit", ["#ff8c78", "#e85d4f", "#bb3f45", "#862d3b"], "#fffaf0"),
}
STATES = ["normal", "hover", "pressed", "disabled"]
PAD = 6  # px @1x around plate for focus ring

def desat(img, k=.25, alpha=.7):
    a = img.split()[3]; g = ImageEnhance.Color(img).enhance(k); g = ImageEnhance.Brightness(g).enhance(.95)
    g.putalpha(a.point(lambda v: int(v * alpha))); return g

def plate(w, h, ramp, state, S=4):
    """button plate (w,h @1x incl PAD). Drawn at S."""
    W, H = w * S, h * S; img = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    p = PAD * S; lip = (2 if state == "pressed" else 5) * S; drop = (3 if state == "pressed" else 0) * S
    lift = (-1 if state == "hover" else 0) * S; r = 16 * S; ow = 2.6 * S
    x0, y0, x1, y1 = p, p + drop + lift, W - p, H - p
    if state == "hover":  # focus/hover ring (sky-700, 3px, offset 2)
        d.rounded_rectangle([x0 - 5 * S, y0 - 5 * S, x1 + 5 * S, y1 + 5 * S], r + 5 * S, outline="#3a9ccc", width=int(3 * S))
    d.rounded_rectangle([x0 + 2 * S, y0 + 3 * S, x1 + 2 * S, y1 + 3 * S], r, fill=rgba(INK_D, 90))
    d.rounded_rectangle([x0, y0, x1, y1], r, fill=ramp[3], outline=INK, width=int(ow))  # lip
    face = [x0 + ow, y0 + ow, x1 - ow, y1 - lip - ow]
    d.rounded_rectangle(face, r - 2 * S, fill=ramp[1])
    d.rounded_rectangle([face[0], face[1] + (face[3] - face[1]) * .62, face[2], face[3]], r - 2 * S, fill=ramp[2])
    d.rounded_rectangle([face[0], face[1], face[2], face[1] + (face[3] - face[1]) * .7], r - 2 * S, fill=ramp[1])
    d.rounded_rectangle([face[0] + 8 * S, face[1] + 4 * S, face[0] + 34 * S, face[1] + 9 * S], 3 * S, fill=ramp[0])  # gloss
    d.ellipse([face[2] - 16 * S, face[1] + 4 * S, face[2] - 10 * S, face[1] + 10 * S], fill=ramp[0])
    # stitch dashes
    for xx in range(int(face[0] + 14 * S), int(face[2] - 14 * S), int(10 * S)):
        d.line([(xx, face[3] - 4 * S), (xx + 5 * S, face[3] - 4 * S)], fill=ramp[3], width=int(1.4 * S))
    d.line([(x0 + r, y1 - lip), (x1 - r, y1 - lip)], fill=INK, width=int(1.6 * S))
    if state == "hover": img = ImageEnhance.Brightness(img).enhance(1.08)
    if state == "pressed": img = ImageEnhance.Brightness(img).enhance(.96)
    if state == "disabled": img = desat(img)
    return img

def icon(name, sz, S=4, col="#fffaf0"):
    W = sz * S; img = Image.new("RGBA", (W, W), (0, 0, 0, 0)); d = ImageDraw.Draw(img); ow = 3 * S
    c = W / 2; k = W / 40
    def body(cx, cy, s, fill):
        d.ellipse([cx - 7 * s, cy - 17 * s, cx + 7 * s, cy - 3 * s], fill=fill, outline=INK, width=ow)
        d.chord([cx - 12 * s, cy - 1 * s, cx + 12 * s, cy + 23 * s], 180, 360, fill=fill, outline=INK, width=ow)
    if name == "singleplayer":
        body(c, c + 4 * k, k, col); sparkle(d, c + 13 * k, c - 12 * k, 4 * k, "#fff2a8")
    elif name == "multiplayer":
        body(c - 7 * k, c + 5 * k, k * .85, "#f6dfa4"); body(c + 7 * k, c + 6 * k, k * .9, col)
    elif name == "settings":
        pts = []
        for i in range(48):
            a = i / 48 * 2 * math.pi; rr = (15 if (i // 3) % 2 == 0 else 11) * k; pts.append((c + rr * math.cos(a), c + rr * math.sin(a)))
        d.polygon(pts, fill=col, outline=INK, width=ow); d.line(pts + [pts[0]], fill=INK, width=ow, joint="curve")
        d.ellipse([c - 5 * k, c - 5 * k, c + 5 * k, c + 5 * k], fill=INK)
    elif name == "quit":  # door + arrow
        d.rounded_rectangle([c - 13 * k, c - 15 * k, c + 3 * k, c + 15 * k], 3 * k, fill="#d08c52", outline=INK, width=ow)
        d.ellipse([c - 1 * k, c - 1 * k, c + 2 * k, c + 2 * k], fill=INK)
        d.polygon([(c + 2 * k, c - 4 * k), (c + 9 * k, c - 4 * k), (c + 9 * k, c - 9 * k), (c + 17 * k, c), (c + 9 * k, c + 9 * k), (c + 9 * k, c + 4 * k), (c + 2 * k, c + 4 * k)], fill=col, outline=INK, width=ow)
    return img

def labelled(key, state, w=320, h=76, S=4):
    label, ramp, tc = BTN[key]
    pl = plate(w, h, ramp, "normal" if state == "disabled" else state, S)
    d = ImageDraw.Draw(pl); drop = (3 if state == "pressed" else -1 if state == "hover" else 0) * S
    ic = icon(key, 40, S); cy = (h * S - 5 * S) / 2 + drop + 1 * S
    pl.alpha_composite(ic, (int((PAD + 14) * S), int(cy - ic.height / 2)))
    f = font(28 * S, 600, 100)
    tw = f.getlength(label); tx = (PAD + 14 + 40 + 10) * S + ((w - 2 * PAD - 14 - 40 - 10 - 14) * S - tw) / 2
    d.text((tx, cy + 2 * S), label, font=f, anchor="lm", fill=INK_D, stroke_width=int(3 * S), stroke_fill=INK_D)
    d.text((tx, cy), label, font=f, anchor="lm", fill=tc, stroke_width=int(3 * S), stroke_fill=INK)
    if state == "disabled": pl = desat(pl)
    return pl

# ---------- loading bar ----------
def bar_frame(w=64, h=32, S=4):
    img = Image.new("RGBA", (w * S, h * S), (0, 0, 0, 0)); d = ImageDraw.Draw(img); ow = 2.6 * S
    d.rounded_rectangle([2 * S, 3 * S, w * S - 1 * S, h * S - 0], 13 * S, fill=rgba(INK_D, 90))
    d.rounded_rectangle([0, 0, w * S - 3 * S, h * S - 3 * S], 13 * S, fill="#a2633a", outline=INK, width=int(ow))
    d.rounded_rectangle([ow, ow, w * S - 3 * S - ow, (h * S - 3 * S) * .4], 11 * S, fill="#d08c52")
    d.rounded_rectangle([6 * S, 6 * S, w * S - 9 * S, h * S - 9 * S], 8 * S, fill="#4a2f3d", outline=INK, width=int(2 * S))  # track well
    d.rounded_rectangle([7 * S, 7 * S, w * S - 10 * S, 10 * S], 3 * S, fill="#2a1b2e")
    return img

def bar_fill(w=32, h=18, S=4):
    img = Image.new("RGBA", (w * S, h * S), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, w * S - 1, h * S - 1], 7 * S, fill="#ff8a2a", outline=INK, width=int(1.6 * S))
    d.rounded_rectangle([2 * S, 2 * S, w * S - 2 * S, h * S * .55], 5 * S, fill="#ffd04a")
    d.rounded_rectangle([5 * S, 3 * S, w * S - 5 * S, 6 * S], 2 * S, fill="#fff6c2")
    return img

def frames_sheet(fn, n, fw, fh, S=4):
    sheet = Image.new("RGBA", (fw * n * S, fh * S), (0, 0, 0, 0))
    for i in range(n):
        f = Image.new("RGBA", (fw * S, fh * S), (0, 0, 0, 0)); fn(f, i); sheet.alpha_composite(f, (i * fw * S, 0))
    return sheet

def save12(img, path, w1):
    """save 1x and @2x from a supersampled image (w1 = 1x width)."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    a = down(img, w1); a.save(path, optimize=True)
    b = down(img, w1 * 2); b.save(path.replace(".png", "@2x.png"), optimize=True)
    return a, b

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--title"); ap.add_argument("--tagline"); ap.add_argument("--fast", action="store_true")
    args = ap.parse_args()
    cfgp = os.path.join(OUT, "branding.json"); cfg = json.load(open(cfgp)) if os.path.exists(cfgp) else {}
    title = args.title or cfg.get("title") or "SurVivaZ"
    tagline = args.tagline if args.tagline is not None else cfg.get("tagline", "a cozy survival camp-out")
    random.seed(1)
    # logo
    L = make_logo(title, tagline, S=2)
    os.makedirs(os.path.join(OUT, "logo"), exist_ok=True)
    l1 = down(L, 1024); l1.save(os.path.join(OUT, "logo", "logo_1024.png"), optimize=True)
    l5 = down(L, 512); l5.save(os.path.join(OUT, "logo", "logo_512.png"), optimize=True)
    # background
    S = 2 if args.fast else 3
    layers = make_background(S=S)
    os.makedirs(os.path.join(OUT, "background", "parallax"), exist_ok=True)
    comp = Image.new("RGBA", layers["sky"].size)
    for k in ("sky", "far", "near", "fireflies", "vignette"):
        comp.alpha_composite(layers[k])
        down(layers[k], 1920, 1080).save(os.path.join(OUT, "background", "parallax", f"menu_bg_{k}.png"), optimize=True)
    down(comp, 1920, 1080).convert("RGB").save(os.path.join(OUT, "background", "menu_bg_1920x1080.png"), optimize=True)
    down(comp, 3840, 2160).convert("RGB").save(os.path.join(OUT, "background", "menu_bg_3840x2160.png"), optimize=True)
    # buttons
    bdir = os.path.join(OUT, "buttons")
    for key, (_, ramp, _) in BTN.items():
        for st in STATES:
            save12(plate(96, 76, ramp, st), os.path.join(bdir, "plates", f"btn_plate_{key}_{st}.png"), 96)
            save12(labelled(key, st), os.path.join(bdir, "labelled", f"btn_{key}_{st}.png"), 320)
        save12(icon(key, 40), os.path.join(bdir, "icons", f"ic_menu_{key}.png"), 40)
    # loading
    ldir = os.path.join(OUT, "loading")
    save12(bar_frame(), os.path.join(ldir, "loading_frame.png"), 64)
    save12(bar_fill(), os.path.join(ldir, "loading_fill.png"), 32)
    def zf(im, i): zombie_full(im, im.width // 2, im.height - 10, im.width / 230, frame=i, nframes=6)
    save12(frames_sheet(zf, 6, 64, 64), os.path.join(ldir, "loading_zombie_walk.png"), 64 * 6)
    def cf(im, i): campfire(im, im.width // 2, im.height - 12, im.width / 190, phase=i / 6 * 2 * math.pi, glow=False)
    save12(frames_sheet(cf, 6, 64, 64), os.path.join(ldir, "loading_campfire.png"), 64 * 6)
    cfg.update({"title": title, "tagline": tagline}); cfg.setdefault("app", {}).update({"title": title, "tagline": tagline})
    json.dump(cfg, open(cfgp, "w"), indent=1)
    print("title:", title)

if __name__ == "__main__":
    main()
