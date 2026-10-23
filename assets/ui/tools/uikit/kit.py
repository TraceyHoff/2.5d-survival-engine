"""Cozy Camp UI kit sprite definitions (frames + 9-slice insets)."""
from __future__ import annotations
import json, math, os, random
from PIL import ImageChops, ImageFilter, Image
from .draw import Canvas, hexc, lighten, darken, alpha, mix, rrect, blob, heart, drop, star, regular, jitter, Noise1D
from .icon import Ink

HERE = os.path.dirname(__file__)
THEME = json.load(open(os.path.join(HERE, '..', '..', 'theme.json')))
P = THEME['palette']
INK = P['ink']
P.setdefault('sky-500', P['sky-500'])

SPRITES: dict[str, dict] = {}


def sprite(name, w, h, nine=None, hotspot=None, pivot=(0.5, 0.5), tags=()):
    def deco(fn):
        SPRITES[name] = dict(name=name, w=w, h=h, nine=nine, hotspot=hotspot, pivot=pivot, fn=fn, tags=list(tags))
        return fn
    return deco


def render(name, scale):
    s = SPRITES[name]
    return s['fn'](scale)


# ============================ shared painters ============================

def wood_grain(c: Canvas, m, base, seed, orient='h', density=1.0):
    """Paint wood planks grain clipped to mask m. orient h = grain runs horizontally."""
    r = random.Random(seed)
    layer = Image.new('RGBA', c.img.size, (0, 0, 0, 0))
    from PIL import ImageDraw
    d = ImageDraw.Draw(layer)
    W, H = c.w, c.h
    n = int((H if orient == 'h' else W) * 0.55 * density)
    for i in range(n):
        pos = r.uniform(0, H if orient == 'h' else W)
        col = alpha(darken(base, r.uniform(0.15, 0.35)), r.randint(60, 120)) if r.random() < 0.7 else alpha(lighten(base, 0.25), r.randint(50, 90))
        wdt = r.uniform(0.35, 0.8)
        L = (W if orient == 'h' else H)
        a0 = r.uniform(-0.2, 0.6) * L; a1 = a0 + r.uniform(0.4, 1.2) * L
        pts = []
        for k in range(12):
            t = a0 + (a1 - a0) * k / 11
            off = math.sin(t * 0.25 + i) * 0.5
            pts.append((t, pos + off) if orient == 'h' else (pos + off, t))
        d.line(c.pts(pts), fill=col, width=max(1, int(wdt * c.S)))
    a = ImageChops.multiply(layer.getchannel('A'), m)
    layer.putalpha(a)
    c.img.alpha_composite(layer)


def nail(c: Canvas, x, y, r=2.1):
    c.ellipse((x - r - 0.9, y - r - 0.9, x + r + 0.9, y + r + 0.9), INK)
    c.paint(c.ellipse_mask((x - r, y - r, x + r, y + r)), c.vgrad(P['sun-300'], P['sun-700'], y - r, y + r))
    c.ellipse((x - r * 0.55, y - r * 0.6, x - r * 0.05, y - r * 0.1), (255, 255, 240, 220))


def leaf(c: Ink, x, y, size, ang, color=None, seed=0):
    """Little leaf (pointy ellipse) with a vein; ang in degrees."""
    color = color or P['leaf-500']
    a = math.radians(ang)
    pts = []
    for i in range(30):
        t = i / 29 * math.pi
        px = math.cos(t) * size
        py = math.sin(t) * size * 0.42 * (1 if i < 30 else 1)
        pts.append((px, py))
    pts += [(math.cos(t) * size, -math.sin(t) * size * 0.42) for t in [j / 29 * math.pi for j in range(29, -1, -1)]]
    # shift so stem at origin
    pts = [(px + size, py) for px, py in pts]
    rot = [(x + px * math.cos(a) - py * math.sin(a), y + px * math.sin(a) + py * math.cos(a)) for px, py in pts]
    c.part(rot, color, ow=1.1)
    c.line([(x + 0.8 * math.cos(a), y + 0.8 * math.sin(a)), (x + size * 1.6 * math.cos(a), y + size * 1.6 * math.sin(a))], alpha(darken(color, 0.35), 200), 0.6)


def vine(c: Ink, pts, seed=0, leaves=3, color=None):
    c.line(pts, INK, 2.2)
    c.line(pts, P['leaf-700'], 1.0)
    r = random.Random(seed)
    for i in range(leaves):
        k = int((i + 0.5) / leaves * (len(pts) - 1))
        x, y = pts[k]
        leaf(c, x, y, r.uniform(2.6, 3.4), r.choice([-60, -120, 30, 150, -20, 200]) + r.uniform(-20, 20), color)


