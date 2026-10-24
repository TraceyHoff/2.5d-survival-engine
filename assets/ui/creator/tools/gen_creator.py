#!/usr/bin/env python3
"""ADR-114 character-creator art (Cozy-Wild UI style, reuses ui/branding/tools/gen_branding.py helpers):
 - preview_bg.png (160x200, @2x 320x400): cozy dusk clearing behind the 160x200 Canvas2D paper-doll preview.
   Centre column (x 36..124, y 30..186) kept calm; the doll's feet go on the rug at (80, 172).
 - ic_randomize.png, ic_rotate_left.png, ic_rotate_right.png (40x40, @2x 80x80): same size/ink/outline as
   ui/branding/buttons/icons/ic_menu_*; glyph-only (the 44px button supplies hover/focus/pressed states, so they
   work for touch, mouse and gamepad/keyboard focus alike); readable on light and dark plates thanks to the ink rim.
Usage: python3 gen_creator.py   (writes next to this tools/ dir)"""
import os, sys, math, random
HERE = os.path.dirname(os.path.abspath(__file__)); OUT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(OUT, "..", "branding", "tools"))
from PIL import Image, ImageDraw, ImageFilter
import gen_branding as B
from gen_branding import INK, INK_D, PAL, rgba, part, blob, rrect, pine, round_tree, sparkle, firefly, down, save12

