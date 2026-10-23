"""Survival-hook art (DESIGN §11 death bags / respawn / gate breach, §14 touch context + ghost, §15 craft queue).
Two registries: HOOKS_UI (UI/touch skins, atlas ui_hooks) and HOOKS_FX (world sprites + vfx frames, grid atlases)."""
from __future__ import annotations
import math, random
from PIL import Image, ImageChops, ImageFilter
from uikit.draw import hexc, lighten, darken, alpha, mix, rrect, blob, star, heart, regular
from uikit.icon import Ink
from inputkit.reg import P, INK
from inputkit import icons as IC, touchkit as TK

UI, FX = {}, {}
def reg(R, name, w, h, nine=None, pivot=(0.5, 0.5), tags=(), meta=None):
    def deco(fn): R[name] = dict(name=name, w=w, h=h, nine=nine, pivot=pivot, tags=list(tags), meta=meta or {}, fn=fn); return fn
    return deco
def ink(w, h, sc, ow=1.6): return Ink(w, h, sc, ow=ow)

# ------------------------------------------------------------ extra painters (32 design box)
@IC.painter('chest')
def _(c):
    c.part(rrect(5, 13, 27, 27, 2.5), P['wood-400']); c.part(rrect(5, 7, 27, 15, 4), P['wood-300'])
    c.part(rrect(14, 12, 18, 18, 1), P['sun-500'], ow=1.1)
@IC.painter('coin')
def _(c):
    c.part(blob(17, 18, 10, 10), P['sun-700'], gloss=False); c.part(blob(16, 16, 10, 10), P['sun-500'])
    c.part(rrect(14.5, 10.5, 17.5, 21.5, 1.2), P['sun-300'], ow=1.0, shade=False)
@IC.painter('pickberry')
def _(c):
    for i, (x, y) in enumerate([(12, 18), (20, 17), (16, 24)]): c.part(blob(x, y, 5, 5, seed=i), P['berry-500'])
    c.part([(13, 11), (18, 4), (22, 6), (17, 12)], P['leaf-500'], ow=1.1)
@IC.painter('talk')
def _(c):
    c.part(blob(16, 14, 12, 9.5) + [], P['parchment-50'])
    c.part([(9, 20), (8, 28), (16, 21)], P['parchment-50'], shade=False)
    for x in (11, 16, 21): c.ellipse((x - 1.6, 12.4, x + 1.6, 15.6), hexc(INK))
@IC.painter('hanger')
def _(c):
    c.arc((13, 3, 19, 10), 180, 420, hexc(INK), 1.6)
    c.part([(16, 10), (28, 22), (27, 25), (5, 25), (4, 22)], P['sky-300'])
@IC.painter('flame')
def _(c):
    c.part(blob(16, 20, 9, 9) + [(16, 3)], P['fire-500']); c.part(blob(16, 22, 5, 5) + [(16, 12)], P['sun-500'], ow=0)
@IC.painter('bag')
def _(c):
    c.part(blob(16, 20, 11, 9, seed=3), P['wood-300']); c.part([(11, 12), (21, 12), (19, 8), (13, 8)], P['wood-400'], ow=1.2)
    c.line([(10, 12.5), (22, 12.5)], hexc(P['red-500']), 1.6)

