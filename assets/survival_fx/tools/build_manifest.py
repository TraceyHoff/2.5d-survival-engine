"""Collect build/*.json into manifest.fragment.json (engine manifest v1, typed fields from engine 0b9e0c8 / §13:
atlas pages + masks, sprite sway + tints; no x_survival) and main_pack.patch.json (typed masks/sway/tints for the
main pack's own atlases and sprites, merged by the main-pack worker). Fails on key collisions with the main manifests.
Gameplay keys (pieces.json / items.json) are claimed when free; if the main pack already owns one, the sprite is
emitted under a fallback key and recorded in key_claims.json, and claimed automatically once the key is free."""
import json, os, sys, glob
from fxlib import ROOT, OUT_BUILD
PREFIX = "survival_fx/atlases/"   # image paths relative to /workspace/assets (same base as the main manifest)

def P(rate, count, speed, spread, gravity, fade=True, scale=(1, 0.7, 0)):
    return {"rate": rate, "count": count, "speed": list(speed), "spread": spread, "gravity": gravity, "fade": fade, "scaleCurve": list(scale)}

VFX = [
 # heat
 {"key": "heat_embers", "sprite": "fx_ember", "anim": "idle", "lifetime": 1.6, "blend": "additive", "particles": P(6, 0, (0.3, 0.9), 0.5, -0.45, True, (1, 0.8, 0))},
 {"key": "heat_spark_burst", "sprite": "fx_fire_spark", "anim": "idle", "lifetime": 0.5, "blend": "additive", "particles": P(0, 8, (1.0, 2.2), 1.2, 0.6, True, (1, 0.5, 0))},
 {"key": "heat_smoke", "sprite": "fx_smoke_puff", "anim": "idle", "lifetime": 2.6, "blend": "normal", "particles": P(1.6, 0, (0.15, 0.35), 0.25, -0.18, True, (0.6, 1.0, 1.4))},
 {"key": "heat_chimney_smoke", "sprite": "fx_smoke_puff", "anim": "idle", "lifetime": 3.2, "blend": "normal", "particles": P(0.9, 0, (0.15, 0.3), 0.2, -0.15, True, (0.7, 1.1, 1.6))},
 {"key": "heat_ring_pulse", "sprite": "fx_heat_ring", "anim": "idle", "lifetime": 1.4, "blend": "additive"},
 # status (renderer spawns at the character; rates scale with intensity, see render_tuning.json)
 {"key": "status_drips", "sprite": "fx_drip", "anim": "idle", "lifetime": 0.4, "blend": "normal", "particles": P(1.5, 0, (0.0, 0.1), 0.3, 1.2, True, (1, 1, 0.8))},
 {"key": "status_feet_splash", "sprite": "fx_splash_feet", "anim": "idle", "lifetime": 0.42, "blend": "normal"},
 {"key": "status_breath", "sprite": "fx_breath_puff", "anim": "idle", "lifetime": 0.6, "blend": "normal"},
 {"key": "status_sweat", "sprite": "fx_sweat_drop", "anim": "idle", "lifetime": 0.4, "blend": "normal", "particles": P(1.0, 0, (0.2, 0.5), 0.8, 0.9, True, (1, 1, 0.7))},
 {"key": "status_tired_spiral", "sprite": "fx_tired_spiral", "anim": "idle", "lifetime": 2.0, "blend": "normal"},
 {"key": "status_sweat_swirl", "sprite": "fx_sweat_swirl", "anim": "idle", "lifetime": 2.0, "blend": "normal"},
 {"key": "status_zzz", "sprite": "fx_zzz", "anim": "idle", "lifetime": 2.4, "blend": "normal"},
 {"key": "emote_hungry", "sprite": "fx_bubble_hungry", "anim": "idle", "lifetime": 2.0, "blend": "normal"},
 {"key": "emote_freezing", "sprite": "fx_bubble_freezing", "anim": "idle", "lifetime": 2.0, "blend": "normal"},
 {"key": "emote_overheating", "sprite": "fx_bubble_overheating", "anim": "idle", "lifetime": 2.0, "blend": "normal"},
 {"key": "emote_exhausted", "sprite": "fx_bubble_exhausted", "anim": "idle", "lifetime": 2.0, "blend": "normal"},
 # wind
 {"key": "wind_leaves_green", "sprite": "fx_wind_leaf_green", "anim": "idle", "lifetime": 4.0, "blend": "normal", "particles": P(1.2, 0, (0.8, 1.8), 0.6, 0.08, True, (1, 1, 0.6))},
 {"key": "wind_leaves_autumn", "sprite": "fx_wind_leaf_autumn", "anim": "idle", "lifetime": 4.0, "blend": "normal", "particles": P(1.2, 0, (0.8, 1.8), 0.6, 0.08, True, (1, 1, 0.6))},
 {"key": "wind_petals_pink", "sprite": "fx_wind_petal_pink", "anim": "idle", "lifetime": 4.5, "blend": "normal", "particles": P(1.6, 0, (0.6, 1.4), 0.7, 0.05, True, (1, 1, 0.5))},
 {"key": "wind_petals_white", "sprite": "fx_wind_petal_white", "anim": "idle", "lifetime": 4.5, "blend": "normal", "particles": P(1.6, 0, (0.6, 1.4), 0.7, 0.05, True, (1, 1, 0.5))},
 {"key": "wind_dust_gust", "sprite": "fx_dust_gust", "anim": "idle", "lifetime": 0.6, "blend": "normal", "particles": P(0, 3, (1.5, 2.5), 0.3, 0.0, True, (0.8, 1.1, 1.3))},
 {"key": "wind_streaks", "sprite": "fx_wind_streak", "anim": "idle", "lifetime": 0.67, "blend": "normal", "particles": P(0.8, 0, (2.0, 3.5), 0.15, 0.0, True, (1, 1, 1))},
 # weather
 {"key": "weather_splash_crown", "sprite": "fx_rain_splash_crown", "anim": "idle", "lifetime": 0.36, "blend": "normal"},
 {"key": "weather_snowflakes", "sprite": "fx_snowflake", "anim": "idle", "lifetime": 6.0, "blend": "normal", "particles": P(20, 0, (0.2, 0.5), 0.8, 0.12, True, (1, 1, 0.6))},
 {"key": "weather_lightning", "sprite": "fx_lightning_bolt", "anim": "strike_a", "lifetime": 0.22, "blend": "additive"},
 {"key": "weather_rainbow", "sprite": "fx_rainbow", "anim": "idle", "lifetime": 30.0, "blend": "normal"},
 # food / night
 {"key": "food_flies", "sprite": "fx_flies", "anim": "idle", "lifetime": 1.0, "blend": "normal"},
 {"key": "food_stink", "sprite": "food_overlay_stink", "anim": "idle", "lifetime": 1.0, "blend": "normal"},
 {"key": "night_fireflies", "sprite": "fx_firefly_glow", "anim": "idle", "lifetime": 6.0, "blend": "additive", "particles": P(0.6, 0, (0.05, 0.25), 6.28, -0.02, True, (0.6, 1, 1, 0.6))},
]

