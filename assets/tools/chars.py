"""Chibi survivors + goofy zombies: a tiny 3D rig projected into 2D toon parts. 8 iso directions baked."""
import math, numpy as np
from PIL import Image, ImageChops, ImageDraw
from toon import Canvas, ellipse_pts, capsule_pts, SS, lerp, outline_col
from palette import ramp, hex2rgb, RAMPS

ELEV = 0.42   # how much "toward viewer" depth shifts down on screen
# engine dir index -> screen facing phi (deg): 0 = facing camera, +90 = facing screen right
DIR_PHI = [45, 0, -45, -90, -135, 180, 135, 90]

class Rig:
    def __init__(self, cv, phi_deg, ox, oy, scale=1.0):
        self.cv = cv; self.p = math.radians(phi_deg); self.ox, self.oy, self.s = ox, oy, scale
        self.items = []
    def proj(self, x, y, z):
        c, s = math.cos(self.p), math.sin(self.p); s_ = self.s
        X = (-x * c + y * s) * s_; V = (x * s + y * c) * s_
        return (self.ox + X, self.oy - z * s_ + V * ELEV), V
    def nv(self, x, y):  # view-facing component of a local horizontal direction
        return x * math.sin(self.p) + y * math.cos(self.p)
    def add(self, depth, fn): self.items.append((depth, len(self.items), fn))
    def draw(self):
        for _, _, fn in sorted(self.items, key=lambda t: (t[0], t[1])): fn()

def circle(c, r, ry=None, rot=0, wob=0.03, seed=0): return ellipse_pts(c[0], c[1], r, ry or r, rot, wob=wob, seed=seed)

# ------------------------------------------------------------------ outfit specs
PLAYERS = {
  "player":   dict(skin="skin_light", hair="hair_brown", top="cloth_red", bottom="cloth_denim", shoe="leather",
                   pack="leather", roll="cloth_green", hat="sprout", scarf="cloth_yellow"),
  "player_b": dict(skin="skin_tan", hair="hair_pink", top="cloth_teal", bottom="cloth_cream", shoe="wood_dark",
                   pack="wood", roll="cloth_red", hat="straw", scarf=None),
  "player_c": dict(skin="skin_deep", hair="hair_black", top="cloth_yellow", bottom="cloth_green", shoe="leather",
                   pack="cloth_denim", roll="cloth_cream", hat="beanie", scarf="cloth_purple"),
}
ZOMBIES = {
  "zombie_walker": dict(skin="zomb_mint", top="cloth_purple", bottom="wood_dark", shoe="leather", hat="floppy",
                        hatc="cloth_denim", body=1.0, head=1.0, lean=0.0, belly=1.0, frame=(48, 64), feet=59, scale=0.98),
  "zombie_brute":  dict(skin="zomb_teal", top="cloth_cream", bottom="cloth_denim", shoe="wood_dark", hat="bandage",
                        hatc="cloth_cream", body=1.45, head=0.92, lean=0.0, belly=1.6, frame=(64, 80), feet=74, scale=1.12),
  "zombie_runner": dict(skin="zomb_lilac", top="cloth_yellow", bottom="cloth_denim", shoe="leather", hat="hood",
                        hatc="cloth_yellow", body=0.8, head=1.05, lean=4.0, belly=0.8, frame=(48, 64), feet=59, scale=0.86),
  # wave 2
  "zombie_mummy":  dict(skin="zomb_lilac", top="cloth_cream", bottom="cloth_cream", shoe="cloth_cream", hat="mummy", wrap=True,
                        hatc="cloth_cream", body=0.95, head=1.0, lean=1.0, belly=1.0, frame=(48, 64), feet=59, scale=0.96),
  "zombie_pumpkin":dict(skin="zomb_mint", top="cloth_green", bottom="cloth_denim", shoe="wood_dark", hat="pumpkin",
                        hatc="pumpkin", body=1.05, head=1.08, lean=0.0, belly=1.15, frame=(48, 64), feet=59, scale=0.98),
}
# per-frame metadata collected while drawing (hand anchor for held equipment, glowing eye spots for emissive pages)
META = {"hand": None, "eyes": [], "glow": []}

def tool_part(cv, rig, hand3, dir3, kind="axe", depth=0.0):
    """Draw a held tool from hand along dir3 (local)."""
    hx, hy, hz = hand3; dx, dy, dz = dir3; L = 13
    a, _ = rig.proj(hx - dx * 3, hy - dy * 3, hz - dz * 3); b, _ = rig.proj(hx + dx * L, hy + dy * L, hz + dz * L)
    def f():
        cv.part(capsule_pts(a[0], a[1], b[0], b[1], 1.3), "wood", lw=0.9, shade=0.3, hl=0.2)
        ang = math.atan2(b[1] - a[1], b[0] - a[0]); px, py = -math.sin(ang), math.cos(ang)
        if kind == "axe":
            hp = [(b[0] + px * 1, b[1] + py * 1), (b[0] + px * 6 - math.cos(ang) * 3, b[1] + py * 6 - math.sin(ang) * 3),
                  (b[0] + px * 6 + math.cos(ang) * 2, b[1] + py * 6 + math.sin(ang) * 2), (b[0] - px * 1 + math.cos(ang), b[1] - py + math.sin(ang))]
            cv.part(hp, "stone", lw=0.9, shade=0.3, hl=0.25)
            cv.line([(b[0] - math.cos(ang) * 1.5, b[1] - math.sin(ang) * 1.5), (b[0] + math.cos(ang) * 1.5, b[1] + math.sin(ang) * 1.5)], hex2rgb(RAMPS["cloth_cream"][2]), 1.0)
    rig.add(depth, f)

BAKE_TOOL = False   # wave 2: tools are separate held-equipment sprites attached at META["hand"]

SWIM_Z = 17.0   # world z of the swim waterline (chest); swim_merge_main.py sinks frames so it sits at the feet pivot

