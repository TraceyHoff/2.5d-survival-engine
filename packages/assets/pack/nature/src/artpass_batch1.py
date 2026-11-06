"""Batch 1 of the README art pass: gt_grass_grazed (+ seasonal twins) and a dedicated build_apiary icon."""
import os, sys, json
import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../../../"))
PACK = os.path.join(ROOT, "packages/assets/pack")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "assets/tools"))
from ground_core import TOP, Tile
from ground_mats import P, tuft, tone, patches, vn, U, V
from ground_pack import bleed, PAD, CW, CH, ANCHOR, FW, FH
from ktx2 import dilate

SEAS = ("summer", "fall", "winter")
TW = {"summer": "", "fall": "_fall", "winter": "_winter"}


def grazed_tile(season):
    """Short, eaten-down grass: duller lawn, darker earth peeking through, no flowers, stubby leftover tufts."""
    p = P["grass"][season]
    d = P["dirt"][season]
    t = Tile()
    worn = [p["t"][1], p["t"][2], p["t"][2], p["t"][3]]
    tone(t, TOP, worn, 71, 0, 2, 3, (.06, .1))
    soil = patches(0, 1400, 3, (.05, .09))
    so = TOP & (soil > .58)
    t.fill(so, d["t"][2])
    t.fill(so & (soil > .78), d["t"][3])
    rng = np.random.default_rng(7100 + SEAS.index(season) * 17)
    n_tuft = 8 if season != "winter" else 5
    for _ in range(n_tuft):
        u, v = float(rng.uniform(.18, .82)), float(rng.uniform(.22, .78))
        tuft(t, u, v, p["blade"], h=float(rng.uniform(1.5, 2.5)), n=int(rng.integers(2, 4)),
             seed=int(rng.integers(1e6)), spread=1.2)
    if season == "winter":
        t.fill(TOP & (vn(U, V, 22, 77) > .94), p["frost"])
    return t.finish(TOP)


def save_grazed_atlas():
    from ground_core import out1, out2
    cells = []
    for se in SEAS:
        t = grazed_tile(se)
        a, b = out1(t), out2(t)
        cells.append((se, np.asarray(a), np.asarray(b)))
    cols, rows = 3, 1
    atlases = {}
    for sc, idx in ((1, 1), (2, 2)):
        im = Image.new("RGBA", (cols * CW * sc, rows * CH * sc), (0, 0, 0, 0))
        for i, (se, a, b) in enumerate(cells):
            src = a if sc == 1 else b
            src = src.copy()
            src[..., 3] = np.where(src[..., 3] >= 128, 255, 0)
            src[src[..., 3] == 0] = 0
            pasted = bleed(src, sc)
            im.paste(Image.fromarray(pasted, "RGBA"), (i * CW * sc, 0))
        im = dilate(im)
        suf = "" if sc == 1 else "@2x"
        path = os.path.join(PACK, f"atlases/gt_grazed{suf}.png")
        im.save(path, optimize=True)
        atlases[sc] = path
        print("wrote", path, im.size)
    man_path = os.path.join(PACK, "manifest.json")
    m = json.load(open(man_path))
    atlas = {
        "key": "gt_grazed",
        "image": "atlases/gt_grazed.png",
        "frameW": CW,
        "frameH": CH,
        "columns": cols,
        "rows": rows,
        "pages": [{"scale": 2, "image": "atlases/gt_grazed@2x.png", "ktx2": "atlases/gt_grazed@2x.ktx2"}],
        "ktx2": "atlases/gt_grazed.ktx2",
    }
    m["atlases"] = [a for a in m["atlases"] if a["key"] != "gt_grazed"]
    last_gt = max(i for i, a in enumerate(m["atlases"]) if a["key"].startswith("gt_"))
    m["atlases"].insert(last_gt + 1, atlas)
    m["sprites"] = [s for s in m["sprites"] if not s["key"].startswith("gt_grass_grazed")]
    insert_at = max(i for i, s in enumerate(m["sprites"]) if s["key"].startswith("gt_grass")) + 1
    new_sprites = []
    for i, se in enumerate(SEAS):
        key = "gt_grass_grazed" + TW[se]
        ph = "gt_grass" + TW[se] if se != "summer" else "gt_grass"
        new_sprites.append({
            "key": key,
            "category": "tile",
            "atlas": "gt_grazed",
            "anchor": dict(ANCHOR),
            "animations": {"idle": {"frames": [i], "fps": 1}},
            "placeholder": ph,
        })
    m["sprites"][insert_at:insert_at] = new_sprites
    open(man_path, "w").write(json.dumps(m, indent=2, ensure_ascii=False) + "\n")
    print("manifest sprites", [s["key"] for s in new_sprites])
    return cells


