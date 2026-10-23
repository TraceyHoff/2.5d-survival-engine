"""Critters: bunny (4 iso directions, idle + hop)."""
import math
from toon import Canvas, ellipse_pts, capsule_pts
from chars import Rig, circle
from palette import ramp

DIR4_PHI = [45, -45, -135, 135]   # engine 4-dir order: 0 down-right, 1 down-left, 2 up-left, 3 up-right

def bunny(dir_idx, anim, fi, W=32, H=32, feet=28):
    cv = Canvas(W, H, seed=80 + fi + dir_idx * 7)
    rig = Rig(cv, DIR4_PHI[dir_idx], W / 2, feet, 1.0)
    z = 0; sq = 1.0; ear = 0.0; nose = 0
    if anim == "hop":
        z, sq = [(0, 0.82), (2.5, 1.18), (5.0, 1.05), (0.8, 0.85)][fi % 4]
        ear = [-0.2, 0.5, 0.3, -0.3][fi % 4]
    else:
        ear = [0, 0.15, 0, -0.1][fi % 4]; nose = fi % 2
    fur = "cloth_cream"
    sh = 1 - z / 10
    # shadow intentionally not baked (renderer projects shadows); keep tiny AO only when grounded
    (bc, bv) = rig.proj(0, -0.5, 4.2 * sq + z)
    (hc, hv) = rig.proj(0, 4.0, 8.6 * sq + z)
    (tc, tv) = rig.proj(0, -5.6, 4.6 * sq + z)
    for side in (-1, 1):
        (fc, fv) = rig.proj(side * 2.6, 1.5 if anim != "hop" else (2.5 if fi == 1 else 1.0), 0.9 + z)
        rig.add(fv - 1, lambda fc=fc: cv.part(circle(fc, 2.0, 1.3), fur, lw=0.8, shade=0.35, hl=0.2))
    rig.add(tv, lambda: cv.part(circle(tc, 2.3, wob=0.15), "snow", lw=0.8, shade=0.25, hl=0.2))
    rig.add(bv, lambda: cv.part(circle(bc, 5.6 / sq ** 0.5, 4.6 * sq, wob=0.04), fur, lw=0.95, shade=0.24, hl=0.15))
    def head():
        m = cv.part(circle(hc, 4.3, 4.0, wob=0.03), fur, lw=0.95, shade=0.22, hl=0.15)
        fv_ = rig.nv(0, 1)
        for side in (-1, 1):
            a = math.radians(side * 32); e = math.radians(-5)
            ex, ey, ez = 0 + 4.1 * math.sin(a), 4.0 + 4.1 * math.cos(a), 8.6 * sq + z + 0.4
            (ep, _) = rig.proj(ex, ey, ez); vis = rig.nv(math.sin(a), math.cos(a))
            if vis > 0.1:
                cv.fill(circle(ep, 1.05 * max(0.5, vis), 1.3, wob=0), ramp("ink")[3])
                cv.fill(circle((ep[0] - 0.35, ep[1] - 0.45), 0.4, 0.4, wob=0), (255, 255, 255))
                (cp, _) = rig.proj(ex * 1.15, ey + 0.3, ez - 1.6)
                cv.fill(circle(cp, 1.1, 0.6, wob=0), ramp("flower_pink")[1], alpha=150, clip=m)
        if fv_ > 0.2:
            (np_, _) = rig.proj(0, 8.2, 8.0 * sq + z)
            cv.fill(circle(np_, 0.8 + 0.2 * nose, 0.6, wob=0), ramp("flower_pink")[2])
    rig.add(hv + 0.5, head)
    for side in (-1, 1):
        (eb, ev) = rig.proj(side * 1.8, 2.8, 12.0 * sq + z)
        tip_x = side * (2.8 + ear * 2); tip_z = 12.0 * sq + z + 7.5 - abs(ear) * 2
        (et, _) = rig.proj(tip_x, 1.0 - ear * 2, tip_z)
        def e(eb=eb, et=et):
            cv.part(capsule_pts(eb[0], eb[1], et[0], et[1], 1.6, 1.9), fur, lw=0.85, shade=0.25, hl=0.15)
            if rig.nv(0, 1) > -0.2:
                cv.part(capsule_pts(eb[0], eb[1] - 0.8, et[0], et[1] + 0.5, 0.7, 0.9), "flower_pink", outline=False, flat=True)
        rig.add(ev + (0.2 if rig.nv(0, 1) < 0 else -0.6), e)
    rig.draw()
    return cv.final()

