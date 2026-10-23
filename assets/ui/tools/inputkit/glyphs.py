"""Device prompt glyphs (32x32, wide keys 64x32). Original cute shapes in the Cozy Camp style: soft plum ink,
3-tone cel shading, light from the top-left. No platform logos: each family gets its own colourway and shapes.
Ids follow @engine/input glyphFor() exactly (see tools/input_ids.py)."""
from __future__ import annotations
import math, string
from uikit.draw import hexc, lighten, darken, alpha, rrect, blob, star, regular
from uikit.icon import Ink
from .reg import sprite, P, INK, text, fit_size
from . import icons as IC

GLYPHS: dict[str, tuple[str, str]] = {}   # glyph id -> (atlas group, sprite name)
ALIASES: dict[str, str] = {}             # extra id -> canonical id


def glyph(gid, group, w=32, h=32):
    name = 'g_' + gid.replace('.', '_')
    def deco(fn):
        def run(sc):
            c = Ink(w, h, sc, ow=1.6); fn(c); return c.out()
        sprite('glyphs', name, w, h, tags=['glyph', group], meta={"id": gid, "group": group})(run)
        GLYPHS[gid] = (group, name)
        return fn
    return deco


# ------------------------------------------------------------------ keyboard
def keycap(c, label, w):
    c.part(rrect(1.6, 2.6, w - 1.6, 29.6, 6.5, wob=0.25, seed=(len(label) if isinstance(label, str) else 3) * 7 + w), P['parchment-400'], gloss=False)
    c.paint(c.poly_mask(rrect(2.8, 3.4, w - 2.8, 25.6, 5.2, wob=0.2, seed=w)), c.vgrad(P['parchment-50'], P['parchment-200'], 3, 26))
    c.ellipse((5, 5, 9, 7.2), (255, 255, 248, 200))
    if isinstance(label, str):
        size, wd = fit_size(label, w - 9, 15 if len(label) == 1 else 12.5 if len(label) == 2 else 10.5)
        text(c, label, w / 2, 14.6, size, INK, 700, wd)
    else:
        label(c, w)


def arrow_tri(c, cx, cy, ang, s=5.0, col=INK):
    a = math.radians(ang)
    pts = [(cx + s * math.cos(a), cy + s * math.sin(a)), (cx + s * 0.8 * math.cos(a + 2.3), cy + s * 0.8 * math.sin(a + 2.3)),
           (cx + s * 0.8 * math.cos(a - 2.3), cy + s * 0.8 * math.sin(a - 2.3))]
    c.poly(pts, col)


KEYS = {**{ch: ch.upper() for ch in string.ascii_lowercase}, **{str(d): str(d) for d in range(10)},
        **{f'f{i}': f'F{i}' for i in range(1, 13)},
        'escape': 'Esc', 'minus': '-', 'equal': '=', 'bracket': '[ ]', 'slash': '/', 'backslash': '\\', 'semicolon': ';',
        'quote': "'", 'comma': ',', 'period': '.', 'backquote': '`', 'insert': 'Ins', 'delete': 'Del', 'home': 'Home', 'end': 'End',
        'arrowup': lambda c, w: arrow_tri(c, w / 2, 14.2, -90, 7.5), 'arrowdown': lambda c, w: arrow_tri(c, w / 2, 15, 90, 7.5),
        'arrow': lambda c, w: (arrow_tri(c, w / 2 - 5.5, 14.5, 180, 6), arrow_tri(c, w / 2 + 5.5, 14.5, 0, 6))}
WIDE = {'space': 'Space', 'shift': 'Shift', 'control': 'Ctrl', 'alt': 'Alt', 'meta': 'Meta', 'enter': 'Enter', 'tab': 'Tab',
        'backspace': 'Back', 'capslock': 'Caps', 'pageup': 'PgUp', 'pagedown': 'PgDn'}

for k, lab in KEYS.items():
    glyph(f'kbm.key.{k}', 'kbm')(lambda c, lab=lab: keycap(c, lab, 32))
for k, lab in WIDE.items():
    def _wide(c, lab=lab, k=k):
        keycap(c, lab, 64)
        if k == 'enter': arrow_tri(c, 53, 14.6, 180, 4.2)
        if k == 'shift': arrow_tri(c, 11, 14.6, -90, 4.4)
        if k == 'tab': arrow_tri(c, 53, 14.6, 0, 4.2)
    glyph(f'kbm.key.{k}', 'kbm_wide', 64, 32)(_wide)


