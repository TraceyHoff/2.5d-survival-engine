#!/usr/bin/env python3
# ADR-145 pet art (docs/DECISIONS.md "Crisp animals and the pets system"). Replaces the sprite_fallbacks tinted stand-ins:
#   13 species animal_<key> (pets.json order): dogs dachshund/lab/husky/shepherd/beagle, cats tabby/siamese/black,
#   parrot, crow, ferret, rabbit, chicken. Anims idle(4) walk(6) run(=walk @12fps) sit(2) eat(2) attack(3) hurt/hit(3) death(2),
#   8 facings each, dirFrames index frame*8+dir (dir d = screen heading 45+45d deg clockwise from east, same as the critters).
#   CRISP: every part is a vector ellipsoid / polygon rendered at 8x the target scale, then point-sampled (NEAREST) down to
#   1x and to @2x separately (no resampling blur), alpha is binary, and a whole-pixel outline (1 px @1x, 2 px @2x) is dilated
#   around the silhouette. Eyes / nose / glints / dizzy stars are placed on the target pixel grid after downscale.
#   Cells (ADR-145 art sizes): 64x64 small (cats, birds, rabbit, ferret, chicken, dachshund, beagle), 96x96 lab/husky/shepherd;
#   frames are trimmed + deduped into tight rect pages pets_<species>[_n] (<= 704x480 @1x = the existing largest stream page,
#   so the stream pool slot does not grow), residency stream with placeholder_animal_s/m/l. Atlas keys start with "pets_" so
#   the renderer's CRISP_ATLAS_RE (^(animals|pets)_) applies sharp-bilinear and skips idle-downscale.
#   animal_rabbit / animal_chicken move here from the main pack (same keys; ids.lock is keyed by key, so ids are unchanged).
#   pet_trough: buildable sprite (piece pet_trough, 1x1, rotSteps 4 -> rows [r0,r1,r0,r1]) on resident pets_trough.
# Re-runnable (idempotent). Run from repo root AFTER adr128.py and adr134.py (adr134 repoints every animal_* hurt anim):
#   python3 packages/assets/pack/nature/src/pets145.py [preview dir]
#   then python3 assets/tools/ktx2.py on nature + main manifests, gen_icon_css.py, lock:ids:pack.
import json, math, os, sys, hashlib
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
R = 'packages/assets/pack/'; NAT = R + 'nature/'; OUT = 'atlases/'
PREV = sys.argv[1] if len(sys.argv) > 1 else '/workspace/assets/nature/preview'
SS = 8; PAD = 2; MAXW, MAXH = 704, 480

def load(p): return json.load(open(p))
def save(m, p, ind): json.dump(m, open(p, 'w'), indent=ind, ensure_ascii=False); open(p, 'a').write('\n')
def hx(s): s = s.lstrip('#'); return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))
def mix(a, b, t): return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))
def lt(c, t): return mix(c, (255, 248, 236), t)
def dk(c, t): return mix(c, (44, 24, 40), t)
OL = (52, 30, 40)

# ---------------- 3D toy model: parts = ellipsoids (center, 3 axis vectors) or polygons (3D points)
def rot(axis, a):
    c, s = math.cos(a), math.sin(a)
    if axis == 'y': return np.array([[c, 0, -s], [0, 1, 0], [s, 0, c]])  # pitch: +a lifts the front (x) up
    if axis == 'x': return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])  # roll
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])
class Part:
    def __init__(s, kind, col, c=None, r=None, pts=None, line=None, z=0.0, shade=True, decals=()):
        s.kind, s.col, s.c, s.r, s.pts, s.line, s.zb, s.shade, s.decals = kind, col, c, r, pts, line, z, shade, list(decals); s.tag = None
def MK(tag, p): q = E(p, (.01, .01, .01), (0, 0, 0)); q.tag = tag; return q
def E(c, r, col, **k): return Part('e', col, c=np.array(c, float), r=np.diag(np.array(r, float)), **k)
def Pg(pts, col, **k): return Part('p', col, pts=np.array(pts, float), **k)
def xform(parts, M, pivot=(0, 0, 0), off=(0, 0, 0)):
    pv, of = np.array(pivot, float), np.array(off, float)
    for p in parts:
        if p.kind == 'e': p.c = M @ (p.c - pv) + pv + of; p.r = M @ p.r
        else: p.pts = (M @ (p.pts - pv).T).T + pv + of
        xform(p.decals, M, pivot, off)
    return parts

class View:
    def __init__(s, d):
        a = math.radians(45 + 45 * d); F = np.array([math.cos(a), math.sin(a)]); L = np.array([math.sin(a), -math.cos(a)])
        s.P = np.array([[F[0], L[0], 0], [F[1] * .5, L[1] * .5, -.86]]); s.D = np.array([F[1], L[1], .55])
    def pt(s, v): return s.P @ v
    def depth(s, v): return float(s.D @ v)
    def ell(s, c, r, n=40):
        M = s.P @ r; C = M @ M.T; w, V = np.linalg.eigh(C); S = V @ np.diag(np.sqrt(np.maximum(w, 1e-6)))
        t = np.linspace(0, 2 * math.pi, n, endpoint=False); ctr = s.pt(c)
        return [tuple(ctr + S @ np.array([math.cos(q), math.sin(q)])) for q in t]

