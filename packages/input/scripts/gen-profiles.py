# Generates profiles/*.json (default binding profiles). Edit here, then run: python3 scripts/gen-profiles.py
import json, os
out = os.path.join(os.path.dirname(__file__), "..", "profiles")
def b(action, control=None, **kw):
    d = {"action": action}
    if control: d["control"] = control
    d.update(kw); return d
def tap(ms=250): return {"type": "tap", "maxMs": ms}
def lp(ms=500): return {"type": "longPress", "ms": ms}
def hold(ms): return {"type": "hold", "ms": ms}
def rep(): return {"type": "repeat", "delayMs": 400, "rateMs": 120}
DT = {"type": "doubleTap", "gapMs": 300}
TOG = {"type": "toggle"}
STICK = [{"type": "deadzoneRadial", "min": 0.15}]
NORM = [{"type": "normalize"}]
def wasd(action): return b(action, composite={"up": "key.KeyW", "down": "key.KeyS", "left": "key.KeyA", "right": "key.KeyD"}, processors=NORM)
def arrows(action): return b(action, composite={"up": "key.ArrowUp", "down": "key.ArrowDown", "left": "key.ArrowLeft", "right": "key.ArrowRight"}, processors=NORM)
def dpad(action): return b(action, composite={"up": "pad.dup", "down": "pad.ddown", "left": "pad.dleft", "right": "pad.dright"})
def lstick(action): return b(action, composite={"x": "pad.lx", "y": "pad.ly"}, processors=STICK)
def rstick(action): return b(action, composite={"x": "pad.rx", "y": "pad.ry"}, processors=STICK)

