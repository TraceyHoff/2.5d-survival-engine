/**
 * Deterministic, versioned per-chunk structure codec ("STRC"). Gameplay owns this blob (pieces are not saved via
 * core's persistent flag, to avoid double-saving); persistence/streaming store it next to the chunk.
 *
 * Layout v1 (little endian, core BinaryWriter):
 *   header: u8 'S','T','R','C' | u16 version | i32 cx | i32 cy | u32 pieceHash | u32 itemHash | u32 count
 *   record: u16 type | u8 tier | u8 rot | u8 variant | u8 paint | u16 hp | u8 level | i16 qx | i16 qy (quarter tiles
 *           relative to the chunk origin) | u16 tribe | u8 flags (1 door, 2 fire, 4 storage)
 *           [door: u8 open, u16 lockTribe] [fire: u8 lit, u32 burnRemainingTicks]
 *           [container (fire or storage): u8 slotCount, u8 n, n x (u8 slot, u16 item, u16 count, u32 ageTicks, u16 durability)]
 * Records are sorted (decks, structure cells, edges, furniture, openings; then level, y, x, type, rot) so hosts
 * decode before openings and re-encoding a decoded chunk is byte-identical. Times are relative to the save tick.
 */
import { BinaryReader, BinaryWriter, entityIndex, Transform, type Entity, type World } from "@engine/core";
import { CHUNK_SIZE, chunkKey, type ChunkKey } from "@engine/world";
import { AttachKind, BuildPiece, Container, DoorState, Fuel, PieceLink, PieceStability, Tribe } from "../components.js";
import { gameplayDefs, isAuthority } from "../config.js";
import { Placement, type PieceDef } from "../defs.js";
import { attachmentsOf, unlinkPiece } from "./links.js";
import { recomputeRegion } from "./integrity.js";
import { placePiece } from "./place.js";
import { openingParent, slotFromPos, slotTransform, structures, unmarkLinked, type StructureIndex } from "./structure.js";
import { setEmittersLit } from "../systems/fuel.js";

export const STRC_VERSION = 1;
const MAGIC = [0x53, 0x54, 0x52, 0x43];
export class StructureCodecError extends Error {}

const rank = (d: PieceDef): number => d.placement === Placement.Cell ? d.layer : d.placement === Placement.Edge ? 4 : d.placement === Placement.Free ? 5 : 6;

interface Rec { e: Entity; def: PieceDef; level: number; qx: number; qy: number; rot: number; type: number }
function records(world: World, idx: StructureIndex, cx: number, cy: number): Rec[] {
  const lh = gameplayDefs(world).building.levelHeight; const out: Rec[] = [];
  for (const e of idx.chunkPieces.get(chunkKey(cx, cy)) ?? []) {
    const def = idx.def(e); const t = world.get(e, Transform); const bp = world.get(e, BuildPiece); if (!def || !t || !bp) continue;
    out.push({ e, def, level: Math.round(t.z / lh), qx: Math.round((t.x - cx * CHUNK_SIZE) * 4), qy: Math.round((t.y - cy * CHUNK_SIZE) * 4), rot: bp.rot, type: bp.type });
  }
  return out.sort((a, b) => rank(a.def) - rank(b.def) || a.level - b.level || a.qy - b.qy || a.qx - b.qx || a.type - b.type || a.rot - b.rot);
}

export function encodeStructures(world: World, cx: number, cy: number): Uint8Array {
  const defs = gameplayDefs(world); const idx = structures(world); const w = new BinaryWriter(256);
  for (const m of MAGIC) w.write("u8", m);
  w.write("u16", STRC_VERSION); w.write("i32", cx); w.write("i32", cy); w.write("u32", defs.hashes.pieces); w.write("u32", defs.hashes.items);
  const recs = records(world, idx, cx, cy); w.write("u32", recs.length);
  for (const r of recs) {
    const bp = world.get(r.e, BuildPiece)!;
    w.write("u16", bp.type); w.write("u8", bp.tier); w.write("u8", bp.rot); w.write("u8", bp.variant); w.write("u8", bp.paint); w.write("u16", bp.hp);
    w.write("u8", r.level); w.write("i16", r.qx); w.write("i16", r.qy); w.write("u16", world.getField(r.e, Tribe, "id") ?? 0);
    const atts = attachmentsOf(world, r.e);
    const door = atts.find((a) => world.has(a, DoorState)); const fire = atts.find((a) => world.has(a, Fuel));
    const store = atts.find((a) => world.has(a, Container) && !world.has(a, Fuel));
    w.write("u8", (door !== undefined ? 1 : 0) | (fire !== undefined ? 2 : 0) | (store !== undefined ? 4 : 0));
    if (door !== undefined) { const d = world.get(door, DoorState)!; w.write("u8", d.open); w.write("u16", d.lockTribe); }
    if (fire !== undefined) { const f = world.get(fire, Fuel)!; w.write("u8", f.lit); w.write("u32", Math.max(0, f.burnUntilTick - world.tick)); }
    for (const c of [fire, store]) if (c !== undefined) writeContainer(world, w, c);
  }
  return w.finish();
}
function writeContainer(world: World, w: BinaryWriter, c: Entity): void {
  const n = world.getField(c, Container, "slotCount")!; const items = world.getArray(c, Container, "items")!, counts = world.getArray(c, Container, "counts")!, created = world.getArray(c, Container, "createdTick")!;
  const used: number[] = []; for (let i = 0; i < n; i++) if (items[i] && counts[i]) used.push(i);
  w.write("u8", n); w.write("u8", used.length);
  const dur = world.getArray(c, Container, "durability")!;
  for (const i of used) { w.write("u8", i); w.write("u16", items[i]!); w.write("u16", counts[i]!); w.write("u32", Math.max(0, world.tick - created[i]!)); w.write("u16", dur[i]!); }
}
function readContainer(world: World, r: BinaryReader, c: Entity | undefined): void {
  const n = r.read("u8"); const used = r.read("u8");
  const items = c !== undefined ? world.getArray(c, Container, "items") : undefined, counts = c !== undefined ? world.getArray(c, Container, "counts") : undefined, created = c !== undefined ? world.getArray(c, Container, "createdTick") : undefined;
  if (c !== undefined) world.setField(c, Container, "slotCount", n);
  for (let k = 0; k < used; k++) {
    const i = r.read("u8"), item = r.read("u16"), count = r.read("u16"), age = r.read("u32"), d = r.read("u16");
    const dur = c !== undefined ? world.getArray(c, Container, "durability") : undefined;
    if (items && counts && created && dur && i < items.length) { items[i] = item; counts[i] = count; created[i] = Math.max(0, world.tick - age); dur[i] = d; }
  }
  if (c !== undefined) world.store(Container).markChanged(entityIndex(c));
}