# verb -> (icon source, button colour, label). Verbs = what contextCommandFor resolves to (open/gather/door/fire/attack) plus
# the node/target flavours the HUD distinguishes (gather -> chop/mine/pick by ResourceNode kind) and the remaining interactables.
CTX = {
    'interact': ('p:hand', 'sun-500', 'Use'), 'open': ('p:chest', 'sun-500', 'Open'), 'loot': ('p:bag', 'sun-500', 'Loot'),
    'gather': ('p:hand', 'leaf-500', 'Gather'), 'chop': ('a:stone_axe', 'leaf-500', 'Chop'), 'mine': ('a:stone_pickaxe', 'slate-300', 'Mine'),
    'pick': ('p:pickberry', 'leaf-300', 'Pick'), 'dig': ('a:stone_shovel', 'wood-300', 'Dig'),
    'door': ('k:ic_door', 'wood-300', 'Door'), 'fire': ('p:flame', 'pumpkin-500', 'Fire'), 'attack': ('a:sword', 'berry-500', 'Attack'),
    'talk': ('p:talk', 'sky-500', 'Talk'), 'buy': ('p:coin', 'sun-300', 'Buy'), 'build': ('k:ic_hammer', 'wood-300', 'Build'),
    'repair': ('p:wrench', 'leaf-300', 'Repair'), 'craft': ('k:ic_workbench', 'wood-300', 'Craft'), 'dress': ('p:hanger', 'sky-300', 'Change look'),
    'sleep': ('k:ic_moon', 'plum-300', 'Rest'), 'none': ('p:hand', 'slate-300', ''),
}
for v, (src, col, _l) in CTX.items():
    IC.BUTTONS[f'ctx_{v}'] = (src, col)
    for st in TK.STATES:
        reg(UI, f'vb_ctx_{v}_{st}', TK.BTN_D, TK.BTN_D, tags=['virtual_button', 'context', v, st], meta={"verb": v, "state": st, "faceRadius": 41})(TK.round_button(f'ctx_{v}', st))
    reg(UI, f'ctxi_{v}', 32, 32, tags=['context_icon', v])((lambda s: lambda sc: IC.icon_image(s, 32 * sc))(src))

# 48dp hit-target debug/overlay ring + tap pulse sized to the min target
@reg(UI, 'hit48', 48, 48, tags=['touch', 'debug'], meta={"dp": 48})
def _(sc):
    c = ink(48, 48, sc); c.arc((1, 1, 47, 47), 0, 360, alpha(P['sky-500'], 200), 1.4)
    for a in range(0, 360, 30): c.arc((1, 1, 47, 47), a, a + 12, alpha(P['white'], 230), 1.4)
    return c.out()

# ------------------------------------------------------------ placement ghost pointer (finger -> ghost)
@reg(UI, 'ghost_finger', 64, 64, tags=['ghost'])
def _(sc):
    c = ink(64, 64, sc); c.paint(c.ellipse_mask((6, 6, 58, 58)), alpha(P['white'], 50))
    c.arc((6, 6, 58, 58), 0, 360, alpha(P['white'], 220), 2.4); c.arc((8, 8, 56, 56), 0, 360, alpha(P['ink'], 120), 1.0)
    return c.out()
@reg(UI, 'ghost_dot', 16, 16, tags=['ghost'])
def _(sc):
    c = ink(16, 16, sc, ow=1.2); c.part(blob(8, 8, 3.6, 3.6), P['white'], shade=False); return c.out()
@reg(UI, 'ghost_seg', 16, 8, tags=['ghost', 'tile_x'], meta={"repeat": "x", "spacingPx": 16})
def _(sc):
    c = ink(16, 8, sc, ow=1.0); c.part(rrect(2, 2.5, 11, 5.5, 1.5), P['white'], shade=False); return c.out()
@reg(UI, 'ghost_reticle_ok', 72, 40, pivot=(0.5, 0.5), tags=['ghost'])
def _(sc): return reticle(sc, P['leaf-300'])
@reg(UI, 'ghost_reticle_bad', 72, 40, pivot=(0.5, 0.5), tags=['ghost'])
def _(sc): return reticle(sc, P['red-300'])
def reticle(sc, col):
    c = ink(72, 40, sc); d = [(36, 4), (68, 20), (36, 36), (4, 20)]
    for i in range(4):
        a, b = d[i], d[(i + 1) % 4]
        for t0 in (0.0, 0.62):
            p0 = (a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0); p1 = (a[0] + (b[0] - a[0]) * (t0 + .38), a[1] + (b[1] - a[1]) * (t0 + .38))
            c.line([p0, p1], hexc(INK), 4.2); c.line([p0, p1], hexc(col), 2.4)
    return c.out()

