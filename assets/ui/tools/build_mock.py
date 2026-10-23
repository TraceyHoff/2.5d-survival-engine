#!/usr/bin/env python3
"""Mock UI state (ui/screens/mock/state.json): the data contract the screens bind to, filled with sample values."""
import json, os
OUT = os.path.join(os.path.dirname(__file__), '..', 'screens', 'mock', 'state.json')

ITEMS = {
 'wood': ('Wood', 'resource', 'common', 50, 0.5, 'Sturdy logs. Smells like a campfire waiting to happen.'),
 'stone': ('Stone', 'resource', 'common', 50, 1.0, 'A nice round rock. Very throwable.'),
 'fiber': ('Plant Fiber', 'resource', 'common', 99, 0.1, 'Twisty grass for rope and string.'),
 'flint': ('Flint', 'resource', 'uncommon', 50, 0.3, 'Sharp and sparky.'),
 'iron_ore': ('Iron Ore', 'resource', 'uncommon', 30, 2.0, 'Lumpy rock with shiny bits.'),
 'iron_ingot': ('Iron Ingot', 'resource', 'rare', 30, 1.5, 'Smelted at a campfire. Heavy!'),
 'berries': ('Berries', 'food', 'common', 20, 0.1, 'Sweet and squishy. A tiny snack.'),
 'water_flask': ('Water Flask', 'food', 'uncommon', 5, 1.0, 'Fresh water in a leather flask.'),
 'stone_axe': ('Stone Axe', 'tool', 'common', 1, 2.0, 'Chops trees. Slowly. Lovingly.'),
 'stone_pickaxe': ('Stone Pickaxe', 'tool', 'common', 1, 2.5, 'For rocks and ore.'),
 'iron_axe': ('Iron Axe', 'tool', 'rare', 1, 3.0, 'Chops trees much faster.'),
 'iron_pickaxe': ('Iron Pickaxe', 'tool', 'rare', 1, 3.5, 'Mines iron veins with ease.'),
 'campfire_kit': ('Campfire Kit', 'placeable', 'uncommon', 1, 4.0, 'Place to make warmth, light and cooking.'),
 'workbench_kit': ('Workbench Kit', 'placeable', 'uncommon', 1, 6.0, 'Unlocks iron tools.'),
 'golden_acorn': ('Golden Acorn', 'trinket', 'legendary', 1, 0.1, 'Lucky! Zombies seem to like it too.'),
 'straw_hat': ('Straw Hat', 'equipment', 'common', 1, 0.3, 'Shade on sunny days.'),
 'wool_sweater': ('Wool Sweater', 'equipment', 'epic', 1, 1.2, 'Hand-knitted. Very warm.'),
 'leather_boots': ('Leather Boots', 'equipment', 'uncommon', 1, 0.8, 'Squeak a little.'),
 'cooked_meat': ('Cooked Drumstick', 'food', 'uncommon', 10, 0.4, 'Hot and juicy. Very filling.'),
 'torch': ('Torch', 'tool', 'common', 5, 0.6, 'Keeps the dark (and zombies) away.'),
 'sword': ('Sword', 'tool', 'rare', 1, 2.5, 'Bonks zombies into poofs.'),
 'shield': ('Wooden Shield', 'equipment', 'uncommon', 1, 3.0, 'Blocks hugs.'),
 'spear': ('Spear', 'tool', 'uncommon', 1, 2.0, 'Pointy end goes toward zombies.'),
 'club': ('Club', 'tool', 'common', 1, 2.0, 'A very serious stick.'),
 'helmet_leather': ('Leather Cap', 'equipment', 'uncommon', 1, 0.8, 'Snug and a little warm.'),
 'armor_leather': ('Leather Vest', 'equipment', 'epic', 1, 3.0, 'Stitched with love. +Warmth.'),
 'boots_leather': ('Leather Boots', 'equipment', 'uncommon', 1, 0.8, 'Squeak a little.'),
 'apple': ('Apple', 'food', 'common', 20, 0.2, 'Crunchy!'),
 'mushroom': ('Mushroom', 'food', 'uncommon', 20, 0.1, 'Probably fine to eat.'),
 'carrot': ('Carrot', 'food', 'common', 20, 0.2, 'Good for night vision. Maybe.'),
 'bandage': ('Bandage', 'food', 'uncommon', 10, 0.1, 'Patches you right up.'),
}
CAT = {'resource': 'Resource', 'food': 'Food', 'tool': 'Tool', 'placeable': 'Placeable', 'trinket': 'Trinket', 'equipment': 'Clothing'}
RAR = {'common': 'Common', 'uncommon': 'Uncommon', 'rare': 'Rare', 'epic': 'Epic', 'legendary': 'Legendary'}