# ---------------------------------------------------------------- wave 2 critters
def _eyes(cv, rig, c3, r, az=34, el=10, big=1.0, clip=None):
    for side in (-1, 1):
        a, e = math.radians(side * az), math.radians(el)
        p3 = (c3[0] + r * math.sin(a) * math.cos(e), c3[1] + r * math.cos(a) * math.cos(e), c3[2] + r * math.sin(e))
        (ep, _) = rig.proj(*p3); vis = rig.nv(math.sin(a), math.cos(a))
        if vis > 0.1:
            cv.fill(circle(ep, 1.0 * big * max(0.5, vis), 1.25 * big, wob=0), ramp("ink")[3])
            cv.fill(circle((ep[0] - 0.35, ep[1] - 0.45), 0.42 * big, 0.42 * big, wob=0), (255, 255, 255))

def chick(dir_idx, anim, fi, W=32, H=32, feet=28):
    cv = Canvas(W, H, seed=90 + fi + dir_idx * 7); rig = Rig(cv, DIR4_PHI[dir_idx], W / 2, feet, 1.0)
    bob = 0; peck = 0; step = [0, 0]
    if anim == "walk": bob = [0, 0.8, 0, 0.8][fi % 4]; step = [[1.5, -1.5], [0, 0], [-1.5, 1.5], [0, 0]][fi % 4]
    else: peck = [0, 0, 3.0, 1.0][fi % 4]
    (bc, bv) = rig.proj(0, 0, 6 + bob)
    (hc, hv) = rig.proj(0, 2.0 + peck * 0.8, 11.5 + bob - peck)
    for side in (-1, 1):
        (f0, fv) = rig.proj(side * 1.8, step[0 if side < 0 else 1], 3 + bob); (f1, _) = rig.proj(side * 1.8, step[0 if side < 0 else 1] + 0.8, 0.4)
        rig.add(fv - 1, lambda f0=f0, f1=f1: (cv.line([f0, f1], ramp("carrot")[2], 0.9), cv.part(circle(f1, 1.5, 0.7), "carrot", lw=0.5, shade=0.3, hl=0.2)))
    def body():
        m = cv.part(circle(bc, 6.0, 5.2, wob=0.06, seed=3), "chick", lw=0.95, shade=0.25, hl=0.18)
        for side in (-1, 1):   # little wings
            (wp, wv) = rig.proj(side * 5.0, -0.5, 6.5 + bob)
            if abs(rig.nv(side, 0)) < 0.98: cv.part(circle(wp, 2.0, 3.0, rot=side * 0.4), "chick", lw=0.7, shade=0.3, hl=0.15, base_col=ramp("chick")[2])
        (tp, _) = rig.proj(0, -5.2, 8 + bob)
        if rig.nv(0, 1) < 0.6: cv.part([(tp[0] - 1.5, tp[1] + 1), (tp[0], tp[1] - 3), (tp[0] + 1.5, tp[1] + 1)], "chick", lw=0.6, shade=0.3, hl=0.2)
    rig.add(bv, body)
    def head():
        m = cv.part(circle(hc, 4.0, 3.8, wob=0.04), "chick", lw=0.95, shade=0.22, hl=0.18)
        hc3 = (0, 2.0 + peck * 0.8, 11.5 + bob - peck)
        _eyes(cv, rig, hc3, 3.9, 38, 12)
        if rig.nv(0, 1) > -0.3:
            (bp, _) = rig.proj(0, 2.0 + peck * 0.8 + 4.4, 11.0 + bob - peck)
            cv.part([(bp[0] - 1.3, bp[1] - 0.6), (bp[0] + 1.3, bp[1] - 0.6), (bp[0], bp[1] + 1.4)], "carrot", lw=0.5, shade=0.3, hl=0.2)
        (tf, _) = rig.proj(0, 1.5 + peck * 0.8, 15.6 + bob - peck)
        for k in (-1, 0, 1): cv.line([tf, (tf[0] + k * 1.6, tf[1] - 2.4 + abs(k))], ramp("chick")[3], 0.7)
    rig.add(hv + 0.5, head)
    rig.draw(); return cv.final()

