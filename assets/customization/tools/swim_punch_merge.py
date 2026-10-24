#!/usr/bin/env python3
"""ADR-107: adds `swim` (AnimState.Swim = 14) and `punch` (AnimState.Punch = 15) to an engine customization pack IN PLACE,
keeping every existing pixel (mirrors sit_merge.py; run after build_all.py + sit_merge.py):
 - renders SWIM_N / PUNCH_N frames x 8 facings per body/wearable sprite from rig.pose(anim="swim"/"punch")
 - swim post-process identical for every layer (tools/swimfx.py): sink so the chest waterline lands at WL (just above the feet
   pivot), clear below it; the body layer alone gets the ripple ring + droplets (tintmask 0). Swim frames hide the held item.
 - EXTRA PAGES (multi-page dirFrames, render f799a2a): existing pages are untouched. Each 80-frame block (swim 6x8 then
   punch 4x8, facing-major: cell = at + d*n + i) goes to a new page; anims carry dirFrames[i*8+d] = {atlas, frame, anchor}.
   Legacy frames/dirStride (swim 0..5/6, punch 0..3/4) stay in range on sprite.atlas and key the punch handR frameMeta.
 - bodies: cz_sp_body_<x> (same 44x60 cell, 10x8, @2x + tintmask + tintmask@2x)
 - wearables: per-sprite trimmed cell (union bbox + feet pivot), greedy-packed onto cz_sp_N pages (<=1020px 1x, @2x, tintmask).
Usage: python3 swim_punch_merge.py ENGINE_DIR [--preview KEY]"""
import sys, os, json, subprocess
HERE = os.path.dirname(os.path.abspath(__file__))
# rig.py / swim_punch_merge.py live in the repo; build_all/render/parts/catalog + the shared toon tools live in the art workspace
for p in ("/workspace/assets/tools", "/workspace/assets/customization/tools", HERE): sys.path.insert(0, p)
import rig  # repo copy first (SWIM_N=6), before build_all/render put the workspace dir on sys.path
sys.path.insert(0, "/workspace/assets/customization/tools")  # rig.py prepends /workspace/assets/tools (has its own build_all)
import build_all, swimfx
import numpy as np
from PIL import Image
from multiprocessing import Pool
from rig import FW, FH, FEET, PAD, SWIM_N, PUNCH_N, SWIM_Z
ENG = sys.argv[1]; D = os.path.join(ENG, "packages/assets/pack/customization"); MP = os.path.join(D, "manifest.customization.json")
JOBS = {j[0]: j for j in build_all.jobs()}
WL = FEET - 2                                  # waterline row (1x) in the 48x80 rig frame
SHIFT = WL - round(FEET - SWIM_Z)              # sink in 1x px
SWIM = {"fps": 6, "directions": 8, "dirStride": SWIM_N, "loop": True}
PUNCH = {"fps": 12, "directions": 8, "dirStride": PUNCH_N, "loop": False}

def render_key(key):
    import render
    j = JOBS[key]; out = []; base = key.startswith("body_")
    for anim, N in (("swim", SWIM_N), ("punch", PUNCH_N)):
        for d in range(8):
            for fi in range(N):
                (i1, i2, m1, m2), K = render.render_frame(j[1], j[2], j[3], d, anim, fi, N, j[4], j[5] if len(j) > 5 else None)
                fr = []
                for im, m, s in ((i1, m1, 1), (i2, m2, 2)):
                    a = np.asarray(im).copy(); m = np.asarray(m).copy(); p = PAD * s
                    if anim == "swim":
                        a = swimfx.sink(a, SHIFT * s, WL * s); m = swimfx.sink(m, SHIFT * s, WL * s)
                        if base:
                            b, f = swimfx.ripple(FW, FH, FW / 2, WL, 12.5, 3.6, fi, s)
                            m[f[..., 3] > 100] = 0; a = swimfx.apply_base(a, b, f)
                    for arr in (a, m): arr[:p] = 0; arr[-p:] = 0; arr[:, :p] = 0; arr[:, -p:] = 0
                    m[a[..., 3] == 0] = 0; fr += [a, m]
                out.append((fr, None if anim == "swim" else K["anchor"]))
    allA = np.concatenate([f[0][0].reshape(-1, 4) for f in out]).astype(np.float32); allM = np.concatenate([f[0][1].reshape(-1, 3) for f in out]).astype(np.float32) / 255
    w = np.clip(np.maximum(allM[:, 0], allM[:, 1]), 0, 1); sel = (w > .8) & (allA[:, 3] > 250)
    if sel.any() and np.median(allA[:, :3][sel].max(1)) >= 212:   # tools/neutral.py contract (K=0.13)
        for fr, _ in out:
            for ai, mi in ((0, 1), (2, 3)):
                a = fr[ai].astype(np.float32); mm = fr[mi].astype(np.float32) / 255; ww = np.clip(np.maximum(mm[..., 0], mm[..., 1]), 0, 1)
                a[..., :3] *= (1 - .13 * ww)[..., None]; fr[ai] = np.clip(a + .5, 0, 255).astype(np.uint8)
    for fr, _ in out:
        for ai in (0, 2): fr[ai][fr[ai][..., 3] == 0] = 0
    return key, out

