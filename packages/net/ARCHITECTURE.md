# @engine/net — Networking Architecture

Status: milestone 2 implemented. *Design-only* items are marked. Stack: TypeScript strict, browser client (Vite) + Node server,
pnpm monorepo. Engine docs: `docs/ARCHITECTURE.md` (§10–14 core/world APIs), `docs/DECISIONS.md`.

## 1. Model
Server-authoritative snapshot replication. Clients predict their owned entities (core `world.predicted`), reconcile with
`world.simulate`, and interpolate everything else ~2 ticks in the past. Fixed 20 Hz tick (configurable).

## 2. Transport
`ClientTransport` / `ServerTransport` with `reliable` and `unreliable` channels.
- `LoopbackNetwork` (+ `LinkConditions {latencyMs, jitterMs, loss}`): in-memory, virtual clock, deterministic; loss hits unreliable only; reliable never reorders. Public API, used by `@engine/testkit` `createHarness`.
- `WsServerTransport` (Node, `@engine/net/node`), `WebSocketClientTransport` (browser). Over WS both channels share TCP; unreliable sends are dropped while `bufferedAmount` > 64 KiB.

## 3. Protocol (v2)
Header on every packet (frozen layout): `u16 protocolVersion, u8 msgType`. Bodies are bit-packed (`BitWriter`/`BitReader`, implement core `FieldWriter/FieldReader`).

| Msg | Channel | Body |
|---|---|---|
| Hello | rel | token[16], named hashes `{name: u32}` |
| Welcome / Reject | rel | clientId, token, tickHz, serverTick / reason, detail (mismatching hash name) |
| Input | unrel | ackTick, viewTick (client render tick, for lag comp), ≤8 newest unprocessed inputs (consecutive seqs) |
| Snapshot | unrel | serverTick, baselineTick (NONE = full), lastProcessedInputSeq, records… End |
| Command | rel | varuint commandId, payload |
| Events | rel or unrel | serverTick, varuint n, (eventId, payload)… |
| Static (8) | rel | serverTick, sections `(more:1, kind:2, chunk cx,cy zigzag)`: Part(records…End, final:1 [version]) · Hit(version) · Delta(from, to, records…End) · Leave |
| StaticCtl (9, c→s) | rel | kind:2 (Evict / Nack), chunk |

**Handshake hashes**: `schema` = `world.getSchemaHash()` (component ids/schemas plus core *salts*, so `installAssetHash` / `world.addSchemaSalt` are covered), `netdefs` = command+event registry, plus any `NetServerOptions.hashes` / `NetClientOptions.hashes` (e.g. a separate `assets` entry if wanted). Any missing/different name → `Reject(SchemaMismatch | HashMismatch, name)`. Adding a hash = adding a key on both sides.

## 4. Replicated state and deltas
- Replicated components = `networked: true` minus NetId (implicit). Component index = order among networked stores. Array fields (core batch 2) are expanded per element on the wire, so a 16-slot inventory change sends only changed elements.
- Server captures a `WorldState` (netId → comp → wire values; quantized ints for `quant` fields) each network phase. Entities with no dirty bit and no `world.removed` record reuse last tick's immutable object.
- **Per-client sent views**: each session keeps the view it was sent per tick (32-tick ring). Snapshot = records diffed against the view of the client's last acked tick (or full). Records: `Spawn(netId, compMask, all)`, `Despawn(netId)`, `Change(netId, changedMask, removedMask, per comp full|elementMask+elements)`, End. Because diffs are against what the client acked, despawns, AOI leaves and component removals repeat until acked (no separate removal buffers). Removals are applied before changes.
- NetIds: monotonic, never reused, start at `ENV_NET_ID + 1 = 2`. `netIds.assign(e)`; entities gaining a networked component are auto-assigned; hand-added NetIds are adopted (re-assigned on collision). Core's environment singleton (NetId 1: TimeOfDay, Weather) is adopted, global, and on clients written into the local `world.environment` (never spawned or destroyed).

