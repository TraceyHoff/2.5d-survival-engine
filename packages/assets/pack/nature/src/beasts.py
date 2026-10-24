"""Ambient animals (gameplay population.json spriteKeys): animal_deer, animal_rabbit, animal_chicken, animal_boar, animal_wolf.
8 facings (engine order E,SE,S,SW,W,NW,N,NE = screen down-right, down, down-left, left, up-left, up, up-right, right),
anims idle/walk/run/eat/hit/death, rendered at 1x and 2x (same grid). Deterministic; no baked shadow or lighting.
Usage: python3 animals.py [--out DIR]  -> DIR/atlases/animals_{small,medium,large}[ @2x].png + .json, manifest fragment."""
import math, os, sys, json, zlib
import common  # noqa: F401  (paths, extra ramps, 1x/@2x final)
from PIL import Image
from toon import Canvas, capsule_pts
from chars import Rig, circle
from palette import ramp

DIR8_PHI = [45 - 45 * i for i in range(8)]
ANIMS = [("idle", 4, 4), ("walk", 6, 8), ("run", 6, 12), ("eat", 4, 4), ("hit", 2, 10), ("death", 5, 8)]
PER_DIR = sum(n for _, n, _ in ANIMS)
INK = ramp("ink")

# species specs (1x px units); frame (W,H), feet y
SPECS = {
  "animal_deer":   dict(frame=(64, 64), feet=56, fur="fur_orange", belly="cloth_cream", L=9.0, rb=6.2, hb=15.0, leg=11.0, lx=3.2, legw=1.5,
                        head=(0, 9.5, 25.0), hr=4.6, snout=3.0, ears="deer", tail="puff", antlers=True, spots=True, eye=1.25),
  "animal_boar":   dict(frame=(48, 48), feet=42, fur="fur_brown", belly="hide", L=8.0, rb=6.6, hb=8.2, leg=5.0, lx=3.6, legw=1.9,
                        head=(0, 10.5, 10.0), hr=4.8, snout=3.6, ears="tri_small", tail="curl", tusks=True, bristle=True, eye=1.0),
  "animal_wolf":   dict(frame=(48, 48), feet=42, fur="slate", belly="cloth_cream", L=7.0, rb=5.8, hb=9.0, leg=6.0, lx=3.0, legw=1.6,
                        head=(0, 7.5, 15.5), hr=5.6, snout=3.0, ears="tri_big", tail="fluffy", tongue=True, eye=1.45),
  "animal_rabbit": dict(frame=(32, 32), feet=28, fur="hide", belly="cloth_cream", L=2.6, rb=4.8, hb=4.6, leg=1.2, lx=2.4, legw=1.2,
                        head=(0, 4.0, 9.0), hr=4.0, snout=1.6, ears="long", tail="puff", hopper=True, eye=1.0),
}

