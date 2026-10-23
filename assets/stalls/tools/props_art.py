"""Props, world prompts, coin icons (cute, SS=4)."""
import sys, os, math, json
sys.path.insert(0, "/workspace/assets/pvp_clan/tools"); sys.path.insert(0, os.path.dirname(__file__))
import numpy as np
from PIL import Image
from stall_art import StallSheet, SAT, ROOT, Rr, CREAM, shade_ramp
from common import *
from stall_art import ROOT
from buildings_clan import RP, INKC
from toon import capsule_pts
from fx_combat import star

def C(w=64, h=64, seed=3):
    c = Canvas(w, h, seed=seed); c.tm = Canvas(w, h, seed=seed); c.em = Canvas(w, h, seed=seed); c.sw = Canvas(w, h, seed=seed); return c
def out(c): return c.img, c.tm.img, c.em.img, c.sw.img
def T(c, pts, ch): mask_paint(c.tm, [pts], 255, ch, 0.35)
def S(c, pts, v=255): mask_paint(c.sw, [pts], v, 0, 0.6)
GOLD = RP("gold"); WOOD = RP("wood"); LWOOD = [lerp(x, (255, 250, 240), 0.35) for x in RP("wood")]

def coin_disc(c, cx, cy, r, ry=None, tilt=0.0):
    ry = ry or r
    c.part(circle(cx, cy + 1.2, r, 30, ry), shade_ramp(GOLD, 0.25), lw=0.8, shade=0.2)       # rim/edge
    c.part(circle(cx, cy, r, 30, ry), GOLD, lw=0.8, shade=0.22, hl=0.18, gloss=[(cx - r * 0.4, cy - ry * 0.4, r * 0.18, ry * 0.12)])
    c.part(circle(cx, cy, r * 0.62, 24, ry * 0.62), GOLD, lw=0.4, shade=0.0, hl=0.0, flat=True, ink=GOLD[3])
    # tiny cute star stamp
    c.fill(rstar(cx, cy, r * 0.36, r * 0.17, 5, -math.pi / 2, p=1.2, sq=ry / r), GOLD[2])

def coin_icon(n):
    c = C(32, 32, 5)
    if n == 1: coin_disc(c, 16, 15, 10)
    elif n == 2:
        for (x, y, r) in ((11, 20, 7), (20, 21, 7), (15, 13, 8)): coin_disc(c, x, y, r, r * 0.95)
    else:
        for k in range(5): coin_disc(c, 16 + (k % 2) * 1.5 - 0.7, 25 - k * 3.2, 9, 4.2)   # stack
        coin_disc(c, 7, 24, 5.5, 5.2); coin_disc(c, 26, 23, 5.5, 5.2)
    c.part(sparkle(25, 6, 3.5), [(255, 255, 255)] * 4, lw=0.5, shade=0, hl=0) if n > 1 else None
    return out(c)

def price_tag(blank=True):
    c = C(48, 32)
    # same 18x8 board the stalls used to bake: face x 15..33, y 15..23 (centre 24,19); hole at x 17.2
    c.line([(24, 11), (24.5, 15)], H(RAMPS["leather"][2]), 0.6)
    c.part(rrect(15, 15, 33, 23, 1.6), CREAM, lw=0.6, shade=0.18, hl=0.0); c.fill(circle(17.2, 19, 0.7, 8), H(RAMPS["leather"][2]))
    return out(c)