# ------------------------------------------------------------ craft queue: ring track + 24-step fill, slot frames, cancel/pause pips
RING_STEPS = 24
def ring(sc, k=None, col=None, track=False):
    c = ink(56, 56, sc)
    if track:
        c.arc((4, 4, 52, 52), 0, 360, hexc(INK), 7.5); c.arc((4, 4, 52, 52), 0, 360, hexc(P['parchment-300']), 4.6)
    else:
        e = -90 + 360 * (k + 1) / RING_STEPS
        c.arc((4, 4, 52, 52), -90, e, hexc(col), 4.6)
        c.arc((4.6, 4.6, 51.4, 51.4), -90, e, alpha(P['white'], 110), 1.2)
        a = math.radians(e); x, y = 28 + 24 * math.cos(a), 28 + 24 * math.sin(a)
        c.part(blob(x, y, 3.4, 3.4), lighten(hexc(col), .3), ow=1.1, shade=False)
    return c.out()
reg(UI, 'cq_ring_track', 56, 56, tags=['craft_queue', 'ring'])(lambda sc: ring(sc, track=True))
for k in range(RING_STEPS):
    reg(UI, f'cq_ring_{k:02d}', 56, 56, tags=['craft_queue', 'ring'], meta={"progress": round((k + 1) / RING_STEPS, 4)})((lambda kk: lambda sc: ring(sc, kk, P['leaf-500']))(k))
    reg(UI, f'cq_ring_paused_{k:02d}', 56, 56, tags=['craft_queue', 'ring', 'paused'], meta={"progress": round((k + 1) / RING_STEPS, 4)})((lambda kk: lambda sc: ring(sc, kk, P['sun-500']))(k))
def slot(sc, st):
    c = ink(64, 64, sc, ow=2.0)
    fill = {'empty': P['parchment-300'], 'active': P['parchment-50'], 'queued': P['parchment-100'], 'paused': P['parchment-100'], 'done': P['leaf-300']}[st]
    c.part(rrect(3, 4, 61, 62, 12), darken(hexc(fill), .25), gloss=False, shade=False)
    c.part(rrect(3, 2, 61, 59, 12), fill, gloss=False)
    if st == 'empty':
        for x0 in range(12, 52, 8): c.line([(x0, 31), (x0 + 4, 31)], alpha(P['wood-400'], 160), 1.4)
    if st == 'active': c.arc((1, 0, 63, 61), 0, 360, alpha(P['sun-500'], 230), 2.0)
    return c.out()
for st in ('empty', 'queued', 'active', 'paused', 'done'):
    reg(UI, f'cq_slot_{st}', 64, 64, nine=(14, 14, 14, 14), tags=['craft_queue', 'slot', st])((lambda s: lambda sc: slot(sc, s))(st))
@reg(UI, 'cq_cancel', 24, 24, tags=['craft_queue', 'button'], meta={"hitDp": 48})
def _(sc):
    c = ink(24, 24, sc, ow=1.4); c.part(blob(12, 12, 9.5, 9.5), P['red-500'])
    c.line([(8, 8), (16, 16)], hexc(P['white']), 2.4); c.line([(16, 8), (8, 16)], hexc(P['white']), 2.4); return c.out()
@reg(UI, 'cq_pause', 24, 24, tags=['craft_queue', 'badge'])
def _(sc):
    c = ink(24, 24, sc, ow=1.4); c.part(blob(12, 12, 9.5, 9.5), P['sun-500'])
    c.part(rrect(8, 7, 11, 17, 1), P['white'], ow=0, shade=False); c.part(rrect(13, 7, 16, 17, 1), P['white'], ow=0, shade=False); return c.out()
@reg(UI, 'cq_refund', 32, 32, tags=['craft_queue', 'icon'])
def _(sc):
    c = ink(32, 32, sc); c.arc((6, 6, 26, 26), 200, 470, hexc(INK), 5); c.arc((6, 6, 26, 26), 200, 470, hexc(P['leaf-500']), 3)
    c.part([(4, 13), (11, 13), (7.5, 19)], P['leaf-500'], ow=1.2, shade=False); return c.out()

