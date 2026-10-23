"""Preview renders for pvp_clan: contact sheets, raid test scene, GIFs, font sample. Output: pvp_clan/preview/"""
import os, sys, json, math
import numpy as np
from PIL import Image, ImageDraw, ImageFont
sys.path.insert(0, os.path.dirname(__file__))
from common import ROOT, ATL, PREV, apply_tint, H

FRAG = json.load(open(os.path.join(ROOT, "manifest.fragment.json")))
ATLAS = {a["key"]: a for a in FRAG["atlases"]}; SPR = {s["key"]: s for s in FRAG["sprites"]}
CLANS = json.load(open(os.path.join(ROOT, "clan_palettes.json")))["palettes"]
FONT = "/workspace/assets/pvp_clan/fonts/nameplate_Nunito.ttf"
BG = (126, 170, 96); INK = (59, 36, 51)
_cache = {}
def page(key, kind="", scale=2):
    p = os.path.join(ATL, f"{key}{kind}{'@2x' if scale == 2 else ''}.png")
    if p not in _cache: _cache[p] = Image.open(p).convert("RGBA" if kind != "_tintmask" else "RGB") if os.path.exists(p) else None
    return _cache[p]
def frame(sprite, idx, clan=None, scale=2, emissive=True):
    s = SPR[sprite]; a = ATLAS[s["atlas"]]; fw, fh = a["frameW"] * scale, a["frameH"] * scale
    box = ((idx % a["columns"]) * fw, (idx // a["columns"]) * fh); box = box + (box[0] + fw, box[1] + fh)
    im = page(a["key"], "", scale).crop(box)
    tm = page(a["key"], "_tintmask", scale)
    if tm is not None and clan is not None: im = apply_tint(im, tm.crop(box), clan[0], clan[1])
    em = page(a["key"], "_emissive", scale) if emissive else None
    if em is not None:
        e = np.asarray(em.crop(box), np.float32) / 255; b = np.asarray(im, np.float32) / 255
        b[..., :3] = np.clip(b[..., :3] + e[..., :3] * e[..., 3:4] * 0.35, 0, 1); im = Image.fromarray((b * 255).astype(np.uint8))
    return im
def anchor_px(sprite, scale=2):
    s = SPR[sprite]; a = ATLAS[s["atlas"]]; an = s.get("anchor", {"x": 0.5, "y": 0.9})
    return an["x"] * a["frameW"] * scale, an["y"] * a["frameH"] * scale
def font(sz): return ImageFont.truetype(FONT, sz)
def label(d, xy, t, sz=14, fill=INK): d.text(xy, t, font=font(sz), fill=fill)
def checker(w, h):
    im = Image.new("RGBA", (w, h), BG + (255,)); d = ImageDraw.Draw(im)
    for y in range(0, h, 16):
        for x in range(0, w, 16):
            if (x // 16 + y // 16) % 2: d.rectangle([x, y, x + 15, y + 15], fill=(118, 162, 90, 255))
    return im

# ---------------------------------------------------------------- contact sheets
def contact(name, title, sprites, clan_idx=0, cell=None, per_row=10, max_frames=8, all_dirs=False):
    clan = (CLANS[clan_idx]["primary"], CLANS[clan_idx]["secondary"])
    rows = []
    for k in sprites:
        s = SPR[k]; a = ATLAS[s["atlas"]]
        fr = []
        if s.get("building"):
            b = s["building"]; fr = list(b["frames"][0]) + (list(b["frames"][1]) if len(b["frames"]) > 1 else [])
            for st, rr in (b.get("states") or {}).items():
                if st != "closed": fr += list(rr[0])
            for n, an in s["animations"].items():
                if len(an["frames"]) > 1: fr += an["frames"][:6]
        else:
            for n, an in s["animations"].items():
                d = an.get("directions", 1); st = an.get("dirStride", a["columns"])
                if all_dirs and d > 1: fr += [an["frames"][min(2, len(an["frames"]) - 1)] + i * st for i in range(d)]
                else: fr += an["frames"][:max_frames]
        rows.append((k, fr[:per_row * 2], a))
    cw = max(a["frameW"] for _, _, a in rows) * 2 if cell is None else cell[0]; ch = max(a["frameH"] for _, _, a in rows) * 2 if cell is None else cell[1]
    lines = []
    for k, fr, a in rows:
        for i in range(0, len(fr), per_row): lines.append((k if i == 0 else "", fr[i:i + per_row], a, k))
    W = 170 + per_row * (cw + 6); Hh = 50 + sum(a["frameH"] * 2 + 10 for _, _, a, _ in lines)
    im = checker(W, Hh); d = ImageDraw.Draw(im); label(d, (10, 10), title + f"   (2x pages, tinted with clan palette '{CLANS[clan_idx]['key']}')", 18)
    y = 46
    for lab, fr, a, k in lines:
        label(d, (8, y + 4), lab, 13)
        for j, f in enumerate(fr):
            x = 170 + j * (cw + 6); fim = frame(k, f, clan)
            d.rectangle([x - 1, y - 1, x + fim.width, y + fim.height], outline=(104, 146, 80, 255))
            im.alpha_composite(fim, (x, y))
            ax, ay = anchor_px(k); d.line([x + ax - 3, y + ay, x + ax + 3, y + ay], fill=(255, 80, 120, 255)); d.line([x + ax, y + ay - 3, x + ax, y + ay + 3], fill=(255, 80, 120, 255))
        y += a["frameH"] * 2 + 10
    im.convert("RGB").save(os.path.join(PREV, name)); return name

def keys(pred): return [s["key"] for s in FRAG["sprites"] if pred(s)]

def all_contacts():
    out = []
    out.append(contact("contact_combat_swings.png", "Combat: swing arcs (8 facings E..NE, mid frame) + 5-frame swings", [f"fx_swing_{c}" for c in ("blade", "blunt", "axe", "spear")], all_dirs=True, per_row=8))
    out.append(contact("contact_combat_fx.png", "Combat FX: hits, bonk, crit, parry, block, dodge, KO, downed, respawn, projectiles, trails",
                       keys(lambda s: s["atlas"] in ("pvp_fx", "pvp_fx_tall", "pvp_projectiles", "pvp_trails")), per_row=12, max_frames=12))
    out.append(contact("contact_loot.png", "Death & loot: bindle/sacks S/M/L, here-lies marker, rarity glows, drop bounce, loot beam", keys(lambda s: s["atlas"] in ("pvp_loot", "pvp_loot_beam")), per_row=8))
    out.append(contact("contact_clan.png", "Clan: banners S/M/L (idle+flap), wall banner, claim totem (emissive rune), territory border", keys(lambda s: s["atlas"] in ("clan_banners", "clan_territory")), clan_idx=3, per_row=10))
    out.append(contact("contact_clan_b.png", "Clan: same pieces, palette sky_sun", keys(lambda s: s["atlas"] == "clan_banners"), clan_idx=1, per_row=10))
    out.append(contact("contact_emblems.png", "Clan emblems (24 single-channel masks; emblemId = index+1)", keys(lambda s: s["atlas"] == "clan_emblems"), per_row=1))
    out.append(contact("contact_buildings.png", "Reinforced tier: damage 0-3 (r0, then r1 mirrored); gate open/breached states; bell ring", keys(lambda s: s["atlas"] in ("clan_buildings",)), clan_idx=0, per_row=10))
    out.append(contact("contact_buildings_large.png", "Reinforced tier, multi-tile: gate_clan 2x1, clan_hall_door 2x1, watchtower 2x2", keys(lambda s: s["atlas"] in ("clan_gates", "clan_structures_large")), clan_idx=4, per_row=8))
    out.append(contact("contact_raid.png", "Raid: crack overlays, hit chips/splinters/dust, embers, smoke, repair, fire loops, rubble, collapse",
                       keys(lambda s: s["atlas"].startswith("raid_")), per_row=10, max_frames=10))
    out.append(contact("contact_worldui.png", "World UI: nameplate icons, nameplates per role, clan/party tag chips, chat bubbles per channel",
                       keys(lambda s: s["atlas"] in ("nameplate_icons", "nameplates", "nameplate_tags", "chat_bubbles")), clan_idx=0, per_row=1))
    return out

# emblem / UI contact in a grid instead of rows
def grid_contact(name, title, ks, cols=12, clan_idx=0):
    clan = (CLANS[clan_idx]["primary"], CLANS[clan_idx]["secondary"])
    ims = [(k, frame(k, SPR[k]["animations"]["idle"]["frames"][0], clan)) for k in ks]
    cw = max(i.width for _, i in ims) + 20; ch = max(i.height for _, i in ims) + 26
    W = cols * cw + 20; Hh = 50 + math.ceil(len(ims) / cols) * ch
    im = checker(W, Hh); d = ImageDraw.Draw(im); label(d, (10, 10), title, 18)
    for i, (k, f) in enumerate(ims):
        x = 10 + (i % cols) * cw; y = 46 + (i // cols) * ch
        im.alpha_composite(f, (x + (cw - 20 - f.width) // 2, y)); label(d, (x, y + f.height + 2), k.replace("emblem_", "").replace("nameplate_", "np_")[:16], 10)
    im.convert("RGB").save(os.path.join(PREV, name)); return name

def emblem_sheet():
    ks = keys(lambda s: s["atlas"] == "clan_emblems"); oa = page("clan_emblems_outline")
    ims = []
    for i, k in enumerate(ks):
        cl = CLANS[i % 16]; f = frame(k, i); b = np.asarray(f, np.float32) / 255
        rgb = np.array(H(cl["secondary"]), np.float32) / 255; card = Image.new("RGBA", f.size, H(cl["primary"]) + (255,))
        e = Image.fromarray((np.concatenate([np.broadcast_to(rgb, b.shape[:2] + (3,)), b[..., 3:4]], -1) * 255).astype(np.uint8))
        o = oa.crop(((i % 8) * 64, (i // 8) * 64, (i % 8) * 64 + 64, (i // 8) * 64 + 64))
        card.alpha_composite(o); card.alpha_composite(e); ims.append((k, card))
    W = 8 * 92 + 20; im = checker(W, 50 + 3 * 100); d = ImageDraw.Draw(im); label(d, (10, 10), "Clan emblems: mask (alpha) in clan secondary over primary field, ink ring from clan_emblems_outline", 15)
    for i, (k, c) in enumerate(ims):
        x = 14 + (i % 8) * 92; y = 46 + (i // 8) * 100; im.alpha_composite(c, (x + 10, y)); label(d, (x + 4, y + 68), k[7:], 12)
    im.convert("RGB").save(os.path.join(PREV, "contact_emblems.png"))

# ---------------------------------------------------------------- fonts (MSDF decode)
def msdf_text(fname, text, size, fill, stroke=INK, stroke_w=0.18):
    js = json.load(open(os.path.join(ROOT, "fonts", fname + ".json"))); atlas = np.asarray(Image.open(os.path.join(ROOT, "fonts", fname + ".png")).convert("RGB"), np.float32) / 255
    fs = js["info"]["size"]; rng = js["distanceField"]["distanceRange"]; sc = size / fs; ch = {c["char"]: c for c in js["chars"]}
    W = int(sum(ch.get(c, ch["?"])["xadvance"] for c in text) * sc + size); Hh = int(js["common"]["lineHeight"] * sc + 8)
    out = np.zeros((Hh, W, 4), np.float32); x = 4
    for c in text:
        g = ch.get(c, ch["?"])
        if g["width"] > 0:
            sub = atlas[g["y"]:g["y"] + g["height"], g["x"]:g["x"] + g["width"]]
            tw, th = max(1, round(g["width"] * sc)), max(1, round(g["height"] * sc))
            sub = np.asarray(Image.fromarray((sub * 255).astype(np.uint8)).resize((tw, th), Image.BILINEAR), np.float32) / 255
            med = np.median(sub, -1); spr = rng * sc
            a_fill = np.clip((med - 0.5) * spr + 0.5, 0, 1); a_out = np.clip((med - 0.5 + stroke_w) * spr + 0.5, 0, 1)
            ox, oy = int(x + g["xoffset"] * sc), int(4 + g["yoffset"] * sc)
            reg = out[oy:oy + th, ox:ox + tw]; hh, ww = reg.shape[:2]
            fa, oa = a_fill[:hh, :ww], a_out[:hh, :ww]
            col = np.array(fill, np.float32) / 255 * fa[..., None] + np.array(stroke, np.float32) / 255 * (1 - fa[..., None])
            na = np.maximum(reg[..., 3], oa)
            reg[..., :3] = np.where(oa[..., None] > reg[..., 3:4], col, reg[..., :3]); reg[..., 3] = na
        x += g["xadvance"] * sc
    return Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8), "RGBA")

def font_sheet():
    im = checker(900, 470); d = ImageDraw.Draw(im); label(d, (10, 10), "MSDF fonts decoded in Python (as the shader would): font_damage (Fredoka 700), font_nameplate (Nunito 800)", 15)
    y = 40
    for t, sz, col in (("-12", 24, (255, 255, 255)), ("-37  CRIT 128!", 40, (255, 212, 90)), ("+25", 32, (155, 232, 120)), ("BLOCK  PARRY  DODGE", 28, (134, 192, 242)), ("9999", 72, (255, 140, 120))):
        t_ = msdf_text("font_damage", t, sz, col); im.alpha_composite(t_, (20, y)); y += t_.height + 4
    for t, sz in (("[BUN] Pippa the Brave", 22), ("Mossbeard  <Acorn Hollow>  äöü ñ é", 18), ("Sir Waddles", 14)):
        t_ = msdf_text("font_nameplate", t, sz, (255, 246, 230), stroke_w=0.22); im.alpha_composite(t_, (20, y)); y += t_.height + 4
    im.convert("RGB").save(os.path.join(PREV, "contact_fonts.png"))

# ---------------------------------------------------------------- raid scene
TW, TH = 128, 64   # 2x tiles
def iso2(x, y, z=0, o=(0, 0)): return (o[0] + (x - y) * TW / 2, o[1] + (x + y) * TH / 2 - z * 2)
def put(cv, sprite, idx, pos, clan=None, alpha=1.0):
    f = frame(sprite, idx, clan); ax, ay = anchor_px(sprite)
    if alpha < 1: f.putalpha(f.getchannel("A").point(lambda v: int(v * alpha)))
    cv.alpha_composite(f, (int(round(pos[0] - ax)), int(round(pos[1] - ay))))
def bframe(sprite, dmg, rot=0, state=None):
    b = SPR[sprite]["building"]; rows = b["states"][state] if state else b["frames"]; return rows[rot % len(rows)][dmg]

def ground(cv, o, n=9):
    d = ImageDraw.Draw(cv); rng = np.random.default_rng(3)
    for y in range(-1, n):
        for x in range(-1, n):
            c = [(132, 178, 98), (124, 170, 92), (138, 182, 104)][int(rng.integers(0, 3))]
            pts = [iso2(x, y, 0, o), iso2(x + 1, y, 0, o), iso2(x + 1, y + 1, 0, o), iso2(x, y + 1, 0, o)]
            d.polygon(pts, fill=c + (255,))
            if (x + y) % 3 == 0:
                px, py = iso2(x + 0.5, y + 0.5, 0, o); d.ellipse([px - 3, py - 2, px + 3, py + 2], fill=(160, 200, 120, 255))

def raid_scene():
    W, Hh = 1500, 1000; o = (W / 2 - 40, 140); cv = Image.new("RGBA", (W, Hh), (110, 156, 86, 255)); ground(cv, o)
    berry = (CLANS[0]["primary"], CLANS[0]["secondary"]); plum = (CLANS[3]["primary"], CLANS[3]["secondary"])
    # territory border (dashed tint) along y=6.. line x=0..6 (tile frames are 64x32 cells = one tile)
    tk = "territory_se"
    for x in range(0, 7):
        p = iso2(x + 0.5, 6.5, 0, o); put(cv, tk, SPR[tk]["animations"]["idle"]["frames"][0], (p[0], p[1]), clan=berry)
    items = []   # (depth, fn)
    def add(depth, fn): items.append((depth, fn))
    # wall line at y in [2,3): front corner at (x+1, 3)
    wl = [("wall_clan_stone", 0), ("wall_clan_stone", 1)]
    for i, (k, dm) in enumerate(wl):
        add(i + 3, lambda k=k, dm=dm, i=i: put(cv, k, bframe(k, dm), iso2(i + 1, 3, 0, o), berry))
    add(4 + 3, lambda: put(cv, "gate_clan", bframe("gate_clan", 2, state="breached"), iso2(4, 3, 0, o), berry))     # gate 2x1 at x 2..4
    for i, (k, dm) in enumerate([("wall_clan_wood", 2), ("wall_clan_palisade", 3), ("wall_clan_wood", 1)]):
        x = 4 + i; add(x + 1 + 3, lambda k=k, dm=dm, x=x: put(cv, k, bframe(k, dm), iso2(x + 1, 3, 0, o), berry))
    add(9 + 4, lambda: put(cv, "watchtower", bframe("watchtower", 1), iso2(9, 4, 0, o), berry))                    # 2x2 at x7..9,y2..4
    # fire on damaged wood wall + palisade, smoke above
    add(5 + 3 + 0.5, lambda: put(cv, "fx_fire_large", SPR["fx_fire_large"]["animations"]["idle"]["frames"][2], iso2(4.6, 2.6, 6, o)))
    add(6 + 3 + 0.5, lambda: put(cv, "fx_fire_small", SPR["fx_fire_small"]["animations"]["idle"]["frames"][5], iso2(5.6, 2.7, 4, o)))
    add(6 + 3 + 0.6, lambda: put(cv, "fx_fire_small", SPR["fx_fire_small"]["animations"]["idle"]["frames"][1], iso2(5.2, 2.9, 0, o)))
    for j, (x, z) in enumerate(((4.4, 46), (4.9, 64), (5.5, 52))):
        add(20 + j, lambda x=x, z=z, j=j: put(cv, "fx_raid_smoke", SPR["fx_raid_smoke"]["animations"]["idle"]["frames"][(j * 2) % 6], iso2(x, 2.4, z, o), alpha=0.85))
    for j in range(6):
        add(22, lambda j=j: put(cv, "fx_raid_ember", SPR["fx_raid_ember"]["animations"]["idle"]["frames"][j % 4], iso2(4.3 + j * 0.25, 2.5, 30 + (j * 13) % 40, o)))
    # crack overlay demo on stone wall 2 handled by its damage frame; add overlay crack on intact stone wall 1 (fallback path)
    add(3.1, lambda: put(cv, "crack_1x1", SPR["crack_1x1"]["animations"]["stage1"]["frames"][0], iso2(1, 3, 0, o), alpha=0.9))
    # inside the base (y < 2): claim totem, banner, bell, chest
    add(1 + 1, lambda: put(cv, "claim_totem", SPR["claim_totem"]["animations"]["idle"]["frames"][2], iso2(2, 1, 0, o), berry))
    add(5 + 1, lambda: put(cv, "storage_box_locked", bframe("storage_box_locked", 1), iso2(5, 1, 0, o), berry))
    add(4 + 0, lambda: put(cv, "raid_bell", SPR["raid_bell"]["animations"]["ring"]["frames"][2], iso2(4, 0, 0, o), berry))
    # outside: banner in clan color, loot sack with rare glow + beam, rubble, raider fx
    add(2 + 6, lambda: put(cv, "banner", SPR["banner"]["animations"]["flap"]["frames"][2], iso2(1.5, 5.5, 0, o), plum))
    add(0 + 5.9, lambda: put(cv, "banner_large", SPR["banner_large"]["animations"]["flap"]["frames"][4], iso2(0.5, 4.9, 0, o), berry))
    add(9.0, lambda: put(cv, "loot_glow_rare", SPR["loot_glow_rare"]["animations"]["idle"]["frames"][1], iso2(4, 5, 0, o)))
    add(9.1, lambda: put(cv, "fx_loot_beam", SPR["fx_loot_beam"]["animations"]["idle"]["frames"][2], iso2(4, 5, 0, o), alpha=0.65))
    add(9.2, lambda: put(cv, "loot_sack_medium", SPR["loot_sack_medium"]["animations"]["idle"]["frames"][0], iso2(4, 5, 0, o)))
    add(11.5, lambda: put(cv, "grave_marker", SPR["grave_marker"]["animations"]["idle"]["frames"][0], iso2(5.6, 5.9, 0, o)))
    add(10.0, lambda: put(cv, "rubble_smoldering", SPR["rubble_smoldering"]["animations"]["idle"]["frames"][1], iso2(6.5, 4.5, 0, o), berry))
    add(10.2, lambda: put(cv, "fx_hit_stone", SPR["fx_hit_stone"]["animations"]["idle"]["frames"][2], iso2(1.6, 3.2, 20, o)))
    add(10.3, lambda: put(cv, "fx_bonk_stars", SPR["fx_bonk_stars"]["animations"]["idle"]["frames"][2], iso2(2.8, 5.0, 34, o)))
    add(10.4, lambda: put(cv, "fx_repair_sparkle", SPR["fx_repair_sparkle"]["animations"]["idle"]["frames"][2], iso2(1.6, 3.0, 30, o)))
    for dpt, fn in sorted(items, key=lambda t: t[0]): fn()
    d = ImageDraw.Draw(cv); label(d, (16, 12), "pvp_clan raid test scene (2x pages): stone walls d0/d1 (+ crack overlay fallback on d0), breached gate d2, wood wall d2 + fire, palisade d3, "
                                  "watchtower 2x2 d1, claim totem, raid bell ringing, locked chest d1, banners (plum_gold, berry_cream), rare loot sack + beam, rubble, territory edge", 13, (40, 28, 36))
    cv.convert("RGB").save(os.path.join(PREV, "raid_scene.png"))

# ---------------------------------------------------------------- GIFs
def gif(name, frames, ms):
    pal = [f.convert("RGB").quantize(colors=255, method=Image.Quantize.MEDIANCUT) for f in frames]
    pal[0].save(os.path.join(PREV, name), save_all=True, append_images=pal[1:], duration=ms, loop=0, disposal=2)

def gif_swing():
    frames = []; W, Hh = 360, 280
    sw = SPR["fx_swing_blade"]["animations"]["swing"]; base = sw["frames"]
    for cls in ("blade", "blunt", "axe", "spear"):
        an = SPR[f"fx_swing_{cls}"]["animations"]["swing"]
        for k in range(5 + 6):
            cv = checker(W, Hh); d = ImageDraw.Draw(cv); label(d, (8, 6), f"fx_swing_{cls} (SE) -> fx_hit_spark + fx_bonk_stars", 12)
            c = (150, 170); d.ellipse([c[0] - 14, c[1] - 6, c[0] + 14, c[1] + 6], fill=(100, 140, 76, 255))
            if k < 5: put(cv, f"fx_swing_{cls}", an["frames"][k] + 1 * an["dirStride"], c)
            else:
                j = k - 5; tgt = (c[0] + 64, c[1] + 34)
                put(cv, "fx_hit_spark", SPR["fx_hit_spark"]["animations"]["idle"]["frames"][min(j, 4)], tgt)
                if j < 6: put(cv, "fx_bonk_stars", SPR["fx_bonk_stars"]["animations"]["idle"]["frames"][j], (tgt[0], tgt[1] - 40))
            frames.append(cv)
    gif("gif_swing_impact.gif", frames, 55)

def gif_ko():
    frames = []
    ko = SPR["fx_ko_puff"]["animations"]["idle"]["frames"]; gh = SPR["fx_ko_ghost"]["animations"]["idle"]["frames"]; dn = SPR["fx_downed_overlay"]["animations"]["idle"]["frames"]
    for k in range(len(ko) + 12):
        cv = checker(300, 260); d = ImageDraw.Draw(cv); label(d, (8, 6), "fx_downed_overlay -> fx_ko_puff -> fx_ko_ghost", 12)
        p = (150, 230)
        if k < 6: put(cv, "fx_downed_overlay", dn[k % len(dn)], p)
        elif k - 6 < len(ko): put(cv, "fx_ko_puff", ko[k - 6], p)
        else: put(cv, "fx_ko_ghost", gh[(k - 6 - len(ko)) % len(gh)], (p[0], p[1] - 10))
        frames.append(cv)
    gif("gif_ko_puff.gif", frames, 85)

def gif_flags():
    frames = []
    for t in range(12):
        cv = checker(560, 300); d = ImageDraw.Draw(cv); label(d, (8, 6), "banner_small / banner / banner_large flap loop (+ shader sway preview), banner_wall, claim_totem", 12)
        for i, (k, cl) in enumerate((("banner_small", 2), ("banner", 3), ("banner_large", 0), ("banner_wall", 9), ("claim_totem", 5))):
            an = SPR[k]["animations"]; fr = an.get("flap", an["idle"])["frames"]
            f = frame(k, fr[t % len(fr)], (CLANS[cl]["primary"], CLANS[cl]["secondary"]))
            sw = SPR[k].get("sway")
            if sw:   # emulate vertex sway: shear proportional to height above the pivot
                amp = sw["amp"] * 2 * math.sin(t / 12 * 2 * math.pi); ax, ay = anchor_px(k)
                f = f.transform(f.size, Image.AFFINE, (1, amp / ay, -amp, 0, 1, 0), Image.BICUBIC)
            ax, ay = anchor_px(k); cv.alpha_composite(f, (int(60 + i * 110 - ax), int(280 - ay)))
        frames.append(cv)
    gif("gif_flag_flap.gif", frames, 100)

if __name__ == "__main__":
    os.makedirs(PREV, exist_ok=True)
    print(all_contacts()); emblem_sheet(); grid_contact("contact_worldui.png", "World UI (2x): nameplates per role, clan/party tag chips (keycap), icons, chat bubbles per theme channel",
        keys(lambda s: s["atlas"] in ("nameplates", "nameplate_tags", "nameplate_icons", "chat_bubbles")), cols=12)
    font_sheet(); raid_scene(); gif_swing(); gif_ko(); gif_flags(); print(sorted(os.listdir(PREV)))
