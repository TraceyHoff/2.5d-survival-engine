"""Player v2 animation set (spec: player_v2_spec.md §6). Poses for the v2 sample on the SAME keypoint model as rig.pose
(x = body right, y = forward, z = up; 1x px), so every paper-doll layer follows each frame. v1 anims (idle/walk/attack/sit)
come straight from rig.pose; the new ones are built here. Nothing in rig.py is modified (ANIM_START only gets seeds for
the new names at import, in this process).
Each entry: (name, frames, fps, loop, atlas group, AnimState mapping, note)."""
import math
import rig
from chars import Rig, DIR_PHI
from rig import FW, FEET, BODY

ANIMS = [
    # core (parity with v1)
    ("idle", 4, 4, True, "core", "Idle", ""),
    ("walk", 6, 10, True, "core", "Walk", ""),
    ("attack", 4, 12, False, "core", "Attack", "generic swing, fallback for every attack_*"),
    # combat: block + per-weapon melee (weapon class from skills.json weaponClasses via weaponClassOf)
    ("block", 3, 10, False, "combat", "NEW Block", "raise guard, hold last frame while blocking"),
    ("attack_unarmed", 5, 14, False, "combat", "Punch (unarmed)", "jab-cross"),
    ("attack_blade", 4, 14, False, "combat", "Attack + blade", "knife/dagger/sword/machete slash"),
    ("attack_blunt", 5, 10, False, "combat", "Attack + blunt", "overhead two-hand smash (club/mace/maul/hammer/bat)"),
    ("attack_axe", 5, 11, False, "combat", "Attack + axe", "diagonal chop (axe/pickaxe as weapon)"),
    ("attack_spear", 4, 11, False, "combat", "Attack + spear", "two-hand thrust"),
    ("attack_throw", 4, 12, False, "combat", "Attack + throwing_axe / sling", "overhand throw, release = frame 2"),
    # ranged
    ("bow_draw", 4, 10, False, "ranged", "NEW Aim (bow)", "nock + draw to the cheek"),
    ("bow_hold", 2, 4, True, "ranged", "NEW Aim (bow, held)", "full draw, slight tremble"),
    ("bow_release", 3, 12, False, "ranged", "Attack + bow", "release, string hand snaps back, release = frame 0"),
    ("attack_crossbow", 3, 12, False, "ranged", "Attack + crossbow", "shoulder shot, light kick"),
    ("gun_aim", 2, 4, True, "ranged", "NEW Aim (firearm/crossbow)", "two-hand shoulder aim"),
    ("gun_fire", 3, 15, False, "ranged", "Attack + firearm", "shot with recoil (muzzle FX at handR + len along angle on frame 0)"),
    # poses / locomotion
    ("crouch_idle", 4, 4, True, "pose", "NEW Crouch", "low stance, hands on knees"),
    ("crouch_walk", 6, 8, True, "pose", "NEW Crouch + moving", "sneak"),
    ("carry_idle", 4, 4, True, "pose", "NEW Carry", "box held at the chest (carry socket)"),
    ("carry_walk", 6, 9, True, "pose", "NEW Carry + moving", "short steps"),
    ("sleep", 4, 2, True, "pose", "NEW Sleep", "curled doze on the ground, slow breathing"),
    ("sit", 4, 4, True, "pose", "Sit", "v1 seat-height sit (seat socket)"),
    ("vehicle", 4, 6, True, "pose", "Sit + in vehicle (ADR-101 rider)", "seated, hands on bars/wheel, road bump (seat socket)"),
    ("build", 6, 12, True, "pose", "Build", "hammering, impact = frame 3"),
]
EVENTS = {"attack": {"hit": 2}, "attack_unarmed": {"hit": [1, 3]}, "attack_blade": {"hit": 2}, "attack_blunt": {"hit": 3},
          "attack_axe": {"hit": 3}, "attack_spear": {"hit": 2}, "attack_throw": {"release": 2}, "bow_release": {"release": 0},
          "attack_crossbow": {"release": 0}, "gun_fire": {"fire": 0}, "build": {"hit": 3}}
