import { BinaryReader, BinaryWriter, decodeField, encodeField, entityIndex, schemaHash, Transform, type ComponentStore, type Entity, type World } from "@engine/core";
import { Chunk, CHUNK_AREA, CHUNK_SIZE } from "./chunk.js";
import type { BuildingGrid } from "./building.js";

export const CHUNK_MAGIC = 0x4b4e4843; // "CHNK"
export const CHUNK_VERSION = 1;

/**
 * Versioned binary chunk format v1 (LE):
 *   u32 magic, u16 version, i32 cx, i32 cy
 *   tiles: u16 runCount, runCount x (u16 len, u16 id)      (RLE)
 *   height: 1024 x u8
 *   buildings: u16 n, n x (u16 piece, u8 lx, u8 ly, u8 z, u8 rot, f32 hp)
 *   components: u8 n, n x (u16 componentId, u32 schemaHash)   (persistent components present in this chunk)
 *   entities: u32 n, n x (u8 compCount, compCount x (u8 tableIndex, record))
 * Transform x/y are stored chunk-relative (precision: see WorldOrigin guidance) and rebased on decode.
 * No storage backend: callers persist the bytes (ChunkProvider.save / their own store).
 */
export function encodeChunk(chunk: Chunk, opts: { world?: World; entities?: Iterable<Entity>; buildings?: BuildingGrid } = {}): Uint8Array {
  const w = new BinaryWriter(4096);
  w.write("u32", CHUNK_MAGIC); w.write("u16", CHUNK_VERSION); w.write("i32", chunk.cx); w.write("i32", chunk.cy);
  const runs: [number, number][] = [];
  for (let i = 0; i < CHUNK_AREA; i++) { const t = chunk.tiles[i]!; const last = runs[runs.length - 1]; if (last && last[1] === t && last[0] < 0xffff) last[0]++; else runs.push([1, t]); }
  w.write("u16", runs.length); for (const [n, t] of runs) { w.write("u16", n); w.write("u16", t); }
  for (let i = 0; i < CHUNK_AREA; i++) w.write("u8", chunk.height[i]!);
  const insts = opts.buildings?.anchoredIn(chunk.key) ?? [];
  w.write("u16", insts.length);
  for (const b of insts) { w.write("u16", b.piece); w.write("u8", b.tx - chunk.cx * CHUNK_SIZE); w.write("u8", b.ty - chunk.cy * CHUNK_SIZE); w.write("u8", b.z); w.write("u8", b.rot); w.write("f32", b.hp); }
  const world = opts.world;
  const stores = world ? world.componentStores.filter((s) => s.def.persistent) : [];
  const ents = world ? [...(opts.entities ?? [])].filter((e) => world.isAlive(e) && stores.some((s) => s.has(entityIndex(e)))) : [];
  const used = stores.filter((s) => ents.some((e) => s.has(entityIndex(e))));
  w.write("u8", used.length); for (const s of used) { w.write("u16", s.id); w.write("u32", schemaHash(s.def.schema)); }
  w.write("u32", ents.length);
  const ox = chunk.cx * CHUNK_SIZE, oy = chunk.cy * CHUNK_SIZE;
  for (const e of ents) {
    const i = entityIndex(e); const have = used.map((s, ti) => [s, ti] as const).filter(([s]) => s.has(i));
    w.write("u8", have.length);
    for (const [s, ti] of have) {
      w.write("u8", ti); const slot = s.slot(i);
      if (s.def === (Transform as unknown)) { // chunk-relative position
        const t = s as unknown as ComponentStore<typeof Transform.schema>;
        for (const f of t.fields) w.write("f32", f === "x" ? t.data.x[slot]! - ox : f === "y" ? t.data.y[slot]! - oy : t.data[f][slot]!);
      } else for (const f of s.fields) encodeField(s, f, slot, w);
    }
  }
  return w.finish();
}

export interface DecodedChunk { chunk: Chunk; buildings: { piece: number; tx: number; ty: number; z: number; rot: number; hp: number }[]; entities: Entity[] }
/** Decodes a chunk; creates its persistent entities in `world` and places buildings into `buildings` if given. */
export function decodeChunk(bytes: Uint8Array, opts: { world?: World; buildings?: BuildingGrid } = {}): DecodedChunk {
  const r = new BinaryReader(bytes);
  if (r.read("u32") !== CHUNK_MAGIC) throw new Error("bad chunk magic");
  const ver = r.read("u16"); if (ver > CHUNK_VERSION) throw new Error(`unsupported chunk version ${ver}`);
  const cx = r.read("i32"), cy = r.read("i32"); const chunk = new Chunk(cx, cy);
  let p = 0; const nr = r.read("u16");
  for (let k = 0; k < nr; k++) { const n = r.read("u16"), t = r.read("u16"); if (p + n > CHUNK_AREA) throw new Error("tile RLE overflow"); chunk.tiles.fill(t, p, p + n); p += n; }
  if (p !== CHUNK_AREA) throw new Error("tile RLE underflow");
  for (let i = 0; i < CHUNK_AREA; i++) chunk.height[i] = r.read("u8");
  const ox = cx * CHUNK_SIZE, oy = cy * CHUNK_SIZE; const buildings: DecodedChunk["buildings"] = [];
  const nb = r.read("u16");
  for (let k = 0; k < nb; k++) {
    const b = { piece: r.read("u16"), tx: ox + r.read("u8"), ty: oy + r.read("u8"), z: r.read("u8"), rot: r.read("u8"), hp: r.read("f32") };
    buildings.push(b); opts.buildings?.place(b.piece, b.tx, b.ty, b.z, b.rot, b.hp);
  }
  const nc = r.read("u8"); const table: ComponentStore[] = []; const world = opts.world;
  for (let k = 0; k < nc; k++) {
    const id = r.read("u16"), h = r.read("u32"); const st = world?.storeById(id);
    if (world && (!st || schemaHash(st.def.schema) !== h || !st.def.persistent)) throw new Error(`chunk component ${id} schema mismatch`);
    if (st) table.push(st);
  }
  const ne = r.read("u32"); const entities: Entity[] = [];
  if (ne && !world) throw new Error("chunk has entities: pass a world to decode");
  for (let k = 0; k < ne; k++) {
    const e = world!.create(); entities.push(e); const i = entityIndex(e); const cc = r.read("u8");
    for (let c = 0; c < cc; c++) {
      const st = table[r.read("u8")]; if (!st) throw new Error("bad component table index");
      const slot = st.add(e, i);
      for (const f of st.fields) decodeField(st, f, slot, r);
      if (st.def === (Transform as unknown)) { const dx = st.data["x"]!, dy = st.data["y"]!; dx[slot] = dx[slot]! + ox; dy[slot] = dy[slot]! + oy; }
    }
  }
  chunk.dirty = false; return { chunk, buildings, entities };
}
