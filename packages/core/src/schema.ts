/** Field types for plain-data components. All numeric; no strings (use numeric ids). */
export type FieldType = "f32" | "f64" | "i8" | "i16" | "i32" | "u8" | "u16" | "u32";
/** Network quantization hint: value clamped to [min,max] and packed into `bits` bits on the wire. Sim keeps full precision. */
export interface QuantHint { bits: number; min: number; max: number }
/** Scalar type name, or object form with optional quant hint, fixed array length and default value. */
export type FieldSpec = FieldType | { type: FieldType; quant?: QuantHint; length?: number; default?: number };
export type Schema = Record<string, FieldSpec>;
/** Array fields (`{type, length}`) are number[] in value objects; scalars are number. */
export type FieldValue<F> = F extends { length: number; type: FieldType } ? number[] : number;
export type SchemaValues<S extends Schema> = { [K in keyof S]: FieldValue<S[K]> };
/** Init / partial write values: arrays accept any ArrayLike. */
export type SchemaInit<S extends Schema> = { [K in keyof S]?: S[K] extends { length: number; type: FieldType } ? ArrayLike<number> : number };
/** Field names whose spec is scalar / array. */
export type ScalarField<S extends Schema> = { [K in keyof S]: S[K] extends { length: number; type: FieldType } ? never : K }[keyof S] & string;
export type ArrayField<S extends Schema> = { [K in keyof S]: S[K] extends { length: number; type: FieldType } ? K : never }[keyof S] & string;

export const ArrayCtor = {
  f32: Float32Array, f64: Float64Array, i8: Int8Array, i16: Int16Array,
  i32: Int32Array, u8: Uint8Array, u16: Uint16Array, u32: Uint32Array,
} as const;
export const FieldSize: Record<FieldType, number> = { f32: 4, f64: 8, i8: 1, i16: 2, i32: 4, u8: 1, u16: 2, u32: 4 };
export type TypedArray = InstanceType<(typeof ArrayCtor)[FieldType]>;

export const fieldType = (f: FieldSpec): FieldType => (typeof f === "string" ? f : f.type);
export const fieldQuant = (f: FieldSpec): QuantHint | undefined => (typeof f === "string" ? undefined : f.quant);
/** Element count: 1 for scalars, `length` for array fields. */
export const fieldLength = (f: FieldSpec): number => (typeof f === "string" ? 1 : f.length ?? 1);
export const isArrayField = (f: FieldSpec): boolean => typeof f !== "string" && f.length !== undefined;
export const fieldDefault = (f: FieldSpec): number => (typeof f === "string" ? 0 : f.default ?? 0);

/** Stable field order: sorted keys, so encoding never depends on object literal order. */
export function schemaFields<S extends Schema>(s: S): (keyof S & string)[] {
  return (Object.keys(s) as (keyof S & string)[]).sort();
}
export function schemaByteSize(s: Schema): number {
  return schemaFields(s).reduce((n, k) => n + FieldSize[fieldType(s[k]!)] * fieldLength(s[k]!), 0);
}
/** Canonical string of a schema (field order, types, quant hints) used for hashing. */
export function schemaSignature(s: Schema): string {
  return schemaFields(s).map((k) => {
    const f = s[k]!; const q = fieldQuant(f);
    const len = isArrayField(f) ? `x${fieldLength(f)}` : ""; const d = fieldDefault(f);
    return `${k}:${fieldType(f)}${len}${q ? `[${q.bits},${q.min},${q.max}]` : ""}${d ? `=${d}` : ""}`;
  }).join(";");
}
export function fnv1a(str: string, h = 0x811c9dc5): number {
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
