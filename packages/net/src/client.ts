import { registerNetIds } from "./netid.js";
import { ENV_NET_ID, NetId, entityIndex, Owner, Transform, type ComponentDef, type ComponentStore, type Entity, type World } from "@engine/core";
import { BitReader } from "./bits.js";
import { InterpolationBuffer } from "./interpolation.js";
import { MessageRegistry, readPayload, writePayload, type MessageDef, type MessageDefBase, type Payload } from "./messages.js";
import {
  MsgType, NONE_U32, PROTOCOL_VERSION, decodeReject, decodeWelcome, emptyToken, encodeHello, encodeInput, readHeader, writeHeader,
  quantizeInput, type InputCmd, type NamedHashes, type RejectReason, type WelcomeMsg,
} from "./protocol.js";
import { BitWriter } from "./bits.js";
import { NO_ENTITY } from "./server.js";
import type { Schema } from "@engine/core";
import { NetSchema, decodeDelta, fromWire, storeFieldLength, type CompValues, type EntityState, type WorldState } from "./state.js";
import type { ClientTransport } from "./transport/types.js";
import { readUtf8 } from "./utf8.js";
import { ChatClient } from "./chat.js";
import { GroupClient } from "./groups.js";
import { TradeClient } from "./trade.js";
import { encodeReport, type ReportReason } from "./anticheat.js";
import { TileClient } from "./tiles.js";
import { NamesClient } from "./names.js";
import { AppearanceClient } from "./appearance.js";
import { RejectReason as RejectReasonV } from "./protocol.js";
import { StallClient } from "./stalls.js";
import type { TileMap } from "@engine/world";
import { StaticClient, encodeStaticCtl } from "./static.js";

const REJECT_TEXT: Record<number, string> = {
  [RejectReasonV.ProtocolMismatch]: "protocol version mismatch: client and server builds differ",
  [RejectReasonV.SchemaMismatch]: "world schema hash mismatch (components changed, e.g. Appearance): client and server must ship together",
  [RejectReasonV.HashMismatch]: "content hash mismatch: client and server must ship together",
  [RejectReasonV.BadToken]: "bad session token", [RejectReasonV.ServerFull]: "server full", [RejectReasonV.Malformed]: "malformed handshake",
};
/** Human-readable rejection, naming the mismatched hash (e.g. "assets") when the server sent one. */
export function rejectMessage(reason: number, detail = ""): string {
  return `server rejected connection: ${REJECT_TEXT[reason] ?? `reason ${reason}`}${detail ? ` [${detail}]` : ""}`;
}
export class NetRejectedError extends Error {
  constructor(readonly reason: RejectReason, readonly detail = "") { super(rejectMessage(reason, detail)); }
}

export interface NetClientOptions {
  world: World;
  transport: ClientTransport;
  /** Applies one input to an owned entity; must be the same function the server uses (prediction). */
  applyInput?: (world: World, entity: Entity, cmd: InputCmd | null) => void;
  /** Samples the local input for this tick (input phase). */
  sampleInput?: () => Omit<InputCmd, "seq">;
  /** Remote entities render this many server ticks in the past (default 2). */
  interpDelayTicks?: number;
  /** Max unacked inputs repeated in each input packet (default 8). */
  inputRedundancy?: number;
  /** Decoded states kept as possible delta baselines (default 64). */
  historySize?: number;
  /**
   * false: no remote interpolation (headless replicas such as singleplayer virtual players; ADR-104). Remote entities
   * take the newest snapshot state directly; no interpolation buffer, no per-frame sampling.
   */
  interpolate?: boolean;
  /** Component interpolated for remote entities (default Transform; field "facing" is angular). */
  interpolated?: ComponentDef;
  onSpawn?: (entity: Entity, netId: number, owned: boolean, world: World) => void;
  onDespawn?: (entity: Entity, netId: number, world: World) => void;
  /** Called when Owner on a live entity starts/stops matching this client. */
  onOwnershipChange?: (entity: Entity, netId: number, owned: boolean, world: World) => void;
  commands?: readonly MessageDefBase[];
  events?: readonly MessageDefBase[];
  /** Extra handshake hashes (must match the server's), e.g. { assets }. */
  hashes?: NamedHashes;
  /** Names of simulation systems to run during reconciliation replay (core simulate {systems}); default all. */
  predictedSystems?: readonly string[];
  /** Time constant (seconds) of the predicted-entity correction offset decay (default 0.1). 0 disables smoothing. */
  correctionSmoothingSec?: number;
  /**
   * Corrections larger than this (tiles, positional fields) snap instead of being smoothed (default: never snap).
   * Use for fast entities (vehicles) where a long smoothed slide looks worse than a one-frame jump.
   */
  correctionSnapDistance?: number;
  /**
   * Extra non-owned entities to predict + reconcile alongside the owned ones (e.g. the vehicle the local player
   * drives and its hitched trailers). Called once per network phase with the owned entities; returned entities are
   * reset to server state and replayed with the owned inputs (applyInput still only runs for owned entities) and are
   * not interpolated. Leaving the set resumes interpolation from the next snapshot.
   */
  controlled?: (world: World, owned: readonly Entity[]) => Iterable<Entity>;
  /** Runs at the end of the network phase after remote interpolation (e.g. pose hitched trailers in the hitch frame). */
  afterInterpolate?: (world: World) => void;
  /** Static-class chunks kept after leaving them, for instant re-entry (LRU, default 64). */
  staticCacheChunks?: number;
  /** Replicated tile store (renderer reads it) and its leave-cache size; see TileClient. */
  tiles?: TileMap;
  tileCacheChunks?: number;
}

