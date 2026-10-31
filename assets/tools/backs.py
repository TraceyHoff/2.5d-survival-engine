"""ADR-253 back-side details for pieces that used to ship one (mirrored) rotation row and now get 4 drawn rows.

Local frame (all box pieces): rot 0 shows the +x and +y faces; the faces hidden at rot 0 come into view at
    rot 1: -y (back)    rot 2: -y and -x    rot 3: -x
so the details below sit flush on the -y / -x faces of the piece's main body and are only added for the rotations that
see them: rot 0 renders exactly as before (pixel-identical), the back rotations show real back construction (battens and
nails on wood, moss and chipped blocks on stone, riveted access plates and vents on metal, seams and patches on cloth)
instead of a mirrored front. Detail slabs are thinner than 0.035 tiles, so they get no ink edges (like trims/drawers).
"""
import zlib
from buildings import B

WOOD = {'wood', 'wood_dark', 'bark', 'paint', 'paint2', 'thatch', 'hay', 'leather', 'hide', 'pine'}
STONE = {'stone', 'cobble', 'brick', 'marble', 'clay', 'slate', 'sand'}
METAL = {'iron', 'black_iron', 'copper', 'gold', 'silver', 'patina', 'metal_teal', 'enamel'}
CLOTH = {'cloth_blue', 'cloth_cream', 'cloth_denim', 'cloth_green', 'cloth_purple', 'cloth_red', 'cloth_teal', 'cloth_yellow',
         'fur_pale', 'fur_brown', 'fur_orange', 'rugbase'}
D = .018   # detail slab depth (tiles): ~1 px proud of the face

def kind(rp):
    if rp in WOOD: return 'wood'
    if rp in STONE: return 'stone'
    if rp in METAL: return 'metal'
    if rp in CLOTH: return 'cloth'
    return None

def visible(r):
    return {0: (), 1: ('-y',), 2: ('-y', '-x'), 3: ('-x',)}[r % 4]

def _face(bx, face, min_w=.16, min_h=4.5):
    """pick the main body box for a back face: largest exterior face of a known material; -> (box, u0, u1, z0, z1, w)"""
    best = None
    for b in bx:
        x0, x1, y0, y1, z0, z1 = b.v; k = kind(b.rp)
        if k is None or min(x1 - x0, y1 - y0) < .035 or 'l' not in b.faces and 'r' not in b.faces: continue
        u0, u1, p = (x0, x1, y0) if face == '-y' else (y0, y1, x0)
        w, h = u1 - u0, z1 - z0
        if w < min_w or h < min_h: continue
        blocked = False
        for o in bx:   # anything sitting on that face (a backrest, a cheek, a lean-to) hides it: skip the box
            if o is b: continue
            ox0, ox1, oy0, oy1, oz0, oz1 = o.v
            a0, a1, q0, q1 = (ox0, ox1, oy0, oy1) if face == '-y' else (oy0, oy1, ox0, ox1)
            if q0 < p - 1e-4 and q1 > p - .06 and min(a1, u1) - max(a0, u0) > .02 and min(oz1, z1) - max(oz0, z0) > 1: blocked = True; break
        if blocked: continue
        sc = w * h
        if best is None or sc > best[-1]: best = (b, u0, u1, z0, z1, sc)
    return best

def _slab(face, p, u0, u1, z0, z1, rp, depth=D):
    if face == '-y': return B(u0, u1, p - depth, p, z0, z1, rp, edge=False)
    return B(p - depth, p, u0, u1, z0, z1, rp, edge=False)

