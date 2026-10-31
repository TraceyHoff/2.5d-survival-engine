#!/usr/bin/env python3
"""Player v2 SAMPLE (spec: player_v2_spec.md; style: cute cel base + scrappy patched/taped/frayed gear).
One body (male) and the exact v1 sample appearance (top_henley + sleeves, bottom_cargo, shoes_boots, hat_cap,
hair_buzz uncovered + hathair, face_smile, eyes_round; scrappy overlay = patches/tape/fray) in all 8 facings for every
v2_anims animation, on an ISOLATED fragment:
  packages/assets/pack/customization_v2_sample/manifest.customization_v2_sample.json   (keys v2s_<exact v1 part key>)
Residency: the core group (idle/walk/attack) atlases are resident in the ADR-220 character pools (body -> "body",
worn layers -> "wear"); combat/ranged/pose and the sleep set stream.
Plus `sleep_lie` / `sleep_lie_under` (v2_sleep_lie.py): hand-built whole flat lying sprites, 4 directions = the bed's
rotation, pivot = the bed's footprint centre, bed socket = frameMeta anchor "bed"; added to the same v2s_ sprites.
Nothing in the v1 customization pack is read-modified or replaced; this tool only imports the v1 rig/parts code.
Frames: 48x80 (1x) / 96x160 (@2x), pivot (24,74); dirFrames entry i = frame*8 + dir; frameMeta "df:i" anchors
(pivot-relative 1x px): head, handR (x, y, angle = DEGREES clockwise from up as v1/handOf, len, behind), handL, plus v2
extras back, hip, footL, footR (+ carry / seat sockets on those anims).
Usage: python3 assets/customization/tools/v2_sample.py [--jobs N]
  then: python3 assets/tools/ktx2.py packages/assets/pack/customization_v2_sample/manifest.customization_v2_sample.json"""
import sys, os, json, math, argparse
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
sys.path.append(os.path.join(os.path.dirname(os.path.dirname(HERE)), "tools"))
import numpy as np
from PIL import Image
from multiprocessing import Pool
import rig, parts, render
import v2_anims, v2_sleep_lie as SL
from PIL import ImageOps
from rig import FW, FH, FEET, PAD

ROOT = os.path.abspath(os.path.join(HERE, "../../.."))
NAME = "customization_v2_sample"; OUT = os.path.join(ROOT, "packages/assets/pack", NAME)
BT = "male"; DIRS = 8; PIV = (FW / 2, FEET)
ANIMS = [(a[0], a[1], a[2], a[3]) for a in v2_anims.ANIMS]   # name, frames, fps, loop (idle/walk/attack/sit = v1 parity)
GROUP = {a[0]: a[4] for a in v2_anims.ANIMS}; GROUPS = ["core", "combat", "ranged", "pose"]
TAPE = [(232, 228, 214), (206, 202, 188), (168, 166, 158), (122, 120, 122)]      # untinted grey duct tape
INK = (74, 47, 61)
V1_HEAD = (0, -29.65); ATTACH_HEAD = {"x": 0, "y": -26.65}   # v1 body frameMeta head / sprite attach.head: 3 px neck lift (ADR-128)

# Exact v1 part keys of the sample appearance (male + top_henley / bottom_cargo / shoes_boots / hat_cap / hair_buzz /
# face_smile / eyes_round): every layer's v2s_ sprite is "v2s_" + the v1 sprite key the appearance resolves to, so the
# v2 resolver maps 1:1 (spec §10). Base specs come from the v1 catalog (read-only import) + the v2 scrappy overlay.
import catalog
_CAT = {k: s for k, _slot, s, _kw in catalog.W}
def _spec(wk, **kw): return {**_CAT[wk], **kw}
APPEARANCE = {"bodyType": BT, "top": "top_henley", "bottom": "bottom_cargo", "shoes": "shoes_boots", "hat": "hat_cap",
              "hair": "hair_buzz", "face": "face_smile", "eyes": "eyes_round"}
