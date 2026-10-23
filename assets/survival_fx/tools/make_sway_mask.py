#!/usr/bin/env python3
"""Derive optional wind-sway weight masks `<atlas>_sway.png` (same size + layout, 8-bit grayscale) for tree/plant atlases.
0 = rigid (trunk, roots, rocks), 255 = full sway (canopy tips). The renderer's sway vertex/fragment shader multiplies its
per-sprite {amp, freq, stiffness} offset by this weight (bilinear-sampled).

Frame layout comes from (first match): the TexturePacker JSON next to the atlas (frames[].frame + pivot), the engine
manifest (--manifest: atlas frameW/frameH + sprite anchors), or --frame WxH --pivot-y FRACTION.
Usage:
  python3 make_sway_mask.py nature.png [--json nature.json | --manifest manifest.json | --frame 96x128 --pivot-y 0.92] [--out-dir DIR]
  python3 make_sway_mask.py --scan /workspace/assets [--out-dir DIR]
Output: `<atlas>_sway.png` is written NEXT TO the source atlas by default (the engine manifest references it from
the atlas as `masks.sway`, e.g. atlases/resources_tall.png -> atlases/resources_tall_sway.png; see survival_fx/main_pack.patch.json).
--out-dir DIR writes there instead (survival_fx's own build uses it so it never writes into the main pack's folders).
One mask per atlas is enough: masks are sampled by UV, so the 1x mask serves every `pages` scale.
"""
import argparse, glob, json, os, re, sys
import numpy as np
from PIL import Image, ImageFilter

BARK = np.array([[184, 128, 88], [138, 90, 60], [101, 65, 48], [71, 45, 38], [176, 120, 80], [135, 86, 58], [97, 64, 46], [67, 44, 36],
                 [184, 178, 176], [138, 132, 148], [95, 90, 112]], np.float32)   # bark + stone ramps (rigid)

def frames_from(path, args):
    W, H = Image.open(path).size
    j = args.json or re.sub(r"\.png$", ".json", path)
    if os.path.exists(j):
        d = json.load(open(j))
        if "frames" in d:
            return [(f["frame"]["x"], f["frame"]["y"], f["frame"]["w"], f["frame"]["h"], (f.get("pivot") or {"y": 0.92})["y"]) for f in d["frames"].values()]
    if args.manifest and os.path.exists(args.manifest):
        m = json.load(open(args.manifest)); img = os.path.basename(path)
        for a in m["atlases"]:
            if os.path.basename(a["image"]) == img:
                piv = {}
                for s in m["sprites"]:
                    if s["atlas"] == a["key"]:
                        for an in s["animations"].values():
                            for f in an["frames"]: piv[f] = s.get("anchor", {"y": 0.9})["y"]
                return [((i % a["columns"]) * a["frameW"], (i // a["columns"]) * a["frameH"], a["frameW"], a["frameH"], piv.get(i, 0.9)) for i in range(a["columns"] * a["rows"])]
    fw, fh = map(int, (args.frame or f"{W}x{H}").split("x"))
    return [(x, y, fw, fh, args.pivot_y) for y in range(0, H, fh) for x in range(0, W, fw)]

def make(path, out, args):
    im = Image.open(path).convert("RGBA"); arr = np.asarray(im, np.float32); out_a = np.zeros(arr.shape[:2], np.float32)
    for (x, y, w, h, py) in frames_from(path, args):
        f = arr[y:y + h, x:x + w]; al = f[..., 3] / 255
        if al.max() < 0.1: continue
        rows = np.where(al.max(1) > 0.3)[0]; top = rows.min(); base = min(h - 1, int(py * h))
        yy = np.arange(h, dtype=np.float32)[:, None] * np.ones((1, w), np.float32)
        hn = np.clip((base - yy) / max(1, base - top), 0, 1)
        rgb = f[..., :3]
        bark = np.clip(1 - np.min(np.linalg.norm(rgb[..., None, :] - BARK[None, None], axis=-1), -1) / 38, 0, 1)
        lum = (rgb * [0.299, 0.587, 0.114]).sum(-1) / 255
        ink = lum < 0.25
        leafy = (1 - bark) * (al > 0.3)
        # ink outline inherits from neighbours (so lines move with the part they belong to)
        lf = np.asarray(Image.fromarray((leafy * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(3)), np.float32) / 255
        leafy = np.where(ink, lf, leafy)
        w_ = (hn ** 1.4) * (0.25 + 0.75 * leafy)
        w_ *= np.clip((hn - 0.08) / 0.15, 0, 1)          # roots / base row are pinned
        w_ = np.asarray(Image.fromarray((w_ * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.5)), np.float32) / 255
        out_a[y:y + h, x:x + w] = w_ * (al > 0.02)
    Image.fromarray((np.clip(out_a, 0, 1) * 255 + 0.5).astype(np.uint8), "L").save(out); return out

def scan(root):
    res = []
    for p in glob.glob(os.path.join(root, "**", "*.png"), recursive=True):
        b = os.path.basename(p).lower()
        if "survival_fx" in p or re.search(r"_(emissive|sheen|sway)\.png$", b) or "/preview/" in p or "/sprites/" in p: continue
        if re.search(r"(nature|tree|plant|resource|foliage|grass)", b): res.append(p)
    return sorted(res)

if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("atlases", nargs="*"); ap.add_argument("--scan"); ap.add_argument("--out-dir", help="output folder (default: next to each source atlas)")
    ap.add_argument("--json"); ap.add_argument("--manifest"); ap.add_argument("--frame"); ap.add_argument("--pivot-y", type=float, default=0.92)
    a = ap.parse_args(); srcs = list(a.atlases) + (scan(a.scan) if a.scan else [])
    if not srcs: print("no nature/tree atlases found"); sys.exit(0)
    for s in srcs:
        out = os.path.join(a.out_dir or os.path.dirname(s), re.sub(r"\.(png|webp)$", "", os.path.basename(s)) + "_sway.png")
        os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
        print("sway:", s, "->", make(s, out, a))