def preview_bg(S=8):
    W, H = 160 * S, 200 * S; u = S; ow = 1.6 * u
    img = Image.new("RGBA", (W, H), rgba("#2a1b2e")); d = ImageDraw.Draw(img)
    for i, c in enumerate(["#3a2a52", "#523a80", "#7452ad", "#9b72d6", "#c77fb0", "#f48fb1", "#f4a74a"]):
        d.rectangle([0, int(i * 15 * u), W, H], fill=c)
    rnd = random.Random(7)
    for _ in range(26):
        x, y = rnd.uniform(0, W), rnd.uniform(0, 60 * u); r = rnd.choice([.5, .5, .8, 1.4]) * u
        if r > u: sparkle(d, x, y, r * 2.2, "#fff6c2")
        else: d.ellipse([x - r, y - r, x + r, y + r], fill="#fffaf0")
    g = Image.new("RGBA", img.size, (0, 0, 0, 0)); ImageDraw.Draw(g).ellipse([108 * u, 2 * u, 156 * u, 50 * u], fill=rgba("#fff2a8", 110))
    img.alpha_composite(g.filter(ImageFilter.GaussianBlur(7 * u))); d = ImageDraw.Draw(img)
    d.ellipse([122 * u, 15 * u, 142 * u, 35 * u], fill="#ffe98a", outline=INK, width=int(ow))
    d.ellipse([125 * u, 17 * u, 132 * u, 23 * u], fill="#fff8c8")
    for cx, cy, s in ((30, 30, 1.0), (96, 50, .8)):
        for dx, r in ((-9, 6), (0, 8), (9, 6)): d.ellipse([(cx + dx - r) * u * s / s, (cy - r * .7) * u, (cx + dx + r) * u, (cy + r * .7) * u], fill="#c9a6ef", outline=INK, width=int(ow * .8))
    # far hills + pine rows
    d.polygon([(0, 104 * u)] + [(x * u, (98 + 6 * math.sin(x / 19)) * u) for x in range(0, 161, 4)] + [(W, H), (0, H)], fill="#5b3f86")
    for i, x in enumerate(range(-4, 170, 13)):
        pine(d, x * u, (106 + (i % 2) * 3) * u, (26 + (i * 7) % 9) * u, ["#8c78c6", "#6f5aa8", "#5b4690", "#3e2f66"], ow * .7, seed=i)
    # meadow
    d.polygon([(0, 118 * u)] + [(x * u, (114 + 4 * math.sin(x / 23 + 1)) * u) for x in range(0, 161, 4)] + [(W, H), (0, H)], fill=PAL["grass"][2], outline=INK, width=int(ow))
    d.polygon([(0, 124 * u)] + [(x * u, (120 + 4 * math.sin(x / 23 + 1)) * u) for x in range(0, 161, 4)] + [(W, H), (0, H)], fill=PAL["grass"][1])
    for i in range(70):
        x, y = rnd.uniform(0, W), rnd.uniform(126 * u, H); hgt = rnd.uniform(2, 3.5) * u
        d.line([(x, y), (x - u * .6, y - hgt)], fill=PAL["grass"][3], width=int(u * .6)); d.line([(x, y), (x + u * .7, y - hgt * .8)], fill=PAL["grass"][3], width=int(u * .6))
    # framing trees (edges only)
    pine(d, 8 * u, 150 * u, 64 * u, PAL["pine"], ow, seed=3)
    round_tree(d, 156 * u, 156 * u, 70 * u, PAL["leaf"], ow, seed=5)
    pine(d, 140 * u, 128 * u, 36 * u, PAL["pine"], ow, seed=8)
    # warm glow + woven rug stage under the doll
    g = Image.new("RGBA", img.size, (0, 0, 0, 0)); ImageDraw.Draw(g).ellipse([30 * u, 120 * u, 130 * u, 190 * u], fill=rgba(PAL["fire"][0], 70))
    img.alpha_composite(g.filter(ImageFilter.GaussianBlur(14 * u))); d = ImageDraw.Draw(img)
    d.ellipse([33 * u, 163 * u, 129 * u, 187 * u], fill=rgba(INK_D, 70))
    d.ellipse([32 * u, 158 * u, 128 * u, 184 * u], fill="#d08c52", outline=INK, width=int(ow))
    d.ellipse([39 * u, 161 * u, 121 * u, 181 * u], fill="#f2c27a")
    d.ellipse([47 * u, 164 * u, 113 * u, 178 * u], outline="#c46a4a", width=int(1.4 * u))
    d.ellipse([57 * u, 167 * u, 103 * u, 175 * u], outline="#7aa0c8", width=int(1.2 * u))
    # tiny props at the corners: lantern on a stump (left), berry bush + mushroom (right)
    part(d, rrect(10 * u, 176 * u, 26 * u, 188 * u, 3 * u), PAL["bark"], ow, hl=False)
    d.ellipse([10 * u, 173 * u, 26 * u, 179 * u], fill=PAL["wood"][0], outline=INK, width=int(ow * .8))
    g = Image.new("RGBA", img.size, (0, 0, 0, 0)); ImageDraw.Draw(g).ellipse([6 * u, 152 * u, 30 * u, 176 * u], fill=rgba("#ffd27a", 150))
    img.alpha_composite(g.filter(ImageFilter.GaussianBlur(4 * u))); d = ImageDraw.Draw(img)
    d.rounded_rectangle([14 * u, 162 * u, 22 * u, 174 * u], 2 * u, fill="#ffe08a", outline=INK, width=int(ow * .8))
    d.rectangle([13 * u, 160 * u, 23 * u, 162.5 * u], fill=PAL["iron"][2], outline=INK, width=int(ow * .6))
    d.arc([15 * u, 156 * u, 21 * u, 162 * u], 180, 360, fill=INK, width=int(ow * .6))
    part(d, blob(146 * u, 186 * u, 13 * u, 8 * u, seed=2, amp=.1), PAL["leaf"], ow)
    for bx, by in ((140, 184), (147, 181), (152, 187), (143, 189)): d.ellipse([(bx - 1.6) * u, (by - 1.6) * u, (bx + 1.6) * u, (by + 1.6) * u], fill=PAL["berry"][1], outline=INK, width=int(u * .5))
    d.rectangle([128 * u, 186 * u, 131 * u, 192 * u], fill="#fff1d6", outline=INK, width=int(u * .6))
    d.chord([124 * u, 181 * u, 135 * u, 191 * u], 180, 360, fill=PAL["mush_red"][1], outline=INK, width=int(ow * .7))
    for x, y in ((127, 184), (131, 183)): d.ellipse([(x - .8) * u, (y - .8) * u, (x + .8) * u, (y + .8) * u], fill="#fffaf0")
    for x, y in ((24, 120), (138, 108), (46, 140), (118, 146), (70, 98), (150, 140)): firefly(img, x * u, y * u, 1.1 * u)
    # soft vignette
    v = Image.new("L", img.size, 0); ImageDraw.Draw(v).rectangle([0, 0, W, H], fill=110); ImageDraw.Draw(v).ellipse([-10 * u, 0, 170 * u, 200 * u], fill=0)
    img.alpha_composite(Image.merge("RGBA", (*[Image.new("L", img.size, 30)] * 3, v.filter(ImageFilter.GaussianBlur(18 * u)))))
    return img

def ic_randomize(sz=40, S=8, col="#fffaf0"):
    W = sz * S; img = Image.new("RGBA", (W, W), (0, 0, 0, 0)); k = W / 40; ow = 3 * S * sz / 40 / (sz / 40)
    die = Image.new("RGBA", (W, W), (0, 0, 0, 0)); d = ImageDraw.Draw(die); c = W / 2
    d.rounded_rectangle([c - 13 * k + 1.2 * k, c - 13 * k + 1.6 * k, c + 13 * k + 1.2 * k, c + 13 * k + 1.6 * k], 6 * k, fill=INK_D)
    d.rounded_rectangle([c - 13 * k, c - 13 * k, c + 13 * k, c + 13 * k], 6 * k, fill="#f1dcc0", outline=INK, width=int(3 * S))
    d.rounded_rectangle([c - 10 * k, c - 10.5 * k, c + 10 * k, c + 8 * k], 4.5 * k, fill=col)
    for px, py in ((-6, -6), (6, -6), (0, 0), (-6, 6), (6, 6)):
        d.ellipse([c + (px - 2.6) * k, c + (py - 2.6) * k, c + (px + 2.6) * k, c + (py + 2.6) * k], fill=INK)
    die = die.rotate(14, resample=Image.BICUBIC, center=(c, c + k))
    img.alpha_composite(die); d = ImageDraw.Draw(img)
    sparkle(d, c + 14.5 * k, c - 14.5 * k, 4.5 * k, "#fff2a8"); sparkle(d, c - 15.5 * k, c + 13 * k, 3 * k, "#fff2a8")
    return img

