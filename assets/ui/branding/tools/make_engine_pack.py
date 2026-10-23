#!/usr/bin/env python3
"""Packs ui/branding art into engine manifest-v1 uniform-grid atlases (+@2x pages) and writes
engine/manifest.branding.pack.json (paths relative to packages/assets/pack). Also writes manifest.branding.json (paths relative to
ui/branding). With --engine DIR, copies atlases into DIR/assets/ui/branding/atlases/ and writes the branding sub-manifest
assets/ui/branding/manifest.branding.json (+ atlases/) there; nothing goes into the pack manifest. Run gen_branding.py first."""
import json, os, sys, shutil
from PIL import Image
B = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); E = os.path.join(B, "engine"); A = os.path.join(E, "atlases")
os.makedirs(A, exist_ok=True)
KEYS = ["singleplayer", "multiplayer", "settings", "quit"]; ST = ["normal", "hover", "pressed", "disabled"]
atlases, sprites = [], []
def grid(key, files2d, fw, fh, scales=(1, 2), ns=None):
    rows, cols = len(files2d), len(files2d[0])
    for sc in scales:
        sheet = Image.new("RGBA", (fw * sc * cols, fh * sc * rows), (0, 0, 0, 0))
        for r, row in enumerate(files2d):
            for c, f in enumerate(row):
                p = os.path.join(B, f if sc == 1 else f.replace(".png", "@2x.png"))
                im = Image.open(p).convert("RGBA")
                if im.size != (fw * sc, fh * sc): im = im.resize((fw * sc, fh * sc), Image.LANCZOS)
                sheet.paste(im, (c * fw * sc, r * fh * sc))
        sheet.save(os.path.join(A, f"{key}{'' if sc == 1 else '@2x'}.png"), optimize=True)
    a = {"key": key, "image": f"atlases/{key}.png", "frameW": fw, "frameH": fh, "columns": cols, "rows": rows}
    if 2 in scales: a["pages"] = [{"scale": 2, "image": f"atlases/{key}@2x.png"}]
    if ns: a["nineSlice"] = {str(i): ns for i in range(rows * cols)}
    atlases.append(a)
def spr(key, atlas, anims, anchor=(0.5, 0.5)):
    sprites.append({"key": key, "category": "ui", "atlas": atlas, "anchor": {"x": anchor[0], "y": anchor[1]}, "animations": anims})
