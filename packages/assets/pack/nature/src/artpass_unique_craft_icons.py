"""Give shared/missing tool and craftable items their own nature_icons frames.

Does not rebuild nature_icons from scratch — only blits unused cells 107-118
and retargets sprite records. Existing fruit_salad / baked_beans / vegetable_stew
/ mushroom pixels stay put.
"""
import json, os, sys, tempfile, subprocess
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "../../../../../"))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "assets/tools"))
sys.path.insert(0, os.path.join(ROOT, "packages/assets/pack/items/src"))

import draw
from draw import C, lt, dk
from itemicons import I, sh, M
from ktx2 import dilate

NATURE = os.path.join(ROOT, "packages/assets/pack/nature")
ATLAS = os.path.join(NATURE, "atlases")
MAN = os.path.join(NATURE, "manifest.nature.json")
ROOT_MAN = os.path.join(ROOT, "packages/assets/pack/manifest.json")
PREV = "/workspace/assets/preview"

# unused nature_icons cells (16x8 = 128, 0-106 used)
FRAMES = {
    "salad": 107,
    "rice_bowl": 108,
    "truffle_stew": 109,
    "truffle": 110,
    "paint_brush": 111,
    "honey_tea": 112,
    "salt_brew": 113,
    "charcoal_tonic": 114,
    "cooling_brew": 115,
    "medicated_bandage": 116,
    "cloth_mask": 117,
    "waterskin": 118,
    "boiled_water_flask": 119,
    "boiled_canteen": 120,
    "boiled_water_bottle": 121,
    "boiled_waterskin": 122,
}

# existing sprites that only need their frame retargeted
RETARGET_NATURE = ("salad", "rice_bowl", "truffle_stew")
# new sprite keys to append
APPEND = ("paint_brush", "honey_tea", "salt_brew", "charcoal_tonic",
          "cooling_brew", "medicated_bandage", "cloth_mask", "waterskin",
          "boiled_water_flask", "boiled_canteen", "boiled_water_bottle",
          "boiled_waterskin")


def salad(c):
    """Green leafy bowl — not the mixed-fruit fruit_salad."""
    I.bowl(c, '#6fbf4e', [
        (11.5, 15.6, '#8fcf6a'), (15.5, 15.2, '#5aa048'),
        (19.5, 16.0, '#c4e07a'), (13.5, 17.2, '#e8402e'),
        (18.0, 17.4, '#f2c84b'),
    ], steam=False)
    # extra ruffled leaf
    c.poly([(10, 15.2), (13, 13.2), (16, 15.0)], '#8fcf6a', ol=False)


def rice_bowl(c):
    """White rice mound in a bowl — not orange baked beans."""
    I.bowl(c, '#f4efe4', [
        (12, 16.0, '#fff8ee'), (16, 15.4, '#efe6d4'),
        (20, 16.2, '#fff8ee'), (14, 17.2, '#e8dcc8'),
        (18.5, 17.4, '#fff8ee'),
    ], steam=True)
    # chopsticks
    c.stroke([(23.5, 8), (21, 16)], 1.0, '#8a5a32')
    c.stroke([(25.5, 8.5), (22.2, 16.2)], 1.0, '#8a5a32')


def truffle_stew(c):
    """Dark earthy stew with lumpy black truffle — not the bright veg stew."""
    I.bowl(c, '#5a3420', [
        (12, 15.8, '#2a1c14'), (16.5, 15.4, '#3a2818'),
        (20, 16.2, '#2a1c14'), (14, 17.2, '#c8783a'),
        (18.2, 17.4, '#2a1c14'),
    ], steam=True)
    c.ell(16.2, 16.6, 2.0, 1.6, '#2a1c14', owf=.5)
    c.dot(15.6, 16.2, .45, lt('#5a3420', .35), 200)


def truffle(c):
    """Lumpy dark underground fungus — not a red-capped mushroom."""
    sh(c, 10)
    col = '#4a3020'
    c.ell(16, 18, 8.2, 6.4, col, shade=.35)
    c.ell(12.5, 16.5, 3.4, 3.0, dk(col, .12), ol=False)
    c.ell(20.0, 17.2, 3.2, 2.8, dk(col, .08), ol=False)
    c.ell(16.5, 14.4, 3.6, 3.0, lt(col, .08), ol=False)
    c.ell(13.8, 20.4, 2.6, 2.2, dk(col, .18), ol=False)
    c.ell(19.4, 20.0, 2.4, 2.0, dk(col, .15), ol=False)
    # soil crumbs
    for x, y in ((8.5, 24.5), (23.5, 24), (11, 26), (20, 26.5)):
        c.ell(x, y, 1.3, .8, '#6a4a30', owf=.5)
    c.shine(13.2, 15.2, .8, 160)