def load(p, mode="RGBA"): return np.asarray(Image.open(os.path.join(D, p)).convert(mode)).copy()
def page2(a): return next(p["image"] for p in a["pages"] if p["scale"] == 2)
NS = 8 * SWIM_N

def save(arr, path, mode): Image.fromarray(arr, mode).save(os.path.join(D, path), optimize=True)
def r8(v): return -(-v // 8) * 8

if __name__ == "__main__":
    if "--preview" in sys.argv:
        k = sys.argv[sys.argv.index("--preview") + 1]; _, out = render_key(k)
        im = np.concatenate([np.concatenate([out[r * 8 + c][0][2] for c in range(8)], 1) for r in range(len(out) // 8)], 0)
        Image.fromarray(im).save("/tmp/sp_" + k + ".png"); sys.exit()
    m = json.load(open(MP)); A = {a["key"]: a for a in m["atlases"]}; S = {s["key"]: s for s in m["sprites"]}
    bodies = [b["sprite"] for b in m["bodyTypes"].values()]
    wear = set()
    def walk(o):
        if isinstance(o, dict):
            for k, v in o.items():
                if k == "sprite" and isinstance(v, str): wear.add(v)
                else: walk(v)
        elif isinstance(o, list):
            for x in o: walk(x)
    walk(m["wearables"]); wear -= set(bodies)
    todo = bodies + sorted(wear); assert all(k in JOBS for k in todo), [k for k in todo if k not in JOBS]
    assert all("swim" not in S[k]["animations"] and "punch" not in S[k]["animations"] for k in todo), "swim/punch already present"
    with Pool(int(os.environ.get("JOBS", "8"))) as pl: R = dict(pl.imap_unordered(render_key, todo))
    NB = 8 * (SWIM_N + PUNCH_N); assert all(len(R[k]) == NB for k in todo)
    print("rendered", len(R), "sprites x", NB, "frames", flush=True)
    def anims(s, page, cells_anchor, fm=None):
        """cells_anchor(j) -> (frame on page, anchor) for block cell j"""
        for name, n, base, spec in (("swim", SWIM_N, 0, SWIM), ("punch", PUNCH_N, NS, PUNCH)):
            df = []
            for i in range(n):
                for d in range(8):
                    f, an = cells_anchor(base + d * n + i); df.append({"atlas": page, "frame": f, "anchor": an})
            s["animations"][name] = {"frames": list(range(n)), **spec, "dirFrames": df}
        if fm: s["animations"]["punch"]["frameMeta"] = fm
    def hand_meta(k):
        fm = {}
        for j in range(NS, NB):
            h = R[k][j][1]; li = j - NS          # legacy index d*PUNCH_N + i on sprite.atlas
            fm[str(li)] = {"anchors": {"handR": {"x": round(h["x"] - FW / 2, 2), "y": round(h["y"] - FEET, 2), "angle": h["angle"], "len": h["len"], "behind": h["behind"]}}}
        return fm
    # ---- bodies: same trimmed cell as the main body page
    for k in bodies:
        s = S[k]; a = A[s["atlas"]]; fw, fh = a["frameW"], a["frameH"]
        wx0 = round(FW / 2 - s["anchor"]["x"] * fw); wy0 = round(FEET - s["anchor"]["y"] * fh)
        has_t2 = os.path.exists(os.path.join(D, "atlases", k + ".tintmask@2x.png"))
        C, Rw = 10, -(-NB // 10); pk = "cz_sp_" + k
        o1 = np.zeros((Rw * fh, C * fw, 4), np.uint8); ot = np.zeros((Rw * fh, C * fw, 3), np.uint8)
        o2 = np.zeros((Rw * fh * 2, C * fw * 2, 4), np.uint8); ot2 = np.zeros((Rw * fh * 2, C * fw * 2, 3), np.uint8); lost = 0
        for j, (fr, _) in enumerate(R[k]):
            X, Y = (j % C) * fw, (j // C) * fh
            c = [fr[0][wy0:wy0 + fh, wx0:wx0 + fw].copy(), fr[1][wy0:wy0 + fh, wx0:wx0 + fw].copy(),
                 fr[2][wy0 * 2:(wy0 + fh) * 2, wx0 * 2:(wx0 + fw) * 2].copy(), fr[3][wy0 * 2:(wy0 + fh) * 2, wx0 * 2:(wx0 + fw) * 2].copy()]
            lost += int(fr[0][..., 3].astype(bool).sum() - c[0][..., 3].astype(bool).sum())
            for i, p in ((0, 1), (1, 1), (2, 2), (3, 2)): c[i][:p] = 0; c[i][-p:] = 0; c[i][:, :p] = 0; c[i][:, -p:] = 0
            o1[Y:Y + fh, X:X + fw] = c[0]; ot[Y:Y + fh, X:X + fw] = c[1]
            o2[Y * 2:(Y + fh) * 2, X * 2:(X + fw) * 2] = c[2]; ot2[Y * 2:(Y + fh) * 2, X * 2:(X + fw) * 2] = c[3]
        save(o1, f"atlases/{pk}.png", "RGBA"); save(o2, f"atlases/{pk}@2x.png", "RGBA"); save(ot, f"atlases/{pk}.tintmask.png", "RGB")
        if has_t2: save(ot2, f"atlases/{pk}.tintmask@2x.png", "RGB")
        A[pk] = {"key": pk, "image": f"atlases/{pk}.png", "frameW": fw, "frameH": fh, "columns": C, "rows": Rw,
                 "pages": [{"scale": 2, "image": f"atlases/{pk}@2x.png"}], "masks": {"tintmask": f"atlases/{pk}.tintmask.png"}}
        anc = dict(s["anchor"]); anims(s, pk, lambda j: (j, anc), hand_meta(k))
        print(f"body {k}: page {pk} {C*fw}x{Rw*fh} (@2x {C*fw*2}x{Rw*fh*2}) clipped-px {lost}", flush=True)
    # ---- wearables: trimmed per-sprite cell, greedy pages
    BB = {}
    for k in sorted(wear):
        al = np.zeros((FH, FW), bool)
        for fr, _ in R[k]: al |= fr[0][..., 3] > 0
        ys, xs = np.nonzero(al)
        x0 = min(int(xs.min()) if len(xs) else 23, FW // 2 - 1) - 1; y0 = min(int(ys.min()) if len(ys) else 73, FEET - 1) - 1
        x1 = max(int(xs.max()) + 1 if len(xs) else 25, FW // 2 + 1) + 1; y1 = max(int(ys.max()) + 1 if len(ys) else 75, FEET + 1) + 1
        x0, y0, x1, y1 = max(0, x0), max(0, y0), min(FW, x1), min(FH, y1)
        BB[k] = (x0, y0, x1 - x0, y1 - y0)
    MAXP = 1020; order = sorted(wear, key=lambda k: (BB[k][3], BB[k][2], k)); pages = []; cur = []
    def fits(g):
        cw = max(BB[k][2] for k in g); ch = max(BB[k][3] for k in g); C = MAXP // cw
        return -(-len(g) * NB // C) * ch <= MAXP
    for k in order:
        if cur and not fits(cur + [k]): pages.append(cur); cur = []
        cur.append(k)
    if cur: pages.append(cur)
    newp = []
    for pi, g in enumerate(pages):
        cw = max(BB[k][2] for k in g); ch = max(BB[k][3] for k in g); C = MAXP // cw; N = len(g) * NB; Rw = -(-N // C)
        W1, H1 = r8(C * cw), r8(Rw * ch); pk = f"cz_sp_{pi}"
        o1 = np.zeros((H1, W1, 4), np.uint8); ot = np.zeros((H1, W1, 3), np.uint8); o2 = np.zeros((H1 * 2, W1 * 2, 4), np.uint8)
        for si, k in enumerate(g):
            x0, y0, w, h = BB[k]; at = si * NB
            for j, (fr, _) in enumerate(R[k]):
                c = at + j; X, Y = (c % C) * cw, (c // C) * ch
                o1[Y:Y + h, X:X + w] = fr[0][y0:y0 + h, x0:x0 + w]; ot[Y:Y + h, X:X + w] = fr[1][y0:y0 + h, x0:x0 + w]
                o2[Y * 2:(Y + h) * 2, X * 2:(X + w) * 2] = fr[2][y0 * 2:(y0 + h) * 2, x0 * 2:(x0 + w) * 2]
            anc = {"x": round((FW / 2 - x0) / cw, 6), "y": round((FEET - y0) / ch, 6)}
            anims(S[k], pk, lambda j, at=at, anc=anc: (at + j, anc))
        save(o1, f"atlases/{pk}.png", "RGBA"); save(o2, f"atlases/{pk}@2x.png", "RGBA"); save(ot, f"atlases/{pk}.tintmask.png", "RGB")
        A[pk] = {"key": pk, "image": f"atlases/{pk}.png", "frameW": cw, "frameH": ch, "columns": C, "rows": Rw,
                 "pages": [{"scale": 2, "image": f"atlases/{pk}@2x.png"}], "masks": {"tintmask": f"atlases/{pk}.tintmask.png"}}
        newp.append(pk); print(f"page {pk}: {len(g)} sprites cell {cw}x{ch} grid {C}x{Rw} -> {W1}x{H1} (@2x {W1*2}x{H1*2})", flush=True)
    m["atlases"] = m["atlases"] + [A["cz_sp_" + k] for k in bodies] + [A[k] for k in newp]
    json.dump(m, open(MP, "w"), indent=1); open(MP, "a").write("\n")
    print("wear pages:", len(newp), "wear sprites:", len(wear), flush=True)
