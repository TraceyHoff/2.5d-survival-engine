import { ComponentStore, type ComponentDef } from "./component.js";
import { entityGen, entityIndex, makeEntity, MAX_ENTITIES, GEN_MASK, type Entity } from "./entity.js";
import { fnv1a, schemaSignature, type ArrayField, type ScalarField, type Schema, type SchemaInit, type SchemaValues, type TypedArray } from "./schema.js";
import { BUILTIN_COMPONENTS, ENV_NET_ID, NetId, PrevTransform, TimeOfDay, Transform, Weather } from "./builtins.js";
import { Rng } from "./rng.js";
import { EventBus } from "./events.js";

/** Built-in phase names; custom phases can be inserted with addPhase(). */
export type BuiltinPhase = "input" | "simulation" | "postSim" | "network" | "renderPrep";
export type Phase = BuiltinPhase | (string & {});
export const PHASES: readonly BuiltinPhase[] = ["input", "simulation", "postSim", "network", "renderPrep"];
export type System = (world: World, dt: number) => void;
/** Scheduling for slow systems: run every `every` ticks (dt passed is dt * every); `offset` staggers (default: hash of name % every). */
export interface SystemOptions { every?: number; offset?: number }
interface SystemEntry { name: string; fn: System; every: number; offset: number }
export type EntityHook = (entity: Entity, world: World) => void;

export interface WorldOptions { maxEntities?: number; seed?: number; registerBuiltins?: boolean }
export interface SimulateOptions {
  /** Called before each replayed tick with the replay index i (0..ticks-1); world.tick is already set. */
  beforeTick?: (i: number) => void;
  /** Only run these named simulation-phase systems (default: all). */
  systems?: readonly string[];
  /** world.tick seen by the first replayed tick (default: world.tick - ticks, i.e. the last `ticks` completed ticks). */
  startTick?: number;
  /** Keep events queued during replay (default false: discarded). */
  keepEvents?: boolean;
}

export class World {
  readonly maxEntities: number;
  private gens: Uint16Array;
  private alive: Uint8Array;
  private freeList: number[] = [];
  private nextIndex = 0;
  private stores: ComponentStore[] = [];
  private byDef = new Map<ComponentDef, ComponentStore>();
  private phaseOrder: Phase[] = [...PHASES];
  private systems = new Map<Phase, SystemEntry[]>(PHASES.map((p) => [p, []]));
  private resources = new Map<object, unknown>();
  private spawnHooks: EntityHook[] = [];
  private despawnHooks: EntityHook[] = [];
  readonly rng: Rng;
  readonly seed: number;
  /** Singleton entity holding TimeOfDay, Weather and NetId=ENV_NET_ID (when builtins are registered). */
  readonly environment: Entity;
  /** True while simulate() is replaying ticks. */
  isReplaying = false;
  /** Entities the client predicts; populated by netcode, checked by systems during replay. */
  readonly predicted = new Set<Entity>();
  private envViews = new Map<ComponentDef, unknown>();
  readonly events = new EventBus();
  tick = 0;
  entityCount = 0;

  constructor(opts: WorldOptions = {}) {
    this.maxEntities = Math.min(opts.maxEntities ?? 65536, MAX_ENTITIES);
    this.gens = new Uint16Array(this.maxEntities);
    this.alive = new Uint8Array(this.maxEntities);
    this.seed = (opts.seed ?? 1) >>> 0;
    this.rng = new Rng(this.seed);
    if (opts.registerBuiltins !== false) {
      for (const c of BUILTIN_COMPONENTS) this.register(c);
      this.environment = this.create();
      this.add(this.environment, NetId, { id: ENV_NET_ID }).add(this.environment, TimeOfDay).add(this.environment, Weather);
    } else this.environment = -1 >>> 0;
  }

  /** Deterministic RNG stream from (world seed, tick, key[, entity]). Pass a NetId (not a local entity id) for cross-peer agreement. */
  rngFor(key: string | number, entity?: Entity): Rng {
    let h = fnv1a(typeof key === "number" ? `#${key}` : key, Math.imul(this.seed ^ 0x9e3779b9, 0x85ebca6b) >>> 0);
    h = Math.imul(h ^ this.tick, 0x01000193) >>> 0;
    if (entity !== undefined) h = Math.imul(h ^ entity, 0xc2b2ae35) >>> 0;
    return new Rng(h ^ (h >>> 16));
  }