def render(parts, view, k, cell, origin, flash=0.0):
    """parts -> crisp RGBA at scale k (cell*k square). origin = ground (0,0,0) in 1x cell px."""
    W = cell * k * SS; im = Image.new('RGBA', (W, W)); f = k * SS; ox, oy = origin[0] * f, origin[1] * f
    def scr(pts): return [(ox + x * f, oy + y * f) for x, y in pts]
    order = sorted(parts, key=lambda p: (view.depth(p.c) if p.kind == 'e' else view.depth(p.pts.mean(0))) + p.zb)
    lw = SS  # one target pixel at either scale
    for p in order:
        if p.tag and p.tag.startswith('m:'): continue
        col = p.col
        poly = scr(view.ell(p.c, p.r) if p.kind == 'e' else [view.pt(v) for v in p.pts])
        m = Image.new('L', (W, W)); ImageDraw.Draw(m).polygon(poly, fill=255)
        bb = m.getbbox()
        if not bb: continue
        lay = Image.new('RGBA', (W, W)); d = ImageDraw.Draw(lay); d.polygon(poly, fill=dk(col, .22) if p.shade else col)
        if p.shade:
            h = bb[3] - bb[1]; sh = [(x, y - h * .14) for x, y in poly]; d.polygon(sh, fill=col)
            cx, cy = (bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2
            hl = [(cx + (x - cx) * .5, cy - h * .16 + (y - cy) * .45) for x, y in poly]
            if h > 6 * f: d.polygon(hl, fill=lt(col, .2))
        for dc in p.decals:
            dp = scr(view.ell(dc.c, dc.r)) if dc.kind == 'e' else scr([view.pt(v) for v in dc.pts]); d.polygon(dp, fill=dc.col)
        lay.putalpha(Image.composite(lay.getchannel('A'), Image.new('L', (W, W)), m))
        if p.line is not False: ImageDraw.Draw(lay).line(poly + [poly[0]], fill=(p.line or dk(col, .5)) + (255,), width=lw, joint='curve')
        im.alpha_composite(lay)
    out = im.resize((cell * k, cell * k), Image.NEAREST)
    a = np.array(out); a[..., 3] = np.where(a[..., 3] > 127, 255, 0).astype(np.uint8)
    if flash: a[..., :3] = (a[..., :3] * (1 - flash) + np.array([255, 250, 245]) * flash).astype(np.uint8)
    out = Image.fromarray(a); al = out.getchannel('A'); dil = al.filter(ImageFilter.MaxFilter(2 * k + 1))
    base = Image.new('RGBA', out.size, OL + (255,)); base.putalpha(dil); base.alpha_composite(out)
    return base

# ---------------- species
SP = {  # key: kind, cell, placeholder, params
 'dog_dachshund': dict(kind='dog', cell=64, ph='m', L=13, br=(13, 5.2, 5.4), bz=8.2, leg=4.6, lr=1.9, hr=5.6, ear='floppy', snout=4.2, tail='thin',
                       col='#a8602e', belly='#c98a50', eye='#2a1c18'),
 'dog_lab':       dict(kind='dog', cell=96, ph='l', L=11, br=(12, 7, 7.2), bz=15, leg=10, lr=2.8, hr=7.6, ear='floppy', snout=5, tail='otter',
                       col='#e6c27a', belly='#f2dca8', eye='#2a1c18'),
 'dog_husky':     dict(kind='dog', cell=96, ph='l', L=11, br=(12, 6.8, 7), bz=15, leg=10, lr=2.7, hr=7.4, ear='pointy', snout=4.8, tail='curl',
                       col='#7d8794', belly='#f4f2ee', mask='#f4f2ee', eye='#4aa8e8'),
 'dog_shepherd':  dict(kind='dog', cell=96, ph='l', L=12, br=(12.5, 6.8, 7), bz=15.5, leg=10.5, lr=2.7, hr=7.4, ear='bigpointy', snout=5.4, tail='bushy',
                       col='#c48a4a', belly='#d8a66a', saddle='#3a2c26', muzzle='#3a2c26', eye='#2a1c18'),
 'dog_beagle':    dict(kind='dog', cell=64, ph='m', L=8, br=(9, 5.6, 5.8), bz=10.5, leg=6.6, lr=2.1, hr=5.6, ear='floppy', snout=3.8, tail='up',
                       col='#c98a48', belly='#f6f0e6', saddle='#3a2e2a', blaze='#f6f0e6', legs='#f6f0e6', eye='#2a1c18'),
 'cat_tabby':     dict(kind='cat', cell=64, ph='m', L=7, br=(8, 4.6, 4.8), bz=9, leg=6, lr=1.7, hr=5.8, ear='cat', snout=1.6, tail='cat',
                       col='#e09a4c', belly='#f6dcb0', stripes='#a85c2a', eye='#5aa040'),
 'cat_siamese':   dict(kind='cat', cell=64, ph='m', L=7, br=(8, 4.5, 4.7), bz=9, leg=6, lr=1.7, hr=5.7, ear='cat', snout=1.6, tail='cat',
                       col='#efe2cc', belly='#f8f0e2', point='#5a4034', eye='#3a8ee8'),
 'cat_black':     dict(kind='cat', cell=64, ph='m', L=7, br=(8, 4.6, 4.8), bz=9, leg=6, lr=1.7, hr=5.8, ear='cat', snout=1.6, tail='cat',
                       col='#3a3846', belly='#4a4858', eye='#f0d040', line=(120, 116, 150)),
 'parrot':        dict(kind='bird', cell=64, ph='s', br=(4.6, 4.2, 6.2), bz=9, hr=4.4, col='#3cc048', wing='#2a9c3a', wing2='#2c6ae0', tailc='#e8402c',
                       beak='#f0e8d0', beakd='#2a2a30', tail=9, cheek='#f6f0d8', leg=3.2, eye='#ffffff'),
 'crow':          dict(kind='bird', cell=64, ph='s', br=(4.8, 4, 5), bz=7.6, hr=3.8, col='#34343e', wing='#262630', wing2='#262630', tailc='#262630',
                       beak='#5a5a66', beakd='#5a5a66', tail=6, leg=3.4, eye='#ffffff', line=(110, 110, 140), beaklen=4),
 'chicken':       dict(kind='bird', cell=64, ph='s', br=(6, 5, 5.4), bz=8.4, hr=3.8, col='#fbf6ec', wing='#ece2cc', wing2='#ece2cc', tailc='#f2ead8',
                       beak='#f2b630', beakd='#f2b630', tail=4, comb='#e8382c', leg=3.6, legc='#f2b630', eye='#2a1c18', beaklen=2.4),
 'rabbit':        dict(kind='rabbit', cell=64, ph='s', br=(6.4, 5, 5.4), bz=6.4, leg=3, lr=1.8, hr=4.8, col='#b08a66', belly='#efe2cc', eye='#2a1c18'),
 'ferret':        dict(kind='dog', cell=64, ph='m', L=12, br=(11, 3.8, 3.9), bz=5.6, leg=3.8, lr=1.5, hr=4.2, ear='round', snout=2.8, tail='thin2',
                       col='#e8dcc0', belly='#f6efe0', mask='#5a4434', legs='#5a4434', eye='#1a1210'),
}
ORDER = ['dog_dachshund', 'dog_lab', 'dog_husky', 'dog_shepherd', 'dog_beagle', 'cat_tabby', 'cat_siamese', 'cat_black', 'parrot', 'crow', 'chicken', 'rabbit', 'ferret']
ANIMS = [('idle', 4, 4, True), ('walk', 6, 8, True), ('sit', 2, 2, True), ('eat', 2, 4, True), ('attack', 3, 10, False), ('hurt', 3, 10, False), ('death', 2, 4, False)]

def model(s, anim, f):
    """-> (parts, pose info {eyes:[(p3, r)], nose:p3, closed:bool, head:p3, hr})"""
    kind = s['kind']; col = hx(s['col']); belly = hx(s.get('belly', s['col'])); ln = s.get('line')
    P = []; info = {'closed': False}
    bx, by, bzr = s['br']; bz = s['bz']; hr = s['hr']; T = 2 * math.pi
    # pose params
    bob = 0; swing = 0; ph = 0; pitch = 0; headdx = 0; headdz = 0; lunge = 0; sit = False; lying = False; squash = 1; tailw = 0; hop = 0
    if anim == 'idle': bob = [0, .35, .6, .35][f] * (bzr * .06); tailw = [0, .6, 0, -.6][f]; info['closed'] = f == 3; headdz = [0, .2, .3, .2][f]
    if anim == 'walk': ph = f / 6 * T; swing = 1; bob = abs(math.sin(ph)) * .5; tailw = math.sin(ph) * .7
    if anim == 'sit': sit = True; tailw = [0, .8][f]; info['closed'] = f == 1
    if anim == 'eat': headdx = 1.0; headdz = -1 - [0, .6][f]; pitch = -.18
    if anim == 'attack': lunge = [-1.2, 2.6, .8][f]; headdz = [.6, -.4, 0][f]; pitch = [.12, -.12, 0][f]; info['mouth'] = f == 1
    if anim == 'hurt': squash = [.82, 1.12, 1][f]; info['closed'] = f != 1; info['stars'] = f >= 1; pitch = [-.05, .16, 0][f]
    if anim == 'death': lying = True; info['closed'] = True; tailw = [0, .3][f]; squash = [1, .96][f]
    info['flash'] = .45 if anim == 'hurt' and f == 0 else 0
    lsw = lambda o: math.sin(ph + o) * swing
    def ED(c, r, cc, **k): return E(c, r, cc, line=ln, **k)
    if kind in ('dog', 'cat', 'rabbit'):
        legc = hx(s.get('legs', s['col'])); body_dec = []
        if kind == 'rabbit':
            bx, by, bzr = s['br']; bz = s['bz'] + (abs(math.sin(ph)) * 3 if anim == 'walk' else 0)
        bzz = bz + bob
        if s.get('saddle'): body_dec.append(E((-.5, 0, bzz + bzr * .55), (bx * .75, by * 1.05, bzr * .55), hx(s['saddle'])))
        if s.get('stripes'):
            for i in range(4): body_dec.append(E((-bx * .55 + i * bx * .36, 0, bzz + bzr * .7), (bx * .07, by * 1.1, bzr * .5), hx(s['stripes'])))
        body_dec.append(E((0, 0, bzz - bzr * .55), (bx * .85, by * .8, bzr * .5), belly))
        P.append(ED((0, 0, bzz), (bx, by, bzr * squash), col, decals=body_dec))
        # legs (FL FR HL HR), x hip offsets
        hipx = bx * .62; lh = s.get('leg', 5)
        for i, (sx, sy, o) in enumerate(((1, 1, 0), (1, -1, math.pi), (-1, 1, math.pi), (-1, -1, 0))):
            if lying: continue
            lx = sx * hipx + lsw(o) * lh * .45; lift = max(0, math.cos(ph + o)) * swing * lh * .2; lr = s['lr']
            if kind == 'rabbit':
                if sx < 0: P.append(ED((-bx * .45 + lsw(o) * 1.2, sy * by * .6, 1.6 + lift), (3.4, 1.7, 1.7), legc))  # big hind feet
                else: P.append(ED((bx * .55 + lsw(o) * 1.5, sy * by * .4, 1.4 + lift), (1.6, 1.3, 1.6), legc))
                continue
            if sit and sx < 0: q = ED((-bx * .3, sy * by * .8, lr * 1.3), (lr * 2.6, lr * 1.2, lr * 1.5), legc); q.tag = 'hind'; P.append(q); continue
            ll = lh + (lh * .3 if sit else 0)
            q = ED((lx + (bx * .1 if sit else 0), sy * by * .55, ll / 2 + lift), (lr, lr, ll / 2 + lr * .4), legc); q.tag = 'front' if sx > 0 else 'hind'; P.append(q)
        # head
        hx_ = bx * .95 + hr * .35 + headdx; hz = bzz + bzr * .55 + hr * .45 + headdz
        if kind == 'cat': hz += 1
        if kind == 'rabbit': hx_ = bx * .8 + hr * .2; hz = bzz + bzr * .6 + hr * .4 + headdz
        hdec = []
        if s.get('mask'):
            if kind == 'dog' and 'husky' in s.get('_k', ''): hdec.append(E((hx_ + hr * .55, 0, hz - hr * .2), (hr * .55, hr * .75, hr * .6), hx(s['mask'])))
            else: hdec.append(E((hx_ + hr * .6, 0, hz + hr * .05), (hr * .5, hr * .95, hr * .3), hx(s['mask'])))
        if s.get('blaze'): hdec.append(E((hx_ + hr * .8, 0, hz + hr * .2), (hr * .3, hr * .22, hr * .75), hx(s['blaze'])))
        if s.get('point'): hdec.append(E((hx_ + hr * .7, 0, hz - hr * .05), (hr * .45, hr * .55, hr * .5), hx(s['point'])))
        if s.get('stripes'): hdec += [E((hx_ + hr * .2, sy * hr * .25, hz + hr * .85), (hr * .45, hr * .08, hr * .3), hx(s['stripes'])) for sy in (-1, 0, 1)]
        head = ED((hx_, 0, hz), (hr * 1.02, hr, hr * .95 * (squash if anim == 'hurt' else 1)), col, decals=hdec); P.append(head)
        sn = s.get('snout', 2)
        muz = hx(s.get('muzzle') or s.get('blaze') or s.get('belly') or s['col'])
        if kind == 'cat': muz = hx(s.get('point') or s['belly'])
        if kind == 'rabbit': sn = 1.4; muz = belly
        nose = (hx_ + hr * .7 + sn * .55, 0, hz - hr * .3)
        P.append(ED(nose, (sn * .62 + .6, hr * (.42 if kind == 'dog' else .5), hr * .36), muz, z=.3))
        P.append(MK('m:nose', (hx_ + hr * .72 + sn * 1.05, 0, hz - hr * .22))); P.append(MK('m:head', (hx_, 0, hz))); info['hr'] = hr
        P += [MK('m:eye', (hx_ + hr * .8, sy * hr * .42, hz + hr * .12)) for sy in (1, -1)]
        if info.get('mouth'): P.append(ED((nose[0] + .4, 0, nose[2] - hr * .35), (sn * .5, hr * .3, .9), (200, 70, 80), z=.2))
        # ears
        e = s.get('ear'); ecol = hx(s.get('point') or s.get('saddle') if e in ('cat', 'bigpointy', 'pointy') and (s.get('point') or s.get('saddle')) else s['col'])
        if 'husky' in s.get('_k', ''): ecol = col
        for sy in (1, -1):
            if e == 'floppy':
                P.append(ED((hx_ - hr * .1, sy * hr * .9, hz - hr * .25 + tailw * .2), (hr * .42, hr * .2, hr * .72), dk(ecol, .12) if not s.get('saddle') else hx(s['col']), z=.1))
            elif e == 'round':
                P.append(ED((hx_ - hr * .2, sy * hr * .7, hz + hr * .7), (hr * .3, hr * .2, hr * .3), dk(col, .1)))
            elif kind == 'rabbit':
                tw = (.15 if (anim == 'idle' and f == 1) else 0)
                P.append(ED((hx_ - hr * .35, sy * hr * .35, hz + hr * 1.75), (hr * .32, hr * .2, hr * 1.05), col, decals=[E((hx_ - hr * .25, sy * hr * .38, hz + hr * 1.75), (hr * .18, hr * .12, hr * .75), (236, 170, 170))]))
            else:
                big = {'cat': 1.0, 'pointy': 1.05, 'bigpointy': 1.35}[e]; tw = (.2 if (anim == 'idle' and f == 1 and sy > 0) else 0)
                b1 = (hx_ + hr * .2, sy * hr * .25, hz + hr * .7); b2 = (hx_ - hr * .45, sy * hr * .85, hz + hr * .55)
                tip = (hx_ - hr * (.1 + tw), sy * hr * .7, hz + hr * (1 + .75 * big))
                inner = [(b1[0] - .2, b1[1] * 1.15 + sy * .2, b1[2] + .3), ((b1[0] + b2[0]) / 2, (b1[1] + b2[1]) / 2, b1[2] + .2), (tip[0] + .1, tip[1], tip[2] - hr * .35)]
                P.append(Pg([b1, b2, tip], ecol, z=-.05, line=ln, decals=[Pg(inner, (236, 168, 160) if not s.get('point') and s['col'] != '#3a3846' else dk(ecol, .1))]))
        # tail
        t = s.get('tail', 'thin'); tc = hx(s.get('point') or s['col'])
        if kind == 'rabbit': P.append(ED((-bx * .95, 0, bzz + bzr * .3), (2.2, 2.2, 2.2), (250, 248, 242)))
        else:
            segs = {'thin': (4, 1.3, .9, 1.6, .25, .1), 'thin2': (5, 1.4, 1.0, 1.6, -.1, .05), 'otter': (5, 2.4, 1.4, 2.0, .1, .0), 'curl': (6, 2.6, 2.2, 1.8, 1.3, .3),
                    'bushy': (5, 2.6, 2.0, 2.3, -.4, -.1), 'up': (5, 1.6, 1.2, 1.7, .8, .35), 'cat': (6, 1.4, 1.2, 1.6, 1.0, .1)}[t]
            n, r0, r1, step, up, base0 = segs; px, pz = -bx * .9, bzz + bzr * .35; yy = 0
            for i in range(n):
                a = i / (n - 1); ang = (base0 + up * a * 1.2) if not lying else .1
                if t == 'curl': ang = math.pi * .3 + a * 2.4
                px -= math.cos(ang) * step; pz += math.sin(ang) * step; yy += tailw * .45 * a
                rr = r0 + (r1 - r0) * a; cc = tc
                if s.get('legs') == '#f6f0e6' and i == n - 1: cc = (246, 240, 230)  # beagle white tip
                if t == 'curl' and i >= n - 2: cc = (244, 242, 238)
                P.append(ED((px, yy, max(pz, rr * .8)), (rr * 1.1, rr, rr), cc, z=-.2 if i < 2 else 0))
        if sit:  # rear down on the hips, chest up; front legs stay planted (stretched), hind legs folded flat
            hip = (-bx * .55, 0, bzz - bzr * .4); sitp = .5 if kind != 'rabbit' else .15
            xform([p for p in P if p.tag not in ('hind', 'front')], rot('y', sitp), hip, (0, 0, -(bzz - bzr * .4) * .45))
            for p in P:
                if p.tag == 'front': p.c[2] += lh * .12; p.r[2, 2] *= 1.25
        if lying:  # on its side, belly toward the viewer's left
            xform(P, rot('x', 1.4), (0, 0, 0), (0, 0, 0)); zmin = min((p.c[2] - abs(p.r[2]).sum() * .6) if p.kind == 'e' else p.pts[:, 2].min() for p in P if not p.tag)
            for p in P: xform([p], np.eye(3), off=(0, 0, -zmin))
        if lunge or pitch: xform(P, rot('y', pitch), (0, 0, bz), (lunge, 0, 0))
        if anim == 'hurt': xform(P, np.diag([1 / squash ** .5, 1, 1]), (0, 0, 0))
    else:  # bird
        bx, by, bzr = s['br']; bz = s['bz'] + bob; wc = hx(s['wing']); w2 = hx(s['wing2'])
        hopz = abs(math.sin(ph)) * 1.6 if anim == 'walk' else 0; bz += hopz
        if sit: bz -= s['leg'] * .8
        if lying: bz = by
        legc = hx(s.get('legc', '#8a8890'))
        if not sit and not lying:
            for sy, o in ((1, 0), (-1, math.pi)):
                lx = lsw(o) * 1.4; ll = s['leg'] + bzr * .4
                P.append(ED((lx, sy * by * .4, ll / 2), (.7, .7, ll / 2), legc, z=-.1))
                P.append(ED((lx + .9, sy * by * .4, .4), (1.4, .9, .5), legc))
        body = ED((0, 0, bz + bzr * .2), (bx, by, bzr * squash), hx(s['col']), decals=[E((bx * .5, 0, bz - bzr * .1), (bx * .55, by * .8, bzr * .6), hx(s.get('cheek', s['col'])))] if s.get('cheek') else [])
        P.append(body)
        flap = [0, .35, 0, -.2][f] if anim == 'idle' else (math.sin(ph) * .3 if anim == 'walk' else (.9 if anim == 'hurt' and f == 1 else (.6 if anim == 'attack' and f == 1 else 0)))
        for sy in (1, -1):
            wing = ED((-bx * .15, sy * (by * .82), bz + bzr * .3 + flap * 2), (bx * .8, by * .25, bzr * .66), wc, z=.05, decals=[E((-bx * .7, sy * (by * .95), bz - bzr * .1 + flap * 2), (bx * .45, by * .3, bzr * .35), w2)])
            if flap: xform([wing], rot('x', sy * flap), (0, sy * by * .8, bz + bzr * .8))
            P.append(wing)
        tl = s['tail']; tc = hx(s['tailc'])
        P.append(ED((-bx - tl * .45, 0, bz - bzr * .1 + (2 if 'comb' in s else 0) + tailw), (tl * .55, by * .45, 1.2 + (2.2 if 'comb' in s else 0)), tc, z=-.3))
        hxx = bx * .45 + headdx; hz = bz + bzr * 1.1 + hr * .5 + headdz
        if s.get('comb'): hxx = bx * .7 + headdx; hz = bz + bzr * .9 + hr * .6 + headdz
        P.append(ED((hxx, 0, hz), (hr, hr * .95, hr), hx(s['col']), decals=[E((hxx + hr * .55, 0, hz - hr * .2), (hr * .45, hr * .8, hr * .45), hx(s['cheek']))] if s.get('cheek') else []))
        bl = s.get('beaklen', 3.2)
        if 'parrot' in s.get('_k', ''):
            P.append(Pg([(hxx + hr * .6, -hr * .35, hz + hr * .25), (hxx + hr * .6, hr * .35, hz + hr * .25), (hxx + hr + bl, 0, hz - hr * .45), (hxx + hr * .7, 0, hz - hr * .9)], hx(s['beak']), z=.3))
        else:
            P.append(Pg([(hxx + hr * .7, -hr * .32, hz + hr * .05), (hxx + hr * .7, hr * .32, hz + hr * .05), (hxx + hr + bl, 0, hz - hr * .2), (hxx + hr * .75, 0, hz - hr * .45)], hx(s['beak']), z=.3))
        if s.get('comb'):
            for i in range(3): P.append(ED((hxx + hr * (.35 - i * .4), 0, hz + hr * (1 + (.25 if i == 1 else .1))), (.9, .7, 1.2), hx(s['comb'])))
            P.append(ED((hxx + hr * 1.0, 0, hz - hr * .85), (.8, .7, 1.2), hx(s['comb']), z=.2))
        P.append(MK('m:head', (hxx, 0, hz))); info['hr'] = hr
        P += [MK('m:eye', (hxx + hr * .5, sy * hr * .75, hz + hr * .2)) for sy in (1, -1)]
        if lying:
            xform(P, rot('x', 1.4), (0, 0, 0), (0, 0, 0)); zmin = min((p.c[2] - abs(p.r[2]).sum() * .6) if p.kind == 'e' else p.pts[:, 2].min() for p in P if not p.tag)
            for p in P: xform([p], np.eye(3), off=(0, 0, -zmin))
        if lunge or pitch: xform(P, rot('y', pitch), (0, 0, bz), (lunge * .7, 0, 0))
        if anim == 'hurt': xform(P, np.diag([1 / squash ** .5, 1, 1]), (0, 0, 0))
    # re-derive eye / head points after transforms (track them as tiny marker parts)
    return P, info

PUP = (26, 18, 24); WHITE = (255, 255, 250, 255)
def px(a, x, y, c):
    if 0 <= y < a.shape[0] and 0 <= x < a.shape[1]: a[y, x] = c if len(c) == 4 else tuple(c) + (255,)
def decorate(im, P, view, k, origin, s, info, anim, f):
    a = np.array(im); M = {}
    for p in P:
        if p.tag and p.tag.startswith('m:'): M.setdefault(p.tag[2:], []).append(p.c)
    head = M['head'][0]; f1 = lambda v: (int(math.floor((origin[0] + view.pt(v)[0]) * k)), int(math.floor((origin[1] + view.pt(v)[1]) * k)))
    def facing(v):
        n = np.array(v) - head; n /= (np.linalg.norm(n) + 1e-9); return float(view.D @ n) / np.linalg.norm(view.D)
    iris = hx(s['eye']) if s['kind'] != 'bird' else PUP
    for e in M.get('eye', []):
        fc = facing(e)
        if fc < -.12: continue
        x, y = f1(e)
        if info['closed']:
            pts = [(0, 0), (1, 0)] if k == 1 else [(0, 1), (1, 0), (2, 0), (3, 1)]
            for dx, dy in pts: px(a, x - k + dx, y + dy, PUP)
            continue
        if k == 1: blk = {(0, -1): WHITE, (1, -1): PUP, (0, 0): iris, (1, 0): PUP}
        else:
            blk = {}
            for dx in range(3):
                for dy in range(4): blk[(dx - 1, dy - 2)] = iris if dy >= 2 and dx < 2 else PUP
            blk[(-1, -2)] = WHITE; blk[(0, -2)] = WHITE; blk[(-1, -1)] = WHITE
        for (dx, dy), c in blk.items(): px(a, x + dx, y + dy, c)
    for n in M.get('nose', []):
        if facing(n) < -.05: continue
        x, y = f1(n)
        for dx in range(k):
            for dy in range(k): px(a, x + dx - (k // 2), y + dy - (k // 2), PUP)
    if info.get('stars'):
        hr = info['hr']; hx_, hy_ = (origin[0] + view.pt(head)[0]), (origin[1] + view.pt(head)[1])
        for i in range(2):
            ang = (f * 1.9 + i * math.pi); sx = int((hx_ + math.cos(ang) * hr * 1.1) * k); sy = int((hy_ - hr * 1.5 + math.sin(ang) * hr * .35) * k)
            arm = 1 if k == 1 else 2
            for t in range(-arm - 1, arm + 2):
                for dx, dy in ((t, 0), (0, t)):
                    for ox in range(-1, 2):
                        for oy in range(-1, 2):
                            if a[sy + dy + oy, sx + dx + ox, 3] == 0: px(a, sx + dx + ox, sy + dy + oy, OL)
            for t in range(-arm, arm + 1): px(a, sx + t, sy, (255, 214, 70)); px(a, sx, sy + t, (255, 214, 70))
            px(a, sx, sy, (255, 255, 230))
    return Image.fromarray(a)

def frame(key, anim, f, d):
    s = dict(SP[key]); s['_k'] = key; cell = s['cell']; origin = (cell / 2, cell * .78); view = View(d); out = []
    for k in (1, 2):
        P, info = model(s, anim, f)
        im = render(P, view, k, cell, origin, flash=info['flash']); im = decorate(im, P, view, k, origin, s, info, anim, f); out.append(im)
    b1, b2 = out[0].getbbox(), out[1].getbbox()
    x0 = min(b1[0], b2[0] // 2); y0 = min(b1[1], b2[1] // 2); x1 = max(b1[2], -(-b2[2] // 2)); y1 = max(b1[3], -(-b2[3] // 2))
    i1 = out[0].crop((x0, y0, x1, y1)); i2 = out[1].crop((2 * x0, 2 * y0, 2 * x1, 2 * y1))
    return i1, i2, (origin[0] - x0) / (x1 - x0), (origin[1] - y0) / (y1 - y0), out

def pack(items):
    order = sorted(range(len(items)), key=lambda i: (-items[i][0].height, -items[i][0].width)); pages = []; cur = []; x = y = rowh = 0
    for i in order:
        w, h = items[i][0].size
        if x + w > MAXW: x = 0; y += rowh + PAD; rowh = 0
        if y + h > MAXH: pages.append(cur); cur = []; x = y = rowh = 0
        cur.append((i, x, y)); x += w + PAD; rowh = max(rowh, h)
    pages.append(cur); res = []
    for pg in pages:
        pw = max(x + items[i][0].width for i, x, y in pg); ph = max(y + items[i][0].height for i, x, y in pg)
        res.append((-(-pw // 16) * 16, -(-ph // 16) * 16, pg))
    return res

def build_species(key, man, sheets):
    s = SP[key]; items = []; by = {}; idx = {}
    for an, n, fps, loop in ANIMS:
        ent = []
        for f in range(n):
            for d in range(8):
                i1, i2, ax, ay, full = frame(key, an, f, d)
                if an in ('idle', 'walk', 'sit', 'hurt') and f == 0: sheets.setdefault(key, {}).setdefault(an, {})[d] = full[1]
                h = hashlib.sha1(i1.tobytes() + i2.tobytes()).hexdigest()
                if h not in by: by[h] = len(items); items.append((i1, i2))
                ent.append((by[h], ax, ay))
        idx[an] = ent
    pages = pack(items); where = {}; atl = []; base = 'pets_' + key
    for p, (pw, ph, pg) in enumerate(pages):
        ak = base if len(pages) == 1 else f'{base}_{p}'; a1 = Image.new('RGBA', (pw, ph)); a2 = Image.new('RGBA', (pw * 2, ph * 2))
        for i, x, y in pg: a1.paste(items[i][0], (x, y)); a2.paste(items[i][1], (2 * x, 2 * y)); where[i] = (ak, x, y, *items[i][0].size)
        assert max(a2.size) <= 2048
        a1.save(f'{NAT}{OUT}{ak}.png', optimize=True); a2.save(f'{NAT}{OUT}{ak}@2x.png', optimize=True)
        atl.append({"key": ak, "image": f"{OUT}{ak}.png", "frameW": pw, "frameH": ph, "columns": 1, "rows": 1,
                    "pages": [{"scale": 2, "image": f"{OUT}{ak}@2x.png", "ktx2": f"{OUT}{ak}@2x.ktx2"}], "residency": "stream",
                    "placeholder": f"placeholder_animal_{s['ph']}", "ktx2": f"{OUT}{ak}.ktx2"})
    anims = {}
    for an, n, fps, loop in ANIMS:
        df = []
        for it, ax, ay in idx[an]:
            ak, x, y, w, h = where[it]; df.append({"atlas": ak, "rect": {"x": x, "y": y, "w": w, "h": h}, "anchor": {"x": round(ax, 5), "y": round(ay, 5)}})
        a = {"frames": list(range(n)), "fps": fps, "directions": 8, "dirStride": 1, **({} if loop else {"loop": False}), "dirFrames": df}
        anims[an] = a
        if an == 'walk': anims['run'] = {**json.loads(json.dumps(a)), "fps": 12}
        if an == 'eat': anims['graze'] = json.loads(json.dumps(a))
        if an == 'hurt': anims['hit'] = json.loads(json.dumps(a))
        if an == 'death': anims['die'] = json.loads(json.dumps(a))
    spr = {"key": f"animal_{key}", "category": "resource", "atlas": atl[0]['key'], "anchor": {"x": 0.5, "y": 0.78}, "animations": anims}
    return atl, spr, len(items), pages

# ---------------- pet_trough (iso 1x1 piece, 64x88 cell, pivot (32,70) like decor_furn_s)
def trough(k, rot):
    W, H = 64 * k * SS, 88 * k * SS; im = Image.new('RGBA', (W, H)); d = ImageDraw.Draw(im); f = k * SS; ox, oy = 32 * f, 70 * f
    def iso(u, v, h): return (ox + (u - v) * 26 * f, oy + (u + v) * 13 * f - h * f)
    lu, lv = (.42, .24) if rot == 0 else (.24, .42); hgt = 11; wall = .07
    wood, wd, wl = hx('#b9804a'), hx('#8a5a32'), hx('#d8a66c')
    def quad(pts, c): d.polygon([iso(*p) for p in pts], fill=c); d.line([iso(*p) for p in pts + [pts[0]]], fill=dk(c, .45), width=SS)
    # legs (4 corner posts) then box: back faces are hidden by the front ones
    for su, sv in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
        u, v = su * (lu - .03), sv * (lv - .03); quad([(u - .03, v + .03, 0), (u + .03, v + .03, 0), (u + .03, v + .03, 4), (u - .03, v + .03, 4)], wd)
    b = 3
    quad([(-lu, lv, b), (lu, lv, b), (lu, lv, hgt), (-lu, lv, hgt)], wood)        # +v face (front-left)
    quad([(lu, -lv, b), (lu, lv, b), (lu, lv, hgt), (lu, -lv, hgt)], dk(wood, .12))  # +u face (front-right)
    # plank seams
    for t in (.33, .66):
        h = b + (hgt - b) * t
        d.line([iso(-lu, lv, h), iso(lu, lv, h)], fill=dk(wood, .35), width=SS); d.line([iso(lu, -lv, h), iso(lu, lv, h)], fill=dk(wood, .4), width=SS)
    quad([(-lu, -lv, hgt), (lu, -lv, hgt), (lu, lv, hgt), (-lu, lv, hgt)], wl)    # rim top
    iu, iv = lu - wall, lv - wall
    quad([(-iu, -iv, hgt), (iu, -iv, hgt), (iu, iv, hgt), (-iu, iv, hgt)], hx('#5a3a24'))  # inside
    # contents: kibble half (+u side) and water half
    mid = 0
    quad([(-iu, -iv, hgt - 1.5), (mid, -iv, hgt - 1.5), (mid, iv, hgt - 1.5), (-iu, iv, hgt - 1.5)] if rot == 0 else [(-iu, -iv, hgt - 1.5), (iu, -iv, hgt - 1.5), (iu, mid, hgt - 1.5), (-iu, mid, hgt - 1.5)], hx('#5ab4e8'))
    import random; rnd = random.Random(145)
    for i in range(22):
        if rot == 0: u, v = rnd.uniform(.03, iu - .03), rnd.uniform(-iv + .03, iv - .03)
        else: u, v = rnd.uniform(-iu + .03, iu - .03), rnd.uniform(.03, iv - .03)
        x, y = iso(u, v, hgt - .6); r = 1.3 * f; c = [hx('#c8843c'), hx('#a8642a'), hx('#e0a050')][i % 3]
        d.ellipse([x - r, y - r * .8, x + r, y + r * .8], fill=c, outline=dk(c, .45), width=max(1, SS // 2))
    # water glint
    gx, gy = iso(-iu * .5, -iv * .3, hgt - 1.4) if rot == 0 else iso(-iu * .3, -iv * .5, hgt - 1.4); d.ellipse([gx - 2 * f, gy - .6 * f, gx + 2 * f, gy + .6 * f], fill=(220, 244, 255))
    # paw print on the front face
    px_, py_ = iso(0, lv, (b + hgt) / 2) if rot == 0 else iso(lu, 0, (b + hgt) / 2)
    pc = hx('#f4e2c4'); d.ellipse([px_ - 1.4 * f, py_ - .6 * f, px_ + 1.4 * f, py_ + 1.4 * f], fill=pc)
    for dx in (-1.6, -.55, .55, 1.6): d.ellipse([px_ + dx * f - .5 * f, py_ - 2 * f - abs(dx) * -.3 * f, px_ + dx * f + .5 * f, py_ - 1.0 * f + abs(dx) * .3 * f], fill=pc)
    out = im.resize((64 * k, 88 * k), Image.NEAREST); a = np.array(out); a[..., 3] = np.where(a[..., 3] > 127, 255, 0).astype(np.uint8); out = Image.fromarray(a)
    dil = out.getchannel('A').filter(ImageFilter.MaxFilter(2 * k + 1)); base = Image.new('RGBA', out.size, OL + (255,)); base.putalpha(dil)
    # soft ground shadow
    sh = Image.new('RGBA', out.size); ImageDraw.Draw(sh).ellipse([(32 - 24) * k, (70 - 8) * k, (32 + 24) * k, (70 + 10) * k], fill=(0, 0, 0, 60))
    sh.alpha_composite(base); sh.alpha_composite(out); return sh

def main():
    man = load(NAT + 'manifest.nature.json'); main_m = load(R + 'manifest.json')
    man['atlases'] = [a for a in man['atlases'] if not a['key'].startswith('pets_')]
    keys = {f'animal_{k}' for k in ORDER} | {'pet_trough'}
    man['sprites'] = [s for s in man['sprites'] if s['key'] not in keys]
    moved = [s['key'] for s in main_m['sprites'] if s['key'] in keys]
    main_m['sprites'] = [s for s in main_m['sprites'] if s['key'] not in keys]
    for f in os.listdir(NAT + OUT):
        if f.startswith('pets_'): os.remove(NAT + OUT + f)
    sheets = {}; report = []
    for key in ORDER:
        atl, spr, n, pages = build_species(key, man, sheets); man['atlases'] += atl; man['sprites'].append(spr)
        report.append((key, n, [(a['key'], a['frameW'], a['frameH']) for a in atl])); print(key, n, report[-1][2], flush=True)
    t1 = [trough(1, r) for r in (0, 1)]; t2 = [trough(2, r) for r in (0, 1)]
    a1 = Image.new('RGBA', (128, 96)); a2 = Image.new('RGBA', (256, 192))
    for i in range(2): a1.paste(t1[i], (i * 64, 0)); a2.paste(t2[i], (i * 128, 0))
    a1.save(f'{NAT}{OUT}pets_trough.png', optimize=True); a2.save(f'{NAT}{OUT}pets_trough@2x.png', optimize=True)
    man['atlases'].append({"key": "pets_trough", "image": f"{OUT}pets_trough.png", "frameW": 64, "frameH": 96, "columns": 2, "rows": 1,
                           "pages": [{"scale": 2, "image": f"{OUT}pets_trough@2x.png", "ktx2": f"{OUT}pets_trough@2x.ktx2"}], "residency": "resident", "ktx2": f"{OUT}pets_trough.ktx2"})
    man['sprites'].append({"key": "pet_trough", "category": "building", "atlas": "pets_trough", "anchor": {"x": 0.5, "y": round(70 / 96, 5)},
                           "animations": {"idle": {"frames": [0], "fps": 1}},
                           "building": {"piece": "pet_trough", "footprint": {"w": 1, "h": 1}, "layer": 2, "frames": [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [1, 1, 1, 1]]},  # no crackOverlay: bld_crack is in the main pack; nature manifest validates standalone
                           "rotationArt": "unique4"})
    save(man, NAT + 'manifest.nature.json', 1); save(main_m, R + 'manifest.json', 2)
    print('moved from main:', moved)
    # previews (@2x, nearest x2 zoom so pixels are visible): per species rows idle/walk/sit/hurt frame 0 x 8 facings
    os.makedirs(PREV, exist_ok=True); outs = []
    for grp, ks in (('dogs', ORDER[:5]), ('cats', ORDER[5:8]), ('others', ORDER[8:])):
        CW = 192; rows = [(k, an) for k in ks for an in ('idle', 'walk', 'sit', 'hurt')]
        pv = Image.new('RGBA', (CW * 8 + 120, CW * len(rows)), (108, 152, 96, 255)); d = ImageDraw.Draw(pv)
        for r, (k, an) in enumerate(rows):
            d.text((4, r * CW + 8), f'{k}\n{an}', fill=(255, 255, 240))
            for dd in range(8):
                im = sheets[k][an][dd]; pv.alpha_composite(im, (120 + dd * CW + (CW - im.width) // 2, r * CW + (CW - im.height) // 2))
        p = f'{PREV}/pets145_{grp}_2x.png'; pv.convert('RGB').save(p); outs.append(p)
    # crisp check: 1x frames zoomed x4 nearest + trough
    zz = Image.new('RGBA', (8 * 100 + 40, 13 * 100), (108, 152, 96, 255))
    for r, k in enumerate(ORDER):
        for dd in range(8):
            i1, i2, ax, ay, full = frame(k, 'walk', 1, dd); z = i1.resize((i1.width * 3, i1.height * 3), Image.NEAREST); zz.alpha_composite(z, (40 + dd * 100, r * 100 + 2))
    p = f'{PREV}/pets145_walk_1x_zoom3.png'; zz.convert('RGB').save(p); outs.append(p)
    tv = Image.new('RGBA', (560, 210), (108, 152, 96, 255))
    for i in range(2): tv.alpha_composite(t2[i], (i * 136 + 4, 4)); tv.alpha_composite(t1[i].resize((128, 176), Image.NEAREST), (288 + i * 136, 4))
    p = f'{PREV}/pets145_trough.png'; tv.convert('RGB').save(p); outs.append(p)
    print('previews', outs)
    return report

if __name__ == '__main__': main()
