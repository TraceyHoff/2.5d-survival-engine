"""Generates stalls/ui/screens/*.json (Cozy Camp schema ui-screen/1) + mock/state.json."""
import json, os
UI = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SC = os.path.join(UI, "screens")
def T(text, font="body", **k): return dict(type="text", text=text, font=font, **k)
def box(children, layout="row", **k):
    k.setdefault("w", "fill"); return dict(type="box", layout=layout, children=children, **k)
def Btn(label, variant="primary", **k): return dict(type="button", label=label, variant=variant, **k)
def ic(name, s=24, **k): return dict(type="icon", icon=name, w=s, h=s, **k)
def kh(key, label, **k): return dict(type="keyhint", key=key, label=label, **k)
def hints(*pairs): return box([kh(a, b) for a, b in pairs], gap=14, h=30, w="auto", align="center")
def price(icon_expr, count_expr, font="label", s=20):
    return box([ic(icon_expr, s), T(count_expr, font, w="auto")], gap=3, h=s + 2, w="auto", align="center")
def lockable(btn, perm, reason):
    """button disabled with a lock + reason tooltip when the viewer lacks the permission"""
    b = dict(btn); b["disabled"] = "{!" + perm + "}"; b["tooltip"] = "{" + perm + " ? \"\" : " + reason + "}"
    b["icon"] = "{" + perm + " ? \"" + btn.get("icon", "") + "\" : \"ic_lock\"}"; b["focusable"] = True
    return b
def screen(id_, title, root, **k):
    d = {"$schema": "../../../ui/screens/screen.schema.json", "schema": "ui-screen/1", "id": id_, "title": title, "layer": k.pop("layer", "window"), "modal": k.pop("modal", False)}
    d.update(k); root["layout"] = "abs"; d["root"] = root; return d
INPUT_NOTE = {"touch": "tap = focus+activate, long-press = inspect, swipe grid scrolls; min hit 48px", "gamepad": "D-pad/LS moves focus over focusOrder; A activate, X inspect, Y sort, LB/RB filter tabs, B back", "kbm": "click, wheel scroll, / focuses search, Enter buy, I inspect, Esc close"}

# ------------------------------------------------------------------ partials
listing_card = {"schema": "ui-partial/1", "params": {"l": "{listing}"}, "root": dict(
    type="panel", w=196, h=78, pad=6, layout="row", gap=8, align="center", focusable=True, frame="{$l.state == \"selected\" ? \"slot_selected\" : \"panel_inset\"}",
    action={"event": "stall.selectListing", "args": {"slot": "{$l.slot}"}}, longPress={"event": "ui.open", "args": {"screen": "item_inspect", "slot": "{$l.slot}"}},
    children=[
        dict(type="slot", w=56, h=56, bind="{$l.item}", showCount=False, missing="{$l.soldOut}"),
        box([T("{$l.item.name}", "label", h=18, w="fill"),
             box([ic("{$l.price.icon}", 20), T("{$l.price.count}", "heading", w="auto"), T("{$l.qty > 1 ? \"for \" + $l.qty : \"\"}", "tiny", w="auto", color="text.muted")], gap=3, h=22, align="center", w="fill"),
             T("{$l.soldOut ? \"Sold out\" : $l.stock + \" left\"}", "tiny", h=16, color="{$l.soldOut ? \"text.danger\" : \"text.muted\"}")], "col", w="fill", h=60, gap=1)])}
crafted_line = {"schema": "ui-partial/1", "params": {"item": "{hover.item}"}, "root": box(
    [ic("ui_maker_mark", 18), T("{\"Crafted by \" + $item.crafterName}", "small", w="fill", color="text.secondary")],
    gap=6, h=20, w="fill", align="center", visible="{$item.crafterId > 0}",
    comment="crafterId 0 = gathered -> hidden. crafterName resolved client-side from the PlayerNameDirectory (follows renames); unknown id -> \"a wanderer\".")}