/** A server event as received: payload entity fields are resolved to local entities (NO_ENTITY if unknown). */
/** source "core": commandId = core CommandRegistry type, detail = core reason string (reason 0). */
export interface CommandRejection { source: "net" | "core"; command: MessageDefBase | undefined; commandId: number; reason: number; detail: string; seq?: number }
export interface ReceivedEvent { tick: number; def: MessageDefBase; payload: Record<string, number> }


/**
 * Client: handshake, snapshot apply (netId -> local entity map), input send with sequence numbers,
 * prediction + reconciliation for owned entities, interpolation for remote ones.
 * Systems: input phase (sample/predict/send), network phase (apply snapshots, reconcile, interpolate).
 */
type TypedArrayLike = { [i: number]: number };
export class NetClient {
  readonly world: World;
  readonly schema: NetSchema;
  clientId = 0;
  token: Uint8Array = emptyToken();
  readonly entities = new Map<number, Entity>(); // netId -> local entity
  readonly owned = new Set<number>(); // netIds predicted locally
  /** Non-owned netIds predicted locally via options.controlled (driven vehicle + trailers). */
  readonly controlled = new Set<number>();
  readonly interp: InterpolationBuffer;
  /** Inputs sent but not yet processed by the server, oldest first. */
  readonly pending: InputCmd[] = [];
  private nextSeq = 0;
  private history = new Map<number, WorldState>();
  private inbox: Uint8Array[] = [];
  latestTick = -1;
  /** Estimated current server tick (float), advanced once per local tick. */
  serverTickEstimate = 0;
  private active = false;
  private welcome: { resolve: (w: WelcomeMsg) => void; reject: (e: Error) => void } | undefined;
  private readonly interpIndex: number | undefined;
  private readonly interpStore: ComponentStore;
  stats = { snapshots: 0, dropped: 0, reconciliations: 0, lastCorrection: 0, maxCorrection: 0, snaps: 0 };
  private readonly opts: NetClientOptions;
  readonly commands: MessageRegistry;
  readonly events: MessageRegistry;
  private eventQueue: { tick: number; def: MessageDefBase; payload: Record<string, number> }[] = [];
  private eventHandlers = new Map<MessageDefBase, ((p: Record<string, number>, tick: number) => void)[]>();
  private netOf = new Map<Entity, number>();
  /** Static replication channel (building pieces etc.). */
  readonly statics: StaticClient;
  private corrections = new Map<Entity, number[]>(); // visual offset per predicted entity (interp comp fields)
  private staticInbox: Uint8Array[] = [];
  private rawHandlers = new Map<number, (r: BitReader) => void>();
  private rejectHandlers: ((r: CommandRejection) => void)[] = [];
  /** Recent command rejections (newest last, capped at 32). */
  readonly rejections: CommandRejection[] = [];
  /** Round-trip time in ms as measured by the server's ping/pong (-1 until known). */
  rttMs = -1;
  /** Chat transport (send/on). */
  readonly chat: ChatClient;
  /** Replicated tiles: `client.tiles.tiles.getTile(x, y)`, `client.tiles.on(...)`. */
  readonly tiles: TileClient;
  /** PlayerId -> display name cache: `client.names.get(id)` / `display(id)` / `on(...)`. */
  readonly names: NamesClient;
  /** Stall purchases / owner commands / sale notifications. */
  readonly stalls: StallClient;
  /** Character look: `client.appearance.setInitial(v)` before connect (sent at join), `set(v)` later. */
  readonly appearance: AppearanceClient;
  /** Own party/clan rosters + member markers. */
  readonly groups: GroupClient;
  /** Trade session protocol. */
  readonly trade: TradeClient;

