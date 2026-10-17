# @engine/net — Networking Architecture

Status: draft v1. Stack: TypeScript (strict), browser client (Vite) + Node server, pnpm monorepo at `/workspace/engine` (packages `core`, `world`, `render`, `net`, `gameplay`; apps `client`, `server`). Engine-wide docs: `docs/ARCHITECTURE.md`, `DECISIONS.md`.

## 1. Model

Server-authoritative, snapshot-replicated, with client-side prediction for the locally owned entity and interpolation for everything else.

- **Server** runs the full sim at a fixed tick (default 20 Hz, configurable via core loop config) and is the only source of truth.
- **Client** sends inputs tagged with tick numbers, predicts its own entity, reconciles against authoritative snapshots, and renders remote entities interpolated ~2 ticks in the past.
- Transport: WebSocket (binary frames) for v1; the transport sits behind a `Transport` interface so WebTransport/WebRTC datagrams (unreliable, unordered) can replace it later without touching replication.

## 2. Integration with core

### 2.1 Components & entities
- Components are plain data with a declared field schema, registered in order → stable numeric component ids, stored as SoA typed arrays. Net reads/writes those arrays directly; no per-entity objects.
- Entities are `uint32` (index + generation). Local entity ids are **never** sent on the wire.
- Component definitions opt in with `networked: true`. Only those components are replicated; others are server-local or client-local.
- Component id order must be identical on client and server (both import the same registration module from `gameplay`); the handshake exchanges a schema hash and rejects mismatches.

### 2.2 NetId and Owner
- Core provides `NetId` and `Owner` components.
- Server assigns `netId`s (monotonic `uint32`, free-list with generation to avoid reuse races) when a networked entity spawns, and keeps a `netId ↔ entity` map. Client keeps its own `netId ↔ local entity` map, creating local entities on first sight.
- `Owner` holds the owning connection/player id; it drives prediction (client predicts only entities it owns) and relevancy/authority checks on inputs.

### 2.3 Loop & phases
Fixed-tick accumulator loop; render interpolates with `alpha`. Systems run in deterministic, explicitly ordered phases:

| Phase | Server | Client |
|---|---|---|
| input | apply queued client inputs for this tick | sample local input, buffer it, send to server |
| simulation | authoritative sim | predicted sim for owned entities |
| post-sim | cleanup, despawns | — |
| **network** | **replication system**: build & send per-client snapshot deltas | **replication system**: apply received snapshots, reconcile, re-simulate |
| render-prep | — | interpolate remote entities (snapshot buffer) + use loop `alpha` for owned entity |

### 2.4 Determinism
The sim uses core's seeded RNG and the tick count; no wall clock. This makes client re-simulation during reconciliation reproduce server results for owned entities (barring floating-point drift, which reconciliation corrects). RNG state is not replicated per tick; RNG-driven outcomes arrive as replicated state.

## 3. Wire format: extending core's serializer

Core ships a schema-driven, versioned binary serializer. Net does **not** write a separate one; it layers on top:

1. **Quantization** — optional per-field hints in the component schema, e.g. `{ type: 'f32', net: { quant: { min: -1024, max: 1024, bits: 18 } } }`, angles as N-bit fractions of a turn, unit vectors octahedral-encoded. Unhinted fields go full precision. Server sim keeps full precision; owned-entity state is quantized on send, and small resulting prediction error is handled by reconciliation.
2. **Bit-packing** — a `BitWriter/BitReader` wrapping core's field encoders so quantized fields use exactly their bit width; varints for netIds and counts.
3. **Delta against acked baseline** — per client, the server keeps a ring buffer (e.g. 32 ticks) of what it sent. Each snapshot is encoded against the newest snapshot the client has acked:
   - entity list: spawned (full component data), despawned (netId only), changed;
   - per changed entity: component bitmask (by component id), then per component a field bitmask and only changed fields;
   - if no ack within the ring window, send a full snapshot (baseline = empty).
   Schema version from core's serializer is in the packet header.

Packet header: `protocolVersion, schemaHash(on handshake), serverTick, baselineTick, lastProcessedInputTick`.

## 4. Inputs, prediction, reconciliation
- Client sends input commands each tick (`tick, buttons bitfield, quantized axes`), redundantly including the last N unacked inputs to survive loss.
- Server buffers inputs per client by tick, applies them in the input phase; missing input → repeat last.
- On snapshot receipt the client: writes authoritative state for owned entities at `serverTick`, drops inputs ≤ `lastProcessedInputTick`, re-runs simulation phase for remaining buffered inputs. Small errors are smoothed visually in render-prep, not in sim state.

## 5. Interpolation
Client buffers snapshots for remote entities and renders at `serverTime − interpDelay` (default 2 ticks = 100 ms at 20 Hz), lerping/slerping between bracketing snapshots; extrapolates at most 1 tick on starvation.

## 6. Relevancy & bandwidth
v1: everything networked is relevant. Interest management (grid-based, from `world`) plugs in where the per-client entity set is built. Per-client byte budget with priority accumulator is deferred.

## 7. Package layout
```
packages/net/src/
  transport/        Transport interface, WebSocket impl (browser + node)
  protocol/         headers, handshake, BitWriter/BitReader, quantizers
  replication/      ServerReplicationSystem, ClientReplicationSystem, baselines, delta codec
  prediction/       input buffer, reconciliation
  interpolation/    snapshot buffer, render-prep system
```

## 8. Open questions (API we need from core)
1. Serializer: exact signatures for per-field encode/decode so net can wrap them with a bit writer (e.g. `encodeField(schema, field, view, index, writer)`), and how schema metadata (quant hints) is attached/read.
2. Schema hash/version: `getSchemaHash(registry): number`?
3. Component storage: API to read/write a field for an entity index and to iterate entities with a given component (`query([...])` shape).
4. Change detection: does core expose dirty bits/version per component per entity, or does net diff against baselines itself?
5. Loop: how net registers systems into the `network` phase and gets `tick`/`alpha`; whether the client loop can re-run the simulation phase for N ticks (reconciliation) without running other phases.
6. NetId/Owner: field schemas, and whether core reserves spawn/despawn hooks net can subscribe to.
