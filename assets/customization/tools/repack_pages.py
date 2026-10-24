#!/usr/bin/env python3
"""Repack selected customization wear pages IN PLACE with wearpack (one wearable / shared component per page, identical
frames stored once, page cell = union bbox incl. feet pivot so anchors stay in [0,1]). Reads the selected pages back
(exact pixels, no re-render); only the frames that live on them move:
  * frames/dirStride anims of sprites whose sprite.atlas is selected (kept contiguous; sprite.atlas + anchor rewritten),
  * dirFrames entries whose atlas is selected (deduplicated one by one; atlas/frame/anchor rewritten).
Other pages/sprites/anims are untouched. Selected pages are replaced by PREFIX<unit> pages. Idempotent when re-run on
its own output (select PREFIX pages again).
Then: python3 assets/tools/ktx2.py <manifest> ; pnpm --filter @engine/assets lock:ids:pack ; pnpm check
Usage: python3 repack_pages.py ENGINE_DIR PAGE_REGEX PREFIX [--dry]
  e.g. repack_pages.py . '^cz_sp_\\d+$|^cz_wp_sp_' cz_wp_sp_      (swim/punch wear pages)
       repack_pages.py . '^cz_pack_(eyes|face)_\\d+$|^cz_wp_(eyes|face)_' cz_wp_"""
import sys, os, json, glob, re
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
sys.path.append(os.path.join(os.path.dirname(os.path.dirname(HERE)), "tools"))
import numpy as np
from PIL import Image
import wearpack
from rig import FW, FH, FEET