def build_figure(cv, phi, spec, anim, fi, nframes, zombie=False, ox=24, oy=59, scale=1.0):
    rig = Rig(cv, phi, ox, oy, scale)
    sk, top, bot = spec["skin"], spec["top"], spec["bottom"]
    bodyk = spec.get("body", 1.0); headk = spec.get("head", 1.0); belly = spec.get("belly", 1.0); lean = spec.get("lean", 0.0)
    t = fi / nframes; ph = 2 * math.pi * t
    bob = 0.0; legs = [(0, 0), (0, 0)]; arms = None; crouch = 0.0; tilt = 0.0; back = 0.0; blink = False; tool = None
    hr = 11.5 * headk; hz = 37 + (bodyk - 1) * 6
    # ---- animation curves
    if anim == "idle":
        bob = [0, 0.5, 1.0, 0.5][fi % 4]; blink = fi == 3 and not zombie
        if zombie: tilt = [0, 1, 2, 1][fi % 4]
    elif anim == "walk":
        bob = abs(math.sin(ph)) * 1.4 - 0.4
        sw = 4.0 if not zombie else 3.0
        legs = [(math.sin(ph) * sw, max(0, math.cos(ph)) * 3.4), (-math.sin(ph) * sw, max(0, -math.cos(ph)) * 3.4)]
        if zombie: tilt = math.sin(ph) * 2.0
    elif anim == "run":
        bob = abs(math.sin(ph)) * 2.4 - 0.8
        sw = 6.2 if not zombie else 5.2
        legs = [(math.sin(ph) * sw, max(0, math.cos(ph)) * 5.2), (-math.sin(ph) * sw, max(0, -math.cos(ph)) * 5.2)]
        lean = lean + 2.6
        if zombie: tilt = math.sin(ph) * 3.2
    elif anim == "crawl":
        crouch = 12.5 - abs(math.sin(ph)) * 0.8; lean = lean + 6.0; tilt = math.sin(ph) * 1.5
        legs = [(-9 + math.sin(ph) * 1.6, max(0, math.sin(ph)) * 1.0 - 0.8), (-9 - math.sin(ph) * 1.6, max(0, -math.sin(ph)) * 1.0 - 0.8)]
    elif anim == "feed":
        crouch = 6.5 + [0, 0.6, 0, 0.6][fi % 4]; lean = lean + 2.5; tilt = [1, -1, 1.5, -0.5][fi % 4]
    elif anim == "attack":
        crouch = [0, -1, 2, 0.5][fi % 4]
    elif anim == "swim":     # ADR-107: paddle/flail in place; legs kick below the waterline (cleared by swim_merge_main.py)
        bob = math.sin(ph) * 0.6; lean = lean + 1.2; sw = 2.0
        legs = [(math.sin(ph) * sw, 1.5 + math.cos(ph)), (-math.sin(ph) * sw, 1.5 - math.cos(ph))]
        if zombie: tilt = math.sin(ph) * 1.5
    elif anim == "punch":    # ADR-107: guard, wind-up, right jab, recover
        crouch = [0, 0.4, 0.2, 0][fi % 4]; lean = lean + [0.5, -0.4, 2.6, 1.0][fi % 4]
    elif anim == "gather":
        crouch = [2, 3.5, 3.0, 3.5][fi % 4]
    elif anim == "hurt":
        back = [-3, -1.5][fi % 2]; tilt = [-3, -1.5][fi % 2]; crouch = [1, 0.5][fi % 2]
    elif anim == "death":
        crouch = [1, 0, 4, 9][min(fi, 3)]; tilt = [4, -6, 10, 16][min(fi, 3)]
    by = bob - crouch
    bz = 19 * (0.9 + 0.1 * bodyk) + by
    hzz = hz + by
    hy = lean + back * 0.6
    if anim == "crawl": hy = lean + 3.0; hzz = 14 + by * 0.15
    if anim == "feed": hzz = hz + by * 0.9 - [0, 1.2, 0, 1.2][fi % 4]
    # head center (local), with zombie droop sideways
    hc3 = (tilt * 0.5, hy, hzz)
    # ---- shadow
    sh_r = 10 * max(1, bodyk * 0.95) * scale
    if spec.get('_shadow'): cv.shadow(ox, oy + 0.5, sh_r, sh_r * 0.45)
    R = lambda name: ramp(name)
    # ---- legs
    hipw = 3.6 * bodyk
    for i, side in enumerate((-1, 1)):
        fwd, lift = legs[i]
        hip = (side * hipw, back * 0.3, 11 + by * 0.5); foot = (side * hipw * 1.05, fwd + back * 0.2, 2.2 + lift)
        (a, va) = rig.proj(*hip); (b, vb) = rig.proj(*foot)
        def leg(a=a, b=b, foot=foot):
            cv.part(capsule_pts(a[0], a[1], b[0], b[1], 3.0 * min(1.25, bodyk), 2.6), bot, lw=1.0, shade=0.3, hl=0.15)
            f2, _ = rig.proj(foot[0], foot[1] + 1.2, foot[2] - 1.0)
            cv.part(circle(f2, 3.4 * min(1.2, bodyk), 2.3), spec["shoe"], lw=1.0, shade=0.35, hl=0.25)
        rig.add((va + vb) / 2 - 2, leg)
    # ---- torso
    tc = (tilt * 0.25, back * 0.4 + lean * 0.4, bz)
    (tp, tv) = rig.proj(*tc)
    trx, try_ = 8.2 * bodyk * (belly ** 0.35), 8.6 * bodyk
    def torso():
        m = cv.part(circle(tp, trx, try_, wob=0.04, seed=3), top, lw=1.05, shade=0.22, hl=0.12)
        # belt / hem line + details
        r = R(top)
        if not zombie:
            hem, _ = rig.proj(tc[0], tc[1], bz - try_ * 0.55)
            cv.fill(circle((hem[0], hem[1] + 3.0), trx * 1.1, 3.2), r[2], clip=m)
            cv.line([(hem[0] - trx, hem[1]), (hem[0] + trx, hem[1])], r[3], 0.7, clip=m)
            # pocket / zipper on front
            if rig.nv(0, 1) > 0.2:
                zp, _ = rig.proj(0, 7, bz + 3); zp2, _ = rig.proj(0, 7.5, bz - 4)
                cv.line([zp, zp2], r[3], 0.6, clip=m, alpha=170)
        else:
            # torn hem zigzag + patch + stitches
            hem, _ = rig.proj(tc[0], tc[1], bz - try_ * 0.6)
            zig = [(hem[0] - trx * 1.2, hem[1] + 4)] + [(hem[0] - trx + k * trx / 3, hem[1] + (1.8 if k % 2 else -1.0)) for k in range(7)] + [(hem[0] + trx * 1.2, hem[1] + 4)]
            cv.fill(zig, (0, 0, 0), clip=m) if False else None
            cv.fill(zig + [(hem[0] + trx * 1.2, hem[1] + 9), (hem[0] - trx * 1.2, hem[1] + 9)], R(sk)[1], clip=m)
            if rig.nv(0, 1) > -0.3:
                pp, _ = rig.proj(-2.5 * bodyk, 6 * bodyk, bz + 1.5)
                patch = [(pp[0] - 2.5, pp[1] - 2.2), (pp[0] + 2.6, pp[1] - 2.6), (pp[0] + 2.2, pp[1] + 2.3), (pp[0] - 2.4, pp[1] + 2.0)]
                cv.part(patch, "cloth_green" if top != "cloth_green" else "cloth_red", lw=0.6, shade=0.3, hl=0.0, clip=m)
                for k in range(3):
                    sx = pp[0] - 2 + k * 2
                    cv.line([(sx, pp[1] - 3.2), (sx + 0.6, pp[1] - 1.8)], R("ink")[1], 0.5)
            if spec.get("wrap"):
                rr = R("cloth_cream")
                for k in range(6):
                    yy = tp[1] - try_ + 2.5 + k * 3.0
                    cv.line([(tp[0] - trx - 1, yy + 1.5 + (k % 2)), (tp[0] + trx + 1, yy - 1.0)], rr[2], 0.5, clip=m)
                    cv.line([(tp[0] - trx - 1, yy + 0.8 + (k % 2)), (tp[0] + trx + 1, yy - 1.7)], rr[0], 0.4, clip=m, alpha=200)
                if rig.nv(0, 1) > -0.3:   # little peeking skin + stitch heart patch
                    pp, _ = rig.proj(2.5 * bodyk, 6 * bodyk, bz + 1.0)
                    cv.fill(circle(pp, 1.8, 1.4), R(sk)[1], clip=m)
                    cv.part(circle((pp[0] - 4.5, pp[1] + 3.5), 1.6, 1.4), "flower_pink", lw=0.5, shade=0.2, hl=0.2, clip=m)
            if belly > 1.2 and rig.nv(0, 1) > -0.2:   # overalls bib + straps for brute
                bp, _ = rig.proj(0, 6, bz - 1)
                bib = [(bp[0] - 6, bp[1] - 5), (bp[0] + 6, bp[1] - 5), (bp[0] + 8, bp[1] + 10), (bp[0] - 8, bp[1] + 10)]
                cv.part(bib, bot, lw=0.8, shade=0.25, hl=0.1, clip=m)
                for sx in (-5, 5):
                    cv.line([(bp[0] + sx, bp[1] - 5), (bp[0] + sx * 1.3, bp[1] - 12)], R(bot)[2], 1.6, clip=m)
                    cv.fill(circle((bp[0] + sx, bp[1] - 4.5), 1.0), R("gold")[1])
                # belly button + stitches
                cv.line([(bp[0] - 3, bp[1] + 3), (bp[0] + 3, bp[1] + 4)], R(bot)[3], 0.6, clip=m)
    rig.add(tv, torso)
    # ---- backpack (players)
    if not zombie:
        (pc, pv) = rig.proj(0, -7.0 + back * 0.4, bz + 2)
        def pack():
            cv.part(circle(pc, 6.6, 7.2, wob=0.05, seed=5), spec["pack"], lw=1.0, shade=0.25, hl=0.15)
            (rc, _) = rig.proj(0, -7.0, bz + 9.5)
            rx = 7.5 * abs(math.cos(rig.p)) + 3.0
            cv.part(capsule_pts(rc[0] - rx, rc[1], rc[0] + rx, rc[1], 2.8), spec["roll"], lw=0.9, shade=0.3, hl=0.2)
            cv.line([(rc[0] - rx * 0.4, rc[1] - 2.6), (rc[0] - rx * 0.4, rc[1] + 2.6)], R("leather")[2], 0.8)
            cv.line([(rc[0] + rx * 0.4, rc[1] - 2.6), (rc[0] + rx * 0.4, rc[1] + 2.6)], R("leather")[2], 0.8)
            # flap
            (fc, _) = rig.proj(0, -7.0, bz + 4)
            cv.fill(circle((fc[0], fc[1] - 0.5), 5.0, 2.6), R(spec["pack"])[2])
            cv.fill(circle((fc[0], fc[1] + 1.8), 1.0), R("gold")[1])
        rig.add(pv, pack)
        # scarf
        if spec.get("scarf"):
            (sc, sv) = rig.proj(0, back * 0.4 + 0.5, bz + 6.8)
            rig.add(sv + 0.6, lambda sc=sc: cv.part(circle(sc, 7.6, 2.6, wob=0.06, seed=9), spec["scarf"], lw=0.9, shade=0.3, hl=0.2))
            (tl, tv2) = rig.proj(3.5, 2.5, bz + 3.5)
            rig.add(tv2 + 0.8 if rig.nv(1, 1) > 0 else sv - 1, lambda tl=tl: cv.part(capsule_pts(tl[0], tl[1] - 2, tl[0] + 0.6, tl[1] + 3, 1.6), spec["scarf"], lw=0.8, shade=0.3, hl=0.15))
    # ---- arms
    shw = 8.2 * bodyk * (belly ** 0.3)
    hands = {}
    for side in (-1, 1):
        sh3 = (side * shw, back * 0.4 + lean * 0.5, bz + 5.5 * bodyk)
        if anim == "walk":
            sw = -legs[0 if side < 0 else 1][0]
            hand3 = (side * (shw + 1.5), sw * 0.8, bz - 3)
            if zombie: hand3 = (side * (shw - 2.5), 11 + math.sin(ph + side) * 1.5, bz + 3 + math.cos(ph) * 1.2)
        elif anim == "run":
            sw = -legs[0 if side < 0 else 1][0]
            if zombie: hand3 = (side * (shw - 2.0), 12 + math.sin(ph + side * 1.3) * 2.5, bz + 7 + math.cos(ph * 2 + side) * 2.2)
            else: hand3 = (side * (shw + 0.5), sw * 1.1, bz - 1.0 + abs(sw) * 0.5)
        elif anim == "crawl":
            hand3 = (side * (shw - 0.5), 9 + side * math.sin(ph) * 3.2, 1.8 + max(0, side * math.cos(ph)) * 3.0)
        elif anim == "feed":
            chew = [0, 1.5, 0.3, 1.8][fi % 4]
            hand3 = (side * 3.2, 8.5, bz + 5.5 + chew * (1 if side > 0 else 0.6))
        elif anim == "attack":
            if zombie:
                k = fi % 4; reach = [6, 2, 14, 10][k]; up = [3, 8, 0, 1][k]
                hand3 = (side * (shw - 3), reach, bz + up)
            elif side == 1:
                hand3 = [(shw - 1, -5, bz + 15), (shw - 2, 6, bz + 15), (shw - 3, 11, bz - 2), (shw, 5, bz - 1)][fi % 4]
            else:
                hand3 = (side * (shw + 0.5), 3, bz - 1)
        elif anim == "swim":
            if zombie: hand3 = (side * (shw - 2.0), 11 + math.sin(ph + side * 1.3) * 2.5, SWIM_Z + 3 + math.cos(ph * 2 + side) * 2.0)
            else:
                a_ = ph + (0 if side > 0 else math.pi); hand3 = (side * (shw + 0.8), 6.0 + math.sin(a_) * 3.5, SWIM_Z + 2.0 + bob + math.cos(a_) * 2.6)
        elif anim == "punch":
            if side == 1: hand3 = [(shw - 2.5, 5, bz + 7), (shw - 1, 1, bz + 7.5), (shw - 3.5, 14, bz + 7), (shw - 2, 8, bz + 6.5)][fi % 4]
            else: hand3 = (side * (shw - 2.5), 6, bz + 7.5)
        elif anim == "gather":
            k = fi % 4; up = [0, 2.5, 0, 2.5][k] if side > 0 else [2.5, 0, 2.5, 0][k]
            hand3 = (side * 4.5, 9, bz - 7 + up)
        elif anim in ("hurt", "death"):
            hand3 = (side * (shw + 4), -2, bz + 6 + (fi % 2))
        else:  # idle
            if zombie: hand3 = (side * (shw - 2.5), 10, bz + 3 + [0, 0.6, 1, 0.6][fi % 4])
            else: hand3 = (side * (shw + 1.2), 0.5, bz - 3.5 + bob * 0.3)
        hands[side] = hand3
        (a, va) = rig.proj(*sh3); (b, vb) = rig.proj(*hand3)
        def arm(a=a, b=b):
            cv.part(capsule_pts(a[0], a[1], b[0], b[1], 2.7 * min(1.3, bodyk), 2.3), top, lw=1.0, shade=0.3, hl=0.15)
            cv.part(circle(b, 2.9 * min(1.3, bodyk)), sk, lw=1.0, shade=0.3, hl=0.2)
        rig.add(max(va, vb) - 0.5 + (0.3 if side == 1 else 0), arm)
    if not zombie:
        # held-equipment anchor (right hand): screen pos (1x px), tool direction angle (deg, 0 = up, clockwise), draw order
        h = hands[1]; k = fi % 4
        if anim == "attack": d = [(0.1, -0.6, 0.8), (0.0, 0.7, 0.7), (0.0, 0.6, -0.8), (0.1, 0.9, -0.2)][k]
        elif anim == "punch": d = (0.0, 0.95, 0.3)
        elif anim == "gather": d = (0.0, 0.85, [-0.5, -0.2, -0.5, -0.2][k])
        elif anim == "run": d = (0.15, -0.45, 0.85)
        elif anim == "walk": d = (0.15, 0.3 + 0.08 * math.sin(ph), 0.92)
        elif anim in ("hurt", "death"): d = (0.4, -0.3, 0.85)
        else: d = (0.15, 0.35, 0.92)
        n = math.sqrt(sum(v * v for v in d)); d = tuple(v / n for v in d)
        (a2, _), (b2, _) = rig.proj(*h), rig.proj(h[0] + d[0] * 10, h[1] + d[1] * 10, h[2] + d[2] * 10)
        ang = math.degrees(math.atan2(b2[0] - a2[0], -(b2[1] - a2[1])))
        META["hand"] = {"x": round(a2[0], 2), "y": round(a2[1], 2), "angle": round(ang, 1),
                        "len": round(math.hypot(b2[0] - a2[0], b2[1] - a2[1]) / 10, 3), "behind": bool(rig.nv(1, 0) <= -0.2)}
        if BAKE_TOOL and anim == "attack":
            _, vh = rig.proj(*h); tool_part(cv, rig, h, d, "axe", depth=vh + (0.4 if rig.nv(1, 0) > -0.2 else -3))
    if zombie and anim == "feed" and rig.nv(0, 1) > -0.4:
        cp, cvv = rig.proj(0, 9.5, bz + 6.5 + [0, 1.2, 0.2, 1.5][fi % 4])
        def carrot(cp=cp):
            bite = fi % 2
            cv.part(capsule_pts(cp[0] - 4.5, cp[1] + 1, cp[0] + 3.5 - bite * 1.5, cp[1] - 1.5, 2.2, 0.9), "carrot", lw=0.8, shade=0.3, hl=0.25)
            for j in range(3): cv.line([(cp[0] - 4.5, cp[1] + 1), (cp[0] - 7.5 + j * 0.8, cp[1] - 2.5 + j * 1.6)], ramp("leaf")[2], 0.9)
            for j in range(2): cv.line([(cp[0] - 2 + j * 2.5, cp[1] - 0.6 + j * 0.2), (cp[0] - 1.2 + j * 2.5, cp[1] + 0.6)], ramp("carrot")[3], 0.4)
            if bite: 
                for j in range(3): cv.fill(circle((cp[0] + 4 + j * 2.2, cp[1] + 3 + (j % 2) * 2), 0.7), ramp("carrot")[1])
        rig.add(cvv + 2.5, carrot)
    # ---- head
    (hp, hv) = rig.proj(*hc3)
    face_v = rig.nv(0, 1)
    def head():
        rot = math.radians(tilt * 2.5)
        hm = cv.part(circle(hp, hr, hr * 0.96, rot=rot, wob=0.025, seed=11), sk, lw=1.15, shade=0.2, hl=0.12)
        skr = R(sk)
        # ears (players) / side bumps
        for side in (-1, 1):
            if abs(rig.nv(side, 0)) < 0.95:
                pass
        # hair / hat / face
        if not zombie:
            hair_cap(cv, rig, hc3, hr, spec, hm)
        if spec.get("hat") == "pumpkin": pumpkin_head(cv, rig, hc3, hr, spec, anim, fi, rot)
        else: face(cv, rig, hc3, hr, spec, zombie, blink, anim, fi, rot, hm)
        if zombie: zombie_hat(cv, rig, hc3, hr, spec, rot, hm)
        else: hat(cv, rig, hc3, hr, spec)
    rig.add(hv + 1.5, head)
    rig.draw()
    return rig