tooltip = {"schema": "ui-partial/1", "$comment": "Drop-in successor of ui/screens/_partials/item_tooltip.json (see ../../PATCH_ui_tooltip.md). Adds rarity border, Crafted-by line, durability bar, fill level (water_flask), price line (stalls).",
    "params": {"item": "{hover.item}", "price": "{null}"},
    "root": dict(type="tooltip", id="item_tooltip", w=268, h="auto", pad=12, layout="col", gap=6, rarityBorder="{$item.rarity}", children=[
        box([dict(type="slot", w=44, h=44, bind="{$item}", showCount=False),
             box([T("{$item.name}", "heading", h=22, w="fill"),
                  T("{$item.rarityLabel} \u00b7 {$item.categoryLabel}", "small", h=16, color="{\"rarity.\" + $item.rarity}")], "col", w="fill", h=44)], gap=8, h=44, align="center"),
        {"type": "include", "src": "_partials/crafted_by.json", "params": {"item": "{$item}"}},
        {"type": "divider", "w": "fill", "h": 14},
        T("{$item.description}", "small", w="fill", wrap=True, h="auto"),
        box([dict(type="foodbadge", stage="{$item.food.stage}", w=16, h=16), T("{$item.food.stageLabel}", "label", w=70, color="{\"food.\" + $item.food.stage}"),
             dict(type="bar", vital="hunger", value="{1 - $item.food.spoiled}", max=1, w="fill", h=12, thin=True)], gap=6, h=20, w="fill", align="center", visible="{$item.food}"),
        box([ic("ui_stall_fill", 16), T("Fill", "label", w=70, color="text.link"), dict(type="bar", vital="thirst", value="{$item.fill}", max=1, w="fill", h=12, thin=True)],
            gap=6, h=20, w="fill", align="center", visible="{$item.fill != null}", comment="water_flask: no spoilage, fill level only"),
        box([ic("ic_hammer", 16), T("Durability", "label", w=86), dict(type="bar", vital="stamina", value="{$item.durability}", max=1, w="fill", h=12, thin=True),
             T("{$item.durability|pct}", "tiny", w=36, align="right")], gap=6, h=20, w="fill", align="center", visible="{$item.durability != null}"),
        {"type": "repeat", "each": "{$item.stats}", "as": "stat", "layout": "col", "gap": 2, "w": "fill", "h": "auto",
         "template": box([ic("{stat.icon}", 20), T("{stat.label}", "small", w="fill"), T("{stat.value}", "label", color="{stat.color}")], gap=6, h=20, w="fill")},
        box([ic("{$price.icon}", 18), T("{$price ? \"Price \" + $price.count + \" \" + $price.name : \"\"}", "label", w="fill")], gap=6, h=20, w="fill", align="center", visible="{$price}"),
        box([ic("ic_weight", 16), T("{$item.weight|fixed1} kg", "tiny", w="fill"), T("{$item.count}/{$item.maxStack}", "tiny")], h=18, w="fill")])}

# ------------------------------------------------------------------ browse
header = box([
    dict(type="avatar", color="{stall.header.ownerId}", w=40, h=40),
    box([box([T("{stall.header.stallName}", "title", w="auto", h=36),
              dict(type="badge", text="{stall.header.open ? \"Open\" : \"Closed\"}", icon="{stall.header.open ? \"ic_check\" : \"ic_moon\"}", color="{stall.header.open ? \"leaf-500\" : \"slate-500\"}", w=86, h=24)], gap=10, h=36, align="center"),
         box([T("{\"by \" + stall.header.ownerName}", "small", w="auto", h=18, color="text.secondary"),
              dict(type="badge", text="{\"[\" + stall.header.clanTag + \"]\"}", color="{stall.header.clanColor}", w=64, h=20, visible="{stall.header.clanTag}")], gap=8, h=20, align="center")], "col", w="fill", h=56),
    box([ic("coin", 28), T("{wallet.coinText}", "heading", w="auto"), T("in bag", "tiny", w="auto", color="text.muted")], gap=4, h=40, w="auto", align="center",
        comment="wallet = count of `coin` (or the selected price item) in the player's Inventory")], gap=12, h=56, w="fill", align="center")
toolbar = box([
    dict(type="input", bind="{stall.ui.search}", placeholder="Search goods\u2026", icon="ic_info", w=230, h=40, id="search", action={"event": "stall.search", "args": {"text": "$value"}}),
    dict(type="tabs", small=True, bind="{stall.ui.filter}", w="fill", h=36, items=[{"id": "all", "label": "All"}, {"id": "food", "label": "Food"}, {"id": "tool", "label": "Tools"}, {"id": "resource", "label": "Stuff"}, {"id": "weapon", "label": "Gear"}],
         action={"event": "stall.filter", "args": {"category": "$id"}}),
    Btn("{stall.ui.sortLabel}", "secondary", icon="ui_stall_sort", w=150, h=40, action={"event": "stall.sort", "args": {"key": "next"}})], gap=10, h=40, w="fill", align="center")
