"""Touch kit: virtual joystick, round action buttons (normal/pressed/disabled), radial menus (hotbar + emotes),
build-mode grid tiles (64x32 iso), focus highlight frames (nine-slice per device), bottom sheet, prompt footer,
hold-to-split ring, drag-lift shadow. Geometry matches engine packages/input/profiles/touchLayout.json:
VirtualControls.geometry() gives centre + r (px); draw sprites centred, scaled to 2r / art diameter."""
from __future__ import annotations
import math
from PIL import Image, ImageChops, ImageFilter, ImageDraw
from uikit.draw import hexc, lighten, darken, alpha, mix, rrect, blob, star, regular
from uikit.icon import Ink
from .reg import sprite, P, INK, text
from . import icons as IC

T = 'touch'


def ink(w, h, sc, ow=1.6): return Ink(w, h, sc, ow=ow)


def soft_shadow(c, cx, cy, rx, ry, a=90):
    m = c.poly_mask(blob(cx, cy, rx, ry, steps=40)).filter(ImageFilter.GaussianBlur(c.S * 2))
    c.paint(m, alpha(P['plum-700'], a))


# ------------------------------------------------------------------ round action buttons
BTN_D = 96  # art diameter incl. outline+shadow; face radius ~ 42 so a 44dp attack button maps ~1:1 at scale 1


def round_button(bid, state):
    src, col = IC.BUTTONS[bid]
    base = hexc(P[col])
    if state == 'disabled': base = mix(mix(base, hexc(P['slate-300']), 0.7), hexc(P['parchment-300']), 0.2)

    def fn(sc):
        c = ink(BTN_D, BTN_D, sc, ow=2.2)
        pr = state == 'pressed'; dy = 3.0 if pr else 0.0
        soft_shadow(c, 48, 55, 41, 39, 70 if not pr else 40)
        # lip (darker underside) then face
        lip = darken(base, 0.35)
        if not pr: c.part(blob(48, 51, 41, 41, wob=0.25, seed=21), lip, gloss=False, shade=False)
        face = c.part(blob(48, 47 + dy, 41, 41, wob=0.25, seed=21), base, gloss=False)
        c.paint(ImageChops.multiply(face, c.poly_mask(blob(48, 40 + dy, 34, 30))), alpha(lighten(base, 0.25), 150))
        # inner parchment well so icons read on every colour
        c.part(blob(48, 47 + dy, 31, 31, wob=0.2, seed=22), mix(hexc(P['parchment-50']), base, 0.18 if state != 'disabled' else 0.35), ow=1.2, gloss=False)
        if not pr: c.shine(30, 24 + dy, 9, 4.5, 170)
        # stitched ring
        for i in range(28):
            a = i / 28 * math.tau
            x, y = 48 + 37 * math.cos(a), 47 + dy + 37 * math.sin(a)
            c.ellipse((x - 0.9, y - 0.9, x + 0.9, y + 0.9), alpha(lighten(base, 0.55), 200 if state != 'disabled' else 90))
        im = IC.icon_image(src, int(round(44 * c.S)))
        if state == 'disabled':
            g = im.convert('LA').convert('RGBA'); g.putalpha(im.getchannel('A').point(lambda v: v * 0.55)); im = g
        c.img.alpha_composite(im, (int(26 * c.S), int((25 + dy) * c.S)))
        if state == 'disabled':  # little padlock pip: non-colour cue
            c.part(rrect(66, 66, 78, 76, 2), P['slate-300'], ow=1.2, gloss=False)
            c.arc((68.5, 60.5, 75.5, 70), 180, 360, INK, 1.6)
        return c.out()
    return fn


STATES = ('normal', 'pressed', 'disabled')
for bid in IC.VIRTUAL:
    for st in STATES:
        sprite(T, f'vb_{bid}_{st}', BTN_D, BTN_D, tags=['virtual_button', bid, st], meta={"action": bid, "state": st, "faceRadius": 41})(round_button(bid, st))


