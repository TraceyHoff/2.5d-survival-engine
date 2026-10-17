import * as core from "@engine/core";
import { ENV_NET_ID, NetId, Owner, Transform, entityIndex, type ComponentDef, type Entity, type World } from "@engine/core";
import { BitReader, BitWriter } from "./bits.js";
import { NetInterest, type InterestOptions } from "./interest.js";
import { PositionHistory } from "./lagcomp.js";
import { DEFAULT_COMMAND_RATE, MessageRegistry, TokenBucket, readPayload, writePayload, type MessageDef, type MessageDefBase, type Payload } from "./messages.js";
import {
  MsgType, NONE_U32, PROTOCOL_VERSION, RejectReason, TOKEN_BYTES, decodeHello, decodeInput, encodeReject,
  encodeWelcome, readHeader, tokenKey, writeHeader, type InputCmd, type NamedHashes,
} from "./protocol.js";
import { NetSchema, captureState, writeDespawn, writeEnd, writeEntityRecord, type EntityState, type WorldState } from "./state.js";
import type { ConnId, ServerTransport } from "./transport/types.js";

/** Resolved value for a null (netId 0) entity field. */
export const NO_ENTITY = 0xffffffff;

/** Server-side netId <-> local entity mapping. NetIds are monotonic u32, never reused; ids below `first` are reserved. */
export class NetIdRegistry {
  private next: number;
  private toEntity = new Map<number, Entity>();
  private toNet = new Map<number, number>(); // entity index -> netId
  constructor(private readonly world: World) {
    this.next = ENV_NET_ID + 1; // reserved for core's environment singleton
    world.onDespawn((e) => this.release(e));
    const ns = world.store(NetId);
    for (let k = 0; k < ns.size; k++) this.adopt(ns.dense[k]!);
  }
  /** Adds a NetId component (idempotent) and returns the netId. */
  assign(e: Entity): number {
    const known = this.netIdOf(e); if (known !== undefined) return known;
    if (this.world.has(e, NetId)) return this.adopt(e);
    const id = this.next++;
    this.world.add(e, NetId, { id });
    this.toEntity.set(id, e); this.toNet.set(entityIndex(e), id);
    return id;
  }
  /** Registers a NetId that was added directly (not via assign); reassigns if it collides. */
  adopt(e: Entity): number {
    const id = this.world.getField(e, NetId, "id")!;
    const owner = this.toEntity.get(id);
    if (owner === e) return id;
    if ((owner !== undefined && this.world.isAlive(owner)) || id === 0) { this.world.remove(e, NetId); return this.assign(e); }
    this.toEntity.set(id, e); this.toNet.set(entityIndex(e), id);
    if (id >= this.next) this.next = id + 1;
    return id;
  }
  entityOf(netId: number): Entity | undefined { return this.toEntity.get(netId); }
  netIdOf(e: Entity): number | undefined { const id = this.toNet.get(entityIndex(e)); return id !== undefined && this.toEntity.get(id) === e ? id : undefined; }
  get size(): number { return this.toEntity.size; }
  private release(e: Entity): void {
    const id = this.toNet.get(entityIndex(e));
    if (id !== undefined && this.toEntity.get(id) === e) { this.toEntity.delete(id); this.toNet.delete(entityIndex(e)); }
  }
}

/** Who receives a networked component. A function scope is a "viewers" hook (e.g. open containers); the owner always passes. */
export type ReplicationScope = "all" | "owner" | "none" | ((world: World, entity: Entity, clientId: number) => boolean);
export type EventScope = "all" | { owner: number } | { clients: readonly number[] } | { nearby: { x: number; y: number } };

export interface ClientSession {
  readonly clientId: number;
  readonly token: Uint8Array;
  conn: ConnId | undefined;
  /** Newest snapshot tick the client has decoded (delta baseline), -1 = none. */
  lastAckTick: number;
  lastReceivedSeq: number;
  lastProcessedSeq: number;
  /** Client's interpolation tick from its last input packet (for lag compensation), -1 = unknown. */
  lastViewTick: number;
  readonly inputQueue: InputCmd[];
  lastSnapshotBytes: number;
  fullSnapshots: number;
  stats: { commands: number; droppedCommands: number; rateLimited: number; deferred: number; bytesSent: number };
}
interface SessionState extends ClientSession {
  views: Map<number, WorldState>;
  lastSent: Map<number, number>;
  buckets: Map<number, TokenBucket>;
  commands: { def: MessageDefBase; payload: Record<string, number> }[];
  events: { reliable: boolean; def: MessageDefBase; payload: Record<string, number> }[];
}

