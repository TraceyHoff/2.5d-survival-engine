# SurVivaZ

_A cozy survival game built on the 2.5D Survival Engine._

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
  Bots are a **dev load-test tool, never part of multiplayer**: `apps/server/src/bots.ts` refuses to start unless
  `NET_DEV_BOTS=1`, tags its connections (`demo.devBot`), and a multiplayer server (the Node default, `mode: "multiplayer"`)
  drops tagged connections unless it was also started with `NET_DEV_BOTS=1`. The production server path (main.ts / game.ts)
  never imports bots.ts. Human bots exist only in singleplayer/offline (the browser's local mode, `mode: "singleplayer"`).

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

---

## Handoff note for Grok — read this first (updated 2026-11-06, ~11:45 CST)

You are picking up the 2.5d survival engine (repo `TraceyHoff/2.5d-survival-engine`, live at https://traceyhoff.github.io/2.5d-survival-engine/). The previous agent (Muse) paused at **92% of the user's free weekly usage limit** (resets Nov 10, 10:19 AM CST). Do the remaining work, then stop — do not start anything beyond the queue below without the user.

### Where things stand
- Remote `main` is at **`5c8e2ca9`** (Task 33, CI + Pages both green, menu `v5c8e2ca9`). **Task 34 is DONE and gated locally, being pushed now** — if the push landed, remote main is the Task 34 commit (see below); if it did not land, the Task 34 work is uncommitted in the checkout at `~/workspace/work/survival-engine` (sparse checkout; never clone into /tmp, 512 MB tmpfs) — do NOT `git reset`, `git checkout -- .`, or re-clone.
- **Task 34 — unique bee/owl art, pet favourite treats, Apiary — complete, gate green, uncommitted at last check (18 modified + 3 new files, ~210 lines, ~1 MB total):** dedicated bee/owl/Apiary pixels painted at runtime in `apps/client/src/task34-art.ts` (software rasterizer; keys `pets_bee`, `pets_owl`, `decor_apiary`; idle + walk, 8 directions × 4 frames; Apiary 2 rotations × 4 damage stages); favourite treats shown in the pet hand-interact panel via `favoriteTreats()` from `pets.json` love entries; Apiary buildable piece (tier 1, 12-slot container, planks 6 + rope 2, `free` placement, ground, outdoor) in `packages/gameplay/data/pieces.json`; bees deposit honey in the nearest Apiary within 10 tiles, trough fallback, and if both are full the honey is kept and retried next tick — never lost. Gate: **2,743 passed / 1 failed (pre-existing sparse-checkout `pack.test.ts` KEYS.md absence) / 3 skipped**; client 575/575, server 107/107, render 441/441, gameplay 1,106/1,109; typechecks clean in changed files; profile flat (open 1.063 / base 1.528 ms/tick vs Task 29 baseline 1.44 / 2.71). The two red flags from the earlier note were checked and are legitimate, not reverts: `pack.test.ts` only adds the `task34` sub-manifest to the merged-manifest list; `write-lock-pack.ts` only adds the same fragment to its SUBS list. New tests: `packages/gameplay/test/task34_apiary.test.ts` 12/12 (re-run by the parent). Honest caveats: the new art was verified numerically (pixel counts, distinctness), NOT visually — no GL in the VM; the user's eyes on the live build are the real check for "beautiful". The pet-panel treat row has no client DOM test (data pinned at gameplay level via `petView.favorites`). The fragment's borrowed `image` paths (bee/owl → `items_build`, Apiary → `nature_icons`) are a deliberate documented compromise: runtime-painted atlases have no files, and the pack test requires every manifest atlas to name an existing PNG+KTX2 pair; view.ts overrides with blob URLs at runtime.
- **Then the queue, in order, one batch at a time — each starts only after the previous batch's CI + Pages are BOTH green (confirmed from the jobs endpoint, never the runs list):**
  1. **Task 35:** world randomly generates with a seed each playthrough (map layout, resource spawns, animal spawns differ each time) but respects the safe zones (Task 33: 20-tile radius around installed spawn points, no aggressive spawns/targeting inside; hordes exempt); more varied terrain heights; ledges of varying terrain heights hidden by the camera angle made more easily seen.
  2. **Task 36:** players/AI humans use a shovel in the hotbar to raise/lower terrain; max terrain height 25 tiles above ground and 25 below; realistic flowing water (dig rivers that flow, elevated bases, pits/walls around bases); underground bases are dark until players make light sources, temperature stays 60°F year-round below 3 tiles underground, plants grow underground with continuous light + water + their other requirements.

### How work gets done here (hard-won rules — follow them)
- **Verify first, then commit locally, then ask the user for push approval — never push without the user tapping "Yes, push it" AND the separate snapshot approval card.** Pushes go through `/opt/hatch/bin/github push-files --owner TraceyHoff --repo 2.5d-survival-engine --branch main --message <msg> --source-dir ~/workspace/work/survival-engine --paths-file <file>`. The paths manifest must be NUL-delimited AND end with a trailing NUL. Keep any single snapshot comfortably under ~5 MB. The snapshot route carries **UTF-8 text files only — no binary PNGs** (embed art as base64 data URIs in a `.ts` file, or paint it in code as Task 34 does).
- **Gate before pushing:** `./node_modules/.bin/vitest run` across gameplay/render/client/server (report exact per-suite counts; the 7 `better-sqlite3` server load failures and the sparse-checkout `pack.test.ts` KEYS.md failure are pre-existing, not regressions) AND `./node_modules/.bin/tsc -p` for every changed package **including test files**. `pnpm` is at `~/workspace/work/tools/node_modules/.bin/pnpm`; plain npm fails on `workspace:` protocol; never run `pnpm add`. Remove any `package.json`/`package-lock.json` diff from npm before pushing. Local `node_modules/@engine/*` symlinks are NOT committed and must never be pushed.
- **CI-only failure classes the local VM hides:** (a) undeclared cross-package imports resolve locally via root symlinks but fail CI's strict pnpm linking — check every new import against the owning package's `package.json` deps, and never create a dep cycle (gameplay must not depend on persist); (b) the 7 unreadable server test files — grep-check shared-shape changes against them by reading them; (c) `pack.test.ts` — run it directly and confirm the only failure is the KEYS.md one. **Typecheck lesson from Task 30:** `AgentContext` lives in `@engine/core`, NOT the gameplay index — never write `G.AgentContext`.
- **After pushing:** check CI + Pages via the GitHub Actions **jobs endpoint** (`/actions/runs/<id>/jobs`, and check-run annotations for failures) — the runs list goes stale. A deploy counts as live only when its Pages run is confirmed successful at job level; report the live menu version (`v<short hash>`). If CI fails, fix it the same way (find the exact error from annotations, fix, re-push).
- **Other standing facts:** all engine work is for this repo only (not the user's other game repo). Names are required to enter the game. Full is the default graphics preset for fresh installs. Death-bag 60s owner-only window is intentional. Disease rates were rebalanced in Task 33 (raw meat 0.25→0.08, untreated water 0.30→0.10, rotten 0.60→0.25, sick food 0.15→0.05, bite 0.20→0.08, transmission 0.25→0.10). Safe spawn radius is 20 tiles. Fur armor set already exists (23.5 insulation total). Dye system, diseases, wetness/cold/flu, Recently Crafted sections, and the Task 32 pets/crops/farm animals (fox, owl, turtle, squirrel; lettuce, pepper, beetroot, rice; pig, alpaca, bee, angora rabbit) are all already in. Full task history lives in `~/MEMORY.md` on this machine.
