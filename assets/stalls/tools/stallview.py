"""Preview helper: resolves stall sprites from manifest.fragment.json and simulates the renderer
(multiply tint by tintmask, attach-point icons/price text/shop name, emissive bloom at night)."""
import json, os, math
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops
A = "/workspace/assets"; R = A + "/stalls"
FR = json.load(open(R + "/manifest.fragment.json"))
ATL = {a["key"]: a for a in FR["atlases"]}; SPR = {s["key"]: s for s in FR["sprites"]}
MAIN = json.load(open(A + "/manifest.json")); MATL = {a["key"]: a for a in MAIN["atlases"]}; MSPR = {s["key"]: s for s in MAIN["sprites"]}
TUNE = json.load(open(R + "/render_tuning.stalls.json")) if os.path.exists(R + "/render_tuning.stalls.json") else {}
_img = {}
def im(p, mode="RGBA"):
    if p not in _img: _img[p] = Image.open(A + "/" + p).convert(mode)
    return _img[p]
def cell(atl, idx, scale=1, kind="i"):
    fw, fh = atl["frameW"] * scale, atl["frameH"] * scale
    p = atl["image"] if scale == 1 else atl["pages"][0]["image"]
    if kind == "e": p = p.replace("@2x.png", ".png").replace(".png", "_emissive.png") if scale == 1 else p.replace("@2x.png", "_emissive@2x.png")
    if kind == "t": p = atl["masks"]["tintmask"] if scale == 1 else atl["masks"]["tintmask"].replace(".png", "@2x.png")
    if kind == "s": p = atl["masks"]["sway"]
    x, y = (idx % atl["columns"]) * fw, (idx // atl["columns"]) * fh
    return im(p).crop((x, y, x + fw, y + fh))
def font(sz, w=700):
    f = ImageFont.truetype(A + "/ui/fonts/Fredoka.ttf", sz)
    try: f.set_variation_by_axes([w, 100])
    except Exception: pass
    return f
INK = (59, 36, 51)
def item_icon(key, size=32):
    if key in ("coin", "coin_few", "coin_many"):
        p = R + f"/ui/icons/{key}{'@2x' if size > 32 else ''}.png"; i = Image.open(p).convert("RGBA")
        return i.crop((8 * (i.width // 48), 8 * (i.width // 48), 40 * (i.width // 48), 40 * (i.width // 48))).resize((size, size), Image.LANCZOS)
    s = MSPR.get(key)
    if not s: return None
    a = MATL[s["atlas"]]; f = s["animations"]["idle"]["frames"][0]
    c = cell({**a, "image": a["image"]}, f); return c.resize((size, size), Image.LANCZOS)
def tint(img, mask, p, s):
    a = np.asarray(img, np.float32) / 255; m = np.asarray(mask.convert("RGB"), np.float32) / 255
    P = np.array([int(p[i:i + 2], 16) for i in (1, 3, 5)], np.float32) / 255; S = np.array([int(s[i:i + 2], 16) for i in (1, 3, 5)], np.float32) / 255
    rgb = a[..., :3]; rgb = rgb * (1 - m[..., :1]) + rgb * P * m[..., :1]; rgb = rgb * (1 - m[..., 1:2]) + rgb * S * m[..., 1:2]
    return Image.fromarray((np.concatenate([rgb, a[..., 3:]], -1) * 255).astype(np.uint8))
def fit_sign(name, w, h, font, scale=1):
    """Sign policy (render_tuning sign.fit): 1 line, shrink to 6px; else word-wrap to 2 lines, shrink to 5px; else ellipsis."""
    name = name[:24]
    for sz in range(int(h), int(6 * scale) - 1, -1):
        if font(sz).getlength(name) <= w: return [name], sz
    words = name.split(" "); best = None
    for k in range(1, len(words)):
        a, b = " ".join(words[:k]), " ".join(words[k:]); m = max(len(a), len(b))
        if best is None or m < best[0]: best = (m, a, b)
    if best:
        for sz in range(int(h / 2), int(5 * scale) - 1, -1):
            f = font(sz)
            if max(f.getlength(best[1]), f.getlength(best[2])) <= w: return [best[1], best[2]], sz
    f = font(int(5 * scale)); t = name
    while t and f.getlength(t + "\u2026") > w: t = t[:-1]
    return [t + "\u2026"], int(5 * scale)


def draw_sprite(canvas, key, sx, sy, state="open", rot=0, dmg=0, scale=1, clan=None, listings=None, name=None, emis=None, anim=None, frame=0):
    s = SPR.get(key) or MSPR[key]; atl = ATL.get(s["atlas"]) or MATL[s["atlas"]]
    if "building" in s:
        rows = s["building"]["states"][state] if "states" in s["building"] else s["building"]["frames"]
        flip = len(rows) == 2 and rot >= 2          # 2-row mirror: rotations 2/3 = rows 0/1 flipped (engine flipX)
        idx = rows[rot if len(rows) == 4 else (rot & 1) % len(rows)][dmg]
    else:
        idx = s["animations"][anim or "idle"]["frames"][frame]; flip = False
    img = cell(atl, idx, scale)
    if clan and "masks" in atl and "tintmask" in atl["masks"]: img = tint(img, cell(atl, idx, scale, "t"), *clan)
    if flip: img = img.transpose(Image.FLIP_LEFT_RIGHT)
    px, py = sx - s["anchor"]["x"] * atl["frameW"] * scale, sy - s["anchor"]["y"] * atl["frameH"] * scale
    canvas.alpha_composite(img, (int(px), int(py)))
    if emis is not None and "masks" in atl and atl["masks"].get("emissive"):
        ei = cell(atl, idx, scale, "e"); emis.alpha_composite(ei.transpose(Image.FLIP_LEFT_RIGHT) if flip else ei, (int(px), int(py)))
    att = dict(s.get("attach", {})); att.update((s.get("frameAttach") or {}).get(str(idx), {}))
    mir = -1 if flip else 1  # baked-mirror rows carry x-negated frameAttach; runtime flipX negates again
    d = ImageDraw.Draw(canvas)
    if listings and state == "open":
        for k, L in enumerate(listings):
            a = att.get(f"slot{k}")
            if not a or not L: continue
            ic = item_icon(L[0], int(a["w"] * scale))
            if ic: canvas.alpha_composite(ic, (int(sx + mir * a["x"] * scale - ic.width / 2), int(sy + a["y"] * scale - ic.height / 2)))  # attach x/y = box centre
            t = att.get(f"tag{k}")
            if t and len(L) > 1 and key != "stall_price_tag":
                ts = SPR["stall_price_tag"]; tt = ts["attach"]["text"]  # renderer: tag sprite so its text box lands on tagN
                draw_sprite(canvas, "stall_price_tag", sx + (mir * t["x"] - tt["x"]) * scale, sy + (t["y"] - tt["y"]) * scale, scale=scale)
                f = font(max(6, int(t["h"] * scale * 0.95))); txt = str(L[1])
                d.text((sx + mir * t["x"] * scale, sy + t["y"] * scale), txt, font=f, fill=INK, anchor="mm")
    if name and "sign" in att:
        a = att["sign"]; tn = TUNE.get("sign", {})
        col = tuple(int(tn.get("color", "#3B2433")[i:i + 2], 16) for i in (1, 3, 5))
        lines, sz = fit_sign(name, a["w"] * scale, a["h"] * scale, font, scale)
        f = font(sz); lh = sz * 1.0; cy = sy + a["y"] * scale - lh * (len(lines) - 1) / 2
        for i, ln in enumerate(lines): d.text((sx + mir * a["x"] * scale, cy + i * lh), ln, font=f, fill=col, anchor="mm")
    return att