kbm = {
 "Gameplay": [wasd("Move"), arrows("Move"), b("Sprint", "key.ShiftLeft"), b("Primary", "mouse.left"), b("Charge", "mouse.left", interaction=hold(350)),
   b("Secondary", "mouse.right"), b("Crouch", "key.ControlLeft"), b("Interact", "key.KeyE", interaction=tap(400)), b("ContextRadial", "key.KeyE", interaction=lp()),
   b("Jump", "key.Space"), b("Reload", "key.KeyR"), *[b(f"Hotbar{i}", f"key.Digit{i}") for i in range(1, 9)],
   b("HotbarNext", "mouse.wheelDown"), b("HotbarPrev", "mouse.wheelUp"), b("QuickUse", "key.KeyX"),
   b("ToggleInventory", "key.Tab"), b("ToggleInventory", "key.KeyI"), b("ToggleCrafting", "key.KeyC"), b("ToggleMap", "key.KeyM"),
   b("OpenChat", "key.Enter"), b("OpenChat", "key.Slash"), b("OpenSocial", "key.KeyP"), b("Cancel", "key.Escape"), b("ToggleBuild", "key.KeyB"),
   b("Camera.Zoom", composite={"negative": "mouse.wheelDown", "positive": "mouse.wheelUp"}, modifiers=["key.AltLeft"]),
   b("Camera.Zoom", composite={"negative": "key.Minus", "positive": "key.Equal"})],
 "Building": [b("Build.PlaceConfirm", "mouse.left"), b("Build.RotateCW", "mouse.right"), b("Build.RotateCW", "key.KeyR"), b("Build.RotateCCW", "key.KeyQ"),
   b("Build.Cancel", "key.Escape"), b("Build.PieceNext", "mouse.wheelDown"), b("Build.PiecePrev", "mouse.wheelUp"),
   b("Build.TierNext", "mouse.wheelDown", modifiers=["key.ShiftLeft"]), b("Build.TierPrev", "mouse.wheelUp", modifiers=["key.ShiftLeft"]),
   b("Build.ToggleSnap", "key.KeyG"), b("Build.LevelUp", "key.PageUp"), b("Build.LevelDown", "key.PageDown"),
   b("Build.DemolishMode", "key.KeyX"), b("Build.UpgradeMode", "key.KeyU"), b("Build.RepairMode", "key.KeyH"), arrows("Build.Nudge"), b("ToggleBuild", "key.KeyB")],
 "Inventory": [arrows("UI.Navigate"), b("Inv.MoveSlot", "mouse.left"), b("Inv.QuickTransfer", "mouse.left", modifiers=["key.ShiftLeft"]),
   b("Inv.SplitStack", "mouse.right"), b("Inv.Drop", "key.KeyQ"), b("Inv.Equip", "key.KeyF"), b("Inv.Use", "key.KeyE"), b("Inv.TakeAll", "key.KeyR"),
   b("Inv.Sort", "key.KeyT"), b("UI.TabNext", "key.BracketRight"), b("UI.TabPrev", "key.BracketLeft"), b("UI.Back", "key.Escape"),
   b("ToggleInventory", "key.Tab"), b("ToggleInventory", "key.KeyI")],
 "Crafting": [arrows("UI.Navigate"), b("Craft.Craft", "key.Enter"), b("Craft.Craft", "mouse.left"), b("Craft.Amount", "key.Enter", modifiers=["key.ShiftLeft"], interaction=rep()),
   b("Craft.Cancel", "key.Backspace"), b("Craft.FilterNext", "key.KeyE"), b("Craft.FilterPrev", "key.KeyQ"), b("UI.Back", "key.Escape"), b("ToggleCrafting", "key.KeyC")],
 "Trade": [arrows("UI.Navigate"), b("Trade.AddOffer", "mouse.left"), b("Trade.AddOffer", "key.Enter"), b("Trade.RemoveOffer", "mouse.right"), b("Trade.RemoveOffer", "key.Backspace"),
   b("Trade.Lock", "key.KeyL"), b("Trade.Confirm", "key.KeyF"), b("UI.TabNext", "key.BracketRight"), b("UI.TabPrev", "key.BracketLeft"), b("UI.Back", "key.Escape")],
 "Chat": [b("Chat.Send", "key.Enter"), b("Chat.Cancel", "key.Escape"), b("Chat.SwitchChannel", "key.Tab")],
 "Social": [arrows("UI.Navigate"), b("Social.ContextMenu", "mouse.right"), b("UI.Submit", "key.Enter"), b("Social.Invite", "key.KeyI"), b("Social.Kick", "key.KeyK"),
   b("Social.Promote", "key.PageUp"), b("Social.Demote", "key.PageDown"), b("Social.Leave", "key.KeyL", interaction=lp(800)), b("Social.SetPermissions", "key.KeyO"),
   b("UI.TabNext", "key.BracketRight"), b("UI.TabPrev", "key.BracketLeft"), b("UI.Back", "key.Escape"), b("OpenSocial", "key.KeyP")],
 "Dialog": [b("Dialog.Confirm", "key.Enter"), b("Dialog.Confirm", "key.KeyY"), b("Dialog.Cancel", "key.Escape"), b("Dialog.Cancel", "key.KeyN")],
}
pad = {
 "Gameplay": [lstick("Move"), rstick("Aim"), b("Sprint", "pad.ls"), b("Primary", "pad.rt"), b("Charge", "pad.rt", interaction=hold(350)), b("Secondary", "pad.lt"),
   b("Crouch", "pad.rs"), b("Interact", "pad.x", interaction=tap(400)), b("ContextRadial", "pad.x", interaction=lp()), b("Jump", "pad.a"), b("Reload", "pad.y"),
   b("QuickUse", "pad.b"), b("Hotbar1", "pad.dup"), b("Hotbar2", "pad.dright"), b("Hotbar3", "pad.ddown"), b("Hotbar4", "pad.dleft"),
   b("Hotbar5", "pad.dup", modifiers=["pad.lb"]), b("Hotbar6", "pad.dright", modifiers=["pad.lb"]), b("Hotbar7", "pad.ddown", modifiers=["pad.lb"]), b("Hotbar8", "pad.dleft", modifiers=["pad.lb"]),
   b("HotbarNext", "pad.rb", interaction=tap()), b("HotbarPrev", "pad.lb", interaction=tap()), b("ToggleInventory", "pad.select", interaction=tap()), b("ToggleMap", "pad.select", interaction=lp()),
   b("ToggleCrafting", "pad.select", modifiers=["pad.lb"]), b("OpenChat", "pad.select", modifiers=["pad.rb"]), b("OpenSocial", "pad.start", interaction=lp()),
   b("Cancel", "pad.start", interaction=tap()), b("ToggleBuild", "pad.y", modifiers=["pad.lb"]),
   b("Camera.Zoom", composite={"negative": "pad.ddown", "positive": "pad.dup"}, modifiers=["pad.rb"])],
 "Building": [b("Build.PlaceConfirm", "pad.rt"), b("Build.PlaceConfirm", "pad.a"), b("Build.Cancel", "pad.b"), b("Build.RotateCW", "pad.rb"), b("Build.RotateCCW", "pad.lb"),
   b("Build.PieceNext", "pad.dright"), b("Build.PiecePrev", "pad.dleft"), b("Build.TierNext", "pad.dup"), b("Build.TierPrev", "pad.ddown"), b("Build.ToggleSnap", "pad.rs"),
   b("Build.LevelUp", "pad.dup", modifiers=["pad.lt"]), b("Build.LevelDown", "pad.ddown", modifiers=["pad.lt"]),
   b("Build.DemolishMode", "pad.x", interaction=lp()), b("Build.RepairMode", "pad.x", interaction=tap()), b("Build.UpgradeMode", "pad.y", interaction=tap()),
   rstick("Build.Nudge"), b("ToggleBuild", "pad.y", modifiers=["pad.lb"])],
 "Inventory": [dpad("UI.Navigate"), lstick("UI.Navigate"), b("Inv.MoveSlot", "pad.a"), b("Inv.QuickTransfer", "pad.y", interaction=tap()), b("Inv.TakeAll", "pad.y", interaction=lp()),
   b("Inv.SplitStack", "pad.x", interaction=tap()), b("Inv.Drop", "pad.x", interaction=lp()), b("Inv.Equip", "pad.lt"), b("Inv.Use", "pad.rt"), b("Inv.Sort", "pad.rs"),
   b("UI.TabNext", "pad.rb"), b("UI.TabPrev", "pad.lb"), b("UI.Back", "pad.b"), b("ToggleInventory", "pad.select")],
 "Crafting": [dpad("UI.Navigate"), lstick("UI.Navigate"), b("Craft.Craft", "pad.a"), b("Craft.Amount", "pad.x", interaction=rep()), b("Craft.Cancel", "pad.y"),
   b("Craft.FilterNext", "pad.rb"), b("Craft.FilterPrev", "pad.lb"), b("UI.Back", "pad.b"), b("ToggleCrafting", "pad.select", modifiers=["pad.lb"])],
 "Trade": [dpad("UI.Navigate"), lstick("UI.Navigate"), b("Trade.AddOffer", "pad.a"), b("Trade.RemoveOffer", "pad.x"), b("Trade.Lock", "pad.y"), b("Trade.Confirm", "pad.start"),
   b("UI.TabNext", "pad.rb"), b("UI.TabPrev", "pad.lb"), b("UI.Back", "pad.b")],
 "Chat": [b("Chat.Send", "pad.start"), b("Chat.Cancel", "pad.b"), b("Chat.SwitchChannel", "pad.rb"), b("Chat.QuickPhrase", "pad.y")],
 "Social": [dpad("UI.Navigate"), lstick("UI.Navigate"), b("Social.ContextMenu", "pad.a"), b("Social.Invite", "pad.x"), b("Social.SetPermissions", "pad.y"),
   b("Social.Promote", "pad.rb"), b("Social.Demote", "pad.lb"), b("Social.Kick", "pad.x", modifiers=["pad.lt"]), b("Social.Leave", "pad.select", interaction=lp(800)),
   b("UI.Back", "pad.b"), b("OpenSocial", "pad.start", interaction=lp())],
 "Dialog": [b("Dialog.Confirm", "pad.a"), b("Dialog.Cancel", "pad.b")],
}
T = lambda n: f"touch.btn.{n}"
touch = {
 "Gameplay": [b("Move", composite={"x": "touch.move.x", "y": "touch.move.y"}), b("Aim", composite={"x": "touch.aim.x", "y": "touch.aim.y"}),
   b("Sprint", T("sprint"), interaction=TOG), b("Primary", T("attack")), b("Charge", T("attack"), interaction=hold(350)), b("Secondary", T("secondary")),
   b("Crouch", T("crouch"), interaction=TOG), b("Interact", T("context"), interaction=tap(400)), b("ContextRadial", T("context"), interaction=lp()),
   b("Jump", T("jump")), b("Reload", T("reload")), *[b(f"Hotbar{i}", f"touch.hotbar.{i}") for i in range(1, 9)],
   b("HotbarNext", "touch.swipe.left"), b("HotbarPrev", "touch.swipe.right"), b("QuickUse", T("quickuse")), b("ToggleInventory", T("inventory")),
   b("ToggleCrafting", T("crafting")), b("ToggleMap", T("map")), b("OpenChat", T("chat")), b("OpenSocial", T("social")), b("Cancel", T("back")), b("ToggleBuild", T("build")),
   b("Camera.Zoom", composite={"negative": "touch.pinch.in", "positive": "touch.pinch.out"})],
 "Building": [b("Build.PlaceConfirm", T("confirm")), b("Build.Cancel", T("cancel")), b("Build.RotateCW", T("rotate")), b("Build.RotateCW", "touch.rotate.cw"), b("Build.RotateCCW", "touch.rotate.ccw"),
   b("Build.PieceNext", "touch.swipe.left"), b("Build.PiecePrev", "touch.swipe.right"), b("Build.TierNext", T("tierup")), b("Build.TierPrev", T("tierdown")),
   b("Build.ToggleSnap", T("snap")), b("Build.LevelUp", T("levelup")), b("Build.LevelDown", T("leveldown")),
   b("Build.DemolishMode", T("demolish")), b("Build.UpgradeMode", T("upgrade")), b("Build.RepairMode", T("repair")),
   b("Build.Nudge", composite={"x": "touch.ghost.x", "y": "touch.ghost.y"}), b("ToggleBuild", T("build"))],
 "Inventory": [b("Inv.MoveSlot", "touch.tap"), b("Inv.QuickTransfer", "touch.doubleTap"), b("Inv.SplitStack", "touch.longPress"),
   b("Inv.Drop", T("drop")), b("Inv.Equip", T("equip")), b("Inv.Use", T("use")), b("Inv.TakeAll", T("takeall")), b("Inv.Sort", T("sort")),
   b("UI.TabNext", "touch.swipe.left"), b("UI.TabPrev", "touch.swipe.right"), b("UI.Back", T("back")), b("ToggleInventory", T("inventory"))],
 "Crafting": [b("Craft.Craft", T("craft")), b("Craft.Amount", T("craftmore"), interaction=rep()), b("Craft.Cancel", T("cancelcraft")),
   b("Craft.FilterNext", "touch.swipe.left"), b("Craft.FilterPrev", "touch.swipe.right"), b("UI.Back", T("back"))],
 "Trade": [b("Trade.AddOffer", "touch.tap"), b("Trade.RemoveOffer", "touch.longPress"), b("Trade.Lock", T("lock")), b("Trade.Confirm", T("confirm")), b("UI.Back", T("back"))],
 "Chat": [b("Chat.Send", T("send")), b("Chat.Cancel", T("back")), b("Chat.SwitchChannel", T("channel"))],
 "Social": [b("Social.ContextMenu", "touch.longPress"), b("Social.Invite", T("invite")), b("Social.Kick", T("kick")), b("Social.Promote", T("promote")),
   b("Social.Demote", T("demote")), b("Social.Leave", T("leave"), interaction=lp(800)), b("Social.SetPermissions", T("perms")), b("UI.Back", T("back"))],
 "Dialog": [b("Dialog.Confirm", T("yes")), b("Dialog.Cancel", T("no"))],
}
for name, cls, layout, binds in [("keyboardMouse", "keyboardMouse", None, kbm), ("gamepad", "gamepad", "xbox", pad), ("touch", "touch", None, touch)]:
    p = {"id": f"default.{name}", "deviceClass": cls, **({"layout": layout} if layout else {}), "bindings": binds}
    open(os.path.join(out, f"{name}.json"), "w").write(json.dumps(p, indent=1) + "\n")