def frog(dir_idx, anim, fi, W=32, H=32, feet=28):
    cv = Canvas(W, H, seed=100 + fi + dir_idx * 7); rig = Rig(cv, DIR4_PHI[dir_idx], W / 2, feet, 1.0)
    z, sq, throat = 0, 1.0, 0
    if anim == "hop": z, sq = [(0, 0.8), (3, 1.2), (5.5, 1.1), (1, 0.85)][fi % 4]
    else: throat = [0, 1, 0, 0.5][fi % 4]
    leg_out = 1.0 if anim != "hop" else [1.0, 0.4, 0.2, 0.9][fi % 4]
    (bc, bv) = rig.proj(0, 0, 4 * sq + z)
    for side in (-1, 1):   # back legs (folded) + front feet
        (lp, lv) = rig.proj(side * 5.0, -2.0 - (1 - leg_out) * 2, 2.2 + z)
        rig.add(lv - 0.5, lambda lp=lp, side=side: cv.part(circle(lp, 3.2, 2.3, rot=side * 0.5), "frog", lw=0.8, shade=0.3, hl=0.2, base_col=ramp("frog")[2]))
        (fp, fv) = rig.proj(side * 3.2, 3.6, 0.6 + z)
        rig.add(fv - 0.4, lambda fp=fp: cv.part(circle(fp, 1.7, 0.9), "frog", lw=0.6, shade=0.3, hl=0.2))
    def body():
        m = cv.part(circle(bc, 6.8 / sq ** 0.4, 5.0 * sq, wob=0.05, seed=4), "frog", lw=1.0, shade=0.24, hl=0.18)
        for (dx, dy) in [(-2.5, -1.5), (2.0, -2.5), (0.5, 0.5)]:
            if rig.nv(0, 1) < 0.4 or True: cv.fill(circle((bc[0] + dx, bc[1] + dy - 1), 0.9, 0.7, wob=0), ramp("frog")[2], clip=m, alpha=180)
        if rig.nv(0, 1) > 0.2:
            (tp, _) = rig.proj(0, 4.0, 2.8 * sq + z)
            cv.fill(circle(tp, 3.6 + throat * 0.7, 2.2 + throat * 0.6, wob=0), ramp("cloth_cream")[1], clip=m)
            (mp, _) = rig.proj(0, 5.6, 5.2 * sq + z)
            cv.line([(mp[0] - 2.8, mp[1] - 0.6), (mp[0], mp[1] + 0.6), (mp[0] + 2.8, mp[1] - 0.6)], ramp("ink")[2], 0.55)
        for side in (-1, 1):   # bulging eyes on top
            (ep, ev) = rig.proj(side * 2.6, 2.2, 8.4 * sq + z)
            cv.part(circle(ep, 2.2, 2.1), "frog", lw=0.7, shade=0.25, hl=0.2)
            if rig.nv(0, 1) > -0.3:
                cv.fill(circle((ep[0], ep[1] + 0.2), 1.25, 1.35, wob=0), ramp("ink")[3]); cv.fill(circle((ep[0] - 0.4, ep[1] - 0.3), 0.45, wob=0), (255, 255, 255))
    rig.add(bv, body)
    rig.draw(); return cv.final()

