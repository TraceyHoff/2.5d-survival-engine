#!/usr/bin/env python3
"""ADR-107 main-pack merge (run after build_all.py / merge_animals.py): adds `swim` to players, zombies, animals and critters
and `punch` to players, IN PLACE in ENGINE/packages/assets/pack (existing pixels untouched; new rows appended).
 - players (characters, _b, _c): chars.py swim (6 f) + punch (4 f), 4 new rows; punch hand anchors -> hands.json/<atlas>.json
 - zombies (all 5 kinds): chars.py swim (6 f, arms flailing forward), 3 new rows (+ emissive + sheen rows)
 - animals_small (rabbit, chicken): swim derived from the walk frames (1x + @2x), 3 new rows
 - animals_medium/large: SKIPPED. No room under 2048 @2x, and non-vehicle dirFrames would mark the sheet legacy in the
   renderer (legacyDirFrameAtlases). The old dirFrames path is kept behind MEDIUM_LARGE = False.
 - critters (4 facings): swim derived from walk, 8 new rows
Swim frames are self-clipped (tools/swimfx.py): sunk so the waterline sits just above the pivot, cleared below, ripple ring.
Usage: python3 swim_merge_main.py ENGINE_DIR"""
import sys, os, json, subprocess
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from PIL import Image
from concurrent.futures import ProcessPoolExecutor
import chars, swimfx
ENG = sys.argv[1]; P = os.path.join(ENG, "packages/assets/pack"); MP = os.path.join(P, "manifest.json")
SHEEN = os.path.join(ENG, "assets/survival_fx/tools/make_sheen_mask.py")
SWIM_N, PUNCH_N = 6, 4

def ld(p): return np.asarray(Image.open(os.path.join(P, p)).convert("RGBA")).copy()
def sv(a, p): Image.fromarray(a, "RGBA").save(os.path.join(P, p), optimize=True)
def grow(a, rows, fh):
    o = np.zeros((rows * fh, a.shape[1], 4), np.uint8); o[:a.shape[0]] = a; return o