def main(eng, rx, pfx, dry=False):
    D = os.path.join(eng, "packages/assets/pack/customization"); MP = os.path.join(D, "manifest.customization.json")
    m = json.load(open(MP)); A = {a["key"]: a for a in m["atlases"]}; sel = {k for k in A if re.search(rx, k)}
    wear = set()
    def walk(o):
        if isinstance(o, dict):
            for k, v in o.items():
                if k == "sprite" and isinstance(v, str): wear.add(v)
                else: walk(v)
        elif isinstance(o, list):
            for x in o: walk(x)
    walk(m["wearables"]); img = {}
    def page(a):
        if a["key"] not in img:
            ld = lambda p, mode: np.asarray(Image.open(os.path.join(D, p)).convert(mode))
            img[a["key"]] = (ld(a["image"], "RGBA"), ld(a["masks"]["tintmask"], "RGB"), ld(next(p["image"] for p in a["pages"] if p["scale"] == 2), "RGBA"))
        return img[a["key"]]
    # crops on the selected pages may overhang the rig frame (swim/punch poses): pad the virtual frame so it holds every
    # crop around the same feet pivot (x kept centred), and run wearpack on that frame size.
    def org(atl, anc):
        a = A[atl]; return FW / 2 - anc["x"] * a["frameW"], FEET - anc["y"] * a["frameH"], a["frameW"], a["frameH"]
    crops = [org(s["atlas"], s["anchor"]) for s in m["sprites"] if s["atlas"] in sel]
    crops += [org(d["atlas"], d["anchor"]) for s in m["sprites"] for an in s["animations"].values() for d in an.get("dirFrames", []) if d["atlas"] in sel]
    px = max([0] + [int(np.ceil(max(-x0, x0 + cw - FW) - 1e-3)) for x0, _, cw, _ in crops])
    pt = max([0] + [int(np.ceil(-y0 - 1e-3)) for _, y0, _, _ in crops]); pb = max([0] + [int(np.ceil(y0 + ch - FH - 1e-3)) for _, y0, _, ch in crops])
    VW, VH, VF = FW + 2 * px, FH + pt + pb, FEET + pt; wearpack.FW, wearpack.FH, wearpack.FEET = VW, VH, VF
    def grab(atl, c, anc):
        a = A[atl]; cw, ch, C = a["frameW"], a["frameH"], a["columns"]; X, Y = (c % C) * cw, (c // C) * ch
        x0 = int(round(VW / 2 - anc["x"] * cw)); y0 = int(round(VF - anc["y"] * ch))
        assert x0 >= 0 and y0 >= 0 and x0 + cw <= VW and y0 + ch <= VH, (atl, c, anc)
        p1, pt, p2 = page(a)
        f1 = np.zeros((VH, VW, 4), np.uint8); ft = np.zeros((VH, VW, 3), np.uint8); f2 = np.zeros((VH * 2, VW * 2, 4), np.uint8)
        f1[y0:y0 + ch, x0:x0 + cw] = p1[Y:Y + ch, X:X + cw]; ft[y0:y0 + ch, x0:x0 + cw] = pt[Y:Y + ch, X:X + cw]
        f2[y0 * 2:(y0 + ch) * 2, x0 * 2:(x0 + cw) * 2] = p2[Y * 2:(Y + ch) * 2, X * 2:(X + cw) * 2]
        return f1, ft, f2
    F, SS = {}, {}
    for s in m["sprites"]:
        rig_sel = s["atlas"] in sel; dfs = [(an, i) for an in s["animations"].values() for i, d in enumerate(an.get("dirFrames", [])) if d["atlas"] in sel]
        if not rig_sel and not dfs: continue
        assert s["key"] in wear, f"{s['key']} on a selected page is not wearable art"
        frs, rr = [], []
        if rig_sel:
            ranges = wearpack.rigid_ranges(s); loc = {}
            for r0, r1 in ranges:
                rr.append([len(frs), len(frs) + r1 - r0])
                for c in range(r0, r1): loc[c] = len(frs); frs.append(grab(s["atlas"], c, s["anchor"]))
            for an in s["animations"].values():
                if "dirFrames" not in an: an["frames"] = [loc[f] for f in an["frames"]]
        for an, i in dfs:
            d = an["dirFrames"][i]; frs.append(grab(d["atlas"], d["frame"], d["anchor"])); an["dirFrames"][i] = {"atlas": None, "frame": len(frs) - 1, "anchor": None}
        F[s["key"]] = (frs, rr); SS[s["key"]] = (s, rig_sel)
    print(f"virtual frame {VW}x{VH} feet {VF} (pad x{px} top{pt} bottom{pb}); {sum(len(f) for f, _ in F.values())} frames", flush=True)
    plan = wearpack.plan(F, wearpack.units_for(m["wearables"], F)); newA = []
    old = sorted(sel); tot0 = sum(A[k]["columns"] * A[k]["frameW"] * A[k]["rows"] * A[k]["frameH"] for k in old)
    if not dry:
        for k in old:
            for p in glob.glob(os.path.join(D, "atlases", k + ".*")) + glob.glob(os.path.join(D, "atlases", k + "@2x.*")): os.remove(p)
    for name, l in plan:
        pk = pfx + name
        assert pk not in A or pk in sel, pk
        if dry: print(f"page {pk}: {len(l[1])} sprites {len(l[0])} cells, cell {l[2][2]}x{l[2][3]} grid {l[3]}x{l[4]} -> {l[5]}x{l[6]}"); continue
        at, rem, nc = wearpack.write(D, pk, l); newA.append(at)
        for k, (rm, anc) in rem.items():
            s, rig_sel = SS[k]
            if rig_sel:
                s["atlas"] = pk; s["anchor"] = anc
            for an in s["animations"].values():
                if "dirFrames" in an:
                    an["dirFrames"] = [{"atlas": pk, "frame": rm[d["frame"]], "anchor": anc} if d["atlas"] is None else d for d in an["dirFrames"]]
                elif rig_sel:
                    for f in an["frames"]:
                        for dd in range(an.get("directions", 1)): assert rm[f + dd * an["dirStride"]] == rm[f] + dd * an["dirStride"], (k, f)
                    an["frames"] = [rm[f] for f in an["frames"]]
        print(f"page {pk}: {len(rem)} sprites {nc} cells, cell {at['frameW']}x{at['frameH']} grid {at['columns']}x{at['rows']} -> {l[5]}x{l[6]}", flush=True)
    print(f"{len(old)} pages ({sum(1 for _ in old)}; grid px {tot0}) -> {len(plan)} pages (px {sum(l[5] * l[6] for _, l in plan)})")
    if dry: return
    for s in m["sprites"]:
        for an in s["animations"].values(): assert all(d["atlas"] is not None for d in an.get("dirFrames", [])), s["key"]
    i = min(j for j, a in enumerate(m["atlases"]) if a["key"] in sel)
    rest = [a for a in m["atlases"] if a["key"] not in sel]; m["atlases"] = rest[:i] + newA + rest[i:]
    json.dump(m, open(MP, "w"), indent=1); open(MP, "a").write("\n")

if __name__ == "__main__": main(sys.argv[1], sys.argv[2], sys.argv[3], "--dry" in sys.argv)