grid = dict(type="list", w="fill", h="fill", pad=[4, 0, 4, 4], children=[{"type": "repeat", "each": "{stall.filtered}", "as": "listing", "layout": "grid", "cols": 4, "cell": [196, 78], "gap": 8,
    "template": {"type": "include", "src": "_partials/listing_card.json", "params": {"l": "{listing}"}}}])
footer = box([hints(("A", "Buy"), ("X", "Inspect"), ("Y", "Sort"), ("LB RB", "Filter"), ("B", "Close")), box([], w="fill"),
              Btn("Buy\u2026", "primary", icon="coin", w=150, h=44, disabled="{!stall.selected || stall.selected.soldOut || !stall.header.open}", action={"event": "ui.open", "args": {"screen": "stall_buy"}})], gap=10, h=44, w="fill", align="center")
browse = screen("stall_browse", "Stall", box([dict(type="scrim", alpha=0.3),
    dict(type="panel", frame="panel_wood_vine", anchor="cc", w=880, h=600, pad=24, layout="col", gap=10, children=[
        dict(type="panel", frame="panel_parchment", w="fill", h="fill", pad=16, layout="col", gap=10, children=[header, {"type": "divider", "w": "fill", "h": 14}, toolbar, grid, footer])]),
    dict(type="button", variant="close", anchor="cc", x=424, y=-284, w=40, h=40, action={"event": "ui.close", "args": {"screen": "stall_browse"}})], w="fill", h="fill"),
    setsState={"ui.windowOpen": True}, opens="interact with a stall piece (StallHeader in AOI) -> net sends full Listings to the viewer",
    binds="stall.* (see DATA_PATHS.md). stall.filtered = adapter-derived (filter+search+sort over stall.listings).", input=INPUT_NOTE,
    focusOrder=["search", "tabs", "sort", "grid", "buy"], hotkeys={"/": "focus:search", "Enter": "stall.buySelected", "I": "inspect", "Esc": "close"})

browse_phone = screen("stall_browse_phone", "Stall (phone)", box([
    dict(type="panel", frame="panel_parchment", anchor="cc", w=380, h=690, pad=12, layout="col", gap=8, children=[
        box([dict(type="avatar", color="{stall.header.ownerId}", w=36, h=36),
             box([T("{stall.header.stallName}", "heading", h=22), box([T("{\"by \" + stall.header.ownerName}", "tiny", w="auto"), dict(type="badge", text="{\"[\" + stall.header.clanTag + \"]\"}", color="{stall.header.clanColor}", w=56, h=18, visible="{stall.header.clanTag}")], gap=6, h=18, align="center")], "col", w="fill", h=40),
             dict(type="button", variant="close", w=40, h=40)], gap=8, h=44, align="center"),
        box([ic("coin", 22), T("{wallet.coinText}", "label", w="auto"), box([], w="fill"), dict(type="badge", text="{stall.header.open ? \"Open\" : \"Closed\"}", color="leaf-500", w=70, h=22)], gap=4, h=26, align="center"),
        dict(type="input", bind="{stall.ui.search}", placeholder="Search goods\u2026", w="fill", h=48),
        dict(type="tabs", small=True, bind="{stall.ui.filter}", w="fill", h=40, items=[{"id": "all", "label": "All"}, {"id": "food", "label": "Food"}, {"id": "tool", "label": "Tools"}, {"id": "resource", "label": "Stuff"}]),
        dict(type="list", w="fill", h="fill", children=[{"type": "repeat", "each": "{stall.filtered}", "as": "listing", "layout": "grid", "cols": 2, "cell": [158, 78], "gap": 6,
             "template": {"type": "include", "src": "_partials/listing_card_phone.json", "params": {"l": "{listing}"}}}]),
        box([Btn("{stall.ui.sortLabel}", "secondary", icon="ui_stall_sort", w=140, h=52), Btn("Buy", "primary", icon="coin", w="fill", h=52)], gap=8, h=52, w="fill")])], w="fill", h="fill"),
    setsState={"ui.windowOpen": True}, layoutFor="viewport width < 720 or input=touch portrait", input=INPUT_NOTE)