## 5. Relevancy
Per session per tick: `view = owned ∪ globals ∪ AOI`, then component scopes.
- **AOI**: `@engine/world` `ChunkMembership` (incremental from Transform change/removal records) + `InterestGrid(membership, {radius, hysteresis})` (32×32-tile chunks, `"cx,cy"` keys). Net sets each client's viewpoint to its first owned entity and uses `grid.get(id).entities`. Leaving AOI → Despawn; re-entering → full Spawn with current state.
- **Globals**: NetId entities without Transform (environment, world singletons) or `server.setGlobal(e)`.
- **Scopes** (net-side registry; core `ComponentDef` has no custom fields): `server.setScope(def, scope)`, `scope = "all" | "owner" | "none" | (world, entity, clientId) => boolean`.
  - `owner`: only the session whose `clientId === Owner.clientId`.
  - `none`: never on the wire (server-only state, e.g. stability).
  - function = **viewers hook** (e.g. container contents while open): owner always passes; others when the hook returns true.
  - Ownership change on a live entity: Owner (scope all) changes → old owner's view loses owner-scoped comps (removedMask), new owner's view gains them (full component). Client flips `owned`, `world.predicted`, interpolation, fires `onOwnershipChange`.
  - Filtered entity states are cached per immutable source state, so unchanged entities stay reference-equal (cheap diff).
- **Budget/priority**: `budgetBytes` per snapshot (default 16 KiB, soft). Despawns, owned and global entities always go. Other records are sorted by `distance² / staleness²` (staleness = ticks since this entity was last sent to this client) and encoded until the budget is hit (a record that doesn't fit is truncated off the writer). Deferred entities keep their old value in the sent view, so they are retried next tick. Large joins spread over several ticks, nearest first.

## 6. Commands (client → server, reliable)
`defineCommand(name, schema, {entityFields?, rate?})`, same ordered list in `NetServerOptions.commands` / `NetClientOptions.commands`.
Client: `client.sendCommand(def, payload)` with entity fields as **local** entities (or `NO_ENTITY`), sent as NetIds. Returns false if not connected or unmapped.
Server: `server.onCommand(def, (session, payload, world) => …)`. Commands are queued on receipt and dispatched at the start of the input phase (deterministic order). Entity fields are resolved to server entities: unknown or dead → dropped (`session.stats.droppedCommands`). Rate limit: token bucket per session per command type, refilled per tick (no wall clock), default `{perSec: 10, burst: 20}`. Over-limit → dropped (`stats.rateLimited`).

## 7. Events (server → client, tick-stamped)
`defineNetEvent(name, schema, {entityFields?})`, same ordered list on both peers.
`server.emitEvent(def, payload, {reliable = true, scope: "all" | {owner} | {clients} | {nearby: {x, y}}})`. Entity fields take local server entities. `nearby` = clients whose AOI covers that chunk. Events are flushed per client in the network phase with the server tick.
Client: `client.pollEvents(upToTick = client.renderTick)` returns events with resolved local entities (`NO_ENTITY` if unknown) and fires `client.onEvent(def, fn(payload, tick))`. Use the default for world effects (lines up with interpolated entities) and `Infinity` for HUD/owner events.

## 8. Prediction / reconciliation
Client sends seq-numbered inputs. Server queues them (bounded 8), applies one per tick per owned entity (`applyInput`), and echoes `lastProcessedSeq`. On a snapshot the client writes authoritative state to owned entities and replays pending inputs with `world.simulate(n, dt, {beforeTick, systems: predictedSystems})`. Core sets `world.tick` per replayed tick, `world.isReplaying`, and discards replay events. Net keeps `world.predicted` = owned entities. Gameplay should skip side effects when `world.isReplaying`.

**Correction smoothing.** After a replay, the snap (before minus after, per field of the interpolated component, facing wrapped) is added to a per-entity visual offset that decays as `exp(-dt/τ)`. τ = `correctionSmoothingSec`, default 0.1 s; 0 disables it. The offset is dropped below 1e-3 tiles. Render at `sim + client.correctionOffset(e)`. Sim state is never touched.

## 9. Lag compensation helpers
`server.positions: PositionHistory` records Transform changes sparsely (static entities cost nothing), window 1 s by default. `getPositionAt(entity, tick)` interpolates fractional ticks and returns undefined outside the window. `session.lastViewTick` = the client's render tick from its last input. `rangeCheckWithSlack(actor, target, range, {slack = 0.25, maxSpeed, leadTicks, dt})` checks against static targets.

## 10. Cost model and benchmark
Per tick: capture O(N) cheap scan + O(changed) rebuild. Per client: O(relevant) view build (reference compares), O(changed relevant) encoding. Not O(clients × N).
`test/bench.test.ts` (headless, fake sessions, ack 3 ticks late, 10% of entities moving per tick, players moving), on the dev box:

| Scenario | ms/tick (server total) | capture ms | bytes/client/tick | encodes / reuses per tick |
|---|---|---|---|---|
| 100 clients × 10k entities spread over 2048² tiles | ~12 (was ~11) | ~4.8 | 173 (≈28 kbit/s) | 1214 / 566 |
| 100 clients clustered in 64² tiles, 10k entities in 512², 4 KiB budget | **~25** (was ~63) | ~7.6 | 2092 (budget-capped) | 475 / 23 912 |

Measured after core batch 4 (Transform z q10, facing q8). Machine is shared and noisy (±2 ms). Milestone-3 changes:
- **Shared record cache**: each tick, an entity's record is encoded once per (current state object, baseline state
  object) and the bits are appended (`BitWriter.appendBits`) for every client with that baseline. States are immutable and
  shared, so object identity is equality. Spawns use the `undefined` baseline, so a spawn blob is cached per entity per tick.