MAIN_MANIFESTS = ["/workspace/assets/manifest.json", "/workspace/engine/packages/assets/pack/manifest.json"]
FALLBACK = "surv_{}"   # used only when a gameplay key is already taken by the main pack

# sway proposals for the main pack's sprites (amp px at sprite top, freq Hz, stiffness 0..1, higher = stiffer);
# the per-pixel weight comes from the atlas-level masks.sway page (make_sway_mask.py), so no sway.mask needed here.
MAIN_SWAY = {
 "tree": (2.2, 0.35, 0.6), "tree_apple": (2.0, 0.33, 0.62), "tree_autumn": (2.3, 0.36, 0.58), "tree_pine": (1.4, 0.28, 0.78),
 "tree_twisty": (2.6, 0.24, 0.45), "bush": (0.9, 0.5, 0.7), "berry_bush": (0.9, 0.5, 0.7), "fiber_grass": (1.8, 0.85, 0.28),
 "flowers": (1.2, 0.95, 0.38), "mushrooms": (0.3, 0.4, 0.9), "glow_mushrooms": (0.35, 0.4, 0.9),
}
OWN_SWAY = {"prop_glow_mushroom_a": (0.4, 0.45, 0.85), "prop_glow_mushroom_b": (0.4, 0.5, 0.85), "prop_glow_mushroom_c": (0.4, 0.55, 0.85),
            "prop_flag": (0.0, 0.0, 1.0)}
def sw(t): return {"amp": t[0], "freq": t[1], "stiffness": t[2]}
# status tints for every character/zombie sprite; strength = value at max level (3 / fully exhausted), scale linearly at runtime
STATUS_TINTS = {"wet": {"color": "#ccd9f7", "strength": 0.9, "mode": "multiply"},
                "frost": {"color": "#cfe8ff", "strength": 0.35, "mode": "screen"},
                "flush": {"color": "#ff8a7a", "strength": 0.15, "mode": "lerp"},
                "exhausted": {"color": "#b8b4c8", "strength": 0.22, "mode": "lerp"}}
SHEEN_ATLAS = ("characters", "zombies")   # atlas key prefixes that get <atlas>_sheen.png
SWAY_ATLAS = ("resources_tall", "resources")

def main_manifests():
    out = []
    for p in MAIN_MANIFESTS:
        if os.path.exists(p): out.append((p, json.load(open(p))))
    return out

