#!/usr/bin/env python3
"""Player v2 SAMPLE: `sleep_lie` - hand-built lying-down sleep set (spec player_v2_spec.md §6b).

Whole flat sprites (NOT the upright rig): the sleeper is modelled once as a small set of rounded solids lying on its
back on the mattress (head on the pillow, one hand on the belly, toes up), ray-cast per pixel in the bed's own iso
projection, cel-shaded (3 tones, light from top-left) and inked, then split per paper-doll layer with the exact
painter's occlusion of the composite (a layer's texel is dropped where a LOWER layer is nearer the camera).

Directions = the 4 bed rotations (bed / bed_* / bunk_bed / dec_bed_double_* are all rotationArt "unique4": rotation r
turns local (x,y) -> (-y,x) r times; head end = local -y). dirFrames index = frame*4 + rot; pass facing = rot*PI/2
to AssetRegistry.resolve() (directionIndex(rot*PI/2, 4) == rot).
Pivot = the bed's footprint centre on the ground (the same point as the bed sprite's anchor), so the sprite is drawn
at the bed's position (+ the per-piece bedFits offset from sample.v2.json for doubles / bunks).
Reference bed: main-pack `bed` (1x2, mattress top z 14, blanket z 16, pillow top z 19).
frameMeta anchors (pivot-relative 1x px): bed = sleeper's hip contact on the mattress (the bed socket), head = head
centre (Zzz / bubble FX), pillow = pillow centre under the head.
Layers (tint R=primary/skin/hair, G=secondary): body (skin), bottom (cargo), shoes (boots), top (henley), face, eyes
(closed), hair (UNCOVERED buzz: the hat comes off in bed). Hat / sleeves / armfront have no sleep_lie twin = hidden."""
import math, numpy as np
from PIL import Image
from scipy import ndimage

TILE = 32 * math.sqrt(2)          # world px per tile edge (iso 64x32 tile)
K = 32 / TILE                     # screen px per world px (horizontal)
FWL, FHL = 96, 88                 # 1x frame
OX, OY = 48, 60                   # pivot = bed footprint centre (ground) in the frame
S = 4                             # supersample per 1x px
NF, FPS = 4, 2                    # breathing loop
ROTS = 4
NEU = [(255, 255, 255), (236, 230, 236), (196, 184, 204), (140, 122, 150)]
NEU_INK = (96, 70, 90)
TAPE = [(232, 228, 214), (206, 202, 188), (168, 166, 158), (122, 120, 122)]
INK = (74, 47, 61)
BLUSH = (238, 156, 150)
# role -> (hl, base, shade, ink, tint)
ROLE = {"P": (NEU[0], NEU[1], NEU[2], NEU_INK, (1, 0)), "S": (NEU[0], NEU[1], NEU[2], NEU_INK, (0, 1)),
        "T": (TAPE[0], TAPE[1], TAPE[2], (110, 96, 100), (0, 0)), "I": (INK, INK, INK, INK, (0, 0)),
        "B": (BLUSH, BLUSH, BLUSH, BLUSH, (0, 0))}
RID = {k: i + 1 for i, k in enumerate(ROLE)}
LIGHT = np.array([-.55, -.15, .82]); LIGHT /= np.linalg.norm(LIGHT)
Z_MAT, Z_BL, Z_PIL = 14, 16, 19   # reference bed (main pack `bed`): mattress, blanket, pillow tops
HEAD = (0.0, -27.5, 25.0); HR = 10.5
HIP = (0.0, 6.0, Z_BL)            # bed socket: hip contact on the blanket
PILLOW = (0.0, -28.5, Z_PIL)
# sleep layers: (v1/v2 part key the twin belongs to, slot, layer, tintChannels)
LAYERS = [("body_male", "body", 0, 1), ("cz_bottom_cargo_male", "bottom", 18, 2), ("cz_shoes_boots_male", "shoes", 19, 2),
          ("cz_top_henley_male", "top", 20, 2), ("cz_face_smile_male", "face", 40, 1), ("cz_eyes_round_male", "eyes", 41, 2),
          ("cz_hair_buzz_male", "hair", 45, 2)]
ORDER = {l[1]: l[2] for l in LAYERS}

def rot_xy(x, y, r):
    for _ in range(r % 4): x, y = -y, x
    return x, y