  constructor(opts: NetClientOptions) {
    this.opts = opts; this.world = opts.world;
    registerNetIds(this.world, this);
    this.schema = new NetSchema(this.world);
    this.commands = new MessageRegistry(opts.commands);
    this.events = new MessageRegistry(opts.events);
    const idef: ComponentDef = opts.interpolated ?? (Transform as unknown as ComponentDef);
    this.interpIndex = opts.interpolate === false ? undefined : this.schema.indexOf(idef, this.world);
    this.interpStore = this.world.store(idef) as unknown as ComponentStore;
    this.interp = new InterpolationBuffer(32, 1, this.interpStore.fields.map((f) => f === "facing"));
    this.statics = new StaticClient(this.schema, {
      upsert: (id, es, old) => this.staticUpsert(id, es, old),
      remove: (id) => this.despawn(this.world, id),
      sendCtl: (kind, key) => { if (this.active) this.opts.transport.send(encodeStaticCtl(kind, key), "reliable"); },
    }, opts.staticCacheChunks ?? 64);
    this.chat = new ChatClient(this); this.groups = new GroupClient(this); this.trade = new TradeClient(this);
    this.names = new NamesClient(this); this.stalls = new StallClient(this); this.appearance = new AppearanceClient(this);
    this.tiles = new TileClient(this, { ...(opts.tiles ? { tiles: opts.tiles } : {}), ...(opts.tileCacheChunks ? { cacheChunks: opts.tileCacheChunks } : {}) });
    opts.transport.onMessage((b) => this.onMessage(b));
    opts.transport.onClose(() => { this.active = false; this.welcome?.reject(new Error("connection closed")); this.welcome = undefined; });
    this.world.addSystem("input", "net.client.input", (w) => this.inputSystem(w));
    this.world.addSystem("network", "net.client.network", (w, dt) => this.networkSystem(w, dt));
  }

  get connected(): boolean { return this.active; }

  /** Connect + handshake. Pass a previous session token to resume. Rejects with NetRejectedError. */
  async connect(token?: Uint8Array): Promise<WelcomeMsg> {
    if (!this.opts.transport.connected) await this.opts.transport.connect();
    const p = new Promise<WelcomeMsg>((resolve, reject) => { this.welcome = { resolve, reject }; });
    this.opts.transport.send(encodeHello({ hashes: this.hashes, token: token ?? emptyToken() }), "reliable");
    return p;
  }

  /** Handshake hashes sent in Hello. */
  get hashes(): NamedHashes { return { ...this.opts.hashes, schema: this.world.getSchemaHash(), netdefs: this.events.hash(this.commands.hash()) }; }

  /** Interpolation (render) tick for remote entities, in server ticks. Play events with tick <= renderTick. */
  get renderTick(): number { return this.serverTickEstimate - (this.opts.interpDelayTicks ?? 2); }

  /** Local entity for a netId / netId for a local entity. */
  entityOf(netId: number): Entity | undefined { return this.entities.get(netId); }
  netIdOf(e: Entity): number | undefined { return this.netOf.get(e); }