def paint_brush(c):
    """Wooden handle + ferrule + paint-dipped bristles — not a stone axe."""
    sh(c, 10)
    # handle
    c.poly([(13.2, 27), (14.2, 14), (17.8, 14), (18.8, 27)], '#c49a62', shade=.3)
    c.line([(14.6, 25), (14.8, 16)], .6, (255, 255, 255), 110)
    # ferrule
    c.rect(13.4, 12.2, 18.6, 15.2, '#b8c0c8', r=.6)
    c.line([(13.6, 13.7), (18.4, 13.7)], .45, dk('#b8c0c8', .35), 180)
    # bristle fan
    br = '#f2c84b'
    c.poly([(12.2, 12.4), (10.5, 5.5), (16, 4.2), (21.5, 5.5), (19.8, 12.4)], br, shade=.3)
    # paint dip (blue)
    c.poly([(10.8, 7.2), (10.5, 5.5), (16, 4.2), (21.5, 5.5), (21.2, 7.2)], '#4a8adf', ol=False)
    c.shine(13.2, 6.2, .6, 180)


def honey_tea(c):
    """Amber teacup with honey drip — not a leafed bottle or honey jar."""
    sh(c, 11)
    cup = '#f4efe6'
    c.ell(15, 22.5, 8.2, 3.2, dk(cup, .15))
    c.poly([(7.2, 16), (22.8, 16), (21.2, 23), (9.0, 23)], cup, shade=.3)
    c.ell(15, 16, 7.8, 2.6, '#d8c8b0')
    c.ell(15, 16, 6.4, 1.9, '#e6a24a', ol=False)
    # handle
    c.stroke([(22.4, 17), (26.2, 17.5), (25.6, 22), (21.6, 21.5)], 1.4, cup)
    # honey drip on rim
    c.ell(18.5, 16.2, 1.3, 1.0, '#f2c84b', ol=False)
    c.stroke([(19.2, 16.6), (20.2, 20.5)], 1.1, '#e6a24a')
    c.dot(20.4, 21.2, .8, '#e6a24a')
    # steam
    for x in (12, 16, 19.5):
        c.line([(x, 13), (x + 1, 10.5), (x - .3, 8)], .6, (255, 255, 255), 150)
    c.shine(10.5, 18, .7, 160)


def salt_brew(c):
    """Pale saline tonic with salt crystals — not generic berries."""
    I.bottle(c, '#d8e8f0', '#eef6fa', steam=False, label='#f7ead1')
    # salt crystals
    for x, y in ((14.2, 20), (16.4, 19.2), (18.2, 20.6)):
        c.poly([(x, y - 1.2), (x + 1.1, y), (x, y + 1.2), (x - 1.1, y)], '#ffffff', ol=False)


def charcoal_tonic(c):
    """Inky charcoal bottle."""
    I.bottle(c, '#3a3634', '#2a2624', cork='#6a5340', label='#c8b090')
    c.ell(16, 20.2, 1.6, 1.3, '#1a1816', owf=.5)


def cooling_brew(c):
    """Icy mint tonic."""
    I.bottle(c, '#c8f0ec', '#7ed4d0', cork='#d8ece8', label='#eef8f6', steam=False)
    # frost sparkles
    for x, y in ((12.5, 14), (19.5, 13.5), (13, 23.5), (19, 24)):
        c.dot(x, y, .55, '#ffffff', 200)


def medicated_bandage(c):
    """Rolled bandage with a green herbal stain — not a plain white roll."""
    sh(c, 10)
    col = '#f4efe6'
    c.ell(16, 18, 9.2, 7.4, col, shade=.3)
    # spiral wrap
    for y in (14.5, 17.5, 20.5, 23.5):
        c.line([(8.5, y), (23.5, y)], .55, dk(col, .25), 170)
    # herb stain + leaf
    c.ell(16, 17.5, 3.4, 2.8, '#6fbf4e', owf=.55)
    c.poly([(16, 15.2), (18.6, 17.2), (16, 19.8), (13.4, 17.2)], '#5aa048', ol=False)
    c.line([(16, 15.4), (16, 19.6)], .45, '#3d7a38', 180)
    c.shine(11.5, 15.2, .8, 170)


