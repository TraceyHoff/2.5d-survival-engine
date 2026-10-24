"""Build SurVivaZ vehicle atlases + manifest.vehicles.json + previews.  python3 build.py <out_pack_vehicles_dir> <preview_dir>"""
import sys, os, json, math, numpy as np
from multiprocessing import Pool
from PIL import Image, ImageDraw
from vrender import *
from vehicles import FAMILIES, STATES, fit_factors, apply_fit
from effects import EFFECTS

OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/veh_out"; PREV = sys.argv[2] if len(sys.argv) > 2 else "/tmp/veh_prev"
PAD = 3  # >=2px transparent gutter per frame side is asserted below
MAXP = 2048
# One atlas per vehicle at TRUE target size (docs/VEHICLES_RENDER.md): key, source model, L x H px (E view, 1x), body width
# (tiles, vehicles.json footprint), seat z px, legacy keys still emitted as aliases. Atlas = veh_art_<key> (+ _1.. overflow).
VEH = [
    ("bike_basic", "bike_basic", 81, 46, 0.6, 16, []), ("bike_road", "bike_road", 81, 46, 0.6, 16, []),
    ("bike_mountain", "bike_mountain", 81, 47, 0.6, 17, []), ("bike_bmx", "bike_bmx", 81, 37, 0.6, 13, []),
    ("bike_fat_tire", "bike_fat_tire", 81, 47, 0.6, 17, []), ("bike_cruiser", "bike_cruiser", 81, 46, 0.6, 16, []),
    ("bike_tandem", "bike_tandem", 118, 46, 0.6, 16, []), ("bike_cargo", "bike_cargo", 109, 49, 0.8, 17, []),
    ("bike_trike", "bike_trike", 86, 46, 1.0, 16, []),
    ("car_compact", "car_hatchback", 163, 89, 1.6, 17, ["car_hatchback"]), ("car_sedan", "car_sedan", 208, 95, 1.8, 18, []),
    ("car_muscle", "car_sports", 217, 89, 1.9, 17, ["car_sports"]), ("car_offroad", "car_suv", 199, 107, 1.9, 19, ["car_suv"]),
    ("car_wagon", "car_wagon", 222, 96, 1.8, 19, []),
    ("truck_pickup", "car_pickup", 244, 111, 2.0, 17, ["car_pickup"]), ("truck_flatbed", "car_flatbed", 294, 118, 2.2, 18, []),
    ("truck_box", "truck_box", 317, 155, 2.3, 17, []),
    ("van_cargo", "van_delivery", 235, 126, 2.0, 17, ["van_delivery"]), ("van_passenger", "van_minivan", 244, 122, 2.0, 16, ["van_minivan"]),
    ("camper_van", "camper_van", 272, 137, 2.1, 15, []), ("camper_rv", "camper_motorhome", 407, 155, 2.5, 17, ["camper_motorhome"]),
    ("semi_tractor", "truck_semi_cab", 294, 170, 2.5, 18, ["truck_semi_cab"]),
    ("trailer_utility_small", "trailer_utility", 113, 56, 1.5, None, ["trailer_utility"]),
    ("trailer_cargo_medium", "trailer_box", 181, 111, 2.0, None, ["trailer_box"]),
    ("trailer_flatbed_large", "trailer_flatbed", 272, 67, 2.3, None, ["trailer_flatbed"]),
    ("trailer_livestock", "trailer_livestock", 272, 130, 2.3, None, []), ("trailer_tanker", "trailer_tanker", 294, 141, 2.3, None, []),
    ("trailer_camper", "camper_trailer", 294, 133, 2.3, None, ["camper_trailer"]), ("trailer_log", "trailer_log", 272, 100, 2.3, None, []),
    ("semi_trailer_box", "trailer_semi_box", 588, 178, 2.5, None, []), ("semi_trailer_flatbed", "trailer_semi_flatbed", 588, 74, 2.5, None, []),
]
SRC = {k: (f, i) for f, l in FAMILIES.items() for i, (k, _) in enumerate(l)}
VSPEC = {}
for key, src, Lp, Hp, Wt, seat, legacy in VEH:
    f, i = SRC[src]; m0 = FAMILIES[f][i][1]("intact"); fx = list(fit_factors(m0, Lp, Hp, Wt))
    if f == "bikes" and key != "bike_trike": fx[1] = 1.0  # bikes keep a slim body; footprint width is collision only
    VSPEC[key] = dict(fam=f, idx=i, fit=tuple(fx), seat=seat, legacy=legacy, target=(Lp, Hp))

