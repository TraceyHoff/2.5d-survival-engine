# Cozy Camp: UI Guide

UI for the cute 2.5D iso multiplayer survival game. It is part of the **Cozy-Wild** art pack (`/workspace/assets/STYLE_GUIDE.md`, `palette.json` v2).
Everything here is generated. To rebuild, run:
`python3 tools/gen_kit.py && python3 tools/make_pack_fragment.py && python3 tools/build_mock.py && python3 tools/build_screens.py && python3 tools/render_previews.py && python3 tools/contact_sheet.py`

## 1. Direction: "Cozy Camp"

Stardew Valley's warm farm life, plus Don't Starve's ink-and-paper charm (made much cuter).

- **Frames**: chunky warm-wood frames with brass nails. Fancy variants (`panel_wood_vine`, minimap, main menu) add vines, leaves and berries.
- **Content**: content sits on cream **parchment** cards. Slots are recessed **tan wells**.
- **HUD**: HUD plaques are translucent **chocolate** (`panel_hud`), so the world stays visible.
- **Buttons**: candy-chunky with a 3–4 px darker *lip* at the bottom. When pressed, the lip squashes and the face drops 2 px.
- **Ink**: outlines are soft plum-brown ink `#3B2433`, never black. They are heavier on the bottom-right (+0.35 px) and slightly wobbly (seeded smooth noise, 0.25–0.6 px @1x).
- **Ornaments**: quirky and sparse: leaf sprigs, vines, stitch dashes, acorn slider knob, ribbon title banners.
- **Shading**: 3-tone cel shading, as in STYLE_GUIDE, with light from the top-left. Shadows shift hue toward plum and highlights toward warm yellow. Panels get a soft drop shadow tinted plum, never grey.
- **Vitals have faces**: heart, stomach (hunger), water drop (thirst), bolt (stamina), thermometer, snowflake (cold) and sun (hot). Each has a happy and a `_low` variant (worried/sad, sweat drop). Low vitals pulse.
- **Readability at 1x**: icons are 32 px with a 1.6 px outline, fills are flat, shapes are big, and there is no detail under 2 px. Text always sits on a solid plaque or has a 1.5–2 px ink stroke.

## 2. Palette tokens (`theme.json` → `palette`, `color`)

Every swatch maps exactly to a `palette.json` ramp; `theme.json.paletteSource` records the mapping.

| Token | Hex | Use |
|---|---|---|
| ink / ink-soft / ink-faint | #3B2433 / #4A2F3D / #6B4A5A | outlines, body text, secondary text |
| wood-200…900 | #F0B878 … #432C24 | frames, tabs, plank buttons |
| parchment-50…500 | #FFFAF0 … #A8906E | cards, inputs, slot wells |
| choc-800/700/600 | #2A1B2E / #432C24 / #61402E | HUD plaques, tooltips on dark |
| leaf, sky, blue, berry, red, sun, plum, pumpkin, fire, moss, rose, eerie, slate | ramps 300/500/700(/900) | accents, states, rarities, vitals |

Semantic colours live under `color.text.*`, `color.surface.*` and `color.accent.*`. Vitals have `fill/light/dark/icon/lowAt`. Temperature uses a 5-stop gradient over 25–45 °C, with the comfort band at 36–38.

**Rarity** (`rarity.*`; pvp_clan reuses these). Colour is never the only cue: every rarity also has a **shape**.

| Rarity | Colour | Text on parchment | Shape cue |
|---|---|---|---|
| common | slate | #575064 (6.4:1) | plain frame |
| uncommon | leaf | #2D7050 (5.0:1) | 1 corner leaf |
| rare | blue | #3A66A8 (4.8:1) | 2 corner gems |
| epic | plum | #7452AD (5.0:1) | 4 corner gems + stitch |
| legendary | sun | #7A4E14 (6.0:1) | diamond corners + sparkles + glow `#FFD45ACC` |

**Chat channels** (`chat.channels.*`; also reused by the WebGL chat bubbles). Each has `label, prefix, name, text (on dark HUD), textOnLight (on parchment), tag`. Contrast was checked against parchment-100 and choc-800:

| Channel | Text on light | Text on dark |
|---|---|---|
| global | 11.9 | 13.6 |
| local | 11.9 | 13.6 |
| party | 4.8 | 13.2 |
| clan | 5.0 | 8.0 |
| whisper | 4.8 | 12.4 |
| trade | 4.8 | 11.4 |
| system | 6.4 | 14.3 |
| warning | 4.8 | 11.4 |
| combat | 4.9 | 8.4 |
| admin | 6.2 | 13.9 |

Each channel also has a tag pill and an icon prefix, so it is never identified by colour alone. `chat.playerNameColors` holds 8 name colours, indexed by `playerId % 8`.

## 3. Typography

| Family | File | License | Axes | Used for |
|---|---|---|---|---|
| **Fredoka** (display) | `fonts/Fredoka.ttf` (variable) | SIL OFL 1.1, `fonts/OFL-Fredoka.txt` | wght 300–700, wdth 75–125 | titles, buttons, labels, numbers |
| **Nunito** (body) | `fonts/Nunito.ttf` (variable) | SIL OFL 1.1, `fonts/OFL-Nunito.txt` | wght 200–1000 | body text, chat, descriptions |

Both fonts come from github.com/google/fonts.

Styles (`font.styles`): hero 56, title 34, heading 18, label 15, button 18–22, body 15, small 13, tiny 11, hud 15, hudSmall 13, count 12, chat 14.
- Text on the world or on HUD plaques uses a 1.5–2 px ink stroke plus a 2 px down shadow. Text on parchment has no stroke.
- Minimum sizes: body 13 px @1x, and 11 px only for tags and counts in Fredoka bold.
- Numbers use Fredoka bold, which is wide and unambiguous.

## 4. Iconography

- **Sizes**: 32×32 @1x (64 @2x), drawn at 4x and LANCZOS-downsampled.
- **Families**:
  - `vital_*` (with faces, plus `_low` variants)
  - `st_*` (status effects: wet, cold, hot, well_fed, bleeding, infected, sheltered, exhausted, warm, starving, poisoned)
  - `ic_*` (UI glyphs)
  - `eq_*` (empty paper-doll silhouettes)
  - `bc_*` (build categories)
  - `cursor_*` (hotspots in `manifest.ui.extras.json`)
- **Item and equipment icons** come from the art pack (`/workspace/assets/atlases/items|equipment.json`, 32 px). The UI never redraws them. Integer upscales use nearest-neighbour. In-game they may be replaced by the renderer's cached offscreen icons.
- **Status tone** is shown by the plaque colour (good = leaf, bad = red, neutral = sky) *and* by an arrow badge or timer.

## 5. Spacing, sizes, radius

- **Spacing scale** `spacing.0…10` = 0, 2, 4, 6, 8, 12, 16, 24, 32, 48, 64 px. Use 8 inside cards, 12–16 between groups and 20 for window padding.
- **Sizes**: slot 48 (40 small), hotbar slot 52, icon 32, button 32/40/52, bar 20 (fill inset 3), minimap 176, toast 320, tooltip max width 280.
- **Radius**: xs 3, sm 6, md 10, lg 14, xl 20, pill.
- **Outlines**: hairline 1, thin 2, base 2.5, thick 3.5.

## 6. States (`state.*`)

| State | Sprite | Visual change |
|---|---|---|
| hover | `*_hover` | brightness ×1.08, lift −1 px, sun outline on slots |
| pressed | `*_pressed` | lip squashed, face +2 px, brightness ×0.96 |
| focus | (ring) | 3 px sky ring `#3A9CCC`, offset 2. Always visible on keyboard focus |
| disabled | `btn_disabled` / `*_disabled` | desaturated, 70% opacity, text `#8A6A52`; tooltip explains why |
| selected | `slot_selected` | sun-gold frame with a corner sparkle, hotbar slot lifts 3 px |

Every button has normal, hover and pressed sprites. Checkboxes, toggles, inputs, tabs, the scrollbar and the slider knob have their own state sprites.

## 7. Accessibility

