#!/usr/bin/env python3
"""Repack customization wearable atlases (cz_* sprites) into few shared pages grouped by slot.
Grid atlases only (manifest has no per-frame rects), so trimming is per atlas: the frame is cropped to the
union alpha bbox of all member sprites' used frames + 1px transparent border (2px gap between cells).
Each sprite keeps its key; its frame block is relocated (frames += base) and its anchor re-normalised.
Pages: 1x <= MAX px per side; the @2x page and the tintmask share the grid (tintmask is sampled by UV, so no @2x mask).
Optional: `pip install pyoxipng` for smaller PNGs.
Usage: python3 packages/assets/scripts/pack-wearables.py [pack/customization dir] [MAX=2048]"""
import json, os, sys, collections, math
from PIL import Image
D = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "../pack/customization")
MAX = int(sys.argv[2]) if len(sys.argv) > 2 else 2048
PAD = 1  # per side -> 2px between cells
mp = os.path.join(D, "manifest.customization.json"); m = json.load(open(mp))
A = {a["key"]: a for a in m["atlases"]}; S = {s["key"]: s for s in m["sprites"]}
slot = {}
def walk(o, sl):
    if isinstance(o, dict):
        for k, v in o.items():
            if k == "sprite" and isinstance(v, str): slot[v] = sl
            else: walk(v, sl)
    elif isinstance(o, list):
        for x in o: walk(x, sl)
for w in m["wearables"]: walk(w, w["slot"])
def used(s):
    a = A[s["atlas"]]; F = set()
    for an in s["animations"].values():
        for d in range(an.get("directions", 1)):
            for f in an["frames"]: F.add(f + d * an.get("dirStride", a["columns"]))
    return F
def cell(a, f, k=1): x = (f % a["columns"]) * a["frameW"] * k; y = (f // a["columns"]) * a["frameH"] * k; return (x, y, x + a["frameW"] * k, y + a["frameH"] * k)
cache = {}
def img(p):
    if p not in cache: cache[p] = Image.open(os.path.join(D, p)).convert("RGBA")
    return cache[p]
info = {}
for k in slot:
    s = S[k]; a = A[s["atlas"]]
    assert not s.get("frameMeta") and all(x not in a for x in ("nineSlice", "emissive")), k
    al = img(a["image"]).getchannel("A"); bb = [10**6, 10**6, -1, -1]; U = used(s)
    for f in U:
        b = al.crop(cell(a, f)).getbbox()
        if b: bb = [min(bb[0], b[0]), min(bb[1], b[1]), max(bb[2], b[2]), max(bb[3], b[3])]
    # keep the anchor inside the trimmed cell so it stays normalised within [0,1]
    ax = s["anchor"]["x"] * a["frameW"]; ay = s["anchor"]["y"] * a["frameH"]
    bb = [min(bb[0], math.floor(ax)), min(bb[1], math.floor(ay)), max(bb[2], math.ceil(ax)), max(bb[3], math.ceil(ay))]
    info[k] = dict(bb=bb, n=max(U) + 1, a=a)
def cap(bb):
    fw = bb[2] - bb[0] + 2 * PAD; fh = bb[3] - bb[1] + 2 * PAD
    return (MAX // fw) * (MAX // fh), fw, fh
groups = collections.defaultdict(list)
for k in slot: groups[slot[k]].append(k)
def U(a, b): return [min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3])]
def bestfit(ks):
    bins = []  # [members, bbox]
    for k in ks:
        best = None
        for b in bins:
            nb = U(b[1], info[k]["bb"])
            if cap(nb)[0] >= sum(info[x]["n"] for x in b[0]) + info[k]["n"]:
                sc = cap(b[1])[0] - cap(nb)[0]
                if best is None or sc < best[0]: best = (sc, b, nb)
        if best: best[1][0].append(k); best[1][1] = best[2]
        else: bins.append([[k], info[k]["bb"]])
    return bins
import random
rng = random.Random(1)
out = []
for sl in sorted(groups):
    ks = sorted(groups[sl], key=lambda k: (-(info[k]["bb"][3] - info[k]["bb"][1]) * (info[k]["bb"][2] - info[k]["bb"][0]), k))
    best = bestfit(ks)
    for _ in range(300):
        b = bestfit(rng.sample(ks, len(ks)))
        if len(b) < len(best): best = b
    out += [(sorted(mb), bb) for mb, bb in best]
