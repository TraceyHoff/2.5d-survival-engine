"""In-world UI for WebGL: nameplate ornaments (crown/star/shield...), nameplate 9-slices (+ clan-tag pill), chat bubble 9-slices per
channel (+ tails, typing dots). Matches ui/theme.json (parchment/wood/ink, 2-2.5px outlines @1x)."""
import math, json, os, numpy as np
from PIL import Image, ImageDraw
from common import *
from fx_combat import star, heart_, capsule, round_poly, twinkle

RP = lambda n: [H(c) for c in RAMPS[n]]
INKC = H("#3b2433")
UI = "/workspace/assets/ui"
THEME = json.load(open(os.path.join(UI, "theme.json")))
CHANNELS = {k: v for k, v in THEME["chat"]["channels"].items() if not k.startswith("$")}
_ATL = {1: (json.load(open(os.path.join(UI, "atlas/ui_atlas.json"))), Image.open(os.path.join(UI, "atlas/ui_atlas.png")).convert("RGBA")),
        2: (json.load(open(os.path.join(UI, "atlas/ui_atlas@2x.json"))), Image.open(os.path.join(UI, "atlas/ui_atlas@2x.png")).convert("RGBA"))}
def ui_frame(name, scale=1):
    js, im = _ATL[scale]; f = js["frames"][name]["frame"]; return im.crop((f["x"], f["y"], f["x"] + f["w"], f["y"] + f["h"]))
def ui_nine(name): return THEME and _ATL[1][0]["frames"][name].get("nineSlice")
def nine(img, ins, W, Hh):
    """9-slice stretch an RGBA image to W x H (ins = (l, t, r, b) in img pixels)."""
    l, t, r, b = ins; w, h = img.size; out = Image.new("RGBA", (W, Hh), (0, 0, 0, 0))
    xs = [(0, l, 0, l), (l, w - r, l, W - r), (w - r, w, W - r, W)]; ys = [(0, t, 0, t), (t, h - b, t, Hh - b), (h - b, h, Hh - b, Hh)]
    for sx0, sx1, dx0, dx1 in xs:
        for sy0, sy1, dy0, dy1 in ys:
            if dx1 > dx0 and dy1 > dy0 and sx1 > sx0 and sy1 > sy0:
                out.paste(img.crop((sx0, sy0, sx1, sy1)).resize((dx1 - dx0, dy1 - dy0), Image.LANCZOS), (dx0, dy0))
    return out
def recolor(img, tag, neutral=False):
    """channel variant of a UI-kit frame: ink outline nudged toward the channel color, warm bottom lip -> channel color.
    returns (image, tintmask) ; neutral=True paints the lip near-white and marks it R in the tint mask."""
    a = np.asarray(img, np.float32) / 255; rgb = a[..., :3]; al = a[..., 3]
    mx, mn = rgb.max(-1), rgb.min(-1); lum = rgb @ np.array([0.299, 0.587, 0.114]); sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-4), 0)
    ink = np.array(H("#3b2433"), np.float32) / 255; tg = np.array(H(tag), np.float32) / 255
    out = rgb.copy(); tm = np.zeros(al.shape + (3,), np.float32)
    o = smooth(0.42, 0.30, lum) * (al > 0.05)                       # outline weight (dark pixels)
    lip = smooth(0.12, 0.22, sat) * smooth(0.45, 0.6, lum) * (1 - o)  # saturated warm lip / shade
    oc = ink * 0.5 + tg * 0.5 * 0.55 + ink * 0.5 * 0.45 if not neutral else ink
    out = out * (1 - o[..., None] * 0.65) + (ink * 0.45 + tg * 0.55 * 0.6 + ink * 0.55 * 0.4) * o[..., None] * 0.65
    shade = (lum / np.maximum(lum.max(), 1e-3))[..., None]
    lipcol = (np.array(NEUTRAL[1], np.float32) / 255 if neutral else (tg * 0.8 + 0.2)) * (0.75 + 0.3 * shade)
    out = out * (1 - lip[..., None]) + np.clip(lipcol, 0, 1) * lip[..., None]
    tm[..., 0] = lip * (al > 0.05)
    im = Image.fromarray((np.concatenate([np.clip(out, 0, 1), al[..., None]], -1) * 255).astype(np.uint8), "RGBA")
    return im, Image.fromarray((tm * 255).astype(np.uint8), "RGB")
