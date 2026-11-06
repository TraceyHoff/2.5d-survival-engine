# SurVivaZ

_A cozy survival game built on the 2.5D Survival Engine._

A cute, cartoony **2.5D isometric multiplayer co-op survival game** and its custom engine. It is browser-first and written in **TypeScript + WebGL2**. You gather resources, build bases, craft, tame pets, recruit AI helpers, farm, trade with other players and survive cold, rain, hunger, disease and the night, alone or with your clan. An authoritative Node server runs the same headless simulation as the browser client. The client predicts locally and interpolates everyone else.

> **Status:** playable and live — [play in your browser](https://traceyhoff.github.io/2.5d-survival-engine/) (menu `vb320c3b5`). Most gameplay systems are implemented, tested and wired into the client: building, crafting, pets, farming, AI helpers, diseases, seasons, dyes and more. See [What's playable today](#whats-playable-today).

## Prerequisites

- **Node.js 20** (`.nvmrc` pins 20; 22 also works)
- **pnpm 10** via corepack: `corepack enable` (the version comes from `packageManager` in `package.json`)
- `better-sqlite3` ships prebuilt binaries for Node 20/22 on Linux, macOS and Windows x64/arm64. On other platforms it builds from source, which needs Python 3 and a C++ toolchain. `pnpm demo` rebuilds it automatically if the binding is missing.

## Quick start

```sh
git clone https://github.com/TraceyHoff/2.5d-survival-engine.git
cd 2.5d-survival-engine
corepack enable
pnpm install --frozen-lockfile
pnpm demo
```

`pnpm demo` starts the game server on `ws://localhost:7777` (save file `./saves/demo.db`) and the Vite client. Open:

**http://127.0.0.1:5173/?player=1&server=ws://localhost:7777**

Use `?player=2` in a second tab to play co-op with yourself.

| Command | What it does |
|---|---|
| `pnpm demo` | server + browser client (`--bots 5` adds 5 bot players, `--fresh` starts a new world) |
| `pnpm demo:bots` | **dev load test only**: fresh server + 20 bots, prints stats (sets `NET_DEV_BOTS=1` for both) |
| `pnpm test` | all Vitest suites |
| `pnpm test:net` | net, testkit and server/client multiplayer integration tests |
| `pnpm check` | `pnpm -r typecheck` + `vitest run` (what CI runs) |
| `pnpm build` | build every package; Vite production bundles for the client and the render demo |
| `pnpm bench` | net/persist benchmarks (`PERF=1`) |
| `pnpm --filter @engine/render dev` | offline renderer showcase with the real art (lighting, weather, day/night, fire) |

Renderer demo URL params include `?time=0..24`, `weather=clear|rain|storm|snow|fog`, `cam=fire`, `gallery=1` and `inside=1`. See [packages/render/README.md](packages/render/README.md).

## Play in your browser

**https://traceyhoff.github.io/2.5d-survival-engine/**

The GitHub Pages build is static, so it runs in **local/offline mode**: the authoritative server game module
(`apps/server/src/game.ts`, the same code `pnpm demo` runs) is hosted in the page over `@engine/net`'s in-memory
loopback transport, with IndexedDB persistence (memory fallback) and 3 local AI bots (`?bots=N` to change).
Limits: single-player plus local bots only, and your world is saved per browser. Real multiplayer needs
`pnpm demo` or a hosted server: open the page with `?server=wss://your-host` to connect to one instead.
Locally, `?offline=1` on the Vite dev client forces offline mode.

### Singleplayer vs multiplayer
- Offline/Pages (`createLocalServer`) is **singleplayer**. Zombies, animals and human bots (virtual players driven by the AI framework, see docs/AI_AGENTS.md) spawn on their own; no commands needed.
- `pnpm demo` / the Node server is **multiplayer** by default (`--mode singleplayer` or `GAME_MODE=singleplayer` to override). Human bots are completely disabled there, and `?bots` is ignored.

## Controls

**In the playable client today:** `WASD` move, `Shift` sprint, `E` gather / interact, `K` character sheet. Reloading the tab reconnects you as the same player.

**Renderer demo:** drag or WASD to pan, wheel to zoom, arrow keys move the player, `F` follow, `H` hide the UI.

**Full default bindings** (`@engine/input`, engine-level; see [ARCHITECTURE §18](docs/ARCHITECTURE.md)):

| Action | Keyboard & mouse | Gamepad | Touch |
|---|---|---|---|
| Move | WASD / arrows | left stick | virtual stick |
| Sprint | Left Shift | L3 | sprint toggle |
| Attack / use | Left mouse | RT | attack button |
| Charge attack | hold Left mouse | hold RT | hold attack |
| Secondary | Right mouse | LT | secondary button |
| Crouch | Left Ctrl | R3 | crouch toggle |
| Interact / radial menu | `E` tap / hold | X tap / hold | context button tap / hold |
| Jump | Space | A | jump button |
| Reload | `R` | Y | reload button |
| Hotbar | `1`–`6` | D-pad (+LB) | hotbar slots |

## Features

✅ = in the playable client today · 🔧 = implemented and tested in the engine/server, not yet exposed in client UI

### Engine core
- ✅ **ECS:** sparse-set entity-component-system with binary-serializable schemas, change tracking, seeded RNG, events and staggered slow systems
- ✅ **Fixed-tick loop:** deterministic 20 Hz simulation shared by server and client, with render interpolation between ticks
- ✅ **Chunk streaming:** a chunked, effectively unbounded isometric tile world (64×32 tiles, height levels) that streams chunks around players
- ✅ **Interest management:** AOI grid, so each client only receives the entities near it
- 🔧 **Transactions, scheduler, job queues, permissions, groups and claims** primitives in core

### Netcode & persistence
- ✅ **Authoritative server** over WebSocket, with snapshot deltas, **client-side prediction and reconciliation**, entity interpolation, lag compensation and basic anti-cheat
- ✅ **Persistence:** SQLite on the server (world chunks, building data, players, claims) and IndexedDB/memory in the browser. Worlds and players survive restarts, and reconnects use an account token.
- ✅ **Bots:** headless bot players (wander + gather) for load testing. 20 Hz holds with dozens of bots.
  Bots are a **dev load-test tool, never part of multiplayer**: `apps/server/src/bots.ts` refuses to start unless
  `NET_DEV_BOTS=1`, tags its connections (`demo.devBot`), and a multiplayer server (the Node default, `mode: "multiplayer"`)
  drops tagged connections unless it was also started with `NET_DEV_BOTS=1`. The production server path (main.ts / game.ts)
  never imports bots.ts. Human bots exist only in singleplayer/offline (the browser's local mode, `mode: "singleplayer"`).

### Survival gameplay (`packages/gameplay`)
- ✅ **Vitals:** hunger, thirst, stamina (drain, delay, regen), health, death; damage from starvation, dehydration, hypothermia and hyperthermia. Death clears diseases, infections and wetness.
- ✅ **Seasons & temperature:** summer 70–88°F, fall 36–69°F, winter 0–35°F; heat waves 89–100°F; snow below 32°F. Body temperature, **wetness** (rain and standing water wet you; wet clothing loses half its insulation), heat sources and shelter/enclosure detection. Enclosed rooms clamp felt temperature; fires warm rooms (campfires, fireplaces, wood stoves, furnaces, torch stands). Outdoor cold damage at 0–10°F is blocked by worn insulation ≥ 10.
- ✅ **Diseases:** data-driven (food poisoning, dysentery, wound infection, cold, heatstroke, exhaustion, influenza). Close-contact transmission, cloth masks block it, Honey Tea cures cold/flu, and a 4-minute care cure (dry, fed, hydrated, warm) clears cold/flu.
- ✅ **Farming:** hoe tilled soil, plant seeds, water and fertilize; 40 plantable crops (wheat, corn, vegetables, herbs, berries, fruit trees, hay, lettuce, pepper, beetroot, rice). Crops go dormant late fall / all winter and die below 40°F outdoors. Seeds come only from gathering each crop's own wild plant.
- ✅ **Pets:** 17 species (5 dogs, 3 cats, parrot, crow, chicken, rabbit, ferret, fox, owl, turtle, squirrel), each with its own skill tree (points at levels 1/6/11/16, cap 20). Tame with favourite treats — the hand-on-pet panel shows each species' favourites. Guard assignments, territory and fence containment.
- ✅ **Farm animals:** 11 species (chicken, duck, goose, turkey, cow, goat, sheep, pig, alpaca, bee, angora rabbit) producing eggs, milk, wool, truffles and honey into troughs. Bees deposit honey into a built **Apiary** instead (trough fallback; honey is never lost if both are full). Animals graze grass tiles and eat hay from troughs.
- ✅ **AI humans:** recruitable helpers. Each wants one fixed item from a 35-item pool, taken automatically from your inventory when you hire them. Jobs: Gather, Farm, Defend, Craft, Maintain. They furnish and upgrade their homes, garden, tame livestock, fill troughs and refuel lit fires. A host toggle (`AI humans in multiplayer`, on by default) turns new spawns/hires off.
- ✅ **Food decay & storage:** 4-stage spoilage (fresh → stale → spoiling → rotten); salt storage slows it (salt barrel ×0.5, curing box ×0.33, cold store ×0.2); frozen food below 0°C holds its freshness. Salt comes from salt-flat deposits on sand near water.
- ✅ **Inventory & containers:** 24 slots (16 pack + 8 hotbar), stacking, durability, atomic transfers. Storage lives on building attachments, reachable within 2.5 tiles. Death bags last 30 minutes with a 60-second owner-only window (PvP); dropped loose items despawn in 3 minutes.
- ✅ **Crafting:** recipes, stations (fired stations must be lit), timed jobs, atomic exchange at completion. Craftable-first sorting, Recently Crafted / Recently Built sections, skill and unlock gating.
- ✅ **Building:** grid-based base building with foundations, walls, floors, roofs, doors, fences and furniture; placement rules, rotation, support/stability (upper decks must be wall-connected; corner pieces alone don't support a deck), HP tiers, upgrades, repair, demolition and door/container states. 158 paintable pieces via the **dye system** (craftable dyes, paint brush in the hotbar).
- ✅ **Structure fire:** burning pieces take damage, spread to flammable tiers (twig/wood) and get put out by rain (`data/fire.json`). Rendered with flames, embers and smoke.
- ✅ **Combat & zombies:** damage pipeline, zombie spawning and AI, hordes. Aggressive spawns (zombies, wolves) are kept out of a 20-tile safe radius around installed spawn points; hordes are exempt.
- ✅ **Character creator:** names are required (Roll button generates a fitting "First Last" name); hair, face and eyes only — new characters start bare and must craft clothing. The in-game Character panel (`K`) shows the character sheet (timers, wetness, insulation); wardrobe, dyes and unlocks live in a separate Wardrobe panel.
- ✅ **World map, markers & compass:** world map with player markers, server-authoritative map markers (party/clan visibility, owner-only removal), compass with idle-north settling, hotbar split from the pack.

### Social, PvP & economy
- 🔧 **Clans/groups** with roles; **land claims** (claim totems) and a permission system (ACLs, ownership, claims, zones)
- 🔧 **PvP & raiding:** raid rules via permission hooks; destroyed stalls spill their stock and till as loot bags
- 🔧 **Chat:** channels, rate limiting, mute lists, wire encoding
- 🔧 **Player-driven trade-stall economy:** no NPC vendors. Stalls come in four sizes (blanket, cart, booth, clan pavilion with up to 24 listings), with stock, a till, prices in any item (`coin` by convention), offline sales, a sales ledger, clan rank policies and atomic purchases. **Crafter names** (provenance) stay on crafted items through every trade, and items made by different crafters never stack.

### Input (`packages/input`)
- ✅ Unified **keyboard & mouse, gamepad and touch** input: bindings, contexts, rebinding, tap/hold/long-press, on-screen touch controls, gestures, focus navigation and device-aware prompts. Phone keyboard: text fields exit element fullscreen before focus so the on-screen keyboard opens cleanly; the game re-enters fullscreen when you enter the world. Portrait and landscape both work (no orientation lock).

### Renderer (`packages/render`)
- ✅ **WebGL2 isometric renderer** (Canvas2D fallback) with depth sorting, sprite batching, building occlusion/cutaway, dynamic **lighting and shadows**, bloom, a **day/night cycle** with color grading, **weather** (rain, storm, snow, fog, wind sway), **fire** and particle VFX, held items, and runtime atlas themes. **Full** is the default graphics preset on fresh installs (Auto / Low / Medium / High / Ultra still selectable), pinning full-resolution rendering. Tree occlusion fades trees to 35% instead of hiding them.

### Art & audio packs (`assets/`)
- The **Cozy-Wild** cartoon art pack: characters, zombies, critters, equipment, items, resources, tiles, buildings and VFX (8-direction sprites, atlases, a palette, piece variants, damage stages) plus audio. Bee, owl and Apiary art is painted at runtime (`apps/client/src/task34-art.ts`, new pixels — no reused sheets).
- **`survival_fx`:** day/night grading, LUTs, sheen masks, render tuning and fire/weather effects
- **`pvp_clan`:** clan palettes, totems, banners, rarity colors, fonts and world-UI colors
- **`ui`:** UI atlas, fonts, input prompt icons ([UI_GUIDE](assets/ui/UI_GUIDE.md))
- **`stalls`:** trade-stall art
- `tools/`: the Python generators (`python3 assets/tools/build_all.py`) that rebuild the pack
- See [assets/INTEGRATION.md](assets/INTEGRATION.md) and [assets/STYLE_GUIDE.md](assets/STYLE_GUIDE.md). The engine loads the validated copy in `packages/assets/pack/`, and the render demo serves `assets/` at `/@art/` (override with `ART_DIR`).

## What's playable today

- **Playable now:** browser single-player and multiplayer (move, sprint, gather, build, craft, tame pets, farm, recruit AI helpers, dye gear, cook, trade via stalls, chat, clans/claims) with prediction and reconciliation; persistent worlds and players; world map + markers + compass; character creator with name roller; seasons, weather, diseases and temperature survival; the WebGL2 renderer with real art, lighting, weather, day/night and fire.
- **Engine-only so far:** some clan/claim/trade UI polish, `@engine/input` gamepad/touch in the client, and WebTransport.
- **Planned:** terrain editing with a shovel, flowing water and underground bases (Task 36), WebTransport, cross-platform shells, a full art pass. **Done recently:** seeded world generation with varied heights and visible ledges (Task 35 / ADR-254).

## Current build status

As of the latest push (Task 34 + CI fix, remote `b320c3b5`, menu `vb320c3b5`): **CI ✅ · GitHub Pages ✅ · live.**

- `pnpm install --frozen-lockfile` ✅
- `vitest run` ✅ **2,743 passed / 1 failed / 3 skipped** (client 575/575, server 107/107, render 441/441, gameplay 1,106/1,109). The 1 failure is pre-existing: `pack.test.ts` reads `assets/building/KEYS.md`, which is absent from a sparse checkout but present in CI's full checkout.
- `pnpm -r typecheck` ✅ with the lockfile-pinned **TypeScript 5.9.3** (CI). Note: the dev VM's local `tsc` is 5.6.3 and can miss errors CI catches — always verify typechecks with the pinned version.
- Busy-world sim runs ~1.5 ms/tick with a base (Task 29 profile harness, `PERF=1`).

## Recent work

Work lands in gated batches: each batch starts only after the previous batch's CI **and** Pages are both green (checked at job level), and nothing is pushed until its tests pass and the user approves the push.

- **Tasks 1–21:** full-resolution rendering, crisp atlases, chests, heat waves, wall-connected ceilings, version marker, seamless rotation, hotbar/map/compass, diseases, pet guarding, animal skill trees, keyboard/orientation fixes, shore/tree fixes.
- **Task 22:** recruitable AI humans. **Task 23:** seasons, character sheet. **Task 24:** flame-heated rooms, cold damage. **Task 25:** dye system, custom icons, 3-minute despawn. **Task 26:** black-pixel hair fix, Full as default preset. **Task 27:** random name generator. **Task 28:** bot homesteading, salt storage, hay and grazing. **Task 29:** performance sweep (−46% sim time). **Task 30:** fur armor, frozen food, wall/door fixes, bot fire refuelling. **Task 31:** wetness, cold/flu, care cure, Wardrobe panel. **Task 32:** fox/owl/turtle/squirrel pets, 4 crops, pig/alpaca/bee/rabbit farm animals. **Task 33:** craftable-first crafting, death clears afflictions, safe spawn radius, disease rebalance, Recently Crafted. **Task 34:** unique bee/owl art, pet favourite treats, buildable Apiary (bees deposit honey; never lost when full).
- **Queued next:** **Task 36** — shovel terrain editing (±25 tiles), realistic flowing water, underground bases (dark, 60°F below 3 tiles, growable with light + water). Task 35 (seeded worldgen / heights / ledges) is done (ADR-254).

## New creatures, items & art — status for the art pass

This is the inventory for the art/assets bot: everything new that still needs dedicated artwork, sprites or animations, and what it currently borrows. **How to read it:** *dedicated* = unique art already ships; *reuses X* = the animal/item is drawn as an existing sheet with a tint/scale (see `packages/gameplay/data/sprite_fallbacks.json` — real art in the pack takes over from a fallback automatically, so shipping a real sprite for a key fixes it everywhere); *generic icon* = the HUD/inventory icon falls back to a category icon. **How new art ships:** dedicated pack sprites go through the pack pipeline (`src/build.py` + regenerate `packages/assets/pack/ids.lock.json` with `write-lock-pack.ts`); the snapshot push route carries text only, so binary PNGs can never be pushed directly — embed as base64 data URIs in a `.ts` file (Task 25 pattern) or paint at runtime in code (Task 34 pattern, `apps/client/src/task34-art.ts`).

### Creatures with dedicated art already (do not redo unless improving)
- **Bee** (`animal_bee`) and **owl** (`animal_owl`) — unique runtime-painted pixels, idle + walk, 8 directions × 4 frames (`apps/client/src/task34-art.ts`; keys `pets_bee`, `pets_owl`). Verified numerically, not yet eyeballed live — the user is the judge of "beautiful".
- **Apiary** (`decor_apiary`) — unique runtime-painted stacked-hive art, 2 rotations × 4 damage stages. Its build-menu icon (`build_apiary`) is a dedicated stacked-hive tile on `items_build` frame 286 (no longer shares the salt barrel's frame 224).

### Creatures still reusing other animals' sheets (need dedicated sprites + animations)
| Creature | Currently drawn as | Task added |
|---|---|---|
| Fox (pet, scout) | wolf, tint `#ff9050`, scale 0.7 | 32 |
| Turtle (pet, tank guard) | boar, tint `#557a3a`, scale 0.85 | 32 |
| Squirrel (pet, forager) | rabbit, tint `#c07040`, scale 0.75 | 32 |
| Pig (farm, truffle) | boar, tint `#f0a0b0` | 32 |
| Alpaca (farm, wool) | deer, tint `#f0e8d8` | 32 |
| Bear | boar, tint `#705038`, scale 1.5 | base roster |
| Bison | boar, tint `#604028`, scale 1.6 | base roster |
| Cow (farm, milk) | boar, tint `#b09070`, scale 1.5 | base roster |
| Deer / red deer / stag / elk / moose | boar (deer family), various tints/scales | base roster |
| Duck (farm, egg) | chicken, tint `#a0c090`, scale 0.9 | base roster |
| Goat (farm, milk) | deer, tint `#e0d8c8`, scale 0.8 | base roster |
| Goose (farm, egg) | chicken, scale 1.2 | base roster |
| Hare | rabbit, tint `#e0d0b0`, scale 1.2 | base roster |
| Sheep (farm, wool) | boar, tint `#f0f0e8`, scale 0.9 | base roster |
| Snake | rabbit, tint `#80a050`, scale 0.6 | base roster |
| Turkey (farm, egg) | chicken, tint `#a07050`, scale 1.4 | base roster |
| Wolf (hostile) | boar, tint `#a0a0a0` | base roster |
| Wild beehive (`beehive`) | tree stump, tint `#e0b040` | base roster |

All of the above need the standard animation frame structure the real sheets have (idle / walk / run / attack / hit / death, 8 directions). The original 13 pets (5 dogs, 3 cats, parrot, crow, chicken, rabbit, ferret) and the chicken farm animal use their own sheets.

### Crops & plants (need dedicated sprites + growth stages)
- **Lettuce, pepper, beetroot, rice** (Task 32, kinds 37–40, 4 growth stages each) — crop sprites derive from the plant sprite scaled per stage; beetroot currently falls back to `wild_beetroot` → `carrot_patch` / wild herbs / bush (tint `#d080a0`). Lettuce/pepper/rice wild seed nodes likewise need their own wild-plant art. All other crops (wheat, corn, potato, carrot, tomato, pumpkin, squash, beans, cabbage, onion, garlic, cotton, flax, hemp, herbs, mushroom, yarrow, ginseng, aloe, berry bushes, trees, fruit trees) share the same fallback pattern — seed icons fall back to `wild_grain`, produce icons to generic fruit/vegetable art (see `sprite_fallbacks.json` `icons`).
- **Hay** (Task 28) — its sprite reuses the wheat sheaf art (nature manifest frames 64 / 8 for hay / hay_seeds); its icon falls back to `wild_grain`. Needs its own hay bale / seed art.
- **Grazed bare grass** — dedicated short, eaten-down grass tiles ship as `gt_grass_grazed`, `gt_grass_grazed_fall`, and `gt_grass_grazed_winter` (resident atlas `gt_grazed`). Visibly distinct from ungrazed `gt_grass` (shorter stubs, soil showing, no flowers). Engine still needs to draw these keys when a `GrazedTile` is present; there is no render lookup yet, so packing the sprites does not auto-bind. See grazing logic in `packages/gameplay/src/skills/husbandry.ts` (about 180s regrow).

### Building pieces (need dedicated sprites)
- **Salt barrel** (tier 1, wood), **curing box** (tier 2, stone), **cold store** (tier 3, metal) — Task 28 salt storage. All three share atlas cells with other storage (`barrel_storage` / `storage_box` / `large_chest`); each needs its own sprite.
- **Apiary build-menu icon** — shipped: `build_apiary` now uses a dedicated stacked-hive icon on `items_build` frame 286. Frame 224 (salt barrel / barrel storage) is unchanged. In-world `decor_apiary` runtime art was left alone.
- **Salt-flat deposits** (Task 28, salt source on sand near water) — no dedicated deposit art listed; check `salt_flat` in the pieces data.

### New items & icons (need dedicated icons)
- **Task 32 items (ids 478–489):** lettuce, lettuce_seeds, pepper, pepper_seeds, beetroot, beetroot_seeds, rice, rice_seeds, salad, rice_bowl, truffle, truffle_stew — plus honey, honey_cake, honey_tea, salt, salt_brew, salted_fish (Task 28/32). Their inventory icons use the generic food fallback (berries) — no dedicated icons yet. **Task 32 resources (ids 87–94):** the 8 new resources behind these items.
- **Task 25's 39 custom HUD/menu icons** (`apps/client/src/game-icons-data.ts`, embedded as base64 data URIs) already ship as custom pixel art — do not redo unless improving. The 🔒 lock badges, tutorial text emoji and the `menu.ts` 🌡 label are still emoji and could use real icons.
- **Seeds in general:** every crop's seed icon falls back to `wild_grain`; every sapling icon falls back to `sticks` (except pine → `icon_pine_sapling`). Dedicated seed/sapling icons would fix dozens of items at once.
- **Meats:** raw/cooked venison, poultry, small game and prime cut all fall back to `raw_meat` / `cooked_meat`. **Milk** falls back to `water_flask`; **wool** to `cotton`; **maple syrup** to `honey`.

## Repository layout

| Path | Contents |
|---|---|
| `packages/core` | ECS, schemas + binary codec, fixed-step loop, RNG, events, permissions, groups, transactions, scheduler, chat model |
| `packages/world` | chunks, iso coordinates, chunk streaming, interest grid, spatial index, building grid, emitters/climate, chunk codec |
| `packages/net` | transport, protocol, snapshot deltas, prediction, lag compensation |
| `packages/persist` | world/player persistence (SQLite, IndexedDB, memory) |
| `packages/gameplay` | survival rules, crafting, building, combat, inventory, fire, economy (`data/*.json` defs) |
| `packages/input` | unified KB+M / gamepad / touch input |
| `packages/render` | WebGL2 isometric renderer + visual demo (`shots/` has screenshots) |
| `packages/assets` | manifest schema/loader/validation, stable ids, recipes; `pack/` is the engine copy of the art pack |
| `packages/testkit` | headless helpers + multi-client loopback harness |
| `apps/server` | headless authoritative server, bots |
| `apps/client` | Vite browser client |
| `assets/` | source art & audio packs (sprites, atlases, audio, survival_fx, pvp_clan, ui, stalls, tools) |
| `scripts/demo.mjs` | `pnpm demo` / `demo:bots` orchestration |
| `docs/` | architecture and decision records |

## Docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): ECS, loop, serialization, world streaming, interest management, building grid, asset pipeline, environment, social/combat/crafting, persistence, input, economy
- [docs/DECISIONS.md](docs/DECISIONS.md): ADR log
- [packages/net/ARCHITECTURE.md](packages/net/ARCHITECTURE.md): netcode
- [packages/persist/README.md](packages/persist/README.md): persistence
- [packages/gameplay/DESIGN.md](packages/gameplay/DESIGN.md) · [README](packages/gameplay/README.md): survival game design
- [packages/render/README.md](packages/render/README.md): renderer
- [packages/input/README.md](packages/input/README.md): input
- [assets/INTEGRATION.md](assets/INTEGRATION.md) · [assets/README.md](assets/README.md): art pack

---

## Handoff note for Grok — read this first (updated 2026-11-06, ~13:10 CST)

You are picking up the 2.5d survival engine (repo `TraceyHoff/2.5d-survival-engine`, live at https://traceyhoff.github.io/2.5d-survival-engine/). The previous agent (Muse) is nearly out of the user's free weekly usage (resets Nov 10, 10:19 AM CST). Do the remaining work, then stop — do not start anything beyond the queue below without the user.

### Where things stand
- Remote `main` was at **`b320c3b5`** (Task 34). **Task 35 (ADR-254) is implemented** on top of current main — see DECISIONS.md ADR-254. Previous note:: CI run 42275457127 job-level SUCCESS and Pages run 42275457130 SUCCESS, menu `vb320c3b5`. Local checkout is clean at the same commit (`~/workspace/work/survival-engine`, sparse checkout; never clone into /tmp, 512 MB tmpfs). Do NOT `git reset`, `git checkout -- .`, or re-clone.
- **Task 34 (done):** unique bee/owl art painted at runtime in `apps/client/src/task34-art.ts` (software rasterizer; keys `pets_bee`, `pets_owl`, `decor_apiary`; idle + walk, 8 directions × 4 frames; Apiary 2 rotations × 4 damage stages); favourite treats in the pet hand-interact panel via `favoriteTreats()` from `pets.json` love entries; Apiary buildable piece (tier 1, 12-slot container, planks 6 + rope 2, `free` placement, ground, outdoor); bees deposit honey in the nearest Apiary within 10 tiles, trough fallback, honey kept and retried next tick if both full — never lost. Gate: **2,743 passed / 1 failed (pre-existing sparse-checkout `pack.test.ts` KEYS.md absence) / 3 skipped**; client 575/575, server 107/107, render 441/441, gameplay 1,106/1,109; profile flat (open 1.063 / base 1.528 ms/tick). The CI fix for Task 34 was a one-line copy in `canvasToBlobURL` (`new ImageData(new Uint8ClampedArray(pixels), w, h)`) — see the TypeScript lesson below. Honest caveats: the new art was verified numerically (pixel counts, distinctness), NOT visually — no GL in the VM; the user's eyes on the live build are the real check for "beautiful". The pet-panel treat row has no client DOM test (data pinned at gameplay level via `petView.favorites`).
- **Next — the queue, in order, one batch at a time. Each starts only after the previous batch's CI + Pages are BOTH green (confirmed from the jobs endpoint, never the runs list):**
  1. **Task 35 (DONE — ADR-254):** world randomly generates with a seed each playthrough (map layout, resource and animal spawns differ; same seed is deterministic); safe zones (Task 33, 20-tile radius, hordes exempt) respected; varied terrain heights (`0..HEIGHT_MAX`); camera-hidden ledges kept visible (dim far cliff faces + top-face ledge lips).
  2. **Task 36 (gate MET — start here next):** players/AI humans use a shovel in the hotbar to raise/lower terrain; max terrain height 25 tiles above ground and 25 below; realistic flowing water (dig rivers that flow, elevated bases, pits/walls around bases); underground bases are dark until players make light sources, temperature stays 60°F year-round below 3 tiles underground, plants grow underground with continuous light + water + their other requirements.
- **Art pass (separate from Tasks 35/36):** the user wants the arts/assets bot to replace the borrowed/reused artwork. The full inventory is in the README section "New creatures, items & art — status for the art pass" above — every creature, crop, piece and item still drawn from another sheet or a generic icon, with its current fallback target. Read that section first; `packages/gameplay/data/sprite_fallbacks.json` is the source of truth for what reuses what.

### How work gets done here (hard-won rules — follow them)
- **Verify first, then commit locally, then ask the user for push approval — never push without the user tapping "Yes, push it" AND the separate snapshot approval card.** Pushes go through `/opt/hatch/bin/github push-files --owner TraceyHoff --repo 2.5d-survival-engine --branch main --message <msg> --source-dir ~/workspace/work/survival-engine --paths-file <file>`. The paths manifest must be NUL-delimited AND end with a trailing NUL. Keep any single snapshot comfortably under ~5 MB. The snapshot route carries **UTF-8 text files only — no binary PNGs** (embed art as base64 data URIs in a `.ts` file, or paint it in code as Task 34 does).
- **Gate before pushing:** `./node_modules/.bin/vitest run` across gameplay/render/client/server (report exact per-suite counts; the 7 `better-sqlite3` server load failures and the sparse-checkout `pack.test.ts` KEYS.md failure are pre-existing, not regressions) AND typecheck every changed package **including test files** with the lockfile-pinned **TypeScript 5.9.3** — NOT the VM's local `tsc` (5.6.3), which missed a real CI failure in Task 34 (TS2769 `new ImageData` overload; see above). A usable 5.9.3 binary can be fetched with `npm pack typescript@5.9.3` into /tmp. `pnpm` is at `~/workspace/work/tools/node_modules/.bin/pnpm`; plain npm fails on `workspace:` protocol; never run `pnpm add`. Remove any `package.json`/`package-lock.json` diff from npm before pushing. Local `node_modules/@engine/*` symlinks are NOT committed and must never be pushed.
- **CI-only failure classes the local VM hides:** (a) undeclared cross-package imports resolve locally via root symlinks but fail CI's strict pnpm linking — check every new import against the owning package's `package.json` deps, and never create a dep cycle (gameplay must not depend on persist); (b) the 7 unreadable server test files — grep-check shared-shape changes against them by reading them; (c) `pack.test.ts` — run it directly and confirm the only failure is the KEYS.md one. **Typecheck lesson from Task 30:** `AgentContext` lives in `@engine/core`, NOT the gameplay index — never write `G.AgentContext`.
- **After pushing:** check CI + Pages via the GitHub Actions **jobs endpoint** (`/actions/runs/<id>/jobs`, and check-run annotations for failures) — the runs list goes stale. A deploy counts as live only when its Pages run is confirmed successful at job level; report the live menu version (`v<short hash>`). If CI fails, fix it the same way (find the exact error from annotations, fix, re-push).
- **Other standing facts:** all engine work is for this repo only (not the user's other game repo). Names are required to enter the game. Full is the default graphics preset for fresh installs. Death-bag 60s owner-only window is intentional. Disease rates were rebalanced in Task 33 (raw meat 0.25→0.08, untreated water 0.30→0.10, rotten 0.60→0.25, sick food 0.15→0.05, bite 0.20→0.08, transmission 0.25→0.10). Safe spawn radius is 20 tiles. Fur armor set already exists (23.5 insulation total). Dye system, diseases, wetness/cold/flu, Recently Crafted sections, and the Task 32 pets/crops/farm animals (fox, owl, turtle, squirrel; lettuce, pepper, beetroot, rice; pig, alpaca, bee, angora rabbit) are all already in. Full task history lives in `~/MEMORY.md` on this machine.