def main():
    parts, textures = [], []
    for f in sorted(glob.glob(os.path.join(OUT_BUILD, "*.json"))):
        d = json.load(open(f)); parts += d["parts"]; textures += d["textures"]
    mains = main_manifests()
    taken = {k: set() for k in ("atlases", "sprites", "vfx")}
    for _, m in mains:
        for kind in taken: taken[kind] |= {x["key"] for x in m.get(kind, [])}
    gameplay = set()
    gp = "/workspace/engine/packages/gameplay/data"
    for f, path in (("pieces.json", "pieces"), ("items.json", "items")):
        if os.path.exists(os.path.join(gp, f)): gameplay |= {x["key"] for x in json.load(open(os.path.join(gp, f)))[path]}
    gameplay |= {"fireplace", "wood_stove", "windsock"}   # requested by Survival Systems, not yet in pieces.json
    claims = {"claimed": [], "emitted": {}, "blockedBy": {}}
    atlases, sprites = [], []
    for p in parts:
        a = dict(p["atlas"]); a["image"] = PREFIX + a["image"]
        a["pages"] = [{"scale": 2, "image": PREFIX + p["hiDpi"][a["key"]].split("/")[-1]}]
        if a.pop("emissive", False): a["masks"] = {"emissive": True}
        atlases.append(a)
        for s0 in p["sprites"]:
            s = dict(s0); k = s["key"]
            if k in gameplay:
                if k in taken["sprites"]:
                    s["key"] = FALLBACK.format(k); claims["emitted"][k] = s["key"]
                    claims["blockedBy"][k] = [mp for mp, m in mains if any(x["key"] == k for x in m["sprites"])]
                else: claims["claimed"].append(k)
            if k in OWN_SWAY: s["sway"] = sw(OWN_SWAY[k])
            sprites.append(s)
    for s in sprites:   # ADR-078: puddles are free-standing ground decals (size variants, no neighbor autotile)
        if s["key"].startswith("tile_ov_puddle_"): s["category"] = "decal"
    keys = {s["key"] for s in sprites}
    vfx = [dict(v, sprite=claims["emitted"].get(v["sprite"], v["sprite"])) for v in VFX]
    for v in vfx: assert v["sprite"] in keys, v
    frag = {"version": 1, "name": "survival_fx", "atlases": atlases, "sprites": sprites, "vfx": vfx}
    for kind in ("atlases", "sprites", "vfx"):
        clash = taken[kind] & {x["key"] for x in frag[kind]}
        if clash: sys.exit(f"key collision in {kind}: {sorted(clash)}")
    for a in atlases: assert a["columns"] * a["frameW"] <= 2048 and a["rows"] * a["frameH"] <= 2048
    for s in sprites:
        a = next(x for x in atlases if x["key"] == s["atlas"]); tot = a["columns"] * a["rows"]
        for an in s["animations"].values(): assert all(0 <= f < tot for f in an["frames"]) and an["fps"] > 0, s["key"]
    json.dump(frag, open(os.path.join(ROOT, "manifest.fragment.json"), "w"), indent=1)
    # ---- typed patch for the main pack (its atlases/sprites; masks live next to their atlases) ----
    ref = mains[0][1] if mains else {"atlases": [], "sprites": []}
    pa = []
    for a in ref["atlases"]:
        stem = a["image"].rsplit(".", 1)[0]; masks = {}
        if a["key"].startswith(SHEEN_ATLAS): masks["sheen"] = stem + "_sheen.png"
        if a["key"] in SWAY_ATLAS: masks["sway"] = stem + "_sway.png"
        if masks: pa.append({"key": a["key"], "masks": masks})
    ps = []
    for s in ref["sprites"]:
        e = {}
        if s["key"] in MAIN_SWAY: e["sway"] = sw(MAIN_SWAY[s["key"]])
        if s["category"] in ("character", "zombie"): e["tints"] = STATUS_TINTS
        if e: ps.append({"key": s["key"], **e})
    patch = {"$comment": "Typed fields for the MAIN pack's own entries (engine 0b9e0c8, ARCHITECTURE §13). Merge key-by-key into "
                         "/workspace/assets/manifest.json: atlases[].masks (shallow-merge), sprites[].sway / sprites[].tints. Mask pages are "
                         "written next to each atlas by survival_fx/tools/make_sheen_mask.py and make_sway_mask.py (default output dir = the atlas's "
                         "folder) during the main-pack build. Tint strength = value at max status level; scale linearly at runtime.",
             "atlases": pa, "sprites": ps,
             "maskCommands": ["python survival_fx/tools/make_sheen_mask.py " + " ".join(a["image"] for a in ref["atlases"] if a["key"].startswith(SHEEN_ATLAS)),
                              "python survival_fx/tools/make_sway_mask.py " + " ".join(a["image"] for a in ref["atlases"] if a["key"] in SWAY_ATLAS)]}
    json.dump(patch, open(os.path.join(ROOT, "main_pack.patch.json"), "w"), indent=1)
    claims["$comment"] = ("Gameplay keys this pack provides art for. 'emitted' maps a gameplay key to the fallback key used because the main pack "
                          "already has a sprite with that key; the build claims the key automatically once it is free.")
    claims["textures"] = sorted(set("survival_fx/" + t for t in textures))
    json.dump(claims, open(os.path.join(ROOT, "key_claims.json"), "w"), indent=1)
    print(f"manifest.fragment.json: {len(atlases)} atlases, {len(sprites)} sprites, {len(vfx)} vfx; claimed {claims['claimed']}; fallback {claims['emitted']}")
    print(f"main_pack.patch.json: {len(pa)} atlas mask entries, {len(ps)} sprite entries")

if __name__ == "__main__": main()