def cloth_mask(c):
    """Tied cloth face mask."""
    sh(c, 10)
    col = '#e8e0d0'
    c.poly([(6, 14), (26, 14), (24.5, 22), (7.5, 22)], col, shade=.3)
    c.poly([(8, 14.2), (16, 12.4), (24, 14.2), (22.5, 20.8), (9.5, 20.8)], lt(col, .08), ol=False)
    # ear loops
    c.stroke([(6.2, 15.5), (3.2, 13), (3.6, 20), (7.2, 20.5)], 1.15, dk(col, .15))
    c.stroke([(25.8, 15.5), (28.8, 13), (28.4, 20), (24.8, 20.5)], 1.15, dk(col, .15))
    # center seam
    c.line([(16, 13.2), (16, 21)], .45, dk(col, .3), 160)
    c.shine(10, 15.5, .7, 160)


def waterskin(c):
    """Leather waterskin with a stopper — not a glass flask."""
    sh(c, 10)
    col = '#8a5a32'
    c.ell(16, 19, 8.6, 7.6, col, shade=.35)
    c.poly([(12.5, 12), (19.5, 12), (21, 16), (11, 16)], lt(col, .05))
    # neck + cork
    c.rect(14.2, 8.2, 17.8, 13.2, dk(col, .1), r=.6)
    c.rect(13.8, 6.0, 18.2, 8.8, '#c99a6b', r=.7)
    # stitch
    for y in (16, 20, 24):
        c.line([(10.5, y), (21.5, y)], .35, '#c4a070', 150)
    c.line([(11, 18), (11, 25)], .55, (255, 220, 180), 90)
    c.shine(12.2, 16.2, .8, 150)



def steam_wisps(c):
    for x in (11, 16, 21):
        c.line([(x, 5.5), (x + 1.1, 3.2), (x - 0.4, 1.2)], .65, (255, 255, 255), 165)


def boiled_water_flask(c):
    """Round brown flask like water_flask, with steam and bubbles."""
    sh(c, 10)
    body = '#8a5340'
    c.ell(16, 19.2, 9.0, 8.4, body, shade=.35)
    c.rect(13.6, 9.0, 18.4, 13.2, dk(body, .08), r=.5)
    c.rect(13.2, 6.4, 18.8, 9.4, '#c99a6b', r=.7)
    c.ell(16, 19.6, 5.5, 5.2, '#3aa0d8', ol=False)
    c.ell(14.8, 18.2, 2.0, 1.6, '#7ec8ee', ol=False)
    for x, y, r in ((14.4, 20.8, .75), (17.4, 18.6, .55), (16.2, 22.0, .45)):
        c.ell(x, y, r, r, '#e8f6ff', owf=.45)
    steam_wisps(c)
    c.shine(12.4, 15.8, .8, 150)


def boiled_canteen(c):
    """Olive kidney canteen like canteen, with steam from the cap."""
    sh(c, 10)
    body = '#8a9a62'
    c.ell(16.4, 18.8, 9.0, 8.0, body, shade=.35)
    c.stroke([(8.8, 14.2), (7.2, 10.2), (12.2, 8.6), (16.4, 10.4)], 1.7, '#6a4a30')
    c.ell(16.4, 18.4, 2.5, 2.3, '#d4a44a', shade=.25)
    steam_wisps(c)
    c.shine(12.0, 15.2, .7, 140)


def boiled_water_bottle(c):
    """Pale labeled bottle like water_bottle, with steam."""
    sh(c, 10)
    glass = '#c5d8e4'
    c.rect(10.5, 10, 21.5, 26.5, glass, r=2.2, shade=.3)
    c.rect(13.2, 6.2, 18.8, 11.2, dk(glass, .08), r=.8)
    c.rect(13.0, 4.4, 19.0, 7.4, '#8aa0b0', r=.7)
    c.rect(12.2, 15.2, 19.8, 21.4, '#eef4f8', r=.6)
    c.line([(11.6, 12), (11.6, 25)], .7, (255, 255, 255), 130)
    steam_wisps(c)
    c.shine(13.2, 13.2, .7, 160)


def boiled_waterskin(c):
    """Leather waterskin with steam from the stopper."""
    waterskin(c)
    steam_wisps(c)


