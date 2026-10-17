import { FieldSize, fieldLength, fieldQuant, fieldType, isArrayField, fnv1a, schemaFields, schemaSignature, type FieldType, type QuantHint, type Schema, type SchemaValues } from "./schema.js";
import type { ComponentStore } from "./component.js";
import type { World } from "./world.js";
import { entityIndex } from "./entity.js";

/** Little-endian growable binary writer/reader. */
export class BinaryWriter {
  private buf: ArrayBuffer; private view: DataView; offset = 0;
  constructor(cap = 256) { this.buf = new ArrayBuffer(cap); this.view = new DataView(this.buf); }
  private ensure(n: number): void {
    if (this.offset + n <= this.buf.byteLength) return;
    let c = this.buf.byteLength * 2; while (c < this.offset + n) c *= 2;
    const nb = new ArrayBuffer(c); new Uint8Array(nb).set(new Uint8Array(this.buf, 0, this.offset));
    this.buf = nb; this.view = new DataView(nb);
  }
  write(t: FieldType, v: number): void {
    this.ensure(FieldSize[t]); const o = this.offset, d = this.view;
    switch (t) {
      case "f32": d.setFloat32(o, v, true); break; case "f64": d.setFloat64(o, v, true); break;
      case "i8": d.setInt8(o, v); break; case "u8": d.setUint8(o, v); break;
      case "i16": d.setInt16(o, v, true); break; case "u16": d.setUint16(o, v, true); break;
      case "i32": d.setInt32(o, v, true); break; case "u32": d.setUint32(o, v, true); break;
    }
    this.offset += FieldSize[t];
  }
  finish(): Uint8Array { return new Uint8Array(this.buf.slice(0, this.offset)); }
}
export class BinaryReader {
  private view: DataView; offset = 0;
  constructor(bytes: Uint8Array) { this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
  get remaining(): number { return this.view.byteLength - this.offset; }
  read(t: FieldType): number {
    if (this.remaining < FieldSize[t]) throw new RangeError("BinaryReader: out of data");
    const o = this.offset, d = this.view; let v: number;
    switch (t) {
      case "f32": v = d.getFloat32(o, true); break; case "f64": v = d.getFloat64(o, true); break;
      case "i8": v = d.getInt8(o); break; case "u8": v = d.getUint8(o); break;
      case "i16": v = d.getInt16(o, true); break; case "u16": v = d.getUint16(o, true); break;
      case "i32": v = d.getInt32(o, true); break; default: v = d.getUint32(o, true);
    }
    this.offset += FieldSize[t]; return v;
  }
}

/** Hash of a single component schema (field names, types, quant hints). */
export function schemaHash(s: Schema): number { return fnv1a(schemaSignature(s)); }

/** Abstract sink/source so net can wrap a BitWriter/BitReader around the same field codecs. */
export interface FieldWriter { write(t: FieldType, v: number): void }
export interface FieldReader { read(t: FieldType): number }

/** Quantize to an unsigned integer in [0, 2^bits-1] (clamped). bits <= 32. */
export function quantize(v: number, q: QuantHint): number {
  const maxI = q.bits >= 32 ? 0xffffffff : (1 << q.bits) - 1 >>> 0;
  const t = (Math.min(Math.max(v, q.min), q.max) - q.min) / (q.max - q.min);
  return Math.round(t * maxI) >>> 0;
}
export function dequantize(i: number, q: QuantHint): number {
  const maxI = q.bits >= 32 ? 0xffffffff : (1 << q.bits) - 1 >>> 0;
  return q.min + (i / maxI) * (q.max - q.min);
}
/** Full-precision per-field encode of store field at dense `slot`. */
export function encodeField(store: ComponentStore, field: string, slot: number, w: FieldWriter): void {
  const t = fieldType(store.def.schema[field]!); const n = store.lengths[field]!; const a = store.data[field]!;
  for (let i = 0; i < n; i++) w.write(t, a[slot * n + i]!);
}
/** Full-precision per-field decode into store field at dense `slot`. */
export function decodeField(store: ComponentStore, field: string, slot: number, r: FieldReader): void {
  const t = fieldType(store.def.schema[field]!); const n = store.lengths[field]!; const a = store.data[field]!;
  for (let i = 0; i < n; i++) a[slot * n + i] = r.read(t);
}
/**
 * Value as it should go on the wire: if the field has a quant hint, returns the quantized
 * integer (caller writes it with `hint.bits` bits); otherwise the raw value. Never mutates sim state.
 */
export function wireValue(store: ComponentStore, field: string, slot: number, element = 0): { value: number; quant?: QuantHint; type: FieldType } {
  const spec = store.def.schema[field]!; const q = fieldQuant(spec); const v = store.data[field]![slot * fieldLength(spec) + element]!;
  return q ? { value: quantize(v, q), quant: q, type: fieldType(spec) } : { value: v, type: fieldType(spec) };
}
export function writeRecord<S extends Schema>(w: FieldWriter, s: S, v: SchemaValues<S>): void {
  for (const k of schemaFields(s)) {
    const f = s[k]!; const t = fieldType(f); const val = v[k] as number | ArrayLike<number>;
    if (isArrayField(f)) { const n = fieldLength(f); for (let i = 0; i < n; i++) w.write(t, (val as ArrayLike<number>)[i] ?? 0); }
    else w.write(t, val as number);
  }
}
export function readRecord<S extends Schema>(r: FieldReader, s: S): SchemaValues<S> {
  const o = {} as Record<string, number | number[]>;
  for (const k of schemaFields(s)) {
    const f = s[k]!; const t = fieldType(f);
    if (isArrayField(f)) { const arr: number[] = []; for (let i = 0; i < fieldLength(f); i++) arr.push(r.read(t)); o[k] = arr; } else o[k] = r.read(t);
  }
  return o as SchemaValues<S>;
}

export const SNAPSHOT_MAGIC = 0x534e4150; // "SNAP"
export const SNAPSHOT_VERSION = 1;

/**
 * Snapshot format v1 (LE):
 * u32 magic, u16 version, u32 tick, u32 worldSchemaHash, u16 componentCount,
 *   per component: u16 id, u32 schemaHash, u32 count, then count x (u32 entity, record)
 * Only `networked` components are written unless `all` is set.
 */
export function encodeSnapshot(world: World, opts: { all?: boolean } = {}): Uint8Array {
  const w = new BinaryWriter(1024);
  w.write("u32", SNAPSHOT_MAGIC); w.write("u16", SNAPSHOT_VERSION); w.write("u32", world.tick); w.write("u32", world.getSchemaHash());
  const stores = world.componentStores.filter((s) => opts.all || s.def.networked);
  w.write("u16", stores.length);
  for (const st of stores) {
    w.write("u16", st.id); w.write("u32", schemaHash(st.def.schema)); w.write("u32", st.size);
    for (let k = 0; k < st.size; k++) {
      w.write("u32", st.dense[k]!);
      for (const f of st.fields) encodeField(st, f, k, w);
    }
  }
  return w.finish();
}
export interface DecodedSnapshot { version: number; tick: number; components: Map<number, { entity: number; values: Record<string, number | number[]> }[]> }
export function decodeSnapshot(world: World, bytes: Uint8Array): DecodedSnapshot {
  const r = new BinaryReader(bytes);
  if (r.read("u32") !== SNAPSHOT_MAGIC) throw new Error("bad snapshot magic");
  const version = r.read("u16");
  if (version > SNAPSHOT_VERSION) throw new Error(`unsupported snapshot version ${version}`);
  const tick = r.read("u32");
  if (r.read("u32") !== world.getSchemaHash()) throw new Error("world schema hash mismatch");
  const n = r.read("u16");
  const components: DecodedSnapshot["components"] = new Map();
  for (let c = 0; c < n; c++) {
    const id = r.read("u16"); const hash = r.read("u32"); const count = r.read("u32");
    const st = world.storeById(id);
    if (!st || schemaHash(st.def.schema) !== hash) throw new Error(`schema mismatch for component id ${id}`);
    const list: { entity: number; values: Record<string, number | number[]> }[] = [];
    for (let i = 0; i < count; i++) list.push({ entity: r.read("u32"), values: readRecord(r, st.def.schema) as Record<string, number | number[]> });
    components.set(id, list);
  }
  return { version, tick, components };
}
/** Applies a decoded snapshot onto a world whose entity indices mirror the source (e.g. save/load, tests). */
export function applySnapshot(world: World, snap: DecodedSnapshot): void {
  for (const [id, list] of snap.components) {
    const st = world.storeById(id)!;
    for (const { entity, values } of list) st.add(entity, entityIndex(entity), values as never);
  }
  world.tick = snap.tick;
}