- Byte-chunked `writeBits`/`readBits`.
- Per-client view built from per-tick per-chunk netId lists, plus a netId-indexed state array and stamp array (no `view.has`). The
  stored view is written once (no `new Map(view)` copy, no deferral rewrite pass).
- Prioritization: netId-indexed positions per tick, `Int32Array` last-sent, and a typed-array threshold sort, so only the ~budget-sized head is fully sorted.
- Capture: unchanged components are structurally shared with the previous state.

## 11. Static / building replication class (implemented, milestone 3)
**API.** `server.setReplicationClass(BuildPiece, "static")` (and `getReplicationClass`). An entity that has any
static-class component and a Transform replicates **all** of its replicated components over the static channel and never in
snapshots. Scopes do not apply to static entities. Set the class before clients join. Server option `staticBudgetBytes`
(default 8 KiB per client per tick) applies to entry streaming only; change batches are unbudgeted. Client option
`staticCacheChunks` (default 64). Stats: `server.staticStats(clientId)` and `client.statics.stats`.

**Server.** `StaticServer` keeps `chunk → {version, netId → EntityState}` from the captured state each tick. The version bumps
once per tick in which anything in the chunk was added, changed, moved in or out, or removed. Per changed chunk there is one Delta blob
per tick (from → to), encoded once and shared by every subscribed client. Per session it keeps:
- `subs` (chunk → version the client holds; 0 = never-populated chunk, subscribed silently).
- `streams` (pending netIds).
- `cache`, a mirror of the client's LRU, maintained by Leave and Evict.

