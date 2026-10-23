"""Preview scene, contact sheets and GIFs into /workspace/assets/preview/."""
import os, sys, json, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from PIL import Image, ImageDraw, ImageFont
from atlas import ROOT
from palette import RAMPS, hex2rgb
SP = os.path.join(ROOT, "sprites"); PV = os.path.join(ROOT, "preview"); os.makedirs(PV, exist_ok=True)
M = json.load(open(os.path.join(ROOT, "manifest.json")))
ATL = {a["key"]: a for a in M["atlases"]}; SPR = {s["key"]: s for s in M["sprites"]}
_sheet = {}
def frame(key, anim="idle", fi=0, d=0, rot=None, stage=0):
    s = SPR[key]; a = ATL[s["atlas"]]
    if a["key"] not in _sheet: _sheet[a["key"]] = Image.open(os.path.join(ROOT, a["image"])).convert("RGBA")
    if rot is not None: idx = s["building"]["frames"][rot if len(s["building"]["frames"]) > 1 else 0][stage]
    else:
        an = s["animations"][anim]; idx = an["frames"][fi % len(an["frames"])] + d * an.get("dirStride", a["columns"])
    x, y = (idx % a["columns"]) * a["frameW"], (idx // a["columns"]) * a["frameH"]
    return _sheet[a["key"]].crop((x, y, x + a["frameW"], y + a["frameH"])), (s["anchor"]["x"] * a["frameW"], s["anchor"]["y"] * a["frameH"])
try: FONT = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 11); FONT_B = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 16)
except Exception: FONT = FONT_B = ImageFont.load_default()

