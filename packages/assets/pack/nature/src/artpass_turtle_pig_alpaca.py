"""Dedicated turtle, pig, and alpaca sheets.

Packs ONLY nature_critters_c_* atlases and appends the three sprite keys.
Does not rebuild nature_critters_a_* / _b_* or run adr134 / build.py.
"""
import json, os, sys, subprocess, tempfile
from types import SimpleNamespace
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "../../../../../"))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "assets/tools"))

import fauna
from ktx2 import dilate

NATURE = os.path.join(ROOT, "packages/assets/pack/nature")
ATLAS = os.path.join(NATURE, "atlases")
MAN = os.path.join(NATURE, "manifest.nature.json")
PREV = "/workspace/assets/preview"
KEYS = ["animal_pig", "animal_alpaca", "animal_turtle"]


def placeholder_for(fw, fh):
    m = max(fw, fh)
    if m <= 28:
        return "placeholder_animal_s"
    if m <= 40:
        return "placeholder_animal_m"
    return "placeholder_animal_l"


def encode_ktx2(src):
    dst = os.path.splitext(src)[0] + ".ktx2"
    fd, tmp = tempfile.mkstemp(suffix=".png")
    os.close(fd)
    try:
        dilate(Image.open(src).convert("RGBA")).save(tmp, compress_level=1)
        cmd = ["toktx", "--t2", "--genmipmap", "--assign_oetf", "srgb",
               "--encode", "etc1s", "--clevel", "2", "--qlevel", "192", dst, tmp]
        print("toktx", os.path.basename(src))
        subprocess.run(cmd, check=True)
    finally:
        os.remove(tmp)


def dump_items(items):
    chunks = [json.dumps(x, indent=1, ensure_ascii=False) for x in items]
    # indent=1 uses 1-space like the nature manifest; bump one extra space so
    # they sit inside the parent array.
    out = []
    for c in chunks:
        lines = c.splitlines()
        out.append("\n".join(" " + ln if ln else ln for ln in lines))
    return ",\n".join(out)


def update_manifest(atlases, sprites):
    raw = open(MAN).read()
    data = json.loads(raw)

    # Drop a previous run of this artpass (re-entrant).
    data["atlases"] = [a for a in data["atlases"] if not a["key"].startswith("nature_critters_c_")]
    data["sprites"] = [s for s in data["sprites"] if s["key"] not in KEYS]
    keep_atlas = {a["key"] for a in data["atlases"]}
    keep_sprite = {s["key"] for s in data["sprites"]}

    # Rewrite via parse+dump only for the filtered lists, then insert new
    # objects surgically into the original text if possible. The nature
    # manifest is large; rewriting the whole file would churn unrelated diffs.
    # Strategy: if a previous c-atlas/sprite is in the raw text, strip those
    # objects by JSON round-trip of just the arrays is too risky. Instead:
    # rebuild from the filtered data ONLY when leftovers exist; otherwise append.

    def find_array_close(label):
        i = raw.find(f'"{label}"')
        if i < 0:
            raise SystemExit(f"missing {label} array")
        # find the matching close of this top-level array: after "label": [
        lb = raw.find("[", i)
        depth = 0
        for j in range(lb, len(raw)):
            ch = raw[j]
            if ch == "[":
                depth += 1
            elif ch == "]":
                depth -= 1
                if depth == 0:
                    return lb, j
        raise SystemExit(f"unclosed {label} array")

    has_old = any(f'"key": "nature_critters_c_' in raw for _ in [0]) or any(
        f'"key": "{k}"' in raw for k in KEYS
    )
    if has_old:
        # Remove old objects by rewriting from filtered JSON using original
        # separators as much as possible: dump filtered+new with indent=1.
        data["atlases"].extend(atlases)
        data["sprites"].extend(sprites)
        # Keep compact-enough 1-space indent matching this file.
        text = json.dumps(data, indent=1, ensure_ascii=False)
        if not text.endswith("\n"):
            text += "\n"
        open(MAN, "w").write(text)
        print("manifest rewritten (replaced prior c-critter pass)")
        return

    a0, a1 = find_array_close("atlases")
    s0, s1 = find_array_close("sprites")
    a_insert = ",\n" + dump_items(atlases)
    s_insert = ",\n" + dump_items(sprites)
    # sprites array comes after atlases; insert sprites first so indices stay valid? 
    # a1 and s1 are independent slices of raw. If we mutate from the end:
    raw = raw[:s1] + s_insert + raw[s1:]
    raw = raw[:a1] + a_insert + raw[a1:]
    json.loads(raw)  # validate
    open(MAN, "w").write(raw)
    print("manifest appended", [a["key"] for a in atlases], KEYS)


def previews(atlases_by_key):
    os.makedirs(PREV, exist_ok=True)
    data = json.loads(open(MAN).read())
    sprites = {s["key"]: s for s in data["sprites"]}
    cache = {}

    def load(name):
        if name not in cache:
            cache[name] = Image.open(os.path.join(NATURE, name)).convert("RGBA")
        return cache[name]

    def extract(ref):
        a = atlases_by_key[ref["atlas"]]
        img = load(a["image"])
        fw, fh, cols = a["frameW"], a["frameH"], a["columns"]
        fr = ref["frame"]
        x, y = (fr % cols) * fw, (fr // cols) * fh
        return img.crop((x, y, x + fw, y + fh))

    CELL, PAD = 96, 8
    rows = KEYS
    cols = 8
    out = Image.new("RGBA", (cols * (CELL + PAD) + PAD, len(rows) * (CELL + 28) + PAD), (40, 36, 32, 255))
    dr = ImageDraw.Draw(out)
    for ri, key in enumerate(rows):
        s = sprites[key]
        dfs = s["animations"]["idle"]["dirFrames"]
        for d in range(8):
            im = extract(dfs[d])
            im2 = im.copy()
            im2.thumbnail((CELL - 8, CELL - 8), Image.NEAREST)
            x = PAD + d * (CELL + PAD) + (CELL - im2.size[0]) // 2
            y = PAD + ri * (CELL + 28) + (CELL - im2.size[1]) // 2
            out.paste(im2, (x, y), im2)
        dr.text((PAD, PAD + ri * (CELL + 28) + CELL + 4), key.replace("animal_", ""), fill=(240, 230, 210, 255))
    path = os.path.join(PREV, "turtle_pig_alpaca_unique.png")
    out.save(path)
    print("preview", path)


def main():
    b = SimpleNamespace(atlases=[], sprites=[], previews={})
    print("generating", KEYS)
    fauna.group(KEYS, "c")(b)
    print("atlases", [a["key"] for a in b.atlases])
    print("sprites", [s["key"] for s in b.sprites])

    for a in b.atlases:
        a["residency"] = "stream"
        a["placeholder"] = placeholder_for(a["frameW"], a["frameH"])
        a["ktx2"] = a["image"].replace(".png", ".ktx2")
        for p in a.get("pages", []):
            p["ktx2"] = p["image"].replace(".png", ".ktx2")

    update_manifest(b.atlases, b.sprites)

    # encode ktx2 for every new atlas page
    for a in b.atlases:
        encode_ktx2(os.path.join(NATURE, a["image"]))
        for p in a.get("pages", []):
            encode_ktx2(os.path.join(NATURE, p["image"]))

    by = {a["key"]: a for a in b.atlases}
    previews(by)
    print("artpass turtle/pig/alpaca done")


if __name__ == "__main__":
    main()
