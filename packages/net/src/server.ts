import { NetId, Owner, entityIndex, type Entity, type World } from "@engine/core";
import { BitReader, BitWriter } from "./bits.js";
import {
  MsgType, NONE_U32, PROTOCOL_VERSION, RejectReason, TOKEN_BYTES, decodeHello, decodeInput, encodeReject,
  encodeWelcome, readHeader, tokenKey, writeHeader, type InputCmd,
} from "./protocol.js";
import { NetSchema, captureState, encodeDelta, type WorldState } from "./state.js";
import type { ConnId, ServerTransport } from "./transport/types.js";

/** Server-side netId <-> local entity mapping. NetIds are monotonic u32 and never reused. */
export class NetIdRegistry {
  private next = 1;
  private toEntity = new Map<number, Entity>();
  private toNet = new Map<number, number>(); // entity index -> netId
  constructor(private readonly world: World) {
    world.onDespawn((e) => this.release(e));
  }
  /** Adds a NetId component (idempotent) and returns the netId. */
  assign(e: Entity): number {
    const existing = this.world.getField(e, NetId, "id");
    if (existing !== undefined && this.toEntity.get(existing) === e) return existing;
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
    if (owner !== undefined || id === 0) { this.world.remove(e, NetId); return this.assign(e); }
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

export interface ClientSession {
  readonly clientId: number;
  readonly token: Uint8Array;
  conn: ConnId | undefined;
  /** Newest snapshot tick the client has decoded (delta baseline), -1 = none. */
  lastAckTick: number;
  /** Highest input seq received / applied; -1 = none. */
  lastReceivedSeq: number;
  lastProcessedSeq: number;
  readonly inputQueue: InputCmd[];
  lastSnapshotBytes: number;
  fullSnapshots: number;
}

export type ApplyInput = (world: World, entity: Entity, cmd: InputCmd | null, clientId: number) => void;

export interface NetServerOptions {
  world: World;
  transport: ServerTransport;
  tickHz?: number;
  /** Ticks of replicated state kept as delta baselines (default 32). Older acks get a full snapshot. */
  historySize?: number;
  /** Max buffered inputs per client; oldest are dropped beyond this (default 8). */
  maxInputQueue?: number;
  maxClients?: number;
  /** Applies one input (or null if none arrived for this tick) to each entity the client owns, in the input phase. */
  applyInput?: ApplyInput;
  onClientJoin?: (session: ClientSession, world: World) => void;
  onClientLeave?: (session: ClientSession, world: World) => void;
  /** Session token source; defaults to crypto.getRandomValues. */
  randomToken?: () => Uint8Array;
}

function defaultToken(): Uint8Array {
  const c = (globalThis as unknown as { crypto?: { getRandomValues(a: Uint8Array): Uint8Array } }).crypto;
  if (!c) throw new Error("no crypto.getRandomValues; pass randomToken");
  return c.getRandomValues(new Uint8Array(TOKEN_BYTES));
}

/**
 * Authoritative server: handshake + sessions, input queues (input phase), netId assignment and
 * per-client delta snapshots (network phase).
 */
export class NetServer {
  readonly world: World;
  readonly netIds: NetIdRegistry;
  readonly schema: NetSchema;
  readonly sessions = new Map<number, ClientSession>(); // clientId -> session
  private byConn = new Map<ConnId, ClientSession>();
  private byToken = new Map<string, ClientSession>();
  private history = new Map<number, WorldState>();
  private prevState: WorldState | undefined;
  private nextClientId = 1;
  readonly tickHz: number; readonly historySize: number;
  private readonly opts: NetServerOptions;

  constructor(opts: NetServerOptions) {
    this.opts = opts; this.world = opts.world;
    this.tickHz = opts.tickHz ?? 20; this.historySize = opts.historySize ?? 32;
    this.schema = new NetSchema(this.world);
    this.netIds = new NetIdRegistry(this.world);
    const t = opts.transport;
    t.onMessage((c, b) => this.onMessage(c, b));
    t.onDisconnect((c) => this.onDisconnect(c));
    this.world.addSystem("input", "net.server.applyInputs", (w) => this.applyInputs(w));
    this.world.addSystem("network", "net.server.replicate", (w) => this.replicate(w));
  }

  sessionByConn(conn: ConnId): ClientSession | undefined { return this.byConn.get(conn); }

  private reject(conn: ConnId, reason: RejectReason): void { this.opts.transport.send(conn, encodeReject(reason), "reliable"); }

  private onMessage(conn: ConnId, bytes: Uint8Array): void {
    let r: BitReader; let h;
    try { r = new BitReader(bytes); h = readHeader(r); } catch { return; }
    if (h.version !== PROTOCOL_VERSION) { this.reject(conn, RejectReason.ProtocolMismatch); return; }
    try {
      if (h.type === MsgType.Hello) this.onHello(conn, r);
      else if (h.type === MsgType.Input) this.onInput(conn, r);
    } catch { this.reject(conn, RejectReason.Malformed); }
  }

  private onHello(conn: ConnId, r: BitReader): void {
    const hello = decodeHello(r);
    if (hello.schemaHash !== this.world.getSchemaHash()) { this.reject(conn, RejectReason.SchemaMismatch); return; }
    let s: ClientSession | undefined;
    if (hello.token.some((b) => b !== 0)) {
      s = this.byToken.get(tokenKey(hello.token));
      if (!s) { this.reject(conn, RejectReason.BadToken); return; }
      if (s.conn !== undefined) this.byConn.delete(s.conn);
      s.conn = conn; s.lastAckTick = -1; // resume: next snapshot is full
    } else {
      if (this.opts.maxClients !== undefined && this.sessions.size >= this.opts.maxClients) { this.reject(conn, RejectReason.ServerFull); return; }
      const token = (this.opts.randomToken ?? defaultToken)();
      s = { clientId: this.nextClientId++, token, conn, lastAckTick: -1, lastReceivedSeq: -1, lastProcessedSeq: -1, inputQueue: [], lastSnapshotBytes: 0, fullSnapshots: 0 };
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
    for (const c of m.cmds) {
      if (c.seq <= s.lastReceivedSeq) continue; // redundant copy
      s.lastReceivedSeq = c.seq; s.inputQueue.push(c);
    }
    const max = this.opts.maxInputQueue ?? 8;
    if (s.inputQueue.length > max) s.inputQueue.splice(0, s.inputQueue.length - max);
  }

  private onDisconnect(conn: ConnId): void {
    const s = this.byConn.get(conn); if (!s) return;
    this.byConn.delete(conn); s.conn = undefined;
    this.opts.onClientLeave?.(s, this.world);
  }

  /** Drop a session entirely (token becomes invalid). */
  removeSession(clientId: number): void {
    const s = this.sessions.get(clientId); if (!s) return;
    this.sessions.delete(clientId); this.byToken.delete(tokenKey(s.token));
    if (s.conn !== undefined) { this.byConn.delete(s.conn); this.opts.transport.disconnect(s.conn); }
  }

  private applyInputs(w: World): void {
    const owned = new Map<number, Entity[]>();
    for (const e of w.query([Owner])) {
      const cid = w.getField(e, Owner, "clientId")!; if (cid === 0) continue;
      const l = owned.get(cid); if (l) l.push(e); else owned.set(cid, [e]);
    }
    for (const s of this.sessions.values()) {
      const cmd = s.inputQueue.shift() ?? null;
      if (cmd) s.lastProcessedSeq = cmd.seq;
      if (this.opts.applyInput) for (const e of owned.get(s.clientId) ?? []) this.opts.applyInput(w, e, cmd, s.clientId);
    }
  }

  /** Network phase: assign netIds, capture state, send each client a delta against its acked baseline. */
  private replicate(w: World): void {
    for (const st of this.schema.stores) for (const index of st.changedIndices()) {
      const e = st.dense[st.slot(index)]!;
      if (!w.has(e, NetId)) this.netIds.assign(e);
    }
    const ns = w.store(NetId);
    for (const index of [...ns.changedIndices()]) { const e = ns.dense[ns.slot(index)]!; if (this.netIds.netIdOf(e) === undefined) this.netIds.adopt(e); }
    const cur = captureState(w, this.schema, this.prevState);
    this.prevState = cur;
    const tick = w.tick;
    this.history.set(tick, cur); this.history.delete(tick - this.historySize);
    for (const s of this.sessions.values()) {
      if (s.conn === undefined) continue;
      const base = s.lastAckTick >= 0 ? this.history.get(s.lastAckTick) : undefined;
      if (!base) s.fullSnapshots++;
      const bw = new BitWriter();
      writeHeader(bw, MsgType.Snapshot);
      bw.writeBits(tick, 32);
      bw.writeBits(base ? s.lastAckTick : NONE_U32, 32);
      bw.writeBits(s.lastProcessedSeq < 0 ? NONE_U32 : s.lastProcessedSeq, 32);
      encodeDelta(bw, this.schema, cur, base);
      const bytes = bw.finish(); s.lastSnapshotBytes = bytes.length;
      this.opts.transport.send(s.conn, bytes, "unreliable");
    }
  }
}