def proj(p, r):
    """bed-local world px (rot0) -> 1x frame px"""
    x, y = rot_xy(p[0] / TILE, p[1] / TILE, r)
    return (OX + (x - y) * 32, OY + (x + y) * 16 - p[2])

def rel(p, r):
    x, y = proj(p, r); return {"x": round(x - OX, 2), "y": round(y - OY, 2)}

# ---------------------------------------------------------------- primitives (local coords, analytic nearest hit)
def _dot(a, b): return (a * b).sum(-1)

class Prim:
    def __init__(s, layer, role="P", clip=Z_MAT - .5, cut=None, deco=None, name=""):
        s.layer, s.role, s.clip, s.cut, s.deco, s.name = layer, role, clip, cut, deco, name

class Ell(Prim):
    def __init__(s, c, R, layer, **kw): super().__init__(layer, **kw); s.c = np.array(c, float); s.R = np.array(R, float)
    def hit(s, o, d):
        oo = (o - s.c) / s.R; dd = d / s.R; A = _dot(dd, dd); B = _dot(dd, oo); C = _dot(oo, oo) - 1; h = B * B - A * C
        t = np.where(h >= 0, (-B + np.sqrt(np.maximum(h, 0))) / A, -np.inf)
        p = o + t[..., None] * d; n = (p - s.c) / s.R ** 2; n /= np.linalg.norm(n, axis=-1, keepdims=True) + 1e-9
        return t, p, n, {"q": (p - s.c) / s.R}

class Cap(Prim):
    def __init__(s, a, b, r, layer, **kw): super().__init__(layer, **kw); s.a = np.array(a, float); s.b = np.array(b, float); s.r = r
    def hit(s, o, d):
        T = 400.0; ro = o + T * d; rd = -d; a, b, r = s.a, s.b, s.r   # iq capsule (nearest hit from the camera side)
        ba = b - a; oa = ro - a; baba = ba @ ba; bard = rd @ ba; baoa = oa @ ba; rdoa = _dot(rd, oa); oaoa = _dot(oa, oa)
        A = baba - bard * bard; B = baba * rdoa - baoa * bard; C = baba * oaoa - baoa * baoa - r * r * baba; h = B * B - A * C
        t = np.full(o.shape[:-1], np.inf); ok = h >= 0
        tb = (-B - np.sqrt(np.maximum(h, 0))) / A; y = baoa + tb * bard
        body = ok & (y > 0) & (y < baba); t = np.where(body, tb, t)
        oc = np.where((y <= 0)[..., None], oa, ro - b); bb = _dot(rd, oc); cc = _dot(oc, oc) - r * r; hh = bb * bb - cc
        tc = -bb - np.sqrt(np.maximum(hh, 0)); t = np.where(ok & ~body & (hh > 0), tc, t)
        t = np.where(np.isfinite(t), T - t, -np.inf)
        p = o + t[..., None] * d; u = np.clip(_dot(p - a, ba) / baba, 0, 1); n = p - (a + u[..., None] * ba)
        n /= np.linalg.norm(n, axis=-1, keepdims=True) + 1e-9
        return t, p, n, {"u": u}

# ---------------------------------------------------------------- the sleeper
def head_frame(r):
    """the sleeper turns its head ~40 deg toward the camera's side (reads as a face at this low iso angle):
    returns unit (face forward, crown, right) axes in bed-local coords for rotation r"""
    side = 1.0 if rot_xy(1.0, 1.0, (4 - r) % 4)[0] > 0 else -1.0
    f = np.array([side * .85, .12, 1.0]); f /= np.linalg.norm(f)
    up = np.array([0, -1.0, 0]); up -= (up @ f) * f; up /= np.linalg.norm(up)
    return f, up, np.cross(up, f)