  /**
   * Send a reliable command. Entity fields take LOCAL entities (or NO_ENTITY) and go out as NetIds.
   * Returns false if not connected or an entity field has no NetId.
   */
  sendCommand<S extends Schema>(def: MessageDef<S>, payload: Payload<S>): boolean {
    if (!this.active) return false;
    const d = def as unknown as MessageDefBase; const id = this.commands.id(d);
    const p = { ...payload } as Record<string, number>; // entity fields are scalars; array fields pass through
    for (const f of d.entityFields) {
      const e = p[f]!; if (e === NO_ENTITY) { p[f] = 0; continue; }
      const n = this.netOf.get(e); if (n === undefined) return false; p[f] = n;
    }
    const w = new BitWriter(); writeHeader(w, MsgType.Command); w.writeVarUint(id);
    w.writeVarUint(this.latestTick < 0 ? 0 : Math.max(0, Math.floor(this.renderTick)) + 1); // view tick at send time (0 = unknown), for lag compensation
    writePayload(w, d, p);
    this.opts.transport.send(w.finish(), "reliable");
    return true;
  }

  /** Subscribe to an event type; called when the event is polled (see pollEvents). */
  onEvent<S extends Schema>(def: MessageDef<S>, fn: (payload: Payload<S>, tick: number) => void): () => void {
    const d = def as unknown as MessageDefBase; this.events.id(d);
    const l = this.eventHandlers.get(d) ?? []; const h = fn as unknown as (p: Record<string, number>, t: number) => void;
    l.push(h); this.eventHandlers.set(d, l);
    return () => { const i = l.indexOf(h); if (i >= 0) l.splice(i, 1); };
  }
  /**
   * Remove and return queued events with server tick <= upToTick (default: renderTick, so effects line up with
   * interpolated entities; pass Infinity for owner/HUD events). Handlers registered via onEvent fire too.
   */
  pollEvents(upToTick = this.renderTick): ReceivedEvent[] {
    const out: ReceivedEvent[] = []; const keep: typeof this.eventQueue = [];
    for (const ev of this.eventQueue) {
      if (ev.tick > upToTick) { keep.push(ev); continue; }
      const p = { ...ev.payload };
      for (const f of ev.def.entityFields) { const n = p[f]!; p[f] = n === 0 ? NO_ENTITY : this.entities.get(n) ?? NO_ENTITY; }
      out.push({ tick: ev.tick, def: ev.def, payload: p });
      for (const h of this.eventHandlers.get(ev.def) ?? []) h(p, ev.tick);
    }
    this.eventQueue = keep;
    return out;
  }
  get pendingEvents(): number { return this.eventQueue.length; }

  private onMessage(bytes: Uint8Array): void {
    let r: BitReader; let h;
    try { r = new BitReader(bytes); h = readHeader(r); } catch { return; }
    if (h.type === MsgType.Reject) {
      const { reason, detail } = decodeReject(r);
      this.welcome?.reject(new NetRejectedError(reason, detail)); this.welcome = undefined;
      this.active = false; this.opts.transport.close(); return;
    }
    if (h.version !== PROTOCOL_VERSION) return;
    if (h.type === MsgType.Welcome) {
      const w = decodeWelcome(r);
      this.clientId = w.clientId; this.token = w.token; this.active = true;
      this.serverTickEstimate = w.serverTick; this.latestTick = -1; this.history.clear();
      this.staticInbox = []; this.statics.reset(); this.names?.reset(); this.stalls?.reset();
      this.welcome?.resolve(w); this.appearance?.onWelcome(); this.welcome = undefined;
    } else if (h.type === MsgType.Snapshot) this.inbox.push(bytes);
    else if (h.type === MsgType.Static) this.staticInbox.push(bytes);
    else if (h.type === MsgType.Ping) {
      const nonce = r.readBits(32); const rtt = r.readBits(16); if (rtt > 0) this.rttMs = rtt;
      const w = new BitWriter(); writeHeader(w, MsgType.Pong); w.writeBits(nonce, 32); this.opts.transport.send(w.finish(), "unreliable");
    }
    else if (h.type === MsgType.CommandRejected) {
      const core = r.readBool(); const id = r.readVarUint(); const sq = r.readVarUint(); const reason = r.readVarUint(); const detail = readUtf8(r);
      const rej: CommandRejection = { source: core ? "core" : "net", command: core ? undefined : this.commands.get(id), commandId: id, reason, detail, ...(sq > 0 && { seq: sq - 1 }) };
      if (this.rejections.length >= 32) this.rejections.shift(); this.rejections.push(rej);
      for (const f of this.rejectHandlers) f(rej);
    }
    else if (h.type === MsgType.Events) {
      const tick = r.readBits(32); const n = r.readVarUint();
      for (let i = 0; i < n; i++) {
        const def = this.events.get(r.readVarUint()); if (!def) return;
        this.eventQueue.push({ tick, def, payload: readPayload(r, def) });
      }
    }
    else this.rawHandlers.get(h.type)?.(r);
  }