def frame_params(anim, fi, sp):
    """leg swing per leg [FL, FR, BL, BR], bob z, head dz/dy, tail wag, squash, eye mode."""
    P = dict(sw=[0, 0, 0, 0], lift=[0, 0, 0, 0], z=0.0, hdz=0.0, hdy=0.0, wag=0.0, sq=1.0, eyes="open", ear=0.0, munch=0, flat=0.0, stars=False, back=0.0)
    hop = sp.get("hopper")
    if anim == "idle":
        P["z"] = [0, 0.3, 0.5, 0.3][fi] * 0.6; P["wag"] = [0, 0.6, 0, -0.6][fi]; P["ear"] = [0, 0.2, 0, -0.1][fi]
        if fi == 2: P["eyes"] = "blink"
    elif anim in ("walk", "run", "swim"):
        n = sp.get("nwalk", 4); t = fi / n * 2 * math.pi; amp = sp["leg"] * (0.35 if anim != "run" else 0.6)
        if hop:
            seq = [(0, .85), (1.5, 1.1), (3.2, 1.08), (3.6, 1.0), (2.0, 1.05), (.4, .88)] if anim == "walk" else [(0, .8), (2.5, 1.2), (5.0, 1.12), (5.8, 1.0), (3.5, 1.05), (.8, .85)]
            P["z"], P["sq"] = seq[fi]; s = math.sin(t) * amp * 1.4; P["sw"] = [s, s, -s, -s]; P["ear"] = -0.4 if anim == "run" else 0.1
        elif anim in ("walk", "swim"):
            s = math.sin(t) * amp; P["sw"] = [s, -s, -s, s]
            P["lift"] = [max(0, math.cos(t)) * 1.2, max(0, -math.cos(t)) * 1.2, max(0, -math.cos(t)) * 1.2, max(0, math.cos(t)) * 1.2]
            P["z"] = abs(math.sin(t)) * 0.6; P["hdz"] = math.sin(2 * t) * 0.4; P["wag"] = math.sin(t) * 0.5
        else:   # bounding gallop: front pair then back pair
            s = math.sin(t) * amp; c = math.sin(t - 1.2) * amp; P["sw"] = [s, s * 0.8, c, c * 0.8]
            P["lift"] = [max(0, math.cos(t)) * 2, max(0, math.cos(t)) * 2, max(0, math.cos(t - 1.2)) * 2, max(0, math.cos(t - 1.2)) * 2]
            P["z"] = max(0, math.sin(t)) * sp["leg"] * 0.25 + 0.3; P["sq"] = 1 + math.sin(t) * 0.06; P["wag"] = 1.0; P["ear"] = -0.5; P["hdz"] = -0.8
    elif anim == "eat":
        P["hdz"] = -sp["head"][2] * 0.55 - [0, 0.6, 0, 0.6][fi]; P["hdy"] = 1.5; P["munch"] = fi % 2; P["wag"] = [0, .5, 0, -.5][fi]
        P["eyes"] = "happy" if fi in (1, 2) else "open"
    elif anim == "attack":
        P["back"] = [1.6, -2.4][fi]; P["hdz"] = [0.6, -1.4][fi]; P["hdy"] = [-0.5, 2.2][fi]; P["sq"] = [0.92, 1.06][fi]; P["eyes"] = "squint"; P["ear"] = -0.5; P["munch"] = fi
        P["sw"] = [[-1, -1, 1, 1], [2.5, 2.5, -1.5, -1.5]][fi]
    elif anim == "hit":
        P["sq"] = [0.82, 1.08][fi]; P["back"] = [2.0, 0.8][fi]; P["eyes"] = "squint"; P["ear"] = [0.6, 0.3][fi]; P["hdz"] = [-0.5, 0.3][fi]
    elif anim == "death":
        P["back"] = [2.0, 1.0, 0.5, 0, 0][fi]; P["z"] = [0, 2.0, 0.5, 0, 0][fi]; P["sq"] = [0.85, 1.1, 0.9, 0.8, 0.78][fi]
        P["flat"] = [0, 0, 0.5, 1, 1][fi]; P["eyes"] = "squint" if fi < 2 else "x"; P["stars"] = fi >= 3; P["ear"] = [0.5, 0.3, 0.6, 0.9, 0.9][fi]
        P["hdz"] = [0, 0.5, -1, -1.5, -1.5][fi]
    if anim == "swim": P["z"] = 0; P["lift"] = [0, 0, 0, 0]; P["wag"] *= 0.5
    if anim == "death" and sp.get("death_map"): pass
    return P

def _eye(cv, rig, k, p3, size, mode, ink=INK):
    (ep, _) = rig.proj(*p3)
    if mode == "open":
        cv.fill(circle(ep, 1.0 * size * k, 1.25 * size * k, wob=0), ink[3])
        cv.fill(circle((ep[0] - .38 * size * k, ep[1] - .5 * size * k), .45 * size * k, .45 * size * k, wob=0), (255, 255, 255))
    elif mode in ("blink", "happy", "squint"):
        w = 1.0 * size * k
        if mode == "squint": cv.line([(ep[0] - w, ep[1] - w * .6), (ep[0] + w * .4, ep[1]), (ep[0] - w, ep[1] + w * .6)], ink[3], 0.6 * k)
        else:
            dy = -0.4 * w if mode == "happy" else 0.3 * w
            cv.line([(ep[0] - w, ep[1]), (ep[0], ep[1] + dy), (ep[0] + w, ep[1])], ink[3], 0.6 * k)
    elif mode == "x":
        w = 0.9 * size * k
        cv.line([(ep[0] - w, ep[1] - w), (ep[0] + w, ep[1] + w)], ink[3], 0.55 * k); cv.line([(ep[0] - w, ep[1] + w), (ep[0] + w, ep[1] - w)], ink[3], 0.55 * k)

def _star(cv, c, r, k):
    pts = []
    for i in range(8):
        a = i / 8 * 2 * math.pi - math.pi / 2; rr = r * k * (1 if i % 2 == 0 else 0.38)
        pts.append((c[0] + math.cos(a) * rr, c[1] + math.sin(a) * rr))
    cv.part(pts, "gold", lw=0.5 * k, shade=0.2, hl=0.3, flat=True)