def sph(rig, c3, r, az, el):
    """point on head sphere at azimuth az (deg, 0=forward, +=character right) and elevation el (deg)."""
    a, e = math.radians(az), math.radians(el)
    x = c3[0] + r * math.sin(a) * math.cos(e); y = c3[1] + r * math.cos(a) * math.cos(e); z = c3[2] + r * math.sin(e)
    p, _ = rig.proj(x, y, z)
    vis = rig.nv(math.sin(a) * math.cos(e), math.cos(a) * math.cos(e))
    return p, vis

def hair_cap(cv, rig, c3, hr, spec, hm):
    hc, _ = rig.proj(c3[0], c3[1] - 0.8, c3[2] + 1.6)
    capm = cv.mask_from(circle(hc, hr * 1.1, hr * 1.05, wob=0.06, seed=21))
    fv = rig.nv(0, 1)
    if fv > -0.35:
        fc, _ = sph(rig, c3, hr * 0.55, 0, -12)
        hole = cv.mask_from(circle(fc, hr * 0.98, hr * 0.84))
        # bangs scallops
        bangs = []
        for k, az in enumerate((-42, -14, 14, 42)):
            bp, v = sph(rig, c3, hr * 1.0, az, 30 + (k % 2) * 5)
            if v > -0.2: bangs.append(circle(bp, hr * 0.32, hr * 0.28))
        if bangs: hole = ImageChops.subtract(hole, cv.mask_from(bangs))
        capm = ImageChops.subtract(capm, hole)
        # keep sideburn locks at the cheeks
    cv.part(None, spec["hair"], mask=capm, lw=1.1, shade=0.2, hl=0.14)
    # strand lines
    r = ramp(spec["hair"])
    for az in (-30, 0, 30):
        a, va = sph(rig, c3, hr * 1.05, az + 180 if fv < -0.35 else az, 55)
        b, vb = sph(rig, c3, hr * 1.05, az + 180 if fv < -0.35 else az, 30)
        if va > -0.6: cv.line([a, b], r[2], 0.6, clip=capm, alpha=200)

