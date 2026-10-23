# Trade stalls: art + UI (Cozy-Wild)

Rebuild: `python3 tools/build_all.py`, then validate with `cd /workspace/engine && npx tsx /workspace/assets/stalls/tools/validate_fragment.ts`.
Last result: fragment OK (34 sprites, 1 vfx, 0 warnings). No missing files. No key collisions with the pack manifest or with the pvp_clan, survival_fx or ui fragments. Merged load OK (306 sprites). validateBuildingSprites returned [].

## Art (`atlases/`, PNG + @2x + JSON hash, 2px padding, ≤2048)
| atlas | piece/footprint | notes |
|---|---|---|
| stall_blanket_{patch,gingham,picnic} | stall_blanket 1×1 | 4 listings, empty/stocked looks |
| stall_cart_{pine_red,dark_teal,sunny} | stall_cart 2×1 | 8 listings, awning sway |
| stall_booth_{thatch,redroof,bluecloth} | stall_booth 2×2 | 12 listings, emissive lantern |
| clan_pavilion | clan_pavilion 3×2 | 24 listings, tintmask (R primary, G secondary), banners/bunting sway, emblem attach |
| clan_trading_post | market_counter 2×1 | 6 listings, clan-only, closed/open (real piece since ab09fa3) |
| stall_props | price tag, shop sign (tint), coin pouch, barter scale, display slot, lantern (emissive), bell (ring anim), rent marker | |
| stall_icons / stall_badges | coin 1/few/many, maker mark, open-shop prompt, sold-out/closed | |

Every building sprite has: layer 2 (LAYER_FURNITURE), `rotationArt: mirror`, `frames[rot][dmg 0-3]`, and `states` in the order **closed (0), open (1)** so it matches `StallHeader.open`. It also has `attach` slotN/tagN/sign/emblem (typed attach, fb7bf56), a pivot at the front footprint corner, and `sway{amp,freq,stiffness}`. Nothing has baked shadows or lighting.
Clan colour: the tintmask is driven by `BuildPiece.tint` → `registry.clanPalette(i)` (16b0f8f). This fragment declares no clanPalettes or tintSets (pvp_clan owns them).

## UI (`ui/screens/*.json`, Cozy Camp schema)
stall_browse, stall_browse_phone, stall_buy (stepper, total, confirm, no_funds/no_space states), stall_manage (stock/price/enable/till/ledger/open-close), stall_manage_perms, market_board (optional), item_inspect, stall_toasts.
Partials: `_partials/item_tooltip.json` (shared), `crafted_by.json`, `listing_card(_phone).json`. Mock data is in `screens/mock/state.json`.
Input: footers show gamepad glyph hints (A/B/X/Y, LB/RB). The phone layout is touch-first.

### UI kit patch (not applied; /workspace/assets/ui belongs to the UI owner)
`ui/item_tooltip.kit.diff` adds these to the kit tooltip: the crafted-by row (an include of `crafted_by.json`, visible only when `crafterId > 0`, so it is hidden for coin/anonymous items), a durability bar, a `fill` bar (water_flask has no spoil row), and an optional price row. To apply:
copy `stalls/ui/screens/_partials/crafted_by.json` to `ui/screens/_partials/`, then apply the diff to `ui/screens/_partials/item_tooltip.json`. Also copy `ui/icons/maker_mark*.png` into the kit icon set. There is no quality line and no clan tag.

## Data paths (provisional; contract = gameplay DESIGN.md §9)
- `stall.header` ← StallHeader {ownerKind, ownerId, open, listingCount}, plus client-resolved `ownerName`/`clanTag`, and `pieceKey` (manifest key).
- `stall.sign` ← StallSign {name (≤24 printable ASCII, `stallName`), nameLen, soldOut (`stallSoldOut`)}. Rename input: maxLength 24 → `gameplay.setStallName` (needs the `list` permission). The browse header shows a Sold out badge from `sign.soldOut`; the world badge uses the same flag.
- World sign text: 1 line shrunk to 6px; otherwise word-wrapped to 2 lines at ≥5px; otherwise ellipsis (`render_tuning.stalls.json` sign.fit). Every sign board is ≥50px wide (the blanket sign was widened from 24 to 50px), so typical 24-character names fit on two lines (checked in market_day/night).
- `stall.revision` ← Listings.revision. It is sent back as `buyFromStall.expectedRevision` together with `expectedPriceItem/Count`.
- `stall.listings[]` ← stallListings `{slot, stockItem→item, stock, priceItem/priceCount→price{item,count}, qty, enabled}`. `soldOut = stock < qty`.
- `stall.viewer.perms{list,price,stock,collect,remove}` ← `can()` with StallActs. `lockReason.<act>` holds client strings.
- `manage.till[]` ← till Container. `manage.ledger[]` ← StallLedger ring, newest first `{tick→ago, item, count, priceItem, priceCount, buyerId→buyerName, crafterId}`.
- Tooltip `$item` ← itemInfo `{itemKey→key/icon, count, durability, freshnessStage 0..3 (from `environment.spoilage.stages`) → food.stage fresh/stale/spoiling/rotten, crafterId, crafterName}`, plus `itemInfo.fill` 0..1 (liquid containers only; water_flask shows a fill bar and no spoil row).
- Toasts ← `gameplay.stall_sale` and `gameplay.till_collected`. Buy errors map rejection reasons (no_funds, no_space, sold_out, price_changed, stale_listing, stall_closed, forbidden…) to strings in stall_buy.json.

## Asks
**Survival Systems:** all four earlier asks landed in ab09fa3 (StallSign soldOut and name, itemInfo.fill, market_counter). Nothing is open.
**Renderer:** (1) Draw listing item icons and price tags at `attach.slotN/tagN` per rotation (`frameAttach`), and hide them when closed. (2) SDF sign text at `attach.sign` (`render_tuning.stalls.json`). (3) Apply the tintmask from `BuildPiece.tint` → clanPalettes, and composite the emblem at `attach.emblem`. (4) Sway masks (`masks.sway`) plus the sprite `sway` field. (5) Emissive lanterns at night only, with flicker. (6) The world prompt and badges from StallHeader. (7) The `stall_sale_coins` vfx on sale.

## Previews (`preview/`)
contact_sheet, market_day, market_night, ui_browse, ui_browse_phone, ui_buy, ui_buy_insufficient, ui_buy_bagfull, ui_manage, ui_manage_owner, ui_manage_perms, ui_market_board, ui_inspect_tooltip, ui_toasts (all .png; UI mockups are 1280×720).

## Renderer feedback pass (Oct 23)
- Slot/tag attach x/y = box CENTRE (render_tuning `attach.xy`). Price tags 18×8 at 1x, text box attach 14×6; odd tags staggered.
- Frames top-trimmed: frameH and anchor y changed (attach is pivot-relative, unchanged meaning).
- Fonts: `fonts/fredoka_{regular,bold}_mtsdf.{png,json}` (BMFont JSON, mtsdf, pxRange 4, em 48, Latin+Latin-1, no kerning); built by `tools/font_mtsdf.py` (needs msdfgen, `MSDFGEN` env).
- Strings: `strings/en.json` (stall.badge.open/soldout/closed, clan).
- Rotation: blanket/booth = 2-row mirror (engine flipX); cart/pavilion/trading_post/counter = unique4, 4 rows.
