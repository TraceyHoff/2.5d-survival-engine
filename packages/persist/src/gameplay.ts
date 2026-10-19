/**
 * Gameplay adapter: saves build pieces with gameplay's own per-chunk structure codec (STRC, `encodeStructures` /
 * `decodeStructures`) as a ChunkSidecar, instead of as plain entities in the chunk codec. Import via
 * "@engine/persist/gameplay" (keeps the base entry free of gameplay).
 *
 *   new WorldPersistence({ ..., sidecars: [gameplayStructures()] })
 *
 * Migration: saves written before this adapter stored pieces (BuildPiece) and attachments (PieceLink) as entities in
 * the chunk row. On load they are indexed, re-encoded through STRC, and recreated by `decodeStructures`, so they get
 * every derived/server-only component (stability, stations, emitters, viewers) exactly like a native STRC load. The
 * next autosave rewrites the chunk in the new layout.
 */
import type { Entity, World } from "@engine/core";
import { chunkKey, type ChunkKey } from "@engine/world";
import {
  attachmentsOf, BuildPiece, decodeStructures, encodeStructures, PieceLink, structureChunkVersion, structureIndexSystem, structures, unloadStructures,
} from "@engine/gameplay";
import type { ChunkSidecar } from "./persistence.js";

export const STRUCTURES_NS = "chunk.structures";

/** Every entity a set of pieces consists of (pieces + linked attachments). */
function withAttachments(world: World, pieces: readonly Entity[]): Entity[] {
  const out: Entity[] = [];
  for (const p of pieces) { out.push(p); for (const a of attachmentsOf(world, p)) out.push(a); }
  return out;
}

export function gameplayStructures(): ChunkSidecar {
  return {
    ns: STRUCTURES_NS,
    encode(world, cx, cy) { return structures(world).chunkPieces.get(chunkKey(cx, cy))?.size ? encodeStructures(world, cx, cy) : undefined; },
    format: (b) => (b.length >= 6 ? b[4]! | (b[5]! << 8) : 0), // u8x4 magic, u16 version
    decode(world, _cx, _cy, bytes) { return withAttachments(world, decodeStructures(world, bytes).pieces); },
    unload(world, key: ChunkKey) { unloadStructures(world, key); },
    version: (world, key) => structureChunkVersion(world, key),
    owns: (world, e) => world.has(e, BuildPiece) || world.has(e, PieceLink),
    size: (world, key) => structures(world).chunkPieces.get(key)?.size ?? 0,
    migrate(world, cx, cy, legacy) {
      const key = chunkKey(cx, cy);
      // Index the decoded pieces and link their attachments. Openings (doors) are skipped until their host piece is
      // indexed, so repeat while that makes progress (bounded: opening-in-opening does not exist).
      for (let i = 0; i < 4; i++) { const before = structures(world).chunkPieces.get(key)?.size ?? 0; structureIndexSystem(world); if ((structures(world).chunkPieces.get(key)?.size ?? 0) === before && i > 0) break; }
      const bytes = encodeStructures(world, cx, cy);
      unloadStructures(world, key);
      for (const e of legacy) if (world.isAlive(e)) world.destroy(e); // anything STRC did not cover (unindexable)
      return withAttachments(world, decodeStructures(world, bytes).pieces);
    },
  };
}