def hat(cv, rig, c3, hr, spec):
    kind = spec.get("hat")
    top, _ = rig.proj(c3[0], c3[1], c3[2] + hr * 0.95)
    if kind == "sprout":
        st, _ = rig.proj(c3[0], c3[1] - 1, c3[2] + hr * 1.05)
        cv.line([st, (st[0] + 0.5, st[1] - 4.5)], ramp("leaf")[3], 1.1)
        cv.part(circle((st[0] - 3.2, st[1] - 5.2), 3.2, 1.7, rot=0.5), "leaf", lw=0.8, shade=0.3, hl=0.25)
        cv.part(circle((st[0] + 3.6, st[1] - 6.0), 3.4, 1.8, rot=-0.45), "leaf", lw=0.8, shade=0.3, hl=0.25)
    elif kind == "straw":
        bc, _ = rig.proj(c3[0], c3[1], c3[2] + hr * 0.55)
        cv.part(circle(bc, hr * 1.55, hr * 0.5, wob=0.05, seed=31), "thatch", lw=1.0, shade=0.3, hl=0.15)
        cc, _ = rig.proj(c3[0], c3[1], c3[2] + hr * 0.85)
        m = cv.part(circle(cc, hr * 0.85, hr * 0.62), "thatch", lw=1.0, shade=0.25, hl=0.2)
        cv.fill(circle((cc[0], cc[1] + hr * 0.42), hr * 0.9, 1.6), ramp("cloth_red")[1], clip=m)
        for k in range(-3, 4):
            cv.line([(bc[0] + k * hr * 0.4, bc[1] - 1.5), (bc[0] + k * hr * 0.45, bc[1] + 2)], ramp("thatch")[2], 0.5, alpha=150)
    elif kind == "beanie":
        cc, _ = rig.proj(c3[0], c3[1] - 0.5, c3[2] + hr * 0.62)
        m = cv.mask_from(circle(cc, hr * 1.06, hr * 0.92, wob=0.04, seed=41))
        cut = cv.mask_from([(cc[0] - 30, cc[1] + hr * 0.2), (cc[0] + 30, cc[1] + hr * 0.2), (cc[0] + 30, cc[1] + 30), (cc[0] - 30, cc[1] + 30)])
        m = ImageChops.subtract(m, cut)
        cv.part(None, spec["scarf"], mask=m, lw=1.0, shade=0.22, hl=0.15)
        band, _ = rig.proj(c3[0], c3[1] - 0.5, c3[2] + hr * 0.42)
        cv.part(capsule_pts(band[0] - hr * 1.0, band[1], band[0] + hr * 1.0, band[1], 2.4), spec["scarf"], lw=0.9, shade=0.35, hl=0.2,
                base_col=ramp(spec["scarf"])[2], shade_col=ramp(spec["scarf"])[3], hl_col=ramp(spec["scarf"])[1])
        cv.part(circle((cc[0] + 1, cc[1] - hr * 0.9), 3.2, wob=0.15, seed=4), "cloth_cream", lw=0.9, shade=0.3, hl=0.2)

