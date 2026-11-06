"""Dedicated lettuce / hay (and rice icon) art: paint unused atlas cells only. Do not rebuild nature atlases."""
import json, os, sys, re
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "../../../../../"))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "assets/tools"))
sys.path.insert(0, os.path.join(ROOT, "assets/survival_fx/tools"))

import common
from crops import crop, wild, CW, CH, CB
from itemicons import _icon
from ktx2 import dilate

NATURE = os.path.join(ROOT, "packages/assets/pack/nature")
ATLAS = os.path.join(NATURE, "atlases")
MAN = os.path.join(NATURE, "manifest.nature.json")
PREV = "/workspace/assets/preview"

# Existing packed cell sizes / anchors (do not re-pack).
SPROUT = dict(key="nature_sprouts", fw=40, fh=52, cols=16, rows=4, ox=20, oy=28, px=24, py=48, anchor_y=0.5385)
CROP = dict(key="nature_crops", fw=44, fh=64, cols=16, rows=7, ox=22, oy=52, px=24, py=48, anchor_y=0.8125)
ICON = dict(key="nature_icons", fw=32, fh=32, cols=16, rows=8)

# Frame plan: unused cells only.
FRAMES = {
    "crop_lettuce_0": ("sprout", 53),
    "crop_lettuce_1": ("sprout", 54),
    "crop_hay_0": ("sprout", 55),
    "crop_hay_1": ("sprout", 56),
    "crop_lettuce_2": ("crop", 87),
    "crop_lettuce_3": ("crop", 88),
    "crop_lettuce": ("crop", 89),
    "wild_lettuce": ("crop", 90),
    "wild_lettuce_dep": ("crop", 91),
    "crop_hay_2": ("crop", 92),
    "crop_hay_3": ("crop", 93),
    "crop_hay": ("crop", 94),
    "wild_hay": ("crop", 95),
    "wild_hay_dep": ("crop", 96),
    "lettuce": ("icon", 97),
    "lettuce_seeds": ("icon", 98),
    "hay": ("icon", 99),
    "hay_seeds": ("icon", 100),
    "rice": ("icon", 101),
    "rice_seeds": ("icon", 102),
}


def render_world(key):
    if key.endswith("_dep"):
        return common.render(lambda k=key: wild(k.replace("wild_", "").replace("_dep", ""), False))
    if key.startswith("wild_"):
        return common.render(lambda k=key: wild(k[5:], True))
    if key.startswith("crop_"):
        rest = key[5:]
        if rest[-2:] in ("_0", "_1", "_2", "_3"):
            plant, stage = rest.rsplit("_", 1)
            return common.render(lambda p=plant, s=int(stage): crop(p, s))
        return common.render(lambda k=rest: crop(k, 4))
    raise ValueError(key)


def grow_sheet(path, new_w, new_h, mode="RGBA", fill=0):
    im = Image.open(path).convert(mode)
    if im.size[0] == new_w and im.size[1] == new_h:
        return im
    grown = Image.new(mode, (new_w, new_h), fill)
    grown.paste(im, (0, 0))
    grown.save(path, optimize=True)
    print("grew", path, "->", grown.size)
    return grown