card_phone = json.loads(json.dumps(listing_card)); r = card_phone["root"]; r["w"] = 158; r["h"] = 78; r["children"][0]["w"] = r["children"][0]["h"] = 48

# ------------------------------------------------------------------ buy
buy = screen("stall_buy", "Buy", box([dict(type="scrim", alpha=0.45),
    dict(type="panel", frame="panel_wood", anchor="cc", w=520, h=500, pad=22, layout="col", gap=8, children=[
        dict(type="panel", frame="panel_parchment", w="fill", h="fill", pad=16, layout="col", gap=10, children=[
            box([dict(type="slot", w=72, h=72, bind="{buy.listing.item}", showCount=False),
                 box([T("{buy.listing.item.name}", "title", h=34), {"type": "include", "src": "_partials/crafted_by.json", "params": {"item": "{buy.listing.item}"}},
                      box([T("Each:", "small", w="auto"), ic("{buy.listing.price.icon}", 20), T("{buy.listing.price.count} {buy.listing.price.name} for {buy.listing.qty}", "label", w="auto")], gap=4, h=22, align="center")], "col", w="fill", h=80, gap=2)], gap=12, h=80, align="center"),
            {"type": "divider", "w": "fill", "h": 14},
            box([T("How many?", "heading", w="fill"), dict(type="stepper", bind="{buy.qty}", w=180, h=44, min=1, max="{buy.maxQty}", id="qty",
                 action={"event": "stall.qty", "args": {"delta": "$delta"}}), Btn("Max", "secondary", w=70, h=44, action={"event": "stall.qty", "args": {"value": "{buy.maxQty}"}})], gap=10, h=44, align="center"),
            T("{buy.listing.stock} in stock \u00b7 you get {buy.qty * buy.listing.qty}", "small", h=18, color="text.muted"),
            dict(type="panel", frame="panel_inset", w="fill", h=88, pad=12, layout="col", gap=4, children=[
                box([T("Total", "heading", w="fill"), ic("{buy.listing.price.icon}", 28), T("{buy.total}", "title", w="auto")], gap=6, h=34, align="center"),
                box([T("You have", "small", w="fill"), T("{buy.have}", "label", w="auto", color="{buy.canAfford ? \"text.success\" : \"text.danger\"}"), T("\u2192 {buy.haveAfter}", "small", w="auto", color="text.muted", visible="{buy.canAfford}")], gap=6, h=22, align="center")]),
            box([ic("ic_warn", 22), T("{buy.message}", "label", w="fill", color="text.danger")], gap=6, h=26, align="center", visible="{buy.state != \"ok\"}"),
            box([], h="fill"),
            box([Btn("Back", "secondary", w=130, h=48, action={"event": "ui.close", "args": {"screen": "stall_buy"}}), box([], w="fill"),
                 Btn("{buy.state == \"ok\" ? \"Buy!\" : buy.state == \"funds\" ? \"Not enough\" : \"Bag full\"}", "primary", icon="coin", w=200, h=48, disabled="{buy.state != \"ok\"}", id="confirm",
                     action={"event": "stall.buy", "args": {"stall": "{stall.header.stallId}", "slot": "{buy.listing.slot}", "qty": "{buy.qty}", "revision": "{stall.revision}"}})], gap=10, h=48, align="center"),
            hints(("A", "Confirm"), ("LS", "Amount"), ("B", "Back"))])])], w="fill", h="fill"),
    layer="modal", modal=True, input=INPUT_NOTE, focusOrder=["qty", "max", "confirm", "back"],
    states={"ok": "buyable", "funds": "have < total (price item count in inventory)", "space": "no free slot / overweight for qty*listing.qty", "stock": "qty > stock (clamped)", "closed": "stall closed meanwhile -> toast + close"},
    sends="stall.buy {stall, slot, qty, revision}; server re-validates price/stock/revision atomically (Listings.revision)")

