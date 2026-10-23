"""Rebuild the whole Cozy-Wild starter pack: atlases, frames, manifest, previews. python3 tools/build_all.py"""
import os, sys, json, importlib, time, zlib
from concurrent.futures import ProcessPoolExecutor
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from PIL import Image
from atlas import write_atlas, warm_glow_pred, cool_glow_pred, both_glow, ROOT

def job(spec):
    mod, fn, args, kw, post = spec
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    r = getattr(importlib.import_module(mod), fn)(*args, **kw)
    if post == "final": r = r.final()
    elif post and post.startswith("bfinal:"):
        import buildings; st, seed = map(int, post.split(":")[1:]); r = buildings.finalize(r, st, seed)
    elif post == "terrain": import terrain; r = terrain.final(r)
    return r

def J(mod, fn, *args, post=None, **kw): return (mod, fn, args, kw, post)

def run(specs, pool): return list(pool.map(job, specs, chunksize=2))

# ------------------------------------------------------------------ builders (piece renders)
def piece_render(key, rot, stage):
    import buildings as b
    defs = PIECES[key]; kind = defs["builder"]
    mirror = defs["art"] == "mirror" and rot % 2 == 1
    r = 1 if mirror else rot
    seed = zlib.crc32(key.encode()) % 1000
    if kind == "roof": cv = b.roof_piece(rot % 2)
    elif kind == "campfire": cv = b.campfire_frame(0, lit=stage < 2, stage=stage); return cv_final_dmg(cv, stage if stage >= 2 else 0, seed)
    elif kind == "torch": cv = b.torch_frame(0); return cv_final_dmg(cv, stage, seed)
    else:
        res = getattr(b, kind)(*defs.get("args", ()))
        boxes, dec = (res if isinstance(res, tuple) else (res, None))
        cv = b.render_boxes(boxes, r, mirror=mirror, seed=seed, decor=dec)
    fp = defs["footprint"]; w, h = (fp[1], fp[0]) if rot % 2 else fp
    sr = (-w / 2 - 0.05, w / 2 + 0.05, -h / 2 - 0.05, h / 2 + 0.05) if defs["layer"] >= 1 and kind not in ("roof",) else None
    return b.finalize(cv, stage, seed + rot, sr if kind not in ("floor",) else None)

def cv_final_dmg(cv, stage, seed):
    import iso; from toon import downscale
    img = iso.damage(cv.img, stage, seed) if stage else cv.img
    return downscale(img, (cv.w, cv.h))

def anim_render(key, i):
    import buildings as b
    if key == "campfire": return b.campfire_frame(i, 6).final()
    return b.torch_frame(i, 4).final()

PIECES = {
  # key: piece, footprint (w,h), layer, art: single|mirror|unique4, builder fn in buildings.py
  "floor":       dict(piece="floor", footprint=(2, 2), layer=0, art="single", builder="floor", args=("wood",)),
  "floor_stone": dict(piece="floor_stone", footprint=(2, 2), layer=0, art="single", builder="floor", args=("stone",)),
  "wall":        dict(piece="wall", footprint=(2, 1), layer=1, art="mirror", builder="wall_wood", args=("plain",)),
  "wall_stone":  dict(piece="wall_stone", footprint=(2, 1), layer=1, art="mirror", builder="wall_stone"),
  "wall_window": dict(piece="wall_window", footprint=(2, 1), layer=1, art="mirror", builder="window_piece"),
  "wall_corner": dict(piece="wall_corner", footprint=(1, 1), layer=1, art="unique4", builder="wall_corner"),
  "door":        dict(piece="door", footprint=(2, 1), layer=1, art="unique4", builder="door_piece", args=(False,)),
  "door_open":   dict(piece="door", footprint=(2, 1), layer=1, art="unique4", builder="door_piece", args=(True,)),
  "pillar":      dict(piece="pillar", footprint=(1, 1), layer=1, art="single", builder="pillar"),
  "roof":        dict(piece="roof", footprint=(2, 2), layer=1, art="mirror", builder="roof"),
  "fence":       dict(piece="fence", footprint=(2, 1), layer=1, art="mirror", builder="fence"),
}
FURNITURE = {
  "bed":       dict(piece="bed", footprint=(1, 2), layer=2, art="unique4", builder="bed"),
  "chest":     dict(piece="chest", footprint=(1, 1), layer=2, art="unique4", builder="chest"),
  "workbench": dict(piece="workbench", footprint=(2, 1), layer=2, art="unique4", builder="workbench"),
  "table":     dict(piece="table", footprint=(1, 1), layer=2, art="single", builder="table"),
  "chair":     dict(piece="chair", footprint=(1, 1), layer=2, art="unique4", builder="chair"),
  "planter":   dict(piece="planter", footprint=(1, 1), layer=3, art="single", builder="planter"),
  "campfire":  dict(piece="campfire", footprint=(1, 1), layer=2, art="single", builder="campfire", anim=6, fps=10),
  "torch":     dict(piece="torch", footprint=(1, 1), layer=3, art="single", builder="torch", anim=4, fps=10),
}
PIECES.update(FURNITURE)

