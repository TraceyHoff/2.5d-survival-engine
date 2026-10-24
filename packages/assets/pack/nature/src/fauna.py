"""ADR-110 animals: 16 species x 8 facings, anims idle(1) walk(4) run(=walk @12fps) attack(2) hit(1) death(2) swim(2).
Every frame is trimmed to its own alpha box and bucketed by 16-rounded size into shared pages named
nature_critters_<w>x<h> (cold tier); sprites address them through per-facing dirFrames (no mirroring in the renderer)."""
import math, os, zlib
import numpy as np
from PIL import Image
import common
from common import render, Frame, FRAG, up
import palette
from palette import ramp
palette.RAMPS.update({
    "fur_red":   ["#e0a07a", "#b86c48", "#8c4c36", "#5e3428"],
    "fur_dark":  ["#a07e66", "#6e5242", "#4e3a32", "#30242a"],
    "fur_tan":   ["#f0d6a8", "#d2aa78", "#a8805a", "#765a44"],
    "fur_grey":  ["#e6e2dc", "#bdb6ae", "#8e8680", "#625c5a"],
    "fur_black": ["#7a7280", "#4c4652", "#34303c", "#201e28"],
    "duck_green": ["#8ee0a0", "#3ea86a", "#2a7a52", "#1c5040"],
    "turkey":    ["#c09070", "#8a5a40", "#603c30", "#3e2624"],
    "snake":     ["#c8e878", "#86c04a", "#5a9440", "#3a6a36"],
})
import beasts
from beasts import Canvas, Rig, circle, capsule_pts, DIR8_PHI, _eye, _star

