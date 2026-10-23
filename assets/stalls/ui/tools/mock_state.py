import json, os
UI = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
base = json.load(open("/workspace/assets/ui/screens/mock/state.json"))
STAGES = ["fresh", "stale", "spoiling", "rotten"]  # engine gameplay/data/environment.json spoilage.stages  # itemInfo.fill 0..1 is set only for liquid containers (water_flask)
def it(key, name, cat, desc, rarity="common", count=1, maxStack=20, weight=0.5, crafter=0, cname=None, dur=None, food=None, fill=None, stats=None):
    d = {"key": key, "name": name, "icon": "item_" + key, "category": cat, "categoryLabel": {"food": "Food", "tool": "Tool", "resource": "Material", "weapon": "Weapon", "medical": "Medical"}.get(cat, cat.title()),
         "rarity": rarity, "rarityLabel": rarity.title(), "count": count, "maxStack": maxStack, "weight": weight, "description": desc, "stats": stats or [], "id": 0,
         "crafterId": crafter, "crafterName": cname}
    if dur is not None: d["durability"] = dur
    if food:  # itemInfo.freshnessStage 0..3 -> environment.spoilage.stages[i].key (fresh/stale/spoiling/rotten)
        d["freshnessStage"] = STAGES.index(food["stage"]); d["food"] = food
    if fill is not None: d["fill"] = fill
    return d
COIN = {"item": "coin", "icon": "coin", "name": "coins"}
def P(n, kind=COIN): return dict(kind, count=n)
IRON = {"item": "iron_ingot", "icon": "item_iron_ingot", "name": "iron"}
BER = {"item": "berries", "icon": "item_berries", "name": "berries"}
goods = [
    (it("berries", "Berries", "food", "Sweet and squishy. A tiny snack.", count=5, food={"spoiled": 0.1, "stage": "fresh", "stageLabel": "Fresh"}, stats=[{"icon": "vital_hunger", "label": "Hunger", "value": "+12", "color": "text.success"}]), 5, P(3), 14),
    (it("cooked_meat", "Cooked Meat", "food", "Juicy and warm. Smells like camp.", count=1, crafter=7, cname="Mabel", food={"spoiled": 0.32, "stage": "stale", "stageLabel": "Stale"}, stats=[{"icon": "vital_hunger", "label": "Hunger", "value": "+35", "color": "text.success"}]), 1, P(4), 6),
    (it("stone_axe", "Stone Axe", "tool", "Chops trees. Slowly. Lovingly.", maxStack=1, weight=2.0, crafter=7, cname="Mabel", dur=0.92), 1, P(12), 2),
    (it("bronze_sword", "Bronze Sword", "weapon", "Bonks zombies into poofs, with style.", rarity="rare", maxStack=1, weight=2.5, crafter=12, cname="Ivo the Smith", dur=1.0, stats=[{"icon": "ic_star", "label": "Damage", "value": "18", "color": "text.primary"}]), 1, P(2, IRON), 1),
    (it("rope", "Rope", "resource", "Twisty fibre. Ties things to other things.", crafter=7, cname="Mabel"), 2, P(2), 10),
    (it("bandage", "Bandage", "medical", "Soft and clean. Stops ouchies.", rarity="uncommon", crafter=3, cname="Pip"), 1, P(5), 0),
    (it("water_flask", "Water Flask", "tool", "Never spoils, just runs dry. Refill at water.", maxStack=1, weight=1.0, crafter=3, cname="Pip", fill=0.75), 1, P(6), 3),
    (it("planks", "Pine Planks", "resource", "Smooth boards for building.", crafter=0), 10, P(4), 8),
    (it("iron_ingot", "Iron Ingot", "resource", "Heavy, shiny, very useful.", rarity="uncommon", weight=1.0, crafter=12, cname="Ivo the Smith"), 1, P(9), 5),
    (it("wood", "Pine Log", "resource", "A log. Classic.", crafter=0), 10, P(10, BER), 20),
    (it("nails", "Nails", "resource", "Pointy little helpers.", crafter=12, cname="Ivo the Smith"), 5, P(1), 30),
    (it("cloth", "Cloth", "resource", "Woven and cozy.", crafter=3, cname="Pip"), 1, P(3), 0),
]
listings = []
for i, (item, qty, pr, stock) in enumerate(goods):
    listings.append({"slot": i, "item": item, "qty": qty, "price": pr, "stock": stock, "enabled": stock > 0 or i != 5, "soldOut": stock == 0, "sold": [12, 3, 1, 2, 9, 7, 0, 4, 2, 5, 11, 6][i],
                     "state": "selected" if i == 2 else None})