_hands = {}
def with_held(im, key, anim, fi, d, held):
    """attach a held_* sprite at the frame's hand anchor (atlases/<atlas>.hands.json), rotated by angle."""
    s = SPR[key]; a = ATL[s["atlas"]]; an = s["animations"][anim]
    idx = an["frames"][fi % len(an["frames"])] + d * an.get("dirStride", a["columns"])
    if a["key"] not in _hands: _hands[a["key"]] = json.load(open(os.path.join(ROOT, "atlases", a["key"] + ".hands.json")))["hands"]
    h = _hands[a["key"]].get(str(idx))
    if not h: return im
    hs = SPR[held]; ha = ATL[hs["atlas"]]
    hidx = hs["animations"]["idle"]["frames"][0] + d * hs["animations"]["idle"].get("dirStride", ha["columns"])
    if ha["key"] not in _sheet: _sheet[ha["key"]] = Image.open(os.path.join(ROOT, ha["image"])).convert("RGBA")
    x, y = (hidx % ha["columns"]) * ha["frameW"], (hidx // ha["columns"]) * ha["frameH"]
    tool = _sheet[ha["key"]].crop((x, y, x + ha["frameW"], y + ha["frameH"]))
    px, py = hs["anchor"]["x"] * ha["frameW"], hs["anchor"]["y"] * ha["frameH"]
    big = Image.new("RGBA", (ha["frameW"] * 2, ha["frameH"] * 2), (0, 0, 0, 0)); big.alpha_composite(tool, (int(ha["frameW"] - px), int(ha["frameH"] - py)))
    big = big.rotate(-h["angle"], resample=Image.BICUBIC, center=(ha["frameW"], ha["frameH"]))
    out = Image.new("RGBA", im.size, (0, 0, 0, 0)); pos = (int(round(h["x"] - ha["frameW"])), int(round(h["y"] - ha["frameH"])))
    layer = Image.new("RGBA", im.size, (0, 0, 0, 0)); layer.alpha_composite(big, (0, 0)) if False else None
    canvas = Image.new("RGBA", (im.width + 200, im.height + 200), (0, 0, 0, 0))
    if h.get("behind"): canvas.alpha_composite(big, (pos[0] + 100, pos[1] + 100)); canvas.alpha_composite(im, (100, 100))
    else: canvas.alpha_composite(im, (100, 100)); canvas.alpha_composite(big, (pos[0] + 100, pos[1] + 100))
    return canvas.crop((100, 100, 100 + im.width, 100 + im.height))

def scene(t=0, night=False, out="preview.png", scale=2):
    N = 14; W, H = 940, 600; ox, oy = W // 2, 70
    img = Image.new("RGBA", (W, H), hex2rgb("#2f2338") + (255,))
    # backdrop gradient
    d = ImageDraw.Draw(img)
    for y in range(H): c = [int(a + (b - a) * y / H) for a, b in zip(hex2rgb("#3b2c4a"), hex2rgb("#24192c"))]; d.line([(0, y), (W, y)], fill=tuple(c) + (255,))
    P = lambda x, y, z=0: (ox + (x - y) * 32, oy + (x + y) * 16 - z * 16)
    def tile_at(x, y):
        if x >= 10 and y <= 2: return "tile_water" if (x >= 11 and y <= 1) else None
        if x + y < 2: return "tile_forest"
        if 6 <= y <= 7 and x < 6: return "tile_dirt"
        if y >= 12 and x >= 9: return "tile_sand"
        return ["tile_grass", "tile_grass", "tile_grass_b", "tile_grass_c"][(x * 7 + y * 13 + x * y) % 4]
    shore = {(10, 0): "tile_shore_w", (10, 1): "tile_shore_w", (10, 2): "tile_shore_nw", (11, 2): "tile_shore_n", (12, 2): "tile_shore_n", (13, 2): "tile_shore_n"}
    for y in range(N):
        for x in range(N):
            k = shore.get((x, y)) or tile_at(x, y)
            if k is None: k = "tile_water_shallow"
            im, (ax, ay) = frame(k, "idle", t)
            px, py = P(x + 0.5, y + 0.5); img.alpha_composite(im, (int(px - ax), int(py - ay)))
    objs = []
    def put(key, wx, wy, anim="idle", fi=0, d=0, rot=None, stage=0, bias=0.0, z=0, held=None):
        if key not in SPR: print("preview: missing", key); return
        if rot is None and "building" in SPR[key] and anim not in SPR[key]["animations"]: anim = "idle"
        objs.append((wx + wy + bias, key, wx, wy, anim, fi, d, rot, stage, z, held))
    # ---- wood cabin (1-tile gameplay cells): floor 3x3 at tiles bx..bx+2, by..by+2; walls on cell edges
    bx, by = 4, 2
    for i in range(3):
        for j in range(3): put("floor", bx + i + 0.5, by + j + 0.5, rot=0, bias=-50)
    put("rug_2", bx + 1.5, by + 1.5, rot=0, bias=-40)
    put("wall_corner", bx, by, rot=0, bias=-0.7)
    for i, k in enumerate(("wall", "wall_window", "wall")): put(k, bx + i + 0.5, by, rot=0, bias=-0.6)
    for j, k in enumerate(("wall_window", "wall", "wall_low")): put(k, bx, by + j + 0.5, rot=1, bias=-0.6, stage=1 if j == 1 else 0)
    put("wall_doorway", bx + 3, by + 0.5, rot=1, bias=0.3); put("door_wood", bx + 3, by + 0.5, rot=1, bias=0.35)
    put("wall_window", bx + 3, by + 1.5, rot=1, bias=0.3); put("wall_low", bx + 3, by + 2.5, rot=1, bias=0.3, stage=2)
    put("wall_low", bx + 0.5, by + 3, rot=0, bias=0.3); put("wall_low", bx + 2.5, by + 3, rot=0, stage=3, bias=0.3)
    put("pillar", bx + 3, by + 3, rot=0, bias=0.4)
    put("bed", bx + 0.5, by + 1.0, rot=0); put("storage_box", bx + 2.5, by + 0.5, rot=1); put("shelf", bx + 1.5, by + 0.35, rot=0)
    put("table", bx + 1.6, by + 2.2, rot=0); put("chair", bx + 1.0, by + 2.3, rot=1); put("potted_plant", bx + 2.6, by + 2.5, rot=0)
    put("painting_3", bx + 0.8, by + 0.12, rot=0, bias=-0.5)
    # crafting yard
    put("workbench", bx + 5.0, by + 1.0, rot=0); put("furnace", bx + 6.6, by + 2.4, anim="idle", fi=t); put("anvil", bx + 5.4, by + 2.6, rot=0)
    put("loom", bx + 4.6, by + 4.4, rot=0); put("cooking_pot", bx + 6.5, by + 4.3, anim="idle", fi=t); put("flower_box_3", bx + 3.6, by + 3.6, rot=0)
    # tier showcase row (twig / wood / stone / metal) + stone hut with roof
    for i, tr in enumerate(("_twig", "", "_stone", "_metal")):
        put("foundation" + tr, 0.5 + i, 7.5, rot=0, bias=-40); put("wall" + tr, 0.5 + i, 7.0, rot=0, bias=-0.6)
    put("stairs_stone", 4.5, 7.5, rot=0)
    hx, hy = 1, 9
    for i in range(2):
        for j in range(2): put("floor_stone", hx + i + 0.5, hy + j + 0.5, rot=0, bias=-50)
    put("wall_stone", hx + 0.5, hy, rot=0, bias=-0.6); put("wall_window_stone", hx + 1.5, hy, rot=0, bias=-0.6)
    put("wall_stone", hx, hy + 0.5, rot=1, bias=-0.6); put("wall_window_stone", hx, hy + 1.5, rot=1, bias=-0.6)
    put("wall_doorway_stone", hx + 2, hy + 0.5, rot=1, bias=0.2); put("door_metal", hx + 2, hy + 0.5, rot=1, bias=0.25); put("wall_stone", hx + 2, hy + 1.5, rot=1, bias=0.2)
    put("wall_stone", hx + 0.5, hy + 2, rot=0, bias=0.2); put("wall_window_stone", hx + 1.5, hy + 2, rot=0, bias=0.2)
    put("roof_corner_stone", hx + 0.5, hy + 0.5, rot=2, bias=3, z=3); put("roof_corner_stone", hx + 1.5, hy + 0.5, rot=3, bias=3, z=3)
    put("roof_corner_stone", hx + 1.5, hy + 1.5, rot=0, bias=3, z=3); put("roof_corner_stone", hx + 0.5, hy + 1.5, rot=1, bias=3, z=3)
    put("flower_box", hx + 2.6, hy + 2.5, rot=0)
    for (k, x, y) in [("tree", 1.5, 3.4), ("tree_pine", 0.5, 5.6), ("tree_pine", 2.4, 0.5), ("tree_autumn", 12.8, 5.4), ("pine_young", 13.4, 8.6),
                      ("tree_twisty", 9.6, 0.6), ("tree_apple", 6.0, 13.3), ("tree_sapling", 8.6, 1.4), ("tree_young", 0.6, 13.2), ("oak_tree", 13.0, 12.6)]: put(k, x, y)
    for (k, x, y) in [("boulder", 10.6, 4.3), ("copper_vein", 11.6, 4.9), ("gold_vein", 12.6, 3.4), ("clay_deposit", 9.0, 13.2), ("blueberry_bush", 5.0, 11.4),
                      ("berry_bush", 3.6, 8.6), ("fiber_grass", 11.8, 7.3), ("pumpkin_patch", 7.6, 12.6), ("mushrooms", 2.8, 4.8), ("glow_mushrooms", 11.6, 13.2),
                      ("flowers", 7.6, 8.4), ("reeds", 10.4, 3.1), ("carrot_patch", 4.2, 12.8), ("wild_herbs", 0.6, 8.6), ("flax", 13.3, 11.0), ("tin_vein", 9.8, 5.2)]:
        put(k, x, y)
    put("bonfire", 9.6, 7.0, anim="idle", fi=t)
    put("player", 8.7, 7.9, "run", t, 1, held="held_iron_sword"); put("player_b", 4.4, 9.4, "gather", t, 3, held="held_stone_pickaxe"); put("player_c", 7.4, 10.4, "attack", t, 1, held="held_bronze_axe")
    put("zombie_walker", 11.6, 8.2, "walk", t, 3); put("zombie_brute", 10.2, 11.0, "walk", t + 1, 4); put("zombie_runner", 8.3, 12.0, "run", t + 2, 5)
    put("zombie_mummy", 12.4, 9.6, "walk", t, 3); put("zombie_pumpkin", 11.2, 10.1, "attack", t, 2); put("zombie_walker", 6.4, 11.8, "feed", t, 1)
    put("critter_bunny", 3.0, 11.9, "hop", t, 1); put("critter_chick", 6.4, 8.9, "idle", t, 0); put("critter_frog", 10.8, 2.6, "idle", t, 1); put("critter_hedgehog", 2.4, 6.4, "idle", t, 2)
    for _, key, wx, wy, anim, fi, dd, rot, stage, z, held in sorted(objs, key=lambda o: o[0]):
        im, (ax, ay) = frame(key, anim, fi, dd, rot, stage)
        if held: im = with_held(im, key, anim, fi, dd, held)
        if SPR[key]["category"] in ("character", "zombie", "critter"):
            sh, (sx, sy) = frame("fx_shadow_blob"); px, py = P(wx, wy); img.alpha_composite(sh, (int(px - sx), int(py - sy)))
        px, py = P(wx, wy, z); img.alpha_composite(im, (int(px - ax), int(py - ay)))
    # fx accents
    for (k, x, y, z) in [("fx_firefly", 12.0, 12.0, 1.8), ("fx_firefly", 11.2, 12.8, 2.5), ("fx_leaf", 12.2, 6.4, 3), ("fx_spark", 8.0, 11.0, 1.4), ("fx_smoke", 9.4, 6.6, 3.6), ("fx_dust", 10.9, 9.6, 0.4)]:
        im, (ax, ay) = frame(k, "idle", t + int(x)); px, py = P(x, y, z); img.alpha_composite(im, (int(px - ax), int(py - ay)))
    d = ImageDraw.Draw(img)
    d.text((14, 12), "Cozy-Wild pack wave 2 - preview scene (1x, 64x32 iso tiles, 1-tile build cells)", fill=hex2rgb(RAMPS["cloth_cream"][1]), font=FONT_B)
    img.save(os.path.join(PV, out))
    img.convert("RGB").resize((W * scale, H * scale), Image.NEAREST).save(os.path.join(PV, out.replace(".png", "_2x.png")))
    return img

def contact(atlas_key, zoom=2, bg="#e9dfc9"):
    a = ATL[atlas_key]; sheet = Image.open(os.path.join(ROOT, a["image"])).convert("RGBA")
    fw, fh = a["frameW"], a["frameH"]; cols, rows = a["columns"], a["rows"]
    pad = 2; lab = 12
    W = cols * (fw + pad) + pad; H = rows * (fh + pad) + pad + 22
    out = Image.new("RGBA", (W, H), hex2rgb(bg) + (255,)); d = ImageDraw.Draw(out)
    names = {}
    tp = json.load(open(os.path.join(ROOT, "atlases", atlas_key + ".json")))
    for n, f in tp["frames"].items(): names[f["index"]] = n
    for i in range(cols * rows):
        x, y = pad + (i % cols) * (fw + pad), 22 + pad + (i // cols) * (fh + pad)
        # checker
        for cy in range(0, fh, 8):
            for cx in range(0, fw, 8):
                if (cx // 8 + cy // 8) % 2: d.rectangle([x + cx, y + cy, x + min(fw, cx + 8) - 1, y + min(fh, cy + 8) - 1], fill=hex2rgb("#ddd0b4"))
        out.alpha_composite(sheet.crop(((i % cols) * fw, (i // cols) * fh, (i % cols + 1) * fw, (i // cols + 1) * fh)), (x, y))
    d.text((4, 4), f"{atlas_key}  ({fw}x{fh} x {cols}x{rows})", fill=hex2rgb(RAMPS["ink"][2]), font=FONT)
    out = out.resize((W * zoom, H * zoom), Image.NEAREST)
    out.save(os.path.join(PV, f"contact_{atlas_key}.png"))

def gif(name, frames_fn, n, fps, zoom=3, bg="#9fd36a"):
    fr = []
    for i in range(n):
        im = frames_fn(i); base = Image.new("RGBA", im.size, hex2rgb(bg) + (255,)); base.alpha_composite(im)
        fr.append(base.convert("RGB").resize((im.width * zoom, im.height * zoom), Image.NEAREST))
    fr[0].save(os.path.join(PV, name), save_all=True, append_images=fr[1:], duration=int(1000 / fps), loop=0)

def row_of(keyframes):
    ims = [frame(*k)[0] for k in keyframes]; W = sum(i.width for i in ims); H = max(i.height for i in ims)
    out = Image.new("RGBA", (W, H), (0, 0, 0, 0)); x = 0
    for im in ims: out.alpha_composite(im, (x, H - im.height)); x += im.width
    return out

def main():
    scene(0)
    import shutil; shutil.copy(os.path.join(PV, "preview.png"), os.path.join(ROOT, "preview.png"))
    for a in ATL:
        if a in ("fog",): continue
        try: contact(a, 1 if ATL[a]["frameW"] >= 96 else 2)
        except FileNotFoundError: pass
    gif("player_walk.gif", lambda i: row_of([("player", "walk", i, d) for d in range(8)]), 6, 10)
    gif("player_variants_actions.gif", lambda i: row_of([("player", "attack", i % 4, 0), ("player_b", "gather", i % 4, 1), ("player_c", "idle", i % 4, 2), ("player", "walk", i, 3)]), 12, 8)
    gif("zombies_walk.gif", lambda i: row_of([("zombie_walker", "walk", i, 1), ("zombie_brute", "walk", i, 1), ("zombie_runner", "walk", i, 1), ("zombie_walker", "walk", i, 0), ("zombie_brute", "walk", i, 2), ("zombie_runner", "walk", i, 7)]), 6, 7)
    gif("zombies_attack_death.gif", lambda i: row_of([("zombie_walker", "attack", i % 4, 1), ("zombie_brute", "hurt", i % 2, 1), ("zombie_runner", "death", min(i, 5), 1)]), 8, 8)
    def water(i):
        im = Image.new("RGBA", (64 * 4, 32 * 3 + 16), (0, 0, 0, 0))
        for y in range(3):
            for x in range(3):
                k = "tile_water" if x + y > 1 else ("tile_shore_nw" if x + y == 0 else "tile_shore_n" if x else "tile_shore_w")
                f, _ = frame(k, "idle", i); im.alpha_composite(f, (64 + (x - y) * 32, (x + y) * 16))
        return im
    gif("water.gif", water, 4, 4)
    gif("fires.gif", lambda i: row_of([("bonfire", "idle", i), ("furnace", "idle", i), ("cooking_pot", "idle", i), ("fx_fire_big", "idle", i), ("fx_fire_huge", "idle", i)]), 6, 10, zoom=2, bg="#3b2c4a")
    gif("zombies_wave2.gif", lambda i: row_of([("zombie_mummy", "walk", i, 1), ("zombie_pumpkin", "walk", i, 1), ("zombie_runner", "run", i, 1), ("zombie_walker", "crawl", i, 1), ("zombie_walker", "feed", i % 4, 1), ("zombie_brute", "run", i, 2)]), 6, 8)
    gif("player_run_held.gif", lambda i: row_of([with_held(*frame("player", "run", i, d)[:1], "player", "run", i, d, "held_iron_sword") for d in range(8)] if False else [("player", "run", i, d) for d in range(8)]), 6, 14)
    gif("critters.gif", lambda i: row_of([(k, an, i % 4, 1) for k in ("critter_bunny", "critter_chick", "critter_frog", "critter_hedgehog") for an in ("idle",)]), 4, 6, zoom=4)
    gif("bunny.gif", lambda i: row_of([("critter_bunny", "hop", i % 4, d) for d in range(4)] + [("critter_bunny", "idle", i % 4, d) for d in range(2)]), 8, 8, zoom=4)
    gif("fx.gif", lambda i: row_of([(k, "idle", i) for k in ("fx_spark", "fx_dust", "fx_poof", "fx_fire", "fx_smoke", "fx_leaf", "fx_rain_splash", "fx_firefly")]), 8, 10, zoom=4, bg="#5a7a5a")
    # animated scene
    fr = [scene(i, out=f"_scene_{i}.png").convert("RGB") for i in range(6)]
    fr[0].save(os.path.join(PV, "scene.gif"), save_all=True, append_images=fr[1:], duration=120, loop=0)
    for i in range(6):
        for s in ("", "_2x"): os.remove(os.path.join(PV, f"_scene_{i}{s}.png"))

if __name__ == "__main__": main()
