#!/usr/bin/env python3
"""Player skin tones (realistic human range only), source of truth for the v1 + v2 body R-tint.

python3 skin_tones.py            -> writes packages/assets/pack/customization/skin_tones.json and patches `skinTones`
                                    in the customization manifest (cz_manifest.save re-shards -> base shard) (same bytes for the same inputs)

How skin is shaded (both v1 body_* and v2 v2s_body_* sheets, measured): the body art is cel-shaded greyscale under a
flat 0/1 tintmask R; shade/highlight are BAKED into the art values (no ramp in the renderer):
  base (196,184,204), shade (140,122,150), highlight (236,230,236), shine (255,255,255), outline (96,70,90)
and the renderer multiplies:  out = art * color / tintNeutral  (tintNeutral 0.78 -> 198.9).
So `color` is the tint INPUT, pre-compensated so the art's base level lands exactly on ramp.base on screen.
ramp.{base,shadow,highlight} are the intended on-screen cel colours (shadow warmer/more saturated, highlight
lighter/less saturated, as real skin shades); `mulShadow` / `mulHighlight` are what today's multiply path draws.
A ramp-aware tint (art band -> ramp entry) can use `ramp` directly; until then `color` is what ships.
"""
import json, os, colorsys
HERE = os.path.dirname(os.path.abspath(__file__)); ENGINE = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
PACK = os.path.join(ENGINE, "packages/assets/pack/customization")
NEUTRAL = 0.78 * 255
ART = {"base": (196, 184, 204), "shade": (140, 122, 150), "highlight": (236, 230, 236)}

# key, on-screen base, undertone, Monk Skin Tone (1..10), Fitzpatrick (I..VI). Light -> deep (checked: L* strictly decreasing).
TONES = [
    ("porcelain",   "#f6e3da", "cool",    1, "I"),
    ("ivory",       "#f3e4cf", "neutral", 1, "I"),
    ("peach",       "#f2d4bb", "warm",    2, "I-II"),
    ("rose",        "#eecbba", "cool",    3, "II"),
    ("sand",        "#e8cba9", "neutral", 3, "II"),
    ("light_olive", "#dcc59f", "olive",   4, "III"),
    ("honey",       "#e0b58c", "warm",    4, "III"),
    ("almond",      "#d2aa84", "neutral", 5, "III-IV"),
    ("olive",       "#c2a379", "olive",   5, "IV"),
    ("tan",         "#c69168", "warm",    6, "IV"),
    ("caramel",     "#ad7a52", "warm",    6, "IV-V"),
    ("deep_olive",  "#987a54", "olive",   6, "V"),
    ("bronze",      "#8f6443", "neutral", 7, "V"),
    ("umber",       "#7b5136", "warm",    7, "V"),
    ("mahogany",    "#6a4030", "cool",    8, "VI"),
    ("cocoa",       "#583c2b", "neutral", 8, "VI"),
    ("ebony",       "#45312a", "warm",    9, "VI"),
    ("onyx",        "#30251f", "cool",   10, "VI"),
]
# Pre-change list (index = saved Appearance.skinTone). Removed: non-human tones.
OLD = [("porcelain", "#fbe3d2"), ("peach", "#f6cfb0"), ("rose", "#eebfa4"), ("honey", "#e2a878"), ("tan", "#c98d5e"),
       ("caramel", "#b0744a"), ("bronze", "#94603c"), ("umber", "#774a2e"), ("cocoa", "#5e3a26"), ("ebony", "#46291c"),
       ("olive", "#c6a27a"), ("goblin", "#a8c98a")]
REMOVED = {"goblin": "green fantasy tone"}

hx = lambda h: tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))
th = lambda c: "#%02x%02x%02x" % tuple(max(0, min(255, round(v))) for v in c)

def lab(c):
    def f(u): u /= 255; return u / 12.92 if u <= .04045 else ((u + .055) / 1.055) ** 2.4
    r, g, b = map(f, c); X = (r * .4124 + g * .3576 + b * .1805) / .95047; Y = r * .2126 + g * .7152 + b * .0722; Z = (r * .0193 + g * .1192 + b * .9505) / 1.08883
    t = lambda v: v ** (1 / 3) if v > .008856 else 7.787 * v + 16 / 116
    return (116 * t(Y) - 16, 500 * (t(X) - t(Y)), 200 * (t(Y) - t(Z)))
dE = lambda a, b: sum((x - y) ** 2 for x, y in zip(lab(a), lab(b))) ** .5

