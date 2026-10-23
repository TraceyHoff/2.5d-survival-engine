"""Decode the MTSDF atlases (median(rgb) and alpha) to a test strip: preview/font_mtsdf.png"""
import json, numpy as np, os
from PIL import Image
R = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
rows = []
for name in ("regular", "bold"):
    js = json.load(open(f"{R}/fonts/fredoka_{name}_mtsdf.json")); pg = np.asarray(Image.open(f"{R}/fonts/{js['pages'][0]}")).astype(float) / 255
    C = {c["id"]: c for c in js["chars"]}
    for txt, sz in (("Mabel's Cozy Pantry Shop  ×12  Crème brûlée", 48), ("Sold out · 3 Berries · Öl Ñ ¿?", 24), ("Bo  999  stall.badge.open", 12)):
        s = sz / js["info"]["size"]; W = int(sum(C[ord(ch)]["xadvance"] for ch in txt) * s) + 8; H = int(js["common"]["lineHeight"] * s) + 6
        out = np.ones((H, W)); x = 4
        for ch in txt:
            c = C[ord(ch)]
            if c["width"]:
                g = pg[c["y"]:c["y"] + c["height"], c["x"]:c["x"] + c["width"]]
                gi = Image.fromarray((g * 255).astype(np.uint8)); gw, gh = max(1, round(c["width"] * s)), max(1, round(c["height"] * s))
                g = np.asarray(gi.resize((gw, gh), Image.BILINEAR)).astype(float) / 255
                d = np.median(g[..., :3], axis=2); spx = js["distanceField"]["distanceRange"] * s
                a = np.clip((d - 0.5) * spx + 0.5, 0, 1)
                ox, oy = int(x + c["xoffset"] * s), int(3 + c["yoffset"] * s)
                ys, xs = slice(max(0, oy), min(H, oy + gh)), slice(max(0, ox), min(W, ox + gw))
                out[ys, xs] = np.minimum(out[ys, xs], 1 - a[ys.start - oy:ys.stop - oy, xs.start - ox:xs.stop - ox])
            x += c["xadvance"] * s
        rows.append(Image.fromarray((out * 255).astype(np.uint8)))
im = Image.new("L", (max(r.width for r in rows), sum(r.height for r in rows)), 255); y = 0
for r in rows: im.paste(r, (0, y)); y += r.height
im.save(f"{R}/preview/font_mtsdf.png"); print(im.size)