# ------------------------------------------------------------------ joystick
@sprite(T, 'vj_base', 128, 128, tags=['joystick'], meta={"radiusArt": 60})
def _(sc, active=False):
    c = ink(128, 128, sc, ow=2.0)
    soft_shadow(c, 64, 68, 58, 56, 60)
    ring = c.part(blob(64, 64, 58, 58, wob=0.3, seed=31), alpha(P['wood-500'], 235), gloss=False)
    c.part(blob(64, 64, 46, 46, wob=0.2, seed=32), alpha(P['parchment-200'] if not active else P['parchment-50'], 170), ow=1.2, gloss=False, shade=False)
    for ang in (-90, 0, 90, 180):
        a = math.radians(ang); x, y = 64 + 52 * math.cos(a), 64 + 52 * math.sin(a)
        pts = [(x + 5 * math.cos(a), y + 5 * math.sin(a)), (x + 4.5 * math.cos(a + 2.2), y + 4.5 * math.sin(a + 2.2)), (x + 4.5 * math.cos(a - 2.2), y + 4.5 * math.sin(a - 2.2))]
        c.part(pts, P['sun-300'] if active else P['parchment-200'], ow=1.0, gloss=False, shade=False)
    for i in range(36):
        a = i / 36 * math.tau; x, y = 64 + 46 * math.cos(a), 64 + 46 * math.sin(a)
        c.ellipse((x - 0.8, y - 0.8, x + 0.8, y + 0.8), alpha(P['wood-300'], 220))
    # little leaf ornament
    c.part(blob(98, 22, 7, 3.4, wob=0.2, seed=33, rot=-0.7), P['leaf-500'], ow=1.2)
    return c.out()


sprite(T, 'vj_base_active', 128, 128, tags=['joystick'])(lambda sc: REGF('vj_base')(sc, True))


def knob(pressed):
    def fn(sc):
        c = ink(64, 64, sc, ow=2.0)
        soft_shadow(c, 32, 37, 26, 24, 80)
        col = P['sun-500'] if pressed else P['pumpkin-300']
        c.part(blob(32, 34, 26, 26, wob=0.25, seed=34), darken(col, 0.3), gloss=False, shade=False)
        c.part(blob(32, 31, 26, 26, wob=0.25, seed=34), col)
        c.part(blob(32, 31, 15, 15, wob=0.2, seed=35), lighten(col, 0.25), ow=1.0, gloss=False)
        for dx in (-5, 0, 5):
            c.ellipse((32 + dx - 1.4, 30, 32 + dx + 1.4, 32.8), alpha(darken(col, 0.4), 200))
        c.shine(22, 19, 6, 3, 190)
        return c.out()
    return fn


sprite(T, 'vj_knob', 64, 64, tags=['joystick'])(knob(False))
sprite(T, 'vj_knob_pressed', 64, 64, tags=['joystick'])(knob(True))


@sprite(T, 'vj_zone', 48, 48, nine=(16, 16, 16, 16), tags=['joystick', 'nine'], meta={"note": "floating-joystick activation zone hint (first-run / settings preview)"})
def _(sc):
    c = ink(48, 48, sc)
    c.paint(c.poly_mask(rrect(2, 2, 46, 46, 14)), alpha(P['parchment-50'], 40))
    m = c.poly_mask(rrect(2, 2, 46, 46, 14)); inner = c.poly_mask(rrect(4, 4, 44, 44, 12))
    ringm = ImageChops.subtract(m, inner)
    dash = Image.new('L', ringm.size, 0); d = ImageDraw.Draw(dash); S = c.S
    for i in range(0, 48, 8):
        d.rectangle([i * S, 0, (i + 4) * S, 48 * S], fill=255)
    dash2 = Image.new('L', ringm.size, 0); d2 = ImageDraw.Draw(dash2)
    for i in range(0, 48, 8):
        d2.rectangle([0, i * S, 48 * S, (i + 4) * S], fill=255)
    hz = ImageChops.multiply(ringm, ImageChops.lighter(ImageChops.multiply(dash, c.poly_mask([(0, 0), (48, 0), (48, 6), (0, 6)])) ,
                                                     ImageChops.lighter(ImageChops.multiply(dash, c.poly_mask([(0, 42), (48, 42), (48, 48), (0, 48)])),
                                                                        ImageChops.multiply(dash2, c.poly_mask([(0, 6), (6, 6), (6, 42), (0, 42), (0, 6)]).point(lambda v: v) if False else ImageChops.lighter(ImageChops.multiply(dash2, c.poly_mask([(0, 0), (6, 0), (6, 48), (0, 48)])), ImageChops.multiply(dash2, c.poly_mask([(42, 0), (48, 0), (48, 48), (42, 48)])))))))
    c.paint(hz, alpha(P['parchment-50'], 220))
    return c.out()