**Entry.** If the cache mirror holds the current version, the server sends Hit (no data). Otherwise it streams the chunk as
Parts, closest chunks first (distance to the client's viewpoints), within the budget. Spawn records are cached per state.
Changes during a stream re-queue the affected netIds: already-sent ones are re-sent or despawned, unsent ones go out at their
current state. This is how place/destroy in the entry tick is handled. The final Part carries the version.

**Client.** `StaticClient` keeps the active chunks plus an LRU cache. Each netId has an owning chunk, so a move across chunks
never destroys the entity. On Leave it moves the chunk to the cache and evicts the oldest chunk past the limit (sending Evict). If a
Hit or Delta doesn't match what the client holds, it drops the chunk and sends Nack, and the server answers Leave + a fresh stream.

**Measured** (`test/static.test.ts`, 3000 pieces over 3×3 chunks, 10% loss on the unreliable channel, 30±10 ms):
- Initial stream: 10 ticks (500 ms), 67.9 KB (22.6 B/piece).
- Steady state: 0 B over 40 ticks.
- 180 changes (repair 100, destroy 50, place 30): 1.7 KB.
- Re-entry after 1 chunk changed: 8 hits + 1 restream, 8.2 KB.

Loopback's reliable channel never drops, so reliability itself rests on the transport (WS/TCP).

## 12. Quantization review (gameplay DESIGN.md N6)
Bits/tick numbers below assume a change every tick.

| Field | Current | Suggested | Why |
|---|---|---|---|
| `Transform.x/y` (core) | f32 (32+32) | keep f32 for now; later chunk-relative `q16` (1/2048 tile within a 32-tile chunk + chunk id on change) | Biggest per-tick cost for movers (64 bits). Chunk-relative quantization halves it without range limits. Core change. |
| `Transform.z` (core) | f32 | `q10 [0,64]` (0.06) | Heights are small and bounded. Saves 22 bits per change. |
| `Transform.facing` (core) | f32 | `q8 [-π,π]` (1.4°) or q10 | Visual only; saves 22–24 bits per change. |
| `TimeOfDay.t` (core env) | **f64**, changes every tick | do not replicate per tick: replicate `dayStartTick`/`dayLengthTicks` and derive `t` from `world.tick`; or `q16` | 64 bits/tick to every client today. |
| `Weather.ticksRemaining` (core env) | u32, changes every tick | `endsAtTick u32` (changes only on weather change) | 32 bits/tick to every client today. |
| `Health.hp` | q10 [0,1000] (0.98 hp) | `q12 [0,1000]` (0.24) or `q10 [0,250]` | Max is 100, so only ~100 steps are used. Regen 0.25/s is invisible for 4 s then jumps. **P**: 0.5 hp reconcile error. |
| `Health.max` | q10 [0,1000] | `u16` or keep | Rarely changes; exactness is nicer for UI. |
| `Survival.hunger/thirst` | q8 [0,100] (0.39) | keep | Decays 0.05–0.08/s, so updates every ~6 s. Owner-only. Fine. |
| `Survival.stamina` | q8 [0,100] (0.39) | `q10 [0,100]` (0.1) | Gates actions (`stamina ≥ cost`): a 0.2 reconcile error can flip a predicted gather near the threshold. Changes 0.75/tick while regenerating. |
| `Survival.maxStamina` | q8 [0,100] | `u8` or keep | Rarely changes. |
| `Survival.bodyTemp` | q10 [25,45] (0.02) | `q9 [28,46]` (0.035) | Clamped to [30,44] in data. 9 bits are plenty for HUD and thresholds. |
| `Exposure.wetness` | q7 [0,1] | keep | Fine. |
| `Exposure.feltTemp` | q10 [-40,60] (0.1) | keep (P) or q8 if HUD-only | — |
| `Exposure.insulation` | f32 | `q8 [-20,40]` | Unquantized 32 bits. Equipment-driven, small range. |
| `Inventory.weight` | f32, changes on every item op | don't replicate (derived on the client from items) or `q12 [0,256]` kg | 32 bits per change of a cached value. |
| `Inventory.maxWeight` | f32 | `q10 [0,256]` or u16 | Rarely changes. |
| `Inventory.item0..15/count0..15` | 32 × u16 | `{type:u16, length:16}` arrays (core batch 2) | Net now sends per-element masks either way. Arrays keep the schema compact. Counts could be u8 if maxStack ≤ 255. |
| `Crafter.progressTicks` | u16, changes every tick while crafting | replace with `startTick u32` (sent once), derive progress | Removes 16 bits/tick per crafting player. |
| `ResourceNode.respawnAtTick` | u32 | scope `none` unless the HUD shows timers | Clients don't need it. |
| `ResourceNode.amount` | u16 | `u8` if capacity ≤ 255 | Minor. |
| `Gatherer.reach`, `CraftingStation.range`, `HeatSource.heat/radius` | f32 | keep (static, sent once), or q8 | Static class candidates. |
| `Dead.tick`, `*UntilTick` | u32 | keep | Absolute ticks must be exact. |

Scopes to apply in gameplay server setup: `Survival, Exposure, Inventory, Gatherer, Crafter → "owner"`; `ResourceNode.respawnAtTick → "none"` (requires a component split, since scope is per component).

## 13. Package layout
```
packages/net/src/
  bits.ts protocol.ts state.ts messages.ts interest.ts lagcomp.ts interpolation.ts
  server.ts (NetServer, NetIdRegistry)  client.ts (NetClient)
  transport/ types, loopback (+conditioner), ws-client, ws-server (Node only)
  index.ts / node.ts   "@engine/net" / "@engine/net/node"
```

## 14. Deferred / open
- Static class + per-chunk versions (§11), shared per-entity record encoding across clients, snapshot fragmentation for datagrams, WebTransport.
- Interest uses one viewpoint per client (`InterestGrid.setClient` takes a single position). Multi-viewpoint (party, camera) would need a world API.
- Adaptive interpolation delay / clock sync.
- Server-side rewind for combat (helpers exist; the policy belongs to gameplay).