def zombie_hat(cv, rig, c3, hr, spec, rot, hm=None):
    kind = spec.get("hat"); hcol = spec["hatc"]
    if kind == "mummy":
        r = ramp("cloth_cream")
        for k, (el, tw) in enumerate([(62, 2.4), (44, 2.6), (24, 2.2), (-26, 2.3), (-50, 2.6)]):
            pts = []
            for az in range(-180, 181, 15):
                p, v = sph(rig, c3, hr * 1.04, az, el + 6 * math.sin(math.radians(az) * 2 + k))
                if v > -0.05: pts.append(p)
            if len(pts) >= 2:
                cv.line(pts, r[1], tw, clip=hm); cv.line([(x, y - tw * 0.35) for x, y in pts], r[0], tw * 0.35, clip=hm, alpha=200)
                cv.line([(x, y + tw * 0.5) for x, y in pts], r[2], 0.45, clip=hm, alpha=200)
        # dangling bandage end
        e, v = sph(rig, c3, hr * 1.0, 70, 30)
        if v > -0.3: cv.part(capsule_pts(e[0], e[1], e[0] + 4, e[1] + 7, 1.4, 1.0), "cloth_cream", lw=0.7, shade=0.3, hl=0.2)
        return
    if kind == "pumpkin": return
    if kind == "floppy":
        cc, _ = rig.proj(c3[0] + 1, c3[1] - 1.5, c3[2] + hr * 0.92)
        cv.part(circle((cc[0] + 1.5, cc[1] + 2.4), hr * 1.2, hr * 0.36, rot=0.18 + rot, wob=0.08, seed=51), hcol, lw=1.0, shade=0.3, hl=0.15)
        m = cv.part(circle((cc[0], cc[1] - 1.2), hr * 0.75, hr * 0.55, rot=rot, wob=0.06, seed=52), hcol, lw=1.0, shade=0.25, hl=0.15)
        cv.fill(circle((cc[0], cc[1] + 1.6), hr * 0.9, 1.4), ramp("cloth_red")[2], clip=m)
        # little flower in band
        cv.part(circle((cc[0] - hr * 0.55, cc[1] + 0.8), 1.8, wob=0.2), "flower_yel", lw=0.6, shade=0.3, hl=0.2)
        cv.line([(cc[0] + 2, cc[1] - 5), (cc[0] + 4, cc[1] - 3.5)], ramp("ink")[1], 0.5)
    elif kind == "bandage":
        a, _ = rig.proj(c3[0] - hr, c3[1], c3[2] + hr * 0.45); b, _ = rig.proj(c3[0] + hr, c3[1], c3[2] + hr * 0.25)
        cv.part(capsule_pts(a[0], a[1], b[0], b[1], 2.0), "cloth_cream", lw=0.8, shade=0.3, hl=0.2)
        cv.line([((a[0] + b[0]) / 2 - 1.5, (a[1] + b[1]) / 2 - 2), ((a[0] + b[0]) / 2 + 1.5, (a[1] + b[1]) / 2 + 2)], ramp("berry")[1], 0.7)
        cv.line([((a[0] + b[0]) / 2 + 1.5, (a[1] + b[1]) / 2 - 2), ((a[0] + b[0]) / 2 - 1.5, (a[1] + b[1]) / 2 + 2)], ramp("berry")[1], 0.7)
        # tiny tuft of hair
        t, _ = rig.proj(c3[0], c3[1], c3[2] + hr * 1.0)
        cv.line([t, (t[0] - 1, t[1] - 3)], ramp("zomb_teal")[3], 0.8); cv.line([t, (t[0] + 2, t[1] - 2.5)], ramp("zomb_teal")[3], 0.8)
    elif kind == "hood":
        hc, _ = rig.proj(c3[0], c3[1] - 1.0, c3[2] + 0.8)
        m = cv.mask_from(circle(hc, hr * 1.15, hr * 1.1, wob=0.05, seed=61))
        if rig.nv(0, 1) > -0.35:
            fc, _ = sph(rig, c3, hr * 0.42, 0, -8)
            m = ImageChops.subtract(m, cv.mask_from(circle(fc, hr * 1.0, hr * 0.92)))
        cv.part(None, hcol, mask=m, lw=1.05, shade=0.22, hl=0.14)
        for side in (-1, 1):   # floppy bunny-ish ears on the hood
            e, v = sph(rig, c3, hr * 1.05, side * 50 + 180 * 0, 60)
            cv.part(circle((e[0] + side * 2, e[1] - 3), 2.2, 4.0, rot=side * 0.5), hcol, lw=0.9, shade=0.3, hl=0.2)

