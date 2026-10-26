"""Shared helpers for the nature fragment: 1x/@2x rendering via the toon kit, tight grid packing, sway masks, previews."""
import os, sys, math, json, subprocess
import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
FRAG = os.path.dirname(HERE)                       # packages/assets/pack/nature
REPO = os.path.abspath(os.path.join(FRAG, "../../../.."))
sys.path.insert(0, os.path.join(REPO, "assets/tools"))
sys.path.insert(0, os.path.join(REPO, "packages/assets/pack/items/src"))
import toon, palette  # noqa: E402

# extra ramps (highlight, base, shade, deep) used only by this fragment
palette.RAMPS.update({
    "birch_bark": ["#ffffff", "#f1ece4", "#cfc6bc", "#9c9088"],
    "blossom":    ["#fff0f6", "#ffc9de", "#f29cbf", "#c8709a"],
    "pear":       ["#f4ffb0", "#d6e86a", "#a9c24a", "#78903a"],
    "peach":      ["#ffe0c4", "#ffb48a", "#f08a6e", "#c0604e"],
    "cherry":     ["#ff8f9a", "#e0304a", "#a81c3c", "#701630"],
    "orange":     ["#ffd27a", "#ffa63a", "#e67a22", "#b0521c"],
    "willow":     ["#d8f0a0", "#a8d478", "#7cae5c", "#56864a"],
    "palm":       ["#c8f08a", "#86c95a", "#5a9e48", "#3c7442"],
    "palm_bark":  ["#e8c690", "#c49c68", "#9a744c", "#6c5038"],
    "moss":       ["#c8e88a", "#94c45a", "#6a9a48", "#4a723e"],
    "rotwood":    ["#a88c74", "#7e6654", "#5c4a40", "#3e3230"],
    "dry":        ["#f0dca0", "#d4b878", "#ac8e58", "#7c6442"],
    "raspberry":  ["#ff9ab8", "#f04878", "#c02c5c", "#841e44"],
    "blackberry": ["#a890c8", "#5c4680", "#3c2c5c", "#261c3e"],
    "wool":       ["#ffffff", "#f6f0e6", "#ddd0c0", "#b0a090"],
})

K = 1
def _final(self, sharpen=True):
    im = toon.downscale(self.img, (self.w * K, self.h * K), sharpen)
    return toon.cel_snap(im, self.pal) if toon.CEL and getattr(self, "pal", None) else im   # CEL=1: solid cel look
toon.Canvas.final = _final

def render(fn, *a, **kw):
    """Render fn(...) -> image at 1x and @2x (the toon canvas supersamples at 4x, so 2x is a straight resolve)."""
    global K
    out = []
    for k in (1, 2):
        K = k; out.append(fn(*a, **kw))
    K = 1
    return out

class Frame:
    """img1/img2 with the pivot (feet) in 1x canvas coords."""
    def __init__(self, imgs, px, py):
        self.i1, self.i2 = imgs; self.px, self.py = px, py

def extents(fr):
    """(left, right, up, down) alpha extents around the pivot in 1x px, covering both scales."""
    L = R = U = D = 0.0
    for im, k in ((fr.i1, 1), (fr.i2, 2)):
        a = np.asarray(im)[..., 3] > 6
        ys, xs = np.nonzero(a)
        if not len(xs): continue
        L = max(L, fr.px - xs.min() / k); R = max(R, (xs.max() + 1) / k - fr.px)
        U = max(U, fr.py - ys.min() / k); D = max(D, (ys.max() + 1) / k - fr.py)
    return L, R, U, D

def up(v, m): return int(math.ceil(v / m) * m)

def pack_grid(key, frames, cols, out_dir, pad=2, sym=True, wa=4, ha=4):
    """Pack frames into one uniform grid atlas (cell = tightest box around the shared pivot + pad).
    Returns (atlas_json, anchor, [frame indices])."""
    ex = [extents(f) for f in frames]
    L = max(e[0] for e in ex); R = max(e[1] for e in ex); U = max(e[2] for e in ex); D = max(e[3] for e in ex)
    if sym: L = R = max(L, R)
    cols = min(cols, len(frames)); rows = math.ceil(len(frames) / cols)
    fw = up(L + R + 2 * pad, max(wa, 16 // math.gcd(cols, 16))); fh = up(U + D + 2 * pad, max(ha, 16 // math.gcd(rows, 16)))
    ox = math.floor(pad + L + (fw - (L + R + 2 * pad)) / 2); oy = math.floor(pad + U + (fh - (U + D + 2 * pad)) / 2)
    pages = []
    for k in (1, 2):
        pg = Image.new("RGBA", (fw * cols * k, fh * rows * k), (0, 0, 0, 0))
        for i, f in enumerate(frames):
            im = f.i1 if k == 1 else f.i2
            cx, cy = (i % cols) * fw + ox, (i // cols) * fh + oy
            pg.alpha_composite(im, (int(round((cx - f.px) * k)), int(round((cy - f.py) * k))))
            # hard clip to the cell so nothing bleeds into the neighbour's gutter
        pages.append(pg)
    assert max(pages[1].size) <= 2048, (key, pages[1].size)
    os.makedirs(os.path.join(out_dir, "atlases"), exist_ok=True)
    pages[0].save(os.path.join(out_dir, f"atlases/{key}.png"), optimize=True)
    pages[1].save(os.path.join(out_dir, f"atlases/{key}@2x.png"), optimize=True)
    aj = {"key": key, "image": f"atlases/{key}.png", "frameW": fw, "frameH": fh, "columns": cols, "rows": rows,
          "pages": [{"scale": 2, "image": f"atlases/{key}@2x.png"}]}
    return aj, {"x": round(ox / fw, 4), "y": round(oy / fh, 4)}, list(range(len(frames)))

def sway_mask(aj, anchor_y, out_dir):
    tools = os.path.join(REPO, "assets/survival_fx/tools/make_sway_mask.py")
    png = os.path.join(out_dir, aj["image"])
    subprocess.run([sys.executable, tools, png, "--frame", f"{aj['frameW']}x{aj['frameH']}", "--pivot-y", str(anchor_y),
                    "--out-dir", os.path.dirname(png)], check=True, stdout=subprocess.DEVNULL)
    aj["masks"] = {"sway": aj["image"].replace(".png", "_sway.png")}

def contact_sheet(items, path, cell=None, cols=8, scale=2, bg=(232, 226, 206)):
    """items: [(label, PIL image)] -> labelled preview sheet."""
    cw = cell or max(max(im.width for _, im in items), 40) * scale + 8
    ch = max(im.height for _, im in items) * scale + 18
    rows = math.ceil(len(items) / cols)
    sh = Image.new("RGBA", (cw * cols, ch * rows), bg + (255,)); d = ImageDraw.Draw(sh)
    for i, (lab, im) in enumerate(items):
        x, y = (i % cols) * cw, (i // cols) * ch
        im2 = im.resize((im.width * scale, im.height * scale), Image.NEAREST)
        sh.alpha_composite(im2, (x + (cw - im2.width) // 2, y + ch - 14 - im2.height))
        d.text((x + 3, y + ch - 12), lab[:22], fill=(60, 40, 50, 255))
    os.makedirs(os.path.dirname(path), exist_ok=True); sh.save(path)
