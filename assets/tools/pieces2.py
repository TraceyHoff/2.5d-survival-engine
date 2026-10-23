"""Wave 2 building catalogue: key -> how to draw it. Used by build_all.py."""
import zlib
from PIL import Image
import buildings as b1, buildings2 as b2
from buildings import render_boxes, finalize
from iso import damage
from toon import downscale

TIER_SUFFIX = {"twig": "_twig", "wood": "", "stone": "_stone", "metal": "_metal"}
P = {}   # key -> dict(piece, footprint, layer, art, draw=(fn,args), anim, fps, states, atlas)

def add(key, piece, fp, layer, art, draw, atlas, **kw): P[key] = dict(piece=piece, footprint=fp, layer=layer, art=art, draw=draw, atlas=atlas, **kw)

for tier, suf in TIER_SUFFIX.items():
    at = "buildings" + ("" if tier == "wood" else "_" + tier)
    add("foundation" + suf, "foundation", (1, 1), 0, "single", ("boxes", b2.foundation, (tier,)), at)
    add("floor" + suf, "floor", (1, 1), 0, "single", ("boxes", b2.floor, (tier,)), at)
    add("floor_hatch_frame" + suf, "floor_hatch_frame", (1, 1), 0, "single", ("boxes", b2.hatch_frame, (tier,)), at)
    add("wall" + suf, "wall", (1, 1), 1, "mirror", ("boxes", b2.wall, (tier, "plain")), at)
    add("wall_low" + suf, "wall_low", (1, 1), 1, "mirror", ("boxes", b2.wall, (tier, "low")), at)
    add("wall_window" + suf, "wall_window", (1, 1), 1, "mirror", ("boxes", b2.wall, (tier, "window")), at)
    add("wall_doorway" + suf, "wall_doorway", (1, 1), 1, "mirror", ("boxes", b2.wall, (tier, "doorway")), at)
    add("wall_corner" + suf, "wall_corner", (1, 1), 1, "unique4", ("boxes", b2.wall_corner, (tier,)), at)
    add("pillar" + suf, "pillar", (1, 1), 1, "single", ("boxes", b2.pillar, (tier,)), at)
    add("stairs" + suf, "stairs", (1, 1), 1, "unique4", ("boxes", b2.stairs, (tier,)), at)
    for rk, (kind, art) in b2.ROOF_KINDS.items():
        add(rk + suf, rk, (1, 1), 0, art, ("roof", tier, kind), at)
add("fence", "fence", (1, 1), 1, "mirror", ("boxes", b2.fence, ()), "buildings")
# legacy wave-1 key kept: "roof" = wood ridge roof (same art as roof_ridge)
ALIASES = {"roof": "roof_ridge"}

# openings
add("door_wood", "door_wood", (1, 1), 1, "unique4", ("boxes", b2.door_leaf, ("wood", False)), "openings", states={"open": ("boxes", b2.door_leaf, ("wood", True))})
add("door_metal", "door_metal", (1, 1), 1, "unique4", ("boxes", b2.door_leaf, ("metal", False)), "openings", states={"open": ("boxes", b2.door_leaf, ("metal", True))})
add("hatch_wood", "hatch_wood", (1, 1), 0, "unique4", ("boxes", b2.hatch_leaf, (False,)), "openings", states={"open": ("boxes", b2.hatch_leaf, (True,))})
add("window_shutters", "window_shutters", (1, 1), 1, "mirror", ("boxes", b2.window_insert, ("shutters_closed",)), "openings", states={"open": ("boxes", b2.window_insert, ("shutters_open",))})
add("window_glass", "window_glass", (1, 1), 1, "mirror", ("boxes", b2.window_insert, ("glass",)), "openings")
add("window_bars", "window_bars", (1, 1), 1, "mirror", ("boxes", b2.window_insert, ("bars",)), "openings")

# furniture / stations (wave 1 builders reused at their existing tile scale)
add("bed", "bed", (1, 2), 2, "unique4", ("boxes", b1.bed, ()), "furniture")
add("storage_box", "storage_box", (1, 1), 2, "unique4", ("boxes", b1.chest, ()), "furniture")
add("large_chest", "large_chest", (2, 1), 2, "unique4", ("boxes", b2.large_chest, ()), "furniture")
add("workbench", "workbench", (2, 1), 2, "unique4", ("boxes", b1.workbench, ()), "furniture")
add("table", "table", (1, 1), 2, "single", ("boxes", b1.table, ()), "furniture")
add("chair", "chair", (1, 1), 2, "unique4", ("boxes", b1.chair, ()), "furniture")
add("anvil", "anvil", (1, 1), 2, "mirror", ("boxes", b2.anvil, ()), "furniture")
add("shelf", "shelf", (1, 1), 2, "unique4", ("boxes", b2.shelf, ()), "furniture")
add("loom", "loom", (2, 1), 2, "unique4", ("boxes", b2.loom, ()), "furniture")
add("campfire", "campfire", (1, 1), 2, "single", ("canvas", "campfire"), "furniture", anim=6, fps=10, emissive=True)
add("bonfire", "bonfire", (1, 1), 2, "single", ("canvas", "bonfire"), "furniture", anim=8, fps=10, emissive=True)
add("torch_stand", "torch_stand", (1, 1), 2, "single", ("canvas", "torch"), "furniture", anim=4, fps=10, emissive=True)
add("furnace", "furnace", (1, 1), 2, "single", ("canvas", "furnace"), "furniture", anim=6, fps=8, emissive=True)
add("cooking_pot", "cooking_pot", (1, 1), 2, "single", ("canvas", "cooking_pot"), "furniture", anim=6, fps=8, emissive=True)
add("fireplace", "fireplace", (2, 1), 2, "single", ("canvas", "fireplace"), "furniture", anim=6, fps=10, emissive=True)
add("wood_stove", "wood_stove", (1, 1), 2, "single", ("canvas", "wood_stove"), "furniture", anim=6, fps=10, emissive=True)
add("lantern", "lantern", (1, 1), 3, "single", ("canvas", "lantern"), "decor", anim=4, fps=6, emissive=True)
add("claim_totem", "claim_totem", (1, 1), 2, "single", ("canvas", "claim_totem"), "decor", emissive=True)
for v in range(4):
    sfx = "" if v == 0 else f"_{v + 1}"
    add("rug" + sfx, "rug", (1, 1), 3, "mirror", ("boxes", b2.rug, (v,)), "decor")
    add("flower_box" + sfx, "flower_box", (1, 1), 3, "single", ("boxes", b2.flower_box, (v,)), "decor")
