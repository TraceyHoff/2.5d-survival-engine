"""Action icons shared by touch glyphs (32px) and the big virtual buttons (any size).
Each painter draws into a 32x32 design box on an Ink canvas. Sources: new painters here, Cozy Camp kit icons, and
the art pack's real item/equipment icons (sword, shield, apple)."""
from __future__ import annotations
import math
from PIL import Image
from uikit.draw import hexc, lighten, darken, alpha, rrect, blob, star, regular, jitter
from uikit.icon import Ink
from uikit import kit
from uikit import placeholders as PH
from .reg import P, INK

PAINT = {}


def painter(name):
    def deco(fn): PAINT[name] = fn; return fn
    return deco


@painter('hand')
def _(c):  # open cozy mitten-hand (interact / use)
    skin = '#FFD2AD'
    for i, (x, h) in enumerate(((9.5, 9), (13.5, 11), (17.5, 11), (21.5, 9))):
        c.part(rrect(x - 2, 15 - h, x + 2, 18, 2, wob=0.15, seed=i), skin, ow=1.3, gloss=False)
    c.part(blob(15.5, 20.5, 8.6, 7.2, wob=0.4, seed=3), skin, ow=1.4)
    c.part(blob(7, 19, 2.6, 4.4, wob=0.2, seed=4, rot=-0.7), skin, ow=1.2, gloss=False)
    for x in (12, 18):
        c.arc((x - 2.2, 22.5, x + 2.2, 25.5), 20, 160, alpha(INK, 160), 0.6)
    for k in range(3):  # sparkle = "interact"
        a = math.radians(-60 + k * 40)
        c.line([(25 + 3 * math.cos(a), 7 + 3 * math.sin(a)), (25 + 5.5 * math.cos(a), 7 + 5.5 * math.sin(a))], P['sun-500'], 1.3)


@painter('jump')
def _(c):
    c.part([(16, 3), (25, 13), (20, 13), (20, 19), (12, 19), (12, 13), (7, 13)], P['sky-500'])
    for x, r in ((9, 2.4), (16, 3.2), (23, 2.4)):
        c.part(blob(x, 26, r * 1.4, r, wob=0.2, seed=int(x)), P['parchment-100'], ow=1.1, gloss=False)


@painter('crouch')
def _(c):
    for y in (9, 17):
        c.part([(6, y), (16, y + 7), (26, y), (26, y + 4), (16, y + 11), (6, y + 4)], P['plum-500'])


@painter('magnet')
def _(c):
    m = c.mask()
    from PIL import ImageDraw
    ImageDraw.Draw(m).arc([c.p(v) for v in (6, 6, 26, 26)], 0, 180, fill=255, width=int(6 * c.S))
    m2 = c.poly_mask([(6, 16), (12, 16), (12, 7), (6, 7)]); m3 = c.poly_mask([(20, 16), (26, 16), (26, 7), (20, 7)])
    from PIL import ImageChops
    body = ImageChops.lighter(ImageChops.lighter(m, m2), m3)
    c.part(body, P['red-500'])
    c.part([(6, 4.5), (12, 4.5), (12, 8), (6, 8)], P['slate-300'], ow=1.2, gloss=False)
    c.part([(20, 4.5), (26, 4.5), (26, 8), (20, 8)], P['slate-300'], ow=1.2, gloss=False)


def _arrow(c, x, y, up=True, col=None, s=1.0):
    col = col or P['leaf-500']; d = -1 if up else 1
    c.part([(x, y + d * 6 * s), (x + 5 * s, y), (x + 2 * s, y), (x + 2 * s, y - d * 5 * s), (x - 2 * s, y - d * 5 * s), (x - 2 * s, y), (x - 5 * s, y)], col, ow=1.2)


def _plank(c, y, col=None):
    c.part(rrect(5, y, 27, y + 6, 1.5, wob=0.2, seed=int(y)), col or P['wood-400'], ow=1.3)
    c.line([(9, y + 3), (23, y + 3)], alpha(darken(P['wood-400'], 0.4), 140), 0.5)


@painter('tier_up')
def _(c): _plank(c, 21); _plank(c, 14, P['wood-300']); _arrow(c, 16, 9, True, P['sun-500'], 0.9)


@painter('tier_down')
def _(c): _plank(c, 7, P['wood-300']); _plank(c, 14); _arrow(c, 16, 25, False, P['slate-500'], 0.9)


@painter('level_up')
def _(c):
    c.part([(4, 27), (4, 21), (11, 21), (11, 15), (18, 15), (18, 9), (25, 9), (25, 27)], P['wood-400'])
    _arrow(c, 10, 9, True, P['sun-500'], 0.85)


@painter('level_down')
def _(c):
    c.part([(4, 27), (4, 9), (11, 9), (11, 15), (18, 15), (18, 21), (25, 21), (25, 27)], P['wood-400'])
    _arrow(c, 22, 9, False, P['slate-500'], 0.85)


