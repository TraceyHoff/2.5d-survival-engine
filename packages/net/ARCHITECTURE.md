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

## 3. Protocol (v3)
Header on every packet (frozen layout): `u16 protocolVersion, u8 msgType`. Bodies are bit-packed (`BitWriter`/`BitReader`, implement core `FieldWriter/FieldReader`).

| Msg | Channel | Body |
|---|---|---|
| Hello | rel | token[16], named hashes `{name: u32}` |
| Welcome / Reject | rel | clientId, token, tickHz, serverTick / reason, detail (mismatching hash name) |
| Input | unrel | v5: u32 ackTick, u32 viewTick, u8 n, [u32 firstSeq], n × (varuint actions, f32 aimX, f32 aimY, bit hasMove, bit worldPoint, bit hasNudge, [i8 moveX, i8 moveY], [i8 nudgeX, i8 nudgeY]), varuint nEdges, nEdges × (varuint zigzag(seq−firstSeq), varuint edges). Analog values use core's q8. Edge pulses ride only in the edge records, sent for every unacked seq, and the server applies them exactly once (late ones are OR'd into the next tick). Client: `client.feedInput(coreInputFrame)` or the `sampleInput` option |
| Snapshot | unrel | serverTick, baselineTick (NONE = full), lastProcessedInputSeq, records… End |
| Command | rel | varuint commandId, varuint viewTick+1 (client render tick at send time; 0 = unknown), payload |
| Events | rel or unrel | serverTick, varuint n, (eventId, payload)… |
| Static (8) | rel | serverTick, sections `(more:1, kind:2, chunk cx,cy zigzag)`: Part(records…End, final:1 [version]) · Hit(version) · Delta(from, to, records…End) · Leave |
| StaticCtl (9, c→s) | rel | kind:2 (Evict / Nack), chunk |
| Groups (10) | rel | §13 roster changes |
| Chat (11) | rel | §14 |
| Markers (12) | unrel | §13 member markers |
| CommandRejected (13) | rel | bit core, varuint commandId (core: command type), varuint seq+1 (0 = unknown), varuint reason, utf8 detail |
| Trade (14) | rel | §15 |
| Ping (15) / Pong (16) | unrel | s→c: u32 nonce, u16 lastRttMs; c→s: u32 nonce |
| Report (17, c→s) | rel | §17 |

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

## 13. Groups: rosters, scopes, markers (milestone 4)
Membership is owned by core's `GroupRegistry` (batch 7) and gameplay (policies, ranks, caps: party 8, clan 50, from data). Net only replicates
and scopes. `new GroupReplicator(server, { groups, playerIdOf?, markerHz = 2, markerBudgetBytes = 512, markerHealth? })`. The code is written
against a structural `GroupSource` (`seq, get, groupsOf, changesSince`); core's `GroupRegistry` is passed directly (tests use it). `playerIdOf`
defaults to core `PlayerId.id` on the client's owned entity, else clientId.

**Routing (per client, last-acked seq).** Each client has its own last delivered seq (the reliable channel delivers in order, so sent = acked)
and the set of groups it holds. Every tick, `changesSince(clientSeq)` is filtered to that client: changes of groups it holds (member/banner/delete).
- A player who joins a group gets that group's full roster (create + members + banner).
- A removed player gets `delete(group)`, so the client drops the group.
- A new session gets the full rosters of all its groups.
- If `changesSince` returns undefined (log overrun), only that client resyncs: deletes for what it holds, then full rosters (`stats.resyncs`).

**Roster wire (Groups, reliable):** `varuint n`, then `n` changes. Each change is `op:2 (0 create, 1 delete, 2 member, 3 banner)`, `varuint seq`,
`varuint group`, then by op:
- create: `u8 kind` (1 party, 2 clan).
- member: `varuint playerId`, `u8 role` (0 removed, 1 member, 2 officer, 3 leader).
- banner: `bit has`, then if has `u8 shape, u8 pattern, u32 color0, u32 color1, u16 emblemId` (core Banner). has = 0 clears.

