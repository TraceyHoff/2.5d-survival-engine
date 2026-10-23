#!/usr/bin/env python3
"""Port of @engine/input prompts.ts glyphFor() + walk of the default profiles: the exact glyph ids the engine can ask for.
Writes ui/input/glyph_ids.referenced.json. Keep in sync with packages/input/src/prompts.ts (commit 4f133b4)."""
import json, os, re
ENG = '/workspace/engine/packages/input'
OUT = os.path.join(os.path.dirname(__file__), '..', 'input')
PS = dict(a="cross", b="circle", x="square", y="triangle", lb="l1", rb="r1", lt="l2", rt="r2", select="share", start="options", ls="l3", rs="r3")
NS = dict(a="b", b="a", x="y", y="x", lb="l", rb="r", lt="zl", rt="zr", select="minus", start="plus", ls="lstick", rs="rstick")
XB = dict(select="view", start="menu")
LAYOUTS = ["xbox", "playstation", "switch", "generic"]


def glyph_for(control, layout="generic"):
    dev, *rest = control.split("."); name = ".".join(rest)
    if dev == "key": return "kbm.key." + re.sub(r"(Left|Right)$", "", re.sub(r"^Digit", "", re.sub(r"^Key", "", name))).lower()
    if dev == "mouse": return "kbm.mouse." + ("wheel" if name.startswith("wheel") else name.lower())
    if dev == "pad":
        m = re.match(r"^([lr])[xy]$", name); n = f"{m.group(1)}s" if m else name
        mp = {"playstation": PS, "switch": NS, "xbox": XB}.get(layout, {})
        return f"gamepad.{layout}.{mp.get(n, n)}"
    if dev == "touch":
        kind, *idr = name.split("."); i = idr[0] if idr else None
        if kind == "btn": return f"touch.button.{i}"
        if kind in ("move", "aim"): return "touch.joystick"
        return f"touch.{(kind or 'tap').lower()}"
    return f"generic.{control}"


def controls_of(b):
    if b.get("control"): return [b["control"]]
    if b.get("chord"): return list(b["chord"])
    if b.get("composite"): return [v for v in b["composite"].values() if isinstance(v, str)]
    return []


def walk():
    used = {}  # glyph id -> list of "device/context/action"
    for f in ("keyboardMouse", "gamepad", "touch"):
        prof = json.load(open(f"{ENG}/profiles/{f}.json"))
        for ctx, bs in prof["bindings"].items():
            for b in bs:
                ctrls = controls_of(b) + list(b.get("modifiers") or [])
                for c in ctrls:
                    lays = LAYOUTS if c.startswith("pad.") else [None]
                    for L in lays:
                        g = glyph_for(c, L or "generic")
                        used.setdefault(g, set()).add(f"{f}/{ctx}/{b['action']}")
    tl = json.load(open(f"{ENG}/profiles/touchLayout.json"))
    for lay in tl.values():
        for el in lay["elements"]:
            if el.get("glyph"): used.setdefault(el["glyph"], set()).add(f"touchLayout/{lay['id']}/{el['id']}")
            if el["kind"] == "joystick": used.setdefault("touch.joystick", set()).add(f"touchLayout/{lay['id']}/{el['id']}")
    return {k: sorted(v) for k, v in sorted(used.items())}


if __name__ == "__main__":
    u = walk()
    bad = [k for k in u if not re.match(r"^(kbm|gamepad|touch)(\.[a-z0-9_]+)+$", k)]
    os.makedirs(OUT, exist_ok=True)
    json.dump({"source": "engine packages/input profiles + touchLayout via glyphFor() port (tools/input_ids.py)", "count": len(u), "invalid": bad, "ids": u},
              open(os.path.join(OUT, "glyph_ids.referenced.json"), "w"), indent=1)
    print(len(u), "ids; invalid:", bad)
    print(sorted(u))