  /** Live read/write view of an environment singleton component (writes mark changed). */
  env<S extends Schema>(def: ComponentDef<S>): SchemaValues<S> {
    let v = this.envViews.get(def as ComponentDef) as SchemaValues<S> | undefined;
    if (v) return v;
    const st = this.store(def); const idx = entityIndex(this.environment);
    if (!st.has(idx)) throw new Error(`environment lacks ${def.name}`);
    const o = {} as Record<string, unknown>;
    for (const f of st.fields) Object.defineProperty(o, f, {
      enumerable: true,
      get: () => st.read(idx, f),
      set: (x: number) => { st.write(idx, f, x); },
    });
    v = o as SchemaValues<S>; this.envViews.set(def as ComponentDef, v); return v;
  }

  // ---- components ----
  /** Registers a component; id = registration order (must match on client & server). Idempotent. */
  register(def: ComponentDef): number {
    const ex = this.byDef.get(def); if (ex) return ex.id;
    const store = new ComponentStore(this.stores.length, def, this.maxEntities) as unknown as ComponentStore;
    this.stores.push(store); this.byDef.set(def, store);
    return store.id;
  }
  store<S extends Schema>(def: ComponentDef<S>): ComponentStore<S>;
  /** Fallback for unions of component defs (e.g. `opts.def ?? Transform`). */
  store(def: ComponentDef): ComponentStore;
  store<S extends Schema>(def: ComponentDef<S>): ComponentStore<S> {
    const s = this.byDef.get(def as ComponentDef);
    if (!s) throw new Error(`Component not registered: ${def.name}`);
    return s as unknown as ComponentStore<S>;
  }
  componentId(def: ComponentDef): number { return this.store(def).id; }
  storeById(id: number): ComponentStore | undefined { return this.stores[id]; }
  get componentStores(): readonly ComponentStore[] { return this.stores; }
  /** Deterministic hash over registration order: id, name, networked flag, schema signature (incl. quant hints). */
  private schemaSalts = new Map<string, number>();
  /** Mix an external hash (e.g. asset registry id hash) into getSchemaHash(), keyed by name. */
  addSchemaSalt(name: string, hash: number): void { this.schemaSalts.set(name, hash >>> 0); }
  getSchemaHash(): number {
    let h = 0x811c9dc5;
    for (const [k, v] of [...this.schemaSalts].sort(([a], [b]) => (a < b ? -1 : 1))) h = fnv1a(`salt|${k}|${v}\n`, h);
    for (const s of this.stores) h = fnv1a(`${s.id}|${s.def.name}|${s.def.networked ? 1 : 0}${s.def.persistent ? "p" : ""}|${schemaSignature(s.def.schema)}\n`, h);
    return h;
  }