one = lambda i: {"frames": [i], "fps": 1}
# logo: 512 is scale-1, 1024 the @2x page (heights made exactly 2x)
l1 = Image.open(os.path.join(B, "logo/logo_1024.png")); h2 = l1.height + (l1.height % 2)
tmp = Image.new("RGBA", (1024, h2)); tmp.paste(l1, (0, 0)); tmp.save("/tmp/_logo@2x.png"); tmp.resize((512, h2 // 2), Image.LANCZOS).save("/tmp/_logo.png")
shutil.copy("/tmp/_logo.png", os.path.join(A, "brand_logo.png")); shutil.copy("/tmp/_logo@2x.png", os.path.join(A, "brand_logo@2x.png"))
atlases.append({"key": "brand_logo", "image": "atlases/brand_logo.png", "frameW": 512, "frameH": h2 // 2, "columns": 1, "rows": 1, "pages": [{"scale": 2, "image": "atlases/brand_logo@2x.png"}]})
spr("ui_brand_logo", "brand_logo", {"idle": one(0)})
# menu backdrop + parallax layers
shutil.copy(os.path.join(B, "background/menu_bg_1920x1080.png"), os.path.join(A, "brand_menu_bg.png"))
shutil.copy(os.path.join(B, "background/menu_bg_3840x2160.png"), os.path.join(A, "brand_menu_bg@2x.png"))
atlases.append({"key": "brand_menu_bg", "image": "atlases/brand_menu_bg.png", "frameW": 1920, "frameH": 1080, "columns": 1, "rows": 1, "pages": [{"scale": 2, "image": "atlases/brand_menu_bg@2x.png"}]})
spr("ui_menu_bg", "brand_menu_bg", {"idle": one(0)})
for L in ("sky", "far", "near", "fireflies", "vignette"):
    shutil.copy(os.path.join(B, f"background/parallax/menu_bg_{L}.png"), os.path.join(A, f"brand_menu_bg_{L}.png"))
    atlases.append({"key": f"brand_menu_bg_{L}", "image": f"atlases/brand_menu_bg_{L}.png", "frameW": 1920, "frameH": 1080, "columns": 1, "rows": 1})
    spr(f"ui_menu_bg_{L}", f"brand_menu_bg_{L}", {"idle": one(0)})
states = lambda r: {s: one(r * 4 + i) for i, s in enumerate(ST)}
grid("brand_btn_plates", [[f"buttons/plates/btn_plate_{k}_{s}.png" for s in ST] for k in KEYS], 96, 76, ns={"l": 22, "t": 18, "r": 22, "b": 20})
grid("brand_btn_labelled", [[f"buttons/labelled/btn_{k}_{s}.png" for s in ST] for k in KEYS], 320, 76)
grid("brand_btn_icons", [[f"buttons/icons/ic_menu_{k}.png" for k in KEYS]], 40, 40)
for r, k in enumerate(KEYS):
    spr(f"ui_menu_btn_plate_{k}", "brand_btn_plates", states(r))
    spr(f"ui_menu_btn_{k}", "brand_btn_labelled", states(r))
    spr(f"ui_menu_ic_{k}", "brand_btn_icons", {"idle": one(r)})
grid("brand_loading_frame", [["loading/loading_frame.png"]], 64, 32, ns={"l": 14, "t": 12, "r": 16, "b": 15})
grid("brand_loading_fill", [["loading/loading_fill.png"]], 32, 18, ns={"l": 8, "t": 7, "r": 8, "b": 7})
spr("ui_loading_frame", "brand_loading_frame", {"idle": one(0)}); spr("ui_loading_fill", "brand_loading_fill", {"idle": one(0)}, (0, 0.5))
for k, an, fps in (("zombie_walk", "walk", 7), ("campfire", "idle", 10)):
    for sc in (1, 2):
        shutil.copy(os.path.join(B, f"loading/loading_{k}{'' if sc == 1 else '@2x'}.png"), os.path.join(A, f"brand_loading_{k}{'' if sc == 1 else '@2x'}.png"))
    atlases.append({"key": f"brand_loading_{k}", "image": f"atlases/brand_loading_{k}.png", "frameW": 64, "frameH": 64, "columns": 6, "rows": 1, "pages": [{"scale": 2, "image": f"atlases/brand_loading_{k}@2x.png"}]})
    spr(f"ui_loading_{k.split('_')[0]}", f"brand_loading_{k}", {an: {"frames": list(range(6)), "fps": fps, "loop": True}}, (0.5, 0.92))
frag = {"version": 1, "name": "ui-branding", "atlases": atlases, "sprites": sprites}
json.dump(frag, open(os.path.join(E, "manifest.branding.pack.json"), "w"), indent=1)
print(len(atlases), "atlases", len(sprites), "sprites")
frag_sub = json.loads(json.dumps(frag)); frag_sub["name"] = "ui-branding"
json.dump(frag_sub, open(os.path.join(B, "manifest.branding.json"), "w"), indent=1)
if "--engine" in sys.argv:
    # Branding is the client's "branding" sub-manifest (art/ui/branding/manifest.branding.json, mergeManifests):
    # write it + atlases into DIR/assets/ui/branding/ only; never into packages/assets/pack (no duplicate keys).
    eng = sys.argv[sys.argv.index("--engine") + 1]; dst = os.path.join(eng, "assets/ui/branding"); os.makedirs(os.path.join(dst, "atlases"), exist_ok=True)
    for f in os.listdir(A): shutil.copy(os.path.join(A, f), os.path.join(dst, "atlases", f))
    shutil.copy(os.path.join(B, "manifest.branding.json"), os.path.join(dst, "manifest.branding.json"))
    print("wrote", dst, "- then pnpm --filter @engine/assets lock:ids:pack")