# (sprite key = v1 part key, slot, base spec, hat flag, part, layer, tintChannels, v1 wearable, v1 sprite, variant)
LAYERS = [
    ("body_male", "body", {}, False, None, 0, 1, None, "body_male", None),
    ("cz_bottom_cargo_male", "bottom", _spec("bottom_cargo", scrap=True), False, None, 18, 2, "bottom_cargo", "cz_bottom_cargo_male", None),
    ("cz_shoes_boots_male", "shoes", _spec("shoes_boots", scrap=True), False, None, 19, 2, "shoes_boots", "cz_shoes_boots_male", None),
    ("cz_top_henley_male", "top", _spec("top_henley", scrap=True), False, "main", 20, 2, "top_henley", "cz_top_henley_male", None),
    ("cz_face_smile_male", "face", _spec("face_smile"), False, None, 40, 1, "face_smile", "cz_face_smile_male", None),
    ("cz_eyes_round_male", "eyes", _spec("eyes_round"), False, None, 41, 2, "eyes_round", "cz_eyes_round_male", None),
    ("cz_hair_buzz_male", "hair", _spec("hair_buzz"), False, None, 45, 2, "hair_buzz", "cz_hair_buzz_male", "uncovered"),
    ("cz_hair_buzz_male_hathair", "hair", _spec("hair_buzz"), True, None, 45, 2, "hair_buzz", "cz_hair_buzz_male_hathair", "hatHair"),
    ("cz_top_henley_male_sleeves", "top", _spec("top_henley", scrap=True), False, "sleeves", 31, 2, "top_henley", "cz_top_henley_male_sleeves", None),
    ("cz_hat_cap_male", "hat", _spec("hat_cap", scrap=True), False, None, 50, 2, "hat_cap", "cz_hat_cap_male", None),
    # arm-front overlays (v2-only, no v1 twin): the front forearm+hand re-drawn above the head group on frames where it
    # passes in front of the face/hair/hat (aim, block, overhead swings seen from behind); empty elsewhere.
    ("body_male_armfront", "body", {}, False, "armfront", 56, 1, None, None, None),
    ("cz_top_henley_male_armfront", "top", _spec("top_henley", scrap=True), False, "armfront", 57, 2, "top_henley", None, None),
]
POOL = lambda slot: "body" if slot == "body" else "wear"   # ADR-220 character pools: body sheets -> body pool, worn layers -> wear pool

def stitches(cv, a, b, n=3, w=.42):
    """short ink ticks across segment a->b (cross-stitch look, ~1 px at 1x, crisp at @2x)"""
    dx, dy = b[0] - a[0], b[1] - a[1]; L = math.hypot(dx, dy) or 1; nx, ny = -dy / L * .7, dx / L * .7
    for i in range(n):
        t = (i + .5) / n; p = (a[0] + dx * t, a[1] + dy * t)
        cv.line([(p[0] - nx, p[1] - ny), (p[0] + nx, p[1] + ny)], INK, w)

def patch(cv, p, w, h, rot=0.0, clip=None, rp="S"):
    ca, sa = math.cos(rot), math.sin(rot)
    q = [(p[0] + x * ca - y * sa, p[1] + x * sa + y * ca) for x, y in ((-w, -h), (w, -h * .9), (w * .95, h), (-w * 1.05, h * .95))]
    cv.part(q, rp, lw=.55, shade=.18, hl=0, clip=clip)
    stitches(cv, q[0], q[1], 2); stitches(cv, q[2], q[3], 2)
    return q

def frayed(cv, pts, rp="P", h=1.4):
    """zigzag frayed hem: little uneven triangles hanging under each point"""
    for i, p in enumerate(pts):
        hh = h * (1.0 if i % 2 else .65)
        cv.part([(p[0] - .9, p[1] - .4), (p[0] + .9, p[1] - .4), (p[0] + .2 * (1 if i % 3 else -1), p[1] + hh)], rp, lw=.5, shade=.15, hl=0)

def scrap_top(c, spec):
    K = c.K; B = K["B"]; cv = c.cv; f = parts.fv(c); grow = spec.get("grow", .9)
    def torso_over():
        m = cv.mask_from([c.torso_pts(grow)])
        if f > -.25:
            p, v = parts.tsurf(c, -38, -1.5, .95)
            if v > -.1: patch(cv, p, 2.0, 1.8, .15, clip=m)
            p, v = parts.tsurf(c, 42, 4.5, .95)
            if v > -.1: cv.part([(p[0] - 2.2, p[1] - 1.4), (p[0] - 1.2, p[1] - 2.2), (p[0] + 2.2, p[1] + 1.2), (p[0] + 1.2, p[1] + 2.0)], TAPE, lw=.5, shade=.15, hl=.1, clip=m)
        else:
            p, _ = parts.tsurf(c, 180, 1.5, .95); patch(cv, p, 2.4, 2.0, -.1, clip=m)
        hem = []
        for az in range(-180, 180, 24):
            p, v = parts.tsurf(c, az, -8.6, 1.0 + grow * .08)
            if v > .05: hem.append(p)
        frayed(cv, hem)
    c.add(K["tv"] + .04, torso_over)