NP_ROLES = {"neutral": "#D8C4A0", "self": "#FFE680", "party": "#7FE0EE", "clan": "#4F8FD6", "enemy": "#E8492E"}

def framed(cv, poly, fill, border, lw=1.6, lip=True, hl=True):
    """UI-kit style panel: flat parchment fill, soft top highlight, bottom lip, inked wobble outline."""
    r = [lerp(H(fill), (255, 255, 255), 0.5), H(fill), lerp(H(fill), H(border), 0.25), H(border)]
    cv.part(poly, r, lw=lw, shade=0.0, hl=0.0, ink=lerp(H(border), INKC, 0.45))
    cl = cv.mask_from(poly)
    ys = [p[1] for p in poly]; xs = [p[0] for p in poly]; y0, y1, x0, x1 = min(ys), max(ys), min(xs), max(xs)
    if lip: cv.fill([(x0, y1 - 2.2), (x1, y1 - 2.2), (x1, y1 + 1), (x0, y1 + 1)], r[2], clip=cl)
    if hl: cv.fill([(x0, y0 - 1), (x1, y0 - 1), (x1, y0 + 1.6), (x0, y0 + 1.6)], (255, 255, 255), alpha=150, clip=cl)

def icon(name):
    cv = blank(24, 24, 1001); tm = blank(24, 24); c = 12
    if name == "crown":
        p = [(4, 18), (4.5, 8), (8.5, 12.5), (12, 5.5), (15.5, 12.5), (19.5, 8), (20, 18)]
        cv.part(round_poly(p, 1.2), RP("gold"), lw=1.3, shade=0.22, hl=0.2)
        cv.part(rrect(4, 16, 20, 19.5, 1.2), RP("gold"), lw=1.0, shade=0.25)
        for x, y, col in ((4.5, 8, "berry"), (12, 5.5, "cloth_blue"), (19.5, 8, "berry")): cv.part(circle(x, y, 1.7, 14), RP(col), lw=0.7, gloss=[(x - 0.5, y - 0.5, 0.5, 0.4)])
        cv.part(circle(c, 14.2, 1.4, 12), RP("cloth_teal"), lw=0.6)
    elif name == "star":
        star(cv, c, 12.5, 8.8, rot=0, face=False, lw=1.3)
    elif name == "shield":
        p = round_poly([(4.5, 4.5), (19.5, 4.5), (19.5, 12), (12, 20.5), (4.5, 12)], 2.2)
        cv.part(p, RP("iron"), lw=1.3, shade=0.2, hl=0.15)
        q = round_poly([(7, 7), (17, 7), (17, 11.8), (12, 17.6), (7, 11.8)], 1.5)
        cv.part(q, NEUTRAL, lw=0.7, shade=0.15, hl=0.1); mask_paint(tm, q, 255, 0, 0.3)
        st = rstar(c, 11.4, 3.0, 1.5, 5, -math.pi / 2, p=1.1); cv.part(st, NEUTRAL, lw=0.5, shade=0.05); mask_paint(tm, st, 255, 1, 0.2)
    elif name == "party_pip":
        heart_(cv, c, 12.5, 7.5)
    elif name == "pvp_flag":
        cv.part(capsule(7, 19, 7, 4.5, 1.1), RP("wood_dark"), lw=0.9)
        f = [(8, 5), (18, 7.5), (15, 10), (18, 12.5), (8, 13)]
        cv.part(round_poly(f, 0.8), RP("cloth_red"), lw=1.0, shade=0.15, hl=0.15)
        cv.part(circle(7, 4.3, 1.6, 12), RP("gold"), lw=0.6)
    elif name == "downed":
        heart_(cv, c, 12.5, 8)
        cv.part(rot_pts(rrect(5, 10.5, 19, 14.5, 1.2), -0.6, c, 12.5), RP("cloth_cream"), lw=0.7, shade=0.1)
        for dx in (-1.2, 1.2): cv.fill(circle(c + dx, 12.5 + dx * 0.6, 0.45, 8), RP("cloth_cream")[3])
    elif name == "officer":
        star(cv, c, 13, 7.5, lw=1.2); cv.part(capsule(5, 5, 19, 5, 1.6), RP("cloth_purple"), lw=0.8)
    elif name == "leader_clan":
        p = [(5, 17), (5.5, 9), (9, 12), (12, 6.5), (15, 12), (18.5, 9), (19, 17)]
        cv.part(round_poly(p, 1.1), NEUTRAL_METAL, lw=1.2, shade=0.2, hl=0.2); mask_paint(tm, p, 255, 0, 0.3)
        cv.part(rrect(5, 15.5, 19, 18.5, 1.0), RP("gold"), lw=0.9, shade=0.25)
    return cv, tm

