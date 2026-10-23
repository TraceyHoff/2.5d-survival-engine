"""Stall art: player stall tiers (blanket 1x1, cart 2x1, booth 2x2) x 3 variants, clan pavilion 3x2, clan trading post 2x1,
props, world prompts, coin icons. Drawn at SS=4 (pvp_clan Piece kit, imported read-only) and LANCZOS-downscaled.
Each building atlas: 16 frames = state(closed,open) x damage(0..3) x rot(r0, r1=mirror); idx = state*8 + dmg*2 + rot."""
import sys, os, math, json
sys.path.insert(0, "/workspace/assets/pvp_clan/tools")
import numpy as np
from PIL import Image
import common
from common import *
from buildings_clan import Piece, planks_h, planks_v, RP, INKC, mirror
from iso import tex_thatch, tex_cobble, tex_flat
from toon import capsule_pts
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
common.ATL = os.path.join(ROOT, "atlases")
SAT = os.path.join(ROOT, "atlases")

def Rr(name): return RP(name)
def shade_ramp(r, k=0.15): return [lerp(c, INKC, k) for c in r]
CREAM = Rr("cloth_cream")

class SP(Piece):
    """Piece + sway mask canvas + attach-point recorder."""
    def __init__(self, W, Hh, fw, fh, seed=1):
        super().__init__(W, Hh, fw, fh, seed); self.sw = Canvas(W, Hh, seed=seed); self.attach = {}
        self.piv = (W / 2, Hh - 8)
    def sway(self, pts, v=255): mask_paint(self.sw, [pts], v, 0, 0.6)
    def occlude(self, pts):   # opaque non-tint part over tinted cloth: clear tint there
        mask_paint(self.tm, [pts], 0, 0, 0.2); mask_paint(self.tm, [pts], 0, 1, 0.2)
    def glow(self, pts, col): self.em.fill(pts, col)
    def att(self, name, x, y, z, w, h):
        px, py = self.p(x, y, z); self.attach[name] = {"x": round(px - self.piv[0], 1), "y": round(py - self.piv[1], 1), "z": round(z / 16, 2), "w": w, "h": h}
    def slot(self, name, x, y, z, w, h):
        """listing icon box; x/y = CENTRE of the box (icon sits with its bottom quarter on the surface point)"""
        self.att(name, x, y, z, w, h); self.attach[name]["y"] = round(self.attach[name]["y"] - 0.25 * h, 1)
    def tag(self, name, x, y, z, w=18, h=8):
        """price tag placement only (attach); no art is baked so unused listings show no blank board"""
        c = self.p(x, y, z)   # NOT baked: the renderer draws stall_price_tag (18x8 face) per enabled listing, text box on tagN
        # text box = tag face right of the string hole; x/y = CENTRE of that box (>= 14x6 at 1x: 7px coin icon + digits)
        bx0, bx1 = c[0] - w / 2 + 3.5, c[0] + w / 2 - 0.5
        self.attach[name] = {"x": round((bx0 + bx1) / 2 - self.piv[0], 1), "y": round(c[1] - self.piv[1], 1), "z": round(z / 16, 2), "w": round(bx1 - bx0, 1), "h": h - 2}
    def finish2(self, st, seed):
        img, tm, em = self.finish(st, seed, lean=False)
        sw = apply_alpha_from(self.sw.img, img)
        return img, tm, em, sw

def mat(p, x, y, z, r=4.5, rp="cloth_cream"):
    """little display mat where the renderer draws a goods icon"""
    q = [p.p(x - .12, y - .12, z), p.p(x + .12, y - .12, z), p.p(x + .12, y + .12, z), p.p(x - .12, y + .12, z)]
    p.part(q, shade_ramp(Rr(rp), 0.05), lw=0.5, shade=0.1, hl=0.1)

