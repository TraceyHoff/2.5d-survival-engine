"""Assemble manifest.vehicles.json from build parts."""
import json, sys, os
OUT = sys.argv[1]
part = json.load(open(OUT + "/_vehicles_part.json")); inter = json.load(open(OUT + "/_interior_part.json"))
sounds = json.load(open(OUT + "/_sounds_part.json")); paint = json.load(open(OUT + "/_paint.json"))
sprites = []
for sp, meta in zip(part["sprites"], part["meta"]):
    col = paint[meta["tint"]["tintSet"]][meta["tint"]["defaultIndex"]]
    sprites.append({**sp, "tints": {"paint": {"color": col, "strength": 1, "mode": "multiply"}}})
sprites += inter["sprites"]
vfx = [{"key": "vehicle_exhaust", "sprite": "fx_smoke", "anim": "idle", "lifetime": 0.9, "blend": "normal",
        "particles": {"rate": 6, "count": 0, "speed": [0.2, 0.5], "spread": 0.5, "gravity": -0.25, "fade": True, "scaleCurve": [0.25, 0.5, 0.7]}},
       {"key": "vehicle_smoke_damaged", "sprite": "fx_smoke", "anim": "idle", "lifetime": 2.0, "blend": "normal",
        "particles": {"rate": 3, "count": 0, "speed": [0.3, 0.7], "spread": 0.5, "gravity": -0.35, "fade": True, "scaleCurve": [0.5, 1.0, 1.5]}}]
meta = part["meta"]
for k, base in (("camper_interior_floor", None), ("camper_interior_wall", None), ("camper_craft_bench", "craft_station"), ("camper_cook_stove", "cook_station")):
    pass
man = {"version": json.load(open(sys.argv[2]))["version"], "name": "survivaz-vehicles",
       "atlases": part["atlases"] + [inter["atlas"]], "sprites": sprites, "sounds": sounds, "vfx": vfx,
       "tintSets": [{"key": "vehicle_paint", "tints": paint["vehicle_paint"]}, {"key": "bike_paint", "tints": paint["bike_paint"]}],
       "vehicles": meta}
json.dump(man, open(OUT + "/manifest.vehicles.json", "w"), separators=(",", ":"))
print(len(sprites), len(man["atlases"]), os.path.getsize(OUT + "/manifest.vehicles.json"))
