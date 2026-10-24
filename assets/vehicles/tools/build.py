"""Build SurVivaZ vehicle atlases + manifest.vehicles.json + previews.  python3 build.py <out_pack_vehicles_dir> <preview_dir>"""
import sys, os, json, math, numpy as np
from multiprocessing import Pool
from PIL import Image, ImageDraw
from vrender import *
from vehicles import FAMILIES, STATES
from effects import EFFECTS

OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/veh_out"; PREV = sys.argv[2] if len(sys.argv) > 2 else "/tmp/veh_prev"
PAD = 3  # >=2px transparent gutter per frame side is asserted below
MAXP = 2048
# atlas groups: family pages (frame size shared per atlas; vehicles never split across atlases)
GROUPS = [("veh_small", [("bikes", k) for k in range(5)] + [("trailers_small", 0)]),
          ("veh_cars", [("cars", k) for k in range(5)]),
          ("veh_vans", [("vans", 0), ("vans", 1)]),
          ("veh_trucks", [("vans", 2), ("vans", 3)]),
          ("veh_campers", [("campers", 0), ("campers", 1)]),
          ("veh_trailers", [("trailers", k) for k in range(4)])]

def model(fam, idx, st): return FAMILIES[fam][idx][1](st)

def shadow_poly(m, d, piv, k=SS):
    L, W = m.foot; cx, cy = getattr(m, "foot_c", (0, 0)); xf = None if getattr(m, "shadow_flat", False) else m.xf
    pts = [(cx + L / 2, cy + W / 2, 0), (cx + L / 2, cy - W / 2, 0), (cx - L / 2, cy - W / 2, 0), (cx - L / 2, cy + W / 2, 0)]
    out = []
    for p in pts: x, y, _ = project_point(p, d, xf); out.append(((x + piv[0]) * k, (y + piv[1]) * k))
    return out

def measure(args):
    fam, idx, st = args; m = model(fam, idx, st); res = []
    for d in range(8):
        mn, mx = render(m.prims, d, m.xf)
        sp = np.array(shadow_poly(m, d, (0, 0), 1)); mn = np.minimum(mn, sp.min(0) - 3); mx = np.maximum(mx, sp.max(0) + 3)
        res.append((mn.tolist(), mx.tolist()))
    return args, res