# ------------------------------------------------------------------ radial menu (hotbar + emotes)
RAD = 160  # art covers radius 70dp + outline; inner radius 22


@sprite(T, 'rad_ring', RAD, RAD, tags=['radial'], meta={"radiusArt": 74, "innerArt": 24})
def _(sc):
    c = ink(RAD, RAD, sc, ow=2.0)
    soft_shadow(c, 80, 84, 74, 72, 70)
    outer = c.poly_mask(blob(80, 80, 74, 74, wob=0.2, seed=41)); inner = c.poly_mask(blob(80, 80, 24, 24))
    ringm = ImageChops.subtract(outer, inner)
    c.part(ringm, alpha(P['wood-500'], 230), gloss=False)
    c.part(ImageChops.subtract(c.poly_mask(blob(80, 80, 68, 68)), c.poly_mask(blob(80, 80, 29, 29))), alpha(P['parchment-100'], 225), ow=1.2, gloss=False, shade=False)
    for i in range(8):
        a = math.radians(i * 45 - 90 + 22.5)
        c.line([(80 + 29 * math.cos(a), 80 + 29 * math.sin(a)), (80 + 68 * math.cos(a), 80 + 68 * math.sin(a))], alpha(P['wood-300'], 230), 1.3)
    return c.out()


def wedge(hi):
    def fn(sc):
        c = ink(RAD, RAD, sc, ow=1.6)
        a0, a1 = -90 - 22.5 + 1.5, -90 + 22.5 - 1.5
        pts = [(80 + 68 * math.cos(math.radians(a0 + (a1 - a0) * t / 16)), 80 + 68 * math.sin(math.radians(a0 + (a1 - a0) * t / 16))) for t in range(17)]
        pts += [(80 + 29 * math.cos(math.radians(a1 - (a1 - a0) * t / 8)), 80 + 29 * math.sin(math.radians(a1 - (a1 - a0) * t / 8))) for t in range(9)]
        c.part(pts, P['sun-300'] if hi else P['parchment-50'], gloss=hi)
        if hi: c.part(star(80, 9.5, 5, 2.2, 5), P['sun-500'], ow=1.0, gloss=False)
        return c.out()
    return fn


sprite(T, 'rad_seg', RAD, RAD, tags=['radial'], meta={"note": "segment 0 at 12 o'clock; rotate by i*45deg about centre"})(wedge(False))
sprite(T, 'rad_seg_hi', RAD, RAD, tags=['radial'])(wedge(True))


@sprite(T, 'rad_hub', 48, 48, tags=['radial'])
def _(sc):
    c = ink(48, 48, sc, ow=1.8)
    c.part(blob(24, 24, 20, 20, wob=0.2, seed=42), P['wood-400'])
    c.part(blob(24, 24, 12, 12), P['parchment-100'], ow=1.1, gloss=False)
    c.part(regular(24, 24, 5, 8, 22.5), P['sun-500'], ow=1.0, gloss=False, shade=False)
    return c.out()


EMOTES = {1: ('wave', 'happy'), 2: ('laugh', 'happy'), 3: ('cheer', 'happy'), 4: ('heart', 'happy'), 5: ('sad', 'sad'),
          6: ('sit', 'sleepy'), 7: ('point', 'o'), 8: ('dance', 'cool')}