Q = dict(neck=False, hoof="bark")
SPECS = {
  "animal_stag":     dict(frame=(72, 80), feet=70, fur="fur_orange", belly="cloth_cream", muzzle="hide", L=9.5, rb=6.4, hb=16.0, leg=12.0, lx=3.2, legw=1.5, head=(0, 10, 26.5), hr=4.8, snout=3.0, ears="deer", tail="puff", antlers="big", eye=1.25, neck=True),
  "animal_red_deer": dict(frame=(64, 64), feet=56, fur="fur_red", belly="cloth_cream", muzzle="hide", L=8.6, rb=5.9, hb=14.5, leg=10.5, lx=3.0, legw=1.4, head=(0, 9, 23.5), hr=4.5, snout=2.9, ears="deer", tail="puff", eye=1.3, neck=True),
  "animal_elk":      dict(frame=(80, 88), feet=78, fur="fur_tan", belly="fur_tan", muzzle="fur_dark", face="fur_dark", legfur="fur_dark", shag="fur_dark", L=11, rb=7.2, hb=17.5, leg=13, lx=3.6, legw=1.8, head=(0, 11.5, 28), hr=5.2, snout=3.4, ears="deer", tail="short", antlers="big", eye=1.2, neck=True),
  "animal_moose":    dict(frame=(88, 88), feet=78, fur="fur_dark", belly="fur_dark", muzzle="fur_dark", legfur="fur_tan", L=12, rb=8.2, hb=18.5, leg=14, lx=4.0, legw=2.0, head=(0, 13, 27), hr=5.8, snout=4.4, ears="deer", tail="short", antlers="palm", hump=True, beard="fur_dark", eye=1.1, neck=True),
  "animal_fox":      dict(frame=(48, 48), feet=42, fur="fur_orange", belly="snow", muzzle="snow", legfur="fur_black", L=6.5, rb=4.6, hb=7.5, leg=5.0, lx=2.6, legw=1.3, head=(0, 7, 12.5), hr=4.8, snout=2.6, ears="tri_big", tail="fluffy", cheeks=True, eye=1.35, neck=True),
  "animal_hare":     dict(frame=(40, 40), feet=34, fur="fur_grey", belly="cloth_cream", L=3.2, rb=5.2, hb=5.2, leg=1.6, lx=2.6, legw=1.3, head=(0, 4.6, 10.0), hr=4.3, snout=1.8, ears="long", tail="puff", hopper=True, pinknose=True, hoof="fur_grey", eye=1.05),
  "animal_squirrel": dict(frame=(40, 40), feet=34, fur="fur_red", belly="cloth_cream", L=2.4, rb=3.8, hb=4.0, leg=1.2, lx=2.0, legw=1.0, head=(0, 3.6, 8.0), hr=3.6, snout=1.5, ears="tri_small", tail="bushy", hopper=True, hoof="fur_red", eye=1.05),
  "animal_cow":      dict(frame=(72, 64), feet=56, fur="snow", belly="snow", muzzle="flower_pink", patches="fur_black", L=11, rb=7.6, hb=11.5, leg=7.0, lx=4.0, legw=2.0, head=(0, 12.5, 14), hr=5.6, snout=3.8, ears="tri_small", tail="tuft", horns="cow", eye=1.2, pinknose=True),
  "animal_sheep":    dict(frame=(56, 56), feet=48, fur="wool", wool="wool", face="fur_black", legfur="fur_black", belly="wool", muzzle="fur_black", hoof="fur_black", L=7.5, rb=6.8, hb=9.0, leg=5.0, lx=3.2, legw=1.3, head=(0, 9.5, 11.5), hr=4.2, snout=2.4, ears="tri_small", tail="short", eye=1.1),
  "animal_goat":     dict(frame=(56, 56), feet=48, fur="cloth_cream", belly="snow", muzzle="snow", L=7.5, rb=5.4, hb=10.0, leg=7.0, lx=2.8, legw=1.4, head=(0, 8.5, 15.0), hr=4.4, snout=2.6, ears="deer", tail="short", horns="goat", beard="cloth_cream", eye=1.2, neck=True),
  "animal_bear":     dict(frame=(72, 64), feet=56, fur="fur_brown", belly="hide", muzzle="hide", L=9.5, rb=8.4, hb=10.0, leg=5.6, lx=4.2, legw=2.5, head=(0, 11.5, 13.0), hr=6.2, snout=3.4, ears="round", tail="short", hump=True, hoof="fur_dark", eye=1.2),
  "animal_bison":    dict(frame=(80, 72), feet=62, fur="fur_brown", belly="fur_brown", muzzle="fur_dark", face="fur_dark", shag="fur_dark", legfur="fur_dark", L=11, rb=8.6, hb=11.5, leg=6.5, lx=4.2, legw=2.3, head=(0, 13.5, 11.5), hr=6.2, snout=3.6, ears="tri_small", tail="tuft", horns="bison", hornc="fur_black", hump=True, beard="fur_dark", eye=1.1),
}
BIRDS = {  # body, wing, head ramp, neck length, beak ramp, extras
  "animal_duck":   dict(body="hide", wing="fur_brown", head="duck_green", neck=1.5, beak="pumpkin", feet="pumpkin", size=0.85),
  "animal_goose":  dict(body="snow", wing="fur_grey", head="snow", neck=4.5, beak="pumpkin", feet="pumpkin", size=1.05),
  "animal_turkey": dict(body="turkey", wing="fur_dark", head="cloth_blue", neck=2.5, beak="cloth_yellow", feet="cloth_red", size=1.15, fan=True, wattle=True),
}
COMMON = ["animal_stag", "animal_red_deer", "animal_fox", "animal_hare", "animal_cow", "animal_sheep", "animal_goat", "animal_duck", "animal_turkey", "animal_goose"]
REST = ["animal_elk", "animal_moose", "animal_bear", "animal_bison", "animal_squirrel", "animal_snake"]
ANIMS = [("idle", 1, 2), ("walk", 4, 8), ("attack", 2, 8), ("hit", 1, 8), ("death", 2, 4), ("swim", 2, 4)]
FI_MAP = {"idle": [0], "walk": [0, 1, 2, 3], "attack": [0, 1], "hit": [0], "death": [1, 4], "swim": [0, 1]}

