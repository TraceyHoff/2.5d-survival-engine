"""Content catalog: every wearable (stable key order = append-only), palettes. Keys are the stable ids (ids.lock.json)."""
from palette import ramp
def hx(c): return "#%02x%02x%02x" % tuple(c)

SKIN = [("porcelain", "#fbe3d2"), ("peach", "#f6cfb0"), ("rose", "#eebfa4"), ("honey", "#e2a878"), ("tan", "#c98d5e"),
        ("caramel", "#b0744a"), ("bronze", "#94603c"), ("umber", "#774a2e"), ("cocoa", "#5e3a26"), ("ebony", "#46291c"),
        ("olive", "#c6a27a"), ("goblin", "#a8c98a")]
HAIR = [("black", "#2e2630"), ("espresso", "#4a3228"), ("chestnut", "#7a4a2c"), ("auburn", "#9a4426"), ("ginger", "#d0702e"),
        ("strawberry", "#e09a6a"), ("honey_blonde", "#e2b464"), ("platinum", "#f2e6c4"), ("ash", "#a89a94"), ("silver", "#d6d2dc"),
        ("bubblegum", "#f48cb8"), ("mint", "#8fe0c0"), ("lilac", "#b89ae6"), ("sky", "#7cb8f0"), ("teal", "#3aa6a0"),
        ("tangerine", "#ff9a3c"), ("cherry", "#d8344a"), ("moss", "#6e9a44"), ("midnight", "#3a4a8c"), ("sunflower", "#f4d03a")]
CLOTH = [("white", "#f4f0e8"), ("cream", "#efe0bc"), ("charcoal", "#4a4250"), ("slate", "#7a7f94"), ("tomato", "#d9503e"),
         ("brick", "#a8432e"), ("berry", "#b8346a"), ("rose", "#ee8aa0"), ("blush", "#f6c2c2"), ("tangerine", "#f08a34"),
         ("mustard", "#b98a1e"), ("butter", "#f6e08a"), ("lime", "#a8d05a"), ("forest", "#3f7a46"), ("sage", "#9cb88c"),
         ("teal", "#2f8f8a"), ("sky", "#86c0ea"), ("denim", "#4e6fa6"), ("navy", "#2e3e6e"), ("lavender", "#b8a4e0"),
         ("plum", "#7a3f7a"), ("cocoa", "#7a5038"), ("tan", "#c49a6c"), ("olive", "#8a8a42"), ("gold", "#f7cc2e"), ("black", "#2a2430")]

W = []   # (key, slot, spec, extra-manifest)
def add(key, slot, spec, **kw): W.append((key, slot, spec, kw))
for s in ["buzz", "pixie", "bob", "long", "ponytail", "pigtails", "bun", "afro", "spiky", "mohawk", "braid", "curtains", "curly", "sidepart"]:
    add("hair_" + s, "hair", {"style": s}, tint=2, hatHair=True)
HATS = [("straw", 1), ("beanie", 2), ("cap", 2), ("cowboy", 2), ("top_hat", 2), ("bucket", 2), ("wizard", 2), ("frog_hood", 2),
        ("viking", 2), ("mushroom_cap", 2), ("chef", 2)]
for s, t in HATS:
    add("hat_" + s, "hat", {"style": s}, tint=(1 if s == "straw" else t), hides=(["hair"] if s == "frog_hood" else []), hatHairFlag=(s != "frog_hood"))