# ------------------------------------------------------------------ mouse
def mouse(c, part):
    body = rrect(8, 3, 24, 29, 8, wob=0.3, seed=3)
    c.part(body, P['parchment-100'])
    hi = P['sun-500']
    if part == 'left': c.part([(8.6, 15), (8.6, 9), (11, 4.6), (15.6, 3.6), (15.6, 15)], hi, ow=0.9, gloss=False)
    if part == 'right': c.part([(16.4, 15), (16.4, 3.6), (21, 4.6), (23.4, 9), (23.4, 15)], hi, ow=0.9, gloss=False)
    c.line([(16, 3.8), (16, 15)], alpha(INK, 200), 0.8); c.line([(8.8, 15), (23.2, 15)], alpha(INK, 200), 0.8)
    wheel = hi if part in ('middle', 'wheel') else P['slate-300']
    c.part(rrect(14.3, 6, 17.7, 12.5, 1.6), wheel, ow=0.9, gloss=False)
    if part == 'wheel':
        arrow_tri(c, 27, 6.5, -90, 3, P['ink']); arrow_tri(c, 27, 13, 90, 3, P['ink'])
    if part in ('back', 'forward'):
        c.part(rrect(6.2, 17, 9.2, 23, 1.2), hi, ow=0.8, gloss=False)
        arrow_tri(c, 3.8 if part == 'back' else 28, 20, 180 if part == 'back' else 0, 3)


for part in ('left', 'right', 'middle', 'wheel', 'back', 'forward'):
    glyph(f'kbm.mouse.{part}', 'kbm')(lambda c, part=part: mouse(c, part))

# ------------------------------------------------------------------ gamepads
FAM = {
    'xbox': dict(disc=P['choc-700'], body=P['choc-600'], label=P['parchment-50'],
                 face={'a': ('A', P['leaf-300']), 'b': ('B', P['red-300']), 'x': ('X', P['sky-300']), 'y': ('Y', P['sun-300'])},
                 lb='LB', rb='RB', lt='LT', rt='RT', ls='L', rs='R', sel='view', start='menu', ids={}),
    'playstation': dict(disc=P['slate-700'], body=P['slate-500'], label=P['parchment-50'],
                        face={'cross': ('cross', P['sky-300']), 'circle': ('circle', P['red-300']), 'square': ('square', P['rose-300']), 'triangle': ('triangle', P['leaf-300'])},
                        lb='L1', rb='R1', lt='L2', rt='R2', ls='L3', rs='R3', sel='share', start='options',
                        ids=dict(lb='l1', rb='r1', lt='l2', rt='r2', ls='l3', rs='r3', select='share', start='options')),
    'switch': dict(disc=P['parchment-100'], body=P['parchment-300'], label=INK,
                   face={'a': ('A', INK), 'b': ('B', INK), 'x': ('X', INK), 'y': ('Y', INK)},
                   lb='L', rb='R', lt='ZL', rt='ZR', ls='L', rs='R', sel='minus', start='plus',
                   ids=dict(lb='l', rb='r', lt='zl', rt='zr', ls='lstick', rs='rstick', select='minus', start='plus')),
    'generic': dict(disc=P['wood-500'], body=P['wood-400'], label=P['parchment-50'],
                    face={'a': ('S', None), 'b': ('E', None), 'x': ('W', None), 'y': ('N', None)},
                    lb='L1', rb='R1', lt='L2', rt='R2', ls='L', rs='R', sel='select', start='start', ids={}),
}
# Nintendo-printed letter -> physical position (engine maps pad.a (south) -> switch "b")
SW_POS = {'a': 'e', 'b': 's', 'x': 'n', 'y': 'w'}
GEN_POS = {'a': 's', 'b': 'e', 'x': 'w', 'y': 'n'}
DOT = {'n': (16, 6.5), 'e': (25.5, 16), 's': (16, 25.5), 'w': (6.5, 16)}


def disc(c, col, r=13.2, seed=1):
    c.part(blob(16, 16.5, r, r, wob=0.35, seed=seed), col)
    c.ellipse((8.5, 7.5, 13, 10.5), (255, 255, 248, 110))


