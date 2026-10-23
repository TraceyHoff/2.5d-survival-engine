"""Wave 2 building pieces at gameplay scale (1 building cell = 1 tile; walls are 1-tile edge pieces centred on the
cell's centre line; 1 floor = 3 terrain levels = 48 px). Material tiers twig / wood / stone / metal.
Keys: wood tier = bare gameplay key (wall, floor, ...); other tiers = <key>_<tier> (wall_twig, wall_stone, wall_metal).
Every piece renders 1 (single) / 2 (mirror) / 4 (unique4) rotations x 4 damage stages into 128x128 cells, pivot (64,96)."""
import math, numpy as np
from PIL import Image, ImageDraw
from iso import IsoCanvas, tex_planks, tex_cobble, tex_thatch, tex_flat, add_outline, damage, ramp_color, HW, HH
from toon import SS, downscale, Canvas, ellipse_pts, capsule_pts, lerp, INK, noise
from palette import ramp
from buildings import B, render_boxes, finalize, planksH, planksV, cobble, flat, toon_at, flowers_in_box, lw_fn

WALL_H = 48; T = 0.12; L = 0.5
OPEN_DOOR = (0.25, 2, 38)     # half width, bottom z, top z of a doorway opening
OPEN_WIN = (0.22, 18, 36)

