"""Camper interior building pieces (128x128 frames, anchor 0.5/0.75, mirror rotation, 4 damage stages)."""
import numpy as np, json, os, sys
from PIL import Image
from vrender import *
from effects import damaged, wrecked
CREAM = hexc("#f4ead4"); WOOD = hexc("#b9824e"); WOODD = hexc("#8a5a35"); TEAL = hexc("#4fa3a5"); STEEL = hexc("#a9b0b8"); DARK = hexc("#4f4858")
LINO = hexc("#e9d9a8"); LINO2 = hexc("#cdb57c"); FLAME = (255, 150, 40)
FW = FH = 128; PIV = (64, 96); D = 1  # local x/y aligned to iso grid axes

def floor():
    p = []
    for i in range(4):
        for j in range(4):
            c = LINO if (i + j) % 2 == 0 else LINO2
            p.append(box(-0.5 + i * 0.25, -0.25 + i * 0.25, -0.5 + j * 0.25, -0.25 + j * 0.25, 0, 0.04, M_TRIM, c))
    return p, {}
def wall():
    p = [box(-0.5, 0.5, -0.5, -0.38, 0, 1.45, M_LIGHTBODY, CREAM),
         box(-0.5, 0.5, -0.38, -0.36, 0.0, 0.42, M_PAINT, (199, 197, 194)),     # tintable dado stripe
         box(-0.28, 0.28, -0.37, -0.36, 0.7, 1.12, M_GLASS, hexc("#9fd3e6")),
         box(-0.32, 0.32, -0.38, -0.33, 0.66, 0.7, M_WOOD, WOOD), box(-0.5, 0.5, -0.5, -0.36, 1.45, 1.52, M_WOOD, WOODD)]
    return p, {"window": (0, -0.36, 0.9)}
def bench():
    p = [box(-0.42, 0.42, -0.3, 0.3, 0.52, 0.62, M_WOOD, WOOD, inset=0.0)]
    for x in (-0.36, 0.36):
        for y in (-0.24, 0.24): p.append(box(x - 0.04, x + 0.04, y - 0.04, y + 0.04, 0, 0.52, M_WOOD, WOODD))
    p += [box(-0.36, 0.36, -0.24, 0.24, 0.16, 0.2, M_WOOD, WOODD),
          box(0.18, 0.34, -0.28, -0.12, 0.62, 0.74, M_METAL, STEEL), box(0.22, 0.3, -0.36, -0.28, 0.66, 0.7, M_METAL, DARK),   # vise
          box(-0.3, -0.05, 0.02, 0.2, 0.62, 0.66, M_PAINT, (199, 197, 194)),   # tintable toolbox lid / mat
          box(-0.3, -0.05, 0.02, 0.2, 0.62, 0.72, M_PAINT, (199, 197, 194), inset=0.02)]
    return p, {"craft_station": (0, 0, 0.66)}
def stove(lit):
    e = FLAME if lit else None
    p = [box(-0.38, 0.38, -0.32, 0.32, 0, 0.62, M_METAL, hexc("#e9e5dc")),
         box(0.38, 0.4, -0.22, 0.22, 0.12, 0.42, M_GLASS, hexc("#3a3444")),          # oven door window
         box(0.38, 0.41, -0.26, 0.26, 0.5, 0.56, M_METAL, DARK)]                       # knob strip
    for x, y in ((-0.16, -0.14), (0.16, 0.14)):
        p.append(cyl((x, y, 0.64), 0.11, 0.02, "z", M_METAL, DARK, n=14))
        p.append(cyl((x, y, 0.67), 0.07, 0.01, "z", M_LAMP if lit else M_METAL, FLAME if lit else hexc("#6b6470"), n=12))
        if lit: p[-1] = cyl((x, y, 0.67), 0.07, 0.01, "z", M_LAMP, (255, 170, 70), n=12); [setattr(pr, "_e", 1) for pr in []]
    p.append(box(-0.38, -0.3, -0.32, 0.32, 0.62, 0.95, M_METAL, hexc("#d8d3c8")))       # back splash
    p.append(box(-0.36, -0.3, -0.06, 0.06, 0.95, 1.25, M_METAL, STEEL))                 # vent flue
    return p, {"cook_station": (0, 0, 0.66), "stove_vent": (-0.33, 0, 1.28)}

def light_burners(L, lit):
    if not lit: return L
    m = np.asarray(L["mat"]); emi = np.asarray(L["emi"]).copy(); emi[m == M_LAMP] = (255, 150, 50)
    L["emi"] = Image.fromarray(emi); return L

STAGES = [None, lambda c, m, t, e, s: damaged(c, m, t, e, s, 0.6), lambda c, m, t, e, s: damaged(c, m, t, e, s, 1.6), wrecked]
PIECES = [("camper_interior_floor", "camper_floor", 0, floor, None), ("camper_interior_wall", "camper_wall", 1, wall, None),
          ("camper_craft_bench", "camper_craft_bench", 2, bench, None), ("camper_cook_stove", "camper_cook_stove", 2, stove, ("off", "lit"))]