def chunky(c: Canvas, x0, y0, x1, y1, r, base, lip=3.0, ow=2.0, pressed=False, hover=False, seed=1,
           wob=0.35, gloss=True, outline=INK, lipc=None):
    """Candy chunky body: ink outline, darker lip at bottom, gradient body, gloss highlight."""
    lipc = lipc or darken(base, 0.38)
    m_out = c.poly_mask(rrect(x0, y0, x1, y1, r, wob=wob, seed=seed))
    c.paint(m_out, outline)
    top = y0 + ow + (lip if pressed else 0)
    m_lip = c.poly_mask(rrect(x0 + ow, top, x1 - ow, y1 - ow, r - ow * 0.7, wob=wob * 0.5, seed=seed + 1))
    c.paint(m_lip, lipc)
    by1 = y1 - ow - (0 if pressed else lip)
    body = rrect(x0 + ow, top, x1 - ow, by1, r - ow * 0.7, wob=wob * 0.5, seed=seed + 1)
    m_body = c.poly_mask(body)
    b = lighten(base, 0.12) if hover else hexc(base) if isinstance(base, str) else base
    c.paint(m_body, c.vgrad(lighten(b, 0.25), darken(b, 0.06), top, by1))
    if gloss:
        gh = (by1 - top) * 0.36
        g = rrect(x0 + ow + r * 0.45, top + 1.6, x1 - ow - r * 0.45, top + 1.6 + gh, gh / 2, wob=0.2, seed=seed + 2)
        c.paint(c.poly_mask(g), (255, 255, 245, 70 if pressed else 105))
    if hover:
        rim = ImageChops.subtract(m_body, c.poly_mask(rrect(x0 + ow + 1.2, top + 1.2, x1 - ow - 1.2, by1 - 1.2, r - ow - 1, seed=seed + 1)))
        c.paint(rim, (255, 250, 220, 150))
    return m_body


def inset_well(c: Canvas, x0, y0, x1, y1, r, fill, ow=2.0, outline=None, shadow=2.2, seed=3, wob=0.3, glow=None):
    """Recessed well (slots, inputs, tracks): outline, fill, inner top-left shadow."""
    outline = outline or P['ink-soft']
    m_o = c.poly_mask(rrect(x0, y0, x1, y1, r, wob=wob, seed=seed))
    c.paint(m_o, outline)
    m_i = c.poly_mask(rrect(x0 + ow, y0 + ow, x1 - ow, y1 - ow, max(1, r - ow * 0.8), wob=wob * 0.5, seed=seed + 1))
    c.paint(m_i, fill)
    d = int(shadow * c.S)
    sh = ImageChops.subtract(m_i, ImageChops.offset(m_i, d, d)).filter(ImageFilter.GaussianBlur(c.S * 0.8))
    c.paint(ImageChops.multiply(sh, m_i), alpha(darken(fill, 0.45), 120))
    hl = ImageChops.subtract(m_i, ImageChops.offset(m_i, -int(c.S), -int(c.S))).filter(ImageFilter.GaussianBlur(c.S * 0.4))
    c.paint(ImageChops.multiply(hl, m_i), (255, 255, 245, 90))
    return m_i


# ============================ panels ============================

def _wood_frame(sc, w, h, inner_pad, r, seed, vines=False, nails=True, interior=None, frame=None):
    c = Ink(w, h, sc)
    frame = frame or P['wood-400']
    m_o = c.poly_mask(rrect(0.6, 0.6, w - 0.6, h - 0.6, r, wob=0.45, seed=seed))
    c.paint(m_o, INK)
    fr = rrect(3, 3, w - 3, h - 3.6, r - 2.4, wob=0.25, seed=seed + 1)
    m_f = c.poly_mask(fr)
    # lip at bottom of frame
    c.paint(c.poly_mask(rrect(3, 4, w - 3, h - 3, r - 2.4, seed=seed + 1)), P['wood-700'])
    c.paint(m_f, c.vgrad(P['wood-300'], P['wood-500'], 0, inner_pad + 2))
    # grain: horizontal in top/bottom bands, vertical in side bands (9-slice stretch safe)
    W, H = c.img.size
    band_h = c.mask(); band_v = c.mask()
    from PIL import ImageDraw
    ImageDraw.Draw(band_h).rectangle([inner_pad * c.S, 0, W - inner_pad * c.S, H], fill=255)
    ImageDraw.Draw(band_v).rectangle([0, inner_pad * c.S, W, H - inner_pad * c.S], fill=255)
    wood_grain(c, ImageChops.multiply(m_f, band_h), frame, seed + 5, 'h')
    wood_grain(c, ImageChops.multiply(m_f, ImageChops.subtract(band_v, band_h)), frame, seed + 6, 'v')
    # top bevel light
    bev = ImageChops.subtract(m_f, ImageChops.offset(m_f, 0, int(1.2 * c.S))).filter(ImageFilter.GaussianBlur(c.S * 0.3))
    c.paint(ImageChops.multiply(bev, m_f), alpha(P['wood-200'], 200))
    # interior well
    ip = inner_pad
    c.paint(c.poly_mask(rrect(ip - 2.2, ip - 2.2, w - ip + 2.2, h - ip + 2.4, 6.5, wob=0.35, seed=seed + 2)), INK)
    m_in = c.poly_mask(rrect(ip, ip, w - ip, h - ip, 4.5, wob=0.2, seed=seed + 3))
    fill = interior or P['parchment-100']
    c.paint(m_in, fill)
    d = int(2.5 * c.S)
    sh = ImageChops.subtract(m_in, ImageChops.offset(m_in, 0, d)).filter(ImageFilter.GaussianBlur(c.S * 1.0))
    c.paint(ImageChops.multiply(sh, m_in), alpha(darken(fill, 0.4), 110))
    if nails:
        k = ip * 0.5 + 0.4
        for x, y in ((k, k), (w - k, k), (k, h - k - 0.4), (w - k, h - k - 0.4)):
            nail(c, x, y, 1.8)
    if vines:
        vine(c, [(2, 15), (3.5, 9), (6, 5), (10, 3), (16, 2.2)], seed=seed, leaves=3)
        vine(c, [(w - 2, h - 15), (w - 3.5, h - 9), (w - 6, h - 5.5), (w - 10, h - 3.4), (w - 16, h - 2.6)], seed=seed + 9, leaves=3)
        # little berry cluster
        for bx, by in ((5.5, 13), (7.6, 14.6)):
            c.part(blob(bx, by, 1.6, 1.6, steps=16), P['berry-500'], ow=0.9, shade=False)
    return c.out()


