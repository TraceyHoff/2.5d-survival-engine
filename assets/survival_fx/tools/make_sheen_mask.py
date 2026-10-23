#!/usr/bin/env python3
"""Derive a wetness sheen/spec mask `<atlas>_sheen.png` from any character/zombie atlas (same size + frame layout).

Channels (RGBA8):
  R = sheen / specular weight: where water glints when wet (tops of hair, hats, shoulders, skin tops, lit rims)
      + sparse bead dots. A renderer that wants a single grayscale channel reads R.
  G = wet-darkening weight: how much the material darkens/saturates when soaked (cloth/hair high, skin/metal low)
  B = drip-start weight: lower edges of hair/hat brims/sleeves where drip particles may spawn (optional)
  A = copy of the sprite alpha (so the mask can be sampled with the same UVs and premultiplied blending)
Wetness in the renderer: wet intensity 0..3 -> wetness 0..255 (0, 85, 170, 255); sheen = R * wetness/255.

Usage:
  python3 make_sheen_mask.py ATLAS.png [ATLAS2.png ...] [--out-dir DIR] [--scale N]
  python3 make_sheen_mask.py --scan /workspace/assets [--out-dir DIR]   # finds character/zombie atlases
--scale: pixels per 1x pixel (auto: 2 if the name contains _2x or @2x, else 1). Works on any layout (all ops are local
and frames are separated by transparent padding), so no JSON is needed.
Output: `<atlas>_sheen.png` is written NEXT TO the source atlas by default (the engine manifest references it from
the atlas as `masks.sheen`, e.g. atlases/characters.png -> atlases/characters_sheen.png; see survival_fx/main_pack.patch.json).
--out-dir DIR writes there instead (survival_fx's own build uses it so it never writes into the main pack's folders).
One mask per atlas is enough: masks are sampled by UV, so the 1x mask serves every `pages` scale.
"""
import argparse, glob, json, os, re, sys
import numpy as np
from PIL import Image, ImageFilter

SKIN = np.array([[255, 210, 173], [235, 169, 138], [217, 151, 95], [176, 111, 69], [143, 86, 54], [106, 60, 42], [255, 230, 204], [242, 192, 143]], np.float32)
METAL = np.array([[180, 194, 204], [126, 142, 160], [232, 240, 244]], np.float32)

def up_distance(a, maxd):
    """per pixel: distance (px) to the nearest transparent pixel straight above (and up-left, light dir), capped."""
    H, W = a.shape; d = np.full((H, W), maxd, np.float32); d2 = np.full((H, W), maxd, np.float32)
    run = np.zeros(W, np.float32); run2 = np.zeros(W, np.float32)
    for y in range(H):
        run = np.where(a[y], run + 1, 0); d[y] = np.minimum(run, maxd)
        prev = np.concatenate([[0], run2[:-1]]); run2 = np.where(a[y], prev + 1, 0); d2[y] = np.minimum(run2, maxd)
    return d, d2

def down_distance(a, maxd):
    return up_distance(a[::-1], maxd)[0][::-1]

def color_dist(rgb, pal):
    return np.min(np.linalg.norm(rgb[..., None, :] - pal[None, None], axis=-1), -1)

