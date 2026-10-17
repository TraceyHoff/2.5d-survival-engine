# Architecture Decision Log

Format: number, title, status, context → decision → consequences. All Accepted 2026-10-17 unless noted.

## ADR-001: TypeScript (strict) everywhere
Shared sim code between browser and server; strict flags incl. `noUncheckedIndexedAccess`. Cost: more `!` on typed-array reads.

## ADR-002: pnpm workspaces monorepo, source-first packages
Packages export `src/index.ts`; no build artifacts for libraries; `build` scripts typecheck. Apps bundle. Simpler dev loop; publishing would need a build later.

## ADR-003: Vite for client, Vitest for tests, Node 20 + tsx for server
One transform pipeline; fast tests; server runs same TS.

## ADR-004: WebGL2 renderer behind a `Renderer` interface, owned by Renderer team
Renderer consumes a `RenderFrame` built in `renderPrep`; never mutates sim. WebGPU can come later behind the same interface.

## ADR-005: Sparse-set ECS with SoA typed arrays (no archetypes)
O(1) add/remove, cache-friendly field iteration, trivially serializable. Queries are slower than archetype tables for many-component joins; mitigated by driving from smallest store.

## ADR-006: Entity id = uint32 (20-bit index + 12-bit generation)
Detects stale handles; 1M entity ceiling; generations wrap after 4096 reuses of a slot (acceptable).

## ADR-007: Components are plain numeric data with schemas; no strings
Field types f32/f64/i8–u32; strings/references replaced by numeric ids. Enables binary serialization and typed-array storage.

## ADR-008: Stable numeric component ids by registration order + `networked` flag
Built-ins first (NetId, Owner, Transform, PrevTransform), then gameplay via one shared registration module. Only `networked: true` components replicate.

## ADR-009: Deterministic world schema hash
`world.getSchemaHash()` = FNV-1a over (id, name, networked, sorted field signature incl. quant hints) in registration order. Checked at handshake and embedded in snapshots; mismatch ⇒ reject.

## ADR-010: Built-in NetId {id:u32} and Owner {clientId:u16} in core
Wire identity decoupled from local entity ids; Owner drives prediction and authority. Server assigns NetIds.

## ADR-011: Built-in Transform + PrevTransform; render interpolation
Transform {x,y,z,facing} in float tile units. PrevTransform copied at the start of every tick; renderer lerps Prev→Current by `alpha`.

## ADR-012: Fixed-timestep loop, default 20 Hz, render(world, alpha)
Accumulator + max-steps clamp; time injected via `advance(elapsedMs)`; `createGameLoop(world, {render})` calls `world.step(dt)` then `render(world, alpha)`.

## ADR-013: Deterministic-friendly sim: seeded RNG, no wall clock
mulberry32 `Rng` with snapshot-able u32 state on the world; sim packages forbid `Date.now`, `performance.now`, `Math.random`.

## ADR-014: Ordered system phases; custom named phases; simulation-only replay
Phases input → simulation → postSim → network → renderPrep; `addPhase(name,{after})`; `world.simulate(n, dt, beforeTick)` re-runs only simulation for reconciliation.

## ADR-015: Per-tick change tracking via dirty bitsets
Bit per entity per store set on add/write/markChanged; `world.changed(def)`; cleared at end of `step()`. Raw typed-array writes must call `markChanged`.

## ADR-016: Entity spawn/despawn hooks
`onSpawn`/`onDespawn`; despawn fires before component removal so net can read NetId.

## ADR-017: Schema-driven versioned binary serialization; per-field codecs
Little-endian, sorted field order, snapshot header (magic, version, tick, world hash) and per-component hash. `encodeField/decodeField` over `FieldWriter/FieldReader` so net can layer bit-packing and deltas.

## ADR-018: Quantization hints on schemas, applied on the wire only
`{type, quant:{bits,min,max}}`; `quantize/dequantize/wireValue` helpers; sim state keeps full precision.

## ADR-019: Authoritative server running the same headless sim; client prediction + interpolation
Netcode team owns transport (WebSocket first, WebTransport later) and replication; see `packages/net/ARCHITECTURE.md`.

## ADR-020: World resources for global state
Typed singletons (`TimeOfDay`, `Weather`) via `defineResource<T>`; numeric enums only.

## ADR-021: Chunked tile map (32×32), 2:1 iso projection, spatial hash
u16 tile ids + u8 height per chunk with dirty/version; `worldToScreen/screenToWorld`; uniform-grid spatial hash for broad phase.

## ADR-022: Queued event bus delivered at end of tick
Deterministic delivery order; `emitNow` for immediate cases.

## ADR-023: Per-tick component removal tracking
Each store keeps an insertion-ordered, deduped set of entity ids (with the generation at removal time) that lost the component this tick via `world.remove` or `destroy`. `world.removed(def): IterableIterator<Entity>`. Cleared with dirty bits in `clearChanges()` / end of `step()`; `simulate()` leaves it untouched. A same-tick re-add appears in both `removed()` and `changed()`, so consumers process removals first, then changes. Resolves ARCHITECTURE open question on removed-component tracking for delta replication.

## ADR-024: Fixed-length array fields
`{type, length: n}` stored SoA with stride n (`data[f][slot*n+i]`). Accessors: `getArray` (live subarray), `getElement/setElement`; value objects use `number[]`. Serialized element-wise; length is part of the schema signature/hash. Change bits stay per-component (not per element).

## ADR-025: Per-field schema defaults
`{type, default}` applied when a component is first added (arrays filled). Default is part of the schema hash.

## ADR-026: Replay semantics for simulate()
`simulate(ticks, dt, {systems?, beforeTick?, startTick?, keepEvents?})`: sets `world.tick = startTick + i` per replay (default startTick = `tick - ticks`, the last `ticks` completed ticks, consistent with `step()` running systems at the pre-increment tick), restores tick afterwards, sets `isReplaying`, discards queued events by default, can restrict to named simulation systems. `world.predicted: Set<Entity>` lets systems skip non-predicted entities. Legacy `simulate(n, dt, fn)` kept.

## ADR-027: Keyed deterministic RNG streams
`world.rngFor(key, entity?)` = fresh mulberry32 seeded by hash(world seed, tick, key, entity). Stateless w.r.t. the global `world.rng`, so prediction can reproduce rolls. Peers must pass a shared id (NetId), not local entity ids.

## ADR-028: Environment singleton entity
Core creates `world.environment` with `NetId = ENV_NET_ID (1)`, `TimeOfDay {t f64, dayLengthTicks u32, day u32}` and `Weather {kind u8, intensity f32, ticksRemaining u32}`, both networked. `world.env(def)` is a live view (writes mark changed). Weather kinds are gameplay data (core enum removed). Net server allocates NetIds from 2; net client maps ENV_NET_ID onto its own environment entity. `resource(TimeOfDay)` remains as a deprecated alias of `env()`.

## ADR-029: System order introspection
`world.systemOrder(): {phase, name}[]`.

## ADR-030: Generic input frames and commands
`defineActions(names)` → bit masks (≤32) owned by gameplay; `InputFrame {tick, actions u32, aimX, aimY, commands}`; commands are schema records (`defineCommand(name, schema)`) with ids from a `CommandRegistry` (registration order, u8). Binary codec `encodeInputFrame/decodeInputFrame`. Legacy `Action` masks kept, deprecated.

## ADR-031: Shared spatial index
`@engine/world` `installSpatialIndex(world)` registers resource `SpatialIndexRes` and postSim system `spatialIndex`, updated incrementally from Transform change/removal records; `queryRadius`, `queryRect` with exact tests.