PAINTERS = {
    "salad": salad,
    "rice_bowl": rice_bowl,
    "truffle_stew": truffle_stew,
    "truffle": truffle,
    "paint_brush": paint_brush,
    "honey_tea": honey_tea,
    "salt_brew": salt_brew,
    "charcoal_tonic": charcoal_tonic,
    "cooling_brew": cooling_brew,
    "medicated_bandage": medicated_bandage,
    "cloth_mask": cloth_mask,
    "waterskin": waterskin,
    "boiled_water_flask": boiled_water_flask,
    "boiled_canteen": boiled_canteen,
    "boiled_water_bottle": boiled_water_bottle,
    "boiled_waterskin": boiled_waterskin,
}


def render_icon(fn):
    was = draw.CEL
    draw.CEL = True
    try:
        c = C(32, 8)
        fn(c)
        return c.out(32), c.out(64)
    finally:
        draw.CEL = was


def blit_icon(frame, imgs):
    for sc, im in ((1, imgs[0]), (2, imgs[1])):
        name = "nature_icons.png" if sc == 1 else "nature_icons@2x.png"
        path = os.path.join(ATLAS, name)
        sheet = Image.open(path).convert("RGBA")
        fw, fh, cols = 32 * sc, 32 * sc, 16
        x = (frame % cols) * fw
        y = (frame // cols) * fh
        cell = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
        cell.paste(im, (0, 0), im)
        sheet.paste(cell, (x, y))
        sheet.save(path, optimize=True)


def encode_ktx2(src):
    dst = os.path.splitext(src)[0] + ".ktx2"
    tok = os.environ.get("TOKTX", "toktx")
    fd, tmp = tempfile.mkstemp(suffix=".png")
    os.close(fd)
    try:
        dilate(Image.open(src).convert("RGBA")).save(tmp, compress_level=1)
        subprocess.run(
            [tok, "--t2", "--genmipmap", "--assign_oetf", "srgb",
             "--encode", "etc1s", "--clevel", "2", "--qlevel", "192", dst, tmp],
            check=True,
        )
        print("toktx", os.path.basename(src))
    finally:
        os.remove(tmp)


def patch_nature_manifest():
    raw = open(MAN).read()
    data = json.loads(raw)
    by = {s["key"]: s for s in data["sprites"]}
    for key in RETARGET_NATURE:
        if key not in by:
            raise SystemExit(f"missing {key} in nature manifest")
        fr = FRAMES[key]
        # surgical replace of that sprite's idle frames array (unique enough next to its key)
        old = f'"key": "{key}"'
        i = raw.find(old)
        if i < 0:
            raise SystemExit(f"cannot find {key}")
        # find the next "frames": [ N ]
        j = raw.find('"frames"', i)
        k = raw.find("[", j)
        end = raw.find("]", k)
        raw = raw[:k+1] + f"\n      {fr}\n     " + raw[end:]
    # append new sprites before the sprites array close if missing
    existing = {s["key"] for s in json.loads(raw)["sprites"]}
    new_objs = []
    for key in APPEND:
        if key in existing:
            continue
        fr = FRAMES[key]
        new_objs.append(
            {
                "key": key,
                "category": "item",
                "atlas": "nature_icons",
                "anchor": {"x": 0.5, "y": 0.5},
                "animations": {"idle": {"frames": [fr], "fps": 1}},
            }
        )
    if new_objs:
        # find sprites array close
        i = raw.find('"sprites"')
        lb = raw.find("[", i)
        depth = 0
        close = None
        for j in range(lb, len(raw)):
            if raw[j] == "[":
                depth += 1
            elif raw[j] == "]":
                depth -= 1
                if depth == 0:
                    close = j
                    break
        chunks = [json.dumps(o, indent=1, ensure_ascii=False) for o in new_objs]
        insert = ",\n" + ",\n".join(
            "\n".join(" " + ln if ln else ln for ln in c.splitlines()) for c in chunks
        )
        raw = raw[:close] + insert + raw[close:]
    json.loads(raw)  # validate
    open(MAN, "w").write(raw)
    print("nature manifest patched")


def patch_root_truffle():
    """nature_icons lives in the nature manifest; a root entry pointing at it fails validation.
    Move `truffle` out of the root manifest and into nature/manifest.nature.json."""
    root = json.load(open(ROOT_MAN))
    nature = json.load(open(MAN))
    removed = [s for s in root["sprites"] if s.get("key") == "truffle"]
    if removed:
        root["sprites"] = [s for s in root["sprites"] if s.get("key") != "truffle"]
        open(ROOT_MAN, "w").write(json.dumps(root, indent=2, ensure_ascii=False) + "\n")
        print("removed root truffle (atlas was not in root)")
    else:
        print("root has no truffle entry")
    if any(s.get("key") == "truffle" for s in nature["sprites"]):
        print("nature truffle already present")
        return
    entry = {
        "key": "truffle",
        "category": "item",
        "atlas": "nature_icons",
        "anchor": {"x": 0.5, "y": 0.5},
        "animations": {"idle": {"frames": [FRAMES["truffle"]], "fps": 1}},
    }
    idx = next((i + 1 for i, s in enumerate(nature["sprites"]) if s.get("key") == "truffle_stew"), len(nature["sprites"]))
    nature["sprites"][idx:idx] = [entry]
    open(MAN, "w").write(json.dumps(nature, indent=2, ensure_ascii=False) + "\n")
    print("nature truffle added at frame", FRAMES["truffle"])


def previews():
    os.makedirs(PREV, exist_ok=True)
    sheet = Image.open(os.path.join(ATLAS, "nature_icons.png")).convert("RGBA")
    items = Image.open(os.path.join(ROOT, "packages/assets/pack/atlases/items.png")).convert("RGBA") if os.path.exists(os.path.join(ROOT, "packages/assets/pack/atlases/items.png")) else None
    # also try items fragment
    if items is None:
        p = os.path.join(ROOT, "packages/assets/pack/items/atlases/items.png")
        if os.path.exists(p):
            items = Image.open(p).convert("RGBA")

    def cell(im, frame, fw=32, cols=16):
        x, y = (frame % cols) * fw, (frame // cols) * fw
        return im.crop((x, y, x + fw, y + fw))

    pairs = [
        ("fruit_salad", 92, "salad", 107),
        ("baked_beans", 93, "rice_bowl", 108),
        ("vegetable_stew", 90, "truffle_stew", 109),
        ("mushroom*", 8, "truffle", 110),
    ]
    singles = [
        ("paint_brush", 111), ("honey_tea", 112), ("salt_brew", 113),
        ("charcoal_tonic", 114), ("cooling_brew", 115),
        ("medicated_bandage", 116), ("cloth_mask", 117), ("waterskin", 118),
    ]
    CELL, PAD = 80, 10
    rows = len(pairs) + 2
    cols = 4
    out = Image.new("RGBA", (cols * (CELL + PAD) + PAD, rows * (CELL + 22) + PAD), (36, 32, 30, 255))
    dr = ImageDraw.Draw(out)

    def paste(im, r, c, label):
        big = im.resize((CELL - 8, CELL - 8), Image.NEAREST)
        x = PAD + c * (CELL + PAD)
        y = PAD + r * (CELL + 22)
        out.paste(big, (x + 4, y), big)
        dr.text((x + 2, y + CELL - 2), label, fill=(240, 230, 210, 255))

    for i, (a, fa, b, fb) in enumerate(pairs):
        if a.endswith("*") and items is not None:
            paste(cell(items, fa), i, 0, a[:-1])
        else:
            paste(cell(sheet, fa), i, 0, a)
        paste(cell(sheet, fb), i, 1, b)
    for i, (k, fr) in enumerate(singles):
        r, c = 4 + i // 4, i % 4
        paste(cell(sheet, fr), r, c, k)
    path = os.path.join(PREV, "unique_craft_icons.png")
    out.save(path)
    print("preview", path, out.size)


def main():
    for key, fn in PAINTERS.items():
        imgs = render_icon(fn)
        blit_icon(FRAMES[key], imgs)
        print("painted", key, "->", FRAMES[key], imgs[0].size)
    patch_nature_manifest()
    patch_root_truffle()
    tok = "/tmp/ktx/out/KTX-Software-4.4.2-Linux-x86_64/bin/toktx"
    if os.path.exists(tok):
        os.environ["TOKTX"] = tok
        os.environ["LD_LIBRARY_PATH"] = "/tmp/ktx/out/KTX-Software-4.4.2-Linux-x86_64/lib:" + os.environ.get("LD_LIBRARY_PATH", "")
    encode_ktx2(os.path.join(ATLAS, "nature_icons.png"))
    encode_ktx2(os.path.join(ATLAS, "nature_icons@2x.png"))
    previews()
    print("artpass unique craft icons done")


if __name__ == "__main__":
    main()