def carve(cv, poly, glow):
    cx = sum(p[0] for p in poly) / len(poly); cy = sum(p[1] for p in poly) / len(poly)
    grow = lambda k: [(cx + (x - cx) * k, cy + (y - cy) * k) for x, y in poly]
    cv.fill(grow(1.35), ramp("pumpkin")[3]); cv.fill(grow(1.12), ramp("ink")[2])
    cv.fill(poly, glow[1]); cv.fill([(cx + (x - cx) * 0.55, cy + (y - cy) * 0.55 - 0.3) for x, y in poly], glow[0])

def pumpkin_head(cv, rig, c3, hr, spec, anim, fi, rot):
    """carved jack-o'-lantern head with a warm candle glow (glow polygons -> emissive page)."""
    c, _ = rig.proj(*c3)
    m = cv.part(circle((c[0], c[1] + 0.5), hr * 1.12, hr * 0.92, rot=rot, wob=0.03, seed=71), "pumpkin", lw=1.15, shade=0.25, hl=0.16)
    r = ramp("pumpkin")
    for az in (-60, -25, 25, 60, 120, 155, 205, 240):   # ribs
        a, va = sph(rig, c3, hr * 1.1, az, 70); b, vb = sph(rig, c3, hr * 1.1, az, -60)
        if va > -0.1 and vb > -0.1:
            mid = ((a[0] + b[0]) / 2 + (a[0] - c[0]) * 0.25, (a[1] + b[1]) / 2)
            cv.line([a, mid, b], r[2], 0.7, clip=m, alpha=210)
    st, _ = rig.proj(c3[0], c3[1], c3[2] + hr * 0.9)
    cv.part(capsule_pts(st[0], st[1], st[0] + 1.5, st[1] - 4.5, 1.8, 1.3), "bark", lw=0.8, shade=0.3, hl=0.2)
    cv.part(circle((st[0] + 4.5, st[1] - 2.5), 3.0, 1.6, rot=0.4), "leaf", lw=0.7, shade=0.3, hl=0.25)
    cv.line([(st[0] + 1, st[1] - 3), (st[0] - 2.5, st[1] - 5), (st[0] - 3.5, st[1] - 3)], ramp("leaf")[3], 0.6)
    glow = ramp("fire")
    fv = rig.nv(0, 1)
    if fv > 0.15 and not (anim == "death" and fi >= 1):
        k = max(0.4, fv)
        for i, az in enumerate((-30, 30)):
            p, v = sph(rig, c3, hr, az, 16)
            big = 1.15 if i == 0 else 0.9
            big *= 1.3
            tri = [(p[0] - 2.6 * k * big, p[1] + 1.6 * big), (p[0] + 2.6 * k * big, p[1] + 1.6 * big), (p[0] + (0.6 if i else -0.6), p[1] - 2.4 * big)]
            carve(cv, tri, glow); META["glow"].append(tri)
        mp, _ = sph(rig, c3, hr, 0, -16)
        w = 6.0 * k; op = 3.0 if anim in ("attack", "feed") and fi % 2 else 1.8
        mouth = [(mp[0] - w, mp[1] - 1), (mp[0] - w * 0.5, mp[1] - 0.2), (mp[0] - w * 0.3, mp[1] - 1.2), (mp[0], mp[1] - 0.2), (mp[0] + w * 0.3, mp[1] - 1.2),
                 (mp[0] + w * 0.5, mp[1] - 0.2), (mp[0] + w, mp[1] - 1), (mp[0] + w * 0.6, mp[1] + op), (mp[0] - w * 0.6, mp[1] + op)]
        carve(cv, mouth, glow); META["glow"].append(mouth)
        cv.fill([(mp[0] - 0.8, mp[1] - 0.4), (mp[0] + 0.8, mp[1] - 0.4), (mp[0], mp[1] + 1.4)], r[2])   # tooth
    elif anim == "death" and fi >= 1 and fv > 0.15:
        for az in (-30, 30):
            p, _ = sph(rig, c3, hr, az, 6)
            for s_ in (-1, 1): cv.line([(p[0] - 1.6, p[1] - 1.6 * s_), (p[0] + 1.6, p[1] + 1.6 * s_)], ramp("ink")[3], 0.8)

