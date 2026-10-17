# @engine/net — Networking Architecture

Status: v1 implemented (milestone 1). Sections marked *Deferred* are not built yet. Stack: TypeScript (strict), browser client (Vite) + Node server, pnpm monorepo at `/workspace/engine` (packages `core`, `world`, `render`, `net`, `gameplay`; apps `client`, `server`). Engine-wide docs: `docs/ARCHITECTURE.md`, `DECISIONS.md`.

## 1. Model

Server-authoritative, snapshot-replicated, with client-side prediction for the locally owned entity and interpolation for everything else.

- **Server** runs the full sim at a fixed tick (default 20 Hz, configurable via core loop config) and is the only source of truth.
- **Client** sends inputs tagged with tick numbers, predicts its own entity, reconciles against authoritative snapshots, and renders remote entities interpolated ~2 ticks in the past.
- Transport: `ClientTransport`/`ServerTransport` interfaces with two channels, `reliable` (ordered, guaranteed) and `unreliable` (may drop/reorder). Implementations: `LoopbackNetwork` (in-memory, virtual clock, deterministic latency/jitter/loss conditioner; loss hits only unreliable, jitter never reorders reliable), `WsServerTransport` (Node, `ws`, exported from `@engine/net/node` so browser bundles never import it), `WebSocketClientTransport` (browser `WebSocket`, ctor injectable). Over WebSocket both channels share one TCP stream; unreliable sends are dropped while `bufferedAmount` exceeds 64 KB. WebTransport datagrams can slot in later.

## 2. Integration with core

### 2.1 Components & entities
- Components are plain data with a declared field schema, registered in order → stable numeric component ids, stored as SoA typed arrays. Net reads/writes those arrays directly; no per-entity objects.
- Entities are `uint32` (index + generation). Local entity ids are **never** sent on the wire.
- Component definitions opt in with `networked: true`. Only those components are replicated; others are server-local or client-local.
- Component id order must be identical on client and server (both import the same registration module from `gameplay`); the handshake exchanges a schema hash and rejects mismatches.

### 2.2 NetId and Owner
- Core provides `NetId` and `Owner` components.
- Server (`NetIdRegistry`) assigns `netId`s — monotonic `uint32`, **never reused** — in the network phase to any entity that gained a networked component and has no NetId (or explicitly via `netIds.assign(e)`); NetIds added by hand are adopted (re-assigned on collision). The map is released in `onDespawn`. Client keeps its own `netId ↔ local entity` map, creating local entities on first sight.
- `Owner` holds the owning client id (0 = server; session `clientId`s start at 1); it drives prediction (client predicts only entities it owns) and relevancy/authority checks on inputs.

### 2.3 Loop & phases
Fixed-tick accumulator loop; render interpolates with `alpha`. Systems run in deterministic, explicitly ordered phases:

| Phase | Server | Client |
|---|---|---|
| input | pop one queued input per session, `applyInput(world, entity, cmd|null)` for each entity it owns | sample input, assign seq, `applyInput` to owned entity (prediction), send |
| simulation | authoritative sim | predicted sim for owned entities |
| post-sim | cleanup, despawns | — |
| **network** | assign netIds, capture state, send per-client deltas | apply snapshots, reconcile (`world.simulate`), write interpolated Transform to remote entities |
| render-prep | — | (not used by net) renderer lerps PrevTransform→Transform by `alpha` |

### 2.4 Determinism
The sim uses core's seeded RNG and the tick count; no wall clock. This makes client re-simulation during reconciliation reproduce server results for owned entities (barring floating-point drift, which reconciliation corrects). RNG state is not replicated per tick; RNG-driven outcomes arrive as replicated state.

## 3. Wire format: extending core's serializer

Core ships a schema-driven, versioned binary serializer. Net does **not** write a separate one; it layers on top:

1. **Quantization** — per-field `quant {bits,min,max}` on the component schema; `captureState` uses core `wireValue` so quantized fields become ints written with exactly `bits` bits, unquantized f32 are `Math.fround`ed. Server sim keeps full precision; the owned entity's small quantization error is absorbed by reconciliation.
2. **Bit-packing** — `BitWriter`/`BitReader` implement core's `FieldWriter`/`FieldReader` (LSB-first), plus varuints for netIds/counts and bools for masks.
3. **Delta against acked baseline** — every tick the server captures a `WorldState` (netId → component index → wire values). Entities with no dirty bit and no `world.removed` entry reuse last tick's immutable entry, so capture cost scales with churn. States are kept in a 32-tick ring. Per client, the baseline is the newest tick it acked; if none or aged out → full snapshot. Body:
   - spawns: netId, component mask, all fields;
   - despawns: netId;
   - changes: netId, changed-component mask, removed-component mask, then per changed component either `full` (newly added) or a field mask + changed fields. Diffing is per field against the baseline (core dirty bits are per entity).
   Because the diff is always against the client's acked state, despawns and component removals are repeated in every snapshot until acked — no separate per-client removal buffer is needed. Removals are processed before changes, so remove+re-add in one tick arrives as a field change.

Packet header (all messages, layout frozen across versions): `u16 protocolVersion, u8 msgType`. Snapshot adds `u32 serverTick, u32 baselineTick (0xFFFFFFFF = full), u32 lastProcessedInputSeq`.

Handshake: client `Hello {schemaHash, token[16]}` (reliable) → `Welcome {clientId, token, tickHz, serverTick}` or `Reject {reason}` (ProtocolMismatch, SchemaMismatch, BadToken, ServerFull, Malformed). An all-zero token creates a session; a known token resumes it (same clientId, next snapshot full). Session tokens come from `crypto.getRandomValues`.

## 4. Inputs, prediction, reconciliation
- Inputs carry a client sequence number (not a server tick, so no clock sync is needed). Each input packet (unreliable) = `ackTick` + the newest ≤8 unprocessed inputs with consecutive seqs, so loss is covered by redundancy.
- Server dedupes by seq, queues per session (bounded, default 8, oldest dropped), applies one per tick in the input phase; empty queue → `applyInput(..., null)`. `lastProcessedSeq` is echoed in every snapshot.
- Client on snapshot: drops pending inputs ≤ lastProcessedSeq, writes authoritative state to owned entities, replays remaining inputs with `world.simulate(n, dt, i => applyInput(pending[i]))`. Correction magnitude is exposed in `client.stats` (visual smoothing is *Deferred*).
- Caveat: `world.simulate` runs every simulation system for every entity. Sim systems must only move entities driven by local-only input components (e.g. `Control`), which remote entities do not have on clients.

## 5. Interpolation
`InterpolationBuffer` per remote netId stores dequantized Transform samples by server tick. The client estimates the server tick (+1 per local tick, snapped to the newest snapshot when off by more than 4 ticks) and writes `sample(estimate − 2)` into Transform each network phase; lerps (shortest-arc for `facing`), extrapolates ≤1 tick, then holds. Other components on remote entities are applied as soon as they arrive.

## 6. Relevancy & bandwidth (*Deferred*)
Everything networked replicates to every client. Interest management (via `world` SpatialHash) plugs in where the per-client state is diffed; byte budgets/priority are deferred. Snapshots are not fragmented (fine on WebSocket; needed for datagrams).

## 7. Package layout
```
packages/net/src/
  bits.ts               BitWriter / BitReader
  protocol.ts           header, Hello/Welcome/Reject/Input codecs
  state.ts              NetSchema, captureState, encodeDelta / decodeDelta
  server.ts             NetServer (sessions, input queue, ReplicationSystem), NetIdRegistry
  client.ts             NetClient (snapshot apply, prediction, reconciliation)
  interpolation.ts      InterpolationBuffer
  transport/            types, loopback (+conditioner), ws-client, ws-server (Node only)
  index.ts / node.ts    "@engine/net" / "@engine/net/node"
```

## 8. Deferred / open
- Ownership transfer (Owner change on a live entity) is not re-evaluated on clients.
- Error smoothing for corrections, clock-sync/adaptive interp delay, server-side input jitter buffer tuning.
- Interest management, bandwidth budget, snapshot fragmentation, WebTransport.
- Core asks (nice to have, not blocking): `world.simulate` with an entity filter or predicted-only system set, so replay cannot touch non-predicted entities.
