"""ADR-114 wear page packer (deterministic). Packs per-sprite frame blocks onto pages so that one page only holds ONE
wearable (both bodies / hatHair / sleeves variants), or one shared component (e.g. identical sleeves used by several tops),
never unrelated items: an outfit only makes resident the pages of the items it wears.
  * identical frames are stored once (exact RGBA@1x + tintmask + RGBA@2x match), incl. blank frames and frames shared
    between bodies / variants / wearables;
  * a page's cell = union alpha bbox of its sprites (+1px border, feet pivot inside) on the FWxFH rig frame, so every
    sprite on a page shares one anchor;
  * partition per unit: fewest pages first, then least padded area, over [all] / by variant / by body / body x variant;
  * page side <= MAXP (padded to multiples of 8), grid columns chosen to minimise padded area.
Frames are full rig frames: (rgba1 FHxFWx4, tintmask1 FHxFWx3, rgba2 2FHx2FWx4)."""
import hashlib, re
import numpy as np
from PIL import Image
from rig import FW, FH, FEET
MAXP = 1020; MAXP8 = MAXP // 8 * 8
def r8(v): return -(-v // 8) * 8
def fhash(fr): return hashlib.sha1(fr[0].tobytes() + fr[1].tobytes() + fr[2].tobytes()).hexdigest()
def body_of(k): return "female" if "_female" in k else "male" if "_male" in k else ""
def variant_of(k): return "hathair" if k.endswith("_hathair") else "sleeves" if k.endswith("_sleeves") else "base"

def bbox(frames):
    al = np.zeros((FH, FW), bool)
    for fr in frames: al |= fr[0][..., 3] > 0
    if al.any():
        ys, xs = np.nonzero(al); x0, y0, x1, y1 = int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1
    else: x0, y0, x1, y1 = FW // 2, FEET, FW // 2, FEET
    x0 = min(x0, FW // 2 - 1) - 1; y0 = min(y0, FEET - 1) - 1; x1 = max(x1, FW // 2 + 1) + 1; y1 = max(y1, FEET + 1) + 1
    return max(0, x0), max(0, y0), min(FW, x1), min(FH, y1)

def rigid_ranges(sprite):
    """cell ranges of a block that anims address arithmetically (frames[i] + dir*dirStride): they must stay contiguous.
    Cells only reached through dirFrames (explicit per frame+facing) are free and deduplicated one by one."""
    rs = []
    for an in sprite["animations"].values():
        if "dirFrames" in an: continue
        lo = min(an["frames"]); hi = max(an["frames"]) + (an.get("directions", 1) - 1) * an["dirStride"] + 1; rs.append([lo, hi])
    rs.sort(); out = []
    for lo, hi in rs:
        if out and lo <= out[-1][1]: out[-1][1] = max(out[-1][1], hi)
        else: out.append([lo, hi])
    return out

def layout(F, keys):
    """F[key] = (block frames, rigid ranges). -> (cells, {key: [cell per block frame]}, bbox, C, R, W, H) or None.
    Rigid ranges are stored contiguously (shared whole when identical); every other frame is stored once per page."""
    cells, idx, seg, remap = [], {}, {}, {}
    for k in keys:            # rigid segments first
        frs, rr = F[k]; rm = [None] * len(frs)
        for lo, hi in rr:
            hs = tuple(fhash(f) for f in frs[lo:hi])
            if hs not in seg:
                seg[hs] = len(cells); cells += frs[lo:hi]
                for j, h in enumerate(hs): idx.setdefault(h, seg[hs] + j)
            for j in range(hi - lo): rm[lo + j] = seg[hs] + j
        remap[k] = rm
    for k in keys:
        frs, _ = F[k]; rm = remap[k]
        for j, fr in enumerate(frs):
            if rm[j] is not None: continue
            h = fhash(fr)
            if h not in idx: idx[h] = len(cells); cells.append(fr)
            rm[j] = idx[h]
    x0, y0, x1, y1 = bbox(cells); cw, ch = x1 - x0, y1 - y0; N = len(cells); best = None
    for C in range(1, MAXP8 // cw + 1):
        Rw = -(-N // C); W, H = r8(C * cw), r8(Rw * ch)
        if H > MAXP8: continue
        if best is None or W * H <= best[0]: best = (W * H, C, Rw, W, H)
    if best is None: return None
    return cells, remap, (x0, y0, cw, ch), best[1], best[2], best[3], best[4]

def partitions(keys):
    ks = sorted(keys); yield [ks]
    for f in (variant_of, body_of, lambda k: (body_of(k), variant_of(k))):
        g = {}
        for k in ks: g.setdefault(f(k), []).append(k)
        if len(g) > 1: yield [g[x] for x in sorted(g)]

def plan(F, units):
    """units: [(name, [sprite keys])] -> [(page name, layout)]"""
    out = []
    for name, keys in units:
        best = None
        for part in partitions(keys):
            L = [layout(F, g) for g in part]
            if any(l is None for l in L): continue
            score = (len(L), sum(l[5] * l[6] for l in L))
            if best is None or score < best[0]: best = (score, part, L)
        if best is None:   # last resort: one sprite per page
            part = [[k] for k in sorted(keys)]; L = [layout(F, g) for g in part]; assert all(L), name; best = (None, part, L)
        _, part, L = best
        for g, l in zip(part, L):
            bs = {body_of(k) for k in g}; vs = {variant_of(k) for k in g}
            lab = ([next(iter(bs))] if len(bs) == 1 and len(part) > 1 else []) + ([next(iter(vs))] if len(vs) == 1 and len(part) > 1 and vs != {"base"} and not name.endswith("_shared") else [])
            suf = "".join("_" + x for x in lab if x)
            out.append((name + suf, l))
    return out

def write(D, pk, l):
    """save page PNGs, return (atlas entry, {key: (remap, anchor)})"""
    cells, remap, (x0, y0, cw, ch), C, Rw, W, H = l
    o1 = np.zeros((H, W, 4), np.uint8); ot = np.zeros((H, W, 3), np.uint8); o2 = np.zeros((H * 2, W * 2, 4), np.uint8)
    for c, fr in enumerate(cells):
        X, Y = (c % C) * cw, (c // C) * ch
        o1[Y:Y + ch, X:X + cw] = fr[0][y0:y0 + ch, x0:x0 + cw]; ot[Y:Y + ch, X:X + cw] = fr[1][y0:y0 + ch, x0:x0 + cw]
        o2[Y * 2:(Y + ch) * 2, X * 2:(X + cw) * 2] = fr[2][y0 * 2:(y0 + ch) * 2, x0 * 2:(x0 + cw) * 2]
    import os
    for arr, p, mode in ((o1, f"atlases/{pk}.png", "RGBA"), (o2, f"atlases/{pk}@2x.png", "RGBA"), (ot, f"atlases/{pk}.tintmask.png", "RGB")):
        Image.fromarray(arr, mode).save(os.path.join(D, p), optimize=True)
    anc = {"x": round((FW / 2 - x0) / cw, 6), "y": round((FEET - y0) / ch, 6)}
    A = {"key": pk, "image": f"atlases/{pk}.png", "frameW": cw, "frameH": ch, "columns": C, "rows": Rw,
         "pages": [{"scale": 2, "image": f"atlases/{pk}@2x.png"}], "masks": {"tintmask": f"atlases/{pk}.tintmask.png"}}
    return A, {k: (rm, anc) for k, rm in remap.items()}, len(cells)

def apply(sprite, pk, rm, anc):
    """rewrite a sprite entry whose anim frames / dirFrames index its block (0..n-1) onto page pk"""
    sprite["atlas"] = pk; sprite["anchor"] = anc
    for an in sprite["animations"].values():
        if "dirFrames" in an:
            an["dirFrames"] = [{"atlas": pk, "frame": rm[d["frame"]], "anchor": anc} for d in an["dirFrames"]]
        else:
            for f in an["frames"]:
                for d in range(an.get("directions", 1)): assert rm[f + d * an["dirStride"]] == rm[f] + d * an["dirStride"], (sprite["key"], f, d)
            an["frames"] = [rm[f] for f in an["frames"]]

def units_for(wearables, F):
    """one unit per wearable; sprites whose whole frame set equals another wearable's (e.g. identical sleeves) form a
    shared unit named after them instead (loaded by every wearable using it, holding nothing else)."""
    def walk(o, acc):
        if isinstance(o, dict):
            for k, v in o.items():
                if k == "sprite" and isinstance(v, str): acc.append(v)
                else: walk(v, acc)
        elif isinstance(o, list):
            for x in o: walk(x, acc)
        return acc
    W = {w["key"]: [k for k in walk(w, []) if k in F] for w in wearables}
    sig = {k: hashlib.sha1("".join(fhash(f) for f in F[k][0]).encode()).hexdigest() for ks in W.values() for k in ks}
    by = {}
    for wk in sorted(W):
        for k in W[wk]: by.setdefault(sig[k], []).append((wk, k))
    shared = {}
    for s, lst in by.items():
        ws = sorted({w for w, _ in lst})
        if len(ws) > 1:
            for _, k in lst: shared[k] = (tuple(ws), variant_of(k))
    units = {}
    for wk in sorted(W):
        own = [k for k in W[wk] if k not in shared]
        if own: units[wk] = own
    for k, (ws, var) in sorted(shared.items()):
        units.setdefault(f"{ws[0]}_{var}_shared", []).append(k)
    return sorted(units.items())