def plate(role, w=48, h=24):
    cv = blank(w, h, 1101); tm = blank(w, h)
    p = rrect(4, 4, w - 4, h - 5, 7)
    framed(cv, p, "#F6EAD2", "#74432C", lw=1.5)
    cl = cv.mask_from(p)
    stripe = [(3, h - 9.2), (w - 3, h - 9.2), (w - 3, h - 2), (3, h - 2)]
    cv.fill(stripe, NP_ROLES[role], clip=cl); cv.fill([(3, h - 9.2), (w - 3, h - 9.2), (w - 3, h - 8.4), (3, h - 8.4)], (255, 255, 255), alpha=120, clip=cl)
    # re-ink outline on top so the stripe sits inside the frame
    cv.part(p, [(0, 0, 0)] * 4, lw=1.5, shade=0, hl=0, ink=lerp(H("#74432C"), INKC, 0.45), mask=None) if False else None
    return cv, tm

def tag_pill(w=48, h=24):
    cv = blank(w, h, 1201); tm = blank(w, h)
    p = rrect(4, 5, w - 4, h - 6, 6)
    cv.part(p, NEUTRAL, lw=1.5, shade=0.0, hl=0.0, ink=INKC)
    cl = cv.mask_from(p); cv.fill([(3, h - 8), (w - 3, h - 8), (w - 3, h - 4), (3, h - 4)], NEUTRAL[2], clip=cl)
    mask_paint(tm, [rrect(4, 5, w - 4, h - 6, 6)], 255, 0, 0.3)
    return cv, tm

def bubble(ch, w=32, h=32):
    fill, border, _ = CHANNELS[ch]; cv = blank(w, h, 1301); tm = blank(w, h)
    p = rrect(4, 4, w - 5, h - 6, 9)
    framed(cv, p, fill, border, lw=1.6)
    if ch == "clan": mask_paint(tm, [arc_ring(p)], 255, 0, 0.0)
    return cv, tm

def arc_ring(p): return p
def tail(ch, w=32, h=32):
    fill, border, _ = CHANNELS[ch]; cv = blank(w, h, 1401); tm = blank(w, h)
    r = [lerp(H(fill), (255, 255, 255), 0.5), H(fill), lerp(H(fill), H(border), 0.25), H(border)]
    t = [(10, 2), (22, 2), (17.5, 9), (13, 15), (13.5, 9)]
    cv.part(round_poly(t, 1.0), r, lw=1.6, shade=0, hl=0, ink=lerp(H(border), INKC, 0.45))
    cv.fill([(9, -2), (23, -2), (23, 3.6), (9, 3.6)], H(fill))   # seam overlaps body bottom edge: draw tail under the body lip
    a = np.asarray(cv.img).copy(); a[: 3 * SS] = 0; cv.img = Image.fromarray(a)
    return cv, tm

def typing48(k): return typing(k, 48, 48, 24 - 16)
def typing(k, w=32, h=32, ox=0):
    cv = blank(w, h, 1501)
    for j in range(3):
        up = 2.2 if j == k else 0
        cv.part(circle(ox + 9 + j * 7, h / 2 - up, 2.2, 16), [(255, 255, 255), (246, 234, 210), (216, 196, 160), (116, 67, 44)], lw=1.0, shade=0.2)
    return cv