def figure(br, r=0):
    """br = breath 0..1 (chest rise), r = bed rotation (head turn side); returns the primitive list"""
    hx, hy, hz = HEAD; hz += .25 * br; P = []
    c = (hx, hy, hz); face_ax, crown, rgt = head_frame(r)
    def q(p): return (p - np.array(c)) / HR
    # body (skin)
    P.append(Ell(c, (HR, HR, HR), "body", clip=Z_PIL - .5, name="head"))
    for sx in (-1, 1):
        e = np.array(c) + rgt * sx * (HR + .1) - crown * .6; P.append(Ell(tuple(e), (2.3, 2.3, 2.3), "body", clip=Z_PIL - .5, name="ear"))
    P.append(Cap((0, -18.5, 19), (0, -14, 19), 4.0, "body", name="neck"))
    P.append(Ell((0, -4, Z_MAT + 2), (9, 12.5, 6 + br * .7), "body", name="torso"))
    P.append(Ell((0, 8, 17), (7.8, 5.5, 5), "body", name="pelvis"))
    LEG = {}
    for sx in (-1, 1):
        kz = 18.5 + (2.5 if sx < 0 else 0)            # left knee slightly raised
        hip, knee, ank, toe = (sx * 4, 9, 18.5), (sx * 4.6, 21, kz), (sx * 5, 32, 18), (sx * 6.6, 35.6, 25)
        LEG[sx] = (hip, knee, ank, toe)
        P += [Cap(hip, knee, 3.8, "body", name="thigh"), Cap(knee, ank, 3.2, "body", name="shin"), Cap(ank, toe, 2.6, "body", name="foot")]
    ARM = {1: ((10, -11, 19), (11.5, -1, 18.5), (4, 1, 23 + br * .7), (3, 1.8, 23.6 + br * .7)),
           -1: ((-10, -11, 19), (-11.6, -.5, 17.5), (-11, 8, 17), (-10.6, 10.5, 17.3))}
    for sx, (sh, el, wr, hd) in ARM.items():
        P += [Cap(sh, el, 3.0, "body", name="uarm"), Cap(el, wr, 2.7, "body", name="farm"),
              Ell(hd, (3.0, 3.3, 2.1), "body", name="hand")]
    # top (henley + scrappy chest patch / sleeve tape)
    def top_deco(p, n, aux):
        out = np.full(p.shape[:-1], RID["P"])
        x, y = p[..., 0], p[..., 1]
        out[(np.abs(x) < 1.3) & (y > -15.5) & (y < -6.5)] = RID["S"]                               # placket
        for by in (-13.2, -10.6, -8.0): out[(x ** 2 + (y - by) ** 2) < .55] = RID["I"]                # buttons
        out[y < -14.6] = RID["S"]                                                                   # round collar
        pm = (x > -7.6) & (x < -2.6) & (y > -9) & (y < -3.6); out[pm] = RID["S"]                   # patch
        st = pm & ((np.abs(x + 7.3) < .35) | (np.abs(x + 2.9) < .35)) & ((np.floor(y * .9) % 2) == 0); out[st] = RID["I"]  # stitches
        return out
    P.append(Ell((0, -4, Z_MAT + 2), (9.9, 13.2, 6.9 + br * .7), "top", cut=lambda p, n, a: p[..., 1] < 8.6, deco=top_deco, name="ttorso"))
    for sx, (sh, el, wr, hd) in ARM.items():
        P.append(Ell(sh, (4.3, 4.3, 4.3), "top", name="tshoulder"))
        tape = (lambda p, n, a, sx=sx: np.where((a["u"] > .45) & (a["u"] < .7), RID["T"], RID["P"])) if sx > 0 else None
        P.append(Cap(sh, el, 4.0, "top", deco=tape, name="tuarm"))
        P.append(Cap(el, wr, 3.7, "top", cut=lambda p, n, a: a["u"] < .86, deco=lambda p, n, a: np.where(a["u"] > .7, RID["S"], RID["P"]), name="tfarm"))
    # bottom (cargo: waistband, side pockets, taped left knee)
    P.append(Ell((0, 8, 17), (8.7, 6.3, 5.9), "bottom", deco=lambda p, n, a: np.where(p[..., 1] < 3.6, RID["S"], RID["P"]), name="bpelvis"))
    for sx, (hip, knee, ank, toe) in LEG.items():
        def pocket(p, n, a, sx=sx):
            pm = (a["u"] > .3) & (a["u"] < .7) & (n[..., 0] * sx > .3); out = np.where(pm, RID["S"], RID["P"])
            out[pm & (a["u"] < .37)] = RID["I"]; return out
        P.append(Cap(hip, knee, 4.9, "bottom", deco=pocket, name="bthigh"))
        kt = (lambda p, n, a: np.where((a["u"] < .22) & (n[..., 2] > .2), RID["T"], RID["P"])) if sx < 0 else None
        P.append(Cap(knee, ank, 4.3, "bottom", cut=lambda p, n, a: a["u"] < .8, deco=kt, name="bshin"))
        P.append(Ell(knee, (4.6, 4.6, 4.6), "bottom", deco=(lambda p, n, a: np.where(n[..., 2] > .25, RID["T"], RID["P"])) if sx < 0 else None, name="bknee"))
    # shoes (boots: cuffs, soles, laces, taped toe)
    for sx, (hip, knee, ank, toe) in LEG.items():
        sh0 = (ank[0] - sx * .2, ank[1] - 4.2, ank[2])
        P.append(Cap(sh0, ank, 3.8, "shoes", deco=lambda p, n, a: np.where(a["u"] < .25, RID["S"], RID["P"]), name="sshaft"))
        def boot(p, n, a, sx=sx):
            out = np.full(p.shape[:-1], RID["P"]); ny, nz = n[..., 1], n[..., 2]
            out[(ny > .55) & (a["u"] > .15)] = RID["S"]                                              # sole (faces the foot end)
            for u0 in (.32, .52): out[(np.abs(a["u"] - u0) < .055) & (ny < -.15)] = RID["I"]         # laces
            if sx < 0: out[(a["u"] > .78) & (nz > .3)] = RID["T"]
            return out
        P.append(Cap(ank, toe, 3.5, "shoes", deco=boot, name="sfoot"))
    # face / eyes / hair are skins over the head sphere
    def fq(p): qq = q(p); return _dot(qq, rgt), -_dot(qq, crown), _dot(qq, face_ax)   # u right, v toward the chin, f forward
    def face_deco(p, n, a):
        u, v, f = fq(p); out = np.zeros(p.shape[:-1], int)
        out[(np.abs(v - (.4 - 1.5 * u * u)) < .042) & (np.abs(u) < .19) & (f > .3)] = RID["I"]          # little smile
        for su in (-1, 1): out[(((u - su * .52) / .15) ** 2 + ((v - .24) / .08) ** 2 < 1) & (f > .3)] = RID["B"]
        return out
    P.append(Ell(c, (HR + .15,) * 3, "face", clip=Z_PIL - .5, deco=face_deco, cut=lambda p, n, a: face_deco(p, n, a) > 0, name="face"))
    def eye_deco(p, n, a):
        u, v, f = fq(p); out = np.zeros(p.shape[:-1], int)
        for su in (-1, 1):
            du = u - su * .35; out[(np.abs(v - (.1 - 2.0 * du * du)) < .045) & (np.abs(du) < .17) & (f > .3)] = RID["I"]  # closed lids
            out[(np.abs(du - su * .17) < .035) & (v > .0) & (v < .1) & (f > .3)] = RID["I"]                                # outer lash
        return out
    P.append(Ell(c, (HR + .25,) * 3, "eyes", clip=Z_PIL - .5, deco=eye_deco, cut=lambda p, n, a: eye_deco(p, n, a) > 0, name="eyes"))
    def hair_cut(p, n, a):
        u, v, f = fq(p); return (v < -.28 + .3 * (1 - f) - .25 * u * u) | ((f < .15) & (v < .45))   # crown + forehead hairline, back/sides
    P.append(Ell(c, (HR + .7, HR + .9, HR + .6), "hair", clip=Z_PIL - .5, cut=hair_cut, name="hair"))
    return P