- **Contrast**: all text is at least 4.5:1, and body text is 6–12:1 (ink on parchment 11.9:1, parchment-50 on choc-800 15.6:1).
- **Colour is never the only cue**: rarity has shapes, chat has tags and icons, vitals have faces and pulse, and temperature has a marker plus snowflake/sun icons.
- **Hit targets**: at least 32×32 @1x (slot 48, hotbar 52).
- **Reduce motion**: respect `prefers-reduced-motion` and the `settings.accessibility.reduceMotion` option. With it on, bounce, wobble and pulse are off, and fades are kept to 120 ms or less.
- **Settings** (pause_settings → Comfort tab): UI scale, Big text, Colour-blind icons (adds shapes and patterns to bars and status plaques), and Reduce motion. A chat filter and a palette-swap mode are proposed but not yet in the screen.
- **Keyboard**: everything is keyboard-reachable. Hotkeys are shown on keycaps, and screens declare `hotkeys` and `openWith`.

## 8. Scaling (1x / 2x)

- **Design resolution**: 1280×720.
- **Scale rule**: `uiScale = clamp(round_to_half(min(vw/1280, vh/720) × devicePixelRatio × userScale), 1, 3)`. Allowed steps are 1, 1.5, 2 and 3.
- **Atlas choice**: use the @2x atlas when the effective pixel scale is above 1.25. Positions are integer-snapped.
- **9-slice insets** are authored at 1x. At 2x, double them (`@2x.json` already stores doubled values).
- **DOM**: set CSS `zoom`/`transform` on the overlay root to `uiScale / devicePixelRatio`. Use `image-set()` (or the `@2x` frame folder, once it is exported) to pick the 2x art.

## 9. Kit and atlases

| Output | Contents |
|---|---|
| `atlas/ui_atlas.png` + `ui_atlas.json` | TexturePacker **JSON hash**, 768×528 (max 2048), 2 px padding, 169 frames. Each frame carries `nineSlice{l,t,r,b}`, `scale9Borders`, `pivot`, `hotspot` and `tags` |
| `atlas/ui_atlas@2x.png` + `@2x.json` | 1536×1056 |
| `atlas/frames/*.png` | individual 1x frames (used by CSS `border-image`) |
| `atlas/engine/` | engine **manifest v1** conformant (ARCHITECTURE §13): 9 uniform-grid pages `ui_kit_<w>x<h>.png` (+@2x) and `manifest.ui.json` (`ui-cozy-camp`, 169 sprites `ui_<name>`, category `ui`, per-frame `nineSlice`). Plus `manifest.ui.pack.json`, the same fragment with `atlases/` image paths for `packages/assets/pack`, and `manifest.ui.extras.json` (hiDpi suffix, cursor hotspots, frame index) |
| `preview/ui_kit_sheet.png` | contact sheet: 9-slice guides, hotspot dots, stretch demos |

Validation: `tools/validate_engine_manifest.ts` (`cd /workspace/engine && npx tsx …`). It passes standalone (169), merged with the sample fixture (196), and merged with the default pack (270). There are no key collisions with the pack's `ui`, `ui_panel` and `ui_button`.

Key 9-slice insets (l,t,r,b @1x):

| Frame(s) | Insets |
|---|---|
| panel_wood | 22 |
| panel_wood_vine | 24 |
| panel_parchment | 18 |
| panel_inset / panel_hud / panel_tooltip / input_* / slot_* | 14 |
| btn_* | 16, 14, 16, 18 |
| ribbon_title | 30, 16, 30, 16 |
| bar_track | 10, 9, 10, 9 |
| bar_fill_* | 7, 6, 7, 6 |
| toast_* | 40, 16, 16, 16 |
| keycap | 10, 9, 10, 12 |

Edge mode is `stretch` (`theme.nineSliceEdgeMode`): wood grain is authored to be stretch-safe.

## 10. Screen schema (`screens/*.json`)

Screens: `hud`, `inventory` (+ paper-doll), `crafting`, `building`, `world_map`, `character`, `chat` (+ `players`/social roster; `#compact` variant for the HUD), `trade`, `main_menu` (connect), `pause_settings`, `death`. Partials live in `screens/_partials/` (`journal_tabs`, `item_slot`, `item_tooltip`). Mock data is in `screens/mock/state.json`.