def build(OUT):
    frames = []; sprites = []; previews = []
    for key, piece, layer, fn, states in PIECES:
        variants = states or (None,)
        rows = {}
        for st in variants:
            prims, att = fn(st == "lit") if states else fn()
            idx = []
            for si, eff in enumerate(STAGES):
                L = render(prims, D, None, (FW, FH), PIV); L = light_burners(L, st == "lit")
                shadow = None if layer == 0 else [((x + PIV[0]) * SS, (y + PIV[1]) * SS) for x, y, _ in (project_point(q, D) for q in ((0.45, 0.45, 0), (0.45, -0.45, 0), (-0.45, -0.45, 0), (-0.45, 0.45, 0)))]
                img, tint, emi = finish(L, shadow, eff, seed=hash((key, si)) % 997, pivot=PIV)
                i2 = np.asarray(downs(img, SS // 2)).copy(); i1 = np.asarray(downs(img, SS)).copy()
                t1 = np.asarray(downs(Image.fromarray((np.clip(tint, 0, 1) * 255).astype(np.uint8)), SS, Image.BOX)).copy(); t1[i1[..., 3] < 8] = 0
                e1 = np.asarray(downs(Image.fromarray(np.clip(emi, 0, 255).astype(np.uint8)), SS, Image.BOX)).copy()
                for arr, g in ((i1, 2), (i2, 4), (t1, 2), (e1, 2)): arr[:g] = 0; arr[-g:] = 0; arr[:, :g] = 0; arr[:, -g:] = 0
                idx.append(len(frames)); frames.append((i1, i2, t1, e1))
            rows[st] = idx
        attach = {}
        for n, p in att.items(): x, y, _ = project_point(p, D); attach[n] = {"x": round(x + PIV[0] - FW / 2, 2), "y": round(y + PIV[1] - FH * 0.75, 2)}
        first = rows[variants[0]]
        b = {"piece": piece, "footprint": {"w": 1, "h": 1}, "layer": layer, "frames": [first]}
        if states: b["states"] = {s: [rows[s]] for s in states}
        if key == "camper_cook_stove": b["stateVfx"] = {"lit": [{"vfx": "campfire_smoke", "attach": "stove_vent"}, {"vfx": "campfire_sparks", "attach": "cook_station"}]}
        sp = {"key": key, "category": "building", "atlas": "veh_camper_interior", "anchor": {"x": 0.5, "y": 0.75},
              "animations": {"idle": {"frames": [first[0]], "fps": 1}}, "building": b, "rotationArt": "mirror", "attach": attach}
        sprites.append(sp)
    n = len(frames); cols = min(n, 1008 // FW); rws = -(-n // cols)  # 1x page <= 1008 (4 per 2048 layer); @2x <= 2016
    P1 = np.zeros((rws * FH, cols * FW, 4), np.uint8); P2 = np.zeros((rws * FH * 2, cols * FW * 2, 4), np.uint8); TM = np.zeros((rws * FH, cols * FW), np.uint8); EM = np.zeros((rws * FH, cols * FW, 3), np.uint8)
    for k, (i1, i2, t1, e1) in enumerate(frames):
        c, r = k % cols, k // cols
        P1[r*FH:(r+1)*FH, c*FW:(c+1)*FW] = i1; P2[r*FH*2:(r+1)*FH*2, c*FW*2:(c+1)*FW*2] = i2; TM[r*FH:(r+1)*FH, c*FW:(c+1)*FW] = t1; EM[r*FH:(r+1)*FH, c*FW:(c+1)*FW] = e1
    g = "veh_camper_interior"
    Image.fromarray(P1).save(f"{OUT}/atlases/{g}.png", optimize=True); Image.fromarray(P2).save(f"{OUT}/atlases/{g}@2x.png", optimize=True)
    Image.fromarray(TM, "L").save(f"{OUT}/atlases/{g}.tintmask.png", optimize=True); Image.fromarray(EM).save(f"{OUT}/atlases/{g}_emissive.png", optimize=True)
    atlas = {"key": g, "image": f"atlases/{g}.png", "frameW": FW, "frameH": FH, "columns": cols, "rows": rws, "pages": [{"scale": 2, "image": f"atlases/{g}@2x.png"}],
             "masks": {"tintmask": f"atlases/{g}.tintmask.png", "emissive": f"atlases/{g}_emissive.png"}}
    return atlas, sprites, P2

if __name__ == "__main__":
    OUT, PREV = sys.argv[1], sys.argv[2]
    atlas, sprites, P2 = build(OUT)
    json.dump({"atlas": atlas, "sprites": sprites}, open(OUT + "/_interior_part.json", "w"))
    bg = Image.new("RGBA", (P2.shape[1], P2.shape[0]), (238, 228, 204, 255)); bg.alpha_composite(Image.fromarray(P2)); bg.save(PREV + "/camper_interior_pieces.png")
    print(atlas["columns"], atlas["rows"])
