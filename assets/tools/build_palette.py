import json
from PIL import Image, ImageDraw, ImageFont
from palette import RAMPS, SHADOW, SHADOW_ALPHA, LIGHT_DIR, hex2rgb
out = {"name": "cozy-wild", "version": 2, "rampOrder": ["highlight", "base", "shade", "deep"],
       "lightDir": "top-left", "outline": {"default": RAMPS["ink"][2], "soft": RAMPS["ink"][1], "deep": RAMPS["ink"][3],
       "rule": "per-material: mix(material.deep, ink.shade, 0.55)"},
       "shadow": {"color": SHADOW, "alpha": SHADOW_ALPHA},
       "ramps": RAMPS,
       "flat": {f"{k}_{n}": c for k, v in RAMPS.items() for n, c in zip(["hl", "base", "shade", "deep"], v)}}
json.dump(out, open("../palette.json", "w"), indent=1)
S = 28; names = list(RAMPS)
W, H = 160 + 4 * S + 10, len(names) * (S + 2) + 10
im = Image.new("RGBA", (W, H), (250, 244, 232, 255)); d = ImageDraw.Draw(im)
try: f = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 12)
except Exception: f = ImageFont.load_default()
for i, n in enumerate(names):
    y = 5 + i * (S + 2); d.text((6, y + 7), n, fill=hex2rgb(RAMPS["ink"][2]), font=f)
    for j, c in enumerate(RAMPS[n]):
        d.rectangle([160 + j * S, y, 160 + (j + 1) * S - 2, y + S - 2], fill=hex2rgb(c), outline=hex2rgb(RAMPS["ink"][3]))
im.save("../palette.png"); print(im.size, len(names))