def hive_icon(size):
    """Cute stacked beehive that reads at menu size. Solid cel, binary alpha, bold outline."""
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    s = size / 32
    def r(n): return int(round(n * s))
    ol = (48, 28, 40, 255)
    wood = [(232, 186, 118, 255), (212, 154, 82, 255), (176, 118, 56, 255)]
    hi = (248, 214, 150, 255)
    # contact shadow (one flat translucent tone)
    d.ellipse([r(7), r(26), r(25), r(31)], fill=(40, 24, 32, 90))
    boxes = [
        (8, 18, 24, 27),
        (9, 11, 23, 19),
        (10, 5, 22, 12),
    ]
    for i, (x0, y0, x1, y1) in enumerate(boxes):
        d.rounded_rectangle([r(x0), r(y0), r(x1), r(y1)], radius=max(1, r(1.5)), outline=ol, fill=wood[1], width=max(1, r(1)))
        # left highlight, right shade
        d.rectangle([r(x0 + 1), r(y0 + 1), r(x0 + 3), r(y1 - 1)], fill=hi)
        d.rectangle([r(x1 - 3), r(y0 + 1), r(x1 - 1), r(y1 - 1)], fill=wood[2])
        # slat line
        mid = (y0 + y1) / 2
        d.line([r(x0 + 2), r(mid), r(x1 - 2), r(mid)], fill=wood[2], width=max(1, r(1)))
    # roof
    d.polygon([(r(9), r(6)), (r(16), r(2)), (r(23), r(6))], fill=wood[1], outline=ol)
    d.polygon([(r(11), r(6)), (r(16), r(3)), (r(16), r(6))], fill=hi)
    # entrance
    d.ellipse([r(14), r(21), r(18), r(25)], fill=(48, 28, 40, 255))
    # two tiny bees
    def bee(cx, cy):
        d.ellipse([r(cx - 2), r(cy - 1), r(cx + 2), r(cy + 2)], fill=(255, 214, 64, 255), outline=ol)
        d.line([r(cx), r(cy - 1), r(cx), r(cy + 2)], fill=ol, width=max(1, r(1)))
        d.ellipse([r(cx - 1), r(cy - 3), r(cx + 1), r(cy - 1)], fill=(230, 245, 255, 255), outline=ol)
    bee(22, 9)
    bee(7, 14)
    # binary alpha except the reserved shadow
    px = np.array(im, copy=True)
    shadow = (px[..., 3] > 0) & (px[..., 3] < 200)
    solid = px[..., 3] >= 200
    px[..., 3] = np.where(solid, 255, np.where(shadow, 90, 0))
    return Image.fromarray(px, "RGBA")


def paste_apiary_icon():
    items = os.path.join(PACK, "items/atlases")
    man_path = os.path.join(PACK, "items/manifest.items.json")
    m = json.load(open(man_path))
    atlas = next(a for a in m["atlases"] if a["key"] == "items_build")
    cols, rows, fw, fh = atlas["columns"], atlas["rows"], atlas["frameW"], atlas["frameH"]
    frame = 286
    assert frame < cols * rows, (frame, cols, rows)
    col, row = frame % cols, frame // cols
    for sc, name in ((1, "items_build.png"), (2, "items_build@2x.png")):
        path = os.path.join(items, name)
        sheet = Image.open(path).convert("RGBA")
        icon = hive_icon(fw * sc)
        x, y = col * fw * sc, row * fh * sc
        # clear cell then paste
        cell = Image.new("RGBA", (fw * sc, fh * sc), (0, 0, 0, 0))
        # 2px padding
        pad = 2 * sc
        inner = hive_icon(fw * sc - 2 * pad)
        cell.paste(inner, (pad, pad), inner)
        sheet.paste(cell, (x, y))
        sheet.save(path, optimize=True)
        print("updated", path, "cell", col, row, "frame", frame)
    raw = open(man_path).read()
    needle = '"key": "build_apiary"'
    i = raw.find(needle)
    if i < 0:
        raise SystemExit("build_apiary sprite missing")
    j = raw.find('"frames":', i)
    k = raw.find(']', j)
    block = raw[j:k+1]
    import re
    updated = re.sub(r"\[\s*\d+\s*\]", f"[{frame}]", block, count=1)
    # keep original multiline list style if present
    if "\n" in block:
        updated = f'"frames": [\n      {frame}\n     ]'
    raw = raw[:j] + updated + raw[k+1:]
    open(man_path, "w").write(raw)
    print("build_apiary -> frame", frame)


def previews(cells):
    out = "/workspace/assets/preview"
    os.makedirs(out, exist_ok=True)
    # grazed vs ungrazed: try to sample existing gt_grass cells from packed pages
    labels = ["summer", "fall", "winter"]
    w, h = 68 * 2 * 3 + 40, 52 * 2 + 50
    canvas = Image.new("RGBA", (w, h), (36, 28, 40, 255))
    dr = ImageDraw.Draw(canvas)
    dr.text((8, 4), "ungrazed (ref tone) vs grazed", fill=(255, 250, 240, 255))
    for i, (se, a, b) in enumerate(cells):
        g = Image.fromarray(b, "RGBA")  # @2x art area 128x96; we have 64x48 in `a`
        canvas.paste(Image.fromarray(a, "RGBA"), (16 + i * 150, 28), Image.fromarray(a, "RGBA"))
        dr.text((16 + i * 150, 28 + 50), f"{se} grazed", fill=(255, 250, 240, 255))
    canvas.save(os.path.join(out, "grazed_grass.png"))
    icon64 = hive_icon(64)
    icon32 = hive_icon(32)
    ic = Image.new("RGBA", (220, 120), (36, 28, 40, 255))
    ic.paste(icon32, (20, 30), icon32)
    ic.paste(icon64, (80, 20), icon64)
    ImageDraw.Draw(ic).text((20, 4), "build_apiary 32 / 64", fill=(255, 250, 240, 255))
    ic.save(os.path.join(out, "build_apiary_icon.png"))
    print("previews written")


if __name__ == "__main__":
    cells = save_grazed_atlas()
    paste_apiary_icon()
    previews(cells)
    print("batch1 generate done")
