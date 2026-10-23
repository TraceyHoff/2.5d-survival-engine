#!/usr/bin/env python3
"""ui/input/touch_layout.json: responsive touch layouts (phone/tablet x landscape/portrait) for gameplay + building.
Every layout is a valid @engine/input VirtualLayout (same element ids/kinds/controls/glyphs as profiles/touchLayout.json), so
`new VirtualControls(layouts[variant][context], device)` works unchanged. Positions are authored as corner + dp offset (thumb reach)
and baked to normalized safe-area anchors for the variant's reference size. Extra fields (x_*) are ignored by the engine."""
import json, os
ENG = json.load(open('/workspace/engine/packages/input/profiles/touchLayout.json'))
OUT = os.path.join(os.path.dirname(__file__), '..', 'input', 'touch_layout.json')
MIN_HIT_DP = 48
REF = {"phone.landscape": (844, 390), "phone.portrait": (390, 844), "tablet.landscape": (1180, 820), "tablet.portrait": (820, 1180)}
# size multipliers (radius dp); tablets keep finger-sized controls (not scaled up with the screen)
SIZE = {"phone.landscape": 1.0, "phone.portrait": 0.9, "tablet.landscape": 1.1, "tablet.portrait": 1.05}

# (corner, dx, dy) = centre offset in dp from that safe-area corner. corners: bl br tl tr bc tc
LAND = {
    "gameplay": {"move": ("bl", 150, 100), "attack": ("br", 88, 92), "secondary": ("br", 190, 52), "context": ("br", 176, 150), "jump": ("br", 62, 210),
                 "sprint": ("bl", 52, 212), "crouch": ("bl", 120, 212), "reload": ("br", 46, 290), "quickuse": ("br", 280, 44),
                 "inventory": ("tr", 36, 34), "crafting": ("tr", 96, 34), "map": ("tr", 156, 34), "build": ("tr", 216, 34),
                 "chat": ("tl", 36, 34), "social": ("tl", 96, 34), "back": ("tl", 36, 94), "hotbar": ("bc", 40, 84)},
    "building": {"move": ("bl", 150, 100), "confirm": ("br", 88, 92), "cancel": ("br", 196, 52), "rotate": ("br", 70, 206),
                 "tierup": ("br", 40, 330), "tierdown": ("br", 40, 270), "snap": ("br", 160, 180), "levelup": ("br", 246, 210),
                 "leveldown": ("br", 246, 150), "demolish": ("bc", -60, 40), "upgrade": ("bc", 0, 40), "repair": ("bc", 60, 40), "build": ("tr", 216, 34)}}
PORT = {
    "gameplay": {"move": ("bl", 110, 150), "attack": ("br", 82, 140), "secondary": ("br", 170, 86), "context": ("br", 160, 216), "jump": ("br", 54, 262),
                 "sprint": ("bl", 46, 286), "crouch": ("bl", 106, 300), "reload": ("br", 42, 336), "quickuse": ("br", 230, 40),
                 "inventory": ("tr", 34, 34), "crafting": ("tr", 92, 34), "map": ("tr", 150, 34), "build": ("tr", 208, 34),
                 "chat": ("tl", 34, 34), "social": ("tl", 92, 34), "back": ("tl", 34, 92), "hotbar": ("bc", 0, 360)},
    "building": {"move": ("bl", 110, 150), "confirm": ("br", 82, 140), "cancel": ("br", 176, 80), "rotate": ("br", 62, 256),
                 "tierup": ("br", 36, 400), "tierdown": ("br", 36, 340), "snap": ("br", 150, 230), "levelup": ("bl", 40, 360),
                 "leveldown": ("bl", 40, 300), "demolish": ("tc", -60, 100), "upgrade": ("tc", 0, 100), "repair": ("tc", 60, 100), "build": ("tr", 208, 34)}}


