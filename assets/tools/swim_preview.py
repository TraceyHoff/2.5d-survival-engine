#!/usr/bin/env python3
"""Preview sheet for ADR-107 swim/punch: rows = sprites (players, paper-doll outfits, zombies, animals, critters),
columns = facings; each frame resolved from the manifests (dirFrames honoured), 3x nearest. Usage: swim_preview.py ENGINE OUT.png"""
import sys, os, json
from PIL import Image, ImageDraw
import importlib.util as _iu, os as _os  # ADR-138: manifest may be a v2 shard index
_spec = _iu.spec_from_file_location("cz_manifest", _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "../../packages/assets/scripts/cz_manifest.py"))
czm = _iu.module_from_spec(_spec); _spec.loader.exec_module(czm)
ENG, OUT = sys.argv[1], sys.argv[2]; P = os.path.join(ENG, "packages/assets/pack")
def man(rel):
    m = czm.load(os.path.join(P, rel)); base = os.path.dirname(os.path.join(P, rel)); return m, {a["key"]: a for a in m["atlases"]}, {s["key"]: s for s in m["sprites"]}, base
MM, MA, MS, MB = man("manifest.json"); CM, CA, CS, CB = man("customization/manifest.customization.json")
cache = {}
def img(base, rel):
    k = os.path.join(base, rel)
    if k not in cache: cache[k] = Image.open(k).convert("RGBA")
    return cache[k]
def frame(key, anim, d, i):
    A, S, base = (MA, MS, MB) if key in MS else (CA, CS, CB); s = S[key]; an = s["animations"][anim]; nd = an["directions"]
    dd = d * nd // 8; i %= len(an["frames"])
    if an.get("dirFrames"):
        r = an["dirFrames"][i * nd + dd]; a = A[r["atlas"]]; g = r["frame"]; anc = r["anchor"]
    else:
        a = A[s["atlas"]]; g = an["frames"][i] + dd * an.get("dirStride", a["columns"]); anc = s["anchor"]
    fw, fh, c = a["frameW"], a["frameH"], a["columns"]; x, y = (g % c) * fw, (g // c) * fh
    im = img(base, a["image"]).crop((x, y, x + fw, y + fh))
    tm = (a.get("masks") or {}).get("tintmask")
    if isinstance(tm, str) and key in TINT:   # preview tint: rgb *= lerp(1, colour, mask R|G)
        import numpy as np
        mk = np.asarray(img(base, tm).crop((x, y, x + fw, y + fh)))[..., :2].astype(np.float32).max(-1)[..., None] / 255
        ar = np.asarray(im).astype(np.float32); ar[..., :3] *= (1 - mk) + mk * np.array(TINT[key], np.float32) / 255
        im = Image.fromarray(ar.clip(0, 255).astype(np.uint8))
    return im, (anc["x"] * fw, anc["y"] * fh)
W = {w["key"]: w for w in CM["wearables"]}
def outfit(bt, keys): return ["body_" + bt] + [W[k]["bodies"][bt]["sprite"] for k in sorted(keys, key=lambda k: W[k]["layer"]) if bt in W[k].get("bodies", {})]
def first(slot): return next(w["key"] for w in CM["wearables"] if w["slot"] == slot and "male" in w.get("bodies", {}))
slots = [s for s in ("shoes", "bottom", "top", "hair") if any(w["slot"] == s for w in CM["wearables"])]
fit = [first(s) for s in slots]
COL = {"shoes": (90, 120, 230), "bottom": (80, 110, 200), "top": (240, 120, 90), "hair": (150, 90, 50)}
TINT = {"body_male": (255, 205, 170), "body_female": (220, 160, 120)}
for k in fit:
    for b in W[k]["bodies"].values(): TINT[b["sprite"]] = COL[W[k]["slot"]]
ROWS = [("player", "swim"), ("player", "punch"), ("player_b", "swim"), ("player_c", "punch"),
        (outfit("male", fit), "swim"), (outfit("male", fit), "punch"), (outfit("female", fit), "swim"), (outfit("female", fit), "punch"),
        ("zombie_walker", "swim"), ("zombie_brute", "swim"), ("zombie_runner", "swim"), ("zombie_mummy", "swim"), ("zombie_pumpkin", "swim"),
        ("animal_rabbit", "swim"), ("animal_chicken", "swim"), ("animal_boar", "swim"), ("animal_wolf", "swim"), ("animal_deer", "swim"),
        ("critter_bunny", "swim"), ("critter_frog", "swim")]
CW, CH, Z = 80, 84, 2; FR = [0, 2]
sheet = Image.new("RGBA", (180 + 8 * len(FR) * CW * Z // 2, len(ROWS) * CH), (120, 178, 206, 255)); dr = ImageDraw.Draw(sheet)
for r, (keys, anim) in enumerate(ROWS):
    keys = keys if isinstance(keys, list) else [keys]
    dr.text((6, r * CH + CH // 2 - 6), f"{keys[0] if len(keys) == 1 else keys[0] + ' +' + str(len(keys) - 1)}: {anim}", fill=(20, 30, 40, 255))
    for d in range(8):
        for j, fi in enumerate(FR):
            cv = Image.new("RGBA", (CW // 2 * 2, CH), (0, 0, 0, 0)); px, py = cv.width / 2, CH - 8
            for k in keys:
                im, (ax, ay) = frame(k, anim, d, fi); im = im.resize((round(im.width * Z / 2 * 1.0), round(im.height * Z / 2)), Image.NEAREST) if Z != 2 else im
                cv.alpha_composite(im, (int(round(px - ax)), int(round(py - ay))))
            cv = cv.resize((cv.width * Z // 2 * 2 // 2 * 1, cv.height), Image.NEAREST) if False else cv
            sheet.alpha_composite(cv.resize((cv.width, cv.height)), (180 + (d * len(FR) + j) * CW, r * CH))
    dr.line([(0, r * CH + CH - 8), (sheet.width, r * CH + CH - 8)], fill=(90, 150, 185, 255))
os.makedirs(os.path.dirname(OUT), exist_ok=True); sheet = sheet.resize((sheet.width * 2, sheet.height * 2), Image.NEAREST); sheet.save(OUT); print(OUT, sheet.size, fit)