def building_atlas(pool, key, keys, cols=16):
    frames, sprites, specs, names = [], [], [], []
    plan = []
    for k in keys:
        d = PIECES[k]; rots = {"single": [0], "mirror": [0, 1], "unique4": [0, 1, 2, 3]}[d["art"]]
        idx = {}
        for r in rots:
            for st in range(4):
                idx[(r, st)] = len(names); names.append(f"{k}_r{r}_s{st}"); specs.append(("piece", k, r, st))
        anim = []
        for i in range(d.get("anim", 0)):
            anim.append(len(names)); names.append(f"{k}_anim{i}"); specs.append(("anim", k, i, 0))
        plan.append((k, d, rots, idx, anim))
    imgs = list(pool.map(_bjob, specs, chunksize=2))
    frames = list(zip(names, imgs))
    em_frames = {i for i, n in enumerate(names) if n.startswith(("campfire", "torch"))}
    entry, sheet = write_atlas(key, frames, 128, 128, cols, "building", (0.5, 0.75), emissive_frames=em_frames, emissive_pred=warm_glow_pred)
    for (k, d, rots, idx, anim) in plan:
        if d["art"] == "single": fr = [[idx[(0, s)] for s in range(4)]]
        elif d["art"] == "mirror": fr = [[idx[(r % 2, s)] for s in range(4)] for r in range(4)]
        else: fr = [[idx[(r, s)] for s in range(4)] for r in range(4)]
        anims = {"idle": {"frames": [fr[0][0]], "fps": 1}}
        if anim: anims = {"idle": {"frames": anim, "fps": d["fps"], "loop": True}, "unlit" if k == "campfire" else "static": {"frames": [fr[0][0]], "fps": 1}}
        sprites.append({"key": k, "category": "building", "atlas": key, "anchor": {"x": 0.5, "y": 0.75}, "animations": anims,
                        "building": {"piece": d["piece"], "footprint": {"w": d["footprint"][0], "h": d["footprint"][1]}, "layer": d["layer"], "frames": fr},
                        "rotationArt": "unique4" if d["art"] == "unique4" else "mirror"})
    return entry, sprites, sheet

def merge_states(sprites, base, others):
    """schema9: fold alt-state keys (e.g. door_open) into building.states of the base key; alt keys are retired (ids stay reserved in the lock)."""
    by = {s["key"]: s for s in sprites}; b = by[base]
    b["building"]["states"] = {"closed": b["building"]["frames"]}
    for st, k in others:
        o = by.pop(k); b["building"]["states"][st] = o["building"]["frames"]
        b["animations"][st] = o["animations"]["idle"]
    return [s for s in sprites if s["key"] in by]

def _p2job(s):
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import pieces2
    if s[0] == "rot": key, rot, state = s[1], s[2], s[3]
    else: return pieces2.anim_frame(s[1], s[2])
    d = pieces2.P[key]; spec = d["draw"] if state is None else d["states"][state]
    return pieces2.frames_for(key, rot, spec)

def building_atlases(pool, cols=16):
    import pieces2
    out = []
    groups = {}
    for k, d in pieces2.P.items(): groups.setdefault(d["atlas"], []).append(k)
    for ak, keys in groups.items():
        jobs, plan = [], []
        for k in keys:
            d = pieces2.P[k]; rots = {"single": [0], "mirror": [0, 1], "unique4": [0, 1, 2, 3]}[d["art"]]
            for st in [None] + list(d.get("states", {})):
                for r in rots: jobs.append(("rot", k, r, st))
            for i in range(d.get("anim", 0)): jobs.append(("anim", k, i))
        res = list(pool.map(_p2job, jobs, chunksize=2))
        names, imgs, idx = [], [], {}
        for j, r in zip(jobs, res):
            if j[0] == "rot":
                for stg, im in enumerate(r): idx[(j[1], j[2], j[3], stg)] = len(names); names.append(f"{j[1]}_{j[3] or 'base'}_r{j[2]}_s{stg}"); imgs.append(im)
            else: idx[(j[1], "anim", j[2])] = len(names); names.append(f"{j[1]}_anim{j[2]}"); imgs.append(r)
        emk = {i for i, n in enumerate(names) if pieces2.P[n.split("_base_")[0].split("_anim")[0].split("_open_")[0]].get("emissive")} if False else None
        em_frames = set()
        for i, n in enumerate(names):
            for k in keys:
                if pieces2.P[k].get("emissive") and (n.startswith(k + "_base_") or n.startswith(k + "_anim")): em_frames.add(i)
        from atlas import both_glow
        entry, sheet = write_atlas(ak, list(zip(names, imgs)), 128, 128, cols, "building", (0.5, 0.75), emissive_frames=em_frames or {-1}, emissive_pred=both_glow if em_frames else None)
        sprites = []
        for k in keys:
            d = pieces2.P[k]
            def rows(st):
                if d["art"] == "single": return [[idx[(k, 0, st, s_)] for s_ in range(4)]]
                if d["art"] == "mirror": return [[idx[(k, r % 2, st, s_)] for s_ in range(4)] for r in range(4)]   # explicit 4 rows: rot 2/3 reuse 0/1 unflipped (symmetric pieces)
                return [[idx[(k, r, st, s_)] for s_ in range(4)] for r in range(4)]
            fr = rows(None)
            anims = {"idle": {"frames": [fr[0][0]], "fps": 1}}
            if d.get("anim"):
                anims = {"idle": {"frames": [idx[(k, "anim", i)] for i in range(d["anim"])], "fps": d["fps"], "loop": True}, "unlit": {"frames": [fr[0][2]], "fps": 1}}
            bld = {"piece": d["piece"], "footprint": {"w": d["footprint"][0], "h": d["footprint"][1]}, "layer": d["layer"], "frames": fr}
            if d.get("states"):
                bld["states"] = {"closed": fr, **{st: rows(st) for st in d["states"]}}
                for st in d["states"]: anims[st] = {"frames": [rows(st)[0][0]], "fps": 1}
            sprites.append({"key": k, "category": "building", "atlas": ak, "anchor": {"x": 0.5, "y": 0.75}, "animations": anims, "building": bld,
                            "rotationArt": "unique4" if d["art"] == "unique4" else "mirror"})
        for al, src in pieces2.ALIASES.items():
            for sp_ in list(sprites):
                if sp_["key"] == src: sprites.append({**json.loads(json.dumps(sp_)), "key": al})
        out.append((entry, sprites, sheet))
    return out

