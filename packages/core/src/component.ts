import { ArrayCtor, fieldType, schemaFields, type Schema, type SchemaValues, type TypedArray } from "./schema.js";

export interface ComponentDef<S extends Schema = Schema> {
  readonly name: string;
  readonly schema: S;
  readonly networked: boolean;
}
export function defineComponent<S extends Schema>(name: string, schema: S, opts: { networked?: boolean } = {}): ComponentDef<S> {
  return { name, schema, networked: opts.networked ?? false };
}

/** Sparse-set SoA store: dense typed arrays per field, sparse index -> dense slot. */
export class ComponentStore<S extends Schema = Schema> {
  readonly fields: (keyof S & string)[];
  readonly data: { [K in keyof S]: TypedArray };
  readonly sparse: Int32Array;
  dense: Uint32Array; // entity ids
  size = 0;
  /** Per-tick change bitset over entity index (bit set on add / write / markChanged). */
  readonly dirty: Uint32Array;
  private cap: number;
  constructor(readonly id: number, readonly def: ComponentDef<S>, maxEntities: number, initialCap = 64) {
    this.fields = schemaFields(def.schema);
    this.sparse = new Int32Array(maxEntities).fill(-1);
    this.dirty = new Uint32Array((maxEntities + 31) >>> 5);
    this.cap = initialCap;
    this.dense = new Uint32Array(initialCap);
    const d: Record<string, TypedArray> = {};
    for (const f of this.fields) d[f] = new ArrayCtor[fieldType(def.schema[f]!)](initialCap);
    this.data = d as { [K in keyof S]: TypedArray };
  }
  has(index: number): boolean { return this.sparse[index]! >= 0; }
  slot(index: number): number { return this.sparse[index]!; }
  private grow(): void {
    this.cap *= 2;
    const nd = new Uint32Array(this.cap); nd.set(this.dense); this.dense = nd;
    for (const f of this.fields) {
      const old = this.data[f]; const n = new ArrayCtor[fieldType(this.def.schema[f]!)](this.cap);
      n.set(old as never); (this.data as Record<string, TypedArray>)[f] = n;
    }
  }
  add(entity: number, index: number, init?: Partial<SchemaValues<S>>): number {
    let s = this.sparse[index]!;
    if (s < 0) {
      if (this.size === this.cap) this.grow();
      s = this.size++;
      this.sparse[index] = s; this.dense[s] = entity;
      for (const f of this.fields) this.data[f][s] = 0;
    }
    this.markChanged(index);
    if (init) for (const f of this.fields) { const v = init[f]; if (v !== undefined) this.data[f][s] = v; }
    return s;
  }
  markChanged(index: number): void { const w = index >>> 5; this.dirty[w] = this.dirty[w]! | (1 << (index & 31)); }
  isChanged(index: number): boolean { return (this.dirty[index >>> 5]! & (1 << (index & 31))) !== 0; }
  /** Entity ids (with generation at removal time) that lost this component this tick; insertion-ordered, deduped. */
  readonly removedThisTick = new Set<number>();
  clearChanged(): void { this.dirty.fill(0); this.removedThisTick.clear(); }
  /** Entity indices whose bit is set and still have this component, ascending. */
  *changedIndices(): IterableIterator<number> {
    const d = this.dirty;
    for (let w = 0; w < d.length; w++) {
      let bits = d[w]!;
      while (bits !== 0) {
        const b = 31 - Math.clz32(bits & -bits); bits &= bits - 1;
        const i = (w << 5) | b; if (this.sparse[i]! >= 0) yield i;
      }
    }
  }
  /** Read a field by entity index (undefined if absent). */
  read(index: number, field: keyof S & string): number | undefined {
    const s = this.sparse[index]!; return s < 0 ? undefined : this.data[field][s];
  }
  /** Write a field by entity index; marks changed. Returns false if absent. */
  write(index: number, field: keyof S & string, value: number): boolean {
    const s = this.sparse[index]!; if (s < 0) return false;
    this.data[field][s] = value; this.markChanged(index); return true;
  }
  remove(index: number): void {
    const s = this.sparse[index]!; if (s < 0) return;
    this.removedThisTick.add(this.dense[s]!);
    const last = --this.size;
    if (s !== last) {
      const moved = this.dense[last]!;
      this.dense[s] = moved;
      for (const f of this.fields) this.data[f][s] = this.data[f][last]!;
      this.sparse[moved & ((1 << 20) - 1)] = s;
    }
    this.sparse[index] = -1;
  }
  get(index: number): SchemaValues<S> | undefined {
    const s = this.sparse[index]!; if (s < 0) return undefined;
    const o = {} as Record<string, number>;
    for (const f of this.fields) o[f] = this.data[f][s]!;
    return o as SchemaValues<S>;
  }
}