def model(key, st):
    v = VSPEC[key]; return apply_fit(FAMILIES[v["fam"]][v["idx"]][1](st), v["fit"], v["seat"])

def shadow_poly(m, d, piv, k=SS):
    L, W = m.foot; cx, cy = getattr(m, "foot_c", (0, 0)); xf = None if getattr(m, "shadow_flat", False) else m.xf
    pts = [(cx + L / 2, cy + W / 2, 0), (cx + L / 2, cy - W / 2, 0), (cx - L / 2, cy - W / 2, 0), (cx - L / 2, cy + W / 2, 0)]
    out = []
    for p in pts: x, y, _ = project_point(p, d, xf); out.append(((x + piv[0]) * k, (y + piv[1]) * k))
    return out

def measure(args):
    key, st = args; m = model(key, st); res = []
    for d in range(8):
        mn, mx = render(m.prims, d, m.xf)
        sp = np.array(shadow_poly(m, d, (0, 0), 1)); mn = np.minimum(mn, sp.min(0) - 3); mx = np.maximum(mx, sp.max(0) + 3)
        res.append((mn.tolist(), mx.tolist()))
    return args, res

def render_frame(args):
    key, st, d, fw, fh, piv, seed, hi = args; m = model(key, st); fam = VSPEC[key]["fam"]
    L = render(m.prims, d, m.xf, (fw, fh), piv)
    eff = EFFECTS[st]; img, tint, emi = finish(L, shadow_poly(m, d, piv), eff, seed=seed, pivot=piv, grass=(st == "rusty" and fam != "bikes"))
    if st == "rusty" and fam == "bikes": img = add_grass(img, shadow_poly(m, d, piv), seed)
    i2 = np.asarray(downs(img, SS // 2)) if hi else None; i1 = downs(img, SS)
    a1 = np.asarray(i1)[..., 3] > 8
    t1 = np.asarray(downs(Image.fromarray((np.clip(tint, 0, 1) * 255).astype(np.uint8)), SS, Image.BOX)); t1 = np.where(a1, t1, 0).astype(np.uint8)
    e1 = np.asarray(downs(Image.fromarray(np.clip(emi, 0, 255).astype(np.uint8)), SS, Image.BOX))
    att = {}
    for n, p in m.attach.items():
        x, y, dep = project_point(p, d, m.xf); att[n] = (round(x, 2), round(y, 2))
    vis = {nm: facing_visible(nrm, d, m.xf) for nm, kind, pos, nrm in m.lights}
    return args[:3], np.asarray(i1), i2, t1, e1, att, vis

def r4(n): return (n + 3) // 4 * 4

def main():
    os.makedirs(OUT + "/atlases", exist_ok=True); os.makedirs(PREV, exist_ok=True)
    for f in os.listdir(OUT + "/atlases"):
        if f.startswith("veh_") and not f.startswith("veh_camper_interior"): os.remove(OUT + "/atlases/" + f)
    pool = Pool(os.cpu_count())
    jobs = [(k, s) for k in VSPEC for s in STATES[VSPEC[k]["fam"]]]
    meas = dict(pool.map(measure, jobs))
    atlases, sprites, meta, report = [], [], [], []
    allframes = {}
    for key, v in VSPEC.items():
        f = v["fam"]; states = STATES[f]
        ext = [math.inf, math.inf, -math.inf, -math.inf]
        for s in states:
            for mn, mx in meas[(key, s)]: ext = [min(ext[0], mn[0]), min(ext[1], mn[1]), max(ext[2], mx[0]), max(ext[3], mx[1])]
        piv = (math.ceil(-ext[0]) + PAD, math.ceil(-ext[1]) + PAD)
        fw = piv[0] + math.ceil(ext[2]) + PAD; fh = piv[1] + math.ceil(ext[3]) + PAD
        cols = min(MAXP // fw, 8 * len(states)); rows_max = MAXP // fh
        spp = max(1, (cols * rows_max) // 8)  # whole states per page
        chunks = [states[i:i + spp] for i in range(0, len(states), spp)]
        m0 = model(key, "intact"); state_atlas = {}; fattach = {}; anims_by = {}
        for ci, ch in enumerate(chunks):
            gkey = f"veh_art_{key}" + (f"_{ci}" if ci else ""); n = 8 * len(ch)
            c_ = min((c for c in range(1, min(cols, n) + 1) if math.ceil(n / c) * fh <= MAXP),
                     key=lambda c: (max(c * fw, math.ceil(n / c) * fh), c * fw * math.ceil(n / c) * fh)); rows = math.ceil(n / c_)
            W1, H1 = r4(c_ * fw), r4(rows * fh); hi = max(W1, H1) <= MAXP // 2
            fjobs = [(key, s, d, fw, fh, piv, hash((key, s)) % 1000 + d, hi) for s in ch for d in range(8)]
            results = pool.map(render_frame, fjobs)
            P1 = np.zeros((H1, W1, 4), np.uint8); P2 = np.zeros((H1 * 2, W1 * 2, 4), np.uint8) if hi else None
            TM = np.zeros((H1, W1), np.uint8); EM = np.zeros((H1, W1, 3), np.uint8); fr = {}
            for k, (key3, i1, i2, t1, e1, att, vis) in enumerate(results):
                c, r = k % c_, k // c_
                i1 = i1.copy(); t1 = t1.copy(); e1 = e1.copy()
                for arr, g in ((i1, 2), (t1, 2), (e1, 2)): arr[:g] = 0; arr[-g:] = 0; arr[:, :g] = 0; arr[:, -g:] = 0  # guaranteed 2px gutter
                P1[r * fh:(r + 1) * fh, c * fw:(c + 1) * fw] = i1
                if hi: i2 = i2.copy(); i2[:4] = 0; i2[-4:] = 0; i2[:, :4] = 0; i2[:, -4:] = 0; P2[r * fh * 2:(r + 1) * fh * 2, c * fw * 2:(c + 1) * fw * 2] = i2
                TM[r * fh:(r + 1) * fh, c * fw:(c + 1) * fw] = t1; EM[r * fh:(r + 1) * fh, c * fw:(c + 1) * fw] = e1
                fr[k] = (key3, att, vis); allframes[(gkey, k)] = (key3, i1, i2, t1, e1)
            Image.fromarray(P1).save(f"{OUT}/atlases/{gkey}.png", optimize=True)
            if hi: Image.fromarray(P2).save(f"{OUT}/atlases/{gkey}@2x.png", optimize=True)
            Image.fromarray(TM, "L").save(f"{OUT}/atlases/{gkey}.tintmask.png", optimize=True)
            has_em = EM.max() > 0
            if has_em: Image.fromarray(EM).save(f"{OUT}/atlases/{gkey}_emissive.png", optimize=True)
            masks = {"tintmask": f"atlases/{gkey}.tintmask.png"}
            if has_em: masks["emissive"] = f"atlases/{gkey}_emissive.png"
            atlases.append({"key": gkey, "image": f"atlases/{gkey}.png", "frameW": fw, "frameH": fh, "columns": c_, "rows": rows,
                            **({"pages": [{"scale": 2, "image": f"atlases/{gkey}@2x.png"}]} if hi else {}), "masks": masks})
            report.append((gkey, fw, fh, c_, rows, W1, H1, hi, bool(has_em)))
            for si, s in enumerate(ch):
                b0 = si * 8; state_atlas[s] = (gkey, b0)
                anims_by[s] = {"frames": [b0], "fps": 1, "directions": 8, "dirStride": 1, "loop": False}
                for d in range(8):
                    (_, att, vis) = fr[b0 + d]; fattach[(s, d)] = {n: {"x": x, "y": y} for n, (x, y) in sorted(att.items())}
                if s == "intact": fr0 = fr
        anchor = {"x": round(piv[0] / fw, 5), "y": round(piv[1] / fh, 5)}
        main_atlas = f"veh_art_{key}"; main_states = [s for s in states if state_atlas[s][0] == main_atlas]
        def sprite_for(skey, sts):
            an = {s: anims_by[s] for s in sts}; an = {"idle": dict(an["intact"]), **an} if "intact" in an else an
            fa = {str(anims_by[s]["frames"][0] + d): fattach[(s, d)] for s in sts for d in range(8)}
            return {"key": skey, "category": "vehicle", "atlas": state_atlas[sts[0]][0], "anchor": anchor, "animations": an,
                    "attach": fattach[(sts[0], 0)], "frameAttach": fa}
        state_sprites = {}
        for s in states:
            if state_atlas[s][0] != main_atlas: state_sprites[s] = f"{key}_st_{s}"
        lights = []
        for nm, kind, pos, nrm in m0.lights:
            spec = LIGHT_SPEC[kind]; per = []
            for d in range(8):
                (_, att, vis) = fr0[d]; per.append({"dir": DIRS[d], "x": att["light_" + nm][0], "y": att["light_" + nm][1], "visible": bool(vis[nm])})
            lights.append({"name": "light_" + nm, "kind": kind, "attach": "light_" + nm, **spec, "dirs": per})
        fam_name = {"bikes": "bicycle", "cars": "car", "vans": "van" if "van" in key else "truck", "campers": "camper", "trailers": "trailer", "trailers_small": "trailer"}[f]
        if key == "semi_tractor": fam_name = "semi"
        if key.startswith("truck_"): fam_name = "truck"
        if key.startswith("trailer_") or key.startswith("semi_trailer"): fam_name = "trailer"
        mt = {"family": fam_name, "states": main_states, "allStates": states,
              "spawnStates": [s for s in ("rusty", "wrecked", "damaged") if s in states],
              "footprintTiles": [round(m0.foot[0], 2), round(m0.foot[1], 2)], "attach": sorted(m0.attach.keys()),
              "seats": [n for n in ("driver", "seat", "seat_passenger", "seat_rear", "seat_rear_l", "seat_rear_r") if n in m0.attach],
              "scaleMode": "native", "targetPx": {"length": v["target"][0], "height": v["target"][1]},
              "tint": {"mask": "tintmask", "channel": "r", "neutral": 0.78, "formula": "out = base*mix(1, color/0.78, strength*mask)", "tintSet": "bike_paint" if f == "bikes" else "vehicle_paint", "defaultIndex": DEFAULT_PAINT.get(key, 0)},
              "lights": lights, "lightStates": LIGHT_STATES if lights else {},
              "emissiveGate": "lights_on" if lights else None,
              "stateVfx": STATE_VFX.get(fam_name, {}) if "exhaust" in m0.attach or fam_name == "trailer" else {},
              "sounds": SOUNDS_FOR.get(fam_name, {})}
        if state_sprites: mt["stateSprites"] = state_sprites
        if v["legacy"]: mt["aliases"] = v["legacy"]
        for skey in [key] + v["legacy"]:
            sprites.append(sprite_for(skey, main_states))
            meta.append({"key": skey, "sprite": skey, "atlas": main_atlas, **mt, **({"aliasOf": key} if skey != key else {})})
        for s, sk in state_sprites.items():
            sprites.append(sprite_for(sk, [s])); meta.append({"key": sk, "sprite": sk, "atlas": state_atlas[s][0], **mt, "states": [s], "stateOf": key})
    json.dump({"atlases": atlases, "sprites": sprites, "meta": meta, "report": report}, open(OUT + "/_vehicles_part.json", "w"))
    import pickle; pickle.dump({k: v for k, v in allframes.items()}, open("/tmp/veh_frames.pkl", "wb"))
    for r in report: print(r)

LIGHT_SPEC = {"headlight": {"color": "#fff1c9", "radius": 5.0, "intensity": 1.0, "cone": 0.6, "beam": "forward"},
              "taillight": {"color": "#ff3b30", "radius": 1.2, "intensity": 0.35, "beam": "backward"},
              "brake": {"color": "#ff2a1f", "radius": 1.6, "intensity": 0.5, "beam": "backward"},
              "porch": {"color": "#ffd99a", "radius": 2.5, "intensity": 0.7, "flicker": 0.03}}
LIGHT_STATES = {"off": {"*": 0.0},
                "on": {"headlight": 1.0, "taillight": 1.0, "brake": 0.4, "porch": 1.0},
                "brake": {"headlight": 1.0, "taillight": 2.2, "brake": 2.0, "porch": 1.0},
                "brake_lights_off": {"headlight": 0.0, "taillight": 2.2, "brake": 2.0, "porch": 0.0}}
DEFAULT_PAINT = {"car_compact": 4, "car_muscle": 0, "car_offroad": 8, "car_wagon": 5, "truck_pickup": 6, "truck_flatbed": 3, "van_passenger": 3, "van_cargo": 9,
                 "semi_tractor": 0, "trailer_camper": 5, "camper_rv": 7, "camper_van": 2, "bike_basic": 3, "bike_fat_tire": 7, "bike_cruiser": 5, "bike_trike": 8, "car_sedan": 2, "car_hatchback": 4, "car_sports": 0, "car_pickup": 6, "car_suv": 8, "van_minivan": 3, "van_delivery": 9, "truck_box": 1,
                 "truck_semi_cab": 0, "camper_trailer": 5, "camper_motorhome": 7, "bike_road": 0, "bike_mountain": 2, "bike_bmx": 4, "bike_cargo": 6, "bike_tandem": 1}
STATE_VFX = {"car": {"running": [{"vfx": "vehicle_exhaust", "attach": "exhaust"}], "damaged": [{"vfx": "vehicle_smoke_damaged", "attach": "engine"}], "wrecked": [{"vfx": "fire", "attach": "engine"}, {"vfx": "campfire_smoke", "attach": "engine"}], "burning": [{"vfx": "structure_fire", "attach": "roof"}]},
             "trailer": {"burning": [{"vfx": "fire", "attach": "cargo"}]}}
for k in ("van", "truck", "camper", "semi"): STATE_VFX[k] = STATE_VFX["car"]
SOUNDS_FOR = {"bicycle": {"bell": "sfx_vehicle_bike_bell", "crash": "sfx_vehicle_crash"},
              "car": {"start": "sfx_vehicle_engine_start", "idle": "sfx_vehicle_engine_idle", "horn": "sfx_vehicle_horn", "crash": "sfx_vehicle_crash", "door": "sfx_vehicle_door"}}
for k in ("van", "camper"): SOUNDS_FOR[k] = SOUNDS_FOR["car"]
for k in ("truck", "semi"): SOUNDS_FOR[k] = {**SOUNDS_FOR["car"], "horn": "sfx_vehicle_horn_truck", "idle": "sfx_vehicle_engine_idle_diesel"}
SOUNDS_FOR["trailer"] = {"crash": "sfx_vehicle_crash", "hitch": "sfx_vehicle_hitch"}

if __name__ == "__main__": main()