export type ApplyInput = (world: World, entity: Entity, cmd: InputCmd | null, clientId: number) => void;
export type CommandHandler<S extends core.Schema = core.Schema> = (session: ClientSession, payload: Payload<S>, world: World) => void;

export interface NetServerOptions {
  world: World;
  transport: ServerTransport;
  tickHz?: number;
  /** Per-client sent-view history used as delta baselines (default 32 ticks). Older acks get a full snapshot. */
  historySize?: number;
  maxInputQueue?: number;
  maxClients?: number;
  applyInput?: ApplyInput;
  onClientJoin?: (session: ClientSession, world: World) => void;
  onClientLeave?: (session: ClientSession, world: World) => void;
  randomToken?: () => Uint8Array;
  /** Client->server commands and server->client events; same ordered lists on both peers. */
  commands?: readonly MessageDefBase[];
  events?: readonly MessageDefBase[];
  /** Extra handshake hashes (e.g. { assets: hash }). "schema" and "netdefs" are always checked. */
  hashes?: NamedHashes;
  /** Chunk area-of-interest; false = every entity is relevant to every client. */
  interest?: InterestOptions | false;
  /** Soft per-client snapshot budget in bytes (default 16 KiB). Owned/global entities and despawns always go. */
  budgetBytes?: number;
  /** Lag-compensation window in ticks (default tickHz = 1 s). */
  positionHistoryTicks?: number;
}

function defaultToken(): Uint8Array {
  const c = (globalThis as unknown as { crypto?: { getRandomValues(a: Uint8Array): Uint8Array } }).crypto;
  if (!c) throw new Error("no crypto.getRandomValues; pass randomToken");
  return c.getRandomValues(new Uint8Array(TOKEN_BYTES));
}

/**
 * Authoritative server: handshake + sessions, commands and inputs (input phase), netId assignment,
 * chunk AOI, scoped per-client delta snapshots with a byte budget, and tick-stamped events (network phase).
 */
export class NetServer {
  readonly world: World;
  readonly netIds: NetIdRegistry;
  readonly schema: NetSchema;
  readonly commands: MessageRegistry;
  readonly events: MessageRegistry;
  readonly positions: PositionHistory;
  readonly interest: NetInterest | undefined;
  readonly sessions = new Map<number, ClientSession>();
  private byConn = new Map<ConnId, SessionState>();
  private byToken = new Map<string, SessionState>();
  private prevState: WorldState | undefined;
  private nextClientId = 1;
  private scopes = new Map<number, ReplicationScope>(); // comp index -> scope (absent = all)
  private ownerScoped = new Set<number>();
  private viewerScoped = new Map<number, (world: World, entity: Entity, clientId: number) => boolean>();
  private excluded = new Set<number>();
  private pubCache = new WeakMap<EntityState, EntityState>();
  private globals = new Set<Entity>();
  private handlers = new Map<MessageDefBase, CommandHandler[]>();
  private ownerCi: number | undefined;
  readonly tickHz: number; readonly historySize: number; readonly budgetBytes: number;
  /** Timings of the last network phase, for benchmarks. */
  readonly perf = { captureMs: 0, sendMs: 0 };
  private readonly opts: NetServerOptions;

  constructor(opts: NetServerOptions) {
    this.opts = opts; this.world = opts.world;
    this.tickHz = opts.tickHz ?? 20; this.historySize = opts.historySize ?? 32; this.budgetBytes = opts.budgetBytes ?? 16 * 1024;
    this.schema = new NetSchema(this.world);
    this.ownerCi = this.schema.indexOf(Owner, this.world);
    this.netIds = new NetIdRegistry(this.world);
    this.commands = new MessageRegistry(opts.commands);
    this.events = new MessageRegistry(opts.events);
    this.positions = new PositionHistory(this.world, opts.positionHistoryTicks ?? this.tickHz);
    if (opts.interest !== false) this.interest = new NetInterest(this.world, opts.interest ?? {});
    const t = opts.transport;
    t.onMessage((c, b) => this.onMessage(c, b));
    t.onDisconnect((c) => this.onDisconnect(c));
    this.world.addSystem("input", "net.server.applyInputs", (w, dt) => this.inputPhase(w, dt));
    this.world.addSystem("network", "net.server.replicate", (w) => this.replicate(w));
  }