@sprite('panel_wood', 64, 64, nine=(22, 22, 22, 22), tags=['panel'])
def _(sc):
    return _wood_frame(sc, 64, 64, 12, 11, 11)


@sprite('panel_wood_vine', 64, 64, nine=(24, 24, 24, 24), tags=['panel'])
def _(sc):
    return _wood_frame(sc, 64, 64, 12, 11, 21, vines=True)


@sprite('panel_wood_dark', 64, 64, nine=(22, 22, 22, 22), tags=['panel'])
def _(sc):
    return _wood_frame(sc, 64, 64, 12, 11, 31, interior=P['choc-700'])


@sprite('panel_parchment', 64, 64, nine=(18, 18, 18, 18), tags=['panel'])
def _(sc):
    c = Ink(64, 64, sc)
    m_o = c.poly_mask(rrect(0.8, 0.8, 63.2, 62.4, 10, wob=0.5, seed=41))
    c.paint(m_o, INK)
    c.paint(c.poly_mask(rrect(2.6, 3.4, 61.4, 61, 8.4, seed=42)), P['parchment-400'])
    m = c.poly_mask(rrect(2.6, 2.6, 61.4, 59.4, 8.4, wob=0.25, seed=42))
    c.paint(m, P['parchment-100'])
    # warm edge vignette (only within inset)
    e = ImageChops.subtract(m, c.poly_mask(rrect(7, 7, 57, 55, 6))).filter(ImageFilter.GaussianBlur(c.S * 2))
    c.paint(ImageChops.multiply(e, m), alpha(P['parchment-300'], 160))
    hl = ImageChops.subtract(m, ImageChops.offset(m, 0, int(1.2 * c.S))).filter(ImageFilter.GaussianBlur(c.S * 0.4))
    c.paint(ImageChops.multiply(hl, m), (255, 255, 250, 200))
    # corner flourishes (ink curls) - in fixed corner regions
    for (x, y, a0) in ((7, 7, 180), (57, 7, 270), (7, 55, 90), (57, 55, 0)):
        c.arc((x - 3, y - 3, x + 3, y + 3), a0, a0 + 90, alpha(P['parchment-500'], 220), 0.9)
        c.ellipse((x - 0.9, y - 0.9, x + 0.9, y + 0.9), alpha(P['parchment-500'], 220))
    return c.out()


@sprite('panel_inset', 48, 48, nine=(14, 14, 14, 14), tags=['panel'])
def _(sc):
    c = Ink(48, 48, sc)
    inset_well(c, 0.8, 0.8, 47.2, 47.2, 9, P['parchment-200'], ow=2, outline=P['parchment-500'], shadow=2.4)
    return c.out()


@sprite('panel_hud', 48, 48, nine=(14, 14, 14, 14), tags=['panel'])
def _(sc):
    """Translucent chocolate plaque behind HUD text (world stays visible)."""
    c = Ink(48, 48, sc)
    c.paint(c.poly_mask(rrect(0.8, 0.8, 47.2, 47.2, 11, wob=0.45, seed=51)), alpha(INK, 230))
    m = c.poly_mask(rrect(2.6, 2.6, 45.4, 45.4, 9.4, wob=0.2, seed=52))
    c.paint(m, alpha(P['choc-700'], 205))
    hl = ImageChops.subtract(m, ImageChops.offset(m, 0, int(1.4 * c.S))).filter(ImageFilter.GaussianBlur(c.S * 0.4))
    c.paint(ImageChops.multiply(hl, m), alpha(P['wood-300'], 150))
    return c.out()


@sprite('panel_tooltip', 48, 48, nine=(14, 14, 14, 16), tags=['panel'])
def _(sc):
    c = Ink(48, 48, sc)
    c.paint(c.poly_mask(rrect(1.5, 4, 47.5, 47.5, 10)), alpha(P['choc-800'], 90))  # soft drop
    c.paint(c.poly_mask(rrect(0.6, 0.6, 46.4, 45, 9, wob=0.45, seed=61)), INK)
    m = c.poly_mask(rrect(2.4, 2.4, 44.6, 43.2, 7.4, wob=0.2, seed=62))
    c.paint(m, c.vgrad(P['parchment-50'], P['parchment-100']))
    c.paint(ImageChops.multiply(ImageChops.subtract(m, ImageChops.offset(m, 0, -int(1.5 * c.S))).filter(ImageFilter.GaussianBlur(c.S * .5)), m), alpha(P['parchment-400'], 170))
    return c.out()