def bird(key, d, anim, fi):
    b = BIRDS[key]; s = b["size"]; W, H, feet = 48, 48, 42
    cv = Canvas(W, H, seed=zlib.crc32(key.encode()) % 997 + fi * 3 + d * 17 + ord(anim[0])); rig = Rig(cv, DIR8_PHI[d], W / 2, feet, s)
    bob = peck = flap = back = flat = 0; step = [0, 0]; eyes = "open"; sq = 1; stars = False; swim = anim == "swim"; lunge = 0
    if anim == "idle": pass
    elif anim in ("walk", "swim"): t = fi / 4 * 2 * math.pi; bob = abs(math.sin(t)) * 0.8; step = [math.sin(t) * 1.8, -math.sin(t) * 1.8]; peck = -math.sin(2 * t) * 0.6
    elif anim == "attack": lunge = [-1.0, 3.0][fi]; peck = [-1.5, 1.5][fi]; flap = [2.5, 1.0][fi]; eyes = "squint"
    elif anim == "hit": sq = .82; back = 1.5; eyes = "squint"; flap = 2
    elif anim == "death": back = [.8, 0][fi]; bob = [2.5, 0][fi]; flap = [2.5, 0][fi]; flat = [0, 1][fi]; eyes = "squint" if fi == 0 else "x"; stars = fi == 1; sq = [1.1, .85][fi]
    by = -back + lunge * 0.4; bz = (6.5 * sq + bob) * (1 - flat) + 4.0 * flat
    if swim: bz = 3.2 + [0, 0.4][fi]
    else:
        for i, side in enumerate((-1, 1)):
            (f0, fv) = rig.proj(side * 1.8, by + step[i] * (1 - flat), bz - 3.5); (f1, _) = rig.proj(side * (1.8 + flat * 3), by + step[i] * (1 - flat) + 0.8, 0.4 + flat * 1.5)
            rig.add(fv - 1, lambda f0=f0, f1=f1: (cv.line([f0, f1], ramp(b["feet"])[2], 0.9 * s), cv.part(circle(f1, 1.6 * s, 0.8 * s), b["feet"], lw=0.5, shade=0.3, hl=0.2)))
    (bc, bv) = rig.proj(0, by, bz)
    if b.get("fan"):
        (fc, fvv) = rig.proj(0, by - 5.0, bz + 4.0)
        def fan():
            for j in range(7):
                a = -math.pi / 2 + (j - 3) * 0.32
                cv.part(capsule_pts(fc[0], fc[1], fc[0] + math.cos(a) * 9 * s, fc[1] + math.sin(a) * 8 * s, 1.4 * s, 2.2 * s), "turkey" if j % 2 else "fur_tan", lw=0.6, shade=0.3, hl=0.2)
        rig.add(fvv - 0.5, fan)
    def body():
        cv.part(circle(bc, 6.4 * s, 5.4 * sq * s, wob=0.06, seed=3), b["body"], lw=0.95, shade=0.25, hl=0.18)
        for side in (-1, 1):
            (wp, wv) = rig.proj(side * 5.0, by - 0.8, bz + 0.6 + flap)
            if abs(rig.nv(side, 0)) < 0.98: cv.part(circle(wp, 2.3 * s, (3.4 - flap * 0.4) * s, rot=side * (0.5 + flap * 0.4)), b["wing"], lw=0.7, shade=0.3, hl=0.15)
        if not b.get("fan"):
            (tp, _) = rig.proj(0, by - 6.0, bz + 1.6)
            if rig.nv(0, 1) < 0.7: cv.part([(tp[0] - 1.6 * s, tp[1] + 1.0), (tp[0], tp[1] - 2.6 * s), (tp[0] + 1.6 * s, tp[1] + 1.0)], b["wing"], lw=0.6, shade=0.3, hl=0.2)
    rig.add(bv, body)
    nl = b["neck"]; hz = (bz + 4.5 + nl - peck) * (1 - flat) + flat * 4.5; hy = by + 3.4 + max(peck, 0) * 0.8 + lunge + flat * 2.5
    (hc, hv) = rig.proj(0, hy, hz); fwd = rig.nv(0, 1)
    (nb, nbv) = rig.proj(0, by + 3.0, bz + 2.0)
    rig.add((nbv + hv) / 2, lambda: cv.part(capsule_pts(nb[0], nb[1], hc[0], hc[1], 2.6 * s, 2.0 * s), b["head"] if key != "animal_goose" else "snow", lw=0.85, shade=0.25, hl=0.15))
    def head():
        m = cv.part(circle(hc, 3.5 * s, 3.3 * s, wob=0.04), b["head"], lw=0.95, shade=0.22, hl=0.18)
        if key == "animal_duck": cv.fill(circle((hc[0], hc[1] + 2.8 * s), 2.6 * s, 0.6 * s, wob=0), (255, 255, 255), clip=m)
        if fwd > -0.35:
            for side in (-1, 1):
                a = math.radians(side * 40); vis = rig.nv(math.sin(a), math.cos(a))
                if vis > 0.05: _eye(beasts_cv(cv), rig, s, (3.4 * math.sin(a), hy + 3.4 * math.cos(a), hz + 0.8), max(0.55, vis) * 0.95, eyes)
        if fwd > -0.5:
            (bp, _) = rig.proj(0, hy + 4.2, hz - 0.6)
            if key in ("animal_duck", "animal_goose"): cv.part(circle(bp, 2.0 * s, 1.1 * s, wob=0), b["beak"], lw=0.5, shade=0.3, hl=0.2)
            else: cv.part([(bp[0] - 1.3 * s, bp[1] - 0.6), (bp[0] + 1.3 * s, bp[1] - 0.6), (bp[0], bp[1] + 1.8 * s)], b["beak"], lw=0.5, shade=0.3, hl=0.2)
            if b.get("wattle"):
                (wt, _) = rig.proj(0.6, hy + 3.4, hz - 2.6); cv.part(circle(wt, 0.9 * s, 2.0 * s, wob=0), "cloth_red", lw=0.5, shade=0.3, hl=0.2)
    rig.add(hv + 0.5, head)
    if swim: _ripple(cv, rig, 0, by, 9 * s, fi)
    if stars: rig.add(99, lambda: [_star(cv, (hc[0] + math.cos(a) * 5, hc[1] - 5.5 + math.sin(a) * 1.2), 1.5, 1) for a in (fi, fi + 2.1, fi + 4.2)])
    rig.draw(); return cv.final()

