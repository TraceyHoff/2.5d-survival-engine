"""2. Death & loot: loot bindle/sacks (S/M/L, sparkle idle), cozy 'here lies' marker, rarity loot glows + tileable beam, drop bounce."""
import math, json, os, numpy as np
from PIL import Image, ImageFont, ImageDraw, ImageFilter
from common import *
from fx_combat import twinkle, star, puff, heart_, eyes, CLOUD, DUST, capsule, round_poly

RP = lambda n: [H(c) for c in RAMPS[n]]
BURLAP = [(250, 228, 176), (226, 192, 132), (186, 144, 96), (128, 92, 66)]
THEME = "/workspace/assets/ui/theme.json"
FONT = "/workspace/assets/ui/fonts/Fredoka.ttf"
GY = 54   # ground line in the 64x64 cell -> anchor y 0.84

def rarity_palette():
    rar = {"common": ("#A9A094", "#D6CFC2"), "uncommon": ("#72C45C", "#B4EA80"), "rare": ("#4F8FD6", "#86C0F2"),
           "epic": ("#9B72D6", "#C9A8F0"), "legendary": ("#FFD45A", "#FFF2A8")}
    src = "defined here (ui/theme.json missing)"
    if os.path.exists(THEME):
        t = json.load(open(THEME)).get("rarity", {})
        for k in rar:
            if k in t: rar[k] = (t[k]["color"], t[k].get("light", rar[k][1]))
        src = "ui/theme.json rarity tokens (color, light) + pvp_clan beam/glow extensions"
    beam = {"common": "#E6E0D6", "uncommon": "#9FF07A", "rare": "#6FB4FF", "epic": "#C08CFF", "legendary": "#FFE070"}  # brighter additive tints
    out = {"source": src, "order": list(rar), "rarity": {}}
    for i, (k, (c, l)) in enumerate(rar.items()):
        out["rarity"][k] = {"index": i, "color": c, "light": l, "beam": beam[k], "glowIntensity": [0.35, 0.55, 0.75, 0.95, 1.2][i],
                            "beamHeightTiles": [0, 1.5, 2.5, 3.5, 5][i], "sparkles": k in ("epic", "legendary"), "ground_glow_sprite": f"loot_glow_{k}"}
    out["note"] = "common has no beam by default (ground glow only). Beam: textures/loot_beam.png, additive, tile in v, tint = beam color."
    return out

def sparkles(cv, e, k, n, spots, col=(255, 250, 220)):
    for j, (x, y, r) in enumerate(spots):
        ph = (k / n + j / len(spots)) % 1; s = max(0, math.sin(ph * math.pi)) ** 1.5
        if s > 0.08: twinkle(cv, x, y, r * s + 0.6, col, rot=ph, e=e, ecol=(255, 240, 190))

def bindle(cv, k):
    # stick lying diagonally, polka-dot bundle tied at the end
    cv.part(capsule(14, GY - 3, 48, GY - 16, 1.6), RP("wood"), lw=0.9)
    b = wobbly(40, GY - 12, 10, 8.5, 3, 0.07)
    cv.part(b, RP("cloth_red"), lw=1.0, shade=0.22, hl=0.15)
    for (x, y) in ((35, GY - 15), (42, GY - 9), (45, GY - 16), (37, GY - 8), (40, GY - 19)):
        cv.fill(circle(x, y, 1.3, 12), H(RAMPS["cloth_cream"][1]), clip=cv.mask_from(b))
    knot = [(37, GY - 21), (41, GY - 26), (44, GY - 21), (46, GY - 25), (47, GY - 20), (42, GY - 18)]
    cv.part(round_poly(knot, 1.2), RP("cloth_red"), lw=0.8, shade=0.1)
    cv.part(circle(42, GY - 19.5, 2.0, 14), RP("cloth_red"), lw=0.6)

