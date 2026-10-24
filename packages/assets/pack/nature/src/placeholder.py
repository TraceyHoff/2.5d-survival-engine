"""Streamed residency (Renderer d72fa5a): the resident `nature_placeholder` sheet (soft, low-detail stand-ins drawn while a
"stream" sheet pages in) and the residency/placeholder tags for crop, sapling, clutter and ADR-110 animal sheets.
Runs last in build.py (group + tag pass), so a rebuild reproduces the fields."""
import common  # noqa: F401
from toon import Canvas, capsule_pts
from palette import RAMPS
from nature import circ

RAMPS.update({"ph_leaf": ["#e6f6c8", "#bfe09a", "#98c47e", "#76a068"],
              "ph_soil": ["#eadcc8", "#cdb89e", "#ad9880", "#8a7866"],
              "ph_ghost": ["#f8f4f0", "#e6dfd8", "#cfc6c0", "#ada3a0"]})

PW, PH, PB = 64, 56, 50          # shared canvas, feet at (32, 50)
ATLAS = "nature_placeholder"

def ph_sprout():
    cv = Canvas(PW, PH, seed=3); cx, b = PW / 2, PB
    cv.shadow(cx, b, 9, 3, alpha=0.14)
    cv.part(circ(cx, b - 1.5, 8, 3, wob=0), "ph_soil", lw=0.7, shade=0.15, hl=0.1)
    cv.line([(cx, b - 2), (cx, b - 8)], RAMPS["ph_leaf"][3], 0.9)
    cv.part(circ(cx - 3, b - 9, 3.2, 1.8, rot=0.5, wob=0), "ph_leaf", lw=0.6, shade=0.15, hl=0.2)
    cv.part(circ(cx + 3, b - 9, 3.2, 1.8, rot=-0.5, wob=0), "ph_leaf", lw=0.6, shade=0.15, hl=0.2)
    return cv.final()

def ph_sapling():
    cv = Canvas(PW, PH, seed=4); cx, b = PW / 2, PB
    cv.shadow(cx, b, 10, 3.5, alpha=0.14)
    cv.part(circ(cx, b - 1.5, 9, 3.4, wob=0), "ph_soil", lw=0.7, shade=0.15, hl=0.1)
    cv.part(capsule_pts(cx, b - 2, cx, b - 12, 1.3, 1.0), "ph_soil", lw=0.7, shade=0.2, hl=0.1)
    cv.part(circ(cx, b - 15, 4.6, 4.0, wob=0), "ph_leaf", lw=0.7, shade=0.18, hl=0.2)
    return cv.final()

def ph_animal(s):
    """soft shadow blob + rounded body/head outline; s = scale (1 small .. 2.6 large)."""
    cv = Canvas(PW, PH, seed=5); cx, b = PW / 2, PB
    cv.shadow(cx, b, 6.5 * s, 2.4 * s, alpha=0.2)
    cv.part(circ(cx - 0.6 * s, b - 4.2 * s, 5.2 * s, 3.4 * s, wob=0), "ph_ghost", lw=0.8, shade=0.12, hl=0.12)
    cv.part(circ(cx + 4.0 * s, b - 7.0 * s, 2.5 * s, 2.3 * s, wob=0), "ph_ghost", lw=0.8, shade=0.12, hl=0.12)
    return cv.final()

FRAMES = [("placeholder_sprout", ph_sprout), ("placeholder_sapling", ph_sapling),
          ("placeholder_animal_s", lambda: ph_animal(1.0)), ("placeholder_animal_m", lambda: ph_animal(1.7)), ("placeholder_animal_l", lambda: ph_animal(2.5))]

ANIMAL_SIZE = {"s": ["animal_duck", "animal_goose", "animal_hare", "animal_squirrel", "animal_snake"],
               "m": ["animal_fox", "animal_sheep", "animal_goat", "animal_turkey"],
               "l": ["animal_stag", "animal_red_deer", "animal_elk", "animal_moose", "animal_cow", "animal_bear", "animal_bison"]}
SIZE_OF = {k: z for z, ks in ANIMAL_SIZE.items() for k in ks}
STREAM_PH = {"nature_sprouts": "placeholder_sprout", "nature_crops": "placeholder_sprout", "nature_saplings": "placeholder_sapling", "nature_clutter": None}

def group_placeholder(b):
    b.static_atlas(ATLAS, [(k, {"idle": [fn]}, None) for k, fn in FRAMES], 8, category="resource", canvas=(PW, PH, PB), want_sway_mask=False)

def tag(b):
    """residency "stream" + placeholder on crop/sapling/clutter/animal sheets; sprite overrides where the sheet default is wrong."""
    sizes = {}   # critter atlas -> sizes of the animals with frames on it
    for s in b.sprites:
        if s["key"] in SIZE_OF:
            for an in s["animations"].values():
                for df in an.get("dirFrames", []): sizes.setdefault(df["atlas"], []).append(SIZE_OF[s["key"]])
    order = "slm"
    for a in b.atlases:
        k = a["key"]
        if k in STREAM_PH: ph = STREAM_PH[k]
        elif k.startswith("nature_critters_"):
            zs = sizes.get(k) or ["m"]; z = max(set(zs), key=lambda z: (zs.count(z), order.index(z))); ph = f"placeholder_animal_{z}"
        else: continue
        a["residency"] = "stream"; a["placeholder"] = ph
    atl = {a["key"]: a for a in b.atlases}
    for s in b.sprites:
        a = atl[s["atlas"]]
        if a.get("residency") != "stream": continue
        want = a["placeholder"]
        if s["key"] in SIZE_OF: want = f"placeholder_animal_{SIZE_OF[s['key']]}"
        elif s["key"].startswith("sapling_"): want = "placeholder_sapling"
        if want != a["placeholder"]: s["placeholder"] = want

GROUPS = [group_placeholder]
