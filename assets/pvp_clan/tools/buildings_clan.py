"""4. Clan base: reinforced building tier (iron-banded wood & stone, clan trim). Each piece: damageStage 0-3 x rotation (mirror art).
Front-most-corner pivot. Tint mask: R = clan primary trim, G = clan secondary (emblem/plaque). Also raid states: gate breached."""
import math, numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageChops
from common import *
from iso import IsoCanvas, tex_planks, tex_cobble, tex_flat, tex_thatch, add_outline, damage, ramp_color
from toon import Canvas, capsule_pts
from fx_combat import star, round_poly

RP = lambda n: [H(c) for c in RAMPS[n]]
INKC = H("#3b2433")

class Piece:
    """IsoCanvas + toon Canvas sharing one SS image, plus tint-mask and emissive canvases. 1x coords for polys."""
    def __init__(self, W, Hh, fw, fh, seed=1):
        # front corner of the footprint (fw x fh tiles, centred at 0,0) lands on frame (W/2, Hh-8)
        self.W, self.Hh = W, Hh; self.fw, self.fh = fw, fh
        ox = W / 2 - (fw - fh) * 16; oy = (Hh - 8) - (fw + fh) * 8
        self.ic = IsoCanvas(W, Hh, ox, oy, seed); self.cv = Canvas(W, Hh, seed=seed); self.cv.img = self.ic.img
        self.tm = Canvas(W, Hh, seed=seed); self.em = Canvas(W, Hh, seed=seed); self.seed = seed
    def sync_in(self): self.ic.img = self.cv.img
    def sync_out(self): self.cv.img = self.ic.img
    def p(self, x, y, z): sx, sy = self.ic.P(x, y, z); return (sx / SS, sy / SS)
    def box(self, *a, **k):
        self.sync_in(); q = self.ic.box(*a, **k); self.ic.ink_edges(q, width=0.5, alpha=150); self.sync_out(); return q
    def part(self, pts, rp, **k): self.cv.part(pts, rp, **k)
    def fill(self, pts, col, **k): self.cv.fill(pts, col, **k)
    def line(self, pts, col, w=1.0, **k): self.cv.line(pts, col, w, **k)
    def front(self, x0, x1, y, z0, z1): return [self.p(x0, y, z1), self.p(x1, y, z1), self.p(x1, y, z0), self.p(x0, y, z0)]
    def right(self, x, y0, y1, z0, z1): return [self.p(x, y1, z1), self.p(x, y0, z1), self.p(x, y0, z0), self.p(x, y1, z0)]
    def tint(self, pts, ch=0, v=255): mask_paint(self.tm, pts if isinstance(pts[0], list) else [pts], v, ch, 0.35)
    # --- details
    def band_front(self, x0, x1, y, z, h=4, rivets=4, rp="iron"):
        q = self.front(x0, x1, y, z, z + h); self.part(q, RP(rp), lw=0.7, shade=0.2, hl=0.25)
        for i in range(rivets):
            t = (i + 0.5) / rivets; c = self.p(x0 + (x1 - x0) * t, y, z + h / 2)
            self.fill(circle(c[0], c[1], 0.8, 10), H(RAMPS[rp][3])); self.fill(circle(c[0] - 0.3, c[1] - 0.3, 0.35, 8), H(RAMPS[rp][0]))
    def band_right(self, x, y0, y1, z, h=4, rivets=2, rp="iron"):
        q = self.right(x, y0, y1, z, z + h); self.part(q, [lerp(c, INKC, 0.15) for c in RP(rp)], lw=0.7, shade=0.2, hl=0.1)
        for i in range(rivets):
            t = (i + 0.5) / rivets; c = self.p(x, y1 + (y0 - y1) * t, z + h / 2); self.fill(circle(c[0], c[1], 0.8, 10), H(RAMPS[rp][3]))
    def bunting(self, x0, x1, y, z, n=3, depth=7, ch=0):
        """scalloped clan cloth draped along a front face (tint R)"""
        pts = [self.p(x0, y + 0.01, z)]
        for i in range(n):
            for t in np.linspace(0, 1, 10):
                u = x0 + (x1 - x0) * (i + t) / n; pts.append(self.p(u, y + 0.01, z - depth * (0.45 + 0.55 * math.sin(t * math.pi))))
        pts.append(self.p(x1, y + 0.01, z))
        self.part(pts, NEUTRAL, lw=0.8, shade=0.18, hl=0.1); self.tint(pts, ch)
        for i in range(n + 1):   # little gold pins
            c = self.p(x0 + (x1 - x0) * i / n, y + 0.01, z - 1); self.part(circle(c[0], c[1], 1.3, 12), RP("gold"), lw=0.5)
    def plaque(self, x, y, z, r=5.0, ch=1):
        """round iron shield boss with an emblem disc (tint G)"""
        c = self.p(x, y + 0.01, z); o = circle(c[0], c[1], r, 30, r * 1.08)
        self.part(o, RP("iron"), lw=0.8, shade=0.25, hl=0.2)
        i = circle(c[0], c[1], r * 0.62, 26, r * 0.68); self.part(i, NEUTRAL, lw=0.5, shade=0.15); self.tint(i, ch)
        st = rstar(c[0], c[1] + 0.2, r * 0.42, r * 0.2, 5, -math.pi / 2, p=1.1); self.fill(st, NEUTRAL[0]); self.tint(st, 0 if ch == 1 else 1)
    def finish(self, stage, seed, lean=True):
        img = add_outline(self.cv.img, 1.0, seed)
        img = damage(img, stage, seed)
        tm = self.tm.img; em = self.em.img
        if stage == 3 and lean:   # leaning: shear by height above the pivot
            k = 0.06 * (1 if seed % 2 else -1); piv = (self.Hh - 8) * SS
            coeff = (1, k, -k * piv, 0, 1, 0)
            img, tm, em = (im.transform(im.size, Image.AFFINE, coeff, resample=Image.BICUBIC) for im in (img, tm, em))
        tm = apply_alpha_from(tm, img); em = apply_alpha_from(em, img)
        return img, tm, em