def sign_board(shape):
    c = C(96, 48)
    if shape == 0:   # plank hanging on two chains
        for x in (18, 78): c.line([(x, 2), (x, 12)], H(RAMPS["iron"][2]), 1.2)
        b = rrect(6, 10, 90, 40, 5); c.part(b, WOOD, lw=1.0, shade=0.22, hl=0.2)
        i = rrect(12, 15, 84, 35, 3); c.part(i, NEUTRAL, lw=0.6, shade=0.12, hl=0.0); T(c, i, 0); S(c, b, 120)
    elif shape == 1:  # scroll banner
        b = [(10, 14), (86, 14), (80, 26), (86, 38), (10, 38), (16, 26)]; c.part(b, NEUTRAL, lw=1.0, shade=0.2, hl=0.12); T(c, b, 0)
        i = rrect(20, 18, 76, 34, 2); c.part(i, LWOOD, lw=0.5, shade=0.08); S(c, b, 200)
    else:  # A-frame chalk sandwich board
        c.part([(16, 46), (30, 6), (66, 6), (80, 46), (74, 46), (62, 12), (34, 12), (22, 46)], WOOD, lw=0.9)
        b = rrect(22, 8, 74, 40, 3); c.part(b, WOOD, lw=1.0, shade=0.2, hl=0.15); i = rrect(26, 12, 70, 36, 2)
        c.part(i, NEUTRAL, lw=0.5, shade=0.1); T(c, i, 0)
    return out(c)

def pouch():
    c = C(48, 48); c.shadow(24, 42, 13, 3.5)
    b = wobbly(24, 30, 14, 12, seed=4, wob=0.06); c.part(b, RP("leather"), lw=1.0, shade=0.25, hl=0.15)
    c.part([(16, 18), (32, 18), (36, 12), (24, 15), (12, 12)], RP("leather"), lw=0.8, shade=0.2)
    c.line([(15, 19), (33, 19)], H(RAMPS["cloth_red"][1]), 1.6)
    coin_disc(c, 37, 38, 5, 4.6); coin_disc(c, 31, 41, 4.5, 4.2)
    c.fill(rstar(24, 31, 4.5, 2.2, 5), H(RAMPS["leather"][0]))
    return out(c)

def scale(tilt=0.0):
    c = C(64, 64); c.shadow(32, 58, 12, 3)
    c.part(rrect(22, 52, 42, 58, 2), RP("wood_dark"), lw=0.8)
    c.part(capsule_pts(32, 52, 32, 16, 1.6), RP("gold"), lw=0.6)
    a, b = (12, 18 + tilt * 6), (52, 18 - tilt * 6)
    c.part(capsule_pts(a[0], a[1], b[0], b[1], 1.3), RP("gold"), lw=0.6)
    for (x, y) in (a, b):
        c.line([(x, y), (x - 7, y + 14)], H(RAMPS["iron"][2]), 0.5); c.line([(x, y), (x + 7, y + 14)], H(RAMPS["iron"][2]), 0.5)
        c.part(circle(x, y + 15, 9, 24, 3), RP("gold"), lw=0.7, shade=0.25, hl=0.2)
    c.part(circle(32, 15, 3, 14), RP("gold"), lw=0.6, hl=0.3)
    c.part(rstar(32, 15, 1.6, 0.7, 4), [(255, 255, 255)] * 4, outline=False)
    return out(c)

def display_slot():
    c = C(48, 32); q = [(24, 8), (44, 18), (24, 28), (4, 18)]
    c.part(q, CREAM, lw=0.9, shade=0.15, hl=0.15)
    c.part([(24, 12), (36, 18), (24, 24), (12, 18)], RP("cloth_red"), lw=0.4, shade=0.1, flat=True)
    return out(c)