  /** Handshake hashes the client must match. */
  get requiredHashes(): NamedHashes {
    return { ...this.opts.hashes, schema: this.world.getSchemaHash(), netdefs: this.events.hash(this.commands.hash()) };
  }
  sessionByConn(conn: ConnId): ClientSession | undefined { return this.byConn.get(conn); }

  // ---------------- scope / relevancy API ----------------
  /** Replication scope for a networked component (net-side registry; core ComponentDef has no custom fields). */
  setScope(def: ComponentDef, scope: ReplicationScope): this {
    const ci = this.schema.indexOf(def, this.world);
    if (ci === undefined) throw new Error(`${def.name} is not a replicated component`);
    if (def === Owner && scope !== "all") throw new Error("Owner must replicate to all");
    this.scopes.set(ci, scope); this.ownerScoped.delete(ci); this.viewerScoped.delete(ci); this.excluded.delete(ci);
    if (scope === "owner") this.ownerScoped.add(ci);
    else if (scope === "none") this.excluded.add(ci);
    else if (typeof scope === "function") this.viewerScoped.set(ci, scope);
    this.pubCache = new WeakMap(); this.prevState = undefined;
    return this;
  }
  getScope(def: ComponentDef): ReplicationScope { const ci = this.schema.indexOf(def, this.world); return (ci !== undefined && this.scopes.get(ci)) || "all"; }
  /** Always replicate this entity to every client regardless of AOI (entities without Transform are global automatically). */
  setGlobal(e: Entity, global = true): void { if (global) this.globals.add(e); else this.globals.delete(e); }

  // ---------------- commands & events API ----------------
  onCommand<S extends core.Schema>(def: MessageDef<S>, handler: CommandHandler<S>): () => void {
    this.commands.id(def as unknown as MessageDefBase);
    const d = def as unknown as MessageDefBase; const l = this.handlers.get(d) ?? []; l.push(handler as unknown as CommandHandler); this.handlers.set(d, l);
    return () => { const i = l.indexOf(handler as unknown as CommandHandler); if (i >= 0) l.splice(i, 1); };
  }
  /** Queue a tick-stamped event (entity fields = local entities; sent as NetIds). Flushed in this tick's network phase. */
  emitEvent<S extends core.Schema>(def: MessageDef<S>, payload: Payload<S>, opts: { reliable?: boolean; scope?: EventScope } = {}): void {
    const d = def as unknown as MessageDefBase; this.events.id(d);
    const p: Record<string, number> = { ...payload };
    for (const f of d.entityFields) { const e = p[f]!; p[f] = e === NO_ENTITY ? 0 : this.netIds.netIdOf(e) ?? 0; }
    const scope = opts.scope ?? "all";
    const near = typeof scope === "object" && "nearby" in scope ? scope.nearby : undefined;
    for (const s of this.byConn.values()) {
      if (typeof scope === "object") {
        if ("owner" in scope && s.clientId !== scope.owner) continue;
        if ("clients" in scope && !scope.clients.includes(s.clientId)) continue;
        if (near && this.interest && !this.interest.covers(s.clientId, near.x, near.y)) continue;
      }
      s.events.push({ reliable: opts.reliable ?? true, def: d, payload: p });
    }
  }

  // ---------------- transport handling ----------------
  private reject(conn: ConnId, reason: RejectReason, detail = ""): void { this.opts.transport.send(conn, encodeReject(reason, detail), "reliable"); }

  private onMessage(conn: ConnId, bytes: Uint8Array): void {
    let r: BitReader; let h;
    try { r = new BitReader(bytes); h = readHeader(r); } catch { return; }
    if (h.version !== PROTOCOL_VERSION) { this.reject(conn, RejectReason.ProtocolMismatch, `v${PROTOCOL_VERSION}`); return; }
    try {
      if (h.type === MsgType.Hello) this.onHello(conn, r);
      else if (h.type === MsgType.Input) this.onInput(conn, r);
      else if (h.type === MsgType.Command) this.onCommandMsg(conn, r);
    } catch { this.reject(conn, RejectReason.Malformed); }
  }

