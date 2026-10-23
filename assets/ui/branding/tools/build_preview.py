#!/usr/bin/env python3
"""Preview mocks: main menu + loading screen (1920x1080) and loading_anim.gif. Not shipped."""
import os, json
from PIL import Image, ImageDraw, ImageFont, ImageEnhance
B = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); P = os.path.join(B, "preview"); os.makedirs(P, exist_ok=True)
F = os.path.join(os.path.dirname(B), "fonts")
cfg = json.load(open(os.path.join(B, "branding.json")))
def font(path, size, w):
    f = ImageFont.truetype(os.path.join(F, path), size)
    f.set_variation_by_axes([w, 100] if "Fredoka" in path else [w]); return f
def nine(img, w, h, l, t, r, b):
    W, H = img.size; out = Image.new("RGBA", (w, h))
    xs = [(0, l, 0, l), (l, W - r, l, w - r), (W - r, W, w - r, w)]; ys = [(0, t, 0, t), (t, H - b, t, h - b), (H - b, H, h - b, h)]
    for sx0, sx1, dx0, dx1 in xs:
        for sy0, sy1, dy0, dy1 in ys:
            if dx1 > dx0 and dy1 > dy0: out.paste(img.crop((sx0, sy0, sx1, sy1)).resize((dx1 - dx0, dy1 - dy0), Image.LANCZOS), (dx0, dy0))
    return out
bg = Image.open(os.path.join(B, "background/menu_bg_1920x1080.png")).convert("RGBA")
logo = Image.open(os.path.join(B, "logo/logo_1024.png"))
# main menu
m = bg.copy(); m.alpha_composite(logo, ((1920 - logo.width) // 2, 50))
y = 450
for k, st in (("singleplayer", "hover"), ("multiplayer", "normal"), ("settings", "normal"), ("quit", "normal")):
    b = Image.open(os.path.join(B, f"buttons/labelled/btn_{k}_{st}@2x.png")).resize((480, 114), Image.LANCZOS)
    m.alpha_composite(b, ((1920 - 480) // 2, y)); y += 124
d = ImageDraw.Draw(m)
d.text((1900, 1062), "v0.1 · placeholder title" if cfg.get("titleIsPlaceholder") else "v0.1", font=font("Nunito.ttf", 22, 700), fill="#e6c47e", anchor="rs", stroke_width=2, stroke_fill="#3b2433")
d.text((960, 960), "A / Enter: select    Arrows / D-pad: move focus", font=font("Nunito.ttf", 24, 800), fill="#f6ead2", anchor="mm", stroke_width=3, stroke_fill="#3b2433")
m.convert("RGB").save(os.path.join(P, "main_menu_mock.png"))
# loading
fr = Image.open(os.path.join(B, "loading/loading_frame@2x.png")); fl = Image.open(os.path.join(B, "loading/loading_fill@2x.png"))
zs = Image.open(os.path.join(B, "loading/loading_zombie_walk@2x.png")); cs = Image.open(os.path.join(B, "loading/loading_campfire@2x.png"))
frames = []
for i in range(12):
    L = ImageEnhance.Brightness(bg).enhance(.55).convert("RGBA")
    l5 = Image.open(os.path.join(B, "logo/logo_512.png")).resize((768, round(logo.height * .75)), Image.LANCZOS)
    L.alpha_composite(l5, ((1920 - l5.width) // 2, 220))
    bw, bh = 960, 64; bx, by = (1920 - bw) // 2, 700
    L.alpha_composite(nine(fr, bw, bh, 28, 24, 32, 30), (bx, by))
    prog = .35 + .4 * i / 11; fw = max(40, int((bw - 40) * prog))
    L.alpha_composite(nine(fl, fw, 36, 16, 14, 16, 14), (bx + 12, by + 12))
    z = zs.crop(((i % 6) * 128, 0, (i % 6 + 1) * 128, 128)); L.alpha_composite(z, (bx + 12 + fw - 70, by - 112))
    c = cs.crop(((i % 6) * 128, 0, (i % 6 + 1) * 128, 128)); L.alpha_composite(c, (bx + bw + 6, by - 72))
    d = ImageDraw.Draw(L)
    d.text((960, 810), f"Warming up the campfire… {int(prog * 100)}%", font=font("Fredoka.ttf", 40, 600), fill="#fffaf0", anchor="mm", stroke_width=4, stroke_fill="#3b2433")
    d.text((960, 870), "Tip: zombies are slow, but very, very curious.", font=font("Nunito.ttf", 28, 700), fill="#e6c47e", anchor="mm", stroke_width=3, stroke_fill="#3b2433")
    frames.append(L.convert("RGB"))
frames[5].save(os.path.join(P, "loading_screen_mock.png"))
small = [f.resize((960, 540), Image.LANCZOS) for f in frames]
small[0].save(os.path.join(P, "loading_anim.gif"), save_all=True, append_images=small[1:], duration=140, loop=0)
print("ok")