  private ownedEntities(): Entity[] { return [...this.owned].map((id) => this.entities.get(id)).filter((e): e is Entity => e !== undefined); }
  private predictedEntities(): Entity[] { return [...this.owned, ...this.controlled].map((id) => this.entities.get(id)).filter((e): e is Entity => e !== undefined); }
  /** Recompute options.controlled after applying snapshots (before reconciliation). */
  private refreshControlled(w: World): void {
    const fn = this.opts.controlled; if (!fn) return;
    const next = new Set<number>();
    for (const e of fn(w, this.ownedEntities())) { const id = this.netOf.get(e); if (id !== undefined && !this.owned.has(id) && w.isAlive(e)) next.add(id); }
    for (const id of this.controlled) if (!next.has(id)) {
      this.controlled.delete(id); const e = this.entities.get(id);
      if (e !== undefined) { if (!this.owned.has(id)) w.predicted.delete(e); this.corrections.delete(e); }
    }
    for (const id of next) if (!this.controlled.has(id)) {
      this.controlled.add(id); this.interp.remove(id); const e = this.entities.get(id); if (e !== undefined) w.predicted.add(e);
    }
  }

  private inputSystem(w: World): void {
    if (!this.active) return;
    const owned = this.ownedEntities();
    const fed = this.fed; this.fed = undefined;
    if (owned.length && (fed || this.opts.sampleInput)) {
      const cmd: InputCmd = { seq: this.nextSeq++, ...quantizeInput(fed ?? this.opts.sampleInput!()) };
      if (!cmd.edges) delete cmd.edges;
      this.pending.push(cmd);
      for (const e of owned) this.opts.applyInput?.(w, e, cmd);
    }
    const n = this.opts.inputRedundancy ?? 8;
    const viewTick = this.latestTick < 0 ? undefined : Math.max(0, Math.floor(this.renderTick));
    this.opts.transport.send(encodeInput({ ackTick: this.latestTick < 0 ? NONE_U32 : this.latestTick, ...(viewTick !== undefined && { viewTick }), cmds: this.pending.slice(-n), edges: this.pending.filter((c) => c.edges).map((c) => ({ seq: c.seq, edges: c.edges! })) }), "unreliable");
  }
  private fed: Omit<InputCmd, "seq"> | undefined;
  /**
   * Feed this tick's core InputFrame (v2) instead of `sampleInput`. Several feeds before the next tick: the latest
   * state wins, edge pulses are OR'd (never lost). Edges are delivered to the server exactly once per seq.
   */
  feedInput(f: { actions: number; aimX: number; aimY: number; moveX?: number; moveY?: number; aimMode?: number; ghostNudgeX?: number; ghostNudgeY?: number; edges?: number }): void {
    const edges = ((this.fed?.edges ?? 0) | (f.edges ?? 0)) >>> 0;
    const c: Omit<InputCmd, "seq"> = { buttons: f.actions >>> 0, aimX: f.aimX, aimY: f.aimY };
    if (f.moveX !== undefined) c.moveX = f.moveX; if (f.moveY !== undefined) c.moveY = f.moveY;
    if (f.aimMode) c.aimMode = f.aimMode;
    if (f.ghostNudgeX !== undefined) c.ghostNudgeX = f.ghostNudgeX; if (f.ghostNudgeY !== undefined) c.ghostNudgeY = f.ghostNudgeY;
    if (edges) c.edges = edges;
    this.fed = c;
  }