def bake(variant, ctx):
    W, H = REF[variant]; k = SIZE[variant]; spec = (PORT if variant.endswith("portrait") else LAND)[ctx]
    els = []
    for e in ENG[ctx]["elements"]:
        e = json.loads(json.dumps(e)); c, dx, dy = spec[e["id"]]
        dx, dy = dx * k, dy * k
        x = {"l": dx, "r": W - dx, "c": W / 2 + dx}[c[1]]
        y = dy if c[0] == "t" else H - dy
        e["anchor"] = {"x": round(x / W, 4), "y": round(y / H, 4)}
        e["radius"] = round(e["radius"] * k, 1)
        if e["kind"] == "radial": e["innerRadius"] = round(e["innerRadius"] * k, 1)
        e["x_hitRadiusDp"] = max(e["radius"], MIN_HIT_DP / 2)   # renderer/touch: never shrink the hit area below 48dp
        e["x_sprite"] = {"joystick": "input_vj_base", "radial": "input_rad_ring"}.get(e["kind"], f"input_vb_{e['id']}_normal")
        if e["kind"] == "joystick":
            e["zone"] = {"x": 0, "y": 0.35, "w": 0.45, "h": 0.65} if not variant.endswith("portrait") else {"x": 0, "y": 0.55, "w": 0.55, "h": 0.45}
        els.append(e)
    return {"id": f"cozy.touch.{variant}.{ctx}", "reference": {"w": W, "h": H}, "elements": els}


def check(lay):
    W, H = lay["reference"]["w"], lay["reference"]["h"]; bad = []
    pts = [(e["id"], e["anchor"]["x"] * W, e["anchor"]["y"] * H, e["radius"]) for e in lay["elements"] if e["kind"] != "joystick"]
    for i, (a, ax, ay, ar) in enumerate(pts):
        if ax - ar < 0 or ax + ar > W or ay - ar < 0 or ay + ar > H: bad.append(f"{a} off-screen")
        if 2 * max(ar, 24) < MIN_HIT_DP: bad.append(f"{a} < 48dp")
        for b, bx, by, br in pts[i + 1:]:
            if ((ax - bx) ** 2 + (ay - by) ** 2) ** .5 < ar + br + 4: bad.append(f"{a}~{b} overlap")
    return bad


def main():
    out = {"_doc": "VirtualLayout per variant/context. Pick variant: tablet if min(cssW,cssH) >= 600dp else phone; portrait if h > w. "
                   "Anchors are normalized inside the safe area (env(safe-area-inset-*) -> --sat/--sar/--sab/--sal). radius in dp at reference; "
                   "engine scale = clamp(min(w/refW, h/refH), 0.75, 2). Mirror x for left-handed (settings.input.leftHanded).",
           "minHitDp": MIN_HIT_DP, "safeArea": {"cssVars": ["--sat", "--sar", "--sab", "--sal"], "minInsetDp": {"top": 8, "right": 12, "bottom": 10, "left": 12},
           "note": "add minInsetDp on top of the device insets so thumbs never land on the home indicator / rounded corners"},
           "variantRule": {"tabletMinShortSideDp": 600, "portraitIf": "h > w"},
           "opacity": {"idle": 0.72, "pressed": 1.0, "disabled": 0.4, "fadeAfterIdleMs": 6000, "fadedOpacity": 0.38},
           "joystick": {"base": "input_vj_base", "baseActive": "input_vj_base_active", "knob": "input_vj_knob", "knobPressed": "input_vj_knob_pressed",
                        "knobTravel": 0.62, "zoneHint": "input_vj_zone", "returnMs": 120},
           "hotbarRadial": {"ring": "input_rad_ring", "segment": "input_rad_seg", "segmentHi": "input_rad_seg_hi", "hub": "input_rad_hub",
                            "openOn": "hold 220ms on the hotbar strip or the hotbar element", "selectOn": "release over segment"},
           "layouts": {}, "issues": {}}
    for v in REF:
        for ctx in ("gameplay", "building"):
            L = bake(v, ctx); out["layouts"].setdefault(v, {})[ctx] = L
            p = check(L)
            if p: out["issues"][f"{v}.{ctx}"] = p
    json.dump(out, open(OUT, "w"), indent=1); print("issues", out["issues"])


if __name__ == "__main__":
    main()
