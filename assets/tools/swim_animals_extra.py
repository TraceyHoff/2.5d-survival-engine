#!/usr/bin/env python3
"""ADR-107 follow-up (render f799a2a: multi-page dirFrames for animals): boar/wolf/deer `swim` on EXTRA pages
(the MEDIUM_LARGE path of swim_merge_main.py). Swim frames derived from the walk frames (tools/swimfx.py sink + ripple),
written to new atlases animals_medium_sp (48px, boar+wolf) / animals_large_sp (64px, deer) with @2x + sheen mask;
`swim.frames` = the walk frames (legacy layout on sprite.atlas), `swim.dirFrames` -> the new page. Existing pages untouched.
Usage: python3 swim_animals_extra.py ENGINE_DIR"""
import sys, os, json, subprocess
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import swim_merge_main as M
P, MP = M.P, M.MP

if __name__ == "__main__":
    m = json.load(open(MP)); A = {a["key"]: a for a in m["atlases"]}; S = {s["key"]: s for s in m["sprites"]}
    for src, keys, fw, cols in (("animals_medium", ["animal_boar", "animal_wolf"], 48, 16), ("animals_large", ["animal_deer"], 64, 12)):
        a = A[src]; fh = fw; assert (a["frameW"], a["frameH"]) == (fw, fh); L1 = M.ld(a["image"]); L2 = M.ld(a["pages"][0]["image"])
        assert all("swim" not in S[k]["animations"] for k in keys)
        def walk_dirs(s):
            w = s["animations"]["walk"]; st = w.get("dirStride", a["columns"]); return [[f + d * st for f in w["frames"]] for d in range(8)]
        der = {k: M.derive(L1, L2, walk_dirs(S[k]), fw, fh, S[k]["anchor"]["x"], S[k]["anchor"]["y"]) for k in keys}
        tot = sum(len(v) for v in der.values()); rows = -(-tot // cols); nk = src + "_sp"
        O1 = np.zeros((rows * fh, cols * fw, 4), np.uint8); O2 = np.zeros((rows * fh * 2, cols * fw * 2, 4), np.uint8); g = 0
        for k in keys:
            s = S[k]; w = s["animations"]["walk"]; n = len(w["frames"]); df = [None] * (n * 8)
            for j, (c1, c2) in enumerate(der[k]):
                M.cell(O1, g, cols, fw, fh)[:] = c1; M.cell(O2, g, cols, fw, fh, 2)[:] = c2; d, i = j // n, j % n
                df[i * 8 + d] = {"atlas": nk, "frame": g, "anchor": dict(s["anchor"])}; g += 1
            s["animations"]["swim"] = {"frames": list(w["frames"]), "fps": 6, "directions": 8, "dirStride": w.get("dirStride", a["columns"]), "loop": True, "dirFrames": df}
            print(k, f"swim {n} frames x 8 dirs -> {nk}")
        M.sv(O1, f"atlases/{nk}.png"); M.sv(O2, f"atlases/{nk}@2x.png")
        subprocess.check_call([sys.executable, M.SHEEN, os.path.join(P, f"atlases/{nk}.png"), "--out-dir", os.path.join(P, "atlases"), "--scale", "1"], stdout=subprocess.DEVNULL)
        assert os.path.exists(os.path.join(P, f"atlases/{nk}_sheen.png"))
        ent = {"key": nk, "image": f"atlases/{nk}.png", "frameW": fw, "frameH": fh, "columns": cols, "rows": rows,
               "pages": [{"scale": 2, "image": f"atlases/{nk}@2x.png"}], "masks": {"sheen": f"atlases/{nk}_sheen.png"}}
        m["atlases"].insert(m["atlases"].index(a) + 1, ent)
        print(nk, cols * fw, "x", rows * fh, "@2x", cols * fw * 2, "x", rows * fh * 2)
    raw = open(MP).read(); ind = 1 if raw.startswith("{\n ") and not raw.startswith("{\n  ") else 2
    json.dump(m, open(MP, "w"), indent=ind); open(MP, "a").write("\n")
