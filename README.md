# 2.5D Survival Engine

A cute, cartoony **2.5D isometric multiplayer co-op survival game** and its custom engine. It is browser-first and written in **TypeScript + WebGL2**. You gather resources, build bases, craft, trade with other players and survive cold, rain, hunger and the night, alone or with your clan. An authoritative Node server runs the same headless simulation as the browser client. The client predicts locally and interpolates everyone else.

> **Status:** early, but you can already play multiplayer in the browser (move, sprint, gather, persistent worlds). Most gameplay systems are implemented and tested in the engine but aren't wired into the client UI yet. See [What's playable today](#whats-playable-today).

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
| `pnpm demo:bots` | headless load run: fresh server + 20 bots, prints stats |
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

## Controls

**In the playable client today:** `WASD` move, `Shift` sprint, `E` gather. Reloading the tab reconnects you as the same player.

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

### Survival gameplay (`packages/gameplay`)
- 🔧 **Vitals:** hunger, thirst, stamina (drain, delay, regen), health, death; damage from starvation, dehydration, hypothermia and hyperthermia
- 🔧 **Environment:** time of day, weather (rain, storm, snow, fog, wind), climate (temperature, humidity, altitude), **body temperature**, **wetness**, heat sources, shelter/enclosure detection and buffs/debuffs (wet, cold, well-fed)
- 🔧 **Food decay** stored on items (never ticked per item)
- ✅/🔧 **Gathering & resources** (gathering is playable) and refining
- 🔧 **Inventory & containers:** fixed slots, stacking, durability, atomic transfers
- 🔧 **Crafting:** recipes, stations (fired stations must be lit), timed jobs, atomic exchange at completion
- 🔧 **Building:** grid-based base building with floors, walls, roofs, doors, fences and furniture; placement rules, rotation, support/stability, HP tiers, upgrades, repair, demolition and door/container states
- 🔧 **Structure fire:** burning pieces take damage, spread to flammable tiers (twig/wood) and get put out by rain (`data/fire.json`). Rendered with flames, embers and smoke.
- 🔧 **Combat & zombies:** damage pipeline, zombie spawning and AI

### Social, PvP & economy
- 🔧 **Clans/groups** with roles; **land claims** (claim totems) and a permission system (ACLs, ownership, claims, zones)
- 🔧 **PvP & raiding:** raid rules via permission hooks; destroyed stalls spill their stock and till as loot bags
- 🔧 **Chat:** channels, rate limiting, mute lists, wire encoding
- 🔧 **Player-driven trade-stall economy:** no NPC vendors. Stalls come in four sizes (blanket, cart, booth, clan pavilion with up to 24 listings), with stock, a till, prices in any item (`coin` by convention), offline sales, a sales ledger, clan rank policies and atomic purchases. **Crafter names** (provenance) stay on crafted items through every trade, and items made by different crafters never stack.

### Input (`packages/input`)
- 🔧 Unified **keyboard & mouse, gamepad and touch** input: bindings, contexts, rebinding, tap/hold/long-press, on-screen touch controls, gestures, focus navigation and device-aware prompts (the client still uses a raw keyboard map)

### Renderer (`packages/render`)
- 🔧 **WebGL2 isometric renderer** with depth sorting, sprite batching, building occlusion/cutaway, dynamic **lighting and shadows**, bloom, a **day/night cycle** with color grading, **weather** (rain, storm, snow, fog, wind sway), **fire** and particle VFX, held items, and runtime atlas themes. It's showcased in the render demo. (The multiplayer client still draws with a Canvas2D debug view.)

### Art & audio packs (`assets/`)
- The **Cozy-Wild** cartoon art pack: characters, zombies, critters, equipment, items, resources, tiles, buildings and VFX (8-direction sprites, atlases, a palette, piece variants, damage stages) plus audio
- **`survival_fx`:** day/night grading, LUTs, sheen masks, render tuning and fire/weather effects
- **`pvp_clan`:** clan palettes, totems, banners, rarity colors, fonts and world-UI colors
- **`ui`:** UI atlas, fonts, input prompt icons ([UI_GUIDE](assets/ui/UI_GUIDE.md))
- **`stalls`:** trade-stall art
- `tools/`: the Python generators (`python3 assets/tools/build_all.py`) that rebuild the pack
- See [assets/INTEGRATION.md](assets/INTEGRATION.md) and [assets/STYLE_GUIDE.md](assets/STYLE_GUIDE.md). The engine loads the validated copy in `packages/assets/pack/`, and the render demo serves `assets/` at `/@art/` (override with `ART_DIR`).

## What's playable today

- **Playable now:** browser multiplayer (connect, move, sprint, gather) with prediction and reconciliation; other players and bots replicate smoothly; persistent worlds and players; the renderer showcase with real art, lighting, weather, day/night and fire.
- **Engine-only so far:** building, crafting/inventory UI, combat input, chat UI, clans/claims/trading UI, `@engine/input` (gamepad/touch) in the client, and the WebGL2 renderer as the client's renderer. Tile edits replicate, but the client still draws placeholder ground.
- **Planned:** WebTransport, cross-platform shells, a full art pass.

## Current build status

As of the last commit: `pnpm install --frozen-lockfile` ✅ · `vitest run` ✅ **80 files / 350 tests pass** · `pnpm -r typecheck` ❌ in `@engine/render` only, from work-in-progress held-item code:

```
packages/render/src/sprites.ts(346,81): error TS2532: Object is possibly 'undefined'.
packages/render/src/sprites.ts(347,57): error TS2532: Object is possibly 'undefined'.
packages/render/src/sprites.ts(348,82): error TS2532: Object is possibly 'undefined'.
```

So `pnpm check` currently fails at the typecheck step. The tests and the demo still run.

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