  private predictedBefore = new Map<Entity, number[]>();
  private networkSystem(w: World, dt: number): void {
    this.predictedBefore.clear();
    if (this.interpIndex !== undefined) for (const e of this.predictedEntities()) {
      const v = w.isAlive(e) ? this.interpStore.get(entityIndex(e)) : undefined; if (v) this.predictedBefore.set(e, this.interpStore.fields.map((f) => v[f]!));
    }
    this.serverTickEstimate += 1;
    const sin = this.staticInbox; this.staticInbox = [];
    for (const bytes of sin) { const r = new BitReader(bytes); readHeader(r); this.statics.handle(r, bytes.length); } // reliable, in order
    const inbox = this.inbox; this.inbox = [];
    let reconcileSeq: number | undefined;
    for (const bytes of inbox) {
      const r = new BitReader(bytes); readHeader(r);
      const tick = r.readBits(32); const baseTick = r.readBits(32); const processed = r.readBits(32);
      if (tick <= this.latestTick) { this.stats.dropped++; continue; } // stale / reordered
      const base = baseTick === NONE_U32 ? undefined : this.history.get(baseTick);
      if (baseTick !== NONE_U32 && !base) { this.stats.dropped++; continue; }
      const d = decodeDelta(r, this.schema, base);
      const prevState = this.latestTick >= 0 ? this.history.get(this.latestTick) : undefined;
      this.history.set(tick, d.state);
      for (const t of this.history.keys()) if (t <= tick - (this.opts.historySize ?? 64)) this.history.delete(t);
      this.latestTick = tick; this.stats.snapshots++;
      this.applyState(w, tick, prevState, d.state);
      if (processed !== NONE_U32) reconcileSeq = processed; else reconcileSeq ??= -1;
    }
    // Behind the newest snapshot: catch up. Too far ahead (a burst of lost/late snapshots): hold at latest+4 instead of
    // snapping back, so render time never runs backwards (a backward jump reads as a stutter on fast vehicles; ADR-102).
    if (this.latestTick >= 0) {
      if (this.serverTickEstimate < this.latestTick) this.serverTickEstimate = this.latestTick;
      else if (this.serverTickEstimate - this.latestTick > 4) this.serverTickEstimate = this.latestTick + 4;
    }
    const tau = this.opts.correctionSmoothingSec ?? 0.1;
    if (tau > 0) {
      const k = Math.exp(-dt / tau);
      for (const [e, off] of this.corrections) {
        if (!w.isAlive(e) || !w.predicted.has(e)) { this.corrections.delete(e); continue; }
        let m = 0; for (let i = 0; i < off.length; i++) { off[i]! *= k; m = Math.max(m, Math.abs(off[i]!)); }
        if (m < 1e-3) this.corrections.delete(e); // sub-pixel
      }
    }
    this.refreshControlled(w);
    if (reconcileSeq !== undefined) this.reconcile(w, dt, reconcileSeq);
    this.interpolate(w);
    this.opts.afterInterpolate?.(w);
  }

  /** Bring the local world in line with `cur` (diffed against the previously applied state, which may be an older tick). */
  private applyState(w: World, tick: number, prev: WorldState | undefined, cur: WorldState): void {
    if (prev) for (const netId of prev.keys()) if (!cur.has(netId) && !this.statics.has(netId)) this.despawn(w, netId);
    for (const [netId, es] of cur) {
      const old = prev?.get(netId);
      let e = this.entities.get(netId);
      if (e === undefined || !w.isAlive(e)) {
        const env = w.environment;
        if (netId === ENV_NET_ID && w.isAlive(env)) e = env; // core-owned environment singleton (ADR-028): adopt, never spawn
        else { e = w.create(); w.add(e, NetId, { id: netId }); }
        this.entities.set(netId, e); this.netOf.set(e, netId);
        this.writeComps(w, e, es, undefined, true);
        const owned = this.isOwned(es);
        if (owned) this.setOwned(w, netId, e, true, false);
        this.opts.onSpawn?.(e, netId, owned, w);
      } else if (old !== es) {
        // removals first (a comp removed+re-added shows up only as changed here)
        for (const ci of old?.keys() ?? []) if (!es.has(ci)) w.remove(e, this.schema.stores[ci]!.def);
        const owned = this.isOwned(es);
        if (owned !== this.owned.has(netId)) this.setOwned(w, netId, e, owned, true);
        this.writeComps(w, e, es, old, this.owned.has(netId) || this.controlled.has(netId));
      }
      if (!this.owned.has(netId) && !this.controlled.has(netId) && this.interpIndex !== undefined) {
        const v = es.get(this.interpIndex);
        if (v) this.interp.push(netId, tick, this.decode(this.interpIndex, v));
      }
    }
  }

