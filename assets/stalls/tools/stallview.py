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
def draw_sprite(canvas, key, sx, sy, state="open", rot=0, dmg=0, scale=1, clan=None, listings=None, name=None, emis=None, anim=None, frame=0):
    s = SPR.get(key) or MSPR[key]; atl = ATL.get(s["atlas"]) or MATL[s["atlas"]]
    if "building" in s:
        rows = s["building"]["states"][state] if "states" in s["building"] else s["building"]["frames"]
        idx = rows[rot][dmg]
    else:
        idx = s["animations"][anim or "idle"]["frames"][frame]
    flip = False
    img = cell(atl, idx, scale)
    if clan and "masks" in atl and "tintmask" in atl["masks"]: img = tint(img, cell(atl, idx, scale, "t"), *clan)
    px, py = sx - s["anchor"]["x"] * atl["frameW"] * scale, sy - s["anchor"]["y"] * atl["frameH"] * scale
    canvas.alpha_composite(img, (int(px), int(py)))
    if emis is not None and "masks" in atl and atl["masks"].get("emissive"):
        emis.alpha_composite(cell(atl, idx, scale, "e"), (int(px), int(py)))
    att = dict(s.get("attach", {})); att.update((s.get("frameAttach") or {}).get(str(idx), {}))
    mir = 1  # mirrored rows carry x-negated frameAttach
    d = ImageDraw.Draw(canvas)
    if listings and state == "open":
        for k, L in enumerate(listings):
            a = att.get(f"slot{k}")
            if not a or not L: continue
            ic = item_icon(L[0], int(a["w"] * scale))
            if ic: canvas.alpha_composite(ic, (int(sx + mir * a["x"] * scale - ic.width / 2), int(sy + a["y"] * scale - ic.height * 0.75)))
            t = att.get(f"tag{k}")
            if t and len(L) > 1:
                f = font(max(6, int(t["h"] * scale * 0.95))); txt = str(L[1])
                d.text((sx + mir * t["x"] * scale, sy + t["y"] * scale), txt, font=f, fill=INK, anchor="mm")
    if name and "sign" in att:
        a = att["sign"]; tn = TUNE.get("sign", {})
        sz = int(a["h"] * scale * 1.0); f = font(sz)
        while f.getlength(name) > a["w"] * scale and sz > 6: sz -= 1; f = font(sz)
        d.text((sx + mir * a["x"] * scale, sy + a["y"] * scale), name, font=f, fill=tuple(int(tn.get("color", "#3B2433")[i:i + 2], 16) for i in (1, 3, 5)), anchor="mm")
    return att