def emote_icon(eid):
    key, mood = EMOTES[eid]
    def fn(sc):
        c = ink(48, 48, sc, ow=1.8)
        if key == 'heart':
            from uikit.draw import heart
            c.part(heart(24, 25, 18, wob=0.3, seed=50), P['rose-500']); c.face(24, 24, 1.6, 'happy'); return c.out()
        c.part(blob(24, 25, 16, 15, wob=0.3, seed=51 + eid), '#FFD2AD')
        c.paint(c.poly_mask(blob(17, 30, 2.6, 1.6)), alpha(P['rose-300'], 200)); c.paint(c.poly_mask(blob(31, 30, 2.6, 1.6)), alpha(P['rose-300'], 200))
        if key == 'laugh':
            for ex in (18.5, 29.5): c.arc((ex - 3, 19, ex + 3, 25), 200, 340, INK, 1.4)
            c.part([(18, 29), (30, 29), (27, 35), (21, 35)], P['berry-700'], ow=1.2, gloss=False, shade=False)
            for x, y in ((40, 12), (8, 14)): c.part(blob(x, y, 2.2, 3.2), P['sky-300'], ow=0.9, gloss=False)
        else:
            c.face(24, 24, 1.6, mood)
        if key == 'wave':
            c.part(blob(41, 18, 5, 6, wob=0.3, seed=52), '#FFD2AD', ow=1.3)
            for k in range(3):
                a = math.radians(-120 + k * 30); c.line([(41 + 8 * math.cos(a), 18 + 8 * math.sin(a)), (41 + 11 * math.cos(a), 18 + 11 * math.sin(a))], P['sun-500'], 1.4)
        if key == 'cheer':
            c.part(star(39, 10, 7, 3, 5, wob=0.2), P['sun-500'], ow=1.2); c.part(star(9, 12, 5, 2.2, 5), P['leaf-300'], ow=1.0, gloss=False)
        if key == 'sad':
            c.part(blob(32, 30, 2.2, 3.4), P['sky-300'], ow=0.9, gloss=False)
        if key == 'sit':
            c.part(blob(24, 42, 12, 3.5, wob=0.3, seed=53), P['wood-500'], ow=1.2, gloss=False)
            c.part([(20, 41), (24, 33), (28, 41)], P['fire-500'], ow=1.0, gloss=False)
            text(c, 'z', 40, 11, 9, INK)
        if key == 'point':
            c.part([(36, 24), (46, 24), (46, 21), (48, 25.5), (46, 30), (46, 27), (36, 27)], P['sun-500'], ow=1.1, gloss=False)
        if key == 'dance':
            c.part(rrect(14, 16, 34, 21, 2), INK, ow=0, shade=False)
            for x, y in ((7, 8), (41, 38)):
                c.line([(x, y + 6), (x, y)], INK, 1.3); c.ellipse((x - 3, y + 4, x, y + 7.5), INK)
        return c.out()
    return fn


for eid, (key, _m) in EMOTES.items():
    sprite(T, f'emote_{key}', 48, 48, tags=['emote', 'radial'], meta={"emoteId": eid})(emote_icon(eid))


# ------------------------------------------------------------------ build grid tiles (64x32 iso diamond)
DIA = [(32, 1), (63, 16), (32, 31), (1, 16)]