def _bjob(s):
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    if s[0] == "piece": return piece_render(s[1], s[2], s[3])
    return anim_render(s[1], s[2])

# ------------------------------------------------------------------ characters
def _cjob(args):
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import chars as c; return c.render_frame_meta(*args)

def char_atlas(pool, key, spec_key, zombie, fw, fh, feet, scale, anims, atlas_key, category, rows_per_dir=1):
    names, specs = [], []
    spec = CH[spec_key] if not zombie else ZB[spec_key]
    for d in range(8):
        for (an, n, fps, loop) in anims:
            for i in range(n):
                names.append(f"{an}_d{d}_{i}"); specs.append((spec, d, an, i, n, zombie, fw, fh, feet, scale))
    res = list(pool.map(_cjob, specs, chunksize=2))
    per_dir = sum(a[1] for a in anims); cols = (per_dir + rows_per_dir - 1) // rows_per_dir
    assert cols * rows_per_dir == per_dir, (key, per_dir, rows_per_dir)
    frames = [(n, im, meta) for n, (im, meta) in zip(names, res)]
    entry, sheet = write_atlas(atlas_key, frames, fw, fh, cols, category, (0.5, round(feet / fh, 4)), frame_dir=key)
    off = 0; A = {}
    for (an, n, fps, loop) in anims:
        A[an] = {"frames": list(range(off, off + n)), "fps": fps, "directions": 8, **({} if rows_per_dir == 1 else {"dirStride": per_dir}), **({} if loop else {"loop": False})}; off += n
    if not zombie:   # hand anchors sidecar: frame index -> {x,y px in frame, angle deg (0 = up, cw), len, behind}
        hands = {str(i): m["hand"] for i, (_, m) in enumerate(res) if m["hand"]}
        json.dump({"atlas": atlas_key, "frameW": fw, "frameH": fh, "doc": "per-frame right-hand anchor for held equipment; attach held_* sprite pivot here, rotate by angle; draw behind body when behind=true", "hands": hands},
                  open(os.path.join(ROOT, "atlases", f"{atlas_key}.hands.json"), "w"))
    return entry, {"key": key, "category": category, "atlas": atlas_key, "anchor": {"x": 0.5, "y": round(feet / fh, 4)}, "animations": A}, sheet

import chars
CH, ZB = chars.PLAYERS, chars.ZOMBIES