old = {info[k]["a"]["key"] for k in slot}
newA = []; idx = collections.Counter()
try:
    import oxipng
except ImportError:
    oxipng = None
def save(im, p, rgb=False):
    if rgb: im = im.convert("RGB")
    q = im
    cols = im.getcolors(256)
    if cols is not None:
        q = im.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
        if q.convert(im.mode).tobytes() != im.tobytes(): q = im
    fp = os.path.join(D, p); q.save(fp, optimize=True)
    if oxipng: oxipng.optimize(fp, level=2)
for members, ub in out:
    sl = slot[members[0]]; idx[sl] += 1; key = f"cz_pack_{sl}_{idx[sl]}"
    _, fw, fh = cap(ub); total = sum(info[k]["n"] for k in members)
    cols = min(MAX // fw, total); rows = -(-total // cols)
    wx0, wy0 = ub[0] - PAD, ub[1] - PAD
    has2 = all(any(p["scale"] == 2 for p in info[k]["a"].get("pages", [])) for k in members)
    hasT = all("tintmask" in info[k]["a"].get("masks", {}) for k in members)
    layers = [("", 1, lambda a: a["image"])]
    if has2: layers.append(("@2x", 2, lambda a: next(p["image"] for p in a["pages"] if p["scale"] == 2)))
    if hasT:
        layers.append((".tintmask", 1, lambda a: a["masks"]["tintmask"]))
    for suf, sc, src in layers:
        canvas = Image.new("RGBA", (cols * fw * sc, rows * fh * sc), (0, 0, 0, 0)); base = 0
        for k in members:
            a = info[k]["a"]; si = img(src(a))
            for f in used(S[k]):
                x, y, _, _ = cell(a, f, sc); g = base + f
                piece = si.crop((x + wx0 * sc, y + wy0 * sc, x + (wx0 + fw) * sc, y + (wy0 + fh) * sc))  # out-of-cell area is transparent margin
                # zero any pixels pulled from neighbouring cells (window may exceed the 48x80 cell by PAD)
                m0 = Image.new("L", piece.size, 0); ox, oy = max(0, -wx0 * sc), max(0, -wy0 * sc)
                m0.paste(255, (ox, oy, min(piece.size[0], (a["frameW"] - wx0) * sc), min(piece.size[1], (a["frameH"] - wy0) * sc)))
                clean = Image.new("RGBA", piece.size, (0, 0, 0, 0)); clean.paste(piece, (0, 0), m0)
                canvas.paste(clean, ((g % cols) * fw * sc, (g // cols) * fh * sc))
            base += info[k]["n"]
        save(canvas, f"atlases/{key}{suf}.png", rgb=suf.startswith(".tintmask"))
    at = {"key": key, "image": f"atlases/{key}.png", "frameW": fw, "frameH": fh, "columns": cols, "rows": rows}
    if has2: at["pages"] = [{"scale": 2, "image": f"atlases/{key}@2x.png"}]
    if hasT: at["masks"] = {"tintmask": f"atlases/{key}.tintmask.png"}
    newA.append(at); base = 0
    for k in members:
        s = S[k]; a = info[k]["a"]
        ax = s["anchor"]["x"] * a["frameW"] - wx0; ay = s["anchor"]["y"] * a["frameH"] - wy0
        s["anchor"] = {"x": round(ax / fw, 6), "y": round(ay / fh, 6)}; s["atlas"] = key
        for an in s["animations"].values():
            an.setdefault("dirStride", a["columns"]); an["frames"] = [f + base for f in an["frames"]]
        base += info[k]["n"]
m["atlases"] = [a for a in m["atlases"] if a["key"] not in old] + newA
json.dump(m, open(mp, "w"), indent=1); open(mp, "a").write("\n")
for o in old:
    for f in os.listdir(os.path.join(D, "atlases")):
        if f.startswith(o + ".") or f.startswith(o + "@"): os.remove(os.path.join(D, "atlases", f))
print(f"{len(old)} wearable atlases -> {len(newA)} packed atlases")
for a in newA: print(" ", a["key"], f'{a["frameW"]}x{a["frameH"]}', f'{a["columns"]*a["frameW"]}x{a["rows"]*a["frameH"]}')