# ------------------------------------------------------------ event icons + banners
@reg(UI, 'ic_deathbag', 32, 32, tags=['event'])
def _(sc):
    c = ink(32, 32, sc); IC.PAINT['bag'](c); c.part(heart(16, 21, 4.2), P['rose-300'], ow=1.0, shade=False); return c.out()
@reg(UI, 'ic_deathbag_locked', 32, 32, tags=['event'])
def _(sc):
    c = ink(32, 32, sc); IC.PAINT['bag'](c)
    c.part(rrect(17, 18, 29, 28, 2), P['sun-500'], ow=1.2); c.arc((19.5, 12.5, 26.5, 22), 180, 360, hexc(INK), 1.8); return c.out()
@reg(UI, 'ic_respawn', 32, 32, tags=['event'])
def _(sc):
    c = ink(32, 32, sc)
    for i, (x, y, r) in enumerate([(10, 20, 7), (22, 20, 7), (16, 14, 8)]): c.part(blob(x, y, r, r * .9, seed=i), P['parchment-50'])
    c.part(heart(16, 18, 5), P['rose-500'], ow=1.0); return c.out()
@reg(UI, 'ic_gate_breach', 32, 32, tags=['event'])
def _(sc):
    c = ink(32, 32, sc)
    c.part(rrect(4, 8, 14, 28, 2), P['wood-400']); c.part([(18, 8), (28, 8), (28, 28), (20, 28), (23, 20), (18, 17)], P['wood-400'])
    c.part(star(16, 15, 6, 2.6, n=6), P['sun-500'], ow=1.1); return c.out()
def banner(sc, col):
    c = ink(96, 40, sc, ow=2.0)
    c.part(rrect(2, 4, 94, 38, 10), darken(hexc(col), .3), gloss=False, shade=False); c.part(rrect(2, 2, 94, 35, 10), col, gloss=False)
    c.shine(20, 9, 9, 2.5, 150); return c.out()
reg(UI, 'banner_breach', 96, 40, nine=(20, 18, 20, 18), tags=['banner'])(lambda sc: banner(sc, P['red-500']))
reg(UI, 'banner_breach_win', 96, 40, nine=(20, 18, 20, 18), tags=['banner'])(lambda sc: banner(sc, P['sun-500']))
reg(UI, 'banner_respawn', 96, 40, nine=(20, 18, 20, 18), tags=['banner'])(lambda sc: banner(sc, P['leaf-500']))

# ============================================================ world FX (frame strips)
def poof_frame(sc, i, n=10):
    """cute cloud poof: puffs expand + fade, hearts/stars pop out, central sparkle flash"""
    c = ink(96, 96, sc, ow=1.4); t = i / (n - 1); rnd = random.Random(4)
    fade = 1.0 if t < .6 else max(0.0, 1 - (t - .6) / .4)
    if t < .35:  # flash
        r = 10 + 40 * t; c.paint(c.ellipse_mask((48 - r, 60 - r * .6, 48 + r, 60 + r * .6)), alpha(P['white'], int(200 * (1 - t / .35))))
    for k in range(9):
        a = k / 9 * math.tau + .3; d = 6 + 26 * (1 - (1 - t) ** 2); rr = (7 + 4 * rnd.random()) * (0.6 + 0.8 * min(1, t * 3)) * (1 - .45 * max(0, t - .6) / .4)
        x, y = 48 + math.cos(a) * d, 64 + math.sin(a) * d * .45 - 10 * t
        if fade > .05 and rr > 1:
            m = c.part(blob(x, y, rr, rr * .9, wob=.2, seed=k), mix(hexc(P['parchment-50']), hexc(P['sky-300']), .15 * k / 9), ow=1.4 * fade)
    for k, shape in enumerate(['h', 's', 'h', 's', 'h']):
        if t < .15: continue
        a = -math.pi / 2 + (k - 2) * .55; d = 12 + 38 * (t - .15); x, y = 48 + math.cos(a) * d, 56 + math.sin(a) * d
        s = 4.2 * (1 if t < .8 else (1 - t) / .2 + .01)
        if s < .6: continue
        if shape == 'h': c.part(heart(x, y, s), P['rose-500'], ow=1.1, shade=False)
        else: c.part(star(x, y, s * 1.2, s * .5, n=4), P['sun-500'], ow=1.1, shade=False)
    im = c.out()
    if fade < 1: im.putalpha(im.getchannel('A').point(lambda v: int(v * fade)))
    return im