  // ---- entities ----
  onSpawn(fn: EntityHook): () => void { this.spawnHooks.push(fn); return () => removeFrom(this.spawnHooks, fn); }
  /** Called before components are removed, so hooks can still read NetId etc. */
  onDespawn(fn: EntityHook): () => void { this.despawnHooks.push(fn); return () => removeFrom(this.despawnHooks, fn); }
  create(): Entity {
    let idx: number;
    if (this.freeList.length) idx = this.freeList.pop()!;
    else { if (this.nextIndex >= this.maxEntities) throw new Error("Entity limit reached"); idx = this.nextIndex++; }
    this.alive[idx] = 1; this.entityCount++;
    const e = makeEntity(idx, this.gens[idx]!);
    for (const h of this.spawnHooks) h(e, this);
    return e;
  }
  isAlive(e: Entity): boolean {
    const i = entityIndex(e);
    return i < this.maxEntities && this.alive[i] === 1 && this.gens[i] === entityGen(e);
  }
  destroy(e: Entity): void {
    if (!this.isAlive(e)) return;
    for (const h of this.despawnHooks) h(e, this);
    const i = entityIndex(e);
    for (const s of this.stores) s.remove(i);
    this.alive[i] = 0; this.gens[i] = (this.gens[i]! + 1) & GEN_MASK;
    this.freeList.push(i); this.entityCount--;
  }
  add<S extends Schema>(e: Entity, def: ComponentDef<S>, init?: SchemaInit<S>): this {
    if (!this.isAlive(e)) throw new Error("add on dead entity");
    this.store(def).add(e, entityIndex(e), init); return this;
  }
  remove(e: Entity, def: ComponentDef): this { if (this.isAlive(e)) this.store(def).remove(entityIndex(e)); return this; }
  has(e: Entity, def: ComponentDef): boolean { return this.isAlive(e) && this.store(def).has(entityIndex(e)); }
  /** Copies component into a fresh object (convenience; hot paths should use store().data). */
  get<S extends Schema>(e: Entity, def: ComponentDef<S>): SchemaValues<S> | undefined {
    return this.isAlive(e) ? this.store(def).get(entityIndex(e)) : undefined;
  }
  /** Writes several fields; marks changed. Throws if missing. */
  set<S extends Schema>(e: Entity, def: ComponentDef<S>, values: SchemaInit<S>): void {
    const st = this.store(def); const i = entityIndex(e);
    if (!this.isAlive(e) || !st.has(i)) throw new Error(`set: missing ${def.name}`);
    const s = st.slot(i);
    for (const f of st.fields) { const v = values[f]; if (v !== undefined) st.writeSlot(s, f, v as number | ArrayLike<number>); }
    st.markChanged(i);
  }
  getField<S extends Schema>(e: Entity, def: ComponentDef<S>, field: ScalarField<S>): number | undefined {
    return this.isAlive(e) ? this.store(def).read(entityIndex(e), field) : undefined;
  }
  setField<S extends Schema>(e: Entity, def: ComponentDef<S>, field: ScalarField<S>, value: number): boolean {
    return this.isAlive(e) && this.store(def).write(entityIndex(e), field, value);
  }
  /** Live subarray of an array field; call store(def).markChanged(entityIndex(e)) after mutating, or use setElement. */
  getArray<S extends Schema>(e: Entity, def: ComponentDef<S>, field: ArrayField<S>): TypedArray | undefined {
    return this.isAlive(e) ? this.store(def).array(entityIndex(e), field) : undefined;
  }
  getElement<S extends Schema>(e: Entity, def: ComponentDef<S>, field: ArrayField<S>, i: number): number | undefined {
    return this.isAlive(e) ? this.store(def).readElement(entityIndex(e), field, i) : undefined;
  }
  setElement<S extends Schema>(e: Entity, def: ComponentDef<S>, field: ArrayField<S>, i: number, value: number): boolean {
    return this.isAlive(e) && this.store(def).writeElement(entityIndex(e), field, i, value);
  }
  /** Entities whose component `def` changed this tick (added or written). Cleared at end of step(). */
  *changed(def: ComponentDef): IterableIterator<Entity> {
    const st = this.store(def);
    for (const i of st.changedIndices()) yield st.dense[st.slot(i)]!;
  }
  /**
   * Entities (with the generation they had at removal) that lost `def` this tick via remove() or destroy().
   * A re-add in the same tick still appears here (and in changed()). Cleared by clearChanges()/end of step().
   */
  removed(def: ComponentDef): IterableIterator<Entity> { return this.store(def).removedThisTick.values(); }
  /** Clears dirty bits and removal records for all stores. */
  clearChanges(): void { for (const s of this.stores) s.clearChanged(); }

  /** Iterates entities having all `all` and none of `none`. Drives from the smallest store. Safe to destroy the current entity. */
  *query(all: readonly ComponentDef[], none: readonly ComponentDef[] = []): IterableIterator<Entity> {
    if (all.length === 0) return;
    const inc = all.map((d) => this.store(d)); const exc = none.map((d) => this.store(d));
    const driver = inc.reduce((a, b) => (b.size < a.size ? b : a));
    for (let k = driver.size - 1; k >= 0; k--) {
      const e = driver.dense[k]!; const i = entityIndex(e);
      if (inc.every((s) => s.has(i)) && !exc.some((s) => s.has(i))) yield e;
    }
  }

  // ---- resources (global singletons, e.g. TimeOfDay, Weather) ----
  setResource<T>(key: ResourceKey<T>, value: T): void { this.resources.set(key, value); }
  /** @deprecated for environment components use env(def); passing a ComponentDef returns env(def) if present. */
  getResource<S extends Schema>(key: ComponentDef<S>): SchemaValues<S> | undefined;
  getResource<T>(key: ResourceKey<T>): T | undefined;
  getResource(key: ResourceKey<unknown> | ComponentDef): unknown {
    if ("schema" in key) return this.isAlive(this.environment) && this.has(this.environment, key) ? this.env(key) : undefined;
    return this.resources.get(key);
  }
  /** Passing a ComponentDef is a deprecated alias of env(def). */
  resource<S extends Schema>(key: ComponentDef<S>): SchemaValues<S>;
  resource<T>(key: ResourceKey<T>): T;
  resource(key: ResourceKey<unknown> | ComponentDef): unknown {
    if ("schema" in key) return this.env(key);
    if (!this.resources.has(key)) throw new Error(`Missing resource ${key.name}`);
    return this.resources.get(key);
  }