def cell(a, g, cols, fw, fh, s=1):
    X, Y = (g % cols) * fw * s, (g // cols) * fh * s; return a[Y:Y + fh * s, X:X + fw * s]

def char_job(args):
    spec, d, anim, fi, n, zombie, fw, fh, feet, scale = args
    im, meta = chars.render_frame_meta(spec, d, anim, fi, n, zombie, fw, fh, feet, scale)
    a = np.asarray(im.convert("RGBA")).copy(); e = np.asarray(meta["emissive"].convert("RGBA")).copy() if meta["emissive"] else np.zeros_like(a)
    hand = meta["hand"]
    if anim == "swim":
        bk = spec.get("body", 1.0); wz = chars.SWIM_Z * (0.9 + 0.1 * bk) * scale; WL = feet - 2; sh = int(round(WL - (feet - wz)))
        a = swimfx.sink(a, sh, WL); e = swimfx.sink(e, sh, WL)
        b, f = swimfx.ripple(fw, fh, fw / 2, WL, 12.5 * scale * min(1.3, bk), 3.6 * scale, fi, 1); a = swimfx.apply_base(a, b, f); hand = None
    a[:2] = 0; a[-2:] = 0; a[:, :2] = 0; a[:, -2:] = 0; e[a[..., 3] == 0] = 0
    return a, e, hand

def sheen_rows(img_rel, y0):
    """run make_sheen_mask on the (already extended) atlas into a temp dir; paste rows >= y0 into the existing sheen."""
    tmp = "/tmp/swimsheen"; os.makedirs(tmp, exist_ok=True)
    subprocess.check_call([sys.executable, SHEEN, os.path.join(P, img_rel), "--out-dir", tmp, "--scale", "1"], stdout=subprocess.DEVNULL)
    new = np.asarray(Image.open(os.path.join(tmp, os.path.basename(img_rel)[:-4] + "_sheen.png")).convert("RGBA"))
    return new

def json_add(rel, names_cells, fw, fh, cols, rows, pivot, s=1, hands=None):
    p = os.path.join(P, rel)
    if not os.path.exists(p): return
    J = json.load(open(p)); F = J["frames"]
    for name, g in names_cells:
        e = {"frame": {"x": (g % cols) * fw * s, "y": (g // cols) * fh * s, "w": fw * s, "h": fh * s}, "rotated": False, "trimmed": False,
             "spriteSourceSize": {"x": 0, "y": 0, "w": fw * s, "h": fh * s}, "sourceSize": {"w": fw * s, "h": fh * s}, "pivot": pivot, "index": g}
        if hands and hands.get(g): e["hand"] = hands[g]
        F[name] = e
    J["meta"]["size"] = {"w": cols * fw * s, "h": rows * fh * s}
    if "grid" in J["meta"]: J["meta"]["grid"]["rows"] = rows
    json.dump(J, open(p, "w"), indent=1)

def derive(L1, L2, frames_by_dir, fw, fh, ax, ay):
    """animals: swim frames from walk frames. frames_by_dir: [[g..] per dir]. -> list (dir-major) of (c1, c2)."""
    feet = ay * fh; tops, widths = [], []
    for fs in frames_by_dir:
        for g in fs:
            al = cell(L1, g, L1.shape[1] // fw, fw, fh)[..., 3]; ys, xs = np.nonzero(al > 20)
            if len(ys): tops.append(ys.min())
    H = feet - min(tops); c = int(round(0.30 * H)); WL = int(round(feet)) - 1; sh = WL - int(round(feet - c))
    out = []
    for fs in frames_by_dir:
        for i, g in enumerate(fs):
            c1 = swimfx.sink(cell(L1, g, L1.shape[1] // fw, fw, fh).copy(), sh, WL)
            ys, xs = np.nonzero(c1[..., 3] > 40); w = (xs.max() - xs.min() + 1) if len(xs) else fw / 3
            rx = max(4.0, min(fw / 2 - 2.5, w / 2 + 1.5)); ry = max(1.6, rx * 0.3)
            b, f = swimfx.ripple(fw, fh, ax * fw, WL, rx, ry, i, 1); c1 = swimfx.apply_base(c1, b, f)
            c2 = None
            if L2 is not None:
                c2 = swimfx.sink(cell(L2, g, L2.shape[1] // (fw * 2), fw, fh, 2).copy(), sh * 2, WL * 2)
                b, f = swimfx.ripple(fw, fh, ax * fw, WL, rx, ry, i, 2); c2 = swimfx.apply_base(c2, b, f)
            for arr, p in ((c1, 1), (c2, 2)):
                if arr is not None: arr[:p] = 0; arr[-p:] = 0; arr[:, :p] = 0; arr[:, -p:] = 0
            out.append((c1, c2))
    return out

if __name__ == "__main__":
    m = json.load(open(MP)); A = {a["key"]: a for a in m["atlases"]}; S = {s["key"]: s for s in m["sprites"]}
    assert not any("swim" in s["animations"] for s in m["sprites"]), "swim already present"
    report = {}
    with ProcessPoolExecutor(8) as pool:
        # ---------------- players + zombies
        groups = [(k, False, chars.PLAYERS[k], 48, 64, 59, 1.0) for k in ("player", "player_b", "player_c")]
        groups += [(k, True, chars.ZOMBIES[k], chars.ZOMBIES[k]["frame"][0], chars.ZOMBIES[k]["frame"][1], chars.ZOMBIES[k]["feet"], chars.ZOMBIES[k]["scale"])
                   for k in ("zombie_walker", "zombie_brute", "zombie_runner", "zombie_mummy", "zombie_pumpkin")]
        for key, zombie, spec, fw, fh, feet, scale in groups:
            s = S[key]; a = A[s["atlas"]]; cols, rows0 = a["columns"], a["rows"]; assert (a["frameW"], a["frameH"]) == (fw, fh)
            anims = [("swim", SWIM_N)] + ([] if zombie else [("punch", PUNCH_N)])
            jobs, names = [], []
            for an, n in anims:
                for d in range(8):
                    for i in range(n): jobs.append((spec, d, an, i, n, zombie, fw, fh, feet, scale)); names.append(f"{an}_d{d}_{i}")
            res = list(pool.map(char_job, jobs, chunksize=2))
            n0 = rows0 * cols; rows = rows0 + -(-len(res) // cols)
            L1 = grow(ld(a["image"]), rows, fh); E = grow(ld(a["image"][:-4] + "_emissive.png"), rows, fh) if zombie else None
            hands = {}
            for j, (c1, e, h) in enumerate(res):
                g = n0 + j; cell(L1, g, cols, fw, fh)[:] = c1
                if E is not None: cell(E, g, cols, fw, fh)[:] = e
                if h: hands[g] = h
            sv(L1, a["image"])
            if E is not None: sv(E, a["image"][:-4] + "_emissive.png")
            sh_new = sheen_rows(a["image"], rows0 * fh); SH = grow(ld(a["masks"]["sheen"]), rows, fh); SH[rows0 * fh:] = sh_new[rows0 * fh:]; sv(SH, a["masks"]["sheen"])
            a["rows"] = rows; off = n0
            for an, n in anims:
                s["animations"][an] = {"frames": list(range(off, off + n)), "fps": 6 if an == "swim" else 12, "directions": 8, "dirStride": n, **({} if an == "swim" else {"loop": False})}; off += 8 * n
            hp = os.path.join(P, "atlases", s["atlas"] + ".hands.json")
            if not zombie and os.path.exists(hp):
                H = json.load(open(hp)); H["hands"].update({str(g): h for g, h in hands.items()}); json.dump(H, open(hp, "w"))
            json_add(f"atlases/{s['atlas']}.json", [(nm, n0 + j) for j, nm in enumerate(names)], fw, fh, cols, rows, s["anchor"], hands=hands)
            report[key] = {an: f"{n} frames x 8 dirs" for an, n in anims}
            print(key, "rows", rows0, "->", rows, flush=True)
    # ---------------- animals_small (append), medium/large (new atlases + dirFrames)
    def walk_dirs(s, ndirs):
        w = s["animations"]["walk"]; st = w.get("dirStride", A[s["atlas"]]["columns"]); return [[f + d * st for f in w["frames"]] for d in range(ndirs)]
    sm = A["animals_small"]; fw = fh = 32; cols = sm["columns"]; rows0 = sm["rows"]
    L1 = ld(sm["image"]); L2 = ld(sm["pages"][0]["image"]); keys = ["animal_rabbit", "animal_chicken"]
    der = {k: derive(L1, L2, walk_dirs(S[k], 8), fw, fh, S[k]["anchor"]["x"], S[k]["anchor"]["y"]) for k in keys}
    tot = sum(len(v) for v in der.values()); rows = rows0 + -(-tot // cols); n0 = rows0 * cols
    L1 = grow(L1, rows, fh); L2 = grow(L2, rows, fh * 2); g = n0; nm1 = []
    for k in keys:
        S[k]["animations"]["swim"] = {"frames": list(range(g, g + 6)), "fps": 6, "directions": 8, "dirStride": 6}
        for j, (c1, c2) in enumerate(der[k]): cell(L1, g, cols, fw, fh)[:] = c1; cell(L2, g, cols, fw, fh, 2)[:] = c2; nm1.append((f"{k}_swim_d{j // 6}_{j % 6}", g)); g += 1
        report[k] = {"swim": "6 frames x 8 dirs (derived from walk)"}
    sv(L1, sm["image"]); sv(L2, sm["pages"][0]["image"]); sm["rows"] = rows
    sh_new = sheen_rows(sm["image"], rows0 * fh); SH = grow(ld(sm["masks"]["sheen"]), rows, fh); SH[rows0 * fh:] = sh_new[rows0 * fh:]; sv(SH, sm["masks"]["sheen"])
    json_add("atlases/animals_small.json", nm1, fw, fh, cols, rows, S["animal_rabbit"]["anchor"]); json_add("atlases/animals_small@2x.json", nm1, fw, fh, cols, rows, S["animal_rabbit"]["anchor"], s=2)
    MEDIUM_LARGE = False
    for src, keys, fw, cols in () if not MEDIUM_LARGE else (("animals_medium", ["animal_boar", "animal_wolf"], 48, 16), ("animals_large", ["animal_deer"], 64, 12)):
        a = A[src]; fh = fw; L1 = ld(a["image"]); L2 = ld(a["pages"][0]["image"])
        der = {k: derive(L1, L2, walk_dirs(S[k], 8), fw, fh, S[k]["anchor"]["x"], S[k]["anchor"]["y"]) for k in keys}
        tot = sum(len(v) for v in der.values()); rows = -(-tot // cols); nk = src + "_swim"
        O1 = np.zeros((rows * fh, cols * fw, 4), np.uint8); O2 = np.zeros((rows * fh * 2, cols * fw * 2, 4), np.uint8); g = 0
        for k in keys:
            s = S[k]; w = s["animations"]["walk"]; df = [None] * (6 * 8)
            for j, (c1, c2) in enumerate(der[k]):
                cell(O1, g, cols, fw, fh)[:] = c1; cell(O2, g, cols, fw, fh, 2)[:] = c2; d, i = j // 6, j % 6
                df[i * 8 + d] = {"atlas": nk, "frame": g, "anchor": dict(s["anchor"])}; g += 1
            s["animations"]["swim"] = {"frames": list(w["frames"]), "fps": 6, "directions": 8, "dirStride": w.get("dirStride", a["columns"]), "dirFrames": df}
            report[k] = {"swim": f"6 frames x 8 dirs (derived from walk, atlas {nk} via dirFrames)"}
        sv(O1, f"atlases/{nk}.png"); sv(O2, f"atlases/{nk}@2x.png")
        tmp = "/tmp/swimsheen"; os.makedirs(tmp, exist_ok=True)
        subprocess.check_call([sys.executable, SHEEN, os.path.join(P, f"atlases/{nk}.png"), "--out-dir", os.path.join(P, "atlases"), "--scale", "1"], stdout=subprocess.DEVNULL)
        ent = {"key": nk, "image": f"atlases/{nk}.png", "frameW": fw, "frameH": fh, "columns": cols, "rows": rows,
               "pages": [{"scale": 2, "image": f"atlases/{nk}@2x.png"}], "masks": {"sheen": f"atlases/{nk}_sheen.png"}}
        m["atlases"].insert(m["atlases"].index(a) + 1, ent)
        print(nk, cols * fw, "x", rows * fh, "@2x", cols * fw * 2, "x", rows * fh * 2)
    # ---------------- critters (4 facings, 1x only)
    cr = A["critters"]; fw = fh = 32; cols = cr["columns"]; rows0 = cr["rows"]; L1 = ld(cr["image"])
    keys = [s["key"] for s in m["sprites"] if s["atlas"] == "critters"]
    der = {k: derive(L1, None, walk_dirs(S[k], 4), fw, fh, S[k]["anchor"]["x"], S[k]["anchor"]["y"]) for k in keys}
    nw = {k: len(S[k]["animations"]["walk"]["frames"]) for k in keys}
    tot = sum(len(v) for v in der.values()); rows = rows0 + -(-tot // cols); n0 = rows0 * cols; L1 = grow(L1, rows, fh); g = n0; nm1 = []
    for k in keys:
        n = nw[k]; S[k]["animations"]["swim"] = {"frames": list(range(g, g + n)), "fps": 6, "directions": 4, "dirStride": n}
        for j, (c1, _) in enumerate(der[k]): cell(L1, g, cols, fw, fh)[:] = c1; nm1.append((f"{k}_swim_d{j // n}_{j % n}", g)); g += 1
        report[k] = {"swim": f"{n} frames x 4 dirs (derived from walk)"}
    sv(L1, cr["image"]); cr["rows"] = rows
    sh_new = sheen_rows(cr["image"], rows0 * fh); SH = grow(ld(cr["masks"]["sheen"]), rows, fh); SH[rows0 * fh:] = sh_new[rows0 * fh:]; sv(SH, cr["masks"]["sheen"])
    json_add("atlases/critters.json", nm1, fw, fh, cols, rows, S[keys[0]]["anchor"])
    raw = open(MP).read(); ind = 1 if raw.startswith("{\n ") and not raw.startswith("{\n  ") else 2
    json.dump(m, open(MP, "w"), indent=ind); open(MP, "a").write("\n")
    json.dump(report, open("/tmp/swim_main_report.json", "w"), indent=1); print(json.dumps(report, indent=1))