@sprite('ribbon_title', 96, 40, nine=(30, 16, 30, 16), tags=['panel'])
def _(sc):
    """Berry-red title ribbon with folded swallow tails (tails live in the l/r insets)."""
    c = Ink(96, 40, sc, ow=1.8)
    red, redd = P['berry-500'], P['berry-700']
    # tails
    lt = [(1.5, 12), (18, 12), (18, 34), (1.5, 34), (8, 23)]
    rt = [(94.5, 12), (78, 12), (78, 34), (94.5, 34), (88, 23)]
    c.part(lt, redd, shade=False); c.part(rt, redd, shade=False)
    # folds
    c.part([(14, 30), (24, 30), (24, 36)], darken(redd, .3), shade=False, ow=1.2)
    c.part([(82, 30), (72, 30), (72, 36)], darken(redd, .3), shade=False, ow=1.2)
    body = rrect(12, 4, 84, 31, 4, wob=0.35, seed=71)
    c.part(body, red, gloss=False)
    m = c.poly_mask(rrect(12, 4, 84, 31, 4))
    # stitch lines along top/bottom (horizontal -> stretch safe as solid)
    c.line([(15, 7.6), (81, 7.6)], alpha(P['berry-300'], 170), 0.7)
    c.line([(15, 27.4), (81, 27.4)], alpha(redd, 220), 0.7)
    c.paint(c.poly_mask(rrect(16, 9, 80, 15, 3)), (255, 255, 245, 55))
    return c.out()


@sprite('divider', 64, 14, nine=(18, 6, 18, 6), tags=['deco'])
def _(sc):
    c = Ink(64, 14, sc, ow=1.0)
    c.line([(9, 7), (55, 7)], alpha(P['parchment-500'], 255), 1.4)
    c.line([(9, 8.2), (55, 8.2)], alpha(P['parchment-50'], 200), 0.6)
    leaf(c, 8.5, 7, 3.2, 200, P['leaf-500']); leaf(c, 8.5, 7, 2.8, 150, P['leaf-300'])
    leaf(c, 55.5, 7, 3.2, -20, P['leaf-500']); leaf(c, 55.5, 7, 2.8, 30, P['leaf-300'])
    return c.out()


# ============================ buttons ============================
BTN_VARIANTS = {
    'primary': P['leaf-500'], 'secondary': P['wood-400'], 'danger': P['berry-500'], 'info': P['sky-500'], 'gold': P['sun-500'],
}


def _button(sc, base, state, seed):
    c = Ink(48, 48, sc)
    if state == 'disabled':
        base = P['slate-300']
    chunky(c, 0.8, 0.8, 47.2, 47.2, 12, base, lip=4.0, ow=2.2, pressed=(state == 'pressed'), hover=(state == 'hover'), seed=seed,
           gloss=state != 'disabled')
    if state == 'disabled':
        # hand-drawn hatch to signal disabled without relying on colour only
        m = c.poly_mask(rrect(4, 4, 44, 40, 9))
        lay = Ink(48, 48, sc)
        for i in range(-48, 48, 7):
            lay.line([(i, 48), (i + 48, 0)], alpha(P['slate-500'], 70), 1.0)
        a = ImageChops.multiply(lay.img.getchannel('A'), m); lay.img.putalpha(a)
        c.img.alpha_composite(lay.img)
    return c.out()


for _v, _base in BTN_VARIANTS.items():
    for _st in ('normal', 'hover', 'pressed', 'disabled'):
        if _st == 'disabled' and _v != 'primary':
            continue
        def _mk(sc, b=_base, st=_st, v=_v):
            return _button(sc, b, st, seed=hash(v) % 100)
        name = f'btn_{_v}_{_st}' if _st != 'disabled' else 'btn_disabled'
        sprite(name, 48, 48, nine=(16, 14, 16, 18), tags=['button'])(_mk)


@sprite('btn_wood_plank', 96, 40, nine=(18, 14, 18, 16), tags=['button'])
def _(sc):
    c = Ink(96, 40, sc)
    m = chunky(c, 0.8, 0.8, 95.2, 39.2, 8, P['wood-400'], lip=3.5, ow=2.1, seed=81, gloss=False)
    wood_grain(c, m, P['wood-400'], 82, 'h', 1.4)
    nail(c, 7, 17, 1.5); nail(c, 89, 17, 1.5)
    return c.out()


def _close(sc, state):
    c = Ink(32, 32, sc)
    chunky(c, 1, 1, 31, 31, 15, P['berry-500'], lip=3, ow=2, pressed=state == 'pressed', hover=state == 'hover', seed=91)
    dy = 1.5 if state == 'pressed' else 0
    for a, b in (((10.5, 9.5 + dy), (21.5, 19.5 + dy)), ((21.5, 9.5 + dy), (10.5, 19.5 + dy))):
        c.line([a, b], INK, 4.6)
    for a, b in (((10.5, 9.5 + dy), (21.5, 19.5 + dy)), ((21.5, 9.5 + dy), (10.5, 19.5 + dy))):
        c.line([a, b], P['parchment-50'], 2.4)
    return c.out()


for _st in ('normal', 'hover', 'pressed'):
    sprite(f'btn_close_{_st}', 32, 32, tags=['button'])(lambda sc, s=_st: _close(sc, s))


