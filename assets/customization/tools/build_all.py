#!/usr/bin/env python3
"""Deterministic build: python3 build_all.py [--jobs 6] [--only key,...] [--no-art]
Renders body + every wearable per body type into customization/atlases, writes hands.json, palettes and
manifest.fragment.json (engine manifest v1 + ADR-080 cosmetics sections). Same inputs -> identical bytes."""
import sys, os, json, argparse
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE); sys.path.append(os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "tools"))
from multiprocessing import Pool
import catalog
from rig import ANIMS, ANIM_START, NF, FW, FH, FEET, COLS, ROWS, rows_for, EXPR_EXTRA, EXPR_SLOTS
ROOT = os.path.dirname(HERE); OUT = os.path.join(ROOT, "atlases"); REL = "customization/atlases"
BODIES = ["male", "female"]

def jobs():
    J = [("body_" + bt, bt, "body", {}, False) for bt in BODIES]
    for key, slot, spec, kw in catalog.W:
        for bt in BODIES:
            if split(slot, spec):
                J.append((f"cz_{key}_{bt}", bt, slot, spec, False, "main"))
                J.append((f"cz_{key}_{bt}_sleeves", bt, slot, spec, False, "sleeves"))
            else: J.append((f"cz_{key}_{bt}", bt, slot, spec, False))
            if slot == "hair": J.append((f"cz_{key}_{bt}_hathair", bt, slot, spec, True))
    return J

def split(slot, spec): return slot == "top" and spec.get("sleeve", "short") != "none"

def run(j):
    from render import render_sheet
    return render_sheet(j[:5] + (OUT,) + j[5:])

def anims(slot=None):
    A = {n: {"frames": list(range(ANIM_START[n], ANIM_START[n] + c)), "fps": fps, "directions": 8, "dirStride": NF, "loop": loop} for n, c, fps, loop in ANIMS}
    if slot in EXPR_SLOTS:   # ADR-082 expressions (faceAnims)
        i, h = ANIM_START["idle"], ANIM_START["hit"]
        A["blink"] = {"frames": [i, i + 3, i], "fps": 10, "directions": 8, "dirStride": NF, "loop": False}
        A["hurt"] = {"frames": [h, h + 1], "fps": 8, "directions": 8, "dirStride": NF, "loop": False}
        for n in EXPR_EXTRA: A[n] = {"frames": [ANIM_START[n]], "fps": 1, "directions": 8, "dirStride": len(EXPR_EXTRA), "loop": True}
    return A
FACE_ANIMS = {"blink": "blink", "happy": "happy", "hurt": "hurt", "sleepy": "sleepy"}
SLEEVE_BY_DIR = [31, 31, 31, 31, 21, 21, 21, 31]   # [E,SE,S,SW,W,NW,N,NE]: above accessories except back views (capes/packs cover)
def nice(key): return " ".join(w.capitalize() for w in key.split("_")[1:])
def frame_meta(key):
    p = os.path.join(OUT, key + ".hands.json")
    if not os.path.exists(p): return None
    H = json.load(open(p))["hands"]
    return {f: {"anchors": {"handR": {"x": round(h["x"] - FW / 2, 2), "y": round(h["y"] - FEET, 2), "angle": h["angle"], "len": h["len"], "behind": h["behind"]}}}
            for f, h in sorted(H.items(), key=lambda t: int(t[0]))}

