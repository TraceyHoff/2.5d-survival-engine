/**
 * PopulationSpawner: data-driven ambient population over loaded chunks (zombies, animals, virtual players...).
 * Mechanism only: gameplay supplies the spawn table and a host (spawn/despawn/blocked/tile/phase callbacks).
 * Deterministic: every decision draws from world.rngFor("pop:<kind>:<chunk>") so the same seed + tick + inputs
 * give the same population. Run step() on a slow cadence (e.g. a system with `every` = 2 s of ticks).
 */
import type { Entity, World } from "@engine/core";
import { CHUNK_SIZE, chunkKeyOf, parseChunkKey, type ChunkKey } from "./chunk.js";

export type PhaseKey = "night" | "dawn" | "day" | "dusk";
export interface SpawnEntry {
  /** Table key, e.g. "zombie_walker", "deer", "human_bot". */
  kind: string;
  /** Category passed to the host ("zombie" | "animal" | "human_bot" | ...). */
  category: string;
  /** Target population per loaded chunk at weight 1. */
  density: number;
  /** Time-of-day multipliers (default 1). */
  timeWeights?: Partial<Record<PhaseKey, number>>;
  /** Only spawn on these tile ids (biome/tile filter); excludeTiles always rejects. */
  tiles?: readonly number[]; excludeTiles?: readonly number[];
  /** Min distance from every viewpoint (players) when spawning. */
  minPlayerDistance: number;
  /** Max distance from the nearest viewpoint when spawning (default: anywhere in the chunk). */
  maxPlayerDistance?: number;
  perChunkCap: number; globalCap: number;
  /** Despawn when farther than this from all viewpoints (unless the host says persistent). */
  despawnDistance: number;
  /** Spawn this many at once (herds); default [1,1]. */
  group?: [number, number];
}
export interface PopulationViewpoint { x: number; y: number }
export interface PopulationHost {
  chunks(): Iterable<ChunkKey>;
  viewpoints(): PopulationViewpoint[];
  phase(): PhaseKey;
  tileAt(tx: number, ty: number): number;
  /** Unwalkable, built on, inside a claim/safe zone... */
  blocked(tx: number, ty: number): boolean;
  /** Returns the entity, "pending" (async spawn; counted until adopt/timeout) or undefined (refused). */
  spawn(entry: SpawnEntry, x: number, y: number): Entity | "pending" | undefined;
  despawn(e: Entity, entry: SpawnEntry): void;
  position(e: Entity): PopulationViewpoint | undefined;
  /** Tagged persistent entities are never despawned by distance. */
  persistent?(e: Entity): boolean;
}
export interface PopulationOptions { attemptsPerChunk?: number; pendingTimeoutTicks?: number }
export interface PopulationStats { spawned: number; despawned: number; byKind: Record<string, number> }

export class PopulationSpawner {
  readonly entries: SpawnEntry[];
  /** Tracked entity -> kind. */
  readonly tracked = new Map<Entity, string>();
  private pending = new Map<string, number[]>(); // kind -> expiry ticks
  constructor(private world: World, entries: readonly SpawnEntry[], private host: PopulationHost, private o: PopulationOptions = {}) {
    this.entries = entries.map((e) => ({ ...e }));
  }
  entry(kind: string): SpawnEntry | undefined { return this.entries.find((e) => e.kind === kind); }
  /** Track an entity spawned asynchronously (resolves one pending slot) or externally. */
  adopt(e: Entity, kind: string): void { this.tracked.set(e, kind); const p = this.pending.get(kind); if (p?.length) p.shift(); }
  forget(e: Entity): void { this.tracked.delete(e); }
  count(kind: string): number { let n = this.pending.get(kind)?.length ?? 0; for (const k of this.tracked.values()) if (k === kind) n++; return n; }