st = base
st["stall"] = {"header": {"stallId": 4021, "pieceKey": "clan_pavilion", "ownerKind": 2, "ownerId": 3, "ownerName": "Berry Clan", "clanTag": "BRY", "clanColor": "berry-500",
                          "open": 1, "listingCount": 24},
               "sign": {"name": "Berry Clan Market", "nameLen": 17, "soldOut": 0},
               "revision": 17, "listings": listings, "filtered": listings, "selected": listings[2],
               "ui": {"filter": "all", "sort": "price", "sortLabel": "Cheapest", "search": ""},
               "viewer": {"role": 2, "roleLabel": "Member", "canBuy": True, "perms": {"list": False, "price": False, "stock": True, "collect": False, "remove": False},
                          "lockReason": {"list": "Only leaders and officers can list items.", "price": "Only leaders and officers can set prices.", "collect": "Only leaders and officers can collect the till.", "stock": ""}}}
st["wallet"] = {"coin": 42, "coinText": "42"}
st["buy"] = {"listing": listings[2], "qty": 2, "maxQty": 2, "total": 24, "have": 42, "haveAfter": 18, "canAfford": True, "hasSpace": True, "state": "ok", "message": ""}
st["manage"] = {"tab": "listings", "till": {"items": [{"key": "coin", "name": "Coin", "count": 128, "rarity": "common"}, {"key": "iron_ingot", "name": "Iron", "count": 4, "rarity": "common"}, {"key": "berries", "name": "Berries", "count": 30, "rarity": "common"}], "totalText": "3 stacks", "canCollect": False},
                "ledgerTotal": 214, "ledger": [{"icon": f"item_{g[0]['key']}", "buyerName": b, "count": c, "priceIcon": g[2]["icon"], "priceCount": g[2]["count"] * c, "ago": a}
                    for g, b, c, a in [(goods[0], "Juniper", 3, "1m"), (goods[2], "Rook", 1, "4m"), (goods[3], "Wren", 1, "12m"), (goods[4], "Juniper", 2, "20m"), (goods[9], "Bo", 1, "1h"), (goods[1], "Fern", 2, "2h"), (goods[8], "Ivo", 1, "3h")]],
                "perms": [{"rank": r, "label": l, "acts": [{"act": a, "on": on, "reason": "" if on else f"{l}s can't {a.lower()}"} for a, on in zip(("List", "Price", "Stock", "Collect", "Buy"), acts)]}
                          for r, l, acts in [("leader", "Leader", (1, 1, 1, 1, 1)), ("officer", "Officer", (1, 1, 1, 1, 1)), ("member", "Member", (0, 0, 1, 0, 1)), ("recruit", "Recruit", (0, 0, 0, 0, 1))]],
                "permNote": "You are a Member: you can stock goods. Ask an officer to change prices or collect the till."}
st["market"] = {"query": "axe", "sortLabel": "Cheapest", "results": [
    {"item": goods[2][0], "stallName": "Berry Clan Market", "ownerName": "Berry Clan", "clanTag": "BRY", "clanColor": "berry-500", "priceIcon": "coin", "priceCount": 12, "stock": 2, "distance": 14, "x": 10, "y": 4},
    {"item": dict(goods[2][0], crafterName="Rook"), "stallName": "Pip's Cart", "ownerName": "Pip", "clanTag": None, "priceIcon": "coin", "priceCount": 14, "stock": 1, "distance": 32, "x": 2, "y": 9},
    {"item": it("iron_axe", "Iron Axe", "tool", "Chop chop!", rarity="uncommon", maxStack=1, dur=0.8, crafter=12, cname="Ivo the Smith"), "stallName": "Sky Traders", "ownerName": "Sky Traders", "clanTag": "SKY", "clanColor": "blue-500", "priceIcon": "item_iron_ingot", "priceCount": 3, "stock": 1, "distance": 48, "x": 20, "y": -6},
    {"item": it("bronze_axe", "Bronze Axe", "tool", "Shiny chopper.", maxStack=1, dur=1.0, crafter=9, cname="Wren"), "stallName": "Wren's Booth", "ownerName": "Wren", "clanTag": "SKY", "clanColor": "blue-500", "priceIcon": "item_berries", "priceCount": 40, "stock": 3, "distance": 61, "x": 30, "y": 2}]}
st["inspect"] = {"item": goods[3][0], "price": goods[3][2]}
st["tipA"] = {"item": goods[1][0], "price": goods[1][2]}
st["tipB"] = {"item": goods[6][0], "price": None}
st["hover"] = {"item": goods[1][0]}
st["toast"] = {"sale": {"count": 2, "itemName": "Rope", "buyerName": "Juniper", "priceCount": 4, "priceName": "coins"}, "till": {"items": 3}}
json.dump(st, open(os.path.join(UI, "screens", "mock", "state.json"), "w"), indent=1, ensure_ascii=False)
print("mock ok")