def build():
    out = {}
    ic = Sheet("nameplate_icons", 24, 24, 8, category="ui", pivot=(0.5, 1.0)); spr = []
    for i, n in enumerate(["crown", "star", "shield", "party_pip", "pvp_flag", "downed", "officer", "leader_clan"]):
        cv, tm = icon(n); ic.add(f"np_{n}", cv.img, None, tm.img, idx=i)
        spr.append({"key": f"np_{n}", "category": "ui", "atlas": "nameplate_icons", "anchor": {"x": 0.5, "y": 0.5}, "animations": {"idle": {"frames": [i], "fps": 1}}})
    ic.sprites = spr; out["icons"] = ic
    # nameplates: ui_panel_hud (dark HUD card) 9-sliced at half corner size -> 64x24, role ring from outline_colors.json
    oc = json.load(open(os.path.join(ROOT, "outline_colors.json")))["colors"]
    roles = ["neutral", "self", "party", "clan", "enemy"]
    npl = Sheet("nameplates", 64, 24, 6, category="ui"); spr = []; ninej = {}
    hud2 = ui_frame("panel_hud", 2); ins2 = [v * 2 for v in (14, 14, 14, 14)]
    for i, r in enumerate(roles):
        big = nine(hud2, ins2, 256, 96)          # 4x of 64x24 with 2x-art corners (= 7px @1x)
        if r != "neutral":
            d = ImageDraw.Draw(big); d.rounded_rectangle([9, 9, 246, 86], radius=22, outline=H(oc[r]["color"]) + (255,), width=5)
        npl.add_raw(f"nameplate_{r}", big.resize((64, 24), Image.LANCZOS), big.resize((128, 48), Image.LANCZOS), idx=i)
        ninej[str(i)] = {"l": 9, "t": 8, "r": 9, "b": 8}
        spr.append({"key": f"nameplate_{r}", "category": "ui", "atlas": "nameplates", "anchor": {"x": 0.5, "y": 1.0}, "animations": {"idle": {"frames": [i], "fps": 1}}})
    npl.sprites = spr; npl.nine = ninej; out["plates"] = npl
    # clan-tag chip: ui_keycap with a neutral (tintable) face; R = clan primary (face), G = clan secondary (lip)
    tg = Sheet("nameplate_tags", 32, 32, 4, category="ui"); spr = []
    for i, kind in enumerate(["clan_tag", "party_tag"]):
        imgs, tms = [], []
        for sc in (1, 2):
            k = ui_frame("keycap", sc); a = np.asarray(k, np.float32) / 255; rgb = a[..., :3]
            lum = rgb @ np.array([0.299, 0.587, 0.114]); mx, mn = rgb.max(-1), rgb.min(-1); sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-4), 0)
            face = smooth(0.55, 0.7, lum) * smooth(0.25, 0.12, sat) * (a[..., 3] > 0.05); lip = smooth(0.15, 0.3, sat) * smooth(0.35, 0.5, lum) * (1 - face)
            g = (lum / max(lum.max(), 1e-3))[..., None]
            out_rgb = rgb * (1 - face[..., None]) + (np.array(NEUTRAL[1], np.float32) / 255 * (0.85 + 0.15 * g)) * face[..., None]
            out_rgb = out_rgb * (1 - lip[..., None]) + (np.array(NEUTRAL[2], np.float32) / 255 * (0.8 + 0.25 * g)) * lip[..., None]
            if kind == "party_tag":   # party chip pre-colored with the theme party tag
                pc_ = np.array(H(THEME["chat"]["channels"]["party"]["tag"]), np.float32) / 255; out_rgb = out_rgb * (1 - face[..., None] * 0.85) + out_rgb * pc_ * face[..., None] * 0.85
            t = np.zeros(lum.shape + (3,), np.float32)
            if kind == "clan_tag": t[..., 0] = face; t[..., 1] = lip
            imgs.append(Image.fromarray((np.concatenate([np.clip(out_rgb, 0, 1), a[..., 3:4]], -1) * 255).astype(np.uint8)))
            tms.append(Image.fromarray((t * 255).astype(np.uint8), "RGB"))
        tg.add_raw(f"nameplate_{kind}", imgs[0], imgs[1], tms[0], tms[1], idx=i)
        spr.append({"key": f"nameplate_{kind}", "category": "ui", "atlas": "nameplate_tags", "anchor": {"x": 0.5, "y": 0.5}, "animations": {"idle": {"frames": [i], "fps": 1}}})
    tg.nine = {"0": {"l": 10, "t": 9, "r": 10, "b": 12}, "1": {"l": 10, "t": 9, "r": 10, "b": 12}}; tg.sprites = spr; out["tags"] = tg
    # chat bubbles: ui_bubble / ui_bubble_tail recolored per theme chat channel (+ a neutral clan-tintable variant)
    cb = Sheet("chat_bubbles", 48, 48, 12, category="ui"); spr = []; ninej = {}
    chans = list(CHANNELS) + ["clan_tint"]
    for i, ch in enumerate(chans):
        tag = CHANNELS.get(ch, CHANNELS["clan"])["tag"]; neutral = ch == "clan_tint"
        b1, t1 = recolor(ui_frame("bubble", 1), tag, neutral); b2, t2 = recolor(ui_frame("bubble", 2), tag, neutral)
        cb.add_raw(f"bubble_{ch}", b1, b2, t1 if neutral else None, t2 if neutral else None, idx=i); ninej[str(i)] = {"l": 16, "t": 16, "r": 16, "b": 16}
        cells = []
        for sc in (1, 2):
            tl, tt = recolor(ui_frame("bubble_tail", sc), tag, neutral)
            c = Image.new("RGBA", (48 * sc, 48 * sc)); c.paste(tl, (12 * sc, 2 * sc)); m = Image.new("RGB", (48 * sc, 48 * sc)); m.paste(tt, (12 * sc, 2 * sc)); cells += [c, m]
        cb.add_raw(f"bubble_{ch}_tail", cells[0], cells[2], cells[1] if neutral else None, cells[3] if neutral else None, idx=12 + i)
        spr.append({"key": f"bubble_{ch}", "category": "ui", "atlas": "chat_bubbles", "anchor": {"x": 0.5, "y": 0.5}, "animations": {"idle": {"frames": [i], "fps": 1}}})
        spr.append({"key": f"bubble_{ch}_tail", "category": "ui", "atlas": "chat_bubbles", "anchor": {"x": 0.5, "y": round(2 / 48, 4)}, "animations": {"idle": {"frames": [12 + i], "fps": 1}}})
    fr = []
    for k in range(3): fr.append(cb.add(f"bubble_typing/idle/{k}", typing48(k).img, idx=24 + k))
    spr.append({"key": "bubble_typing", "category": "ui", "atlas": "chat_bubbles", "anchor": {"x": 0.5, "y": 0.5}, "animations": {"idle": {"frames": fr, "fps": 4}}})
    cb.sprites = spr; cb.nine = ninej; out["bubbles"] = cb
    for s in out.values(): s.warnings = [w for w in s.warnings if "tail" not in w]
    json.dump({"source": "ui/theme.json chat.channels (tag color drives the bubble lip/outline); channelIds from theme chat.channelIds",
               "channels": {k: {"tag": v["tag"], "text": THEME["chat"]["bubble"]["textColor"], "name": v.get("textOnLight"), "sprite": f"bubble_{k}", "tail": f"bubble_{k}_tail"} for k, v in CHANNELS.items()},
               "clanTintable": {"sprite": "bubble_clan_tint", "tail": "bubble_clan_tint_tail", "mask": "chat_bubbles_tintmask R = lip"},
               "nameplateRoles": {r: f"nameplate_{r}" for r in ["neutral", "self", "party", "clan", "enemy"]},
               "nameplateText": {"font": "fonts/font_nameplate.json (MSDF)", "color": THEME["color"]["text"]["onDark"], "stroke": "#2A1B2E"},
               "clanTag": {"sprite": "nameplate_clan_tag", "mask": "R face = clan primary, G lip = clan secondary", "text": "#3B2433"}}, open(os.path.join(ROOT, "world_ui_colors.json"), "w"), indent=1)
    return out

if __name__ == "__main__":
    for s in build().values(): print(s.save(), s.warnings[:3])
