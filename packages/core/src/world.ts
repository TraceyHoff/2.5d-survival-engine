import { ComponentStore, type ComponentDef } from "./component.js";
import { entityGen, entityIndex, makeEntity, MAX_ENTITIES, GEN_MASK, type Entity } from "./entity.js";
import { fnv1a, schemaSignature, type Schema, type SchemaValues } from "./schema.js";
import { BUILTIN_COMPONENTS, PrevTransform, Transform } from "./builtins.js";
import { Rng } from "./rng.js";
import { EventBus } from "./events.js";

/** Built-in phase names; custom phases can be inserted with addPhase(). */
export type BuiltinPhase = "input" | "simulation" | "postSim" | "network" | "renderPrep";
export type Phase = BuiltinPhase | (string & {});
export const PHASES: readonly BuiltinPhase[] = ["input", "simulation", "postSim", "network", "renderPrep"];
export type System = (world: World, dt: number) => void;
export type EntityHook = (entity: Entity, world: World) => void;

export interface WorldOptions { maxEntities?: number; seed?: number; registerBuiltins?: boolean }

export class World {
  readonly maxEntities: number;
  private gens: Uint16Array;
  private alive: Uint8Array;
  private freeList: number[] = [];
  private nextIndex = 0;
  private stores: ComponentStore[] = [];
  private byDef = new Map<ComponentDef, ComponentStore>();
  private phaseOrder: Phase[] = [...PHASES];
  private systems = new Map<Phase, { name: string; fn: System }[]>(PHASES.map((p) => [p, []]));
  private resources = new Map<object, unknown>();
  private spawnHooks: EntityHook[] = [];
  private despawnHooks: EntityHook[] = [];
  readonly rng: Rng;
  readonly events = new EventBus();
  tick = 0;
  entityCount = 0;

  constructor(opts: WorldOptions = {}) {
    this.maxEntities = Math.min(opts.maxEntities ?? 65536, MAX_ENTITIES);
    this.gens = new Uint16Array(this.maxEntities);
    this.alive = new Uint8Array(this.maxEntities);
    this.rng = new Rng(opts.seed ?? 1);
    if (opts.registerBuiltins !== false) for (const c of BUILTIN_COMPONENTS) this.register(c);
  }

  // ---- components ----
  /** Registers a component; id = registration order (must match on client & server). Idempotent. */
  register(def: ComponentDef): number {
    const ex = this.byDef.get(def); if (ex) return ex.id;
    const store = new ComponentStore(this.stores.length, def, this.maxEntities) as unknown as ComponentStore;
    this.stores.push(store); this.byDef.set(def, store);
    return store.id;
  }
  store<S extends Schema>(def: ComponentDef<S>): ComponentStore<S> {
    const s = this.byDef.get(def as ComponentDef);
    if (!s) throw new Error(`Component not registered: ${def.name}`);
    return s as unknown as ComponentStore<S>;
  }
  componentId(def: ComponentDef): number { return this.store(def).id; }
  storeById(id: number): ComponentStore | undefined { return this.stores[id]; }
  get componentStores(): readonly ComponentStore[] { return this.stores; }
  /** Deterministic hash over registration order: id, name, networked flag, schema signature (incl. quant hints). */
  getSchemaHash(): number {
    let h = 0x811c9dc5;
    for (const s of this.stores) h = fnv1a(`${s.id}|${s.def.name}|${s.def.networked ? 1 : 0}|${schemaSignature(s.def.schema)}\n`, h);
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
  add<S extends Schema>(e: Entity, def: ComponentDef<S>, init?: Partial<SchemaValues<S>>): this {
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
  set<S extends Schema>(e: Entity, def: ComponentDef<S>, values: Partial<SchemaValues<S>>): void {
    const st = this.store(def); const i = entityIndex(e);
    if (!this.isAlive(e) || !st.has(i)) throw new Error(`set: missing ${def.name}`);
    for (const f of st.fields) { const v = values[f]; if (v !== undefined) st.write(i, f, v); }
  }
  getField<S extends Schema>(e: Entity, def: ComponentDef<S>, field: keyof S & string): number | undefined {
    return this.isAlive(e) ? this.store(def).read(entityIndex(e), field) : undefined;
  }
  setField<S extends Schema>(e: Entity, def: ComponentDef<S>, field: keyof S & string, value: number): boolean {
    return this.isAlive(e) && this.store(def).write(entityIndex(e), field, value);
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
  getResource<T>(key: ResourceKey<T>): T | undefined { return this.resources.get(key) as T | undefined; }
  resource<T>(key: ResourceKey<T>): T {
    if (!this.resources.has(key)) throw new Error(`Missing resource ${key.name}`);
    return this.resources.get(key) as T;
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
  addSystem(phase: Phase, name: string, fn: System): this {
    const l = this.systems.get(phase); if (!l) throw new Error(`unknown phase ${phase}`);
    l.push({ name, fn }); return this;
  }
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
  /** Run a single phase's systems once. */
  runPhase(phase: Phase, dt: number): void { for (const s of this.systems.get(phase) ?? []) s.fn(this, dt); }
  /**
   * Re-simulation for prediction reconciliation: runs ONLY the simulation phase `ticks` times.
   * `beforeTick(i)` lets the caller apply buffered input for each replayed tick.
   * Does not touch world.tick, events, change bits, or PrevTransform.
   */
  simulate(ticks: number, dt: number, beforeTick?: (i: number) => void): void {
    for (let i = 0; i < ticks; i++) { beforeTick?.(i); this.runPhase("simulation", dt); }
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