# ------------------------------------------------------------------ manage
row = box([dict(type="slot", w=48, h=48, bind="{l.item}", showCount=False),
           box([T("{l.item.name}", "label", h=18), T("{l.stock} in stock \u00b7 sold {l.sold}", "tiny", h=14, color="text.muted")], "col", w=170, h=36),
           box([lockable(dict(type="button", variant="secondary", w=32, h=32, icon="ic_minus", action={"event": "stall.setPrice", "args": {"slot": "{l.slot}", "delta": -1}}), "stall.viewer.perms.price", "stall.viewer.lockReason.price"),
                box([ic("{l.price.icon}", 20), T("{l.price.count}", "heading", w="auto")], gap=3, w=62, h=32, align="center", justify="center"),
                lockable(dict(type="button", variant="secondary", w=32, h=32, icon="ic_plus", action={"event": "stall.setPrice", "args": {"slot": "{l.slot}", "delta": 1}}), "stall.viewer.perms.price", "stall.viewer.lockReason.price")], gap=4, w=150, h=32, align="center"),
           lockable(dict(type="button", variant="info", label="Item", w=74, h=32, icon="ui_stall_tag", action={"event": "stall.pickPriceItem", "args": {"slot": "{l.slot}"}}), "stall.viewer.perms.price", "stall.viewer.lockReason.price"),
           T("x{l.qty}", "label", w=36),
           lockable(dict(type="button", variant="primary", label="Stock", w=92, h=32, icon="ui_stall_restock", action={"event": "stall.stock", "args": {"slot": "{l.slot}"}}), "stall.viewer.perms.stock", "stall.viewer.lockReason.stock"),
           dict(type="toggle", bind="{l.enabled}", w=56, h=32, disabled="{!stall.viewer.perms.list}", tooltip="{stall.viewer.perms.list ? \"\" : stall.viewer.lockReason.list}", action={"event": "stall.enable", "args": {"slot": "{l.slot}", "enabled": "$value"}}),
           ic("{stall.viewer.perms.list ? \"\" : \"ic_lock\"}", 18)],
          gap=8, h=56, w="fill", align="center", pad=[4, 8, 4, 8], focusable=True)
manage_tabs = dict(type="tabs", bind="{manage.tab}", w=520, h=40, items=[{"id": "listings", "label": "Listings", "icon": "ui_stall_tag"}, {"id": "till", "label": "Till & Ledger", "icon": "ui_stall_till"}, {"id": "perms", "label": "Clan rights", "icon": "ui_stall_clan_key"}],
                   action={"event": "manage.tab", "args": {"tab": "$id"}})
till = dict(type="panel", frame="panel_inset", w=300, h="fill", pad=12, layout="col", gap=8, children=[
    box([ic("ui_stall_till", 28), T("Till", "heading", w="fill"), T("{manage.till.totalText}", "label", w="auto")], gap=6, h=30, w="fill", align="center"),
    {"type": "repeat", "each": "{manage.till.items}", "as": "t", "layout": "grid", "cols": 5, "cell": [48, 48], "gap": 4, "template": dict(type="slot", w=48, h=48, bind="{t}")},
    lockable(Btn("Collect all", "gold", icon="coin", w="fill", h=44, id="collect", action={"event": "stall.collect", "args": {"stall": "{stall.header.stallId}"}}), "stall.viewer.perms.collect", "stall.viewer.lockReason.collect"),
    {"type": "divider", "w": "fill", "h": 14},
    box([ic("ui_stall_ledger", 24), T("Ledger", "heading", w="fill"), T("{manage.ledgerTotal} sales", "tiny", w=70, align="right", color="text.muted")], gap=6, h=26, w="fill", align="center"),
    dict(type="list", w="fill", h="fill", children=[{"type": "repeat", "each": "{manage.ledger}", "as": "e", "layout": "col", "gap": 2, "w": "fill", "h": "auto",
        "template": box([ic("{e.icon}", 20), T("{e.buyerName} bought {e.count}", "tiny", w="fill"), ic("{e.priceIcon}", 16), T("{e.priceCount}", "tiny", w=26), T("{e.ago}", "tiny", w=34, color="text.muted")], gap=4, h=22, w="fill", align="center")}])])