TOPS = {
    "tee": dict(sleeve="short", collar="round", sleevehem=True), "tank": dict(sleeve="none", tank=True), "sweater": dict(sleeve="long", style="stripes", cuff=True, collar="round"),
    "hoodie": dict(sleeve="long", hood=True, pocket=True, strings=True, cuff=True, grow=1.2), "flannel": dict(sleeve="long", style="plaid", buttons=True, cuff=True),
    "vest": dict(sleeve="short", open=True, buttons=False, grow=1.1), "raincoat": dict(sleeve="long", hem=(5, 9.5), buttons=True, collar="v", grow=1.3, sleeve_grow=1.5),
    "tunic": dict(sleeve="short", hem=(4, 9), belt=True, collar="v"), "puffer": dict(sleeve="long", style="quilt", quilt=True, grow=2.2, sleeve_grow=2.2, cuff=True),
    "pinafore": dict(sleeve="short", hem=(7, 11.5), bib=True, frill=True), "sailor": dict(sleeve="short", collar="sailor"),
}
for k, v in TOPS.items(): add("top_" + k, "top", v, tint=2)
BOTS = {
    "shorts": dict(len=.42, waist=True), "jeans": dict(len=.93, seam=True, cuff=True), "cargo": dict(len=.9, cargo=True, waist=True, grow=1.2),
    "skirt": dict(skirt=(5.5, 9.0), hemband=True), "long_skirt": dict(skirt=(10, 11.5), hemband=True), "leggings": dict(len=.95, grow=.45, waist=True),
    "kilt": dict(skirt=(6, 9), plaid=True), "sweatpants": dict(len=.9, cuff=True, waist=True, grow=1.3), "patched": dict(len=.88, patch=True, seam=True),
    "bloomers": dict(len=.38, puff=True, grow=1.9, frill_leg=True),
}
for k, v in BOTS.items(): add("bottom_" + k, "bottom", v, tint=2)
SHOES = {
    "sneakers": dict(style="sneakers", swoosh=True, laces=True), "boots": dict(style="boots", shaft=.32, laces=True, soleS=True),
    "sandals": dict(style="sandals"), "rain_boots": dict(style="rain", shaft=.5, flare=1.6, soleS=True, cuffS=True),
    "clogs": dict(style="clogs", w=3.1, len=4.4, band=True, soleS=True, soleLow=True), "bunny_slippers": dict(style="bunny", w=3.1, len=4.2, sole=False),
    "hiking_boots": dict(style="hiking", shaft=.28, laces=True, cuffS=True), "flats": dict(style="flats", bow=True, soleS=True),
    "hightops": dict(style="hightops", shaft=.26, laces=True, cuffS=True), "mushroom_shoes": dict(style="mush", w=3.2, len=4.2, soleS=True),
}
for k, v in SHOES.items(): add("shoes_" + k, "shoes", v, tint=2)
ACC = [("round_glasses", 1, 36), ("sunglasses", 1, 36), ("eyepatch", 1, 36), ("scarf", 2, 30), ("backpack", 2, 30), ("flower", 2, 45),
       ("bandana", 2, 30), ("satchel", 2, 30), ("earrings", 1, 36), ("cape", 2, 30)]
for k, t, l in ACC: add("acc_" + k, "accessory", {"style": k}, tint=t, layer=l)
for k in ["smile", "grin", "freckles", "moustache", "beard", "cat", "bushy", "tongue", "stubble"]: add("face_" + k, "face", {"style": k}, tint=1)
for k in ["round", "sparkle", "sleepy", "happy", "cat", "button", "lashes", "wide", "wink"]:
    add("eyes_" + k, "eyes", {"style": k}, tint=2)
LAYER = dict(shoes=19, bottom=18, top=20, accessory=30, hands=33, face=32, eyes=34, hair=40, hat=50)
# ---- ADR-114 starter wearables (append-only; no unlock tags -> listed in the creator for everyone)
for s in ["wavy", "topknot", "space_buns", "shag"]: add("hair_" + s, "hair", {"style": s}, tint=2, hatHair=True)
for k in ["goatee", "long_beard", "chops", "rosy"]: add("face_" + k, "face", {"style": k}, tint=1)
for k, v in {"henley": dict(sleeve="long", collar="round", buttons=True, cuff=True), "striped_tee": dict(sleeve="short", style="stripes", collar="round"),
             "polo": dict(sleeve="short", collar="v", buttons=True), "cardigan": dict(sleeve="long", open=True, buttons=True, cuff=True, grow=1.2)}.items():
    add("top_" + k, "top", v, tint=2)
for k, v in {"capris": dict(len=.66, seam=True, cuff=True), "joggers": dict(len=.9, cuff=True, waist=True, grow=1.0, seam=True),
             "pleated_skirt": dict(skirt=(6.5, 9.5), hemband=True), "cutoffs": dict(len=.5, seam=True, patch=True)}.items():
    add("bottom_" + k, "bottom", v, tint=2)