def scrap_sleeve(c, spec, side):
    K = c.K; B = K["B"]; cv = c.cv; sr = B["arm"] + spec.get("sleeve_grow", 1.2)
    a, b = K["sh"][side], K["hand"][side]
    if side == 1: cv.part(parts.circle(c.p(c.lerp3(a, b, .34)), sr + .35, 1.0), TAPE, lw=.5, shade=.15, hl=.1)
    else:
        q = c.p(c.lerp3(a, b, .52)); cv.part(parts.circle(q, sr * .8, 1.4, wob=.1), "S", lw=.5, shade=.15, hl=0)
        cv.line([(q[0] - 1.1, q[1] - .6), (q[0] + 1.1, q[1] + .6)], INK, .42)

def scrap_leg(c, spec, side):
    K = c.K; B = K["B"]; cv = c.cv; lp = parts.legpath(c, side); L = spec.get("len", .93); lr = B["leg"] + spec.get("grow", .9)
    if side == -1:
        q = c.p(parts.along(c, lp, .34)); cv.part(parts.circle(q, lr + .45, 1.0), TAPE, lw=.5, shade=.15, hl=.1)
    hem = [c.p(c.off(parts.along(c, lp, L - .01), math.sin(t) * (lr + .2), math.cos(t) * (lr + .2) * .5, 0)) for t in np.linspace(-1.3, 1.3, 4)]
    frayed(cv, hem, h=1.2)

def scrap_shoe(c, spec, side):
    K = c.K; cv = c.cv; ft = K["feet"][side]; W = spec.get("w", 2.7)
    if side == -1: cv.part(parts.circle(c.p(c.off(ft, 0, 2.3, -.9)), W + .25, .85), TAPE, lw=.5, shade=.15, hl=.1)
    elif c.nv(0, 1) > -.3:
        up = parts.legpath(c, side)[::-1]; q = c.p(parts.along(c, up, .2)); cv.part(parts.circle(q, 1.4, 1.2, wob=.1), "S", lw=.45, shade=.15, hl=0)

def scrap_hat(c, spec):
    def f():
        if parts.fv(c) < -.2: return
        K = c.K; hr = K["hr"]; p = c.p(parts.hz(c, -hr * .38, hr * .78, hr * .62))
        patch(c.cv, p, 1.7, 1.4, -.25)
    c.add(parts.hv(c) + 3.02, f)

def wrap_side_items(c, fn_side):
    """after the slot's own per-side items (lambda side=side: ...), draw the scrappy overlay for that side"""
    out = []
    for it in c.items:
        d, i, fn, *rest = it; dfl = getattr(fn, "__defaults__", None)
        if dfl and len(dfl) == 1 and dfl[0] in (-1, 1):
            fn = (lambda fn=fn, s=dfl[0]: (fn(), fn_side(s)))
        out.append((d, i, fn, *rest))
    c.items = out

def render_layer(bt, slot, spec, d, anim, fi, n, hat, part):
    K = v2_anims.pose(bt, d, anim, fi, n); c = rig.Ctx(K); c.extra = None
    c.cv.cel = True; c.cv.pal = []; c.cv.detail = slot if slot in render.DETAIL_SLOTS else None
    front_part = part == "armfront"
    if front_part: part = "sleeves" if slot == "top" else None
    if slot == "body" and K.get("ground"): c.cv.shadow(24, 74.5, 10.5, 3.6)   # bent-leg poses on the ground (sit flag skips it in parts.body)
    parts.gear_parts.apply_remap(c, spec); render.draw(c, slot, spec, hat)
    if spec.get("scrap"):
        if slot == "top":
            wrap_side_items(c, lambda s: scrap_sleeve(c, spec, s)); scrap_top(c, spec)
            if c.extra:
                ex = c.extra
                def extra(cc, ex=ex):
                    ex(cc)
                    for s in (-1, 1):
                        if K["front"][s]: scrap_sleeve(c, spec, s)
                c.extra = extra
        elif slot == "bottom": wrap_side_items(c, lambda s: scrap_leg(c, spec, s))
        elif slot == "shoes": wrap_side_items(c, lambda s: scrap_shoe(c, spec, s))
        elif slot == "hat": scrap_hat(c, spec)
    if part == "sleeves": c.items = []; c.run(armcut=False, extra=c.extra)
    elif part == "main": c.run(armcut=True, extra=None)
    else: c.run(armcut=(slot != "body"), extra=c.extra)
    if front_part: c.cv.erase(ImageOps.invert(armfront_mask(c, K)))
    return c.out(), K