# ---------------------------------------------------------------- ray-cast + cel + ink
def rays(r):
    ys, xs = np.mgrid[0:FHL * S, 0:FWL * S].astype(np.float64); sx = (xs + .5) / S - OX; sy = (ys + .5) / S - OY
    a = sx / K; b = 2 * sy / K; wx = (a + b) / 2; wy = (b - a) / 2
    o = np.stack([wx, wy, np.zeros_like(wx)], -1); d = np.array([1.0, 1.0, K]); d /= np.linalg.norm(d)
    lx, ly = rot_xy(o[..., 0], o[..., 1], (4 - r) % 4); dl = rot_xy(d[0], d[1], (4 - r) % 4)
    return np.stack([lx, ly, o[..., 2]], -1), np.array([dl[0], dl[1], d[2]])

@np.errstate(all="ignore")
def render(r, fi):
    br = [0, .5, 1, .5][fi]; o, d = rays(r); prims = figure(br, r)
    H, W = o.shape[:2]; per = {}
    for pi, pr in enumerate(prims):
        t, p, n, aux = pr.hit(o, d)
        ok = np.isfinite(t) & (p[..., 2] >= pr.clip)
        if pr.cut is not None: ok &= pr.cut(p, n, aux)
        role = pr.deco(p, n, aux) if pr.deco is not None else np.full((H, W), RID[pr.role])
        L = per.setdefault(pr.layer, {"t": np.full((H, W), -np.inf), "role": np.zeros((H, W), int), "n": np.zeros((H, W, 3)), "id": np.full((H, W), -1)})
        better = ok & (t > L["t"]) & (role > 0)
        L["t"][better] = t[better]; L["role"][better] = role[better]; L["n"][better] = n[better]; L["id"][better] = pi
    out = {}
    for key, slot, lay, _ in LAYERS:
        L = per[slot]; vis = np.isfinite(L["t"])
        for s2, L2 in per.items():                       # painter's occlusion: drop texels a LOWER layer covers
            if ORDER[s2] < lay: vis &= ~(np.isfinite(L2["t"]) & (L2["t"] > L["t"] + .35))
        out[slot] = shade(L, vis)
    return out