  private staticUpsert(netId: number, es: EntityState, old: EntityState | undefined): void {
    const w = this.world; let e = this.entities.get(netId);
    if (e === undefined || !w.isAlive(e)) {
      e = w.create(); w.add(e, NetId, { id: netId });
      this.entities.set(netId, e); this.netOf.set(e, netId);
      this.writeComps(w, e, es, undefined, true);
      this.opts.onSpawn?.(e, netId, false, w);
      return;
    }
    for (const ci of old?.keys() ?? []) if (!es.has(ci)) w.remove(e, this.schema.stores[ci]!.def);
    this.writeComps(w, e, es, old, true);
  }

  private setOwned(w: World, netId: number, e: Entity, owned: boolean, notify: boolean): void {
    const pred = w.predicted;
    if (owned) { this.owned.add(netId); this.interp.remove(netId); pred.add(e); }
    else { this.owned.delete(netId); pred.delete(e); if (!this.owned.size) this.pending.length = 0; }
    if (notify) this.opts.onOwnershipChange?.(e, netId, owned, w);
  }

  private isOwned(es: EntityState): boolean {
    const oi = this.schema.indexOf(Owner, this.world);
    const v = oi === undefined ? undefined : es.get(oi);
    return v !== undefined && v[0] === this.clientId;
  }
  private decode(ci: number, v: CompValues): number[] { const specs = this.schema.specs[ci]!; return v.map((x, i) => fromWire(specs[i]!, x)); }

  /** Writes changed comps. For remote entities the interpolated comp is left to interpolate() (except on spawn). */
  private writeComps(w: World, e: Entity, es: EntityState, old: EntityState | undefined, full: boolean): void {
    // ADR-104: direct typed-array writes via a per-component plan (same semantics as w.add/w.set: defaults on add,
    // every field overwritten, change bit set) without the per-write decode array, init object and closures.
    const idx = entityIndex(e);
    for (const [ci, v] of es) {
      if (old?.get(ci) === v) continue;
      if (!full && ci === this.interpIndex && old?.has(ci)) continue;
      const st = this.schema.stores[ci]!; const plan = this.writePlan(ci); const specs = this.schema.specs[ci]!;
      if (!st.has(idx)) st.add(e, idx); else st.markChanged(idx);
      const slot = st.slot(idx);
      for (let i = 0; i < plan.length; i += 1) { const p = plan[i]!; (st.data[p.f] as TypedArrayLike)[slot * p.n + p.el] = fromWire(specs[i]!, v[i]!); }
    }
  }
  private readonly plans: ({ f: string; n: number; el: number }[] | undefined)[] = [];
  private writePlan(ci: number): { f: string; n: number; el: number }[] {
    let p = this.plans[ci];
    if (!p) { const st = this.schema.stores[ci]!; p = this.plans[ci] = this.schema.layout[ci]!.map(([f, el]) => ({ f, n: storeFieldLength(st, f), el })); }
    return p;
  }

  private despawn(w: World, netId: number): void {
    const e = this.entities.get(netId);
    this.entities.delete(netId); this.owned.delete(netId); this.controlled.delete(netId); this.interp.remove(netId);
    if (e === undefined) return;
    this.netOf.delete(e); w.predicted.delete(e);
    if (e === w.environment) return; // never destroy core's singleton
    if (w.isAlive(e)) { this.opts.onDespawn?.(e, netId, w); w.destroy(e); }
  }