import json as _json
try:
    ITEM_IDS = {k: i + 1 for i, k in enumerate(_json.load(open('/workspace/assets/atlases/items.json'))['frames'])}
except Exception:
    ITEM_IDS = {}
SPOILS = {'berries', 'apple', 'cooked_meat', 'mushroom', 'carrot', 'raw_meat', 'fish', 'bread', 'egg', 'stew_bowl'}


def item(key, count=1, **extra):
    n, cat, rar, mx, wt, desc = ITEMS[key]
    d = {"key": key, "name": n, "icon": f"item_{key}", "category": cat, "categoryLabel": CAT[cat], "rarity": rar, "rarityLabel": RAR[rar],
         "count": count, "maxStack": mx, "weight": wt * count, "description": desc, "stats": []}
    d["id"] = ITEM_IDS.get(key, 0)
    if key in SPOILS:
        sp = extra.pop("spoiled", 0.1)
        st = next(x for x, m in (("fresh", .25), ("stale", .5), ("spoiling", .8), ("rotten", 1.01)) if sp < m)
        d["food"] = {"spoiled": sp, "stage": st, "stageLabel": st.capitalize()}
    d.update(extra)
    return d


inv_items = [item('stone_axe', durability=0.7), item('sword', durability=0.9), item('stone_pickaxe'), item('berries', 12, spoiled=0.38), item('water_flask', 2), item('wood', 34), item('stone', 18), None,
             item('fiber', 27), item('flint', 6), item('iron_ore', 4), item('iron_ingot', 2), item('campfire_kit'), item('cooked_meat', 3, spoiled=0.66), item('apple', 5, spoiled=0.05), item('golden_acorn')]
inv_items[3]['stats'] = [{"icon": "vital_hunger", "label": "Hunger", "value": "+12", "color": "text.success"}, {"icon": "vital_thirst", "label": "Thirst", "value": "+4", "color": "text.success"}]
slots = []
for i, it in enumerate(inv_items):
    slots.append({"index": i, "container": "player", "item": it, "hotkey": str(i + 1) if i < 8 else None,
                  "state": "selected" if i == 0 else ("hover" if i == 3 else None)})
hover = dict(inv_items[3])

recipes = [
 {"id": 1, "key": "stone_axe", "name": "Stone Axe", "station": "none", "stationLabel": "Hand craft", "seconds": 2, "craftable": True, "locked": False},
 {"id": 2, "key": "stone_pickaxe", "name": "Stone Pickaxe", "station": "none", "stationLabel": "Hand craft", "seconds": 2, "craftable": True, "locked": False},
 {"id": 3, "key": "campfire_kit", "name": "Campfire Kit", "station": "none", "stationLabel": "Hand craft", "seconds": 3, "craftable": True, "locked": False},
 {"id": 4, "key": "workbench_kit", "name": "Workbench Kit", "station": "none", "stationLabel": "Hand craft", "seconds": 5, "craftable": False, "locked": False},
 {"id": 5, "key": "iron_ingot", "name": "Iron Ingot", "station": "campfire", "stationLabel": "At a campfire", "seconds": 4, "craftable": True, "locked": False},
 {"id": 6, "key": "iron_axe", "name": "Iron Axe", "station": "workbench", "stationLabel": "At a workbench", "seconds": 4, "craftable": False, "locked": True},
 {"id": 7, "key": "iron_pickaxe", "name": "Iron Pickaxe", "station": "workbench", "stationLabel": "At a workbench", "seconds": 4, "craftable": False, "locked": True},
 {"id": 8, "key": "bandage", "name": "Bandage", "station": "none", "stationLabel": "Hand craft", "seconds": 1, "craftable": True, "locked": False},
]
for r in recipes:
    r["output"] = item(r["key"], 1)