# Bed parts that sit between the sleeper and the camera are baked in as occlusion cuts (the engine draws the sleeper
# after the bed sprite), one animation per "fit" (bed-local tiles x, y / z px, relative to the reference sleep spot):
#   sleep_lie        reference `bed` boards (assets/tools/buildings.py bed()): headboard x+-0.5 y-1.0..-0.88 z0..30,
#                    footboard y0.86..0.98 z0..16. Also used for dec_bed_double_* (boards 32/38 high) and the bunk upper.
#   sleep_lie_under  dec_bunk_bed lower bunk: the upper bunk's slab+mattress (x+-0.42, y-0.9..0.9, z36..50 in bunk
#                    coords = y-0.835..0.965, z35..49 relative to the reference spot); no boards at that level.
CUTS = {"sleep_lie": [((-.5, .5), (-1.0, -.88), (0.0, 30.0)), ((-.5, .5), (.86, .98), (0.0, 16.0))],
        "sleep_lie_under": [((-.42, .42), (-.835, .965), (35.0, 49.0))]}
ANIMS = list(CUTS)
def cut_tmax(r, boxes):
    """per SS pixel: largest ray parameter at which the ray is inside one of the boxes (-inf = misses)"""
    o, d = rays(r); out = np.full(o.shape[:2], -np.inf)
    with np.errstate(all="ignore"):
        for bx, by, bz in boxes:
            lo = np.array([bx[0] * TILE, by[0] * TILE, bz[0]]); hi = np.array([bx[1] * TILE, by[1] * TILE, bz[1]])
            t1 = (lo - o) / d; t2 = (hi - o) / d
            tn = np.minimum(t1, t2).max(-1); tx = np.maximum(t1, t2).min(-1)
            out = np.where(tx > tn, np.maximum(out, tx), out)
    return out

def shade(L, vis):
    role = np.where(vis, L["role"], 0)
    return {"vis": vis, "role": role, "t": np.where(vis, L["t"], -np.inf), "n": L["n"], "id": np.where(vis, L["id"], -1)}

@np.errstate(all="ignore")
def finish(Ls, r, ring_px=3.0):
    """cel colours + ink ring + inner depth-edge ink -> SS RGBA + 2ch tint mask (face/eyes decals: no ring)"""
    vis, role, t, n, pid = Ls["vis"], Ls["role"], Ls["t"], Ls["n"], Ls["id"]
    Lloc = np.array([*rot_xy(LIGHT[0], LIGHT[1], (4 - r) % 4), LIGHT[2]]); ndl = (n * Lloc).sum(-1)
    H, W = vis.shape; rgb = np.zeros((H, W, 3)); tm = np.zeros((H, W, 2))
    for k, i in RID.items():
        hl, base, sh, ink, tint = ROLE[k]; m = vis & (role == i)
        c = np.where((ndl < .22)[..., None], sh, np.where((ndl > .93)[..., None], hl, base))
        rgb[m] = c[m]; tm[m] = tint
    # inner ink: texel next to a clearly nearer texel of another primitive (outline drawn on the far side)
    inner = np.zeros((H, W), bool); RAD = 3
    for dy in range(-RAD, RAD + 1):
        for dx in range(-RAD, RAD + 1):
            if dx * dx + dy * dy > RAD * RAD or (dx == 0 and dy == 0): continue
            tn = np.roll(np.roll(t, dy, 0), dx, 1); idn = np.roll(np.roll(pid, dy, 0), dx, 1)
            inner |= vis & (idn >= 0) & (idn != pid) & (tn > t + 2.2)
    inkc = np.zeros((H, W, 3))
    for k, i in RID.items(): inkc[role == i] = ROLE[k][3]
    rgb[inner] = inkc[inner]
    # outer ring: 3 SS px around the silhouette, colour/tint of the nearest figure texel
    dist, (iy, ix) = ndimage.distance_transform_edt(~vis, return_indices=True)
    ring = (~vis) & (dist <= ring_px)
    rgb[ring] = inkc[iy[ring], ix[ring]]; tm[ring] = tm[iy[ring], ix[ring]]
    a = (vis | ring).astype(np.float64)
    return rgb, a, tm

