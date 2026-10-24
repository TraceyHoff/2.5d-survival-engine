#!/usr/bin/env python3
"""Repack customization wearable art into per-frame trimmed rects (AnimationJson.dirFrames[].rect, render fb01c5c6).
Every anim of every selected wearable sprite becomes explicit dirFrames {atlas, rect, anchor} (frames.length x directions
entries, index i*directions+dirIndex, exactly what arithmetic/grid/rect indexing resolved to before):
  * rect = alpha bbox of the frame (1x and @2x) unioned with the feet pivot (validator: anchor in [0,1]) + 1px clear border,
  * identical frames (same pixels + same pivot) across frames, facings, anims and sprites of a page share one rect,
  * fully transparent frames (e.g. back-facing eyes/face) all point at one 1x1 clear rect per page.
Pages: one per wearable (or per identical-sprite shared unit; split by variant/body only if it does not fit), shelf-packed,
<= 1016 px, PNG + @2x + RGB tintmask; run ktx2.py after. `frames` arrays (= frame counts, matching the body) are kept.
Reads the current pages back (grid, frame or rect entries), so it is pixel-exact and idempotent on its own output.
Pages no sprite references afterwards are deleted.
Tight rects (--tight eyes,face; render 5be856e0): the rect is the alpha bbox only and the feet pivot may lie outside it
(manifest DIRFRAME_ANCHOR_SLACK = 8 rect sizes; the rect only grows toward the pivot where that limit needs it), so face/eye
frames no longer stretch down to the feet.
Bodies (--bodies; render bf615e84): body_<bt> (all anims incl. the cz_sp_body_* swim/punch page) -> one rect page keyed
`body_<bt>` (body pool key rule), tintmask@2x kept. Index-keyed frameMeta (sprite level + anim level) is resolved per
dirFrames entry exactly like AssetRegistry.dirFrameMeta(legacy frame) and rewritten as anim-level "df:<i>" keys.
Usage: python3 rectpack.py ENGINE_DIR [--slots eyes,face,...] [--tight eyes,face] [--bodies] [--dry]   (default: every wearable slot)
Then: python3 assets/tools/ktx2.py <manifest>; pnpm --filter @engine/assets lock:ids:pack; pnpm check"""
import sys, os, json, glob, hashlib, re
import numpy as np
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from wearpack import body_of, variant_of, partitions, r8
MAXP8 = 1016; PFX = "cz_wr_"

def dir_index(d, n): return d  # entry slot d == AssetRegistry.directionIndex result d (arithmetic used d*dirStride)

SLACK = 8 - 0.05   # manifest DIRFRAME_ANCHOR_SLACK (8) minus rounding margin

def mask2x(p): return re.sub(r"(\.[a-z]+)$", r"@2x\1", p)