  private onHello(conn: ConnId, r: BitReader): void {
    const hello = decodeHello(r);
    for (const [name, v] of Object.entries(this.requiredHashes)) {
      if (hello.hashes[name] !== v) { this.reject(conn, name === "schema" ? RejectReason.SchemaMismatch : RejectReason.HashMismatch, name); return; }
    }
    let s: SessionState | undefined;
    if (hello.token.some((b) => b !== 0)) {
      s = this.byToken.get(tokenKey(hello.token));
      if (!s) { this.reject(conn, RejectReason.BadToken); return; }
      if (s.conn !== undefined) this.byConn.delete(s.conn);
      s.conn = conn; s.lastAckTick = -1; s.views.clear();
    } else {
      if (this.opts.maxClients !== undefined && this.sessions.size >= this.opts.maxClients) { this.reject(conn, RejectReason.ServerFull); return; }
      const token = (this.opts.randomToken ?? defaultToken)();
      s = {
        clientId: this.nextClientId++, token, conn, lastAckTick: -1, lastReceivedSeq: -1, lastProcessedSeq: -1, lastViewTick: -1,
        inputQueue: [], lastSnapshotBytes: 0, fullSnapshots: 0,
        stats: { commands: 0, droppedCommands: 0, rateLimited: 0, deferred: 0, bytesSent: 0 },
        views: new Map(), lastSent: new Map(), buckets: new Map(), commands: [], events: [],
      };
      this.sessions.set(s.clientId, s); this.byToken.set(tokenKey(token), s);
      this.opts.onClientJoin?.(s, this.world);
    }
    this.byConn.set(conn, s);
    this.opts.transport.send(conn, encodeWelcome({ clientId: s.clientId, token: s.token, tickHz: this.tickHz, serverTick: this.world.tick }), "reliable");
  }

  private onInput(conn: ConnId, r: BitReader): void {
    const s = this.byConn.get(conn); if (!s) return;
    const m = decodeInput(r);
    if (m.ackTick !== NONE_U32 && m.ackTick > s.lastAckTick && m.ackTick <= this.world.tick) s.lastAckTick = m.ackTick;
    if (m.viewTick !== undefined && m.viewTick <= this.world.tick) s.lastViewTick = m.viewTick;
    for (const c of m.cmds) {
      if (c.seq <= s.lastReceivedSeq) continue;
      s.lastReceivedSeq = c.seq; s.inputQueue.push(c);
    }
    const max = this.opts.maxInputQueue ?? 8;
    if (s.inputQueue.length > max) s.inputQueue.splice(0, s.inputQueue.length - max);
  }

  private onCommandMsg(conn: ConnId, r: BitReader): void {
    const s = this.byConn.get(conn); if (!s) return;
    const id = r.readVarUint(); const def = this.commands.get(id);
    if (!def) { s.stats.droppedCommands++; return; }
    const payload = readPayload(r, def);
    let b = s.buckets.get(id); if (!b) { b = new TokenBucket(def.rate ?? DEFAULT_COMMAND_RATE); s.buckets.set(id, b); }
    if (!b.take()) { s.stats.rateLimited++; return; }
    s.commands.push({ def, payload });
  }

  private onDisconnect(conn: ConnId): void {
    const s = this.byConn.get(conn); if (!s) return;
    this.byConn.delete(conn); s.conn = undefined; s.views.clear(); s.events.length = 0;
    this.interest?.removeViewer(s.clientId);
    this.opts.onClientLeave?.(s, this.world);
  }

  removeSession(clientId: number): void {
    const s = this.sessions.get(clientId) as SessionState | undefined; if (!s) return;
    this.sessions.delete(clientId); this.byToken.delete(tokenKey(s.token)); this.interest?.removeViewer(clientId);
    if (s.conn !== undefined) { this.byConn.delete(s.conn); this.opts.transport.disconnect(s.conn); }
  }

  private ownedBy(w: World): Map<number, Entity[]> {
    const owned = new Map<number, Entity[]>();
    for (const e of w.query([Owner])) {
      const cid = w.getField(e, Owner, "clientId")!; if (cid === 0) continue;
      const l = owned.get(cid); if (l) l.push(e); else owned.set(cid, [e]);
    }
    return owned;
  }

