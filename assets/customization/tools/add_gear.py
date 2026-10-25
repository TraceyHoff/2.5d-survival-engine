#!/usr/bin/env python3
"""ADR-135 gear: append NEW catalog wearables (catalog.GEAR keys not yet in the pack) as manifest stubs (wearable entries
from build_all.fragment, sprite anim structure cloned from a same-slot template sprite), then render + tight-pack them with
rerender.py (every facing x every anim: idle/walk/run/gather/attack/hit/death/sit/swim/punch/harvest/chop/mine/drink/eat)
and mark their cz_wr_<key> pages residency "stream" with the resident placeholder sprite PLACEHOLDER[key] (same slot).
Usage: python3 add_gear.py ENGINE_DIR [--jobs 8]   then: assets/tools/ktx2.py <manifest> ; lock:ids:pack ; pnpm check"""
import sys, os, json, copy
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import build_all, catalog, rerender, rectpack
import importlib.util as _iu, os as _os  # ADR-138: manifest may be a v2 shard index
_spec = _iu.spec_from_file_location("cz_manifest", _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "../../../packages/assets/scripts/cz_manifest.py"))
czm = _iu.module_from_spec(_spec); _spec.loader.exec_module(czm)
TEMPLATE = {"accessory": "acc_satchel", "hands": "acc_cloth_gloves", "hat": "hat_viking", "top": "top_vest", "bottom": "bottom_cargo", "shoes": "shoes_boots"}
PLACEHOLDER = {"acc_cloth_gloves": None, "acc_leather_gloves": None, "acc_fur_mittens": None, "acc_gauntlets": None}   # gloves: nothing while loading
def placeholder(key):
    if key in PLACEHOLDER: return PLACEHOLDER[key]
    return catalog.GEAR_PH.get(key)
def stream_pages(m, keys):
    W = {w["key"]: w for w in m["wearables"]}; n = 0
    for k in keys:
        pages = {a["key"] for a in m["atlases"] if a["key"] == rectpack.PFX + k or a["key"].startswith(rectpack.PFX + k + "_")}
        ph = placeholder(k)
        for a in m["atlases"]:
            if a["key"] in pages:
                a["residency"] = "stream"; n += 1
                if ph is None: a["placeholder"] = None
        if ph:   # sprite-level placeholder: the same-body resident placeholder wearable sprite (per layer)
            P = W[ph]; layers = W[k].get("layers") or [W[k]]; pl = P.get("layers") or [P]
            for li, L in enumerate(layers):
                for bt, b in L["bodies"].items():
                    s = next(s for s in m["sprites"] if s["key"] == b["sprite"]); s["placeholder"] = pl[min(li, len(pl) - 1)]["bodies"][bt]["sprite"]
    return n
def main(eng, jobs):
    D = os.path.join(eng, "packages/assets/pack/customization"); MP = os.path.join(D, "manifest.customization.json")
    m = czm.load(MP); have = {w["key"] for w in m["wearables"]}
    new = [w for w in catalog.W if w[0] in catalog.GEAR and w[0] not in have]
    if new:
        frag = build_all.fragment(build_all.jobs()); FW = {w["key"]: w for w in frag["wearables"]}; S = {s["key"]: s for s in m["sprites"]}
        for key, slot, spec, kw in new:
            w = FW[key]; m["wearables"].append(w); t = TEMPLATE[slot]
            for bt in build_all.BODIES:
                for suf in ([""] + (["_sleeves"] if build_all.split(slot, spec) else [])):
                    s = copy.deepcopy(S[f"cz_{t}_{bt}{suf}"]); s["key"] = f"cz_{key}_{bt}{suf}"; s.pop("placeholder", None)
                    for an in s["animations"].values(): an.pop("frameMeta", None)
                    m["sprites"].append(s)
        sp = os.path.join(D, "strings", "en.json"); st = json.load(open(sp))
        for w in new: st[f"cosmetic.{w[0]}"] = build_all.STR[f"cosmetic.{w[0]}"]
        json.dump(dict(sorted(st.items())), open(sp, "w"), indent=1)
        czm.save(MP, m)
        slots = sorted({w[1] for w in new})
        rerender.main(eng, [f"cz_{w[0]}_" for w in new], slots, rectpack.ALL_TIGHT, jobs)
        m = czm.load(MP)
    n = stream_pages(m, [k for k in catalog.GEAR])
    czm.save(MP, m); print("gear wearables added", len(new), "stream pages", n, flush=True)
if __name__ == "__main__":
    a = sys.argv; main(a[1], int(a[a.index("--jobs") + 1]) if "--jobs" in a else 8)