**Screen props**:
- `id, title, layer (hud|window|modal|overlay), modal`
- `setsState` (e.g. `{"ui.windowOpen": true}`, `{"ui.buildMode": true}`)
- `derive` (computed paths)
- `hotkeys`, `openWith`
- `root` (a widget)

**Widget**: `{type, id?, anchor?, x?, y?, w?, h?, pad?, layout?, gap?, align?, justify?, visible?, action?, tooltip?, children?, ...typeProps}`
- **anchor**: tl, tc, tr, cl, cc, cr, bl, bc or br. Offsets point inward: on right/bottom anchors a positive value moves inward; on centre anchors a positive value moves right/down.
- **Sizes**: px number, `"fill"`, `"auto"` or `"NN%"`.
- **pad**: a number or `[t,r,b,l]`.
- **layout**: `abs` | `row` | `col` | `grid{cols, cell:[w,h], gap}`.
- **align/justify**: `start|center|end|between`.
- **Types**:
  - Containers: `box, panel{frame}, list` (clips and reserves a 22 px scrollbar gutter).
  - Basic widgets: `text{font,wrap,color}, icon, button{variant: primary|secondary|danger|info|gold, label, icon, disabled}, tabs, slot{bind}, bar{vital,value,max}, input{bind,placeholder,maxLength}, checkbox, toggle, slider, keyhint, chatline, minimap, avatar, rank, banner, badge, lockstamp, scrim, toast, statrow, pips`.
  - Structural: `repeat{each, as, template, limit}`, `include{src:"_partials/x.json", params}` (exposed to the template as `$param`), and `"file.json#variant"`.
  - Note: `variant: "gold"` is a button **colour** (sun yellow), not currency.
- **Bindings**: any string may contain `{expr}`.
  - Grammar: paths (`a.b.c`, `arr.length`), literals (`"str"`, numbers, `true/false/null`), `! * / + - < <= > >= == != && || ?:` and parentheses.
  - Filters: `|int |fixed1 |pct |time |deg |upper |tickclock`.
  - A string that is exactly `{expr}` yields the raw value (number, object or array). Derived template strings are re-evaluated.
  - Reference evaluator: `tools/uikit/expr.py`. Mirror it in TS for production; the prototype has a path-only subset.
- **Actions**: `{"event": "<ns.verb>", "args": {...}}`. Args are bound, and `$param` placeholders are filled by the widget (for example `$all|shift=half`).

### Data paths contract

What the client adapter must provide each frame, as a view-model:

| Path | Source |
|---|---|
| `player.vitals.{health,healthMax,hunger,thirst,stamina,staminaMax,bodyTemp,feltTemp,wetness}` | `Health`, `Survival`, `Exposure` |
| `player.effects[] {icon,label,description,remaining,tone}` | *(no gameplay source yet)* |
| `player.xp`, `player.stats` | *(no gameplay source yet)* |
| `hotbar.{selected,slots[0..7]}`, `inventory.{slots[16],weight,maxWeight}` | `Inventory` (items/counts/durability/createdTick ×16, weight, maxWeight 60), `Equipment.mainHandSlot` |
| slot `{index, container, item:{id,key,name,icon,rarity,count,maxStack,weight,description,stats[],durability,food?{spoiled,stage,stageLabel}}, hotkey, state}` | item defs joined with the art-pack key |
| `equipment.{head,chest,legs,feet,hands,back,mainhand,offhand,trinket}.item` | only `mainHand` exists in gameplay today |
| `crafting.{queue[],selected}`, `recipes[] {id,key,name,station,stationLabel,seconds,craftable,locked,ingredients[{key,count,have}]}` | `Crafter`, recipe defs |
| `build.{category,selected,pieces[],rotation,valid,cost[]}` | `BuildPieceDef` |
| `world.{time.hours,day,phase}, weather, tick, tickHz` | `DayPhaseChanged`, `WeatherChanged` |
| `map.*` | |
| `net.{connected,connecting,rtt,serverUrl,status,statusText,statusIcon,error}`, `session.players[]` | session.ts |
| `chat.{history[], recent[], draft, channel}` | `client.chat`, see below |
| `me.{playerId, clientId, membership:{partyId,clanId,rank}}` | gameplay `Membership` |
| `groups.{groups[], markers[], _vm.party, _vm.clan}`, `map.memberPins[]` | `client.groups`, see below |
| `trade.current` (TradeView) + `trade._vm` | `client.trade`, see below |
| `ui.{windowOpen,buildMode}` | set by screens |
| `settings.*`, `death.*`, `toasts[]`, `interact.*`, `hover.*` | |

