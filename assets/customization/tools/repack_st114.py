#!/usr/bin/env python3
"""ADR-114 follow-up: repack the cz_st114_* wear pages IN PLACE with wearpack (one wearable / shared component per page,
deduplicated cells). Reads the current pages back (exact pixels, no re-render), rewrites the pages, the sprite entries
(atlas, anchor, frames, dirFrames) and the atlas list; other pages/sprites untouched. Idempotent.
Then: python3 assets/tools/ktx2.py <manifest> ; pnpm --filter @engine/assets lock:ids:pack ; pnpm check
Usage: python3 repack_st114.py ENGINE_DIR"""
import sys, os, json, glob
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
sys.path.append(os.path.join(os.path.dirname(os.path.dirname(HERE)), "tools"))
import numpy as np
from PIL import Image
import wearpack
from rig import FW, FH, FEET
import importlib.util as _iu, os as _os  # ADR-138: manifest may be a v2 shard index
_spec = _iu.spec_from_file_location("cz_manifest", _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "../../../packages/assets/scripts/cz_manifest.py"))
czm = _iu.module_from_spec(_spec); _spec.loader.exec_module(czm)
PFX = "cz_st114_"

def main(eng):
    D = os.path.join(eng, "packages/assets/pack/customization"); MP = os.path.join(D, "manifest.customization.json")
    m = czm.load(MP); A = {a["key"]: a for a in m["atlases"]}
    S = [s for s in m["sprites"] if s["atlas"].startswith(PFX)]; img = {}
    def page(a):
        if a["key"] not in img:
            ld = lambda p, mode: np.asarray(Image.open(os.path.join(D, p)).convert(mode))
            img[a["key"]] = (ld(a["image"], "RGBA"), ld(a["masks"]["tintmask"], "RGB"), ld(next(p["image"] for p in a["pages"] if p["scale"] == 2), "RGBA"))
        return img[a["key"]]
    F = {}
    for s in S:
        a = A[s["atlas"]]; cw, ch, C = a["frameW"], a["frameH"], a["columns"]
        used = set()
        for an in s["animations"].values():
            if "dirFrames" in an:
                assert all(d["atlas"] == s["atlas"] and d["anchor"] == s["anchor"] for d in an["dirFrames"]), s["key"]
                used |= {d["frame"] for d in an["dirFrames"]}
            else: used |= {f + d * an["dirStride"] for f in an["frames"] for d in range(an.get("directions", 1))}
        for r0, r1 in wearpack.rigid_ranges(s): used |= set(range(r0, r1))
        order = sorted(used); loc = {c: j for j, c in enumerate(order)}
        x0 = int(round(FW / 2 - s["anchor"]["x"] * cw)); y0 = int(round(FEET - s["anchor"]["y"] * ch))
        assert x0 >= 0 and y0 >= 0 and x0 + cw <= FW and y0 + ch <= FH, s["key"]
        p1, pt, p2 = page(a); frs = []
        for c in order:
            X, Y = (c % C) * cw, (c // C) * ch
            f1 = np.zeros((FH, FW, 4), np.uint8); ft = np.zeros((FH, FW, 3), np.uint8); f2 = np.zeros((FH * 2, FW * 2, 4), np.uint8)
            f1[y0:y0 + ch, x0:x0 + cw] = p1[Y:Y + ch, X:X + cw]; ft[y0:y0 + ch, x0:x0 + cw] = pt[Y:Y + ch, X:X + cw]
            f2[y0 * 2:(y0 + ch) * 2, x0 * 2:(x0 + cw) * 2] = p2[Y * 2:(Y + ch) * 2, X * 2:(X + cw) * 2]
            frs.append((f1, ft, f2))
        for an in s["animations"].values():   # re-index onto the sprite's own block
            if "dirFrames" in an:
                for d in an["dirFrames"]: d["frame"] = loc[d["frame"]]
            else: an["frames"] = [loc[f] for f in an["frames"]]
        F[s["key"]] = (frs, wearpack.rigid_ranges(s))
    old = sorted(k for k in A if k.startswith(PFX))
    for k in old:
        for p in glob.glob(os.path.join(D, "atlases", k + ".*")) + glob.glob(os.path.join(D, "atlases", k + "@2x.*")): os.remove(p)
    SS = {s["key"]: s for s in S}; newA = []
    for name, l in wearpack.plan(F, wearpack.units_for(m["wearables"], F)):
        pk = PFX + name; at, rem, nc = wearpack.write(D, pk, l); newA.append(at)
        for k, (rm, anc) in rem.items(): wearpack.apply(SS[k], pk, rm, anc)
        print(f"page {pk}: {len(rem)} sprites {nc} cells, cell {at['frameW']}x{at['frameH']} grid {at['columns']}x{at['rows']} -> {l[5]}x{l[6]}", flush=True)
    i = min(j for j, a in enumerate(m["atlases"]) if a["key"].startswith(PFX))
    rest = [a for a in m["atlases"] if not a["key"].startswith(PFX)]; m["atlases"] = rest[:i] + newA + rest[i:]
    czm.save(MP, m)
    print(f"{len(old)} pages -> {len(newA)} pages")

if __name__ == "__main__": main(sys.argv[1])