# ---------------------------------------------------------------- extra material tone fields
def tex_wattle(w, h, s):
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32); n = noise(w, h, 2 * SS, s)
    band = 4.5 * SS; r = (yy // band).astype(int); f = (yy % band) / band
    stake = 9 * SS; over = (((xx // stake).astype(int) + r) % 2 == 0)
    t = 0.7 + np.abs(f - 0.5) * 1.6 + np.where(over, -0.35, 0.35) + (n - 0.5) * 0.5
    t = np.where((xx % stake) < SS * 1.2, 2.6, t)
    return t
def tex_ashlar(w, h, s, bw=11, bh=6):
    rng = np.random.default_rng(s); yy, xx = np.mgrid[0:h, 0:w]
    r = yy // (bh * SS); off = (r % 2) * (bw * SS // 2); c = (xx + off) // (bw * SS)
    tone = rng.normal(1.0, 0.18, (h // (bh * SS) + 2, w // (bw * SS) + 3))[r, c]
    fy = (yy % (bh * SS)); fx = (xx + off) % (bw * SS)
    t = tone + (noise(w, h, 2 * SS, s) - 0.5) * 0.25
    t = np.where(fy < SS, t - 0.5, t); t = np.where(fy > bh * SS - 1.4 * SS, t + 0.7, t)
    t = np.where((fy > bh * SS - 0.7 * SS) | (fx < 0.7 * SS), 3.0, t)
    return t
def tex_panels(w, h, s, pw=12):
    yy, xx = np.mgrid[0:h, 0:w]; t = 1.0 + (noise(w, h, 5 * SS, s) - 0.5) * 0.3
    fx = xx % (pw * SS); t = np.where(fx < SS * 0.8, 2.8, t); t = np.where(fx < SS * 2, t - 0.4, t)
    for ry in (int(2.5 * SS), h - int(2.5 * SS)):
        riv = ((np.abs(yy - ry) < SS * 0.9) & (np.abs(fx - pw * SS / 2) < SS * 0.9))
        t = np.where(riv, -0.4, t)
    rust = noise(w, h, 4 * SS, s + 3) > 0.78
    return np.where(rust, t + 0.9, t)
def tex_diamond(w, h, s):
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32); p = 4 * SS
    a = ((xx + yy) % p < SS * 0.9) & (((xx - yy) // p) % 2 == 0); b = ((xx - yy) % p < SS * 0.9) & (((xx + yy) // p) % 2 == 1)
    return 1.0 + (noise(w, h, 6 * SS, s) - 0.5) * 0.3 - np.where(a | b, 0.6, 0) + np.where(np.roll(a | b, SS, 0), 0.5, 0)
def tex_logs(w, h, s, d=6):
    yy, xx = np.mgrid[0:h, 0:w]; f = (yy % (d * SS)) / (d * SS); r = yy // (d * SS)
    t = 0.4 + (np.abs(f - 0.45) * 2) ** 1.5 * 1.8 + (noise(w, h, 3 * SS, s) - 0.5) * 0.4 + np.sin(xx / (5 * SS) + r) * 0.08
    return t
def tex_reed(w, h, s): return tex_wattle(h, w, s).T if False else tex_thatch(w, h, s, row=5)

TEX = dict(wattle=lambda w, h, s: tex_wattle(w, h, s), ashlar=lambda w, h, s: tex_ashlar(w, h, s), panels=lambda w, h, s: tex_panels(w, h, s),
           diamond=lambda w, h, s: tex_diamond(w, h, s), logs=lambda w, h, s: tex_logs(w, h, s), reed=lambda w, h, s: tex_reed(w, h, s),
           planks=planksH(7), planksV=planksV(5), deck=lambda w, h, s: tex_planks(w, h, s, board=9), cobble=cobble(6), cobble4=cobble(4),
           flag=lambda w, h, s: tex_cobble(w, h, s, cell=11), flat=flat(0.12))

TIERS = {
  #        wall rp/tex          base (plinth)            frame (posts/beam)     floor/deck             roof
  "twig":  dict(wall=("thatch", "wattle"), base=None, frame=("bark", "planksV"), floor=("thatch", "reed"), found=("bark", "logs"),
                roof="thatch", roof_style="thatch", trim="bark", post_w=0.07, beam=False),
  "wood":  dict(wall=("wood", "planks"), base=("cobble", "cobble4"), frame=("wood_dark", "planksV"), floor=("wood", "deck"), found=("cobble", "cobble"),
                roof="wood", roof_style="shingle", trim="wood_dark", post_w=0.09, beam=True),
  "stone": dict(wall=("cobble", "cobble"), base=("stone", "ashlar"), frame=("stone", "ashlar"), floor=("stone", "flag"), found=("stone", "ashlar"),
                roof="slate", roof_style="shingle", trim="wood_dark", post_w=0.11, beam=True),
  "metal": dict(wall=("iron", "panels"), base=("slate", "ashlar"), frame=("metal_teal", "flat"), floor=("iron", "diamond"), found=("slate", "ashlar"),
                roof="metal_teal", roof_style="corrugated", trim="metal_teal", post_w=0.08, beam=True),
}
def tx(name): return TEX[name]

# ---------------------------------------------------------------- walls
def wall(tier, kind="plain"):
    M = TIERS[tier]; wrp, wtx = M["wall"]; top = WALL_H if kind != "low" else 24
    bx = []; z0 = 0
    if M["base"]:
        brp, btx = M["base"]; z0 = 7
        if kind == "doorway":
            hw = OPEN_DOOR[0]
            bx += [B(-L, -hw, -T - 0.03, T + 0.03, 0, 7, brp, top=tx(btx), left=tx(btx), right=tx(btx)), B(hw, L, -T - 0.03, T + 0.03, 0, 7, brp, top=tx(btx), left=tx(btx), right=tx(btx))]
        else: bx.append(B(-L, L, -T - 0.03, T + 0.03, 0, 7, brp, top=tx(btx), left=tx(btx), right=tx(btx)))
    pw = M["post_w"]; inner = L - pw
    W = lambda x0, x1, za, zb: B(x0, x1, -T, T, za, zb, wrp, left=tx(wtx), right=tx(wtx), top=flat())
    beam_z = top - 5 if M["beam"] else top
    if kind in ("plain", "low"): bx.append(W(-inner, inner, z0, beam_z))
    elif kind == "window":
        hw, a, b = OPEN_WIN
        bx += [W(-inner, inner, z0, a), W(-inner, -hw, a, b), W(hw, inner, a, b), W(-inner, inner, b, beam_z)]
        fr = M["trim"]
        bx += [B(-hw - 0.05, hw + 0.05, -T - 0.03, T + 0.05, a - 3, a, fr), B(-hw - 0.05, hw + 0.05, -T - 0.03, T + 0.03, b, b + 3, fr),
               B(-hw - 0.05, -hw, -T - 0.03, T + 0.03, a, b, fr), B(hw, hw + 0.05, -T - 0.03, T + 0.03, a, b, fr)]
    elif kind == "doorway":
        hw, a, b = OPEN_DOOR
        bx += [W(-inner, -hw, z0 if True else 0, b), W(hw, inner, z0, b), W(-inner, inner, b, beam_z)]
        if z0: bx += [W(-inner, -hw, 0, z0)] if False else []
        fr = M["trim"]
        bx += [B(-hw - 0.05, hw + 0.05, -T - 0.03, T + 0.03, b - 1, b + 3, fr), B(-hw - 0.05, -hw, -T - 0.03, T + 0.03, 0, b, fr), B(hw, hw + 0.05, -T - 0.03, T + 0.03, 0, b, fr),
               B(-hw, hw, -T, T, 0, 2, M["base"][0] if M["base"] else "dirt", top=flat())]
    frp, ftx = M["frame"]
    for sx in (-1, 1):
        bx.append(B(sx * L - (pw if sx > 0 else 0), sx * L + (pw if sx < 0 else 0), -T - 0.04, T + 0.04, 0, top + (1 if M["beam"] else 3), frp, left=tx(ftx), right=tx(ftx)))
    if M["beam"]: bx.append(B(-L, L, -T - 0.05, T + 0.05, top - 5, top, frp, left=tx(ftx) if ftx != "planksV" else planksH(5), right=tx(ftx) if ftx != "planksV" else planksH(5), top=flat()))
    dec = []
    if tier == "twig":   # twine lashings at the stake tops
        def lash(cv, r, m):
            def d(c):
                for dy in (0, 3): c.line([(14, 20 + dy), (18, 21 + dy)], ramp("thatch")[2], 0.9)
            for sx in (-L + 0.03, L - 0.03): toon_at(cv, sx, T + 0.05, top - 6, r, m, d)
        dec.append((-1, lash))
    if tier == "metal":   # hazard stripe + bolts on the beam
        pass
    return bx, dec

def wall_corner(tier):
    M = TIERS[tier]; wrp, wtx = M["wall"]; frp, ftx = M["frame"]; bx = []; z0 = 0
    if M["base"]:
        brp, btx = M["base"]; z0 = 7
        bx += [B(-0.5, T + 0.03, -T - 0.03, T + 0.03, 0, 7, brp, top=tx(btx), left=tx(btx), right=tx(btx)), B(-T - 0.03, T + 0.03, -0.5, -T - 0.03, 0, 7, brp, top=tx(btx), left=tx(btx), right=tx(btx))]
    bt = WALL_H - (5 if M["beam"] else 0)
    bx += [B(-0.5, -T, -T, T, z0, bt, wrp, left=tx(wtx), right=tx(wtx), top=flat()), B(-T, T, -0.5, -T, z0, bt, wrp, left=tx(wtx), right=tx(wtx), top=flat()),
           B(-T - 0.05, T + 0.05, -T - 0.05, T + 0.05, 0, WALL_H + 1, frp, left=tx(ftx), right=tx(ftx))]
    if M["beam"]:
        bx += [B(-0.5, T + 0.05, -T - 0.05, T + 0.05, bt, WALL_H, frp, top=flat()), B(-T - 0.05, T + 0.05, -0.5, -T - 0.05, bt, WALL_H, frp, top=flat())]
    return bx, []

def pillar(tier):
    M = TIERS[tier]; frp, ftx = M["frame"]; bx = []
    if M["base"]: bx.append(B(-0.22, 0.22, -0.22, 0.22, 0, 7, M["base"][0], top=tx(M["base"][1]), left=tx(M["base"][1]), right=tx(M["base"][1])))
    bx += [B(-0.14, 0.14, -0.14, 0.14, 0, WALL_H, frp, left=tx(ftx), right=tx(ftx)), B(-0.19, 0.19, -0.19, 0.19, WALL_H, WALL_H + 4, frp, top=flat())]
    return bx, []

def fence(tier="wood"):
    bx = [B(x - 0.06, x + 0.06, -0.06, 0.06, 0, 24, "wood", left=planksV(3), right=planksV(3)) for x in (-0.44, 0.44)]
    bx += [B(-0.5, 0.5, -0.035, 0.035, 15, 19, "wood", left=planksH(4), right=planksH(4)), B(-0.5, 0.5, -0.035, 0.035, 7, 11, "wood", left=planksH(4), right=planksH(4))]
    return bx, [(-1, lambda cv, r, m: toon_at(cv, 0.0, 0.05, 19, r, m, lambda c: c.part(ellipse_pts(16, 23, 2.2, 1.8, n=14), "flower_pink", lw=0.5, shade=0.2, hl=0.2)))]

# ---------------------------------------------------------------- decks
def floor(tier):
    M = TIERS[tier]; rp, t = M["floor"]
    bx = [B(-0.5, 0.5, -0.5, 0.5, 0, 4, rp, top=tx(t), left=planksH(4) if rp in ("wood", "thatch") else tx("flat"), right=planksH(4) if rp in ("wood", "thatch") else tx("flat"))]
    if tier == "twig": bx = [B(-0.5, 0.5, x - 0.06, x + 0.06, 0, 2, "bark", left=tx("logs"), right=tx("logs")) for x in (-0.35, 0.35)] + [B(-0.5, 0.5, -0.5, 0.5, 2, 4, rp, top=tx(t))]
    return bx, []

def foundation(tier):
    M = TIERS[tier]; rp, t = M["found"]; frp, ft = M["floor"]
    return [B(-0.5, 0.5, -0.5, 0.5, 0, 9, rp, top=tx(t), left=tx(t), right=tx(t)), B(-0.47, 0.47, -0.47, 0.47, 9, 12, frp, top=tx(ft), left=tx("flat"), right=tx("flat"))], []

def hatch_frame(tier):
    M = TIERS[tier]; rp, t = M["floor"]; h = 0.22; trim = M["trim"]
    bx = [B(-0.5, 0.5, -0.5, -h, 0, 4, rp, top=tx(t)), B(-0.5, 0.5, h, 0.5, 0, 4, rp, top=tx(t)), B(-0.5, -h, -h, h, 0, 4, rp, top=tx(t)), B(h, 0.5, -h, h, 0, 4, rp, top=tx(t)),
          B(-h, h, -h, h, 0, 0.6, "ink", top=flat(0.05), faces="t", edge=False),
          B(-h - 0.04, h + 0.04, -h - 0.04, -h, 4, 5, trim), B(-h - 0.04, h + 0.04, h, h + 0.04, 4, 5, trim), B(-h - 0.04, -h, -h, h, 4, 5, trim), B(h, h + 0.04, -h, h, 4, 5, trim)]
    return bx, []

def stairs(tier):
    M = TIERS[tier]; rp, t = M["floor"]; frp, ft = M["frame"]; bx = []
    n = 6
    for k in range(n):   # rises toward -y (back); step k spans y from 0.5 - (k+1)/n to 0.5 - k/n
        y1 = 0.5 - k / n; y0 = y1 - 1 / n
        bx.append(B(-0.36, 0.36, y0, y1, k * 8 + 4, k * 8 + 8, rp, top=tx(t), left=planksH(3) if rp in ("wood", "thatch") else tx("flat"), right=tx("flat")))
    for sx in (-0.42, 0.36):   # stringers
        for k in range(n): bx.append(B(sx, sx + 0.06, 0.5 - (k + 1) / n, 0.5 - k / n, 0, k * 8 + 9, frp, left=tx(ft) if ft != "planksV" else planksV(3), right=tx(ft) if ft != "planksV" else planksV(3)))
    if tier != "twig": bx.append(B(0.36, 0.42, -0.5, -0.42, 48, 60, frp))   # newel post at the top
    return bx, []

# ---------------------------------------------------------------- roofs (raymarched height fields)
ROOF_P = 24.0; ROOF_T = 3.0
def roof_d(kind, x, y):
    """distance-to-eave field (tiles) on the cell [-.5,.5]^2 in local rot-0 coords. ridge/high side at -y (back)."""
    u = 0.5 + x; v = 0.5 - y        # u: 0 at -x edge; v: 0 at front (+y) eave, 1 at back
    if kind == "slope": return v
    if kind == "ridge": return 0.5 - np.abs(y)
    if kind == "hip": return np.minimum(0.5 - np.abs(y), 0.5 - x)
    if kind == "corner": return np.minimum(v, 1 - u)          # outer corner: eaves at front and at +x
    if kind == "valley": return np.maximum(v, 1 - u) * 0 + np.minimum(1.0, np.maximum(v, 1 - u))
    if kind == "peak": return 0.5 - np.maximum(np.abs(x), np.abs(y))
    if kind == "flat": return np.zeros_like(x) + 0.08
    raise KeyError(kind)

def roof_piece(tier, kind, rot, seed=3, mirror=False):
    M = TIERS[tier]; rp = M["roof"]; style = M["roof_style"]; trim = M["trim"]
    cv = IsoCanvas(128, 128, 64, 96, seed)
    Wd, Ht = cv.W, cv.H
    X, Y = np.meshgrid(np.arange(Wd) + 0.5, np.arange(Ht) + 0.5)
    A = (X / SS - cv.ox) / HW            # x - y
    Bz = (Y / SS - cv.oy) / HH           # x + y - z/HH
    zmax = ROOF_T + ROOF_P * 1.05 + 1
    hit = np.zeros(X.shape, bool); hx = np.zeros(X.shape, np.float32); hy = np.zeros_like(hx); hz = np.zeros_like(hx)
    inv = lw_fn((4 - rot) % 4, False)   # world -> local rotation
    def local(x, y):
        xr, yr = x, y
        for _ in range((4 - rot) % 4): xr, yr = -yr, xr
        return xr, yr
    z = zmax
    while z >= 0:
        s = Bz + z / HH; x = (A + s) / 2; y = (s - A) / 2
        inside = (np.abs(x) <= 0.5) & (np.abs(y) <= 0.5) & ~hit
        if inside.any():
            lx, ly = local(x, y)
            h = ROOF_T + ROOF_P * roof_d(kind, lx, ly)
            if kind == "flat": h = np.where((np.abs(lx) > 0.44) | (np.abs(ly) > 0.44), 7.0, 4.0)
            new = inside & (z <= h)
            hit |= new; hx = np.where(new, x, hx); hy = np.where(new, y, hy); hz = np.where(new, z, hz)
        z -= 0.35
    lx, ly = local(hx, hy)
    hh = ROOF_T + ROOF_P * roof_d(kind, lx, ly) if kind != "flat" else np.where((np.abs(lx) > 0.44) | (np.abs(ly) > 0.44), 7.0, 4.0)
    top = hit & (hz >= hh - 0.5)
    side_r = hit & ~top & (hx >= 0.5 - 0.02)        # +x face
    side_l = hit & ~top & ~side_r                    # +y face
    # surface normal (world) from finite differences of the local field, rotated back
    e = 0.01
    def H(x, y):
        a, b = local(x, y); return ROOF_T + ROOF_P * roof_d(kind, a, b) if kind != "flat" else np.full_like(x, 4.0)
    gx = (H(hx + e, hy) - H(hx - e, hy)) / (2 * e) / 36.0; gy = (H(hx, hy + e) - H(hx, hy - e)) / (2 * e) / 36.0
    n = np.sqrt(gx ** 2 + gy ** 2 + 1); nx, ny, nz = -gx / n, -gy / n, 1 / n
    tone_top = np.clip(0.85 * nx - 0.15 * ny - 0.45 * nz + 0.2, -0.7, 1.3)
    # material pattern on the roof surface: courses follow contour lines
    lvl = hh / 4.6; frac = lvl - np.floor(lvl)
    along = (lx * np.abs(gy) - ly * np.abs(gx) + lx * (np.abs(gx) < 1e-3) * 0) * 36 / (np.sqrt(gx ** 2 + gy ** 2) + 1e-6) if kind != "flat" else lx * 36
    along = np.where(np.sqrt(gx ** 2 + gy ** 2) < 1e-3, lx * 36, along)
    nn = noise(Wd, Ht, 2 * SS, seed)
    if style == "shingle":
        sw = 6.0; stag = (np.floor(lvl) % 2) * sw / 2; seam = ((along + stag) % sw) < 0.7
        pat = -0.25 + frac * 0.9 + np.where(seam, 1.2, 0) + (nn - 0.5) * 0.3 + np.where(frac < 0.14, 1.4, 0)
    elif style == "thatch":
        pat = 0.0 + frac * 1.1 + np.sin(along * 1.7 + nn * 5) * 0.25 + (nn - 0.5) * 0.4 + np.where(frac < 0.1, 1.0, 0)
    else:   # corrugated metal: ridges running down the slope
        pat = np.sin(along * 1.6) * 0.45 + (nn - 0.5) * 0.15 + np.where(np.abs(((hh / 12) % 1) - 0.5) < 0.03, 0.8, 0)
        pat += np.where(noise(Wd, Ht, 5 * SS, seed + 7) > 0.8, 0.8, 0)    # rust freckles
    if kind == "flat": pat = (nn - 0.5) * 0.3 + np.where((np.abs(lx) > 0.44) | (np.abs(ly) > 0.44), -0.3, 0.2)
    tone = np.where(top, tone_top + pat, 0)
    # ridge caps / hips: where the field is at a crease (two slope planes meet) draw a trim cap
    crease = np.zeros_like(top)
    if kind in ("ridge", "hip", "corner", "peak", "valley"):
        d1 = H(hx + 0.03, hy) + H(hx - 0.03, hy) - 2 * H(hx, hy); d2 = H(hx, hy + 0.03) + H(hx, hy - 0.03) - 2 * H(hx, hy)
        crease = top & ((np.abs(d1) + np.abs(d2)) > 0.6)
    col = ramp_color(rp, tone)
    side_t = np.where(side_r, 0.85, 0.0) + (np.sin(hz * 1.4) * 0.15) + (nn - 0.5) * 0.25
    col = np.where((side_l | side_r)[..., None], ramp_color(trim, side_t), col)
    col = np.where(crease[..., None], ramp_color(trim, -0.2 + 0.85 * (nx > 0.1)), col)
    al = hit.astype(np.float32) * 255
    cv.img = Image.fromarray(np.concatenate([col, al[..., None]], 2).astype(np.uint8), "RGBA")
    # ink on face boundaries (top vs sides) for a crisp read
    fid = np.where(top, 1, np.where(side_r, 2, np.where(side_l, 3, 0)))
    edge = (fid != np.roll(fid, 1, 0)) | (fid != np.roll(fid, 1, 1))
    edge &= hit
    a = np.asarray(cv.img).copy(); a[edge, :3] = (np.array(lerp(INK, (90, 60, 70), 0.3)) * 0.8 + a[edge, :3] * 0.2).astype(np.uint8)
    cv.img = Image.fromarray(a)
    return cv

ROOF_KINDS = {"roof_slope": ("slope", "unique4"), "roof_ridge": ("ridge", "mirror"), "roof_hip": ("hip", "unique4"), "roof_corner": ("corner", "unique4"),
              "roof_valley": ("valley", "unique4"), "roof_peak": ("peak", "single"), "roof_flat": ("flat", "single")}

# ---------------------------------------------------------------- opening inserts (gameplay "opening" pieces)
def door_leaf(kind="wood", open_=False):
    hw, a, b = OPEN_DOOR; w = hw - 0.02
    rp = "cloth_red" if kind == "wood" else "iron"; tex = planksV(5) if kind == "wood" else tx("panels")
    if not open_: bx = [B(-w, w, -0.045, 0.045, a, b - 1, rp, left=tex, right=tex)]
    else: bx = [B(-w - 0.02, -w + 0.06, 0.05, 0.05 + 2 * w, a, b - 1, rp, left=tex, right=tex)]
    if kind == "metal":
        if not open_: bx += [B(-w, w, -0.05, 0.05, z, z + 3, "metal_teal") for z in (8, 28)]
        else: bx += [B(-w - 0.03, -w + 0.07, 0.05, 0.05 + 2 * w, z, z + 3, "metal_teal") for z in (8, 28)]
    def knob(cv, r, m):
        if open_: return
        toon_at(cv, w - 0.07, 0.05, 20, r, m, lambda c: c.part(ellipse_pts(16, 24, 1.3, 1.3, n=12), "gold" if kind == "wood" else "iron", lw=0.6, shade=0.3, hl=0.2))
        if kind == "wood": toon_at(cv, 0.0, 0.05, 31, r, m, lambda c: c.part(ellipse_pts(16, 23, 3.0, 2.6, n=16), "glass", lw=0.6, shade=0.3, hl=0.3))   # little round window
    return bx, [(-1, knob)]

def hatch_leaf(open_=False):
    h = 0.21
    if not open_: return [B(-h, h, -h, h, 3, 5.5, "wood", top=lambda w, hh, s: tex_planks(w, hh, s, board=6), left=planksH(2), right=planksH(2)),
                          B(-h, h, -0.03, 0.03, 5.5, 6.2, "iron", faces="t")], []
    return [B(-h, h, -h - 0.04, -h, 4, 4 + 2 * h * 36, "wood", left=planksV(4), right=planksV(4))], []

def window_insert(kind):
    hw, a, b = OPEN_WIN; w = hw
    if kind == "glass":
        return [B(-w, w, -0.015, 0.015, a, b, "glass", left=flat(0.3), right=flat(0.3), faces="lr", edge=False),
                B(-0.025, 0.025, -0.03, 0.03, a, b, "wood_dark", faces="lr"), B(-w, w, -0.03, 0.03, (a + b) / 2 - 1, (a + b) / 2 + 1, "wood_dark", faces="lr"),
                B(-w, w, T + 0.02, T + 0.16, a - 6, a, "wood", left=planksH(3), right=planksH(3))], \
               [(-1, lambda cv, r, m: toon_at(cv, 0.0, T + 0.09, a, r, m, flowers_in_box))]
    if kind == "bars":
        return [B(x - 0.018, x + 0.018, -0.02, 0.02, a, b, "iron", faces="lr") for x in np.linspace(-w + 0.05, w - 0.05, 4)] + \
               [B(-w, w, -0.025, 0.025, z, z + 1.5, "iron", faces="lrt") for z in (a + 3, b - 4)], []
    if kind == "shutters_closed":
        return [B(-w, 0, T + 0.01, T + 0.04, a, b, "cloth_teal", left=planksV(4), right=planksV(4)), B(0, w, T + 0.01, T + 0.04, a, b, "cloth_teal", left=planksV(4), right=planksV(4))], \
               [(-1, lambda cv, r, m: toon_at(cv, 0.0, T + 0.05, (a + b) / 2 - 3, r, m, lambda c: c.part(ellipse_pts(16, 24, 2.5, 2.2, n=16), "flower_yel", lw=0.5, shade=0.2, hl=0.2)))]
    if kind == "shutters_open":
        return [B(-w - 0.02, -w + 0.01, T + 0.01, T + 0.01 + w, a, b, "cloth_teal", left=planksV(4), right=planksV(4)),
                B(w - 0.01, w + 0.02, T + 0.01, T + 0.01 + w, a, b, "cloth_teal", left=planksV(4), right=planksV(4))], []
    raise KeyError(kind)

# ---------------------------------------------------------------- stations, furniture, decor
def anvil():
    return [B(-0.2, 0.2, -0.16, 0.16, 0, 13, "bark", top=lambda w, h, s: tex_cobble(w, h, s, cell=3), left=planksV(3), right=planksV(3)),
            B(-0.1, 0.1, -0.07, 0.07, 13, 18, "iron"), B(-0.26, 0.2, -0.1, 0.1, 18, 24, "iron", top=flat(0.08)),
            B(0.2, 0.34, -0.06, 0.06, 20, 24, "iron"), B(-0.3, -0.26, -0.08, 0.08, 19, 24, "iron"),
            B(0.0, 0.18, 0.1, 0.16, 24, 25.5, "wood_dark")], \
           [(-1, lambda cv, r, m: toon_at(cv, 0.05, 0.13, 25, r, m, lambda c: (c.part(capsule_pts(10, 24, 20, 21, 1.0), "wood", lw=0.6, shade=0.3, hl=0.2), c.part(ellipse_pts(21, 21, 2.2, 1.6, n=12), "iron", lw=0.6, shade=0.3, hl=0.2))))]

def furnace_boxes():
    return [B(-0.4, 0.4, -0.38, 0.38, 0, 26, "stone", top=tx("ashlar"), left=tx("ashlar"), right=tx("ashlar")),
            B(-0.32, 0.32, -0.3, 0.3, 26, 34, "brick", top=lambda w, h, s: tex_ashlar(w, h, s, 8, 5), left=lambda w, h, s: tex_ashlar(w, h, s, 8, 5), right=lambda w, h, s: tex_ashlar(w, h, s, 8, 5)),
            B(-0.13, 0.13, -0.24, 0.0, 34, 58, "brick", left=lambda w, h, s: tex_ashlar(w, h, s, 6, 5), right=lambda w, h, s: tex_ashlar(w, h, s, 6, 5), top=flat()),
            B(-0.16, 0.16, -0.27, 0.03, 58, 61, "iron")]

def furnace_frame(i, n=6, lit=True, stage=0):
    """stone smelting furnace with a glowing arched mouth (animated, emissive)."""
    cv = render_boxes(furnace_boxes(), 0, seed=77)
    px, py = cv.P(0.0, 0.39, 0)
    c = Canvas(128, 128, seed=9)
    mx, my = px / SS, py / SS
    m = c.part([(mx - 9, my - 1), (mx - 9, my - 12), (mx - 5, my - 17), (mx + 5, my - 17), (mx + 9, my - 12), (mx + 9, my - 1)], "ink", lw=0.8, shade=0.1, hl=0.0, flat=True)
    if lit and stage < 3:
        from fx import fire
        fl = fire(i, n, 32, 32).resize((20 * SS, 20 * SS), Image.LANCZOS)
        c.paste(fl, mx - 10, my - 20)
        k = 0.6 + 0.4 * math.sin(2 * math.pi * i / n)
        c.fill(ellipse_pts(mx, my - 2, 7, 2.2, n=16), ramp("fire")[1], alpha=int(220 * k), clip=m)
    else:
        for j in range(3): c.fill(ellipse_pts(mx - 4 + j * 4, my - 2.5, 1.6, 1.0, n=10), ramp("fire")[3] if stage < 3 else ramp("ink")[1])
    c.part([(mx - 10, my), (mx + 10, my), (mx + 10, my + 2), (mx - 10, my + 2)], "iron", lw=0.7, shade=0.3, hl=0.2)
    cv.img = Image.alpha_composite(cv.img, c.img)
    return cv

def cooking_pot_frame(i, n=6, lit=True):
    from fx import fire
    cv = Canvas(128, 128, seed=6); cx, cy = 64, 96
    for (dx, dy) in [(-12, -2), (12, -2), (0, 4), (-8, 3), (8, 3)]:
        cv.part(ellipse_pts(cx + dx, cy + dy - 2, 3.6, 2.8, n=10, wob=0.1, seed=int(dx * 10 + 50)), "stone", lw=0.9, shade=0.3, hl=0.2)
    for sx in (-1, 1): cv.part(capsule_pts(cx + sx * 15, cy, cx + sx * 4, cy - 40, 1.4), "bark", lw=0.9, shade=0.3, hl=0.2)
    cv.part(capsule_pts(cx - 8, cy - 39, cx + 8, cy - 39, 1.3), "bark", lw=0.8, shade=0.3, hl=0.2)
    if lit:
        fl = fire(i, n, 32, 32).resize((22 * SS, 22 * SS), Image.LANCZOS); cv.paste(fl, cx - 11, cy - 24)
    cv.line([(cx, cy - 39), (cx, cy - 28)], ramp("iron")[2], 0.7)
    m = cv.part(ellipse_pts(cx, cy - 18, 10, 8.5, n=30), "hair_black", lw=1.0, shade=0.3, hl=0.15)
    cv.part(ellipse_pts(cx, cy - 25.5, 10.5, 2.8, n=24), "hair_black", lw=0.9, shade=0.2, hl=0.1, base_col=ramp("hair_black")[2])
    cv.part(ellipse_pts(cx, cy - 25.5, 8.2, 1.9, n=24), "carrot", lw=0.4, shade=0.2, hl=0.3, outline=False, base_col=ramp("leaf_autumn")[1])   # bubbling stew
    for j in range(3):
        f = ((i / n) + j / 3) % 1.0
        cv.part(ellipse_pts(cx - 5 + j * 5, cy - 26 - f * 12, 1.2 + f * 1.6, 1.0 + f * 1.4, n=12), "smoke", lw=0.5, shade=0.2, hl=0.2)
    cv.part(capsule_pts(cx + 4, cy - 26, cx + 12, cy - 38, 0.9), "wood", lw=0.6, shade=0.3, hl=0.2)   # ladle
    return cv

def fireplace_frame(i, n=6, lit=True):
    cv = render_boxes([B(-0.8, 0.8, -0.42, -0.1, 0, 44, "stone", top=tx("ashlar"), left=tx("ashlar"), right=tx("ashlar")),
                       B(-0.9, 0.9, -0.46, 0.02, 30, 34, "wood_dark", top=planksH(4), left=planksH(4), right=planksH(4)),
                       B(-0.3, 0.3, -0.42, -0.2, 44, 72, "stone", left=tx("ashlar"), right=tx("ashlar"), top=flat()),
                       B(-0.85, 0.85, -0.1, 0.25, 0, 3, "stone", top=tx("flag"), left=tx("flat"), right=tx("flat"))], 0, seed=71)
    px, py = cv.P(0.0, -0.09, 3); mx, my = px / SS, py / SS
    c = Canvas(128, 128, seed=2)
    c.part([(mx - 16, my), (mx - 16, my - 16), (mx - 10, my - 22), (mx + 10, my - 22), (mx + 16, my - 16), (mx + 16, my)], "ink", lw=0.7, flat=True)
    for k in (-6, 0, 6): c.part(capsule_pts(mx + k - 5, my - 3, mx + k + 5, my - 5, 2.0), "bark", lw=0.6, shade=0.3, hl=0.2)
    if lit:
        from fx import fire
        c.paste(fire(i, n, 48, 64, size=1.9).resize((26 * SS, 34 * SS), Image.LANCZOS), mx - 13, my - 33)
    for (dx, rp) in [(-12, "flower_pink"), (11, "pumpkin")]:   # cozy mantel decor
        pass
    cv.img = Image.alpha_composite(cv.img, c.img)
    def mantel(cv2):
        toon_at(cv2, -0.6, -0.25, 34, 0, False, lambda cc: cc.part(ellipse_pts(16, 21, 3.4, 3.0, n=16), "pumpkin", lw=0.6, shade=0.3, hl=0.2))
        toon_at(cv2, 0.55, -0.25, 34, 0, False, lambda cc: (cc.part([(13, 24), (19, 24), (18, 18), (14, 18)], "brick", lw=0.6, shade=0.3, hl=0.2), cc.part(ellipse_pts(16, 16, 3.0, 2.4, n=14), "leaf", lw=0.5, shade=0.3, hl=0.2)))
    mantel(cv)
    return cv

def wood_stove_frame(i, n=6, lit=True):
    from fx import fire
    cv = Canvas(128, 128, seed=8); cx, cy = 64, 96
    for sx in (-7, 7): cv.part(capsule_pts(cx + sx, cy, cx + sx * 0.8, cy - 6, 1.4), "hair_black", lw=0.7, shade=0.3, hl=0.2)
    m = cv.part(ellipse_pts(cx, cy - 19, 13, 14, n=40), "hair_black", lw=1.1, shade=0.3, hl=0.18)
    cv.part(ellipse_pts(cx, cy - 33, 11, 3.0, n=30), "hair_black", lw=0.9, shade=0.2, hl=0.2, base_col=ramp("hair_black")[0])
    cv.part(capsule_pts(cx + 2, cy - 34, cx + 2, cy - 64, 3.0), "hair_black", lw=0.9, shade=0.35, hl=0.25)
    heart = [(cx, cy - 10)] + [(cx + 6 * math.sin(t) ** 3, cy - 18 - (5 * math.cos(t) - 2 * math.cos(2 * t) - math.cos(3 * t))) for t in np.linspace(0.3, 2 * math.pi - 0.3, 20)]
    hm = cv.part(heart, "ink", lw=0.6, flat=True)
    if lit:
        cv.paste(fire(i, n, 32, 32).resize((16 * SS, 16 * SS), Image.LANCZOS), cx - 8, cy - 25)
        cv.fill(heart, ramp("fire")[1], alpha=int(90 + 60 * math.sin(2 * math.pi * i / n)))
    cv.part(capsule_pts(cx - 13, cy - 8, cx + 13, cy - 8, 1.0), "gold", lw=0.6, shade=0.3, hl=0.2)
    return cv

def large_chest():
    return [B(-0.8, 0.8, -0.3, 0.3, 0, 17, "wood", left=planksH(5), right=planksH(5)), B(-0.82, 0.82, -0.32, 0.32, 17, 25, "wood", left=planksH(4), right=planksH(4), top=planksH(5)),
            B(-0.82, -0.74, -0.33, 0.33, 0, 25, "iron"), B(0.74, 0.82, -0.33, 0.33, 0, 25, "iron"), B(-0.04, 0.04, -0.33, 0.33, 0, 25, "iron"),
            B(-0.1, 0.1, 0.32, 0.36, 12, 20, "gold")], []

def shelf():
    bx = [B(-0.45, 0.45, -0.2, -0.12, 0, 40, "wood_dark", left=planksV(4), right=planksV(4))]
    for sx in (-0.45, 0.39): bx.append(B(sx, sx + 0.06, -0.2, 0.12, 0, 40, "wood", left=planksV(3), right=planksV(3)))
    for z in (0, 13, 26, 39): bx.append(B(-0.45, 0.45, -0.2, 0.12, z, z + 2.5, "wood", top=planksH(3)))
    def stuff(cv, r, m):
        toon_at(cv, -0.2, -0.04, 15.5, r, m, lambda c: (c.part([(11, 24), (15, 24), (15, 15), (11, 15)], "cloth_red", lw=0.5, shade=0.3, hl=0.2), c.part([(15, 24), (19, 24), (19, 17), (15, 17)], "cloth_blue", lw=0.5, shade=0.3, hl=0.2), c.part([(19, 24), (22, 24), (23, 16), (20, 16)], "cloth_yellow", lw=0.5, shade=0.3, hl=0.2)))
        toon_at(cv, 0.2, -0.04, 15.5, r, m, lambda c: c.part(ellipse_pts(16, 21, 3.5, 3.2, n=16), "glass", lw=0.6, shade=0.3, hl=0.3, gloss=[(15, 19.5, 0.7, 1.2)]))
        toon_at(cv, 0.0, -0.04, 28.5, r, m, lambda c: (c.part(ellipse_pts(13, 21, 3.2, 3.0, n=16), "pumpkin", lw=0.6, shade=0.3, hl=0.2), c.part(ellipse_pts(20, 22, 2.4, 2.0, n=14), "berry", lw=0.5, shade=0.3, hl=0.2)))
        toon_at(cv, -0.1, -0.04, 2.5, r, m, lambda c: c.part([(10, 24), (22, 24), (21, 19), (11, 19)], "thatch", lw=0.6, shade=0.3, hl=0.2))
    return bx, [(-1, stuff)]

def loom():
    bx = [B(-0.8, -0.72, -0.25, 0.25, 0, 36, "wood_dark"), B(0.72, 0.8, -0.25, 0.25, 0, 36, "wood_dark"),
          B(-0.8, 0.8, -0.05, 0.03, 33, 37, "wood"), B(-0.8, 0.8, -0.3, 0.3, 12, 14, "wood", top=planksH(3)),
          B(-0.62, 0.62, -0.02, 0.0, 14, 33, "cloth_cream", left=lambda w, h, s: tex_planks(w, h, s, board=2, gaps=False, vertical=True), right=flat(), faces="l", edge=False),
          B(-0.62, 0.62, -0.03, 0.01, 14, 22, "cloth_purple", left=lambda w, h, s: tex_planks(w, h, s, board=2, gaps=False), faces="l"),
          B(-0.7, 0.7, 0.18, 0.26, 18, 21, "wood"), B(-0.6, -0.5, 0.1, 0.3, 0, 12, "wood_dark"), B(0.5, 0.6, 0.1, 0.3, 0, 12, "wood_dark")]
    return bx, [(-1, lambda cv, r, m: toon_at(cv, 0.65, 0.3, 14, r, m, lambda c: c.part(ellipse_pts(16, 21, 3.4, 3.0, n=16), "cloth_purple", lw=0.6, shade=0.3, hl=0.2)))]

RUG_COLS = [("cloth_red", "cloth_yellow"), ("cloth_teal", "cloth_cream"), ("cloth_purple", "flower_pink"), ("cloth_green", "flower_yel")]
def rug(v=0):
    a, b = RUG_COLS[v]
    bx = [B(-0.46, 0.46, -0.36, 0.36, 0, 1.0, a, top=lambda w, h, s, v=v: rug_tex(w, h, s, v), faces="tlr")]
    return bx, []
def rug_tex(w, h, s, v):
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32); cx, cy = w / 2, h / 2
    d = np.maximum(np.abs(xx - cx) / cx, np.abs(yy - cy) / cy)
    t = 1.0 + np.where((d > 0.78) & (d < 0.86), -1.2, 0) + np.where(d > 0.92, 1.0, 0)
    dia = (np.abs(xx - cx) / cx + np.abs(yy - cy) / cy)
    t = np.where((dia < 0.5) & (dia > 0.32), -1.0, t) + (noise(w, h, SS, s) - 0.5) * 0.2
    return t

def potted_plant(v=0):
    def plant(c):
        c.part([(11, 27), (21, 27), (22.5, 19), (9.5, 19)], "brick", lw=0.7, shade=0.3, hl=0.2)
        c.part(capsule_pts(9, 19, 23, 19, 1.2), "brick", lw=0.6, shade=0.2, hl=0.2, base_col=ramp("brick")[0])
        if v == 0:
            for a in (-0.7, -0.3, 0.1, 0.5, 0.9): c.part(ellipse_pts(16 + math.sin(a) * 5, 13 - math.cos(a) * 4, 2.6, 4.5, rot=a, n=16), "leaf", lw=0.6, shade=0.3, hl=0.25)
        elif v == 1:
            c.part(capsule_pts(16, 19, 16, 7, 3.2, 2.8), "frog", lw=0.7, shade=0.3, hl=0.25)
            for s in (-1, 1): c.part(capsule_pts(16, 13, 16 + s * 5, 11, 1.6), "frog", lw=0.6, shade=0.3, hl=0.25)
            c.part(ellipse_pts(16, 5.5, 1.8, 1.6, n=12), "flower_pink", lw=0.5, shade=0.2, hl=0.2)
        else:
            c.line([(16, 19), (16, 9)], ramp("grass")[3], 0.8)
            for a in range(5): c.part(ellipse_pts(16 + math.cos(a * 1.26) * 2.6, 8 + math.sin(a * 1.26) * 2.2, 2.0, 1.8, n=12), "flower_blue", lw=0.5, shade=0.2, hl=0.1)
            c.fill(ellipse_pts(16, 8, 1.1, 1.1, n=10), ramp("flower_yel")[0])
    return [], [(-1, lambda cv, r, m: toon_at(cv, 0, 0, 0, r, m, plant))]

def flower_box(v=0):
    cols = [["flower_pink", "flower_yel", "flower_blue", "flower_pink"], ["berry", "flower_yel", "berry", "flower_yel"],
            ["flower_blue", "cloth_cream", "flower_blue", "cloth_cream"], ["flower_yel", "pumpkin", "flower_yel", "pumpkin"]][v]
    def fb(c):
        for i, (dx, col) in enumerate(zip((-9, -3, 3, 9), cols)):
            x, y = 16 + dx, 22 - (i % 2) * 1.5
            c.line([(x, 25), (x, y)], ramp("grass")[3], 0.8)
            for a in range(5): c.part(ellipse_pts(x + math.cos(a * 1.2566 + i) * 1.5, y + math.sin(a * 1.2566 + i) * 1.3, 1.25, 1.1, n=12), col, lw=0.5, shade=0.2, hl=0.1)
            c.fill(ellipse_pts(x, y, 0.8, 0.8, n=10), ramp("flower_yel")[0])
    return [B(-0.4, 0.4, -0.2, 0.2, 0, 9, "wood", left=planksH(3), right=planksH(3), top=flat())], [(-1, lambda cv, r, m: toon_at(cv, 0.0, 0.0, 9, r, m, fb))]

PAINTINGS = 6
def painting(v=0):
    """wall-hung: a framed canvas just in front of a wall centred in the same cell (y = T)."""
    def art(c):
        fr = [(7, 6), (25, 6), (25, 24), (7, 24)]
        c.part(fr, "wood", lw=0.9, shade=0.3, hl=0.25)
        inner = [(9, 8), (23, 8), (23, 22), (9, 22)]
        sky = ["cloth_blue", "flower_pink", "cloth_yellow", "cloth_teal", "cloth_purple", "glass"][v]
        m = c.part(inner, sky, lw=0.3, shade=0.2, hl=0.1, outline=False)
        if v == 0: c.fill(ellipse_pts(16, 24, 11, 6, n=24), ramp("grass")[1], clip=m); c.fill(ellipse_pts(19, 12, 2, 2, n=12), ramp("flower_yel")[0], clip=m)   # meadow + sun
        elif v == 1: c.part(ellipse_pts(16, 16, 4, 4.5, n=20), "cloth_cream", lw=0.4, shade=0.2, hl=0.2); c.fill(ellipse_pts(14.6, 15.5, 0.6, 0.8, n=8), ramp("ink")[3]); c.fill(ellipse_pts(17.4, 15.5, 0.6, 0.8, n=8), ramp("ink")[3])  # portrait
        elif v == 2: c.part([(10, 22), (14, 13), (18, 22)], "stone", lw=0.4, shade=0.2, hl=0.2); c.part([(15, 22), (19, 11), (23, 22)], "stone", lw=0.4, shade=0.2, hl=0.2)  # mountains
        elif v == 3: c.part(ellipse_pts(16, 16, 4.5, 3, n=20), "pumpkin", lw=0.4, shade=0.2, hl=0.2); c.line([(16, 13), (17, 11)], ramp("bark")[2], 0.6)   # still life
        elif v == 4: c.fill(ellipse_pts(18, 12, 2.6, 2.6, n=16), ramp("cloth_cream")[0], clip=m); c.fill(ellipse_pts(19, 11.5, 2.2, 2.2, n=16), ramp(sky)[1], clip=m)  # moon night
        else: c.part(ellipse_pts(16, 17, 4, 3.5, n=20), "zomb_mint", lw=0.4, shade=0.2, hl=0.2); c.fill(ellipse_pts(14.5, 16, 1.0, 1.0, n=8), (255, 255, 255)); c.fill(ellipse_pts(17.8, 16.4, 0.6, 0.6, n=8), (255, 255, 255))  # zombie portrait :)
    def back(c): c.part([(7, 6), (25, 6), (25, 24), (7, 24)], "wood_dark", lw=0.9, shade=0.3, hl=0.2)
    def dec(cv, r, m):
        f = lw_fn(r, m); vis = r in (0, 1)
        toon_at(cv, 0.0, T + 0.03, 20, r, m, art if vis else back)
    return [], [(-1, dec)]

def trophy_skull():
    def art(c):
        c.part([(10, 6), (22, 6), (24, 18), (16, 26), (8, 18)], "wood", lw=0.9, shade=0.3, hl=0.25)
        c.part(ellipse_pts(16, 14, 5.5, 5.0, n=24), "zomb_mint", lw=0.8, shade=0.25, hl=0.2)
        c.part(ellipse_pts(14, 13.5, 1.9, 1.9, n=14), "cloth_cream", lw=0.4, shade=0.1, hl=0.0); c.fill(ellipse_pts(14.3, 13.8, 0.9, 0.9, n=8), ramp("ink")[3])
        c.part(ellipse_pts(18.6, 14, 1.2, 1.1, n=12), "cloth_cream", lw=0.4, shade=0.1, hl=0.0); c.fill(ellipse_pts(18.6, 14.2, 0.5, 0.5, n=8), ramp("ink")[3])
        c.line([(13, 17.5), (16, 18.5), (19, 17.5)], ramp("ink")[2], 0.5); c.part(ellipse_pts(17, 19.3, 1.0, 1.2, n=10), "flower_pink", lw=0.3, shade=0.2, hl=0.2)
        c.line([(12, 10), (17, 9)], ramp("zomb_mint")[3], 0.5)
    def back(c): c.part([(10, 6), (22, 6), (24, 18), (16, 26), (8, 18)], "wood_dark", lw=0.9, shade=0.3, hl=0.2)
    return [], [(-1, lambda cv, r, m: toon_at(cv, 0.0, T + 0.03, 22, r, m, art if r in (0, 1) else back))]

def lantern_frame(i=0, n=4):
    cv = Canvas(128, 128, seed=3); cx, cy = 64, 96
    cv.part(capsule_pts(cx, cy, cx, cy - 30, 1.5), "wood_dark", lw=0.9, shade=0.3, hl=0.2)
    cv.part(capsule_pts(cx - 4, cy - 30, cx + 6, cy - 30, 1.2), "wood_dark", lw=0.8, shade=0.3, hl=0.2)
    cv.part(ellipse_pts(cx, cy + 0.5, 5, 2, n=16), "stone", lw=0.7, shade=0.3, hl=0.2)
    lx, ly = cx + 5, cy - 22
    cv.line([(lx, cy - 30), (lx, ly - 7)], ramp("iron")[2], 0.6)
    m = cv.part([(lx - 4, ly - 6), (lx + 4, ly - 6), (lx + 3.5, ly + 4), (lx - 3.5, ly + 4)], "glass", lw=0.8, shade=0.2, hl=0.2, base_col=ramp("fire")[0], shade_col=ramp("fire")[1])
    k = [1.0, 0.85, 0.95, 0.8][i % 4]
    cv.fill(ellipse_pts(lx, ly, 1.6 * k, 2.6 * k, n=14), ramp("fire")[1]); cv.fill(ellipse_pts(lx, ly + 0.5, 0.8, 1.3, n=10), (255, 255, 240))
    cv.part(capsule_pts(lx - 4.5, ly - 6.5, lx + 4.5, ly - 6.5, 1.0), "iron", lw=0.6, shade=0.3, hl=0.2); cv.part(capsule_pts(lx - 4, ly + 4.5, lx + 4, ly + 4.5, 1.0), "iron", lw=0.6, shade=0.3, hl=0.2)
    for x in (lx - 3.7, lx + 3.7): cv.line([(x, ly - 6), (x, ly + 4)], ramp("iron")[2], 0.5)
    return cv

def claim_totem():
    cv = Canvas(128, 128, seed=5); cx, cy = 64, 96
    cv.part(ellipse_pts(cx, cy, 9, 3.5, n=20), "stone", lw=0.8, shade=0.3, hl=0.2)
    for k, (rp, face) in enumerate([("wood", 0), ("wood_dark", 1), ("wood", 2)]):
        y = cy - 6 - k * 14
        m = cv.part([(cx - 7, y + 1), (cx - 7.5, y - 13), (cx + 7.5, y - 13), (cx + 7, y + 1)], rp, lw=1.0, shade=0.3, hl=0.2)
        for s in (-1, 1): cv.fill(ellipse_pts(cx + s * 3, y - 8, 1.8, 1.4, n=12), ramp("cloth_cream")[0]); cv.fill(ellipse_pts(cx + s * 3, y - 7.8, 0.8, 0.8, n=8), ramp("ink")[3])
        cv.line([(cx - 3, y - 3.5), (cx, y - 2.5 - (k % 2)), (cx + 3, y - 3.5)], ramp("ink")[2], 0.6)
        cv.line([(cx - 7, y - 11), (cx + 7, y - 11)], ramp("cloth_red")[1], 0.9, clip=m)
    for s in (-1, 1): cv.part([(cx + s * 7, cy - 36), (cx + s * 16, cy - 40), (cx + s * 15, cy - 33), (cx + s * 7, cy - 31)], "cloth_teal", lw=0.8, shade=0.3, hl=0.2)   # wings
    cv.line([(cx, cy - 48), (cx, cy - 64)], ramp("wood_dark")[1], 1.0)
    cv.part([(cx, cy - 64), (cx + 11, cy - 61), (cx, cy - 57)], "cloth_yellow", lw=0.7, shade=0.3, hl=0.2)
    cv.part(ellipse_pts(cx, cy - 49, 2.2, 2.2, n=12), "mush_glow", lw=0.6, shade=0.2, hl=0.3)    # glowing gem (claim beacon)
    return cv