@sprite('keycap', 32, 32, nine=(10, 9, 10, 12), tags=['button'])
def _(sc):
    c = Ink(32, 32, sc)
    chunky(c, 1, 1, 31, 31, 7, P['parchment-100'], lip=4, ow=1.8, seed=95, lipc=P['parchment-400'])
    return c.out()


# ============================ slots ============================

def _slot(sc, kind):
    c = Ink(48, 48, sc)
    fill = P['parchment-300']; outline = P['wood-600']; ow = 2.2
    rc = THEME['rarity'].get(kind)
    if kind == 'hover':
        fill = lighten(P['parchment-300'], 0.25)
    if kind == 'locked':
        fill = P['slate-300']; outline = P['slate-700']
    if rc:
        fill = mix(P['parchment-300'], rc['light'], 0.35)
    if kind == 'selected':
        # gold glow + thick gold ring
        c.paint(c.poly_mask(rrect(0.2, 0.2, 47.8, 47.8, 11)).filter(ImageFilter.GaussianBlur(c.S * 0.6)), alpha(P['sun-300'], 230))
        c.paint(c.poly_mask(rrect(1, 1, 47, 47, 10.5, wob=0.35, seed=101)), INK)
        c.paint(c.poly_mask(rrect(2.6, 2.6, 45.4, 45.4, 9, wob=0.2, seed=102)), c.vgrad(P['sun-300'], P['sun-700']))
        inset_well(c, 5.6, 5.6, 42.4, 42.4, 6.5, lighten(fill, 0.2), ow=1.6, outline=INK, seed=103)
        # corner sparkles
        for x, y in ((6, 6), (42, 42)):
            c.part(star(x, y, 3.2, 1.1, 4, rot=0), P['parchment-50'], ow=0.9, shade=False)
        return c.out()
    if rc:
        c.paint(c.poly_mask(rrect(1, 1, 47, 47, 10.5, wob=0.35, seed=111)), INK)
        c.paint(c.poly_mask(rrect(2.5, 2.5, 45.5, 45.5, 9, wob=0.2, seed=112)), c.vgrad(rc['light'], rc['color']))
        inset_well(c, 5.2, 5.2, 42.8, 42.8, 6.5, fill, ow=1.6, outline=INK, seed=113)
        # gem at bottom-right corner (inside the 14px corner inset)
        gx, gy = 40.5, 40.5
        gem = [(gx, gy - 4.6), (gx + 4.2, gy), (gx, gy + 4.6), (gx - 4.2, gy)]
        c.part(gem, rc['color'], ow=1.3)
        c.poly([(gx, gy - 3.2), (gx + 2, gy - 0.4), (gx - 2, gy - 0.4)], (255, 255, 250, 170))
        if kind == 'legendary':
            c.part(star(7.5, 7.5, 4.4, 1.6, 4, rot=0), P['parchment-50'], ow=1.0, shade=False)
            c.part(star(40.5, 7.2, 2.6, 1.0, 4, rot=0), P['parchment-50'], ow=0.9, shade=False)
        return c.out()
    if kind == 'hover':
        c.paint(c.poly_mask(rrect(0.4, 0.4, 47.6, 47.6, 11)).filter(ImageFilter.GaussianBlur(c.S * 0.5)), alpha(P['sun-300'], 200))
        outline = P['sun-700']
    inset_well(c, 1.6, 1.6, 46.4, 46.4, 9, fill, ow=ow + (0.6 if kind == 'hover' else 0), outline=outline, seed=121, shadow=2.6)
    return c.out()


for _k in ('empty', 'hover', 'selected', 'locked', 'common', 'uncommon', 'rare', 'epic', 'legendary'):
    sprite(f'slot_{_k}', 48, 48, nine=(14, 14, 14, 14), tags=['slot'])(lambda sc, k=_k: _slot(sc, k))


# ============================ bars ============================

@sprite('bar_track', 64, 20, nine=(10, 9, 10, 9), tags=['bar'])
def _(sc):
    c = Ink(64, 20, sc)
    c.paint(c.poly_mask(rrect(0.6, 0.6, 63.4, 19.4, 9.4, wob=0.35, seed=131)), INK)
    m = c.poly_mask(rrect(2.3, 2.3, 61.7, 17.7, 7.6, seed=132))
    c.paint(m, P['choc-600'])
    sh = ImageChops.subtract(m, ImageChops.offset(m, 0, int(2 * c.S))).filter(ImageFilter.GaussianBlur(c.S * .6))
    c.paint(ImageChops.multiply(sh, m), alpha(P['choc-800'], 220))
    return c.out()


def _fill(sc, key):
    v = THEME['vitals'][key]
    c = Ink(64, 14, sc)
    m = c.poly_mask(rrect(0, 0, 64, 14, 7, seed=141))
    c.paint(m, c.vgrad(v['light'], v['dark'], 0, 14))
    c.paint(c.poly_mask(rrect(0, 2.5, 64, 14, 7)), alpha(v['fill'], 255))
    c.paint(c.poly_mask(rrect(0, 7.5, 64, 14, 6.5)), alpha(v['dark'], 120))
    c.paint(c.poly_mask(rrect(4, 1.8, 60, 5.2, 1.7)), (255, 255, 250, 150))
    return c.out()