  /** Reset owned entities to the authoritative state and replay unprocessed inputs via world.simulate. */
  private reconcile(w: World, dt: number, processedSeq: number): void {
    while (this.pending.length && this.pending[0]!.seq <= processedSeq) this.pending.shift();
    const state = this.history.get(this.latestTick); if (!state) return;
    const owned: [Entity, number[] | undefined][] = []; const inputs: Entity[] = [];
    for (const netId of [...this.owned, ...this.controlled]) {
      const e = this.entities.get(netId); const es = state.get(netId);
      if (e === undefined || !es) continue;
      // predicted value captured at the start of the network phase (applyState may already have written server state)
      const before = this.predictedBefore.get(e);
      this.writeComps(w, e, es, undefined, true);
      owned.push([e, before]); if (this.owned.has(netId)) inputs.push(e);
    }
    if (!owned.length) return;
    const pending = this.pending;
    const beforeTick = (i: number): void => { for (const e of inputs) this.opts.applyInput?.(w, e, pending[i]!); };
    // core simulate: world.tick follows the replayed ticks, world.isReplaying is set, replay events are discarded.
    w.simulate(pending.length, dt, { beforeTick, ...(this.opts.predictedSystems && { systems: this.opts.predictedSystems }) });
    this.stats.reconciliations++;
    let corr = 0;
    for (const [e, before] of owned) {
      const after = this.interpStore.get(entityIndex(e)); if (!before || !after) continue;
      corr = Math.max(corr, Math.hypot(...this.interpStore.fields.map((f, i) => (f === "facing" ? 0 : after[f]! - before[i]!)))); // fields are schema-sorted (facing first): index before pairing
    }
    if ((this.opts.correctionSmoothingSec ?? 0.1) > 0) for (const [e, before] of owned) {
      const after = this.interpStore.get(entityIndex(e)); if (!before || !after) continue;
      const d = this.interpStore.fields.map((f, i) => { const x = before[i]! - after[f]!; return f === "facing" ? Math.atan2(Math.sin(x), Math.cos(x)) : x; });
      if (Math.max(...d.map(Math.abs)) < 1e-4) continue; // no visible correction
      const snap = this.opts.correctionSnapDistance;
      if (snap !== undefined && Math.hypot(...this.interpStore.fields.map((f, i) => (f === "facing" ? 0 : d[i]!))) > snap) { this.corrections.delete(e); this.stats.snaps++; continue; }
      const off = this.corrections.get(e) ?? d.map(() => 0);
      d.forEach((x, i) => { off[i]! += x; });
      this.corrections.set(e, off);
    }
    this.stats.lastCorrection = corr; this.stats.maxCorrection = Math.max(this.stats.maxCorrection, corr);
  }

  /** Remote entities: write the interpolated component at (estimated server tick - delay). */
  private interpolate(w: World): void {
    const t = this.renderTick;
    for (const netId of this.interp.ids()) {
      const e = this.entities.get(netId); if (e === undefined || !w.isAlive(e) || !w.has(e, this.interpStore.def)) continue;
      const v = this.interp.sample(netId, t); if (!v) continue;
      const vals: Record<string, number> = {}; this.interpStore.fields.forEach((f, i) => { vals[f] = v[i]!; });
      w.set(e, this.interpStore.def, vals);
    }
  }

  /** Handle a server->client message type (module-defined). Called on receipt, in arrival order. */
  onRawMessage(type: number, fn: (r: BitReader) => void): void { this.rawHandlers.set(type, fn); }
  /** Send raw bytes to the server. Returns false if not connected. */
  sendRaw(bytes: Uint8Array, channel: "reliable" | "unreliable"): boolean { if (!this.active) return false; this.opts.transport.send(bytes, channel); return true; }
  /** Report a player (spam/abuse/cheating/other), optionally pointing at a chat message tick. Rate-limited server-side. */
  reportPlayer(targetPlayerId: number, reason: ReportReason, messageTick?: number): boolean { return this.sendRaw(encodeReport(targetPlayerId, reason, messageTick), "reliable"); }
  /** Server rejected one of our commands (core CommandHandler validation or gameplay). */
  onCommandRejected(fn: (r: CommandRejection) => void): () => void { this.rejectHandlers.push(fn); return () => { const i = this.rejectHandlers.indexOf(fn); if (i >= 0) this.rejectHandlers.splice(i, 1); }; }

  /**
   * Visual correction offset for a predicted entity, per field of the interpolated component (default Transform:
   * {x, y, z, facing}). Render at sim value + offset: a reconciliation snap becomes a ~correctionSmoothingSec decay.
   * Sim state is never modified. Returns undefined when there is no pending correction.
   */
  correctionOffset(e: Entity): Record<string, number> | undefined {
    const off = this.corrections.get(e); if (!off) return undefined;
    const r: Record<string, number> = {}; this.interpStore.fields.forEach((f, i) => { r[f] = off[i]!; }); return r;
  }

  close(): void { this.opts.transport.close(); }
}
