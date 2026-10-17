# engine

A custom **2.5D isometric multiplayer co-op survival engine** in TypeScript: gather resources, build bases, fight, survive day/night and weather. It targets the browser first and other platforms later. An authoritative Node server runs the same headless simulation as the client, which predicts and interpolates.

- **Core:** sparse-set ECS with binary-serializable schemas, a fixed-step 20 Hz loop, seeded RNG, and change tracking.
- **World:** chunked, effectively unbounded tile world with streaming, interest management and a building grid.
- **Netcode:** WebSocket, snapshot deltas, prediction/reconciliation and lag compensation.
- **Persistence:** SQLite on the server, IndexedDB in the browser.
- **Assets:** data-driven manifests.
- **Input:** a unified keyboard/mouse, gamepad and touch input layer.

## Prerequisites

- **Node.js ≥ 20** (`.nvmrc` pins 20; 22 also works). `nvm use` picks the right version.
- **pnpm 10** via corepack: `corepack enable` (the version comes from `packageManager` in `package.json`).
- **better-sqlite3** (server persistence) ships prebuilt binaries for Node 20/22 on Linux, macOS and Windows x64/arm64. On other platforms or Node versions it compiles from source, which needs Python 3 and a C++ toolchain (`build-essential` / Xcode CLT / VS Build Tools). `pnpm demo` checks the binding and runs `pnpm rebuild better-sqlite3` if it's missing.

## Quick start

```sh
git clone <repo> engine && cd engine
corepack enable
pnpm install --frozen-lockfile
pnpm check          # typecheck every package + run all tests
pnpm demo           # server + Vite client; open the two printed URLs
```

| Command | What it does |
|---|---|
| `pnpm check` | `pnpm -r typecheck` + `vitest run` (what CI runs) |
| `pnpm test` | all Vitest suites |
| `pnpm test:net` | net + testkit + server/client multiplayer integration tests |
| `pnpm -r build` | typecheck/build every package; Vite production builds for client and render demo |
| `pnpm bench` | net/persist benchmarks with strict timing ceilings (`PERF=1`) |
| `pnpm --filter @engine/client build` | client production bundle in `apps/client/dist` |

## How to play

```sh
pnpm demo                      # server ws://localhost:7777 (save ./saves/demo.db) + client http://127.0.0.1:5173/
pnpm demo --bots 5             # …plus 5 headless bot players (wander + gather)
pnpm demo --fresh              # new world (deletes the save)
pnpm demo:bots                 # headless load run: fresh server + 20 bots, stats every 3 s
pnpm demo:bots --bots 50 --duration 60
```

- `pnpm demo` prints two client URLs, `http://127.0.0.1:5173/?player=1&server=ws://localhost:7777` and `…?player=2…`. Each `player=N` keeps a separate saved account, so two tabs on one browser act as two players. Connect with the overlay (top-left: server URL, name, Connect).
- **Ports:** game server WebSocket `7777` (`--port` or `PORT`), Vite client `5173` (`--client-port`). Other options: `--save <file>`, `--duration <s>`, `--open`.
- **Standalone:**
  - Server: `pnpm --filter @engine/server start -- --save saves/demo.db [--fresh]`
  - Client: `pnpm --filter @engine/client dev`, then open `/?server=ws://host:7777`
  - Bots: `pnpm --filter @engine/server bots -- --url ws://127.0.0.1:7777 --count 5`
  - Renderer visual demo (offline, no server): `pnpm --filter @engine/render dev`
- **Controls wired in the client today:** **WASD** move, **Shift** sprint, **E** gather. Everything else (combat, building, inventory UI, gamepad/touch) exists at the engine level but isn't hooked into `apps/client` yet. Default bindings for all three device classes are listed in `docs/ARCHITECTURE.md` §18.
- **Persistence:** reload a tab and it reconnects as the same player (token in `localStorage`). Ctrl-C saves the world; the next `pnpm demo` restores players and world edits.

## Repository layout

| Path | Owner | Contents |
|---|---|---|
| `packages/core` | Engine architecture | ECS, schemas + binary codec, fixed-step loop, RNG, events, input frames, permissions, groups, transactions, scheduler, chat model |
| `packages/world` | Engine architecture | chunks, iso coords, ChunkManager streaming, interest grid, spatial index, building grid, emitters/climate, chunk codec |
| `packages/assets` | Engine architecture (schema) / Art (pack) | manifest schema/loader/validation, stable ids, recipes; `pack/` = Art's real asset pack |
| `packages/input` | Engine architecture | unified input: devices, bindings, contexts, touch controls, gestures, focus navigation, prompts |
| `packages/testkit` | Engine architecture | headless helpers + multi-client loopback harness |
| `packages/render` | 2.5D Renderer | WebGL2 iso renderer + visual demo |
| `packages/net` | Netcode | transport, protocol, snapshot deltas, prediction, lag compensation |
| `packages/persist` | Netcode | world/player persistence (SQLite, IndexedDB, memory) |
| `packages/gameplay` | Survival Systems | survival rules, crafting, building rules, combat, inventory |
| `apps/server` | Netcode | headless authoritative server, bots |
| `apps/client` | Netcode (connect UI) | Vite browser client |
| `scripts/demo.mjs` | Netcode | `pnpm demo` / `demo:bots` orchestration |

## Docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): architecture, ECS, loop, serialization, world streaming, interest management, building grid, asset pipeline, testing, environment, social/permissions/combat/crafting, persistence, input system
- [docs/DECISIONS.md](docs/DECISIONS.md): ADR log
- [packages/net/ARCHITECTURE.md](packages/net/ARCHITECTURE.md): netcode design
- [packages/persist/README.md](packages/persist/README.md): persistence
- [packages/gameplay/DESIGN.md](packages/gameplay/DESIGN.md): survival game design
- [packages/render/README.md](packages/render/README.md): renderer
- [packages/input/README.md](packages/input/README.md): input wiring

## Status

**Playable now**
- Multiplayer in the browser: connect, move, sprint, gather, with prediction and server reconciliation. Other players and bots replicate smoothly.
- Persistent worlds and players (SQLite) that survive restarts and reconnects.
- The headless load test (`pnpm demo:bots`) holds 20 Hz with dozens of bots.
- The renderer demo shows the iso map with real art, day/night and weather.

**Engine-level, not yet wired into the playable client**
- Building placement UI, crafting/inventory UI, combat input, chat UI, clans/trading UI. The sim and gameplay systems exist, but the client lacks the UI.
- `@engine/input` (gamepad, touch, rebinding, prompts) isn't in `apps/client` yet. The client still uses a raw keyboard map.
- The WebGL2 renderer isn't the client's renderer yet (the client uses a Canvas2D debug view).
- Tile edits replicate, but the client still draws placeholder ground.

**Planned**: WebTransport, cross-platform shells, a full art pass across all categories.