for _k in ('health', 'hunger', 'thirst', 'stamina', 'xp'):
    sprite(f'bar_fill_{_k}', 64, 14, nine=(7, 6, 7, 6), tags=['bar'])(lambda sc, k=_k: _fill(sc, k))


@sprite('bar_fill_temperature', 64, 14, nine=(7, 6, 7, 6), tags=['bar'])
def _(sc):
    c = Ink(64, 14, sc)
    m = c.poly_mask(rrect(0, 0, 64, 14, 7))
    c.paint(m, c.hgrad([(t, col) for t, col in THEME['vitals']['temperature']['gradient']]))
    c.paint(ImageChops.multiply(c.poly_mask(rrect(0, 7.5, 64, 14, 6.5)), m), alpha(INK, 50))
    c.paint(c.poly_mask(rrect(4, 1.8, 60, 5.2, 1.7)), (255, 255, 250, 140))
    return c.out()


@sprite('bar_marker', 16, 28, pivot=(0.5, 0.5), tags=['bar'])
def _(sc):
    c = Ink(16, 28, sc, ow=1.5)
    c.part([(3, 2), (13, 2), (13, 6), (8, 10.5), (3, 6)], P['parchment-50'], shade=False)
    c.part([(3, 26), (13, 26), (13, 22), (8, 17.5), (3, 22)], P['parchment-50'], shade=False)
    c.line([(8, 9), (8, 19)], INK, 1.6)
    return c.out()


@sprite('bar_shine', 64, 20, nine=(10, 9, 10, 9), tags=['bar'])
def _(sc):
    """Overlay drawn on top of track+fill: notches every 1/4 + glass glint."""
    c = Ink(64, 20, sc)
    c.paint(c.poly_mask(rrect(5, 3.4, 59, 6.2, 1.4)), (255, 255, 255, 60))
    return c.out()


# ============================ tabs ============================

def _tab(sc, st):
    c = Ink(48, 48, sc)
    base = {'normal': P['wood-600'], 'hover': P['wood-500'], 'active': P['parchment-100']}[st]
    y0 = 6 if st != 'active' else 1
    c.paint(c.poly_mask(rrect(0.8, y0, 47.2, 60, 10, wob=0.4, seed=151)), INK)
    m = c.poly_mask(rrect(2.6, y0 + 1.8, 45.4, 60, 8.4, seed=152))
    c.paint(m, c.vgrad(lighten(base, 0.18), darken(base, 0.05) if st != 'active' else base, y0, 48))
    if st != 'active':
        wood_grain(c, m, base, 153, 'h', 0.8)
        c.paint(c.poly_mask(rrect(0, 44.5, 48, 48, 0)), alpha(INK, 255))
    hl = ImageChops.subtract(m, ImageChops.offset(m, 0, int(1.3 * c.S))).filter(ImageFilter.GaussianBlur(c.S * 0.4))
    c.paint(ImageChops.multiply(hl, m), (255, 250, 230, 160))
    return c.out()


for _st in ('normal', 'hover', 'active'):
    sprite(f'tab_{_st}', 48, 48, nine=(14, 16, 14, 6), tags=['tab'])(lambda sc, s=_st: _tab(sc, s))


# ============================ scrollbar ============================

@sprite('scroll_track', 20, 48, nine=(9, 10, 9, 10), tags=['scroll'])
def _(sc):
    c = Ink(20, 48, sc)
    inset_well(c, 2, 0.8, 18, 47.2, 7.5, P['parchment-300'], ow=1.8, outline=P['wood-600'], seed=161)
    return c.out()


def _thumb(sc, hover):
    c = Ink(20, 48, sc)
    m = chunky(c, 2, 1, 18, 47, 7.5, P['wood-500'] if not hover else P['wood-400'], lip=2.5, ow=1.8, seed=171, hover=hover)
    return c.out()


sprite('scroll_thumb', 20, 48, nine=(9, 10, 9, 12), tags=['scroll'])(lambda sc: _thumb(sc, False))
sprite('scroll_thumb_hover', 20, 48, nine=(9, 10, 9, 12), tags=['scroll'])(lambda sc: _thumb(sc, True))


@sprite('scroll_grip', 16, 16, tags=['scroll'])
def _(sc):
    c = Ink(16, 16, sc)
    for y in (5, 8, 11):
        c.line([(4.5, y), (11.5, y)], alpha(P['wood-900'], 200), 1.2)
        c.line([(4.5, y + 0.9), (11.5, y + 0.9)], alpha(P['wood-200'], 160), 0.6)
    return c.out()


# ============================ checkbox / toggle / slider / input ============================

def _check(sc, on, st):
    c = Ink(32, 32, sc)
    fill = P['parchment-50'] if st != 'disabled' else P['slate-300']
    outline = P['sun-700'] if st == 'hover' else INK
    inset_well(c, 3, 3, 29, 29, 6.5, fill, ow=2.2 if st != 'hover' else 2.8, outline=outline, seed=181, shadow=2)
    if on:
        pts = [(8.5, 16), (13.8, 22), (26.5, 6.5)]
        c.line(pts, INK, 6.2)
        c.line(pts, P['leaf-500'] if st != 'disabled' else P['slate-500'], 3.4)
        c.line([(9.6, 15.6), (13.8, 20.2)], alpha(P['leaf-300'], 220), 1.0)
    return c.out()