**Netcode shapes: final, bound verbatim** (`engine/packages/net/ARCHITECTURE.md` §13–§17, commits 50db8f3 and 525a262). Raw net objects keep their exact field names. Anything net does not carry (names, online state, resolved items) is added by the client adapter under a `_vm` key, so the boundary stays visible.

- **Chat**: `chat.history[]` is `client.chat.history`, where each entry is a `ChatDelivered` `{channel, channelId, fromPlayer, fromClient, tick, text, mentions[], emote}`.
  - `channel` is the numeric `ChatChannel`: Global 0, Local 1, Party 2, Clan 3, Trade 4, Whisper 5, System 6. It maps to `theme.chat.channelIds`, and the `|channel` filter converts it.
  - `channelId` is the party/clan group id or the whisper target.
  - `emote` is a u16 (0 = none). It renders as `* Name verb text` using `theme.chat.emotes`. That id table is UI-proposed (see open questions).
  - `mentions` holds at most 8 online players. The client resolves them from `@name`; they are never used for delivery.
  - `_vm`: `{fromName, mentionsMe, kind?}`. `kind:"warning"` styles system lines.
  - `chat.recent` is the last 3 lines, for the HUD.
  - **Send**: `chat.send {channel, text, to?, mentions?, emote?}` → `client.chat.send(channel, text, {to, mentions, emote})`.
  - **Rejects**: `client.chat.onReject((channel, reason))` → a toast with the text from `theme.chat.rejectReasons` (1 RateLimited … 9 BadChannel).
- **Groups**: `groups.groups[]` is `client.groups.groups` (Map → array) of `{id, kind (1 party, 2 clan), members[{playerId, role}], banner?}`.
  - Roles are 1 member, 2 officer, 3 leader (see `theme.groups.roles`).
  - The banner is `{shape, pattern, colors[u32 RGBA, u32 RGBA], emblemId}`. The UI draws a fallback shield until the banner art lands.
  - `groups.markers[]` is `client.groups.markers` `{playerId, x, y, hp (0–100, 255 = unknown), tick}`. These are low-rate (2 Hz) and cover only members outside the AOI.
  - `groups._vm.party` / `groups._vm.clan` are `ofKind(kind)` plus `max` (8 / 50) and `name`/`tag` for the clan. Each member gets `_vm{name, online, hpPct, inView}`: `hpPct` comes from the replicated Health when in view, otherwise from `marker.hp`; `null` means unknown.
  - `me.membership` is gameplay's `Membership` summary `{partyId, clanId, rank}`.
- **Map pins**: `map.memberPins[]` `{playerId, kind, name, x, y, hp}` is built from `groups.markers` and drawn on the minimap (clamped to the ring) and on the world map (with a name and a hp bar when hp ≠ 255). Members inside the AOI come from their entities (`map.markers` kind `member`).
- **Trade**: `trade.current` is the `TradeView` exactly: `{id, partner, status (0 Requested, 1 Open, 2 Done, 3 Cancelled), reason, iRequested, version, myOfferRevision, theirOfferRevision, myLock, myConfirm, theirLock, theirConfirm, myOffer[], theirOffer[]}`.
  - Each offer line is `{slot, item, count, durability, createdTick}`. **There is no currency.**
  - `trade._vm`: `{partnerName, mine[], theirs[]}` (lines resolved to item view-models, including the food stage), `maxLines` 16, and `idleSecondsLeft` (120 s idle timeout, counted from the last `tradeUpdated`).
  - Lock is one-way. Any offer change bumps `version` and that side's revision, and clears both locks and confirms; the UI says so.
  - Confirm sends `version`, so a stale confirm is ignored server-side.
  - A request (status 0, `!iRequested`) shows an Accept/Decline toast.
  - When the trade ends (status 2 or 3), the window closes and a toast shows `theme.trade.endReasons[reason]`; reasons ≥ 100 come from the gameplay hook.