def main():
    t0 = time.time()
    M = {"version": 1, "name": "cozy-wild-starter", "atlases": [], "sprites": [], "sounds": [], "vfx": [], "tintSets": [], "palettes": [], "variantSets": []}
    sheets = {}
    with ProcessPoolExecutor(8) as pool:
        # characters
        for key, ak in (("player", "characters"), ("player_b", "characters_b"), ("player_c", "characters_c")):
            e, sp, sh = char_atlas(pool, key, key, False, 48, 64, 59, 1.0, chars.PLAYER_ANIMS, ak, "character"); M["atlases"].append(e); M["sprites"].append(sp); sheets[ak] = sh
        for key, ak in (("zombie_walker", "zombies"), ("zombie_brute", "zombies_brute"), ("zombie_runner", "zombies_runner"), ("zombie_mummy", "zombies_mummy"), ("zombie_pumpkin", "zombies_pumpkin")):
            z = ZB[key]; fw, fh = z["frame"]
            e, sp, sh = char_atlas(pool, key, key, True, fw, fh, z["feet"], z["scale"], chars.ZOMBIE_ANIMS, ak, "zombie", rows_per_dir=2)
            sp["animations"]["shamble"] = dict(sp["animations"]["walk"])   # renderer AnimState.Shamble
            M["atlases"].append(e); M["sprites"].append(sp); sheets[ak] = sh
        print("chars", time.time() - t0)
        # held equipment: 8 facings per row (dirStride 1), torch = 4 flame rows
        import held
        hk = [k for k, _, _ in held.HELD]; names, specs, rowkey = [], [], []
        for k in hk + ["torch"] * 4:
            i = len(rowkey) - len(hk) if k == "torch" else 0
            rowkey.append(k)
            for d in range(8): names.append(f"held_{k}_d{d}_{i}"); specs.append(J("held", "render", k, d, i))
        e, sh = write_atlas("held", list(zip(names, run(specs, pool))), 48, 48, 8, "equipment", (0.5, 0.75)); M["atlases"].append(e); sheets["held"] = sh
        e["emissive"] = True
        em = Image.new("RGBA", sh.size, (0, 0, 0, 0)); tr = sh.crop((0, 48 * len(hk), sh.width, sh.height))
        from atlas import warm_glow_pred
        import numpy as np
        ar = np.asarray(tr).astype(np.float32); ar[..., 3] *= warm_glow_pred(ar); em.alpha_composite(Image.fromarray(ar.astype(np.uint8)), (0, 48 * len(hk)))
        em.save(os.path.join(ROOT, "atlases", "held_emissive.png"))
        for r, k in enumerate(hk):
            M["sprites"].append({"key": f"held_{k}", "category": "equipment", "atlas": "held", "anchor": {"x": 0.5, "y": 0.75},
                                 "animations": {"idle": {"frames": [r * 8], "fps": 1, "directions": 8, "dirStride": 1}}})
        M["sprites"].append({"key": "held_torch", "category": "equipment", "atlas": "held", "anchor": {"x": 0.5, "y": 0.75},
                             "animations": {"idle": {"frames": [(len(hk) + i) * 8 for i in range(4)], "fps": 10, "directions": 8, "dirStride": 1}}})
        # critters
        import critters
        names, specs, cmeta = [], [], []
        for ck, (fn, anims, alias) in critters.CRITTERS.items():
            base_ = len(names) // 4 if False else None
            cmeta.append((ck, anims, alias, len(names)))
            for d in range(4):
                for (an, n, fps) in anims:
                    for i in range(n): names.append(f"{ck}_{an}_d{d}_{i}"); specs.append(J("critters", fn.__name__, d, an, i))
        e, sh = write_atlas("critters", list(zip(names, run(specs, pool))), 32, 32, 8, "critter", (0.5, 0.875), frame_dir="critters")
        M["atlases"].append(e); sheets["critters"] = sh
        for (ck, anims, alias, off) in cmeta:
            A, o = {}, off
            for (an, n, fps) in anims: A[an] = {"frames": list(range(o, o + n)), "fps": fps, "directions": 4}; o += n
            for al, src in alias.items(): A[al] = dict(A[src])
            M["sprites"].append({"key": ck, "category": "critter", "atlas": "critters", "anchor": {"x": 0.5, "y": 0.875}, "animations": A})
        # tiles
        tn, ts = [], []
        for i in range(4): tn.append(f"tile_water_{i}"); ts.append(J("terrain", "water", i, 4, post="terrain"))
        for i in range(4): tn.append(f"tile_water_shallow_{i}"); ts.append(J("terrain", "water", i, 4, shallow=True, post="terrain"))
        statics = [("tile_grass", "grass", (0, 11)), ("tile_grass_b", "grass", (1, 12)), ("tile_grass_c", "grass", (2, 13)), ("tile_dirt", "dirt", ()),
                   ("tile_sand", "sand", ()), ("tile_rock", "stone", ()), ("tile_snow", "snow", ()), ("tile_forest", "forest", ())]
        for k, fn, a in statics: tn.append(k); ts.append(J("terrain", fn, *a, post="terrain"))
        import terrain
        shores = list(terrain.SHORE_EDGES) + list(terrain.SHORE_CORNERS)
        for s in shores:
            for i in range(4): tn.append(f"tile_shore_{s}_{i}"); ts.append(("terrain_shore", s, i))
        imgs = list(pool.map(_tjob, ts, chunksize=2))
        e, sh = write_atlas("tiles", list(zip(tn, imgs)), 64, 48, 8, "tile", (0.5, 0.3333)); M["atlases"].append(e); sheets["tiles"] = sh
        TA = lambda fr, fps=1: {"frames": fr, "fps": fps}
        M["sprites"].append({"key": "tile_water", "category": "tile", "atlas": "tiles", "anchor": {"x": 0.5, "y": 0.3333}, "animations": {"idle": TA([0, 1, 2, 3], 4)}})
        M["sprites"].append({"key": "tile_water_shallow", "category": "tile", "atlas": "tiles", "anchor": {"x": 0.5, "y": 0.3333}, "animations": {"idle": TA([4, 5, 6, 7], 4)}})
        for j, (k, _, _) in enumerate(statics):
            M["sprites"].append({"key": k, "category": "tile", "atlas": "tiles", "anchor": {"x": 0.5, "y": 0.3333}, "animations": {"idle": TA([8 + j])}})
        for j, s in enumerate(shores):
            b = 16 + j * 4
            M["sprites"].append({"key": f"tile_shore_{s}", "category": "tile", "atlas": "tiles", "anchor": {"x": 0.5, "y": 0.3333}, "animations": {"idle": TA([b, b + 1, b + 2, b + 3], 4)}})
        print("tiles", time.time() - t0)
        # resources
        tall = [("tree", "tree_oak", {}), ("tree_apple", "tree_oak", {"seed": 4, "fruit": "berry"}), ("tree_autumn", "tree_oak", {"seed": 6, "rp": "leaf_autumn"}),
                ("tree_pine", "tree_pine", {}), ("tree_twisty", "tree_twisty", {}), ("tree_stump", "stump", {}),
                ("tree_sapling", "nature2.sapling", {}), ("tree_young", "nature2.tree_young", {}), ("pine_sapling", "nature2.sapling", {"kind": "pine"}),
                ("pine_young", "nature2.tree_young", {"kind": "pine"})]
        imgs = run([J(*(fn.split(".") if "." in fn else ("nature", fn)), **kw) for _, fn, kw in tall], pool)
        e, sh = write_atlas("resources_tall", [(k, im) for (k, _, _), im in zip(tall, imgs)], 96, 128, 5, "resource", (0.5, 0.92),
                            emissive_frames={4}, emissive_pred=cool_glow_pred); M["atlases"].append(e); sheets["resources_tall"] = sh
        SW = {"tree": (2.0, 0.35, 0.6), "tree_apple": (2.0, 0.35, 0.6), "tree_autumn": (2.0, 0.35, 0.6), "tree_pine": (1.4, 0.3, 0.75), "tree_twisty": (2.4, 0.25, 0.5),
              "tree_sapling": (1.6, 0.7, 0.35), "pine_sapling": (1.2, 0.7, 0.4), "tree_young": (1.8, 0.45, 0.55), "pine_young": (1.3, 0.4, 0.7)}
        for j, (k, _, _) in enumerate(tall):
            s = {"key": k, "category": "resource", "atlas": "resources_tall", "anchor": {"x": 0.5, "y": 0.92}, "animations": {"idle": {"frames": [j], "fps": 1}}}
            if k in SW: s["sway"] = {"amp": SW[k][0], "freq": SW[k][1], "stiffness": SW[k][2]}
            M["sprites"].append(s)
        small = [("boulder", "rock", (True,), {}), ("rock_small", "rock", (False,), {"seed": 14}), ("loose_rocks", "loose_rocks", (), {}),
                 ("iron_vein", "rock", (True,), {"seed": 31, "ore": "leaf_autumn", "rp": "cobble"}), ("bush", "bush", (), {}),
                 ("berry_bush", "berry_bush", (True,), {}), ("berry_bush_empty", "berry_bush", (False,), {}), ("fiber_grass", "fiber_grass", (), {}),
                 ("fallen_branches", "fallen_branches", (), {}), ("mushrooms", "mushrooms", (), {}), ("glow_mushrooms", "mushrooms", (), {"glow": True}),
                 ("flowers", "flowers", (), {}),
                 ("copper_vein", "nature2.ore_vein", ("copper_vein",), {}), ("tin_vein", "nature2.ore_vein", ("tin_vein",), {}), ("gold_vein", "nature2.ore_vein", ("gold_vein",), {}),
                 ("coal_seam", "nature2.ore_vein", ("coal_seam",), {}), ("clay_deposit", "nature2.clay_deposit", (), {}), ("sand_dune", "nature2.sand_dune", (), {}),
                 ("animal_carcass", "nature2.hide_bundle", (), {}), ("carrot_patch", "nature2.carrot_patch", (), {}), ("wild_herbs", "nature2.wild_herbs", (), {}),
                 ("blueberry_bush", "nature2.blueberry_bush", (True,), {}), ("blueberry_bush_empty", "nature2.blueberry_bush", (False,), {}),
                 ("reeds", "nature2.reeds", (), {}), ("pumpkin_patch", "nature2.pumpkin_patch", (), {}), ("flax", "nature2.flax", (), {})]
        imgs = run([J(*(fn.split(".") if "." in fn else ("nature", fn)), *a, **kw) for _, fn, a, kw in small], pool)
        e, sh = write_atlas("resources", [(k, im) for (k, _, _, _), im in zip(small, imgs)], 64, 64, 8, "resource", (0.5, 0.875),
                            emissive_frames={10}, emissive_pred=cool_glow_pred); M["atlases"].append(e); sheets["resources"] = sh
        SWS = {"bush": (0.8, 0.5, 0.7), "berry_bush": (0.8, 0.5, 0.7), "fiber_grass": (1.6, 0.8, 0.3), "flowers": (1.0, 0.9, 0.4), "glow_mushrooms": (0.3, 0.4, 0.9), "mushrooms": (0.3, 0.4, 0.9),
               "blueberry_bush": (0.8, 0.5, 0.7), "reeds": (1.8, 0.7, 0.3), "flax": (1.5, 0.8, 0.3), "wild_herbs": (1.0, 0.8, 0.4), "carrot_patch": (0.6, 0.8, 0.5)}
        for j, (k, _, _, _) in enumerate(small):
            if k.endswith("_empty"): continue
            A = {"idle": {"frames": [j], "fps": 1}}
            if k in ("berry_bush", "blueberry_bush"): A["depleted"] = {"frames": [j + 1], "fps": 1}
            s = {"key": k, "category": "resource", "atlas": "resources", "anchor": {"x": 0.5, "y": 0.875}, "animations": A}
            if k in SWS: s["sway"] = {"amp": SWS[k][0], "freq": SWS[k][1], "stiffness": SWS[k][2]}
            M["sprites"].append(s)
        big = run([J("nature2", "big_oak")], pool)
        e, sh = write_atlas("resources_huge", [("oak_tree", big[0])], 128, 160, 1, "resource", (0.5, 0.9375), emissive_frames={0}, emissive_pred=cool_glow_pred)
        M["atlases"].append(e); sheets["resources_huge"] = sh
        M["sprites"].append({"key": "oak_tree", "category": "resource", "atlas": "resources_huge", "anchor": {"x": 0.5, "y": 0.9375}, "animations": {"idle": {"frames": [0], "fps": 1}},
                             "sway": {"amp": 1.6, "freq": 0.25, "stiffness": 0.7}})
        print("resources", time.time() - t0)
        # items + equipment
        import items
        for ak, lst, cat in (("items", items.ITEMS, "item"), ("equipment", items.EQUIPMENT, "equipment")):
            imgs = run([J("items", "_icon", k) for k, _ in lst], pool)
            e, sh = write_atlas(ak, [(k, im) for (k, _), im in zip(lst, imgs)], 32, 32, 8, cat, (0.5, 0.5)); M["atlases"].append(e); sheets[ak] = sh
            for j, (k, _) in enumerate(lst):
                M["sprites"].append({"key": k, "category": cat, "atlas": ak, "anchor": {"x": 0.5, "y": 0.5}, "animations": {"idle": {"frames": [j], "fps": 1}}})
        # buildings (wave 2: gameplay-scale catalogue in pieces2.py)
        for e, sp, sh in building_atlases(pool): M["atlases"].append(e); M["sprites"] += sp; sheets[e["key"]] = sh
        print("buildings", time.time() - t0)
        # fx
        import fx
        names, imgs, fxmeta = [], [], []
        for k, (fn, fps, loop) in fx.FX.items():
            fr = fn(); fxmeta.append((k, len(names), len(fr), fps, loop))
            for i, im in enumerate(fr): names.append(f"{k}_{i}"); imgs.append(im)
        e, sh = write_atlas("vfx", list(zip(names, imgs)), 32, 32, 8, "vfx", (0.5, 0.5)); M["atlases"].append(e); sheets["vfx"] = sh
        for (k, off, n, fps, loop) in fxmeta:
            A = {"idle": {"frames": list(range(off, off + n)), "fps": fps, **({} if loop else {"loop": False})}}
            M["sprites"].append({"key": k, "category": "vfx", "atlas": "vfx", "anchor": {"x": 0.5, "y": 0.85 if k == "fx_rain_splash" else 0.5}, "animations": A})
        for (ak, fk, fn, fw, fh, n, anc) in (("vfx_fire_big", "fx_fire_big", fx.fire_big, 48, 64, 8, 0.906), ("vfx_fire_huge", "fx_fire_huge", fx.fire_huge, 64, 96, 8, 0.92)):
            e, sh = write_atlas(ak, [(f"{fk}_{i}", fn(i, n)) for i in range(n)], fw, fh, n, "vfx", (0.5, anc), emissive_pred=warm_glow_pred); M["atlases"].append(e); sheets[ak] = sh
            M["sprites"].append({"key": fk, "category": "vfx", "atlas": ak, "anchor": {"x": 0.5, "y": anc}, "animations": {"idle": {"frames": list(range(n)), "fps": 10}}})
        fog = [("fx_fog_0", fx.fog_tile(0)), ("fx_fog_1", fx.fog_tile(1))]
        e, sh = write_atlas("fog", fog, 256, 256, 2, "vfx", (0.5, 0.5)); M["atlases"].append(e)
        M["sprites"].append({"key": "fx_fog", "category": "vfx", "atlas": "fog", "anchor": {"x": 0.5, "y": 0.5}, "animations": {"idle": {"frames": [0], "fps": 1}, "layer2": {"frames": [1], "fps": 1}}})
    # UI placeholder passthrough (owned by UI worker)
    M["atlases"].append({"key": "ui", "image": "atlases/ui.png", "frameW": 32, "frameH": 32, "columns": 2, "rows": 1, "nineSlice": {"0": {"l": 6, "t": 6, "r": 6, "b": 6}, "1": {"l": 6, "t": 6, "r": 6, "b": 6}}})
    M["sprites"] += [{"key": "ui_panel", "category": "ui", "atlas": "ui", "anchor": {"x": 0.5, "y": 0.5}, "animations": {"idle": {"frames": [0], "fps": 1}}},
                     {"key": "ui_button", "category": "ui", "atlas": "ui", "anchor": {"x": 0.5, "y": 0.5}, "animations": {"idle": {"frames": [1], "fps": 1}}}]
    M["vfx"] = [
        {"key": "campfire_sparks", "sprite": "fx_spark", "anim": "idle", "lifetime": 1.2, "blend": "additive", "particles": {"rate": 12, "count": 0, "speed": [0.5, 1.5], "spread": 0.6, "gravity": -0.5, "fade": True, "scaleCurve": [1, 0.6, 0]}},
        {"key": "hit_dust", "sprite": "fx_dust", "anim": "idle", "lifetime": 0.5, "blend": "normal", "particles": {"rate": 0, "count": 8, "speed": [1, 3], "spread": 6.283, "gravity": 0, "fade": True, "scaleCurve": [0.5, 1.2]}},
        {"key": "hit_sparkle", "sprite": "fx_spark", "anim": "idle", "lifetime": 0.36, "blend": "additive"},
        {"key": "zombie_poof", "sprite": "fx_poof", "anim": "idle", "lifetime": 0.6, "blend": "normal"},
        {"key": "footstep_dust", "sprite": "fx_dust", "anim": "idle", "lifetime": 0.43, "blend": "normal", "particles": {"rate": 0, "count": 2, "speed": [0.2, 0.6], "spread": 1.2, "gravity": 0, "fade": True, "scaleCurve": [0.5, 0.9]}},
        {"key": "leaves_falling", "sprite": "fx_leaf", "anim": "idle", "lifetime": 3.0, "blend": "normal", "particles": {"rate": 0.6, "count": 0, "speed": [0.2, 0.5], "spread": 1.0, "gravity": 0.15, "fade": True, "scaleCurve": [1, 1, 0.8]}},
        {"key": "chop_leaves", "sprite": "fx_leaf", "anim": "idle", "lifetime": 1.2, "blend": "normal", "particles": {"rate": 0, "count": 6, "speed": [0.8, 2.0], "spread": 2.4, "gravity": 0.6, "fade": True, "scaleCurve": [1, 0.8]}},
        {"key": "campfire_smoke", "sprite": "fx_smoke", "anim": "idle", "lifetime": 2.5, "blend": "normal", "particles": {"rate": 2.5, "count": 0, "speed": [0.3, 0.6], "spread": 0.4, "gravity": -0.3, "fade": True, "scaleCurve": [0.6, 1.0, 1.4]}},
        {"key": "fire", "sprite": "fx_fire", "anim": "idle", "lifetime": 0.6, "blend": "additive"},
        {"key": "rain", "sprite": "fx_rain", "anim": "idle", "lifetime": 0.8, "blend": "normal", "particles": {"rate": 120, "count": 0, "speed": [8, 11], "spread": 0.15, "gravity": 3, "fade": False, "scaleCurve": [1]}},
        {"key": "rain_splash", "sprite": "fx_rain_splash", "anim": "idle", "lifetime": 0.25, "blend": "normal"},
        {"key": "snow", "sprite": "fx_snow", "anim": "idle", "lifetime": 4.0, "blend": "normal", "particles": {"rate": 40, "count": 0, "speed": [0.4, 1.0], "spread": 0.8, "gravity": 0.2, "fade": True, "scaleCurve": [1, 1, 0.6]}},
        {"key": "fireflies", "sprite": "fx_firefly", "anim": "idle", "lifetime": 5.0, "blend": "additive", "particles": {"rate": 0.8, "count": 0, "speed": [0.1, 0.3], "spread": 6.283, "gravity": -0.02, "fade": True, "scaleCurve": [0, 1, 1, 0]}},
        {"key": "fog", "sprite": "fx_fog", "anim": "idle", "lifetime": 60.0, "blend": "normal"},
        {"key": "fire_big", "sprite": "fx_fire_big", "anim": "idle", "lifetime": 0.8, "blend": "additive"},
        {"key": "fire_huge", "sprite": "fx_fire_huge", "anim": "idle", "lifetime": 0.8, "blend": "additive"},
        {"key": "structure_fire", "sprite": "fx_fire_huge", "anim": "idle", "lifetime": 6.0, "blend": "additive", "particles": {"rate": 1.5, "count": 0, "speed": [0.0, 0.2], "spread": 1.0, "gravity": 0, "fade": True, "scaleCurve": [0.5, 1, 0.7]}},
    ]
    from palette import RAMPS
    M["tintSets"] = [{"key": "shirt_colors", "tints": ["#ff6b6b", "#ffd93d", "#6bcb77", "#4d96ff"]}]
    M["palettes"] = [{"key": "zombie_pale", "source": RAMPS["zomb_mint"], "target": ["#e8eaee", "#c8ccd2", "#9aa0a8", "#6e7480"]},
                     {"key": "player_dark_hair", "source": RAMPS["hair_brown"], "target": RAMPS["hair_black"]}]
    M["variantSets"] = [{"key": "player_variants", "base": "player", "variants": [{"key": "player_red", "tint": "shirt_colors", "tintIndex": 0}, {"key": "player_blue", "tint": "shirt_colors", "tintIndex": 3},
                         {"key": "player_tan", "palette": "player_dark_hair"}, {"key": "player_farmer", "sprite": "player_b"}, {"key": "player_ranger", "sprite": "player_c"}]},
                        {"key": "zombie_variants", "base": "zombie_walker", "variants": [{"key": "zombie_green"}, {"key": "zombie_pale", "palette": "zombie_pale"},
                         {"key": "zombie_big", "sprite": "zombie_brute"}, {"key": "zombie_fast", "sprite": "zombie_runner"},
                         {"key": "zombie_wrapped", "sprite": "zombie_mummy"}, {"key": "zombie_gourd", "sprite": "zombie_pumpkin"}]}]
    import pieces2
    # variantSets only accept character/zombie bases (schema), so decor piece variants go to a sidecar: piece key -> sprite key per BuildPiece.variant
    json.dump({"$comment": "BuildPiece.variant index -> sprite key (variant 0 = the base key)", "pieces": {b_: [b_] + [f"{b_}_{i + 1}" for i in range(1, n)] for b_, n in pieces2.VARIANTS.items()}},
              open(os.path.join(ROOT, "piece_variants.json"), "w"), indent=1)
    am = os.path.join(ROOT, "audio", "manifest.json")
    if os.path.exists(am): M["sounds"] = json.load(open(am))["sounds"]
    # copy placeholder ui page from engine sample (UI worker replaces)
    src = "/workspace/engine/packages/assets/sample/ui.png"
    if os.path.exists(src): Image.open(src).save(os.path.join(ROOT, "atlases", "ui.png"))
    # gameplay item keys are the source of truth (items.json): wave-1 icon keys renamed, ids moved in pack/ids.lock.json
    add_masks(M)
    from finalize_manifest import finalize; finalize(M)
    json.dump(M, open(os.path.join(ROOT, "manifest.json"), "w"), indent=1)
    print("done", time.time() - t0, len(M["sprites"]), "sprites")

