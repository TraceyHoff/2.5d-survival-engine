#!/usr/bin/env python3
"""Crops the kit frames the DOM menu stylesheet (apps/client/src/gameplay-panels.css) uses out of the kit atlases
(../ui_kit_*.png + @2x) so CSS can border-image / background them. Rerun after the kit is regenerated."""
import json, os
from PIL import Image
K = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."); OUT = os.path.dirname(os.path.abspath(__file__))
WANT = ["ui_slot_empty", "ui_slot_hover", "ui_slot_selected", "ui_slot_locked", "ui_panel_tooltip", "ui_panel_inset", "ui_btn_gold_normal", "ui_btn_gold_hover",
        "ui_bar_track", "ui_bar_fill_xp", "ui_ic_lock", "ui_ic_check", "ui_ic_crown", "ui_ic_star", "ui_ic_person", "ui_ic_cross", "ui_ic_bag", "ui_ic_craft", "ui_bubble"]
m = json.load(open(os.path.join(K, "manifest.ui.kit.json"))); A = {a["key"]: a for a in m["atlases"]}; S = {s["key"]: s for s in m["sprites"]}
for k in WANT:
    s = S[k]; a = A[s["atlas"]]; f = next(iter(s["animations"].values()))["frames"][0]
    for suf, sc in (("", 1), ("@2x", 2)):
        im = Image.open(os.path.join(K, os.path.basename(a["image"]).replace(".png", f"{suf}.png")))
        x, y = (f % a["columns"]) * a["frameW"] * sc, (f // a["columns"]) * a["frameH"] * sc
        im.crop((x, y, x + a["frameW"] * sc, y + a["frameH"] * sc)).save(os.path.join(OUT, f"{k}{suf}.png"), optimize=True)
    print(k, a["frameW"], a["frameH"], a.get("nineSlice", {}).get(str(f)))