for _i, _a in enumerate(ANIMS): rig.ANIM_START.setdefault(_a[0], 1000 + _i * 37)
V1_POSE = {"idle", "walk", "attack", "sit"}

def _walk_legs(ph, sw, lift):
    return [(math.sin(ph) * sw, max(0, math.cos(ph)) * lift), (-math.sin(ph) * sw, max(0, -math.cos(ph)) * lift)]

def params(anim, fi, n):
    """per-frame pose parameters. hands(bz, shw) -> {side: (x,y,z)}; bent legs: leg(side, hipz) -> (hip, knee, foot)."""
    ph = 2 * math.pi * fi / n; P = dict(bob=0.0, crouch=0.0, back=0.0, lean=0.0, tilt=0.0, expr="normal", legs=[(0, 0), (0, 0)],
                                         bent=None, ground=False, seated=False, dv=(0.15, 0.35, 0.92), dvL=None, sockets=())
    f = fi
    if anim == "block":
        P.update(crouch=[.5, 1.5, 1.2][f], back=[0, -.6, -.4][f], expr="focus", dv=(-.85, .2, .5), dvL=(0, 1, .25))
        R = [(5, 5, 5), (3, 7, 8.5), (3, 7, 8)][f]; L = [(-5, 5, 5), (-3, 7.5, 8.5), (-3, 7.5, 8)][f]
        P["hands"] = lambda bz, shw, R=R, L=L: {1: (R[0], R[1], bz + R[2]), -1: (L[0], L[1], bz + L[2])}
    elif anim == "attack_unarmed":
        G = lambda s: (s * (8.2 - 2.5), 6, 7)
        R = [G(1), G(1), (6.5, 3, 7), (2, 13.5, 7), G(1)][f]; L = [G(-1), (-4.5, 13, 7.2), G(-1), (-5.5, 5, 6.5), G(-1)][f]
        P.update(lean=[.5, 2, .2, 2.6, 1][f], crouch=[0, .4, .2, .4, 0][f], expr=["focus", "yell", "focus", "yell", "focus"][f], dv=(0, .95, .3), dvL=(0, .95, .3))
        P["hands"] = lambda bz, shw, R=R, L=L: {1: (R[0], R[1], bz + R[2]), -1: (L[0], L[1], bz + L[2])}
    elif anim == "attack_blade":
        R = [(9.2, -2, 9), (8.2, 6, 8), (1, 10, 4.5), (-3, 6.5, 2)][f]
        P.update(lean=[-.5, .5, 2, 1.2][f], expr=["focus", "yell", "yell", "focus"][f], dv=[(.5, -.6, .6), (.5, .85, .2), (-.85, .5, 0), (-.6, -.2, -.6)][f])
        P["hands"] = lambda bz, shw, R=R: {1: (R[0], R[1], bz + R[2]), -1: (-(shw + .5), 4, bz)}
    elif anim == "attack_blunt":
        g = [(5.5, -3.5, 11), (6.5, -5, 13.5), (4, 5, 11), (1, 11, -2), (1, 8, 3)][f]   # chibi head: wind up over the right shoulder, not through the head
        P.update(crouch=[0, -.5, 0, 2.5, 1][f], lean=[-.8, -1.2, .5, 3, 1.5][f], expr=["focus", "focus", "yell", "yell", "focus"][f],
                 dv=[(0, -.75, .65), (0, -.3, .95), (0, .75, .65), (0, .9, -.45), (0, .8, .4)][f])
        P["dvL"] = P["dv"]
        P["hands"] = lambda bz, shw, g=g: {1: (g[0] + 1.2, g[1] + .5, bz + g[2] + 1.2), -1: (g[0] - 1.6, g[1], bz + g[2] - 1.2)}
    elif anim == "attack_axe":
        R = [(10.2, -2, 12), (9.2, 1, 14), (5, 7, 8), (1, 10, -1), (4, 7, 3)][f]
        P.update(crouch=[0, -.4, 0, 2, 1][f], lean=[-.6, -1, .8, 2.6, 1.2][f], expr=["focus", "focus", "yell", "yell", "focus"][f],
                 dv=[(.4, -.6, .7), (.3, -.2, .95), (.1, .8, .6), (-.2, .9, -.4), (0, .8, .5)][f])
        P["hands"] = lambda bz, shw, R=R: {1: (R[0], R[1], bz + R[2]), -1: (-(shw + 1), 3, bz - 1)}
    elif anim == "attack_spear":
        R, L = [((4, -1, 1), (-1, 5, 2.5)), ((4, -2.5, 1.5), (-1, 3.5, 3)), ((2.5, 7, 3), (-1.5, 12.5, 4)), ((3.5, 2, 2), (-1, 8, 3))][f]
        P.update(lean=[0, -.8, 3, 1][f], crouch=[.5, .8, 1.2, .5][f], expr=["focus", "focus", "yell", "focus"][f], dv=(0, 1, .05), dvL=(0, 1, .05))
        P["hands"] = lambda bz, shw, R=R, L=L: {1: (R[0], R[1], bz + R[2]), -1: (L[0], L[1], bz + L[2])}
    elif anim == "attack_throw":
        R = [(9.7, -3, 11), (9.2, -1, 13), (5, 8, 9), (2, 10, 1)][f]
        P.update(lean=[-1, -1.2, 2, 2.5][f], crouch=[0, .3, .6, 1][f], expr=["focus", "focus", "yell", "focus"][f], dv=[(.2, -.7, .7), (.1, -.2, .97), (0, .9, .4), (0, .6, -.8)][f])
        P["hands"] = lambda bz, shw, R=R: {1: (R[0], R[1], bz + R[2]), -1: (-(shw - 1), 6, bz + 4)}
    elif anim in ("bow_draw", "bow_hold", "bow_release"):
        if anim == "bow_draw": R = [(-.5, 8.5, 7), (1.5, 6, 7.5), (3.5, 3.5, 8), (4.5, 2, 8.5)][f]; L = [(-3.5, 8, 5.5), (-2.5, 9.5, 7), (-2.5, 9.5, 7), (-2.5, 9.5, 7)][f]
        elif anim == "bow_hold": R = [(4.5, 2, 8.5), (4.6, 1.8, 8.6)][f]; L = (-2.5, 9.5, 7 + .15 * f)
        else: R = [(6.5, -2, 9.5), (6.5, -1, 7.5), (5, 2, 5)][f]; L = [(-2.5, 10, 7.5), (-2.5, 9.5, 7), (-3.5, 8, 5)][f]
        P.update(lean=-.3, expr="focus" if anim != "bow_release" or f < 2 else "normal", dv=(0, 1, 0), dvL=(0, .1, 1))
        P["hands"] = lambda bz, shw, R=R, L=L: {1: (R[0], R[1], bz + R[2]), -1: (L[0], L[1], bz + L[2])}
    elif anim in ("gun_aim", "gun_fire", "attack_crossbow"):
        if anim == "gun_aim": R = (3.5, 5.5, 7 + .3 * f); L = (.5, 10, 6.8 + .3 * f); back = 0; tip = .02; ex = "focus"
        elif anim == "gun_fire":
            R = [(3.8, 3.5, 8.2), (3.6, 4.6, 7.6), (3.5, 5.3, 7.1)][f]; L = [(.8, 8, 8.5), (.6, 9, 7.6), (.5, 9.8, 7)][f]
            back = [-1.6, -.8, -.2][f]; tip = [.38, .18, .05][f]; ex = ["yell", "focus", "focus"][f]
        else:
            R = [(3.6, 4.6, 7.6), (3.5, 5.1, 7.2), (3.5, 5.5, 7)][f]; L = [(.6, 9, 7.6), (.5, 9.6, 7.1), (.5, 10, 6.8)][f]
            back = [-.8, -.4, 0][f]; tip = [.2, .08, .02][f]; ex = "focus"
        P.update(lean=1.2, back=back, expr=ex, dv=(0, 1, tip), dvL=(0, 1, tip))
        P["hands"] = lambda bz, shw, R=R, L=L: {1: (R[0], R[1], bz + R[2]), -1: (L[0], L[1], bz + L[2])}
    elif anim in ("crouch_idle", "crouch_walk"):
        walk = anim == "crouch_walk"; bob = abs(math.sin(ph)) * .5 if walk else [0, .3, .5, .3][f]
        P.update(bob=bob, by=-6 + bob, hipz=6.5 + bob * .3, lean=2.2 if walk else 2, bent=True, ground=True,
                 expr="focus" if walk else ("blink" if f == 3 else "normal"))
        def leg(side, hipz, back=0.0, walk=walk, ph=ph):
            fw = (math.sin(ph) if side < 0 else -math.sin(ph)) * 2.6 if walk else 0
            lift = max(0, math.cos(ph) if side < 0 else -math.cos(ph)) * 2 if walk else 0
            return (side * 3.6, -1, hipz), (side * 4.6, 4.2 + fw * .6, 6.3 + lift * .5), (side * 4.0, 1.8 + fw, 2.2 + lift)
        P["leg"] = leg
        P["hands"] = lambda bz, shw, walk=walk, ph=ph: {s: (s * (shw - 1.5), 5.5 - (math.sin(ph) * s * .8 if walk else 0), bz - 3.5) for s in (-1, 1)}
    elif anim in ("carry_idle", "carry_walk"):
        walk = anim == "carry_walk"
        P.update(bob=(abs(math.sin(ph)) * 1.0 - .3) if walk else [0, .4, .7, .4][f], back=-.5, lean=.2, dv=(-.35, .5, .8), dvL=(.35, .5, .8), sockets=("carry",),
                 expr="normal" if walk or f != 3 else "blink")
        if walk: P["legs"] = _walk_legs(ph, 3.0, 2.6)
        P["hands"] = lambda bz, shw: {s: (s * 3.4, 7.5, bz + 2.5) for s in (-1, 1)}
    elif anim == "sleep":
        br = [0, .25, .4, .25][f]
        P.update(bob=br, by=-9 + br * .5, hipz=4.2, lean=2.6, tilt=[-1.5, -2, -2.2, -2][f], bent=True, ground=True, expr="sleepy", dv=(0, .8, -.6), dvL=(0, .8, -.6))
        P["leg"] = lambda side, hipz: ((side * 3.6, -1, hipz), (side * 4.0, 4.5, 9.5), (side * 3.9, 7.5, 2.2))
        P["hands"] = lambda bz, shw: {s: (s * 4.2, 6.5, bz + .5) for s in (-1, 1)}
    elif anim == "vehicle":
        b = [0, .6, .1, -.3][f]
        P.update(bob=b, by=b * .6 - 4, hipz=7.4 + b * .2, lean=1.2, bent=True, seated=True, dv=(.45, .3, .85), dvL=(-.45, .3, .85), sockets=("seat",))
        P["leg"] = lambda side, hipz: ((side * 3.6, -1.2, hipz), (side * 4.0, 5.6, hipz + .6), (side * 3.78, 6.8, 2.2))
        P["hands"] = lambda bz, shw: {s: (s * (shw - 2.8), 8, bz + 2.5) for s in (-1, 1)}
    elif anim == "build":
        R = [(4.5, 2, 9), (4.5, 3.5, 10.5), (3.5, 7, 5), (2, 9.5, -1.5), (2.5, 9, 0), (4, 5, 5)][f]
        P.update(crouch=1.5 + [0, 0, .4, .8, .4, 0][f], lean=1.5, expr="focus",
                 dv=[(0, -.5, .85), (0, -.3, .95), (0, .6, .8), (0, .95, -.3), (0, .9, -.2), (0, .6, .8)][f], dvL=(0, .9, -.4))
        P["hands"] = lambda bz, shw, R=R: {1: (R[0], R[1], bz + R[2]), -1: (-3, 9, bz - 3)}
    else: raise KeyError(anim)
    return P