def lantern(lit=True, k=0):
    c = C(32, 64); sw = math.sin(k / 4 * 2 * math.pi) * 1.2
    c.line([(16, 2), (16 + sw * 0.3, 12)], H(RAMPS["iron"][3]), 0.9)
    cx = 16 + sw
    c.part(rrect(cx - 7, 12, cx + 7, 17, 2), RP("iron"), lw=0.6)
    body = [(cx - 8, 18), (cx + 8, 18), (cx + 9, 40), (cx - 9, 40)]
    glass = RP("fire") if lit else RP("glass")
    if lit: c.part(circle(cx, 30, 14, 30), [(255, 230, 150)] * 4, outline=False, flat=True)  # (not used as emissive halo: renderer blooms)
    c.img = Image.new("RGBA", c.img.size, (0, 0, 0, 0)) if lit else c.img
    c.line([(16, 2), (16 + sw * 0.3, 12)], H(RAMPS["iron"][3]), 0.9); c.part(rrect(cx - 7, 12, cx + 7, 17, 2), RP("iron"), lw=0.6)
    c.part(body, glass, lw=0.9, shade=0.2, hl=0.25, gloss=[(cx - 4, 24, 1.4, 4)])
    if lit:
        fl = wobbly(cx, 31, 3.2, 5, seed=k + 2); c.part(fl, [(255, 255, 230)] * 4, outline=False, flat=True)
        c.em.fill(body, H(RAMPS["fire"][1])); c.em.fill(fl, (255, 252, 220))
    for x in (cx - 8.5, cx + 8.5): c.part(capsule_pts(x, 18, x, 40, 0.9), RP("iron"), lw=0.4)
    c.part(rrect(cx - 9, 39, cx + 9, 44, 2), RP("iron"), lw=0.6)
    c.part(circle(cx, 47, 2.5, 12), RP("cloth_red"), lw=0.5); S(c, [(0, 10), (32, 10), (32, 60), (0, 60)], 255)
    return out(c)

def bell(k=0, n=6):
    c = C(48, 64); ang = math.sin(k / n * 2 * math.pi) * 0.5 if k else 0
    c.part(rrect(6, 6, 42, 11, 2.5), RP("wood"), lw=0.8)                       # bracket
    c.part(capsule_pts(24, 8, 24, 16, 1.2), RP("iron"), lw=0.5)
    hp = (24, 16)
    pts = [(hp[0] - 3, hp[1])] + [(hp[0] - 3 - 9 * t ** 1.4, hp[1] + 20 * t) for t in np.linspace(0, 1, 12)] + [(hp[0] + 3 + 9 * t ** 1.4, hp[1] + 20 * t) for t in np.linspace(1, 0, 12)]
    pts = rot_pts(pts, ang, *hp); cl = rot_pts([(24, 39)], ang * 1.5, *hp)[0]
    c.part(circle(cl[0], cl[1], 2.6, 12), RP("iron"), lw=0.6)
    c.part(pts, RP("gold"), lw=1.0, shade=0.25, hl=0.25, gloss=[(hp[0] - 4, hp[1] + 8, 1.5, 3)])
    # cute face
    f = rot_pts([(20.5, 27), (27.5, 27), (24, 30.5)], ang, *hp)
    for e in f[:2]: c.fill(circle(e[0], e[1], 1.1, 10), INKC)
    c.line([(f[2][0] - 1.6, f[2][1] - 0.4), (f[2][0], f[2][1] + 0.8), (f[2][0] + 1.6, f[2][1] - 0.4)], INKC, 0.7)
    for e in f[:2]: c.fill(circle(e[0] + (-2 if e is f[0] else 2), e[1] + 2.2, 1.5, 10, 0.9), H(RAMPS["berry"][0]), alpha=180)
    c.part(rot_pts(rrect(10.5, 34.5, 37.5, 37.5, 1.5), ang, *hp), RP("gold"), lw=0.7, shade=0.2)
    if k in (1, 2, 4, 5):
        side = 1 if k in (1, 2) else -1
        for j in range(3):
            a = -0.7 + j * 0.7; r0, r1 = 15 + (k % 3), 20 + (k % 3)
            c.line([(24 + side * math.cos(a) * r0, 26 + math.sin(a) * r0), (24 + side * math.cos(a) * r1, 26 + math.sin(a) * r1)], (255, 226, 120), 1.4)
        nx = 24 + side * 18; c.fill(circle(nx, 50, 2, 10), INKC); c.line([(nx + 1.8, 50), (nx + 1.8, 43), (nx + 4, 44)], INKC, 0.8)
    return out(c)

