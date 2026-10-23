import { fieldLength, fieldType, schemaHash, type ComponentStore, type FieldType, type Schema, type World } from "@engine/core";
import { CHUNK_AREA } from "@engine/world";

/**
 * Schema migration "fields added since": a save written before `fields` existed on component `component` (by
 * name) carries the schema hash of the current schema minus those fields. Persist then decodes it with that old
 * layout and fills the added fields with 0 (every element). Field order is the schema's key order, so added
 * fields may sit anywhere; the rest must keep their order and types.
 */
export interface AddedFields { component: string; fields: readonly string[] }
/** core Slot.crafterId on gameplay's slot containers (4b8b28d): 0 = no crafter. */
export const CRAFTER_ID_MIGRATIONS: readonly AddedFields[] = [
  { component: "Inventory", fields: ["crafterId"] },
  { component: "Container", fields: ["crafterId"] },
];
export const DEFAULT_MIGRATIONS: readonly AddedFields[] = CRAFTER_ID_MIGRATIONS;

const BYTES: Record<FieldType, number> = { f32: 4, f64: 8, i8: 1, u8: 1, i16: 2, u16: 2, i32: 4, u32: 4 };
export const oldSchemaOf = (s: Schema, added: readonly string[]): Schema =>
  Object.fromEntries(Object.entries(s).filter(([k]) => !added.includes(k))) as Schema;
/** Per field of the CURRENT schema: [byteSize, isAdded]. */
export interface FieldPlan { fields: { bytes: number; added: boolean }[]; oldSize: number; newSize: number }
/** The migration that explains stored hash `h` for `store`, if any. */
export function planFor(store: ComponentStore, h: number, migrations: readonly AddedFields[]): FieldPlan | undefined {
  for (const m of migrations) {
    if (m.component !== store.def.name || !m.fields.some((f) => f in store.def.schema)) continue;
    if (schemaHash(oldSchemaOf(store.def.schema, m.fields)) !== h) continue;
    const fields = store.fields.map((f) => { const spec = store.def.schema[f]!; return { bytes: BYTES[fieldType(spec)] * fieldLength(spec), added: m.fields.includes(f) }; });
    let oldSize = 0, newSize = 0; for (const f of fields) { newSize += f.bytes; if (!f.added) oldSize += f.bytes; }
    return { fields, oldSize, newSize };
  }
  return undefined;
}
/** Old-layout record bytes -> current-layout bytes (added fields zero). */
export function upgradeRecord(plan: FieldPlan, src: Uint8Array, at: number, out: Uint8Array, to: number): void {
  let i = at, o = to;
  for (const f of plan.fields) { if (!f.added) out.set(src.subarray(i, i + f.bytes), o), (i += f.bytes); o += f.bytes; }
}

/**
 * Rewrites a chunk row (world chunk format v1) whose component table has hashes explained by `migrations` into the
 * current layout so world's decodeChunk accepts it. Returns undefined when nothing needs migrating (or the row is
 * not understood: decodeChunk then reports the real error). Pure byte rewrite; world/core are untouched.
 */
export function migrateChunkBytes(world: World, bytes: Uint8Array, migrations: readonly AddedFields[] = DEFAULT_MIGRATIONS): Uint8Array | undefined {
  if (!migrations.length || bytes.length < 16) return undefined;
  const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    let o = 14; const runs = d.getUint16(o, true); o += 2 + runs * 4 + CHUNK_AREA;
    const nb = d.getUint16(o, true); o += 2 + nb * 10;
    const tableAt = o; const nc = d.getUint8(o); o += 1;
    const sizes: number[] = []; const plans: (FieldPlan | undefined)[] = []; let any = false;
    for (let k = 0; k < nc; k++) {
      const id = d.getUint16(o, true), h = d.getUint32(o + 2, true); o += 6;
      const st = world.storeById(id); if (!st) return undefined;
      const plan = schemaHash(st.def.schema) === h ? undefined : planFor(st, h, migrations);
      if (!plan && schemaHash(st.def.schema) !== h) return undefined;
      plans.push(plan); if (plan) any = true;
      sizes.push(plan ? plan.oldSize : st.fields.reduce((n, f) => n + BYTES[fieldType(st.def.schema[f]!)] * fieldLength(st.def.schema[f]!), 0));
    }
    if (!any) return undefined;
    // Pass 1: size of the rewritten entity section.
    const entAt = o; const ne = d.getUint32(o, true); o += 4; let grow = 0;
    for (let k = 0; k < ne; k++) {
      const cc = d.getUint8(o); o += 1;
      for (let c = 0; c < cc; c++) { const t = d.getUint8(o); o += 1; const p = plans[t]; if (sizes[t] === undefined) return undefined; o += sizes[t]!; if (p) grow += p.newSize - p.oldSize; }
    }
    if (o !== bytes.length) return undefined;
    const out = new Uint8Array(bytes.length + grow); out.set(bytes.subarray(0, entAt));
    const od = new DataView(out.buffer);
    for (let k = 0; k < nc; k++) { const p = plans[k]; if (p) { const id = d.getUint16(tableAt + 1 + k * 6, true); od.setUint32(tableAt + 1 + k * 6 + 2, schemaHash(world.storeById(id)!.def.schema), true); } }
    // Pass 2: copy entities, widening migrated records.
    let i = entAt + 4, w = entAt + 4; od.setUint32(entAt, ne, true);
    for (let k = 0; k < ne; k++) {
      const cc = d.getUint8(i); out[w++] = cc; i++;
      for (let c = 0; c < cc; c++) {
        const t = d.getUint8(i); out[w++] = t; i++; const p = plans[t];
        if (p) { upgradeRecord(p, bytes, i, out, w); i += p.oldSize; w += p.newSize; }
        else { out.set(bytes.subarray(i, i + sizes[t]!), w); i += sizes[t]!; w += sizes[t]!; }
      }
    }
    return out;
  } catch { return undefined; }
}