def ps_symbol(c, kind, col):
    if kind == 'cross':
        for a in (45, 135):
            r = math.radians(a); dx, dy = 6.2 * math.cos(r), 6.2 * math.sin(r)
            c.line([(16 - dx, 16.5 - dy), (16 + dx, 16.5 + dy)], INK, 4.4); c.line([(16 - dx, 16.5 - dy), (16 + dx, 16.5 + dy)], col, 2.4)
    elif kind == 'circle':
        c.arc((9.8, 10.3, 22.2, 22.7), 0, 360, INK, 4.2); c.arc((10.6, 11.1, 21.4, 21.9), 0, 360, col, 2.4)
    elif kind == 'square':
        c.part(rrect(10.2, 10.7, 21.8, 22.3, 1.6), alpha(col, 0), ow=2.0, shade=False)
        c.paint(c.poly_mask(rrect(11.2, 11.7, 20.8, 21.3, 1)), alpha(col, 255))
        c.paint(c.poly_mask(rrect(13.2, 13.7, 18.8, 19.3, 0.5)), P['slate-700'])
    elif kind == 'triangle':
        outer = regular(16, 17.6, 7.6, 3, -90); inner = regular(16, 17.6, 4.0, 3, -90)
        c.part(outer, col, ow=1.4, shade=False); c.poly(inner, P['slate-700'])


def face_button(fam, key):
    f = FAM[fam]; lab, col = f['face'][key]
    def fn(c):
        disc(c, f['disc'], seed=ord(key[0]))
        if fam == 'playstation': ps_symbol(c, lab, col); return
        if fam == 'generic':
            pos = GEN_POS[key]
            for p, (x, y) in DOT.items():
                if p == pos: c.part(blob(x, y + 0.5, 4.6, 4.6), P['sun-500'], ow=1.3)
                else: c.part(blob(x, y + 0.5, 2.6, 2.6), P['parchment-300'], ow=1.0, shade=False)
            return
        text(c, lab, 16, 16.2 if fam == 'xbox' else 15.4, 15, col, 700, 100)
        if fam == 'switch':  # position hint dots (south lit = B)
            pos = SW_POS[key]
            for p, (x, y) in DOT.items():
                x2, y2 = 16 + (x - 16) * 0.95, 16.5 + (y - 16) * 0.95
                c.ellipse((x2 - 1.4, y2 - 1.4, x2 + 1.4, y2 + 1.4), P['red-500'] if p == pos else alpha(INK, 70))
    return fn


def shoulder(fam, side, trigger):
    f = FAM[fam]; lab = f['lt' if trigger and side == 'l' else 'rt' if trigger else 'lb' if side == 'l' else 'rb']
    def fn(c):
        if trigger:
            pts = rrect(7, 3, 25, 29, 7, wob=0.3, seed=4)
            c.part(pts, f['disc'])
            c.ellipse((10, 6, 15, 9), (255, 255, 248, 100))
            text(c, lab, 16, 18, 11.5 if len(lab) == 2 else 13, f['label'], 700, 92)
        else:
            sl = -1.5 if side == 'l' else 1.5
            pts = [(3, 22), (3.5, 14 + sl), (8, 9), (24, 9), (28.5, 14 - sl), (29, 22)]
            c.part(rrect(3, 9, 29, 23, 6.5, wob=0.3, seed=5), f['disc'])
            c.ellipse((7, 11, 13, 13.5), (255, 255, 248, 100))
            text(c, lab, 16, 16, 11.5, f['label'], 700, 92)
    return fn


def stick(fam, side, press=False):
    f = FAM[fam]; lab = f['ls' if side == 'l' else 'rs']
    def fn(c):
        c.part(blob(16, 16.5, 13.2, 13.2, wob=0.3, seed=6), f['body'], gloss=False)
        c.part(blob(16, 16, 9.0, 9.0, wob=0.2, seed=7), f['disc'])
        c.arc((9.6, 9.6, 22.4, 22.4), 200, 330, alpha(lighten(f['disc'], 0.5), 160), 0.8)
        for ang in (-90, 0, 90, 180):
            a = math.radians(ang); arrow_tri(c, 16 + 12.2 * math.cos(a), 16.5 + 12.2 * math.sin(a), ang, 2.2, f['label'] if fam != 'switch' else INK)
        text(c, lab, 16, 15.8, 10 if len(lab) > 1 else 11.5, f['label'], 700, 90)
    return fn