for i in range(10): reg(FX, f'fx_respawn_poof_{i}', 96, 96, pivot=(0.5, 0.667), tags=['fx_respawn_poof'])((lambda k: lambda sc: poof_frame(sc, k))(i))

def bag_body(c, dy=0.0, sq=1.0, locked=False, glow=0.0):
    w, h = 13 * (2 - sq), 11 * sq; cy = 38 - h + dy
    if glow: c.paint(c.ellipse_mask((24 - 18, cy - 4, 24 + 18, cy + h + 14)), alpha(P['sun-300'], int(90 * glow)))
    c.part(blob(24, cy + h * .35, w, h, wob=.12, seed=3), P['wood-300'])
    c.part([(24 - w * .45, cy - h * .45), (24 + w * .45, cy - h * .45), (24 + w * .3, cy - h * .9), (24 - w * .3, cy - h * .9)], P['wood-400'], ow=1.2)
    c.line([(24 - w * .55, cy - h * .45), (24 + w * .55, cy - h * .45)], hexc(P['red-500']), 1.8)
    c.part(heart(24, cy + h * .45, 3.6), P['rose-300'], ow=1.0, shade=False)
    if locked:
        c.part(rrect(30, cy + 1, 40, cy + 9, 2), P['sun-500'], ow=1.1); c.arc((32, cy - 4, 38, cy + 4), 180, 360, hexc(INK), 1.6)
def bag_sprite(sc, i, locked):
    c = ink(48, 48, sc, ow=1.4); c.paint(c.ellipse_mask((12, 37, 36, 44)), alpha(P['plum-700'], 70))
    bag_body(c, dy=-1.2 * math.sin(i / 4 * math.tau), locked=locked, glow=(.5 + .5 * math.sin(i / 4 * math.tau)) if locked else 0); return c.out()
for i in range(4):
    reg(FX, f'death_bag_open_{i}', 48, 48, pivot=(0.5, 0.85), tags=['death_bag'])((lambda k: lambda sc: bag_sprite(sc, k, False))(i))
    reg(FX, f'death_bag_locked_{i}', 48, 48, pivot=(0.5, 0.85), tags=['death_bag'])((lambda k: lambda sc: bag_sprite(sc, k, True))(i))
def drop_frame(sc, i):
    """bag falls in, squashes, ghost-heart floats up, dust ring"""
    c = ink(64, 64, sc, ow=1.4); W = Ink
    fall = [-30, -16, -4, 0, 0, 0, 0, 0][i]; sq = [1, 1.1, 1.0, .7, 1.15, .95, 1, 1][i]
    if i >= 3:
        t = (i - 3) / 4
        for k in range(6):
            a = k / 6 * math.tau; d = 10 + 14 * t; r = 4 * (1 - t) + .5
            c.part(blob(32 + math.cos(a) * d, 50 + math.sin(a) * d * .4, r, r * .8, seed=k), P['parchment-200'], ow=1.0 * (1 - t))
        c.part(heart(32, 22 - 16 * t, 4 * (1 - t * .6)), alpha(P['rose-300'], int(255 * (1 - t))), ow=1.0 * (1 - t), shade=False)
    c.paint(c.ellipse_mask((20, 47, 44, 54)), alpha(P['plum-700'], 70 if i >= 2 else 30))
    cc = ink(48, 48, sc, ow=1.4); bag_body(cc, dy=fall, sq=sq); im = c.out(); im.alpha_composite(cc.out(), (8 * sc, 12 * sc)); return im
for i in range(8): reg(FX, f'fx_deathbag_drop_{i}', 64, 64, pivot=(0.5, 0.8), tags=['fx_deathbag_drop'])((lambda k: lambda sc: drop_frame(sc, k))(i))