for _on in (False, True):
    for _st in ('normal', 'hover', 'disabled'):
        nm = f"checkbox_{'on' if _on else 'off'}" + ('' if _st == 'normal' else f'_{_st}')
        sprite(nm, 32, 32, tags=['checkbox'])(lambda sc, o=_on, s=_st: _check(sc, o, s))


def _toggle(sc, on, disabled=False):
    c = Ink(48, 28, sc)
    tr = P['leaf-500'] if on else P['slate-500']
    if disabled:
        tr = P['slate-300']
    inset_well(c, 1, 3, 47, 25, 11, tr, ow=2.2, outline=INK, seed=191, shadow=2.2)
    kx = 34 if on else 14
    c.part(blob(kx, 13.4, 10, 10, wob=0.3, seed=192), P['parchment-50'] if not disabled else P['slate-300'], ow=2.0)
    if on:
        leaf(c, kx - 2.2, 13, 3.4, -40, P['leaf-500'])
    else:
        c.ellipse((kx - 2, 11.4, kx + 2, 15.4), alpha(P['slate-500'], 200))
    return c.out()


sprite('toggle_off', 48, 28, tags=['toggle'])(lambda sc: _toggle(sc, False))
sprite('toggle_on', 48, 28, tags=['toggle'])(lambda sc: _toggle(sc, True))
sprite('toggle_disabled', 48, 28, tags=['toggle'])(lambda sc: _toggle(sc, False, True))


@sprite('slider_track', 64, 20, nine=(9, 9, 9, 9), tags=['slider'])
def _(sc):
    c = Ink(64, 20, sc)
    inset_well(c, 0.8, 4, 63.2, 16, 6, P['parchment-300'], ow=2, outline=INK, seed=201, shadow=1.8)
    return c.out()


@sprite('slider_fill', 64, 20, nine=(9, 9, 9, 9), tags=['slider'])
def _(sc):
    c = Ink(64, 20, sc)
    c.paint(c.poly_mask(rrect(0.8, 4, 63.2, 16, 6, wob=.3, seed=201)), INK)
    m = c.poly_mask(rrect(2.8, 6, 61.2, 14, 4.2))
    c.paint(m, c.vgrad(P['leaf-300'], P['leaf-700'], 6, 14))
    c.paint(c.poly_mask(rrect(5, 6.8, 59, 8.6, .9)), (255, 255, 245, 130))
    return c.out()


def _knob(sc, hover):
    c = Ink(32, 32, sc, ow=2.0)
    # acorn knob: cap + nut
    c.part(blob(16, 18.5, 9.2, 9.6, wob=0.3, seed=211), P['wood-300'] if hover else P['wood-400'])
    c.part(rrect(5.5, 7, 26.5, 15.5, 5, wob=0.4, seed=212), P['wood-700'])
    for x in range(8, 26, 3):
        c.line([(x, 9), (x + 1.4, 13.6)], alpha(P['wood-900'], 170), 0.7)
    c.part(rrect(14.6, 2.5, 17.6, 8.5, 1.4), P['wood-700'], ow=1.2, shade=False)
    c.shine(12, 20, 2, 3, 120)
    return c.out()


sprite('slider_knob', 32, 32, tags=['slider'])(lambda sc: _knob(sc, False))
sprite('slider_knob_hover', 32, 32, tags=['slider'])(lambda sc: _knob(sc, True))


def _input(sc, st):
    c = Ink(48, 48, sc)
    fill = P['parchment-50'] if st != 'disabled' else P['slate-300']
    if st == 'focus':
        c.paint(c.poly_mask(rrect(0, 0, 48, 48, 11)).filter(ImageFilter.GaussianBlur(c.S * 0.6)), alpha(P['sky-300'], 230))
    inset_well(c, 1.4, 1.4, 46.6, 46.6, 9, fill, ow=2.2 if st != 'focus' else 2.6, outline=INK if st != 'focus' else P['sky-700'], seed=221, shadow=2.4)
    return c.out()


for _st in ('normal', 'focus', 'disabled'):
    sprite(f'input_{_st}', 48, 48, nine=(14, 14, 14, 14), tags=['input'])(lambda sc, s=_st: _input(sc, s))


# ============================ bubble / toast / minimap ============================

@sprite('bubble', 48, 48, nine=(16, 16, 16, 16), tags=['chat'])
def _(sc):
    c = Ink(48, 48, sc)
    c.paint(c.poly_mask(rrect(0.8, 0.8, 47.2, 46.6, 15, wob=0.6, seed=231)), INK)
    m = c.poly_mask(rrect(2.6, 2.6, 45.4, 44.8, 13.4, wob=0.3, seed=232))
    c.paint(m, P['parchment-50'])
    c.paint(ImageChops.multiply(ImageChops.subtract(m, ImageChops.offset(m, 0, -int(2 * c.S))).filter(ImageFilter.GaussianBlur(c.S * .6)), m), alpha(P['parchment-300'], 200))
    return c.out()