def beasts_cv(cv): return cv

def _ripple(cv, rig, x, y, r, fi):
    (wc, _) = rig.proj(x, y, 0); rx, ry = r, r * 0.5
    def back():
        cv.fill(circle(wc, rx * 0.95, ry * 0.95, wob=0), ramp("water")[1], alpha=150)
        cv.line([(wc[0] + math.cos(a) * rx, wc[1] - abs(math.sin(a)) * ry) for a in np.linspace(0, math.pi, 24)], ramp("water")[0], 0.9, alpha=230)
    def front():
        cv.line([(wc[0] + math.cos(a) * rx, wc[1] + abs(math.sin(a)) * ry) for a in np.linspace(0, math.pi, 24)], ramp("water")[0], 0.9, alpha=230)
        cv.line([(wc[0] - rx * 0.3 + fi * 2, wc[1] + ry * 1.2), (wc[0] + rx * 0.1 + fi * 2, wc[1] + ry * 1.2)], (255, 255, 255), 0.6, alpha=200)
    rig.add(-99, back); rig.add(99, front)

def snake(key, d, anim, fi):
    W, H, feet = 48, 40, 32
    cv = Canvas(W, H, seed=301 + fi * 3 + d * 17 + ord(anim[0])); rig = Rig(cv, DIR8_PHI[d], W / 2, feet, 1.0)
    ph = {"idle": 0, "walk": fi * math.pi / 2, "attack": 0, "hit": 0.5, "death": 0, "swim": fi * math.pi}[anim]
    flat = anim == "death" and fi == 1; n = 14; Lb = 22.0
    raise_ = {"attack": [3.5, 5.5][min(fi, 1)], "idle": 3.0, "hit": 2.0}.get(anim, 1.2 if not flat else 0.6)
    lunge = 3.5 if anim == "attack" and fi == 1 else (-1.5 if anim == "attack" else 0)
    pts = []
    for i in range(n):
        t = i / (n - 1); y = (t - 0.75) * Lb + lunge * t ** 3
        amp = (2.6 if anim != "idle" else 3.4) * (1 - t * 0.4)
        x = math.sin(t * 2.6 * math.pi + ph) * amp * (0.2 if flat else 1)
        z = 1.3 + (raise_ * max(0, (t - 0.72) / 0.28) ** 1.4 if not flat else 0)
        pts.append((x, y, z))
    def seg(i):
        a, b2 = rig.proj(*pts[i])[0], rig.proj(*pts[i + 1])[0]; w = 1.0 + 1.6 * math.sin(min(1, (i + 1) / (n - 2)) * math.pi * 0.8)
        cv.part(capsule_pts(a[0], a[1], b2[0], b2[1], w, w), "snake", lw=0.7, shade=0.3, hl=0.2, base_col=ramp("snake")[1] if i % 3 else ramp("cloth_yellow")[1])
    for i in range(n - 1): rig.add(rig.proj(*pts[i])[1], lambda i=i: seg(i))
    hx, hy, hz = pts[-1]; (hc, hv) = rig.proj(hx, hy + 1.0, hz + 0.6); fwd = rig.nv(0, 1)
    def head():
        cv.part(circle(hc, 3.0, 2.4, wob=0.03), "snake", lw=0.8, shade=0.25, hl=0.18)
        eyes = "x" if flat else ("squint" if anim in ("hit", "attack") or (anim == "death") else "open")
        if fwd > -0.35:
            for side in (-1, 1):
                a = math.radians(side * 45); vis = rig.nv(math.sin(a), math.cos(a))
                if vis > 0.05: _eye(cv, rig, 1, (hx + 2.6 * math.sin(a), hy + 1.0 + 2.6 * math.cos(a), hz + 1.3), max(0.55, vis) * 0.9, eyes)
        if fwd > -0.2 and not flat and (anim in ("attack", "idle") or fi % 2):
            (tp, _) = rig.proj(hx, hy + 4.6 + (1.5 if anim == "attack" else 0), hz)
            cv.line([(hc[0] + (tp[0] - hc[0]) * 0.6, hc[1] + (tp[1] - hc[1]) * 0.6 + 0.6), tp], ramp("cloth_red")[1], 0.6)
    rig.add(hv + 0.5, head)
    if anim == "swim": _ripple(cv, rig, 0, -4, 14, fi)
    if flat: rig.add(99, lambda: [_star(cv, (hc[0] + math.cos(a) * 4, hc[1] - 5 + math.sin(a)), 1.4, 1) for a in (0, 2.1, 4.2)])
    rig.draw(); return cv.final()

