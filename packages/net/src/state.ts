import {
  dequantize, entityIndex, fieldQuant, fieldType, NetId, quantize, wireValue,
  type ComponentDef, type ComponentStore, type FieldSpec, type World,
} from "@engine/core";
import type { BitReader, BitWriter } from "./bits.js";

/** Wire values (quantized ints / f32-rounded floats) of one component, in core's sorted field order. */
export type CompValues = readonly number[];
/** Replicated state of one entity: schema component index -> wire values. Treated as immutable once built. */
export type EntityState = ReadonlyMap<number, CompValues>;
/** Replicated world state at one tick: netId -> entity state. */
export type WorldState = ReadonlyMap<number, EntityState>;

/** Replicated component list shared by client and server: networked stores except NetId, ascending id. */
export class NetSchema {
  readonly stores: ComponentStore[];
  readonly specs: FieldSpec[][];
  private readonly indexById = new Map<number, number>();
  constructor(world: World) {
    const netIdStore = world.store(NetId) as unknown as ComponentStore;
    this.stores = world.componentStores.filter((s) => s.def.networked && s !== netIdStore);
    this.specs = this.stores.map((s) => s.fields.map((f) => s.def.schema[f]!));
    this.stores.forEach((s, i) => this.indexById.set(s.id, i));
  }
  get count(): number { return this.stores.length; }
  indexOf(def: ComponentDef, world: World): number | undefined { return this.indexById.get(world.componentId(def)); }
}

export function toWire(spec: FieldSpec, v: number): number {
  const q = fieldQuant(spec);
  if (q) return quantize(v, q);
  return fieldType(spec) === "f32" ? Math.fround(v) : v;
}
export function fromWire(spec: FieldSpec, v: number): number { const q = fieldQuant(spec); return q ? dequantize(v, q) : v; }
function writeWire(w: BitWriter, spec: FieldSpec, v: number): void { const q = fieldQuant(spec); if (q) w.writeBits(v, q.bits); else w.write(fieldType(spec), v); }
function readWire(r: BitReader, spec: FieldSpec): number { const q = fieldQuant(spec); return q ? r.readBits(q.bits) : r.read(fieldType(spec)); }

/**
 * Server: capture replicated state of every entity that has a NetId. Entities with no change bit
 * and no removal this tick reuse the previous tick's (immutable) EntityState, so cost scales with churn.
 * Must run before world.step() clears change/removal tracking (i.e. in the network phase).
 */
export function captureState(world: World, schema: NetSchema, prev: WorldState | undefined): Map<number, EntityState> {
  const ns = world.store(NetId);
  const touched = new Set<number>();
  for (const st of schema.stores) for (const e of world.removed(st.def)) touched.add(entityIndex(e));
  const out = new Map<number, EntityState>();
  for (let k = 0; k < ns.size; k++) {
    const index = entityIndex(ns.dense[k]!); const netId = ns.data.id[k]!;
    const old = prev?.get(netId);
    if (old && !ns.isChanged(index) && !touched.has(index) && !schema.stores.some((s) => s.isChanged(index))) { out.set(netId, old); continue; }
    const es = new Map<number, CompValues>();
    schema.stores.forEach((st, ci) => {
      if (!st.has(index)) return;
      const slot = st.slot(index);
      es.set(ci, st.fields.map((f) => wireValue(st, f, slot).value).map((v, i) => (fieldType(schema.specs[ci]![i]!) === "f32" && !fieldQuant(schema.specs[ci]![i]!) ? Math.fround(v) : v)));
    });
    out.set(netId, es);
  }
  return out;
}

export interface DeltaStats { spawns: number; despawns: number; changes: number }

/**
 * Delta body (bit-packed), against `base` (undefined = full snapshot):
 *   varuint nSpawn, { varuint netId, compMask[nComp], all fields of each present comp }
 *   varuint nDespawn, { varuint netId }
 *   varuint nChange, { varuint netId, changedMask[nComp], removedMask[nComp],
 *                      per changed comp: bit full ? all fields : fieldMask[nFields] + changed fields }
 */