- **Report**: the `net.reportPlayer {targetPlayerId, reason (1 Spam, 2 Abuse, 3 Cheating, 4 Other), messageTick?}` command → `client.reportPlayer(...)`. Reports are opened from a roster row or a chat line's context menu; from a chat line, `messageTick` is that line's `tick`. The limit is 3/min, so a rejection shows a toast.
- **Mute/block**: these are core `MuteList` (`chat.channels.mutes`). The UI emits `social.mute/block {player}`; the client command to toggle them is an open question.
- **Food decay** (survival_fx): every spoilable item view-model carries `food {spoiled, stage, stageLabel}`.
  - `spoiled = 1 − slotFreshness(world, e, slot)` (gameplay `inventory.ts`, lazy from `createdTick`).
  - Stage thresholds: fresh < 0.25 ≤ stale < 0.5 ≤ spoiling < 0.8 ≤ rotten (`theme.food.stages`).
  - Slots show the staged art `food_<key>` anim `<stage>` from `survival_fx/atlases/surv_food.json`, with the `food_badge_<stage>` badge at the slot's **top-right**, because the count owns the bottom-right. Items without staged art keep their art-pack icon and get the badge (plus the fuzz overlay when spoiling or rotten).
  - Tooltips show the stage label and a freshness bar.

### Events the UI emits

| Area | Events |
|---|---|
| Windows | `ui.open/close {screen}`, `ui.contextMenu {player, items}` |
| Inventory and hotbar | `hotbar.select`, `inventory.slotClick/move/split/drop/sort` |
| Crafting | `crafting.select/craft/cancel/filterCategory` |
| Building | `build.select/rotate/cycle/category/place/cancel` |
| Map | `map.zoom/ping/center` |
| Chat and social | `chat.send {channel,text,to?,mentions?,emote?}`, `chat.cycleChannel`, `chat.whisper {to}`, `party.invite/leave/kick`, `clan.promote`, `social.mute/block` (core lists), `net.reportPlayer {targetPlayerId, reason, messageTick?}` (from a chat line's context menu, so `messageTick` = the line's `tick`) |
| Trade | `trade.offer {id, add \| remove}` (the client rebuilds the full line list → `client.trade.offer(id, lines[{slot,count}])`), `trade.lock {id}`, `trade.confirm {id, version}`, `trade.cancel {id}`, `trade.accept/decline {id}`, `trade.request {player}` |
| Session and menus | `player.respawn/spectate`, `net.connect/hostLocal/disconnect`, `session.copyInvite`, `settings.tab` (+ bound toggles/sliders writing `settings.*`) |

Events the UI consumes are listed in §11.

## 11. INTEGRATION

### Decision: DOM/CSS overlay for screens and HUD; WebGL for world-anchored UI

**Why DOM**:
- `apps/client` (Vite, Canvas2D debug draw) and the `@engine/render` demo already use plain-DOM overlays.
- `connect.ts` is DOM.
- The Renderer has decided that in-world nameplates, clan tags, chat bubbles and interaction prompts are **WebGL with SDF text**.

So:
- **DOM overlay (this kit)**: HUD, every window and menu, tooltips, toasts and cursors. It sits in one `#ui` root above the canvas, uses `pointer-events: none` on the root and `auto` on widgets, and the z layers from `theme.z`.
  - 9-slice frames map 1:1 to CSS `border-image` (slice = `nineSlice` insets, fill; see `prototype/proto.css` and `integration/connect.ts`).
  - Fonts load via `@font-face` from `fonts/`.
  - Tokens are injected as CSS custom properties from `theme.json`.
- **WebGL (Renderer + pvp_clan worker)**: nameplates, clan tags, chat bubbles and prompts, drawn with the `ui_*` sprites from the engine manifest (`ui_bubble`, `ui_bubble_tail`, `ui_panel_hud`, `ui_keycap`, …), the same `chat.channels`/`rarity` tokens, and an SDF build of Fredoka.
  - The Renderer provides per-frame **screen positions** for world-anchored DOM bits that stay in the overlay (station markers, trade request prompt). The UI positions those with `transform: translate()`, with no layout per frame.
  - The Renderer provides **cached offscreen item icons** (inventory, trade, crafting). The slot widget accepts an `iconUrl`/`ImageBitmap` override and falls back to the art-pack atlas.