export interface DecodedStructures { cx: number; cy: number; pieces: Entity[]; hashMismatch: boolean }
/** Decodes into the world (server/authority): spawns pieces + attachments, restores state, recomputes stability. */
export function decodeStructures(world: World, bytes: Uint8Array, opts: { strictHashes?: boolean } = {}): DecodedStructures {
  const defs = gameplayDefs(world); const idx = structures(world); const r = new BinaryReader(bytes); const lh = defs.building.levelHeight;
  for (const m of MAGIC) if (r.read("u8") !== m) throw new StructureCodecError("not a structure blob (bad magic)");
  const version = r.read("u16"); if (version !== STRC_VERSION) throw new StructureCodecError(`unsupported structure blob version ${version} (expected ${STRC_VERSION})`);
  const cx = r.read("i32"), cy = r.read("i32"); const ph = r.read("u32"), ih = r.read("u32");
  const hashMismatch = ph !== defs.hashes.pieces || ih !== defs.hashes.items;
  if (hashMismatch && opts.strictHashes) throw new StructureCodecError("structure blob was written with different piece/item ids");
  const count = r.read("u32"); const pieces: Entity[] = [];
  for (let k = 0; k < count; k++) {
    const type = r.read("u16"), tier = r.read("u8"), rot = r.read("u8"), variant = r.read("u8"), paint = r.read("u8"), hp = r.read("u16");
    const level = r.read("u8"), qx = r.read("i16"), qy = r.read("i16"), tribe = r.read("u16"), flags = r.read("u8");
    const door = flags & 1 ? { open: r.read("u8"), lockTribe: r.read("u16") } : undefined;
    const fire = flags & 2 ? { lit: r.read("u8"), rem: r.read("u32") } : undefined;
    const def = defs.pieces.get(type);
    const x = cx * CHUNK_SIZE + qx / 4, y = cy * CHUNK_SIZE + qy / 4;
    let e: Entity | undefined;
    if (def) {
      const slot = slotFromPos(def, x, y, level, rot);
      const parent = def.placement === Placement.Opening ? openingParent(idx, def, slot) : 0;
      if (def.placement !== Placement.Opening || parent) {
        e = placePiece(world, 0, { def, slot, parent, pos: slotTransform(def, slot, lh, x, y), tier, variant }, { pay: false, hp, paint, tribe });
        pieces.push(e);
      }
    }
    const atts = e !== undefined ? attachmentsOf(world, e) : [];
    const doorA = atts.find((a) => world.has(a, DoorState)); const fireA = atts.find((a) => world.has(a, Fuel)); const storeA = atts.find((a) => world.has(a, Container) && !world.has(a, Fuel));
    if (door && doorA !== undefined) world.set(doorA, DoorState, door);
    if (fire && fireA !== undefined) { world.set(fireA, Fuel, { lit: fire.lit, burnUntilTick: world.tick + fire.rem }); }
    if (fire) readContainer(world, r, fireA);
    if (flags & 4) readContainer(world, r, storeA);
  }
  if (isAuthority(world) && pieces.length) { recomputeRegion(world, idx, new Set(pieces)); idx.dirty.clear(); }
  // fires: restore emitter strength for lit fires
  for (const p of pieces) for (const a of attachmentsOf(world, p)) if (world.getField(a, Fuel, "lit")) setEmittersLit(world, a, 1);
  return { cx, cy, pieces, hashMismatch };
}
/** Drops a chunk's pieces from the world without destruction rules (unload after saving). */
export function unloadStructures(world: World, k: ChunkKey): number {
  const idx = structures(world); const set = [...(idx.chunkPieces.get(k) ?? [])]; let n = 0;
  for (const e of set) {
    for (const a of unlinkPiece(world, e)) if (world.isAlive(a)) { unmarkLinked(world, a); world.destroy(a); }
    idx.removePiece(e); if (world.isAlive(e)) { world.destroy(e); n++; }
  }
  return n;
}
/** Per-chunk structure version (bumped on any change) for dirty tracking. */
export const structureChunkVersion = (world: World, k: ChunkKey): number => structures(world).chunkVersions.get(k) ?? 0;