def quad(key, d, anim, fi, k=1):
    sp = SPECS[key]; W, H = sp["frame"]; cv = Canvas(W * k, H * k, seed=zlib.crc32(key.encode()) % 997 + fi * 3 + d * 17 + ord(anim[0]))
    rig = Rig(cv, DIR8_PHI[d], W * k / 2, sp["feet"] * k, k); P = frame_params(anim, fi, sp)
    fur, belly = sp["fur"], sp["belly"]; L, rb, hb, leg = sp["L"], sp["rb"] * P["sq"] ** -.3, sp["hb"], sp["leg"]
    by0 = -P["back"]; z = P["z"]; fl = P["flat"]
    bz = hb * P["sq"] * (1 - fl) + (rb * 0.75) * fl + z
    swim = anim == "swim"
    if swim: bz = rb * 0.45 + [0, 0.4][fi % 2]
    front = (0, by0 + L / 2, bz + 0.4); rear = (0, by0 - L / 2, bz)
    # legs (splay sideways when flat)
    for i, (sx, fy) in enumerate([(-1, 1), (1, 1), (-1, -1), (1, -1)]):
        if swim: break
        hy = by0 + fy * (L / 2) * 0.9; hip = (sx * sp["lx"], hy, bz - rb * 0.3)
        foot = (sx * (sp["lx"] + fl * leg * 0.9), hy + P["sw"][i] * (1 - fl), max(0.8, P["lift"][i] + z * (0.6 if not sp.get("hopper") else 0.9)) * (1 - fl) + fl * 1.2)
        (hp, hv), (fp, fv) = rig.proj(*hip), rig.proj(*foot)
        dep = (hv + fv) / 2 - 0.6
        def lg(hp=hp, fp=fp):
            cv.part(capsule_pts(hp[0], hp[1], fp[0], fp[1], sp["legw"] * k * 1.1, sp["legw"] * k), sp.get("legfur", fur), lw=0.85 * k, shade=0.3, hl=0.15, base_col=ramp(fur)[2] if sx < 0 else None)
            cv.part(circle(fp, sp["legw"] * k * 1.05, sp["legw"] * k * 0.75), sp.get("hoof", "bark"), lw=0.6 * k, shade=0.3, hl=0.2)
        rig.add(dep, lg)
    # tail
    (tp, tv) = rig.proj(0, by0 - L / 2 - rb * 0.8, bz + rb * 0.35 + P["wag"] * 0.3)
    def tail():
        t = sp["tail"]
        if t == "puff": cv.part(circle(tp, 2.0 * k * (1.2 if sp.get("hopper") else 1), wob=0.15), "snow", lw=0.8 * k, shade=0.25, hl=0.2)
        elif t == "curl":
            pts = [(tp[0] + (math.cos(a) * 1.6 + a * 0.3) * k, tp[1] - (math.sin(a) * 1.6 + 1) * k) for a in [i * 0.5 for i in range(10)]]
            cv.line(pts, ramp(fur)[3], 1.0 * k); cv.line(pts, ramp(fur)[1], 0.5 * k)
        elif t == "fluffy":
            (tt, _) = rig.proj(P["wag"] * 3.5, by0 - L / 2 - rb - 4, bz + rb + 3 + abs(P["wag"]))
            cv.part(capsule_pts(tp[0], tp[1], tt[0], tt[1], 2.0 * k, 3.0 * k), fur, lw=0.9 * k, shade=0.28, hl=0.18)
            cv.part(circle(tt, 1.8 * k, wob=0.1), "snow", lw=0.6 * k, shade=0.2, hl=0.1)
        elif t == "bushy":   # squirrel: big S-curl up over the back
            pts3 = [(0, by0 - L / 2 - rb * 0.6, bz + rb * 0.2), (P["wag"] * 0.8, by0 - L / 2 - rb * 1.6, bz + rb * 1.6), (P["wag"] * 1.2, by0 - L / 2 - rb * 1.2, bz + rb * 3.0), (P["wag"] * 1.2, by0 - L / 2 - rb * 0.3, bz + rb * 3.6)]
            P2 = [rig.proj(*p)[0] for p in pts3]
            for j, (a, b) in enumerate(zip(P2, P2[1:])): cv.part(capsule_pts(a[0], a[1], b[0], b[1], (2.2 + j * 0.5) * k, (2.6 + j * 0.4) * k), fur, lw=0.85 * k, shade=0.25, hl=0.18)
        elif t == "tuft":
            (tt, _) = rig.proj(P["wag"] * 1.5, by0 - L / 2 - rb - 0.6, bz - rb * 0.6)
            cv.line([tp, tt], ramp(fur)[3], 0.9 * k); cv.part(circle(tt, 1.3 * k, 1.8 * k, wob=0.1), sp.get("tuftc", "fur_brown"), lw=0.6 * k, shade=0.3, hl=0.15)
        elif t == "short":
            cv.part(circle(tp, 1.6 * k, 1.4 * k, wob=0.1), fur, lw=0.7 * k, shade=0.3, hl=0.15)
    if not (swim and sp["tail"] in ("tuft", "curl")): rig.add(tv, tail)
    if swim:
        (wc, wv) = rig.proj(0, by0, 0)
        def ripple(front, wc=wc):
            rx, ry = (L / 2 + rb * 1.6) * k, (L / 2 + rb * 1.6) * 0.5 * k
            n = 28; pts = [(wc[0] + math.cos(a) * rx, wc[1] + math.sin(a) * ry) for a in [math.pi * (i / (n - 1)) * (1 if front else -1) for i in range(n)]]
            if not front:
                cv.fill(circle(wc, rx * 0.95, ry * 0.95, wob=0), ramp("water")[1], alpha=150)
            cv.line(pts, ramp("water")[0], 0.9 * k, alpha=230)
            if front: cv.line([(wc[0] + rx * 0.4 * math.cos(fi * 2 + a), wc[1] + ry * 1.25) for a in (0, 0.5)], (255, 255, 255), 0.6 * k, alpha=200)
        rig.add(-99, lambda: ripple(False)); rig.add(99, lambda: ripple(True))
    # body
    (fp_, fv_), (rp_, rv_) = rig.proj(*front), rig.proj(*rear)
    def body():
        m = cv.part(capsule_pts(rp_[0], rp_[1], fp_[0], fp_[1], rb * k, rb * k * 1.04), fur, lw=1.0 * k, shade=0.24, hl=0.16)
        (bp, _) = rig.proj(0, by0, bz - rb * 0.55)
        cv.fill(circle(bp, (L * 0.5 + rb * 0.6) * k, rb * 0.5 * k, wob=0.05), ramp(belly)[1], clip=m, alpha=220)
        if sp.get("spots"):
            for (sx, sy) in [(-1.5, -2.5), (1.8, -1.0), (-0.6, 0.8), (1.0, -3.6)]:
                (s, _) = rig.proj(sx, by0 + sy, bz + rb * 0.75)
                cv.fill(circle(s, 0.9 * k, 0.7 * k, wob=0), ramp("cloth_cream")[0], clip=m)
        if sp.get("patches"):
            for (sx, sy, r) in [(-2, -2.0, 2.6), (2.4, 1.5, 2.2), (0.5, -4.0, 1.8), (-1.5, 2.8, 1.6)]:
                (s, _) = rig.proj(sx, by0 + sy, bz + rb * 0.6)
                cv.fill(circle(s, r * k, r * 0.75 * k, wob=0.2, seed=int(sx * 3)), ramp(sp["patches"])[2], clip=m)
        if sp.get("shag"):
            (s, _) = rig.proj(0, by0 + L * 0.35, bz + rb * 0.3)
            cv.fill(circle(s, (rb * 1.15) * k, rb * 1.2 * k, wob=0.12, seed=5), ramp(sp["shag"])[2], clip=m, alpha=235)
        if sp.get("wool"):
            for j in range(7):
                a = j / 7 * 2 * math.pi
                (s, _) = rig.proj(math.cos(a) * rb * 0.55, by0 + math.sin(a) * L * 0.45, bz + rb * 0.55)
                cv.part(circle(s, rb * 0.55 * k, rb * 0.5 * k, wob=0.12, seed=j), sp["wool"], lw=0.7 * k, shade=0.25, hl=0.2)
        if sp.get("hump"):
            (s, _) = rig.proj(0, by0 + L * 0.3, bz + rb * 0.85)
            cv.part(circle(s, rb * 0.85 * k, rb * 0.7 * k, wob=0.08, seed=2), sp.get("shag", fur), lw=0.9 * k, shade=0.25, hl=0.15)
        if sp.get("bristle"):
            for j in range(6):
                (s, _) = rig.proj(0, by0 - L / 2 + j * L / 5, bz + rb * 0.95)
                cv.line([s, (s[0] - 0.6 * k, s[1] - 2.2 * k)], ramp(fur)[3], 0.8 * k)
    rig.add((fv_ + rv_) / 2, body)
    # head
    hx, hy, hz = sp["head"]; hy = hy + by0 - L * 0 + P["hdy"]; hz = hz * (1 - fl) * P["sq"] ** .5 + fl * (rb * 0.8) + P["hdz"] + z
    if fl: hy += 1.5
    hc3 = (hx, hy, hz); (hc, hv) = rig.proj(*hc3); hr = sp["hr"]
    # neck for tall animals
    if sp.get("neck") and fl < 1:
        (nb, nv) = rig.proj(0, by0 + L / 2 + 0.5, bz + rb * 0.4)
        rig.add((nv + hv) / 2 - 0.1, lambda nb=nb: cv.part(capsule_pts(nb[0], nb[1], hc[0], hc[1], rb * 0.6 * k, hr * 0.55 * k), fur, lw=0.9 * k, shade=0.24, hl=0.14))
    fwd = rig.nv(0, 1)
    sn3 = (0, hy + hr * 0.85, hz - hr * 0.3 - (0.4 if P["munch"] else 0)); (snp, snv) = rig.proj(*sn3)
    def ears(front_side):
        for side in (-1, 1):
            e = sp["ears"]; a = P["ear"]
            if e == "long":
                base = (side * 1.6, hy - 1.0, hz + hr * 0.7); tip = (side * (2.6 + a * 2), hy - 2.5 - a * 3, hz + hr * 0.7 + 5.8 - abs(a) * 2.5)
            elif e == "deer":
                base = (side * hr * 0.7, hy - 0.8, hz + hr * 0.5); tip = (side * (hr + 3.5 + a), hy - 1.5, hz + hr * 0.6 + 1.5 - a * 2)
            elif e == "round":
                base = (side * hr * 0.7, hy - 0.5, hz + hr * 0.6); tip = (side * hr * 0.8, hy - 0.6, hz + hr + 0.8)
            elif e == "tri_big":
                base = (side * hr * 0.55, hy - 0.5, hz + hr * 0.6); tip = (side * (hr * 0.75 + a * 1.5), hy - 1.0 - a * 2, hz + hr + 4.0 - abs(a) * 2)
            else:
                base = (side * hr * 0.6, hy - 0.5, hz + hr * 0.6); tip = (side * (hr * 0.9 + a), hy - 1.6, hz + hr + 1.8 - a)
            (bp, bv), (tp2, _) = rig.proj(*base), rig.proj(*tip)
            behind = bv < hv
            if behind != front_side:
                continue
            w0 = (1.6 if e in ("long", "deer") else 2.2 if e == "tri_big" else 1.6) * k
            if e == "round":
                cv.part(circle(tp2, 1.9 * k, 1.7 * k, wob=0.04), sp.get("face", fur), lw=0.8 * k, shade=0.25, hl=0.15)
                if fwd > -0.2: cv.fill(circle(tp2, 0.9 * k, 0.8 * k, wob=0), ramp(sp.get("muzzle", "hide"))[1])
            elif e in ("tri_big", "tri_small"):
                dx, dy = tp2[0] - bp[0], tp2[1] - bp[1]; n = math.hypot(dx, dy) or 1; px, py = -dy / n * w0, dx / n * w0
                pts = [(bp[0] + px, bp[1] + py), tp2, (bp[0] - px, bp[1] - py)]
                cv.part(pts, fur, lw=0.85 * k, shade=0.25, hl=0.15)
                if fwd > -0.2: cv.fill([(bp[0] + px * .45, bp[1] + py * .45), ((tp2[0] * 2 + bp[0]) / 3, (tp2[1] * 2 + bp[1]) / 3), (bp[0] - px * .45, bp[1] - py * .45)], ramp("flower_pink")[1], alpha=200)
            else:
                cv.part(capsule_pts(bp[0], bp[1], tp2[0], tp2[1], w0 * 0.8, w0 * 1.15), sp.get("face", fur), lw=0.85 * k, shade=0.25, hl=0.15)
                if fwd > -0.2: cv.part(capsule_pts(bp[0], bp[1] - 0.3 * k, tp2[0], tp2[1] + 0.3 * k, w0 * 0.35, w0 * 0.55), "flower_pink", outline=False, flat=True)
    def horns():
        hs = sp["horns"]
        for side in (-1, 1):
            if hs == "goat": pts3 = [(side * 1.4, hy - 0.4, hz + hr * 0.8), (side * 2.0, hy - 2.5, hz + hr + 2.8), (side * 2.4, hy - 5.0, hz + hr + 2.0)]
            elif hs == "bison": pts3 = [(side * hr * 0.8, hy - 0.3, hz + hr * 0.5), (side * (hr + 2.4), hy, hz + hr * 0.8), (side * (hr + 2.4), hy + 0.4, hz + hr + 2.2)]
            else: pts3 = [(side * hr * 0.6, hy - 0.4, hz + hr * 0.75), (side * (hr + 1.4), hy, hz + hr + 0.6), (side * (hr + 1.8), hy + 0.8, hz + hr + 2.4)]
            P2 = [rig.proj(*p)[0] for p in pts3]; c = ramp(sp.get("hornc", "cloth_cream"))
            cv.line(P2, c[3], (2.2 if hs != "goat" else 1.9) * k); cv.line(P2, c[1], (1.3 if hs != "goat" else 1.1) * k)
    def antlers():
        if sp.get("antlers") == "palm":   # moose: flat paddles
            for side in (-1, 1):
                (b, _) = rig.proj(side * 1.8, hy - 0.8, hz + hr * 0.8); (p, _) = rig.proj(side * (hr + 5.0), hy - 1.4, hz + hr + 3.2)
                cv.line([b, p], ramp("wood")[3], 1.6 * k)
                m2 = cv.part(circle(p, 4.6 * k, 2.6 * k, rot=-side * 0.35, wob=0.1, seed=side + 3), "cloth_cream", lw=0.8 * k, shade=0.28, hl=0.15)
                for j in range(4): cv.part(circle((p[0] + side * (j - 1.5) * 2.0 * k, p[1] - 2.4 * k + abs(j - 1.5) * 0.6 * k), 0.9 * k, 1.3 * k, wob=0), "cloth_cream", lw=0.5 * k, shade=0.3, hl=0.2)
            return
        big = sp.get("antlers") == "big"
        for side in (-1, 1):
            b = (side * 1.6, hy - 0.8, hz + hr * 0.85)
            g = 1.5 if big else 1.0
            pts3 = [b, (side * 3.0 * g, hy - 1.2, hz + hr + 4 * g), (side * 5.0 * g, hy - 1.8, hz + hr + 8 * g)]
            P2 = [rig.proj(*p)[0] for p in pts3]
            col = ramp("wood")
            for w, c in ((1.5, col[3]), (0.8, col[1])):
                cv.line(P2, c, w * k)
                tines = [((side * 3.0 * g, hy - 1.2, hz + hr + 4 * g), (side * 2.4 * g, hy + 0.6, hz + hr + 7.2 * g)), ((side * 4.2 * g, hy - 1.6, hz + hr + 6.5 * g), (side * 6.6 * g, hy - 1.0, hz + hr + 7.6 * g))]
                if big: tines.append(((side * 2.0, hy - 1.0, hz + hr + 2.4), (side * 1.6, hy + 1.6, hz + hr + 4.6)))
                for (p3a, p3b) in tines:
                    cv.line([rig.proj(*p3a)[0], rig.proj(*p3b)[0]], c, w * k)
    def head():
        if sp.get("antlers") and fwd < 0: antlers()
        if sp.get("horns") and fwd < 0: horns()
        ears(True)
        if sp.get("beard"):
            (bp, _) = rig.proj(0, hy + hr * 0.5, hz - hr * 1.0)
            cv.part([(bp[0] - 1.4 * k, bp[1] - 2 * k), (bp[0] + 1.4 * k, bp[1] - 2 * k), (bp[0], bp[1] + 2.8 * k)], sp["beard"], lw=0.6 * k, shade=0.3, hl=0.2)
        m = cv.part(circle(hc, hr * k, hr * 0.94 * k, wob=0.04), sp.get("face", fur), lw=0.95 * k, shade=0.22, hl=0.16)
        if sp.get("cheeks"):   # fluffy cheek tufts
            for side in (-1, 1):
                (cp, _) = rig.proj(side * hr * 0.95, hy - 0.5, hz - hr * 0.3)
                cv.part([(cp[0], cp[1] - 1.5 * k), (cp[0] + side * 2.2 * k, cp[1] + 0.5 * k), (cp[0], cp[1] + 1.6 * k)], fur, lw=0.6 * k, shade=0.25, hl=0.1)
        if fwd > -0.35:
            for side in (-1, 1):
                a = math.radians(side * 36); vis = rig.nv(math.sin(a), math.cos(a))
                if vis > 0.05:
                    p3 = (hx + hr * 0.92 * math.sin(a), hy + hr * 0.92 * math.cos(a), hz + hr * 0.22)
                    sz = sp["eye"] * (1.15 if (key == "animal_wolf" and side > 0) else 1.0) * max(0.55, vis)   # wolf: goofy mismatched eyes
                    _eye(cv, rig, k, p3, sz, P["eyes"])
                    (cp, _) = rig.proj(hx + hr * 1.0 * math.sin(a) * 1.05, hy + hr * 0.8 * math.cos(a), hz - hr * 0.35)
                    cv.fill(circle(cp, 1.1 * k, 0.6 * k, wob=0), ramp("flower_pink")[1], alpha=150, clip=m)
        ears(False)
        if sp.get("antlers") and fwd >= 0: antlers()
        if sp.get("horns") and fwd >= 0: horns()
    def snout():
        r = sp["snout"]
        if sp.get("pigsnout"):
            m = cv.part(circle(snp, r * k, r * 0.8 * k, wob=0.02), "flower_pink", lw=0.85 * k, shade=0.25, hl=0.2)
            if fwd > 0.1:
                for side in (-1, 1): cv.fill(circle((snp[0] + side * r * 0.35 * k, snp[1]), 0.5 * k, 0.75 * k, wob=0), ramp("flower_pink")[3])
            for side in (-1, 1):
                (tb, tvv) = rig.proj(side * r * 0.75, sn3[1] - 0.3, sn3[2] - r * 0.4); (tt, _) = rig.proj(side * r * 1.0, sn3[1] + 0.4, sn3[2] + r * 0.5)
                if rig.nv(side, 0.6) > -0.5: cv.part(capsule_pts(tb[0], tb[1], tt[0], tt[1], 0.85 * k, 0.4 * k), "cloth_cream", lw=0.55 * k, shade=0.25, hl=0.2)
            return
        m = cv.part(circle(snp, r * k, r * 0.78 * k, wob=0.02), sp.get("muzzle", belly), lw=0.85 * k, shade=0.22, hl=0.18)
        (np_, _) = rig.proj(0, sn3[1] + r * 0.75, sn3[2] + r * 0.35)
        if fwd > -0.1: cv.fill(circle(np_, (0.7 if sp.get("pinknose") else 1.0) * k, 0.75 * k, wob=0), ramp("flower_pink")[2] if sp.get("pinknose") else ramp("ink")[3])
        if sp.get("tongue") and fwd > 0.0 and P["eyes"] not in ("x",):
            (tg, _) = rig.proj(0.8, sn3[1] + r * 0.4, sn3[2] - r * 0.85 - P["munch"] * 0.4)
            cv.part(capsule_pts(tg[0], tg[1] - 0.8 * k, tg[0] + 0.3 * k, tg[1] + 1.6 * k, 0.9 * k, 1.1 * k), "flower_pink", lw=0.55 * k, shade=0.3, hl=0.25)
    rig.add(hv + 0.5, head)
    rig.add(snv + 0.5 + (0.1 if fwd > 0 else -1.2), snout)
    if anim == "eat":
        (gp, gv) = rig.proj(0, sn3[1] + 1.0, 0.3)
        def tuft():
            for j in (-1, 0, 1): cv.line([gp, (gp[0] + j * 1.4 * k, gp[1] - (2.6 - abs(j)) * k)], ramp("grass")[2 - (j == 0)], 0.9 * k)
        rig.add(gv + 0.6, tuft)
    if P["stars"]:
        def stars():
            for j, a in enumerate((fi * 0.9, fi * 0.9 + 2.1, fi * 0.9 + 4.2)):
                _star(cv, (hc[0] + math.cos(a) * hr * 1.2 * k, hc[1] - hr * 1.4 * k + math.sin(a) * 1.3 * k), 1.6, k)
        rig.add(99, stars)
    rig.draw(); return cv.final()

