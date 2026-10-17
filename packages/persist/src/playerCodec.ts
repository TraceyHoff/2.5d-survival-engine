import { BinaryReader, BinaryWriter, decodeField, encodeField, entityIndex, NetId, Owner, PrevTransform, schemaHash, type ComponentDef, type Entity, type World } from "@engine/core";

export const PLAYER_MAGIC = 0x52594c50; // "PLYR"
export const PLAYER_VERSION = 1;
/** Never saved with a player: wire identity, session ownership and per-tick render state. */
export const PLAYER_ALWAYS_EXCLUDED: readonly ComponentDef[] = [NetId, Owner, PrevTransform];

export interface PlayerCodecOptions {
  /** Extra components not to save/restore (transient per-tick state such as input intents). */
  exclude?: readonly ComponentDef[];
}

/**
 * Player record v1 (LE). Components are keyed by NAME (not registration id) and carry their schema hash and byte
 * length, so a save survives component reordering and unknown/changed components are skipped instead of failing:
 *   u32 magic, u16 version, u8 n, n x (u8 nameLen, name bytes, u32 schemaHash, u32 byteLen, fields...)
 * Positions are absolute f32 tile units (see ADR-033; rebasing applies beyond F32_SAFE_TILE_RANGE).
 */
export function encodePlayer(world: World, e: Entity, opts: PlayerCodecOptions = {}): Uint8Array {
  const skip = new Set<ComponentDef>([...PLAYER_ALWAYS_EXCLUDED, ...(opts.exclude ?? [])]);
  const i = entityIndex(e); const w = new BinaryWriter(512);
  const stores = world.componentStores.filter((s) => s.has(i) && !skip.has(s.def as ComponentDef));
  w.write("u32", PLAYER_MAGIC); w.write("u16", PLAYER_VERSION); w.write("u8", stores.length);
  for (const s of stores) {
    const name = s.def.name; if (name.length > 255) throw new Error(`component name too long: ${name}`);
    w.write("u8", name.length); for (let k = 0; k < name.length; k++) w.write("u8", name.charCodeAt(k) & 0xff);
    w.write("u32", schemaHash(s.def.schema));
    const sub = new BinaryWriter(64); const slot = s.slot(i);
    for (const f of s.fields) encodeField(s, f, slot, sub);
    const body = sub.finish(); w.write("u32", body.length); for (const b of body) w.write("u8", b);
  }
  return w.finish();
}

export interface PlayerRestoreResult { restored: string[]; skipped: string[] }
/**
 * Writes a saved player record onto an existing (freshly spawned) entity. Components missing on the entity are
 * added; components whose name is unknown or whose schema hash changed are skipped (the fresh spawn values stay).
 */
export function decodePlayerInto(world: World, e: Entity, bytes: Uint8Array, opts: PlayerCodecOptions = {}): PlayerRestoreResult {
  const r = new BinaryReader(bytes);
  if (r.read("u32") !== PLAYER_MAGIC) throw new Error("bad player magic");
  const ver = r.read("u16"); if (ver > PLAYER_VERSION) throw new Error(`unsupported player version ${ver}`);
  const skip = new Set<ComponentDef>([...PLAYER_ALWAYS_EXCLUDED, ...(opts.exclude ?? [])]);
  const byName = new Map(world.componentStores.map((s) => [s.def.name, s] as const));
  const i = entityIndex(e); const out: PlayerRestoreResult = { restored: [], skipped: [] };
  const n = r.read("u8");
  for (let k = 0; k < n; k++) {
    const len = r.read("u8"); let name = ""; for (let c = 0; c < len; c++) name += String.fromCharCode(r.read("u8"));
    const h = r.read("u32"); const size = r.read("u32");
    const st = byName.get(name);
    if (!st || skip.has(st.def as ComponentDef) || schemaHash(st.def.schema) !== h) { r.offset += size; out.skipped.push(name); continue; }
    const start = r.offset;
    const slot = st.has(i) ? st.slot(i) : st.add(e, i);
    for (const f of st.fields) decodeField(st, f, slot, r);
    if (r.offset - start !== size) throw new Error(`player component ${name}: size mismatch`);
    st.markChanged(i); out.restored.push(name);
  }
  return out;
}
