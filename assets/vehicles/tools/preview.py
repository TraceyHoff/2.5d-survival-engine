"""Contact sheets: one PNG per vehicle (rows = states, cols = 8 dirs) at 2x with sample paint, plus a lights-on row."""
import sys, json, pickle, numpy as np
from PIL import Image, ImageDraw, ImageFont
OUT = sys.argv[1]; PREV = sys.argv[2]
part = json.load(open(OUT + "/_vehicles_part.json")); frames = pickle.load(open("/tmp/veh_frames.pkl", "rb"))
PAINT = json.load(open(OUT + "/_paint.json"))
DIRS = ["E", "SE", "S", "SW", "W", "NW", "N", "NE"]
try: font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 14)
except Exception: font = ImageFont.load_default()
def hexc(h): return np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], np.float32)
def tinted(i2, t1, color):
    m = np.asarray(Image.fromarray(t1).resize((i2.shape[1], i2.shape[0]), Image.BILINEAR), np.float32)[..., None] / 255
    base = i2[..., :3].astype(np.float32); out = base * (1 + (color / (0.78 * 255) - 1) * m)
    return np.dstack([np.clip(out, 0, 255).astype(np.uint8), i2[..., 3]])
def lit(img, e1):
    e = np.asarray(Image.fromarray(e1).resize((img.shape[1], img.shape[0]), Image.BILINEAR), np.float32)
    dark = img[..., :3].astype(np.float32) * np.array([0.35, 0.38, 0.55]); g = np.asarray(Image.fromarray(e.astype(np.uint8)).filter(__import__("PIL.ImageFilter").ImageFilter.GaussianBlur(6)), np.float32)
    out = dark + e * 1.0 + g * 1.4
    return np.dstack([np.clip(out, 0, 255).astype(np.uint8), img[..., 3]]), np.clip(g.max(-1) * 2, 0, 255)
def fr(at, i):
    k3, i1, i2, t1, e1 = frames[(at, i)]
    if i2 is None: i2 = np.asarray(Image.fromarray(i1).resize((i1.shape[1] * 2, i1.shape[0] * 2), Image.LANCZOS))
    return k3, i1, i2, t1, e1
SP = {s["key"]: s for s in part["sprites"]}
def loc(meta, s):  # (atlas, base frame) of a state, following stateSprites overflow
    sp = SP[meta.get("stateSprites", {}).get(s, meta["key"])]; return sp["atlas"], sp["animations"][s]["frames"][0]
paths = []
for sp, meta in zip(part["sprites"], part["meta"]):
    if "aliasOf" in meta or "stateOf" in meta: continue
    key = sp["key"]; at = sp["atlas"]; states = meta.get("allStates", meta["states"])
    color = hexc(PAINT[meta["tint"]["tintSet"]][meta["tint"]["defaultIndex"]])
    sample = [fr(*loc(meta, states[0]))]
    fh, fw = sample[0][2].shape[:2]; rows = len(states) + (1 if meta["lights"] else 0); LW = 110
    sheet = Image.new("RGBA", (LW + 8 * fw, 24 + rows * fh), (238, 228, 204, 255)); dr = ImageDraw.Draw(sheet)
    dr.text((6, 4), f"{key}  ({at}, frame {fw//2}x{fh//2} @1x)  tint {PAINT[meta['tint']['tintSet']][meta['tint']['defaultIndex']]}", fill=(52, 36, 60), font=font)
    for d in range(8): dr.text((LW + d * fw + fw // 2 - 8, 24 + rows * fh - 18), DIRS[d], fill=(120, 100, 110), font=font)
    for r, s in enumerate(states):
        dr.text((6, 24 + r * fh + fh // 2), s, fill=(52, 36, 60), font=font)
        for d in range(8):
            a_, b_ = loc(meta, s); _, i1, i2, t1, e1 = fr(a_, b_ + d)
            sheet.alpha_composite(Image.fromarray(tinted(i2, t1, color)), (LW + d * fw, 24 + r * fh))
    if meta["lights"]:
        r = len(states); dr.rectangle([LW, 24 + r * fh, LW + 8 * fw, 24 + (r + 1) * fh], fill=(40, 44, 70, 255)); dr.text((6, 24 + r * fh + fh // 2), "lights on", fill=(52, 36, 60), font=font)
        for d in range(8):
            a_, b_ = loc(meta, "intact"); _, i1, i2, t1, e1 = fr(a_, b_ + d)
            img, glow = lit(tinted(i2, t1, color), e1)
            gl = Image.new("RGBA", (fw, fh), (255, 230, 170, 0)); gl.putalpha(Image.fromarray(glow.astype(np.uint8)))
            sheet.alpha_composite(gl, (LW + d * fw, 24 + r * fh)); sheet.alpha_composite(Image.fromarray(img), (LW + d * fw, 24 + r * fh))
    p = f"{PREV}/{key}.png"; sheet.save(p, optimize=True); paths.append(p)
print("\n".join(paths))
