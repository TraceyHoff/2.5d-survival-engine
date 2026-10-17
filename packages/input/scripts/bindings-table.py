# Prints markdown default binding tables from profiles/*.json (used in docs/ARCHITECTURE.md "Input System").
import json, os
d = os.path.join(os.path.dirname(__file__), "..", "profiles")
P = {c: json.load(open(os.path.join(d, f"{c}.json"))) for c in ["keyboardMouse", "gamepad", "touch"]}
def fmt(b):
    if "control" in b: s = b["control"]
    elif "chord" in b: s = "+".join(b["chord"])
    else:
        c = b["composite"]; s = "/".join(c[k] for k in c)
    s = s.replace("key.", "").replace("Key", "").replace("Digit", "").replace("touch.btn.", "btn:")
    if b.get("modifiers"): s = "+".join(m.replace("key.", "") for m in b["modifiers"]) + "+" + s
    it = b.get("interaction")
    if it and it["type"] != "press": s += f" ({it['type']}{' ' + str(it.get('ms') or it.get('maxMs') or '') + 'ms' if it.get('ms') or it.get('maxMs') else ''})"
    return f"`{s}`"
for ctx in P["keyboardMouse"]["bindings"]:
    print(f"\n**{ctx}**\n\n| Action | Keyboard & mouse | Gamepad (standard / Xbox names) | Touch |\n|---|---|---|---|")
    acts = []
    for c in P.values():
        for b in c["bindings"].get(ctx, []):
            if b["action"] not in acts: acts.append(b["action"])
    for a in acts:
        cells = [", ".join(fmt(b) for b in P[c]["bindings"].get(ctx, []) if b["action"] == a) or "—" for c in P]
        print(f"| {a} | " + " | ".join(cells) + " |")