export function encodeDelta(w: BitWriter, schema: NetSchema, cur: WorldState, base: WorldState | undefined): DeltaStats {
  const n = schema.count;
  const spawns: number[] = []; const despawns: number[] = [];
  const changes: { netId: number; changed: number[]; removed: number[] }[] = [];
  for (const [netId, es] of cur) {
    const old = base?.get(netId);
    if (!old) { spawns.push(netId); continue; }
    if (old === es) continue;
    const changed: number[] = []; const removed: number[] = [];
    for (let ci = 0; ci < n; ci++) {
      const a = old.get(ci); const b = es.get(ci);
      if (a && !b) removed.push(ci);
      else if (b && (!a || b.some((v, i) => v !== a[i]))) changed.push(ci);
    }
    if (changed.length || removed.length) changes.push({ netId, changed, removed });
  }
  if (base) for (const netId of base.keys()) if (!cur.has(netId)) despawns.push(netId);

  w.writeVarUint(spawns.length);
  for (const netId of spawns) {
    const es = cur.get(netId)!; w.writeVarUint(netId);
    for (let ci = 0; ci < n; ci++) w.writeBool(es.has(ci));
    for (let ci = 0; ci < n; ci++) { const v = es.get(ci); if (v) schema.specs[ci]!.forEach((s, i) => writeWire(w, s, v[i]!)); }
  }
  w.writeVarUint(despawns.length);
  for (const netId of despawns) w.writeVarUint(netId);
  w.writeVarUint(changes.length);
  for (const c of changes) {
    const es = cur.get(c.netId)!; const old = base!.get(c.netId)!;
    w.writeVarUint(c.netId);
    for (let ci = 0; ci < n; ci++) w.writeBool(c.changed.includes(ci));
    for (let ci = 0; ci < n; ci++) w.writeBool(c.removed.includes(ci));
    for (const ci of c.changed) {
      const v = es.get(ci)!; const a = old.get(ci); const specs = schema.specs[ci]!;
      w.writeBool(!a);
      if (!a) { specs.forEach((s, i) => writeWire(w, s, v[i]!)); continue; }
      for (let i = 0; i < specs.length; i++) w.writeBool(v[i] !== a[i]);
      for (let i = 0; i < specs.length; i++) if (v[i] !== a[i]) writeWire(w, specs[i]!, v[i]!);
    }
  }
  return { spawns: spawns.length, despawns: despawns.length, changes: changes.length };
}

export interface DecodedDelta {
  state: Map<number, EntityState>;
  spawned: number[];
  despawned: number[];
  /** netId -> component indices changed/added, and removed */
  changed: Map<number, { changed: number[]; removed: number[] }>;
}

export function decodeDelta(r: BitReader, schema: NetSchema, base: WorldState | undefined): DecodedDelta {
  const n = schema.count;
  const state = new Map<number, EntityState>(base ?? []);
  const spawned: number[] = []; const despawned: number[] = [];
  const changed = new Map<number, { changed: number[]; removed: number[] }>();
  const readAll = (ci: number): number[] => schema.specs[ci]!.map((s) => readWire(r, s));
  const ns = r.readVarUint();
  for (let k = 0; k < ns; k++) {
    const netId = r.readVarUint(); const present: number[] = [];
    for (let ci = 0; ci < n; ci++) if (r.readBool()) present.push(ci);
    const es = new Map<number, CompValues>(); for (const ci of present) es.set(ci, readAll(ci));
    state.set(netId, es); spawned.push(netId);
  }
  const nd = r.readVarUint();
  for (let k = 0; k < nd; k++) { const netId = r.readVarUint(); state.delete(netId); despawned.push(netId); }
  const nc = r.readVarUint();
  for (let k = 0; k < nc; k++) {
    const netId = r.readVarUint();
    const ch: number[] = []; const rm: number[] = [];
    for (let ci = 0; ci < n; ci++) if (r.readBool()) ch.push(ci);
    for (let ci = 0; ci < n; ci++) if (r.readBool()) rm.push(ci);
    const old = state.get(netId);
    if (!old) throw new Error(`delta references unknown netId ${netId}`);
    const es = new Map(old);
    for (const ci of rm) es.delete(ci);
    for (const ci of ch) {
      if (r.readBool()) { es.set(ci, readAll(ci)); continue; }
      const prev = old.get(ci); if (!prev) throw new Error(`field delta for absent component ${ci}`);
      const specs = schema.specs[ci]!; const mask = specs.map(() => r.readBool());
      const v = [...prev]; mask.forEach((m, i) => { if (m) v[i] = readWire(r, specs[i]!); });
      es.set(ci, v);
    }
    state.set(netId, es); changed.set(netId, { changed: ch, removed: rm });
  }
  return { state, spawned, despawned, changed };
}