def mirror(img): return img.transpose(Image.FLIP_LEFT_RIGHT)

# ------------------------------------------------------------------ pieces
def planks_v(board=6): return lambda w, h, s: tex_planks(w, h, s, board=board, vertical=True)
def planks_h(board=7): return lambda w, h, s: tex_planks(w, h, s, board=board)
def cobble(cell=6.5): return lambda w, h, s: tex_cobble(w, h, s, cell=cell)

def missing_planks(pc, x0, x1, y, z0, z1, n, seed):
    """punch dark gaps where planks fell out (stage 3), with a cute cross-plank patch"""
    rng = np.random.default_rng(seed)
    for i in range(n):
        u = x0 + (x1 - x0) * (0.15 + 0.7 * rng.random()); w = 0.09
        zz0 = z0 + 4 + rng.random() * 10; zz1 = zz0 + 12 + rng.random() * 12
        q = pc.front(u, u + w, y + 0.005, zz0, min(z1 - 2, zz1)); pc.fill(q, lerp(H(RAMPS["wood_dark"][3]), INKC, 0.4))

def patch_planks(pc, x, y, z):
    a, b = pc.p(x - 0.12, y + 0.012, z - 6), pc.p(x + 0.12, y + 0.012, z + 6)
    c, d = pc.p(x - 0.12, y + 0.012, z + 6), pc.p(x + 0.12, y + 0.012, z - 6)
    for p0, p1 in ((a, b), (c, d)): pc.part(capsule_pts(p0[0], p0[1], p1[0], p1[1], 1.4), RP("wood"), lw=0.6, shade=0.2)

def wall_wood(st, seed=1):
    pc = Piece(96, 128, 1, 1, seed)
    pc.box(-0.5, 0.5, -0.2, 0.2, 0, 48, "wood", left=planks_v(6), right=planks_v(6), top=lambda w, h, s: tex_flat(w, h, s, 1.4), seed=seed)
    for z in (9, 33): pc.band_front(-0.5, 0.5, 0.2, z, 4, 5); pc.band_right(0.5, -0.2, 0.2, z, 4, 2)
    if st >= 2: missing_planks(pc, -0.4, 0.3, 0.2, 0, 48, 1 if st == 2 else 3, seed)
    if st == 3: patch_planks(pc, 0.05, 0.2, 22)
    pc.box(-0.52, 0.52, -0.24, 0.24, 48, 53, "wood_dark", seed=seed + 5)
    for x in (-0.56, 0.38):
        pc.box(x, x + 0.18, -0.26, 0.26, 0, 56, "wood_dark", left=planks_v(9), seed=seed + 7)
        pc.box(x - 0.01, x + 0.19, -0.27, 0.27, 56, 59, "iron", seed=seed + 9)
    pc.bunting(-0.38, 0.38, 0.24, 45, 2, 8)
    pc.plaque(0.0, 0.2, 24, 5.5)
    return pc.finish(st, seed)

def wall_stone(st, seed=2):
    pc = Piece(96, 128, 1, 1, seed)
    pc.box(-0.5, 0.5, -0.22, 0.22, 0, 41, "cobble", left=cobble(), right=cobble(), seed=seed)
    pc.box(-0.52, 0.52, -0.25, 0.25, 41, 48, "wood_dark", left=planks_h(7), right=planks_h(7), seed=seed + 3)
    pc.band_front(-0.52, 0.52, 0.25, 42.5, 3.5, 6); pc.band_right(0.52, -0.25, 0.25, 42.5, 3.5, 2)
    merl = [(-0.5, -0.24), (-0.11, 0.11), (0.26, 0.5)]
    for i, (a, b) in enumerate(merl):
        if st == 3 and i == 1: continue                       # a missing merlon
        h = 58 if not (st >= 2 and i == 2) else 54
        pc.box(a, b, -0.22, 0.22, 48, h, "stone", left=cobble(5), right=cobble(5), seed=seed + 11 + i)
    pc.bunting(-0.42, 0.42, 0.25, 40.5, 3, 7)
    c = pc.p(0.0, 0.23, 20); pc.plaque(0.0, 0.22, 19, 5.0)
    if st == 3:  # tumbled bricks at the base
        for j, (x, dz) in enumerate(((0.35, 0), (0.5, 0), (0.42, 4))):
            q = pc.p(x, 0.4, dz); pc.part(wobbly(q[0], q[1] - 2, 3.4, 2.4, j, 0.1), RP("cobble"), lw=0.7, shade=0.3)
    return pc.finish(st, seed)