def chicken(key, d, anim, fi, k=1):
    W, H, feet = 32, 32, 28; cv = Canvas(W * k, H * k, seed=211 + fi * 3 + d * 17 + ord(anim[0])); rig = Rig(cv, DIR8_PHI[d], W * k / 2, feet * k, k)
    bob = 0; peck = 0; step = [0, 0]; flap = 0; eyes = "open"; back = 0; sq = 1; flat = 0; stars = False
    if anim == "idle": bob = [0, .3, .5, .3][fi]; eyes = "blink" if fi == 2 else "open"
    elif anim == "walk": t = fi / 6 * 2 * math.pi; bob = abs(math.sin(t)) * 0.8; step = [math.sin(t) * 1.8, -math.sin(t) * 1.8]; peck = -math.sin(2 * t) * 0.6
    elif anim == "run": t = fi / 6 * 2 * math.pi; bob = abs(math.sin(t)) * 1.6 + 0.5; step = [math.sin(t) * 2.6, -math.sin(t) * 2.6]; flap = 1 + math.sin(t * 2); peck = -1
    elif anim == "eat": peck = [0, 3.0, 4.5, 1.5][fi]; eyes = "happy" if fi == 2 else "open"
    elif anim == "attack":
        P["back"] = [1.6, -2.4][fi]; P["hdz"] = [0.6, -1.4][fi]; P["hdy"] = [-0.5, 2.2][fi]; P["sq"] = [0.92, 1.06][fi]; P["eyes"] = "squint"; P["ear"] = -0.5; P["munch"] = fi
        P["sw"] = [[-1, -1, 1, 1], [2.5, 2.5, -1.5, -1.5]][fi]
    elif anim == "hit": sq = [.8, 1.1][fi]; back = [1.5, .6][fi]; eyes = "squint"; flap = [2, 1][fi]
    elif anim == "death":
        back = [1.5, .8, .3, 0, 0][fi]; bob = [0, 2.5, .6, 0, 0][fi]; flap = [2, 2.5, 1, 0, 0][fi]; flat = [0, 0, .5, 1, 1][fi]; eyes = "squint" if fi < 2 else "x"; stars = fi >= 3; sq = [.85, 1.1, .9, .85, .85][fi]
    by = -back; bz = (6.5 * sq + bob) * (1 - flat) + 4.0 * flat
    for i, side in enumerate((-1, 1)):
        (f0, fv) = rig.proj(side * 1.8, by + step[i] * (1 - flat), bz - 3.5); (f1, _) = rig.proj(side * (1.8 + flat * 3), by + step[i] * (1 - flat) + 0.8, 0.4 + max(0, -step[i] * 0.3) * (anim == "run") + flat * 1.5)
        rig.add(fv - 1, lambda f0=f0, f1=f1: (cv.line([f0, f1], ramp("carrot")[2], 0.9 * k), cv.part(circle(f1, 1.5 * k, 0.7 * k), "carrot", lw=0.5 * k, shade=0.3, hl=0.2)))
    (bc, bv) = rig.proj(0, by, bz)
    def body():
        cv.part(circle(bc, 6.4 * k, 5.6 * sq * k, wob=0.06, seed=3), "snow", lw=0.95 * k, shade=0.25, hl=0.18)
        for side in (-1, 1):
            (wp, wv) = rig.proj(side * 5.2, by - 0.5, bz + 0.5 + flap)
            if abs(rig.nv(side, 0)) < 0.98: cv.part(circle(wp, 2.2 * k, (3.2 - flap * 0.5) * k, rot=side * (0.4 + flap * 0.4)), "snow", lw=0.7 * k, shade=0.3, hl=0.15, base_col=ramp("snow")[2])
        (tp, _) = rig.proj(0, by - 5.6, bz + 2.5)
        if rig.nv(0, 1) < 0.7:
            for j in (-1, 0, 1): cv.part([(tp[0] + (j * 1.4 - 1.2) * k, tp[1] + 1.2 * k), (tp[0] + j * 2.0 * k, tp[1] - 3.6 * k), (tp[0] + (j * 1.4 + 1.2) * k, tp[1] + 1.2 * k)], "snow", lw=0.6 * k, shade=0.3, hl=0.2)
    rig.add(bv, body)
    hz = (bz + 5.8 - peck) * (1 - flat) + flat * 4.5; hy = by + 3.0 + max(peck, 0) * 0.8 + flat * 2.5
    (hc, hv) = rig.proj(0, hy, hz); fwd = rig.nv(0, 1)
    def head():
        (cb, _) = rig.proj(0, hy - 0.5, hz + 3.4)
        if fwd < 0: cv.part(circle(cb, 2.6 * k, 1.8 * k, wob=0.2, seed=5), "berry", lw=0.6 * k, shade=0.25, hl=0.25)
        m = cv.part(circle(hc, 4.0 * k, 3.8 * k, wob=0.04), "snow", lw=0.95 * k, shade=0.22, hl=0.18)
        if fwd >= 0:
            for j in (-1, 0, 1):
                (cj, _) = rig.proj(j * 0.2, hy + 0.4 + j * 1.2, hz + 3.6 - abs(j) * 0.5)
                cv.part(circle(cj, 1.5 * k, 1.5 * k, wob=0), "berry", lw=0.55 * k, shade=0.25, hl=0.25)
        if fwd > -0.35:
            for side in (-1, 1):
                a = math.radians(side * 38); vis = rig.nv(math.sin(a), math.cos(a))
                if vis > 0.05: _eye(cv, rig, k, (3.9 * math.sin(a), hy + 3.9 * math.cos(a), hz + 0.8), max(0.55, vis), eyes)
        if fwd > -0.3:
            (bp, _) = rig.proj(0, hy + 4.4, hz - 0.4); (wt, _) = rig.proj(0, hy + 3.6, hz - 2.2)
            cv.part(circle(wt, 0.9 * k, 1.4 * k, wob=0), "berry", lw=0.5 * k, shade=0.3, hl=0.2)
            cv.part([(bp[0] - 1.4 * k, bp[1] - 0.6 * k), (bp[0] + 1.4 * k, bp[1] - 0.6 * k), (bp[0], bp[1] + 1.6 * k)], "chick", lw=0.5 * k, shade=0.3, hl=0.2)
    rig.add(hv + 0.5, head)
    if anim == "eat" and fi in (1, 2):
        (gp, gv) = rig.proj(0, hy + 4.0, 0.3)
        rig.add(gv + 0.6, lambda: [cv.fill(circle((gp[0] + j * 1.5 * k, gp[1] - abs(j) * 0.4 * k), 0.6 * k, 0.45 * k, wob=0), ramp("gold")[2]) for j in (-1, 0, 1)])
    if stars:
        rig.add(99, lambda: [_star(cv, (hc[0] + math.cos(a) * 5 * k, hc[1] - 5.5 * k + math.sin(a) * 1.2 * k), 1.5, k) for a in (fi, fi + 2.1, fi + 4.2)])
    rig.draw(); return cv.final()