**Components and events the UI needs exposed** (read-only, sampled once per frame by an adapter that builds the view-model in §10):
- **Components**: `Health`, `Survival`, `Exposure`, `Dead`, `Inventory`, `Equipment`, `Crafter`, plus item, recipe and build-piece defs.
- **Gameplay events**:
  - `ItemGathered` → toast "+3 Wood"
  - `CraftStarted/Completed/Failed` → queue, toast
  - `VitalDepleted` → warning toast, low icon
  - `Died` → death screen
  - `WeatherChanged`, `DayPhaseChanged` → clock, weather badge, "Getting dark" toast
- **Net**: `client.trade.on(view)` (open, refresh, request toast, or end toast by status), `client.chat.on` / `onReject`, `client.groups.on(change)` + `markers`, `client.onCommandRejected` (danger toast).
- **Commands the UI emits** are listed in §10; the client maps them to net commands.

### Exact engine integration steps

These are for the Engine Architect / client owner. **Nothing has been committed to /workspace/engine.**

1. **Atlas → default pack.**
   - Copy `atlas/engine/ui_kit_*.png` (and `@2x`) to `engine/packages/assets/pack/atlases/`.
   - Append `atlas/engine/manifest.ui.pack.json` → `atlases[]` and `sprites[]` to `pack/manifest.json`.
   - Run `pnpm --filter @engine/assets lock:ids:pack` to append the stable ids.
   - Already verified locally: the merged manifest loads with 270 sprites, `ui_panel_wood` nineSlice {22,22,22,22}, and no collisions.
   - The old placeholder `ui`, `ui_panel` and `ui_button` can stay until the renderer switches over.
2. **Serve the UI folder to the client.** Vite's default `publicDir` is `apps/client/public/` (no vite config exists yet). Either:
   - symlink or copy `/workspace/assets/ui/{atlas,fonts,screens,theme.json}` to `apps/client/public/ui/`, or
   - add `vite.config.ts` with a `/ui` alias or a copy plugin.
   The runtime expects them at `/ui/`, which is configurable.
3. **Connect screen swap.**
   - Replace `apps/client/src/connect.ts` with `/workspace/assets/ui/integration/connect.ts`. It keeps the same exports (`ConnectOverlay`, `mountConnectOverlay(session, opts)`), the same `#connect-overlay` and `[data-role=server-url|player-name|connect|status|rtt|account]` hooks, the same 250 ms polling, and the same session reads. `session.ts` is untouched.
   - It is typechecked against the real `session.ts` with the engine `tsconfig.base.json` (tsc clean) and rendered in headless Chrome: `preview/connect_idle.png`, `connect_error.png`, `connect_connected.png`.
   - New optional opts:
     - `uiBase` (default `/ui/`)
     - `hideWhenConnected`: set this once the HUD shows ping and players and the pause menu has Disconnect.
   - `main.ts` needs no change.
4. **HUD and screens.** Port `prototype/proto.js` into `apps/client/src/ui/`:
   - token injection
   - a TS port of `tools/uikit/expr.py`
   - the widget renderers for the schema in §10
   - the adapter that builds the view-model from components and events
   Mount it after the canvas. This is the next client task; the prototype shows HUD and inventory working from `theme.json`, the frame PNGs, the art-pack atlases and `mock/state.json`.

## 12. File map

| Path | What it is |
|---|---|
| `theme.json` | design tokens |
| `fonts/` | Fredoka, Nunito + OFL licenses |
| `atlas/` | TexturePacker atlas 1x/2x, `frames/`, `engine/` (manifest v1 fragment and grid pages) |
| `screens/*.json`, `screens/_partials/`, `screens/mock/state.json` | screen definitions and mock data |
| `preview/*.png` | 1280×720 mockups (hud, inventory, crafting, building, world_map, character, chat, trade, main_menu, pause_settings, death, connect_*, prototype_*) and `ui_kit_sheet.png` |
| `integration/connect.ts` | drop-in connect view |
| `prototype/index.html`, `proto.css`, `proto.js` | DOM prototype: HUD + inventory (Tab toggles it, 1–8 select a hotbar slot, hover shows a tooltip). Serve from `/workspace/assets` |
| `tools/` | generators: `gen_kit.py`, `make_pack_fragment.py`, `build_mock.py`, `build_screens.py`, `render_previews.py`, `contact_sheet.py`, `validate_engine_manifest.ts`, `uikit/*` |