  step(): PopulationStats {
    const w = this.world, h = this.host; const stats: PopulationStats = { spawned: 0, despawned: 0, byKind: {} };
    for (const [k, p] of this.pending) this.pending.set(k, p.filter((t) => t > w.tick));
    const views = h.viewpoints(); const phase = h.phase();
    // Despawn + per-chunk counts.
    const perChunk = new Map<string, number>(); const global = new Map<string, number>();
    for (const [e, kind] of [...this.tracked].sort((a, b) => a[0] - b[0])) {
      const entry = this.entry(kind); const p = h.position(e);
      if (!p || !entry) { this.tracked.delete(e); continue; }
      const far = views.length > 0 && views.every((v) => Math.hypot(v.x - p.x, v.y - p.y) > entry.despawnDistance);
      if ((far || views.length === 0) && !h.persistent?.(e)) { h.despawn(e, entry); this.tracked.delete(e); stats.despawned++; continue; }
      const ck = `${kind}|${chunkKeyOf(p.x, p.y)}`; perChunk.set(ck, (perChunk.get(ck) ?? 0) + 1);
      global.set(kind, (global.get(kind) ?? 0) + 1);
    }
    for (const [k, p] of this.pending) global.set(k, (global.get(k) ?? 0) + p.length);
    if (views.length === 0) return this.fill(stats, global);
    const chunks = [...h.chunks()].sort();
    for (const entry of this.entries) {
      const weight = entry.timeWeights?.[phase] ?? 1; const target = entry.density * weight; if (target <= 0) continue;
      for (const ck of chunks) {
        if ((global.get(entry.kind) ?? 0) >= entry.globalCap) break;
        const have = perChunk.get(`${entry.kind}|${ck}`) ?? 0; const cap = Math.min(entry.perChunkCap, Math.ceil(target));
        if (have >= cap) continue;
        const rng = w.rngFor(`pop:${entry.kind}:${ck}`);
        // Fractional density: spawn with probability (target - have) when below 1.
        if (rng.next() >= Math.min(1, target - have)) continue;
        const { cx, cy } = parseChunkKey(ck);
        for (let a = 0; a < (this.o.attemptsPerChunk ?? 4); a++) {
          const tx = cx * CHUNK_SIZE + rng.int(0, CHUNK_SIZE), ty = cy * CHUNK_SIZE + rng.int(0, CHUNK_SIZE);
          const x = tx + 0.5, y = ty + 0.5;
          let near = Infinity; for (const v of views) near = Math.min(near, Math.hypot(v.x - x, v.y - y));
          if (near < entry.minPlayerDistance || (entry.maxPlayerDistance !== undefined && near > entry.maxPlayerDistance) || near > entry.despawnDistance) continue;
          const tile = h.tileAt(tx, ty);
          if (entry.excludeTiles?.includes(tile) || (entry.tiles && !entry.tiles.includes(tile)) || h.blocked(tx, ty)) continue;
          const [g0, g1] = entry.group ?? [1, 1]; const n = Math.min(rng.int(g0, g1 + 1), cap - have, entry.globalCap - (global.get(entry.kind) ?? 0));
          for (let i = 0; i < n; i++) {
            const gx = x + (i ? rng.range(-1.5, 1.5) : 0), gy = y + (i ? rng.range(-1.5, 1.5) : 0);
            if (i && h.blocked(Math.floor(gx), Math.floor(gy))) continue;
            const r = h.spawn(entry, gx, gy); if (r === undefined) continue;
            if (r === "pending") { let p = this.pending.get(entry.kind); if (!p) this.pending.set(entry.kind, (p = [])); p.push(w.tick + (this.o.pendingTimeoutTicks ?? 200)); }
            else this.tracked.set(r, entry.kind);
            global.set(entry.kind, (global.get(entry.kind) ?? 0) + 1); perChunk.set(`${entry.kind}|${ck}`, (perChunk.get(`${entry.kind}|${ck}`) ?? 0) + 1); stats.spawned++;
          }
          break;
        }
      }
    }
    return this.fill(stats, global);
  }
  private fill(s: PopulationStats, g: Map<string, number>): PopulationStats { for (const e of this.entries) s.byKind[e.kind] = g.get(e.kind) ?? 0; return s; }
}