  // ---- phases & systems ----
  get phases(): readonly Phase[] { return this.phaseOrder; }
  /** Insert a custom named phase after an existing one (default: end, before renderPrep). */
  addPhase(name: string, opts: { after?: Phase } = {}): this {
    if (this.systems.has(name)) return this;
    const at = opts.after !== undefined ? this.phaseOrder.indexOf(opts.after) + 1 : this.phaseOrder.indexOf("renderPrep");
    if (at <= 0 && opts.after !== undefined) throw new Error(`unknown phase ${opts.after}`);
    this.phaseOrder.splice(at, 0, name); this.systems.set(name, []); return this;
  }
  addSystem(phase: Phase, name: string, fn: System, opts: SystemOptions = {}): this {
    const l = this.systems.get(phase); if (!l) throw new Error(`unknown phase ${phase}`);
    const every = opts.every ?? 1; if (!(Number.isInteger(every) && every >= 1)) throw new Error(`addSystem ${name}: every must be a positive integer`);
    const offset = opts.offset ?? (every > 1 ? fnv1a(name) % every : 0);
    l.push({ name, fn, every, offset: ((offset % every) + every) % every }); return this;
  }
  /** Removes a system by name from every phase; returns true if one was removed. */
  removeSystem(name: string): boolean {
    let hit = false; for (const l of this.systems.values()) for (let i = l.length - 1; i >= 0; i--) if (l[i]!.name === name) { l.splice(i, 1); hit = true; }
    return hit;
  }
  /** True if a system with this schedule runs at `tick`. */
  static scheduled(every: number, offset: number, tick: number): boolean { return every <= 1 || (tick + every - offset) % every === 0; }
  private runEntry(s: SystemEntry, dt: number): void { if (World.scheduled(s.every, s.offset, this.tick)) s.fn(this, dt * s.every); }
  /**
   * One fixed tick: snapshot PrevTransform, run every phase except renderPrep in order,
   * flush queued events, clear change bits, tick++.
   */
  step(dt: number): void {
    copyPrevTransforms(this);
    for (const p of this.phaseOrder) if (p !== "renderPrep") this.runPhase(p, dt);
    this.events.flush();
    this.clearChanges();
    this.tick++;
  }
  /** Flattened execution order. */
  systemOrder(): { phase: Phase; name: string; every?: number; offset?: number }[] {
    const out: { phase: Phase; name: string; every?: number; offset?: number }[] = [];
    for (const p of this.phaseOrder) for (const s of this.systems.get(p)!) out.push(s.every > 1 ? { phase: p, name: s.name, every: s.every, offset: s.offset } : { phase: p, name: s.name });
    return out;
  }
  /** Run a single phase's systems once. */
  runPhase(phase: Phase, dt: number): void { for (const s of this.systems.get(phase) ?? []) this.runEntry(s, dt); }
  /**
   * Re-simulation for prediction reconciliation: runs ONLY the simulation phase (optionally only named systems)
   * `ticks` times. For replay i, world.tick = startTick + i; world.tick is restored afterwards.
   * isReplaying is true throughout. Events queued during replay are discarded unless keepEvents.
   * Does not touch change bits, removal records or PrevTransform.
   * The legacy form simulate(ticks, dt, beforeTick) is still accepted.
   */
  simulate(ticks: number, dt: number, opts?: SimulateOptions | ((i: number) => void)): void {
    const o: SimulateOptions = typeof opts === "function" ? { beforeTick: opts } : opts ?? {};
    const saved = this.tick; const q = this.events.queued; const wasReplaying = this.isReplaying;
    const only = o.systems ? new Set(o.systems) : undefined;
    const list = (this.systems.get("simulation") ?? []).filter((s) => !only || only.has(s.name));
    const start = o.startTick ?? Math.max(0, saved - ticks);
    this.isReplaying = true;
    try {
      for (let i = 0; i < ticks; i++) {
        this.tick = start + i;
        o.beforeTick?.(i);
        for (const s of list) this.runEntry(s, dt);
      }
    } finally {
      this.tick = saved; this.isReplaying = wasReplaying;
      if (!o.keepEvents) this.events.truncate(q);
    }
  }
}

function removeFrom<T>(arr: T[], v: T): void { const i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); }

export interface ResourceKey<_T> { readonly name: string }
export const defineResource = <T>(name: string): ResourceKey<T> => ({ name });

export function copyPrevTransforms(w: World): void {
  const t = w.store(Transform); const p = w.store(PrevTransform);
  for (let k = 0; k < t.size; k++) {
    const e = t.dense[k]!; const i = entityIndex(e);
    const s = p.add(e, i);
    p.data.x[s] = t.data.x[k]!; p.data.y[s] = t.data.y[k]!; p.data.z[s] = t.data.z[k]!; p.data.facing[s] = t.data.facing[k]!;
  }
}