## 13. Open questions

**Engine Architect**
- The grid atlases have no padding between cells. Do we need a half-texel UV inset or extrusion to avoid bleeding when 9-slices are scaled?
- Can the manifest accept per-frame rects (TexturePacker hash), to avoid 9 grid pages?
- What is the convention for @2x pages: an ADR for the `@2x` suffix, and where to declare it?
- Should `nineSlice` support a `repeat|stretch` edge mode?
- Where do UI runtime files live: `public/ui` or a package?

**Renderer**
- What is the API shape for the world-anchor screen positions? Proposal: `onFrame(cb(anchors: Map<id, {x, y, visible, depth}>))`.
- What is the cached icon handle? Proposal: URL or `ImageBitmap` keyed by item key + scale.
- Is there an SDF Fredoka build (msdf-bmfont) and an outline width matching `font.styles.chat.stroke`?
- `/workspace/assets/pvp_clan` currently has only combat FX atlases and **no nameplate or bubble frames yet**. I'm happy to share `ui_bubble`, `ui_bubble_tail`, `ui_panel_hud` and `ui_keycap` from this kit so world UI matches 1:1.

**Survival Systems / Gameplay**
- The inventory is 16 slots. Is the hotbar its first 8 slots (current assumption)?
- Equipment has only `mainHand`. Are head, chest, legs, feet, offhand and trinket planned? The paper-doll shows 9 slots.
- Status effects (wet, cold, well-fed, bleeding, …): which component or event carries name, remaining time and tone?
- XP, level and skills don't exist in gameplay. Keep the XP bar, or hide it behind a flag?
- The build piece list is only floor and wall. Which categories should the build menu ship with?
- Do we need item rarity on item defs? The art pack and UI assume `common…legendary`.
- Food stage: should the client compute `slotFreshness` locally (it needs item `spoilSeconds`, `createdTick` and the holder's `spoilMul` replicated), or will the server replicate a stage? Thresholds are taken from survival_fx (0.25 / 0.5 / 0.8). Please confirm them as gameplay data.

**Netcode / Core**
- Mute/block: there is no client command documented to edit core's `MuteList`. Which command should `social.mute/block` map to?
- Is there a map ping message?
- Names: rosters, markers and `ChatDelivered` carry only playerIds. Where does the client get names (a `PlayerId`/name component on entities, or a name directory message for out-of-AOI members and offline clan members)? Is there an `online` flag for offline clan members?
- Clan name and tag aren't in the Groups wire. Where should they come from?
- Emote ids: the u16 `emote` needs a shared id table. The UI proposes `theme.chat.emotes` (1 wave … 8 dance); who owns it?
- Trade:
  - Lock has no unlock op. Confirm that unlocking only happens by changing an offer.
  - Is `client.trade.offer` a full replace of the line list (the UI assumes yes)?
  - Can the client get the idle-timeout deadline, or should it count 120 s from the last update?
- Party/clan actions (invite, leave, kick, promote): these aren't in net yet. Are they gameplay commands?
- Banner art: shape, pattern and emblem id tables are needed to render `banner`.

## Engine layout (ADR-082 UI kit placement)
Screens: `assets/ui/screens/<name>.json` (+ `_partials/`), schema `assets/ui/screen.schema.json`, kit atlases `assets/ui/kit/`
(`manifest.ui.kit.json`, merged into the pack manifest `ui` category), strings `assets/ui/strings/en.json`. See `kit/README.md`.
New screens: `character_creator`, `wardrobe`, `craft_queue`, `touch_context`, `survival_events`, plus stall screens
(`stall_browse[_phone]`, `stall_buy`, `stall_manage[_perms]`, `stall_toasts`, `item_inspect`, `market_board`).