def sack(cv, cx, s, k, n, extra=False):
    br = 1 + 0.025 * math.sin(k / n * 6.283)      # breathing squash
    w, h = 13 * s, 14 * s * br; top = GY - h * 1.75
    body = []
    for j in range(64):
        a = j / 64 * 6.283; x = math.cos(a); y = math.sin(a)
        wid = w * (1.0 + 0.18 * y) ; body.append((cx + x * wid, GY - h + y * h * (0.95 if y > 0 else 0.85)))
    if extra:  # loot poking out (behind the neck)
        cv.part(capsule(cx - 6 * s, top + 2, cx - 11 * s, top - 7 * s, 2.2 * s), RP("wood"), lw=0.9)                    # plank
        cv.part(rstar(cx + 7 * s, top - 3 * s, 3.5 * s, 2.5 * s, 3, 0), RP("leaf"), lw=0.7)                            # carrot leaves
        cv.part([(cx + 4 * s, top + 1), (cx + 10 * s, top + 1), (cx + 7 * s, top + 9 * s)], RP("leaf_autumn"), lw=0.8)   # carrot
    cv.part(body, BURLAP, lw=1.1, shade=0.2, hl=0.12)
    cl = cv.mask_from(body)
    for j in range(5):  # burlap weave hints
        y = GY - h * 1.6 + j * h * 0.36; cv.line([(cx - w * 0.7, y), (cx + w * 0.7, y + 1)], BURLAP[2], 0.5, clip=cl, alpha=110)
    neck = [(cx - 4 * s, GY - h * 1.72), (cx + 4 * s, GY - h * 1.72), (cx + 3 * s, GY - h * 1.88), (cx - 3 * s, GY - h * 1.88)]
    ruff = wobbly(cx, GY - h * 1.98 - 2 * s, 6.5 * s, 3.4 * s, 9, 0.18, n=40)
    cv.part(ruff, BURLAP, lw=0.9, shade=0.25)
    cv.part(rrect(cx - 5 * s, GY - h * 1.86 - 1.4 * s, cx + 5 * s, GY - h * 1.86 + 1.4 * s, 1.3 * s), RP("wood_dark"), lw=0.7, shade=0.2)  # rope
    cv.part(capsule(cx + 4 * s, GY - h * 1.86, cx + 7.5 * s, GY - h * 1.6, 0.9 * s), RP("wood_dark"), lw=0.6)
    # patch with stitches
    pp = rrect(cx - w * 0.62, GY - h * 1.0, cx - w * 0.12, GY - h * 0.5, 1.2)
    cv.part(rot_pts(pp, -0.15, cx - w * 0.37, GY - h * 0.75), RP("cloth_teal" if s > 1.1 else "cloth_red"), lw=0.6, shade=0.1)
    for j in range(4):
        x = cx - w * 0.6 + j * w * 0.15; cv.line([(x, GY - h * 1.04 + j * 0.3), (x + 1, GY - h * 0.98 + j * 0.3)], (255, 250, 230), 0.5)
    # sleepy happy face stitched on: cute
    eyes(cv, cx + w * 0.22, GY - h * 0.85, 0.75 * s, blush=True, closed=True)
    cv.line([(cx + w * 0.22 - 1.2 * s, GY - h * 0.6), (cx + w * 0.22, GY - h * 0.5), (cx + w * 0.22 + 1.2 * s, GY - h * 0.6)], H("#3b2433"), 0.6)
    if s > 1.1:  # gold coins spilling
        for j, (x, y) in enumerate(((cx + w * 0.9, GY - 2), (cx + w * 1.15, GY - 1.5), (cx + w * 1.0, GY - 4.5))):
            cv.part(circle(x, y, 2.6, 18, 1.7), RP("gold"), lw=0.6, shade=0.25, hl=0.2)

def loot_sack(size, k, n=6):
    cv = blank(64, 64, 31 + k); e = blank(64, 64)
    if size == "small":
        bindle(cv, k); spots = [(44, GY - 30, 2.6), (20, GY - 12, 2.0), (52, GY - 8, 1.8)]
    elif size == "medium":
        sack(cv, 32, 0.95, k, n); spots = [(46, GY - 34, 2.8), (17, GY - 22, 2.2), (44, GY - 6, 2.0)]
    else:
        sack(cv, 30, 1.25, k, n, extra=True); spots = [(50, GY - 44, 3.2), (12, GY - 30, 2.4), (54, GY - 16, 2.2), (22, GY - 46, 2.0)]
    sparkles(cv, e, k, n, spots)
    return cv, e

