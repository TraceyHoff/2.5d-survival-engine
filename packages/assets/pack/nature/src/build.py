#!/usr/bin/env python3
"""Nature sub-manifest (ADR-110 art batch): trees, bushes, logs, crops, saplings, wild plants, fish shoal, clutter,
new animals and item icons. Re-runnable: python3 packages/assets/pack/nature/src/build.py
then python3 assets/tools/ktx2.py packages/assets/pack/nature/manifest.nature.json --report /tmp/nature_vram.json
Writes manifest.nature.json + atlases/ next to src/, and contact-sheet previews to /workspace/assets/nature/preview/."""
import os, sys, json, glob
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common
from common import render, Frame, pack_grid, sway_mask, contact_sheet, FRAG

PREVIEW = os.environ.get("NATURE_PREVIEW", "/workspace/assets/nature/preview")
atlases, sprites, previews = [], [], {}

def static_atlas(key, entries, cols, sway=None, category="resource", canvas=(96, 128, 118), want_sway_mask=True):
    """entries: [(sprite key, {anim: [fn, ...]}, sway tuple or None)] rendered on a WxH canvas with feet at (W/2, base)."""
    W, H, B = canvas; frames, index = [], []
    for skey, anims, sw in entries:
        idx = {}
        for an, fns in anims.items():
            idx[an] = []
            for fn in fns:
                frames.append(Frame(render(fn), W / 2, B)); idx[an].append(len(frames) - 1)
        index.append((skey, idx, sw))
    aj, anchor, _ = pack_grid(key, frames, cols, FRAG)
    if want_sway_mask and any(sw for *_, sw in index): sway_mask(aj, anchor["y"], FRAG)
    atlases.append(aj)
    for skey, idx, sw in index:
        s = {"key": skey, "category": category, "atlas": key, "anchor": anchor,
             "animations": {an: {"frames": fr, "fps": 1 if len(fr) == 1 else 4} for an, fr in idx.items()}}
        if sw: s["sway"] = {"amp": sw[0], "freq": sw[1], "stiffness": sw[2]}
        sprites.append(s)
    previews.setdefault(key, []).extend((f"{sk}:{an}", frames[i].i2) for sk, idx, _ in index for an, fr in idx.items() for i in fr[:1])

def group_trees(_=None):
    import flora
    T = [(k, {"idle": [a]} | ({"depleted": [b]} if b else {}), (1.6, 0.25, 0.7) if k != "palm_tree" else (2.0, 0.3, 0.6)) for k, (a, b) in flora.TREES.items()]
    static_atlas("nature_trees", T, 8, canvas=(flora.TW, flora.TH, flora.TB))
    B = [(k, {"idle": [a]} | ({"depleted": [b]} if b else {}), (0.8, 0.5, 0.7) if k.endswith("_bush") else (1.2, 0.7, 0.4)) for k, (a, b) in flora.BUSHES.items()]
    B += [(k, {"idle": [a]}, None) for k, (a, b) in flora.LOGS.items()]
    static_atlas("nature_bushes", B, 8, canvas=(flora.PW, flora.PH, flora.PB))

GROUPS = [group_trees]
for name in ("crops", "fauna", "itemicons", "roads", "signs", "toolicons", "placeholder", "statusfx"):
    if os.path.exists(os.path.join(os.path.dirname(os.path.abspath(__file__)), name + ".py")):
        mod = __import__(name); GROUPS += mod.GROUPS

if __name__ == "__main__":
    for f in glob.glob(os.path.join(FRAG, "atlases/*")): os.remove(f)
    for g in GROUPS: g(sys.modules[__name__])
    if "placeholder" in sys.modules: sys.modules["placeholder"].tag(sys.modules[__name__])
    keys = [s["key"] for s in sprites]; assert len(keys) == len(set(keys)), "duplicate sprite keys"
    man = {"version": 1, "name": "nature", "atlases": atlases, "sprites": sprites}
    json.dump(man, open(os.path.join(FRAG, "manifest.nature.json"), "w"), indent=1); open(os.path.join(FRAG, "manifest.nature.json"), "a").write("\n")
    for k, items in previews.items(): contact_sheet(items, os.path.join(PREVIEW, f"{k}.png"), cols=8, scale=1)
    print(f"atlases {len(atlases)} sprites {len(sprites)}")