**Client:** `client.groups.groups: Map<groupId, {kind, members: Map<playerId, role>, banner?}>`, `ofKind(kind)` and `on(change)`. Set
`client.groups.into = coreRegistry` to mirror into core's registry via `apply()`.

**Scopes.**
- `server.setScope(def, "party" | "clan")`: the owner plus members of the owner's party or clan.
- Event scopes `{ group: groupId }` and `{ groupOf: entity, kind: "party" | "clan" }` (online members only).
- Gameplay's `Membership` summary component (partyId, clanId, rank) uses scope `"all"`.

**Member markers (Markers, unreliable, 2 Hz):** group members outside the viewer's AOI only, party first then nearest, capped at
`markerBudgetBytes`. Wire: `u32 tick`, then repeated `(bit more=1, varuint playerId, varuint zigzag(round(x·4)), varuint zigzag(round(y·4)),
u8 hp%)`, ending with bit 0. hp% 255 = unknown. Client: `client.groups.markers: Map<playerId, {x, y, hp, tick}>`.

## 14. Chat transport (milestone 4)
`new ChatServer(server, opts)`. Client: `client.chat.send(channel, text, { to?, mentions?, emote? })`, `client.chat.on(msg => …)`,
`client.chat.onReject((channel, reason) => …)`, `client.chat.history`.
- **Channels:** Global 0, Local 1, Party 2, Clan 3, Trade 4, Whisper 5, System 6.
- **Routing:**
  - Local: owned-entity positions within `localRadius`, default 48 tiles.
  - Party and clan: group resolver. Non-members are refused with NotMember and never receive anything.
  - Global and trade: everyone.
  - Whisper: by `toPlayerId`; the sender gets an echo.
  - System: server only, `chat.system(text, toClients?)`.
- Validation, recipients, mutes, blocks and rate limits are core's `ChannelRegistry` (passed as `opts.channels`, required); the payload is
  core's `encodeChatMessage`. Net doesn't reimplement any of it. `opts.localRadius` (default 48) sets `channels.localRadius`.
- **Server boundary, in order:**
  1. kind > System → BadChannel;
  2. normalize hook (default NFC + trim), then empty check;
  3. build core `ChatMessage {kind, channel: sender's party/clan group id | whisper target | 0, from: playerId, tick, text}`;
  4. `channels.validate(m)`: system_only→BadChannel, too_long (512 B)→TooLong, muted→Muted, not_member→NotMember, no_target→NoTarget,
     rate_limited→RateLimited (+ `chatRateLimited` anomaly). Core's TokenBucket is per player, on ticks (default capacity 5, 0.05/tick);
  5. `maxLength` (UTF-16 units, default 256) → TooLong;
  6. `filter` (replace text or refuse → Filtered);
  7. `channels.recipients(m, online, sender)` (blocks applied by core; players without a position never count as local), mapped
     playerId→client; the sender always gets its own line. Whisper to an offline target → NoTarget.
- **Reject reasons:** RateLimited 1, TooLong 2, Muted 3, NotMember 4, NoTarget 5, Filtered 6, Empty 7, Policy 8, BadChannel 9.
- Mute and block through `chat.channels.mutes` (core MuteList, serializable).

**Wire (Chat, reliable).** utf8 = `varuint byteLength` + bytes.
- c→s: `u8 kind, varuint toPlayerId (0 unless whisper), utf8 text, u8 nMentions, nMentions × varuint playerId, u16 emote (0 = none)`.
- s→c message: `bit 0, varuint n, n bytes core encodeChatMessage (u8 kind, u32 channel, u32 from (0 = system), u32 tick, string text),
  varuint fromClient, u8 nMentions, varuint playerId…, u16 emote`. Client view: `{channel, channelId, fromPlayer, fromClient, tick, text, mentions, emote}`.
- s→c reject: `bit 1, u8 kind, u8 reason`.

**Mentions.** The client resolves them from @name. The server dedupes them, drops ids that aren't online or are 0, and caps them at 8.
Mentions are never used for delivery.