@painter('demolish')
def _(c):
    c.part(rrect(5, 8, 27, 27, 2, wob=0.3, seed=7), P['wood-400'])
    c.line([(16, 8), (13, 14), (18, 18), (14, 27)], INK, 1.5)
    c.part(star(24, 8, 6, 2.6, 6, wob=0.2, seed=2), P['pumpkin-500'], ow=1.1, gloss=False)


@painter('upgrade')
def _(c):
    c.part(star(16, 15, 11, 5, 5, wob=0.4, seed=5), P['sun-500'])
    _arrow(c, 16, 26, True, P['leaf-500'], 0.7)


@painter('wrench')
def _(c):
    c.part([(9, 25.5), (6.5, 23), (17, 12.5), (19.5, 15)], P['slate-300'])
    c.part(blob(21, 10.5, 5.6, 5.6, wob=0.2, seed=8), P['slate-300'])
    c.part(blob(23.2, 8.3, 2.3, 2.3), P['parchment-100'], ow=0.9, shade=False)
    c.part(blob(8, 24.5, 1.4, 1.4), P['red-500'], ow=0.8, shade=False)


@painter('drop')
def _(c):
    _arrow(c, 16, 15, False, P['pumpkin-500'], 1.1)
    c.part(blob(16, 26, 11, 2.6, wob=0.3, seed=9), P['leaf-500'], ow=1.2, gloss=False)


@painter('sort')
def _(c):
    for i, w in enumerate((18, 13, 8)):
        c.part(rrect(5, 7 + i * 7, 5 + w, 11 + i * 7, 2), P['sky-500'], ow=1.1, gloss=False)
    _arrow(c, 25, 21, False, P['sun-500'], 0.8)


@painter('takeall')
def _(c):
    k = kit_icon('ic_bag', 26); c.img.alpha_composite(k.resize((int(26 * c.S), int(26 * c.S)), Image.LANCZOS), (int(1 * c.S), int(5 * c.S)))
    _arrow(c, 24, 9, False, P['leaf-500'], 0.75)


@painter('send')
def _(c):
    c.part([(4, 15), (28, 5), (20, 27), (15, 19)], P['parchment-50'])
    c.part([(15, 19), (28, 5), (13, 25)], P['sky-300'], ow=1.1, gloss=False)


@painter('channel')
def _(c):
    c.part(rrect(4, 5, 28, 21, 6, wob=0.3, seed=10), P['parchment-50'])
    c.part([(9, 19), (8, 27), (15, 20)], P['parchment-50'], ow=1.2, gloss=False)
    for i, col in enumerate((P['leaf-500'], P['blue-500'], P['plum-500'])):
        c.part(blob(10 + i * 6, 13, 2.1, 2.1), col, ow=0.9, gloss=False)


@painter('invite')
def _(c):
    c.part(blob(13, 10, 5, 5, wob=0.2, seed=11), '#FFD2AD')
    c.part(rrect(5, 16, 21, 27, 6, wob=0.3, seed=12), P['blue-500'])
    c.part([(23, 13), (26, 13), (26, 17), (30, 17), (30, 20), (26, 20), (26, 24), (23, 24), (23, 20), (19, 20), (19, 17), (23, 17)], P['leaf-500'], ow=1.1)


@painter('kick')
def _(c):
    c.part([(9, 4), (16, 4), (16, 17), (26, 19), (27, 26), (8, 26)], P['wood-500'])
    c.part(rrect(7, 24, 28, 28, 1.5), P['wood-700'], ow=1.1, gloss=False)
    for y in (9, 13): c.line([(10, y), (15, y)], P['parchment-300'], 1.0)


@painter('demote')
def _(c):
    c.part([(6, 9), (16, 17), (26, 9), (26, 14), (16, 22), (6, 14)], P['slate-500'])


@painter('key')
def _(c):
    c.part(blob(10, 12, 6.5, 6.5, wob=0.3, seed=13), P['sun-500'])
    c.part(blob(10, 12, 2.4, 2.4), P['parchment-100'], ow=1.0, shade=False)
    c.part([(14, 15), (27, 26), (24.5, 28.5), (22, 26), (20, 28), (18, 26), (19.5, 24), (12, 17)], P['sun-500'], ow=1.3)


@painter('joystick')
def _(c):
    c.part(blob(16, 20, 12, 7, wob=0.3, seed=14), P['choc-600'])
    c.part(rrect(14, 9, 18, 20, 2), P['slate-300'], ow=1.2, gloss=False)
    c.part(blob(16, 9, 5, 5, wob=0.2, seed=15), P['red-500'])