def make(src, out, scale=None):
    im = Image.open(src).convert("RGBA"); arr = np.asarray(im, np.float32)
    if scale is None: scale = 2 if re.search(r"[_@]2x", os.path.basename(src)) else 1
    rgb, al = arr[..., :3], arr[..., 3] / 255
    solid = al > 0.5
    lum = (rgb * [0.299, 0.587, 0.114]).sum(-1) / 255
    mx, mn = rgb.max(-1), rgb.min(-1); sat = (mx - mn) / np.maximum(mx, 1)
    # interior (exclude the ink outline: dark pixels within ~1px of the silhouette edge)
    er = np.asarray(Image.fromarray((solid * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(3 if scale == 1 else 5)), np.float32) / 255
    ink = (lum < 0.30) & (er < 0.5)
    interior = solid & ~ink
    du, dul = up_distance(solid, 8 * scale)
    top = np.clip(1 - (np.minimum(du, dul * 1.1) - 1.5 * scale) / (3.5 * scale), 0, 1) ** 0.9      # upward-facing surfaces
    # also internal tops: a big luminance step up->down (hat brim over face, hair over forehead, shoulder under head)
    lum_above = np.roll(lum, scale * 2, axis=0); inner_top = np.clip((lum - lum_above) * 3, 0, 1) * 0.3
    skin = np.clip(1 - color_dist(rgb, SKIN) / 85, 0, 1); metal = np.clip(1 - color_dist(rgb, METAL) / 40, 0, 1)
    smooth_mat = np.clip(0.55 + 0.45 * skin + 0.4 * metal + 0.25 * lum, 0, 1)
    loc = np.asarray(Image.fromarray((lum * 255).astype(np.uint8)).filter(ImageFilter.BoxBlur(2 * scale)), np.float32) / 255
    rim = np.clip((lum - loc) * 4, 0, 1)          # toon rim highlights (top-left lit edges) also glint
    sheen = np.clip(np.maximum(top, inner_top) * smooth_mat * (0.75 + 0.5 * lum) + rim * 0.15 * smooth_mat * (1 - 0.7 * skin), 0, 1)
    # beads: sparse dots on upward faces (deterministic)
    rng = np.random.default_rng(1234); beads = (rng.random(solid.shape) > 0.985).astype(np.float32)
    if scale > 1: beads = np.asarray(Image.fromarray((beads * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(3)), np.float32) / 255
    sheen = np.maximum(sheen, beads * np.clip(top + 0.35, 0, 1) * 0.9)
    sheen *= interior
    darken = interior * np.clip(0.85 - 0.55 * skin - 0.5 * metal, 0.15, 1)
    dd = down_distance(solid, 4 * scale)
    drip = interior * np.clip(1 - (dd - 1) / (2 * scale), 0, 1) * (1 - skin * 0.7)
    out_arr = np.stack([sheen, darken, drip, al], -1)
    Image.fromarray((np.clip(out_arr, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA").save(out)
    return out

def scan(root):
    found = set()
    man = os.path.join(root, "manifest.json")
    if os.path.exists(man):
        m = json.load(open(man)); atl = {a["key"]: a["image"] for a in m.get("atlases", [])}
        for s in m.get("sprites", []):
            if s.get("category") in ("character", "zombie") and s.get("atlas") in atl:
                for d in ("atlases", ""):
                    p = os.path.join(root, d, atl[s["atlas"]])
                    if os.path.exists(p): found.add(p)
                    p2 = re.sub(r"\.png$", "_2x.png", p)
                    if os.path.exists(p2): found.add(p2)
    for p in glob.glob(os.path.join(root, "**", "*.png"), recursive=True):
        b = os.path.basename(p).lower()
        if "survival_fx" in p or re.search(r"_(emissive|sheen|sway)\.png$", b) or "/preview/" in p or "/ui/" in p: continue
        if re.search(r"(character|player|survivor|zombie|chars)", b) and "/sprites/" not in p: found.add(p)
    return sorted(found)

if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("atlases", nargs="*"); ap.add_argument("--scan"); ap.add_argument("--out-dir", help="output folder (default: next to each source atlas)"); ap.add_argument("--scale", type=int)
    a = ap.parse_args(); srcs = list(a.atlases) + (scan(a.scan) if a.scan else [])
    if not srcs: print("no character/zombie atlases found"); sys.exit(0)
    for s in srcs:
        base = re.sub(r"\.(png|webp)$", "", os.path.basename(s)) + "_sheen.png"
        out = os.path.join(a.out_dir or os.path.dirname(s), base); os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
        print("sheen:", s, "->", make(s, out, a.scale))