for v in range(3): add("potted_plant" + ("" if v == 0 else f"_{v + 1}"), "potted_plant", (1, 1), 3, "single", ("boxes", b2.potted_plant, (v,)), "decor")
for v in range(b2.PAINTINGS): add("painting" + ("" if v == 0 else f"_{v + 1}"), "painting", (1, 1), 3, "unique4", ("boxes", b2.painting, (v,)), "decor")
add("trophy_skull", "trophy_skull", (1, 1), 3, "unique4", ("boxes", b2.trophy_skull, ()), "decor")
VARIANTS = {"rug": 4, "flower_box": 4, "potted_plant": 3, "painting": b2.PAINTINGS}

def canvas_frame(name, i, lit=True, stage=0):
    if name == "campfire": return b1.campfire_frame(i, 6, stage=stage, lit=lit)
    if name == "bonfire": return bonfire_frame(i, 8, lit=lit, stage=stage)
    if name == "torch": return b1.torch_frame(i, 4)
    if name == "furnace": return b2.furnace_frame(i, 6, lit=lit, stage=stage)
    if name == "cooking_pot": return b2.cooking_pot_frame(i, 6, lit=lit)
    if name == "fireplace": return b2.fireplace_frame(i, 6, lit=lit)
    if name == "wood_stove": return b2.wood_stove_frame(i, 6, lit=lit)
    if name == "lantern": return b2.lantern_frame(i, 4)
    if name == "claim_totem": return b2.claim_totem()
    raise KeyError(name)

def bonfire_frame(i, n=8, lit=True, stage=0):
    import math
    from toon import Canvas, ellipse_pts, capsule_pts, SS
    from fx import fire
    cv = Canvas(128, 128, seed=15); cx, cy = 64, 96
    stones = [(math.cos(a) * 26, math.sin(a) * 13) for a in [k * 2 * math.pi / 12 for k in range(12)]]
    for (dx, dy) in [s for s in stones if s[1] < 0]: cv.part(ellipse_pts(cx + dx, cy + dy - 2, 4.8, 3.6, n=10, wob=0.1, seed=int(dx * 10 + 99)), "stone", lw=1.0, shade=0.3, hl=0.2)
    for k in range(7):   # log teepee
        a = k / 7 * math.pi * 2; x0, y0 = cx + math.cos(a) * 15, cy + math.sin(a) * 7
        cv.part(capsule_pts(x0, y0 - 2, cx + math.cos(a) * 2, cy - 30, 3.2, 2.0), "bark" if stage < 3 else "ink", lw=0.9, shade=0.35, hl=0.25)
    if lit and stage < 3:
        cv.paste(fire(i, n, 64, 96, size=2.8, tongues=7).resize((60 * SS, 90 * SS), Image.LANCZOS), cx - 30, cy - 92)
    for (dx, dy) in [s for s in stones if s[1] >= 0]: cv.part(ellipse_pts(cx + dx, cy + dy - 2, 5.0, 3.7, n=10, wob=0.1, seed=int(dx * 10 + 99)), "stone", lw=1.0, shade=0.3, hl=0.2)
    return cv

def base(spec, rot, key):
    """SS-resolution base canvas (before damage/outline) for one rotation."""
    kind = spec[0]; seed = zlib.crc32(key.encode()) % 1000
    d = P[key]; mirror = d["art"] == "mirror" and rot % 2 == 1
    r = 1 if mirror else rot
    if kind == "roof": return b2.roof_piece(spec[1], spec[2], rot, seed=seed)
    res = spec[1](*spec[2]); boxes, dec = res if isinstance(res, tuple) else (res, None)
    return render_boxes(boxes, r, mirror=mirror, seed=seed, decor=dec)

def frames_for(key, rot, spec=None):
    """-> 4 damage-stage images for one rotation."""
    d = P[key]; spec = spec or d["draw"]; seed = zlib.crc32(key.encode()) % 1000
    if spec[0] == "canvas":
        out = []
        for st in range(4):
            cv = canvas_frame(spec[1], 0, lit=st < 2 or spec[1] in ("lantern", "torch", "claim_totem"), stage=st) if st >= 2 else canvas_frame(spec[1], 0)
            img = damage(cv.img, st, seed) if st else cv.img
            out.append(downscale(img, (cv.w, cv.h)))
        return out
    cv = base(spec, rot, key)
    fp = d["footprint"]; w, h = (fp[1], fp[0]) if rot % 2 else fp
    sr = (-w / 2 - 0.05, w / 2 + 0.05, -h / 2 - 0.05, h / 2 + 0.05) if d["layer"] >= 1 and spec[0] != "roof" else None
    return [finalize(cv, st, seed + rot, sr) for st in range(4)]

def anim_frame(key, i):
    d = P[key]; cv = canvas_frame(d["draw"][1], i); return downscale(cv.img, (cv.w, cv.h))