def grave(k, n=4):
    cv = blank(64, 64, 41); e = blank(64, 64)
    mound = wobbly(32, GY - 2, 17, 5.2, 2, 0.08)
    cv.part(mound, RP("dirt"), lw=0.9, shade=0.25)
    for x in (18, 25, 41, 47):  # grass tufts on the mound
        cv.part([(x - 2, GY - 3), (x - 1, GY - 8), (x, GY - 4), (x + 1.5, GY - 9), (x + 2, GY - 3)], RP("grass"), lw=0.6, shade=0.1)
    sign = []
    for j in range(32):
        a = math.pi + j / 31 * math.pi; sign.append((32 + math.cos(a) * 11, GY - 26 + math.sin(a) * 8))
    sign += [(43, GY - 4), (21, GY - 4)]
    sign = rot_pts(sign, -0.08, 32, GY - 4)       # leans a little: cozy, hand-made
    cv.part(sign, RP("wood"), lw=1.0, shade=0.2, hl=0.15)
    cl = cv.mask_from(sign)
    for y in (GY - 22, GY - 14): cv.line([(19, y + 1), (45, y - 1)], H(RAMPS["wood"][2]), 0.5, clip=cl, alpha=140)  # plank seams
    # carved text "here lies" + heart (legible at 2x)
    t = Image.new("L", (cv.W, cv.H), 0); d = ImageDraw.Draw(t)
    f = ImageFont.truetype(FONT, 22); f.set_variation_by_axes([650, 100]) if hasattr(f, "set_variation_by_axes") else None
    d.text((32 * SS, (GY - 26) * SS), "here", font=f, fill=255, anchor="mm")
    d.text((32 * SS, (GY - 19) * SS), "lies", font=f, fill=255, anchor="mm")
    t = t.rotate(4.5, center=(32 * SS, (GY - 4) * SS))
    lay = Image.new("RGBA", (cv.W, cv.H), H(RAMPS["wood"][3]) + (0,)); lay.putalpha(t); cv.img = Image.alpha_composite(cv.img, lay)
    heart_(cv, 32.5, GY - 10.5, 2.6)
    # daisy that bobs
    bob = math.sin(k / n * 6.283) * 0.8
    cv.line([(14, GY - 3), (13 + bob, GY - 12)], H(RAMPS["leaf"][2]), 0.9)
    fl = rstar(13 + bob, GY - 13, 3.6, 1.8, 6, 0.3, p=0.8)
    cv.part(fl, RP("cloth_cream"), lw=0.6, shade=0.1); cv.part(circle(13 + bob, GY - 13, 1.2, 12), RP("gold"), lw=0.4)
    # candle in a jar (flicker -> emissive)
    jx = 49
    cv.part(rrect(jx - 3.5, GY - 11, jx + 3.5, GY - 2, 2), [(240, 252, 255), (210, 236, 244), (160, 200, 220), (100, 140, 170)], lw=0.7, shade=0.15)
    cv.part(rrect(jx - 1.4, GY - 8, jx + 1.4, GY - 3, 0.8), RP("cloth_cream"), lw=0.4)
    fh = [1.0, 1.25, 0.9, 1.15][k]
    flame = [(jx, GY - 8 - 4.2 * fh)] + [(jx + math.cos(a) * 1.4, GY - 8.6 + math.sin(a) * 1.2) for a in np.linspace(0, math.pi, 10)]
    cv.part(flame, RP("fire"), lw=0.4, shade=0.1, hl=0.2, ink=H(RAMPS["fire"][3]))
    e.fill(flame, (255, 220, 120)); None; glow(cv, jx, GY - 9, 5, (255, 220, 140), 0.25 * fh)
    return cv, e