@painter('hotbar')
def _(c):
    for i in range(8):
        a = math.radians(i * 45 - 90)
        c.part(blob(16 + 10 * math.cos(a), 16 + 10 * math.sin(a), 3.2, 3.2), P['parchment-100'] if i else P['sun-500'], ow=1.1, gloss=False)
    c.part(blob(16, 16, 3, 3), P['wood-500'], ow=1.1, gloss=False)


ART = {'sword': 'sword', 'shield': 'shield', 'apple': 'apple', 'bandage': 'bandage'}


def kit_icon(name, size):
    """Render a Cozy Camp kit sprite at an arbitrary pixel size (supersampled, then LANCZOS)."""
    s = kit.SPRITES[name]
    sc = max(1, math.ceil(size / s['w']))
    im = kit.render(name, sc)
    return im if im.width == size else im.resize((size, int(size * s['h'] / s['w'])), Image.LANCZOS)


def art_icon(key, size):
    im = PH.art_pack_icon(key)
    if im is None: return None
    if size % im.width == 0: return im.resize((size, size), Image.NEAREST)
    return im.resize((size * 2, size * 2), Image.NEAREST).resize((size, size), Image.LANCZOS)


_ICACHE = {}
def icon_image(src, size):
    k = (src, size)
    if k not in _ICACHE: _ICACHE[k] = _icon_image(src, size)
    return _ICACHE[k].copy()

def _icon_image(src, size):
    """src: 'p:<painter>' | 'k:<kit sprite>' | 'a:<art key>' -> RGBA size x size."""
    kind, name = src.split(':', 1)
    if kind == 'k': return kit_icon(name, size)
    if kind == 'a': return art_icon(name, size)
    c = Ink(32, 32, size / 32, ow=1.6)
    PAINT[name](c)
    return c.out()


# touch.button.<id> -> icon source + button colour (shared by glyphs and virtual buttons)
BUTTONS = {
    'attack': ('a:sword', 'berry-500'), 'secondary': ('a:shield', 'blue-500'), 'context': ('p:hand', 'sun-500'),
    'jump': ('p:jump', 'sky-500'), 'sprint': ('k:vital_stamina', 'pumpkin-500'), 'crouch': ('p:crouch', 'plum-300'),
    'reload': ('k:ic_rotate', 'slate-300'), 'quickuse': ('a:apple', 'rose-300'),
    'inventory': ('k:ic_bag', 'wood-300'), 'crafting': ('k:ic_craft', 'wood-300'), 'map': ('k:ic_map', 'wood-300'),
    'chat': ('k:ic_chat', 'wood-300'), 'social': ('k:ic_players', 'wood-300'), 'build': ('k:ic_hammer', 'wood-300'),
    'back': ('k:ic_arrow_left', 'wood-300'),
    'confirm': ('k:ic_check', 'leaf-500'), 'cancel': ('k:ic_cross', 'red-500'), 'rotate': ('k:ic_rotate', 'sky-500'),
    'tierup': ('p:tier_up', 'slate-300'), 'tierdown': ('p:tier_down', 'slate-300'), 'snap': ('p:magnet', 'slate-300'),
    'levelup': ('p:level_up', 'slate-300'), 'leveldown': ('p:level_down', 'slate-300'),
    'demolish': ('p:demolish', 'red-300'), 'upgrade': ('p:upgrade', 'sun-300'), 'repair': ('p:wrench', 'leaf-300'),
    'drop': ('p:drop', 'pumpkin-300'), 'equip': ('k:eq_chest', 'blue-300'), 'use': ('p:hand', 'leaf-300'),
    'takeall': ('p:takeall', 'leaf-300'), 'sort': ('p:sort', 'sky-300'), 'craft': ('k:ic_craft', 'leaf-500'),
    'craftmore': ('k:ic_plus', 'leaf-300'), 'cancelcraft': ('k:ic_cross', 'red-300'), 'lock': ('k:ic_lock', 'sun-300'),
    'send': ('p:send', 'sky-500'), 'channel': ('p:channel', 'sky-300'), 'invite': ('p:invite', 'leaf-300'),
    'kick': ('p:kick', 'red-300'), 'promote': ('k:ic_crown', 'sun-300'), 'demote': ('p:demote', 'slate-300'),
    'leave': ('k:ic_door', 'red-300'), 'perms': ('p:key', 'sun-300'), 'yes': ('k:ic_check', 'leaf-500'), 'no': ('k:ic_cross', 'red-500'),
}
# the 26 on-screen virtual controls in packages/input/profiles/touchLayout.json
VIRTUAL = ['attack', 'secondary', 'context', 'jump', 'sprint', 'crouch', 'reload', 'quickuse', 'inventory', 'crafting', 'map', 'chat',
           'social', 'build', 'back', 'confirm', 'cancel', 'rotate', 'tierup', 'tierdown', 'snap', 'levelup', 'leveldown', 'demolish', 'upgrade', 'repair']
