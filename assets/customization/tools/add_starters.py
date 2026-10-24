#!/usr/bin/env python3
"""ADR-114: append NEW catalog wearables (keys not yet in the engine pack) to ENGINE/packages/assets/pack/customization IN PLACE,
leaving every existing page/sprite untouched. Per new sprite (incl. split sleeves + hatHair variants) one contiguous block:
  base sheet (rig.frame_list: 8x31 [+8x2 face/eyes expressions]) | sit 8xSIT_N | swim 8xSWIM_N | punch 8xPUNCH_N
rendered with render.py/parts.py (+ swim_punch_merge.render_key for the swim sink / neutral contract), trimmed to the union
alpha bbox (+1px border, feet pivot inside) and greedy-packed per slot onto new cz_st114_<slot>_<n> pages (<=1020 px 1x, @2x, tintmask).
Anim names/frame counts == body: base anims via frames (+block offset), sit via frames/dirStride 4, swim/punch via dirFrames
(legacy frames 0..n-1 like every other wear sprite). Wearable entries come from build_all.fragment() (unlockTags from UNLOCKS -> []).
Then run: python3 assets/tools/ktx2.py <manifest> ; pnpm --filter @engine/assets lock:ids:pack ; pnpm check
Usage: python3 add_starters.py ENGINE_DIR"""
import sys, os, json
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import swim_punch_merge as spm      # also sets up sys.path (repo assets/tools appended)
import build_all, catalog
import numpy as np
from PIL import Image
from multiprocessing import Pool
from rig import FW, FH, FEET, PAD, SIT_N, SWIM_N, PUNCH_N, frame_list
ENG = sys.argv[1]; D = os.path.join(ENG, "packages/assets/pack/customization"); MP = os.path.join(D, "manifest.customization.json")
MAXP = 1020; PFX = "cz_st114_"
MAXP8 = MAXP // 8 * 8  # pages are padded to multiples of 8

def neutral(out):   # tools/neutral.py contract (K=0.13), same median rule as the base sheets
    allA = np.concatenate([f[0].reshape(-1, 4) for f in out]).astype(np.float32); allM = np.concatenate([f[1].reshape(-1, 3) for f in out]).astype(np.float32) / 255
    w = np.clip(np.maximum(allM[:, 0], allM[:, 1]), 0, 1); sel = (w > .8) & (allA[:, 3] > 250)
    if sel.any() and np.median(allA[:, :3][sel].max(1)) >= 212:
        for fr in out:
            for ai, mi in ((0, 1), (2, 3)):
                a = fr[ai].astype(np.float32); mm = fr[mi].astype(np.float32) / 255; ww = np.clip(np.maximum(mm[..., 0], mm[..., 1]), 0, 1)
                a[..., :3] *= (1 - .13 * ww)[..., None]; fr[ai] = np.clip(a + .5, 0, 255).astype(np.uint8)
    for fr in out:
        for ai in (0, 2): fr[ai][fr[ai][..., 3] == 0] = 0

def render_key(key):
    import render
    j = spm.JOBS[key]; part = j[5] if len(j) > 5 else None
    fl = frame_list(j[2]) + [(d, "sit", fi, SIT_N) for d in range(8) for fi in range(SIT_N)]
    out = []
    for d, anim, fi, n in fl:
        (i1, i2, m1, m2), _ = render.render_frame(j[1], j[2], j[3], d, anim, fi, n, j[4], part)
        fr = []
        for im, m, s in ((i1, m1, 1), (i2, m2, 2)):
            a = np.asarray(im).copy(); m = np.asarray(m).copy(); p = PAD * s
            for arr in (a, m): arr[:p] = 0; arr[-p:] = 0; arr[:, :p] = 0; arr[:, -p:] = 0
            m[a[..., 3] == 0] = 0; fr += [a, m]
        out.append(fr)
    neutral(out)
    _, sp = spm.render_key(key)
    return key, (len(fl) - 8 * SIT_N, out + [f for f, _ in sp])