manage = screen("stall_manage", "Manage stall", box([dict(type="scrim", alpha=0.3),
    dict(type="panel", frame="panel_wood_vine", anchor="cc", w=1180, h=640, pad=22, layout="col", gap=8, children=[
        dict(type="panel", frame="panel_parchment", w="fill", h="fill", pad=14, layout="col", gap=10, children=[
            box([ic("ui_stall_stall", 36), box(w=640, children=[dict(type="input", bind="{stall.header.stallName}", w=300, h=40, disabled="{!stall.viewer.perms.list}", action={"event": "stall.rename", "args": {"name": "$value"}}),
                 T("{stall.header.ownerKind == 2 ? \"Clan stall \u00b7 [\" + stall.header.clanTag + \"] \u00b7 you are \" + stall.viewer.roleLabel : \"Your stall\"}", "small", w="auto", color="text.secondary")], gap=12, h=40, align="center"),
                 box([], w="fill"), T("{stall.header.open ? \"Open for trade\" : \"Closed\"}", "label", w="auto"),
                 dict(type="toggle", bind="{stall.header.open}", w=56, h=32, id="open", disabled="{!stall.viewer.perms.list}", action={"event": "stall.setOpen", "args": {"stall": "{stall.header.stallId}", "open": "$value"}}), ic("{stall.viewer.perms.list ? \"\" : \"ic_lock\"}", 20)], gap=10, h=44, w="fill", align="center"),
            manage_tabs,
            box([dict(type="panel", frame="panel_inset", w="fill", h="fill", pad=8, layout="col", gap=4, children=[
                    box([T("Item", "tiny", w=226), T("Price (each sale)", "tiny", w=150), T("Paid in", "tiny", w=74), T("Qty", "tiny", w=36), T("", "tiny", w=92), T("On", "tiny", w=56)], gap=8, h=16, pad=[0, 8, 0, 64]),
                    dict(type="list", w="fill", h="fill", children=[{"type": "repeat", "each": "{stall.listings}", "as": "l", "layout": "col", "gap": 4, "w": "fill", "h": "auto", "template": row}]),
                    box([lockable(Btn("List item from bag\u2026", "primary", icon="ic_plus", w=240, h=44, action={"event": "ui.open", "args": {"screen": "stall_list_item"}}), "stall.viewer.perms.list", "stall.viewer.lockReason.list"),
                         T("{stall.listings.length}/{stall.header.listingCount} listing slots", "small", w="fill", color="text.muted")], gap=12, h=44, align="center")]),
                 till], gap=12, h="fill", w="fill"),
            hints(("A", "Edit"), ("LS", "Price"), ("X", "Stock"), ("Y", "On/Off"), ("LB RB", "Tabs"), ("B", "Close"))])])], w="fill", h="fill"),
    setsState={"ui.windowOpen": True}, opens="owner (or clan member with any right) interacts with own stall; Shift/hold-interact on clan stall", input=INPUT_NOTE,
    sends="stall.list {invSlot, listingSlot, qty, price{item,count}} | stall.setPrice {slot, item?, count|delta} | stall.stock {slot, invSlot, count} | stall.enable {slot, enabled} | stall.collect {stall} | stall.setOpen {stall, open} | stall.remove {slot}",
    permissions="clan stalls: leader+officer list/price/collect, member stock only, recruit buy only (StallActs). Disabled controls show ic_lock + tooltip stall.viewer.lockReason.<act>")
perm_row = box([dict(type="rank", rank="{r.rank}", w=28, h=28), T("{r.label}", "label", w=120),
                {"type": "repeat", "each": "{r.acts}", "as": "a", "layout": "row", "gap": 10, "w": "auto", "h": 30,
                 "template": box([dict(type="checkbox", bind="{a.on}", w=26, h=26, disabled=True), ic("{a.on ? \"\" : \"ic_lock\"}", 16)], gap=2, w=78, h=30, align="center", tooltip="{a.reason}")}],
               gap=8, h=36, w="fill", align="center")