def rent_marker():
    c = C(64, 80); c.shadow(32, 74, 12, 3.5)
    c.part(capsule_pts(32, 74, 32, 22, 2.2), RP("wood_dark"), lw=0.8)
    b = rrect(10, 20, 54, 44, 4); c.part(b, LWOOD, lw=1.0, shade=0.2, hl=0.2)
    # big friendly key + "+" (claim)
    c.part(circle(22, 32, 5, 18), GOLD, lw=0.7, hl=0.25); c.fill(circle(22, 32, 2, 10), LWOOD[1])
    c.part([(26, 30.5), (42, 30.5), (42, 33.5), (40, 33.5), (40, 37), (37.5, 37), (37.5, 33.5), (26, 33.5)], GOLD, lw=0.6)
    c.part([(44, 12), (56, 4), (56, 20)], NEUTRAL, lw=0.6, shade=0.1); mask_paint(c.tm, [[(44, 12), (56, 4), (56, 20)]], 255, 0, 0.35)
    c.line([(44, 20), (44, 4)], H(RAMPS["wood_dark"][2]), 1.0); S(c, [(44, 2), (60, 2), (60, 22), (44, 22)])
    # dotted claim footprint ring on ground
    for a in np.linspace(0, 2 * math.pi, 14, endpoint=False):
        x, y = 32 + 26 * math.cos(a), 72 + 6 * math.sin(a); c.fill(circle(x, y, 1.4, 8), (255, 250, 240), alpha=220)
    return out(c)

def prompt_open(k=0):
    c = C(48, 48); bob = math.sin(k / 4 * 2 * math.pi) * 1.5
    b = cloud(24, 21 + bob, 17, 14, seed=2); c.part(b, CREAM, lw=1.2, shade=0.15, hl=0.15)
    c.part([(20, 33 + bob), (28, 33 + bob), (24, 41 + bob)], CREAM, lw=0.9, shade=0.1)
    # tiny awning stall glyph
    for i in range(4): c.part([(13 + i * 5.5, 13 + bob), (18.5 + i * 5.5, 13 + bob), (18.5 + i * 5.5, 19 + bob), (13 + i * 5.5, 19 + bob)], RP("cloth_red" if i % 2 == 0 else "cloth_cream"), lw=0.5, shade=0.05)
    c.part(rrect(14, 19 + bob, 34, 29 + bob, 1.5), WOOD, lw=0.6, shade=0.15); coin_disc(c, 24, 24 + bob, 3.6)
    c.part(sparkle(38, 9 + bob, 3.5), [(255, 240, 160)] * 4, lw=0.4, shade=0, hl=0)
    return out(c)

def badge(kind):
    c = C(64, 32)
    col = RP("berry") if kind == "sold_out" else RP("iron")
    b = rrect(4, 6, 60, 26, 10); c.part(b, col, lw=1.2, shade=0.2, hl=0.2)
    if kind == "sold_out":   # empty crate glyph + X ribbon (text is SDF, drawn by renderer: 'Sold out')
        c.part(rrect(9, 10, 21, 22, 2), RP("wood"), lw=0.6); c.line([(10, 11), (20, 21)], INKC, 1.2); c.line([(20, 11), (10, 21)], INKC, 1.2)
    else:   # closed: little moon on a shutter
        c.part(rrect(9, 10, 21, 22, 2), RP("wood_dark"), lw=0.6); c.part([(17, 12), (13, 16), (17, 20), (14, 20), (11, 16), (14, 12)], GOLD, lw=0.4)
    return out(c)