def down(rgb, a, tm, f, pal):
    H, W = a.shape; h, w = H // f, W // f
    def box(x): return x.reshape(h, f, w, f, *x.shape[2:]).mean(axis=(1, 3))
    A = box(a); C = box(rgb * a[..., None]) / np.maximum(A[..., None], 1e-6); M = box(tm * a[..., None]) / np.maximum(A[..., None], 1e-6)
    P = np.array(sorted(pal), np.float64); dd = ((C[..., None, :] - P[None, None]) ** 2).sum(-1); C = P[dd.argmin(-1)]
    fig = A >= .5; img = np.zeros((h, w, 4), np.uint8); img[fig, :3] = np.round(C[fig]); img[fig, 3] = 255
    m = np.zeros((h, w, 3), np.uint8); m[..., 0] = np.where(fig & (M[..., 0] >= .5), 255, 0); m[..., 1] = np.where(fig & (M[..., 1] >= .5), 255, 0)
    return img, m

PAL = {tuple(c) for k in ROLE for c in ROLE[k][:4]}

def frame_job(args):
    """-> (r, fi, {anim: {slot: (img1x, mask1x, img2x, mask2x)}}, anchors)"""
    r, fi = args; L = render(r, fi); res = {an: {} for an in ANIMS}; tbs = {an: cut_tmax(r, CUTS[an]) for an in ANIMS}
    for key, slot, lay, _ in LAYERS:
        rgb, a, tm = finish(L[slot], r, 0.0 if slot in ("face", "eyes") else 3.0)
        tf = L[slot]["t"]; _, (iy, ix) = ndimage.distance_transform_edt(~np.isfinite(tf), return_indices=True)
        tfx = tf[iy, ix]                                  # figure depth, extended under the ink ring
        for an in ANIMS:
            ac = np.where((a > 0) & (tbs[an] > tfx), 0.0, a)
            i1, m1 = down(rgb, ac, tm, S, PAL); i2, m2 = down(rgb, ac, tm, S // 2, PAL)
            res[an][slot] = (i1, m1, i2, m2)
    anc = {"bed": rel(HIP, r), "head": rel((HEAD[0], HEAD[1], HEAD[2] + .25 * [0, .5, 1, .5][fi]), r), "pillow": rel(PILLOW, r)}
    return r, fi, res, anc

# ---------------------------------------------------------------- bed fits (sample.v2.json): where each bed's sleep spot is
# relative to the reference bed's, per rotation, in pivot-relative 1x px. Local rot0 (tiles, z px) sleep-spot data read
# off the building generators: assets/tools/buildings.py bed() and pack/building/src/decor/furniture.py.
BEDS = {   # piece: [(slot name, local x tiles, pillow-centre y tiles, blanket-top z px)]
    "bed": [("single", 0.0, -.635, 16)],
    "bed_double_*": [("left", -.37, -.65, 19), ("right", .37, -.65, 19)],       # dec_bed_double_{rustic,fine,luxury}(+__variant)
    "bunk_bed": [("lower", 0.0, -.70, 17), ("upper", 0.0, -.70, 47)],             # dec_bunk_bed
}
def bed_fits():
    ref = BEDS["bed"][0]; out = {}
    for piece, spots in BEDS.items():
        out[piece] = {}
        for nm, x, y, z in spots:
            dx, dy, dz = x * TILE, (y - ref[2]) * TILE, z - ref[3]; offs = []
            for r in range(ROTS):
                a, b = rot_xy(dx / TILE, dy / TILE, r); offs.append({"x": round((a - b) * 32, 2), "y": round((a + b) * 16 - dz, 2)})
            out[piece][nm] = offs
    return out