for k, v in {"loafers": dict(style="loafers", band=True, soleS=True, len=4.0), "slip_ons": dict(style="slip_ons", band=True),
             "moccasins": dict(style="moccasins", w=2.9, laces=True, sole=False), "trail_runners": dict(style="trail", swoosh=True, laces=True, soleS=True)}.items():
    add("shoes_" + k, "shoes", v, tint=2)
# ---- ADR-135 gameplay gear (append-only; unlockTags ["gear"] -> not in the creator; mapped by data/wear_cosmetics.json)
# ADR-137: dedicated hands slot, over the front sleeves (31) on front facings, behind the torso on back facings (sleeves 21)
HANDS_BY_DIR = [33, 33, 33, 33, 22, 22, 22, 33]
GEAR = []
def gear(key, slot, spec, **kw): GEAR.append(key); add(key, slot, spec, **kw)
for k in ["cloth_gloves", "leather_gloves", "fur_mittens", "gauntlets"]: gear("acc_" + k, "hands", {"style": k, "noarmcut": True}, tint=(1 if k == "gauntlets" else 2), layer=33, layerByDir=HANDS_BY_DIR)
GEAR_PH = {}   # gear key -> resident placeholder wearable (same slot) drawn while its stream page loads
for s, hh, hd in [("helmet", False, ["hair"]), ("fur_hat", True, []), ("leather_cap", True, []), ("hood", False, ["hair"])]:
    gear("hat_" + s, "hat", {"style": s}, tint=2, hides=hd, hatHairFlag=hh)
GEAR_PH.update(hat_helmet="hat_viking", hat_fur_hat="hat_beanie", hat_leather_cap="hat_cap", hat_hood="hat_frog_hood")
# ---- ADR-137 exact per-item gear keys (<slotprefix>_gear_<item>; data/wear_cosmetics.json items/artTodo). Tier order bone..composite.
import json as _json, os as _os
_WC = _json.load(open(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "../../../packages/gameplay/data/wear_cosmetics.json")))
def _res_ph(k):   # resident placeholder: follow gear (streamed) placeholders back to a resident wearable; None = nothing
    seen = set()
    while k in GEAR_PH and k not in seen: seen.add(k); k = GEAR_PH[k]
    return None if (k is None or k in GEAR) else k
def gear137(key, slot, spec, ph, **kw):   # ph = resident placeholder (frozen here: wear_cosmetics items[] later point at the art itself)
    gear(key, slot, spec, **kw); GEAR_PH[key] = _res_ph(ph)
TIERS = ("bone", "bronze", "iron", "steel", "composite")
for k, st, hd, hh, ph, kw in [("straw_hat", "gear_straw", [], True, "hat_straw", {"tint": 1}), ("linen_cap", "linen_cap", [], True, "hat_cap", {"remap": {"P": "cloth_cream"}}),
                         ("rain_hood", "rain_hood", ["hair"], False, "hat_frog_hood", {}), ("fur_hat", "gear_fur_hat", [], True, "hat_beanie", {}),
                         ("leather_cap", "gear_leather_cap", [], True, "hat_cap", {}), ("wool_hat", "wool_hat", [], True, "hat_beanie", {})] + \
                        [(f"{t}_helmet", f"{t}_helmet", ["hair"], False, "hat_viking", {}) for t in TIERS]:
    gear137("hat_gear_" + k, "hat", dict({"style": st}, **({"remap": kw["remap"]} if "remap" in kw else {})), ph, tint=kw.get("tint", 2), hides=hd, hatHairFlag=hh)