if __name__ == "__main__":
    m = json.load(open(MP)); have = {w["key"] for w in m["wearables"]}; S0 = {s["key"] for s in m["sprites"]}
    new = [w for w in catalog.W if w[0] not in have]; newk = {w[0] for w in new}
    J = [j for j in build_all.jobs() if j[0].startswith("cz_") and any(j[0].startswith(f"cz_{k}_") for k in newk) and j[0] not in S0]
    frag = build_all.fragment(build_all.jobs()); FS = {s["key"]: s for s in frag["sprites"]}
    slot_of = {j[0]: j[2] for j in J}; todo = sorted(slot_of)
    print("new wearables", len(new), "sprites", len(todo), flush=True)
    with Pool(int(os.environ.get("JOBS", "8"))) as pl: R = dict(pl.imap_unordered(render_key, todo))
    BB = {}
    for k in todo:
        al = np.zeros((FH, FW), bool)
        for fr in R[k][1]: al |= fr[0][..., 3] > 0
        ys, xs = np.nonzero(al)
        x0 = min(int(xs.min()), FW // 2 - 1) - 1; y0 = min(int(ys.min()), FEET - 1) - 1
        x1 = max(int(xs.max()) + 1, FW // 2 + 1) + 1; y1 = max(int(ys.max()) + 1, FEET + 1) + 1
        x0, y0, x1, y1 = max(0, x0), max(0, y0), min(FW, x1), min(FH, y1); BB[k] = (x0, y0, x1 - x0, y1 - y0)
    def fits(g):
        cw = max(BB[k][2] for k in g); ch = max(BB[k][3] for k in g); C = MAXP8 // cw
        return -(-sum(len(R[k][1]) for k in g) // C) * ch <= MAXP8
    pages = []
    for sl in ("hair", "face", "top", "bottom", "shoes", "hat", "accessory", "eyes"):
        cur = []
        for k in sorted([k for k in todo if slot_of[k] == sl], key=lambda k: (BB[k][3], BB[k][2], k)):
            if cur and not fits(cur + [k]): pages.append((sl, cur)); cur = []
            assert fits([k]), (k, BB[k]); cur.append(k)
        if cur: pages.append((sl, cur))
    cnt = {}; newA = []; newS = []
    for sl, g in pages:
        cnt[sl] = cnt.get(sl, 0) + 1; pk = f"{PFX}{sl}_{cnt[sl]}"
        cw = max(BB[k][2] for k in g); ch = max(BB[k][3] for k in g); C = MAXP8 // cw; N = sum(len(R[k][1]) for k in g); Rw = -(-N // C)
        W1, H1 = spm.r8(C * cw), spm.r8(Rw * ch)
        o1 = np.zeros((H1, W1, 4), np.uint8); ot = np.zeros((H1, W1, 3), np.uint8); o2 = np.zeros((H1 * 2, W1 * 2, 4), np.uint8); at = 0
        for k in g:
            x0, y0, w, h = BB[k]; nb, frs = R[k]
            for j, fr in enumerate(frs):
                c = at + j; X, Y = (c % C) * cw, (c // C) * ch
                o1[Y:Y + h, X:X + w] = fr[0][y0:y0 + h, x0:x0 + w]; ot[Y:Y + h, X:X + w] = fr[1][y0:y0 + h, x0:x0 + w]
                o2[Y * 2:(Y + h) * 2, X * 2:(X + w) * 2] = fr[2][y0 * 2:(y0 + h) * 2, x0 * 2:(x0 + w) * 2]
            anc = {"x": round((FW / 2 - x0) / cw, 6), "y": round((FEET - y0) / ch, 6)}
            s = {"key": k, "category": "character", "atlas": pk, "anchor": anc, "animations": {}}
            for n, an in FS[k]["animations"].items():
                s["animations"][n] = dict(an, frames=[f + at for f in an["frames"]])
            s["animations"]["sit"] = {"frames": list(range(at + nb, at + nb + SIT_N)), "fps": 4, "directions": 8, "dirStride": SIT_N, "loop": True}
            o = at + nb + 8 * SIT_N
            spm.anims(s, pk, lambda jj, o=o, anc=anc: (o + jj, anc))
            newS.append(s); at += len(frs)
        spm.D = D; spm.save(o1, f"atlases/{pk}.png", "RGBA"); spm.save(o2, f"atlases/{pk}@2x.png", "RGBA"); spm.save(ot, f"atlases/{pk}.tintmask.png", "RGB")
        newA.append({"key": pk, "image": f"atlases/{pk}.png", "frameW": cw, "frameH": ch, "columns": C, "rows": Rw,
                     "pages": [{"scale": 2, "image": f"atlases/{pk}@2x.png"}], "masks": {"tintmask": f"atlases/{pk}.tintmask.png"}})
        print(f"page {pk}: {len(g)} sprites cell {cw}x{ch} grid {C}x{Rw} -> {W1}x{H1} (@2x {W1*2}x{H1*2})", flush=True)
    m["atlases"] += newA; m["sprites"] += newS
    m["wearables"] += [w for w in frag["wearables"] if w["key"] in newk]
    assert all(not w["unlockTags"] for w in m["wearables"] if w["key"] in newk)
    json.dump(m, open(MP, "w"), indent=1); open(MP, "a").write("\n")
    sp = os.path.join(D, "strings", "en.json"); st = json.load(open(sp))
    for w in new: st[f"cosmetic.{w[0]}"] = build_all.STR[f"cosmetic.{w[0]}"]
    json.dump(dict(sorted(st.items())), open(sp, "w"), indent=1)
    print("added", len(new), "wearables,", len(newS), "sprites,", len(newA), "pages", flush=True)