def hedgehog(dir_idx, anim, fi, W=32, H=32, feet=28):
    cv = Canvas(W, H, seed=110 + fi + dir_idx * 7); rig = Rig(cv, DIR4_PHI[dir_idx], W / 2, feet, 1.0)
    bob = [0, 0.5, 0, 0.5][fi % 4] if anim == "walk" else 0; sniff = [0, 0.6, 0, -0.3][fi % 4] if anim == "idle" else 0
    step = [[1.2, -1.2], [0, 0], [-1.2, 1.2], [0, 0]][fi % 4] if anim == "walk" else [0, 0]
    (bc, bv) = rig.proj(0, -1.0, 4.8 + bob)
    for i, side in enumerate((-1, 1)):
        for fy in (2.5, -3.5):
            (fp, fv) = rig.proj(side * 3.2, fy + step[i] * (1 if fy > 0 else -1), 0.6)
            rig.add(fv - 1, lambda fp=fp: cv.part(circle(fp, 1.4, 0.9), "fur_brown", lw=0.6, shade=0.3, hl=0.2))
    (hc, hv) = rig.proj(0, 4.0 + sniff, 4.4 + bob)
    def spines():
        m = cv.part(scallop_pts(bc[0], bc[1] - 0.5, 7.4, 5.6), "fur_brown", lw=1.0, shade=0.3, hl=0.15, base_col=ramp("fur_brown")[2])
        for k in range(9):
            x = bc[0] - 5 + (k % 5) * 2.5 + (k // 5) * 1.2; y = bc[1] - 4 + (k // 5) * 2.6
            cv.line([(x, y + 1.5), (x - 0.8, y - 1.2)], ramp("fur_brown")[0], 0.5, clip=m, alpha=200)
        (ap, _) = rig.proj(-1.5, -2, 9.5 + bob)
        cv.part(circle(ap, 1.6, 1.4, wob=0), "berry", lw=0.5, shade=0.3, hl=0.2, gloss=[(ap[0] - 0.5, ap[1] - 0.5, 0.4, 0.4)])   # a berry stuck on its spines
        cv.line([(ap[0], ap[1] - 1.3), (ap[0] + 0.6, ap[1] - 2.4)], ramp("leaf")[3], 0.5)
    rig.add(bv, spines)
    def face():
        if rig.nv(0, 1) < -0.5: return
        m = cv.part(circle(hc, 3.4, 2.8, wob=0.04), "fur_orange", lw=0.85, shade=0.2, hl=0.2, base_col=ramp("hide")[0])
        _eyes(cv, rig, (0, 4.0 + sniff, 4.4 + bob), 3.0, 40, 18, big=0.85)
        (np_, _) = rig.proj(0, 7.2 + sniff, 4.0 + bob)
        cv.fill(circle(np_, 0.9, 0.75, wob=0), ramp("ink")[3])
    rig.add(hv + 0.6, face)
    rig.draw(); return cv.final()

def scallop_pts(x, y, r, ry):
    pts = []
    for i in range(48):
        a = i / 48 * 2 * math.pi; k = 1 + 0.09 * abs(math.sin(a * 6)) if math.sin(a) < 0.3 else 1.0
        pts.append((x + math.cos(a) * r * k, y + math.sin(a) * ry * k))
    return pts

CRITTERS = {  # key: (fn, [(anim, frames, fps)], aliases)
    "critter_bunny": (bunny, [("idle", 4, 4), ("hop", 4, 10)], {"walk": "hop"}),
    "critter_chick": (chick, [("idle", 4, 5), ("walk", 4, 10)], {}),
    "critter_frog": (frog, [("idle", 4, 4), ("hop", 4, 9)], {"walk": "hop"}),
    "critter_hedgehog": (hedgehog, [("idle", 4, 4), ("walk", 4, 8)], {}),
}