def fragment(J):
    A, S = [], []
    for j in J:
        key, bt, slot, spec, hat = j[:5]
        A.append({"key": key, "image": f"{REL}/{key}.png", "frameW": FW, "frameH": FH, "columns": COLS, "rows": rows_for(slot),
                  "pages": [{"scale": 2, "image": f"{REL}/{key}@2x.png"}], "masks": {"tintmask": f"{REL}/{key}.tintmask.png"}})
        S.append({"key": key, "category": "character", "atlas": key, "anchor": {"x": 0.5, "y": round(FEET / FH, 4)}, "animations": anims(slot)})
        if slot == "body":
            fm = frame_meta(key)
            if fm: S[-1]["frameMeta"] = fm
    A.append({"key": "cz_mirror", "image": "customization/mirror/mirror.png", "frameW": 128, "frameH": 128, "columns": 4, "rows": 5,
              "pages": [{"scale": 2, "image": "customization/mirror/mirror@2x.png"}], "masks": {"emissive": True}})
    S.append({"key": "mirror", "category": "building", "atlas": "cz_mirror", "anchor": {"x": 0.5, "y": 0.75},
              "animations": {"idle": {"frames": [16, 17, 18, 19], "fps": 5, "loop": True}},
              "building": {"piece": "mirror", "footprint": {"w": 1, "h": 1}, "layer": 2, "frames": [[r * 4 + d for d in range(4)] for r in range(4)]},
              "rotationArt": "unique4"})
    W = []
    for key, slot, spec, kw in catalog.W:
        bodies = {}
        for bt in BODIES:
            b = {"sprite": f"cz_{key}_{bt}"}
            if slot == "hair": b["hatHair"] = {"sprite": f"cz_{key}_{bt}_hathair"}
            bodies[bt] = b
        w = {"key": key, "slot": slot, "displayName": STR[f"cosmetic.{key}"], "locKey": f"cosmetic.{key}", "bodies": bodies, "layer": kw.get("layer", catalog.LAYER[slot]), **({"layerByDir": kw["layerByDir"]} if "layerByDir" in kw else {}), "z": 0,
             "tintChannels": kw.get("tint", 0), "hidesSlots": kw.get("hides", []), "hatHair": bool(slot == "hat" and kw.get("hatHairFlag", False)),
             "unlockTags": [t for t, ks in UNLOCKS.items() if key in ks], "outline": "none" if slot in EXPR_SLOTS else "body"}
        if slot in EXPR_SLOTS: w["faceAnims"] = FACE_ANIMS
        if split(slot, spec):
            w["layers"] = [{"name": "main", "layer": w["layer"], "bodies": {bt: {"sprite": f"cz_{key}_{bt}"} for bt in BODIES}},
                           {"name": "sleeves_front", "layer": SLEEVE_BY_DIR[0], "layerByDir": SLEEVE_BY_DIR, "minor": True,
                            "bodies": {bt: {"sprite": f"cz_{key}_{bt}_sleeves"} for bt in BODIES}}]
            del w["bodies"]; del w["layer"]
        W.append(w)
    pal = lambda L: [{"key": k, "color": c} for k, c in L]
    return {"version": 1, "name": "customization", "atlases": A, "sprites": S,
            "bodyTypes": {bt: {"sprite": "body_" + bt, "anim": "idle", "displayName": STR[f"body.{bt}"], "locKey": f"body.{bt}",
                               "cosmeticDefaults": DEFAULTS[bt]} for bt in BODIES},
            "requiredSlots": ["face", "eyes"], "faceAnims": FACE_ANIMS, "tintNeutral": 0.78,
            "skinTones": pal(catalog.SKIN), "hairColors": pal(catalog.HAIR), "clothingColors": pal(catalog.CLOTH), "wearables": W}

# tags from engine packages/gameplay/data/cosmetics.json (DESIGN §10); untagged = free for everyone
UNLOCKS = {"founder": {"hat_top_hat", "acc_cape", "eyes_sparkle"}, "chef": {"hat_chef", "top_pinafore"},
           "smith": {"top_vest", "shoes_hiking_boots"}, "merchant": {"acc_satchel", "hat_wizard", "hat_mushroom_cap", "shoes_mushroom_shoes"},
           "raider": {"hat_viking", "acc_eyepatch", "bottom_kilt"}, "gear": set(catalog.GEAR)}
STARTER = {"hair_buzz", "hair_bob", "hair_ponytail", "hair_long", "top_tee", "top_tank", "bottom_shorts", "bottom_jeans", "bottom_skirt",
           "shoes_sneakers", "shoes_sandals", "face_smile", "face_freckles", "face_stubble", "eyes_round", "eyes_happy", "eyes_lashes", "hat_straw"}

DEFAULTS = {"male": {"hair": "hair_buzz", "face": "face_smile", "eyes": "eyes_round", "top": "top_tee", "bottom": "bottom_jeans", "shoes": "shoes_sneakers"},
            "female": {"hair": "hair_bob", "face": "face_smile", "eyes": "eyes_lashes", "top": "top_tee", "bottom": "bottom_skirt", "shoes": "shoes_sandals"}}
NAME_FIX = {"hat_top_hat": "Top Hat", "acc_eyepatch": "Eyepatch", "face_smile": "Smile"}
STR = {"body.male": "Build A", "body.female": "Build B"}
for _k, _s, _sp, _kw in catalog.W: STR[f"cosmetic.{_k}"] = NAME_FIX.get(_k, nice(_k))

if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("--jobs", type=int, default=6); ap.add_argument("--only", default=""); ap.add_argument("--no-art", action="store_true")
    a = ap.parse_args(); os.makedirs(OUT, exist_ok=True); J = jobs()
    if not a.no_art:
        todo = [j for j in J if not a.only or any(o in j[0] for o in a.only.split(","))]
        with Pool(a.jobs, maxtasksperchild=4) as p:
            for i, k in enumerate(p.imap_unordered(run, todo)): print(f"[{i + 1}/{len(todo)}] {k}", flush=True)
    json.dump(fragment(J), open(os.path.join(ROOT, "manifest.fragment.json"), "w"), indent=1)
    json.dump({"skinTones": catalog.SKIN, "hairColors": catalog.HAIR, "clothingColors": catalog.CLOTH}, open(os.path.join(ROOT, "palettes.json"), "w"), indent=1)
    os.makedirs(os.path.join(ROOT, "strings"), exist_ok=True)
    json.dump(dict(sorted(STR.items())), open(os.path.join(ROOT, "strings", "en.json"), "w"), indent=1)
    print("fragment:", len(J), "sprites,", len(catalog.W), "wearables")