def ic_rotate(sz=40, S=8, col="#fffaf0", right=False):
    W = sz * S; img = Image.new("RGBA", (W, W), (0, 0, 0, 0)); d = ImageDraw.Draw(img); k = W / 40; c = W / 2
    # thick arc: ink stroke, then cream stroke on top (same 3px-rim look as ic_menu_*)
    Rm = 12.5 * k; box = [c - Rm, c - Rm, c + Rm, c + Rm]; a0, a1 = 150, 395     # PIL degrees, clockwise from +x
    ta = math.radians(a0); bx, by = c + Rm * math.cos(ta), c + Rm * math.sin(ta)
    tx, ty = math.sin(ta), -math.cos(ta); nx, ny = math.cos(ta), math.sin(ta)  # tangent toward decreasing angle (visual CCW)
    head = [(bx + nx * 8 * k - tx * 2 * k, by + ny * 8 * k - ty * 2 * k), (bx + tx * 8 * k, by + ty * 8 * k), (bx - nx * 8 * k - tx * 2 * k, by - ny * 8 * k - ty * 2 * k)]
    def strokes(dd, off, fill_arc, fill_head, w):
        bo = [c - Rm - w / 2 + off[0], c - Rm - w / 2 + off[1], c + Rm + w / 2 + off[0], c + Rm + w / 2 + off[1]]
        dd.arc(bo, a0 + 4, a1, fill=fill_arc, width=int(w))
        e = math.radians(a1); ex, ey = c + Rm * math.cos(e) + off[0], c + Rm * math.sin(e) + off[1]; r = w / 2
        dd.ellipse([ex - r, ey - r, ex + r, ey + r], fill=fill_arc)
        dd.polygon([(x + off[0], y + off[1]) for x, y in head], fill=fill_head)
    strokes(d, (1.2 * k, 1.6 * k), INK_D, INK_D, 7.5 * k)
    strokes(d, (0, 0), INK, INK, 7.5 * k)
    d.line(head + [head[0]], fill=INK, width=int(3 * k), joint="curve")
    d.arc([c - Rm - 2.25 * k, c - Rm - 2.25 * k, c + Rm + 2.25 * k, c + Rm + 2.25 * k], a0 + 4, a1, fill=col, width=int(4.5 * k))
    e = math.radians(a1); ex, ey = c + Rm * math.cos(e), c + Rm * math.sin(e); r = 2.25 * k
    d.ellipse([ex - r, ey - r, ex + r, ey + r], fill=col)
    cx_, cy_ = sum(x for x, _ in head) / 3, sum(y for _, y in head) / 3
    d.polygon([(cx_ + (x - cx_) * .62, cy_ + (y - cy_) * .62) for x, y in head], fill=col)
    # little turntable disc in the middle (reads as "turn the character", not "undo")
    d.ellipse([c - 6 * k, c + 1 * k, c + 6 * k, c + 6 * k], fill="#d08c52", outline=INK, width=int(2.2 * S))
    d.ellipse([c - 3 * k, c - 7 * k, c + 3 * k, c - 1 * k], fill="#7aa0c8", outline=INK, width=int(2.2 * S))
    d.rounded_rectangle([c - 2.4 * k, c - 2 * k, c + 2.4 * k, c + 3.5 * k], 1.5 * k, fill="#7aa0c8", outline=INK, width=int(2.2 * S))
    return img.transpose(Image.FLIP_LEFT_RIGHT) if right else img

if __name__ == "__main__":
    p = preview_bg(); a = down(p, 160).convert("RGB"); a.save(os.path.join(OUT, "preview_bg.png"), optimize=True)
    down(p, 320).convert("RGB").save(os.path.join(OUT, "preview_bg@2x.png"), optimize=True)
    save12(ic_randomize(), os.path.join(OUT, "ic_randomize.png"), 40)
    save12(ic_rotate(), os.path.join(OUT, "ic_rotate_left.png"), 40)
    save12(ic_rotate(right=True), os.path.join(OUT, "ic_rotate_right.png"), 40)
    print("ok")
