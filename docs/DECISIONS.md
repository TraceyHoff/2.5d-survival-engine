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