def draw(key, d, anim, i):
    if key == "animal_snake": return snake(key, d, anim, i), (24, 32)
    if key in BIRDS: return bird(key, d, anim, i), (24, 42)
    fi = FI_MAP[anim][i]
    sp = SPECS[key]; beasts.SPECS[key] = sp
    return beasts.quad(key, d, anim, fi, 1), (sp["frame"][0] / 2, sp["feet"])

def trim(fr, pad=1):
    """tight alpha box (1x px, from both scales) around a frame; returns (x0, y0, w, h) in 1x canvas coords."""
    a1 = np.asarray(fr.i1)[..., 3] > 6; a2 = np.asarray(fr.i2)[..., 3] > 6
    ys, xs = np.nonzero(a1); y2, x2 = np.nonzero(a2)
    x0 = min(xs.min(), x2.min() // 2) - pad; y0 = min(ys.min(), y2.min() // 2) - pad
    x1 = max(xs.max() + 1, (x2.max() + 2) // 2) + pad; y1 = max(ys.max() + 1, (y2.max() + 2) // 2) + pad
    return int(x0), int(y0), int(x1 - x0), int(y1 - y0)

def group(keys, name):
    def g(b):
        cells = []   # (key, anim, i, d, Frame, box)
        for key in keys:
            for an, n, _ in ANIMS:
                for i in range(n):
                    for d in range(8):
                        imgs = render(lambda: draw(key, d, an, i)[0]); (px, py) = _pivot(key)
                        fr = Frame(imgs, px, py); cells.append((key, an, i, d, fr, trim(fr)))
        # bucket by 8-rounded size (+2px gutter each side)
        buckets = {}
        for c in cells:
            x0, y0, w, h = c[5]; bw, bh = up(w + 4, 8), up(h + 4, 8); buckets.setdefault((bw, bh), []).append(c)
        where = {}
        for (bw, bh), cs in sorted(buckets.items()):
            per_row = max(2, 1024 // bw) // 2 * 2; max_rows = max(2, 1024 // bh) // 2 * 2; chunk = per_row * max_rows
            for pi in range(0, len(cs), chunk):
                part = cs[pi:pi + chunk]; cols = min(per_row, max(2, math.ceil(math.sqrt(len(part) * bh / bw)))); cols += cols % 2 if bw % 16 else 0; cols = min(cols, per_row)
                rows = math.ceil(len(part) / cols); rows += rows % 2 if (rows * bh) % 16 else 0
                akey = f"nature_critters_{name}_{bw}x{bh}" + (f"_{pi // chunk}" if len(cs) > chunk else "")
                pages = [Image.new("RGBA", (bw * cols * k, bh * rows * k), (0, 0, 0, 0)) for k in (1, 2)]
                for j, c in enumerate(part):
                    key, an, i, d, fr, (x0, y0, w, h) = c
                    cx, cy = (j % cols) * bw, (j // cols) * bh
                    ox, oy = (bw - w) // 2, (bh - h) // 2
                    for k, pg, im in ((1, pages[0], fr.i1), (2, pages[1], fr.i2)):
                        crop = im.crop((x0 * k, y0 * k, (x0 + w) * k, (y0 + h) * k)); pg.alpha_composite(crop, ((cx + ox) * k, (cy + oy) * k))
                    where[(key, an, i, d)] = (akey, j, {"x": round((ox + fr.px - x0) / bw, 5), "y": round((oy + fr.py - y0) / bh, 5)})
                os.makedirs(os.path.join(FRAG, "atlases"), exist_ok=True)
                pages[0].save(os.path.join(FRAG, f"atlases/{akey}.png"), optimize=True); pages[1].save(os.path.join(FRAG, f"atlases/{akey}@2x.png"), optimize=True)
                b.atlases.append({"key": akey, "image": f"atlases/{akey}.png", "frameW": bw, "frameH": bh, "columns": cols, "rows": rows, "pages": [{"scale": 2, "image": f"atlases/{akey}@2x.png"}]})
        for key in keys:
            anims = {}
            for an, n, fps in ANIMS:
                anims[an] = {"frames": list(range(n)), "fps": fps, "directions": 8, "dirStride": 1, **({"loop": False} if an in ("death", "hit", "attack") else {}),
                             "dirFrames": [{"atlas": where[(key, an, i, d)][0], "frame": where[(key, an, i, d)][1], "anchor": where[(key, an, i, d)][2]} for i in range(n) for d in range(8)]}
            anims["run"] = dict(anims["walk"], fps=12)
            first = anims["idle"]["dirFrames"][0]
            b.sprites.append({"key": key, "category": "critter", "atlas": first["atlas"], "anchor": first["anchor"], "animations": anims})
            b.previews.setdefault(f"critters_{name}", []).extend((f"{key[7:]}:{an}{i}d{d}", c[4].i2) for c in cells if c[0] == key for an, i, d in [(c[1], c[2], c[3])] if d in (1, 3, 5) and (an in ("idle", "attack", "swim", "death") and i == min(1, len(FI_MAP[an]) - 1) or (an == "walk" and i == 1)))
    return g

def _pivot(key):
    if key == "animal_snake": return (24, 32)
    if key in BIRDS: return (24, 42)
    return (SPECS[key]["frame"][0] / 2, SPECS[key]["feet"])

SET = os.environ.get("FAUNA_SET", "all")
GROUPS = [group(COMMON, "a")] + ([group(REST, "b")] if SET == "all" else [])