have = {'wood': 34, 'stone': 18, 'fiber': 27, 'iron_ore': 4, 'iron_ingot': 2}
cur_ing = [dict(item('wood', 1), count=5, have=34), dict(item('stone', 1), count=4, have=18)]
wb_ing = [dict(item('wood', 1), count=10, have=34), dict(item('stone', 1), count=4, have=18), dict(item('iron_ingot', 1), count=3, have=2)]

pieces = [("floor", "Wood Floor", "bc_floors", True), ("wall", "Log Wall", "bc_walls", True), ("wall_window", "Window Wall", "bc_walls", True), ("door", "Door", "bc_doors", True),
          ("roof", "Thatch Roof", "bc_roofs", True), ("fence", "Picket Fence", "bc_defense", True), ("chest", "Chest", "bc_storage", True), ("campfire", "Campfire", "bc_stations", True),
          ("workbench", "Workbench", "ic_workbench", False), ("crop_plot", "Crop Plot", "bc_farming", True), ("flower_box", "Flower Box", "bc_decor", True), ("spikes", "Spikes", "bc_defense", False)]

state = {
 "app": {"title": "Cozy Wild", "tagline": "survive together · build a cozy camp", "version": "0.1.0"},
 "theme": {"vitals": {"health": {"lowAt": 0.25}}},
 "input": {"bindings": {"interact": "E"}},
 "player": {"name": "Maple", "facing": 0.6, "appearance": {"skin": "skin_light", "hair": "hair_brown", "shirt": "cloth_red"},
            "vitals": {"health": 72, "healthMax": 100, "hunger": 18, "thirst": 64, "stamina": 41, "staminaMax": 100, "bodyTemp": 35.4, "feltTemp": 4, "wetness": 0.6},
            "xp": {"level": 4, "value": 340, "next": 500},
            "stats": {"insulation": 6, "kills": 23, "days": 3},
            "effects": [{"icon": "st_wet", "label": "Soggy", "description": "Rain makes you colder.", "remaining": 42, "tone": "bad"},
                        {"icon": "st_cold", "label": "Chilly", "description": "Find a fire or a roof.", "remaining": None, "tone": "bad"},
                        {"icon": "st_well_fed", "label": "Snacked", "description": "Health regen +10%.", "remaining": 95, "tone": "good"},
                        {"icon": "st_sheltered", "label": "Cozy", "description": "Under a roof.", "remaining": None, "tone": "good"}],
            "skills": [{"icon": "ic_hammer", "label": "Building", "level": 3}, {"icon": "ic_craft", "label": "Crafting", "level": 2},
                       {"icon": "ic_bag", "label": "Foraging", "level": 4}, {"icon": "cursor_attack", "label": "Bonking", "level": 1}]},
 "hotbar": {"selected": 0, "slots": slots[:8]},
 "inventory": {"slots": slots, "weight": 31.6, "maxWeight": 50, "selected": 0},
 "hover": {"item": hover, "screenPos": [560, 110]},
 "equipment": {"head": {"item": item('helmet_leather')}, "chest": {"item": item('armor_leather')}, "feet": {"item": item('boots_leather')},
               "mainhand": {"item": item('stone_axe')}, "legs": {"item": None}, "offhand": {"item": item('shield')}, "hands": {"item": None}, "back": {"item": None}, "trinket": {"item": item('golden_acorn')}},
 "world": {"time": {"hours": 17.6, "day": 3, "phase": "dusk", "phaseIcon": "ic_sun"}, "weather": {"kind": 1, "label": "Drizzly", "icon": "st_wet"}},
 "map": {"minimap": "minimap_tex", "markers": [{"kind": "global", "x": 0, "y": 0}, {"kind": "member", "playerId": 2, "x": 20, "y": -12, "color": "#4F8FD6", "note": "in-AOI party member (from replicated entity)"}, {"kind": "camp", "x": -18, "y": 14}],
         "legend": [{"icon": "ic_home", "label": "Camp", "visible": True}, {"icon": "ic_players", "label": "Friends", "visible": True}, {"icon": "ic_campfire", "label": "Campfires", "visible": True},
                    {"icon": "ic_zombie", "label": "Zombie dens", "visible": False}, {"icon": "ic_pin", "label": "Pings", "visible": True}, {"icon": "ic_skull", "label": "Where I poofed", "visible": True}],
         "cursor": {"x": 132, "y": -48, "biome": "Meadow"}, "zoom": 1, "center": [0, 0]},
 "net": {"connected": True, "connecting": False, "rtt": 42, "serverUrl": "ws://localhost:8080", "status": "connected", "statusText": "Connected to Maple's Camp · 3 campers",
         "statusIcon": "ic_check", "error": None, "protocol": "net v3"},
 "session": {"players": [{"name": "Maple", "ping": 42, "isHost": True, "color": "#E85D4F", "status": "Chopping trees"},
                         {"name": "Bramble", "ping": 88, "isHost": False, "color": "#4F8FD6", "status": "At the campfire"},
                         {"name": "Pip", "ping": 191, "isHost": False, "color": "#72C45C", "status": "Respawning..."}]},
 "chat": {"draft": "", "channel": "global",
          "recent": [], "messages": [
   {"channel": "system", "fromPlayerId": 0, "fromName": "", "text": "Welcome to Maple's Camp! Be kind, share berries.", "tick": 72000},
   {"channel": "local", "fromPlayerId": 2, "fromName": "Bramble", "text": "hiii :D", "tick": 72400},
   {"channel": "party", "fromPlayerId": 3, "fromName": "Pip", "text": "anyone got a spare axe?", "tick": 73200, "mentions": [1]},
   {"channel": "party", "fromPlayerId": 1, "fromName": "Maple", "text": "making one now, meet at the workbench", "tick": 73400},
   {"channel": "system", "fromPlayerId": 0, "fromName": "", "text": "Night is coming. Zombies get bolder in the dark.", "tick": 75000, "kind": "warning"},
   {"channel": "clan", "fromPlayerId": 4, "fromName": "Thistle", "text": "clan meeting at the big oak tonight", "tick": 75300},
   {"channel": "global", "fromPlayerId": 2, "fromName": "Bramble", "emote": "wave", "text": "waves at everyone", "tick": 75500},
   {"channel": "trade", "fromPlayerId": 5, "fromName": "Juniper", "text": "trading 5 flint for berries?", "tick": 75800},
   {"channel": "whisper", "fromPlayerId": 2, "fromName": "Bramble", "toPlayerId": 1, "text": "psst, I hid the golden acorn", "tick": 76000}]},
 "toasts": [{"kind": "success", "title": "+3 Wood", "text": "Into your backpack.", "icon": "item_wood"},
            {"kind": "warning", "title": "Getting dark", "text": "Light a campfire soon!", "icon": "ic_moon"},
            {"kind": "danger", "title": "So hungry...", "text": "Eat something, quick!", "icon": "vital_hunger_low"}],
 "interact": {"visible": True, "verb": "Chop", "targetName": "Oak Tree", "progress": 0.55, "screenPos": [680, 290]},
 "crafting": {"filter": "", "selected": 3, "quantity": 1, "queueMax": 4, "scroll": 0,
              "categories": [{"id": "all", "label": "All", "icon": "ic_star", "active": True}, {"id": "tools", "label": "Tools", "icon": "ic_hammer", "active": False},
                             {"id": "survival", "label": "Survival", "icon": "ic_campfire", "active": False}, {"id": "food", "label": "Food", "icon": "vital_hunger", "active": False},
                             {"id": "build", "label": "Building", "icon": "bc_walls", "active": False}],
              "current": {"name": "Campfire Kit", "output": item('campfire_kit', 1), "seconds": 3, "station": "none", "stationLabel": "Hand craft", "stationIcon": "ic_check", "stationOk": True,
                          "description": "Warmth, light and cooking. Zombies hate it!", "ingredients": cur_ing, "craftable": True, "maxCraftable": 3},
              "queue": [{"index": 0, "name": "Bandage", "output": item('bandage', 1), "progress": 0.7, "total": 1}, {"index": 1, "name": "Stone Axe", "output": item('stone_axe', 1), "progress": 0, "total": 2}]},
 "recipes": recipes,
 "build": {"rotation": 90, "selected": "wall", "ghost": {"valid": True, "message": "Looks good! Click to place"},
           "categories": [{"id": "struct", "label": "Structure", "icon": "bc_walls", "active": True}, {"id": "floor", "label": "Floors", "icon": "bc_floors", "active": False},
                          {"id": "door", "label": "Doors", "icon": "bc_doors", "active": False}, {"id": "roof", "label": "Roofs", "icon": "bc_roofs", "active": False},
                          {"id": "station", "label": "Stations", "icon": "bc_stations", "active": False}, {"id": "storage", "label": "Storage", "icon": "bc_storage", "active": False},
                          {"id": "defense", "label": "Defense", "icon": "bc_defense", "active": False}, {"id": "farm", "label": "Farming", "icon": "bc_farming", "active": False},
                          {"id": "decor", "label": "Decor", "icon": "bc_decor", "active": False}],
           "pieces": [{"key": k, "name": n, "icon": ic, "affordable": a} for k, n, ic, a in pieces],
           "current": {"name": "Log Wall", "description": "Keeps zombies out. Mostly.", "hp": 300, "footprint": "2×1",
                       "cost": [dict(item('wood', 1), count=6, have=34), dict(item('fiber', 1), count=2, have=27), dict(item('stone', 1), count=20, have=18)]}},
 "settings": {"tab": "audio", "audio": {"master": 0.8, "music": 0.55, "sfx": 0.9}, "ui": {"scale": 1.25}, "access": {"largeText": False, "reduceMotion": True, "shapeCues": True}},
 "menu": {"backdrop": "menu_bg", "colors": [{"hex": "#E85D4F", "selected": True, "index": 0}, {"hex": "#4F8FD6", "selected": False, "index": 1}, {"hex": "#72C45C", "selected": False, "index": 2}, {"hex": "#F7C844", "selected": False, "index": 3}]},
 "death": {"causeText": "Starved on day 4 (should've eaten those berries)", "canRespawnAtCamp": True, "cooldown": 10, "cooldownLeft": 4,
           "stats": [{"icon": "ic_day", "value": "4", "label": "Days"}, {"icon": "ic_zombie", "value": "23", "label": "Zombies poofed"}, {"icon": "ic_craft", "value": "17", "label": "Things made"}, {"icon": "ic_home", "value": "41", "label": "Pieces built"}]},
}
# --- social / chat / trade in the FINAL net client shapes (packages/net/ARCHITECTURE.md §13-§17) ---
# Raw net objects are kept verbatim; anything the UI needs that net doesn't carry lives under `_vm` (client adapter).
NAMES = {1: "Maple", 2: "Bramble", 3: "Pip", 4: "Thistle", 5: "Juniper", 6: "Grumbleweed"}
CH = {"global": 0, "local": 1, "party": 2, "clan": 3, "trade": 4, "whisper": 5, "system": 6}
state["me"] = {"playerId": 1, "clientId": 11, "membership": {"partyId": 9, "clanId": 3, "rank": 3}}
hist = []
for m in state["chat"]["messages"]:
    c = CH[m["channel"]]
    hist.append({"channel": c, "channelId": {2: 9, 3: 3, 5: m.get("toPlayerId", 0)}.get(c, 0), "fromPlayer": m["fromPlayerId"], "fromClient": 10 + m["fromPlayerId"] if m["fromPlayerId"] else 0,
                 "tick": m["tick"], "text": m["text"] if not m.get("emote") else "", "mentions": m.get("mentions", []), "emote": 1 if m.get("emote") else 0,
                 "_vm": {"fromName": NAMES.get(m["fromPlayerId"], ""), "mentionsMe": 1 in m.get("mentions", []), "kind": m.get("kind")}})