def stripes_tone(n=6):
    def f(w, h, s):
        xx = np.arange(w)[None, :].repeat(h, 0); return np.where((xx * n // max(1, w)) % 2 == 0, 0.0, 0.0) + tex_flat(w, h, s, amp=0.08)
    return f

def awning(p, x0, x1, yb, yf, zb, zf, ra, rb, n=6, scallop=4.0, tint=None):
    """striped sloped awning (sway-masked). ra/rb ramps alternate."""
    for i in range(n):
        u0 = x0 + (x1 - x0) * i / n; u1 = x0 + (x1 - x0) * (i + 1) / n
        q = [p.p(u0, yb, zb), p.p(u1, yb, zb), p.p(u1, yf, zf), p.p(u0, yf, zf)]
        rp = ra if i % 2 == 0 else rb
        p.part(q, rp, lw=0.6, shade=0.08, hl=0.15); p.sway(q, 150)
        if tint is not None and i % 2 == 0: p.tint(q, tint)
    for i in range(n):  # scalloped valance
        u0 = x0 + (x1 - x0) * i / n; u1 = x0 + (x1 - x0) * (i + 1) / n
        pts = [p.p(u0, yf, zf)] + [p.p(u0 + (u1 - u0) * t, yf, zf - scallop * math.sin(t * math.pi) - 1.2) for t in np.linspace(0, 1, 9)] + [p.p(u1, yf, zf)]
        rp = ra if i % 2 == 0 else rb
        p.part(pts, rp, lw=0.6, shade=0.2, hl=0.0); p.sway(pts, 255)
        if tint is not None and i % 2 == 0: p.tint(pts, tint)

def sign_board(p, x0, x1, y, z0, z1, rp="wood", tint=None):
    q = p.front(x0, x1, y, z0, z1); p.part(q, Rr(rp), lw=0.8, shade=0.18, hl=0.2)
    inner = p.front(x0 + 0.05, x1 - 0.05, y + 0.005, z0 + 2, z1 - 2)
    p.part(inner, [lerp(c, (255, 250, 240), 0.35) for c in Rr("wood")] if tint is None else NEUTRAL, lw=0.5, shade=0.1, hl=0.0)
    if tint is not None: p.tint(inner, tint)
    return inner

# ------------------------------------------------------------------ player tiers
BLANKET_V = [("patch", "cloth_red", "cloth_cream"), ("gingham", "cloth_blue", "cloth_cream"), ("picnic", "cloth_green", "cloth_yellow")]
def blanket(v, state, st, seed=11):
    name, ra, rb = BLANKET_V[v]; p = SP(96, 96, 1, 1, seed + v)
    p.ic.ground_shadow(-0.45, 0.45, -0.45, 0.45, 0.02, 0.18); p.sync_out()
    # blanket quilt: 4x4 patches
    for i in range(4):
        for j in range(4):
            x0, y0 = -0.42 + i * 0.21, -0.42 + j * 0.21
            q = [p.p(x0, y0, 1.5), p.p(x0 + .21, y0, 1.5), p.p(x0 + .21, y0 + .21, 1.5), p.p(x0, y0 + .21, 1.5)]
            p.part(q, Rr(ra if (i + j) % 2 == 0 else rb), lw=0.35, shade=0.05, hl=0.05, outline=(i in (0, 3) or j in (0, 3)))
    for t in np.linspace(-0.4, 0.4, 7):  # fringe on the front edge
        c = p.p(t, 0.43, 0); p.line([c, (c[0] - 0.8, c[1] + 2)], Rr(rb)[2], 0.7)
    # pillow at back + little sign stick
    c = p.p(-0.3, -0.32, 4); p.part(wobbly(c[0], c[1], 7, 4, seed=3), Rr(rb), lw=0.8, shade=0.25, hl=0.2)
    if v == 1:
        c = p.p(0.32, -0.3, 0); p.part(wobbly(c[0], c[1] - 5, 6, 6, seed=5), Rr("wood"), lw=0.8)
        p.line([(c[0] - 5, c[1] - 9), (c[0], c[1] - 16), (c[0] + 5, c[1] - 9)], Rr("wood")[2], 1.0)
    # sign: a cardboard stub on a stick behind
    s = p.p(0.05, -0.45, 0); p.line([s, (s[0], s[1] - 26)], Rr("wood")[2], 1.4)
    b = rrect(s[0] - 27, s[1] - 40, s[0] + 27, s[1] - 24, 2); p.part(b, [lerp(c, (255, 250, 240), 0.35) for c in Rr("wood")], lw=0.8, shade=0.2, hl=0.15)
    p.attach["sign"] = {"x": round(s[0] - p.piv[0], 1), "y": round(s[1] - 32 - p.piv[1], 1), "w": 50, "h": 12}
    if v == 2:  # tiny parasol (sways)
        c = p.p(-0.38, 0.1, 0); p.line([c, (c[0], c[1] - 40)], Rr("wood")[3], 1.2)
        um = [(c[0] - 16, c[1] - 34)] + [(c[0] + 16 * math.cos(a), c[1] - 38 - 9 * math.sin(a)) for a in np.linspace(math.pi, 0, 16)] + [(c[0] + 16, c[1] - 34)]
        p.part(um, Rr("cloth_yellow"), lw=0.8, shade=0.2, hl=0.2); p.sway(um, 200)
        for k in range(4): a = math.pi * (k + .5) / 4; p.line([(c[0], c[1] - 47), (c[0] + 15 * math.cos(a), c[1] - 34 - 4 * math.sin(a))], Rr("cloth_yellow")[2], 0.6)
    slots = [(-0.2, -0.05), (0.2, -0.05), (-0.2, 0.25), (0.2, 0.25)]
    if state == 1:
        for k, (x, y) in enumerate(slots):
            mat(p, x, y, 2); p.slot(f"slot{k}", x, y, 3, 16, 16)
        for k, (x, y) in enumerate(slots):
            c = p.p(x + 0.12, y + 0.14, 2); p.part(capsule_pts(c[0], c[1], c[0], c[1] - 6, 0.5), Rr("wood"), lw=0.3)
            p.tag(f"tag{k}", x + 0.12, y + 0.14, 10 + 6 * (k % 2))
    else:  # goods bundled under a tied cloth
        c = p.p(0, 0.08, 6); cl = wobbly(c[0], c[1], 22, 10, seed=8, wob=0.1)
        p.part(cl, Rr(rb), lw=1.0, shade=0.3, hl=0.15)
        p.line([(c[0] - 4, c[1] - 9), (c[0], c[1] - 6), (c[0] + 4, c[1] - 9)], Rr("leather")[2], 1.0)
        for k in range(4): p.att(f"slot{k}", 0, 0, 0, 0, 0); p.attach[f"tag{k}"] = dict(p.attach[f"slot{k}"])
    return p.finish2(st, seed + v), p.attach

CART_V = [("pine_red", "wood", "cloth_red", "cloth_cream"), ("dark_teal", "wood_dark", "cloth_teal", "cloth_cream"), ("sunny", "wood", "cloth_yellow", "cloth_green")]
def cart(v, state, st, seed=21):
    name, wd, ra, rb = CART_V[v]; p = SP(144, 144, 2, 1, seed + v)
    p.ic.ground_shadow(-0.95, 0.95, -0.45, 0.45, 0.02, 0.2); p.sync_out()
    # back posts
    for x in (-0.86, 0.78):
        p.box(x, x + 0.08, -0.42, -0.34, 0, 64, wd, left=planks_v(9), seed=seed + 1)
    p.box(-0.9, 0.9, -0.42, 0.42, 8, 28, wd, left=planks_h(6), right=planks_h(6), top=planks_h(7), seed=seed + 3)
    p.band_front(-0.9, 0.9, 0.42, 26, 2.5, 6, rp="wood_dark" if wd == "wood" else "wood")
    # wheels on the front (+y) face ends
    for x in (-0.6, 0.6):
        c = p.p(x, 0.44, 10); rim = circle(c[0], c[1], 9, 32, 10)
        p.part(rim, Rr("wood_dark"), lw=0.9, shade=0.25, hl=0.2); p.part(circle(c[0], c[1], 6, 24, 7), Rr("wood"), lw=0.5, shade=0.2)
        for a in np.linspace(0, math.pi, 4, endpoint=False): p.line([(c[0] - 6 * math.cos(a), c[1] - 7 * math.sin(a)), (c[0] + 6 * math.cos(a), c[1] + 7 * math.sin(a))], Rr("wood_dark")[2], 0.8)
        p.part(circle(c[0], c[1], 2, 12), Rr("iron"), lw=0.5)
    # handles on the right end
    a, b = p.p(0.9, 0.2, 16), p.p(1.12, 0.3, 12); p.part(capsule_pts(a[0], a[1], b[0], b[1], 1.2), Rr(wd), lw=0.5)
    if v == 2:
        for x in (-0.55, 0.55):  # flower box
            c = p.p(x, 0.43, 20)
            for k in range(3): p.part(circle(c[0] - 4 + k * 4, c[1] - 3, 2, 10), Rr("flower_pink" if k % 2 else "flower_yel"), lw=0.4)
    # front posts
    for x in (-0.86, 0.78):
        p.box(x, x + 0.08, 0.34, 0.42, 28, 58, wd, left=planks_v(9), seed=seed + 5)
    slots = [(-0.66 + 0.44 * i, -0.15 + 0.3 * j) for j in range(2) for i in range(4)]
    if state == 1:
        for k, (x, y) in enumerate(slots): mat(p, x, y, 28.5, rp=rb); p.slot(f"slot{k}", x, y, 30, 16, 16)
        for k, (x, y) in enumerate(slots[4:]): p.tag(f"tag{k + 4}", x + 0.12, 0.44, 22 - 8 * (k % 2))
        for k, (x, y) in enumerate(slots[:4]):  # back row tags hang from the awning
            p.tag(f"tag{k}", x, -0.1, 50 - 8 * (k % 2))
        awning(p, -0.95, 0.95, -0.45, 0.55, 66, 56, Rr(ra), Rr(rb), n=6)
    else:
        awning(p, -0.95, 0.95, -0.45, 0.55, 66, 56, Rr(ra), Rr(rb), n=6)
        # roll-down cloth curtain over the goods
        q = [p.p(-0.9, 0.5, 56), p.p(0.9, 0.5, 56), p.p(0.9, 0.46, 26), p.p(-0.9, 0.46, 26)]
        p.part(q, Rr(rb), lw=0.9, shade=0.2, hl=0.1); p.sway(q, 90)
        for x in np.linspace(-0.6, 0.6, 4): a, b = p.p(x, 0.505, 54), p.p(x, 0.47, 30); p.line([a, b], Rr(rb)[2], 0.7)
        for x in (-0.6, 0.6): a = p.p(x, 0.51, 40); p.line([(a[0] - 3, a[1]), (a[0] + 3, a[1] + 1)], Rr("leather")[2], 1.2)
        for k in range(8): p.att(f"slot{k}", 0, 0, 0, 0, 0); p.attach[f"tag{k}"] = dict(p.attach[f"slot{k}"])
    inner = sign_board(p, -0.45, 0.45, 0.56, 57, 69, rp=wd)
    p.att("sign", 0, 0.56, 63, 52, 10)
    return p.finish2(st, seed + v), p.attach

BOOTH_V = [("thatch", "wood", "thatch", "cloth_green"), ("redroof", "wood_dark", "brick", "cloth_red"), ("bluecloth", "wood", "cloth_blue", "cloth_yellow")]
def booth(v, state, st, seed=31):
    name, wd, roof, acc = BOOTH_V[v]; p = SP(144, 176, 2, 2, seed + v)
    p.ic.ground_shadow(-0.95, 0.95, -0.95, 0.95, 0.02, 0.2); p.sync_out()
    p.box(-0.98, 0.98, -0.98, 0.98, 0, 4, wd, top=planks_h(7), left=planks_h(4), right=planks_h(4), seed=seed)  # deck
    # back walls with shelves
    p.box(-0.95, 0.95, -0.95, -0.85, 4, 60, wd, left=planks_v(8), seed=seed + 2)
    p.box(-0.95, -0.85, -0.85, 0.6, 4, 60, wd, right=planks_v(8), left=planks_v(8), seed=seed + 4)
    shelf = [(-0.55, -0.7), (-0.15, -0.7), (0.25, -0.7), (0.65, -0.7)]
    for z in (22, 40):
        p.box(-0.85, 0.95, -0.85, -0.6, z, z + 3, wd, top=planks_h(6), seed=seed + z)
    for k, (x, y) in enumerate(shelf):
        z = 43 if k % 2 == 0 else 25
    # crates on the right (+x) side
    crates = [(0.7, -0.3), (0.7, 0.15)]
    for (x, y) in crates:
        p.box(x - 0.2, x + 0.2, y - 0.2, y + 0.2, 4, 18, "wood", left=planks_h(5), right=planks_h(5), top=planks_h(5), seed=seed + 7)
    # counter along the front (+y)
    p.box(-0.85, 0.5, 0.55, 0.9, 4, 26, wd, left=planks_h(6), right=planks_h(6), top=planks_h(6), seed=seed + 9)
    p.band_front(-0.85, 0.5, 0.9, 22, 3, 5, rp="wood_dark" if wd == "wood" else "wood")
    # posts
    for (x, y) in ((-0.95, 0.88), (0.88, 0.88), (0.88, -0.95)):
        p.box(x, x + 0.08, y, y + 0.08, 4, 66, wd, left=planks_v(9), seed=seed + 11)
    slots = [(x, y, z) for z in (25, 43) for (x, y) in ((-0.55, -0.72), (0.05, -0.72))]
    slots = [(-0.6, -0.72, 43.5), (0.0, -0.72, 43.5), (-0.6, -0.72, 25.5), (0.0, -0.72, 25.5),
             (0.6, -0.72, 43.5), (0.6, -0.72, 25.5),
             (-0.6, 0.72, 26.5), (-0.2, 0.72, 26.5), (0.2, 0.72, 26.5),
             (0.7, -0.3, 18.5), (0.7, 0.15, 18.5), (0.7, 0.55, 8)]
    if state == 1:
        for k, (x, y, z) in enumerate(slots):
            if z < 20 or y > 0: mat(p, x, y, z, rp=acc)
            p.slot(f"slot{k}", x, y, z + 2, 16, 16)
        for k, (x, y, z) in enumerate(slots):
            if y < -0.5: p.tag(f"tag{k}", x, -0.58, z - 5)
            elif y > 0.5 and z > 20: p.tag(f"tag{k}", x, 0.92, 16)
            else: p.tag(f"tag{k}", x, y + 0.22, z - 6)
    else:
        # shutters drop over the counter, crates covered
        q = [p.p(-0.9, 0.92, 62), p.p(0.92, 0.92, 62), p.p(0.92, 0.92, 26), p.p(-0.9, 0.92, 26)]
        p.part(q, Rr(wd), lw=0.9, shade=0.12, hl=0.1)
        for x in np.linspace(-0.9, 0.92, 9)[1:-1]: a, b = p.p(x, 0.925, 61), p.p(x, 0.925, 27); p.line([a, b], Rr(wd)[3], 0.7)
        for z in (34, 54): a, b = p.p(-0.85, 0.93, z), p.p(0.85, 0.93, z); p.line([a, b], Rr("iron")[2], 1.6)
        c = p.p(0.0, 0.93, 44); p.part(rrect(c[0] - 3, c[1] - 3, c[0] + 3, c[1] + 3, 1), Rr("gold"), lw=0.6)
        q = [p.p(0.92, 0.88, 62), p.p(0.92, -0.95, 62), p.p(0.92, -0.95, 26), p.p(0.92, 0.88, 26)]
        p.part(q, shade_ramp(Rr(wd), 0.2), lw=0.9, shade=0.1, hl=0.05)
        for k in range(12): p.att(f"slot{k}", 0, 0, 0, 0, 0); p.attach[f"tag{k}"] = dict(p.attach[f"slot{k}"])
    # roof
    L = 1.08
    if roof in ("thatch", "brick"):
        tex = (lambda w, h, s: tex_thatch(w, h, s)) if roof == "thatch" else planks_h(4)
        p.box(-L, L, -L, L, 66, 70, roof, top=tex, left=tex, right=tex, seed=seed + 13)
        ap = p.p(0, 0, 100); a, b, c_, d = p.p(-L, L, 70), p.p(L, L, 70), p.p(L, -L, 70), p.p(-L, -L, 70)
        p.part([a, b, ap], Rr(roof), lw=1.0, shade=0.12, hl=0.1)
        p.part([b, c_, ap], shade_ramp(Rr(roof), 0.25), lw=1.0, shade=0.12, hl=0.0)
        for t in np.linspace(0.15, 0.85, 4):
            p.line([(a[0] + (ap[0] - a[0]) * t, a[1] + (ap[1] - a[1]) * t), (b[0] + (ap[0] - b[0]) * t, b[1] + (ap[1] - b[1]) * t)], Rr(roof)[2], 0.8)
        p.part(circle(ap[0], ap[1] - 1, 3, 14), Rr("wood_dark"), lw=0.6)
    else:
        awning(p, -L, L, -L, L, 84, 66, Rr("cloth_blue"), Rr("cloth_cream"), n=8, scallop=5)
    # hanging goods under the eave: garlic, sausage, lantern (emissive)
    for k, x in enumerate((-0.7, -0.45, 0.62)):
        c = p.p(x, 0.98, 66); p.line([c, (c[0], c[1] + 6)], Rr("leather")[2], 0.6)
        if k == 0: p.part(wobbly(c[0], c[1] + 9, 3.5, 3.5, seed=2), Rr("cloth_cream"), lw=0.6); p.sway(circle(c[0], c[1] + 9, 4, 10), 180)
        elif k == 1: p.part(capsule_pts(c[0], c[1] + 6, c[0] + 1, c[1] + 14, 2.0), Rr("mush_red"), lw=0.6); p.sway(circle(c[0], c[1] + 10, 4, 10), 180)
    c = p.p(0.62, 0.98, 66); body = rrect(c[0] - 3.5, c[1] + 6, c[0] + 3.5, c[1] + 15, 1.5)
    p.part(rrect(c[0] - 4.5, c[1] + 4, c[0] + 4.5, c[1] + 6.5, 1), Rr("iron"), lw=0.5)
    p.part(body, Rr("fire") if state == 1 else Rr("glass"), lw=0.6, shade=0.15, hl=0.3)
    if state == 1: p.glow(body, H(RAMPS["fire"][0]))
    p.part(rrect(c[0] - 4.5, c[1] + 14.5, c[0] + 4.5, c[1] + 16.5, 1), Rr("iron"), lw=0.5)
    sign_board(p, -0.5, 0.5, 1.1, 70, 84, rp=wd)
    p.att("sign", 0, 1.1, 77, 58, 11)
    return p.finish2(st, seed + v), p.attach

def bunting_flags(p, pts3, n, tint_alt=True):
    """triangle pennants along a sagging string, R/G alternating (tintable), sway-masked"""
    a, b = pts3
    for i in range(n):
        t0, t1 = i / n, (i + 1) / n
        def at(t): x = a[0] + (b[0] - a[0]) * t; y = a[1] + (b[1] - a[1]) * t + 6 * math.sin(t * math.pi); return (x, y)
        u, w = at(t0 + 0.08 / n), at(t1 - 0.08 / n); m = at((t0 + t1) / 2)
        tri = [u, w, (m[0], m[1] + 7)]
        p.part(tri, NEUTRAL, lw=0.5, shade=0.15, hl=0.0); p.tint(tri, i % 2 if tint_alt else 0); p.sway(tri, 255)
    p.line([at(t) for t in np.linspace(0, 1, 16)], H(RAMPS["leather"][2]), 0.6)

def pavilion(state, st, seed=41):
    p = SP(208, 224, 3, 2, seed)
    p.ic.ground_shadow(-1.45, 1.45, -0.95, 0.95, 0.02, 0.2); p.sync_out()
    p.box(-1.5, 1.5, -1.0, 1.0, 0, 5, "cobble", top=cobble(5.5), left=cobble(5), right=cobble(5), seed=seed)
    # back canopy wall (clan cloth, R)
    q = [p.p(-1.4, -0.92, 78), p.p(1.4, -0.92, 78), p.p(1.4, -0.92, 5), p.p(-1.4, -0.92, 5)]
    p.part(q, NEUTRAL, lw=0.8, shade=0.12, hl=0.1); p.tint(q, 0)
    for x in np.linspace(-1.2, 1.2, 7): a, b = p.p(x, -0.915, 76), p.p(x, -0.915, 7); p.line([a, b], NEUTRAL[2], 0.6)
    p.plaque(0, -0.91, 58, 8, ch=1); p.att("emblem", 0, -0.91, 58, 12, 12)
    # back shelf (8 slots)
    for z in (24, 40): p.box(-1.3, 1.3, -0.9, -0.62, z, z + 3, "wood_dark", top=planks_h(6), seed=seed + z)
    p.box(-1.3, -1.24, -0.9, -0.62, 5, 43, "wood_dark", seed=seed + 3); p.box(1.24, 1.3, -0.9, -0.62, 5, 43, "wood_dark", seed=seed + 3)
    # side table on right (+x) end (8 slots)
    p.box(0.95, 1.4, -0.45, 0.55, 5, 22, "wood", left=planks_h(5), right=planks_h(5), top=planks_h(6), seed=seed + 5)
    # long front counter (8 slots)
    p.box(-1.35, 0.8, 0.5, 0.88, 5, 26, "wood", left=planks_h(6), right=planks_h(6), top=planks_h(6), seed=seed + 7)
    p.bunting(-1.35, 0.8, 0.88, 22, n=4, depth=6, ch=0)
    poles = [(-1.45, 0.9), (1.37, 0.9), (1.37, -0.98), (-1.45, -0.98)]
    for (x, y) in poles[:3]: p.box(x, x + 0.08, y, y + 0.08, 5, 92, "wood_dark", left=planks_v(9), seed=seed + 9)
    slots = [(-1.05 + 0.33 * i, -0.76, 43.5) for i in range(4)] + [(0.27 + 0.33 * i - 0.33, -0.76, 43.5) for i in range(4)]
    slots = [(-1.1 + 0.31 * i, -0.76, 43.5) for i in range(8)] + [(-1.1 + 0.31 * i, -0.76, 27.5) for i in range(8)] + \
            [(1.06, -0.3 + 0.25 * i, 22.5) for i in range(4)] + [(1.28, -0.3 + 0.25 * i, 22.5) for i in range(4)]
    front = [(-1.18 + 0.27 * i, 0.69, 26.5) for i in range(8)]
    slots = slots[:16] + [s for s in slots[16:]]
    allslots = slots[:8] + slots[8:16] + slots[16:24]
    # replace middle shelf with front counter to read better: 8 top shelf, 8 front counter, 8 side table
    allslots = slots[:8] + front + slots[16:24]
    if state == 1:
        for k, (x, y, z) in enumerate(allslots):
            if y > 0.3 or x > 0.9: mat(p, x, y, z - 0.5, 3.5, "cloth_cream")
            p.slot(f"slot{k}", x, y, z + 2, 14, 14)
        for k, (x, y, z) in enumerate(allslots):
            if k < 8: p.tag(f"tag{k}", x, -0.6, 37 - 8 * (k % 2))
            elif k < 16: p.tag(f"tag{k}", x, 0.9, 13 - 8 * (k % 2))
            else: p.tag(f"tag{k}", 1.42, y, 15 if k < 20 else 9)
    else:
        for k in range(24): p.att(f"slot{k}", 0, 0, 0, 0, 0); p.attach[f"tag{k}"] = dict(p.attach[f"slot{k}"])
    # roof: big peaked clan canopy, stripes R/G
    L0, L1, M0, M1 = -1.6, 1.52, -1.12, 1.05
    ap1, ap2 = p.p(-1.0, -0.03, 128), p.p(0.92, -0.03, 128)
    a, b, c_, d = p.p(L0, M1, 92), p.p(L1, M1, 92), p.p(L1, M0, 92), p.p(L0, M0, 92)
    p.part([c_, b, ap2], NEUTRAL[1:] + [NEUTRAL[3]], lw=1.0, shade=0.1, hl=0.0); p.tint([c_, b, ap2], 1)
    front = [a, b, ap2, ap1]; p.part(front, NEUTRAL, lw=1.0, shade=0.1, hl=0.15); p.tint(front, 0)
    for t in np.linspace(0.12, 0.88, 6):  # G stripes down the front slope
        s0 = (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t); s1 = (ap1[0] + (ap2[0] - ap1[0]) * t, ap1[1] + (ap2[1] - ap1[1]) * t)
        dd = 3.2; st_ = [(s0[0] - dd, s0[1] - dd / 2), (s0[0] + dd, s0[1] + dd / 2), (s1[0] + dd * .6, s1[1] + dd * .3), (s1[0] - dd * .6, s1[1] - dd * .3)]
        p.fill(st_, NEUTRAL[0]); mask_paint(p.tm, [st_], 0, 0, 0.3); p.tint(st_, 1)
    # scalloped valance + bunting across the front
    vals = []
    for i in range(8):
        u0, u1 = L0 + (L1 - L0) * i / 8, L0 + (L1 - L0) * (i + 1) / 8
        pts = [p.p(u0, M1, 92)] + [p.p(u0 + (u1 - u0) * t, M1, 92 - 6 * math.sin(t * math.pi) - 1) for t in np.linspace(0, 1, 9)] + [p.p(u1, M1, 92)]
        p.part(pts, NEUTRAL, lw=0.6, shade=0.2, hl=0.0); p.tint(pts, i % 2); p.sway(pts, 255)
    bunting_flags(p, (p.p(-1.45, 0.94, 80), p.p(1.4, 0.94, 80)), 9)
    # finials + pole banners
    for apx in (ap1, ap2): p.part(circle(apx[0], apx[1] - 2, 3.2, 14), Rr("gold"), lw=0.6, hl=0.3)
    top = (ap2[0], ap2[1] - 4); p.line([top, (top[0], top[1] - 20)], Rr("wood_dark")[2], 1.2)
    fl = [(top[0], top[1] - 20), (top[0] + 14, top[1] - 16), (top[0], top[1] - 11)]; p.part(fl, NEUTRAL, lw=0.6, shade=0.1); p.tint(fl, 0); p.sway(fl, 255)
    for (x, y) in (poles[0], poles[1]):
        c = p.p(x + 0.04, y + 0.09, 76); ban = [(c[0] - 6, c[1]), (c[0] + 6, c[1]), (c[0] + 6, c[1] + 26), (c[0], c[1] + 21), (c[0] - 6, c[1] + 26)]
        p.part(ban, NEUTRAL, lw=0.7, shade=0.15, hl=0.1); p.tint(ban, 0); p.sway(ban, 200)
        dsc = circle(c[0], c[1] + 10, 3.6, 18); p.part(dsc, NEUTRAL, lw=0.4, shade=0.1); p.tint(dsc, 1)
    if state == 0:  # drapes drawn closed across the front
        for k, (x0, x1) in enumerate(((-1.45, -0.3), (-0.3, 0.85), (0.85, 1.42))):
            q = [p.p(x0, 0.96, 90), p.p(x1, 0.96, 90), p.p(x1, 0.96, 5), p.p(x0, 0.96, 5)]
            p.part(q, NEUTRAL, lw=0.9, shade=0.12, hl=0.08); p.tint(q, 0); p.sway(q, 80)
            for t in np.linspace(0.2, 0.8, 3): a_, b_ = p.p(x0 + (x1 - x0) * t, 0.965, 88), p.p(x0 + (x1 - x0) * t, 0.965, 8); p.line([a_, b_], NEUTRAL[2], 0.7)
            c = p.p((x0 + x1) / 2, 0.97, 48); p.part(rrect(c[0] - 8, c[1] - 2, c[0] + 8, c[1] + 2, 1), RP("gold"), lw=0.5)
    # sign board hanging under the valance (tintable G)
    sign_board(p, -0.6, 0.6, 1.02, 70, 84, tint=1)
    p.att("sign", 0, 1.02, 77, 66, 10)
    # lanterns on poles (emissive at night: always drawn lit when open)
    for (x, y) in (poles[0], poles[1]):
        c = p.p(x + 0.04, y + 0.12, 50); body = rrect(c[0] - 3, c[1], c[0] + 3, c[1] + 8, 1.4)
        p.part(body, Rr("fire") if state == 1 else Rr("glass"), lw=0.6, shade=0.15, hl=0.3)
        if state == 1: p.glow(body, H(RAMPS["fire"][0]))
    return p.finish2(st, seed), p.attach

def cobble(c): return lambda w, h, s: tex_cobble(w, h, s, cell=c)

def trading_post(state, st, seed=51):
    p = SP(144, 160, 2, 1, seed)
    p.ic.ground_shadow(-0.95, 0.95, -0.45, 0.45, 0.02, 0.2); p.sync_out()
    # warehouse back wall with big door
    p.box(-0.95, 0.95, -0.5, -0.3, 0, 72, "wood_dark", left=planks_v(7), right=planks_v(7), top=planks_h(5), seed=seed)
    d = p.front(-0.35, 0.35, -0.29, 0, 50); p.part(d, Rr("wood"), lw=0.9, shade=0.15, hl=0.15)
    for z in (12, 38): p.band_front(-0.35, 0.35, -0.285, z, 3, 3)
    p.bunting(-0.95, 0.95, -0.29, 72, n=4, depth=7, ch=0)
    p.plaque(0, -0.28, 60, 6, ch=1); p.att("emblem", 0, -0.28, 60, 9, 9)
    # crates + barrel
    p.box(-0.9, -0.5, -0.25, 0.1, 0, 20, "wood", left=planks_h(5), right=planks_h(5), top=planks_h(5), seed=seed + 2)
    c = p.p(0.7, -0.08, 0); p.part([(c[0] - 9, c[1] - 26), (c[0] + 9, c[1] - 26), (c[0] + 10, c[1] - 2), (c[0] - 10, c[1] - 2)], Rr("wood"), lw=0.9, shade=0.25)
    for z in (6, 20): p.line([(c[0] - 10, c[1] - z), (c[0] + 10, c[1] - z)], Rr("iron")[2], 1.3)
    # counter (logs + iron bands)
    p.box(-0.95, 0.95, 0.12, 0.45, 0, 24, "wood", left=planks_h(5), right=planks_h(5), top=planks_h(7), seed=seed + 4)
    p.band_front(-0.95, 0.95, 0.45, 2, 3, 6); p.band_front(-0.95, 0.95, 0.45, 18, 3, 6)
    cl = p.front(-0.6, 0.6, 0.455, 7, 15); p.part(cl, NEUTRAL, lw=0.6, shade=0.15); p.tint(cl, 0)
    slots = [(-0.7 + 0.28 * i, 0.28, 24.5) for i in range(6)]
    if state == 1:
        for k, (x, y, z) in enumerate(slots): mat(p, x, y, z); p.slot(f"slot{k}", x, y, z + 2, 15, 15)
        for k, (x, y, z) in enumerate(slots): p.tag(f"tag{k}", x, 0.48, 20 if k % 2 else 12)
        # ledger chalkboard on the counter + bell
        c = p.p(0.82, 0.25, 24); p.part(rrect(c[0] - 6, c[1] - 14, c[0] + 6, c[1], 1.4), Rr("wood_dark"), lw=0.7)
        p.fill(rrect(c[0] - 4.5, c[1] - 12.5, c[0] + 4.5, c[1] - 1.5, 1), (70, 90, 80))
        for j in range(3): p.line([(c[0] - 3, c[1] - 10 + j * 3), (c[0] + 2.5 - j, c[1] - 10 + j * 3)], (235, 235, 220), 0.5)
    else:
        q = [p.p(-0.95, 0.46, 46), p.p(0.95, 0.46, 46), p.p(0.95, 0.46, 24), p.p(-0.95, 0.46, 24)]
        p.part(q, Rr("wood"), lw=0.9, shade=0.12, hl=0.1)
        for x in np.linspace(-0.95, 0.95, 7)[1:-1]: a, b = p.p(x, 0.465, 45), p.p(x, 0.465, 25); p.line([a, b], Rr("wood")[3], 0.7)
        c = p.p(0, 0.47, 35); p.part(rrect(c[0] - 3, c[1] - 3, c[0] + 3, c[1] + 3, 1), Rr("gold"), lw=0.6)
        for k in range(6): p.att(f"slot{k}", 0, 0, 0, 0, 0); p.attach[f"tag{k}"] = dict(p.attach[f"slot{k}"])
    sign_board(p, -0.55, 0.55, -0.28, 76, 90, tint=1); p.att("sign", 0, -0.28, 83, 60, 10)
    # shingle overhang
    p.box(-1.0, 1.0, -0.55, -0.25, 90, 94, "brick", top=planks_h(4), left=planks_h(3), seed=seed + 8)
    return p.finish2(st, seed), p.attach

# ------------------------------------------------------------------ atlas writing
class StallSheet(Sheet):
    def __init__(self, key, fw, fh, cols, pivot):
        super().__init__(key, fw, fh, cols, category="building", pivot=pivot); self.sway = {}; self.has_sway = False
    def addf(self, name, img, tm, em, sw, idx):
        has_t = np.asarray(tm)[..., :2].max() > 0; has_e = np.asarray(em)[..., 3].max() > 0
        self.add(name, img, em if has_e else None, tm if has_t else None, idx=idx)
        a = np.asarray(sw)[..., 0]
        if a.max() > 0:
            self.has_sway = True
            for s, k in ((1, "1"), (2, "2")):
                sz = (self.fw * s, self.fh * s)
                m = Image.fromarray(np.ascontiguousarray(a)).resize(sz, Image.LANCZOS)
                al = np.asarray(self.frames[idx]["i" + k])[..., 3]
                self.sway[(idx, s)] = Image.fromarray(np.minimum(np.asarray(m), al).astype(np.uint8))
    def save(self):
        out = super().save()
        if self.has_sway:
            for s, suf in ((1, ""), (2, "@2x")):
                pg = Image.new("L", (self.cols * self.fw * s, self.rows * self.fh * s), 0)
                for (idx, ss), m in self.sway.items():
                    if ss == s: pg.paste(m, ((idx % self.cols) * self.fw * s, (idx // self.cols) * self.fh * s))
                Image.merge("RGB", (pg, Image.new("L", pg.size, 0), Image.new("L", pg.size, 0))).save(os.path.join(SAT, f"{self.key}_sway{suf}.png"), optimize=True)
        return out
    def atlas_json(self):
        p = f"stalls/atlases/{self.key}"
        a = {"key": self.key, "image": p + ".png", "frameW": self.fw, "frameH": self.fh, "columns": self.cols, "rows": self.rows,
             "pages": [{"scale": 2, "image": p + "@2x.png"}]}
        m = {}
        if self.has_emis: m["emissive"] = True
        if self.has_tint: m["tintmask"] = p + "_tintmask.png"
        if self.has_sway: m["sway"] = p + "_sway.png"
        if m: a["masks"] = m
        return a

TRIM = {}
BADGE_GAP = 2

def build_piece(key, piece, fp, W, Hh, fn, sway=None, tags=None):
    attach = {}; outs = {}
    for state in (0, 1):
        for dmg in range(4): outs[(state, dmg)] = fn(state, dmg)
    # trim empty headroom: union alpha over every frame (mirror = same rows), keep MARGIN+1 px clear above the art.
    # attach points are pivot-relative, so only frameH and anchor.y change.
    SSf = outs[(0, 0)][0][0].height / Hh; top = Hh
    for (img, tm, em, sw), _ in outs.values():
        rows = np.nonzero(np.asarray(img)[..., 3].max(axis=1) > 8)[0]
        if len(rows): top = min(top, int(rows[0] / SSf))
    T = max(0, top - MARGIN - 1); Hh0 = Hh; Hh = Hh0 - T; TRIM[key] = (Hh0, Hh)
    # world prompt / badge anchor: centred over the pivot, BADGE_GAP px above the topmost art row (all states/damage).
    # Badge sprites are anchored at their body bottom, so the renderer places the sprite anchor exactly here.
    by = round((top - T) - (Hh - 8) - BADGE_GAP, 1)
    for (_, at) in outs.values(): at["badge"] = {"x": 0.0, "y": by, "w": 30, "h": 10}
    crop = lambda im: im.crop((0, int(T * SSf), im.width, im.height))
    sh = StallSheet(key, W, Hh, 4, (0.5, (Hh - 8) / Hh))
    for state in (0, 1):
        for dmg in range(4):
            (img, tm, em, sw), at = outs[(state, dmg)]; img, tm, em, sw = map(crop, (img, tm, em, sw))
            i0 = state * 8 + dmg * 2
            sh.addf(f"{key}/{['closed','open'][state]}/damage{dmg}/r0", img, tm, em, sw, i0)
            sh.addf(f"{key}/{['closed','open'][state]}/damage{dmg}/r1", mirror(img), mirror(tm), mirror(em), mirror(sw), i0 + 1)
            if dmg == 0: attach[["closed", "open"][state]] = at
    sh.save()
    # rotationArt: art is drawn for r0 + baked mirror r1. Square footprints (blanket 1x1, booth 2x2) truly mirror: 2 rows,
    # engine flips rows 0/1 for rotations 2/3. Non-square (cart/post 2x1, pavilion 3x2): a flip would swap the long axis,
    # so rotations 2/3 must reuse rows 0/1 unflipped -> 4 explicit rows = unique4 (shopfront stays toward the camera).
    sq = fp[0] == fp[1]; art = "mirror" if sq else "unique4"
    rows = lambda s: [[s * 8 + d * 2 for d in range(4)], [s * 8 + d * 2 + 1 for d in range(4)]] * (1 if sq else 2)
    spr = {"key": key, "category": "building", "atlas": key, "anchor": {"x": 0.5, "y": round((Hh - 8) / Hh, 5)}, "rotationArt": art,
           "animations": {"idle": {"frames": [8], "fps": 1}, "closed": {"frames": [0], "fps": 1}},
           "building": {"piece": piece, "footprint": {"w": fp[0], "h": fp[1]}, "layer": 2, "frames": rows(1),
                        "states": {"closed": rows(0), "open": rows(1)}},
           "attach": attach["open"],
           "attachByState": {"closed": {k: v for k, v in attach["closed"].items() if not (k.startswith("slot") or k.startswith("tag"))}},
           "tags": tags or {}}
    if sway: spr["sway"] = sway
    return sh, spr

def build_all():
    sheets, sprites = [], []
    AW = {"amp": 1.4, "freq": 0.7, "stiffness": 0.55}
    for v, (nm, *_ ) in enumerate(BLANKET_V):
        sh, s = build_piece(f"stall_blanket_{nm}", "stall_blanket", (1, 1), 96, 96, lambda st, d, v=v: blanket(v, st, d), sway=AW if v == 2 else None, tags={"tier": 1, "variant": nm}); sheets.append(sh); sprites.append(s)
    for v, (nm, *_ ) in enumerate(CART_V):
        sh, s = build_piece(f"stall_cart_{nm}", "stall_cart", (2, 1), 144, 144, lambda st, d, v=v: cart(v, st, d), sway=AW, tags={"tier": 2, "variant": nm}); sheets.append(sh); sprites.append(s)
    for v, (nm, *_ ) in enumerate(BOOTH_V):
        sh, s = build_piece(f"stall_booth_{nm}", "stall_booth", (2, 2), 144, 176, lambda st, d, v=v: booth(v, st, d), sway={"amp": 1.0, "freq": 0.6, "stiffness": 0.6}, tags={"tier": 3, "variant": nm}); sheets.append(sh); sprites.append(s)
    sh, s = build_piece("clan_pavilion", "clan_pavilion", (3, 2), 208, 224, pavilion, sway={"amp": 1.8, "freq": 0.75, "stiffness": 0.5}, tags={"clan": True, "tint": ["clan_primary", "clan_secondary"]}); sheets.append(sh); sprites.append(s)
    sh, s = build_piece("clan_trading_post", "market_counter", (2, 1), 144, 160, trading_post, sway={"amp": 1.2, "freq": 0.7, "stiffness": 0.6}, tags={"clan": True}); sheets.append(sh); sprites.append(s)
    return sheets, sprites

if __name__ == "__main__":
    only = sys.argv[1:]
    sheets, sprites = build_all()
    json.dump({"atlases": [s.atlas_json() for s in sheets], "sprites": sprites}, open(os.path.join(ROOT, "tools", "_buildings.json"), "w"), indent=1)
    for s in sheets:
        for w in s.warnings[:2]: print("warn", w)
    print("ok", len(sheets))