def breach_frame(sc, i, n=10):
    """gate burst: red-gold flash + shockwave diamond (iso), flying planks/splinters, dust, little stars"""
    c = ink(128, 128, sc, ow=1.5); t = i / (n - 1); rnd = random.Random(9)
    if t < .5:
        r = 14 + 60 * t; c.paint(c.ellipse_mask((64 - r, 92 - r * .5, 64 + r, 92 + r * .5)), alpha(P['sun-300'], int(170 * (1 - t / .5))))
    ws = 10 + 50 * t
    if t > .05:
        dmd = [(64, 92 - ws * .5), (64 + ws, 92), (64, 92 + ws * .5), (64 - ws, 92)]
        c.line(dmd + [dmd[0]], alpha(P['red-500'], int(230 * (1 - t))), 3.2 * (1 - t) + .4)
    for k in range(7):
        a = -math.pi * (.1 + .8 * k / 6); v = 30 + 25 * rnd.random(); x = 64 + math.cos(a) * v * t; y = 80 + math.sin(a) * v * t + 70 * t * t
        ang = rnd.random() * 3 + t * 6 * (1 if k % 2 else -1); L = 9 if k % 3 else 13
        pts = [(x + math.cos(ang) * L - math.sin(ang) * 2.4, y + math.sin(ang) * L + math.cos(ang) * 2.4), (x + math.cos(ang) * L + math.sin(ang) * 2.4, y + math.sin(ang) * L - math.cos(ang) * 2.4),
               (x - math.cos(ang) * L + math.sin(ang) * 2.4, y - math.sin(ang) * L - math.cos(ang) * 2.4), (x - math.cos(ang) * L - math.sin(ang) * 2.4, y - math.sin(ang) * L + math.cos(ang) * 2.4)]
        if t < .95: c.part(pts, P['wood-300'] if k % 2 else P['wood-400'], ow=1.3)
    for k in range(8):
        a = k / 8 * math.tau; d = 8 + 34 * t; r = (6 + 3 * (k % 3)) * (1 - .7 * t)
        if t > .1: c.part(blob(64 + math.cos(a) * d, 92 + math.sin(a) * d * .45 - 8 * t, r, r * .8, seed=k), P['parchment-300'], ow=1.2 * (1 - t))
    if .1 < t < .8:
        for k in range(3):
            a = -math.pi / 2 + (k - 1) * .9; d = 20 + 30 * t
            c.part(star(64 + math.cos(a) * d, 60 + math.sin(a) * d * .7, 5, 2, n=5), P['sun-500'], ow=1.1, shade=False)
    return c.out()
for i in range(10): reg(FX, f'fx_gate_breach_{i}', 128, 128, pivot=(0.5, 0.72), tags=['fx_gate_breach'])((lambda k: lambda sc: breach_frame(sc, k))(i))
for i in range(4):
    @reg(FX, f'fx_splinter_{i}', 16, 16, tags=['fx_splinter'])
    def _(sc, i=i):
        c = ink(16, 16, sc, ow=1.0); a = i * math.pi / 4
        c.part([(8 + math.cos(a) * 6 - math.sin(a) * 1.6, 8 + math.sin(a) * 6 + math.cos(a) * 1.6), (8 + math.cos(a) * 6 + math.sin(a) * 1.6, 8 + math.sin(a) * 6 - math.cos(a) * 1.6),
                (8 - math.cos(a) * 6 + math.sin(a) * 1.6, 8 - math.sin(a) * 6 - math.cos(a) * 1.6), (8 - math.cos(a) * 6 - math.sin(a) * 1.6, 8 - math.sin(a) * 6 + math.cos(a) * 1.6)], P['wood-300'])
        return c.out()
    @reg(FX, f'fx_puff_{i}', 24, 24, tags=['fx_puff'])
    def _(sc, i=i):
        c = ink(24, 24, sc, ow=1.1); r = 8 - i * 1.5
        c.part(blob(12, 12, r, r * .9, wob=.2, seed=i), P['parchment-50']); im = c.out()
        im.putalpha(im.getchannel('A').point(lambda v: int(v * (1 - i * .2)))); return im
