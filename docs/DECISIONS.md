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

## ADR-156: Creature sheets resident on budgets of 384 MB and up

**Context:** At the PC texture budget (768 MB), a 42 s walk/sprint profile streamed creature and pet sheets in and out. Those sheets (62 small sheets, about 4.8 MPx) caused 23–32 page-ins and evictions per run, and each one meant a texture upload plus frame-table rows, which showed up as hitches.

**Decision:** On budgets of `RESIDENT_CREATURE_MIN_MB` = 384 MB or more, `pets_*` and `nature_critters_*` sheets load resident and hot at full resolution, outside the stream pool. Smaller budgets (mobile and safe) keep streaming them, so they keep the same hot-tier floor as before.

**Result:** Same 42 s profile at 768 MB: page-ins went from 23–32 to 8–10 (only wearables' first loads remain), and frame-table row uploads went from 87–121 to 55–64. No quality drops anywhere: creatures are now always full-res on PC.