def main(eng, slots=None, dry=False, tight=(), bodies=False):
    D = os.path.join(eng, "packages/assets/pack/customization"); MP = os.path.join(D, "manifest.customization.json")
    m = json.load(open(MP)); A = {a["key"]: a for a in m["atlases"]}; S = {s["key"]: s for s in m["sprites"]}
    def walk(o, acc):
        if isinstance(o, dict):
            for k, v in o.items():
                if k == "sprite" and isinstance(v, str): acc.append(v)
                else: walk(v, acc)
        elif isinstance(o, list):
            for x in o: walk(x, acc)
        return acc
    W = {w["key"]: sorted(set(walk(w, []))) for w in m["wearables"] if slots is None or w["slot"] in slots}
    sel = sorted({k for ks in W.values() for k in ks})
    assert not any(k.startswith("body") for k in sel)
    TIGHT = {k for w in m["wearables"] if w["slot"] in tight for k in walk(w, [])}
    BODY = sorted(b["sprite"] for b in m.get("bodyTypes", {}).values()) if bodies else []
    if slots is not None and not W: sel = []
    sel = sorted(set(sel) | set(BODY))
    cache = {}
    def page(ak):
        if ak not in cache:
            if len(cache) > 48: cache.clear()
            a = A[ak]; ld = lambda p, mode: np.asarray(Image.open(os.path.join(D, p)).convert(mode))
            t2 = mask2x(a["masks"]["tintmask"])
            cache[ak] = (ld(a["image"], "RGBA"), ld(a["masks"]["tintmask"], "RGB"), ld(next(p["image"] for p in a["pages"] if p["scale"] == 2), "RGBA"),
                         ld(t2, "RGB") if os.path.exists(os.path.join(D, t2)) else None)
        return cache[ak]
    def src_entries(s):
        """per anim: list of (atlas, (x,y,w,h), (ax,ay) pivot px inside the rect) in dirFrames order"""
        out = {}
        for name, an in s["animations"].items():
            n = an.get("directions", 1); L = []
            if "dirFrames" in an:
                for d in an["dirFrames"]:
                    a = A[d["atlas"]]
                    if "rect" in d: r = d["rect"]; R = (r["x"], r["y"], r["w"], r["h"])
                    else: f = d["frame"]; R = ((f % a["columns"]) * a["frameW"], (f // a["columns"]) * a["frameH"], a["frameW"], a["frameH"])
                    L.append((d["atlas"], R, (d["anchor"]["x"] * R[2], d["anchor"]["y"] * R[3])))
            else:
                a = A[s["atlas"]]; st = an.get("dirStride", a["columns"]) if n > 1 else 0
                for f0 in an["frames"]:
                    for d in range(n):
                        f = f0 + dir_index(d, n) * st
                        R = ((f % a["columns"]) * a["frameW"], (f // a["columns"]) * a["frameH"], a["frameW"], a["frameH"])
                        L.append((s["atlas"], R, (s["anchor"]["x"] * R[2], s["anchor"]["y"] * R[3])))
            assert len(L) == len(an["frames"]) * n, (s["key"], name)
            out[name] = L
        return out
    def grab(ak, R, piv, tight=False):
        """-> (key, crop or None(blank), pivot in crop px)"""
        x, y, w, h = R; p1, pt, p2, t2 = page(ak); ax, ay = piv; iax, iay = round(ax * 2) / 2, round(ay * 2) / 2
        assert abs(ax - iax) < 0.02 and abs(ay - iay) < 0.02, (ak, R, piv)
        c1 = p1[y:y + h, x:x + w]; ct = pt[y:y + h, x:x + w]; c2 = p2[2 * y:2 * (y + h), 2 * x:2 * (x + w)]
        al = (c1[..., 3] > 0) | (c2[..., 3] > 0).reshape(h, 2, w, 2).any(axis=(1, 3))
        if not al.any(): return ("blank", None, None)
        ys, xs = np.nonzero(al); x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
        if tight:
            x0 -= 1; y0 -= 1; x1 += 1; y1 += 1
            def fit(lo, hi, pv):   # grow toward the pivot until it is within the anchor slack of the rect
                while pv > hi + SLACK * (hi - lo): hi += 1
                while pv < lo - SLACK * (hi - lo): lo -= 1
                return lo, hi
            x0, x1 = fit(x0, x1, iax); y0, y1 = fit(y0, y1, iay)
        else:
            x0 = min(x0, int(np.floor(iax)) - 0) - 1; y0 = min(y0, int(np.floor(iay))) - 1; x1 = max(x1, int(np.ceil(iax))) + 1; y1 = max(y1, int(np.ceil(iay))) + 1
        cw, ch = x1 - x0, y1 - y0
        n1 = np.zeros((ch, cw, 4), np.uint8); nt = np.zeros((ch, cw, 3), np.uint8); n2 = np.zeros((2 * ch, 2 * cw, 4), np.uint8)
        sx0, sy0, sx1, sy1 = max(x0, 0), max(y0, 0), min(x1, w), min(y1, h)
        n1[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0] = c1[sy0:sy1, sx0:sx1]; nt[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0] = ct[sy0:sy1, sx0:sx1]
        n2[2 * (sy0 - y0):2 * (sy1 - y0), 2 * (sx0 - x0):2 * (sx1 - x0)] = c2[2 * sy0:2 * sy1, 2 * sx0:2 * sx1]
        n4 = None
        if t2 is not None:
            n4 = np.zeros((2 * ch, 2 * cw, 3), np.uint8)
            n4[2 * (sy0 - y0):2 * (sy1 - y0), 2 * (sx0 - x0):2 * (sx1 - x0)] = t2[2 * y:2 * (y + h), 2 * x:2 * (x + w)][2 * sy0:2 * sy1, 2 * sx0:2 * sx1]
        pv = (iax - x0, iay - y0)
        k = hashlib.sha1(n1.tobytes() + nt.tobytes() + n2.tobytes() + (n4.tobytes() if n4 is not None else b"") + repr((cw, ch, pv)).encode()).hexdigest()
        return (k, (n1, nt, n2, n4), pv)
    # ---- read every selected sprite (unique crops + per-entry keys)
    CROP, PIV, ENT = {}, {}, {}
    for k in sel:
        E = {}
        for name, L in src_entries(S[k]).items():
            ks = []
            for ak, R, piv in L:
                h, c, pv = grab(ak, R, piv, k in TIGHT); ks.append(h)
                if c is not None and h not in CROP: CROP[h] = c; PIV[h] = pv
            E[name] = ks
        ENT[k] = E
    # ---- units: per wearable; sprites identical across wearables form a shared unit
    sig = {k: hashlib.sha1(json.dumps(ENT[k], sort_keys=True).encode()).hexdigest() for k in sel}
    by = {}
    for wk in sorted(W):
        for k in W[wk]: by.setdefault(sig[k], set()).add(wk)
    units = {}
    for k in BODY: by.setdefault(sig[k], set()).add(k); units[k] = [k]
    for wk in sorted(W):
        own = [k for k in W[wk] if len(by[sig[k]]) == 1]
        if own: units[wk] = own
    for k in sel:
        if k in BODY: continue
        ws = sorted(by[sig[k]])
        if len(ws) > 1: units.setdefault(f"{ws[0]}_{variant_of(k)}_shared", []).append(k)
    def layout(keys, wfix=None, hmin=0):
        items, seen = [], set()
        for k in keys:
            for ks in ENT[k].values():
                for h in ks:
                    if h not in seen: seen.add(h); items.append(h)
        sizes = [(1, 1) if h == "blank" else (CROP[h][0].shape[1], CROP[h][0].shape[0]) for h in items]
        order = sorted(range(len(items)), key=lambda i: (-sizes[i][1], -sizes[i][0], i))
        best = None
        for Wd in ([wfix] if wfix else range(64, MAXP8 + 1, 8)):
            if max(s[0] for s in sizes) > Wd: continue
            pos = {}; x = y = sh = 0
            for i in order:
                w, h = sizes[i]
                if x + w > Wd: y += sh; x = 0; sh = 0
                pos[i] = (x, y); x += w; sh = max(sh, h)
            H = max(r8(y + sh), hmin)
            if H > MAXP8: continue
            sc = (Wd * H, max(Wd, H))
            if best is None or sc < best[0]: best = (sc, Wd, H, pos)
        if best is None: return None
        _, Wd, H, pos = best
        return Wd, H, {items[i]: (pos[i][0], pos[i][1], sizes[i][0], sizes[i][1]) for i in pos}
    plan = []
    for name, keys in sorted(units.items()):
        bestp = None
        for part in list(partitions(keys)) + [[[k] for k in sorted(keys)]]:
            L = [layout(g) for g in part]
            if any(l is None for l in L): continue
            sc = (len(L), sum(l[0] * l[1] for l in L))
            if bestp is None or sc < bestp[0]: bestp = (sc, part, L)
        assert bestp, name
        _, part, L = bestp
        for g, l in zip(part, L):
            bs = {body_of(k) for k in g}; vs = {variant_of(k) for k in g}; lab = []
            if len(part) > 1:
                if len(bs) == 1: lab.append(next(iter(bs)))
                if len(vs) == 1 and vs != {"base"} and not name.endswith("_shared"): lab.append(next(iter(vs)))
            plan.append(((name if name in BODY else PFX + name) + "".join("_" + x for x in lab if x), g, l))
    # bodies share one body-pool slot geometry (max w x max h of the body pages): give every body page the same size
    bi = [j for j, (pk, g, l) in enumerate(plan) if g[0] in BODY]
    if len(bi) > 1:
        best = None
        for Wd in range(64, MAXP8 + 1, 8):
            L = [layout(plan[j][1], Wd) for j in bi]
            if any(l is None for l in L): continue
            sc = (Wd * max(l[1] for l in L), Wd)
            if best is None or sc < best[0]: best = (sc, Wd, max(l[1] for l in L))
        _, Wd, Hm = best
        for j in bi: plan[j] = (plan[j][0], plan[j][1], layout(plan[j][1], Wd, Hm))
    old_used = {S[k]["atlas"] for k in sel} | {d["atlas"] for k in sel for an in S[k]["animations"].values() for d in an.get("dirFrames", [])}
    ncrop = len(CROP); px0 = sum(A[a]["frameW"] * A[a]["columns"] * A[a]["frameH"] * A[a]["rows"] for a in old_used)
    for pk, g, (Wd, H, pos) in plan: print(f"{pk}: {len(g)} sprites, {len(pos)} rects, {Wd}x{H}")
    print(f"{len(sel)} sprites, {ncrop} unique frames; pages in use {len(old_used)} -> new {len(plan)} (px {sum(l[0] * l[1] for _, _, l in plan)})")
    if dry: return
    newA = []
    for pk, g, (Wd, H, pos) in plan:
        o1 = np.zeros((H, Wd, 4), np.uint8); ot = np.zeros((H, Wd, 3), np.uint8); o2 = np.zeros((2 * H, 2 * Wd, 4), np.uint8)
        has4 = any(CROP[h][3] is not None for h in pos if h != "blank"); o4 = np.zeros((2 * H, 2 * Wd, 3), np.uint8) if has4 else None
        for h, (x, y, w, hh) in pos.items():
            if h == "blank": continue
            c1, ct, c2, c4 = CROP[h]; o1[y:y + hh, x:x + w] = c1; ot[y:y + hh, x:x + w] = ct; o2[2 * y:2 * (y + hh), 2 * x:2 * (x + w)] = c2
            if has4: assert c4 is not None, h; o4[2 * y:2 * (y + hh), 2 * x:2 * (x + w)] = c4
        outs = [(o1, f"atlases/{pk}.png", "RGBA"), (o2, f"atlases/{pk}@2x.png", "RGBA"), (ot, f"atlases/{pk}.tintmask.png", "RGB")]
        if has4: outs.append((o4, f"atlases/{pk}.tintmask@2x.png", "RGB"))
        for arr, p, mode in outs: Image.fromarray(arr, mode).save(os.path.join(D, p), optimize=True)
        newA.append({"key": pk, "image": f"atlases/{pk}.png", "frameW": Wd, "frameH": H, "columns": 1, "rows": 1,
                     "pages": [{"scale": 2, "image": f"atlases/{pk}@2x.png"}], "masks": {"tintmask": f"atlases/{pk}.tintmask.png"}})
        def df(h):
            x, y, w, hh = pos[h]
            if h == "blank": return {"atlas": pk, "rect": {"x": x, "y": y, "w": 1, "h": 1}, "anchor": {"x": 0, "y": 0}}
            pv = PIV[h]; return {"atlas": pk, "rect": {"x": x, "y": y, "w": w, "h": hh}, "anchor": {"x": round(pv[0] / w, 6), "y": round(pv[1] / hh, 6)}}
        for k in g:
            s = S[k]
            if k in BODY: rekey_meta(s, A[s["atlas"]]["columns"])
            s["atlas"] = pk; s["anchor"] = {"x": 0.5, "y": 1.0}
            for name, an in s["animations"].items():
                an["dirFrames"] = [df(h) for h in ENT[k][name]]
    # old pages no sprite references any more -> drop (entry + files)
    refs = {s["atlas"] for s in m["sprites"]} | {d["atlas"] for s in m["sprites"] for an in s["animations"].values() for d in an.get("dirFrames", [])}
    newkeys = {a["key"] for a in newA}; drop = sorted(a for a in old_used if a not in refs and a not in newkeys)
    txt = json.dumps({k: v for k, v in m.items() if k not in ("atlases", "sprites")})
    for a in drop: assert f'"{a}"' not in txt, f"{a} referenced outside sprites"
    i = min([j for j, a in enumerate(m["atlases"]) if a["key"] in set(drop) | newkeys] or [len(m["atlases"])])
    rest = [a for a in m["atlases"] if a["key"] not in set(drop) | newkeys]; m["atlases"] = rest[:i] + newA + rest[i:]
    for a in drop:
        if a in newkeys: continue
        for p in glob.glob(os.path.join(D, "atlases", a + ".*")) + glob.glob(os.path.join(D, "atlases", a + "@2x.*")): os.remove(p)
    for a in newkeys:   # a reused key (body_<bt>) that no longer ships a mask variant: drop the stale file
        if a in old_used and not any(CROP[h][3] is not None for pk, g, (Wd, H, pos) in plan if pk == a for h in pos if h != "blank"):
            for p in glob.glob(os.path.join(D, "atlases", a + ".tintmask@2x.*")): os.remove(p)
    print("dropped pages:", len(drop), "kept (still used by unselected sprites):", sorted(a for a in old_used if a in refs and a not in newkeys))
    json.dump(m, open(MP, "w"), indent=1); open(MP, "a").write("\n")

def rekey_meta(s, cols):
    """Index-keyed frameMeta -> anim-level "df:<i>" (AssetRegistry.dirFrameMeta with the legacy arithmetic frame: sprite
    meta, then anim meta wins per anchor name). Must run before the anims get their new dirFrames."""
    sm = s.pop("frameMeta", {}) or {}
    for name, an in s["animations"].items():
        am = an.pop("frameMeta", {}) or {}; n = an.get("directions", 1); st = an.get("dirStride", cols) if n > 1 else 0
        assert all(str(k).lstrip("-").isdigit() for k in list(sm) + list(am)), (s["key"], name)
        out = {}
        for i, f0 in enumerate(an["frames"]):
            for d in range(n):
                f = str(f0 + d * st); a, b = sm.get(f), am.get(f)
                if a is None and b is None: continue
                anc = {**((a or {}).get("anchors") or {}), **((b or {}).get("anchors") or {})}
                out[f"df:{i * n + d}"] = {"anchors": anc}
        if out: an["frameMeta"] = out

if __name__ == "__main__":
    a = sys.argv; sl = a[a.index("--slots") + 1].split(",") if "--slots" in a else None
    tg = a[a.index("--tight") + 1].split(",") if "--tight" in a else ()
    main(a[1], sl, "--dry" in a, tg, "--bodies" in a)
