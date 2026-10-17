import type { Entity } from "@engine/core";
import { CHUNK_SIZE, chunkKey, type ChunkKey } from "./chunk.js";

const CELL = 4; const CPC = CHUNK_SIZE / CELL; // cells per chunk side (8)
interface Bucket { cells: (Set<Entity> | undefined)[]; count: number }

/**
 * Two-level spatial index for large worlds: chunk map -> fixed 8x8 grid of 4-tile cells per chunk.
 * Memory is proportional to occupied chunks; queries touch only overlapping chunks/cells.
 */
export class ChunkedSpatialIndex {
  private buckets = new Map<ChunkKey, Bucket>();
  private where = new Map<Entity, { k: ChunkKey; c: number; x: number; y: number }>();
  get size(): number { return this.where.size; }
  get chunkCount(): number { return this.buckets.size; }
  insert(e: Entity, x: number, y: number): void {
    const cx = Math.floor(x / CHUNK_SIZE), cy = Math.floor(y / CHUNK_SIZE);
    const k = chunkKey(cx, cy); const c = Math.floor((y - cy * CHUNK_SIZE) / CELL) * CPC + Math.floor((x - cx * CHUNK_SIZE) / CELL);
    const old = this.where.get(e);
    if (old) { if (old.k === k && old.c === c) { old.x = x; old.y = y; return; } this.detach(e, old.k, old.c); }
    let b = this.buckets.get(k); if (!b) this.buckets.set(k, (b = { cells: new Array(CPC * CPC), count: 0 }));
    (b.cells[c] ??= new Set()).add(e); b.count++;
    this.where.set(e, { k, c, x, y });
  }
  remove(e: Entity): void { const w = this.where.get(e); if (w) { this.detach(e, w.k, w.c); this.where.delete(e); } }
  private detach(e: Entity, k: ChunkKey, c: number): void {
    const b = this.buckets.get(k)!; b.cells[c]!.delete(e); if (--b.count === 0) this.buckets.delete(k);
  }
  queryRect(minX: number, minY: number, maxX: number, maxY: number, out: Entity[] = []): Entity[] {
    const c0x = Math.floor(minX / CHUNK_SIZE), c1x = Math.floor(maxX / CHUNK_SIZE), c0y = Math.floor(minY / CHUNK_SIZE), c1y = Math.floor(maxY / CHUNK_SIZE);
    for (let cy = c0y; cy <= c1y; cy++) for (let cx = c0x; cx <= c1x; cx++) {
      const b = this.buckets.get(chunkKey(cx, cy)); if (!b) continue;
      const ox = cx * CHUNK_SIZE, oy = cy * CHUNK_SIZE;
      const gx0 = Math.max(0, Math.floor((minX - ox) / CELL)), gx1 = Math.min(CPC - 1, Math.floor((maxX - ox) / CELL));
      const gy0 = Math.max(0, Math.floor((minY - oy) / CELL)), gy1 = Math.min(CPC - 1, Math.floor((maxY - oy) / CELL));
      for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) {
        const s = b.cells[gy * CPC + gx]; if (!s) continue;
        for (const e of s) { const p = this.where.get(e)!; if (p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY) out.push(e); }
      }
    }
    return out;
  }
  queryRadius(x: number, y: number, r: number, out: Entity[] = []): Entity[] {
    const tmp = this.queryRect(x - r, y - r, x + r, y + r); const r2 = r * r;
    for (const e of tmp) { const p = this.where.get(e)!; if ((p.x - x) ** 2 + (p.y - y) ** 2 <= r2) out.push(e); }
    return out;
  }
  entitiesInChunk(k: ChunkKey): Entity[] { const b = this.buckets.get(k); const out: Entity[] = []; if (b) for (const s of b.cells) if (s) for (const e of s) out.push(e); return out; }
  clear(): void { this.buckets.clear(); this.where.clear(); }
}