def face(cv, rig, c3, hr, spec, zombie, blink, anim, fi, rot, hm):
    r_ink = ramp("ink")
    eyes = []
    for i, az in enumerate((-30, 30)):
        p, v = sph(rig, c3, hr, az, -8)
        if v > 0.12: eyes.append((i, p, v))
    for i, p, v in eyes:
        sq = max(0.35, min(1.0, v * 1.2))
        if not zombie:
            if blink or anim in ("hurt",):
                cv.line([(p[0] - 2.2 * sq, p[1] + 0.3), (p[0], p[1] + 1.2), (p[0] + 2.2 * sq, p[1] + 0.3)], r_ink[3], 0.9)
            else:
                cv.part(circle(p, 2.3 * sq, 3.1, wob=0.0), [r_ink[1], r_ink[3], r_ink[3], r_ink[3]], lw=0.4, flat=True, outline=False)
                cv.fill(circle((p[0] - 0.7 * sq, p[1] - 1.1), 1.1 * sq + 0.25, 1.25), (255, 255, 255))
                cv.fill(circle((p[0] + 0.8 * sq, p[1] + 1.2), 0.5, 0.5), (255, 255, 255), alpha=220)
            bl, bv = sph(rig, c3, hr * 0.98, -46 if i == 0 else 46, -24)
            if bv > 0.1: cv.fill(circle(bl, 2.4 * max(0.4, bv), 1.3), ramp("flower_pink")[1], alpha=150, clip=hm)
        else:
            big = (i == 0) != (spec["hat"] == "hood")
            if anim == "death" and fi >= 1:
                for s in (-1, 1): cv.line([(p[0] - 1.6, p[1] - 1.6 * s), (p[0] + 1.6, p[1] + 1.6 * s)], r_ink[3], 0.8)
            elif big:
                META["eyes"].append((p[0], p[1], 3.3 * sq + 0.5, 3.9))
                cv.part(circle(p, 3.3 * sq, 3.4, wob=0.03), "cloth_cream", lw=0.8, shade=0.15, hl=0.0)
                jitter = [(0.6, 0.5), (-0.4, 0.9), (0.2, -0.3), (0.8, 1.1)][fi % 4]
                cv.fill(circle((p[0] + jitter[0] * sq, p[1] + jitter[1]), 1.25, 1.25), r_ink[3])
                cv.fill(circle((p[0] + jitter[0] * sq - 0.4, p[1] + jitter[1] - 0.4), 0.4), (255, 255, 255))
            else:
                META["eyes"].append((p[0], p[1], 1.7 * sq + 0.5, 2.1))
                cv.part(circle(p, 1.7 * sq, 1.6), "cloth_cream", lw=0.6, shade=0.1, hl=0.0)
                cv.fill(circle((p[0] + 0.2, p[1] + 0.3), 0.8), r_ink[3])
                cv.line([(p[0] - 2.3, p[1] - 2.6), (p[0] + 2.0, p[1] - 1.4)], ramp(spec["skin"])[3], 0.8)  # droopy lid
    # mouth
    mp, mv = sph(rig, c3, hr, 0, -36)
    if mv > 0.2:
        k = max(0.4, mv)
        if not zombie:
            if anim == "attack": cv.part(circle(mp, 1.5 * k, 1.3), [ramp("berry")[1]] * 2 + [ramp("berry")[2], r_ink[3]], lw=0.5, shade=0.2, hl=0)
            else: cv.line([(mp[0] - 1.6 * k, mp[1] - 0.4), (mp[0] - 0.5 * k, mp[1] + 0.5), (mp[0] + 0.5 * k, mp[1] - 0.1), (mp[0] + 0.5 * k, mp[1] - 0.1), (mp[0] + 1.6 * k, mp[1] + 0.5) if False else (mp[0] + 1.6 * k, mp[1] - 0.4)], r_ink[3], 0.6)
        else:
            open_ = anim in ("attack", "punch", "swim", "idle", "walk", "run", "crawl") or (anim == "feed" and fi % 2 == 1)
            cv.part(circle((mp[0], mp[1] + 0.2), 2.4 * k, 1.4 if open_ else 0.8), r_ink, lw=0.5, flat=True, outline=False)
            # tooth + tongue
            cv.fill([(mp[0] - 1.0 * k, mp[1] - 1.0), (mp[0] + 0.1, mp[1] - 1.0), (mp[0] - 0.4, mp[1] + 0.4)], (255, 250, 240))
            cv.part(circle((mp[0] + 1.0 * k, mp[1] + 1.6), 1.3, 1.6), "flower_pink", lw=0.6, shade=0.3, hl=0.2)
            # stitches on forehead/cheek
            a, va = sph(rig, c3, hr, -10, 32); b, vb = sph(rig, c3, hr, 32, 18)
            if va > 0.1 and vb > 0.1:
                cv.line([a, b], ramp(spec["skin"])[3], 0.6, clip=hm)
                for t in (0.2, 0.5, 0.8):
                    x, y = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
                    cv.line([(x - 0.5, y - 1.2), (x + 0.5, y + 1.2)], ramp(spec["skin"])[3], 0.5, clip=hm)
    # zombie back-of-head stitch
    if zombie and rig.nv(0, 1) < -0.3:
        a, _ = sph(rig, c3, hr, 160, 20); b, _ = sph(rig, c3, hr, 200, -10)
        cv.line([a, b], ramp(spec["skin"])[3], 0.6, clip=hm)