def hsv_shift(c, dh, ks, kv, add_v=0.0):
    h, s, v = colorsys.rgb_to_hsv(*(x / 255 for x in c)); h = (h + dh / 360) % 1; s = min(1, s * ks); v = min(1, v * kv + add_v)
    return tuple(x * 255 for x in colorsys.hsv_to_rgb(h, s, v))

def tone(key, base, under, monk, fitz):
    b = hx(base)
    color = tuple(min(255, b[i] * NEUTRAL / ART["base"][i]) for i in range(3))            # tint input
    mul = {k: th(tuple(color[i] * ART[k][i] / NEUTRAL for i in range(3))) for k in ART}
    shadow = hsv_shift(b, -4, 1.12, 0.74)      # one hard shade: darker, a touch redder + richer
    high = hsv_shift(b, 3, 0.80, 1.06, 0.04)   # hard highlight: lighter, slightly desaturated, warmer
    return {"key": key, "color": th(color), "ramp": {"base": th(b), "shadow": th(shadow), "highlight": th(high)},
            "mulBase": mul["base"], "mulShadow": mul["shade"], "mulHighlight": mul["highlight"],
            "undertone": under, "monk": monk, "fitzpatrick": fitz}

def build():
    T = [tone(*t) for t in TONES]
    L = [lab(hx(t["ramp"]["base"]))[0] for t in T]
    assert all(a > b for a, b in zip(L, L[1:])), "not light -> deep"
    # old index -> nearest new tone on screen (old colours went through the same multiply; compare rendered base)
    rend = lambda c: tuple(hx(c)[i] * ART["base"][i] / NEUTRAL for i in range(3))
    def nearest(i, k, c):
        if k in REMOVED:   # non-human: nearest realistic tone by lightness, olive undertone preferred for green
            l0 = lab(rend(c))[0]; cand = [j for j, t in enumerate(T) if t["undertone"] == "olive"]
            return min(cand, key=lambda j: abs(lab(hx(T[j]["ramp"]["base"]))[0] - l0))
        same = [j for j, t in enumerate(T) if t["key"] == k]
        j = min(range(len(T)), key=lambda j: dE(rend(c), hx(T[j]["ramp"]["base"])))
        return same[0] if same and dE(rend(c), hx(T[same[0]]["ramp"]["base"])) < dE(rend(c), hx(T[j]["ramp"]["base"])) + 6 else j
    legacy = [{"old": i, "oldKey": k, "oldColor": c, "new": (n := nearest(i, k, c)), "newKey": T[n]["key"],
               "dE": round(dE(rend(c), hx(T[n]["ramp"]["base"])), 1), **({"removed": REMOVED[k]} if k in REMOVED else {})}
              for i, (k, c) in enumerate(OLD)]
    return {"version": 2, "note": "Realistic human skin tones only, light -> deep (Monk Skin Tone 1-10, Fitzpatrick I-VI; warm / neutral / "
            "cool / olive undertones). `color` = tint input for the baked cel body art (out = art * color / tintNeutral); ramp = intended "
            "on-screen base/shadow/highlight; mul* = what the multiply path draws today. Saves store the index: apply legacyMap "
            "(Appearance.skinTone old -> new) when loading appearances saved before this change.",
            "tintNeutral": 0.78, "artLevels": {k: th(v) for k, v in ART.items()}, "count": len(T), "tones": T,
            "legacyMap": [l["new"] for l in legacy], "legacy": legacy, "removed": [{"key": k, "color": dict(OLD)[k], "reason": r} for k, r in REMOVED.items()]}

def main():
    d = build(); q = os.path.join(PACK, "skin_tones.json"); json.dump(d, open(q, "w"), indent=1); open(q, "a").write("\n")
    import sys; sys.path.insert(0, os.path.join(ENGINE, "packages/assets/scripts")); import cz_manifest   # ADR-138 shard index
    p = os.path.join(PACK, "manifest.customization.json"); m = cz_manifest.load(p)
    m["skinTones"] = [{"key": t["key"], "color": t["color"], "ramp": t["ramp"], "undertone": t["undertone"], "monk": t["monk"], "fitzpatrick": t["fitzpatrick"]} for t in d["tones"]]
    cz_manifest.save(p, m)   # re-shards (skinTones -> base shard) + index bytes/sha
    for t in d["tones"]: print(f'{t["key"]:<12} color {t["color"]} base {t["ramp"]["base"]} sh {t["ramp"]["shadow"]}/{t["mulShadow"]} hi {t["ramp"]["highlight"]}/{t["mulHighlight"]} dEsh {dE(hx(t["ramp"]["shadow"]), hx(t["mulShadow"])):.1f}')
    for l in d["legacy"]: print(l)

if __name__ == "__main__": main()
