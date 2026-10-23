import sys, os, math, random
sys.path.insert(0, os.path.dirname(__file__))
from stallview import *
P = R + "/preview"; os.makedirs(P, exist_ok=True)
def tile(key): s = MSPR[key]; return cell(MATL[s["atlas"]], s["animations"]["idle"]["frames"][0]), s
def ground(W, H, ox, oy, n=14, path=None):
    c = Image.new("RGBA", (W, H), (122, 176, 92, 255)); rnd = random.Random(3)
    for s_ in range(-n, 2 * n):
        for x in range(-n, n + 1):
            y = s_ - x
            if not -n <= y <= n: continue
            key = "tile_dirt" if path and path(x, y) else rnd.choice(["tile_grass", "tile_grass_b", "tile_grass_c"])
            t, sp = tile(key); sx, sy = ox + (x - y) * 32, oy + (x + y) * 16
            if -64 < sx < W + 64 and -48 < sy < H + 48: c.alpha_composite(t, (int(sx - 32), int(sy - 16)))
    return c
GOODS = [("berries", 3), ("wood", 1), ("stone_axe", 12), ("cooked_meat", 4), ("rope", 2), ("iron_ingot", 9), ("bandage", 5), ("planks", 2), ("cloth", 3), ("bronze_sword", 30), ("water_flask", 2), ("nails", 1)]
def scr(x, y, ox, oy): return ox + (x - y) * 32, oy + (x + y) * 16
def scene(night=False, out="market_day.png", scale=2):
    W, H = 1280, 720; ox, oy = 640 // scale + 10, 120 // scale + 85
    g = ground(W // scale, H // scale, ox, oy, 14, path=lambda x, y: abs(x - y) <= 1 or abs(x + y - 6) <= 0)
    emis = Image.new("RGBA", g.size, (0, 0, 0, 0))
    G = GOODS * 3
    # (key, front-corner world pos (x,y), state, rot, clan, listings, name)  -- sorted by depth (x+y)
    items = [
        ("clan_pavilion", (-2, 3), "open", 0, ("#E8475F", "#F6EAD2"), G[:24], "Berry Clan"),
        ("clan_pavilion", (5, -1), "open", 1, ("#4F8FD6", "#FFD45A"), G[3:27], "Sky Traders"),
        ("stall_booth_thatch", (1, 6), "open", 0, None, G[:12], "Mabel's Pantry"),
        ("stall_booth_redroof", (7, 2), "closed", 1, None, None, "Iron Ivo"),
        ("stall_cart_pine_red", (-2, 6), "open", 0, None, G[4:12], "Pip's Cart"),
        ("stall_cart_dark_teal", (5, 6), "open", 1, None, G[1:9], "Teal & Tea"),
        ("stall_cart_sunny", (10, 0), "closed", 0, None, None, "Sunny Sprouts"),
        ("stall_blanket_patch", (3, 9), "open", 0, None, G[5:9], "Odds"),
        ("stall_blanket_gingham", (0, 9), "open", 0, None, G[8:12], "Bo"),
        ("stall_blanket_picnic", (8, 7), "open", 0, None, G[0:4], "Fern"),
        ("stall_rent_marker", (-1, 11), None, 0, None, None, None),
        ("stall_lantern", (2, 4), None, 0, None, None, None),
    ]
    prompts = []
    items.sort(key=lambda t: t[1][0] + t[1][1])
    for key, (x, y), st, rot, clan, L, name in items:
        sx, sy = scr(x, y, ox, oy)
        if st: draw_sprite(g, key, sx, sy, st, rot, 0, 1, clan, L, name, emis)
        else: draw_sprite(g, key, sx, sy, emis=emis, anim="lit" if key == "stall_lantern" else None)
        if st == "open" and key.startswith("stall_b") and "blanket" not in key or (st and "pavilion" in key):
            pass
        # world prompts above stalls
        s = SPR[key]
        if st: prompts.append((key, sx, sy, st))
    for key, sx, sy, st in prompts:
        s = SPR[key]
        if st:
            hgt = ATL[s["atlas"]]["frameH"] * s["anchor"]["y"]
            pk = "stall_prompt_open" if st == "open" else "stall_badge_closed"
            draw_sprite(g, pk, sx, sy - hgt - 6 + (0 if st == "open" else 12))
            if st == "closed":
                ImageDraw.Draw(g).text((sx + 7, sy - hgt + 6), "Closed", font=font(9), fill=(246, 234, 210), anchor="mm")
    sx, sy = scr(3, 9, ox, oy); draw_sprite(g, "stall_badge_sold_out", sx + 30, sy - 40); ImageDraw.Draw(g).text((sx + 37, sy - 40), "Sold out", font=font(8), fill=(255, 250, 240), anchor="mm")
    if night:
        a = np.asarray(g, np.float32)
        a[..., :3] *= np.array([0.36, 0.34, 0.55]); a[..., 2] += 18
        g = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
        e = emis.copy(); ea = np.asarray(e).copy(); ea[ea[..., 3] < 100] = 0; e = Image.fromarray(ea); g.alpha_composite(e)
        def gblur(x, r):
            k = np.exp(-0.5 * (np.arange(-3 * r, 3 * r + 1) / r) ** 2); k /= k.sum()
            x = np.apply_along_axis(lambda v: np.convolve(v, k, "same"), 0, x); return np.apply_along_axis(lambda v: np.convolve(v, k, "same"), 1, x)
        ef = np.asarray(e, np.float32) / 255; prem = ef[..., :3] * ef[..., 3:]
        add = np.zeros_like(prem)
        for r_, w_ in ((3, 1.4), (10, 2.6)):
            add += np.stack([gblur(prem[..., c], r_) for c in range(3)], -1) * 255 * w_
        hot = (ef[..., 3] > 0.55).astype(np.float32); pool = gblur(hot, 22); pool = np.clip(pool / max(1e-6, pool.max()) * 2.0, 0, 1)[..., None]
        add += pool * np.array([140, 95, 45], np.float32)
        gg = np.asarray(g, np.float32); gg[..., :3] = np.clip(gg[..., :3] + add, 0, 255); g = Image.fromarray(gg.astype(np.uint8))
    g = g.resize((W, H), Image.NEAREST)
    g.convert("RGB").save("/tmp/_bg_" + out)
    d = ImageDraw.Draw(g); d.text((16, 16), ("Night" if night else "Day") + " market: player stalls + clan pavilions (Berry Clan red/cream, Sky Traders blue/gold), 2x nearest", font=font(16), fill=(255, 250, 240), stroke_width=2, stroke_fill=INK)
    g.convert("RGB").save(P + "/" + out); print("wrote", out)

def contact():
    W = 1600; rows = []; pad = 8
    bg = (196, 226, 160)
    tiles = []
    for key in [k for k in SPR if "building" in SPR[k]]:
        s = SPR[key]; atl = ATL[s["atlas"]]
        strip = Image.new("RGBA", ((atl["frameW"] + pad) * 8, atl["frameH"] + 18), bg + (255,))
        for i, (st, dmg, rot) in enumerate([(st, d, 0) for st in ("open", "closed") for d in range(4)]):
            c = Image.new("RGBA", (atl["frameW"], atl["frameH"]), (0, 0, 0, 0))
            draw_sprite(c, key, atl["frameW"] // 2, atl["frameH"] - 8, st, rot if i else 0, dmg, 1, ("#9B72D6", "#FFD45A") if "clan" in key else None, GOODS * 2 if i == 0 else None, "Name Here" if i == 0 else None)
            strip.alpha_composite(c, (i * (atl["frameW"] + pad), 18))
        ImageDraw.Draw(strip).text((4, 2), f"{key}  open d0-3 | closed d0-3", font=font(12), fill=INK)
        tiles.append(strip)
    # props row
    pr = Image.new("RGBA", (1600, 110), bg + (255,)); x = 40
    for key, anim, n in [("stall_price_tag", None, 1), ("stall_shop_sign", None, 1), ("stall_shop_sign", "scroll", 1), ("stall_shop_sign", "aframe", 1), ("stall_coin_pouch", None, 1), ("stall_barter_scale", "tip", 2), ("stall_display_slot", None, 1), ("stall_lantern", "lit", 4), ("stall_shop_bell", "ring", 6), ("stall_rent_marker", None, 1), ("stall_prompt_open", None, 4), ("stall_badge_sold_out", None, 1), ("stall_badge_closed", None, 1)]:
        for f in range(n if n < 3 else 3):
            draw_sprite(pr, key, x, 92 if SPR[key]["category"] != "ui" or key == "stall_price_tag" or key == "stall_shop_sign" else 60, anim=anim, frame=f, clan=("#72C45C", "#FFFAF0") if key == "stall_shop_sign" else None)
            x += 62 if ATL[SPR[key]["atlas"]]["frameW"] < 96 else 92
    for k in ("coin", "coin_few", "coin_many"):
        pr.alpha_composite(item_icon(k, 64), (x, 30)); x += 70
    tiles.append(pr)
    H_ = sum(t.height for t in tiles) + 40
    sheet = Image.new("RGB", (max(t.width for t in tiles), H_), bg)
    y = 30
    for t in tiles: sheet.paste(t, (0, y), t); y += t.height
    ImageDraw.Draw(sheet).text((6, 6), "stalls contact sheet (1x; open state shows renderer-simulated goods icons, price text, sign name; clan pieces tinted Plum & Gold)", font=font(14), fill=INK)
    sheet.save(P + "/contact_sheet.png"); print("contact", sheet.size)
if __name__ == "__main__":
    contact(); scene(False, "market_day.png"); scene(True, "market_night.png")