perms = screen("stall_manage_perms", "Clan stall rights", box([dict(type="scrim", alpha=0.3),
    dict(type="panel", frame="panel_wood_vine", anchor="cc", w=760, h=520, pad=22, layout="col", gap=8, children=[
        dict(type="panel", frame="panel_parchment", w="fill", h="fill", pad=16, layout="col", gap=10, children=[
            box([ic("ui_stall_clan_key", 32), T("Clan stall rights \u00b7 [{stall.header.clanTag}] {stall.header.stallName}", "heading", w="fill")], gap=8, h=36, align="center"),
            T("Who may do what at clan stalls. Set by the clan's ranks (economy config).", "small", w="fill", color="text.secondary"),
            box([T("", "tiny", w=156)] + [T(x, "label", w=78, align="center") for x in ("List", "Price", "Stock", "Collect", "Buy")], gap=10, h=22, pad=[0, 0, 0, 8]),
            {"type": "repeat", "each": "{manage.perms}", "as": "r", "layout": "col", "gap": 4, "w": "fill", "h": "auto", "template": perm_row},
            {"type": "divider", "w": "fill", "h": 14},
            box([ic("ic_info", 22), T("{manage.permNote}", "small", w="fill", wrap=True)], gap=8, h=44, align="center"),
            box([], h="fill"),
            hints(("LB RB", "Tabs"), ("B", "Close"))])])], w="fill", h="fill"), setsState={"ui.windowOpen": True}, readOnly=True,
    binds="manage.perms[] {rank, label, acts[{act, on, reason}]} built from ECONOMY clan rank rules + StallActs")

# ------------------------------------------------------------------ market board
res_row = box([dict(type="slot", w=48, h=48, bind="{m.item}", showCount=False),
               box([T("{m.item.name}", "label", h=18), box([T("{m.stallName} \u00b7 {m.ownerName}", "tiny", w="auto", color="text.muted"), dict(type="badge", text="{\"[\" + m.clanTag + \"]\"}", color="{m.clanColor}", w=52, h=18, visible="{m.clanTag}")], gap=6, h=18, align="center")], "col", w="fill", h=40),
               box([ic("{m.priceIcon}", 22), T("{m.priceCount}", "heading", w="auto")], gap=3, w=80, h=30, align="center"),
               T("{m.stock} left", "small", w=70), T("{m.distance} m", "small", w=56, color="text.muted"),
               Btn("Pin", "info", icon="ic_pin", w=80, h=36, action={"event": "map.ping", "args": {"x": "{m.x}", "y": "{m.y}"}})], gap=10, h=56, w="fill", align="center", pad=[4, 8, 4, 8], focusable=True)
board = screen("market_board", "Market board", box([dict(type="scrim", alpha=0.3),
    dict(type="panel", frame="panel_wood_vine", anchor="cc", w=900, h=600, pad=22, layout="col", gap=8, children=[
        dict(type="panel", frame="panel_parchment", w="fill", h="fill", pad=16, layout="col", gap=10, children=[
            box([ic("ui_stall_ledger", 32), T("Market board", "title", w="fill"), T("{market.results.length} offers nearby", "small", w="auto", color="text.muted")], gap=8, h=40, align="center"),
            box([dict(type="input", bind="{market.query}", placeholder="What are you looking for?", w="fill", h=40, focus=True),
                 Btn("{market.sortLabel}", "secondary", icon="ui_stall_sort", w=170, h=40), Btn("Paid in", "secondary", icon="coin", w=130, h=40)], gap=10, h=40, align="center"),
            dict(type="list", w="fill", h="fill", children=[{"type": "repeat", "each": "{market.results}", "as": "m", "layout": "col", "gap": 4, "w": "fill", "h": "auto", "template": res_row}]),
            hints(("A", "Pin on map"), ("Y", "Sort"), ("B", "Close"))])])], w="fill", h="fill"),
    setsState={"ui.windowOpen": True}, opens="interact with a market board piece (proposed) or the map tab",
    binds="market.results[] from cached stall headers + last-seen listings (client-side index; server search message proposed, see DATA_PATHS.md)", input=INPUT_NOTE)