def armfront_sides(K):
    """sides whose hand is at/in front of the head's depth and overlaps the head (+hat) on screen"""
    R = K["rig"]; (hx, hy), vh = R.proj(*K["hc"]); out = []
    for s in (-1, 1):
        if not K["front"][s]: continue
        (px, py), vb = R.proj(*K["hand"][s]); mid = tuple(a + (b - a) * .55 for a, b in zip(K["sh"][s], K["hand"][s])); (mx, my), _ = R.proj(*mid)
        near = min(math.hypot(px - hx, py - hy), math.hypot(mx - hx, my - hy)) < K["hr"] + 4.5
        if near and vb >= vh + .5: out.append(s)
    return out

def armfront_mask(c, K):
    B = K["B"]; polys = []
    for s in armfront_sides(K):
        a = c.lerp3(K["sh"][s], K["hand"][s], 0.3)
        polys.append(c.tube(a, K["hand"][s], B["arm"] + .9)); polys.append(rig.circle(c.p(K["hand"][s]), B["hand"] + 1.0))
    return c.cv.mask_from(polys)

def anchors(K):
    R = K["rig"]; P = lambda p3: R.proj(*p3)[0]; rel = lambda p: {"x": round(p[0] - PIV[0], 2), "y": round(p[1] - PIV[1], 2)}
    out = {"head": {"x": V1_HEAD[0], "y": V1_HEAD[1]}}   # ADR-128 neck reference: head motion is baked into head-group art
    if K["anchor"]: a = K["anchor"]; out["handR"] = {"x": round(a["x"] - PIV[0], 2), "y": round(a["y"] - PIV[1], 2), "angle": a["angle"], "len": a["len"], "behind": a["behind"]}
    if K.get("anchorL"): a = K["anchorL"]; out["handL"] = {"x": round(a["x"] - PIV[0], 2), "y": round(a["y"] - PIV[1], 2), **{k: a[k] for k in ("angle", "len", "behind") if k in a}}
    tc = K["tc"]; out["back"] = rel(P((tc[0], tc[1] - K["B"]["trx"] * .8, tc[2] + 2)))
    out["back"]["behind"] = K["d"] in (1, 2, 3)   # S-ish facings: back gear sits behind the body
    out["hip"] = rel(P(K["hipc"])); out["footL"] = rel(P(K["feet"][-1])); out["footR"] = rel(P(K["feet"][1]))
    for nm, p3 in K.get("sockets", {}).items():   # carry: object centre held at the chest (behind the body when facing away); seat: pelvis contact
        out[nm] = rel(P(p3))
        if nm == "carry": out[nm]["behind"] = K["d"] in (5, 6, 7)
    return out

def job(args):
    li, d, anim, fi, n = args; key, slot, spec, hat, part, *_ = LAYERS[li]
    (i1, i2, m1, m2), K = render_layer(BT, slot, spec, d, anim, fi, n, hat, part)
    res = []
    for im, m, s in ((i1, m1, 1), (i2, m2, 2)):
        a = np.asarray(im).copy(); m = np.asarray(m).copy(); p = PAD * s
        for arr in (a, m): arr[:p] = 0; arr[-p:] = 0; arr[:, :p] = 0; arr[:, -p:] = 0
        m[a[..., 3] == 0] = 0; res += [a, m]
    return li, d, anim, fi, res, (anchors(K) if slot == "body" and part != "armfront" else None)

def shelf(sizes, maxw):
    """simple shelf pack of (w,h) at 1x (2px gutter); returns positions + page size (multiple of 4)"""
    x = y = rowh = 0; pos = []; W = 0
    for w, h in sizes:
        if x + w > maxw: x = 0; y += rowh + 2; rowh = 0
        pos.append((x, y)); x += w + 2; rowh = max(rowh, h); W = max(W, x)
    H = y + rowh; r4 = lambda v: (v + 3) // 4 * 4
    return pos, r4(W), r4(H)

SLEEP = {k: slot for k, slot, _l, _t in SL.LAYERS}   # part keys with a sleep_lie twin (the rest are hidden in bed)