def tile(kind):
    def fn(sc):
        c = Ink(64, 32, sc, ow=1.0)
        d = c.poly_mask(DIA)
        inner = c.poly_mask([(32, 3.2), (59, 16), (32, 28.8), (5, 16)])
        edge = ImageChops.subtract(d, inner)
        if kind == 'grid':
            c.paint(edge, alpha(P['parchment-50'], 90)); return c.out()
        col, fa, ea = {'valid': (P['leaf-300'], 95, 230), 'invalid': (P['red-300'], 105, 235), 'snap': (P['sky-300'], 90, 230),
                       'occupied': (P['slate-300'], 70, 190), 'hover': (P['sun-300'], 70, 235), 'claim': (P['plum-300'], 60, 200)}[kind]
        c.paint(inner, alpha(col, fa)); c.paint(edge, alpha(darken(col, 0.2), ea))
        if kind == 'invalid':  # hatching: non-colour cue
            h = Image.new('L', d.size, 0); dr = ImageDraw.Draw(h); S = c.S
            for x in range(-32, 96, 7): dr.line([(x * S, 32 * S), ((x + 16) * S, 0)], fill=150, width=int(1.4 * S))
            c.paint(ImageChops.multiply(h, inner), alpha(P['red-700'], 150))
        if kind == 'valid':
            c.line([(27, 16), (31, 19.5), (38, 12.5)], alpha(P['leaf-700'], 230), 1.6)
        if kind == 'snap':
            for (x, y) in DIA: c.ellipse((x - 2, y - 2, x + 2, y + 2), alpha(P['sky-700'], 230) if 0 < x < 64 else (0, 0, 0, 0))
        if kind == 'occupied':
            c.ellipse((29.5, 13.5, 34.5, 18.5), alpha(P['slate-700'], 200))
        return c.out()
    return fn


for k in ('grid', 'valid', 'invalid', 'snap', 'occupied', 'hover', 'claim'):
    sprite(T, f'tile_{k}', 64, 32, tags=['build_tile'], pivot=(0.5, 0.5))(tile(k))


# ------------------------------------------------------------------ focus highlight frames (nine-slice)
def focus_frame(dev):
    spec = {'gamepad': (P['sun-500'], 3.2, True), 'kbm': (P['sky-500'], 2.0, False), 'touch': (P['leaf-500'], 2.6, False),
            'gamepad_drag': (P['pumpkin-500'], 3.2, True)}[dev]
    col, wd, corners = spec

    def fn(sc):
        c = Ink(48, 48, sc, ow=1.0)
        o = c.poly_mask(rrect(1.5, 1.5, 46.5, 46.5, 11, wob=0.25, seed=61)); i = c.poly_mask(rrect(1.5 + wd, 1.5 + wd, 46.5 - wd, 46.5 - wd, 11 - wd))
        glow = ImageChops.subtract(c.dilate(o, 0.1), i).filter(ImageFilter.GaussianBlur(c.S * 1.0))
        c.paint(c.dilate(ImageChops.subtract(o, i), 1.0), INK)
        c.paint(ImageChops.subtract(o, i), col)
        c.paint(ImageChops.subtract(c.poly_mask(rrect(2.2, 2.2, 45.8, 24, 10)), c.poly_mask(rrect(1.5 + wd, 1.5 + wd, 46.5 - wd, 46.5 - wd, 11 - wd))), alpha(lighten(col, 0.5), 120))
        if corners:  # little leaf "brackets" at the corners
            for (x, y, r) in ((5, 5, -2.4), (43, 5, -0.8), (5, 43, 2.4), (43, 43, 0.8)):
                c.part(blob(x, y, 4.2, 2.2, wob=0.2, seed=int(x + y), rot=r), P['leaf-500'] if dev == 'gamepad' else P['pumpkin-300'], ow=1.1, gloss=False)
        return c.out()
    return fn


for dev in ('gamepad', 'kbm', 'touch', 'gamepad_drag'):
    sprite(T, f'focus_{dev}', 48, 48, nine=(16, 16, 16, 16), tags=['focus', dev, 'nine'])(focus_frame(dev))


# ------------------------------------------------------------------ bottom sheet + handle, footer, prompt chip
@sprite(T, 'sheet_frame', 96, 96, nine=(28, 36, 28, 8), tags=['sheet', 'nine'], meta={"note": "phone bottom sheet; anchored to bottom, top corners round, grab handle drawn separately at top-centre"})
def _(sc):
    c = Ink(96, 96, sc, ow=2.0)
    c.part(rrect(2, 6, 94, 110, 20, wob=0.25, seed=71), P['wood-500'], gloss=False)
    c.part(rrect(8, 14, 88, 110, 14, wob=0.2, seed=72), P['parchment-100'], ow=1.4, gloss=False, shade=False)
    for x in range(12, 86, 6): c.line([(x, 10), (x + 3, 10)], alpha(P['wood-300'], 220), 1.0)
    return c.out()