def palisade(st, seed=3):
    pc = Piece(96, 128, 1, 1, seed); rng = np.random.default_rng(seed)
    xs = np.linspace(-0.42, 0.42, 5); tops = [58, 63, 60, 64, 57]
    for i, x in enumerate(xs):
        if st == 3 and i == 3: continue                                    # a fallen log
        lean = (rng.random() - 0.5) * (3 if st >= 2 else 0.8)
        b = pc.p(x, 0, 0); t = pc.p(x, 0, tops[i]); t = (t[0] + lean, t[1])
        r = 5.2
        log = [(b[0] - r, b[1] + 1), (t[0] - r, t[1] + 4), (t[0], t[1] - 4), (t[0] + r, t[1] + 4), (b[0] + r, b[1] + 1)]
        pc.part(round_poly(log, 1.6), RP("bark"), lw=0.9, shade=0.3, hl=0.18)
        tip = [(t[0] - r + 0.8, t[1] + 4.5), (t[0], t[1] - 3.5), (t[0] + r - 0.8, t[1] + 4.5), (t[0], t[1] + 6)]
        pc.part(round_poly(tip, 1.2), RP("wood"), lw=0.6, shade=0.2)     # whittled tip shows pale wood
        for k in range(2):
            y0 = b[1] - 12 - k * 18 - rng.random() * 6; pc.line([(b[0] - 2, y0), (b[0] - 1, y0 - 5)], H(RAMPS["bark"][3]), 0.6, alpha=170)
    for z in (14, 38):   # iron straps
        a, bb = pc.p(-0.5, 0.06, z), pc.p(0.5, 0.06, z)
        strap = [(a[0], a[1] - 2), (bb[0], bb[1] - 2), (bb[0], bb[1] + 2), (a[0], a[1] + 2)]
        pc.part(strap, RP("iron"), lw=0.7, shade=0.2)
        for x in xs: c = pc.p(x, 0.06, z); pc.fill(circle(c[0], c[1], 0.9, 10), H(RAMPS["iron"][3]))
    for i in (1, 3):   # clan cloth wraps (R)
        if st == 3 and i == 3: continue
        c = pc.p(xs[i], 0.06, 27); wrap = rrect(c[0] - 5.4, c[1] - 3, c[0] + 5.4, c[1] + 3, 1.5)
        pc.part(wrap, NEUTRAL, lw=0.6, shade=0.15); pc.tint(wrap, 0)
    t = pc.p(xs[2], 0, tops[2]); fl = [(t[0] + 0.5, t[1] - 4), (t[0] + 10, t[1] - 1.5), (t[0] + 0.5, t[1] + 1)]
    pc.part(capsule_pts(t[0], t[1] + 2, t[0], t[1] - 6, 0.7), RP("wood_dark"), lw=0.4)
    pc.part(fl, NEUTRAL, lw=0.6, shade=0.1); pc.tint(fl, 1)
    if st == 3:
        b = pc.p(0.5, 0.35, 0); pc.part(capsule_pts(b[0] - 18, b[1] - 1, b[0] + 4, b[1] - 6, 4.2), RP("bark"), lw=0.9, shade=0.3)
    return pc.finish(st, seed, lean=False)

def barricade(st, seed=4):
    pc = Piece(96, 128, 1, 1, seed)
    def stake(x, yd, z0, z1, broken=False):
        a = pc.p(x, 0, z0); b = pc.p(x, yd, z1)
        if broken: b = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        pc.part(capsule_pts(a[0], a[1], b[0], b[1], 2.2, 1.4), RP("wood"), lw=0.8, shade=0.25, hl=0.2)
        if not broken:
            pc.part(circle(b[0], b[1], 2.0, 14), RP("iron"), lw=0.6, gloss=[(b[0] - 0.6, b[1] - 0.6, 0.6, 0.5)])   # rounded iron caps (cute, not sharp)
    for x in (-0.36, 0.36):   # X frames
        for s in (-1, 1):
            a, b = pc.p(x, -0.35 * s, 0), pc.p(x, 0.35 * s, 30)
            pc.part(capsule_pts(a[0], a[1], b[0], b[1], 2.4), RP("wood_dark"), lw=0.8, shade=0.3)
    for i, x in enumerate((-0.25, 0.0, 0.25)): stake(x, -0.42, 15, 34, broken=(st == 3 and i == 0))
    a, b = pc.p(-0.5, 0, 16), pc.p(0.5, 0, 16)
    pc.part(capsule_pts(a[0], a[1], b[0], b[1], 3.4), RP("bark"), lw=0.9, shade=0.3, hl=0.2)
    for x in (-0.36, 0.36): c = pc.p(x, 0, 16); pc.part(rrect(c[0] - 1.6, c[1] - 4, c[0] + 1.6, c[1] + 4, 0.8), RP("iron"), lw=0.5)
    for i, x in enumerate((-0.25, 0.0, 0.25)): stake(x, 0.42, 15, 34, broken=(st >= 2 and i == 2))
    c = pc.p(0.08, 0.02, 16); bow = [wobbly(c[0] - 3, c[1] - 2, 3, 2.2, 1, 0.1), wobbly(c[0] + 3, c[1] - 2, 3, 2.2, 2, 0.1)]
    pc.part(bow, NEUTRAL, lw=0.6, shade=0.15); pc.tint(bow, 0)
    tails = [(c[0] - 1, c[1]), (c[0] - 3, c[1] + 7), (c[0], c[1] + 5), (c[0] + 3, c[1] + 7), (c[0] + 1, c[1])]
    pc.part(tails, NEUTRAL, lw=0.5, shade=0.1); pc.tint(tails, 1)
    pc.part(circle(c[0], c[1] - 1.5, 1.4, 12), NEUTRAL, lw=0.5); pc.tint(circle(c[0], c[1] - 1.5, 1.4, 12), 0)
    return pc.finish(st, seed, lean=False)