def dpad(fam, arm):
    f = FAM[fam]
    def fn(c):
        plus = [(12, 3), (20, 3), (20, 12), (29, 12), (29, 20), (20, 20), (20, 29), (12, 29), (12, 20), (3, 20), (3, 12), (12, 12)]
        c.part(plus, f['disc'])
        arms = {'dup': [(12.8, 3.8), (19.2, 3.8), (19.2, 12), (12.8, 12)], 'ddown': [(12.8, 20), (19.2, 20), (19.2, 28.2), (12.8, 28.2)],
                'dleft': [(3.8, 12.8), (12, 12.8), (12, 19.2), (3.8, 19.2)], 'dright': [(20, 12.8), (28.2, 12.8), (28.2, 19.2), (20, 19.2)]}
        lit = [arm] if arm in arms else list(arms) if arm == 'dpad' else []
        for a in lit: c.part(arms[a], P['sun-500'], ow=0.9, gloss=False)
        c.ellipse((14.2, 14.2, 17.8, 17.8), alpha(darken(f['disc'], 0.3), 200))
    return fn


def menu_button(fam, which):
    f = FAM[fam]; kind = f['sel' if which == 'select' else 'start']
    def fn(c):
        if fam == 'switch':
            c.part(blob(16, 16.5, 10, 10, wob=0.3, seed=8), f['disc'])
            c.line([(11, 16.3), (21, 16.3)], INK, 2.6)
            if kind == 'plus': c.line([(16, 11.3), (16, 21.3)], INK, 2.6)
            return
        c.part(rrect(5, 10, 27, 23, 6.5, wob=0.3, seed=9), f['disc'])
        L = f['label']
        if kind in ('view', 'select', 'share'):
            c.part(rrect(10.5, 12.6, 17.5, 18.6, 1.2), alpha(f['disc'], 255), ow=0, shade=False)
            for (x0, y0) in ((10.5, 12.8), (14.5, 15.2)):
                c.arc((0, 0, 0, 0), 0, 1, L, 0.1)
                c.line([(x0, y0), (x0 + 7, y0), (x0 + 7, y0 + 5), (x0, y0 + 5), (x0, y0)], L, 1.1)
            if kind == 'share': c.line([(22, 19.5), (22, 13.5)], L, 1.2)
        else:
            for y in (13.3, 16.5, 19.7): c.line([(11, y), (21, y)], L, 1.4)
    return fn


def home(fam):
    f = FAM[fam]
    def fn(c):
        disc(c, f['disc'], 12, seed=10)
        L = f['label']
        c.poly([(16, 9.5), (23, 16), (21, 16), (21, 22.5), (11, 22.5), (11, 16), (9, 16)], L)
        c.poly([(14.5, 22.5), (14.5, 18.5), (17.5, 18.5), (17.5, 22.5)], f['disc'])
    return fn


for fam, f in FAM.items():
    ids = f['ids']
    for k in f['face']:
        glyph(f'gamepad.{fam}.{k}', fam)(face_button(fam, k))
    for b, side, trig in (('lb', 'l', False), ('rb', 'r', False), ('lt', 'l', True), ('rt', 'r', True)):
        glyph(f'gamepad.{fam}.{ids.get(b, b)}', fam)(shoulder(fam, side, trig))
    for s in ('ls', 'rs'):
        glyph(f'gamepad.{fam}.{ids.get(s, s)}', fam)(stick(fam, s[0]))
    for a in ('dup', 'ddown', 'dleft', 'dright', 'dpad'):
        glyph(f'gamepad.{fam}.{a}', fam)(dpad(fam, a))
    xb = {'select': 'view', 'start': 'menu'} if fam == 'xbox' else {}
    for m in ('select', 'start'):
        glyph(f'gamepad.{fam}.{ids.get(m, xb.get(m, m))}', fam)(menu_button(fam, m))
    glyph(f'gamepad.{fam}.home', fam)(home(fam))
# positional aliases for the generic family (requested by Engine Architect: gamepad.generic.south ...)
for k, pos in GEN_POS.items():
    ALIASES[f'gamepad.generic.{dict(s="south", e="east", w="west", n="north")[pos]}'] = f'gamepad.generic.{k}'

# ------------------------------------------------------------------ touch gestures
SKIN = '#FFD2AD'