state["chat"] = {"history": hist, "recent": hist[-3:], "draft": "", "channel": 0}
G = lambda pid, role, online=True, hp=None, inView=True: {"playerId": pid, "role": role, "_vm": {"name": NAMES[pid], "online": online, "hpPct": hp, "inView": inView}}
state["groups"] = {
  "groups": [{"id": 9, "kind": 1, "members": [{"playerId": 1, "role": 3}, {"playerId": 2, "role": 1}, {"playerId": 3, "role": 1}]},
             {"id": 3, "kind": 2, "members": [{"playerId": 1, "role": 3}, {"playerId": 4, "role": 2}, {"playerId": 2, "role": 1}, {"playerId": 5, "role": 1}],
              "banner": {"shape": 1, "pattern": 2, "colors": [0x7452ADFF, 0xFFD45AFF], "emblemId": 4}}],
  "markers": [{"playerId": 3, "x": 41.5, "y": -12.25, "hp": 64, "tick": 76080}, {"playerId": 4, "x": 60.0, "y": -8.0, "hp": 255, "tick": 76080}],
  "_vm": {"party": {"id": 9, "kind": 1, "max": 8, "members": [G(1, 3, hp=0.72), G(2, 1, hp=0.95), G(3, 1, hp=0.64, inView=False)]},
          "clan": {"id": 3, "kind": 2, "max": 50, "name": "Acorn Gang", "tag": "ACRN",
                   "banner": {"shape": 1, "pattern": 2, "colors": ["#7452AD", "#FFD45A"], "emblemId": 4},
                   "members": [G(1, 3, hp=0.72), G(4, 2, hp=None, inView=False), G(2, 1, hp=0.95), G(5, 1, online=False)]}}}