## 15. Trade sessions (milestone 4)
Net owns the state machine and messages. Gameplay registers the rules through `validate(world, a, b, phase, offers?)`, with phases request,
offer, commit and tick; return a code to refuse or cancel, which reaches the client as `TradeEnd.Hook + code`. The swap goes through
`TradeInventory.swap`, which must be atomic. `coreTradeInventory()` implements it over core `Containers` + `transaction()` (durability and createdTick carried by core Slot):
`readSlot` returns core `Slot.durability`/`createdTick` (0 if the container lacks them); `swap` moves every line into a free slot of the other side with `tx.transfer` inside one core
transaction (container validators run; any failure rolls both sides back). It needs enough empty slots; stacks aren't merged. Each committed
trade gets a `txnId`.

**Item model.** Slots are parallel `item / count / durability` u16[16] plus `createdTick` u32[16], with no instance ids. An offer line is
`{slot, count}`. The server snapshots the slot tuple when the offer is made. At commit, every slot must still hold the same item, durability
and createdTick, with count ≥ offered, or the trade ends with Validation.

**Flow.**
1. Request → Accept or Decline.
2. While Open: any number of Offer / Lock / Confirm(version).
3. Commit when both sides have confirmed.

**Rules.**
- Any offer change bumps `version` and that side's `offerRevision`, and clears both locks and confirms.
- A Confirm whose `version` is stale is ignored.
- One active trade (requested or open) per client. Further requests get Busy; this is the double-spend guard, together with commit
  re-validation.
- The trade is cancelled on disconnect, missing or dead entity, distance > `maxDistance` (default 6), request timeout (30 s), idle timeout
  (120 s), or the tick hook.
- `TradeEnd` reasons: None 0, Declined 1, Timeout 2, Distance 3, Dead 4, Disconnect 5, Busy 6, Validation 7, Cancelled 8, NoTarget 9,
  SwapFailed 10, Hook+n 100+n.

**Wire (Trade, reliable).**
- c→s: `u8 op`, then:
  - Request (0): `varuint targetPlayer`;
  - Accept (1), Decline (2), Lock (4), Cancel (6): `varuint tradeId`;
  - Offer (3): `varuint tradeId, u8 n, n × (u8 slot, u16 count)`;
  - Confirm (5): `varuint tradeId, varuint version`.
- s→c **tradeUpdated** (sent to both traders on every change): `varuint tradeId, varuint partnerPlayer, u8 status (Requested 0, Open 1,
  Done 2, Cancelled 3), u8 reason, bit iRequested, varuint version, varuint myOfferRevision, varuint theirOfferRevision, bit myLock,
  bit myConfirm, bit theirLock, bit theirConfirm, myOffer, theirOffer`.
  - Each offer is `u8 n, n × (u8 slot, u16 item, u16 count, u16 durability, u32 createdTick)`.
  - The partner's item details are included, because they can't see your inventory.

**Client:** `client.trade.request / accept / decline / offer / lock / confirm(id, version) / cancel`, plus `client.trade.current` and
`client.trade.on(view => …)`.

## 16. Commands, combat validation, lag compensation (milestone 4)
- **Rejections.** `server.rejectCommand(clientId, def | id, reason, detail?, { seq?, core? })` sends CommandRejected. The server subscribes to
  core `CommandRejected` events (from `installCommandHandlers`) and forwards each to the issuing client only, as
  `{source: "core", commandId: type, seq, reason: 0, detail: reason string}`; disable with `forwardCoreRejections: false`. Client:
  `client.onCommandRejected(fn)` and `client.rejections` (`{source: "net" | "core", command, commandId, reason, detail, seq?}`). Net keeps its
  own per-command token buckets.
- **View tick.** Commands carry the client's view tick, which updates `session.lastViewTick` on arrival. Without this, a command arriving
  ahead of the input that carries the view tick would rewind to a stale tick.
