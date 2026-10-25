"""ADR-135 off-hand: add anchors.handL (same pivot/convention as handR: x from frame centre, y from FEET) to every
df frameMeta entry of body_male/body_female, from the rig's left-hand pose. Usage: python3 hand_l_meta.py <engine>"""
import sys, os, json
sys.path.insert(0, os.path.dirname(__file__))
import render, rig, rerender
def main(eng):
    MP = os.path.join(eng, "packages/assets/pack/customization/manifest.customization.json"); m = json.load(open(MP)); n = 0; bad = 0
    for s in m["sprites"]:
        if not s["key"].startswith("body_"): continue
        j = rerender.JOBS[s["key"]]
        for a, an in s["animations"].items():
            for k, e in an.get("frameMeta", {}).items():
                i = int(k[3:]); f, d = divmod(i, an.get("directions", 1)); ra, fi, nn = rerender.rigframe(a, f)
                _, K = render.render_frame(j[1], j[2], j[3], d, ra, fi, nn, j[4]); h = K["anchorL"]; r = K["anchor"]
                if r and "handR" in e["anchors"] and abs(r["x"] - rig.FW / 2 - e["anchors"]["handR"]["x"]) > .02: bad += 1
                e["anchors"]["handL"] = {"x": round(h["x"] - rig.FW / 2, 2), "y": round(h["y"] - rig.FEET, 2), "angle": h["angle"], "len": h["len"], "behind": h["behind"]}; n += 1
    json.dump(m, open(MP, "w"), indent=1); open(MP, "a").write("\n"); print("handL entries", n, "handR mismatches", bad)
if __name__ == "__main__": main(sys.argv[1])