# torso (top_gear_*): pm/sm = untinted body/sleeve material, P stays the tinted trim
for k, ph, sp in [("linen_shirt", "top_tee", dict(sleeve="long", collar="v", buttons=True, cuff=True, pm="cloth_cream", sm="cloth_cream")),
                  ("padded_jacket", "top_puffer", dict(sleeve="long", style="quilt", quilt=True, grow=1.8, sleeve_grow=1.8, cuff=True, buttons=True)),
                  ("fur_coat", "top_puffer", dict(sleeve="long", hem=(6, 10.5), grow=2.0, sleeve_grow=2.0, pm="fur_brown", sm="fur_brown", furtrim=True)),
                  ("raincoat", "top_raincoat", dict(sleeve="long", hem=(5, 9.5), buttons=True, collar="v", grow=1.3, sleeve_grow=1.7, cuff=True, hood=True)),
                  ("oilskin_coat", "top_raincoat", dict(sleeve="long", hem=(6, 10), buttons=True, collar="v", grow=1.4, sleeve_grow=1.5, pm="oilskin", sm="oilskin")),
                  ("leather_jacket", "top_flannel", dict(sleeve="long", open=True, collar="v", cuff=True, grow=1.3, sleeve_grow=1.3, pm="leather", sm="leather")),
                  ("wool_sweater", "top_sweater", dict(sleeve="long", style="stripes", cuff=True, collar="round", grow=1.5, sleeve_grow=1.5)),
                  ("fur_vest", "top_vest", dict(sleeve="none", open=True, grow=1.6, pm="fur_brown", furtrim=True))] + \
                 [(f"{t}_cuirass", "top_vest", dict(sleeve="short", plates=True, pm=t, sm="S", pauldron=t, grow=1.4, tier=t)) for t in TIERS]:
    gear137("top_gear_" + k, "top", sp, ph, tint=2)
# legs (bottom_gear_*): remap P -> untinted material, S stays the tinted trim
for k, ph, sp in [("linen_trousers", "bottom_jeans", dict(len=.9, seam=True, cuff=True, waist=True, remap={"P": "cloth_cream"})),
                  ("padded_trousers", "bottom_cargo", dict(len=.9, cargo=True, waist=True, grow=1.7, cuff=True)),
                  ("fur_leggings", "bottom_leggings", dict(len=.95, grow=1.3, waist=True, cuff=True, remap={"P": "fur_brown"})),
                  ("waxed_trousers", "bottom_cargo", dict(len=.92, seam=True, waist=True, grow=1.2, cuff=True, remap={"P": "oilskin"})),
                  ("leather_trousers", "bottom_jeans", dict(len=.93, seam=True, waist=True, grow=1.1, remap={"P": "leather"}))] + \
                 [(f"{t}_greaves", "bottom_cargo", dict(len=.9, waist=True, grow=1.1, greaves=t)) for t in TIERS]:
    gear137("bottom_gear_" + k, "bottom", sp, ph, tint=2)
# feet (shoes_gear_*)
for k, ph, sp in [("reed_sandals", "shoes_sandals", dict(style="sandals", remap={"S": "reed", "P": "reed"})),
                  ("leather_boots", "shoes_boots", dict(style="boots", shaft=.34, laces=True, soleS=True, cuffS=True, remap={"P": "leather"})),
                  ("fur_boots", "shoes_hiking_boots", dict(style="boots", shaft=.36, flare=1.9, w=3.1, cuffS=True, soleS=True, remap={"P": "fur_brown"})),
                  ("rubber_boots", "shoes_rain_boots", dict(style="rain", shaft=.48, flare=1.9, w=3.0, soleS=True, cuffS=True, band=True)),
                  ("snakeskin_boots", "shoes_boots", dict(style="boots", shaft=.36, soleS=True, cuffS=True, scales=True, remap={"P": "snake"}))] + \
                 [(f"{t}_boots", "shoes_hiking_boots", dict(style="boots", shaft=.34, w=3.0, soleS=True, plated=t, remap={"P": t})) for t in TIERS]:
    gear137("shoes_gear_" + k, "shoes", sp, ph, tint=2)
# hands (hands_gear_*): re-keyed ADR-135 gloves + tier gauntlets on the dedicated hands layer; nothing while streaming
for k in ["cloth_gloves", "leather_gloves", "fur_mittens"] + [f"{t}_gauntlets" for t in TIERS]:
    gear137("hands_gear_" + k, "hands", {"style": k, "noarmcut": True}, None, tint=2, layer=33, layerByDir=HANDS_BY_DIR)
