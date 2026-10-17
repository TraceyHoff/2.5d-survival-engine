import { fnv1a, Rng } from "@engine/core";
import { Chunk, CHUNK_SIZE, type ChunkKey } from "./chunk.js";
import type { BaseClimate, BaseClimateSource } from "./climate.js";

/** A resource node to spawn in a freshly generated chunk (gameplay maps kind -> ResourceNode etc). */
export interface NodePlacement { tx: number; ty: number; kind: number }
export interface GeneratedChunk { chunk: Chunk; nodes: NodePlacement[] }

/** Pluggable chunk source. Return undefined if the provider has nothing (e.g. storage miss). */
export interface ChunkProvider {
  load(cx: number, cy: number): GeneratedChunk | undefined;
  /** Optional persistence of an unloaded chunk (encoded with encodeChunk). */
  save?(key: ChunkKey, bytes: Uint8Array): void;
}

/** Deterministic per-(seed,cx,cy) hash value in [0,1). */
export function hash2(seed: number, x: number, y: number): number {
  let h = Math.imul(seed ^ Math.imul(x | 0, 0x27d4eb2d), 0x165667b1) ^ Math.imul(y | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
/** Smooth value noise in [0,1). */
export function valueNoise(seed: number, x: number, y: number, scale: number): number {
  const fx = x / scale, fy = y / scale, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
  const s = (t: number) => t * t * (3 - 2 * t);
  const a = hash2(seed, x0, y0), b = hash2(seed, x0 + 1, y0), c = hash2(seed, x0, y0 + 1), d = hash2(seed, x0 + 1, y0 + 1);
  return a + (b - a) * s(tx) + (c - a) * s(ty) + (a - b - c + d) * s(tx) * s(ty);
}

export interface ProceduralOptions {
  seed: number;
  /** Tile ids by biome band (low -> high noise). Default: water, sand, grass, forest, rock. */
  bands?: { max: number; tile: number; nodeKinds?: number[]; nodeChance?: number; /** °C baseline */ temp?: number; /** 0..1 */ humidity?: number }[];
  /** Large-scale temperature variation amplitude in °C (default 8) over `climateScale` tiles (default 512). */
  climateAmplitude?: number; climateScale?: number;
}
export const DEFAULT_BANDS = [
  { max: 0.3, tile: 1, temp: 16, humidity: 0.9 },                                   // water
  { max: 0.36, tile: 2, nodeKinds: [4], nodeChance: 0.01, temp: 22, humidity: 0.5 }, // sand: loose rocks
  { max: 0.62, tile: 3, nodeKinds: [1, 2, 3], nodeChance: 0.03, temp: 18, humidity: 0.55 }, // grass: branches, grass, bush
  { max: 0.8, tile: 4, nodeKinds: [5, 1], nodeChance: 0.08, temp: 15, humidity: 0.7 },  // forest: trees
  { max: 1.01, tile: 5, nodeKinds: [6, 7], nodeChance: 0.04, temp: 8, humidity: 0.35 }, // rock: boulder, iron
];
/** Seeded procedural generator stub: biome noise + resource node placement. Pure function of (seed, cx, cy). */
export class ProceduralGenerator implements ChunkProvider, BaseClimateSource {
  private bands: NonNullable<ProceduralOptions["bands"]>;
  constructor(readonly opts: ProceduralOptions) { this.bands = opts.bands ?? DEFAULT_BANDS; }
  private noiseAt(tx: number, ty: number): number {
    const seed = this.opts.seed >>> 0;
    return 0.65 * valueNoise(seed, tx, ty, 48) + 0.35 * valueNoise(seed ^ 0xabc, tx, ty, 12);
  }
  /** Deterministic base climate for a tile (no chunk needs to be loaded). Altitude matches generated tile height. */
  baseClimate(tx: number, ty: number): BaseClimate {
    const n = this.noiseAt(tx, ty); const band = this.bands.find((b) => n < b.max) ?? this.bands[this.bands.length - 1]!;
    const amp = this.opts.climateAmplitude ?? 8, scale = this.opts.climateScale ?? 512;
    const large = (valueNoise((this.opts.seed ^ 0x5151) >>> 0, tx, ty, scale) - 0.5) * 2 * amp;
    return { temperature: (band.temp ?? 15) + large, humidity: band.humidity ?? 0.5, altitude: Math.floor(n * 4) };
  }
  /** Mean base climate of a chunk (sampled on a 4x4 grid). */
  chunkClimate(cx: number, cy: number): BaseClimate {
    let t = 0, h = 0, a = 0; const S = CHUNK_SIZE / 4;
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) { const b = this.baseClimate(cx * CHUNK_SIZE + i * S + S / 2, cy * CHUNK_SIZE + j * S + S / 2); t += b.temperature; h += b.humidity; a += b.altitude; }
    return { temperature: t / 16, humidity: h / 16, altitude: a / 16 };
  }
  load(cx: number, cy: number): GeneratedChunk {
    const c = new Chunk(cx, cy); const nodes: NodePlacement[] = []; const seed = this.opts.seed >>> 0;
    const rng = new Rng(fnv1a(`${cx},${cy}`, seed));
    for (let ly = 0; ly < CHUNK_SIZE; ly++) for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const tx = cx * CHUNK_SIZE + lx, ty = cy * CHUNK_SIZE + ly;
      const n = this.noiseAt(tx, ty);
      const band = this.bands.find((b) => n < b.max) ?? this.bands[this.bands.length - 1]!;
      const i = ly * CHUNK_SIZE + lx; c.tiles[i] = band.tile; c.height[i] = Math.floor(n * 4);
      if (band.nodeKinds?.length && rng.next() < (band.nodeChance ?? 0)) nodes.push({ tx, ty, kind: rng.pick(band.nodeKinds) });
    }
    c.dirty = false; return { chunk: c, nodes };
  }
}