@sprite('bubble_tail', 24, 16, pivot=(0.5, 0.0), tags=['chat'])
def _(sc):
    c = Ink(24, 16, sc)
    pts = [(4.5, -3), (19.5, -3), (13.4, 13.8), (11.4, 13.8)]
    c.paint(c.dilate(c.poly_mask(pts), 1.9), INK)
    c.poly(pts, P['parchment-50'])
    return c.out()


TOAST = {'info': ('sky-500', 'ic_info'), 'success': ('leaf-500', 'ic_check'), 'warning': ('pumpkin-500', 'ic_warn'), 'danger': ('berry-500', 'ic_skull')}


def _toast(sc, kind):
    c = Ink(72, 56, sc)
    col = P[TOAST[kind][0]]
    c.paint(c.poly_mask(rrect(1.5, 4.5, 71.5, 55.5, 12)), alpha(P['choc-800'], 80))
    c.paint(c.poly_mask(rrect(0.6, 0.6, 70.4, 53.6, 11, wob=0.45, seed=241)), INK)
    m = c.poly_mask(rrect(2.4, 2.4, 68.6, 51.8, 9.4, seed=242))
    c.paint(m, c.vgrad(P['parchment-50'], P['parchment-100']))
    capm = ImageChops.multiply(m, c.poly_mask([(0, 0), (34, 0), (34, 56), (0, 56)]))
    c.paint(capm, c.vgrad(lighten(col, 0.2), darken(col, 0.1)))
    c.line([(34, 3), (34, 51)], INK, 1.8)
    c.paint(ImageChops.multiply(ImageChops.subtract(capm, ImageChops.offset(capm, 0, int(1.3 * c.S))).filter(ImageFilter.GaussianBlur(c.S * .4)), capm), (255, 255, 245, 120))
    return c.out()


for _k in TOAST:
    sprite(f'toast_{_k}', 72, 56, nine=(40, 16, 16, 16), tags=['toast'])(lambda sc, k=_k: _toast(sc, k))


@sprite('minimap_frame', 176, 176, tags=['minimap'])
def _(sc):
    c = Ink(176, 176, sc, ow=2.2)
    cx = cy = 88
    ring_o = c.poly_mask(blob(cx, cy, 82, 82, wob=0.8, seed=251, steps=120))
    c.paint(c.dilate(ring_o, 2.2), INK)
    c.paint(ring_o, c.vgrad(P['wood-300'], P['wood-600'], 6, 170))
    wood_grain(c, ring_o, P['wood-500'], 252, 'h', 0.6)
    hole = c.ellipse_mask((cx - 70, cy - 70, cx + 70, cy + 70))
    inner_ink = c.ellipse_mask((cx - 72.5, cy - 72.5, cx + 72.5, cy + 72.5))
    c.paint(inner_ink, INK)
    # punch the hole
    a = ImageChops.subtract(c.img.getchannel('A'), hole); c.img.putalpha(a)
    # bevel
    bev = ImageChops.subtract(ring_o, ImageChops.offset(ring_o, 0, int(2 * c.S))).filter(ImageFilter.GaussianBlur(c.S * .5))
    c.paint(ImageChops.multiply(bev, ring_o), alpha(P['wood-200'], 200))
    # nails at diagonals
    for a_ in (45, 135, 225, 315):
        r = 77
        nail(c, cx + r * math.cos(math.radians(a_)), cy + r * math.sin(math.radians(a_)), 2.2)
    # compass N tab
    c.part(blob(cx, 12, 11, 10, wob=0.4, seed=253), P['berry-500'])
    c.line([(cx - 3.5, 17), (cx - 3.5, 7), (cx + 3.5, 17), (cx + 3.5, 7)], INK, 3.2)
    c.line([(cx - 3.5, 17), (cx - 3.5, 7), (cx + 3.5, 17), (cx + 3.5, 7)], P['parchment-50'], 1.5)
    # vines
    vine(c, [(18, 120), (14, 134), (20, 150), (32, 162), (46, 168)], seed=254, leaves=4)
    vine(c, [(150, 40), (158, 30), (156, 20)], seed=255, leaves=2)
    for bx, by in ((22, 140), (25.5, 143.5), (21.5, 145)):
        c.part(blob(bx, by, 2.4, 2.4, steps=16), P['berry-500'], ow=1.0)
    return c.out()


@sprite('minimap_mask', 140, 140, tags=['minimap'])
def _(sc):
    c = Ink(140, 140, sc)
    c.ellipse((0, 0, 140, 140), (255, 255, 255, 255))
    return c.out()


@sprite('minimap_player', 24, 24, tags=['minimap'])
def _(sc):
    c = Ink(24, 24, sc, ow=1.6)
    c.part([(12, 2.5), (20, 20), (12, 16), (4, 20)], P['sun-500'])
    return c.out()


@sprite('minimap_ping', 16, 16, tags=['minimap'])
def _(sc):
    c = Ink(16, 16, sc, ow=1.4)
    c.part(blob(8, 8, 5, 5), P['sky-500'])
    return c.out()


@sprite('notif_dot', 16, 16, tags=['deco'])
def _(sc):
    c = Ink(16, 16, sc, ow=1.4)
    c.part(blob(8, 8, 5.4, 5.4, wob=.3, seed=3), P['berry-500'])
    return c.out()


from . import icons  # noqa: E402,F401  (registers icons & cursors)