- **Position history.** `server.positions` (PositionHistory) is the authoritative history; core has none.
  - Per-entity typed ring buffers (capacity 24), window = `positionHistoryTicks`.
  - Entities idle for a whole window are purged and answered from their current Transform.
  - `positions.track = (w, e) => w.has(e, Health)` limits recording to hittable entities. Memory is tracked movers × 24 × 16 B.
- **`validateHit(server, session, attacker, target, { reach, coneDeg?, aim?, maxRewindMs = 200, slack = 0.25, attackerAt? })`.**
  - Rewinds the target to `session.lastViewTick`, clamped to now − 200 ms.
  - Checks reach, then the cone, widened by the target's angular size.
  - Returns `{ok, rewindTick, distance, targetPos}` or `{ok: false, reason: noAttacker | noTarget | reach | cone}`.
- **`rewindTickFor(server, session)`.**
- **`FireRateGuard(server?, toleranceTicks = 1).tryUse(session, action, minIntervalTicks)`.** Reports `fireRate` anomalies.

## 17. Anti-cheat and session plumbing (milestone 4)
- **Position authority.** Clients send inputs and commands only, and Transform is never accepted from a client.
- **`new AntiCheat(server, cfg)`.**
  - **Movement validator** (postSim): owned entities' server-side motion against `maxSpeed` (default 8 tiles/s) × (1 + `speedTolerance`
    0.25). Jumps over `teleportDistance` (default 4) count as teleport unless `allowTeleport(e)` returns true.
  - **Anomaly feed** (`server.onAnomaly` / `server.anomaly(s, kind, detail)`): rateLimited, unknownCommand, malformed, inputFlood,
    badEntityRef, commandRejected, chatRateLimited, fireRate, tradeOffer, speed, teleport, reportRateLimited. Gameplay can add kinds.
  - **Suspicion score.** Weights per kind (`DEFAULT_WEIGHTS`, overridable) with linear decay (`decayPerSec`, default 0.5). Thresholds
    default to 10 → log, 25 → flag, 50 → kick. Each fires once per crossing and re-arms below half the threshold.
  - **Structured log** (`ac.log`, `onLog`): `{tick, clientId, playerId, kind, detail, score, action?, target?, reason?, messageTick?}`.
    Also `onAction`, `score(id)`, `isFlagged(id)`, `counters(id)`.
- **Player reports.** Client: `client.reportPlayer(targetPlayerId, reason, messageTick?)`, with reasons Spam 1, Abuse 2, Cheating 3,
  Other 4. Rate-limited to 3/min (burst 3). Each report is logged as kind `report` and passed to `onReport(report)`. Wire (Report,
  reliable): `varuint targetPlayerId, u8 reason, varuint messageTick+1 (0 = none)`.
- **RTT.** The server pings every `pingIntervalMs` (default 1000). `session.rttMs` is a smoothed value, and `client.rttMs` is echoed in the
  next Ping. Simulated transports provide `now()`.
- **Resume.** `resumeToken(token, world) => boolean` accepts a stored token the server doesn't know (e.g. after a restart). A new session
  is created with that token, `session.resumed` is set, and `onClientJoin` runs.
- **Forget.** `server.kick(clientId)` (= `removeSession`) disconnects the client and forgets its session; it is safe inside `onClientLeave`.

## 18. Crafting replication pattern (milestone 4)
- The client predicts **progress only**: the shared craft system runs on the predicted entity.
- At completion, the client holds at 100% and never runs the completion branch, so it never mints items.
- The server completes the job, writes the owner-scoped inventory, and emits a reliable owner-scoped `CraftCompleted` event.
- The item appears on the client only when the snapshot carrying the inventory arrives. A server refusal goes out as a command rejection,
  and reconciliation resets the predicted progress.
- `test/crafting.test.ts` demonstrates this with fake `Craft` / `Bag` components.

## 19. Raids and large groups (milestone 4)
**Raid bulk removal.** Static Delta sections start with `varuint nRemoved` + sorted delta-varint netIds, before the change and spawn
records. Destroying 600 pieces across 9 chunks in one tick costs 664 B, 1.1 B per removal (individual despawn records were about 3 B
each).