# ------------------------------------------------------------------ sheet builders
PLAYER_ANIMS = [("idle", 4, 4, True), ("walk", 6, 10, True), ("attack", 4, 12, False), ("gather", 4, 8, True), ("run", 6, 14, True)]
ZOMBIE_ANIMS = [("idle", 4, 4, True), ("walk", 6, 7, True), ("attack", 4, 10, False), ("hurt", 2, 10, False), ("death", 6, 10, False),
                ("run", 6, 12, True), ("crawl", 6, 6, True), ("feed", 4, 6, True)]

def poof(cv, cx, cy, k, alpha=1.0):
    """cartoon cloud puff with stars (k: 0..1 growth)."""
    for i, (dx, dy, r) in enumerate([(-6, 0, 5), (5, -1, 5.5), (0, -5, 6), (-2, 3, 5), (4, 4, 4.5)]):
        rr = r * (0.6 + 0.6 * k)
        cv.part(circle((cx + dx * (0.8 + k * 0.6), cy + dy * (0.8 + k * 0.6)), rr, rr * 0.9, wob=0.1, seed=i), "smoke", lw=0.9, shade=0.25, hl=0.25)
    for i in range(3):
        a = i * 2.1 + k * 2; x, y = cx + math.cos(a) * 9 * (0.6 + k), cy - 6 + math.sin(a) * 4
        star(cv, x, y, 2.2 * (1.2 - k * 0.5), "gold")

def star(cv, x, y, r, rp="gold", rot=0.0):
    pts = []
    for i in range(10):
        a = rot - math.pi / 2 + i * math.pi / 5; rr = r if i % 2 == 0 else r * 0.45
        pts.append((x + math.cos(a) * rr, y + math.sin(a) * rr))
    cv.part(pts, rp, lw=0.6, shade=0.25, hl=0.2)

def render_frame_meta(spec, dir_idx, anim, fi, n, zombie, fw, fh, feet, scale):
    """-> (image, meta) with meta = {hand, emissive (Image|None)}"""
    META["hand"] = None; META["eyes"] = []; META["glow"] = []
    im = render_frame(spec, dir_idx, anim, fi, n, zombie, fw, fh, feet, scale)
    em = None
    if META["eyes"] or META["glow"]:
        from PIL import ImageDraw as D_, ImageFilter as F_
        mk = Image.new("L", (fw * 4, fh * 4), 0); d = D_.Draw(mk)
        for (x, y, rx, ry) in META["eyes"]: d.ellipse([(x - rx) * 4, (y - ry) * 4, (x + rx) * 4, (y + ry) * 4], fill=255)
        for poly in META["glow"]: d.polygon([(x * 4, y * 4) for x, y in poly], fill=255)
        mk = mk.resize((fw, fh), Image.LANCZOS)
        a = np.asarray(im).astype(np.float32); mm = np.asarray(mk).astype(np.float32) / 255
        # only pixels that are still eye-white / candle-lit in the final frame (occluders stay dark)
        lum = a[..., :3].max(-1); sat_ok = lum > 175
        out = a.copy(); out[..., 3] = a[..., 3] * mm * sat_ok
        em = Image.fromarray(out.astype(np.uint8))
        if not out[..., 3].any(): em = None
    hand = META["hand"]
    if anim == "death" and fi >= 4: hand = None
    return im, {"hand": hand, "emissive": em}

def render_frame(spec, dir_idx, anim, fi, n, zombie, fw, fh, feet, scale):
    cv = Canvas(fw, fh, seed=17 + dir_idx * 3 + fi)
    phi = DIR_PHI[dir_idx]
    if anim == "death" and fi >= 4:
        poof(cv, fw / 2, feet - 12, (fi - 4) / 1.5)
        return cv.final()
    build_figure(cv, phi, spec, anim, fi, n, zombie=zombie, ox=fw / 2, oy=feet, scale=scale)
    if anim == "death" and fi == 1:
        for i in range(3): star(cv, fw / 2 - 6 + i * 6, feet - 50 * scale + (i % 2) * 2, 2.0)
    im = cv.final()
    if anim == "death" and fi == 3:
        a = np.asarray(im).copy(); a[..., 3] = (a[..., 3] * 0.7).astype(np.uint8); im = Image.fromarray(a)
        c2 = Canvas(fw, fh, seed=3); poof(c2, fw / 2, feet - 8, 0.0); im = Image.alpha_composite(im, c2.final())
    if anim == "hurt" and fi == 0:
        a = np.asarray(im).astype(np.float32); a[..., :3] = a[..., :3] * 0.55 + 255 * 0.45; im = Image.fromarray(a.astype(np.uint8))
    return im