def chest(st, seed=5):
    pc = Piece(96, 128, 1, 1, seed)
    pc.box(-0.3, 0.3, -0.22, 0.22, 0, 18, "wood", left=planks_h(6), right=planks_h(6), seed=seed)
    pc.box(-0.32, 0.32, -0.24, 0.24, 18, 27, "wood", left=planks_h(5), right=planks_h(5), top=planks_h(6), seed=seed + 2)
    for x in (-0.3, 0.22): pc.box(x, x + 0.08, 0.21, 0.25, 0, 27, "iron", seed=seed + 4)   # corner straps
    pc.band_front(-0.32, 0.32, 0.24, 17, 2.4, 0)
    trim = pc.front(-0.3, 0.3, 0.245, 24, 27); pc.part(trim, NEUTRAL, lw=0.5, shade=0.1); pc.tint(trim, 0)
    # lid emblem plaque (G)
    c = pc.p(0, 0, 27); disc = circle(c[0], c[1], 5, 26, 2.6); pc.part(disc, NEUTRAL, lw=0.6, shade=0.15); pc.tint(disc, 1)
    # big cute padlock
    c = pc.p(0, 0.26, 15); 
    pc.line([(c[0] - 2.4, c[1] - 3), (c[0] - 2.4, c[1] - 5.5), (c[0], c[1] - 7.5), (c[0] + 2.4, c[1] - 5.5), (c[0] + 2.4, c[1] - 3)], H(RAMPS["iron"][3]), 1.6)
    lock = rrect(c[0] - 4, c[1] - 3.5, c[0] + 4, c[1] + 3.5, 1.8)
    if st < 3: pc.part(lock, RP("gold"), lw=0.8, shade=0.25, hl=0.2, gloss=[(c[0] - 2, c[1] - 2, 0.9, 0.6)]); pc.fill(circle(c[0], c[1] - 0.3, 1.0, 10), INKC); pc.fill([(c[0] - 0.5, c[1]), (c[0] + 0.5, c[1]), (c[0], c[1] + 2)], INKC)
    else:   # lock popped open, dangling
        pc.part(rot_pts(lock, 0.6, c[0], c[1]), RP("gold"), lw=0.8, shade=0.25)
    return pc.finish(st, seed, lean=False)

def bell(st, k=0, seed=6, ring=False):
    pc = Piece(96, 128, 1, 1, seed)
    for x in (-0.32, 0.24): pc.box(x, x + 0.08, -0.05, 0.05, 0, 66, "wood_dark", left=planks_v(9), seed=seed + 1)
    pc.box(-0.38, 0.38, -0.06, 0.06, 62, 68, "wood_dark", seed=seed + 3)
    for x in (-0.32, 0.24):   # diagonal braces
        a, b = pc.p(x + 0.04, 0.05, 50), pc.p(x + 0.04 + (0.14 if x < 0 else -0.14), 0.05, 62)
        pc.part(capsule_pts(a[0], a[1], b[0], b[1], 1.2), RP("wood_dark"), lw=0.5)
    # little roof
    L, Rr = pc.p(-0.48, 0, 68), pc.p(0.48, 0, 68); top = pc.p(0, 0, 80)
    roof = [(L[0] - 2, L[1] + 2), top, (Rr[0] + 2, Rr[1] + 2), (Rr[0] + 2, Rr[1] - 2), (top[0], top[1] - 4), (L[0] - 2, L[1] - 2)]
    pc.part(round_poly(roof, 1.5), RP("thatch"), lw=0.9, shade=0.25, hl=0.2)
    if st < 3:
        fl = [(top[0], top[1] - 4), (top[0] + 9, top[1] - 7), (top[0], top[1] - 10)]
        pc.part(capsule_pts(top[0], top[1] - 2, top[0], top[1] - 11, 0.7), RP("wood_dark"), lw=0.4); pc.part(fl, NEUTRAL, lw=0.5, shade=0.1); pc.tint(fl, 0)
    # bell (swings when ringing)
    ang = math.sin(k / 6 * 2 * math.pi) * 0.45 if ring else (0.25 if st == 3 else 0)
    hp = pc.p(0, 0, 61)
    bpts = [(hp[0] - 2.2, hp[1] + 2)] + [(hp[0] - 2.2 - 6.5 * t ** 1.5, hp[1] + 2 + 14 * t) for t in np.linspace(0, 1, 12)] + \
           [(hp[0] + 2.2 + 6.5 * t ** 1.5, hp[1] + 2 + 14 * t) for t in np.linspace(1, 0, 12)] + [(hp[0] + 2.2, hp[1] + 2)]
    bpts = rot_pts(bpts, ang, hp[0], hp[1])
    cl = rot_pts([(hp[0], hp[1] + 18)], ang * 1.4, hp[0], hp[1])[0]
    pc.part(circle(cl[0], cl[1], 1.9, 12), RP("iron"), lw=0.6)
    pc.part(bpts, RP("gold"), lw=0.9, shade=0.25, hl=0.25, gloss=[(hp[0] - 2.5, hp[1] + 7, 1.2, 2.2)])
    lip = rot_pts(rrect(hp[0] - 9.4, hp[1] + 14.5, hp[0] + 9.4, hp[1] + 17, 1.2), ang, hp[0], hp[1])
    pc.part(lip, RP("gold"), lw=0.7, shade=0.2)
    pc.line(rot_pts([(hp[0], hp[1] + 18), (hp[0] + 1, hp[1] + 34)], ang * 1.4, hp[0], hp[1]), H(RAMPS["leather"][1]), 0.9)  # pull rope
    # ding lines + little notes
    if ring and k in (1, 2, 4, 5):
        side = 1 if k in (1, 2) else -1
        for j in range(3):
            a = -0.6 + j * 0.6; r0, r1 = 13 + (k % 3) * 2, 17 + (k % 3) * 2
            pc.line([(hp[0] + side * math.cos(a) * r0, hp[1] + 9 + math.sin(a) * r0), (hp[0] + side * math.cos(a) * r1, hp[1] + 9 + math.sin(a) * r1)], (255, 236, 150), 1.3)
    img, tm, em = pc.finish(st, seed, lean=False)
    return img, tm, em

