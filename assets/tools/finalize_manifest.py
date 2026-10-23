"""Post-build manifest steps (also called from build_all.main):
 1. merge survival_fx/main_pack.patch.json (atlas masks shallow-merge, sprite sway/tints by key)
 2. drop keys claimed by survival_fx / pvp_clan (claim_totem) (survival_fx/key_claims.json 'emitted': e.g. campfire) so their art takes the gameplay key;
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
    M["sprites"] = [s for s in M["sprites"] if s["key"] not in DROP_FOR_SURVIVAL_FX and s["key"] not in DROP_FOR_PVP_CLAN]
    S = {s["key"]: s for s in M["sprites"]}
    for k, src in ALIASES.items():
        if k not in S and src in S: M["sprites"].append({**json.loads(json.dumps(S[src])), "key": k})
    return M

if __name__ == "__main__":
    f = os.path.join(ROOT, "manifest.json"); M = finalize(json.load(open(f)))
    json.dump(M, open(f, "w"), indent=1); print(len(M["sprites"]), "sprites")