def sleep_set(key, slot, RS):
    """pack one layer's sleep frames (2 anims x NF frames x 4 rotations) into a streamed atlas + the two animations"""
    fr = {(an, fi, r): (res[an][slot], anc) for r, fi, res, anc in RS for an in SL.ANIMS}
    order = [(an, fi, r) for an in SL.ANIMS for fi in range(SL.NF) for r in range(SL.ROTS)]
    pv = (SL.OX, SL.OY); W, H = SL.FWL, SL.FHL
    def fit(b):
        x0, y0, x1, y1 = b
        for _ in range(96):
            ax, ay = (pv[0] - x0) / (x1 - x0), (pv[1] - y0) / (y1 - y0)
            if -7.5 <= ax <= 8.5 and -7.5 <= ay <= 8.5: break
            if not -7.5 <= ax <= 8.5: x1, x0 = (x1 + 1, x0) if x1 < W else (x1, x0 - 1)
            if not -7.5 <= ay <= 8.5: y1, y0 = (y1 + 1, y0) if y1 < H else (y1, y0 - 1)
        return (x0, y0, x1, y1)
    boxes = []
    for k in order:
        a1, _, a2, _ = fr[k][0]
        al = (a1[..., 3] > 0) | (a2[..., 3].reshape(H, 2, W, 2).max(axis=(1, 3)) > 0); ys, xs = np.nonzero(al)
        boxes.append(fit((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1) if len(xs) else (pv[0], pv[1] - 1, pv[0] + 1, pv[1])))
    uniq, idx = {}, []
    for k, b in zip(order, boxes):
        a1, m1, a2, m2 = fr[k][0]; x0, y0, x1, y1 = b
        h = hash((b, a1[y0:y1, x0:x1].tobytes(), a2[y0 * 2:y1 * 2, x0 * 2:x1 * 2].tobytes(), m2[y0 * 2:y1 * 2, x0 * 2:x1 * 2].tobytes(), m1[y0:y1, x0:x1].tobytes()))
        if h not in uniq: uniq[h] = (len(uniq), k, b)
        idx.append(uniq[h][0])
    U = sorted(uniq.values()); sizes = [(b[2] - b[0], b[3] - b[1]) for _, _, b in U]
    pos, PW, PH = shelf(sizes, max(64, int(math.sqrt(sum(w * h for w, h in sizes) * 1.35))))
    assert PW <= 1024 and PH <= 1024, (key, PW, PH)
    P1 = np.zeros((PH, PW, 4), np.uint8); M1 = np.zeros((PH, PW, 3), np.uint8); P2 = np.zeros((PH * 2, PW * 2, 4), np.uint8); M2 = np.zeros((PH * 2, PW * 2, 3), np.uint8)
    for (u, k, b), (x, y) in zip(U, pos):
        a1, m1, a2, m2 = fr[k][0]; x0, y0, x1, y1 = b; w, h = x1 - x0, y1 - y0
        P1[y:y + h, x:x + w] = a1[y0:y1, x0:x1]; M1[y:y + h, x:x + w] = m1[y0:y1, x0:x1]
        P2[y * 2:(y + h) * 2, x * 2:(x + w) * 2] = a2[y0 * 2:y1 * 2, x0 * 2:x1 * 2]; M2[y * 2:(y + h) * 2, x * 2:(x + w) * 2] = m2[y0 * 2:y1 * 2, x0 * 2:x1 * 2]
    ak = "v2s_wr_" + key + "__sleep"; base = f"atlases/{ak}"
    Image.fromarray(P1, "RGBA").save(os.path.join(OUT, "atlases", ak + ".png"), optimize=True)
    Image.fromarray(P2, "RGBA").save(os.path.join(OUT, "atlases", ak + "@2x.png"), optimize=True)
    Image.fromarray(M1, "RGB").save(os.path.join(OUT, "atlases", ak + ".tintmask.png"), optimize=True)
    Image.fromarray(M2, "RGB").save(os.path.join(OUT, "atlases", ak + ".tintmask@2x.png"), optimize=True)
    atlas = {"key": ak, "image": base + ".png", "frameW": PW, "frameH": PH, "columns": 1, "rows": 1,
             "pages": [{"scale": 2, "image": base + "@2x.png"}], "masks": {"tintmask": base + ".tintmask.png"}, "residency": "stream"}
    anims = {}; j = 0
    for an in SL.ANIMS:
        dfs, fm = [], {}
        for fi in range(SL.NF):
            for r in range(SL.ROTS):
                u, k, b = U[idx[j]]; x, y = pos[u]; x0, y0, x1, y1 = b; w, h = x1 - x0, y1 - y0
                dfs.append({"atlas": ak, "rect": {"x": x, "y": y, "w": w, "h": h}, "anchor": {"x": round((pv[0] - x0) / w, 5), "y": round((pv[1] - y0) / h, 5)}})
                if slot == "body": fm[f"df:{fi * SL.ROTS + r}"] = {"anchors": fr[(an, fi, r)][1]}
                j += 1
        anims[an] = {"frames": list(range(SL.NF)), "fps": SL.FPS, "directions": SL.ROTS, "dirStride": SL.NF, "loop": True, "dirFrames": dfs, **({"frameMeta": fm} if fm else {})}
    return atlas, {"anims": anims, "total": len(order), "page": {"group": "sleep", "atlas": ak, "residency": "stream", "pages1x": [PW, PH], "uniqueFrames": len(U)}}