# ------------------------------------------------------------------ inspect
inspect = screen("item_inspect", "Inspect", box([dict(type="scrim", alpha=0.45),
    dict(type="panel", frame="panel_wood", anchor="cc", x=-150, w=560, h=560, pad=22, layout="col", children=[
        dict(type="panel", frame="panel_parchment", w="fill", h="fill", pad=18, layout="col", gap=10, rarityBorder="{inspect.item.rarity}", children=[
            box([dict(type="slot", w=112, h=112, bind="{inspect.item}", showCount=False),
                 box([T("{inspect.item.name}", "title", h=36), T("{inspect.item.rarityLabel} \u00b7 {inspect.item.categoryLabel}", "label", h=20, color="{\"rarity.\" + inspect.item.rarity}"),
                      {"type": "include", "src": "_partials/crafted_by.json", "params": {"item": "{inspect.item}"}},
                      box([ic("{inspect.price.icon}", 22), T("{inspect.price.count} {inspect.price.name} at {stall.header.stallName}", "label", w="fill")], gap=6, h=24, align="center", visible="{inspect.price}")], "col", w="fill", h=112, gap=4)], gap=16, h=112, align="center"),
            {"type": "divider", "w": "fill", "h": 14},
            T("{inspect.item.description}", "body", w="fill", wrap=True, h="auto"),
            box([dict(type="foodbadge", stage="{inspect.item.food.stage}", w=20, h=20), T("{inspect.item.food.stageLabel}", "label", w=90, color="{\"food.\" + inspect.item.food.stage}"),
                 dict(type="bar", vital="hunger", value="{1 - inspect.item.food.spoiled}", max=1, w="fill", h=16)], gap=8, h=24, w="fill", visible="{inspect.item.food}", align="center"),
            box([ic("ic_hammer", 20), T("Durability", "label", w=90), dict(type="bar", vital="stamina", value="{inspect.item.durability}", max=1, w="fill", h=16), T("{inspect.item.durability|pct}", "label", w=44)], gap=8, h=24, w="fill", visible="{inspect.item.durability != null}", align="center"),
            {"type": "repeat", "each": "{inspect.item.stats}", "as": "stat", "layout": "col", "gap": 4, "w": "fill", "h": "auto",
             "template": dict(type="statrow", icon="{stat.icon}", label="{stat.label}", value="{stat.value}", w="fill", h=24)},
            box([], h="fill"),
            box([ic("ic_weight", 18), T("{inspect.item.weight|fixed1} kg \u00b7 stacks to {inspect.item.maxStack}", "small", w="fill")], gap=6, h=22, align="center"),
            hints(("A", "Buy"), ("B", "Back"))])]),
    # tooltip partial demo (hover state) on the right
    dict(type="box", anchor="cc", x=330, y=-120, w=268, h="auto", children=[{"type": "include", "src": "_partials/item_tooltip.json", "params": {"item": "{tipA.item}", "price": "{tipA.price}"}}]),
    dict(type="box", anchor="cc", x=330, y=150, w=268, h="auto", children=[{"type": "include", "src": "_partials/item_tooltip.json", "params": {"item": "{tipB.item}", "price": "{null}"}}])], w="fill", h="fill"),
    layer="modal", modal=True, input=INPUT_NOTE, binds="inspect.item = item VM incl. crafterId/crafterName, durability, food|fill; inspect.price = listing price (stall context) or null")

# ------------------------------------------------------------------ toasts / world prompt
toasts = screen("stall_toasts", "Stall toasts", box([
    dict(type="toast", kind="success", icon="coin", title="Sold! {toast.sale.count}\u00d7 {toast.sale.itemName}", text="{toast.sale.buyerName} paid {toast.sale.priceCount} {toast.sale.priceName}", anchor="tr", x=20, y=90, w=330, h=56),
    dict(type="toast", kind="info", icon="ui_stall_till", title="Till collected", text="{toast.till.items} stacks moved to your bag", anchor="tr", x=20, y=152, w=330, h=56)], w="fill", h="fill"),
    layer="overlay", events={"gameplay.stall_sale": "owner(s) only: success toast + coin vfx at stall + bell ring anim", "gameplay.till_collected": "collector: info toast"})

os.makedirs(os.path.join(SC, "_partials"), exist_ok=True)
for name, d in [("_partials/listing_card", listing_card), ("_partials/listing_card_phone", card_phone), ("_partials/crafted_by", crafted_line), ("_partials/item_tooltip", tooltip),
                ("stall_browse", browse), ("stall_browse_phone", browse_phone), ("stall_buy", buy), ("stall_manage", manage), ("stall_manage_perms", perms), ("market_board", board), ("item_inspect", inspect), ("stall_toasts", toasts)]:
    json.dump(d, open(os.path.join(SC, name + ".json"), "w"), indent=1, ensure_ascii=False)
print("screens ok")