def maker_mark():
    c = C(32, 32)
    b = circle(16, 16, 12, 30); c.part(b, RP("leather"), lw=0.9, shade=0.2, hl=0.15)
    c.part(capsule_pts(10, 24, 18, 14, 1.8), RP("wood"), lw=0.6)
    hd = rot_pts(rrect(12, 7, 27, 14, 1.8), 0.68, 19.5, 10.5); c.part(hd, RP("iron"), lw=0.7, hl=0.3)
    c.fill(rstar(21, 21, 2.6, 1.1, 5), H(RAMPS["gold"][0]))
    c.part(sparkle(8, 9, 3), [(255, 245, 190)] * 4, lw=0.4, shade=0, hl=0)
    return out(c)

def ui_icon(kind):
    c = C(32, 32)
    if kind == "ic_stall":
        for i in range(4): c.part([(5 + i * 5.5, 7), (10.5 + i * 5.5, 7), (10.5 + i * 5.5, 13), (5 + i * 5.5, 13)], RP("cloth_red" if i % 2 == 0 else "cloth_cream"), lw=0.6, shade=0.05)
        c.part(rrect(6, 13, 26, 26, 2), WOOD, lw=0.8, shade=0.2); c.part(rrect(9, 16, 23, 20, 1), CREAM, lw=0.4)
    elif kind == "ic_till":
        c.part(rrect(5, 12, 27, 27, 3), RP("wood_dark"), lw=0.9, shade=0.2); c.part(rrect(8, 15, 24, 19, 1), RP("iron"), lw=0.4)
        coin_disc(c, 16, 9, 5, 4.5)
    elif kind == "ic_ledger":
        c.part(rrect(7, 5, 25, 27, 2), RP("cloth_green"), lw=0.9, shade=0.2); c.part(rrect(10, 8, 22, 24, 1), CREAM, lw=0.4)
        for j in range(4): c.line([(12, 11 + j * 3.5), (20 - (j % 2) * 3, 11 + j * 3.5)], INKC, 0.7)
    elif kind == "ic_tag":
        c.part([(6, 10), (20, 10), (27, 16), (20, 22), (6, 22)], CREAM, lw=0.9, shade=0.2); c.part(circle(10, 16, 1.6, 10), RP("leather"), lw=0.4)
    elif kind == "ic_restock":
        c.part(rrect(6, 12, 26, 27, 2), WOOD, lw=0.9, shade=0.2); c.line([(6, 17), (26, 17)], H(RAMPS["wood"][3]), 0.8)
        c.part([(16, 3), (23, 10), (19, 10), (19, 14), (13, 14), (13, 10), (9, 10)], RP("cloth_green"), lw=0.6)
    elif kind == "ic_search":
        c.part(circle(13, 13, 8, 24), RP("glass"), lw=1.0, hl=0.3); c.part(capsule_pts(19, 19, 26, 26, 2.2), RP("wood"), lw=0.6)
    elif kind == "ic_sort":
        c.part([(9, 5), (15, 12), (11, 12), (11, 26), (7, 26), (7, 12), (3, 12)], RP("cloth_blue"), lw=0.6)
        c.part([(23, 27), (29, 20), (25, 20), (25, 6), (21, 6), (21, 20), (17, 20)], RP("cloth_yellow"), lw=0.6)
    elif kind == "ic_filter":
        c.part([(5, 7), (27, 7), (18, 17), (18, 26), (14, 24), (14, 17)], RP("cloth_purple"), lw=0.8, shade=0.2)
    elif kind == "ic_clan_key":
        c.part(rrect(5, 6, 27, 26, 4), NEUTRAL, lw=0.9, shade=0.15); mask_paint(c.tm, [rrect(5, 6, 27, 26, 4)], 255, 0, 0.3)
        c.part(circle(13, 16, 4, 16), GOLD, lw=0.6); c.part(rrect(16, 15, 25, 17.5, 0.5), GOLD, lw=0.5)
    elif kind == "ic_fill":
        c.part(rrect(10, 4, 22, 9, 1.5), RP("leather"), lw=0.6); c.part(wobbly(16, 19, 10, 10, seed=3), RP("glass"), lw=0.9, hl=0.3)
        c.part([(7.5, 21), (24.5, 21), (22, 27), (10, 27)], RP("water"), lw=0.3, flat=True)
    return out(c)