  // ---------------- input phase ----------------
  private inputPhase(w: World, dt: number): void {
    const owned = this.ownedBy(w);
    for (const s of this.sessions.values() as IterableIterator<SessionState>) {
      for (const b of s.buckets.values()) b.refill(dt);
      const cmds = s.commands; s.commands = [];
      for (const c of cmds) {
        const p = { ...c.payload }; let ok = true;
        for (const f of c.def.entityFields) {
          const id = p[f]!; if (id === 0) { p[f] = NO_ENTITY; continue; }
          const e = this.netIds.entityOf(id);
          if (e === undefined || !w.isAlive(e)) { ok = false; break; }
          p[f] = e;
        }
        if (!ok) { s.stats.droppedCommands++; continue; }
        s.stats.commands++;
        for (const h of this.handlers.get(c.def) ?? []) h(s, p, w);
      }
      const cmd = s.inputQueue.shift() ?? null;
      if (cmd) s.lastProcessedSeq = cmd.seq;
      if (this.opts.applyInput) for (const e of owned.get(s.clientId) ?? []) this.opts.applyInput(w, e, cmd, s.clientId);
    }
  }

  // ---------------- network phase ----------------
  /** Component view of `es` for `clientId` according to scopes. Returns shared objects whenever possible. */
  private filterFor(netEntity: Entity, es: EntityState, clientId: number): EntityState {
    if (!this.ownerScoped.size && !this.viewerScoped.size) return es;
    const owner = this.ownerCi !== undefined ? es.get(this.ownerCi)?.[0] : undefined;
    let hasViewer = false;
    for (const ci of this.viewerScoped.keys()) if (es.has(ci)) { hasViewer = true; break; }
    if (owner === clientId) return es; // owner sees owner- and viewer-scoped comps
    let pub = this.pubCache.get(es);
    if (!pub) {
      let restricted = hasViewer;
      if (!restricted) for (const ci of this.ownerScoped) if (es.has(ci)) { restricted = true; break; }
      if (!restricted) pub = es;
      else { const m = new Map(es); for (const ci of this.ownerScoped) m.delete(ci); for (const ci of this.viewerScoped.keys()) m.delete(ci); pub = m; }
      this.pubCache.set(es, pub);
    }
    if (!hasViewer) return pub;
    let m: Map<number, readonly number[]> | undefined;
    for (const [ci, fn] of this.viewerScoped) {
      const v = es.get(ci); if (!v || !fn(this.world, netEntity, clientId)) continue;
      m ??= new Map(pub); m.set(ci, v);
    }
    return m ?? pub;
  }