def blit_world(spec, frame, imgs):
    for sc, im in ((1, imgs[0]), (2, imgs[1])):
        name = f"{spec['key']}.png" if sc == 1 else f"{spec['key']}@2x.png"
        path = os.path.join(ATLAS, name)
        sheet = Image.open(path).convert("RGBA")
        fw, fh, cols = spec["fw"] * sc, spec["fh"] * sc, spec["cols"]
        x = (frame % cols) * fw
        y = (frame // cols) * fh
        ox = (spec["ox"] - spec["px"]) * sc
        oy = (spec["oy"] - spec["py"]) * sc
        cell = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
        cell.paste(im, (ox, oy), im)
        sheet.paste(cell, (x, y))
        sheet.save(path, optimize=True)


def blit_icon(frame, imgs):
    spec = ICON
    for sc, im in ((1, imgs[0]), (2, imgs[1])):
        name = "nature_icons.png" if sc == 1 else "nature_icons@2x.png"
        path = os.path.join(ATLAS, name)
        sheet = Image.open(path).convert("RGBA")
        fw, fh, cols = spec["fw"] * sc, spec["fh"] * sc, spec["cols"]
        x = (frame % cols) * fw
        y = (frame // cols) * fh
        cell = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
        cell.paste(im, (0, 0), im)
        sheet.paste(cell, (x, y))
        sheet.save(path, optimize=True)


def paint_sway(spec, frames):
    color = os.path.join(ATLAS, f"{spec['key']}.png")
    sway_p = os.path.join(ATLAS, f"{spec['key']}_sway.png")
    im = Image.open(color).convert("RGBA")
    if os.path.exists(sway_p):
        sway = Image.open(sway_p).convert("L")
        if sway.size != im.size:
            grown = Image.new("L", im.size, 0)
            grown.paste(sway, (0, 0))
            sway = grown
    else:
        sway = Image.new("L", im.size, 0)
    arr = np.asarray(im, np.float32)
    out_a = np.array(sway, np.float32)
    fw, fh, cols, py = spec["fw"], spec["fh"], spec["cols"], spec["anchor_y"]
    BARK = np.array([[184, 128, 88], [138, 90, 60], [101, 65, 48], [71, 45, 38],
                     [176, 120, 80], [135, 86, 58], [97, 64, 46], [67, 44, 36],
                     [184, 178, 176], [138, 132, 148], [95, 90, 112]], np.float32)
    for f in frames:
        x, y = (f % cols) * fw, (f // cols) * fh
        w, h = fw, fh
        fr = arr[y:y + h, x:x + w]
        al = fr[..., 3] / 255
        if al.max() < 0.1:
            out_a[y:y + h, x:x + w] = 0
            continue
        rows = np.where(al.max(1) > 0.3)[0]
        top = int(rows.min())
        base = min(h - 1, int(py * h))
        yy = np.arange(h, dtype=np.float32)[:, None] * np.ones((1, w), np.float32)
        hn = np.clip((base - yy) / max(1, base - top), 0, 1)
        rgb = fr[..., :3]
        bark = np.clip(1 - np.min(np.linalg.norm(rgb[..., None, :] - BARK[None, None], axis=-1), -1) / 38, 0, 1)
        lum = (rgb * [0.299, 0.587, 0.114]).sum(-1) / 255
        ink = lum < 0.25
        leafy = (1 - bark) * (al > 0.3)
        lf = np.asarray(Image.fromarray((leafy * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(3)), np.float32) / 255
        leafy = np.where(ink, lf, leafy)
        wt = (hn ** 1.4) * (0.25 + 0.75 * leafy)
        wt *= np.clip((hn - 0.08) / 0.15, 0, 1)
        wt = np.asarray(Image.fromarray((wt * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.5)), np.float32) / 255
        out_a[y:y + h, x:x + w] = wt * (al > 0.02) * 255
    Image.fromarray((np.clip(out_a, 0, 255) + 0.5).astype(np.uint8), "L").save(sway_p)
    print("sway", sway_p)


def set_idle_frame(raw, key, frame):
    needle = f'"key": "{key}"'
    i = raw.find(needle)
    if i < 0:
        raise SystemExit(f"missing sprite {key}")
    j = raw.find('"frames":', i)
    k = raw.find("]", j)
    block = raw[j:k + 1]
    if "\n" in block:
        updated = f'"frames": [\n      {frame}\n     ]'
    else:
        updated = re.sub(r"\[\s*\d+\s*\]", f"[{frame}]", block, count=1)
    return raw[:j] + updated + raw[k + 1:]


def sprite_block(key, atlas, frame, anchor_y, extra_anim=None, sway=True):
    anim = f'''   "animations": {{
    "idle": {{
     "frames": [
      {frame}
     ],
     "fps": 1
    }}'''
    if extra_anim:
        anim += f''',
    "depleted": {{
     "frames": [
      {extra_anim}
     ],
     "fps": 1
    }}'''
    anim += "\n   }"
    sway_txt = ""
    if sway:
        amp = 0.5 if atlas == "nature_sprouts" else 0.6
        sway_txt = f''',
   "sway": {{
    "amp": {amp},
    "freq": 0.7,
    "stiffness": 0.5
   }}'''
    return f'''  {{
   "key": "{key}",
   "category": "resource",
   "atlas": "{atlas}",
   "anchor": {{
    "x": 0.5,
    "y": {anchor_y}
   }},
{anim}{sway_txt}
  }}'''


def update_manifest():
    raw = open(MAN).read()
    # grow nature_crops rows 6 -> 7 (only the first rows field after that atlas key)
    i = raw.find('"key": "nature_crops"')
    j = raw.find('"rows":', i)
    raw = raw[:j] + re.sub(r'"rows":\s*\d+', '"rows": 7', raw[j:j + 40], count=1) + raw[j + 40:]

    for key, frame in (("lettuce", 97), ("lettuce_seeds", 98), ("hay", 99),
                       ("hay_seeds", 100), ("rice", 101), ("rice_seeds", 102)):
        raw = set_idle_frame(raw, key, frame)

    if '"key": "crop_lettuce_0"' in raw:
        open(MAN, "w").write(raw)
        print("manifest already has new sprites; frames/rows refreshed")
        return

    new_sprites = [
        sprite_block("crop_lettuce_0", "nature_sprouts", 53, 0.5385),
        sprite_block("crop_lettuce_1", "nature_sprouts", 54, 0.5385),
        sprite_block("crop_lettuce_2", "nature_crops", 87, 0.8125),
        sprite_block("crop_lettuce_3", "nature_crops", 88, 0.8125),
        sprite_block("crop_lettuce", "nature_crops", 89, 0.8125),
        sprite_block("wild_lettuce", "nature_crops", 90, 0.8125, extra_anim=91),
        sprite_block("crop_hay_0", "nature_sprouts", 55, 0.5385),
        sprite_block("crop_hay_1", "nature_sprouts", 56, 0.5385),
        sprite_block("crop_hay_2", "nature_crops", 92, 0.8125),
        sprite_block("crop_hay_3", "nature_crops", 93, 0.8125),
        sprite_block("crop_hay", "nature_crops", 94, 0.8125),
        sprite_block("wild_hay", "nature_crops", 95, 0.8125, extra_anim=96),
    ]
    insert = ",\n" + ",\n".join(new_sprites) + "\n"
    close = raw.rfind("\n ]\n}")
    if close < 0:
        raise SystemExit("could not find sprites array close")
    raw = raw[:close] + insert + raw[close:]
    open(MAN, "w").write(raw)
    print("manifest updated")


def extract(spec_key, frame, scale=2):
    name = f"{spec_key}.png" if scale == 1 else f"{spec_key}@2x.png"
    sheet = Image.open(os.path.join(ATLAS, name)).convert("RGBA")
    specs = {"nature_sprouts": SPROUT, "nature_crops": CROP, "nature_icons": ICON}
    spec = specs[spec_key]
    fw, fh, cols = spec["fw"] * scale, spec["fh"] * scale, spec["cols"]
    x, y = (frame % cols) * fw, (frame // cols) * fh
    return sheet.crop((x, y, x + fw, y + fh))


def previews():
    os.makedirs(PREV, exist_ok=True)
    bg = (36, 28, 40, 255)
    label = (255, 250, 240, 255)

    def strip(title, cells, path, cell_w=88, cell_h=128):
        w = 16 + len(cells) * (cell_w + 12)
        h = cell_h + 48
        canvas = Image.new("RGBA", (w, h), bg)
        dr = ImageDraw.Draw(canvas)
        dr.text((8, 4), title, fill=label)
        for i, (name, im) in enumerate(cells):
            x = 12 + i * (cell_w + 12)
            canvas.paste(im, (x, 22), im)
            dr.text((x, 22 + cell_h - 8), name, fill=label)
        canvas.save(path)
        print("preview", path)

    lettuce = [
        ("_0", extract("nature_sprouts", 53)),
        ("_1", extract("nature_sprouts", 54)),
        ("_2", extract("nature_crops", 87)),
        ("_3", extract("nature_crops", 88)),
        ("ripe", extract("nature_crops", 89)),
        ("wild", extract("nature_crops", 90)),
        ("depl", extract("nature_crops", 91)),
        ("icon", extract("nature_icons", 97)),
        ("seed", extract("nature_icons", 98)),
    ]
    strip("lettuce: stages + wild + icons", lettuce, os.path.join(PREV, "lettuce_unique.png"))

    hay = [
        ("_0", extract("nature_sprouts", 55)),
        ("_1", extract("nature_sprouts", 56)),
        ("_2", extract("nature_crops", 92)),
        ("_3", extract("nature_crops", 93)),
        ("ripe", extract("nature_crops", 94)),
        ("wild", extract("nature_crops", 95)),
        ("depl", extract("nature_crops", 96)),
        ("bale", extract("nature_icons", 99)),
        ("seed", extract("nature_icons", 100)),
    ]
    strip("hay: forage grass + bale (not wheat)", hay, os.path.join(PREV, "hay_unique.png"))

    # comparison of produce / seed icons vs the things they used to share
    comps = [
        ("cabbage", extract("nature_icons", 68)),
        ("lettuce", extract("nature_icons", 97)),
        ("wheat", extract("nature_icons", 64)),
        ("hay", extract("nature_icons", 99)),
        ("rice", extract("nature_icons", 101)),
        ("wht sd", extract("nature_icons", 8)),
        ("cab sd", extract("nature_icons", 15)),
        ("let sd", extract("nature_icons", 98)),
        ("hay sd", extract("nature_icons", 100)),
        ("rice sd", extract("nature_icons", 102)),
    ]
    strip("icons: no shared frames", comps, os.path.join(PREV, "lettuce_hay_icon_compare.png"), cell_w=72, cell_h=80)

    wheat = [
        ("w_0", extract("nature_sprouts", 0)),
        ("w_1", extract("nature_sprouts", 1)),
        ("w_2", extract("nature_crops", 0)),
        ("w_3", extract("nature_crops", 1)),
        ("ripe", extract("nature_crops", 38)),
        ("wild", extract("nature_crops", 57)),
        ("depl", extract("nature_crops", 58)),
        ("sheaf", extract("nature_icons", 64)),
        ("seed", extract("nature_icons", 8)),
    ]
    strip("wheat (unchanged, already unique)", wheat, os.path.join(PREV, "wheat_unique_confirm.png"))


def encode_ktx2():
    import subprocess, tempfile
    jobs = [
        ("nature_icons.png", "etc1s", "srgb"),
        ("nature_icons@2x.png", "etc1s", "srgb"),
        ("nature_sprouts.png", "etc1s", "srgb"),
        ("nature_sprouts@2x.png", "etc1s", "srgb"),
        ("nature_crops.png", "etc1s", "srgb"),
        ("nature_crops@2x.png", "etc1s", "srgb"),
        ("nature_sprouts_sway.png", "uastc", "linear"),
        ("nature_crops_sway.png", "uastc", "linear"),
    ]
    for name, mode, oetf in jobs:
        src = os.path.join(ATLAS, name)
        dst = os.path.splitext(src)[0] + ".ktx2"
        tmp = None
        use = src
        if mode == "etc1s":
            fd, tmp = tempfile.mkstemp(suffix=".png")
            os.close(fd)
            dilate(Image.open(src).convert("RGBA")).save(tmp, compress_level=1)
            use = tmp
        cmd = ["toktx", "--t2", "--genmipmap", "--assign_oetf", oetf]
        if mode == "etc1s":
            cmd += ["--encode", "etc1s", "--clevel", "2", "--qlevel", "192"]
        else:
            cmd += ["--encode", "uastc", "--uastc_quality", "2", "--uastc_rdo_l", "0.5", "--zcmp", "19"]
        print("toktx", name)
        subprocess.run(cmd + [dst, use], check=True)
        if tmp:
            os.remove(tmp)


def main():
    # Grow nature_crops by one row so ripe + wild + depleted all get their own cells.
    grow_sheet(os.path.join(ATLAS, "nature_crops.png"), 44 * 16, 64 * 7)
    grow_sheet(os.path.join(ATLAS, "nature_crops@2x.png"), 88 * 16, 128 * 7)
    sway = os.path.join(ATLAS, "nature_crops_sway.png")
    if os.path.exists(sway):
        grow_sheet(sway, 44 * 16, 64 * 7, mode="L", fill=0)

    crop_frames = []
    sprout_frames = []
    for key, (kind, frame) in FRAMES.items():
        if kind == "icon":
            imgs = _icon(key)
            blit_icon(frame, imgs)
            print("icon", key, frame)
        else:
            imgs = render_world(key)
            spec = SPROUT if kind == "sprout" else CROP
            blit_world(spec, frame, imgs)
            (sprout_frames if kind == "sprout" else crop_frames).append(frame)
            print("world", key, kind, frame, imgs[0].size)

    paint_sway(SPROUT, sprout_frames)
    paint_sway(CROP, crop_frames)
    update_manifest()
    previews()
    print("artpass lettuce/hay generate done")


if __name__ == "__main__":
    main()
