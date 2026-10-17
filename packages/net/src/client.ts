import { ENV_NET_ID, NetId, entityIndex, Owner, Transform, type ComponentDef, type ComponentStore, type Entity, type World } from "@engine/core";
import { BitReader } from "./bits.js";
import { InterpolationBuffer } from "./interpolation.js";
import {
  MsgType, NONE_U32, PROTOCOL_VERSION, decodeWelcome, emptyToken, encodeHello, encodeInput, readHeader,
  type InputCmd, type RejectReason, type WelcomeMsg,
} from "./protocol.js";
import { NetSchema, decodeDelta, fromWire, type CompValues, type EntityState, type WorldState } from "./state.js";
import type { ClientTransport } from "./transport/types.js";

export class NetRejectedError extends Error {
  constructor(readonly reason: RejectReason) { super(`server rejected connection (reason ${reason})`); }
}

export interface NetClientOptions {
  world: World;
  transport: ClientTransport;
  /** Applies one input to an owned entity; must be the same function the server uses (prediction). */
  applyInput?: (world: World, entity: Entity, cmd: InputCmd | null) => void;
  /** Samples the local input for this tick (input phase). */
  sampleInput?: () => { buttons: number; aimX: number; aimY: number };
  /** Remote entities render this many server ticks in the past (default 2). */
  interpDelayTicks?: number;
  /** Max unacked inputs repeated in each input packet (default 8). */
  inputRedundancy?: number;
  /** Decoded states kept as possible delta baselines (default 64). */
  historySize?: number;
  /** Component interpolated for remote entities (default Transform; field "facing" is angular). */
  interpolated?: ComponentDef;
  onSpawn?: (entity: Entity, netId: number, owned: boolean, world: World) => void;
  onDespawn?: (entity: Entity, netId: number, world: World) => void;
}

/**
 * Client: handshake, snapshot apply (netId -> local entity map), input send with sequence numbers,
 * prediction + reconciliation for owned entities, interpolation for remote ones.
 * Systems: input phase (sample/predict/send), network phase (apply snapshots, reconcile, interpolate).
 */
export class NetClient {
  readonly world: World;
  readonly schema: NetSchema;
  clientId = 0;
  token: Uint8Array = emptyToken();
  readonly entities = new Map<number, Entity>(); // netId -> local entity
  readonly owned = new Set<number>(); // netIds predicted locally
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
  stats = { snapshots: 0, dropped: 0, reconciliations: 0, lastCorrection: 0, maxCorrection: 0 };
  private readonly opts: NetClientOptions;

  constructor(opts: NetClientOptions) {
    this.opts = opts; this.world = opts.world;
    this.schema = new NetSchema(this.world);
    const idef = opts.interpolated ?? Transform;
    this.interpIndex = this.schema.indexOf(idef, this.world);
    this.interpStore = this.world.store(idef) as unknown as ComponentStore;
    this.interp = new InterpolationBuffer(32, 1, this.interpStore.fields.map((f) => f === "facing"));
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
    this.opts.transport.send(encodeHello({ schemaHash: this.world.getSchemaHash(), token: token ?? emptyToken() }), "reliable");
    return p;
  }

  private onMessage(bytes: Uint8Array): void {
    let r: BitReader; let h;
    try { r = new BitReader(bytes); h = readHeader(r); } catch { return; }
    if (h.type === MsgType.Reject) {
      const reason = r.readBits(8) as RejectReason;
      this.welcome?.reject(new NetRejectedError(reason)); this.welcome = undefined;
      this.active = false; this.opts.transport.close(); return;
    }
    if (h.version !== PROTOCOL_VERSION) return;
    if (h.type === MsgType.Welcome) {
      const w = decodeWelcome(r);
      this.clientId = w.clientId; this.token = w.token; this.active = true;
      this.serverTickEstimate = w.serverTick; this.latestTick = -1; this.history.clear();
      this.welcome?.resolve(w); this.welcome = undefined;
    } else if (h.type === MsgType.Snapshot) this.inbox.push(bytes);
  }

  private ownedEntities(): Entity[] { return [...this.owned].map((id) => this.entities.get(id)).filter((e): e is Entity => e !== undefined); }

  private inputSystem(w: World): void {
    if (!this.active) return;
    const owned = this.ownedEntities();
    if (owned.length && this.opts.sampleInput) {
      const cmd: InputCmd = { seq: this.nextSeq++, ...this.opts.sampleInput() };
      this.pending.push(cmd);
      for (const e of owned) this.opts.applyInput?.(w, e, cmd);
    }
    const n = this.opts.inputRedundancy ?? 8;
    this.opts.transport.send(encodeInput({ ackTick: this.latestTick < 0 ? NONE_U32 : this.latestTick, cmds: this.pending.slice(-n) }), "unreliable");
  }

  private networkSystem(w: World, dt: number): void {
    this.serverTickEstimate += 1;
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
    if (this.latestTick >= 0 && (this.serverTickEstimate < this.latestTick || this.serverTickEstimate - this.latestTick > 4)) this.serverTickEstimate = this.latestTick;
    if (reconcileSeq !== undefined) this.reconcile(w, dt, reconcileSeq);
    this.interpolate(w);
  }