def _motif(face, b, u0, u1, z0, z1, seed):
    p = b.v[2] if face == '-y' else b.v[0]; k = kind(b.rp); h = z1 - z0; w = u1 - u0; out = []
    s = lambda *a, **kw: out.append(_slab(face, p, *a, **kw))
    j = ((seed % 7) - 3) * .01   # small per-piece offset so neighbours do not read stamped
    alt = face == '-x'
    if k == 'wood':
        bat = 'bark' if b.rp == 'wood_dark' else 'wood_dark'; m = min(.06, w * .15)
        if not alt:   # horizontal battens nailed across the boards
            zs = (z0 + h * .5,) if h < 12 else (z0 + h * .26, z0 + h * .66)
            for zc in zs:
                th = min(2.2, max(1.2, h * .14)); s(u0 + m, u1 - m, zc - th / 2, zc + th / 2, bat)
                for uc in (u0 + m + .035, u1 - m - .035): s(uc - .016, uc + .016, zc - .6, zc + .6, 'iron', depth=D + .008)
        else:         # vertical cleat + a chalk-marked tag
            uc = u0 + w * (.34 + j); s(uc - min(.045, w * .12), uc + min(.045, w * .12), z0 + h * .08, z1 - h * .08, bat)
            if h >= 9 and w >= .26: s(u0 + w * .58, u0 + w * .58 + min(.14, w * .3), z0 + h * .45, z0 + h * .45 + min(4, h * .3), 'cloth_cream')
    elif k == 'stone':
        moss = 'leaf' if b.rp != 'clay' else 'grass'
        if not alt:   # moss creeping up from the ground + one chipped block
            segs = 3; hs = (2.6, 4.2, 1.6)
            for i in range(segs):
                a = u0 + w * i / segs; bb = u0 + w * (i + 1) / segs; s(a, bb, z0, z0 + min(h * .45, hs[(i + seed) % 3]), moss)
            if h >= 8:   # a chipped / patched block in a darker stone
                s(u1 - w * (.36 - j), u1 - w * .12, z1 - min(h * .34, 6), z1 - min(h * .1, 1.5), 'cobble' if b.rp == 'stone' else 'stone')
        else:         # weep hole / drain + moss in the other corner
            uc = u0 + w * (.62 + j); s(uc - min(.05, w * .1), uc + min(.05, w * .1), z0 + h * .3, z0 + h * .3 + max(1.5, h * .12), 'ink', depth=D * .6)
            s(u0, u0 + w * .3, z0, z0 + min(3.4, h * .4), moss)
    elif k == 'metal':
        plate = 'black_iron' if b.rp != 'black_iron' else 'iron'
        if not alt:   # riveted access plate
            pu0, pu1 = u0 + w * .2, u1 - w * .2; pz0, pz1 = z0 + h * .22, z1 - h * .22; s(pu0, pu1, pz0, pz1, plate)
            for uc in (pu0 + .03, pu1 - .03):
                for zc in (pz0 + 1, pz1 - 1): s(uc - .014, uc + .014, zc - .55, zc + .55, 'silver', depth=D + .008)
        else:         # vent slits
            n = 3 if h >= 10 else 2
            for i in range(n):
                zc = z0 + h * (.3 + .2 * i); s(u0 + w * .25, u1 - w * .25, zc - .6, zc + .6, 'ink', depth=D * .6)
    elif k == 'cloth':
        thread = 'cloth_cream' if b.rp != 'cloth_cream' else 'wood_dark'
        if not alt:   # back seam (dashed stitches) + sewn maker's label
            zc = z0 + h * .55; n = max(3, int(w / .08))
            for i in range(n):
                a = u0 + w * (i + .25) / n; s(a, a + w * .45 / n, zc - .45, zc + .45, thread)
            if h >= 7 and w >= .24: s(u0 + w * .12, u0 + w * .12 + min(.12, w * .3), z0 + h * .14, z0 + h * .14 + min(3.5, h * .28), 'cloth_cream' if b.rp != 'cloth_cream' else 'cloth_red')
        else:         # square patch with corner stitches
            pw = min(.16, w * .4); ph = min(6, h * .45); uc = u0 + w * (.55 + j); zc = z0 + h * .5
            s(uc - pw / 2, uc + pw / 2, zc - ph / 2, zc + ph / 2, 'cloth_denim' if b.rp != 'cloth_denim' else 'cloth_yellow')
    return out

def details(bx, r, seed=0):
    """extra boxes showing the back construction for rotation r (none for r == 0)."""
    out = []
    for face in visible(r):
        f = _face(bx, face)
        if f: out += _motif(face, f[0], f[1], f[2], f[3], f[4], seed + (0 if face == '-y' else 11))
    return out

def seed_of(key):
    return zlib.crc32(key.encode()) % 1000

def draw_on(cv, bx, rot, seed=0):
    """paint extra (already rot-0-local) detail boxes over a finished canvas, e.g. a raymarched roof: they sit on
    visible faces of a convex piece, so drawing them last is the correct occlusion."""
    from buildings import xform, painter_sort
    bs = painter_sort([xform(b, rot, False) for b in bx])
    for i, b in enumerate(bs): cv.box(*b.v, b.rp, b.top, b.left, b.right, seed=seed * 31 + 500 + i * 7, faces=b.faces)
    return cv

def roof_flat(r):
    """back of the flat roof (rim 7 px at |x|,|y| > .44): a rain scupper + drip stain on the -y rim, the top of an
    access ladder on the -x rim."""
    out = []
    if '-y' in visible(r):
        out += [B(-.12, .04, -.57, -.5, 3.6, 5.6, 'iron'), B(-.09, .01, -.518, -.5, 0, 3.6, 'patina', edge=False)]
    if '-x' in visible(r):
        out += [B(-.518, -.5, .1, .13, 0, 7, 'iron', edge=False), B(-.518, -.5, .3, .33, 0, 7, 'iron', edge=False)]
        out += [B(-.522, -.5, .1, .33, z, z + .9, 'iron', edge=False) for z in (1.6, 4.4)]
    return out