**Benches** (`test/war.bench.test.ts`, fake sessions; strict ceilings only with `PERF=1`):

| Scenario | ms/tick | bytes/client/tick | notes |
|---|---|---|---|
| 50v50 clan war, 256² area, 3k props, rosters + clan markers + party-scoped comp, 30 hit events/tick | ~16 | 386 (≈62 kbit/s) | markers 22.5 B/client/tick |
| 100-player brawl in 64², 100 hit events/tick | ~14–25 (noisy box) | 2104 (≈337 kbit/s) | events ≈ 6 B each |

Events are already aggregated as one Events message per tick per client per reliability class. Further hit compaction, such as a
per-target damage sum, is left to gameplay, since it changes the event semantics.

## 20. Tile and building replication (milestone 5)
**Tiles.** `new TileSync(server, { tiles: chunkManager, budgetBytes = 8 KiB })` is the sole drainer of `tiles.tileChanges()` (once per tick, in
`onTick`). It reuses the static-class scheme. Each client has subscribed chunks with the version it holds, plus a server-side mirror of its LRU.
- **AOI entry:** if the cached version matches → Hit (no data). Otherwise a Full chunk, closest first by viewpoint, under the per-tick budget
  (at least one chunk per tick). Full blobs are cached per chunk version and shared across clients.
- **Edits:** one core `encodeTileDelta` per changed chunk per tick, encoded once and sent to every subscriber holding an older version.
  Deltas are never budgeted.
- **Leave:** the client moves the chunk into its LRU (default 64). On eviction it sends TilesCtl Evict. A Hit or Delta the client can't apply →
  Nack → Leave plus a fresh Full.
- **Heights** travel only in Full; core keeps no height edit stream. A height edit bumps the version, so the chunk restreams on the next entry.
- **Wire, Tiles (18, reliable):** `u32 tick`, then sections `bit 1, u2 kind, zigzag-varuint cx, cy`, ended by bit 0.
  - Full 0: `varuint version, tile runs, height runs` (`varuint n, n × (varuint len, varuint value)`).
  - Hit 1: `varuint version`.
  - Delta 2: `varuint n, n bytes core tile delta (u32 version, u16 count, count × (u16 index, u16 tile))`.
  - Leave 3: no payload.
- **Wire, TilesCtl (19, c→s, reliable):** `u2 kind (0 Evict, 1 Nack), chunk key`.
- **Client:** `client.tiles` (TileClient).
  - `client.tiles.tiles` is a core `TileMap` (`getTile`, `getChunk`, `loadedChunks`). Pass your own with `NetClient({ tiles })`.
  - `client.tiles.on((key, "full" | "hit" | "delta" | "leave", chunk) => …)`.
  - Deltas go through core `applyTileDelta`, so `client.tiles.tiles.tileChanges()` also lists edited chunks for the renderer.
  - `client.tiles.stats`.
- **Server stats:** `sync.sessionStats(clientId)`, `sync.stats`.
- **Server accessors added for this:** `server.relevantChunks(clientId)` and `server.viewpointsOf(clientId)`.

**Buildings: static entity class, not BuildingGrid's stream.** Gameplay's authoritative pieces are entities with `BuildPiece` (static class,
hp u16, damageStage, paint…), and edge walls exist only as entities. `BuildingGrid` is gameplay's server-side index (gridId ↔ entity). Net
therefore replicates pieces only via the static class (§11) and never sends `buildingChanges()`, so nothing goes out twice. Clients rebuild
their own grid/index from the replicated entities (gameplay's job). Nobody drains `BuildingGrid.buildingChanges()` today; gameplay should set
`grid.recordChanges = false`, or drain it, to keep the buffer from growing.

**Batched hp/state (protocol v4).** A static Delta section is `nRemoved + sorted delta-varint netIds`, then **column batches**, then records.
Column batches carry entities whose only change is one element of one component (hp, state, damageStage):
`varuint nCols`, each `varuint ci, varuint element, varuint n, n sorted delta-varint netIds, n values (field wire encoding)`. Everything else
uses normal entity records.