# ADR-240 (render charArt.ts V2S_ALIAS) still names the pre-fix sample pieces as slot fallbacks; keep those keys as
# aliases of the exact-key sprites (same atlases/frames, +0 VRAM) until V2S_ALIAS moves to the exact keys.
COMPAT_ALIASES = {"v2s_cz_top_scrap_male": "v2s_cz_top_henley_male", "v2s_cz_top_scrap_male_sleeves": "v2s_cz_top_henley_male_sleeves",
                  "v2s_cz_bottom_scrap_male": "v2s_cz_bottom_cargo_male", "v2s_cz_shoes_scrap_male": "v2s_cz_shoes_boots_male",
                  "v2s_cz_hat_scrap_male": "v2s_cz_hat_cap_male"}


def compat_sprites(sprites):
    by = {x["key"]: x for x in sprites}
    return [{**by[new], "key": old} for old, new in COMPAT_ALIASES.items()]


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--jobs", type=int, default=os.cpu_count()); A = ap.parse_args()
    work = [(li, d, an, fi, n) for li in range(len(LAYERS)) for an, n, _, _ in ANIMS for fi in range(n) for d in range(DIRS)]
    with Pool(A.jobs) as pool:
        R = pool.map(job, work, chunksize=8)
        RS = pool.map(SL.frame_job, [(r, fi) for fi in range(SL.NF) for r in range(SL.ROTS)])
    os.makedirs(os.path.join(OUT, "atlases"), exist_ok=True)
    byl = {}
    for li, d, an, fi, res, anc in R: byl.setdefault(li, {})[(an, fi, d)] = (res, anc)
    atlases, sprites, meta = [], [], []
    def fit(b):   # the loader wants each dirFrame anchor within [-8,9] of its rect: grow tiny slivers toward the pivot
        x0, y0, x1, y1 = b
        for _ in range(64):
            ax, ay = (PIV[0] - x0) / (x1 - x0), (PIV[1] - y0) / (y1 - y0)
            if -7.5 <= ax <= 8.5 and -7.5 <= ay <= 8.5: break
            if not -7.5 <= ax <= 8.5: x1, x0 = (x1 + 1, x0) if x1 < FW else (x1, x0 - 1)
            if not -7.5 <= ay <= 8.5: y1, y0 = (y1 + 1, y0) if y1 < FH else (y1, y0 - 1)
        return (x0, y0, x1, y1)
    for li, (key, slot, spec, hat, part, layer, tch, wk, v1s, variant) in enumerate(LAYERS):
        fr = byl[li]; anims = {}; pages = []; nuniq = ntot = 0
        for g in GROUPS:   # one atlas per anim group keeps every @2x page <= 2048
            GA = [a for a in ANIMS if GROUP[a[0]] == g]
            order = [(an, fi, d) for an, n, _, _ in GA for fi in range(n) for d in range(DIRS)]
            boxes = []   # trim on the union of 1x alpha and the @2x alpha downsampled (both scales share one rect)
            for k in order:
                a1, _, a2, _ = fr[k][0]
                al = (a1[..., 3] > 0) | (a2[..., 3].reshape(FH, 2, FW, 2).max(axis=(1, 3)) > 0)
                ys, xs = np.nonzero(al)
                boxes.append((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1) if len(xs) else (int(PIV[0]), int(PIV[1]) - 1, int(PIV[0]) + 1, int(PIV[1])))
            boxes = [fit(b) for b in boxes]
            uniq, idx = {}, []   # dedupe identical frames (same rect content at 1x+2x)
            for k, b in zip(order, boxes):
                a1, m1, a2, m2 = fr[k][0]; x0, y0, x1, y1 = b
                h = hash((b, a1[y0:y1, x0:x1].tobytes(), a2[y0 * 2:y1 * 2, x0 * 2:x1 * 2].tobytes(), m2[y0 * 2:y1 * 2, x0 * 2:x1 * 2].tobytes()))
                if h not in uniq: uniq[h] = (len(uniq), k, b)
                idx.append(uniq[h][0])
            U = sorted(uniq.values()); sizes = [(b[2] - b[0], b[3] - b[1]) for _, _, b in U]
            side = max(64, int(math.sqrt(sum(w * h for w, h in sizes) * 1.35)))
            pos, PW, PH = shelf(sizes, side)
            assert PW <= 1024 and PH <= 1024, (key, g, PW, PH)
            P1 = np.zeros((PH, PW, 4), np.uint8); M1 = np.zeros((PH, PW, 3), np.uint8); P2 = np.zeros((PH * 2, PW * 2, 4), np.uint8); M2 = np.zeros((PH * 2, PW * 2, 3), np.uint8)
            for (u, k, b), (x, y) in zip(U, pos):
                a1, m1, a2, m2 = fr[k][0]; x0, y0, x1, y1 = b; w, h = x1 - x0, y1 - y0
                P1[y:y + h, x:x + w] = a1[y0:y1, x0:x1]; M1[y:y + h, x:x + w] = m1[y0:y1, x0:x1]
                P2[y * 2:(y + h) * 2, x * 2:(x + w) * 2] = a2[y0 * 2:y1 * 2, x0 * 2:x1 * 2]; M2[y * 2:(y + h) * 2, x * 2:(x + w) * 2] = m2[y0 * 2:y1 * 2, x0 * 2:x1 * 2]
            ak = "v2s_wr_" + key + ("" if g == "core" else "__" + g); base = f"atlases/{ak}"
            Image.fromarray(P1, "RGBA").save(os.path.join(OUT, "atlases", ak + ".png"), optimize=True)
            Image.fromarray(P2, "RGBA").save(os.path.join(OUT, "atlases", ak + "@2x.png"), optimize=True)
            Image.fromarray(M1, "RGB").save(os.path.join(OUT, "atlases", ak + ".tintmask.png"), optimize=True)
            Image.fromarray(M2, "RGB").save(os.path.join(OUT, "atlases", ak + ".tintmask@2x.png"), optimize=True)
            atlases.append({"key": ak, "image": base + ".png", "frameW": PW, "frameH": PH, "columns": 1, "rows": 1,
                            "pages": [{"scale": 2, "image": base + "@2x.png"}],   # @2x tintmask: <mask>@2x naming (as v1)
                            "masks": {"tintmask": base + ".tintmask.png"},
                            # core (idle/walk/attack) = resident in the character pool (ADR-220/ADR-156); other groups stream
                            **({"residency": "resident", "pool": POOL(slot)} if g == "core" else {"residency": "stream"})})
            pages.append({"group": g, "atlas": ak, "residency": "resident" if g == "core" else "stream", "pages1x": [PW, PH], "uniqueFrames": len(U)}); nuniq += len(U); ntot += len(order)
            j = 0
            for an, n, fps, loop in GA:
                dfs, fm = [], {}
                for fi in range(n):
                    for d in range(DIRS):
                        u, k, b = U[idx[j]]; x, y = pos[u]; x0, y0, x1, y1 = b; w, h = x1 - x0, y1 - y0
                        dfs.append({"atlas": ak, "rect": {"x": x, "y": y, "w": w, "h": h}, "anchor": {"x": round((PIV[0] - x0) / w, 5), "y": round((PIV[1] - y0) / h, 5)}})
                        anc = fr[(an, fi, d)][1]
                        if anc: fm[f"df:{fi * DIRS + d}"] = {"anchors": anc}
                        j += 1
                anims[an] = {"frames": list(range(n)), "fps": fps, "directions": DIRS, "dirStride": n, "loop": loop, "dirFrames": dfs}
                if fm: anims[an]["frameMeta"] = fm
        if key in SLEEP:
            sa, sp = sleep_set(key, SLEEP[key], RS); atlases.append(sa); anims.update(sp["anims"]); pages.append(sp["page"])
            nuniq += sp["page"]["uniqueFrames"]; ntot += sp["total"]
        sk = "v2s_" + key
        sprites.append({"key": sk, "category": "character", "atlas": "v2s_wr_" + key, "anchor": {"x": .5, "y": 1}, **({"attach": {"head": ATTACH_HEAD}} if slot == "body" else {}), "animations": anims})
        meta.append({"sprite": sk, "slot": slot, "layer": layer, "layerName": part or "main", "tintChannels": tch,
                     "wearable": wk, "v1Sprite": v1s, **({"variant": variant} if variant else {}),
                     **({"layerByDir": [31, 31, 31, 31, 21, 21, 21, 31]} if part == "sleeves" else {}),
                     "atlases": pages, "uniqueFrames": nuniq})
        print(f"{sk}: {nuniq}/{ntot} unique, pages " + ", ".join(f"{p['group']} {p['pages1x'][0]*2}x{p['pages1x'][1]*2}" for p in pages) + " @2x", flush=True)
    sprites += compat_sprites(sprites)
    man = {"version": 1, "name": NAME, "atlases": atlases, "sprites": sprites}
    with open(os.path.join(OUT, f"manifest.{NAME}.json"), "w") as f: json.dump(man, f, separators=(",", ":"))
    side = {"doc": "Player v2 sample paper-doll (isolated test fragment; NOT wired into wearables/ids.lock/saves). Draw order = layer asc; "
                   "sleeves use layerByDir like v1 multi-layer tops. Tint: R=primary, G=secondary (palette indices into the v1 lists).",
            "spec": "player_v2_spec.md (style: cute cel base + scrappy worn/patched/taped gear)", "bodyType": BT, "skinTone": "tan",
            "palette": {"skin": "tan", "hair": ["espresso", "ash"], "top": ["sage", "denim"], "bottom": ["slate", "brick"], "shoes": ["charcoal", "cream"], "hat": ["mustard", "brick"], "eyes": ["black", "black"]},
            "frame": {"w": FW, "h": FH, "pivot": list(PIV), "scales": [1, 2], "dirOrder": ["E", "SE", "S", "SW", "W", "NW", "N", "NE"], "dirFramesIndex": "frame*8+dir"},
            "anims": [{"name": a[0], "frames": a[1], "fps": a[2], "loop": a[3], "group": a[4], "state": a[5], "note": a[6], **({"events": v2_anims.EVENTS[a[0]]} if a[0] in v2_anims.EVENTS else {})} for a in v2_anims.ANIMS],
            "appearance": APPEARANCE,
            "compatAliases": {**COMPAT_ALIASES, "note": "ADR-240 V2S_ALIAS slot fallbacks; same atlases as the exact-key sprite (+0 VRAM); drop once V2S_ALIAS uses the exact keys"},
            "anchorUnits": {"x,y": "1x px relative to the sprite pivot (+y down)", "angle": "DEGREES clockwise from screen-up (v1 + engine handOf: sprites.ts converts deg->rad); flipX mirrors (-angle)", "len": "px per unit item length", "behind": "draw held item behind the body"},
            "residencyNote": "core group atlases (idle/walk/attack) residency resident + pool (body|wear, ADR-220 character pools / ADR-156 core set); combat/ranged/pose/sleep atlases stream",
            "sleepLie": {"anims": {"sleep_lie": "reference-bed cut: bed (main pack), dec_bed_double_* (left/right), dec_bunk_bed upper", "sleep_lie_under": "dec_bunk_bed lower bunk (cut by the upper bunk)"},
                         "directions": SL.ROTS, "dirIndex": "bed rotation r (pass facing = r*PI/2 to resolve(); directionIndex(r*PI/2, 4) == r); dirFrames entry = frame*4 + r",
                         "frames": SL.NF, "fps": SL.FPS, "frame1x": [SL.FWL, SL.FHL], "pivot1x": [SL.OX, SL.OY],
                         "pivot": "the bed's footprint centre on the ground (the bed sprite's own anchor point) + bedFits[piece][spot][r] (1x px)",
                         "socket": "frameMeta anchor 'bed' on the body sprite = hip contact on the mattress; also 'head' (Zzz/bubble FX) and 'pillow'",
                         "layers": {k: slot for k, slot, _l, _t in SL.LAYERS}, "hidden": ["hat", "top sleeves", "armfront overlays", "hair hatHair"],
                         "hairVariant": "uncovered", "drawOrder": "layer asc, same layers as upright; draw after (in front of) the bed sprite",
                         "referenceBed": "main pack `bed` (1x2, mattress z14, blanket z16, pillow z19, headboard z30, footboard z16)",
                         "bedFits": SL.bed_fits()},
            "sockets": {"carry": "chest-held object centre (carry_idle/carry_walk; behind=true facing N/NW/NE)", "seat": "pelvis contact point (sit/vehicle): put it on the seat/vehicle socket"},
            "layers": meta}
    with open(os.path.join(OUT, "sample.v2.json"), "w") as f: json.dump(side, f, indent=1)

if __name__ == "__main__": main()