def build():
    sheets, sprites = [], []
    sh = StallSheet("stall_props", 96, 80, 8, (0.5, 0.9)); idx = 0; rec = {}
    def add(name, res, pivot=None):
        nonlocal idx
        img, tm, em, sw = res; W, Hh = img.size[0] // 4, img.size[1] // 4
        canvas = Canvas(96, 80); canvas.img.paste(img, ((96 - W) * 2, (80 - Hh) * 4 - 4 * 4 if Hh <= 76 else 0))
        def fit(x):
            f = Image.new(x.mode, (96 * 4, 80 * 4), (0,) * len(x.getbands())); f.paste(x, ((96 - W) * 2, max(0, (80 - Hh) * 4 - 16))); return f
        sh.addf(name, fit(img), fit(tm), fit(em), fit(sw), idx); rec[name] = idx; idx += 1
    add("price_tag", price_tag())
    for s in range(3): add(f"shop_sign_{s}", sign_board(s))
    add("coin_pouch", pouch()); add("barter_scale", scale(0)); add("barter_scale_tip", scale(0.6)); add("display_slot", display_slot())
    add("stall_lantern_off", lantern(False))
    for k in range(4): add(f"stall_lantern_{k}", lantern(True, k))
    for k in range(6): add(f"shop_bell_{k}", bell(k))
    add("stall_rent_marker", rent_marker())
    sh.save(); sheets.append(sh)
    piv = {"x": 0.5, "y": 0.9}
    def spr(key, cat, anims, extra=None):
        s = {"key": key, "category": cat, "atlas": "stall_props", "anchor": piv, "animations": anims}; s.update(extra or {}); sprites.append(s)
    spr("stall_price_tag", "ui", {"idle": {"frames": [rec["price_tag"]], "fps": 1}}, {"attach": {"text": {"x": 1.5, "y": -9, "w": 14, "h": 6}}})
    spr("stall_shop_sign", "ui", {"idle": {"frames": [rec["shop_sign_0"]], "fps": 1}, "scroll": {"frames": [rec["shop_sign_1"]], "fps": 1}, "aframe": {"frames": [rec["shop_sign_2"]], "fps": 1}},
        {"attach": {"sign": {"x": 0, "y": -21, "w": 68, "h": 16}}, "sway": {"amp": 0.8, "freq": 0.6, "stiffness": 0.7}})
    spr("stall_coin_pouch", "building", {"idle": {"frames": [rec["coin_pouch"]], "fps": 1}})
    spr("stall_barter_scale", "building", {"idle": {"frames": [rec["barter_scale"]], "fps": 1}, "tip": {"frames": [rec["barter_scale"], rec["barter_scale_tip"], rec["barter_scale"]], "fps": 6, "loop": False}},
        {"attach": {"pan_l": {"x": -20, "y": -32, "w": 14, "h": 14}, "pan_r": {"x": 20, "y": -32, "w": 14, "h": 14}}})
    spr("stall_display_slot", "building", {"idle": {"frames": [rec["display_slot"]], "fps": 1}}, {"attach": {"slot0": {"x": 0, "y": -14, "w": 18, "h": 18}}})
    spr("stall_lantern", "building", {"idle": {"frames": [rec["stall_lantern_0"]], "fps": 1}, "lit": {"frames": [rec[f"stall_lantern_{k}"] for k in range(4)], "fps": 4}, "off": {"frames": [rec["stall_lantern_off"]], "fps": 1}},
        {"sway": {"amp": 1.2, "freq": 0.5, "stiffness": 0.4}})
    spr("stall_shop_bell", "building", {"idle": {"frames": [rec["shop_bell_0"]], "fps": 1}, "ring": {"frames": [rec[f"shop_bell_{k}"] for k in range(6)], "fps": 12, "loop": False}})
    spr("stall_rent_marker", "building", {"idle": {"frames": [rec["stall_rent_marker"]], "fps": 1}}, {"sway": {"amp": 1.0, "freq": 0.8, "stiffness": 0.5}})
    # world prompts + icons (48 grid)
    ic = StallSheet("stall_icons", 48, 48, 8, (0.5, 0.5)); j = 0; r2 = {}
    def add2(name, res):
        nonlocal j
        img, tm, em, sw = res; W, Hh = img.size[0] // 4, img.size[1] // 4
        def fit(x):
            f = Image.new(x.mode, (192, 192), (0,) * len(x.getbands())); f.paste(x, ((48 - W) * 2, (48 - Hh) * 2)); return f
        ic.addf(name, fit(img), fit(tm), fit(em), fit(sw), j); r2[name] = j; j += 1
    for k in range(4): add2(f"prompt_open_{k}", prompt_open(k))
    for n, nm in ((1, "coin"), (2, "coin_few"), (3, "coin_many")): add2(nm, coin_icon(n))
    add2("maker_mark", maker_mark())
    for k in ("ic_stall", "ic_till", "ic_ledger", "ic_tag", "ic_restock", "ic_search", "ic_sort", "ic_filter", "ic_clan_key", "ic_fill"): add2(k, ui_icon(k))
    ic.save(); sheets.append(ic)
    bd = StallSheet("stall_badges", 64, 32, 2, (0.5, 0.5)); bd.addf("badge_sold_out", *badge("sold_out"), 0); bd.addf("badge_closed", *badge("closed"), 1); bd.save(); sheets.append(bd)
    def spr2(key, cat, frames, fps=1, extra=None, atlas="stall_icons"):
        s = {"key": key, "category": cat, "atlas": atlas, "anchor": {"x": 0.5, "y": 0.5}, "animations": {"idle": {"frames": frames, "fps": fps}}}; s.update(extra or {}); sprites.append(s)
    spr2("stall_prompt_open", "ui", [r2[f"prompt_open_{k}"] for k in range(4)], 4, {"anchor": {"x": 0.5, "y": 0.9}})
    spr2("coin", "item", [r2["coin"]], 1, {"animations": {"idle": {"frames": [r2["coin"]], "fps": 1}, "few": {"frames": [r2["coin_few"]], "fps": 1}, "many": {"frames": [r2["coin_many"]], "fps": 1}},
         "stackArt": {"1": "idle", "2": "few", "10": "many"}})
    spr2("ui_maker_mark", "ui", [r2["maker_mark"]])
    for k in ("ic_stall", "ic_till", "ic_ledger", "ic_tag", "ic_restock", "ic_search", "ic_sort", "ic_filter", "ic_clan_key", "ic_fill"): spr2("ui_stall_" + k[3:], "ui", [r2[k]])
    spr2("stall_badge_sold_out", "ui", [0], atlas="stall_badges", extra={"anchor": {"x": 0.5, "y": 0.84375}, "attach": {"text": {"x": 7, "y": -11, "w": 34, "h": 12}}})
    spr2("stall_badge_closed", "ui", [1], atlas="stall_badges", extra={"anchor": {"x": 0.5, "y": 0.84375}, "attach": {"text": {"x": 7, "y": -11, "w": 34, "h": 12}}})
    # export 1x/2x pngs of UI icons for the DOM kit
    os.makedirs(os.path.join(ROOT, "ui", "icons"), exist_ok=True)
    for name, i in r2.items():
        for s, suf in ((1, ""), (2, "@2x")):
            ic.frames[i]["i" + str(s)].save(os.path.join(ROOT, "ui", "icons", f"{name}{suf}.png"))
    return sheets, sprites

if __name__ == "__main__":
    sheets, sprites = build()
    json.dump({"atlases": [s.atlas_json() for s in sheets], "sprites": sprites}, open(os.path.join(ROOT, "tools", "_props.json"), "w"), indent=1)
    print("ok")
