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

## ADR-032: Unbounded chunk coordinates with string ChunkKey
Chunk coords are signed int32; `chunkKey(cx,cy)` = `"cx,cy"` (string, stable wire/debug format), `chunkOf(pos)`, `chunkKeyOf(x,y)`, `parseChunkKey`. Strings over packed numbers because int32×int32 does not fit a JS number exactly; measured cost is negligible at interest-update rates.

## ADR-033: Float precision policy
Transform stays f32 tile units. Guaranteed ≤1/256-tile precision within ±65,536 tiles of the origin (`F32_SAFE_TILE_RANGE`). Larger worlds run sims relative to a `WorldOrigin` (region/camera rebasing at chunk corners) and persist chunk-relative positions (chunk codec does this).

## ADR-034: ChunkManager streaming with pluggable providers and LRU
Active set = union of squares (Chebyshev radius) around interest sources, with an unload margin (hysteresis), a per-update load budget, and an LRU of inactive chunks. Stable hooks `onLoad(chunk, nodes)` / `onUnload(chunk)` (persist there). `ChunkProvider.load` (sync) — `ProceduralGenerator` (seeded value-noise biomes + resource node placements) is the stub provider.

## ADR-035: Persistent component flag + versioned binary chunk codec
`defineComponent(..., {persistent: true})` (Transform is persistent). `encodeChunk/decodeChunk` v1: RLE tiles, heights, anchored building instances, persistent-component table with schema hashes, entities with chunk-relative Transform. No storage backend in core/world.

## ADR-036: Chunk membership + InterestGrid for relevancy
`ChunkMembership` maintains entity→chunk incrementally from Transform change/removal records. `InterestGrid` computes per-client relevant chunks (radius + hysteresis) and entities, emitting `enteredChunks/leftChunks/entered/left` each update; cost O(clients × chunks-in-radius + nearby entities). `setAlwaysRelevant` for own player/environment.

## ADR-037: Hierarchical spatial index
`ChunkedSpatialIndex`: chunk map → 8×8 grid of 4-tile cells; memory proportional to occupied chunks; rect/radius queries visit only overlapping chunks/cells. The flat `SpatialHash`/`installSpatialIndex` remain for small worlds.

## ADR-038: Building grid as data structures only
`BuildingGrid` with per-chunk `StructureLayer` (sparse occupancy keyed by level 0..15, layer 0..3, local tile), multi-tile rotated footprints spanning chunks, collision/occupancy/rect queries, support graph (`supportsOf/dependentsOf/neighborsOf`), `stabilityRule` hook, sub-tile sockets (1/4 tile) with `snap`. `BuildPieceDef` is data (`loadBuildPieces`): footprint, levels, layer, solid, cost [{resource, amount}], sockets, hp. Rules belong to Survival Systems.

## ADR-039: Stable string-key → numeric id registry with lock tables
`StableIdRegistry.assign(keys, lock)` keeps locked ids and appends new keys after the max (sorted), so content additions never renumber; `hash` covers all pairs. Used by assets (`ids.lock.json`) and build pieces. `world.addSchemaSalt(name, hash)` mixes such hashes into `getSchemaHash()`.

## ADR-040: Data-driven asset manifests (@engine/assets)
JSON manifest v1: atlases (grid frames) and sprites (category ∈ character/zombie/item/equipment/resource/building/tile, anchor, animations with frames/fps/directions 1|4|8/dirStride). `loadManifest` validates (all issues reported), assigns stable u16 ids, `AssetRegistry.frame()` resolves atlas rects by facing/time; `installAssetHash(world, reg)`. Placeholder cartoony atlases generated by a dependency-free script.

## ADR-041: Test harness and CI
Core exports `createTestWorld`, `stepN`, `FakeClock`, `TEST_SEED`. `@engine/testkit` `createHarness` runs an in-process `NetServer` + N `NetClient`s over Netcode's loopback transport on one fake clock. `pnpm check` = recursive typecheck + vitest; GitHub Actions workflow runs install, check and build (not pushed yet).

## ADR-042: Derived TimeOfDay (no per-tick replication)
`TimeOfDay {dayLengthTicks u32, epochTick i32}`; fraction/hours/day are derived from `world.tick` by `timeOfDay(world, tick?)` → `{t, hours, day, tickOfDay, dayLengthTicks}`. Jumps go through `setTimeOfDay(world, hours, day?)` / `setDayLength(world, ticks)`, which rewrite `epochTick` (the only time the component changes and replicates). Replaces the f64 `t` that cost 64 bits/tick per client (Netcode §12). Gameplay's clock system now only emits phase-change events.

## ADR-043: Weather.endsAtTick
`Weather {kind u8, intensity f32, endsAtTick u32}`: weather lasts while `tick < endsAtTick`; replaces the per-tick `ticksRemaining` countdown (32 bits/tick per client).

## ADR-044: Transform wire quantization
`Transform.z` q10 over [0, `TRANSFORM_Z_MAX` = 64] tiles (~0.0625 tile), `facing` q8 over [-π, π] (~1.4°). Sim keeps f32; values outside the range are clamped on the wire, so systems keep facing normalized (`normalizeAngle`) and heights within 0..64 tiles. x/y stay f32 (chunk-relative q16 is a future option).

## ADR-045: Multiple interest viewpoints per client
`InterestGrid.setClientViewpoints(id, [{x, y, r?}])`; the relevant chunk/entity set is the union, hysteresis is applied per viewpoint. `setClient(id, x, y, r?)` remains as the single-viewpoint shorthand.

## ADR-046: Extended asset manifest (sounds, vfx, UI, emissive, variants, building sprites)
Manifest v1 gains optional `sounds` (file variants, volume, pitchJitter, loop, category sfx|ambience|ui), `vfx` (sprite/anim ref, lifetime, particle params, blend normal|additive|multiply), atlas `nineSlice` insets and `emissive` flag (`<image>_emissive.png`, same layout), `tintSets`, `palettes` (source→target color maps), `variantSets` (character/zombie base + tint/palette/sprite variants) and building sprite data (`piece`, footprint, layer, `frames[rotation][damageStage]`, cross-checked by `validateBuildingSprites`). Ids are stable per namespace (sprites, sounds, vfx, variants, tints, palettes) via `StableIdRegistry`; `ids.lock.json` is namespaced (flat legacy sprite locks migrate automatically) and the registry hash covers all namespaces.

## ADR-047: Generic emitters and field sampling
`@engine/world` `Emitter {kind u8, radius f32, strength f32, falloff u8 (Constant|Linear|Quadratic)}` (networked) + `EmitterIndex` (postSim system `emitterIndex`, per-kind `ChunkedSpatialIndex`, incremental from change/removal records). `sampleField(kind, x, y, z?)` sums contributions; `nearestEmitters(kind, x, y, n, z?)`. Optional `OcclusionFn`; `buildingOcclusion(grid, {transmit, kinds})` makes solid building tiles block (walls block heat). Kinds and meaning (heat, light-as-warmth, smell, noise) are gameplay's.

## ADR-048: Shelter and exposure queries on BuildingGrid
`isCovered(tx, ty, z)` (roof-layer piece above), `enclosure(tx, ty, z, maxCells)` (bounded flood fill bounded by solid wall-layer pieces; `{enclosed, roofed, size}`; cache shared by all cells of a room, invalidated by `version` bump on place/remove), `exposure(x, y, z, windDir?)` heuristic in [0,1]. Configurable `roofLayers` / `wallLayers`. Gameplay decides what exposure means.

## ADR-049: Wind on Weather
`Weather` gains `windDir` (radians toward which wind blows, q8 [-π,π]) and `windSpeed` (tiles/s, q8 [0,32]); networked with the environment singleton.

## ADR-050: Climate sampling with gameplay-owned models
`BaseClimateSource.baseClimate(tx, ty)` → `{temperature, humidity, altitude}`; `ProceduralGenerator` implements it from biome bands (+ large-scale noise, altitude = tile height) and `chunkClimate`. `installClimate(world, source, model?)`, `setClimateModel`, `climateAt(world, x, y)` = `model.sample(base, {time: timeOfDay, weather})`. `DefaultClimateModel` is a simple placeholder; Survival Systems supplies its own `ClimateModel`.

## ADR-051: Scheduled (slow) systems and lazy decay
`addSystem(phase, name, fn, {every, offset})`: runs when `tick ≡ offset (mod every)` with `dt × every`; default offset = hash(name) % every for deterministic staggering; honored by `simulate()`. `decayAt(createdTick, rate, tick, {initial, mode})` and `decayReachesAt` support lazy decay: store createdTick/lastUpdateTick per item/slot and evaluate on read instead of per-tick updates.

## ADR-052: Generic modifier stacks
`defineModifierStack(name, capacity)` → fixed-capacity array component (stat u8 [0 = empty], op Add|Mul, value f32, expiresAtTick u32 [0 = permanent]); `addModifier` (refreshes same stat+op, reuses expired slots), `removeModifiers`, `evaluate(world, e, def, stat, base)` = (base + Σadd) × Πmul over live entries, `pruneModifiers` (slow system). Stat ids belong to gameplay.

## ADR-053: Stable PlayerId and server-authoritative GroupRegistry
`PlayerId {id u32}` (persistent, networked) is the account identity; `Owner.clientId` stays transient. Parties/clans live in a `GroupRegistry` (world data, not components): `{id, kind u8, members playerId→role u8, version}`, versioned binary `encode/decode`, and a bounded change log (`seq`, `changesSince(seq)` → deltas or `undefined` = resync, `apply` for client mirrors). `Membership {partyId, clanId}` and `OwnedBy {playerId, groupId}` components mirror it on entities.

## ADR-054: Generic permissions, area claims and zones
Gameplay defines action bits with `definePermissionActions`. `can(world, actor, target, action)` order: gameplay rules (allow/deny/no opinion) → `AccessList` (deny wins, then allow) → `OwnedBy` (owner player, group role ≥ `minRole[action]`) → claim at target position (owner group; `claimOutsiderMask`) → `defaultAllow`. `canAt` covers placement. `ClaimRegistry` buckets rect claims by 32-tile cells (chunk grid) for O(1) lookup; `zoneAt(x, y)` unions `ZoneFlag`s (Raidable, PvP, Safe, NoBuild).

## ADR-055: Damage pipeline; lag compensation stays in net
`DamagePipeline` with ordered `pre`/`mitigation`/`post` hooks over a `DamageEvent` record `{source, target, amount, type u8, tick}`, `DamageApplied` event, and `canDamage` (gameplay hooks → safe zones → optional PvP zone → shared party/clan unless `friendlyFire`). No Transform history in core: Netcode's `PositionHistory.getPositionAt` / `rangeCheckWithSlack` is the lag-compensation API.

## ADR-056: Container adapters and transactions over gameplay inventories
No core container component: gameplay's Inventory is canonical. Core defines `SlotContainer {capacity, getSlot, setSlot}` adapters registered per component (`scalarFieldsContainer`, `arrayFieldsContainer` helpers), a `maxStack` hook and validators. `Transaction` records undo per touched slot; `transaction(world, fn)` commits on ok, rolls back on failure/throw; `transfer()` is an atomic single move (merge/swap).

## ADR-057: Scheduler, timed job queues and recipe data
`Scheduler` = binary heap on (tick, seq), deterministic, not persisted (persist due ticks, re-arm). `defineJobQueue(name, cap)` array component {recipeId, startTick, endTick, count, state, remaining}; `JobQueues` arms one timer per head job (no per-tick work), with pause/resume/cancel (`onCancel` refund hook) and `rearmAll` after load. `@engine/assets` `loadRecipes` reads gameplay's recipes.json format as-is (+ outputs, unlocks, skill, tags) with StableIdRegistry ids; rules stay in gameplay.

## ADR-058: Chat data model and message-only strings
Channel kinds Global/Local/Party/Clan/Trade/Whisper/System; `ChannelRegistry` derives recipients from groups/proximity, validates (membership, mute, size, tick token bucket); `MuteList` (blocks + timed mutes, JSON). `writeString/readString` (varint length + UTF-8, max bytes) exist for message records only — never component schemas. Net owns transport.

## ADR-059: Server-side command handlers
`CommandHandlers.on(def, {permission?, validate?, handle})`; queued commands are processed in the input-phase system `commands` ordered by (actor, seq, arrival), skipped during replay; failures emit `CommandRejected {reason}`, success `CommandAccepted`. Complements net's transport-level `NetServer.onCommand`.

## ADR-060: Tile and building change records for replication
`Chunk.set` records `(index, old, new)` triples (only when the value changes) and registers the chunk with its owning TileMap; `tileChanges()` drains per chunk (sorted by key, with `version`), and evicted/unloaded chunks are forgotten. `encodeTileDelta/decodeTileDelta/applyTileDelta` give a compact wire form (u32 version, u16 n, n × (u16 index, u16 tile)), collapsing repeated edits. `BuildingGrid` mutations go through `place`/`remove`/`setHp`/`damage`, which record `Placed/Removed/Hp` changes drained by `buildingChanges()` (`recordChanges = false` for bulk loads). `world.setField` always marks dirty (via `ComponentStore.write`; covered by a test). Single consumer (net) drains once per tick.

## ADR-061: Async chunk providers
`AsyncChunkProvider.load` may return a Promise; `ChunkManager` accepts either. In-flight loads are tracked per key with a token: never requested twice, count toward `pendingLoads`, dropped (`stats.asyncDropped`) if the chunk leaves the keep set or is evicted before arrival, errors counted and retried on a later update. `settle()` awaits in-flight loads. The sync `ChunkProvider` type is unchanged, so existing callers (persist) are unaffected.

## ADR-062: encodeChunk fast path
Header, RLE tiles, height and buildings are written into a reused module-level DataView (no tuple/instance array allocation); the entity section still uses BinaryWriter. Format v1 unchanged and byte-identical to the previous encoder. 3000-piece chunk: warm 0.885 → 0.07–0.12 ms, cold 4.5 → 1.3–1.5 ms (box measurements).

## ADR-063: World.removeSystem
`world.removeSystem(name): boolean` removes a named system from all phases (tests, toggling debug systems). Requested by Netcode tests.

## ADR-064: Art pack is default content; placeholders are a fixture; typed schema additions
`packages/assets/pack/` (Art & Assets) is the default manifest (`DEFAULT_MANIFEST`, `fetchDefaultManifest`, `@engine/assets/node`); `sample/` stays in place as the placeholder test fixture (render's debug mount and Art's pack test reference it), with placeholder-specific assertions in `test/fixture.test.ts`. Added `lock:ids:pack`. Schema: optional `critter` category (`OPTIONAL_CATEGORIES`, so required-coverage checks don't break), typed `rotationArt` (mirror 1/2/4 rows with flipX derivation, unique4 = 4 rows), `building.states`, `sway`, and sound loop points. Pillar layer reconciled to 1 per INTEGRATION.md (fixture test fixed).

## ADR-065: Building piece state
`PieceInstance.state` (0..63) via `BuildingGrid.setState` (records `State` change) and `place(..., state)`. Stored in the chunk codec rot byte's upper 6 bits, so format v1 and persisted data stay compatible.

## ADR-066: Clan banners in GroupRegistry
`Group.banner {shape u8, pattern u8, colors [u32, u32], emblemId u16}` via `setBanner(group, banner|null)`, logged as a `banner` delta and saved in GroupRegistry format v2 (v1 still decodes).

## ADR-067: Height convention
`FLOOR_HEIGHT_LEVELS = 3`: one building floor = 3 terrain levels (16 px each, walls 48 px). Transform.z is terrain levels; BuildingGrid z is a floor index; helpers `floorToTerrainZ` / `terrainZToFloor`.

## ADR-068: Slot item state (durability, createdTick) and merge rules
`Slot` gains optional `durability` (u16, 0 = n/a) and `createdTick` (u32), carried by adapters (`arrayFieldsContainer {durability, createdTick}`, `scalarFieldsContainer {durabilities, createdTicks}`), `transfer`, swaps, `Transaction.add/remove/set` and rollback. Merges go through `ContainerRegistry.mergeMeta` (default `defaultMergeMeta`: count-weighted average createdTick, min durability). `maxStack(item, state)` sees the slot state; items with durability > 0 stack to 1 by default, and custom hooks passed to `installContainers` keep that unless `durabilityStacks: true`. Moving a whole stack onto a same-item slot that cannot absorb it now swaps the two slots (e.g. two tools) instead of failing; partial moves still fail with `stack_full`.

## ADR-069: World.isRegistered and recipe station ids
`world.isRegistered(def)` is public. `loadRecipes` auto-assigns stable station ids (`registry.stationIds`, "none" = 0, optional `stationLock`) when no station lookup is given; an explicit lookup stays strict. The batch-10 recipes test failure came from the test's own hard-coded station table (campfire/workbench only) and the move of recipe ids into gameplay's `ids.lock.json`. No data was missing.

## ADR-070: Atlas scale pages, generalized mask pages, sprite tints
Atlases get `pages: [{scale, image}]`, a list of resolution variants. A list of scales covers 1.5×/2×/3× and keeps `image` as the scale-1 page. `pickPage(atlas, dpr)` chooses the smallest scale ≥ dpr. `FrameRef` carries `pages`/`masks`; `AssetRegistry.scaled(ref, dpr)` resolves the rect. `masks {emissive?, sheen?, sway?, tintmask?}` generalizes emissive pages (UV-sampled, scale-independent); `emissive: boolean` remains as shorthand and `emissiveImage` as an alias. Sprites get typed `tints: Record<name, {color, strength, mode?}>` and `sway.mask`. The survival_fx `x_survival` block is a deprecated alias mapped by `applyLegacySurvival`, with warnings returned from `loadManifest`.

## ADR-071: Unified cross-device input (@engine/input)
**Decision:** A new client-only package with a DOM-free core (devices as string-path controls, JSON binding profiles per device class, a priority context stack with consume/passthrough/textEntry, interaction state machines, processors), a thin browser adapter, and a single sampling point per sim tick into core `InputState`. Gameplay-specific behavior comes in through hooks (autoTarget, aimAssist, contextAction, ghostSnap, holdCancel), so rules stay in gameplay.
**Why:** Keeps the sim deterministic and netcode unchanged, makes every feature Node-testable with FakeDevice/replay, and lets remapping and touch layouts be data.
**Alternatives:** Per-device ad-hoc listeners in the client (current state; doesn't scale to contexts or touch); framework-bound input (ties UI tech).

## ADR-072: InputFrame v2 (append-only)
**Decision:** Append a flags byte + optional q8 `moveX/moveY`, `aimMode`, q8 `ghostNudgeX/Y`, and u32 `edges` after the legacy layout; `INPUT_FRAME_VERSION = 2`, codecs take an explicit version so v1 peers still decode. Digital move bits are always set as fallback; hold bits keep gameplay's order and only append (Crouch, Charge); edges are pulses for one tick.
**Why:** Analog movement for gamepad/touch and explicit aim semantics without renumbering bits or command ids.

## ADR-073: Default input contract and glyph manifest
**Decision:** Ship Survival Systems' contract as `packages/input/profiles/*.json` (generated by `scripts/gen-profiles.py`) plus `defaults.ts` (actions, contexts, frame mapping, focus actions, touch layouts). Context actions are client events, not frame bits; PlaceCmd is only sent on PlaceConfirm. Prompt glyphs come from a manifest `glyphs` map keyed `kbm.*`/`gamepad.<layout>.*`/`touch.*`. Sprite tints gain `saturation` (default 1, applied before the color mode).
**Why:** Gameplay files are blocked this batch; data-first defaults are easy for gameplay to take over or override.

## ADR-074: Crafter attribution as a plain slot field + PlayerNameRegistry
**Decision:** `Slot.crafterId` is a u32 `PlayerId` (0 = none) stored as a plain per-slot component array, like `durability`/`createdTick`. Stacks merge only when item, crafterId and durability all match (`sameStack`), in core `Transaction` and in gameplay's own slot ops. Display names live in `PlayerNameRegistry` (seq + change log, binary encode/decode), and are resolved at display time.
**Why:** Netcode asked for it: one fixed-width field goes through the existing schema-driven net and chunk encoding with no side-table lifecycle (interning, GC, id remapping on load), and it is cheap (4 B/slot). Replicating names once per player keeps per-item cost at an id.
**Alternatives:** Interned metadata id + side table (more flexible for quality/signature, but needs its own persistence and replication; quality/signature can be added later as further optional slot fields or a side table keyed by a future `meta` value). Name strings on items (unbounded, goes stale on rename).
**Consequence:** Adding the field changes the Inventory/Container schema hash; persisted chunks need a migration or a fresh world (Netcode).

## ADR-075: Trade stalls as core primitives (TradeStall, atomicPurchase, SaleLedger)
**Decision:** Core provides a `TradeStall` component (listings + `revision`), permission-checked stock/withdraw/listing ops via `can()` with gameplay-supplied action bits, an atomic `buyFromStall`/`atomicPurchase` over `transaction()`, and an append-only `SaleLedger`. Ownership reuses `OwnedBy` (player or clan group). There are no balance rules.
**Why:** The purchase needs to be all-or-nothing across three containers, and rank checks should reuse the unified permission path. A revision counter lets net reject stale purchases cheaply.
**Alternatives:** Gameplay-only stall logic (each rule set would reimplement atomicity); escrow entities (more state, no gain over a transaction).
**Note:** Survival has gameplay-side `StallHeader/Listings/StallLedger` components in progress. They can either adopt `TradeStall` or keep theirs and call `atomicPurchase` + `can()` directly; core does not require its own component.

## ADR-076: Sprite attach points
**Decision:** Optional `attach` on sprites and `frameAttach[frame]` per-frame overrides (frame keys override sprite keys), resolved onto `FrameRef.attach`. Units are px offsets from the pivot at 1x scale; x is mirrored when `flipX` (`AssetRegistry.attachPoint`).
**Why:** Renderer needs stable anchors for stall display slots, price tags, name labels and vfx sockets without hard-coding per-sprite offsets.

## ADR-077: Two-tone clan tint via palette index, not tint2
**Decision:** Add manifest `clanPalettes` (primary/secondary pairs). `BuildPiece.tint` stays a u8 index (gameplay already stores it that way); the renderer maps tintmask R to primary and G to secondary. There is no `tint2` field.
**Why:** A single u8 per piece replicates and persists cheaply, keeps both colors consistent per clan, and lets a clan recolor by changing one index instead of rewriting every piece. A raw RGB `tint2` would double per-piece state and still need an index for UI pickers.
**Alternatives:** `tint2` u32 next to `tint` (free colors, but bigger and unsynchronized); deriving secondary from `tintSets.clan_secondary` (two parallel lists that can drift apart).

## ADR-078: Manifest schema batch for clan/raid art
**Decision:** Add mask file/size validation through injected IO (`validateAssetFiles`, so `loadManifest` stays browser-pure), per-rotation animation rows (`rotations`, with `<anim>_r1` kept as a fallback), `building.crackOverlay`, `building.stateVfx` (reusing ADR-076 attach points), vfx `stretch: velocity`, and an optional `decal` category with first-match autotile rules plus a required fallback. Everything is optional, and existing packs validate unchanged (pvp_clan fragment: 0 warnings, 0 file issues).
**Why:** These replace naming hacks and renderer-side conventions with validated data. First-match masked rules cover 4-way edges (16 tiles) and 8-way blob sets without a fixed tileset layout.

## ADR-079: ClaimRegistry encode/decode in core
**Decision:** `ClaimRegistry.encode()`, `static decode(bytes)`, `load(bytes)` (replaces the contents in place) and the read-only getter `nextClaimId`. Format v1 is byte-identical to persist's committed `claims` blob (magic "CLLM", u8 version, u32 nextId, u32 defaultFlags, u32 count, count × (u32 id, u32 ownerGroup, 4 × f64 rect, u32 flags, i32 priority)), so existing saves load unchanged and no migration is needed. Persist can drop its private-field fallback (`claimsNextId`) and the add/remove nextId trick and call these methods instead.

## ADR-080: Character customization as a cosmetic paper-doll component, separate from equipment
**Decision:** The manifest gets optional `bodyTypes`, `wearables`, `skinTones`, `hairColors` and `clothingColors` sections, loaded into `AssetRegistry.cosmetics` (a `CosmeticCatalog`, with its own `wearables` lock section). Core gets an `Appearance` component (networked + persistent): `bodyType` u8, `skinTone` u8, `version` u16 (wrapping change counter), `parts` u16×8 (0 = none), and `primary`/`secondary` u8×8 palette indices over the fixed slot order `WEARABLE_SLOTS` (hair, hat, accessory, top, bottom, shoes, face, eyes; new slots can only be appended). It also gets the pure helpers `defaultAppearance`, `validateAppearance` and `resolveLayers`. Core only sees a structural `CosmeticCatalogLike`, so core does not depend on assets. Gameplay armor can optionally name a cosmetic override (`equipCosmetic`) on item defs. That is documented here but not wired yet.
**Why:** A full look costs 42 bytes, uses palette indices (the same as clan tint, ADR-077) and validates on the server cheaply. Keeping cosmetics apart from equipment means a stat change never breaks how a character looks, and a cosmetic can never carry stats. The tintmask R/G channel convention is reused, so no new mask kind is needed.
**Version counter:** the Renderer caches `resolveLayers` output per entity, keyed by `Appearance.version`. Every writer must call `setAppearance(world, e, value)`, which writes the whole value and bumps `version` (wrapping u16). Direct `world.set` or `setElement` on Appearance is forbidden, because the cache would go stale. A per-component dirty bit wouldn't work here: it is cleared every tick and isn't available on clients after replication.
**Alternatives:** One entity per worn part (too many entities to replicate); raw RGB colors (bigger, and not pickable from curated lists); deriving the look from equipment (couples art to balance).

## ADR-081: Renderer contracts — StallDisplay, 1-based clan tint, buildPieceVisual, mergeManifests
**Decision:**
1. **StallDisplay** (core, `networked: true`, not persistent): `item` u16, `qty` u16, `price` u32, `currency` u16, each × `STALL_LISTINGS` (8), mirroring TradeStall listing rows slot-for-slot. No scope hook is registered, so net broadcasts it to every observer (listings are viewer-only data). It is optional: `addStallDisplay(world, e)` registers/adds/syncs it, and `syncStallDisplay(world, e)` copies TradeStall rows (marks changed only on a diff). `setStallListing`, `stockStall`, `withdrawStall` and `buyFromStall` call it automatically through the revision bump.
2. **Clan tint indexing:** `BuildPiece.tint` = 0 means no clan tint, and 1..N means `clanPalettes[tint - 1]`. Out-of-range values give no tint (no modulo). `BuildPiece.paint` overrides `tint` when it is not 0, using the same indexing. Implemented as `AssetRegistry.clanPaletteForTint(tint)`. `clanPalette(index)` stays 0-based on the raw array.
3. **buildPieceVisual(registry, piece, opts)** in `@engine/assets` is the only gameplay BuildPiece → render mapping. Inputs: `{type, rot, tint, paint, damageStage?, state?, level?}`, plus opts `{ghost?, pieceKey?}`. Output: `{visualId, rotation, damageStage, stateIndex, frame, crack?, level, layer, ghost, tintIndex, palette?}`. Uses manifest building defs (`building.piece`, rotation rows/flipX via `buildingFrame`, `states`, `crackOverlay` stage1..3, `layer`). It lives in assets because render already depends on assets, and gameplay can depend on assets (assets → core only), so there is no cycle. Core cannot host it because it needs the registry.
4. **mergeManifests(fragments, {strict?, resolve?})** in `@engine/assets` replaces render's `mergeManifestFragments` stub and the collision scan in Art's `validate_fragment.ts`. Every keyed array section (including wearables, skin/hair/clothing colors, palettes, decals, clanPalettes and unknown future ones) and the record sections (`glyphs`, `bodyTypes`) merge in order. The first definition wins, and every collision is reported as `{section, key, fragments}`. `strict` throws `ManifestMergeError`.
**Why:** The Renderer needs a stable, tested contract instead of local adapters. 0 is the natural "unset" value for a u8 tint, and modulo would silently give a clan the wrong colors.

## ADR-082: Cosmetics contract extensions (layers, 8 facings, frameMeta, expressions, tintNeutral, body defaults)
**Decision:** Optional extensions to ADR-080, all backward compatible: wearable `layers[]`; 8-entry or compass `layerByDir` with `directionIndex8`; sprite/animation `frameMeta` anchors with registry accessors (replacing `hands.json`); `faceAnims`/`expressions` plus a runtime `expression` option on `resolveLayers`; default `tintMode: multiply` with `tintNeutral` 0.78 and `out = base * mix(1, color/tintNeutral, strength)`; per-body `cosmeticDefaults` and `requiredSlots`; `displayName`/`locKey`; `outline: "body" | "none"` (booleans still accepted); UI widget types `charpreview` and `cosmeticslot` with `validateUiScreen`. See docs/CHARACTER_CUSTOMIZATION.md.
**Why:** The renderer already draws 8 facings, and Art needs multi-piece garments, per-frame hand anchors and expressions. With a neutral grey, an authored mask reproduces the picked color exactly. The Appearance wire format is unchanged (still 42 bytes).
**Known gap:** the render shader's multiply doesn't divide by tintNeutral yet, and its layer cache buckets by 4 facings. Those are Renderer follow-ups.
## ADR-090: Game modes and a deterministic ambient PopulationSpawner
**Decision.** `createGameServer({ mode })` takes `"singleplayer" | "multiplayer"`. `gameModeConfig(mode)` returns `{ mode, humanBots }`, and `humanBots` is true only in singleplayer. local.ts (the in-browser server) defaults to singleplayer. The Node server defaults to multiplayer (`--mode` / `GAME_MODE`). In multiplayer, no virtual-player host is installed, the human_bot spawn entry is filtered out, `markVirtual` is refused, and the local `bots` option is ignored. Ambient zombies, animals and bots come from one `PopulationSpawner` (in @engine/world). Its tables are data in gameplay/data/spawns.json (population.json was replaced; see gameplay DESIGN §22):
- density per loaded chunk, tile include/exclude lists, time-of-day weights, minimum and maximum player distance, and per-chunk and global caps
- spawning is blocked by unwalkable tiles, structures, the BuildingGrid and claims
- despawn beyond `despawnDistance` from every non-bot player, unless the entity is persistent
- `rngFor("pop:<kind>:<chunk>")` on a 2 s cadence

The legacy per-player zombie spawner turns itself off when population owns zombies (`PopulationZombies`).
**Why.** One mechanism with data in gameplay, and it is deterministic and testable. Multiplayer stays bot-free by construction rather than by convention.

## ADR-091: Human bots are virtual players driven by a data-driven agent framework
**Decision.** A human bot is a real player session: a loopback NetClient with its own replica, account (ClaimAccount derived from its identity) and name. It is driven by `AgentController` (@engine/core/ai), and its only output is `AgentOutput`. local.ts maps that to the same `Act` buttons, aim and chat a human sends. Bots never touch the server World. The framework provides:
- perception (sight cone, hearing, memory decay) and a blackboard
- utility behaviors with curves, traits and schedule bonuses
- a budgeted, round-robin think
- reaction delay, aim error, jitter, path wobble, idle pauses and look-around
- rate-limited templated chat with a pluggable `ChatProvider` (an LLM hook; the engine never calls external services)

Identity is persisted in the `agents` record namespace. Gameplay supplies `referenceBehaviors()`, and you add more with `survivorController({ extra })`.
**Why.** Bots go through the same authority, validation and anti-cheat path as humans, so whatever they can do, a human could have done.

## ADR-092: Bot commands use the human command path
**Decision.** `AgentOutput.commands` (`{ type: name, payload }[]`) is sent by the bot host through the bot's own `NetClient.sendCommand`, the same as human input. There is no server-side shortcut. Targets on the wire are network entity ids: agents reference replica entities, and NetClient's netId mapping translates them (unmappable targets are dropped client-side).
**Why.** One validation, rate-limit and rejection path for humans and bots, so a bot can never do anything a human client couldn't. Tested in apps/client/test/local.test.ts (refused buy: identical rejection).

## ADR-093: One shared AnimState in core
**Decision.** `AnimState` (const enum) and `ANIM_STATE_NAMES` live in @engine/core (anim.ts). Gameplay's `Anim` re-exports it, and the replicated `AnimState.anim` u8 keeps its values: Idle 0, Walk 1, Run 2, Attack 3, Hurt 4, Die 5, Gather 6, Build 7. New states are appended only: Eat 8, Graze 9, Shamble 10, Crawl 11, Feed 12, Sit 13 (vehicle riders, ADR-097). Hit and Death are aliases of Hurt and Die. Never renumber. Removed states keep their slot.
**Why.** Gameplay, render and AI used separate numberings. One append-only table keeps the wire format unchanged and gives every package the same ids and names.

## ADR-094: Browser-hosted P2P multiplayer over WebRTC data channels
**Decision.** A player can host a session in their browser tab ("Multiplayer → Host game") and others join by room code ("Join with code"). The dedicated WS server path is unchanged.
- **Transport split.** The protocol (v7, unchanged) runs over two RTCDataChannels per guest: a reliable/ordered channel for handshake, commands, chat and reliable events, and an unreliable/unordered channel (`maxRetransmits: 0`) for snapshots/input, mapped onto the existing `Channel` ("reliable" | "unreliable") of `ClientTransport`/`ServerTransport` (`RtcClientTransport` / `RtcServerTransport`, packages/net/src/transport/rtc.ts). Unreliable sends are dropped while the channel is not open or `bufferedAmount` > 64 KB (snapshots supersede each other). With PeerJS the reliable channel is the connection's own (`reliable: true`, raw serialization) and the unreliable one is negotiated on the same RTCPeerConnection (`negotiated: true, id: 7`), so there is one ICE negotiation per guest.
- **Host-authoritative.** The host runs `createLocalServer` in mode `"multiplayer"` (human bots off, animals + zombies on). Its own loopback client and the RTC guests are merged by `MultiServerTransport` into ONE NetServer, so guests get exactly the Node server's validation, rate limits, `entityRefs: "aoi"` scoping and dev-bot rejection. The host is trusted (it is the server).
- **Signaling** is behind a `Signaling` interface (apps/client/src/p2p.ts). The default `PeerJsSignaling` uses the free PeerJS cloud broker (lazy-loaded `peerjs` chunk); a Cloudflare Worker (or any broker) can implement `host(peerId)` / `join(code)` instead. ICE: public Google + Cloudflare STUN by default; TURN is a hook: `VITE_ICE_SERVERS` at build time or `?ice=<JSON RTCIceServer[]>` at runtime replaces the list.
- **Room code.** 6 chars from `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (no 0/O/1/I/L), ~887M codes, shown as `ABC-234`; input is normalized (case, dashes, spaces) and rejected if it has a character outside the alphabet. Peer id = `survivaz-v7-<CODE>` (namespaced by game + protocol version so incompatible builds can't meet). A taken id is retried with a new code.
- **Cap.** Including the host: 6 on a mobile host (`pointer: coarse` or `navigator.userAgentData.mobile`), otherwise the Settings value (default 12, clamped 2–32). Extra joins are rejected by NetServer with `ServerFull` and the detail "the host's game is full (N players max[ on a mobile host])", which the guest sees on the menu.
- **Host leave.** End session / tab close sends an empty reliable frame ("bye") to every guest before closing; guests surface "Host ended the session" and return to the menu (a dropped link without a bye reads "lost connection to the host"). The host saves the world through the browser WorldStore (IndexedDB, `engine-p2p-host-<slot>`) on leave and best-effort on `beforeunload`/`pagehide`.
- **Tests** run the whole thing over `FakeRtcNetwork` (paired fake data channels with seeded loss and reorder on the unreliable channel); no real WebRTC in CI.
**Security notes.** The host sees guests' IPs (inherent to P2P; TURN-relay-only would hide them). Room codes are capability-less: anyone with the code can join, up to the cap; codes are not guessable at scale but are not secret auth. Guests trust the host completely (it can cheat); this mode is for friends, the dedicated server remains the competitive path. Guest input is untrusted and goes through the standard NetServer validation and rate limits. The PeerJS cloud is a shared third-party broker: it sees peer ids and SDP (not game data, which is DTLS-encrypted end to end).
**Why.** GitHub Pages can't run a server; a browser host gives multiplayer with zero infrastructure while reusing the exact server code, and the transport/signaling interfaces keep a later move to our own Worker/TURN a config change.

## ADR-095: One UI root for fullscreen, touch-action:none, and a shared menu focus layer

**Context.** On Android Chrome the joystick/buttons died in fullscreen and the stats HUD overlapped the touch controls. Overlays and dialogs were appended to `<body>`, the canvas lacked `touch-action:none` (Chrome fires `pointercancel` as soon as it decides a drag is a pan, killing the joystick pointer), and controls weren't re-laid out on `fullscreenchange`. In-game menus were only reachable via touch-layout buttons with no keyboard/gamepad navigation.

**Decision.**
- `#game-root` (`apps/client/src/ui-root.ts`) holds the canvas, HUD, P2P overlay, touch overlay, menu bar and every modal; all client UI mounts through `mountUi()`. `fullscreen.ts` requests fullscreen on this root (`fullscreenTarget()`), never on the canvas or `<html>`.
- `attachBrowserInput` sets `touch-action:none`/`user-select:none` on the element, re-measures and resets virtual controls on `fullscreenchange`/`orientationchange`, and takes safe-area `insets`.
- The HUD is compact and anchored top-left at `env(safe-area-inset-*)`; the P2P chip is top-centre; the DOM menu bar is top-right, so the layout's top-row virtual buttons are dropped.
- `UINav` (`ui-nav.ts`) is the single focus/navigation layer for all modals: a modal stack that pushes the `Dialog` input context, Tab trap, arrows / D-pad / left stick spatial movement (`FocusManager`), Enter/Space/A confirm, Esc/B back, Start (or Esc with nothing open) pause, per-menu hotkeys. `GameMenus` builds inventory, crafting, build, character, party, clan, trade, chat, settings and a pause hub with **Quit to main menu**, which exits fullscreen and ends the session.

**Consequences.** Every menu is usable by touch (44px targets), gamepad and keyboard+mouse. New UI must mount via `mountUi()` and open dialogs via `UINav.open()`. Menu bodies are currently shells until the gameplay UIs land. Covered by jsdom tests in `apps/client/test/ui-nav.test.ts`.

## ADR-096: Data-driven vehicles in the shared sim
**Decision.** Vehicles (bicycles, cars, trucks, vans, campers, semis, trailers) are entities that carry `Vehicle`, `VehicleSeats`, `Hitch` and the existing `Container`. Riders carry `Driver`. All four components are appended after `ClanStatus`. Defs live in `packages/gameplay/data/vehicles.json`; `defId` = index + 1, append only, and the defs hash is salted into the world schema hash. `gameplay.vehicles` runs on every peer: an arcade kinematic bicycle model with drift, footprint collision through `movementBlocked`, and trailer pin joints solved parents first. Riders steer with the same move axes and Sprint as walking. Enter, exit, hitch, unhitch and station use are validated commands on the ADR-092 path. Camper stations work only while parked (|speed| < 0.25), through `addVehicleStationHook`. Spec: docs/VEHICLES.md.
**Why.** One input path means bots and every device drive the same way. Storage reuses Container, so open, deposit, withdraw and persistence need no new code. Running the same deterministic sim on server and client keeps prediction possible. Data-driven defs let Survival and Art add variants without engine changes.
**Consequences.** Container's 24-slot cap limits slot scaling, so maxWeight carries the size difference (lifted by ADR-098). World schema hash: 0x7c9a353e (default install).

## ADR-101: Vehicle render follow-ups: Sit, data anchors, replicated toggles
**Decision.**
- `AnimState.Sit = 13` is appended in core (ADR-093 table). `gameplay.vehicles` sets seated riders to Sit; `exitVehicle` restores Idle.
- Seat anchors (`seatAnchors[]`, one `{x, y, z}` per seat) and hitch anchors (`hitches[].anchor`, x = ±offset) live in `vehicles.json` and its schema, validated by `validateVehicleDefs`. Values were ported from render's computed layout; render's `seatAnchors`/`hitchU` read the defs and keep the formula as `defaultSeatAnchors` fallback.
- Engine and headlights are bits of a new 1-byte component `VehicleState {flags u8}` (networked, persistent, appended after `VehicleCondition`), added to powered vehicles only. It is a separate component instead of a field on `Vehicle` so the byte goes on the wire only when toggled, not with every moving-vehicle delta. Toggled by `gameplay.vehicleEngine` / `gameplay.vehicleHeadlights` `{target, on}` (0 off, 1 on, 2 toggle), driver only (`not_driver`, `no_engine` on bicycles, `wrecked`, `bad_value`), registered after `VEHICLE_CRAFT_COMMANDS`. The flags are presentational for now: they do not gate driving or fuel.
- `Vehicle`, `VehicleSeats`, `Driver`, `Hitch`, `VehicleState` are listed in `GAMEPLAY_REPLICATION` with scope "all", so `Vehicle.heading` of trailers reaches every client in AOI (tested through a snapshot round trip).
- `localPlayerVehicle(world, playerEid)` returns the ridden vehicle's NetId or null (render cutaway).
- Assets: `vehicle` is an optional sprite category; render's debug vehicle pack uses it.
**Why.** Render asked for these (packages/render/docs/VEHICLES_RENDER.md); data anchors let Art tune seats without code, and a separate flags component keeps bandwidth flat.
**Consequences.** World schema hash (default install): 0x029aeedf (was 0x23146301). Old clients can't connect. Vehicles from older saves have no `VehicleState`; the first toggle adds it (flags 0 until then).

## ADR-102: Vehicle netcode: driver prediction, hitch-frame trailers, speed AOI, P2P distant throttle
**Decision.** The seat-0 driver predicts its vehicle and trailer chain (`NetClientOptions.controlled`, with `w.simulate` replay) using the server's input function (`applyDemoInput`). Corrections over 2 tiles snap. Everyone else interpolates with a 4-tick delay, and the render clock holds instead of running backwards. Remote hitched trailers are posed on the tow's interpolated pin (`afterInterpolate`). The AOI bonus scales with vehicle speed (thresholds 8/16 up and 6/13 down, max 2 chunks, holdTicks 60). Vehicle commands get AOI entity references, per-command rates and appended reason codes, and `gameplay.vehicleGuard` (appended to GAMEPLAY_SYSTEM_ORDER) reverts and reports impossible moves. NetId lookups use an O(1) cached map (`netIdEntity`). The P2P host sets `distantThrottle { nearTiles 24, interval 3 }`.
**Why.** Vehicles move 2–4× faster than players, so unpredicted driving feels laggy, and a smoothed slide after a big correction is worse than a snap. Trailers interpolated on their own drift off the pin. A mobile host has to send to 5 guests: the throttle cuts the guests' mean snapshot from 846 B to 353 B (677 to 282 kbit/s of uplink) in the 8-vehicle test.
**Consequences.** Remote entities render 200 ms behind, up from 100 ms. Vehicles have no permission system (the spec has none). Netdefs hash changes because vehicle commands and reasons are appended. Adding the guard system changes GAMEPLAY_SYSTEM_ORDER. Admin teleports of a driven vehicle must pass `installVehicleGuard(..., { allow })`.


**ADR-102 addendum: vehicle command wiring.** GAMEPLAY_NET_COMMANDS appends, after ReloadCmd/WearCmd (net ids 37/38): vehicleEnter 39, vehicleExit 40, vehicleHitch 41, vehicleUnhitch 42, vehicleStation 43 (4/s, burst 8), then vehicleDeploy 44, vehicleRefuel 45, vehicleRepair 46 (2/s, burst 4); demo.devBot shifts to 47. `target` (and hitch `tow`) are NetId entity fields in INPUT_ENTITY_FIELDS, so they are validated under aoi. Dispatch goes only through `handlers.enqueue` (none are in INPUT_QUEUE). Range checks live in the gameplay validators (too_far / actor_too_far), so the server adds none. Crafting reject reasons are appended to COMMAND_REJECT_REASONS: empty_slot, not_kit, no_tank, not_fuel, wrong_fuel, not_repair_item, wrong_part, needs_garage.

## ADR-104: Modular building: triangle/vertex placement, tiered art keys, raid multipliers
**Decision.**
- **Pieces.** Art's piece set (assets/building/KEYS.md) is added as append-only pieces, ids 52–67 in ids.lock.json.
- **New placement.** `Placement.Tri` (=4) places triangle pieces at the exact centroid, with 12 rotation steps and deterministic edge snapping. Corner walls are free pieces snapped to vertices.
- **New piece fields.** Pieces can set `family`, `minTier`, `extraCost` and a `maxSlope` override.
- **Raid multipliers.** Tiers carry raid multipliers for melee, explosive and fire. `damagePiece(cause)` scales player and fire damage (zombie damage is unscaled). `installBuildingRaidRule` denies explosives when the multiplier is 0.
- **Persistence.** STRC v4 adds f64 x/y for triangle pieces; v1–v3 still decode.
- **Sprite keys.** The key is `<piece>@tier<N>` (twig and untiered pieces use the bare key). Damage is drawn with the `bld_crack` overlay anims `stage1..3`, not with a key suffix.
- **One `pieceVariantKey`.** The overloads `pieceVariantKey(def, variant)` and `pieceVariantKey(defs, piece)` are unified in building/modular.ts, and stall_display re-exports it.
- **Floor height.** `building.levelHeight` is 3 so it matches @engine/world `FLOOR_HEIGHT_LEVELS` (48 px floors).

**Why.** Art shipped the tiered set with keys baked against the existing render lookup. levelHeight=2 had stacked floors at 2/3 of the art height.

**Consequences.**
- Floor z placement changes. Old saves store slot z in levels, so their upper floors re-seat at the new height.
- Missing art: foundation_ramp and floor_triangle.
- The renderer still draws triangle rotation at quarter turns.
- Net commands, components and the schema are unchanged.

## ADR-098: Per-instance Container capacity up to 96 slots, paged UI, grown-array migration
**Decision.** `Container` arrays (`items`, `counts`, `createdTick`, `durability`, `crafterId`) are `CONTAINER_MAX_SLOTS` = 96 wide; `CONTAINER_SLOTS` is kept as a deprecated alias. Capacity stays per instance in `slotCount` (u8), set from the def: piece `container` (validated <= 96), bag sizes, and vehicles through `storageCapacity`, which scales vehicles.json `storage.slots` by class with `packages/gameplay/data/vehicle_storage.json` (scale and per-class max: bicycle <= 6, car 18, van 40, truck 48, camper 48, semi 16, trailer 96; semi_trailer_box = 96). Vehicle `maxWeight` is unchanged, so weight still binds first. Replication is unchanged: net's element-level Change records (sparse index list for wide components) already send only the changed slots; a one-slot change on a full 96-slot box is 19 B against a 1403 B spawn (apps/server/test/container_bandwidth.test.ts). Persist gains `AddedFields.grown` (old array lengths): old rows are copied element by element and the tail is zero-filled; `CONTAINER_96_MIGRATIONS` (24-wide, with and without crafterId) are in `DEFAULT_MIGRATIONS` for chunk rows and player records. The inventory panel shows the open container as pages of `CONTAINER_PAGE_SIZE` = 24 focusable slots with ◀ ▶ buttons (touch), PgUp/PgDn (keyboard) and LB/RB (gamepad, `UINavOptions.onPage`); slot keys are stable so the morph refresh patches only changed slots.
**Why.** ADR-096 noted the 24 cap forced weight to carry all vehicle size difference. Growing the one component keeps open, deposit, withdraw, viewers scope and persistence on one code path instead of a second "big container" component. Element deltas make width nearly free per tick; slotCount keeps small boxes small in play.
**Consequences.** Each Container row is 4x wider in memory and on disk (~1.3 KB vs ~340 B), and a Spawn record sends every element: opening a box (viewers scope) costs ~1.4 KB once. Asked Netcode for a zero-run or slotCount-bounded spawn encoding. Old saves load through the migration; ids unchanged (no component added). World schema hash: 0x6b564b26 (was 0x029aeedf, ADR-097).

## ADR-099: Players can delete their progress (local saves, hosted worlds, dedicated-server data)
**Decision.** The main menu has a **Delete progress** button next to Singleplayer and Multiplayer. It opens a picker of what this device stores, with checkboxes for Singleplayer world (`engine-local-<slot>`), Hosted multiplayer world (`engine-p2p-host-<slot>`), Character/appearance (player rows in both DBs), Bot memories (`agents` records), Settings (`engine-settings`, `engine.input.bindings`) and Delete everything, which also forgets the slot's account token, name and server. Each row shows counts, size or last-played time when known (`engine.lastPlayed.<mode>.<slot>`). Listing never creates a DB. In-game Settings has **Delete save** in singleplayer: it stops the local server, closes the DB and then deletes it, and keeps settings unless the player opts in. It has **Delete hosted world** for P2P, which is refused while hosting. It has **Delete my progress** on dedicated servers. Every delete must be confirmed by typing DELETE or by holding a button for 1.5 s with pointer, touch, Enter/Space or gamepad A. One tap never deletes. Blocked IDB deletes tell the player to close other tabs. Dedicated servers accept `account.deleteMyProgress` with confirm `0xde1e7e`, rate-limited to 1 per 30 s, only from the caller's claimed session. The server removes the caller's player row (`deletePlayers` on all WorldStores) and leaves party and clan, passing leadership to the next member. Buildings are abandoned (`OwnedBy.playerId` cleared, group kept) and stalls are unowned and closed. Bot memories of the player are forgotten. The client gets `ProgressDeleted`, is kicked, and reconnects to the character creator. The token is kept and maps to a fresh PlayerId.
**Why.** It gives players a clear right to erase their data without breaking shared state for others in groups or towns.
**Consequences.** `SaveBatch.deletePlayers` is part of the persist contract (memory, SQLite, IndexedDB). P2P protocol prefix bumped to `survivaz-v8-`.

## ADR-100: Wider default gameplay camera with persisted user zoom
**Decision.** The default camera zoom drops from 1.6 to 1.6/√1.3 ≈ 1.40, so the view shows about 30% more area on desktop. Viewports with a short side ≤ 480 CSS px use 1.5, blended linearly up to 800 px, so phones zoom out less and sprites stay readable. On top of that, a user multiplier (0.75–1.6) is controlled by mouse wheel, two-finger touch pinch on the canvas and +/- keys. It is saved as `zoom` in `engine-settings`; settings saves merge so the value survives. Gamepad bumpers are *not* bound because they already rotate in Build mode (`apps/client/src/camera-zoom.ts`).
**Why.** Players asked for more situational awareness. Phones need a closer camera than desktops to keep characters legible.

## ADR-103: Sparse Spawn bodies for wide components (protocol v8)
**Decision.** In a Spawn record, each present component with more than 8 wire elements (fixed-length array fields expanded) is prefixed by one bit: 1 = sparse body (`varuint k`, then k × `varuint gap, value` for the non-zero elements; the rest decode as 0), 0 = the old dense body. The writer picks whichever is smaller, so the worst case costs one extra bit. Components with ≤ 8 elements and all Change records (element masks, sparse indices, and the full body of a newly added component) are unchanged. PROTOCOL_VERSION 7 → 8; the P2P peer prefix is already `survivaz-v8-` (ADR-099), and mixed builds are rejected by the Hello protocol version.
**Why.** ADR-098's 96-slot Container made every box open cost ~1.36 KB of Spawn body, mostly zeros. The Hello schema hash only covers component schemas, not the record codec, so the codec change needs a protocol bump to reject mixed builds.
**Consequences.** Container Spawn body (component only): empty 96-slot box 1359 B → 17 B; 4 occupied slots 72 B; full box 1360 B (dense fallback). Viewer scope and AOI unchanged. Tests: packages/net/test/spawn-sparse.test.ts.

## ADR-105: Non-render performance for singleplayer (bot LOD, cheaper replicas, server in a Web Worker)
**Decision.** (1) Singleplayer runs `createLocalServer` (sim, population, virtual-player bots, IndexedDB persistence) in a dedicated Web Worker (`apps/client/src/local-worker.ts`, bridged by `local-bridge.ts` with a postMessage `ClientTransport`; the cosmetics catalog crosses as a plain `CatalogSnapshot`). It falls back to the old in-tab server when `Worker` is missing, with `?worker=0`, or when the worker fails or does not report ready within 15 s. P2P hosting stays in-tab (its RTC transports live on the main thread). (2) Virtual-player bot replicas use `NetClient({ interpolate: false })` (no interpolation buffer; bots read the latest state) and a per-client distant-entity throttle (`NetServer.setDistantThrottle`, bots: 24 tiles / every 4th tick). (3) Bot perception LOD: bots more than `AGENT_LOD_NEAR` (40) tiles from every human reuse a cached world view, refreshed every `AGENT_LOD_EVERY` (4) ticks on a staggered phase; their own self state (`buildAgentSelf`) is fresh every tick. Lookups that scanned arrays (bot by agent, server entity by client) now use maps. (4) `NetClient.writeComps` writes typed arrays directly through a cached per-component plan. `ComponentStore` tracks a dirty word range so `clearChanged` / `changedIndices` only touch words that can be set. (5) `World.profiler` is an optional per-system timing hook (off by default), used by `apps/client/perf` (headless profiler: `tsx perf/run.ts --seconds 60`).
**Why.** Profiling a headless 60 s singleplayer session (32 bots, vehicles, population) showed most of the frame time was outside the server sim: bot replica `applyState`/`writeComps` ~54%, interpolation ~11%, `buildAgentView` ~11%, GC ~12%. On phones all of that ran on the render/input thread.
**Consequences.** Measured on the dev box, 60 s, 32 bots, run one after the other: total 134.8 → 104.4 ms/tick (−23%), bots side 114.2 → 81.4 ms/tick (−29%), GC 6352 → 3321 collections (17.1 → 13.1 s). Server sim is unchanged within noise (17.4 → 19.5). In the browser, all of this except the player's own client (~3.5 ms/tick) now runs off the main thread. Far bots react to world changes up to 3 ticks (150 ms) late. Bot replicas no longer interpolate (they never render). Tests: apps/client/test/local_worker.test.ts (worker bridge in-process, fallback, catalog round-trip), apps/client/test/perf_budget.test.ts (short session under a generous `PERF_BUDGET_MS`, default 400 ms/tick, about 10× the measured cost), packages/core/test/dirty_range.test.ts.
**Update (round 2): direct local bots, device-scaled bot cap.** (6) Local bots no longer run a `NetClient` + replica `World` + per-bot `FixedLoop`. Each is a `DirectClient` (`packages/net/src/direct.ts`) on its own loopback connection: Hello / Input / Command / Chat are still real wire messages decoded by `NetServer.onMessage`, so ADR-092 validation, the command token bucket and gameplay handlers are unchanged (a bot refused buy is rejected exactly like a human's). After Welcome, `NetServer.setDirect(clientId)` marks the session direct: `replicate` skips encoding snapshots for it, and events and pings skip it. It stays an interest-grid viewer, and entity refs in its commands must be alive and inside its AOI (`interest.covers`), or the command is refused. Perception reads the authoritative `game.world` read-only through the bot's server entity. `buildAgentView` takes optional `candidates`: one spatial hash per agent tick (24-tile cells, 3×3 lookup, which covers sight 12 / hearing 18), so a view no longer scans every entity. Sight and hearing filtering are unchanged. Inputs are sent once per agent tick (20 Hz, the server rate). (7) `LocalServerOptions.maxBots` caps live virtual players (initial `bots` plus population-spawned human bots). The default is `defaultMaxBots()`: `MOBILE_MAX_BOTS` = 8 on mobile (coarse pointer or UA mobile, the `detectDevice` used for the P2P host cap) and `DESKTOP_MAX_BOTS` = 32 elsewhere.
**Why.** At 20 Hz (`DEFAULT_TICK_HZ`) the budget is 50 ms/tick. After round 1, bots were still 81 ms/tick, mostly from decoding their own snapshots. Server-sim p95 of ~40 ms came mostly from `replicate` encoding 33 snapshots per tick plus the GC that caused.
**Consequences.** Dev box, 60 s, 32 bots, sequential runs: total 104.4 → 16.9 ms/tick, bots 81.4 → 8.4, server sim 19.5 (p95 40.2) → 6.2 (p95 11.4), GC 3321 → 1085 collections (13.1 → 1.5 s). Bots now see the exact authoritative state (no replica latency), but only what their sight and hearing allow. `seen` ids are server entities, mapped to netIds on send. Phones run at most 8 bots by default. Tests: apps/client/test/direct_bots.test.ts (no snapshots to direct sessions, bots still move via inputs, maxBots cap, device default) plus the existing local.test.ts refused-buy parity test.


## ADR-106: Four per-seed spawn points, blank-slate world, 1-hour day
**Decision.** (1) `computeSpawnPoints(generator)` (`packages/world/src/spawnPoints.ts`) picks four points per seed, one per quadrant, 48..144 tiles from the origin, on grass (fallback: other land tiles), each the centre of a 5×5 grass patch with no generated resource nodes. The quadrant scoring pushes them outward so they end up far apart. Gameplay stores them as a world resource (`setSpawnPoints` / `spawnPoints(world)` in `packages/gameplay/src/spawn_points.ts`). `pickSpawnPoint` picks the least-crowded point (live survivors within 24 tiles, rng tie-break), with ±2 tile jitter. The point is used by client joins (singleplayer, P2P host and dedicated server all run `createGameServer`), by PvP respawn when there is no bed or claim (the `setRespawnLocator` hook is still checked first), and by PopulationSpawner human bots. Those bots ignore their rolled position and spread over the 4 points; they are marked persistent so the spawner does not despawn them while they are away from viewpoints. Chunks are pre-warmed around all four points. `GameServer.spawnPoints` exposes them, and `?diag` prints them (for the URL `?seed=`, default 1234). `GameServerOptions.spawnPoints` overrides the list; tests that need co-located players pass `[SPAWN]`. (2) The starter camp (`apps/server/src/camp.ts`, structures at 19,8) is removed. Worlds start blank. Resources, animals and zombies still come from the generator and population. `randomAppearance` moved to `apps/server/src/appearance.ts`. (3) `environment.json` `dayLengthSeconds` 1200 → 3600 (72 000 ticks at 20 Hz). The client fallback is updated to match.
**Why.** The owner asked that players and AI humans not all spawn in one spot, for a blank-slate world, and for one in-game day per real hour.
**Consequences.** Rate review: hunger, thirst, spoilage and weather are defined per real second (vitals.json), and nothing is defined per day (no crops or daily timers), so no rates changed. Day and night phases (and the zombie night) each last 3× longer in real time. The time of day is not persisted, so no migration is needed. Old saves keep any camp structures they already have. Dev bots in local play start at the spawn points. Tests: packages/world/test/spawn_points.test.ts, packages/gameplay/test/spawn_points.test.ts, apps/server/test/spawn_world.test.ts (blank slate, spread, 72 000-tick day, HUD clock), plus existing multi-player tests pinned to `[SPAWN]`.

## ADR-107: Mobile-scrollable menus, Back everywhere, dawn start, punching, death/respawn, swimming, bare-hand gathering
**Decision.** (1) Every panel/modal (`.gm-panel`, `[data-modal]>*`, delete-progress, `#p2p-overlay`, boot `.panel`, settings, pause, main menu) is capped at `calc(100dvh - safe-area top/bottom - 16px)` (100vh fallback) with `overflow-y:auto; -webkit-overflow-scrolling:touch; touch-action:pan-y; overscroll-behavior:contain`; rules live in `ui-root.ts` (inside `#game-root`, so fullscreen too) plus `game-menus.ts`/`menu.ts`/`p2p-overlay.ts`. Touch input listeners are on the canvas only, so panels' scroll gestures are not swallowed. UINav and the boot menu focus via `focusVisible()` (focus + `scrollIntoView({block:"nearest"})`). (2) UINav is the menu stack: any modal without `[data-role=close|back]` gets a "← Back" button; Esc, gamepad B, the Back button and Android/browser back (`popstate`, one sentinel history entry kept by `BackHistory` while the stack is non-empty) all close the top entry; the boot menu uses the same for its sub-screens and the delete-progress screen gained an explicit Back. (3) `environment.startTimeOfDay` 0.25 → 0.3 (07:12, early daylight). The day-clock epoch (`TimeOfDay.epochTick`) is now persisted as `WorldMeta.dayEpochTick` and restored on load (`restoreDayClock`), so every world keeps its time across reloads; pre-ADR-107 saves without the field fall back to the legacy 0.25 start. (4) Unarmed punching: the human Act (tap/A/E/click) first targets the nearest live zombie/animal within fists range (`nearestMeleeTarget`) and sends an Attack intent through the existing combatSystem/applyDamage path (FISTS damage, range, cooldown), else falls back to gathering. Swings set `AnimState.Punch` (fists) or `Attack`; players get AnimState lazily and `gameplay.animSettle` returns player one-shots to Idle after 8 ticks. (5) Root cause of "zombies can't kill players": verified the damage→Dead→Died→respawn chain is correct and covered it with tests (night zombie kills an idle player; respawn at the ADR-106 points leaves the player alive, Idle, intent cleared and able to move). (6) `AnimState.Swim = 14`, `Punch = 15` appended (wire-stable u8, ADR-093). `movement.swimTiles` [water] lets players enter water at `swimSpeedMul` 0.4; zombies/animals move at that multiplier on water; AI pathing (`unwalkableTiles`) is unchanged. animSettle and the client view switch locomotion anims to Swim on water. The renderer uses `swim` frames when the atlas has them (fallback swim→walk→idle; punch→attack→idle); without them it clips the lower 45% of the sprite and bobs it (new per-instance `aJ` attribute, INSTANCE_FLOATS 36→40). (7) Bare-hand gathering (`resources.json` `bareHands`): nodes needing a tier ≤ `maxMinTier` 1 axe/pickaxe/shovel can be hit without the tool for `max(minYield 1, floor(roll × yieldMul 0.25))` of the primary drop only, with `cooldownMul` 2× and no tier bonus; higher tiers still fail with WrongTool.
**Why.** Owner requests (mobile usability, consistent back navigation, starting in daylight, a way to fight and gather when unarmed, water traversal).
**Consequences.** Component schema hash unchanged (46f005fc): AnimState's field type is the same; only enum values were appended. Art needs `swim` (8 dirs × ~6 frames) for player bodies/paper-doll layers, zombies and animals, and `punch` (8 dirs × ~4 frames) for player bodies/layers; until then the fallbacks above render.

## ADR-108: Night light-avoidance, Snuffer zombie, fuel tiers + station fuel UI, defensive structures
**Decision.** (1) A cheap spatial light grid (`systems/lights.ts`: lit Light emitters + vehicle headlights, bucketed into `lightAvoid.gridCell`-tile cells, rebuilt every `rebuildTicks`) drives `shyGoal` in the zombie AI: during `lightAvoid.phases` (night, dusk) normal zombies leave lit radii and, when their next step would enter one, pace tangentially at the dark edge (direction flips every `paceSeconds`). Fire going out → they close in. (2) `zombie_snuffer` (blue tint, `light.ignoresLight/targetsLights`) seeks the nearest light within `seekRange`, then on each attack either extinguishes it (`extinguishChance`, `snuffFire` → `LightSnuffed`) or damages the piece / vehicle (`snuffDamage`). Uses existing Walk/Run/Attack anims. (3) Fuel is data-driven `fuelSeconds`: wood 20 s, coal 60 s, crude oil 120 s; lantern is now fired (needs fuel). Inventory panel shows a Fuel section on any fired container (status + time left via `fuelSecondsLeft`, Light/Put out toggle on pad X, one button per pack fuel item) built from `fuelView`/`toggleFireIntent`; plain focusable buttons so touch, gamepad and keyboard/mouse all work. Crafting at a fired station already requires it lit, so queued jobs pause when fuel runs out; Fuel/Container persist. (4) Defenses (`combat/defenses.ts`, new append-only `Defense` component {readyTick, owner, target}): `barbed_wire` (contact slow + dps), `spike_trap`, existing `barricade_spiked` as spike wall, `bear_trap` (damage + root, re-arms), `arrow_turret`/`bolt_turret`/`flame_turret` (ammo pulled from the piece's own storage, flame may ignite). Turrets always target zombies; players only when the raid rule (`setRaidRule`) allows, never the owner, same tribe, owner's party or clan. New `DamageCause.Turret/Trap`.
**Why.** Owner request: make night defence about light, fuel and structures.
**Consequences.** Schema hash 46f005fc → 85da6c05 (appended `Defense` component only). No new AnimState values. Art: `zombie_snuffer` full set (idle/walk/run/attack/hurt/death/swim, 8 dirs), turret sprites with aim + fire FX (arrow, bolt, flame jet), trap armed/sprung states (bear trap, spike trap), barbed wire, lantern lit/unlit, fuel icons wood/coal/crude_oil.

## ADR-109: Vehicle keys
**Decision.** Deploying a crafted vehicle kit locks the vehicle (new append-only `VehicleLock` {keyId, owner, issued}; keyId is a stable per-world id, max+1) and gives the deployer a `vehicle_key` item (maxStack 1) whose slot `crafterId` holds the keyId — the item's instance data, so it syncs through the existing owner-only Inventory/Container replication, persists with the slots, and keeps its binding when stored, traded, looted or dropped in a death bag (`moveSlotTuples` carries crafterId). Tooltip shows a short code (`keyCode`, e.g. `K-3F9A`), or "vehicle destroyed" once the vehicle entity is gone (the key opens nothing). `validateEnter` requires the matching key in the actor's Inventory for seat 0 (auto-seat 255 skips the driver seat without it); `validateVehicleToggle` requires it to switch the engine on; passengers need none. New reject reason `no_key` appended to COMMAND_REJECT_REASONS. AI humans drive through the same command path, so a bot holding the key can drive. Legacy vehicles (no VehicleLock) are migrated by `keyIssueSystem` (authority, every 20 ticks from vehicleSystem): crafted ones (VehicleCondition.crafterId) lock and their key is handed to the owner when that player is present (`issued` flag, once); world-spawned ones get keyId 0 and stay open.
**Why.** Owner request: vehicles should be theft-able only by taking the key.
**Consequences.** Schema hash 85da6c05 → 9230b2f4 (appended `VehicleLock`). No new AnimState values. Art: `vehicle_key` icon.

## ADR-110: Wildlife, farming, flora and ground clutter

**Context.** The world needed more to hunt and gather, plus real farming: you get seeds by harvesting wild plants and crops, then plant them on your own land.

**Decision.**
- **Wildlife.** 16 new animal archetypes were appended to `ai.json`, keeping the existing `Animal.kind` indices.
  - Passive: stag, red deer, fox, hare, squirrel, turkey, duck, sheep.
  - Defensive: elk, goose, goat, cow, bison.
  - Territorial: moose, bear, snake.
  - Each animal has data-driven loot. Depending on species this is meat cuts (venison, poultry, small game, prime cut), hide, fur, bone, fat, feathers, antler, wool, milk or snake skin.
  - Matching spawn rows were appended to `spawns.json`, with small biome-weighted caps.
  - `installPopulation({ animalCapMul })` scales the animal per-chunk and global caps. The local host passes `clamp(maxBots / 32, 0.4, 1)`, multiplied by 0.6 under `?gl=lowend` or `?safe=1`, so mobile hosts get fewer animals.
- **Recipes.** New recipes cover tallow and tallow candles, bone meal and fertilizer, a bone needle, knife and axe, an antler pickaxe, bone arrows, wool and snakeskin processing, leather and wool clothing, a fur vest, a hoe, a watering can, cooked cuts and meals. Tanning (hide → leather) already existed.
- **Farming.** Configured in `data/farming.json` and implemented in `src/farming.ts`. There are 34 plantables: 19 crops, 4 berry bushes and 11 tree saplings, 5 of them fruit trees.
  - Use a hoe to till the tile in front of you. This creates a `Crop` entity with kind 0 (tilled soil).
  - Using a crop seed on tilled soil plants it. Saplings and berry seeds plant on any free allowed tile.
  - You can't plant inside someone else's claim. Plants need ≥0.9 tiles of spacing.
  - Water from the watering can or rain gives full speed for 10 minutes. Unwatered plants grow at 0.5×. Fertilizer adds 1.5× until the plant matures.
  - Crops mature in 6–18 minutes, bushes in 15 and trees in 28–40, all within a 1-hour day.
  - `Crop {kind, stage, growth, waterUntilTick, fertilized}` is networked and persistent. It is appended at the end of `GAMEPLAY_COMPONENTS`.
  - When a plant matures it becomes a resource node. `crop_*` nodes are `oneShot`: they are destroyed when depleted and yield produce plus seeds at 0.6. Trees and bushes regrow normally.
  - Seeds come only from gathering: wild crops drop them at 0.3, and wild trees and bushes drop saplings or seeds. No recipe makes them (this is tested).
- **Flora.** New nodes include:
  - Trees: pine, birch, maple, willow, palm.
  - Fruit trees: apple, pear, cherry, orange, peach. They need no tool and regrow in 300 s.
  - Bushes: blueberry, raspberry, blackberry, strawberry, fiber, dry shrub.
  - Logs and stumps: fallen log, mossy log, tree stump, rotten stump.
  - Other: 16 wild crops and a shoreline fish shoal.
  - Worldgen places these per biome. Node chance is slightly higher: sand 0.025, grass 0.045, forest 0.09.
- **Clutter.** `clutterForChunk` places clutter deterministically from a hash of the tile and biome. It is render-only: no ECS entity on the server and no network traffic.
  - The client creates view-World sprites for chunks near the camera.
  - Normal quality: density 1, 2-chunk radius, 1600-sprite cap.
  - Lowend or safe mode: density 0.35, 1-chunk radius, 400-sprite cap.
  - `?clutter=0` turns it off. If the art is missing, nothing is drawn.
- **Rendering.** `*_tree` nodes are drawn tall, act as occluders and sway. `*_bush` nodes sway. Crops are drawn with `farm_soil`, `crop_<plant>_<stage>` or `sapling_<key>_<stage>`.

**Consequences.** The schema hash is now b39d3a19 (was 9230b2f4). Existing worlds keep their animal and item ids, since `ids.lock.json` was regenerated with the new ids appended.

## ADR-111: Art fallbacks, farming toasts and context prompt (ADR-110 follow-up)
- `packages/gameplay/data/sprite_fallbacks.json` + `resolveSprite(key, has)`: a key the art pack has is drawn as itself (new art takes over automatically); otherwise it resolves through candidate keys (recursive, tint multiplied, scale composed). New trees fall back to tree_* / oak_tree (tinted), bushes to the closest bush, animals to deer/boar/wolf/rabbit/chicken (scaled and tinted), crop/sapling stages to plant or bush sprites scaled by stage, clutter to small sprites (or is skipped). The view (`View.rs`) uses it for animals, resources, crops and clutter.
- Icons: `resolveIcon` / `iconForItem` give the item's own icon, then a mapped icon, then a per-category generic icon; panels check against the `[data-icon]` rules in the stylesheet.
- Farming: `FarmFail.NeedsHoe` added; a failed Use emits the reliable `gameplay.FarmFailed {entity, reason}`. `farmPrompt(world, player)` dry-runs till/plant and returns Till/Plant/Water/Fertilize/Harvest plus the predicted failure. The client shows `#farm-prompt` with the QuickUse binding (keyboard X / pad B; Harvest uses Interact). On touch the prompt is a tap button. A predicted failure shows a short `#farm-toast` (FARM_FAIL_TEXT) and sends nothing. No ECS schema change.

## ADR-112: Base customization catalog (furniture, decor, plants, wall hangings, rugs, outdoor)
- 106 new data-only pieces / 366 variants in `pieces.json` (marked `$decor`, generated by `packages/gameplay/scripts/gen-decor.mjs`; rerun + `pnpm lock:ids`). New `category` field (default from layer/station) drives Build-panel category tabs (focusable buttons: touch, D-pad, keys; panel scrolls; Back as before).
- Furniture in material sets `_rustic` (planks) / `_fine` (hardwood + nails) / `_luxury` (hardwood + cloth + bronze) with style variants. Storage pieces (cabinets, wardrobes, dressers, bookcases, pantry spoilMul 0.75, barrels, baskets, racks) reuse the container attachment; wardrobes and mirrors keep the `wardrobe` feature. Stoves/ovens/ranges are `fired` campfire stations with fuelMul; lamps, candles, chandeliers, sconces, lamp posts are `fired + light` with a 1-slot fuel container (ADR-108 fuel). No new systems or components: decor is static pieces, so mobile/console cost is just sprites.
- Wall mounts: `features.mount` on an Edge piece hangs it on one face (rot & 2) of an existing blocking wall. Separate `StructureIndex.mounts` map (edge+face), so a wall can carry one mount per face without sharing wall occupancy; support = the wall (parent), and `destroyPiece` removes mounts with their wall. Validation: no wall -> NoSocket, face taken -> Occupied.
- Rugs are layer 1 free pieces (1x1, 2x1, 2x2, 3x2, round 2x2, runner 3x1) so furniture (2) and decor (3) share the tiles; variant = pattern overlay, paint = colour.
- Planters (`features.planter`: herb_planter, window_planter, planter_box, garden_bed) spawn tilled soil on placement; `plant()` skips the terrain rule inside a planter (`inPlanter`), so herbs grow indoors via the existing crop system.
- Placement, rotation, recipes (build cost from existing resources), plot/clan privilege are the existing build pipeline. Art: `docs/ART_ADR112.md` (keys, variants, fallbacks, tinting); every piece resolves to pack art through `sprite_fallbacks.json` (client `pk()` resolver), also covering older art-less pieces (lantern, banner, mirror, stoves...).
- Schema hash b39d3a19 -> da41d22b (no new components; the hash covers the piece table). Tests: `packages/gameplay/test/adr112-decor.test.ts`.

## ADR-113: Skill tree, XP/levels and minimal animal husbandry

**Decision.** Data-driven skill tree in `packages/gameplay/data/skills.json` (generated by `gen-skills.mjs`): 11 branches (survival, combat, crafting, farming, husbandry, cooking, medicine, building, vehicles, stealth, leadership), 122 nodes with acyclic prerequisites, point costs and perks that can carry trade-offs (e.g. *Iron Stomach*: eat rotten food without sickness at the cost of IRON_STOMACH_HP=4 HP; weapon-class damage perks).
- **XP** (authority only) from gathering, crops, cooking, combat/kills/hunting, building, healing and vehicle repair; shared with party/clan within 20 tiles. Levels grant skill points.
- **Components (append-only):** `Progression`, `Tamed`; schema salt `gameplay.skills`=SKILLS_HASH. **Schema hash 232cdb14** (was da41d22b).
- **Commands:** `gameplay.unlockSkill {node}` (server validates points, prerequisites and ownership), `gameplay.respecSkills` (coin cost scales with level).
- **Effects** via `setSkillLevelProvider` multipliers: damage, gather/crop yield, nutrition, healing, fuel, noise, carry, vehicle fuel/repair. Entities without Progression get full skill (no regression).
- **Husbandry:** `animal_feed` item and recipe, `feeding_trough` piece; Use with feed near an animal shows Tame/Feed; tamed animals home to the trough, deposit produce there, and breed with the perk.
- **AI:** survivors spend points by personality-trait weights.
- **UI:** Skills menu (⭐, **J**, menu-bar button). Native-scroll viewport (touch/wheel pan), Zoom ± and Ctrl+wheel, branch jump buttons, focusable node buttons for gamepad/keyboard (select then select again to learn), Respec, Back; level-up toast. Perf: one static SVG for edges, husbandry runs at 1 Hz.

**Art:** skill_branch_{survival,combat,crafting,farming,husbandry,cooking,medicine,building,vehicles,stealth,leadership}; skill_forager, skill_pack_mule, skill_firekeeper, skill_iron_stomach, skill_scavenger, skill_beast_of_burden, skill_ember_saver, skill_hardy, skill_lumberjack, skill_wilderness_master, skill_brawler, skill_battle_hardened, skill_blade_training, skill_blade_expert, skill_blade_mastery, skill_blunt_training, skill_blunt_expert, skill_blunt_mastery, skill_axe_training, skill_axe_expert, skill_axe_mastery, skill_spear_training, skill_spear_expert, skill_spear_mastery, skill_bow_training, skill_bow_expert, skill_bow_mastery, skill_crossbow_training, skill_crossbow_expert, skill_crossbow_mastery, skill_firearm_training, skill_firearm_expert, skill_firearm_mastery, skill_berserker, skill_deadeye, skill_tinkerer, skill_smithing_1, skill_smithing_2, skill_smithing_3, skill_armorsmithing_1, skill_armorsmithing_2, skill_armorsmithing_3, skill_tailoring_1, skill_tailoring_2, skill_tailoring_3, skill_chemistry_1, skill_chemistry_2, skill_demolitions_1, skill_demolitions_2, skill_demolitions_3, skill_bowyery_1, skill_bowyery_2, skill_bowyery_3, skill_gunsmithing_1, skill_gunsmithing_2, skill_gunsmithing_3, skill_gunsmithing_4, skill_green_thumb, skill_composter, skill_seed_saver, skill_irrigator, skill_orchardist, skill_herbalist, skill_master_farmer, skill_monoculture, skill_husbandry_1, skill_husbandry_pens, skill_husbandry_gentle, skill_husbandry_dairy, skill_husbandry_breeding, skill_husbandry_whisperer, skill_husbandry_rancher, skill_husbandry_butcher, skill_camp_cook, skill_seasoning, skill_preserver, skill_baker, skill_brewer, skill_butcher_block, skill_gourmet, skill_glutton, skill_master_chef, skill_first_aid, skill_field_medic, skill_apothecary, skill_triage, skill_antiseptics, skill_surgeon, skill_pharmacologist, skill_doctor, skill_carpenter, skill_mason, skill_joiner, skill_architect, skill_fortifier, skill_interior_designer, skill_hearth_builder, skill_master_builder, skill_grease_monkey, skill_mechanic_2, skill_hauler, skill_fuel_economist, skill_mechanic_3, skill_road_warrior, skill_mechanic_4, skill_salvager, skill_light_step, skill_shadow, skill_backstabber, skill_silent_hunter, skill_assassin, skill_ghost, skill_phantom, skill_light_pack, skill_rally, skill_mentor, skill_quartermaster, skill_diplomat, skill_warlord, skill_commander, skill_chieftain, skill_tactician; item animal_feed; piece feeding_trough (fallbacks shipped).

## ADR-114: Character creator before entering the world

**Decision.** After the main-menu mode choice (Singleplayer / Host / Join / Multiplayer) and before connecting, `apps/client/src/character-creator.ts` shows a full-screen dialog with these fields: **Name**, **Body**, **Skin**, **Hair** and hair colour, **Face / beard** (its colour follows the hair), **Eyes**, and **Top / Bottom / Shoes** with colours. It also has a **rotating preview** (auto-turn through E/S/W/N plus ⟲/⟳ buttons), **🎲 Randomize**, **Back** (returns to the main menu) and **Enter world**.
- **Options:** only parts that are compatible with the chosen body and have no unlock tags (gated cosmetics stay wardrobe unlocks, and the server would reject them). Hair and face allow None.
- **Persistence:** stored per save in `survivaz.character.<singleplayer|hosted|remote>.<slot>`. "Delete progress → Character" also clears it.
- **Existing characters skip the screen.** The Character panel has *Edit character (next start)* (or use `?editchar=1`). The name always applies. A look change on an already-created character still follows the server's wardrobe gate.
- **Network:** the name goes in the normal join hello and SetName, and the server now strips `<>`, collapses whitespace and caps names at 20 characters. The look is sent once the player spawns, as `gameplay.setAppearance`. The server validates it with `checkAppearance` (catalog, unlocks, first-join gate), so singleplayer, host and remote all use the same path.
- **Input:** touch and mouse (44px buttons), keyboard (↑/↓ focus, ←/→ change the focused row, Enter, Esc = Back), and gamepad (d-pad/stick, A, B = Back, Y = Randomize). The panel scrolls with `overflow:auto` and fits `100dvh` with safe-area insets, including in fullscreen.
- **Perf:** a 160×200 Canvas2D preview redrawn only on change or each turn (~1 Hz); no WebGL work.
- **No ECS change** (schema hash stays 232cdb14).

**Art:** the preview is a palette paper-doll fallback. Requested: `ui/creator/preview_bg.png`, `ui/creator/ic_randomize.png`, `ui/creator/ic_rotate_left.png` / `ic_rotate_right.png`, plus starter wearables per slot and body (more hair, beard and face styles, tops, bottoms and shoes) so the creator has more than the defaults.


## ADR-115: Realistic, server-synced day/night lighting; placed-decor variants; creator art

**Context:** each client ran its own day clock from its local `world.tick`, so players who joined at different times saw different times of day, and the clock jumped after a reconnect or a tick correction. The light curve was a few hand-made keyframes, which gave flat noon light, sudden dusk and a dark-blue night without moonlight. Placed decor always drew variant 0. The creator art (ADR-114) had landed but nothing used it.

**Decision:**
- **One clock, from the server.** The time of day is `dayFractionAt(serverTick, epochTick, dayLengthTicks)`. It uses `NetClient.serverTickEstimate` plus the frame alpha, measured against the replicated `TimeOfDay` component, and never the client's own `world.tick`. `DayClock` (core/time.ts) takes the first sample as-is, then moves forward at the natural day rate and blends out any error over ~2 s, handling the midnight wrap, so the clock never snaps. The client's `sampleDayClock()` (apps/client/day-clock.ts) feeds both the renderer (`iso.render(..., dayFrac)`, which then uses `setDayFraction`) and the HUD clock (`dayHours()`). Debug `ov.hours` still wins. Test: two loopback clients that join 15 s apart agree with each other and with the server to within 6/2400 of a day.
- **Physical light curve** (render/timeOfDay.ts). Sun elevation is `62°·sin((h−6)/24·2π)`. `DAY_CURVE` is a table keyed by elevation (−90, astronomical/nautical/civil twilight, golden hour, 15°, 30°, 90°) that gives ambient, sky, fog and lamp glow, blended with smoothstep. Dawn is tinted pinker and dusk more orange near the horizon. The night has a moon term scaled by `moonIllumination(day)` (a 29.53-day synodic cycle). Shadows follow the sun's direction and length and fade out below ~10°; at night there is only a faint moon shadow. `dimForWeather` darkens and flattens the light under overcast, rain, fog, snow and storms. Art's keyframe grading stays (LUTs, shadow tint, 35% of ambient). Lamps and window glow fade in with `glow`. The Canvas2D fallback uses the same curve and weather dimming. Test: no step larger than 0.06 per game-minute, plus checks on twilight ordering and the moon phase.
- **Placed decor variants:** `view.ts` passes the replicated piece `variant` (by name, or by index) and the rotation to `buildPieceVisual` for placed pieces, not just for the ghost (`pieceVariantOpts`, with a test).
- **Creator art:** `ui/creator/**` is mounted under the art base. The preview host shows `preview_bg` (image-set 1x/2x, 160×200 with the feet at 80,172, centered), and the Canvas2D preview draws over it transparently. Rotate and Randomize are 40 px icon buttons (`ic_rotate_left/right`, `ic_randomize`) that keep their aria-labels and fall back to a glyph if an image fails. A test checks that every unlock-free starter wearable (the 20 new ones included) is offered for both bodies.
- **No ECS change** (schema hash stays 232cdb14).

**Consequences:** every player sees the same sky, and a reconnect or tick correction never makes the light jump. A full day and night has visible golden hour, blue hour and moon phases. The WebGL creator preview still draws its own solid backdrop (that is the Renderer's area); a transparent backdrop there can come later.


## ADR-116: Maxed-out graphics on powerful devices (probe-based tiers, Ultra, console full art)

**Context:** Auto started every device on the same governor level. Desktop budgets were 768 MB and DPR 3. Consoles were capped at 256 MB and 1080p, with downscaled pages, because the Xbox had run out of memory (OOM) at 768 MB with a bad FBO format. Detection was mostly based on the UA string. The governor stepped down after 1.5 s of frames slower than 60 fps, so short hitches lowered quality on strong PCs. A context loss sent every device straight to `lowend`.

**Decision:**
- **Tiers** are low, medium, high and **ultra**. Ultra means native DPR up to 4 (capped at 4K or the canvas size), a full-resolution lightmap, bloom, full weather, particles x1.25, clutter x1.25, and maximum sprite, animation and wearable detail. The Settings presets are Auto, Low, Medium, High and Ultra. *High* now really means high (it used to map to ultra).
- **Probe-based classification** (`render/deviceTier.ts` `classifyDevice`) uses the renderer string, MAX_TEXTURE_SIZE, hardwareConcurrency, deviceMemory, touch, and the RGBA8 FBO result. The UA is only used to detect consoles and phones.

| device | class | Auto start | ceiling | atlas budget | backbuffer |
|---|---|---|---|---|---|
| Desktop dGPU (GeForce/RTX/GTX, Radeon RX/Pro, Arc), Apple M-series | desktop-dgpu | **ultra** | ultra | 1024 MB | DPR<=4, <=4K |
| dGPU with <4 threads, <4 GB, or MAX_TEXTURE_SIZE <8192 | desktop-dgpu | high | ultra | 768 MB | DPR<=3, <=4K |
| Intel UHD/Iris, AMD Radeon(TM) Graphics (iGPU) | desktop-igpu | high | high | 768 MB | DPR<=3 |
| Masked/unknown desktop renderer | desktop-unknown | high (the bench can promote it) | ultra | 768 MB | DPR<=3 |
| Xbox Edge (SraKmd) / console UA | console | **ultra** | ultra | 448 MB streamed, RGBA8 targets | native, <=4K |
| iPhone/iPad, Apple GPU, Immortalis, Adreno 73x+, Xclipse | mobile-high | high | high | 128 MB | native DPR, 3.2 MP |
| Android Mali and other phones | mobile | medium | high | 128 MB | native DPR, 3.2 MP |
| SwiftShader/llvmpipe/Basic Render/WARP, failed RGBA8 FBO | software | low (auto lowend) | medium | 160 MB | DPR 1, 720p |

- **Bench:** a median of 120 frames after 30 warm-up frames. Under 9 ms promotes an unknown or dGPU desktop one level, up to its ceiling. Over 25 ms demotes one level. It is skipped when the device has a remembered tier.
- **Governor hysteresis:** it steps down one level only after more than 5 s with the frame-time EMA slower than 50 fps (time below 30 fps counts double). It steps up after 8 s of headroom (EMA < 14 ms, about 71 fps). Between 50 and 71 fps nothing changes. There is a 3 s cooldown after each change, a level that was stepped down from needs 4x the up time before it is retried, and the governor never goes above the device ceiling.
- **Per-device memory:** after the Auto level has held for 30 s, it is saved in localStorage (`survivaz.render.deviceTier`) under a hash of the renderer and UA. The next start uses that level and skips the bench. A context loss clears it.
- **Context loss ladder:** full → **high** (`?gl=high`: Ultra capped at High with the pre-ADR-116 budgets, i.e. console 256 MB / 1080p and desktop 768 MB) → lowend → safe. Debug (dots) is never chosen automatically. MAX_RELOADS is now 4.
- **Settings:** the Auto option reads "Auto (Ultra) — adaptive", showing the current pick, and a line below it shows the detected tier and device class (and "remembered" when it applies).
- **Bots:** on strong CPUs (>= 8 threads, not mobile or lowend), far bots in the local host perceive every tick instead of every 4th.
- **No ECS change** (schema hash stays 232cdb14).

**Consequences:** desktop PCs with a discrete GPU and consoles start fully maxed out. Phones and weak devices keep their conservative starts. Short frame drops no longer lower quality. An Xbox that runs out of memory falls back to High, which is the known-good 256 MB setup, not lowend. Clutter density follows the tier's `clutter` value on the next start, which the client view wires up later (for now it stays 1 unless lowend).

## ADR-117: Audio system (Web Audio mixer, sound banks, snapshot-driven events, adaptive music)

**Context:** the game only had a few `new Audio()` animal calls (and that path doubled the `animal_` prefix, so it never found its files). We want full sound: effects for every gameplay action, ambience, adaptive music, and volume controls that work on touch, gamepad and keyboard/mouse. It must run on phones and consoles, stay cheap on low-end devices, and add **no netcode**.

**Decision:**
- **Mixer** (`apps/client/src/audio/mixer.ts`): one `AudioContext` with buses `master ← {music, ambient, sfx, ui, voice}` and a compressor on master. Volume and mute per bus are stored in localStorage (`survivaz.audio.v1`). The context is created and resumed on the first pointer, touch or key gesture, or a gamepad button (iOS gets a silent-buffer unlock). It suspends while the tab is hidden. When singleplayer is paused, world sound, loops and music fade out but UI sounds keep working. Sound effects are decoded `AudioBuffer`s with pooled filter→pan→gain chains. Music uses streamed `<audio>` elements (`MediaElementSource`). Voice limits: per-key `maxVoices`, then a global cap (32, or 12 in low-CPU mode) that steals the voice with the lowest priority, oldest first. **Low-CPU mode** (Auto = `?gl=lowend`, ≤4 cores or ≤2 GB; it can be set On or Off in Settings) halves the per-key limits, drops the compressor and lowpass filters, and synthesizes at 22 kHz.
- **Formats:** a bank lists file stems. The client tries `ogg` (Vorbis/Opus), then `m4a`, then `mp3`, filtered by `canPlayType`, so Safari and iOS use m4a. The Vite pack mount now serves `audio/{sfx,ambience,ui,music,voice}/*.{ogg,opus,m4a,mp3}`.
- **Sound bank** (`audio/bank.json`, generated by `scripts/gen-audio-bank.mjs`): 244 dotted event keys. Each entry has a bus, file variants, volume, pitch/volume jitter, loop/stream flags, priority, maxVoices, maxDist and a **procedural placeholder** recipe. If a key is missing, lookup falls back to its dotted parent (`footstep.grass` → `footstep`). If there is no parent either, the event stays silent. When a key has no files, or its file fails to decode, a deterministic synthesized placeholder plays instead, so the game has sound before Art delivers. Variants never repeat back to back.
- **2.5D spatial** (`audio/spatial.ts`): the listener is the local player. Gain is 1 inside 2 tiles and fades quadratically to 0 at maxDist (18 by default). Stereo pan follows iso screen x, `(dx−dy)/2`. If exactly one of listener and source is under a roof (a roof piece above within ~0.9 tile), the sound goes through a 900 Hz lowpass. The weather and biome beds share a lowpass that closes to 700 Hz indoors.
- **Events without netcode** (`audio/snapshot.ts` + `audio/events.ts`): each rendered frame reads the replicated net world within 26 tiles into plain snapshots. The `AudioDirector` diffs them against the last frame:
  - Footsteps come from distance travelled, by surface (tile or floor-piece tier, plus swim). Zombies and animals have their own steps.
  - When an attack or punch animation starts, a swing plays, or a fire sound for ranged weapons, chosen by the held item's family. An HP drop plays a hit by the attacker's class, plus a hurt vocal. Death plays a death vocal.
  - Reload starts when `reloadUntilTick` rises. A bow draws on charge.
  - Gathering follows the gather animation and the nearest node's tool class. Tree fall and rock break play when a node runs out.
  - Starting or finishing crafting or cooking plays a sound, with craft and sizzle loops in between.
  - Fires ignite, crackle (loop) and get extinguished. When a **snuffer** is within 3.5 tiles, the extinguish is `zombie.snuffer.snuff` + `fire.snuffed` instead.
  - Other sounds: doors (with metal variants), turret and trap `readyTick`, crop till/plant/water/grow, eat/drink from hunger/thirst rises, level-up, explosion on explosive despawn, build place/break on piece spawn/despawn.
  - Vehicles: engine start/stop, idle and rev loops crossfaded by speed with pitch following RPM (0.8–1.6), headlights, door/seat changes, bicycle ride and mount. The **horn (H) is local-only**, because no horn flag is replicated.
  - Spawns and despawns are ignored for 2 s after the first frame and whenever more than 6 arrive in one frame, so chunk streaming does not cause bursts. At most 12 one-shots play per frame.
- **Ambience** (`audio/ambience.ts`): day/night beds crossfade on daylight, which comes from the ADR-115 day fraction (dawn 0.2–0.3, dusk 0.7–0.8). The day bed depends on biome (forest/beach/rocky from tiles around the listener). Shore water plays near water. Weather beds: rain (an indoor rain-on-roof variant), storm, wind (from wind speed), snow. Random one-shots: birds by day, owls and distant zombie moans at night, thunder in storms.
- **Adaptive music** (`audio/music.ts`): the menu theme plays in the main menu. In game, explore plays by day and night plays at night. Threat comes from nearby hostile zombies or animals and the CombatTag, smoothed to rise fast and release over ~6 s. It crossfades in `combat.low` and then `combat.high`. Exploration music plays for 120–180 s, then leaves a 30–90 s silence gap; combat ignores gaps. Stingers play on death.
- **Settings:** an Audio block in Settings has a −/+ pair (10 % steps), a value readout and a Mute toggle per bus, plus a Low-CPU cycle button. These are plain buttons, so UINav's gamepad focus and A button, touch and mouse all work. Changes apply live and persist. UI sounds come from capture-phase click, hover and focus listeners (back/close/cancel use `ui.back`) and toasts (`ui.notify`).
- **Assets:** `docs/AUDIO_ASSETS.md` lists every key with its bus, loop/one-shot, variant count, target length, format and status, plus delivery naming (`packages/assets/pack/audio/<bus dir>/<key with _>_<n>.ogg` + `.m4a`). Re-run `node scripts/gen-audio-bank.mjs` after adding files.
- **No ECS change:** audio is client-only. The gameplay world schema hash (server role, `World.getSchemaHash`) is **b585c117**, the same before and after this change.

**Consequences:** every peer hears the same events from the same replicated state, at zero bandwidth cost. Sounds the snapshot cannot show (other players' horns, exact hit victims in crowds) are approximated or local-only. Placeholders are deliberately lo-fi. Real assets replace them per key with no code change.

## ADR-118: Loading bar driven by real progress; zombie walks the fill edge

- Boot progress is a weighted stage list (`apps/client/src/load-progress.ts`): renderer/shader init 8%, art manifest 10%, sprite atlases 52%, building variants/hands 10%, lighting + shader warm-up (`loadLook`) 15%, ready 5%. `IsoView.create` reports stages via `onStage`; the atlas stage counts image/KTX2 responses with Resource Timing (`PerformanceObserver`) against the number of eager atlases (capped at 97% until `setRegistry` resolves) and shows MB transferred.
- `LoadProgress.value` is monotonic; `EasedBar` eases the shown fill exponentially toward it (never backwards, dt clamped for background tabs). `BootUI.finish()` eases to 100% then hands off to the menu (1.2 s cap). `BootUI.fail()` turns the bar red with a message (e.g. the safe-quality reload); a renderer fallback shows a notice and still completes.
- The zombie sits on a `.lane` above the track at `left = fill%`, with a 6-frame walk + bob while the fill moves (Art's `loading_zombie_walk.png` when branding provides it, otherwise an inline pixel SVG). `prefers-reduced-motion` snaps the fill, freezes frame/bob and stops the campfire animation. The track has `role=progressbar` + `aria-valuenow`.
- Not covered: the audio bank (decoding needs an unlocked AudioContext, so it is not on the boot path), and world join after the menu (not part of the boot screen).

## ADR-119: Roads (path, gravel, paved) and settlement classification

- **Data:** `packages/gameplay/data/roads.json` has three surfaces.
  - **Path:** needs a shovel or hoe and costs nothing; walk ×1.10, vehicle ×1.15.
  - **Gravel:** 2 `gravel`; walk ×1.20, vehicle ×1.35.
  - **Paved:** 1 `stone` + 1 `cement`, or 1 `asphalt` + 1 `crude_oil`; walk ×1.30, vehicle ×1.60.
  - New recipes: `gravel` (2 stone → 3, no station), `cement` (3 stone + 1 clay → 2, furnace), `asphalt` (2 gravel + 1 crude_oil → 2, furnace).
- **ECS:** a `Road` component (`surface`, `mask`, `tx`, `ty`, `owner`) on a lightweight replicated entity per tile.
  - Upgrading replaces the surface in place.
  - `mask` is a 4-bit N/E/S/W neighbour mask, recomputed for the tile and its neighbours on place and remove, so edges auto-connect.
  - The client draws `road_<surface>_m<mask>`, falling back to `road_<surface>`.
  - **Render gap fixed (art 2b92a0ee):** roads are drawn as `Flat` ground decals (sorted under feet, entities and shadows) in both WebGL2 and Canvas2D. The `_m0.._m15` variant comes from the replicated `mask`, which counts neighbouring roads of any surface (the art's arms run to the tile edge, so mixed surfaces still join). The view re-picks the variant when neighbours change (`apps/client/src/road-sign-view.ts`). The `gravel`, `cement` and `asphalt` item icons resolve from `nature_roadicons`.
- **Placement:** a road may go anywhere, including outside privilege zones, except inside someone else's zone (`no_privilege`).
  - `PlaceRoadCmd` lays a 4-connected Bresenham line from a drag; the line is capped at `maxDragTiles` (32), and the command stops at the first tile the player can't afford.
  - `RemoveRoadCmd` is owner only.
  - Roads persist through the normal entity save.
- **Speed:** `movement.ts` multiplies walk speed by `roadSpeedMul`, and `vehicles.ts` multiplies vehicle speed by `roadVehicleMul`.
- **Settlements:** `classifySettlements` takes homestead points (one per owned base) and single-link clusters them within 24 tiles.
  - A cluster containing any clan base is a **clan city**.
  - Otherwise, a cluster with 2 or more clanless players is a **village**.
  - A lone player is a **house**.
  - The HUD shows the settlement at the player's position in `#settlement-label`.
- **Client:** G cycles the road tool (off → path → gravel → paved), and a drag places the road.
- **Schema:** GAMEPLAY_COMPONENTS appends Road, Sign, HordeMember, WorldRules, HordeStatus and PieceOwner. The new schema hash (server role) is **a70d288c**, replacing b585c117.

## ADR-120: Craftable signage

- **Six kinds**, each an item, a recipe and a placeable: `sign_wooden_post`, `sign_hanging`, `sign_wall_plaque`, `sign_billboard` (longer text), `sign_metal_road` and `sign_arrow` (rotatable).
- **Text** is stored in the `Sign` component, which is replicated and persisted.
  - `sanitizeSignText` strips control characters, collapses whitespace and trims, then limits length to `SIGN_TEXT_MAX`, or a per-kind limit.
  - `maskProfanity` masks whole words, including leetspeak forms, with `*`. Substrings inside clean words are not matched (no Scunthorpe problem).
- **Editing:** `setSignText` is allowed for the sign's owner, or a member of the sign's clan. `removeSign` refunds the item.
- **Commands:** `PlaceSignCmd`, `SetSignTextCmd` and `RemoveSignCmd`; reject reasons `no_item` and `not_owner`.
- **Client:**
  - Signs show as DOM world labels within 22 tiles, at most 40 at a time.
  - Clicking a label edits its text through `prompt()`.
  - N places the first sign the player is carrying.
  - **Render gap fixed (art 2b92a0ee):** the sign sprite shows `idle` for `Sign.rot` 0 and `idle_r1..r3` otherwise, instead of always frame 0, in both WebGL2 and Canvas2D. A rotation updates the live sprite. `Sprite.frameId` with the high bit set (`frame-select.ts`) selects a named animation. The `icon_sign_*` item icons resolve.

## ADR-121: Roaming zombie hordes and world rules

- **World rules:** a `WorldRules` env component with `hordes` (default **on**) and `hordeGraceDays` (default **3** in-game days, clamped 0–30).
  - They are set from the main-menu Settings for **new** worlds, saved in the save meta (`hordes`, `hordeGraceDays`), and the save wins on reload.
  - The pause menu shows the current world's rules, read only.
- **Director:** server only, in `hordes.ts`.
  - It never runs while hordes are disabled, or before the grace period ends.
  - The grace period doubles while the highest player level is below 3 (`graceFor`).
  - It rolls at dusk or night, at most once per in-game day.
  - A target is a base: `PieceOwner` pieces grouped by clan, or by solo player.
  - It announces a warning (`HordeStatus.phase = Warning`, 30 s), then spawns tagged `HordeMember` zombies on a ring 36–48 tiles out.
  - They steer to the base and attack structures; the existing fire-light, snuffer and defence systems apply to them normally.
  - The horde is **defeated** when every member is dead.
- **Size:**
  - `scale = min(2.5, 1 + 0.05·(level−1) + 0.03·daysPastGrace)`
  - **Solo** = `min(14, round(4·scale))`
  - **Clan** = `min(64, round((12 + 4·members)·scale))`
  - Totals are clipped to `maxHordeZombies` 120 and `maxActiveHordes` 3.
  - Solo is therefore always smaller than any clan horde, and a clan horde grows with member count.
- **Client:**
  - `#horde-toast` with sounds `horde.warning`, `horde.spawn` and `horde.defeated` (placeholders in the generated bank; listed in AUDIO_ASSETS.md).
- **Known gaps:**
  - Horde members and `PieceOwner` are not persisted. After a reload, bases group by a 32-tile cell.
  - There is no in-game toggle after creation.

## ADR-122: Road tool and sign input across devices, styled sign editor

- **Bindings** (`packages/input/profiles`, new non-consuming `Road` context, priority 12):
  - Keyboard/mouse: `RoadTool` = **G** (cycle surfaces → off), `PlaceSign` = **N**; in Road: Enter confirm, Esc cancel/exit (`Road` is in `ESC_OWNING_CONTEXTS`, so Esc does not open the pause menu).
  - Gamepad (incl. Xbox Elite/Edge mappings): every Gameplay button is taken, so the pad enters the tool from the Build panel. Inside `Road`: right stick moves a tile cursor (radial deadzone 0.15), **A** mark start / mark end / lay, **RT** lay, **B** cancel → exit, **Y** next surface, **X** place sign. These shadow Jump/Aim/Interact only while the tool is on.
  - Touch: drag (or tap start, tap end) plans a line; it stays pending until **✓ Lay road** / **✕ Cancel**. Pointer downs on virtual sticks/buttons are ignored.
- **UI:** a top-right HUD bar (44 px targets) with Road and Sign buttons and a per-device prompt; the Build panel gets a "Roads & signs" section. The preview draws exactly the server's `roadLine` walk (capped at 32 tiles).
- **Sign editor** (`sign-editor.ts`) replaces `prompt()`: a UINav modal (Esc, gamepad B, browser back via back-history and a Back button all close it) with a live preview, per-kind counter, `sanitizeSignText`, an on-screen keyboard (pad Y toggles; opens by default on gamepad), and a scrollable panel sized with `dvh` and safe-area insets. Empty signs now show a ✎ label so they can be edited; the HUD Sign button becomes "Edit sign" near one.
- **Gaps:** no per-world creation step for hordes/grace days (new-world rules stay in main-menu Settings, ADR-121, because singleplayer start does not know whether a save exists); no Gameplay-context gamepad hotkey for the road tool; touch places signs at the player tile.

## ADR-123 Character visibility: AOI leave hysteresis, pinned wear/face pages, last-good layers

- **Problem:** characters popped in/out and their appearance (hair, clothes, eyes) intermittently blanked.
- **Root causes:** (1) `NetServer.replicate` had chunk-level interest hysteresis only. An entity crossing the leave edge was despawned and then respawned at once, which caused create/destroy churn and a pop. (2) `PageLRU.victim` let any nearer request steal the farthest *live* page even when a visible character retained it, so two crowds kept stealing each other's wear/face pages. (3) A wear/face layer whose page was not resident (a swim/punch page streaming in, or an evicted page) was skipped for that frame. (4) Chunk culling for sprites used the bare view rect, not the sprite margin.
- **Not causes (verified):** spawn records carry every component, so the full `Appearance`/`Wardrobe` goes with every create, and the client rebuilds created entities with full state. The ADR-116 quality governor changes resolution, bloom and particles but never drops layers (`maxDetail` is unused). Layers are dropped by the OOM fallback ladder (`EvictWearables`) and the dress cap, both deliberate.
- **Decision:** `interestLinger` (default on; `{ leaveChunks: 1, minTicks: 2 s }`; `false` = old behaviour): a replicated entity stays while it is within radius+hysteresis+1 chunks of a viewpoint, and at least 2 s after it leaves. Retained pages can only be stolen by `PRIO_NEAR` requests (the local player and adjacent characters). The sprite batcher keeps a per-(entity, slot) last-good frame and draws it while the current page is unavailable, provided the old page is still resident. Chunk culling uses the margin rect.
- **Tests:** `net/test/aoi.test.ts` (linger and oscillation), `net/test/appearance_aoi.test.ts` (two clients: appearance survives leave/re-enter, no spawn without Appearance), `render/test/charPin.test.ts`.
- **Gaps:** the OOM ladder's `EvictWearables` still strips far characters (by design under memory pressure). The last-good frame cannot help once the page itself is evicted. Body-only fallback remains for the very first load.

## ADR-124: Creator eye, shoe and secondary colour rows; creator screenshot hook
- **Context:** The renderer already tints eyes (R), shoes (R + G) and 2-channel clothing (G = secondary). The ADR-114 creator only exposed hair, top and bottom colours.
- **Data:** No new fields. `Appearance.primary[eyes]`, `primary[shoes]` and `secondary[slot]` already exist, are networked and persisted, and are checked by `validateAppearance` against `SLOT_PALETTE`. The component schema and its hash are unchanged.
- **Rows:**
  - **Shoe colour:** `shoes:color` cycles `clothingColors`.
  - **Secondary colour:** one row that sets `secondary` on top, bottom and shoes (`SECONDARY_SLOTS`) together.
  - **Eye colour:** `eyes:color` cycles a curated `EYE_COLOR_KEYS` subset of `clothingColors` (browns, hazels, greens, blues, greys, then a few fun ones). The server range check is unchanged.
  - Each colour row shows a swatch. The rows use the same 44 px ◀ ▶ buttons, so touch, mouse, keyboard (arrows) and gamepad (d-pad) work, and the panel scrolls on mobile.
- **Palette:** `mustard` was #e0b43a and `gold` was #e8b84a, which were nearly identical. They are now `mustard` #b98a1e (dark, muted) and `gold` #f7cc2e (bright). A test keeps every clothing colour more than 25 RGB units from the others, and mustard/gold more than 60 apart.
- **Screenshot hook:**
  - `?creator=shot&seed=N[&facing=0..7][&preview=2d]` skips the menu and world. It loads the art and customization pack, then opens the creator with `randomLook(cat, mulberry32(seed))`.
  - In this mode there is no auto-turn and the animation clock is fixed at t = 0.
  - Once the preview's art has loaded and two frames have drawn, it sets `window.__creatorReady = { ok, seed, facing, renderer, appearance }` and `[data-boot=creator][data-ready=1]`.
  - It sets `{ ok: false, error }` if the pack did not load.
## ADR-125: Slower on-foot movement so vehicles matter

- **Problem:** players walked at 4 tiles/s and sprinted at 6.4, so even cars (13–18) were only ~2–3× a sprint and walking everywhere was fine.
- **Change** (`movement.json`, one shared constant read by server simulation and client prediction through `applyMovementInput`/`speedMultiplier`):
  - `walkSpeed` 4 → **2.6** tiles/s (−35%, about a jog). `sprintMul` stays 1.6, so sprint 6.4 → **4.16**.
  - Swim stays ×0.4: 1.6 → **1.04** (walk) / 2.56 → **1.66** (sprint). Roads (ADR-119 ×1.1/1.2/1.3), encumbrance, wetness, skills and buffs are unchanged multipliers on the new base.
  - Motor vehicles below 12.5 were raised to **12.5** (trucks 11/12, campers 10/12, semi 12), so every car/truck/van/camper/semi tops out at 12.5–18 = **3.0–4.3× sprint** (before boost). Bicycles (4.5–8) are unchanged: about 1–2× sprint, without stamina cost.
- **Animation:** new `walkAnimRefSpeed` (4 = the speed the walk art was authored for). `walkAnimRate()` = walkSpeed / walkAnimRefSpeed (0.65). The client binds it as a new render `animRate` binding for character Walk (WebGL `SpriteBatch` and Canvas2D), so feet don't slide.
- **Zombies are unchanged:** walker 1.4, brute 1.0, snuffer 2.0, runner **2.8**. A runner is faster than a walking player (2.6) but slower than a sprinting one (4.16), so you escape a runner only by sprinting. `adr125_speeds.test.ts` pins this.
- **Netcode:** AntiCheat and range slack only set upper bounds (`building.playerMaxSpeed` 5 is unchanged), so slower movement can't trip them. Vehicle caps follow the updated `maxSpeed` via `riderMaxSpeed`.

## ADR-126: Tool-needed symbol near resource nodes
Context: players could not tell which tool a node needs until a gather failed. Decision: `@engine/gameplay` `toolHint(world, player)` (pure) picks the nearest non-depleted ResourceNode within 1.5 tiles and derives the symbol from resources.json only: `requiredTool: none` → hand; a fitting tool owned (equipped or anywhere in the inventory, tier ≥ minTier, best tier wins) → that tool, normal; no fitting tool but bareHands allows it (tier 1 axe/pickaxe/shovel, 25% yield) → hand; otherwise the required tool greyed with a red lock. The client (`apps/client/src/tool-hint.ts`) draws it on a small DOM canvas positioned from the shared camera, so WebGL2 and Canvas2D look identical and it needs no input (touch draws it larger); it fades in/out via CSS opacity and hides while menus/build mode are open. Settings → "Show tool needed near resources" (`toolHints`, default on, applied live). Icons are the Art & Assets sprites `tool_req_<hand|axe|pickaxe|shovel|hoe|knife|sickle>` (nature_toolicons atlas, 32px + @2x, resident), resolved through the asset registry with the page nearest the on-screen pixel size; a vector canvas placeholder (no emoji/fonts) is drawn only if the registry/key/image is unavailable. Consequences: hoe/sickle are drawn but no node requires them yet.

## ADR-127: Normalized player movement (every direction = walkSpeed)
- **Problem:** the move vector was never normalized. Each screen key added a full (±1, ±1) iso step, so one key moved √2 ≈ 1.41× and a two-key diagonal (e.g. down+right → (2, 0)) moved 2× in tile space. Worse, the live server/client path (`apps/server/src/protocol.ts` `moveDelta`) still used the hard-coded `MOVE_SPEED = 4` / `SPRINT_MUL = 1.6`, so ADR-125's `walkSpeed` 2.6 never reached players: measured cardinal (one key) 5.66 tiles/s, two-key diagonal 8.0, sprint 9.05 / 12.8. Gameplay's own `applyMovementInput` (2.6-based) gave 3.68 / 5.2.
- **Change:** `@engine/gameplay` `moveVector(actions, analog?)` builds a screen-space vector (digital bits, or the analog stick `moveX/moveY` when past `input.json` `moveDeadzone`), clamps its length to 1 (stick stays proportional below 1), then maps it to iso with a length-preserving 45° rotation (`dx = (sx+sy)/√2`, `dy = (sy−sx)/√2`). `moveDirection(bits)` = `moveVector(bits)`. `applyMovementInput` takes the optional analog and moves `walkSpeed × speedMultiplier × |v|`.
- **One shared path:** `protocol.ts` `applyMoveInput` (server authority, client prediction, bots via `applyDemoInput`) now delegates to `applyMovementInput`; `MOVE_SPEED`, `SPRINT_MUL` and `moveDelta` are removed. This also brings collision, encumbrance, wetness, roads, swim and buffs to the live path.
- **Result:** all 8 key directions and a full stick = **2.6** tiles/s walk, **4.16** sprint (× other multipliers). Felt speed drops: one key 5.66 → 2.6 (−54%), two-key diagonal 8.0 → 2.6 (−68%); this is the speed ADR-125 intended.
- **Vehicles:** unchanged. `driveFromBits` already normalized and points the same way as `moveDirection`; `setDriveInput` clamps analog to 1.
- **Anti-cheat:** the bounds still hold. The fastest on-foot speed is now 4.16 × 1.3 (best road) = 5.4, under `playerMaxSpeed` 5 × 1.25 tolerance = 6.25 and the AntiCheat default of 8 × 1.25. Before the fix, the live sprint diagonal (12.8) exceeded both.
- **Tests:** `adr127_move_normalize.test.ts` covers 8 directions × walk/sprint, the mapping, analog (16 angles at 0.5 and 1, the corner clamp, the deadzone, fallback to digital bits), the anti-cheat margin and vehicle parity.

## ADR-128: Gathering animations, node hit feedback, pickup toasts, eat/drink and cooked food values
- **Anims:** core `AnimState` appends Harvest=16, Chop=17, Mine=18, Drink=19 (append-only, wire-stable). `gatherAnimFor(node, tool)`: tool-free nodes → Harvest; axe nodes with an axe → Chop; pickaxe nodes with a pickaxe → Mine; required tool not held (bare-hands allowed) → Punch; other tools → Harvest. Set on the authority per GatherSwing and replicated; one-shot (settles to Idle). Render falls back harvest→gather→punch→attack→idle, chop/mine→attack→punch→idle, drink→eat→idle. Art needs: docs/ART_LIST_ADR128.md.
- **Node feedback (client, derived from replicated `ResourceNode.amount`):** so every client agrees without new wire fields. On a drop the node wiggles (damped 360 ms shake away from the player), emits wood/stone/leaf particles by required tool, and shows a remaining-yield bar that fades out over 3 s. DOM overlay canvas `#gather-fx`, so it is the same for the WebGL2 and Canvas2D renderers.
- **Pickup toasts:** "+3 Wood" with icon, from inventory diffs (so gather, harvest, loot, pickup and craft all show it), merged per item while visible, max 4, 2.2 s; smaller on touch screens.
- **Eat/drink:** `UseCmd` stays the only command. Server enforces a 10-tick cooldown (`ConsumeFailed{Cooldown}`). Rotten (last spoil stage) food is refused (`Rotten`) unless the player has `iron_stomach` (ADR-113; eaten for `IRON_STOMACH_HP`). `slot = NO_SLOT` next to water (3×3 probe of swim tiles) drinks +12 thirst (`WaterDrunk`). An empty container used next to water is refilled; away from water it fails (`Empty`). Containers: water_flask, canteen (6 sips), water_bottle (2). UI: inventory "Eat & drink" buttons (Eat/Drink/Refill/Drink water), quick-use prompt (Eat/Drink/Drink water) on the gamepad/quickbar path, food/water lines in tooltips, eat/drink audio.
- **Food values:** raw edible foods keep low hunger; every raw fruit/berry/veg has a campfire recipe (3 s, 1→1; stoves count as campfire stations) making a cooked variant with 2× hunger, +2 health and 1.5× shelf life. Clients learn about water through `WaterProbeRes` (set from the replicated tile chunks).

## ADR-129: Character neck and head anchor
- **Note:** commits 6e859881, f74c4db4 and e9ebfbe7 say "ADR-128 neck" in their messages and code comments. ADR-128 is the gathering / eat / drink ADR; the neck work is this ADR.
- **Problem:** face, eyes, hair, hats and head accessories were drawn at fixed offsets over the body frame, so when a body frame's head moved (walk bob, sit, swim, crouch, other facings) the head layers floated off the neck.
- **Data (assets, 6e859881):** body sprites may carry an optional `head` anchor in `frameMeta` (keyed by dir-frame, rect or frame, like `handR`; pivot-relative 1x px). Sprites get an optional draw `group`; untagged keys matching `HEAD_GROUP_KEY` (face_, eyes_, hair_, hat_, headwear_, glasses, sunglasses, eyepatch, earrings, flower) default to `"head"`. `AssetRegistry.headOffset(body) = anchors.head - attach.head` (the body's reference head point, sprite `attach` or a `frameAttach` override); without either point the offset is {0,0}, so art without neck metadata draws exactly as before. The validator rejects a head anchor more than `HEAD_RECT_SLACK_PX` (16) outside its frame rect. Tests: `packages/assets/test/headAnchor.test.ts`.
- **Render (f74c4db4):** `AtlasManager.headOffsetOf(frame)` / `isHeadSprite(id)` (cached); the WebGL2 sprite pass shifts head-group layers by the offset, as do both creator previews (WebGL2 and `preview2d`). Tests cover 8 facings x idle/walk/sit/swim/crouch and draw order (`packages/render/test/head_anchor.test.ts`).
- **Canvas2D (e9ebfbe7):** the in-game Canvas2D fallback now draws the paper-doll layers (CPU tint through the tintmask, cached per frame+tint, head offset) instead of the bare body.

## ADR-130: Creator shot hook v2, served-only manifest index, hair/eye/face secondary rows
- **Shot hook (extends ADR-124):** `?creator=shot&seed=N[&facing][&body=0|1|male|female][&sex=m|f][&freeze=1][&timeout=ms]`.
  - `body` (or `sex`; `body` wins) overrides the seed's body roll. The roll is still consumed so other fields keep their place in the seed stream (seeds 1-4 all rolled female before).
  - `timeout` (default 20000 ms): `window.__creatorReady = { ok:false, error:"timeout", stage, ms, hidden }`; `stage` (art, catalog, creator, preview, loading:<kind>, frames:<kind>) says where it stalled. Success adds `body`, `freeze`, `ms`.
  - The "two drawn frames" wait was rAF-only; rAF never fires in a hidden/occluded (background headless) tab, so ready could hang forever. Each wait now also resolves on a 100 ms timer.
  - `freeze=1`: preview `freeze` option: anim ticks stop (no idle bob), `IsoRenderer.freezeClock` keeps `time` at 0 (no shader-time effects, flicker, particles) and stops adaptive-quality changes; preview DPR fixed at 1. Auto-turn is already off in shot mode. The game view behind the creator overlay is not frozen: diff the `[data-role=creator-preview]` element, not the page.
- **Manifest index:** the fragment list moved to `apps/client/src/manifest-index.ts`. vite writes `<art>/manifests.index.json` (build) / serves it (dev) with only fragments that the art mounts actually ship, so no optional fragment 404s. The `pack/` mount now also ships `items/`, `nature/` and `vehicle_items/` manifests + atlases (they were wired in the client but filtered out by the mount regex, so Pages 404'd on them and their art never loaded).
- **Secondary colour rows:** `<slot>:color2` fields set `secondary[slot]` (hair/face: hairColors, eyes: clothingColors). The rows for hair, face and eyes show only when a starter wearable in that slot has `tintChannels` 2; today's pack has none (hair/eyes tintmasks have an empty G channel; 8547e761 made happy/button eyes R-tinted, 3dbbf22c added top trim on G, already driven by the Secondary colour row), so they appear once Art ships color2 there.
- **peerjs:** declared in `apps/client/package.json` and the lockfile, and only loaded through `await import("peerjs")` in `p2p.ts` (lazy chunk). A checkout installed before it was added lacks it; re-run `pnpm install`.

## ADR-131: Seamless atlas re-tiers (quality tier steps never rebuild atlases; rebuilds hold the last frame)
Accepted 2026-10-24. Context: on phones (Android Chrome, Mali) the world periodically "hiccuped" and the local player blinked. ADR-116 governor tier steps changed `resScale`, hence `camera.scale` (zoom x dpr), which fed the atlas footprint and flipped `needsRetier`, so tier steps ran a full `AtlasManager.rebuild`: a synchronous re-upload of every array plus every lazy wear/body/stream/building page reset to non-resident (player undressed/invisible, world art popping). Decision: (1) footprint = `atlasFootprint(zoom, device DPR)`, independent of quality tier; (2) `needsRetier` fires only when crisper art / more mip levels are needed, never for a smaller footprint, so oscillation converges; (3) `rebuild` pages previously resident pages back in (closest first) while `AtlasManager.settling` is true, and `IsoRenderer.render` holds the last frame meanwhile (`SettleHold`, max `SETTLE_HOLD_MS` = 1.5 s). The local player is always a "must" snapshot record; `local_player_never_despawns.test.ts` guards it. Consequences: remaining legit re-tiers (zoom-in) show a short held frame instead of a flash; the rebuild upload itself is not yet chunked (follow-up).

## ADR-132: Skill tree split into category trees (tabs), shared point pool
Accepted 2026-10-24. Context: the ADR-113 tree showed all 122 nodes on one giant canvas with a branch jump list. Players asked for separate trees for buffs, skills, etc. Decision:
- `skills.json` gains `categories` (generated by `gen-skills.mjs`); every branch belongs to exactly one category, and each category is its own tree with its own roots. Categories: **Buffs & Perks** (new `perks` branch + leadership, 11 nodes), **Survival & Gathering** (9), **Farming, Animals & Cooking** (24), **Medicine** (8), **Crafting & Building** (30), **Combat & Weapon Mastery** (combat + stealth, 32), **Vehicles & Mechanics** (8).
- Prerequisites never cross categories (`tree.ts` throws at load; tested). Rewired: `iron_stomach` is now the root of the perks tree (cost 2, was tier 2 under forager), `monoculture` and `light_pack` moved to perks and require `iron_stomach`; `hardy` requires `forager`; `pharmacologist` dropped `chemistry_1`; `hearth_builder` dropped `firekeeper`.
- Node keys and **node order are unchanged** (`inBranch()` in the generator moves a node's branch without moving it), so `Progression.nodes` bits, saves and point spends carry over with no migration. Players who own a node whose prerequisites changed keep it. The `Progression` component schema is unchanged; the `gameplay.skills` world salt changes (net handshake only).
- Points stay one shared pool, shown once above the tabs. UI: a `tablist` of buttons (44 px, owned/total and a ✦ available count per tab), ◀ ▶ buttons, PgUp/PgDn and gamepad LB/RB (`UINav.onPage`) cycle tabs; the tree view lays out only the active category (`progressionView().categories`, per-node `cx`/`cy`).
- Art: category tabs reuse existing branch icons (Buffs & Perks and the `perks` branch use `skill_iron_stomach` as a placeholder); dedicated `skill_branch_perks` / category tab icons are an Art follow-up.
- Layout: lanes are spread by `LANE_SPREAD` (2.1) in the view so 150 px nodes no longer overlap (the old combat weapon lanes did).

## ADR-133: Compact touch HUD (audit of ADR-122 controls, context-gated buttons, no long-press menus)
- Context: on phones the ADR-122 touch layout covered ~24% of a landscape screen with a 140 px hotbar radial over E / ✋ / ✚, dead buttons and an always-on Road/Sign bar; long-presses opened the browser Copy / Select all / Web search popup.
- Audit (gameplay layout): `move` stick kept (floating, only drawn while held, r 60→50); `attack` kept (Primary/Charge, r 44→28, "⚔ Hit"); `context` kept (Interact/ContextRadial, r 34→24, "✋ Use"); `sprint` kept (toggle, r 28→22, "» Run"); `reload` kept but context-only (shown only when the main hand holds a ranged weapon, `holdsRangedWeapon`); `hotbar` radial kept (only touch way to pick hotbar 1-8) but shrunk r 70→24 ("◎ Slot"; drag direction picks the slot, so the selection still works outside the small circle). Removed: `jump` (⤒, no gameplay consumer), `secondary` (✋, not mapped into the client frame), `crouch` (⇩, no consumer), `quickuse` (✚, duplicates the tappable farm prompt).
- Building layout: kept `confirm` / `cancel` / `rotate` (the only actions BuildMode reads); removed tierup/tierdown/snap/levelup/leveldown/demolish/upgrade/repair (no consumer, unlabeled, overlapping).
- `VirtualControls.hidden`: ids not drawn and not hit-tested. Scale clamp [0.75, 2] → [1, 1.15] so controls are 44-64 px on every phone. The overlay hides controls absent from the active layout and labels each one (icon + caption).
- Road / Sign HUD buttons only show in road mode (Sign also when a sign is in reach to edit); entry is the Build panel "Roads & signs", G or N. Bar moved below the menu bar.
- Menu bar on phones: Inventory, Build, "⋯ More" (folds Crafting/Party/Skills/Chat…), ☰. Stats panel slimmer on short screens.
- `user-select:none` + `-webkit-touch-callout:none` on html/body/game root (text fields excepted); `contextmenu` / `selectstart` preventDefault document-wide outside text fields.
- Tests: no overlap / on-screen / below the menu bar / 44-65 px at 8 phone sizes with notch insets, layout audit, hidden-not-hit, mode-gated Road/Sign and Reload, long-press blocking.

## ADR-134: Hit reactions, creature health bars, resource depletion + relocating respawn
- Status: accepted (2026-10-24).
- Hit reactions: `applyDamage` stamps `HitReact {startTick, dir, src, amount}` (networked "all", **not persistent**, appended to `GAMEPLAY_COMPONENTS`) on any hp-losing hit; `dir` is the attacker→target angle quantised to a byte. The client renders a 320 ms procedural flinch (`hitPose`: 0.16-tile nudge away from the hit, squash, side tilt, 120 ms white flash via the WebGL `hitFlash` / Canvas2D `brightness` filter). Stagger is **visual only**: no server knockback or stun, so PvP stays fair and prediction never rubber-bands. Hits older than 6 ticks are ignored for late joiners. Hurt sounds already come from the audio events (`combat.hit.*`, `*.hurt` on hp drop).
- Expression: new mood sensor `hitRecently` (first mood, `hurt` for 0.6 s); the expression system now also runs for entities with `HitReact` (zombies). Expression stays broadcast and non-persistent.
- Creature bars: `CreatureBars` (gather-fx) shows a compact ADR-128-frame hp bar over players, AI humans, animals and zombies when hp drops or a HitReact arrives, fading 4 s after the last hit; the local player's combat targets (hit by me within 8 s, or my current attack target) keep theirs up. Party/clan mates draw blue. Bars sit 74 px (46 px animals) above the feet, 30/26 px wide.
- Depletion: a non-one-shot node at amount 0 is destroyed and replaced by `NodeRegrow {kind, respawnAtTick, stumpUntilTick, tries}` (networked + **persistent**). Axe nodes leave a stump for `stumpSeconds`. When due, `respawnSystem` picks a deterministic new spot (`findRegrowSpot`, `minRadius`–`maxRadius` tiles, same tile type as the origin, never void/water) clear of structures (6), roads (2), living players (10) and other nodes (1.5); failing that it retries every 30 s, and after 10 tries regrows in place, so density stays stable. Tunables live in `resources.json` → `depletion` (`respawnMul` scales every kind's `respawnSeconds`).
- Persistence: `regenerateNodes` can be a predicate; the server skips generator nodes for stored chunks that already hold nodes/regrows, so harvested spots stay harvested across restarts. Old saves still load (append-only components, per-component hash migration); legacy amount-0 nodes are converted on first tick.
- Art follow-ups: hurt/hit frames (Anim.Hurt, 8 directions, 2–3 frames) for player bodies, AI humans, each zombie kind and each animal kind; a stump sprite per tree species (only `tree_stump` exists); optional dedicated small creature hp-bar frame.

## ADR-135: XP from all activities + kill XP, PvP anti-farm, equipment slots with in-world rendering

**XP (audit):** ADR-132 already had server-side `Progression {xp, level, points}` (networked + persistent) and `awardXp` for gather/craft/build/cook/eat. New: one tunables table `packages/gameplay/data/xp.json` (`XP` export) — `sources` (small per-activity XP: gather/chop/mine/dig 2, craft 4, cook 6, eat/drink 1, build 5, road 1, sign 3, farm 6, till/water/fertilize 1, plant 2, husbandry 2, tame 25, heal 4, repair 5, combat 0.5/dmg, walk 1 per 40 tiles, vehicle 1 per 120 tiles), `kills` (base x kindMul[key] x (1 + perLevel*(victimLevel-1)), capped at maxLevelMul 4: zombie 15 (walker 1 / runner 1.4 / snuffer 1.6 / brute 2.5), animal 8 (x0.4 squirrel … x4 bear), AI human 30, player 40), `pvp` (per killer→victim window 1800 s: first kill free, then x0.5 each, max 4 per window, victims 10+ levels below give x0.25), `travel` (teleport cap 25 tiles/s), `popup`. Award is authority-only (`isAuthority && !isReplaying`); `XpActivity` events from farming/roads/signs/husbandry; `gameplay.xpTravel` postSim every 20 ticks. The server registers the AI-human predicate (`setAiHumanPredicate`).
**Client:** "+N XP" / "Level N!" lines in the ADR-128 pickup toast stack (from Progression deltas, `xpGain`), plus a tiny `#xp-chip` (Lv + 56 px bar).

**Equipment (audit):** main hand existed as `Equipment.mainHandSlot` but `IntentAction.Equip` had no handler — new `gameplay.equip` system (same slot again = unequip). `Worn` grows to 8 slots (Head, Torso, Legs, Feet, Hands, Back, **OffHand**, **Accessory**), now networked + persistent; body stats (waterproof average) use the first 6. Knives can be worn off-hand (small armor); an off-hand item cannot also be the main-hand slot. Inventory panel: tap / D-pad+A equips (`equipIntent` / `wearIntent`), drag onto the Equipment section, Equipment rows unequip, "Off hand" buttons for knives. `equipmentView` lists the 9 slots.
**Rendering:** the client now mirrors `Equipment.mainHandItem` into its view world and binds `held_<itemkey>` sprites (held items were never drawn on the client before). Worn gear maps through `data/wear_cosmetics.json` (item family → existing paper-doll wearable placeholder) via `wornCosmetics`; Renderer-owned change in `packages/render`: `AppearanceBinding.override` (optional parts patch + cache salt) in character/layers.ts + sprites.ts.
**Art needs:** held_stone_knife; dedicated armor/gear wearables (current ones are cosmetic placeholders); gloves/gauntlets wearables (unmapped); off-hand held rendering + art; accessory items; XP chip frame + XP toast icon.

## ADR-136: Building on every platform (contextual piece menu) + station-only crafting recipes

**Build audit:** `BuildMode` handled only Cancel / Rotate / PlaceConfirm; PieceNext/Prev, TierNext/Prev, LevelUp/Down (multi-level floors were impossible, `level` stayed 0), Demolish/Upgrade/Repair and Nudge were bound on all three devices but did nothing, and the client never sent `DemolishCmd` / `UpgradeCmd` / `RepairCmd`. Gamepad aim was fixed at 2 tiles along the stick; touch had no way to aim (AimResolver.setTouchTarget was never called) so the ghost sat in front of the player; pad LB+Y (ToggleBuild) was unhandled, so a controller could only open Build through the pause menu. Conflicts: pad D-pad up = TierNext and LT+up = LevelUp, KBM wheel vs Shift+wheel both fired.
**Fix:** `BuildMode` now cycles piece / tier, changes floor (0..maxLevel; LevelUp/Down win over Tier, Tier over Piece), runs a gamepad build cursor (right stick, `moveVector` screen→iso, 5 tiles/s, clamped to buildReach, follows the player), takes a touch world point (`build-hud.ts`: tap positions, drag adjusts with a 48 px lift, touches on the virtual joystick zone / buttons are ignored, the ✓ button places) and tracks the placed piece under the aim (`pieceTargetAt` in gameplay ui/placement.ts). Only while a piece is targeted, one compact labelled strip shows `Piece · tier · hp%` and Repair / Upgrade → next tier / Demolish with the device's hint (KBM H / U / X, pad X / Y / hold X, touch buttons). Demolish needs a second press (3 s) except the pad's 500 ms hold; Esc / B disarms before cancelling. Intents: `repairIntent` / `upgradeIntent` / `demolishIntent` (entity field `target`); the server re-validates as before. Pad LB+Y opens the Build menu (and returns to it while placing). HUD = one chip (piece, ✓/✕, Floor N ▲▼). Roads / signs (ADR-122) already had per-device flows and tests; unchanged. Build.ToggleSnap stays a no-op (snapping is authoritative on the server).
**Crafting:** the personal Crafting menu lists hand (station 0) recipes only, plus a hint "More recipes at stations (N): …"; station recipes appear only in that station's panel (Interact on a campfire / stove / workbench / furnace / anvil / garage → `interactPanel` `station` → "Crafting Station" menu with the station name and, for fired stations, fuel + Light/Put out). `craftingView(c, station)` filters (-1 = all, for the camper). Station tags fixed: trail_mix → none, thread_from_wool / flour_from_wheat → workbench. Proximity was already enforced server-side (`craftQueueReason` "no_station", unlit fired stations do not count, queued jobs pause out of range); covered by new tests.
**Tests:** apps/client/test/build_platforms.test.ts (kbm, gamepad, touch through the real InputSystem profiles), packages/gameplay/test/station_crafting.test.ts.

## ADR-137: Dedicated hands cosmetic slot + exact item → wearable mapping (ADR-135 follow-up)

**Problem (Art):** core `WEARABLE_SLOTS` had no hands slot, so ADR-135 gloves (82e035a3) mapped through `accessory`, and `wornCosmetics`' fill order let a glove hide a cloak/backpack. Every armor tier (bone/bronze/iron/steel/composite) mapped to one family wearable, so all tiers looked identical.
**Hands slot:** `"hands"` is **appended** to core `WEARABLE_SLOTS` (index 8; earlier indices unchanged, palette clothingColors), so Appearance arrays grow 8 → 9. The four glove wearables (`acc_cloth_gloves`, `acc_leather_gloves`, `acc_fur_mittens`, `acc_gauntlets`; keys/ids unchanged) move to slot `hands`, layer 33 with `layerByDir` [33,33,33,33,22,22,22,33]: over body, top main (20) and the front sleeves (31) on E/SE/S/SW/NE, behind the torso on W/NW/N like the back sleeves (21). Art tools follow (catalog.py `hands` slot + `HANDS_BY_DIR`, build_all passes `layerByDir`, render/rectpack/add_gear know `hands`). `wornCosmetics` puts anything worn in the Hands wear slot on the `hands` Appearance slot, so gloves never displace back/accessory items (Accessory wear slot still beats Back on the accessory layer).
**Old saves / appearances:** persist `APPEARANCE_HANDS_MIGRATIONS` (in `DEFAULT_MIGRATIONS`) widen 8-wide Appearance rows (with or without `version`) for chunk rows and player records, hands = 0; the SetAppearance wire already carries its slot count and pads. Wardrobe / creator / random looks iterate `WEARABLE_SLOTS` (no hands starter parts: gloves are `gear`-locked).
**Exact mapping:** `data/wear_cosmetics.json` gains `items` (item key → wearable key), resolved before `families` by `wearableKeyFor`; the client passes its catalog so an exact key whose art is not in the pack falls back to the family. Today every `items` entry is a **placeholder equal to the family wearable**; when Art lands a variant, point `items[key]` at it. `artTodo` lists the planned key per item (`<slotprefix>_gear_<itemKey>`, prefix = Appearance slot: hat_/top_/bottom_/shoes_/hands_/acc_ (back)).
**Art needs (wearable keys to draw, per item/tier/slot):** `hat_gear_straw_hat` (head, t1, item `straw_hat`, placeholder `hat_straw`); `hat_gear_linen_cap` (head, t1, item `linen_cap`, placeholder `hat_cap`); `hat_gear_rain_hood` (head, t2, item `rain_hood`, placeholder `hat_hood`); `hat_gear_fur_hat` (head, t2, item `fur_hat`, placeholder `hat_fur_hat`); `top_gear_linen_shirt` (torso, t1, item `linen_shirt`, placeholder `top_tee`); `top_gear_padded_jacket` (torso, t2, item `padded_jacket`, placeholder `top_puffer`); `top_gear_fur_coat` (torso, t3, item `fur_coat`, placeholder `top_puffer`); `top_gear_raincoat` (torso, t2, item `raincoat`, placeholder `top_raincoat`); `top_gear_oilskin_coat` (torso, t5, item `oilskin_coat`, placeholder `top_raincoat`); `bottom_gear_linen_trousers` (legs, t1, item `linen_trousers`, placeholder `bottom_jeans`); `bottom_gear_padded_trousers` (legs, t2, item `padded_trousers`, placeholder `bottom_cargo`); `bottom_gear_fur_leggings` (legs, t3, item `fur_leggings`, placeholder `bottom_leggings`); `bottom_gear_waxed_trousers` (legs, t2, item `waxed_trousers`, placeholder `bottom_cargo`); `shoes_gear_reed_sandals` (feet, t1, item `reed_sandals`, placeholder `shoes_sandals`); `shoes_gear_leather_boots` (feet, t2, item `leather_boots`, placeholder `shoes_boots`); `shoes_gear_fur_boots` (feet, t3, item `fur_boots`, placeholder `shoes_hiking_boots`); `shoes_gear_rubber_boots` (feet, t5, item `rubber_boots`, placeholder `shoes_rain_boots`); `hands_gear_cloth_gloves` (hands, t1, item `cloth_gloves`, placeholder `acc_cloth_gloves`); `hands_gear_leather_gloves` (hands, t2, item `leather_gloves`, placeholder `acc_leather_gloves`); `hands_gear_fur_mittens` (hands, t3, item `fur_mittens`, placeholder `acc_fur_mittens`); `acc_gear_fur_cloak` (back, t3, item `fur_cloak`, placeholder `acc_cape`); `acc_gear_reed_satchel` (back, t1, item `reed_satchel`, placeholder `acc_backpack`); `acc_gear_leather_backpack` (back, t2, item `leather_backpack`, placeholder `acc_backpack`); `acc_gear_frame_pack` (back, t3, item `frame_pack`, placeholder `acc_backpack`); `acc_gear_tactical_pack` (back, t5, item `tactical_pack`, placeholder `acc_backpack`); `hat_gear_bone_helmet` (head, t1, item `bone_helmet`, placeholder `hat_helmet`); `top_gear_bone_cuirass` (torso, t1, item `bone_cuirass`, placeholder `top_vest`); `bottom_gear_bone_greaves` (legs, t1, item `bone_greaves`, placeholder `bottom_cargo`); `shoes_gear_bone_boots` (feet, t1, item `bone_boots`, placeholder `shoes_hiking_boots`); `hands_gear_bone_gauntlets` (hands, t1, item `bone_gauntlets`, placeholder `acc_gauntlets`); `hat_gear_bronze_helmet` (head, t2, item `bronze_helmet`, placeholder `hat_helmet`); `top_gear_bronze_cuirass` (torso, t2, item `bronze_cuirass`, placeholder `top_vest`); `bottom_gear_bronze_greaves` (legs, t2, item `bronze_greaves`, placeholder `bottom_cargo`); `shoes_gear_bronze_boots` (feet, t2, item `bronze_boots`, placeholder `shoes_hiking_boots`); `hands_gear_bronze_gauntlets` (hands, t2, item `bronze_gauntlets`, placeholder `acc_gauntlets`); `hat_gear_iron_helmet` (head, t3, item `iron_helmet`, placeholder `hat_helmet`); `top_gear_iron_cuirass` (torso, t3, item `iron_cuirass`, placeholder `top_vest`); `bottom_gear_iron_greaves` (legs, t3, item `iron_greaves`, placeholder `bottom_cargo`); `shoes_gear_iron_boots` (feet, t3, item `iron_boots`, placeholder `shoes_hiking_boots`); `hands_gear_iron_gauntlets` (hands, t3, item `iron_gauntlets`, placeholder `acc_gauntlets`); `hat_gear_steel_helmet` (head, t4, item `steel_helmet`, placeholder `hat_helmet`); `top_gear_steel_cuirass` (torso, t4, item `steel_cuirass`, placeholder `top_vest`); `bottom_gear_steel_greaves` (legs, t4, item `steel_greaves`, placeholder `bottom_cargo`); `shoes_gear_steel_boots` (feet, t4, item `steel_boots`, placeholder `shoes_hiking_boots`); `hands_gear_steel_gauntlets` (hands, t4, item `steel_gauntlets`, placeholder `acc_gauntlets`); `hat_gear_composite_helmet` (head, t5, item `composite_helmet`, placeholder `hat_helmet`); `top_gear_composite_cuirass` (torso, t5, item `composite_cuirass`, placeholder `top_vest`); `bottom_gear_composite_greaves` (legs, t5, item `composite_greaves`, placeholder `bottom_cargo`); `shoes_gear_composite_boots` (feet, t5, item `composite_boots`, placeholder `shoes_hiking_boots`); `hands_gear_composite_gauntlets` (hands, t5, item `composite_gauntlets`, placeholder `acc_gauntlets`); `hat_gear_leather_cap` (head, t2, item `leather_cap`, placeholder `hat_leather_cap`); `top_gear_leather_jacket` (torso, t2, item `leather_jacket`, placeholder `top_flannel`); `bottom_gear_leather_trousers` (legs, t2, item `leather_trousers`, placeholder `bottom_jeans`); `top_gear_wool_sweater` (torso, t2, item `wool_sweater`, placeholder `top_sweater`); `hat_gear_wool_hat` (head, t2, item `wool_hat`, placeholder `hat_beanie`); `top_gear_fur_vest` (torso, t3, item `fur_vest`, placeholder `top_vest`); `shoes_gear_snakeskin_boots` (feet, t2, item `snakeskin_boots`, placeholder `shoes_boots`).
**Tests:** packages/assets/test/hands_slot.test.ts (real pack: gloves are hands-slot, layer order with tee + cape), packages/persist/test/appearance_hands.test.ts (8 → 9 migration), packages/gameplay/test/xp_equip.test.ts (gloves + cloak/backpack, exact-vs-family fallback, table coverage).

## ADR-138: Sharded customization manifest (v2 index + per-category shards)
**Problem:** `packages/assets/pack/customization/manifest.customization.json` reached ~57 MiB (59,732,898 B). GitHub warns at 50 MB and rejects files over 100 MB; every new wearable grows it further.
**Decision:** split it into per-category manifest shards that loaders merge. **Git LFS rejected:** the game is served from GitHub Pages, which does not serve LFS content.
**Format:** `manifest.customization.json` becomes a small index `{"version":2,"name":"customization","shards":[{"category","file","bytes","sha"(sha256 hex)}...]}`; shard paths are relative to the index. Each shard is a v1 fragment with the unchanged entry schema: one shard per wearable slot (`hair`, `hat`, `top`, `bottom`, `shoes`, `accessory` (back/acc), `face`, `eyes`, `hands`) holding the slot's wearables plus the sprites/atlases only they reference, and `base` (bodies, palettes, bodyTypes, requiredSlots, faceAnims, tintNeutral, and any shared/unreferenced sprite or atlas). Every shard must be ≤ 20 MiB (`MANIFEST_SHARD_MAX_BYTES`); an oversized category is split by wearable into numbered parts (`manifest.customization.hat.1.json`, `.2`...).
**Loading:** `@engine/assets` `resolveManifestShards(json, load)` passes v1 through and, for v2, fetches all shards in parallel (`Promise.all`) and merges with `mergeShards` (keyed arrays concatenated in index order, records unioned, scalars must agree). Unlike `mergeManifests` (first wins), a key in two shards is an error (`ShardMergeError`). The client (`apps/client/src/view.ts`) resolves each fragment before the ADR-081 merge, so the merged manifest — and therefore streaming, residency, and ids.lock.json — is unchanged. Node: `readManifestJson(path)` (`@engine/assets/node`, or `@engine/assets/read-manifest` for jsdom tests); `loadManifestFile`, write-lock-pack, check-sub-manifests and all tests use it. Python art tools load/save through `packages/assets/scripts/cz_manifest.py` (save writes the merged file and re-shards). vite.config.ts serves/copies `manifest.customization.*.json`.
**Tooling:** `pnpm art:shard-manifest [file]` converts a v1 file (or re-shards a v2 index), removes stale shards and verifies the round trip. `pnpm art:check-manifest-size` and `packages/assets/test/manifest_shards.test.ts` (in `pnpm check`/CI) fail if any `manifest*.json` under packages/assets or assets/ is over 20 MiB, and check index bytes/sha, parallel fetch, and duplicate-key errors.
**Initial shards:** base 0.71, hair 9.38, hat 6.82, top 14.35, bottom 6.29, shoes 6.28, accessory 3.88, face 3.54, eyes 2.43, hands 3.26 MiB; index 1.8 KB.

## ADR-139: Cross-device QA pass (phone / Xbox pad / desktop) fixes
**Context:** a headless QA pass on phone (412x915 touch), Xbox Edge (pad) and desktop (KBM) found blockers and UX bugs.
**Decisions:**
- **Character creator:** the panel is a wrapping *row* (it was a column, which wrapped sideways on phones and put "Enter world" off-screen). The sticky footer stays inside the scroll padding. Gamepad **Start = Enter world** (it used to take ~34 D-pad presses); a blank name still shows the prompt and focuses the name field.
- **Gamepad menus:** the profile's `ToggleInventory` (Select tap), `ToggleCrafting` (LB+Select) and `OpenChat` (RB+Select) had no consumer, and UINav made Select open pause. Now `padMenuAction` maps them to inventory, crafting and chat. Select also closes an open inventory. Pause is Start only.
- **Held buttons:** UINav ignores pad buttons that are still held when it is created, and ignores the pad while a boot screen (`[data-boot]`) is up. Before this, the Start press that left the creator opened pause on the first frame.
- **Crafting list:** each recipe shows its output item's icon. Recipes that make the same output are labelled with their first distinct ingredient, e.g. "Hoe ×1 (bone)".
- **Pause menu** no longer lists context-only menus (`station`, `camper`); those open only from interacting with the station. **Chat** has a single close control (the header ✕).
- **Bot names** are unique per world: the seeded offset is followed by the slot index. The RNG draw is kept, so trait rolls do not change.
**Not changed:** party invites need the invitee to be nearby ("online, not nearby"). That is by design.

## ADR-140: Dev sandbox and second QA pass fixes

- **Status:** accepted (2026-10-25)
- **Decision:** `?dev=sandbox` (singleplayer) and `DEV_SANDBOX=1` (server) spawn players with `SANDBOX_KIT`, which is sized to fit the 16-slot, weight-capped inventory. It is off by default and has no effect in production builds or on servers without the env var.
- `EquipCmd` is appended to `GAMEPLAY_NET_COMMANDS`, which is append-only. Tapping a weapon or tool now equips it online instead of showing "Not connected."
- Client `sendIntent` no longer converts entity args to NetIds itself, because `NetClient.sendCommand` already maps `def.entityFields`. Doing it twice broke party and clan invites and kicks online. See `intentPayload`.
- An invalid build ghost now shows a reason (`buildFailText`).
- The canvas, HUD, touch overlay and build HUD get `-webkit-touch-callout:none` and `user-select:none`.
- Chat and provenance show "Unknown survivor" for senders who have no name, instead of `#id`.

## ADR-141: QA pass 3 — context-only party/clan actions, station rendering, unlit campfire

- **Party roles are networked** (`PartyRank`), so the client shows Kick/Invite only to the leader. Members see only "Leave party".
- **Clan roster buttons are context-only** (`clanMemberActions`). Promote and Demote are leader-only. Kick needs the leader rank, or the rank's `kick` permission plus a higher rank than the target. Invite and goal follow the rank's permissions. Buttons are hidden, not shown disabled.
- **A free-standing placed station is drawn by its own kind** (`isFreeStandingStation`). Before this, a placed workbench or anvil was drawn as a bonfire, so E near it seemed to open nothing.
- **Clients rebuild the spatial index before the crafting view**, so a station shows its own recipes instead of greyed-out ones.
- **An out campfire draws unlit logs.** The bonfire building gained an `unlit` state, and spawned fires pick the `unlit` frame.
- **Workbench "wouldn't place":** not a bug. The failure reason showed the spot was occupied.

## ADR-142: QA pass 4: rotate ghost, snapping/signs over MP, stalls, touch and gamepad core loop

- **Rotating the ghost no longer makes it vanish or show "Too far away".** The snap target is clamped to reach minus `SNAP_REACH_MARGIN` (0.75), and the ghost uses ground z. Rotation is kept when the piece is placed, on R, the bumpers, and the touch rotate button.
- **Input:** a tap latch, so presses shorter than a frame still register. Mouse movement counts as activity. D-pad focus moves by the gap between rects. The focus ring shows only during nav. Touch controls are clamped 4px from the screen edges. The narrow build HUD sits below the top bar.
- **The connect overlay hides while connected.** Before this, it covered the HUD.
- **Market stalls (blanket, cart, booth, pavilion, counter) can stand on bare ground.** The sandbox kit now carries cloth and fiber.
- **Opening a stall on a replica client no longer crashes.** Listings, till, and stock are viewer-scoped, so the stall view and menus tolerate them being missing.
- Verified with two clients: sign text and road tiles replicate. Pressing E at the anvil opens the forge recipes.
- Not verified: a second client buying from a stall, movement speed in the browser (headless runs at about 6 fps), and gathering and crafting with a gamepad.

## ADR-143: Stall browsing must register the viewer; owners view the till

- Context: QA pass 5 found that a second client within 2.5 tiles could open a stall's panel but saw no listings. The client's `openStall()` never sent `OpenStallCmd`, so the buyer never joined the viewer-scoped `Listings`/`Container` replication. The till was also never viewed, so the owner's till always looked empty and "Collect till" stayed disabled.
- Decision: The client now sends `openStallIntent(stall)` when it opens a stall. The server's `openStall` adds a viewer only once. If the actor may `collect`, it also adds them as a viewer of the till container, creating `ContainerViewers` when needed. `closeStall` and switching stalls drop the till viewer (`leaveStallTill`).
- Verified over two live clients: the buyer saw the listing and bought it (Stone +1, Sticks −1), the owner's till showed the payment, and Collect moved it to the owner's inventory. With the gamepad stub, RT-hold gathers, LB+Select opens crafting, the D-pad moves focus, A queues a craft (inputs consumed) and B closes the menu.
- Note: Select-tap (inventory) uses a 250 ms tap window. Below about 6 fps (headless swiftshader), a 3-frame press goes over that window. This comes from the test environment and is not a bug.
- Tests: apps/client/test/adr143_stall_open.test.ts and the ADR-143 case in packages/gameplay/test/economy.test.ts.

## ADR-144: Interactive tutorial (guide)
- Context: New players had no in-game help on controls, survival or the social menus.
- Decision: `apps/client/src/tutorial/` holds a 36-card guide. `steps.ts` is pure: it lists the steps and `TutorialProgress` (save/resume in `localStorage["survivaz-tutorial-<slot>"]`, status active/done/skipped). `labels.ts` builds control chips from the live InputSystem bindings and pad layout, so a rebind changes the text, and nothing is hardcoded. `probe.ts` turns game state into counters: moved, sprint, zoom, gain, gainLog, eat, craft, tool, build, rotate, place and menu:<id>. "Do" steps move on when their counter grows past the value it had when the step began. Info steps wait for Next. `overlay.ts` draws one compact card plus a spotlight ring and arrow. `placeCard` picks the spot that overlaps least with the target (weighted ×100) and with the HUD, menu bar, touch controls, build HUD and open panel.
- Start: the guide starts the first time a NEW character enters a world (the boot menu found no saved character), or with `?tutorial=1`. It resumes while its status is active. It can be skipped (✕ or Pause → Skip the guide) and replayed from Pause or Settings ("Play the guide again").
- Input: the card rebuilds when `input.onDeviceChange` fires. On info cards, Jump (Space / pad A) means Next and pad B means Back. Neither works while a menu is open. Touch uses large buttons. The card updates at 4 Hz, and its DOM only rebuilds when the step or device changes. TV-size screens get a larger card.
- Verified in headless Chrome: desktop 1280×720, a 390×844 touch phone and 1920×1080 with a gamepad stub. The build → rotate → ghost steps advanced live, and the card never overlapped its target or the open panel.
- Follow-up (touch, gamepad, live run): on touch the Move card shows a ghost joystick (`#tutorial-ghost`, dashed circle, animated knob, "Drag here") in the left stick zone, and the spotlight ring targets it while no real stick is on screen (steps opt in with `ghost: "joystick"`). On gamepad, action cards say "Stuck? Hold Y to skip" with a fill bar; holding Reload (Y) for 1 s calls Next, and the button must be released before it can skip again (no chain skips).
- Live sandbox run on desktop (headless Chrome, 1024×576): walk, sprint, zoom, gather by hand, open the bag, eat, craft a Stone Axe, equip, chop, build mode, rotate, place a real campfire, then E on it opens the station card. Fixes from that run: the 16-slot sandbox kit filled the bag, so every craft sat at "Paused 0%" (the kit now leaves 2 slots free; trousers/boots dropped); "place" counted the `gameplay.place` command even when the server refused it ("Spot taken"), so it now counts only a build piece that really appears within ~12 tiles while build mode is on (`ProbeSample.pieces`); sprint distance counts if either sample was sprinting. `__qa` (sandbox only) gained `tutProbe`, `nodes()` (with resource key and tool) and `hint()`.
- Tests: apps/client/test/adr144_tutorial.test.ts.

## ADR-145: Crisp animals and the pets system

**Crisp animals (cause and fix).**
- Cause: animal sheets were never in the hot atlas tier. `animals_large` was even matched by `COLD_ATLAS_RE`. Under VRAM pressure the atlas manager's idle-downscale halved them first. They were then magnified with plain bilinear filtering on WebGL2 (soft and blurry). On Canvas2D they were drawn at fractional device-pixel origins, so texel columns came out uneven and smeared, which was worst at phone DPR 3.
- WebGL2: `animals` joins `HOT_ATLAS_RE`, and `animals_large` leaves the cold list. `CRISP_ATLAS_RE` (`^(animals|pets)_`) sheets are skipped by idle-downscale. Their instances carry the render-internal `CRISP` flag (1024). The fragment shader's `crispUv` does sharp bilinear: it samples the texel centre inside a texel and blends only across a ~1 device px seam when magnified. That gives crisp edges at any non-integer zoom or DPR with no shimmer. Minified sprites are left to the mips.
- Canvas2D: sprite origins are snapped to whole device pixels (`snapPx`), and smoothing stays off when magnified.
- VRAM: the measured sandbox resident set was unchanged (~127 MB). Creature sheets are small, and only these are exempt from downscale.
- Art sizes: author creatures at 1× = 64×64 px cells for small animals (cat, birds, rabbit, ferret, chicken, dachshund, beagle) and 96×96 px for large dogs (lab, husky, shepherd), with a 2× (`@2x`) sheet for DPR ≥ 2. Use whole-pixel outlines and no sub-pixel AA on edges.

**Pets (data-driven, `packages/gameplay/data/pets.json`, `src/pets.ts`).**
- Species (13): dachshund, labrador, husky, german shepherd, beagle; tabby, siamese and black cat; parrot, crow, chicken, rabbit, ferret.
- Treats (6): dog biscuit, meaty chew, fish treat and egg crunch (campfire); seed mix and veggie bites (by hand).
- Each species has a love/like/ok/hate preference per treat that sets the tame chance. A hated treat is refused and kept; a failed try uses the treat.
- Taming (`PetOfferCmd`): players and AI humans (survivor `tame_pet` behaviour) can tame. A tame adds `Pet` (owner PlayerId, name, species, level, xp, hp, fullness, loyalty, cmd, stay post), `Tamed` and a 6-slot `Container` bag. Only the owner can open the bag (other players get Locked), rename it (`PetRenameCmd`, sanitized, max 16) or command it (`PetCommandCmd`).
- Hunger: 4 per minute. Below 60 the pet eats from its bag, then from food on the ground (non-permanent loot bags within 6 tiles that are unowned or the owner's), then from the owner's `pet_trough`.
- `pet_trough` is a new buildable container. `TroughOwner` is set on placement.
- Starving: −HP every 10 s, floored at 1, plus lost loyalty. A pet never dies of hunger. Well fed pets regenerate slowly.
- Follow: keeps up with the owner (teleports when far), defends the owner, and fetches items the owner drops into its bag.
- Stay: holds its post and defends itself, the owner, the owner's structures and the owner's other pets. Attackers are remembered from `Damaged` / `PieceDamaged` events for 15 s.
- Defence takes priority over eating, so a hungry pet still fights back.
- XP comes from hits and kills. The XP curve is base 20 × 1.35^level, up to level 20. Each level raises max HP, damage and speed.
- A dead pet (combat only) drops its bag contents for the owner.
- Persistence: `Pet`, `Tamed` and the container are persistent. Health is rebuilt from `Pet.hp` and level after a load.
- Replication: `Pet` is networked. `PetEventEvt` (tamed, refused, shied, fed, level up, renamed) goes to the owner only.
- Client:
  - Interact (E / pad X / touch context button) on a pet or tameable animal opens the Pet panel. It shows HP, fed, trust and XP bars, Follow / Stay / Rename, treat offers with chances, and the bag grid (take) plus pack grid (give).
  - Rename uses the sign editor ("Save name"), with the on-screen keyboard on gamepad.
  - Pets show world HP bars and hit reacts. The inventory panel's "Drop items…" section lets the pet fetch.
  - Help text is in the panel and the help menu (`PET_HELP`) and does not depend on the tutorial.
  - Placeholder sprites come from `sprite_fallbacks`.
- Sandbox: a pet corner on join (a dachshund, tabby and parrot, plus a permanent treat crate).
- Tests: packages/gameplay/test/pets.test.ts, packages/persist/test/pets145.test.ts.

## ADR-146: Container commands over the network; permanent bags

- `OpenContainer`, `CloseContainer`, `Deposit` and `Withdraw` were never in `GAMEPLAY_NET_COMMANDS`, so panel container taps silently did nothing online and in the in-tab server (send returned false). They are now appended (append-only ids). Their `target` fields are remapped client→server entity ids, and they run through the input queue like every other command.
- Closing the Pet panel sends `CloseContainer`, so the pet's bag stops being "the open container" and the pack panel returns to normal. `openContainer()` (client "which container is open") ignores pets, whose bags show only in the Pet panel.
- `PERMANENT_BAG` (`LootBag.despawnAtTick === 0xffffffff`) marks caches like the sandbox treat crate. Pets never eat from or fetch those.

## ADR-147: Singleplayer prediction stamina snap
Rubber-banding in SP came from client prediction reconciling against stamina quantised to 16 bits by the server snapshot, so predicted sprint/walk diverged and was corrected. Prediction now uses the same snapped stamina; walk 2.6 / sprint 4.2 and normalised diagonals unchanged. Test: adr147_sp_prediction.test.ts.

## ADR-148: Startup/tutorial hitch removal
Page LRU now uses residency/margin hysteresis (no evict/reload thrash), GPU readbacks use async PBO+fence with orphaned buffers, page uploads are gated to 2/frame (bypassed for prio 0 and while settling). The black-frame check skips settle-held frames (was a false "World rendered black"). No quality reduction.

## ADR-149: Pet sheets get full mip tail
`pets_*` sheets were uploaded with 1 mip level, so heavily minified 704px sheets looked blurry/aliased. Stream pools holding pets now force OWN_MAX_LEVELS (3).

## ADR-150: Scored tutorial card placement
Tutorial cards are scored against target, player zone (x1) and avoided UI (hotbar, touch controls, HUD, tool bar; x20), are pointer-events:none except buttons, and are compact on phones. Test: adr150_tutorial_place.test.ts.

## ADR-151: Faster player melee
Melee felt sluggish. All weapon melee cooldowns in items.json scaled x0.65 (rounded to 0.05 s, floor 0.3 s), fists 0.6 -> 0.4 s. Both client prediction and server authority read the same gameplay data in combatSystem, so swings are never rejected. Each swing restarts the Punch/Attack anim, which settles after PLAYER_SWING_TICKS = 6 (0.3 s, was 8); the client flinch HIT_REACT_MS is 320 -> 260 ms, so flinches don't stack at the fastest rate. Test: adr151_melee_speed.test.ts.

ADR-150 addendum: the target (with the 10 px spotlight ring) is weighted x1000 and both screen edges are scanned in 8 columns, so tight phone-landscape steps (sprint, skills-info) no longer touch the Run button; measured 0 overlaps on all 4 layouts.

## ADR-152: Low props never auto-fade (the tutorial "shadowy blob")

**Context.** The translucent green smudge in front of the player in the tutorial was the player-built campfire (bonfire sprite, furniture atlas).
Its frame is 128 px with an anchor at 0.75, so its frame-anchor height is 96 px. That is above the 40 px occlusion threshold, while the art is only about 33 px tall.
Occlusion therefore faded it to 0.35 alpha whenever the player stood behind it. Its atlas also never registered as in use, so it stayed in the cold x0.125 tier as a mosaic.

**Decision.** The free-standing campfire carries an explicit `Occluder{fade:1}`, so it never fades. Build pieces in `LOW_PROP_PIECES` get the
`ROT_NO_OCCLUDE` (0x40) rotation bit, and the piece occlusion test skips them. Sprites with a never-fade Occluder mark their atlas as used, so it is promoted out of the cold tier on the next retier.
The hot-tier scale measured unchanged on the 160 MB budget (hotMin 0.5, 500 hot atlases, before and after).

## ADR-153: Death screen, reliable respawn, bed respawn, bag compass

**Context.** Players who died stayed dead. The server and the in-process singleplayer server both handled `gameplay.respawnPlayer` (ADR-106 pvp). The client had no death UI, though, and nothing ever sent the command. A dead player could only reload the page. In the tutorial the guide card stayed on screen over a dead character, and there was no way back into the step. Separately, the bed/claim respawn hook (`setRespawnLocator`) was never installed, so respawn ignored beds and could put the player at another world spawn point hundreds of tiles from their bag.

**Decision.** `apps/client/src/death-screen.ts` shows a full-screen "You died" card while the local player has `Dead`. It sits at z 90, above the tutorial (45) and menus. Menus and build mode close on death, and gameplay input is ignored. The Respawn button counts down `PVP.respawnSeconds` (+0.4 s of slack), then sends `gameplay.respawnPlayer`. It works with mouse or touch click, keyboard (Enter / Space / R), and gamepad (A / Start, edge-triggered). If the player is still dead 1.5 s after a press, the button re-arms. The tutorial card is hidden while dead, and the tutorial step is kept: progress is client-side and is never reset by death. After respawn, a `#bag-compass` pill points at the player's newest `LootBag` (`deathBagsOf`). When the bag is outside the area of interest, the pill points at the remembered death spot instead. The server installs `installBedRespawn`. It respawns beside the nearest bed the player placed (`PieceOwner`). With no bed, it uses the world spawn point nearest the death spot (+ jitter), so a tutorial or new player comes back to their start area next to their bag. Vitals are reset as before (pvp.json: 50 % HP, 60 hunger / thirst, full stamina). The bag stays at the death spot with its items.

## ADR-154: Streaming no longer stalls the frame (frame-table row uploads, no per-page-in glGetError on big budgets)

**Context.** PC and console play was choppy. CPU profiles were taken over 42 s of scripted walking, sprinting and fighting near animals and AI, from CDP in headless Chrome with ANGLE/SwiftShader.
They showed that streaming sheet page-ins (creatures and wearables) drove two per-upload costs:
1. `beginFrame` re-uploaded the RGBA32F frame table from the lowest to the highest dirty row. Each row is 32 KB and the table has 198 rows, so two far-apart sheets paging in the same frame re-sent most of the table. That was 929 rows in 42 s at the desktop budget and 2066 rows at the 160 MB budget.
2. Every page-in called `glGetError` twice. Each call is a synchronous round trip to the GPU process that drains the pipeline, a classic hitch on Windows and Xbox ANGLE/D3D11.

**Decision.** Track dirty rows individually and upload only the contiguous runs. In the same scenario that is 106 rows instead of 929 at 768 MB (8.8x less), and 193 instead of 2066 at 160 MB (10.7x less).
`syncChecks` (the per-page-in getError) stays on only for budgets under `SYNC_CHECK_MAX_MB` (384, mobile/lowmem), where lazily committed OOM must free the exact slot. Larger budgets rely on the watchdog's async, once-a-second check.
Graphics quality is unchanged.

**Consequences.** Frame-time effect on real GPUs still has to be confirmed on hardware. SwiftShader moves GPU cost into whichever call syncs first, so its fps is not representative.

## ADR-155: Camera z eases across terrain height steps

**Context:** On PC and console, walking felt choppy. Profiling at 320x180 while holding a direction showed the camera moving at a steady 87 px/s, with bursts of about 330 px/s (3.8x) lasting 2–3 frames every ~10 frames. Prediction corrections and snaps were both 0. Those bursts lined up with the camera target's z jumping by a full terrain step: `groundZ` lifts an entity onto stepped tile heights, and `camera.lookAt` projects z onto screen y. So every tile-height boundary jerked the whole screen.

**Decision:** The view eases only the camera target's z with an exponential filter (`CAM_Z_TAU` = 0.15 s). It snaps when the jump is larger than `CAM_Z_SNAP` = 4 (a teleport or respawn). The camera's x/y stays exact, and sprites still stand on their own steps.

**Result:** Same 10 s walk: camera speed coefficient of variation went from 0.54 to 0.095, and the peak went from 332 to ≤157 px/s. Graphics and movement speeds are unchanged.

## ADR-156: Creature sheets resident on budgets of 384 MB and up (128 MB since ADR-237)

**Context:** At the PC texture budget (768 MB), a 42 s walk/sprint profile streamed creature and pet sheets in and out. Those sheets (62 small sheets, about 4.8 MPx) caused 23–32 page-ins and evictions per run, and each one meant a texture upload plus frame-table rows, which showed up as hitches.

**Decision:** On budgets of `RESIDENT_CREATURE_MIN_MB` = 384 MB or more, `pets_*` and `nature_critters_*` sheets load resident and hot at full resolution, outside the stream pool. Smaller budgets (mobile and safe) keep streaming them, so they keep the same hot-tier floor as before.

**Result:** Same 42 s profile at 768 MB: page-ins went from 23–32 to 8–10 (only wearables' first loads remain), and frame-table row uploads went from 87–121 to 55–64. No quality drops anywhere: creatures are now always full-res on PC.

## ADR-157: Allocation-free per-frame view reads

**Context:** A sampling heap profile (including objects collected by minor and major GCs) of the 42 s PC-budget run showed the client allocating about 22 MB/s. The view's per-frame mirror loop made the biggest share: about 12.7k `World.get()` calls per frame, and each one builds a fresh dictionary object (Transform 3.7k, ResourceNode 1.5k, HitReact 1.4k, PrevTransform 1.1k, Sprite, Health and others). On top of that, `groundZ` built two chunk-key strings per entity per frame. GC time in the CPU profile stayed small (0.3–0.4%), but minor-GC pauses are frame-time jitter on real hardware.

**Decision:**
- `World.getInto(e, def, out)` / `ComponentStore.readInto` fill a caller-owned object with scalar fields.
- The view reads Transform and PrevTransform straight from the typed arrays into scratch objects (`readXform`).
- Single-field reads use `getField`.
- VWet/VTemp are written only when they change.
- `groundZ` has a one-entry chunk cache that is reset every view frame.

**Result:** Same work (normalised by the unchanged `query` cost), the view render subtree allocated 326 MB before and 208 MB after (-36%). get() plus groundZ allocation went from 169 MB to 53 MB (-69%). Rendering is unchanged.

## ADR-158: HUD DOM writes only when values change

**Context.** Per-frame HUD code (death screen + bag compass, tool hint, XP chip, pickup toasts, world-tools buttons) re-assigned identical hidden/dataset/text/style values every frame: ~12.2 DOM mutations/frame, ~1 layout + 2 style recalcs per frame while walking (headless perf2 hud.mjs, 20 s walk).

**Decision.** `apps/client/src/dom-diff.ts` helpers (setHidden/setData/setText/setAttr/setStyle/setDisabled) compare before writing; the hot writers use them. Behaviour is unchanged (same values, same elements); canvas drawing untouched.

**Result (hud.mjs, 20 s walk).** Mutations 14510/1185 frames (12.2/f) → 362/1739 frames (0.21/f); layouts 1224 → 352, style recalcs 2424 → 367; layout 83 → 28 ms, style 132 → 14 ms. Real-browser/Xbox Edge confirmation of frame-time spikes still needed.

## ADR-159: no watchdog glGetError on desktop/console budgets; frame pacing audit

**Context.** The ADR-148 blank-frame watchdog still called `gl.getError()` on every collected readback (~1/s), a synchronous GPU-process round trip (3 calls = 211 ms in headless swiftshader at BUDGET=768).

**Decision.** That check is gated on `atlas.syncChecks`, which is off at budgets ≥384 MB (ADR-154). Low budgets keep the OOM check. Audit, no change: frame() uses the rAF timestamp, clamps dt to 250 ms, and FixedLoop interpolates with alpha = acc/dt (backlog drop after 5 steps). The draw path is already batched (~11 instanced draws + 5 element draws, 8 programs, 17 texture binds per frame), so no batching change. SP server: it runs in a Worker by default (ADR-105); forcing `?worker=0` drops headless fps 16.1 → 5.1 and raises p99 from 134 to 365 ms, so the Worker default matters and must stay.

**Result.** getError 3 → 0 per 42 s walk; the frame-time effect needs confirmation on a real GPU and on Xbox Edge.

## ADR-160: bare-handed loot bags (zombie loot, Interact / primary open, Take all)

**Context.** Zombie archetypes in ai.json had loot tables, but nothing dropped them: corpseSystem only removed corpses. No input opened a loot bag. Interact only opened stall, station, pet and wardrobe panels, and Primary only attacked or gathered.

**Decision.**
- **Zombie loot:** corpseSystem rolls the zombie's ai.json archetype loot once per corpse (`dropZombieLoot`, rng `zombie.loot` per entity) into an ownerless LootBag that despawns after 120 s, the same as animal loot.
- **Interact (E / pad X / touch interact):** `interactPanel` returns `{panel:"loot"}` for the nearest LootBag in `containerReach` when it is at least as close as any station or pet. The client sends OpenContainer and shows the bag in the inventory panel.
- **Primary (mouse click / pad RT / touch tap):** the server's Gather fallback opens a bag (`handLootTarget`) when no melee foe is in reach and the bag is closer than the nearest node. The client opens the inventory panel when a newly opened LootBag replicates to it.
- **Take all:** a "Take all" panel button sends Withdraw with item 0, which moves every stack that fits.
- **Gates:** no tool or equip check. The existing gates still apply: canLootBag's owner-only window and container reach.

**Result.** Zombie, animal, player and bot death bags, dropped stacks and sandbox crates all open and empty by hand (adr160_hand_loot.test.ts).

## ADR-161: world labels for loot bags and dropped items

**Context.** Players could not tell a dropped stack, a zombie bag or a death bag from scenery. Bag contents (Container)
replicate only to viewers, so clients cannot name a bag they have not opened.

**Decision.**
- New networked component `LootSummary {item:u16, count:u16, stacks:u8, source:u8}` (appended last to
  GAMEPLAY_COMPONENTS, replicated to "all"). `source` is a LootSource tag (Zombie, Animal, Death, Dropped, Crate)
  set at creation via `tagLootSource` (zombie / animal / death / pet bags, dropItem, thrown weapons); untagged bags are
  inferred (permanent ownerless = Crate). Postsim `gameplay.lootSummary` (every 10 ticks) recomputes top item / count /
  stacks and writes only on change.
- Text (`lootLabelText`): one stack = "Wood ×4"; Zombie loot; Death bag / "Your bag" for the local owner; Supply crate;
  otherwise "<top item> +N more" or "Loot".
- Client `loot-labels.ts`: one pointer-events:none 2D overlay canvas (no per-label DOM, no layout; idle frames do no
  canvas work, per ADR-158). Labels within 12 tiles, nearest first, merged when closer than 46 css px ("(+2 bags)"),
  at most 14. Each bag gets a soft pulsing gold ground glow. The nearest bag inside containerReach shows the
  Interact prompt for the active device ("[E] Open", the gamepad binding label, or "Tap ✋ to open"). Labels are 13 px or
  larger so they stay readable at 1080p, and they hide while a menu is open or build mode is on.

**Result.** Tests cover the summary and source tagging, inference and refresh, the label text, merge and cap, the
client range filter and "Your bag", and the device prompts. Not done: owner names for other players' bags (player
names do not replicate) and labels for bags on upper floors (they use the bag's z, so they work but have not been
checked visually).

## ADR-162: Small decor on flat surfaces

**Context.** Players want vases, candles, lamps, books and similar small decorations to sit on tables, counters, desks, shelves and other flat-topped pieces, and to rotate them there.

**Decision.**
- `pieces.json` gains `"small": true` (14 hand-sized decor pieces) and `"surface": { "height": h }` (tables .8, workbenches .85, counters/cabinets/dressers .9, coffee tables .45, side tables .6, shelves 1.2, decor crate .7) → `PieceDef.small` / `PieceDef.surfaceHeight` (validated 0 < h < 1.5).
- Small decor (occupancy layer 3) already shares tiles with furniture (layer 2). `building/surface.ts`: `surfaceHeightAt` reads the layer-2 occupant of the tile at that level from the StructureIndex (works identically on server and client replica, so the ghost and the server agree); `smallPieceZ = level*levelHeight + surface height`.
- `snapPlacement` lifts small pieces' `pos.z` (ghost preview snaps to the top). `validatePlacement` treats a small piece over a surface as supported (no deck needed) and `supportsAt` lists the surface piece as its support, so stability follows the table. Rotation is the normal Free-piece rotation.
- `placePiece` re-derives z for small pieces, so persistence needs **no format change** (decode rebuilds through placePiece; surfaces precede decor by entity order, and placing a surface re-seats decor already on its tiles via `reseatSmallOn`).
- `destroyPiece` of a surface re-seats its decor to the floor (server-authoritative Transform z, replicated as a normal static change) and marks it for the integrity pass; decor that only had the surface as support (e.g. a potted plant on a table on bare terrain) collapses.
- Client: build pieces use `pieceGroundZ`: the lift above the level floor is kept on top of terrain steps (`max(z, terrain)` would otherwise swallow it); depth sorting uses that z.

**Consequences.** Only axis tile occupancy matters (a vase on any tile of a 2×1 table sits on it). One small piece per tile. Not covered: stacking decor on decor, surfaces on non-layer-2 pieces.

## ADR-163: build-mode piece actions are bridged net commands

**Context.** In networked play (including the browser's offline sandbox, which runs a local server) build-mode Demolish, Upgrade, Repair and door toggle/lock went through `sendIntent`, but `DemolishCmd`, `UpgradeCmd`, `RepairCmd`, `ToggleDoorCmd` and `LockDoorCmd` were never in `GAMEPLAY_NET_COMMANDS`. `gameplayNet()` threw, `sendIntent` returned false, and nothing reached the server. Their `target` was also missing from `INPUT_ENTITY_FIELDS`, so even a bridged send would have handed the server a raw NetId instead of an entity.

**Decision.** Append the five commands to the end of `GAMEPLAY_NET_COMMANDS` so existing ids do not change, and map their `target` as an entity field. `apps/server/test/adr163_mp_build_loot.test.ts` checks every bridged command. It also runs a real two-client loopback session that covers loot labels on both clients, the owner-only window and then bare-hand take-all, a vase placed over the net on a table with rot 1 on both replicas, and a table demolished through the client command path, which drops the vase to the floor on the server and both clients.

## ADR-164: loot labels in the Canvas2D fallback view

**Context.** The ADR-161 overlay projected labels through `iso.renderer.camera`. When WebGL2 or the art fails, or with `?renderer=debug`, the client draws the Canvas2D debug view, `iso` is undefined, and no labels showed. `?renderer=debug` also threw `Cannot access 'debugCanvas' before initialization`, because `fallback()` runs synchronously before the `let` line, which left the page without a game loop or `__qa`.

**Decision.** `debugCamera(cam, cssW, cssH, dpr)` in `loot-labels.ts` builds a `CameraLike` for the fallback (zoom 1, centred on `worldToScreen(player)`, lifted `tileH / 2 - 12` so it lines up with the fallback's entity dots). `mountLootLabels` uses it whenever `iso` is missing and the fallback context exists. `debugCanvas` is now declared before the renderer boot. A unit test checks that a label sits right over the fallback's bag dot. Browser check: `/workspace/shots/loot_canvas2d_dropped_label.png`.

## ADR-165: Gather and ToggleFire are bridged net commands

**Context.** An audit of every command the client sends through `sendIntent` (panel intents in `packages/gameplay/src/ui` and `sendIntent({ cmd })` in `apps/client`) against `GAMEPLAY_NET_COMMANDS` found two that were never bridged: `GatherCmd` (the touch **Harvest** farm prompt tap) and `ToggleFireCmd` (the campfire panel's **Light / Put out** button). `gameplayNet()` threw, `sendIntent` swallowed it, and the tap did nothing in networked play (including the offline sandbox's local server). Keyboard and gamepad gathering still worked because they use the input bits.

**Decision.** Append both to the end of `GAMEPLAY_NET_COMMANDS` so existing ids stay the same, and map `target` as an entity field. `apps/server/test/adr165_sent_commands_bridged.test.ts` scans the client and UI sources for every `intent(XCmd` / `cmd: XCmd` and fails if any of them is not bridged, so a new panel button cannot fail silently in the same way again.

## ADR-166: draw loot bags (death bags, zombie/animal loot, dropped items, supply crates)
- Bug (live): bags looked like they vanished after dying. They were never drawn. `view.ts` classify had no LootBag
  branch, so a bag showed only its ADR-161 label. Before respawn, the corpse standing on the bag hid that.
- Fix: every `LootBag` entity draws the pack's `death_bag` sprite (`LOOT_BAG_SPRITE`, frame 0, shadow, never an occluder).
- Test: `adr166_bags_visible_after_respawn` covers die -> respawn -> walk back. It checks the death bag, pre-death loot
  and post-respawn loot replicate in SP and in 2-client MP. It also checks that the view routes LootBag to a manifest sprite.

## ADR-167: BackHistory never calls history.back()
- Bug: in the Party panel, Accept or Decline on an invite closes the panel and quickly reopens it. The async `history.back()`
  from the close raced the reopen's `pushState`, so the skip counter went out of step. A later back then left the app (about:blank).
- Fix: closing just disarms. The sentinel entry stays, and a reopen reuses it (`history.state.survivazBack`) rather than
  pushing another one. Browser and Android Back still close the top menu. Side effect: one extra Back press may be needed
  before leaving the page.
- Test: `adr167_back_history`.

## ADR-168: stopped music streams unload cleanly
- Bug: the audit logged `music_explore_*.ogg net::ERR_ABORTED`. When a stream voice was released, `media.src = ""` aborted the
  request. It also fired the element's `onerror` format fallback, so the stopped track refetched the `.m4a` (about 1.8 MB)
  and played it on a disconnected node.
- Fix: release clears `onerror` and `onended` first, then calls `removeAttribute("src")` and `load()`. The ERR_ABORTED left is
  Chrome cancelling the stream on purpose.
- Test: `adr168_music_stream_release`.

## ADR-170: vehicles are drawn, deployable, enterable and switchable on every input
- Bug: the client never drew vehicles (`VehicleView` had no caller). Inventory had no way to deploy a kit. Interact never
  entered a vehicle. `VehicleEngineCmd` and `VehicleHeadlightsCmd` were registered but never bridged. Every car, truck and
  trailer kit (25-800 kg) also overflowed the 60 kg bag, so a crafted kit stayed owed forever.
- Fix:
  - `view.ts syncVehicles` feeds `VehicleView` snapshots, and headlights follow the day clock.
  - The inventory gets a "Vehicles" section with `Deploy <kit>`, which places the vehicle 2.5 tiles ahead.
  - `vehicle-controls.ts`: Interact enters the nearest vehicle or exits it. `Vehicle.Engine` and `Vehicle.Lights` toggle
    `{target, on:2}`, and the `#vehicle-hud` chip shows the state.
  - Bindings: KBM V/F; pad RB+Y/RB+B; touch 🔑/💡 buttons that exist only in the driving layout and do not overlap.
  - World prompts hide while driving. The state commands are appended to `GAMEPLAY_NET_COMMANDS`.
  - Kit weight is capped at 8 kg, as a flat-packed crate.
- Note: `packages/input/scripts/gen-profiles.py` is stale against the JSON profiles, so its output was not regenerated.
  The profiles were edited by hand.
- Test: `adr170_vehicle_controls`. Checked in the browser: deploy → enter → engine/lights → drive → exit on KBM and touch.

## ADR-169: Build.ToggleSnap is a working grid-snap toggle with a chip indicator
- Bug: `Build.ToggleSnap` was bound (KBM G, pad R3, `touch.btn.snap`), but nothing read it.
- Fix:
  - `BuildMode.snap` is on by default. The toggle passes `assist=false` into `buildPreviewFor` when off. When on, it keeps the
    default (facing aim snaps to the nearest valid cell) and also snaps the imprecise gamepad cursor.
  - The build HUD chip has a `[data-bh=snap][data-snap=on|off]` "▦ Snap / ▢ Free" button with a G / R3 hint (tap on touch),
    plus a "Snap on/off" toast.
- Limit: a pointed mouse cell or touch tap is always exact, so a red ghost can still say why. Placement is always
  grid-aligned on the server; `PlaceCmd` has no free-placement flag, and adding one would be a protocol change.
- Test: `adr169_build_snap`. Checked in the browser on touch (shots/audit_snap_touch.png).

## ADR-171: Road tool and sign placement from build mode on every input

**Context.** The road tool and sign placing could only be reached with KBM G/N in Gameplay or from the Road context. Touch had no way in, and gamepad had no road entry. The world tool bar is hidden while building.

**Decision.** Add the actions `Build.RoadTool` and `Build.PlaceSign`, appended to the Build list. They are bound in the Building context to KBM T/N and pad LT+X/LT+Y. The LT modifier shadows the plain X/Y repair and upgrade bindings. The build HUD now shows a 🛣 Road / 🪧 Sign row only while building, with device hints. Tapping or clicking a button, or pressing the action, stops build mode and then opens the road tool. For a sign, it edits the nearest sign, or places a new one if none is near. `BuildMode` gets an optional `tools` hook, which main.ts wires to worldTools.

**Consequences.** All three inputs can reach both tools. A 2-button row is added under the build chip. It was checked on a 844×390 touch viewport with no overlaps. Test: apps/client/test/adr171_build_tools.test.ts.

## ADR-172: Replica timers use the server tick; chat and invite notices

**Context.** The 2-client browser pass turned up two problems.
1. Bob saw a 60 s party invite as "417s". A replica's `world.tick` counts from when it joined, while the timers below are stamped with server ticks:
   - `expiresTick` on party and clan invites;
   - craft `startTick` / `endTick`;
   - fuel `burnUntilTick`;
   - `CombatTag.untilTick`.

   So the UI timers were wrong. An invite could also outlive its server expiry, or be hidden on a long-lived client.
2. Incoming chat and party/clan invites were only visible inside their closed panels, so nothing told the player they had arrived.

**Decision.**
- `MenuCtx.tick` (optional) plus `ctxTick(c)`. The client passes `NetClient.serverTickEstimate`. The party and clan invite views, craft progress, and `fuelView` (via a new `now` param on `fuelSecondsLeft`) use it. Audio `snapshotWorld` gets `now` for the combat tag.
- `GameMenus.setBadge(id, n)` adds a red count on a menu-bar button. On mobile, ⋯ is also marked when the badged button is a collapsed secondary one.
  - Chat lines from other players increment the chat badge while the chat panel is closed. Opening chat clears it.
  - A new party or clan invite shows a toast and badges 👥 / Clan. The badge clears when the invite is answered or expires.

**Consequences.** Timers are correct online. Players notice messages and invites on PC, gamepad and touch alike, since the notices are visual and not tied to an input. Test: apps/client/test/adr172_server_tick_notices.test.ts. Verified with two live clients against a dev server.

## ADR-173: Name tags over other players

**Context.** In multiplayer you could not tell who was who. **Decision.** `apps/client/src/name-tags.ts` draws a small pill (12 px Fredoka, 6 px padding) over every other living player, using the loot-label pattern (ADR-161): one pointer-events-none overlay canvas `#name-tags`, redrawn only while tags exist, with no per-tag DOM and cached `measureText`. It uses the same CameraLike as the loot labels, so it works over WebGL and the Canvas2D fallback (debugCamera). The tag position is the render-alpha lerp of PrevTransform→Transform (remote players are already interpolated), lifted by `NAME_TAG.lift × drawZoom` so it tracks the sprite at any zoom. Full opacity up to 8 tiles, fading to 0.25 at 22 tiles, then culled. Party mates are tinted green (#8EF08A) and clan mates blue (#8CC8FF), from the networked Membership. Your own player, the dead and players without a name yet get no tag; names come from `NetClient.names`, and unknown ids are requested. Tags are hidden while a full menu is open. The setting is Settings → "Show player names" (`Settings.nameTags`, on by default), read at most once a second. Test hooks `data-count` / `data-names` are written only when they change. **Tests.** `apps/client/test/adr173_name_tags.test.ts`.

## ADR-174: Free (off-grid) placement when snap is off

**Status:** accepted (2026-10-26)

**Context:** With grid snap off, Free pieces still snapped to quarter tiles and 16 rotation steps, so decor could not be nudged or angled freely.

**Decision:**
- Bit 7 of the existing u8 placement rot (`FINE_ROT = 0x80`) marks a fine request. There is no protocol or save-version change.
- The server's `snapPlacement` honours the flag only for `fineEligible` pieces: Free placement, not vertex-snapped, no claim radius, not a stall. Those snap to 1/16 tile with 24 rotation steps (15°).
- Structural pieces (cell, edge, opening, tri), posts, claims and stalls ignore the flag and stay on the grid.
- Overlap and validation reuse the existing tile-occupancy checks. Depth sorting comes from Transform x/y.
- ADR-162 surface decor works off-grid, because `smallPieceZ` reads the tile under the exact x/y.
- Persistence writes exact f64 x/y (flag 16, previously used only by tri pieces) for fine pieces. Older saves load unchanged.
- The ghost runs the same `snapPlacement`, so the preview position and slot match the server.
- The client's `BuildMode` sends `FINE_ROT | fineRot` while free-placing. Rotate (R / RB / LB / touch) steps 15°, and toggling snap converts the heading. The HUD snap chip shows "▢ Free 45°", or "Free · grid piece" for pieces that can't go off-grid.
- The art has 4 rotation rows, so the sprite shows the nearest quarter turn while the facing is exact.

**Tests:** packages/gameplay/test/adr174_free_placement.test.ts covers the fine snap, ineligible pieces, overlap, ghost == server, the persistence round-trip with replica slot equality, and surface decor.

## ADR-175: Viewport-relative default camera zoom (mobile sees the same world as PC/console)

**Problem.** `camera.zoom` is CSS px per iso px, and ADR-100's `defaultZoom` returned a near-fixed value (1.40 desktop, 1.50 on phones). A fixed pixels-per-tile means world coverage scales with screen size: an 844x390 phone showed ~563x260 iso px vs ~1368x770 at 1920x1080 — roughly 3x closer per axis, ~7x less area.

**Decision.** `defaultZoom(w, h) = DESKTOP_ZOOM × min(long/1920, short/1080)`, clamped to [0.3, 4]. The viewport is "contained" against the orientation-matched 1920x1080 reference, so every screen shows at least PC's view along both axes of its own orientation: any 16:9 screen (720p, 1440p, 4K) shows exactly the PC view; phone landscape shows PC's vertical span and a wider horizontal span; phone portrait shows PC's short-side span (≈770 iso px) across its width and more world vertically. DPR is untouched: the renderer still multiplies by `devicePixelRatio` and snaps zoom×DPR to quarter steps, so render resolution and sprite sharpness are unchanged. The user multiplier (wheel/pinch/±, 0.75–1.6) is unchanged and still persisted, so players can pinch in.

**Trade-offs.** Sprites are physically small on phones (that is what "same view as PC" means); HUD/touch controls are CSS-sized and unaffected. Portrait cannot match PC's 16:9 width without being absurdly zoomed out, so it matches the short axis instead. Tests: `apps/client/test/adr175_camera_zoom.test.ts`.

## ADR-176: Drinking works on the server; raw produce hydrates

**Problem.** Players could not drink. The client showed "Drink water" (ADR-128's `WaterProbeRes` reads replicated tiles) and sent `gameplay.use` with `NO_SLOT` (wired in `GAMEPLAY_NET_COMMANDS` since ADR-128, so not an ADR-163/165 wiring miss). But the authoritative server world has no `TerrainRes`: its tiles live in `ChunkManager`. `nearWater()` fell back to `inWater()`, which returns false without `TerrainRes`, so the server dropped every tile drink and every empty flask/canteen/bottle refill without an error. Single-player runs the same server code (in-tab or worker), so the bug hit everywhere. The prompt also needed empty hands, so holding an axe by a lake hid it.

**Decision.**
- `createGameServer` registers `WaterProbeRes` over `chunks.getTile`, so `nearWater` is correct on the authority. All water is tile id 1 (`movement.swimTiles`); worldgen has no salt or ocean tile, so all water is fresh.
- `farmPrompt` offers "Drink water" next to water whenever the held item is not food or a farm tool, not only with empty hands. An empty liquid container held next to water shows "Refill <name>". The prompt is the existing ADR-110 context prompt: QuickUse key or gamepad binding, a tappable button on touch. The inventory panel's "Drink water" button (ADR-128) is unchanged. Wells and rain collectors do not exist.
- Raw produce restores a small amount of thirst, scaled by juiciness, through `food.thirst` in items.json (thirst runs 0..100). The rule is to raise values and never lower them: berries/blue/rasp/blackberry/cherry 6, strawberry/apple 7, pear/peach 8, tomato 9, orange 10, coconut 14 (unchanged), cabbage/pumpkin/squash 6, carrot/corn 5, potato/onion/wild onion 4, mushroom/beans 3, garlic 2. Cooked food and meat are unchanged.

**Caveat.** The server's `inWater` (swim speed and swim anim) still reads only `TerrainRes`. That is out of scope here.

**Tests.** `apps/server/test/adr176_drink_water.test.ts` runs over loopback: a tile drink raises thirst by `WATER_TILE_THIRST` (12), an empty canteen refills and then hydrates, and the prompt shows while a tool is held. All three fail without the fix. `packages/gameplay/test/adr176_produce_thirst.test.ts` covers the produce values.

## ADR-177: Gamepad camera zoom (hold RB + D-pad ↑/↓)

**Problem.** Zoom (ADR-100/175) only worked with wheel, pinch and +/- keys. The gamepad profile already bound `Camera.Zoom` to `RB + D-pad ↑/↓` (and the tutorial "Look around" step advertised it), but no client code ever read the `Camera.Zoom` action — `attachZoom` listened only to DOM wheel/pointer/key events — so the pad binding was dead (Xbox Edge and PC controllers alike).

**Decision.** Keep the existing binding: hold **RB + D-pad ↑ = zoom in, RB + D-pad ↓ = zoom out**. It is free in Gameplay: plain D-pad = hotbar 1–4 and LB + D-pad = hotbar 5–8 (the RB modifier binding shadows the plain D-pad one), RB+Y/RB+B are vehicle engine/lights, RB+Select is chat. Menus, build mode (D-pad = tier, RB = rotate, LT + D-pad = level) and the road/sign tool own their input and do not zoom. `onUiFrame` calls `ZoomControl.nudge(input.axis("Camera.Zoom"), dt)` only when the active device is a gamepad (keyboard/touch keep their event paths, avoiding double steps). `padZoomStep` multiplies the user zoom by `exp(axis × 0.9 × dt)` — smooth, frame-rate independent, full 0.75–1.6 range in ~0.85 s — and goes through the same `setUser` clamp and debounced "engine-settings" persistence. The tutorial chip (`{A:Camera.Zoom}`) and ARCHITECTURE controls table already render the binding from the profile.

**Trade-offs.** A very quick RB+D-pad press (<250 ms) still also counts as an RB tap (HotbarNext), the same as the existing RB+Y/RB+B chords. No zoom while in build mode on pad.

## ADR-178: The authoritative server has a TerrainRes (swimming, water collision, AI water checks)
- **Cause:** the server keeps tiles in `ChunkManager` but never sets `TerrainRes`, so every gameplay TerrainRes reader saw "no terrain". `inWater` was always false, which meant no swim speed (0.4×) and no Swim anim. `movementBlocked` skipped the unwalkable-tile check, so zombies, animals and vehicles walked across water. Zombie pathing (`combat/path.ts`), zombie targeting (`combat/zombies.ts`), horde spawn tile checks (`hordes.ts`) and build height/water validation (`building/place.ts`) were all inert. The client replica had no TerrainRes either; it only had the ADR-128 water probe. Players moved at full speed in water on both sides, and the Swim anim never fired.
- **Fix:**
  - The server sets `TerrainRes = terrainFromTileMap(chunks)`. This replaces ADR-176's `WaterProbeRes`; `nearWater` prefers TerrainRes.
  - The client sets `TerrainRes` over replicated tiles (`apps/client/src/replica-terrain.ts`, which follows the current session's `TileMap`). Prediction now runs the same swim speed and collision as the server, with no water rubber-banding. This works in single-player too, because the in-tab server is the same `createGameServer`.
  - Population and farming already fell back to `PopulationTiles`, and gathering already checked it. They are unchanged.
- **Caveat:** tiles the client has not received yet read as 0 (land). Those tiles are outside the relevant-chunk radius, so the player cannot reach them.
- Tests: `apps/server/test/adr178_server_swim.test.ts`. All of its tests fail without the server change.

## ADR-179: Client hotbar strip + client-side hotbar selection

**Context.** Players reported no hotbar at the bottom-centre. Root cause: the client never rendered one (no hotbar view existed; nothing to be hidden by z-index, safe-area, zoom (ADR-175) or HUD change-only updates (ADR-158)). Also, the client FRAME_MAPPING carries no `edgeBits`, so Hotbar1..8 edges never reached the sim and 1-8 / D-pad did nothing.

**Decision.** `apps/client/src/hotbar.ts` mounts a minimal 8-slot `#hotbar` toolbar (inventory slots 0-7) absolutely positioned bottom-centre above `--sab`, z-index below menus/tutorial, 44px slots (36px on small screens). It rebuilds only when its content/equip/device key changes (ADR-158 spirit), hides while dead, in menus, build mode or world tools, and click/tap equips. `main.ts` reads pressed Hotbar1..8 (keys, D-pad, LB+D-pad) and gamepad RB/LB taps (cycle filled slots) in gameplay and sends `equipIntent(slot)`. Number labels show only for keyboard/mouse.

**Consequences.** Visible on PC, gamepad, phone landscape/portrait, WebGL and Canvas2D, with no overlaps. The Reload edge is still not mapped (follow-up). There's no mouse-wheel cycling because the wheel zooms.

## ADR-180: Client frame edges reach the sim (Reload, Hotbar1..8)

**Context.** The client FRAME_MAPPING had no `edgeBits`, so no edge action ever left the client, and the server's `applyInput` ignored `cmd.edges` anyway (`applyGameplayInput` is not on the server path). So R / pad Y / touch Reload did nothing, and Hotbar1..8 only worked through ADR-179's client-side shim.

**Decision.** `apps/client/src/frame-mapping.ts` maps every edge action to `GameplayEdgeBits` (same order as input `EDGE_ACTIONS`). The client strips the sim edges (Reload, Hotbar1..8) outside plain gameplay, i.e. in menus, build mode, world tools and death. Gameplay's `edgeCommands(edges)` turns sim edges into commands (Hotbar*n* → `EquipCmd(n-1)`, Reload → `ReloadCmd`); it is shared by `applyGameplayInput` and the server's `applyInput`, which queues them like their net-command twins. ADR-179's client path now only does the pad RB/LB cycle, so Hotbar1..8 fire once.

**Audit.** These edges are UI or have no sim effect and are sent but ignored by the sim: Jump, HotbarNext/Prev, QuickUse, ToggleInventory/Crafting/Map, OpenChat, OpenSocial and Cancel.

**Consequences.** `adr180_edges_reach_sim.test.ts` checks that every bound edge has a matching bit, that each sim edge maps to a command, and that keyboard and gamepad input equip and reload over loopback on the authoritative server.

## ADR-181: Two water depths — shallow (wade) and deep (swim)
- **Model:** no new persisted tile and no schema change. Depth is derived at runtime (`packages/world/src/waterDepth.ts`). Water tile 1 is **shallow** when a loaded non-water tile lies within `movement.shallowRadius` (2, Chebyshev); otherwise it is **deep**. Tile 8 (`ShallowWater`) is always shallow. Unloaded tile 0 never counts as shore. Existing saves and worldgen therefore get a shallow band along every shore and river and deep lake centres, without a migration. Narrow rivers (≤4 wide) come out entirely shallow.
- **Shallow:** walkable for players, AI and vehicles (`terrainBlocksWalker`). Movement ×`wadeSpeedMul` (0.7), sprint allowed. You can drink here. Building is allowed. The client sinks the sprite by 0.15 and keeps the wet level ≥160 while moving, which gives drips and splash.
- **Deep:** must swim, at ×`swimSpeedMul` (lowered from 0.4 to 0.35), with no sprint. The Swim anim plays only here. Placement is blocked (`building/place.ts`), and AI pathing treats it as a wall. Loot bags in deep water float ashore: every 10 ticks they move 0.5 tiles toward the nearest non-deep tile within 8.
- **Shared:** server and client prediction use the same `waterDepth` over TerrainRes (ADR-178), so they agree.
- **Render:** shallow uses the existing `ShallowWater` palette/sprite in WebGL2 (`tilemap.ts`, `terrainTiles.ts`) and `#4f93bf` in Canvas2D. No new art; the lighter tint is enough for now. Dedicated wade/foam art is future work.
- **Caveats:** a chunk mesh can show stale depth at a chunk edge until it is rebuilt, because unloaded neighbours read as deep. The renderers use the constant `SHALLOW_RADIUS`, not the data value.
- **Tests:** `packages/gameplay/test/adr181_water_depth.test.ts`. adr107 and adr178 were updated for the new swim speed and shallow band.

## ADR-182: Water renders as one flat surface; depth shown only by a smooth tint
- **Cause:** worldgen stores tile height as `floor(n*4)`, and the water band spans n ≈ 0–0.3, so one lake mixes heights 0 and 1. The WebGL2 tile sprites and the terrain mesh drew water at its stored height minus 0.25, so the surface had steps and skirts inside the water. ADR-181 also swapped shore water to the `tile_water_shallow` sprite, which made the steps stand out more. Canvas2D was already flat, but it drew a hard two-colour edge.
- **Fix (render only):** `renderTileHeight` (world/waterDepth.ts) draws every water tile (1 and 8) at `WATER_SURFACE_HEIGHT` (0, minus the usual 0.25), whatever its stored height. It is used by `terrainTiles.ts` (z and neighbour skirt masks), `tilemap.ts` (`tileHeight`, the top face and cliff faces) and the client `groundZ`, so swimmers sit on the surface. All water now uses the same `tile_water` art. Depth is shown by `waterShoreTint`: 1 next to land, then 0.67 and 0.33, and 0 from 4 tiles out.
  - The WebGL2 sprite shader lightens water by up to 50% × tint.
  - The vertex-colour mesh blends the tint per corner, so the gradient is smooth.
  - Canvas2D lerps from #3484bc to #4f93bf.
- **Unchanged:** gameplay depth rules (ADR-181, radius 2), stored heights and saves. A shore now has one single skirt or cliff, going from land down to the water level.
- **Tests:** `packages/render/test/adr182_flat_water.test.ts` (fails without the fix).

## ADR-183: The Canvas2D renderer skips the GL black-frame self-check
- **Cause:** after every frame, `IsoView.render` ran the ADR-148 black-frame check with `if (this.blackCheck?.gl !== r.gl) this.blackCheck = new BlackFrameCheck(r.gl); bc.pending`. The Canvas2D renderer (`?renderer=canvas`, or the fallback when WebGL2 is missing) has no `gl`, so the condition was `undefined !== undefined`, which is false. No check was ever created, and `bc.pending` threw "Cannot read properties of undefined (reading 'pending')" on every frame. The frame loop showed it as a "Frame error" overlay.
- **Fix:** the check moved into the exported `blackFrameStep(state, renderer, held0)`, which returns early when the renderer has no `gl`. With nothing to read back there is no black-frame check. The WebGL2 behaviour is unchanged.
- **Test:** `apps/client/test/adr183_canvas_blackcheck.test.ts` (fails without the guard).

## ADR-184: Smooth, stronger shore-to-deep water tint (no per-tile steps)

- **Problem:** the ADR-182 tint was subtle and stepped. The WebGL2 sprite layer had one flat tint per tile, the range was 3 tiles, and Canvas2D used one fill per tile, so you could see diamond-shaped bands.
- **Field:** `waterShoreTint` now reaches `SHORE_TINT_RANGE` = 6 tiles out (linear, 1 → 0). The new `waterCornerTint(tileAt, cx, cy)` averages the four tiles around a corner (land = 1, unloaded skipped), and `bilerpTint` blends four corners. Neighbouring tiles share their corners, so the blend is continuous across edges.
- **WebGL2:** `terrainTiles` passes the 4 corner tints per instance (attribute 3, 16 floats per instance), and the fragment shader bilinearly interpolates them at the pixel's ground position (`vWorld - tile origin`), smoothstepped. Colour mixes from deep blue to turquoise and keeps the art's luminance/detail. The `tilemap` mesh uses the same corners with SHALLOW #5cd0d0 and DEEP #184690.
- **Canvas2D:** water is drawn as a single image at 1 px per tile, using the same endpoints (`waterRgb`), with tints cached per chunk. It goes through the iso affine with bilinear smoothing, under the land diamonds, which replaces the per-tile water fills.
- **Unchanged:** the flat surface height (ADR-182) and gameplay depth (ADR-181). Test: `packages/render/test/adr184_smooth_water_tint.test.ts`.
## ADR-185: Name tags keep a stable screen-depth draw order (no blinking boxes over characters)
Name tags (ADR-173) were sorted farthest-from-me first. When two players/bots stand close together at about the same distance, interpolation jitter flipped that order every few frames, so their overlapping dark tag boxes alternated on top: "blinking boxes over characters", in both WebGL2 and Canvas2D (the tags are a shared overlay canvas). Tags now sort by screen y (top first, entity id tie-break), matching sprite depth, so the order only changes when characters actually cross. Ruled out by per-frame probes: creature HP bars, atlas eviction, silhouettes. Test: `adr185_name_tag_blink.test.ts`.

## ADR-186: KTX2/Basis transcoding runs in a worker pool
- **Cause:** in profiles of long `?dev=sandbox` sessions, the Basis wasm transcoder (`basisTranscoder`, `loadKtx2Rgba`) ran on the main thread. It took about 8% of main-thread time, in long tasks of 50-200 ms every time a streamed page (wearables, vehicles, bodies, building tiers) came in. On screen this showed up as hitches while walking into new areas or meeting new characters.
- **Fix:** `ktx2.ts` now starts a small worker pool from an inline Blob worker, with `transcodeWorkerCount(cores)` workers: 1 on ≤4 cores, otherwise 2. The workers load the same vendored transcoder. The KTX2 bytes are transferred to the worker (no copy), and the transcoded levels are transferred back. Output formats, mip levels and quality are unchanged. When there is no `Worker`/Blob URL, the old in-thread path runs. Worker errors reject, and the caller falls back to PNG as before. `setKtx2Workers(false)` forces the in-thread path.
- **Measured** (swiftshader, 480x270, SP worker): Basis no longer shows up in main-thread profiles. Long tasks dropped from 49 to 36, and p95 frame time from 183 to 150 ms.
- **Tests:** `packages/render/test/ktx2_worker.test.ts`.

## ADR-187: Console texture budgets skip the per-page-in getError sync
- **Cause:** ADR-154 drained `gl.getError()` after each page-in when `textureBudgetMB < 384`. The Xbox/console budgets (256, 448 ultra) fall under that, so consoles paid a full GPU pipeline sync on every page-in. In profiles, `getError` was the biggest single main-thread cost at 12.7%, with single stalls of 300-800 ms.
- **Fix:** `SYNC_CHECK_MAX_MB` is now 200. Mobile/safe budgets (128/160) keep the per-page check, because those drivers OOM in practice. Console and desktop budgets rely on the existing once-per-frame `OUT_OF_MEMORY` check and the rebuild-time retry. Texture quality is unchanged.
- **Tests:** `packages/render/test/frametable_rows.test.ts` (256 MB → no sync checks).
## ADR-188: Characters never draw a partial paper doll; on-screen pages are never evicted; wardrobe prefetch ring
Near characters flashed pale/undressed (body only) and hair dropped out and back while wear pages streamed or were stolen. (1) Eviction check: `PageLRU.victim`'s live-steal path let a nearer request (always the local player, prio 0) take a page drawn this very frame; the frame table is consistent (rows cleared on evict, uploaded in `beginFrame` before drawing), so the visible effect was that layer vanishing until it paged back. Pages touched within `ONSCREEN_FRAMES` (2) are now never victims; the requester keeps its fallback until a slot frees. (2) `SpriteBatch` plans all layers first: when any layer is not resident the character keeps its last fully-composited look (`layerSource`: held last-good frames, the same resident piece keeps animating, never an old/new outfit mix) and the composite is only refreshed when all layers are resident. A character never composited yet (first sight during initial streaming) still draws what is resident (`partialLayers` stat). (3) Characters with Appearance up to `PREFETCH_RING_PX` (768) beyond the draw margin request their wear/hair pages every 8 frames. The behind-props silhouette is unchanged. Tests: `adr188_char_hold.test.ts`, updated `charPin`/`charPriority`.

## ADR-189: Name tags declutter vertically
`declutterTags` (pure): the tag lowest on screen keeps its spot, each overlapping tag above it is nudged straight up just clear (2 px gap). Deterministic from positions (no jitter); the overlay eases each tag's offset (~14/s) so a new overlap slides apart instead of snapping. Test: `adr189_name_tag_declutter.test.ts`.

## ADR-190: Atlas re-tier without a freeze (memoized, time-sliced resizes + hysteresis)
- **Cause:** a re-tier ran `AtlasManager.rebuild` in one go. Chrome's `createImageBitmap` resize of an ImageBitmap runs synchronously, so the `Promise.all` of about 100 resizes (fitToPage masks, scaleList, halveSide) plus a linear `dirFrameIndex` search landed in a single 0.8–1.4 s task. Re-tiers also fired several times early in a session.
- **Fix:** (1) Resizes are memoized per source image + size + filter (`resizeImage`, LRU of 2 per source). A re-tier reuses the previous rebuild's resizes, which have the same pixels. (2) Uncached resizes are serialized through `sliced()`, which yields to the next frame after `RESIZE_SLICE_MS` (6 ms). The old atlases keep rendering until the existing atomic swap and settle-hold. (3) `dirFrameIndex` uses a `byRect` map, giving identical indices in O(1). (4) Hysteresis: a re-tier needs `RETIER_CONFIRM` (3) consecutive positive checks and `RETIER_MIN_GAP_FRAMES` (1800) of spacing, and never starts while a rebuild is in flight. Art resolution and mip levels are unchanged. The GPU upload (≤55 ms) stays synchronous, because double-buffering the texture arrays would double peak VRAM.
- **Tests:** `packages/render/test/retier_sliced.test.ts` (identical cached results, no simulated frame over the slice budget and well under 50 ms, confirm/gap/busy hysteresis). `seamless_retier.test.ts` is unchanged and still passes.

## ADR-191: Prediction in the server tick frame + predicted contact slow
- **Cause:** at 60/150 ms RTT the only scenario with visible corrections was walking over spiked barricades: p99 0.125 tiles, max 0.18, 39–48 corrections over 0.01 per minute. (1) The server's `contactSystem` slow (a MoveSpeed buff) was authority-only, so the client never predicted it. (2) Tick-based rules (buff expiry, contact cadence) were evaluated at `world.tick` during live prediction and at `saved−n` during replay. Neither matches the server tick (`latestTick+1+i`) at which pending input `i` actually runs.
- **Fix:** `World.predictLead` and `simTick(e)`. Netcode sets the lead after each input push (`latestTick + pending.length − tick`). Replays now start at `latestTick+1`. Movement evaluates speed buffs at `simTick`. On clients, `contactSystem` runs `predictContactSlow`, which applies the same idempotent slow modifier to predicted entities in the server's tick frame (damage stays authoritative). Residuals still go through the existing smooth decay (tau 0.1 s; snap only above 2 tiles).
- **Result (correction p99 in tiles at 60/150 ms RTT, 0 snaps):** spikes 0.125 → 0.0005. Open, water, stamina, walls and melee were already ≤0.0013 and are now ≤0.0009. Total corrections are also lower (stamina 436 → 97). Players have no server-side knockback, and trap root hits only hostiles, so neither needs prediction.
- **Tests:** `packages/gameplay/test/adr191_predict_lead.test.ts`.

## ADR-192: Remote "teleports" — carried snapshot values are not interpolation samples
- **Cause:** when the server leaves an entity out of a snapshot's record, the client reconstructs that entity from the delta baseline. This happens with the distance throttle (`distantThrottle`, on by default for P2P hosts as `{24, 3}`), with soft-budget deferral in crowded areas, and when an entity is unchanged. The client pushed those carried values as a fresh interpolation sample at the new tick. A far mover therefore froze for 2 of every 3 ticks and then jumped. When the baseline was older than the last applied tick, the carried value even stepped the entity back to the older position before it jumped forward. Measured on a throttled remote runner: 34 of 52 running frames were frozen, and the worst single-frame jump was 12 tiles.
- **Fix:** (1) `NetClient.applyState` calls `InterpolationBuffer.hold(netId, tick)` instead of `push` when the interp component is the baseline's own value. (2) The buffer lerps across carried runs shorter than `bridgeTicks` (8), which covers throttled or deferred movers. Longer runs count as a rest: the entity stays pinned and does not extrapolate, and a hold sample is inserted when it moves again, so it does not creep. It does not extrapolate across ticks that a received snapshot covered. (3) A per-entity adaptive render lag equal to the newest real-sample spacing − 1 is slewed by at most 0.1 tick per frame. This lets throttled entities always have a bracketing sample even when the tick estimate runs up to `latest+4`. Non-throttled entities keep lag 0.
- **Result:** throttled remote at 60 / 150 ms + jitter: 0 frozen frames, max per-frame step 0.22 tiles (steady pace is 0.20).
- **Tests:** `packages/net/test/adr192_remote_teleport.test.ts`. The existing `interpolation.test.ts` is unchanged and still passes.

## ADR-193: No "invisible attackers" — sourceless hits don't flinch
- **Report:** zombies took damage and flinched with no visible attacker.
- **Repro:** a headless `devSandbox` server plus client ran for 10 min, logging every `Damaged` event on a zombie by cause and source type. 2880 of 2880 hits were `Sunlight` with source 0. There were no hits from pets, animals, AI humans, traps, spikes, turrets, fire, other zombies, or hidden entities outside the client's interest radius. Sunlight damage is intended (`ai.dayDps`), but each think tick it also set `Anim.Hurt` and stamped a `HitReact` with dir 0 and src 0. The client turned that into a full knockback flinch toward +x, which looked exactly like an unseen hitter.
- **Fix:** `HitReact` gains `cause` (a `DamageCause`). `applyDamage` sets the Hurt anim only for directed hits, meaning the source is alive and is not the target itself. Sunlight and a creature's own fire still stamp `HitReact`, so the hp bar still shows, and the HitReact now carries its cause. The client's `hitPose(ms, dir, directed)` gives undirected hits no knockback, tilt or squash, only a faint flash. Directed hits are unchanged.
- **Tests:** `packages/gameplay/test/adr193_invisible_attacker.test.ts`, `apps/client/test/adr193_undirected_hit.test.ts`. Both fail without the fix.

## ADR-194: Zombies are calm by day, aggressive by night (no sunlight damage)
- **Decision (owner):** zombies no longer take sunlight damage. This overrides the `dayDps` part of ADR-193; the hit-cause plumbing (`HitReact.cause`, undirected hits with no flinch) stays. `DamageCause.Sunlight` stays in the enum so saves remain compatible, but nothing emits it.
- **Temperament:** server-authoritative in `zombieAISystem`, so single-player and online behave the same. A non-horde zombie is aggressive from `ai.aggroStartT` 0.77 (≈18:29, mid-dusk) until `ai.aggroEndT` 0.27 (≈06:29, late dawn). Outside that window it is calm: it doesn't acquire players by sight or noise, drops any chase or investigation, and wanders. Light-seeking Snuffers are already night-only. Without a clock, t reads 0, so zombies are aggressive.
- **Staggered transition:** each zombie gets a stable 0..`ai.aggroStaggerT` (0.05 ≈ 72 game-min) offset from a NetId hash. A crowd therefore wakes at dusk and settles at dawn gradually, not all on one tick.
- **Hordes:** `HordeMember` zombies are always aggressive.
- **Retaliation:** a calm zombie that is hit by a living non-zombie (player, AI human, pet) targets that attacker for `ai.retaliateSeconds` (30 s), within `loseTargetMul` × sight. It then calms down again. `combat.lastAttacker` is a sim-local, server-only map written by `applyDamage`. Getting hit should never be free, and this lets a player choose a daytime fight.
- **Tests:** `packages/gameplay/test/adr194_day_calm.test.ts` covers no daylight damage, a day zombie ignoring a nearby player, retaliation, and the staggered dusk; those fail without the change. It also covers the night zombie and the horde-by-day zombie, which already passed and now guard against regressions. ADR-193's test now uses sourceless Fire.

## ADR-195: Foundation seams — flat-sprite depth tie-break
- **Cause:** flat (deck) sprites, such as foundations and floors, take their depth from the ground plane: `aA.z + 0.01 - hp/uHH`. Two same-level neighbours therefore have exactly equal depth on every pixel where their art overlaps. With `LESS`, whichever was drawn first won, so the back piece's edge showed through the front piece and flickered as the batch order changed.
- **Fix:** the key adds `(aA.z - uDepth.x) * FLAT_TIE_BREAK` (2e-4), so the piece with the nearer pivot wins every shared pixel deterministically. The bias is far below a single tile row, so it never reorders a flat sprite against anything standing on it. The CPU mirror for this is `flatDepthKey`. Canvas2D draws no building pieces, so it has no seam (see ADR-196 for the overlay).
- **Tests:** `packages/render/test/adr195_flat_seam.test.ts`.

## ADR-196: Magnetic structure snapping + snap overlay
- **Magnet:** `buildPreviewFor` runs `magnetize` when assist is on. It looks for valid placements that touch an existing structural piece: a foundation or floor next to a foundation within `MAGNET_CELL_RADIUS` (1 tile), a wall on a foundation edge or a floor on wall tops within `MAGNET_EDGE_RADIUS` (0.6). It picks the nearest one that is valid, so the cursor, the touch point, or the gamepad aim only has to come within about half a tile. The preview then reports `magnet`, `snapEdge` (the shared segment) and `outline`.
- **Visuals:** ghost tint is clearer green (0.3, 1, 0.4) or red (1, 0.22, 0.22), alpha 0.62–0.70. `apps/client/src/snap-overlay.ts` draws the footprint outline in green or red and the snap edge in a highlight colour on a 2D canvas, `#snap-overlay`, above both renderers. Canvas2D/debug mode also gets placement feedback this way. The outline is lifted to `IsoView.ghostZ`, so it sits on the ghost over terrain.
- **No surprise jumps:** when the raw spot is invalid for any reason other than a missing socket or support (10/11), for example spot taken, too far or no materials, the red ghost and its reason are kept.
- **Input:** all three modes feed the same preview: touch point, gamepad aim and mouse.
- **Tests:** `packages/gameplay/test/adr196_magnet_snap.test.ts`, `apps/client/test/adr196_snap_overlay.test.ts`.

## ADR-197: Deck side-face culling + total depth order for structure pieces

**Context.** On large bases, adjacent foundations and floors drew their side skirts into each other. Those hidden sides were
covered only by the depth test, and the depth key is coarse, so under camera micro-jitter they flickered in and out.
Ghosts had the same key as the piece under them, and equal keys in the static chunk sort were ordered arbitrarily.
Canvas2D drew no building pieces at all.

**Decision.**
- *Neighbour-aware culling, no new art.* `building/deckFaces.ts` builds a per-frame `DeckNeighbors` map from every
  placed (non-ghost) layer-0 deck before chunk culling, so it crosses chunk borders. It is rebuilt from ECS state each
  frame, so place, demolish, upgrade and remote replication are handled with no events.
  - A side is *closed* when every cell along it holds a deck at the same level whose top is the same height or taller
    (within 0.5 px), of any tier.
  - Each pixel is projected onto the piece's top plane, giving tile offsets (a, b). Pixels past a closed edge
    (beyond `DECK_EDGE_EPS` = 0.02 tiles) are discarded: in the WebGL2 fragment shader, using instance floats o[38]
    (mask | fw<<4 | fh<<8) and o[39] (top px).
  - Canvas2D uses the equivalent convex clip polygon (`deckClipPolygon`).
  - Top heights come from the art: `tools/measure-deck-tops.py` generates `deckTops.generated.ts` (foundations at all
    tiers 12 px, floors 5 px).
  - The chunk checksum covers all instance floats, so a mask change rebuilds the static chunk.
- *Walls and roofs are not culled.* Walls are edge pieces whose faces are always outward, and roofs have their own
  occlusion handling.
- *Unique tie-break.* `pieceTieBreak` = ((x−y) mod 4)·0.0008, plus 0.004 for ghosts, which stays below the 0.01 layer
  bias. The static sort is now a total order (key, sy, sx, entity).
- *Canvas2D.* Pieces are painted level-major. Decks draw under their level's uprights, in iso order, with ties broken
  by `pieceOrder` (level, layer, y, x). The camera origin is rounded to whole device pixels.

**Tests.** `adr197_deck_faces.test.ts` covers a 10x10 mixed-tier base (foundations, floors on level 1, walls, a ghost):
- Interior sides are all closed and outward sides open.
- The clip polygon matches the per-pixel test.
- A software raster over 120 jittered frames, with a shuffled raster order, gives identical output with zero interior
  side pixels.
- The same raster without the fix shows interior side fragments, equal-key ties and changing frames.

**Art & Assets could improve.**
- Ship the top and skirt as separate layers, or a per-side mask channel. Culling would then be exact on irregular rims,
  not plane-based.
- Use trimmed frames for decks: the 128x128 untrimmed frames waste fill.
- Add a `deckTop` field to the manifest instead of measuring it.
- Measure each rotation separately if rotated deck art ever stops being a mirror.

## ADR-198: Persistent client error log + timed error overlay
- **Capture:** `apps/client/src/error-log.ts` keeps a ring buffer (`ERROR_LOG_MAX` = 60) in localStorage (`survivaz.errorlog.v1`). Every `showRenderError` call (frame errors, renderer exceptions, resize failures, context loss, black-frame checks, start-up failures) is recorded, and so are window `error` and `unhandledrejection` events. Each entry stores the timestamp, a short stable code (`E-XXXX`, an FNV hash of kind + first message line), the message, the stack, the renderer (webgl2 / canvas2d / debug), the GPU and the build hash (`__BUILD_HASH__`, set from git or `GITHUB_SHA` in the Vite config). When the same error repeats back to back, its counter goes up instead of adding a new entry.
- **Safety:** saves are throttled to one coalesced write per second and flushed on `pagehide`. The logger never throws: a corrupt store, a full quota (the buffer is halved and saved again), an unserializable error value or a context probe that throws are all handled.
- **Overlay:** it stays up for 8 s (`OVERLAY_MS`) and then removes itself. A tap dismisses it sooner. Each error shows its code and "Saved to Settings → Error log". The same error is shown at most once every 8 s, but every occurrence is logged. Before this change the overlay showed each error only once per page and never closed. A reload (for example the context-loss recovery reload) was the only thing that cleared it, which is why players saw it "vanish".
- **UI:** Settings → "🐞 Error log" opens the `error-log` modal: newest entries first, plus 📋 Copy (full text report to the clipboard), Clear and Back. These are ordinary modal buttons, so the shared ui-nav focus layer handles them: D-pad/stick to move, A to activate, B to go back.
- **Tests:** `apps/client/test/adr198_error_log.test.ts`.

## ADR-199: No false "World rendered black" after a WebGL context loss
- **Cause (found by soak with `WEBGL_lose_context`):** if a black-frame readback was in flight, or started, while the context was lost, it read all zeros. After a restore, the dead readback buffer gave glError 0x502. Either way the player saw a second, false "World rendered black" overlay on top of the real "context lost" one. `glInfo` also reported "GPU: null" on a lost context.
- **Fix:** `blackFrameStep` stops checking for the rest of the page once `gl.isContextLost()` has been true, because the renderer is rebuilt by the recovery reload. `glInfo` remembers the GPU name from the last live probe. The renderer's own `context-lost` event no longer opens a second overlay: gl-recovery already reports the loss and the quality step-down.
- **Tests:** `apps/client/test/adr199_lost_context_blackcheck.test.ts`.

## ADR-200: Gamepad can drive every menu (blocker pass: inventory, crafting, build)
- **Report:** with a gamepad (PC and Xbox Edge), only the main menu could be navigated. Inventory, crafting and build menus, and modals in general, ignored the pad or opened and closed again by themselves.
- **Root cause:** the character creator's own pad `tick` called `ok.click()`, which ran `done()` and cancelled its rAF, but then the tick re-armed itself with `raf = requestAnimationFrame(tick)` on its last line. That zombie loop kept polling in game: A clicked `document.activeElement` a second time, so every menu item activated twice (open then close), and Start clicked a detached Enter-world button. The creator's name field could also not be filled by pad at all.
  - The boot menu (`menu.ts`) had the same stale-loop shape.
  - Select→inventory was a 250 ms `tap`. A frame hitch on a slow device (Xbox Edge, software GL) stretched a normal press past the window, so it was cancelled and nothing opened.
  - The "Drop items…" `<summary>` was not focusable, so drop was unreachable by pad.
- **Fix:**
  - The creator tick returns when `disposed` (checked at entry and again before re-arming), and `done()` destroys any open keyboard nav.
  - The boot menu poll is guarded by a show generation (`padGen`).
  - A on the creator name (or Enter world with an empty name on pad) opens the shared on-screen keyboard (`buildSignEditor` with `keyboard: true`) in a nested `UINav` (`ignoreBoot`); X saves.
  - The Select tap window is now 500 ms, the same as the Map long-press threshold. Shorter is inventory, longer is map, and there is no dead zone.
  - The Drop summary has `tabindex=0`.
  - All menus keep going through the one shared `UINav` (modal stack, focus trap and restore, spatial D-pad and stick with repeat, A/B, LB/RB tabs, X/Y `[data-pad]` shortcuts, Dialog context suppressing gameplay).
- **Not covered:** split stack and move-to-hotbar have no game command for any device yet (the hotbar is the first inventory slots), so the pad cannot do them either.
- **Tests:** `apps/client/test/adr200_pad_blockers.test.ts` covers pad-only equip, eat, drop, craft, and selecting a foundation then Place. `character_creator.test.ts` covers the creator pad loop dying with the creator and A opening the keyboard.
- **Browser check:** a headless Chrome run at 1920×1080 with a mocked `navigator.getGamepads` went pad-only through main menu, creator keyboard, inventory equip and eat, LB+Select crafting queue, and pause→Build→foundation→Place→A. The foundation piece count went 1→2.

**Part 2 — one focus system for every surface (extends `ui-nav.ts`, no second navigator).**
- A on any text `<input>`/`<textarea>` (pad only) opens the shared `buildSignEditor` on-screen keyboard as a nested `osk` modal, in a new `raw` mode (no sign sanitising / 48-char cap; respects the field's `maxLength`). Done writes the value back and fires `input` + `change`; focus returns to the field. Mouse/keyboard/touch still type directly.
- LT/RT (buttons 6/7) join X/Y/LB/RB as `[data-pad]` shortcuts; when a modal has no such control, LB/RB call `onPage(d, "tab")` and LT/RT call `onPage(d, "page")`. GameMenus routes those to inventory container paging, skill categories, or `cycleTabs` over a `[data-tabs=tab|page]` group (build categories, station tabs, chat channels, craft amount).
- Glyph hint footer `[data-role=pad-hints]` (Ⓐ Select, Ⓑ Back, plus live `[data-pad]` labels and LB/RB / LT/RT when they apply) in the top modal. It shows only while `html[data-pad-ui]` is set (by any pad input; cleared by pointerdown/keydown), together with a stronger pad focus ring.
- Closing a nested modal restores focus to the element that opened it when that element is still inside the new top modal.
- `navigator.gamepadInputEmulation = "gamepad"` at startup (Xbox Edge).
- Chat Send has `data-pad=X`.
- Test `adr200_pad_registration.test.ts` enumerates `GAME_MENUS` + pause and asserts that each registers as `nav.top`, traps focus and renders the footer.
- Not covered: split stack / move-to-hotbar (no game command exists for any input device).

## ADR-201: Errors that were swallowed now go to the error log
- **Render:** `@engine/render` exports `reportRenderError(where, err, visible?)` and `setRenderErrorSink`. Without a sink it falls back to console.warn, and it never throws. These paths now report through it instead of `() => undefined` or a bare console.warn:
  - the atlas retier (ADR-190 async swap, `IsoRenderer` every 30 frames)
  - lazy atlas page-in
  - optional atlas layers (tint and emissive)
  - KTX2 transcode failures (also covers the ADR-186 texture worker)
  - Canvas2D image and atlas loads
  - body page-in, which is marked `visible`: characters would go missing
- **Client:** `main.ts` installs the sink. `visible` reports call `showRenderError`, which shows the overlay and logs. Everything else calls `logRecoverable` and goes only to the ADR-198 log, with no overlay. In the audio mixer, `play()`, resume and decode-failed-for-every-format now call `logRecoverable`. `NotAllowedError` and `AbortError` (autoplay policy, interrupted play) are expected and are dropped.
- **Left as is (intentional fallbacks, not errors):** feature probes (`canPlayType`, OffscreenCanvas mask readback), catalog-shape guards, fullscreen and orientation lock rejections, the DB close-after-late-open, the resize-chain tail and the menu leave chain.
- **Tests:** `apps/client/test/adr201_swallowed_errors.test.ts`.

## ADR-202: Zombies hunt AI humans exactly like players

Accepted 2026-10-26. Context: AI humans (virtual players, ADR-105) must feel the same pressure as players so that crafting and building matter to them.

- **Finding:** no targeting change was needed. `zombies.ts` `acquire()` picks any living entity with `Survival`. AI humans are real server player entities (a DirectClient's `Survival`/`Health`), so the ADR-194 day-calm / night-hunt / horde rules, sight and noise detection, and retaliation already apply to them unchanged.
- **Guard:** `apps/client/test/adr197_zombies_hunt_ai_humans.test.ts` spawns a zombie next to an AI human at night and asserts the bot becomes `ZombieBrain.target`.
- **Pets:** zombies do not proactively hunt pets, because pets have no `Survival`. A pet that bites a zombie is hit back through `lastAttacker` retaliation. Pets stay companions, not bait.
- **Defence:** AI humans answer with ADR-203 (the `defend` behaviour, held weapon, and a campfire and walls at home).

## ADR-203: AI human autonomy — needs-driven goals, stuck re-planning

Accepted 2026-10-26. Context: AI humans stood still.

- **Root cause:** the gather behaviour stopped 1.6 tiles from a node, but gather reach is 1.5 (`rangeSlack` 0 for bots), so every swing failed `OutOfRange` (597 of 597 in a probe). The 120-tick timeout then re-picked the same node. Fix: `GATHER_STOP` = 1.2.
- **Second cause:** home was the `addBot` (x, y), but the server spawns or restores the bot elsewhere (~300 tiles away), so `build`, `sleep` and `return_home` walked across the map. The host now re-homes a bot that is more than `HOME_MAX_DIST` (48) from its home (`local.ts` view builder; bot host, not UI).
- **Goal sensors** (`packages/gameplay/src/ai/autonomy.ts`, `fillGoalSensors`). They compute `needs`: the first missing goal tool's ingredients (`GOAL_CRAFTS`: stone axe, then pickaxe, then spear, using the player recipe rules), then the campfire cost, then food, plus wood fuel when the home fire is out. They also find the gather node the bot needs (banned, empty and tool-locked nodes skipped), nearby water when thirsty (ADR-176 drink, `UseCmd` slot 255), an equip slot when the hand is empty, a repair target (home piece below 60% hp), body cold (`COLD_BELOW` 36.3), and the home campfire with its lit state.
- **Behaviours:** gather, explore, craft (goal tools first), build (per-key plan at home, with a campfire bonus at night), `tend_fire` (open → deposit wood → toggle fire → close, the station panel's own commands), `drink_water`, `equip`, `repair`, and `defend`. At night a cold bot with no fire, or an unlit fire, may still gather and is not allowed to sleep. Eat, drink, equip and craft also run inline from long behaviours (`instantChores`), so a chore never has to win against gather's inertia. Every action is a normal client command (wire path, rate limits, server validation): server-authoritative, no cheats.
- **Stuck detection:** `stuckOn` (the bot has not closed 0.5 tiles in `STUCK_TICKS` 60) bans the node for 1200 ticks and re-plans. explore re-goals, build shifts its spot, return_home gives up, and a node held for 240 ticks is banned.
- **Cost:** goal sensors refresh every `SENSE_EVERY` (10) ticks per agent. Item, recipe and campfire lookups are indexed once per defs object, and one alloc-free build-piece pass per home is shared for 30 ticks. Goal sensing takes about 0.4 ms per tick with 16 bots (3.2 ms before the caching). The whole local server ran at 25.4 ms per tick with 16 bots versus 20.7 ms before, and most of that difference is the extra gather, craft and build simulation the bots now trigger.
- **Tests:** `apps/client/test/adr198_ai_human_autonomy.test.ts`: a bot gathers within 600 ticks, crafts a stone axe, and builds a campfire between 15:00 and 21:00. All three fail without this change.

## ADR-204: Split stack and move item to hotbar

Accepted 2026-10-27. Context: the inventory had no way to split a stack or put an item on the hotbar (inventory slots 0..7).

- **Commands** (`packages/gameplay/src/inventory_ops.ts`): `gameplay.splitStack {where,slot,count}` and `gameplay.moveSlot {where,slot,to}`, registered append-only after the pet commands and bridged in `GAMEPLAY_NET_COMMANDS` at 10/s each. `where` 0 is the player's own inventory, 1 is the open `Viewing` container (stalls and tills are refused).
- **Server-authoritative validation:** slots must be below the holder's slot count and below `CONTAINER_MAX_SLOTS` (96); split count must be 1..n-1; the new stack goes to the first empty slot, else `no_space`; moving to the same slot or from an empty slot is refused. Rejects write nothing.
- **Move = swap:** an occupied target swaps. Main-hand, weapon-state and worn slot references follow their item, so an equipped item stays equipped.
- **Persistence:** items, counts, created tick, durability and crafter move together and totals/weight are unchanged, so no schema change. A snapshot round trip is tested.
- **UI** (`gameplay-panels.ts`): pack slots carry pad X = Split (stacks ≥2) and Y = To hotbar, shown in the pad hint footer (`data-pad-x-label`). Split opens one picker row: − (LT) / "n / total" / + (RT) / Split ×n / Cancel, default half. To hotbar opens one row of 8 hotbar targets (occupied ones show the item and swap). Mouse/touch reach the same through a collapsed "Split / hotbar…" section. Only one arrange row renders at a time, so no buttons overlap. `ui-nav.ts` resolves `data-pad-<btn>` on the focused element before modal-wide `[data-pad]` shortcuts.
- **Tests:** `packages/gameplay/test/adr204_inventory_ops.test.ts`, `apps/client/test/adr204_pad_split_hotbar.test.ts` (pad-only split and to-hotbar).

## ADR-205: Container split / to hotbar, specific reject text, hint footer never covers focus

Accepted 2026-10-27. Context: ADR-204 left three rough edges — open containers had no Split / To-hotbar, its new reject reasons were not in the wire list (clients saw a generic message), and the sticky pad hint footer could cover the focused control (hotbar picker slots 5/6) while the split tooltip covered the count.

Decision:
- `gameplay.containerToSlot {slot, to}` moves a stack from the open container (`Viewing`, so in reach) into pack hotbar slot `to` (0..7); an occupied slot swaps back into the container. The server validates open container, bounds (incl. the 96 slot cap), non-empty source, target not equipped/worn, and weight (neither side may end above its `maxWeight` when it got heavier); freshness is rebased per holder. Split / move with `where = 1` reuse the ADR-204 commands. Storage slots get the same X = Split / Y = To hotbar pad shortcuts, footer hints, and mouse/touch/keyboard buttons in one arrange row (still one picker at a time).
- Reasons are now specific (`empty_slot`, `no_container` added; `bad_holder`, `same_slot`, `too_heavy`, `equipped` appended to `COMMAND_REJECT_REASONS`, append-only). The client maps inventory-op rejections to friendly text in the panel status line and a toast.
- The split count is part of the picker heading (no tooltips on −/+), so nothing covers it. Any focus change in a modal (`focusin`, `focusVisible`, panel `focusKey`, footer rebuild) scrolls the panel so the focused control ends above the `.pad-hints` footer.

Consequences: tests `adr205_container_ops`, `adr205_reject_reasons`, `adr205_pad_container_ops` (pad only); the ADR-204 footer test now asserts on the footer element.

## ADR-206: Closer default / max zoom, indoor zoom

Context: players wanted to see inside their homes better and a slightly closer camera on PC and console.

Decision:
- `DESKTOP_ZOOM` = ADR-175 base × `DEFAULT_CLOSER` 1.1 (≈ 1.543 at 1920×1080). The ADR-175 viewport scaling is unchanged, so phones still show the same world span as PC/console.
- The user zoom range is now 0.68..1.75 (was ~0.75..1.6). Max zoom-in goes from about 2.24 to 2.70 absolute at 1080p. The farthest view stays about the same.
- Indoor zoom: `IsoRenderer.indoor` exposes the existing roof cutaway state (`sprites.cutawayActive`) and does not allocate. `ZoomControl.setIndoor` eases an extra ×1.15 factor (`indoorStep`, exponential, tau 280 ms, frame-rate independent). The factor multiplies the user's zoom, so it is relative and never overrides it. A 180 ms debounce stops doorway flicker from pumping the camera.

Consequences: tests `adr206_indoor_zoom` (includes a gamepad-only RB + D-pad min/max test). `delete_picker` now expects the new default. `__qa.zoom()` is a sandbox probe.

## ADR-207: Clan-shared bases

Context: clan members should be able to build one big base together, and non-members must stay out.

Decision:
- This reuses the Tribe privilege model. A clan member whose rank has the `base` perm carries `Tribe = clan id`. Pieces, claim totems (`PrivilegeZone.tribe`) and door `lockTribe` all store it, and they persist as the u16 tribe (structures codec).
- Members can therefore place, snap, upgrade, repair and demolish each other's pieces inside a clan claim and use clan doors.
- Fixes found while doing this:
  - Storage inside a claim (`canUseBaseStorage`) now needs privilege. Stalls and tills stay public. The rule is checked when the container is opened and again while it is open, so a kicked member's open chest closes on the next tick.
  - Repair now needs privilege like the other build actions (it used to be exempt).
- Leave or kick removes the Tribe, so build, storage and door rights end immediately and rejoining restores them. Disband leaves the leader's Tribe, so the leader keeps the base. Ranks without `base` cannot build in the clan claim. Raiders must destroy the claim totem before they can loot storage.
- All checks are server-side (the gameplay command handlers). Clients only see the outcome.

Consequences: test `clan_base` (co-build/snap/upgrade/repair/demolish, outsider blocked, shared storage, kick closes the viewer and revokes rights, persistence round-trip). Behaviour change: outsiders can no longer open chests or repair inside someone else's claim.

## ADR-208: Render reconciliation smoothing; hot-path allocations

Context: profiling of PC/console movement (ADR-191/192 prediction). NetClient has computed a decaying visual `correctionOffset` since ADR-191, but the game client never consumed it. The render package's `netTransformSource` was not wired, and IsoView mirrors the net world itself. So every reconciliation that moved the local player (late or lost input, server collision, knockback) appeared as a rubber-band jump of the full correction within one tick, and the camera, which follows the player, jumped the whole screen with it.

Decision:
- `CorrectionSampler` (apps/client) offsets predicted entities by `NetClient.correctionInto` (an allocation-free accessor). It samples once per network tick and keeps the previous tick's sample for PrevTransform, so lerp(prev+offPrev, cur+offCur, alpha) stays continuous. Sim state is untouched.
- Allocations removed from the per-frame or per-tick path: the camera follow target is a scratch object, and `NetClient.interpolate` reuses one value record instead of allocating one per remote entity per tick.

Consequences: test `adr208_correction_render`. In a simulated 0.5-tile correction while walking, the old path moves backwards up to 0.1 tile per frame; the new path never moves backwards and never moves faster than walk speed. Sandbox (`?dev=sandbox&worker=0`) shows 0 corrections at zero latency, so the change matters on real networks.

## ADR-209: Per-tree skill XP, levels and points
- **Context:** before this change, all seven skill categories (perks, survival, homestead, medicine, crafting, combat, vehicles) shared one character level and one point pool. Chopping trees could pay for combat skills.
- **Decision:** each tree now has its own XP, level curve (`skills.json` → `treeLevels`: base 40, ×1.1 per level, 1 point per level plus 1 bonus point every 5 levels, max level 60) and unspent points. These are stored in `Progression.txp/tlevel/tpoints` (8 slots) with `tver`. The fields are networked and persistent, so they replicate the same way as the old row.
  - `xp.json` → `trees` maps every XP source to a tree; for example chop/gather/mine → survival, kill/hunt → combat, cook/farm → homestead, craft/build → crafting.
  - Each tree earns XP **only** from its own activities. Buffs & Perks earns only from its own sources (eat, drink, sign). There is no cross-tree share.
  - Awards run on the authority only (`awardXpRaw`, skipped while replaying). Party/clan XP sharing goes to the same tree.
  - `canUnlock`/`unlockSkill` check and spend the node's own tree ("Not enough points in this tree"). Respec refunds each tree what was spent in it. NPC AI picks go through `canUnlock`, so they follow the same rule.
  - The global `xp/level` row stays as the **character level**, used for kill, PvP and horde scaling and the HUD "Lv" chip. It no longer grants points.
- **Migration (old saves):** the persist `AddedFields` migration (`PROGRESSION_TREES_MIGRATION`) zero-fills the new fields when an old record loads, so `tver = 0`. Then, on the authority, `migrateProgression` runs once (on spawn/ensure and in the `gameplay.progressionMigrate` postSim system) and applies `convertLegacyProgression`:
  1. Every learned node stays learned and is charged to its own tree. That tree's level is set to the lowest level whose earned points cover the cost (no refund-and-relearn needed). Any rounding surplus stays in that tree as unspent points, and tree XP starts at 0.
  2. Leftover global unspent points are split evenly across all 7 trees. The remainder goes one point each to the trees with the least spent; ties go to the lower tree index.
  3. Legacy `points` is set to 0 and `tver` to 1. The migration is idempotent.

  Clients read through `treesOf`, which shows the same conversion read-only for an unmigrated row, so no false level-up toasts appear.
- **UI:**
  - Each Skills tab reads "<Tree> · Lv N · P pts".
  - The summary line shows the selected tree's level, XP x/next and "N points to spend here", with an XP progress bar (`role=progressbar`).
  - XP toasts name the tree ("+12 Combat XP", "Combat level 6!"), and the level-up hint says "6 Combat points — open Skills".
  - Controls are unchanged: LB/RB/PgUp/PgDn switch trees, A selects then A learns, B goes back. Mouse, keyboard and touch use the same buttons.
- **Tests:** `gameplay/test/skill_trees.test.ts` (routing, perks share, cross-tree rejection, per-tree respec, conversion, in-world migration), `persist/test/progression_trees.test.ts` (old-layout player record → load → convert), `client/test/adr209_skill_trees_pad.test.ts` (pad-only spend: RB → D-pad → A A; empty tree refuses), `client/test/adr209_tree_toasts.test.ts`, and the updated `skills.test.ts`/`gameplay-panels.test.ts`.
- **Amendment (2026-10-27):** removed the original 20% `perksShare` that every award gave to Buffs & Perks, because each tree must earn only from its own activities. `xp.json` no longer has `perksShare`. Test: "ADR-209 amendment: strictly per-tree XP" checks that every source credits exactly one tree. Saves are unaffected because no schema changed.

## ADR-210: Edge walls flush on the foundation rim, corner posts in every tier, seamless decks
- **Root cause (walls off the edge):** both renderers floored an edge piece's Transform (the exact edge midpoint `(tx+.5, ty)` / `(tx, ty+.5)`) to its tile and pivoted at that tile's centre, which moved every wall, doorway, window and half wall half a tile inward along the edge normal. They were also drawn at ground height (no deck-top lift), and the N and W walls meeting at a junction had equal depth keys, so they flickered. Gameplay positions were always correct.
- **Fix:** `pieceRotFlags(def)` (`render/building/modular.ts`) replaces the client's `exactPivot` flag:
  - Edge pieces and edge openings (not hatches) get `ROT_EXACT_PIVOT | ROT_DECK_LIFT`.
  - Vertex corner posts also get `ROT_VERTEX_POST`.
  - Layer-1 cell pieces get the lift.
  - WebGL2 (`sprites.ts`) and Canvas2D (`canvas2d.ts`) both honour the exact pivot. They lift by `DeckNeighbors.topNear/topOver` (the tallest deck touching the pivot) and add `exactTieBreak` (`(round(2(px-py)) mod 8) * 0.0004`) to the depth. Posts add `VERTEX_POST_BIAS` (0.53) so a post draws in front of the wall ends that meet at its vertex. No gaps, no overlap, no z-fight.
- **Persistence:** no migration. Stored positions were already right; only the drawing changed.
- **Corners:** `wall_corner_inner/outer/angled` now use `minTier: 0` (twig through tier 4, cost = `costScale` × tier recipe).
  - Twig uses the bare-key art (placeholder).
  - Rotation: 4 steps (angled: 8) by RB/LB, R/Q or the touch rotate button.
  - The ADR-196 magnet has a corner mode (`magnetizeCorner`, `cornerJunctions`). It suggests the nearest vertex within 0.75 tile where an N-running and a W-running wall meet.
  - Server validation is unchanged: there must be a deck at one of the four vertex tiles. The creature `Blocked` box is ±0.15 at the vertex.
  - Movement no longer treats a vertex post as blocking its whole anchor tile.
- **Seamless decks (connected texture):**
  - Side faces: ADR-197's per-axis test culled the open front skirt next to a closed neighbour, because a skirt pixel projects onto the top plane diagonally. This left staggered "teeth". A pixel now belongs to the face with the larger rim excess (`deckSideOf`). The Canvas2D clip polygon is the matching non-convex shape, with wedges bounded by the diagonals.
  - Tops: pixels within `DECK_SEAM_BAND` (0.16 tile) of a closed side are resampled `DECK_SEAM_SHIFT` (0.3) toward the interior. WebGL2 does this per fragment through the screen↔top-plane Jacobian. Canvas2D redraws clipped, shifted patches. The result is that bevels, outlines and edge shading show only on the outer perimeter.
  - Tier-pack decks (`bld_foundation_t*`, `bld_floor_t*`, stilts) were missing from `DECK_TOP_PX`, so they got no culling at all. `tools/measure-deck-tops.py` now measures pack layer-0 slabs.
  - Masks are rebuilt every frame from `DeckNeighbors`, so they update immediately when pieces are added or removed.
- **Tests:** `render/test/adr210_seamless.test.ts` (no-hole 3x3 slab, owning face, clip polygon for all 16 masks, seam shift and patches, flags, lift, junction depth) and `client/test/adr210_corners_pad.test.ts` (twig to top-tier costs; pad-only junction snap, RB 90° steps and A place; server validation; movement). `adr197_deck_faces.test.ts` was updated for the owning-face rule.

## ADR-211: Crisp WebGL building art, L-shaped outer corners (auto-rotate, RB override), twig corner art

**Root cause (blurry orange walls in WebGL):** on lowmem/safe budgets (headless SwiftShader 160 MB, mobile 128 MB) `AtlasManager.fitBudget`'s idle-demotion pass ran before any base was on screen, so the resident building atlases were never "recently used" and were demoted to cold ×0.125 — tier-0 twig walls drew as 10 px blobs scaled up. Separately the streamed `bld` pool had only 2 lowmem slots, so a mixed-tier base thrashed onto the legacy fallback art (WebGL ≠ Canvas2D). The near-player fade was already a uniform alpha (occlusion "fade", 0.35); the smear was the downscaled art.

**Fix:** idle demotion orders building atlases (`BUILD_ATLAS_RE`) last; `BLD_POOL_SLOTS_LOWMEM` 2 → 4 (one per tier page). Building atlases now stay at t**L-shaped outer corners (supersedes the ADR-210 post-only `wall_corner_outer`):** `wall_corner_outer` (`shape: "L"`) is one piece at a vertex spanning BOTH outer edges of a foundation corner, each arm a full tile edge. Rot 0 wraps the tile at +x/+y of the vertex, 1 −x/+y, 2 −x/−y, 3 +x/−y (`lCornerTile` / `lCornerArms`); arms face outward like perimeter walls (north 0, west 1, south 2, east 3). The `StructureIndex` registers the L under both arm edge keys, so movement (`edgeBlocker`), room enclosure, deck dependents and the edge-occupancy checks treat it as two walls; removal frees both. Cost 2× a wall (`costScale 2`), hp 500, `blocksPath`.
- **Placement / snap:** an L needs a deck on the tile it wraps (`NoSupport` otherwise), and both arm edges free (`Occupied`). Previews (pad, mouse, touch) snap to the nearest *foundation outer corner* within 1.6 tiles (`outerCornerRots`: wrapped tile is a deck, both tiles across the arms are not), auto-rotated outward; a taken corner falls through to the next. RB/R locks the player's rotation at that vertex (`BuildSelection.autoRot = false`): the L stays there, red if that rotation does not wrap a deck, and no snap-assist hop; moving to another corner re-enables auto-fit. Inner/angled corners keep the ADR-210 post behaviour (`cornerFitRots`).
- **Straight walls may not use a corner slot:** server validation rejects a straight wall (`wall`, `wall_low`, `wall_arched`, `wall_fortified`: Edge, family wall, not a mount, no opening socket) on an edge that is an arm of a foundation outer corner with `BuildFail.CornerSlot` (21) — including two straight walls meeting at 90°; the preview shows it red. Doorway/window frames are exempt (a 1x1 hut still gets a door); interior edges and the middle of outer runs are unaffected, and straight walls butt against the arm ends exactly like wall-to-wall (same edge-midpoint pivots).
- **Rendering (both renderers, no gameplay import):** `lCornerArmPivots` / `lCornerArmPiece` (render `building/modular.ts`, parity-tested against gameplay) expand an L into its tier's straight wall at each arm's edge midpoint (`ROT_EXACT_PIVOT | ROT_DECK_LIFT`, the same depth/tie-break as an edge wall, so arms meet neighbours seamlessly) plus the corner post art at the vertex (`ROT_VERTEX_POST`) capping the joint. WebGL2 `gatherPieces` draws per part; the near-player fade is computed once per L (arms read the smoothed value), so the whole L fades uniformly. Canvas2D adds the arm items to its painter list.
- **Save migration (load, authority, idempotent):** `migrateWallPairsToCorners` (in `decodeStructures`) merges each pair of plain `wall` pieces (any tier, no opening, no attachments) on both arms of a foundation outer corner into one L at the lower tier — cost-neutral (L = 2 walls), so nothing is refunded; hp keeps the pair's mean health fraction; paint/variant/tribe come from the first wall. Single straight walls already in a corner slot, doorway/window frames and other wall kinds are grandfathered unchanged; the next save writes the L.r junction re-enables auto-fit.

**Twig corner art:** `pack/building/src/twig_corners.py` renders outer/inner/angled corners in the twig material to `building_tw.png`; the bare-key `bld_wall_corner_*` sprites point to it (previously tier-1 wood placeholders).
**Corner posts hidden in WebGL2 only:** Canvas2D orders a vertex post as a whole sprite (pivot + `VERTEX_POST_BIAS` 0.53, just in front of the walls whose ends meet the vertex), but the WebGL2 upright depth is per pixel (`key + hp * zPerPx`). Walls meeting the vertex pivot up to half a tile row lower on screen, so at a shared pixel they gain extra height term and won the depth test: posts drew behind the wall ends. `vertexPostGlBias(hh, zPerPx)` = 0.53 + 1.5 rows of the height term (≈1.03 at 64x32 / zStep 16) in `sprites.ts`; an occupant or wall one row in front still out-ranks the post (`adr211_vertex_post_depth.test.ts`).

**Soft art on 1024-layer devices:** a basic/software adapter (e.g. SwiftShader) is auto "lowend" (mediump → 1024-px texture-array layers, DPR 1). Tier pages (2016x1056) only fit 1x in 2048 layers, so such devices keep building art at 0.5x (LINEAR mag) — crisp-shape but soft. Desktop/integrated GPUs get 1x. Possible follow-up: split tier pages into ≤1024 sub-pages. Representative desktop captures spoof the WebGL renderer string (UNMASKED_RENDERER) to a desktop GPU; the near-player occlusion fade is the uniform `fade` mode (alpha 0.35).

## ADR-212: Relog-safe stations, all pieces placeable, body collision + deck stand height, interaction hand, console memory budget, progression reachability

**Stations unusable / walls unplaceable after relog (root cause):** `WorldPersistence` restores only persistent components. Derived, non-persistent piece components (station/storage/door runtime state, socket and blocker data that `placePiece` adds) and the `StructureIndex` entries were never rebuilt for loaded pieces, and `PieceOwner` was not persistent. As a result, a reloaded workbench had no station component (so it could not be used), and the index had no record of loaded walls/foundations (so sockets for new pieces such as `wall_doorway` were missing).
**Fix:** `building/rehydrate.ts` re-derives those components for every loaded piece. `LoadedQueueRes` queues loaded pieces, and the `structureIndex` system wrapper rebuilds the index on the next tick. `PieceOwner` is now `persistent: true`. No save migration is needed because loading is idempotent.
**Tests:** `persist/test/relogin212.test.ts` (save → reload → use the station; place `wall_doorway` after reload). `gameplay/test/all_pieces212.test.ts` places every piece × every tier it supports (143 combos) and checks that `tryPlace` and the preview agree.
**Caveat:** the ADR-211 `CornerSlot` (21) rule is kept on purpose: a straight wall on a foundation's outer-corner arm still fails, and players should use `wall_corner_outer`.

**Collision (root causes):** (1) Player `z` was never raised on decks, so players sank into foundations. (2) Movement tested only the centre point, so bodies clipped half into walls and door jambs. (3) `wall_arched` had no `blocksPath`. (4) Open shutters made a `wall_window` passable. (5) Zombie `moveToward` ignored structures.
**Fix (one shared function, so server = prediction = bots):**
- `applyMovementInput` moves on each axis with `bodyAxisMove`, a square body of half-size `movement.bodyRadius` (0.3). It samples the leading face at three lateral points against `edgeBlocker` and solid cells, and also checks perpendicular edges in the newly entered row (T-junctions and jambs). A blocked move is clamped to the face.
- When the player pushes straight into a wall beside an opening, a small nudge slides them into the doorway.
- `standHeightAt` gives the stand height: foundation deck 0.75 (= 12 px / zStep 16), floor 0.3125, ramp/steps half. `settleStandZ` eases toward it at `stepRate` (6 /s), so step-up and step-down are smooth.
- Open doors and doorways pass; closed doors, walls, corners and stations block.
- The client renders walkers on a deck with piece ground so they do not dip over terrain steps.
- Zombies use the same `bodyAxisMove` and `settleStandZ`.
**Tests:** `gameplay/test/collision212.test.ts` (step-up/down, walls/window/doorway/jamb assist, closed/open door, station + L corner, deterministic replay, zombie confined).
**Caveats:** vertex posts (`wall_corner_inner/angled`) do not block. Animals and pets do not test structures.

**Interaction hand (feature):** `apps/client/src/station-hint.ts` shows a hand symbol over the crafting station that Interact would open. It uses the same selection as `interactPanel`, so the symbol never disagrees with the button. The device hint sits under it (`[E]`, gamepad face button, or "Tap"), and the symbol is also a tap target. It does not blink: there is no pulse, just one fade. Hysteresis (`exitSlack` 0.35 tiles, 350 ms grace) keeps it steady at the edge of range. It hides when Interact would open something else (a loot bag, pet or stall). It is a renderer-agnostic DOM overlay, identical in WebGL2 and Canvas2D. **Test:** `client/test/station_hint212.test.ts`.

**Progression dead end (root cause):** the anvil cost `hardwood` 2. Hardwood (oak/maple) needs a tier-2 axe, and every tier-2 tool is crafted at the anvil, so anvil → hardwood → bronze axe → anvil was a cycle. Players could only escape it by luck, through creature loot or bare-hand drops. **Fix (balance data):** the anvil now costs `iron_ingot` 6 + `planks` 4. Iron still gates it, so the anvil stays a meaningful milestone, and hardwood remains the tier-2+ building material. The sandbox kit swaps `hardwood` 2 for `planks` 4. **Test:** `gameplay/test/progression212.test.ts` starts from bare hands plus world-gatherable resources (nodes, bare-hand rules, creature material loot; gear drops do not count) and walks the recipe/station/harvest-tier graph to a fixpoint. It asserts that every tool, weapon, armor and clothing item, every station, every tool kind's top tier, every armor/weapon tier and every building tier is reachable. Failures name the blocking recipe and the missing ingredients. A regression check removes all hardwood sources and still reaches the anvil and the bronze axe. No other dead ends were found.

**Xbox Edge crashes — memory (root causes):** no texture/VFX/DOM leak was found. The crash pressure was GC churn plus a few unbounded or ever-growing structures:
- **Allocation rate.** The in-tab server and client allocated **~205 MB/s** of JS heap in sandbox combat, measured with a CDP sampling heap profile (worker=0, 15 s). The main sources:
  - `interest.update` rebuilt every client's relevant set every tick, because the global membership version changes every tick.
  - `for (const [k,v] of map)` and `new Map(map)` allocate an entry array per element in net encode/decode/apply.
  - `world.get` object allocations in hot loops (agents, inventory scans).
  - `[...defs.values()].filter` in survivor AI.
  - `Math.hypot` rest arrays.
  - Generator-heavy queries driven by the largest store.
- **Fixes.**
  - `ChunkMembership` keeps a change log (entity, from, to) that is only enabled when a consumer trims it (`InterestGrid`); persistence's membership logs nothing. `InterestGrid` applies those deltas incrementally, with a full double-buffered rebuild only when a window moves.
  - Net code iterates with `forEach`, copies with `copyMap`, and reads with `getField`.
  - Inventory helpers avoid temp objects; skill totals are hash-cached; `world.query` drives from the smallest store.
  - AI uses a `WeakMap` defs lookup cache.
- **Result:** **205 → 117 → 75.7 MB/s** (−63%), with the post-GC heap at ~92–123 MB. No graphics settings were touched.
- **Remaining sources** are each ≤ 5 MB/s: snapshot `captureState`/`replicate` maps (inherent to snapshot history), `world.query`/`world.get` in animal AI/anim settle/render, `buildAgentView`, static updates, `nearestNode`, `spatialIndex.queryRadius`, bot `rebuildGrid` and client interpolation.
- **Audio:** `AudioSystem.frame` already returns before `snapshotWorld` while the mixer is locked or suspended, so there is no per-frame audio snapshot in this tree.

**Console memory budget profile:** `apps/client/src/memory-budget.ts` defines `MEMORY_BUDGETS` desktop/console/mobile. It is chosen by UA (Xbox/PlayStation/Nintendo) and can be overridden with `?profile=`.
- **Console:** 12 offline bots (desktop 32) and 8 P2P host slots, a 384 MB soft JS heap and a 1 MB/min leak threshold.
- **Visuals are unchanged.** The existing console VRAM budget (`capabilities.ts`, 256/448 MB) still applies.
- **Watchdog:** `HeapTrend` samples `performance.memory` every 5 s into a fixed ring. It skips a 3-minute warm-up and compares the lowest floor of the last 5 one-minute windows against the first 5. A short-window minimum is not the post-GC floor, because V8 major GCs can be minutes apart; the soak showed a 30 s-window version raising a false leak flag. It warns once in the console and exposes `window.__survivazMem()` for QA (no UI).
- **Tests:** `client/test/memory_budget212.test.ts` covers detection, caps and leak/no-leak, including old-gen sawtooth and warm-up. `server/test/leak212.test.ts` runs a long two-client session with AOI churn. It checks that snapshot views stay ≤ `historySize`+1, the change logs (interest and persistence) stay at 0, client history stays ≤ 64, entity counts plateau and linger drains. `world/test/interest212.test.ts` checks that incremental interest equals a full rebuild over 600 ticks of churn.

**32-minute soak (`/tmp` Playwright script).** Setup: production build, sandbox `worker=0`, SwiftShader. Each ~1-minute cycle: 35 s of WASD movement and attacks, then placing foundations and walls (pieces periodically demolished), then 1/6 day per cycle, so a full day/night every ~6 min. Each sample read CDP `Runtime.getHeapUsage`, forced a GC every other cycle, and read `Memory.getDOMCounters` and the atlas VRAM accountant.

| | desktop (33 players incl. bots) | `?profile=console` (13 players) |
|---|---|---|
| post-GC JS heap first → last (min–max) | 91.8 → 97.3 MB (88.4–97.7) | 88.6 → 90.3 MB (79.5–90.3) |
| post-GC slope, minutes 5–32 | **+0.03 MB/min** (flat) | **+0.15 MB/min** (~4 MB over 27 min, within noise) |
| peak pre-GC heap / V8 total heap | 354 / 414 MB | 290 / 330 MB |
| DOM nodes / JS listeners (steady) | 264–285 / 87–90 | 237–328 / 87–89 |
| GPU texture (atlas VRAM, SwiftShader budget 160 MB) | 115.7 → 143.1 MB, plateaued after streaming | same |
| server entities | 4.8k → 9.9k by min ~8, then flat | 4.6k → 8.3k, then flat |
| page errors / crashes | 0 / 0 | 0 / 0 |

DOM spikes (4.9k–17.6k nodes, 1.2k–3.3k listeners) appeared only while a menu was open. They dropped back to baseline on close, so they are not a leak. There was no unbounded growth in heap, DOM, listeners, VRAM or entities.

## ADR-213: Xbox controller (Edge) menu navigation on real devices, ?padDebug=1

Accepted 2026-10-29. Context: on a real Xbox (Edge, Xbox controller) the D-pad and left stick did not move focus in modals, the pause hub, inventory, crafting or the boot menu, although ADR-200/204/205 passed with mocked pads in jsdom. The mocks only covered one shape: a `standard`-mapped pad at index 0 read through `getGamepads()`. Reproducing other shapes on the production build (`pnpm build` + preview, Playwright with trusted CDP key events) found these causes:

1. **Keyboard emulation was ignored.** Edge can deliver the controller as key events: `key` "GamepadDPadDown", "GamepadLeftThumbstickDown", "GamepadA" (EdgeHTML), or "Unidentified"/"" with only `keyCode` 195..218 (Chromium has no DOM key name for VK_GAMEPAD_*). UINav, the boot menu, the character creator and the death screen only understood Arrow/Enter/Escape. `navigator.gamepadInputEmulation = "gamepad"` was set too late (in a module, after the first input) and does not exist in Chromium Edge, so the page cannot rely on it.
2. **First pad only.** `getGamepads().find(g => g)` took index 0. An idle or phantom pad there (common with a second controller, or a Bluetooth plus USB duplicate) hid the live pad at index 1.
3. **mapping "" was unread.** A non-standard pad (DirectInput layout) reports the D-pad as a hat on axis 9 and View/Menu at buttons 6/7. Menus read buttons 12..15/9, so the D-pad did nothing and Menu did not pause.
4. **Any keydown turned the pad UI off.** The `data-pad-ui` reset also fired on pad keys, which removed the focus ring and hint footer.

Decision:
- `@engine/input` `xbox.ts` holds the shared normalisation. `gamepadKeyControl(e)` maps key names, VK_GAMEPAD keyCodes and UWP Navigation* keys to one control (right stick = `null`, swallowed). `normalizePad` maps `standard` or `""` pads (hat axis 9, digital axes 6/7, trigger axis) to the standard layout. `mergePads` ORs every connected pad. Gameplay (`browser.ts`) uses the same normalisation, plus a virtual pad fed by emulated pad keys while no menu is open.
- `apps/client/src/pad-input.ts`: `navPad()` (the merged pad), `PadArbiter` and `PadEdges`/`padKeyEdge`. Edge can report one physical press as a Gamepad API button, a pad key and an ArrowDown. The first source to report a control owns it until that source lets go (+120 ms grace), so focus moves exactly once. Pad keys repeat on our own timer (400 ms, then 110 ms); OS auto-repeat events are ignored. Repeat clocks cap each frame step at 120 ms, so a frame hitch never turns a tap into a repeat.
- UINav, the boot menu, the character creator, the death screen and delete-progress hold-to-confirm all handle pad keys and the merged pad explicitly. No synthetic arrow events are used. With no menu open, pad keys go to gameplay: only Menu/Start pauses, and the D-pad is not prevented, so hotbar and zoom keep working. The inline `<head>` script sets `gamepadInputEmulation = "gamepad"` before any module runs, for EdgeHTML.
- **`?padDebug=1`** mounts a fixed, non-interactive readout (`pre#pad-debug`). It shows `gamepadInputEmulation` support, each pad (index, id, mapping, pressed buttons, axes), the merged pad, the focused element, the top `[data-menu]`, `data-pad-ui`, connect events, the last 8 pad key events (key/code/keyCode → control) and the last nav actions, including drops by the arbiter.

Tests: `packages/input/test/adr213_xbox.test.ts` covers key/keyCode mapping, hat decoding, mapping "" layout and merging. `apps/client/test/adr213_xbox_pad.test.ts` covers pad keys (named and Unidentified) moving once, key repeat timing, A/B/Start, idle pad 0 + live pad 1, the hat pad, API + key + Arrow for one press moving once, frame-hitch taps and the simple-screen helpers. `apps/client/e2e/xbox-nav.mjs` (`pnpm -C apps/client e2e:xbox <url> <shotDir>`) is the production-build harness. It runs six delivery modes (key, keyUnid, apiIdle0, apiHat, apiStick, both) over the main menu, pause hub, every pause entry, inventory (equip, eat, X split, Y to hotbar, drop), chat OSK, settings dialogs, station/camper/trade/pet screens and the death screen. It counts focusin per press, checks repeat and the focus ring, and confirms that the hotbar and zoom do not change while a menu is open.

Consequences: menus accept the controller however Edge delivers it, and no single press can move focus twice. Not verified on Xbox hardware. The harness emulates the documented event shapes.

## ADR-214: Pooled VFX layer (combat, world and ambient effects) with hard memory caps for both renderers

Accepted 2026-10-29. Context: combat and the world had no feedback: no hit sparks, blood, debris, muzzle flash, dust or weather particles. Xbox Edge also crashes under memory pressure (see ADR-212), so any effects layer must stay bounded: no per-frame garbage, no texture growth, and a lighter budget on consoles without changing the PC look.

Decision:
- **One pool:** `apps/client/src/fx/pool.ts` `ParticlePool` is a struct-of-arrays pool (Float32Array/Uint8Array) with a fixed capacity and a live budget. `PF.Prio` spawns steal a slot when the pool is full. Ambient spawns are capped at 60% of the budget and are shed first by the frame-time governor (`shedAmbient`). A refused spawn is counted (`dropped`); nothing grows.
- **Effects (`fx/effects.ts`):** material impacts (blood, ichor, spark/metal, wood, stone, fire, sizzle) with a directional spray, crit flash, deaths, melee swings, muzzle flash and tracers, explosions, footsteps per surface, water splash/ripple/wake, gathering, tree fall, rock break, build place/break, sparkles, steam, level-up, fire ignite/snuff/emit, vehicle exhaust and wheel dust, fireflies, motes, leaves and rain splashes. Screen cues: shake (trauma), hit-stop (the renderer's effect clock; the sim is untouched), hurt/cold/heat/fire vignette, horde flicker and night-fall fog.
- **Director (`fx/director.ts`):** reads the replicated world and the audio director's per-frame sound events, so effects fire on the same events on host and client. It keeps no per-frame maps: a bounded entity lookup is rebuilt at most every 30 frames, and caches are interned.
- **Drawing (`fx/draw.ts`):** a single Canvas2D overlay (`#vfx-fx`) above both the WebGL and Canvas2D renderers, so both look the same. Two fixed sprite atlases (emissive, plus ambient-lit, re-tinted in place when the light level changes). The overlay backing store is capped at `FX_MAX_PIXELS` = 1920×1080 (sprites are soft, so upscaling is invisible). It shrinks to 1×1 when effects are off or the layer is hidden. Vignette canvases are capped at 4. `dispose()` releases every canvas, and `texBytes()` reports the total.
- **Zero per-frame allocation:** hot paths stage particle parameters into the shared `S` Float64Array and call `spawnS(shape, color, flags)`. Passing 16 doubles across a non-inlined call boxed each one as a HeapNumber, about 2.4 KB per impact. PRNG state lives in a Uint32Array, and the frame/env objects are reused.
- **Console profile (ADR-212):** when `memoryProfileFor(...) === "console"` (Xbox/PlayStation/Nintendo UA or `?profile=console`), `FX_CONSOLE` sets a 1024-slot pool, an 800-particle budget and a 1280×720 overlay cap. The effects and palette are the same. Desktop keeps 2048/1400 and the 1080p cap.
- **Settings:** `survivaz.fx.v1` controls effects full/reduced/off, shake, hit-stop, reduced motion (auto follows `prefers-reduced-motion`), ambient and vignette. Effects follow the render-quality tier's particle scale.

Measurements:

| Measurement | Result |
|---|---|
| Node probe (`tools/fx-alloc-probe.ts`), 20k frames of stress | 59 B/frame attributed to fx. Most of it is ambient spawn arguments and `step`'s return value; before the fix it was about 2 KB/frame. |
| `impact` microbenchmark | 0.13 B/impact (was 2463), 1.0 µs/impact |
| Chrome/SwiftShader, 15 s sandbox with continuous bursts | fx-attributed allocation was 0.9–2.5 MB out of about 1.1 GB for the whole page (≤0.2%) |
| Texture memory | constant after warm-up: 12.48 MB worst case at 4K/DPR2 (an uncapped 4K/DPR2 overlay alone would be 132 MB), 10.4 MB at 1280×720/DPR2, 5.8 MB under the console profile, 0 after dispose |
| Frame cost | 0.3–0.8 ms per frame for update plus draw, with 600–1300 live particles |

Tests: `apps/client/test/adr214_vfx.test.ts` (17) covers the pool (caps, stealing, ambient cap, shedding), settings, effect state, the director, a 3000-frame stress run with bounded maps, the overlay pixel cap, texBytes constant then 0 after dispose (`FX_MEM_REPORT=1` prints the numbers), and console-profile detection and caps.

Consequences: effects add bounded, constant memory, and the console gets about half the particle and texture budget. The game's own allocation rate (about 70 MB/s in the sandbox) is outside this ADR. Not verified on Xbox hardware.

## ADR-215: Inner/angled corner posts collide; animals and pets collide with and path around structures

Accepted 2026-10-29. Context: ADR-212 gave players and zombies body collision with edge walls, closed doors and solid cell pieces. Two gaps were left. Free-standing vertex corners (`wall_corner_inner`, `wall_corner_angled`) had no collision: `solidCell` skips `snap === "vertex"`, and only ADR-211 L corners, which are edges, blocked. Animals (`animalAISystem`) and pets (`petSystem`) also moved with a bare centre-point terrain test, so they walked through walls, corners, closed doors and stations.

Decision:
- **Corner posts (movement.ts, shared by player authority, client prediction, zombies and creatures):** `bodyAxisMove` runs the ADR-212 edge/cell clamp, then `postAxisMove` against `cornerPostBoxes(def, rot, vx, vy)`. Each corner has a 0.3×0.3 post at the vertex. An inner corner adds two short stubs (half-length 0.095) along its art arms, so a body walking down the middle of the neighbouring edge never snags. An angled corner adds a chain of four boxes along its 45° run. The art row is chosen the way the renderer chooses it. A body already overlapping a box can always move out of it. `StructureIndex.vertexPosts` counts free-standing solid vertex pieces, so the post pass costs nothing when there are none. `StructureIndex.count` is now O(1) (`info.size`), because it is read per axis.
- **Creature nav (`systems/creature_nav.ts`, authority only; creature Transforms replicate, so prediction is unaffected):**
  - `creatureStep(world, e, gx, gy, sp, stopAt, tileBlocked, dt)` moves the creature with the same `bodyAxisMove` body (radius `bodyRadius`), so creatures obey the same rules as players and zombies.
  - It returns `undefined` when no piece is anchored near the move. `StructureIndex.anyPieceNear` keeps an 8×8-tile block count, updated in `addPiece`/`removePiece`. On `undefined` the caller runs its legacy straight-line step, bit for bit.
  - Near structures it does a body-sized sight check: the centre plus 4 body corners through a tile DDA, plus the exact post boxes. It is allocation-free (`crossOk`, `segBox`), and a clear result is cached for 60 ticks.
  - When sight is blocked, it runs a bounded A*: 4-neighbour, radius 24, at most 1200 nodes, and a detour bound of f ≤ 2·h₀ + 12. A per-search memo handles ENTER/ENTER_OK. Doorways and open doors pass. Closed doors, walls, solid cells, angled-corner tiles and unwalkable terrain block.
  - Routes are cached per entity and dropped when the goal tile changes or `StructureIndex.version` changes (door toggle, build or removal).
    - A found route is kept for 120 ticks. An unreached one re-plans every 40 ticks.
    - A goal that moves one open tile extends the route instead of searching again.
    - The creature steers to the farthest of the next 4 route tiles in sight (string pulling, with the pick cached for 8 ticks).
    - A stall forces a re-plan, then 40 ticks of lane-only steering.
  - An unreachable goal routes to the closest reachable tile. A step that makes no progress returns `false`, and the caller idles.
- **Animals (population.ts):** wander, flee, approach and attack moves go through `creatureStep`. On `false` the animal idles, except in Attack state.
- **Pets (pets.ts):**
  - `step` goes through `creatureStep`, so pets follow their owner through open doorways and doors and stop at closed ones.
  - The legacy "close enough to the owner" stop is not used when the owner is walled off (`walledOff`). The pet paths round until it is within 0.8 tiles or in sight.
  - The catch-up teleport uses `reachableSpotNear`: the first of 12 offsets in body-sized sight of the owner, so a pet never lands behind a wall or inside a station. Away from structures it keeps the legacy (-1, +0.5).
  - Trough reach is 1.5 tiles, because the pet body now stops against the trough footprint.
- **Animal threat scan (perf, population.ts):** living survivors are gathered once per tick into a flat `[e, x, y]` list. Each animal scans that list instead of running `index.queryRadius`, which in a village walks every piece and animal in range. The test is the same: exact r², then hypot, with ties broken on entity id. Above 48 survivors it falls back to the radius query.

Measurements: `PERF=1 pnpm vitest run packages/gameplay/test/bench215.test.ts`. The scenario has 160 animals, 16 pets, 4 walking players and 20 zombies, either on open ground or around a 4×4 village of rooms with doors and workbenches. Values are ms/tick, medians of interleaved runs on the box.

| Build | Open ground | Village |
|---|---|---|
| origin/main (c15efcdd) | 1.48–1.70 | 3.60–3.85 |
| this ADR | 0.71–0.74 | 1.69–1.79 |
| origin/main + threat scan only | 0.68–0.76 | 1.40–1.48 |

Nav itself costs about 0.3 ms/tick in the dense village (about 10% of the profile, mostly route and sight). The threat scan more than pays for it: net, about 2× faster than main in both scenarios.

Tests: `corners215.test.ts` (4) covers the inner post and stubs blocking from every side, the angled run per art row, escape from overlap (zombies collide too) and a deterministic prediction replay past posts. `nav215.test.ts` (7) covers open ground deferring to the legacy step, routing round through a doorway while a closed door keeps the animal out, staying inside a closed room, walking round a workbench, posts blocking creatures, wandering and fleeing animal AI never crossing a closed house's walls, a pet following its owner in through an open door and being kept out by a closed one, and the catch-up teleport landing on the owner's side of the walls. The fixture is in `nav215_fixture.ts`. `bench215.test.ts` runs with PERF=1. Screenshots: `/workspace/shots/gaps214_door_closed.png` and `gaps214_door_open_pet_inside.png`.

Consequences:
- Creatures respect buildings server-side.
- Open-ground behaviour is unchanged (legacy path).
- An Attack-state animal blocked by a wall keeps trying rather than idling.
- An unreachable goal leaves the creature idle at the closest tile.
- ADR-212's lateral slop applies to creatures too.
- The threat scan reads current Transforms rather than spatial-hash cells, which differs only for an entity that crossed a cell this tick.

## ADR-216: Realistic light radii; lights push back the night (gameplay radius = drawn radius)

Accepted 2026-10-29. Context: players reported that campfires and other lights "hardly give any light to protect the player". The drawn light was much smaller than the gameplay light:
- The client light table gave a campfire 4.5 tiles, a torch stand 3.5, a lantern 2.5 and a held torch 3. Lamp posts, candles, chandeliers and other light pieces had no entry and borrowed the campfire spec.
- The WebGL falloff `(1-d²)²` (d = dist²/r²) plus a tight core put the visible edge at about 55–65% of the nominal radius, so a campfire visibly lit about 3 tiles.
- The gameplay light grid (ADR-108 zombie light avoidance) used `max(heatRadius*2, 4)`, so the zombies' stand-off ring (campfire 8, torch 4) sat far outside the visible pool.
- Free-standing lit stations (`spawnStation` campfire/furnace) were not in the light grid at all.
- Canvas2D multiplied the frame by the ambient colour and then added a capped (alpha ≤ 0.6) glow, which tinted the dark but never pushed it back.

Decision:
- **One radius per light piece:** `pieces.json` `lightRadius` (tiles, the distance where the light fades to 0) drives the gameplay light Emitter (`lightRadiusOf`; 0 = legacy `max(heatRadius*2, 4)`).
  - The client draws piece lights with the replicated Emitter radius (`LightTable.withRadius`, kept in sync every frame). The table now supplies only colour, intensity and flicker.
  - Rehydrate refreshes the radius on old saves.
  - The client table and `render_tuning.json` carry the same radius for every light piece (test-enforced).
- **Values:**

  | Source | Old radius (drawn / gameplay) | New radius |
  |---|---|---|
  | campfire | 4.5 / 8 | 8 |
  | fireplace | 4 / 10 | 8 |
  | wood_stove | 3 / 8 | 6 |
  | stove_iron, cook_range | campfire spec / 6 | 5 |
  | clay_oven | campfire spec / 5 | 4.5 |
  | furnace | 3.5 / 6 | 6 |
  | torch_stand | 3.5 / 4 | 6 |
  | lantern, lantern_hanging | 2.5 / 4 | 6 |
  | candle | campfire spec / 4 | 3 |
  | candelabra | campfire spec / 4 | 4 |
  | table_lamp | campfire spec / 4 | 4.5 |
  | floor_lamp | campfire spec / 4 | 6 |
  | wall_sconce | campfire spec / 4 | 5 |
  | chandelier | campfire spec / 4 | 7 |
  | lamp_post | campfire spec / 4 | 9 |
  | free-standing campfire / furnace (`STATION_LIGHT_RADIUS`) | 6 / none | 8 / 6 |
  | heat_brazier (visual) | 4 | 6.5 |
  | held torch (visual) | 3 | 5.5 |
  | held lantern (visual) | — | 5 |
  | held candle (visual) | — | 3 |
  | glow mushrooms, lit windows | 1.6 / 1.5 | 2.5 |

  Gameplay radii that shrink (fireplace, stoves, ovens, candle) now match what is drawn. Every one stays at least `lightAvoid.minRadius`.
- **Free-standing stations:** a lit `spawnStation` campfire or furnace (CraftingStation + Fuel, no piece) joins the light grid at `STATION_LIGHT_RADIUS`. Zombies keep out of it and Snuffers can target it (`snuffLight` already handles a Fuel entity). The client's bonfire light uses the same radius.
- **Falloff (WebGL LightPass and Canvas2D share `lightFalloff`):**
  - Full strength out to 35% of the radius, then a smoothstep fade to exactly 0 at the radius: no rim, and still clearly lit at 75%.
  - A hot core: `exp(-14 t²) · 0.45`.
  - `LIGHT_GAIN` 0.8 puts an intensity-1 plateau at about 0.8 (warm, scene colours readable).
  - Flicker moves brightness ±30% and radius only ±3.5%, since big radii would visibly wobble.
  - The composite applies a hue-preserving soft knee to the decoded light (`lightKnee`: max channel above 1 compressed toward 1.625), so overlapping fires brighten the scene instead of clipping to flat yellow.
- **Canvas2D (`canvasLight.ts`):** a real lightmap.
  - A 1/4-res offscreen canvas is cleared to ambient. Each light is added (`lighter`) as an iso 2:1 ellipse, with the same radius conversion as WebGL (`r·tileW/2·1.414`), gradient stops sampled from `lightFalloff`, and the WebGL flicker noise.
  - The lightmap is multiplied onto the frame, then a small additive warm core is drawn per light.
  - When the ambient sum is ≥ 2.9 (day) it is skipped, as before.
- **Held lights (visual only):** a character whose main hand (or off hand) holds `torch`, `lantern`, `tallow_candle` or `candle` gets a follower view entity with a `held_<key>` LightSource. It is a separate entity so the character sprite never gets BloomSource. Only `tallow_candle` exists in items.json today; `torch` is still only proposed (items_proposed.json), and its light lights up as soon as the item ships.
  - Held lights do not feed the gameplay light grid, so a carried torch does not repel zombies. That would be a gameplay change, left for when the torch item ships.

Not changed:
- Lightmap resolution per quality tier: ultra 1×, high 2×, low/medium/console 4×. The smooth, larger lights look the same at quarter res.
- The light count is uncapped, as before.
- `uStrength` (daylightLightScale 0.2 → 1 at night).

Performance: the same number of instanced quads, with larger quads. Headless SwiftShader sandbox at 23:00 with 6 lit fires, a torch stand and a lamp post:

| Renderer | Before (mean / p95) | After (mean / p95) |
|---|---|---|
| WebGL | 140 / 150 ms | 124 / 150 ms |
| `?profile=console` | 131–146 / 250–300 ms | 122–131 / 233–250 ms |
| `?renderer=canvas` | 107 / 133 ms | 102 / 167 ms (one noisy run 277 ms) |

The numbers are all within run-to-run noise.

Tests: `adr216_light_radius` (gameplay data, light grid, stations, avoidance, rehydrate), `adr216_light_falloff` (profile, canvas stops, flicker, knee) and `adr216_lights` (client table matches pieces.json, held lights).

## ADR-217: Axe icon over trees, logs from trees / sticks from the ground, held lights repel zombies

Accepted 2026-10-29. Context: owner feedback. Trees showed the hand interaction icon although they are meant for an axe; trees dropped about as many sticks as logs while fallen branches were the main log source; and a torch, lantern or candle in hand did not scare zombies (ADR-216 left held lights visual-only).

Decision:
- **Tool icon (ADR-126 `toolHintFor`).** A tool node that bare hands can still work (`bareHands`, e.g. a tier-1 tree) now shows its tool's icon (axe over trees, pickaxe over boulders / veins, shovel over clay) with `have` true, `equipped` false and `bare` true. The client draws the crisp axe art with the gold "use / equip a tool" ring, never the hand; the label still says "bare hands (25% yield; axe for full)". Nodes with `requiredTool: none` (bushes, branches, fiber grass, loose rocks, crops, fruit trees) keep the hand. The hint is the same DOM canvas overlay for WebGL and Canvas2D, and it works for mouse, touch and gamepad.
- **Yields (resources.json).** Old → new:
  - `tree`: wood 2–4, sticks 1–2 @40% → wood 3–5, sticks 1 @30%. Fiber and apple are unchanged.
  - `oak_tree`: hardwood 2–3, sticks 1–2 @50% → hardwood 2–4, sticks 1 @30%.
  - `fallen_branches`: wood 1–2 (always) + sticks 1–3 @60% → sticks 2–4 (always, first yield, so bare hands get sticks) + wood 1 @35% + fiber 1 @20%.
  - Expected value per swing: tree 4 logs vs 0.3 sticks; branches 3 sticks vs 0.35 logs. `dry_shrub` and `rotten_stump` already gave only sticks.
  - Why branches still drop the odd log: with zero logs, the ADR-203 AI humans (and a brand-new player without an axe) only get wood by punching trees (1 log per 2 s), and the AI campfire-before-night test failed. 35% keeps "more sticks than logs" by about 9× and keeps the first night survivable.
- **AI (ADR-203 autonomy).**
  - A wanted node's pull (up to −20 tiles) now scales with how much of the needed items one swing is worth. Bare hands count only the first yield at `yieldMul / cooldownMul`.
  - A fitting tool in the bag counts for a node, and the bot equips it for that node (`gameplay.equip`, as a player taps Equip), so a bot holding a knife switches to its axe for trees.
  - The goal order is now stone axe → home campfire → pickaxe / spear (`FIRE_AFTER_GOALS = 1`). The goal tools after the axe also reserve the campfire's cost.
- **Torch and lantern (items.json, recipes.json).**
  - `torch`: tier 1, stack 5, worn in the off hand, `heldLight` 5.5. Hand-crafted in 2 s from 2 sticks + 2 fiber, so it is available on day one.
  - `lantern`: tier 2, worn in the off hand, `heldLight` 5. Made at a workbench from glass + copper ingot + tallow candle.
  - `tallow_candle`: now has `heldLight` 3, off-hand wear and tier 1.
  - `ItemDef.heldLight` (0..12 tiles, default 0) is the single source of truth. The client draws the held light at that radius (the `held_<key>` look, otherwise the torch look), so the drawn radius equals the gameplay radius as in ADR-216.
- **Held lights in the light grid (lights.ts, server-authoritative).**
  - `activeLights` adds one light per living entity with `max(heldLight(main-hand item), heldLight(worn off-hand item))`. Players, AI humans and NPCs all count. A torch merely carried in the bag does not; a dead bearer does not.
  - The rebuild interval is unchanged (every 10 ticks). Held lights are bucketed with a 4-tile pad (`HELD_LIGHT_PAD`), and `lightAt` reads the bearer's live position, so the ring follows a running player between rebuilds.
  - Zombies, including horde members (same `shyGoal`), keep out of the radius at dusk and night exactly as for placed lights (ADR-108 / ADR-216).
  - Same exceptions as for placed lights:
    - a zombie already in melee reach (AttackPlayer) still swings;
    - `ignoresLight` types ignore it;
    - Snuffers go for the light, which for a held light means attacking the bearer.
  - Cost: one Equipment / Worn query per grid rebuild, plus one Transform read per held-light candidate in the queried cell.

Tests:
- `adr217_axe_yields_heldlight` covers:
  - the icons per node class;
  - expected yields;
  - a stone-axe tree run vs a branch run;
  - the torch / lantern / candle data and recipes;
  - main-hand and off-hand radii and the live follow;
  - a carried torch and a dead bearer;
  - a walker kept beyond 5 tiles of a torch bearer at night (control: it closes to 2 tiles);
  - a horde member kept away.
- `tool-hint` and `gathering` are updated for the new icon and yields.

## ADR-218: Fires animate (placed hearths, stations, held torches, burning flames) with embers and smoke

Status: accepted (2026-10-29)

Context: campfires and other fires looked frozen. Causes, in both renderers:
- Placed fired pieces (campfire / bonfire, furnace, fireplace, stoves, torch stand) resolved their static building frame. In WebGL they were then baked into the static chunk VBOs. In Canvas2D `gatherPieces` also ignored the piece state, so an out bonfire still looked lit.
- The free-standing station bonfire was stuck on frame 0 in WebGL (`frameId` 0 with no AnimState). In Canvas2D it animated, but in lockstep with every other fire.
- The held torch was resolved at t = 0.
- The furnace has no `unlit` building state (its building frames are per damage stage), so an out furnace drew lit art.
- ADR-214 burning flames lived 0.8 s (exactly one 8-frame loop) and were respawned at 0.98 × life with a 0.15 s fade-out. Every flame dipped in alpha about every 0.78 s and all tiles restarted on frame 0 together. VfxLayer eviction could also drop them silently.
- Lit hearths had no embers or smoke; only Burning pieces and chimneys emitted them.

Decision:
- **Fire clock (`fire-anim.ts`).**
  - `fireAnimTime(now, seed)` runs on render time (not sim ticks), with a hashed per-entity phase (0..8 s) and a rate jitter of 0.85..1.15×, so neighbouring fires never flicker in sync.
  - A lit fire plays its sprite's looping multi-frame `idle` (`AtlasManager.fireAnim`, `isFireAnim`).
  - `pieceFireFrame` is the shared rule:
    - lit, intact and not a ghost: play the flame;
    - out, with no own building state: show the `unlit` anim frame;
    - otherwise: the building frame. flipX is kept.
- **WebGL (`sprites.ts`).**
  - Pieces apply the rule from the new `pieceLit` binding. An animated fire is `dynamic`, so it is never put in a static chunk.
  - Lit station sprites with a fire anim animate.
  - `emitHeld` plays the held sprite's fire anim at the bearer's fire time.
- **Canvas2D.**
  - `gatherPieces` uses `pieceFireFrame` with `pieceLit` / `pieceState`.
  - Lit stations get the per-entity fire time.
  - Hearths draw stateless embers and smoke (`hearthParticles`, additive embers).
- **Burning (ADR-214 revisited).**
  - One persistent, infinite-lifetime flame per footprint tile (capped), each with a random anim age.
  - A flame is respawned only if it was evicted (`VfxInstance.dead`) or its size class changed. Flames are killed (`VfxLayer.kill`) when the burn stops.
  - `VfxSpawn.age` back-dates the birth time.
- **HearthFx.**
  - Calm `campfire_sparks` and `campfire_smoke` particles rise over lit hearths and lit fire stations (`litPieces` binding, FireState.Hearth = 2). It is capped at 48 hearths.
  - The client classifies hearths in `fire-state.ts`: campfire, furnace, fireplace, wood_stove, stove_iron, cook_range, clay_oven. Lanterns, candles and lamps stay light-flicker only.

Unchanged:
- Light flicker (shader, time-based).
- Single-frame decor lights.

Tests:
- `render/adr218_fire_anim` covers:
  - clock advance, looping and per-entity desync;
  - `pieceFireFrame` on the real bonfire / furnace art: lit animates, out furnace shows unlit, damaged / ghost / non-fired keep the building frame;
  - VfxLayer age / kill / eviction `dead`;
  - BurningFx keeps the same flame instance at full alpha for 5 s and kills it when the burn ends;
  - HearthFx emits only for hearths and lit stations;
  - the bounds and alpha of the Canvas2D particles.
- `client/adr218_fire_state` covers the state mapping, that hearth keys are fired pieces, and the binding / static-chunk wiring.

Shots: `/workspace/shots/fire_{before,after}_{webgl,canvas}_1..6.png` (screencast, about 100–230 ms apart under swiftshader).

## ADR-219: Skill nodes show a generated, never-clipped description (focus / hover / select)

Problem: skill nodes showed only a name and cost. The `title` → `[data-tip]` bubble was a CSS `::before`, so the tree viewport clipped it and it covered neighbouring nodes. Gamepad focus showed nothing.

Decision:
- **Generated text (`gameplay/skills/describe.ts`).** `skillDescription(i)` (cached) is built from the node's `effects`, and `SkillNodeView.info` carries it.
  - Mods → `SKILL_MOD_LABEL` lines with values, e.g. "+15% gather yield". `dmg_*` entries with equal values merge into one line, and a single class lists its weapons.
  - Perks → `SKILL_PERK_TEXT`, which uses the real constants: `IRON_STOMACH_HP`, husbandry `breedSeconds` / `maxPerTrough`.
  - Skill-level nodes → "<Skill> skill level N" plus "Unlocks recipes: … and N more" from recipes.json, or "Needed for <Skill> N+1".
  - Rank chains (same branch, same effect signature) → "Rank n of N" plus a running total for earlier ranks.
  - An authored `desc` survives only as a non-numeric flavour note, so the shown numbers always come from data.
  - New exported constants used by both the code and the text: `FIRE_TENDER_RADIUS = 6` (fuel.ts) and `XP_SHARE_RADIUS = 20` (tree.ts).
- **Description panel (`[data-role=skill-desc]`, `#skill-desc`).** The panel sits above the tree viewport, inside `[data-role=skill-view]`, so it is never inside the clipped, pannable area.
  - It wraps (`white-space:normal; overflow-wrap:anywhere`) and has a min-height of 6.2em, so its height doesn't jump.
  - The tree height became `clamp(150px, 100dvh - 470px, 420px)`, so panel + tree fit at 720p and on mobile.
  - It shows the title, cost and rank, the effect lines, and the state (learned / reject reason / how to learn).
- **Focus drives the panel.**
  - Node `onfocus` (D-pad / Tab) and `onmouseenter` set `skillUi.peek`, which survives the periodic menu re-render. `vp.onmouseleave` restores the focused or selected node.
  - On focus, the node is revealed inside the tree viewport only (`revealIn`), and then above the sticky pad-hints footer.
  - Nodes drop `title` (no `data-tip`) and get `aria-describedby="skill-desc"` plus an aria-label that contains the description.
- **`morph` copies handler properties.** It now copies `onfocus` / `onmouseenter` / `onmouseleave` as well as `onclick` (`MORPH_HANDLERS`). Reused elements no longer keep stale closures pointing at a discarded panel. Panels that need focus / hover behaviour across refreshes must use these properties, not `addEventListener`.

Tests:
- `gameplay/adr219_skill_desc` covers:
  - every node has non-empty text;
  - every mod value appears as a %;
  - authored % values agree with the data;
  - specific values, rank chains and totals, and recipe unlocks.
- `client/adr219_skill_desc_panel` covers:
  - D-pad focus updates the panel and it survives `refresh()`;
  - the panel is outside and before the tree viewport and wraps;
  - every node in every tab yields effect lines;
  - `morph` carries the handlers.

Shots: `/workspace/shots/skilldesc_{desktop,720p,mobile}.png` (Crafting / Master Smith), `skilldesc_combat_*.png` (Blades Expert, rank 2/3) and `skilldesc_before_*.png`. The layout probe reports overflow false, no clipped nodes, and the focused node visible at 1920×1080, 1280×720 and 390×844.

## ADR-220: Characters never render distorted after an atlas re-tier (live layout kept until swap; lossless paper-doll pools)

**Symptom.** Player and AI humans (body, customizations, wardrobe layers) look right for a few seconds, then go wrong. They show as undressed or body-only for about 4 s, with stray garbage frames (e.g. a floating head), and then settle at reduced fidelity.

**Root cause.**
1. `AtlasManager.rebuild()` (an ADR-190 re-tier, e.g. a downscale step-up about 11 s after start, a zoom or footprint change) tore down the live state *first*: `pools = []`, `layoutVersion++`, `gen++`, caches cleared. It then spent seconds loading images, running `fitBudget`/`halveSide` and laying out before the swap. During that window the renderer kept drawing with no pool residency, so wear layers were missing. ADR-188 `lastGood` held composites also replayed entry/atlas indices from the dead layout, which produced the misplaced-part frames. SettleHold (1500 ms) only covered the post-upload phase.
2. Contributing cause: paper-doll pages were ETC1S-transcoded and are lossy against the source PNGs. Measured mean diff was 9.3 for hoodie (8.5 % of px > 32 off) and 10.6 for body_male (11.9 %).

**Fix.**
- `rebuild()` keeps the live pools, layoutVersion and gen untouched while planning (`planningRebuild` flag; `poolReserveBytes` ignores stale tint flags meanwhile). It bumps generation, clears caches and swaps only immediately before `layout()` and upload, which SettleHold covers.
- `SpriteRenderer` clears `lastGood` whenever `atlas.layoutVersion` changes, so held frames never index a foreign layout.
- When the texture budget is ≥ 448 MB (desktop 768, ultra 1024, ultra-console 448), the `body` and `wear` pools are no longer put in the compressed own array. They page in from the lossless PNGs into RGBA8, so they match the source art exactly. Lower budgets keep ETC1S (console 256, mobile 128, lowmem/safe 160): always-lossless measured 130 → 246 MB at a 160 budget and crushed vehicles and buildings to 0.25×. That is a documented quality-for-VRAM trade-off on those tiers. The compressed tail order is now body, wear, bld, veh, stream.
- No per-frame cost was added: one integer compare per draw, and the rebuild work is unchanged.

**Tests.** `packages/render/test/adr220_char_fidelity.test.ts` covers four cases:
- the lossless threshold;
- `planOwn` at 768 leaves body/wear uncompressed while veh stays compressed;
- at 160 everything is compressed;
- rebuild keeps the live layout, layoutVersion and gen through `fitBudget` and bumps them once at the swap.

**Shots (`/workspace/shots`).**
- `charfix_before_dpr2_1..14.png` and `charfix_before_timeline.png`: original code, t = 10–19 s, dressed → undressed → stray head → dressed.
- `charfix_after_dpr2_1..14.png` and `charfix_after_timeline.png`: stays dressed through the re-tier.
- `charfix_after_{canvas,console_webgl,mobile_webgl}_1..3.png`: Canvas2D, `?profile=console` and mobile, stable at t = 5/15/25 s.
- `charfix_source_ref_png_vs_etc1s.png`: source PNG vs ETC1S comparison.
- `charfix_before_webgl_1..10.png`: initial reproduction.

## ADR-221: Crafting stations and building tiers are unlocked in the skill trees

**Context.** Every crafting station and every building tier was available from the first minute. The request: all stations and base-building tiers must be learned in the skill trees, a fresh character starts with twig only, the build menu shows what is locked and why, the server enforces it, and AI humans must still progress.

**Decision.**
- 13 new skill nodes (appended to `gen-skills.mjs`, so existing node bits are unchanged; 122 → 135 nodes). Each carries `effects.unlock: string[]` with `piece:<key>` / `tier:<key>` tokens:
  - Survival: **Firecraft** (campfire, cost 1). It lives in Survival, not Cooking, so the first fire never needs cooking XP (cooking XP needs a fire).
  - Crafting: **Workbench** (1) → **Furnace** (1) → **Anvil** (2) → **Garage** (2).
  - Building: **Wood Framing** (tier wood, 1) → **Stonework** (stone, 2) → **Sheet Metal** (metal, 2) → **Reinforced Steel** (reinforced, 3).
  - Cooking: **Wood Stove** (1) → **Clay Oven** (1) → **Iron Stove** (2) → **Cook Range** (2).
  - Prerequisites stay inside one category (ADR-209 trees). Unlock nodes reuse existing atlas icons.
- Gates: a station piece needs its `piece:` token; a tiered piece at tier > twig needs that `tier:` token. Recipes made at a station need that station's token. Fixed-tier furniture/decor (storage box, doors, beds, …) is **not** gated; gating 170 pieces would have needed 170 nodes and was not asked for.
- Server enforcement (authoritative): `validatePlacement` → `BuildFail.SkillLocked` (22), Upgrade → `SkillLocked`, `checkRecipe` → `CraftFail.Locked` (8), craft queue → `"skill_locked"` (new `COMMAND_REJECT_REASONS` entry). Entities without `Progression` (NPC crafters, tooling) are never gated.
- UI: `buildView` returns `locked` + `requirement` ("Requires Stonework (Crafting & Building)") per tier. The build panel prefixes locked pieces and tiers with 🔒, greys them (`alt`), puts the requirement in the tooltip/aria-label, shows a requirement line and disables Place. Locked buttons remain focusable, so D-pad/gamepad navigation and the scrolling grid layout are unchanged. The craft panel explains `skill_locked`. Skill descriptions say "Build the Campfire (and craft its recipes)" / "Build and upgrade to the stone tier".
- AI: `pickSkillNode` heavily weights unlock nodes (×20 for campfire, workbench and wood tier; ×4 for the rest). The agent now spends per-tree points; before this change it checked the always-0 global `points`, so AI never learned anything. The survivor build planner skips pieces it has not unlocked.

**Save migration.** `Progression.tver` 1 → 2. Any character with history (tver ≥ 1, points, xp, level > 1 or any node) gets **all** unlock nodes free, so already-placed pieces, upgrades and known recipes keep working. Placed pieces are never removed for any player. Fresh characters (tver 0, no history) start twig-only. Respec keeps unlock nodes and does not refund them; a character that only owns unlock nodes has nothing to respec.

**Tests.** `packages/gameplay/test/adr221_unlocks.test.ts` (16): data/gating invariants, reachability, twig-only placement, SkillLocked on place/preview/upgrade, craft `skill_locked`/`Locked`, the NPC exemption, migration (legacy vs fresh), respec, AI picks, and `buildView` locked/requirement. Existing tests that assume a seasoned builder use the `spawnLearned` helper. `persist/progression_trees` and the icon-count test were updated.

## ADR-222: Choosing a piece never places it (placement-confirm latch)

**Bug.** With a controller, picking some stations or furniture in the Build panel placed them straight away, at whatever spot the aim defaulted to. The player never chose where.

**Root cause.**
- `UINav` reads the pad directly and clicks the focused button on the A edge. That happens inside `onUiFrame()`, after `input.update()` has already recorded the same A press.
- The click calls `startPlacing`, which pushes the `Building` context. In that context A (and RT, mouse left, Enter-driven clicks) is bound to `Build.PlaceConfirm`.
- `buildMode.update()` then runs in the same input frame and sees `Build.PlaceConfirm` as pressed, so the piece was placed at once.
- Mouse had the same race on the click that closed the menu. Pieces are only ever placed through BuildMode (no item auto-deploys), so this one path covers stations, furniture and structures from every entry point.

**Fix.** `BuildMode.start()` arms a confirm latch. `Build.PlaceConfirm` is ignored until it has been seen released (`input.down` false) in a frame after the start. The latch re-arms when the picker reselects a piece while placing. Rotation, nudging, tier and floor all work during the latch, and cancel (B / Esc) still works. `BuildModeInput.down` is optional; fakes without it fall back to `pressed`.

**Tests.** `apps/client/test/adr222_place_latch.test.ts`:
- gamepad, keyboard/mouse and touch;
- campfire, workbench, storage box, foundation and lantern;
- the selecting press, held for 3 frames, places nothing;
- after release, rotate, then a fresh confirm places it;
- re-selecting re-arms the latch.

## ADR-223: Slot-grid inventory, quick eat, compact crafting

**Context.** The inventory was one long list of buttons (pack, a "Split / hotbar…" list, Equipment, "Eat & drink", Vehicles, "Drop items…"),
and crafting was one huge recipe list; players scrolled to eat or craft, and hover tooltips overlapped neighbours.

**Decision.**
- Inventory (`[data-role=inv-layout]`): pack slots `HOTBAR_SIZE..slotCount-1` as fixed tiles in a contained scroll area (`inv-grid`), the
  hotbar `0..7` as a bottom row (`inv-hotbar`, key numbers shown), Equipment as a right column (stacked above the grid under 620px).
  Tiles keep `slot-N` / `[data-role=slot]` and carry no `data-tip`; ONE details pane (`inv-details`) shows the selected / focused item and
  its actions (Eat/Drink · Equip · Off hand · Deploy · Split · To hotbar · Drop) as plain buttons — the old Eat / Drop / Vehicles / arrange lists are gone.
- Quick use with no Eat button: pad A / Enter (click `detail === 0`) = primary action (eat · drink · equip · store); mouse / touch: tap selects,
  a second tap within 450 ms (double-click / double-tap) = primary. Pad X / Y stay split / to hotbar (ADR-204/205; targets live in the pane,
  which follows focus). Drag a tile onto any slot = MoveSlotCmd (move / swap), onto Equipment = equip.
- Hotbar food: `edgeCommands(edges, world, e)` maps Hotbar1..8 on a food slot (not tool / weapon) to UseCmd instead of EquipCmd
  (`hotbarConsumes`, shared by client prediction and the server); tapping the on-screen hotbar does the same. Without a world the ADR-180 mapping is unchanged.
- Crafting / station: category tabs from the output item's category (All · Tools · Combat · Wear · Food · Materials; LB/RB on pad), a search
  box (name or ingredient), ×1/×5/×10 (LT/RT), a scrollable tile grid (`recipe-grid`, `recipe-ID` keys kept, click / A queues) and a details
  pane (`craft-details`) for the focused / hovered recipe with have/need per ingredient.

**Consequences.** Tests: adr223_inventory_grid (layout, double-tap eat, pad A eat/equip + X split, drag-drop, hotbar food, crafting tabs/search/details);
old Drop-section / crafter-tooltip tests now target the details pane. RB/LB hotbar *cycling* still equips (cycling past food must not eat it).

## ADR-224: Build window — tabs, tile grid, choose = place

**Context.** The build panel was a wall of text buttons: category buttons, a piece list, then Tier / Variant / Tint rows, a Cost line and a
separate "Place" button (one more press for every piece, and the ADR-222 carry-through bug lived on that press). Piece cost / lock reasons were
`data-tip` hover tooltips, which were cut off at the panel's right edge (ADR-221 follow-up), and Roads & signs made the panel scroll.

**Decision.**
- Category tabs are derived from the piece data (`bcat-<category>`, `data-tabs="tab"` → LB/RB), plus a `bcat-roads` tab for the road / sign
  tools when available. They wrap on wide screens and scroll horizontally under 620px.
- Tier tabs (`tier-N`, `data-tabs="page"` → LT/RT, 🔒 when locked) appear when the category holds tiered (structural) pieces. Tile cost follows the chosen tier.
- `[data-role=piece-grid]`: one tile per piece (`piece-ID`, role piece) with a preview glyph from its key (`pieceGlyph`; pieces have no item art),
  name, cost (or "Locked"), `data-locked` / `data-short`, aria-label and pad label (Place / Locked / Can't afford). There is no hover tooltip;
  the grid scrolls inside the panel.
- One details pane (`build-details`) for the focused / hovered tile: name · tier, have/need per material, the ADR-221 requirement line
  (`build-locked`) or a hint, then Variant and Tint rows when the piece has them.
- Choosing a tile (click, tap, pad A, Enter) starts placement at once (`startPlacing`) and closes the window. There is no Place button, and
  nothing is spent until the placement is confirmed (ADR-222 latch). A locked or unaffordable tile only selects and says why.
- Back: Cancel (B / Esc) in a menu-started placement returns to the build window once Cancel is released (`BuildMode.start(sel, { fromMenu })`
  + `onBack`). ToggleBuild still goes straight to the picker.
- Tooltip edge fix: the last button of a multi-item grid opens its `data-tip` leftwards; the build window itself has no tooltips.

**Consequences.** Tests: adr224_build_window (tabs, tiles, no tips / no Place, tier tabs change cost, hover → details, choose → placing on mouse
and pad, unaffordable stays, glyphs, back-after-release); adr200 pad test now places with one A. Glyphs are a stand-in until pieces get icon art.

## ADR-225: Slower skill-tree leveling (modelled play session)

**Problem.** Trees went 1 → 7 in minutes. Two causes: the ADR-209 tree curve was tiny (base 40, ×1.1: 309 XP to level 7), and gathering paid `source × items` once **per yield line** (a tree swing dropping 4 wood + sticks + apple paid ~12 XP instead of 2).

**Decision.**
- Gathering XP is paid **once per successful swing** (`ItemGathered` de-duplicated per entity/node/tick), units = 1.
- `skills.json treeLevels.early = [150, 450, 800, 1200, 1600, 2100]` (XP to next for levels 1..6), then geometric ×`growth` (1.1) from the last early step (`treeXpCurve`). Cumulative: L2 150, L3 600, L4 1400, L5 2600, L6 4200, L7 6300, L10 ~13 950.
- Character level (`levels`, used by hordes / ADR-226) is unchanged; it only slows because gather XP is no longer multiplied by item count.
- `skills/xp_sim.ts` models one hour of focused play per tree (rates include walking, stamina, inventory, respawns). `adr225_xp_curve.test.ts` asserts: level 2 (ADR-221 cost-1 unlock nodes) < 10 min, level 3–4 after 1 h, level 7 after 3–7 h; and prints the table.

| tree | old XP/min | old L2 / L7 / L@1h | new XP/min | new L2 / L4 / L7 / L10 | new L@1h |
|---|---|---|---|---|---|
| survival | 87 | 0.5m / 3.5m / L28 | 27 | 5.6m / 52m / 3.9h / 8.6h | 4 |
| crafting | 20 | 2.0m / 15m / L15 | 20 | 7.5m / 1.2h / 5.3h / 11.6h | 3 |
| homestead | 34 | 1.2m / 9m / L19 | 22 | 6.8m / 1.1h / 4.8h / 10.6h | 3 |
| combat | 24 | 1.7m / 13m / L17 | 24 | 6.3m / 58m / 4.4h / 9.7h | 4 |

Existing saves keep their levels (only future XP is affected). AI humans (host-flagged bots) get `xp.json aiHumanMul` = ×5 on every award so their short simulated lives still reach the base-plan unlocks (ADR-203 campfire-before-night test); they use the same awards and spend points through the same picker; the ADR-221 base-plan unlocks still come first.

## ADR-226: Snuffers wait for level 10

**Decision.** A zombie kind may carry `minPlayerLevel` / `levelRadius` (zombies.json); the Snuffer has 10 / 64 tiles.
**Which level:** the **highest skill-tree level** (ADR-209 per-tree level, the number on the skill tabs, retuned by ADR-225) of any **human** player (alive, `Progression`, not a host-flagged AI human) within 64 tiles of the spawn point. Chosen over the hidden character level because it is what players see and plan around, and because AI humans level ×5 (ADR-225) and must not pull light-destroyers onto new players. With ADR-225 that is ~9–12 h of focused play in one tree.
**Where (server only):** `combat/zombie_gate.ts` — population spawner (`host.spawn` refuses the snuffer entry), legacy per-player spawner (gated roll becomes a walker) and horde director (gated by the horde target's position; roll becomes a walker so the horde keeps its size). Snuffers that already exist are untouched. Tests: `adr226_snuffer_gate.test.ts`.

## ADR-227: Smaller campfire flames (fallback `scale` honoured for build pieces)

**Context.** The pack has no campfire art, so the campfire piece/station falls back to the full-size `bonfire` sprite (ADR-110/112). Its flames were taller than the player. The view's piece-key fallback (`pk`) kept only the key and dropped the chain's `scale`/`tint`, so the existing `lantern` (0.4), `torch_stand` (0.6) and `wood_stove` (0.8) scales had no effect either: every bonfire-art fire drew at bonfire size.

**Decision.**
- `sprite_fallbacks.json`: campfire → bonfire gets `"scale": 0.55`.
- New render binding `pieceScale(entity)` sets a uniform scale about the pivot.
  - WebGL: written into the piece instance scale, so it covers the static chunk, dynamic and ADR-218 animated paths.
  - Canvas2D: `drawPiece` applies `ctx.scale`.
- The client view resolves the scale per piece key (`pieceArtScale`, cached) for placed pieces and the build ghost. Free-standing campfire stations draw the campfire fallback sprite with its scale.
- ADR-218 hearth embers/smoke scale with the flame:
  - WebGL `HearthFx`: spawn height × scale; stations read `Sprite.scale`.
  - Canvas2D: `hearthParticles` gets tileW × scale.
- Unchanged: the ADR-218 animation (same frames and clock) and the ADR-216 light radius (8).

**Other fires.** The lantern (0.4) and torch stand (0.6) now actually render smaller, which is also correct for their size. Wood stove 0.8 and fireplace 1.0 use furnace art. The real `bonfire` piece stays at full size.

**Tests.** gameplay adr227_campfire_scale (3) and render adr227_flame_scale (1). Screenshots: /workspace/shots/flame_small_{before,after}_{webgl,canvas}_{1,2}.png.

## ADR-228: Smoother build placement mode

**Context.** In build mode, `BuildMode.refresh()` ran every frame and did all of this each time:
- a snap + validate pass (`buildPreviewFor`);
- with the gamepad assist, up to 16 extra ring previews, each calling `validatePlacement` again;
- a full linear `pieceTargetAt` scan that copied the Transform of every BuildPiece.

The view also re-synced the ghost every frame and stepped to each new snapped spot. The snap overlay cleared and re-stroked its full-screen canvas (with shadow blur) every frame, even when nothing had changed. Static chunks were not the problem: the browser probe counted 0 `staticRebuilds` while moving the ghost, before and after the change, because the ghost is drawn as a dynamic sprite.

**Decision.**
- **Memoized validation per preview pass.** `buildPreviewFor` wraps its pass in a memo keyed by the snapped slot (def, tier, variant, parent, pos, facing, slot fields). The magnet candidates and the assist ring validate each distinct slot only once. The world cannot change inside one pass, so the reuse is exact. Counters live in `previewStats`.
- **Spatially throttled per-frame refresh.** The per-frame call skips the snap/validate/target queries while all other inputs are unchanged and the aim moved less than `REFRESH_STEP` (0.125 tile) within `REFRESH_MAX_MS` (100 ms). The other inputs are: selection, autoRot, rotation, level, assist, aim mode, player position, world tick, and structure count. Explicit actions (place, rotate, level, tier, piece, snap toggle, target actions) always refresh exactly.
- **Cheaper `pieceTargetAt`.** It reads fields instead of copying Transforms and rejects pieces outside the aim box first. The level penalty sits on both sides of the radius test, so only pieces within `radius` of the aim can win. Results are identical, and a brute-force comparison test checks this.
- **Interpolated ghost.** `view.syncGhost` eases the drawn ghost toward the preview: rate 25/s, about 40 ms to close two thirds of the gap. It snaps instead when the piece, tier, variant, rotation or level changes, or on a jump of 3 tiles or more. A settled, unchanged ghost is not re-synced.
- **Snap overlay.** It redraws only when its line set (coordinates, colours, viewport) changes.

**Numbers.**

Node bench: 478 pieces (a 20×20 foundation grid plus 4 wall rows), aim sweeping each frame, BuildMode.update CPU ms/frame:

| Input | Piece | Before (ms) | After (ms) |
|---|---|---|---|
| Mouse | wall | 0.565 | 0.256 |
| Mouse | foundation | 0.378 | 0.195 |
| Mouse | campfire | 0.300 | 0.169 |
| Gamepad | wall | 0.466 | 0.230 |
| Gamepad | foundation | 1.515 | 0.321 |
| Gamepad | campfire | 0.316 | 0.180 |

`pieceTargetAt` dropped from about 0.15 to 0.085 ms.

Browser (swiftshader, 1280×720, about 220 pieces): frame times are GPU-raster bound at about 200 ms in software GL, so the change does not show up in total frame time there. The CPU segments came out as follows:

| Renderer | Input | BuildMode.update before (ms) | After (ms) |
|---|---|---|---|
| WebGL | mouse | 1.02 | 0.67 |
| WebGL | pad | 3.6 | 2.8 |
| Canvas2D | mouse | 0.70 | 0.60 |
| Canvas2D | pad | 2.6 | 3.3 |

- The pad numbers are noise at 5 fps: every frame moves about 1 tile, so the throttle never applies.
- Hot in-page timings after the change: pad preview 0.32 ms, mouse preview 0.04 ms, target 0.03 ms.
- Static chunk rebuilds while moving: 0 before and after.
- Probe: /workspace/shots/perf228.mjs.

**Tests.** apps/client adr228_build_smooth (3): throttle/refresh rules, memoized ring validation, and target scan equal to brute force.

## ADR-229: Build window icons from Art's items_build atlas

**Context.** The ADR-224 build window used placeholder emoji glyphs on its tiles (`pieceGlyph`). Art & Assets shipped one icon per piece and tier, plus road surfaces and sign kinds, in the `items_build` atlas (32px cells, @2x 64px, category ui, stream residency, centre-anchored; generator `packages/assets/pack/items/src/adr224.py`). The generated icon CSS already has `[data-icon="build_*"]` rules for it. The rug, curtain and tapestry icons are white because the game tints them with the clan palette.

**Decision.**
- **Piece tiles.** `buildIconKey(pieceKey, tier, tiered)` maps a tiered piece to `build_<key>_t<N>` for the selected tier and an untiered piece to `build_<key>`. If the selected tier has no art (below the piece's `minTier`), the nearest tier above it is used. The tile gets `data-icon` and `data-bicon`, and its `::before` draws the atlas cell at 32px in place of the glyph.
- **Locked tiles.** They keep their art, shown greyed, with a 🔒 before the name.
- **Glyph fallback.** If no candidate key exists in the stylesheet (`hasIcon`), the tile keeps `data-glyph`.
- **Roads tab.** Button `road-<i>` uses `build_road_<ROADS.surfaces[i-1].key>`. `sign-place` and `sign-edit` use `build_sign_wooden_post`. Icons sit left of the label.
- **Clan tint.** It applies to pieces whose key matches `isClanTintedIcon` (`rug_*`, `curtains`, `tapestry`). The tile's `::before` multiplies a colour over the art (`background-blend-mode: multiply`) and is masked to the icon's alpha, which keeps the cel shading. The colour is the selected paint index, else the player's clan (`clanTintIndex`), else palette 1. It comes from `GameplaySource.clanTint`, which is the registry's `clanPaletteForTint`. The client registry currently loads no clanPalettes, so `CLAN_PRIMARY_FALLBACK` is used: it copies the assets/pvp_clan primaries and is test-locked against them.
- Art's `skills.py` is not touched.

**Tests.** apps/client adr229_build_icons (2):
- For every pieces.json entry, every tier from minTier to 4 has its exact key in both the items_build manifest and the stylesheet. Below minTier there is no glyph. Every road surface and sign kind has its key, and the sign tool has its icon. The tinted set is pinned, and the fallback palette equals the assets palette.
- In the DOM: a tier-3 click gives `build_foundation_t3`; a rug tile gets `data-tint=clan` with `--bt` from the clan; the road and sign buttons carry their keys.

**Screenshots.** In /workspace/shots, `build3_{desktop,720p,mobile}{,_tier3,_rugs,_rugs_tint2,_roads}.png`, produced by build3.mjs. In each view, all 186 tiles and tools across the 10 tabs show an icon, with 0 glyph fallbacks.

## ADR-230: In-world clan tint for build pieces

**Context.** Art put clan palettes on main (1ed134b9): `registry.clanPaletteForTint(t)` (1-based, 16 palettes) and `buildPieceVisual(...).palette`. In the world, pieces were still drawn with `tint: 0`. `clanTintIndex` returned 1-255, and the build window used a hard-coded `CLAN_PRIMARY_FALLBACK` table.

**Decision.**
- **Tintmask gating** (`apps/client/src/clan-tint.ts`):
  - A piece is tinted only when its atlas frame has a `tintmask` region (`pieceHasTintMask`). Without a mask, the shader multiplies the whole frame, which would recolour stone and wood.
  - `clanPieceTintPair` returns the RGBA8 pair: primary to mask.r and secondary to mask.g, using `clanRgbToRgba8`.
- **view.ts:**
  - The VPiece classify branch sets `tint` and `tintIndex` from the palette.
  - `bindGameplay` gets `pieceTints: e => pieceTintPairs.get(e)`, so the G mask receives the secondary colour.
  - `syncPieceTint` re-checks every 15 ticks, staggered per entity, so repaint and clan changes are applied. The maps are cleared on destroy.
- **Canvas2D:** `tintPiecePixels` applies the same r/g mask maths on the CPU. Results are cached per (frame, pair) in `tintedPieces`, capped at 512 entries, so Canvas2D tints too.
- **`clanTintIndex`:** now wraps to `1 + (id-1) % 16` (`CLAN_PALETTE_COUNT`).
- **Build window:**
  - Uses `clanPaletteForTint(t)?.primary`, falling back to palette 1.
  - `CLAN_PRIMARY_FALLBACK` and its sync test are removed.
  - The tint-icon regex now also covers vase, pottery and fence_picket.

**Tinted pieces:** rugs, curtains, tapestry, clan_flag, vase, pottery, shield_mount@clan, fence_picket/@white, garden_gate/@picket, @painted cabinets/dressers/kitchen cupboard, and desk@drafting.

**Evidence.**
- **Tests:** `adr230_clan_tint` has 4 tests covering the wrap, mask gating and pair, the Canvas2D pixel tint and the palette registry. `adr229_build_icons` was updated.
- **No churn:** after placement, `staticRebuildsIdle3s` was 0 in every WebGL run. The tint only changes when the palette changes, so the static chunk checksum is stable.
- **Perf (perf228 harness, headless SwiftShader, mouse):**

  | Build | avgMs | p95 | renderMs/frame | staticRebuilds |
  |---|---|---|---|---|
  | after | 188.1 | 233 | 6.18 | 0 |
  | before | 192.6 | 250 | 9.30 | 0 |

  The two are at parity, within noise.
- **Screenshots:** `/workspace/shots/clantint_canvas_{a,b,c,d}{,_crop}.png`. Each set places pieces in columns for tint 0, 1, 2 and 10, and the colours match `assets/preview/clan_tint_inworld.png`.
- **Wall-mounted pieces:** curtains, tapestry and shield_mount need a wall, so they are covered by the unit test rather than a shot.
- **Known limitation (pre-existing; baseline main shows the same):**
  - In headless SwiftShader WebGL, streamed decor pages (rugs, vases) do not appear in screenshots. Campfire and stove do appear.
  - So `clantint_webgl_*.png` show the scene without decor.
  - The WebGL tint is verified by the shader path, the `pieceTintPairs` counts and one earlier near-player run that showed a correctly tinted rug, vase and flag.

## ADR-231: Touch drag-and-drop between pack, hotbar, equipment and containers

**Decision.** Slot tiles move by pointer-event drag (mouse, touch, pen) with gamepad/keyboard pick-to-move as the fallback. All moves stay server-authoritative and reuse existing commands.
- **Drag core (`apps/client/src/slot-drag.ts`):** sources carry `data-drag="k:n"`, targets `data-drop="k:n"` (p = pack, c = viewed container, e = equip, h = HUD hotbar). Mouse/pen start after a 6 px move; touch starts after a 260 ms long-press (10 px of movement first cancels it, so the grid still scrolls), so tap, double-tap-to-eat/take and scrolling are unchanged. A ghost clone follows the pointer; it lives on `[data-modal]` so panel re-renders do not wipe it. Dropping on a slot moves, swaps or merges; dropping outside, on the same slot, or pressing Escape cancels. The click after a drag is swallowed.
- **Server ops:** `MoveSlotCmd` now merges identical stacks (same item and crafter, up to maxStack, remainder stays) and otherwise swaps, for the pack (`where` 0) and the viewed container (`where` 1). `ContainerToSlotCmd` gains `dir` (0 = container → pack slot, 1 = pack slot → container slot) with the same merge/swap rule. Client intents: `containerToSlotIntent(slot,to,dir)`, `slotToContainerIntent(packSlot,cslot)`.
- **Mapping:** p→p and c→c `moveSlot`; c→p `containerToSlot`; p→c `slotToContainer`; →e equip; e→p unequip then move; HUD `h:N`→`h:M` `moveSlot`.
- **Container view:** replaces the ADR-223 split/to-hotbar list with a two-column grid (pack + hotbar left, storage grid with take-all and pager right); a single column at ≤ 760 px wide, tile size scales so eight hotbar tiles always fit. The details pane keeps Store/Take, Split, To hotbar and a new Move (pick) action; with a pick held, tapping or pressing A on any slot places it, and Cancel drops the pick.
- **HUD hotbar:** gets its own `installSlotDrag` with `touch-action:none` so slots can be reordered directly on screen.

**Evidence.**
- **Tests:** `adr231_drag_moves` (4: pack merge + overflow, swap, dir 1 empty/merge/swap, dir 0 merge + empty-source rejects) and `adr231_slot_drag` (6: threshold/ghost/cancel/click-swallow/Escape; touch long-press vs tap vs scroll; panel pack/merge/canvas-cancel/equip; container mappings; pad Move + A, double-tap take; HUD hotbar). `adr223_inventory_grid` drag test moved to pointer events.
- **Full gate:** typecheck clean; 379 files / 1983 tests passed, 1 skipped.
- **Screenshots (`/workspace/shots/drag231.mjs`, live server + real storage box):** `drag_{desktop,720p,mobile,tablet}.png` and `drag_*_ghost.png` (mid-drag ghost; mobile and tablet use a CDP touch long-press). No horizontal scroll and no overlap at 1280×800, 1280×720, 390×844 and 820×1180; each run's drop landed server-side ("Moved Gravel.").

## ADR-232: Streamed decor build pieces never requested their atlas page

**Finding (real bug, not a headless artefact).** Rugs and vases placed in the world stayed invisible in WebGL. Runtime probe of the view world after placing campfire, wood_stove, rug_2x2 and vase:
- `dec_rug_2x2__plain` and `dec_vase__tall` resolve to manifest **stream** sheets (`streamClass` = "stream"). Their page state stayed `"missing"` forever. Campfire (`bonfire`) and stove (`furnace`) are on resident sheets, which is why they showed.
- `SpriteRenderer.gatherPieces` only handled the `"bld"` tier pool: it called `pageReady` (which touches and requests the page) for building tiers alone. For every other streamed class it wrote the instance straight from the frame table, so nothing ever requested the page and the instance pointed at an unloaded layer.
- Culling, sorting and static chunk insertion were fine: the pieces were in the chunk (`staticInstances` 6). The page simply never loaded.
- Any GPU is affected, not just SwiftShader. The rug only showed earlier when the build ghost (a dynamic sprite, which does call `streamNear`) had already paged in the decor sheet. So decor placed by other players, or loaded from a save, was invisible.

**Decision.** New exported `pieceDrawSprite(atlas, vis)` in `sprites.ts` picks the sprite a piece draws each frame:
- resident art draws as is;
- a building-tier page falls back to the resident tier (unchanged);
- any other streamed page is requested at `PRIO_NEAR` (so the fallback ladder never starves it) and the piece draws the sheet's placeholder, or nothing, until the page is uploaded.

Because the instance changes when the page arrives, the static chunk checksum changes and the chunk rebuilds once. Visible pieces touch their page each frame, so it is not idle-unloaded while on screen. New `streamFallbacks` counter.

**Evidence.**
- **Tests:** `stream.test.ts` has 2 new ADR-232 tests: the request is made and the placeholder or skip is drawn until resident; it still requests when the ladder is off. 8 tests in the file.
- **Headless WebGL (SwiftShader + GPU spoof):** rug and vase page state goes missing → resident and both are drawn (`/workspace/shots/decor232_webgl.png`). `staticRebuilds` settles; there was no change over the last 10 s idle.

## ADR-233: Stray "tab" behind the panel's top-right corner on touch devices

**Context.** ADR-231's tablet and mobile screenshots showed a small light rounded sliver at the top edge of every modal, just left of the close button. It was not hit-testable (`elementsFromPoint` only returned the panel). The cause was the close button's tooltip: modals auto-focus the close button, and on touch (`hover:none`/`pointer:coarse`) `:focus` shows the `data-tip` tooltip. That tooltip is anchored *above* its button (`bottom:calc(100% + 8px)`), so the panel's top edge clipped it, leaving only its bottom border and shadow visible. Desktop was unaffected because it only shows tips on hover or `:focus-visible`.

**Decision.** In `gameplay-panels.css`:
- Tooltips on `header` buttons open below the button and right-aligned, so they stay inside the panel.
- On touch, `:focus` alone (the modal's auto-focus) no longer shows a header tooltip. A press (`:active`) still does.
- Every other button keeps its tap-to-show tooltip.

**Evidence.**
- `adr233_header_tip.test.ts` (2 tests).
- Screenshots, tablet 820×1180 at DSF 2: `/workspace/shots/tab233_before.png` shows the sliver; `tab233_after.png` shows it gone.

## ADR-234: Skill-tree audit, all 135 nodes measured server-side

**Context.** The owner asked whether every skill-tree node actually gives its bonus. ADR-219 generates each node's description from its `effects` data, so the description values are the spec. Until now, tests only checked that a modifier was summed, not that the system consuming it produced the described change.

**Decision.** `test/adr234_skill_audit.test.ts` has one case per node. Each case builds two players with the same prerequisites, one of them also owning the node, and runs the real authoritative system. It asserts the measured ratio equals (1 + sum with) / (1 + sum without).

What each case measures:
- **gather / cropYield:** bare-hand swings at fresh nodes. NetId pairs the base roll across the two worlds, 2000 swings. Covered nodes: wild tree, crop_wheat, apple_tree and blueberry_bush.
- **carry:** stones accepted.
- **fuel:** campfire burn ticks with the player within 6 tiles.
- **vfuel / repair:** refuel liters and repair HP.
- **nutrition:** hunger from berries.
- **heal:** HP from bandage and medkit.
- **noise:** NoiseLevel.
- **xp:** 500 gather awards.
- **share:** a party mate's XP.
- **dmg_\*:** `applyDamage` with a held weapon of the class.
- **tame:** chance.
- **produce:** egg interval at a trough.
- **breeding and iron_stomach perks:** checked directly.
- **skill levels:** level reached, plus `meetsSkill` on a recipe at that level.
- **husbandry 1 / 2:** taming and pens.
- **unlock tokens:** `hasSkillUnlock`, `pieceUnlocked` and the station crafting gate.

A coverage case rejects any effect kind the audit does not handle.

Run against the old code, 33 of 135 nodes failed. Fixes:

| Nodes | Bug | Fix |
|---|---|---|
| wilderness_master, battle_hardened, tinkerer, master_farmer, preserver, master_chef, doctor, carpenter, architect, interior_designer, master_builder, phantom, diplomat, chieftain, tactician (15) | `awardXpRaw` rounded `base*(1+xp)` per award, and activity awards are 1–6 XP, so +5% / +10% rounded to 0 (measured ×1.00). | Per-entity fractional carry (`carryRound`, sim-local), so the XP is paid out over time. |
| rally, mentor, commander, chieftain (4) | Party/clan share was `Math.round(amount*share)`, which is 0 for small awards (mates got nothing). Stacked share also rounded wrong. | Per-mate fractional carry. |
| hardy, camp_cook, seasoning, preserver, baker, butcher_block, gourmet, glutton, master_chef, brewer, antiseptics (11) | The "nutrition" multiplier also scaled the health of food and medicine, so cooking nodes boosted bandages/medkits and heal nodes over-healed. It also scaled poison (raw meat −hp). | Health uses freshness × heal mod only; negative health is unscaled. |
| green_thumb, composter, irrigator, orchardist, master_farmer, monoculture (6) | `cropYield` applied only to `crop_*` nodes. Planted fruit trees and berry bushes used "gather", so orchardist did nothing for orchards and monoculture's −10% gather hit fruit. | `yieldSkillMod`: food yields of non-crop plantables (farming.json `becomes`) use cropYield. Description now says "harvest yield of crops, fruit trees and berry bushes". |
| husbandry_pens (1) | Husbandry level 2 was checked nowhere. Tamed animals produced and bred at troughs without it. | `canUsePens`: an owner needs husbandry ≥ 2 for trough settling, production and breeding. Owners with no Progression or who are offline are not gated. |

Several nodes had more than one bug, which is why the counts sum past 33. Also, `tameChance` was renamed `livestockTameChance`, because `pets.ts` already exports `tameChance`.

**Not changed (informational).** These 13 skill-level nodes grant a level that no recipe asks for directly:
- smithing_1 and smithing_2;
- armorsmithing_1 and armorsmithing_2;
- tailoring_1;
- chemistry_1;
- demolitions_2;
- bowyery_1 and bowyery_2;
- the mechanics levels 1–4 (grease_monkey, mechanic_2 to mechanic_4).

They are stepping stones to the gated levels. The mechanics nodes' repair and vfuel mods are verified. The audit checks that each level is granted.

**Evidence.** `adr234_skill_audit.test.ts`: 137 tests (135 nodes, coverage, poison). Against the old src, 34 fail; all pass after the fixes. Full suite: 2124 passed, 1 skipped.

## ADR-235: Bigger content areas in list modals (build, crafting, inventory, container)

**Context.** The owner wants to see more pieces, slots and items at once. The grids were capped at fixed sizes: piece grid `min(38vh,300px)`, recipe grid `min(36vh,280px)` and inventory grid `min(34vh,252px)`. Panels were also capped at 560–940px. At 1080p this left the build grid showing 12 of 37 pieces in a 720px panel surrounded by mostly empty screen.

**Decision.** A CSS-only block, appended last in `gameplay-panels.css` so it overrides the earlier caps:
- **Wider panels:**
  - build: `min(1120px,96vw)`;
  - crafting: `min(1000px,96vw)`;
  - inventory: `min(960px,96vw)`;
  - container view: `min(1200px,96vw)`, with slot tiles at `min(56px, …)` instead of 48px.
- **Grid heights come from the viewport:** each is `max(floor, calc(100dvh - chrome))`, where chrome is the measured header, tabs and details. The panel therefore never exceeds `100dvh-16px`, and the grid stays the only scroll container.
- **Phones (≤620px):**
  - build and recipe grids use 4 columns of 76–80px tiles instead of 3;
  - piece names are 10.5px, with tighter borders and word-boundary wrapping (no mid-word "Foundatio-n" break);
  - stacked container and pack grids each get half the free height.

Tile sizes and hit targets (≥48/56px) are unchanged. Spatial gamepad and arrow navigation was checked: it still moves through the grid and keeps the focused tile in view. The bottom-row → header wrap is the same as before.

**Evidence.** `bigger.mjs` (Playwright and Chrome sandbox) measured each view at 1920×1080, 1280×720, tablet 820×1180 touch and mobile 390×844 touch.
- "Visible" counts tiles fully inside both the grid and the viewport.
- "Cap" counts the slots that fit without scrolling.
- No panel or page scroll and no cut-off at any size.

| View | 1080p | 720p | Tablet | Mobile |
|---|---|---|---|---|
| Build pieces visible | 12→37 of 37 | 12→20 | 12→37 | 6→12 |
| Crafting recipes visible | 15→35 of 35 | 10→30 | 15→35 | 9→16 |
| Inventory pack capacity | 28→72 | 21→32 | 28→72 | 48→88 |
| Container storage capacity | 48→72 | 32→40 | 56→104 | 24→40 |

Inventory and container show all of their 8 and 12 test items both before and after. `adr235_bigger_lists.test.ts` has 4 tests. Screenshots: `/workspace/shots/bigger_{before,after}_{1080p,720p,tablet,mobile}_{build,crafting,inventory,container}.png`.

## ADR-236: Multiplayer moves to its own start-menu page; no connection box over the game

**Problem.** The dedicated-server connect box (`connect.ts`, `#connect-overlay`) and the P2P host box (`p2p-overlay.ts`) sat on top of the game during play. When the link dropped, the box measured 256×117 at top-centre, and 217×159 on mobile, where it covered the HUD and the menu bar. The start menu split multiplayer over sub-pages, and at 720p the panel ran past the bottom of the screen (bottom at 736 of 720).

**Decision.**
- **Start menu → Multiplayer** (`menu.ts`, `.boot[data-page=multiplayer]`). This one page replaces the join and dedicated sub-pages. It has three sections:
  - **Host**: the `Host game` button, plus the player cap.
  - **Join a friend**: a room-code field and `Join`.
  - **Dedicated server**: a server address field and `Connect`, with a live status line (`[data-role=server-status]`). The line shows "● Online · N ms" or "Can't reach server (…)". `probeServer()` checks the address with a WebSocket open, once on open and again 600 ms after each edit.

  Navigation works on every input:
  - **Gamepad:** focus starts on Host. D-pad and Tab order is Host → code → Join → address → Connect → Back, then it wraps. A activates and B goes back.
  - **Keyboard:** Enter in a field presses that field's own button (`Join` or `Connect`), not the first button on the page.
  - **Touch:** inputs flex to width.

  At max-height 860px or max-width 480px the page uses a compact layout: no subtitle or lane, and the page aligns to the top. A failed connect or join, leaving a session, and ending a session all return to this page with a notice (`backToMenu(…, "multiplayer")`).
- **Pause → Session** (`game-menus.ts`, `SessionInfo` + `sessionBody`) carries everything the old boxes showed. It now sits directly under Resume and refreshes live.
  - **Rows:** Server or room code, status, ping, account and players (host marked).
  - **Actions:** Reconnect (when not connected), plus Disconnect, Leave or End session.
- **In game** (`net-status.ts`) there is only `#net-status`: a ≤220px non-interactive pill that sits just under the vitals HUD. It shows only when there is a problem:
  - "Disconnected · Pause → Session";
  - "Connecting…" after 3 s;
  - "High ping · N ms" once ping stays above 250 ms for 3 s. A single slow sample, such as the initial snapshot, doesn't count.
- `connect.ts`, `p2p-overlay.ts` and their test are removed. `?server=` / `?menu=0` now connect automatically (`?autoconnect=0` turns that off).

**Evidence.** `/workspace/shots/mp.mjs` (Playwright and Chrome) ran a real local server at 1920×1080, 1280×720, tablet 1024×768 touch and mobile 390×844 touch.

Each run opens Multiplayer, checks the focus order, connects to the dedicated server end to end, and opens Pause → Session. It then kills the server.

| Check | Before | After |
|---|---|---|
| Menu panel in view at 720p | no (bottom 736) | yes (76–590) |
| Box over game, link lost | 256×117 (mobile 217×159) | pill 170×20 (mobile 187×20), no overlap |
| Overlays while connected | – | none |

- **Focus order** at all four sizes: Host → code → Join → address → Connect → Back → wrap.
- **P2P hosting** works (room code shown, 1/12 players, host listed).
- **P2P join:** the guest reached the host ("join: client 1"), but the WebRTC data channel timed out between two headless contexts on this box. That is a network/TURN limit; the transport code is unchanged. The failure correctly returns to Multiplayer with "Couldn't join … TURN server may be needed".

`adr236_mp_menu.test.ts` has 10 tests. Screenshots: `/workspace/shots/mp_menu_{before,after}_*.png`, `mp_ingame_{before,after}_*[_lost|_session].png` and `mp_ingame_after_{host,join}_session.png`.

## ADR-237: Creature, character and zombie sheets stay x1 on the mobile budget

**Problem.** Animals were blurry on phones only. Desktop was sharp. Emulated in Playwright with a faked GPU string: iPhone 14 Pro Max at dpr 3 ("Apple GPU", mobile-high), Pixel 7 at dpr 3 ("Adreno 660", mobile), and a desktop RTX at dpr 3 for reference. The mobile 128 MB atlas budget caused it in two ways:
- **Hot tier halved.** `fitBudget` could not fit the hot tier at x1, so after cold shrink, pool trimming and idle demotion it halved *every* hot atlas. That left `animals_medium`/`animals_large`, `characters*` and `zombies` at x0.5 for the whole session.
- **Pets and critters streamed.** `RESIDENT_CREATURE_MIN_MB` = 384 (ADR-156) kept the 62 `pets_*`/`nature_critters_*` sheets in the stream pool. With no free layers, that pool was planned at its smallest scale: ETC1S **x0.25** slots. A 32 px critter frame became 8×8 texels.

A phone at dpr ≈2.7 and zoom 0.61 magnifies a sprite texel about 1.8× at x1, about 3.7× at x0.5 and about 7× at x0.25. That matches the mosaic critters and soft deer in the before shots.

The backbuffer was not the cause. It is `dpr × resScale`, which is 2.7 at high on iPhone and 2.25 at medium on Android, so the compositor upscales it at most 1.33× (ADR-116/quality). That costs far less than the 2–4× atlas loss. The old local `sceneDpr` WIP (a backbuffer floor at native 1×) only helps dpr ≤ 2 screens, so it was not landed.

**Decision.**
- **Pin drawn sheets at x1.** New `FIDELITY_ATLAS_RE = /^(animals|pets|nature_critters|characters|zombies)(_|$)/`. When `fitBudget` has to halve the hot tier, it first tries the same hot scale with every *drawn* (`recentlyUsed`), hot sheet matching that pattern kept at x1. It falls back to the old plan at that same scale only if the pinned plan does not fit. The rest of the hot tier is never lowered further to make room.
  - Before anything has been drawn, the pin covers every hot creature, character and zombie sheet except the 62 small resident creature sheets. Those follow through the normal re-tier once drawn.
  - `needsRetier` treats pinned sheets as x1, so they never trigger a rebuild loop.
  - The result is exposed as `fitInfo.pinned` and in the diag tier line ("x1-pinned N").
- **Mobile keeps creatures resident.** `RESIDENT_CREATURE_MIN_MB` drops from 384 to 128. Pets and critters are now resident and hot on mobile and lowmem (x0.5 when idle, x1 once drawn) instead of x0.25 ETC1S stream slots.
- **Never-drawn menu art goes cold.** `^brand_` joins `COLD_ATLAS_RE`. The six 1920×1080 `brand_menu_bg*` sheets and the other brand sheets were registered as hot atlases but are never sampled, because the menu uses DOM images. They cost 6 × 3.3 MB at x0.5 on mobile and about 66 MB at x1 on desktop. Cold, they pay for the pinned sheets. A brand sheet that does get drawn becomes hot through `recentlyUsed` as usual.

**Evidence.** Probes are in `/tmp/wt-animblur-probe`: probe/vram/shot `.mjs`, Playwright with SwiftShader and a faked `UNMASKED_RENDERER`, `?quality=high`.

| | Before | After |
|---|---|---|
| Mobile animals_medium/large, characters, zombies | x0.5 | x1 |
| Mobile pets/critters | stream pool x0.25 (ETC1S) | resident, drawn ones x1 (26 pinned in the sandbox) |
| Mobile atlas arrays (75 s, after re-tier) | 131 MB, 14 layers | 127 MB, 12 layers (budget 128) |
| Mobile at boot (before the first re-tier) | 165 MB | same plan (the pin does not fit at boot, so the old plan is kept) |
| Crop sharpness (mean abs Laplacian on animal crops, iPhone / Android) | 9.1, 7.6 / 9.6, 7.1 | 10.9, 9.7 / 11.4, 10.3 (desktop ref 8.3–9.0) |

Shots: `/workspace/shots/animalblur_{before,after}_mobile_{iphone,android}.png`, `animalblur_desktop_reference.png`, `animalblur_before_after_mobile_crops.png`.

Desktop (1024 MB) is unchanged: it re-tiers to hot x1 and already kept creatures resident. Perf: there is no backbuffer, draw-call or shader change. A rebuild costs at most one extra pack attempt per hot scale tried, and re-tiers keep the ADR-190 hysteresis.

**Tests.** `packages/render/test/adr237_mobile_crisp_creatures.test.ts` checks:
- the regex scope;
- that a halved hot tier keeps drawn sheets at x1 while terrain and decor take x0.5;
- that undrawn hot sheets are not pinned;
- the exact old plan when the pin does not fit;
- no boot pin for the resident creature sheets;
- `needsRetier` quiet for pinned sheets;
- 128 MB residency;
- brand art cold.

`resident_creatures.test.ts` is updated to the 128 MB threshold.

## ADR-238: Dropped items and death bags despawn on a persisted server timer

**Problem.** Ground loot piled up. Every bag (dropped stacks, death bags, thrown weapons, zombie and animal loot, stall returns) carried one fixed `despawnAtTick` (15 min, or 2 min for creature loot). Nothing capped the total, and the client gave no warning before a bag vanished.

**Decision.**
- **Timer is data.** `LootBag` gains `spawnTick` (absolute tick), `kind` (the `LootSource`) and `emptiedTick`. `world.tick` persists in WorldMeta, so lifetimes survive save/load and restarts. Downtime does not count. The server (`lootBagDespawnSystem`, postSim, every 20 ticks) decides. Clients only read the replicated fields.
- **Lifetimes** live in `pvp.json` → `despawn`, which replaces `bagDespawnSeconds`/`thrownBagSeconds`:

  | Value | Seconds |
  |---|---|
  | `droppedSeconds` | 600 |
  | `deathBagSeconds` (pet death bags too) | 1800 |
  | `thrownSeconds` | 300 |
  | `creatureLootSeconds` | 120 |
  | `stallBagSeconds` | 600 |
  | `emptiedSeconds` | 12 |
  | `fadeSeconds` | 30 |
  | `maxGroundBags` | 400 (bags) |
  | `deathBagMinAgeSeconds` | 300 |
  | `legacyBagSeconds` | 900 |

- **No reset on interaction.** Opening a bag or taking part of it changes nothing. A bag looted down to empty records `emptiedTick` and despawns `emptiedSeconds` later, fading over that grace. It used to vanish the instant it was empty. Refilling it inside the grace cancels the grace. Permanent caches (`despawnAtTick` 0xffffffff, such as the sandbox crate, now `kind` Crate) never time out. Emptied, they vanish immediately on the next despawn pass, as before ADR-238: no grace, fade or puff. *(Amended: the first version gave them the 12 s grace too.)*
- **Cap.** With more than `maxGroundBags` live bags, the oldest by spawn tick (ties by entity id) get `despawnAtTick = now + fadeSeconds`, so they fade and puff like any other bag. Permanent bags and bags already in their last fade window are not counted. A death bag younger than `deathBagMinAgeSeconds` is never taken. The cap overflows rather than eat a fresh corpse run.
- **Legacy saves.** Migration `LOOTBAG_DESPAWN_MIGRATION` zero-fills the new fields. `kind` 0 means legacy: the spawn tick is `despawnAtTick - legacyBagSeconds` (used by the `canLootBag` owner window), and the old expiry is kept.
- **Client.**
  - **Fade.** `despawnFadeAlpha` (pure, in gameplay) gives 1 until the last `fadeSeconds`, or the whole emptied grace. It then eases down with a smoothstep to 0.25 with a ±6 % 0.5 Hz breathe. It never blinks and never returns to full. The view writes it to a new render component `SpriteAlpha`. The WebGL sprite pass multiplies body and shadow alpha by it, and Canvas2D sets `globalAlpha`. It fades the bag sprite itself; no overlay box.
  - **Puff.** `fx/loot-puff.ts` `LootPuffTracker` remembers each replicated bag's position and expiry. When a bag disappears within [expiry − 20, expiry + 80] ticks, the ADR-214 director plays `Fx.lootPuff`: a small `dustRing` plus 4 soft smoke particles. A bag that leaves the AOI early, or a permanent crate, gets no puff.
- **AI.** AI humans never perceive LootBags: `buildAgentView` has no ground-item channel. Pets re-query bags each tick, skip empty bags and skip permanent crates. A despawned bag fails `OpenContainer` with `InvalidTarget`, and an open loot window auto-closes, so nothing can hold a stale ground item.
- **Event.** `gameplay.LootBagDespawned {bag, x, y, z, kind, reason: expired|emptied}` is emitted on the server for logs and hooks.

**Tests.**
- `packages/gameplay/test/adr238_ground_despawn.test.ts` covers:
  - the balance values;
  - dropped expiry at 600 s and death bags at 1800 s;
  - no reset on open or partial take;
  - the emptied grace of 10–15 s, with refill cancelling it;
  - permanent and legacy bags;
  - the cap taking the oldest first, with the fade-not-pop;
  - young death bag protection, and expiry of that protection;
  - the fade curve;
  - InvalidTarget and auto-close.
- `packages/persist/test/adr238_lootbag_despawn.test.ts` covers the chunk round trip and the legacy migration.
- `apps/server/test/adr238_ground_despawn.test.ts` covers field replication, the client fade value, replicated removal, an emptied death bag gone about 12 s later on the client, and the timer across a SQLite restart.
- `apps/client/test/adr238_loot_despawn_fx.test.ts` covers puff-on-expiry (no puff on early removal, on a crate, or when not live) and the fade wiring.
- `pvp.test.ts` and `adr160_hand_loot.test.ts` now expect the emptied grace.

**Amendment (crate).** An emptied permanent crate goes at `emptiedTick` itself (`bagExpiryTick`). Test: "a permanent crate ... still vanishes IMMEDIATELY when emptied" in `adr238_ground_despawn.test.ts`, which also checks that a death bag emptied alongside it keeps its 12 s fade.

**Limits.** The Canvas2D fallback does not fade paper-doll layers (bags have none). The cap is a global count, not per area.