def render_frame(args):
    fam, idx, st, d, fw, fh, piv, seed = args; m = model(fam, idx, st)
    L = render(m.prims, d, m.xf, (fw, fh), piv)
    eff = EFFECTS[st]; img, tint, emi = finish(L, shadow_poly(m, d, piv), eff, seed=seed, pivot=piv, grass=(st == "rusty" and fam != "bikes"))
    if st == "rusty" and fam == "bikes": img = add_grass(img, shadow_poly(m, d, piv), seed)
    i2 = downs(img, SS // 2); i1 = downs(img, SS)
    a1 = np.asarray(i1)[..., 3] > 8
    t1 = np.asarray(downs(Image.fromarray((np.clip(tint, 0, 1) * 255).astype(np.uint8)), SS, Image.BOX)); t1 = np.where(a1, t1, 0).astype(np.uint8)
    e1 = np.asarray(downs(Image.fromarray(np.clip(emi, 0, 255).astype(np.uint8)), SS, Image.BOX))
    att = {}
    for n, p in m.attach.items():
        x, y, dep = project_point(p, d, m.xf); att[n] = (round(x, 2), round(y, 2))
    vis = {nm: facing_visible(nrm, d, m.xf) for nm, kind, pos, nrm in m.lights}
    return args[:4], np.asarray(i1), np.asarray(i2), t1, e1, att, vis

def main():
    os.makedirs(OUT + "/atlases", exist_ok=True); os.makedirs(PREV, exist_ok=True)
    pool = Pool(os.cpu_count())
    jobs = [(f, i, s) for g, mem in GROUPS for f, i in mem for s in STATES[f]]
    meas = dict(pool.map(measure, jobs))
    atlases, sprites, meta, report = [], [], [], []
    allframes = {}
    def geom(mem):
        ext = [math.inf, math.inf, -math.inf, -math.inf]
        for f, i in mem:
            for s in STATES[f]:
                for mn, mx in meas[(f, i, s)]: ext = [min(ext[0], mn[0]), min(ext[1], mn[1]), max(ext[2], mx[0]), max(ext[3], mx[1])]
        piv = (math.ceil(-ext[0]) + PAD, math.ceil(-ext[1]) + PAD)
        fw = piv[0] + math.ceil(ext[2]) + PAD; fh = piv[1] + math.ceil(ext[3]) + PAD
        n = sum(8 * len(STATES[f]) for f, i in mem); cols = min(MAXP // (fw * 2), n); rows = math.ceil(n / cols)
        while cols > 1 and math.ceil(n / (cols - 1)) == rows: cols -= 1
        return (rows * fh * 2 <= MAXP), cols * fw * rows * fh
    def partitions(xs):
        if not xs: yield []; return
        first, rest = xs[0], xs[1:]
        for p in partitions(rest):
            yield [[first]] + p
            for k in range(len(p)): yield p[:k] + [[first] + p[k]] + p[k + 1:]
    split = []
    for gkey, mem in GROUPS:
        best = None
        for p in partitions(mem):
            gs = [geom(c) for c in p]
            if not all(ok for ok, _ in gs): continue
            score = (len(p), sum(a for _, a in gs))
            if best is None or score < best[0]: best = (score, p)
        chunks = sorted(best[1], key=lambda c: mem.index(c[0]))
        for ci, c in enumerate(chunks): split.append((gkey if len(chunks) == 1 else f"{gkey}_{ci}", sorted(c, key=mem.index)))
    for gkey, mem in split:
        ext = [math.inf, math.inf, -math.inf, -math.inf]
        for f, i in mem:
            for s in STATES[f]:
                for mn, mx in meas[(f, i, s)]: ext = [min(ext[0], mn[0]), min(ext[1], mn[1]), max(ext[2], mx[0]), max(ext[3], mx[1])]
        piv = (math.ceil(-ext[0]) + PAD, math.ceil(-ext[1]) + PAD)
        fw = piv[0] + math.ceil(ext[2]) + PAD; fh = piv[1] + math.ceil(ext[3]) + PAD
        cols = MAXP // (fw * 2); nframes = sum(8 * len(STATES[f]) for f, i in mem); rows = math.ceil(nframes / cols)
        assert rows * fh * 2 <= MAXP, (gkey, fw, fh, cols, rows)
        cols = min(cols, nframes); rows = math.ceil(nframes / cols)
        # shrink columns so the page is as square-ish as possible without adding rows
        while cols > 1 and math.ceil(nframes / (cols - 1)) == rows: cols -= 1
        fjobs = []; fi = 0; layout = {}
        for f, i in mem:
            for s in STATES[f]:
                layout[(f, i, s)] = fi
                for d in range(8): fjobs.append((f, i, s, d, fw, fh, piv, hash((f, i, s)) % 1000 + d)); fi += 1
        results = pool.map(render_frame, fjobs)
        P1 = np.zeros((rows * fh, cols * fw, 4), np.uint8); P2 = np.zeros((rows * fh * 2, cols * fw * 2, 4), np.uint8)
        TM = np.zeros((rows * fh, cols * fw), np.uint8); EM = np.zeros((rows * fh, cols * fw, 3), np.uint8)
        fr = {}
        for k, (key4, i1, i2, t1, e1, att, vis) in enumerate(results):
            c, r = k % cols, k // cols
            i1 = i1.copy(); i2 = i2.copy(); t1 = t1.copy(); e1 = e1.copy()
            for arr, g in ((i1, 2), (i2, 4), (t1, 2), (e1, 2)): arr[:g] = 0; arr[-g:] = 0; arr[:, :g] = 0; arr[:, -g:] = 0  # guaranteed 2px gutter
            P1[r * fh:(r + 1) * fh, c * fw:(c + 1) * fw] = i1; P2[r * fh * 2:(r + 1) * fh * 2, c * fw * 2:(c + 1) * fw * 2] = i2
            TM[r * fh:(r + 1) * fh, c * fw:(c + 1) * fw] = t1; EM[r * fh:(r + 1) * fh, c * fw:(c + 1) * fw] = e1
            fr[k] = (key4, att, vis); allframes[(gkey, k)] = (key4, i1, i2, t1, e1)
        Image.fromarray(P1).save(f"{OUT}/atlases/{gkey}.png", optimize=True)
        Image.fromarray(P2).save(f"{OUT}/atlases/{gkey}@2x.png", optimize=True)
        Image.fromarray(TM, "L").save(f"{OUT}/atlases/{gkey}.tintmask.png", optimize=True)
        has_em = EM.max() > 0
        if has_em: Image.fromarray(EM).save(f"{OUT}/atlases/{gkey}_emissive.png", optimize=True)
        masks = {"tintmask": f"atlases/{gkey}.tintmask.png"}
        if has_em: masks["emissive"] = f"atlases/{gkey}_emissive.png"
        atlases.append({"key": gkey, "image": f"atlases/{gkey}.png", "frameW": fw, "frameH": fh, "columns": cols, "rows": rows,
                        "pages": [{"scale": 2, "image": f"atlases/{gkey}@2x.png"}], "masks": masks})
        report.append((gkey, fw, fh, cols, rows, bool(has_em)))
        for f, i in mem:
            key = FAMILIES[f][i][0]; m0 = model(f, i, "intact")
            anims = {}; fattach = {}
            for s in STATES[f]:
                b = layout[(f, i, s)]; anims[s] = {"frames": [b], "fps": 1, "directions": 8, "dirStride": 1, "loop": False}
                for d in range(8):
                    (_, att, vis) = fr[b + d]; fattach[str(b + d)] = {n: {"x": x, "y": y} for n, (x, y) in sorted(att.items())}
            anims = {"idle": dict(anims["intact"]), **anims}
            b0 = layout[(f, i, "intact")]
            sprites.append({"key": key, "category": "item", "atlas": gkey, "anchor": {"x": round(piv[0] / fw, 5), "y": round(piv[1] / fh, 5)},
                            "animations": anims, "attach": fattach[str(b0)], "frameAttach": fattach})
            lights = []
            for nm, kind, pos, nrm in m0.lights:
                spec = LIGHT_SPEC[kind]; per = []
                for d in range(8):
                    (_, att, vis) = fr[b0 + d]; per.append({"dir": DIRS[d], "x": att["light_" + nm][0], "y": att["light_" + nm][1], "visible": bool(vis[nm])})
                lights.append({"name": "light_" + nm, "kind": kind, "attach": "light_" + nm, **spec, "dirs": per})
            fam_name = {"bikes": "bicycle", "cars": "car", "vans": "van" if "van" in key else "truck", "campers": "camper", "trailers": "trailer", "trailers_small": "trailer"}[f]
            if key == "truck_semi_cab": fam_name = "semi"
            meta.append({"key": key, "sprite": key, "family": fam_name, "atlas": gkey, "states": STATES[f],
                         "spawnStates": [s for s in ("rusty", "wrecked", "damaged") if s in STATES[f]],
                         "footprintTiles": [round(m0.foot[0], 2), round(m0.foot[1], 2)], "attach": sorted(m0.attach.keys()),
                         "seats": [n for n in ("driver", "seat", "seat_passenger", "seat_rear", "seat_rear_l", "seat_rear_r") if n in m0.attach],
                         "tint": {"mask": "tintmask", "channel": "r", "neutral": 0.78, "formula": "out = base*mix(1, color/0.78, strength*mask)", "tintSet": "bike_paint" if f == "bikes" else "vehicle_paint", "defaultIndex": DEFAULT_PAINT.get(key, 0)},
                         "lights": lights, "lightStates": LIGHT_STATES if lights else {},
                         "emissiveGate": "lights_on" if lights else None,
                         "stateVfx": STATE_VFX.get(fam_name, {}) if "exhaust" in m0.attach or fam_name == "trailer" else {},
                         "sounds": SOUNDS_FOR.get(fam_name, {})})
    json.dump({"atlases": atlases, "sprites": sprites, "meta": meta, "report": report}, open(OUT + "/_vehicles_part.json", "w"))
    import pickle; pickle.dump({k: v for k, v in allframes.items()}, open("/tmp/veh_frames.pkl", "wb"))
    print(report)

LIGHT_SPEC = {"headlight": {"color": "#fff1c9", "radius": 5.0, "intensity": 1.0, "cone": 0.6, "beam": "forward"},
              "taillight": {"color": "#ff3b30", "radius": 1.2, "intensity": 0.35, "beam": "backward"},
              "brake": {"color": "#ff2a1f", "radius": 1.6, "intensity": 0.5, "beam": "backward"},
              "porch": {"color": "#ffd99a", "radius": 2.5, "intensity": 0.7, "flicker": 0.03}}
LIGHT_STATES = {"off": {"*": 0.0},
                "on": {"headlight": 1.0, "taillight": 1.0, "brake": 0.4, "porch": 1.0},
                "brake": {"headlight": 1.0, "taillight": 2.2, "brake": 2.0, "porch": 1.0},
                "brake_lights_off": {"headlight": 0.0, "taillight": 2.2, "brake": 2.0, "porch": 0.0}}
DEFAULT_PAINT = {"car_sedan": 2, "car_hatchback": 4, "car_sports": 0, "car_pickup": 6, "car_suv": 8, "van_minivan": 3, "van_delivery": 9, "truck_box": 1,
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