SHEEN_ATLASES = ("characters", "characters_b", "characters_c", "zombies", "zombies_brute", "zombies_runner", "zombies_mummy", "zombies_pumpkin", "critters")
SWAY_ATLASES = ("resources_tall", "resources", "resources_huge")
def add_masks(M):
    """survival_fx mask tools -> atlases/<atlas>_sheen.png / _sway.png next to each atlas; typed atlas `masks` (batch 11)."""
    import subprocess
    tools = "/workspace/assets/survival_fx/tools"; adir = os.path.join(ROOT, "atlases")
    sheen = [os.path.join(adir, a + ".png") for a in SHEEN_ATLASES]
    sway = [os.path.join(adir, a + ".png") for a in SWAY_ATLASES]
    subprocess.run([sys.executable, f"{tools}/make_sheen_mask.py", *sheen, "--out-dir", adir], check=True, stdout=subprocess.DEVNULL)
    subprocess.run([sys.executable, f"{tools}/make_sway_mask.py", *sway, "--out-dir", adir], check=True, stdout=subprocess.DEVNULL)
    for a in M["atlases"]:
        m = {}
        if a.pop("emissive", False): m["emissive"] = True
        if a["key"] in SHEEN_ATLASES and os.path.exists(os.path.join(adir, a["key"] + "_sheen.png")): m["sheen"] = f"atlases/{a['key']}_sheen.png"
        if a["key"] in SWAY_ATLASES and os.path.exists(os.path.join(adir, a["key"] + "_sway.png")): m["sway"] = f"atlases/{a['key']}_sway.png"
        if m: a["masks"] = m

def _tjob(s):
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    if isinstance(s, tuple) and s and s[0] == "terrain_shore":
        import terrain; k = s[1]; fn = terrain.SHORE_EDGES.get(k) or terrain.SHORE_CORNERS[k]
        return terrain.final(terrain.shore(fn, s[2], 4, seed=9))
    return job(s)

if __name__ == "__main__": main()