def loot_glow(rar, pal, k, n=6):
    cv = blank(64, 64, 51); e = blank(64, 64); c = H(pal["rarity"][rar]["color"]); l = H(pal["rarity"][rar]["light"])
    inten = pal["rarity"][rar]["glowIntensity"]; ph = k / n * 6.283; pul = 0.85 + 0.15 * math.sin(ph)
    glow(cv, 32, GY - 4, 14 * pul, l, 0.55 * min(1, inten)); None
    ring = arc_band(32, GY - 4, 13 + 2 * math.sin(ph), 6.5 + math.sin(ph), 0, 6.2832, 1.4, 1.4, 60)
    cv.fill(ring, l, alpha=200); e.fill(ring, l, alpha=220)
    for j in range(3 + 2 * pal["rarity"][rar]["index"] // 2):   # motes rising
        t = (k / n + j / 5) % 1; x = 32 + math.cos(j * 2.3) * 10; y = GY - 6 - t * 26
        r = 1.5 * math.sin(t * math.pi) + 0.3
        cv.fill(circle(x, y, r, 12), l, alpha=230); e.fill(circle(x, y, r + 0.5, 12), c)
    if pal["rarity"][rar]["sparkles"]:
        for j in range(3):
            t = (k / n + j / 3) % 1; s = math.sin(t * math.pi)
            twinkle(cv, 32 + math.cos(j * 2.1 + 0.4) * 16, GY - 14 - j * 6, 3.2 * s + 0.5, l, e=e, ecol=c)
    return cv, e

def drop_bounce(k, n=6):
    cv = blank(64, 64, 61 + k); e = blank(64, 64)
    if k <= 3:
        rr = 6 + k * 5; band = arc_band(32, GY - 4, rr, rr * 0.45, 0, 6.2832, 2 - k * 0.4, 2 - k * 0.4, 50)
        cv.fill(band, (255, 246, 214), alpha=230 - k * 40)
    for j in range(3):
        if 1 <= k: puff(cv, 32 + (j - 1) * (8 + k * 2.5), GY - 4 - k * 1.2 - (j % 2) * 2, max(0, 3.2 - abs(k - 2) * 0.9), 4 + j, DUST, lw=0.7)
    for j in range(5):
        a = -math.pi / 2 + (j - 2) * 0.55; d = 6 + k * 4
        s = [1.2, 2.8, 3.2, 2.6, 1.8, 0.9][k]
        twinkle(cv, 32 + math.cos(a) * d, GY - 10 + math.sin(a) * d * 0.9 + k * k * 0.25, s, (255, 248, 210), rot=j, e=e, ecol=(255, 236, 170))
    return cv, e

def beam_tex(k, n=6, w=32, h=128):
    """vertical loot beam, white, tileable in v; frames scroll motes upward by h/n per frame."""
    cv = blank(w, h, 71)
    x = np.linspace(-1, 1, w * SS); prof = np.exp(-(x / 0.42) ** 2) * 0.75 + np.exp(-(x / 0.12) ** 2) * 0.5
    a = np.clip(np.tile(prof[None, :], (h * SS, 1)), 0, 1)
    img = np.zeros((h * SS, w * SS, 4), np.uint8); img[..., :3] = 255; img[..., 3] = (a * 220).astype(np.uint8)
    cv.img = Image.fromarray(img)
    rng = np.random.default_rng(3); off = k / n * h
    for j in range(10):
        bx = w / 2 + (rng.random() - 0.5) * w * 0.5; by = (rng.random() * h - off) % h; r = 0.9 + rng.random() * 1.4
        for dy in (-h, 0, h):
            if j % 3 == 0: cv.fill(sparkle(bx, by + dy, r * 1.9, 0.22), (255, 255, 255))
            else: cv.fill(circle(bx, by + dy, r, 12), (255, 255, 255), alpha=230)
    return cv

def build():
    pal = rarity_palette(); json.dump(pal, open(os.path.join(ROOT, "rarity_palette.json"), "w"), indent=1)
    sh = Sheet("pvp_loot", 64, 64, 12, category="vfx", pivot=(0.5, GY / 64)); sprites = []; idx = 0
    def group(key, fn, n, fps, loop=True, cat="vfx", piv=GY / 64):
        nonlocal idx
        if idx % 12 + n > 12: idx = (idx // 12 + 1) * 12
        fr = []
        for k in range(n):
            cv, e = fn(k, n); sh.add(f"{key}/idle/{k}", cv.img, e.img, idx=idx, pivot=(0.5, piv)); fr.append(idx); idx += 1
        sprites.append({"key": key, "category": cat, "atlas": "pvp_loot", "anchor": {"x": 0.5, "y": round(piv, 4)}, "animations": {"idle": {"frames": fr, "fps": fps, "loop": loop}}})
    for s in ("small", "medium", "large"): group(f"loot_sack_{s}", lambda k, n, s=s: loot_sack(s, k, n), 6, 6, cat="item")
    group("grave_marker", grave, 4, 6, cat="item")
    for r in pal["order"]: group(f"loot_glow_{r}", lambda k, n, r=r: loot_glow(r, pal, k, n), 6, 8)
    group("fx_item_drop_bounce", drop_bounce, 6, 14, loop=False)
    sh.sprites = sprites
    bm = Sheet("pvp_loot_beam", 32, 128, 6, category="vfx", pivot=(0.5, 1.0), sharpen=False); bm.edge_fade = False
    for k in range(6):
        cv = beam_tex(k); bm.add(f"fx_loot_beam/idle/{k}", cv.img, idx=k)
        if k == 0:
            downscale(cv.img, (32, 128), False).save(os.path.join(TEX, "loot_beam.png")); downscale(cv.img, (64, 256), False).save(os.path.join(TEX, "loot_beam@2x.png"))
    bm.sprites = [{"key": "fx_loot_beam", "category": "vfx", "atlas": "pvp_loot_beam", "anchor": {"x": 0.5, "y": 1.0}, "animations": {"idle": {"frames": list(range(6)), "fps": 8}}}]
    return {"loot": sh, "beam": bm, "pal": pal}

if __name__ == "__main__":
    o = build()
    for k in ("loot", "beam"): print(o[k].save(), o[k].warnings[:4])
