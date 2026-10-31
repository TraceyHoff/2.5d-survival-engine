#!/usr/bin/env python3
"""ADR-244 follow-up: `sleep_lie` / `sleep_lie_under` for every v1 accessory + hands sprite (v2_sleep_lie.ACC kinds).
The v2 sample (v2s_) paper-doll keeps the v1 accessory/hands sprites (no V2S alias), and the engine's shared chain anim
only lies flat when every worn layer has the anim -> each cz_acc_* / cz_hands_gear_* sprite gets the two anims as
dirFrames on ONE streamed atlas per look (cz_sleep_acc_<kind>, shared by male/female and acc_/hands_gear_ twins), added
under the existing v1 keys. v1 atlases/frames/anims are untouched (only the two new anim entries + new atlases).
Same set as the v2 body: 4 directions = bed rotation r, NF frames, frame*4+r, pivot = bed footprint centre.
Bags/packs are off in bed (one blank frame). Usage: python3 add_sleep_lie_acc.py [--jobs N]
  then: python3 assets/tools/ktx2.py packages/assets/pack/customization/manifest.customization.json"""
import sys, os, re, argparse
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from multiprocessing import Pool
import v2_sleep_lie as SL, v2_sample as VS
import importlib.util as _iu
_spec = _iu.spec_from_file_location("cz_manifest", os.path.join(HERE, "../../../packages/assets/scripts/cz_manifest.py"))
czm = _iu.module_from_spec(_spec); _spec.loader.exec_module(czm)
ROOT = os.path.abspath(os.path.join(HERE, "../../..")); D = os.path.join(ROOT, "packages/assets/pack/customization")
MP = os.path.join(D, "manifest.customization.json")
BAGS = {"backpack", "satchel", "gear_reed_satchel", "gear_leather_backpack", "gear_frame_pack", "gear_tactical_pack"}

def kind_of(sprite_key):
    """cz_acc_<style>_<bt> / cz_hands_gear_<style>_<bt> -> ACC kind (None = not an accessory/hands sprite)"""
    m = re.fullmatch(r"cz_(?:acc|hands)_(?:gear_)?(.+)_(male|female)", sprite_key)
    if not m: return None
    st = m.group(1)
    if st in BAGS or sprite_key.replace("cz_acc_", "").rsplit("_", 1)[0] in BAGS: return "bag"
    return st if st in SL.ACC else None

def job(a): return SL.frame_job(a)

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--jobs", type=int, default=os.cpu_count()); A = ap.parse_args()
    m = czm.load(MP); W = {w["key"]: w for w in m["wearables"]}
    targets = {}
    for w in m["wearables"]:
        if w.get("slot") not in ("accessory", "hands"): continue
        for b in w["bodies"].values():
            k = kind_of(b["sprite"]); assert k, b["sprite"]; targets[b["sprite"]] = k
    kinds = sorted(set(targets.values()))
    with Pool(A.jobs) as pool:
        RS = pool.map(job, [(r, fi, (k,)) for k in kinds for fi in range(SL.NF) for r in range(SL.ROTS)])
    by_kind = {}
    for (r, fi, res, anc), (k, _fi, _r) in zip(RS, [(k, fi, r) for k in kinds for fi in range(SL.NF) for r in range(SL.ROTS)]):
        by_kind.setdefault(k, []).append((r, fi, res, anc))
    keys = {a["key"] for a in m["atlases"]}; S = {s["key"]: s for s in m["sprites"]}; sets = {}
    for k in kinds:
        ak = "cz_sleep_acc_" + k
        atlas, sp = VS.sleep_set(k, k, by_kind[k], ak=ak, out=D)
        atlas["placeholder"] = None   # nothing while streaming (the bed hides it a frame)
        if ak in keys: m["atlases"] = [atlas if a["key"] == ak else a for a in m["atlases"]]
        else: m["atlases"].append(atlas)
        sets[k] = sp; print(f"{ak}: {sp['page']['uniqueFrames']}/{sp['total']} unique, page {sp['page']['pages1x'][0]*2}x{sp['page']['pages1x'][1]*2} @2x", flush=True)
    for sk, k in sorted(targets.items()):
        an = S[sk]["animations"]
        for a in SL.ANIMS: an[a] = sets[k]["anims"][a]
    czm.save(MP, m)
    print("sprites", len(targets), "kinds", len(kinds), flush=True)
    for sk, k in sorted(targets.items()): print(" ", sk, "->", k)

if __name__ == "__main__": main()