  private replicate(w: World): void {
    const t0 = now();
    const ns = w.store(NetId);
    for (const index of [...ns.changedIndices()]) { const e = ns.dense[ns.slot(index)]!; if (this.netIds.netIdOf(e) === undefined) this.netIds.adopt(e); }
    for (const st of this.schema.stores) for (const index of [...st.changedIndices()]) {
      const e = st.dense[st.slot(index)]!;
      if (!w.has(e, NetId)) this.netIds.assign(e);
    }
    this.positions.record();
    const cur = captureState(w, this.schema, this.prevState, this.excluded);
    this.prevState = cur;
    const owned = this.ownedBy(w);
    const tf = w.store(Transform);
    // global entities: no Transform, or flagged
    const globals: number[] = [];
    for (let k = 0; k < ns.size; k++) { const e = ns.dense[k]!; if (!tf.has(entityIndex(e)) || this.globals.has(e)) globals.push(ns.data.id[k]!); }
    const grid = this.interest;
    if (grid) {
      grid.sync();
      for (const s of this.byConn.values()) {
        const pos = (owned.get(s.clientId) ?? []).filter((e) => tf.has(entityIndex(e))).map((e) => ({ x: w.getField(e, Transform, "x")!, y: w.getField(e, Transform, "y")! }));
        grid.setViewer(s.clientId, pos);
      }
      grid.update();
    }
    const t1 = now(); this.perf.captureMs = t1 - t0;
    const tick = w.tick;
    for (const s of this.byConn.values()) {
      // ---- relevant view ----
      const view = new Map<number, EntityState>();
      const add = (netId: number): void => {
        if (view.has(netId)) return; const es = cur.get(netId); if (!es) return;
        const e = this.netIds.entityOf(netId); view.set(netId, e === undefined ? es : this.filterFor(e, es, s.clientId));
      };
      const ownedIds = new Set<number>();
      for (const e of owned.get(s.clientId) ?? []) { const id = this.netIds.netIdOf(e); if (id !== undefined) { ownedIds.add(id); add(id); } }
      for (const id of globals) add(id);
      if (grid) { for (const e of grid.relevant(s.clientId)) { const id = this.netIds.netIdOf(e); if (id !== undefined) add(id); } }
      else for (const id of cur.keys()) add(id);
      // ---- encode against acked view ----
      const base = s.lastAckTick >= 0 ? s.views.get(s.lastAckTick) : undefined;
      if (!base) s.fullSnapshots++;
      const bw = new BitWriter();
      writeHeader(bw, MsgType.Snapshot);
      bw.writeBits(tick, 32); bw.writeBits(base ? s.lastAckTick : NONE_U32, 32);
      bw.writeBits(s.lastProcessedSeq < 0 ? NONE_U32 : s.lastProcessedSeq, 32);
      const sent = new Map(view);
      if (base) for (const id of base.keys()) if (!view.has(id)) writeDespawn(bw, id);
      const must: number[] = []; const rest: number[] = [];
      for (const [id, es] of view) { if (base?.get(id) === es) continue; (ownedIds.has(id) || globals.includes(id) ? must : rest).push(id); }
      for (const id of must) writeEntityRecord(bw, this.schema, id, view.get(id)!, base?.get(id));
      if (rest.length > 1 && bw.byteLength < this.budgetBytes) this.prioritize(rest, s, owned.get(s.clientId) ?? [], tick);
      for (let i = 0; i < rest.length; i++) {
        const id = rest[i]!; const mark = bw.bitLength;
        if (bw.byteLength >= this.budgetBytes || !(writeEntityRecord(bw, this.schema, id, view.get(id)!, base?.get(id)), true) || bw.byteLength > this.budgetBytes) {
          bw.truncate(mark);
          // defer this and everything after it: the client keeps its baseline value / does not get the spawn yet
          for (let j = i; j < rest.length; j++) { const d = rest[j]!; const old = base?.get(d); if (old) sent.set(d, old); else sent.delete(d); }
          s.stats.deferred += rest.length - i;
          break;
        }
        s.lastSent.set(id, tick);
      }
      writeEnd(bw);
      s.views.set(tick, sent);
      for (const t of s.views.keys()) if (t < s.lastAckTick || t <= tick - this.historySize) s.views.delete(t);
      const bytes = bw.finish(); s.lastSnapshotBytes = bytes.length; s.stats.bytesSent += bytes.length;
      this.opts.transport.send(s.conn!, bytes, "unreliable");
      this.flushEvents(s, tick);
    }
    this.perf.sendMs = now() - t1;
  }

  /** Order by distance to the client's owned entities, discounted by staleness (ticks since last sent). */
  private prioritize(ids: number[], s: SessionState, owned: Entity[], tick: number): void {
    const w = this.world; const tf = w.store(Transform);
    const centers = owned.filter((e) => tf.has(entityIndex(e))).map((e) => [w.getField(e, Transform, "x")!, w.getField(e, Transform, "y")!] as const);
    const score = new Map<number, number>();
    for (const id of ids) {
      const e = this.netIds.entityOf(id); let d2 = 0;
      if (e !== undefined && centers.length && tf.has(entityIndex(e))) {
        const sl = tf.slot(entityIndex(e)); const x = tf.data.x[sl]!, y = tf.data.y[sl]!;
        d2 = Math.min(...centers.map(([cx, cy]) => (x - cx) ** 2 + (y - cy) ** 2));
      }
      const stale = tick - (s.lastSent.get(id) ?? tick - 1);
      score.set(id, d2 / (stale * stale));
    }
    ids.sort((a, b) => score.get(a)! - score.get(b)!);
  }

  private flushEvents(s: SessionState, tick: number): void {
    if (!s.events.length) return;
    for (const reliable of [true, false]) {
      const list = s.events.filter((e) => e.reliable === reliable); if (!list.length) continue;
      const w = new BitWriter(); writeHeader(w, MsgType.Events); w.writeBits(tick, 32); w.writeVarUint(list.length);
      for (const ev of list) { w.writeVarUint(this.events.id(ev.def)); writePayload(w, ev.def, ev.payload); }
      this.opts.transport.send(s.conn!, w.finish(), reliable ? "reliable" : "unreliable");
    }
    s.events.length = 0;
  }
}

const now = (): number => (globalThis as { performance?: { now(): number } }).performance?.now() ?? 0;