# ------------------------------------------------------------------ large pieces (160x256)
def gate(st, mode="closed", seed=7):
    pc = Piece(160, 256, 2, 1, seed)
    # back halves of the doors when open (swung inward)
    if mode == "open":
        for x in (-0.66, 0.6):
            pc.box(x, x + 0.06, -0.72, -0.02, 0, 52, "wood", left=planks_v(6), right=planks_v(6), seed=seed + 20)
    def tower(i, x):
        pc.box(x, x + 0.3, -0.42, 0.42, 0, 66, "cobble", left=cobble(6), right=cobble(6), seed=seed + i)
        pc.box(x - 0.02, x + 0.32, -0.44, 0.44, 66, 72, "wood_dark", left=planks_h(6), right=planks_h(6), seed=seed + 3)
        for j, (a, b) in enumerate(((-0.42, -0.14), (0.14, 0.42))):
            if st == 3 and i == 1 and j == 1: continue
            pc.box(x, x + 0.3, a, b, 72, 80, "stone", left=cobble(5), right=cobble(5), seed=seed + 5 + j)
        trim = pc.front(x, x + 0.3, 0.42, 58, 64); pc.part(trim, NEUTRAL, lw=0.6, shade=0.1); pc.tint(trim, 0)
        trim2 = pc.right(x + 0.3, -0.42, 0.42, 58, 64); pc.part(trim2, [lerp(c, NEUTRAL[3], 0.2) for c in NEUTRAL], lw=0.6, shade=0.1); pc.tint(trim2, 0)
    tower(0, -1.0)
    # lintel
    pc.box(-0.72, 0.72, -0.16, 0.16, 54, 62, "wood_dark", left=planks_h(8), right=planks_h(8), seed=seed + 9)
    pc.band_front(-0.72, 0.72, 0.16, 56, 3, 8)
    if mode == "closed":
        for i, (a, b) in enumerate(((-0.7, 0.0), (0.0, 0.7))):
            pc.box(a, b, -0.06, 0.06, 0, 54, "wood", left=planks_v(6), right=planks_v(6), seed=seed + 11 + i)
            for z in (10, 38): pc.band_front(a + 0.02, b - 0.02, 0.06, z, 4, 4)
            c = pc.p(b - 0.12 if i == 0 else a + 0.12, 0.07, 26)
            pc.line([(c[0] - 2.4, c[1] - 1), (c[0], c[1] + 2.6), (c[0] + 2.4, c[1] - 1)], H(RAMPS["gold"][2]), 1.4)   # ring handles
            pc.part(circle(c[0], c[1] - 1.6, 1.4, 12), RP("gold"), lw=0.5)
        if st >= 2: missing_planks(pc, -0.6, 0.5, 0.06, 0, 54, 1 if st == 2 else 3, seed)
        if st == 3: patch_planks(pc, -0.35, 0.06, 30)
        a, b = pc.p(-0.7, 0.07, 26), pc.p(0.7, 0.07, 26)    # crossbar
        pc.part(capsule_pts(a[0], a[1], b[0], b[1], 2.4), RP("wood_dark"), lw=0.8, shade=0.3)
    elif mode == "breached":
        # left door smashed with a big hole, right door hanging off one hinge, planks on the ground
        pc.box(-0.7, -0.05, -0.06, 0.06, 0, 54, "wood", left=planks_v(6), right=planks_v(6), seed=seed + 11)
        pc.band_front(-0.68, -0.07, 0.06, 38, 4, 3)
        hole = [pc.p(-0.55, 0.065, 8), pc.p(-0.32, 0.065, 4), pc.p(-0.15, 0.065, 14), pc.p(-0.1, 0.065, 30), pc.p(-0.3, 0.065, 36), pc.p(-0.5, 0.065, 28)]
        pc.fill(hole, lerp(H(RAMPS["wood_dark"][3]), INKC, 0.3))
        jag = hole + [hole[0]]
        for j in range(len(hole)):   # splintered rim
            p0, p1 = jag[j], jag[j + 1]; m = ((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2)
            pc.part([p0, (m[0] + (j % 2 * 2 - 1) * 1.5, m[1] - 2), p1], RP("wood"), lw=0.4, shade=0)
        sub = Piece(160, 256, 2, 1, seed + 1)
        sub.box(0.05, 0.7, -0.06, 0.06, 0, 54, "wood", left=planks_v(6), right=planks_v(6), seed=seed + 12)
        sub.band_front(0.07, 0.68, 0.06, 10, 4, 3); sub.band_front(0.07, 0.68, 0.06, 38, 4, 3)
        hinge = pc.p(0.7, 0.06, 50)
        dimg = sub.cv.img.rotate(-14 - st * 3, center=(hinge[0] * SS, hinge[1] * SS), resample=Image.BICUBIC)
        pc.cv.img = Image.alpha_composite(pc.cv.img, dimg)
        for j, (x, y, a) in enumerate(((-0.2, 0.5, 0.3), (0.2, 0.62, -0.5), (-0.55, 0.55, 1.2))):
            c = pc.p(x, y, 0); pl = rot_pts(rrect(c[0] - 9, c[1] - 2, c[0] + 9, c[1] + 2, 1), a, c[0], c[1])
            pc.part(pl, RP("wood"), lw=0.7, shade=0.25)
    # hanging clan banner from lintel (R) with plaque (G)
    if not (mode == "breached" and st >= 2):
        tl, tr_ = pc.p(-0.22, 0.17, 53), pc.p(0.22, 0.17, 53)
        b = [tl, tr_, pc.p(0.22, 0.17, 38), pc.p(0.0, 0.17, 33), pc.p(-0.22, 0.17, 38)]
        if mode == "breached": b = rot_pts(b, 0.25, tl[0], tl[1])
        pc.part(b, NEUTRAL, lw=0.8, shade=0.15, hl=0.1); pc.tint(b, 0)
        c = ((b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2 + 7); d = circle(c[0], c[1], 3.4, 20); pc.part(d, NEUTRAL, lw=0.5, shade=0.1); pc.tint(d, 1)
    tower(1, 0.7)
    return pc.finish(st, seed, lean=(mode != "open"))

def hall_door(st, seed=8):
    pc = Piece(160, 256, 2, 1, seed)
    def pillar(i, x):
        pc.box(x, x + 0.28, -0.4, 0.4, 0, 70, "stone", left=cobble(6), right=cobble(6), seed=seed + i)
        pc.box(x - 0.03, x + 0.31, -0.43, 0.43, 70, 75, "wood_dark", seed=seed + 2)
        pc.part([pc.p(x - 0.03, 0.43, 75), pc.p(x + 0.31, 0.43, 75), pc.p(x + 0.14, 0.43, 84)], RP("cobble"), lw=0.7, shade=0.2)
        # hanging banners (R)
        bx0, bx1 = x + 0.02, x + 0.26
        b = [pc.p(bx0, 0.41, 66), pc.p(bx1, 0.41, 66), pc.p(bx1, 0.41, 30), pc.p((bx0 + bx1) / 2, 0.41, 25), pc.p(bx0, 0.41, 30)]
        if not (st == 3 and i == 1): pc.part(b, NEUTRAL, lw=0.8, shade=0.15); pc.tint(b, 0)
        stp = [pc.p(bx0, 0.411, 40), pc.p(bx1, 0.411, 40), pc.p(bx1, 0.411, 37), pc.p(bx0, 0.411, 37)]
        if not (st == 3 and i == 1): pc.fill(stp, NEUTRAL[1]); pc.tint(stp, 1)
    pillar(0, -1.0)
    # arched stone frame + double door on the plane y=0
    def arch(x0, x1, z0, zs, zt, y, n=24):
        pts = [pc.p(x0, y, z0)]
        for t in np.linspace(0, 1, n):
            a = math.pi * (1 - t); u = (x0 + x1) / 2 + math.cos(a) * (x1 - x0) / 2; pts.append(pc.p(u, y, zs + math.sin(a) * (zt - zs)))
        pts.append(pc.p(x1, y, z0)); return pts
    fr = arch(-0.72, 0.72, 0, 48, 72, 0.12); pc.part(fr, RP("cobble"), lw=1.0, shade=0.15, hl=0.15)
    dr = arch(-0.6, 0.6, 0, 44, 64, 0.125)
    tex = Canvas(160, 256, seed=seed); tex.img = Image.new("RGBA", (160 * SS, 256 * SS))
    pc.part(dr, RP("wood"), lw=0.8, shade=0.12, hl=0.1)
    cl = pc.cv.mask_from(dr)
    for j in range(1, 8):    # vertical planks
        u = -0.6 + 1.2 * j / 8; pc.line([pc.p(u, 0.126, 0), pc.p(u, 0.126, 70)], H(RAMPS["wood"][2]), 0.7, clip=cl)
    pc.line([pc.p(0, 0.127, 0), pc.p(0, 0.127, 70)], H(RAMPS["wood_dark"][3]), 1.2, clip=cl)
    for z in (12, 34):
        q = pc.front(-0.6, 0.6, 0.128, z, z + 3.6); pc.part(q, RP("iron"), lw=0.6, shade=0.2, clip=cl)
        for j in range(10): c = pc.p(-0.55 + j * 0.122, 0.129, z + 1.8); pc.fill(circle(c[0], c[1], 0.8, 8), H(RAMPS["iron"][3]))
    for s in (-1, 1):   # knockers
        c = pc.p(s * 0.14, 0.13, 26); pc.line([(c[0] - 2.6, c[1]), (c[0], c[1] + 3), (c[0] + 2.6, c[1])], H(RAMPS["gold"][2]), 1.5); pc.part(circle(c[0], c[1] - 1, 1.6, 12), RP("gold"), lw=0.5)
    if st >= 2: missing_planks(pc, -0.5, 0.4, 0.125, 0, 44, 1 if st == 2 else 2, seed)
    if st == 3: patch_planks(pc, 0.3, 0.13, 20)
    # crest above the arch (G) with crown
    c = pc.p(0, 0.13, 70); sh = round_poly([(c[0] - 6, c[1] - 6), (c[0] + 6, c[1] - 6), (c[0] + 6, c[1] + 1), (c[0], c[1] + 7), (c[0] - 6, c[1] + 1)], 2)
    pc.part(sh, NEUTRAL, lw=0.8, shade=0.15); pc.tint(sh, 1)
    pc.part(rstar(c[0], c[1], 3, 1.5, 5, -math.pi / 2, p=1.1), RP("gold"), lw=0.5)
    pillar(1, 0.72)
    return pc.finish(st, seed)

def watchtower(st, seed=9):
    pc = Piece(160, 256, 2, 2, seed); rng = np.random.default_rng(seed)
    legs = [(-0.85, -0.85), (0.69, -0.85), (-0.85, 0.69), (0.69, 0.69)]
    for i, (x, y) in enumerate(legs[:3]):
        pc.box(x, x + 0.16, y, y + 0.16, 0, 92, "bark", left=planks_v(10), right=planks_v(10), seed=seed + i)
    # braces on front faces
    def brace(a, b): pc.part(capsule_pts(a[0], a[1], b[0], b[1], 1.6), RP("wood_dark"), lw=0.6, shade=0.25)
    if st < 3: brace(pc.p(-0.77, 0.85, 8), pc.p(0.77, 0.85, 80))
    brace(pc.p(0.77, 0.85, 8), pc.p(-0.77, 0.85, 80))
    brace(pc.p(0.85, -0.77, 8), pc.p(0.85, 0.77, 80)); 
    if st < 2: brace(pc.p(0.85, 0.77, 8), pc.p(0.85, -0.77, 80))
    pc.box(*legs[3], legs[3][0] + 0.16, legs[3][1] + 0.16, 0, 92, "bark", left=planks_v(10), right=planks_v(10), seed=seed + 4) if False else \
        pc.box(0.69, 0.85, 0.69, 0.85, 0, 92, "bark", left=planks_v(10), right=planks_v(10), seed=seed + 4)
    # ladder
    for x in (-0.25, 0.05): a, b = pc.p(x, 0.92, 0), pc.p(x, 0.92, 90); pc.part(capsule_pts(a[0], a[1], b[0], b[1], 1.2), RP("wood"), lw=0.6, shade=0.25)
    for z in range(8, 88, 11):
        if st == 3 and z in (41, 52): continue
        a, b = pc.p(-0.25, 0.92, z), pc.p(0.05, 0.92, z); pc.line([a, b], H(RAMPS["wood"][2]), 1.6)
    # platform
    pc.box(-1.0, 1.0, -1.0, 1.0, 88, 96, "wood", left=planks_h(6), right=planks_h(6), top=planks_h(7), seed=seed + 5)
    pc.band_front(-1.0, 1.0, 1.0, 89.5, 3, 8); pc.band_right(1.0, -1.0, 1.0, 89.5, 3, 6)
    # bunting under platform (R) + plaque (G)
    pc.bunting(-0.95, 0.95, 1.0, 88, 4, 8)
    q = []
    for i in range(4):
        for t in np.linspace(0, 1, 10):
            v = -0.95 + 1.9 * (i + t) / 4; q.append(pc.p(1.01, -v, 88 - 8 * (0.45 + 0.55 * math.sin(t * math.pi))))
    q = [pc.p(1.01, 0.95, 88)] + q + [pc.p(1.01, -0.95, 88)]
    pc.part(q, [lerp(c, NEUTRAL[3], 0.2) for c in NEUTRAL], lw=0.8, shade=0.15); pc.tint(q, 0)
    # roof posts + railing
    for (x, y) in ((-0.9, -0.9), (0.78, -0.9), (-0.9, 0.78)): pc.box(x, x + 0.12, y, y + 0.12, 96, 128, "wood_dark", seed=seed + 7)
    for z in (104, 111):
        a, b = pc.p(-0.95, 0.95, z), pc.p(0.95, 0.95, z); pc.part(capsule_pts(a[0], a[1], b[0], b[1], 1.3), RP("wood"), lw=0.6, shade=0.25)
        a, b = pc.p(0.95, 0.95, z), pc.p(0.95, -0.95, z); pc.part(capsule_pts(a[0], a[1], b[0], b[1], 1.3), RP("wood"), lw=0.6, shade=0.25)
    for v in np.linspace(-0.85, 0.85, 6):
        a, b = pc.p(v, 0.95, 96), pc.p(v, 0.95, 111); pc.line([a, b], H(RAMPS["wood"][2]), 1.2)
        a, b = pc.p(0.95, v, 96), pc.p(0.95, v, 111); pc.line([a, b], H(RAMPS["wood"][3]), 1.2)
    pc.box(0.78, 0.9, 0.78, 0.9, 96, 128, "wood_dark", seed=seed + 8)
    pc.plaque(0.0, 0.96, 104, 6.0)
    # pyramid thatch roof
    apex = pc.p(0, 0, 162); c4 = [pc.p(-1.15, -1.15, 126), pc.p(1.15, -1.15, 126), pc.p(1.15, 1.15, 126), pc.p(-1.15, 1.15, 126)]
    pc.sync_in()
    lf = [c4[3], c4[2], apex]; rf = [c4[2], c4[1], apex]
    pc.part(lf, RP("thatch"), lw=1.0, shade=0.08, hl=0.15); pc.part(rf, [lerp(c, H(RAMPS["thatch"][3]), 0.35) for c in RP("thatch")], lw=1.0, shade=0.08, hl=0.05)
    for j in range(1, 6):   # thatch rows
        t = j / 6
        for face, col in ((lf, RAMPS["thatch"][2]), (rf, RAMPS["thatch"][3])):
            a = (face[0][0] + (face[2][0] - face[0][0]) * t, face[0][1] + (face[2][1] - face[0][1]) * t)
            b = (face[1][0] + (face[2][0] - face[1][0]) * t, face[1][1] + (face[2][1] - face[1][1]) * t)
            pc.line([a, b], H(col), 0.8, alpha=200)
    if st >= 2:   # cute patch / hole in roof
        c = pc.p(0.2, 0.9, 136); pc.fill(wobbly(c[0], c[1], 4, 3, seed, 0.2), lerp(H(RAMPS["thatch"][3]), INKC, 0.4))
    # rim trim (R) along eaves
    eave = [c4[3], c4[2], (c4[2][0], c4[2][1] + 3), (c4[3][0], c4[3][1] + 3)]; pc.part(eave, NEUTRAL, lw=0.6, shade=0.1); pc.tint(eave, 0)
    eave2 = [c4[2], c4[1], (c4[1][0], c4[1][1] + 3), (c4[2][0], c4[2][1] + 3)]; pc.part(eave2, [lerp(c, NEUTRAL[3], 0.2) for c in NEUTRAL], lw=0.6, shade=0.1); pc.tint(eave2, 0)
    # flag on apex (secondary)
    pc.part(capsule_pts(apex[0], apex[1] + 2, apex[0], apex[1] - 20, 0.9), RP("wood_dark"), lw=0.5)
    fl = [(apex[0] + 0.8, apex[1] - 19), (apex[0] + 13, apex[1] - 16), (apex[0] + 9, apex[1] - 13.5), (apex[0] + 13, apex[1] - 11), (apex[0] + 0.8, apex[1] - 9)]
    if st < 3: pc.part(fl, NEUTRAL, lw=0.7, shade=0.12); pc.tint(fl, 1)
    pc.part(circle(apex[0], apex[1] - 21, 1.8, 12), RP("gold"), lw=0.5)
    return pc.finish(st, seed)

# ------------------------------------------------------------------ build
# (sprite key, draw fn, BuildPieceDef key from gameplay/data/pieces.json (or NEW), layer)
SMALL = [("wall_clan_wood", wall_wood, "wall", 1), ("wall_clan_stone", wall_stone, "wall", 1), ("wall_clan_palisade", palisade, "wall", 1),
         ("barricade_spiked", barricade, "barricade_spiked", 1), ("storage_box_locked", chest, "storage_box", 2), ("raid_bell", None, "raid_bell", 2)]
NEW_PIECES = {   # proposed additions for gameplay/data/pieces.json (Survival Systems owns numbers)
    "barricade_spiked": {"key": "barricade_spiked", "placement": "free", "layer": 1, "tiered": False, "tier": 2, "hp": 500, "ground": True, "blocksPath": True, "contactDamage": "proposed"},
    "raid_bell": {"key": "raid_bell", "placement": "free", "layer": 2, "tier": 2, "hp": 300, "ground": True, "alarm": "proposed: rings on structure damage within privilegeRadius"},
    "banner_wall": {"key": "banner_wall", "placement": "edge", "layer": 3, "tier": 1, "hp": 40, "solid": False, "paintable": True},
    "gate_clan": {"key": "gate_clan", "placement": "free", "layer": 1, "tier": 3, "hp": 1500, "footprint": {"w": 2, "h": 1}, "door": True, "blocksPath": True, "states": ["closed", "open", "breached"]},
    "clan_hall_door": {"key": "clan_hall_door", "placement": "free", "layer": 1, "tier": 3, "hp": 1200, "footprint": {"w": 2, "h": 1}, "door": True, "blocksPath": True},
    "watchtower": {"key": "watchtower", "placement": "free", "layer": 1, "tier": 2, "hp": 900, "footprint": {"w": 2, "h": 2}, "levels": 3, "ground": True},
}

def _bsprite(key, atlas, frames, piece, footprint, layer, anchor, extra=None, states=None):
    s = {"key": key, "category": "building", "atlas": atlas, "anchor": anchor, "rotationArt": "mirror",
         "animations": {"idle": {"frames": [frames[0][0]], "fps": 1}},
         "building": {"piece": piece, "footprint": {"w": footprint[0], "h": footprint[1]}, "layer": layer, "frames": frames}}
    if states: s["building"]["states"] = states
    if extra: s.update(extra)
    return s

def _stages(sh, key, fn, idx, prefix=""):
    r0, r1 = [], []
    for st in range(4):
        img, tm, em = fn(st)
        r0.append(sh.add(f"{key}/{prefix}damage{st}/r0", img, None, tm, idx=idx)); idx += 1
        r1.append(sh.add(f"{key}/{prefix}damage{st}/r1", mirror(img), None, mirror(tm), idx=idx)); idx += 1
    return [r0, r1, r0, r1], idx

def build(only=None):
    out = {}
    sm = Sheet("clan_buildings", 96, 128, 10, category="building", pivot=(0.5, 120 / 128)); spr = []
    anc = {"x": 0.5, "y": round(120 / 128, 5)}; idx = 0
    for key, fn, piece, layer in SMALL:
        rows, idx = _stages(sm, key, fn or (lambda st: bell(st)), idx)
        extra = None
        if key == "raid_bell":
            ring0, ring1 = [], []
            for k in range(6):
                img, tm, em = bell(0, k, ring=True)
                ring0.append(sm.add(f"{key}/ring/SE/{k}", img, None, tm, idx=idx)); ring1.append(sm.add(f"{key}/ring/SW/{k}", mirror(img), None, mirror(tm), idx=idx + 6)); idx += 1
            idx += 6
            extra = {"animations": {"idle": {"frames": [rows[0][0]], "fps": 1}, "ring": {"frames": ring0, "fps": 12}, "ring_r1": {"frames": ring1, "fps": 12}}}
        spr.append(_bsprite(key, "clan_buildings", rows, piece, (1, 1), layer, anc, extra))
    sm.sprites = spr; out["small"] = sm
    anc = {"x": 0.5, "y": round(248 / 256, 5)}
    gt = Sheet("clan_gates", 160, 256, 6, category="building", pivot=(0.5, 248 / 256)); idx = 0; st_rows = {}
    for mode in ("closed", "open", "breached"):
        st_rows[mode], idx = _stages(gt, "gate_clan", lambda s, m=mode: gate(s, m), idx, prefix=f"{mode}_")
    gt.sprites = [_bsprite("gate_clan", "clan_gates", st_rows["closed"], "gate_clan", (2, 1), 1, anc, states=st_rows,
                           extra={"animations": {"idle": {"frames": [st_rows["closed"][0][0]], "fps": 1}, "open": {"frames": [st_rows["open"][0][0]], "fps": 1}, "breached": {"frames": [st_rows["breached"][0][0]], "fps": 1}}})]
    out["gates"] = gt
    lg = Sheet("clan_structures_large", 160, 256, 6, category="building", pivot=(0.5, 248 / 256)); idx = 0; spr = []
    for key, fn, fp in (("clan_hall_door", hall_door, (2, 1)), ("watchtower", watchtower, (2, 2))):
        rows, idx = _stages(lg, key, fn, idx); spr.append(_bsprite(key, "clan_structures_large", rows, key, fp, 1, anc))
    lg.sprites = spr; out["large"] = lg
    return out

if __name__ == "__main__":
    import sys, time; t = time.time()
    o = build()
    for s in o.values():
        if s.frames: print(s.save(), s.warnings[:4])
    print("t", time.time() - t)