state["social"] = {"tab": "party"}
mine = [dict(item('wood', 10), slot=5, createdTick=70000), dict(item('berries', 6, spoiled=0.38), slot=3, createdTick=61000)]
theirs = [dict(item('iron_axe', 1), slot=2, durability=0.8, createdTick=50000), dict(item('flint', 5), slot=9, createdTick=52000), dict(item('iron_ingot', 2), slot=11, createdTick=55000)]
raw = lambda l: [{"slot": x["slot"], "item": x["id"], "count": x["count"], "durability": int(round((x.get("durability") or 1) * 65535)) if x.get("durability") is not None else 0, "createdTick": x["createdTick"]} for x in l]
state["trade"] = {"current": {"id": 7, "partner": 2, "status": 1, "reason": 0, "iRequested": True, "version": 8, "myOfferRevision": 3, "theirOfferRevision": 5,
                              "myLock": True, "myConfirm": False, "theirLock": False, "theirConfirm": False, "myOffer": raw(mine), "theirOffer": raw(theirs)},
                  "_vm": {"partnerName": "Bramble", "mine": mine, "theirs": theirs, "maxLines": 16, "idleSecondsLeft": 94, "idleSeconds": 120, "bothLocked": False}}
# minimap / world-map pins: in-AOI members come from entities, out-of-view from groups.markers (2 Hz)
state["map"]["memberPins"] = [{"playerId": 3, "kind": "party", "name": "Pip", "x": 41.5, "y": -12.25, "hp": 64},
                              {"playerId": 4, "kind": "clan", "name": "Thistle", "x": 60.0, "y": -8.0, "hp": 255}]
os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump(state, open(OUT, 'w'), indent=1, ensure_ascii=False)
print('mock state ok')