def _proj_anchor(P, h, dv):
    nn = math.sqrt(sum(v * v for v in dv)); dv = tuple(v / nn for v in dv)
    (a2, _), (b2, _) = P(*h), P(h[0] + dv[0] * 10, h[1] + dv[1] * 10, h[2] + dv[2] * 10)
    return {"x": round(a2[0], 2), "y": round(a2[1], 2), "angle": round(math.degrees(math.atan2(b2[0] - a2[0], -(b2[1] - a2[1]))), 1),
            "len": round(math.hypot(b2[0] - a2[0], b2[1] - a2[1]) / 10, 3)}

def pose(bt, d, anim, fi, n):
    """rig.pose-compatible keypoints (+ K['sockets'] world points, K['ground'] = draw the contact shadow ourselves)."""
    if anim in V1_POSE:
        K = rig.pose(bt, d, anim, fi, n); K["sockets"] = {}
        if anim == "sit": K["sockets"]["seat"] = (0, -1.2, K["hips"][1][2] - 1.6)
        return K
    B = BODY[bt]; Q = params(anim, fi, n)
    bob, crouch, back, lean, tilt = Q["bob"], Q["crouch"], Q["back"], Q["lean"], Q["tilt"]
    by = Q.get("by", bob - crouch); bz = 19 + by; hipz = Q.get("hipz", 11 + by * .5)
    rg = Rig(None, DIR_PHI[d], FW / 2, FEET)
    K = dict(sit=bool(Q["bent"] or Q["seated"]), ground=Q["ground"], bt=bt, B=B, d=d, anim=anim, fi=fi, n=n, rig=rg, expr=Q["expr"],
             tilt=tilt, back=back, lean=lean, bob=bob, by=by, bz=bz, hips={}, feet={}, knees={})
    for i, side in enumerate((-1, 1)):
        if Q.get("leg"):
            hip, knee, foot = Q["leg"](side, hipz); hip = (hip[0], hip[1] + back * .3, hip[2])
        else:
            fwd, lift = Q["legs"][i]
            hip = (side * B["hipw"], back * .3, hipz); foot = (side * B["hipw"] * 1.05, fwd + back * .2, 2.2 + lift)
            knee = tuple((h + f) / 2 for h, f in zip(hip, foot))
        K["hips"][side], K["knees"][side], K["feet"][side] = hip, knee, foot
    K["tc"] = (tilt * .25, back * .4 + lean * .4, bz); K["hipc"] = (0, back * .3, hipz + 1.0)
    shw = B["shw"]; H = Q["hands"](bz, shw)
    K["sh"] = {s: (s * shw, back * .4 + lean * .5, bz + 5.5) for s in (-1, 1)}; K["hand"] = H
    K["hc"] = (tilt * .5, lean + back * .6, 37 + by); K["hr"] = B["hr"]
    Pj = rg.proj; _, tv = Pj(*K["tc"]); K["tv"] = tv; K["front"] = {}
    for side in (-1, 1):
        # v2: an arm is "front" by its HAND depth (v1 used max(shoulder, hand)), so arms reaching forward stay behind the torso
        # when seen from behind instead of being painted across the back (aim / carry / block / bow from N, NW, NE)
        _, vb = Pj(*H[side]); K["front"][side] = vb - .5 + (.3 if side == 1 else 0) >= tv
    K["anchor"] = {**_proj_anchor(Pj, H[1], Q["dv"]), "behind": not K["front"][1]}
    dvL = Q["dvL"] or (-Q["dv"][0], Q["dv"][1], Q["dv"][2])
    K["anchorL"] = {**_proj_anchor(Pj, H[-1], dvL), "behind": not K["front"][-1]}
    K["sockets"] = {}
    if "carry" in Q["sockets"]: K["sockets"]["carry"] = (0, 8.8, bz + 3.2)
    if "seat" in Q["sockets"]: K["sockets"]["seat"] = (0, -1.2, hipz - 1.6)
    return K