def finger(c, x=16, y=12, ang=0.0, s=1.25):
    """Pointing finger with palm, fingertip at (x, y)."""
    a = math.radians(ang); ca, sa = math.cos(a), math.sin(a)
    T = lambda px, py: (x + (px * ca - py * sa) * s, y + (px * sa + py * ca) * s)
    c.part([T(*p) for p in rrect(-2.7, -0.5, 2.7, 13, 2.7)], SKIN, ow=1.3, gloss=False)
    c.part([T(*p) for p in blob(1.5, 15.5, 6.6, 5.2, wob=0.3, seed=11)], SKIN, ow=1.4)
    c.part([T(*p) for p in rrect(-1.6, 0.5, 1.6, 3.4, 1.4)], P['parchment-50'], ow=0, shade=False)


def ripple(c, x, y, r, a=230):
    c.arc((x - r, y - r, x + r, y + r), 0, 360, alpha(P['sky-500'], a), 1.2)


def g_tap(c): ripple(c, 16, 8.5, 5.5); ripple(c, 16, 8.5, 2.8, 160); finger(c, 16, 9)


def g_double(c):
    ripple(c, 16, 8.5, 6.5); ripple(c, 16, 8.5, 4); finger(c, 16, 9)
    c.part(blob(26, 7, 4.6, 4.6), P['sun-500'], ow=1.1, gloss=False); text(c, '2', 26, 6.8, 7, INK)


def g_hold(c):
    c.arc((9, 2, 23, 16), 0, 360, alpha(INK, 70), 2.0); c.arc((9, 2, 23, 16), -90, 180, P['sun-500'], 2.0); finger(c, 16, 9)


def g_drag(c):
    for i in range(4): c.ellipse((4 + i * 3.2 - 0.9, 18 - i * 2.2 - 0.9, 4 + i * 3.2 + 0.9, 18 - i * 2.2 + 0.9), alpha(P['sky-500'], 220))
    arrow_tri(c, 18.5, 10.5, -35, 3.2, P['sky-500']); finger(c, 21, 9.5, 0, 1.15)


def g_swipe(c):
    for i, y in enumerate((6, 9.5, 13)): c.line([(3 + i, y), (11 - i, y)], alpha(P['sky-500'], 230), 1.3)
    arrow_tri(c, 13, 9.5, 180, 3.0, P['sky-500']); finger(c, 21, 8, -15, 1.15)


def g_pinch(c):
    finger(c, 10, 9, -30, 1.0); finger(c, 22, 9, 30, 1.0)
    arrow_tri(c, 14, 4, 0, 2.6, P['sky-500']); arrow_tri(c, 18, 4, 180, 2.6, P['sky-500'])


def g_rotate(c):
    c.arc((5, 2, 27, 22), 200, 340, P['sky-500'], 1.6); arrow_tri(c, 25.5, 8.5, 70, 3.0, P['sky-500'])
    finger(c, 10, 10, -25, 0.95); finger(c, 22, 12, 25, 0.95)


def g_ghost(c):
    c.part([(16, 2), (25, 6.5), (16, 11), (7, 6.5)], alpha(P['leaf-300'], 200), ow=1.0, shade=False)
    c.line([(16, 11.5), (16, 14)], alpha(INK, 160), 0.8); finger(c, 16, 14.5, 0, 1.0)


for gid, fn in (('touch.tap', g_tap), ('touch.doubletap', g_double), ('touch.longpress', g_hold), ('touch.drag', g_drag),
                ('touch.swipe', g_swipe), ('touch.pinch', g_pinch), ('touch.rotate', g_rotate), ('touch.ghost', g_ghost),
                ('touch.joystick', lambda c: IC.PAINT['joystick'](c)), ('touch.hotbar', lambda c: IC.PAINT['hotbar'](c))):
    glyph(gid, 'touch')(fn)
ALIASES['touch.hold'] = 'touch.longpress'


# ------------------------------------------------------------------ touch.button.<id> (small disc + icon)
def tbutton(bid):
    src, col = IC.BUTTONS[bid]
    def fn(c):
        c.part(blob(16, 16.6, 14.6, 14.6, wob=0.3, seed=sum(map(ord, bid)) % 97), P['parchment-100'], gloss=False)
        c.paint(c.poly_mask(blob(16, 16.2, 12.4, 12.4)), alpha(lighten(P[col], 0.35), 255))
        im = IC.icon_image(src, int(round(22 * c.S)))
        c.img.alpha_composite(im, (int(5 * c.S), int(5 * c.S)))
    return fn


for bid in IC.BUTTONS:
    glyph(f'touch.button.{bid}', 'touch_buttons')(tbutton(bid))
