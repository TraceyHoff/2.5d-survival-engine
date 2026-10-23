#!/usr/bin/env python3
"""ui/input/action_glyphs.json: per device (kbm | touch | gamepad.<layout>) -> context -> action -> prompt entries.
Derived from engine profiles with the glyphFor() port, so ids equal promptFor(...).glyphs at runtime. The renderer/DOM can either
call promptFor() live (preferred) or use this table (static tooltips, docs, loading-screen tips, offline previews)."""
import json, os, re
from input_ids import ENG, LAYOUTS, glyph_for, controls_of
OUT = os.path.join(os.path.dirname(__file__), '..', 'input', 'action_glyphs.json')

LABEL = {"Move": "Move", "Aim": "Aim", "Camera.Zoom": "Zoom", "Sprint": "Sprint", "Primary": "Attack / Use", "Secondary": "Block / Alt",
         "Crouch": "Sneak", "Interact": "Interact", "ContextRadial": "Actions wheel", "Charge": "Charge", "Jump": "Jump / Dodge",
         "Reload": "Reload", "HotbarNext": "Next slot", "HotbarPrev": "Previous slot", "QuickUse": "Quick eat / use",
         "ToggleInventory": "Backpack", "ToggleCrafting": "Crafting", "ToggleMap": "Map", "OpenChat": "Chat", "OpenSocial": "Clan & friends",
         "Cancel": "Back", "ToggleBuild": "Build", "Build.PlaceConfirm": "Place", "Build.Cancel": "Cancel", "Build.RotateCW": "Rotate",
         "Build.RotateCCW": "Rotate back", "Build.PieceNext": "Next piece", "Build.PiecePrev": "Previous piece", "Build.TierNext": "Tier up",
         "Build.TierPrev": "Tier down", "Build.ToggleSnap": "Snap", "Build.LevelUp": "Floor up", "Build.LevelDown": "Floor down",
         "Build.DemolishMode": "Demolish", "Build.UpgradeMode": "Upgrade", "Build.RepairMode": "Repair", "Build.Nudge": "Nudge",
         "UI.Navigate": "Navigate", "UI.Submit": "Select", "UI.Back": "Back", "UI.TabNext": "Next tab", "UI.TabPrev": "Previous tab",
         "Inv.MoveSlot": "Pick up / place", "Inv.SplitStack": "Split stack", "Inv.Drop": "Drop", "Inv.QuickTransfer": "Quick move",
         "Inv.Equip": "Equip", "Inv.Use": "Use", "Inv.TakeAll": "Take all", "Inv.Sort": "Sort", "Craft.Craft": "Craft",
         "Craft.Amount": "Amount", "Craft.Cancel": "Cancel craft", "Craft.FilterNext": "Next category", "Craft.FilterPrev": "Previous category",
         "Trade.AddOffer": "Offer", "Trade.RemoveOffer": "Take back", "Trade.Lock": "Lock offer", "Trade.Confirm": "Accept trade",
         "Chat.Send": "Send", "Chat.Cancel": "Close chat", "Chat.SwitchChannel": "Channel", "Chat.QuickPhrase": "Quick chat",
         "Social.Invite": "Invite", "Social.Kick": "Kick", "Social.Promote": "Promote", "Social.Demote": "Demote", "Social.Leave": "Leave clan",
         "Social.SetPermissions": "Permissions", "Social.ContextMenu": "Options", "Dialog.Confirm": "Confirm", "Dialog.Cancel": "Cancel"}


def label(a):
    m = re.match(r"^Hotbar(\d)$", a)
    return f"Slot {m.group(1)}" if m else LABEL.get(a, a)


def collapse(b, layout):
    """Presentation hint for composites: draw one combined glyph instead of 4 keys."""
    c = b.get("composite") or {}
    v = set(c.values())
    if {"key.KeyW", "key.KeyA", "key.KeyS", "key.KeyD"} <= v: return {"collapse": "wasd", "glyphs": ["kbm.key.w", "kbm.key.a", "kbm.key.s", "kbm.key.d"]}
    if {"key.ArrowUp", "key.ArrowDown"} <= v: return {"collapse": "arrows", "glyphs": ["kbm.key.arrowup", "kbm.key.arrow", "kbm.key.arrowdown"]}
    if any(s.startswith("pad.d") for s in v): return {"collapse": "dpad", "glyphs": [f"gamepad.{layout}.dpad"]}
    sticks = {glyph_for(s, layout) for s in v if re.match(r"pad\.[lr][xy]$", s)}
    if sticks: return {"collapse": "stick", "glyphs": sorted(sticks)}
    return None


def main():
    out = {"source": "engine packages/input/profiles via tools/gen_action_glyphs.py (glyphFor port, commit 4f133b4)",
           "devices": {}, "_doc": "entry = {glyphs[], modifiers[], interaction?, collapse?, label}; first entry is the primary prompt"}
    for f, dev in (("keyboardMouse", "kbm"), ("touch", "touch"), ("gamepad", "gamepad")):
        prof = json.load(open(f"{ENG}/profiles/{f}.json"))
        for L in (LAYOUTS if dev == "gamepad" else [None]):
            key = f"gamepad.{L}" if L else dev; d = out["devices"].setdefault(key, {})
            for ctx, bs in prof["bindings"].items():
                for b in bs:
                    lay = L or "generic"
                    e = collapse(b, lay) or {"glyphs": [glyph_for(c, lay) for c in controls_of(b)]}
                    e["modifiers"] = [glyph_for(m, lay) for m in b.get("modifiers") or []]
                    if b.get("interaction"): e["interaction"] = b["interaction"]["type"]
                    e["label"] = label(b["action"])
                    d.setdefault(ctx, {}).setdefault(b["action"], []).append(e)
    json.dump(out, open(OUT, "w"), indent=1)
    print({k: sum(len(c) for c in v.values()) for k, v in out["devices"].items()})


if __name__ == "__main__":
    main()