  /** Bring the local world in line with `cur` (diffed against the previously applied state, which may be an older tick). */
  private applyState(w: World, tick: number, prev: WorldState | undefined, cur: WorldState): void {
    if (prev) for (const netId of prev.keys()) if (!cur.has(netId)) this.despawn(w, netId);
    for (const [netId, es] of cur) {
      const old = prev?.get(netId);
      // core-owned environment singleton: write into world.environment instead of spawning (ADR-028)
      if (netId === ENV_NET_ID && w.has(w.environment, NetId)) { if (old !== es) this.writeComps(w, w.environment, es, old, false); continue; }
      let e = this.entities.get(netId);
      if (e === undefined || !w.isAlive(e)) {
        e = w.create(); w.add(e, NetId, { id: netId }); this.entities.set(netId, e);
        this.writeComps(w, e, es, undefined, true);
        const owned = this.isOwned(es);
        if (owned) this.owned.add(netId);
        this.opts.onSpawn?.(e, netId, owned, w);
      } else if (old !== es) {
        // removals first (a comp removed+re-added shows up only as changed here)
        for (const ci of old?.keys() ?? []) if (!es.has(ci)) w.remove(e, this.schema.stores[ci]!.def);
        this.writeComps(w, e, es, old, this.owned.has(netId));
      }
      if (!this.owned.has(netId) && this.interpIndex !== undefined) {
        const v = es.get(this.interpIndex);
        if (v) this.interp.push(netId, tick, this.decode(this.interpIndex, v));
      }
    }
  }

  private isOwned(es: EntityState): boolean {
    const oi = this.schema.indexOf(Owner, this.world);
    const v = oi === undefined ? undefined : es.get(oi);
    return v !== undefined && v[0] === this.clientId;
  }
  private decode(ci: number, v: CompValues): number[] { const specs = this.schema.specs[ci]!; return v.map((x, i) => fromWire(specs[i]!, x)); }

  /** Writes changed comps. For remote entities the interpolated comp is left to interpolate() (except on spawn). */
  private writeComps(w: World, e: Entity, es: EntityState, old: EntityState | undefined, full: boolean): void {
    for (const [ci, v] of es) {
      if (old?.get(ci) === v) continue;
      if (!full && ci === this.interpIndex && old?.has(ci)) continue;
      const st = this.schema.stores[ci]!; const vals = this.decode(ci, v);
      const init: Record<string, number> = {}; st.fields.forEach((f, i) => { init[f] = vals[i]!; });
      if (w.has(e, st.def)) w.set(e, st.def, init); else w.add(e, st.def, init);
    }
  }

  private despawn(w: World, netId: number): void {
    const e = this.entities.get(netId);
    this.entities.delete(netId); this.owned.delete(netId); this.interp.remove(netId);
    if (e !== undefined && w.isAlive(e)) { this.opts.onDespawn?.(e, netId, w); w.destroy(e); }
  }

  /** Reset owned entities to the authoritative state and replay unprocessed inputs via world.simulate. */
  private reconcile(w: World, dt: number, processedSeq: number): void {
    while (this.pending.length && this.pending[0]!.seq <= processedSeq) this.pending.shift();
    const state = this.history.get(this.latestTick); if (!state) return;
    const owned: [Entity, number[] | undefined][] = [];
    for (const netId of this.owned) {
      const e = this.entities.get(netId); const es = state.get(netId);
      if (e === undefined || !es) continue;
      const before = this.interpIndex !== undefined ? this.interpStore.get(entityIndex(e)) : undefined;
      this.writeComps(w, e, es, undefined, true);
      owned.push([e, before ? this.interpStore.fields.map((f) => before[f]!) : undefined]);
    }
    if (!owned.length) return;
    const pending = this.pending;
    w.simulate(pending.length, dt, (i) => { for (const [e] of owned) this.opts.applyInput?.(w, e, pending[i]!); });
    this.stats.reconciliations++;
    let corr = 0;
    for (const [e, before] of owned) {
      const after = this.interpStore.get(entityIndex(e)); if (!before || !after) continue;
      corr = Math.max(corr, Math.hypot(...this.interpStore.fields.filter((f) => f !== "facing").map((f, i) => after[f]! - before[i]!)));
    }
    this.stats.lastCorrection = corr; this.stats.maxCorrection = Math.max(this.stats.maxCorrection, corr);
  }

  /** Remote entities: write the interpolated component at (estimated server tick - delay). */
  private interpolate(w: World): void {
    const t = this.serverTickEstimate - (this.opts.interpDelayTicks ?? 2);
    for (const netId of this.interp.ids()) {
      const e = this.entities.get(netId); if (e === undefined || !w.isAlive(e) || !w.has(e, this.interpStore.def)) continue;
      const v = this.interp.sample(netId, t); if (!v) continue;
      const vals: Record<string, number> = {}; this.interpStore.fields.forEach((f, i) => { vals[f] = v[i]!; });
      w.set(e, this.interpStore.def, vals);
    }
  }

  close(): void { this.opts.transport.close(); }
}
