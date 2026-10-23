import json, os
R = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
b = json.load(open(os.path.join(R, "tools/_buildings.json"))); p = json.load(open(os.path.join(R, "tools/_props.json")))
for sp in b["sprites"]:
    cl = sp.pop("attachByState", {}).get("closed", {})
    sp["attach"] = {k: v for k, v in sp["attach"].items() if v.get("w", 1) > 0}
    mirr = lambda m: {k: dict(v, x=round(-v["x"], 1)) for k, v in m.items()}
    fa = {}
    for i in range(16):
        st_open = i >= 8; r1 = i % 2 == 1
        if st_open and r1: fa[str(i)] = mirr(sp["attach"])                       # baked mirror row: every point x-negated
        elif not st_open: fa[str(i)] = mirr(cl) if r1 else dict(cl)              # closed: sign/emblem move
        if not st_open and r1:  # closed + mirrored: slots/tags still need mirrored x so nothing stale is left
            fa[str(i)] = {**mirr(sp["attach"]), **mirr(cl)}
    sp["frameAttach"] = {k: v for k, v in fa.items() if v}
frag = {"version": 1, "name": "stalls", "$comment": "Trade stalls (player + clan). Paths relative to /workspace/assets. attach/frameAttach are typed engine fields (closed frames 0-7 override sign; renderer hides slotN/tagN contents when state=closed). 'tags' and 'stackArt' are provisional untyped hints.",
        "atlases": b["atlases"] + p["atlases"], "sprites": b["sprites"] + p["sprites"], "vfx": [
          {"key": "stall_sale_coins", "sprite": "coin", "anim": "idle", "lifetime": 0.8, "blend": "normal",
           "particles": {"rate": 0, "count": 5, "speed": [0.8, 1.6], "spread": 1.2, "gravity": 1.4, "fade": True, "scaleCurve": [0.6, 1, 0.8]}}]}
json.dump(frag, open(os.path.join(R, "manifest.fragment.json"), "w"), indent=1)
# pieces.proposed.json: empty (market_counter landed in ab09fa3)
print(len(frag["atlases"]), "atlases", len(frag["sprites"]), "sprites")
