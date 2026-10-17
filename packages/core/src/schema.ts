/** Field types for plain-data components. All numeric; no strings (use numeric ids). */
export type FieldType = "f32" | "f64" | "i8" | "i16" | "i32" | "u8" | "u16" | "u32";
/** Network quantization hint: value clamped to [min,max] and packed into `bits` bits on the wire. Sim keeps full precision. */
export interface QuantHint { bits: number; min: number; max: number }
export type FieldSpec = FieldType | { type: FieldType; quant?: QuantHint };
export type Schema = Record<string, FieldSpec>;
export type SchemaValues<S extends Schema> = { [K in keyof S]: number };

export const ArrayCtor = {
  f32: Float32Array, f64: Float64Array, i8: Int8Array, i16: Int16Array,
  i32: Int32Array, u8: Uint8Array, u16: Uint16Array, u32: Uint32Array,
} as const;
export const FieldSize: Record<FieldType, number> = { f32: 4, f64: 8, i8: 1, i16: 2, i32: 4, u8: 1, u16: 2, u32: 4 };
export type TypedArray = InstanceType<(typeof ArrayCtor)[FieldType]>;

export const fieldType = (f: FieldSpec): FieldType => (typeof f === "string" ? f : f.type);
export const fieldQuant = (f: FieldSpec): QuantHint | undefined => (typeof f === "string" ? undefined : f.quant);

/** Stable field order: sorted keys, so encoding never depends on object literal order. */
export function schemaFields<S extends Schema>(s: S): (keyof S & string)[] {
  return (Object.keys(s) as (keyof S & string)[]).sort();
}
export function schemaByteSize(s: Schema): number {
  return schemaFields(s).reduce((n, k) => n + FieldSize[fieldType(s[k]!)], 0);
}
/** Canonical string of a schema (field order, types, quant hints) used for hashing. */
export function schemaSignature(s: Schema): string {
  return schemaFields(s).map((k) => {
    const f = s[k]!; const q = fieldQuant(f);
    return `${k}:${fieldType(f)}${q ? `[${q.bits},${q.min},${q.max}]` : ""}`;
  }).join(";");
}
export function fnv1a(str: string, h = 0x811c9dc5): number {
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