@sprite(T, 'sheet_handle', 48, 16, tags=['sheet'])
def _(sc):
    c = Ink(48, 16, sc, ow=1.4)
    c.part(rrect(8, 5, 40, 11, 3), P['wood-300'], gloss=False)
    return c.out()


@sprite(T, 'footer_bar', 64, 40, nine=(20, 14, 20, 14), tags=['footer', 'nine'], meta={"note": "button-prompt footer strip (gamepad/kbm); glyph + label pairs sit on it"})
def _(sc):
    c = Ink(64, 40, sc, ow=1.8)
    c.part(rrect(2, 3, 62, 37, 12, wob=0.25, seed=73), alpha(P['choc-700'], 235), gloss=False)
    c.line([(12, 7.5), (52, 7.5)], alpha(P['wood-300'], 160), 0.9)
    return c.out()


@sprite(T, 'prompt_chip', 48, 32, nine=(14, 12, 14, 12), tags=['prompt', 'nine'], meta={"note": "world interaction prompt backing (WebGL) and HUD key-hint backing"})
def _(sc):
    c = Ink(48, 32, sc, ow=1.6)
    c.part(rrect(2, 2.5, 46, 29.5, 11, wob=0.25, seed=74), alpha(P['parchment-50'], 240), gloss=False)
    return c.out()


# hold-to-split progress ring: 8 frames (0..7 = 12.5%..100%)
def split_ring(k):
    def fn(sc):
        c = Ink(64, 64, sc, ow=1.4)
        c.arc((6, 6, 58, 58), 0, 360, alpha(INK, 110), 6.5)
        end = -90 + 360 * (k + 1) / 8
        c.arc((6, 6, 58, 58), -90, end, INK, 6.5); c.arc((6.8, 6.8, 57.2, 57.2), -90, end, P['sun-500'], 4.2)
        if k == 7:
            c.part(star(32, 4.5, 4.5, 2, 5), P['sun-300'], ow=1.0, gloss=False)
        return c.out()
    return fn


for k in range(8):
    sprite(T, f'split_ring_{k}', 64, 64, tags=['split_ring'], meta={"frame": k})(split_ring(k))


@sprite(T, 'drag_shadow', 64, 32, tags=['drag'], meta={"note": "under a lifted item while dragging (touch drag-and-drop, gamepad 'carry')"})
def _(sc):
    c = Ink(64, 32, sc)
    soft_shadow(c, 32, 16, 24, 9, 110)
    return c.out()


@sprite(T, 'tap_pulse', 64, 64, tags=['feedback'])
def _(sc):
    c = Ink(64, 64, sc)
    c.arc((6, 6, 58, 58), 0, 360, alpha(P['parchment-50'], 220), 3.0); c.arc((16, 16, 48, 48), 0, 360, alpha(P['sun-300'], 200), 2.0)
    return c.out()


@sprite(T, 'ghost_handle', 48, 48, tags=['build'], meta={"note": "touch build ghost drag handle drawn liftPx above the finger"})
def _(sc):
    c = Ink(48, 48, sc, ow=1.8)
    c.part(blob(24, 24, 18, 18, wob=0.25, seed=75), alpha(P['parchment-50'], 235))
    for ang in (-90, 0, 90, 180):
        a = math.radians(ang); x, y = 24 + 11 * math.cos(a), 24 + 11 * math.sin(a)
        c.part([(x + 5 * math.cos(a), y + 5 * math.sin(a)), (x + 4 * math.cos(a + 2.2), y + 4 * math.sin(a + 2.2)), (x + 4 * math.cos(a - 2.2), y + 4 * math.sin(a - 2.2))], P['sky-500'], ow=1.0, gloss=False)
    c.ellipse((21, 21, 27, 27), INK)
    return c.out()


def REGF(name):
    from .reg import REG
    return REG[T][name]['fn']
