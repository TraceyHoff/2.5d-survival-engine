"""Post-build manifest steps (also called from build_all.main):
 1. merge survival_fx/main_pack.patch.json (atlas masks shallow-merge, sprite sway/tints by key)
 2. rotationArt honesty (fix_rotation_art): sprites declaring 'mirror' but shipping 4 rows [r0, r1, r0, r1] become
    'unique4' (4 explicit rows, no runtime flip: r1 is re-rendered mirrored geometry with top-left lighting, and edge/opening/
    ridge/fence pieces keep their axis at rot 2/3), except MIRROR_OK pieces whose art survives a pixel flip -> 2 rows + 'mirror'.
 3. drop keys claimed by survival_fx / pvp_clan (claim_totem) (survival_fx/key_claims.json 'emitted': e.g. campfire) so their art takes the gameplay key;
    ids stay reserved in pack/ids.lock.json, so the claimed key keeps its numeric id."""
import json, os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# key_claims.json: campfire (approved move) + keys survival_fx already claimed (their animated heat/food art wins)
DROP_FOR_SURVIVAL_FX = ["campfire", "torch_stand", "lantern", "fireplace", "wood_stove", "windsock", "rot"]
# keys owned by the pvp_clan fragment (its two-tone tintmask art wins); id stays reserved in pack/ids.lock.json
DROP_FOR_PVP_CLAN = ["claim_totem"]
# alias -> source: gameplay keys and wave-1 keys both resolve (wave-1 keys keep their locked ids, gameplay keys get new ids)
ALIASES = {"stone_spear": "spear", "wooden_club": "club", "chest": "storage_box", "planter": "flower_box", "door": "door_wood"}
TINTS_LIKE = {"zombie_mummy": "zombie_walker", "zombie_pumpkin": "zombie_walker"}

# flat floor decals: no directional lighting or axis, so the engine's rot 2/3 = rows 0/1 + flipX looks right
MIRROR_OK = {"rug"}

def fix_rotation_art(sprites, mirror_ok):
    """4-row 'mirror' tables -> 2-row mirror (piece/key in mirror_ok) or 'unique4'. Applies to building.frames, building.states
    and animation rotations. Idempotent. Returns {key: new rotationArt} for changed sprites."""
    changed = {}
    for s in sprites:
        b = s.get("building")
        if not b or s.get("rotationArt", "mirror") != "mirror": continue
        tables = [b["frames"]] + list(b.get("states", {}).values())
        if not all(len(t) == 4 and t[2] == t[0] and t[3] == t[1] for t in tables): continue
        if b["piece"] in mirror_ok or s["key"] in mirror_ok:
            b["frames"] = b["frames"][:2]
            if "states" in b: b["states"] = {k: v[:2] for k, v in b["states"].items()}
            changed[s["key"]] = "mirror(2 rows)"
        else:
            s["rotationArt"] = "unique4"
            for a in s.get("animations", {}).values():
                if len(a.get("rotations", [])) == 2: a["rotations"] = a["rotations"] * 2
                elif len(a.get("rotations", [])) == 1: a["rotations"] = a["rotations"] * 4
            changed[s["key"]] = "unique4"
    return changed

def finalize(M):
    p = json.load(open(os.path.join(ROOT, "survival_fx", "main_pack.patch.json")))
    A = {a["key"]: a for a in M["atlases"]}; S = {s["key"]: s for s in M["sprites"]}
    for a in p.get("atlases", []):
        if a["key"] in A: A[a["key"]].setdefault("masks", {}).update(a.get("masks", {}))
    for s in p.get("sprites", []):
        if s["key"] in S:
            for f in ("sway", "tints"):
                if f in s: S[s["key"]][f] = s[f]
    for k, src in TINTS_LIKE.items():
        if k in S and "tints" in S.get(src, {}) and "tints" not in S[k]: S[k]["tints"] = S[src]["tints"]
    fix_rotation_art(M["sprites"], MIRROR_OK)
    M["sprites"] = [s for s in M["sprites"] if s["key"] not in DROP_FOR_SURVIVAL_FX and s["key"] not in DROP_FOR_PVP_CLAN]
    S = {s["key"]: s for s in M["sprites"]}
    for k, src in ALIASES.items():
        if k not in S and src in S: M["sprites"].append({**json.loads(json.dumps(S[src])), "key": k})
    return M

if __name__ == "__main__":
    f = os.path.join(ROOT, "manifest.json"); M = finalize(json.load(open(f)))
    json.dump(M, open(f, "w"), indent=1); print(len(M["sprites"]), "sprites")
