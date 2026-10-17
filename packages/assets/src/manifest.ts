import { StableIdRegistry, type World } from "@engine/core";

export const MANIFEST_VERSION = 1;
export const CATEGORIES = ["character", "zombie", "item", "equipment", "resource", "building", "tile"] as const;
export type Category = (typeof CATEGORIES)[number];
/** Iso facings: 1 (none), 4 (NE,SE,SW,NW) or 8 (E,SE,S,SW,W,NW,N,NE). */
export type Directions = 1 | 4 | 8;

export interface AtlasJson { key: string; image: string; frameW: number; frameH: number; columns: number; rows: number }
export interface AnimationJson { frames: number[]; fps: number; directions?: Directions; /** frame offset per direction row (default: atlas columns) */ dirStride?: number; loop?: boolean }
export interface SpriteJson {
  key: string; category: Category; atlas: string;
  /** Pivot in [0,1] of the frame; feet for characters (default 0.5, 0.9). */
  anchor?: { x: number; y: number };
  animations: Record<string, AnimationJson>;
}
export interface ManifestJson { version: number; name?: string; atlases: AtlasJson[]; sprites: SpriteJson[] }

export interface Atlas extends AtlasJson { id: number }
export interface Animation { id: number; name: string; frames: number[]; fps: number; directions: Directions; dirStride: number; loop: boolean }
export interface SpriteDef { id: number; key: string; category: Category; atlas: Atlas; anchor: { x: number; y: number }; animations: Map<string, Animation>; animList: Animation[] }
export interface FrameRef { atlas: Atlas; frame: number; x: number; y: number; w: number; h: number; anchorX: number; anchorY: number }

export class ManifestError extends Error { constructor(readonly issues: string[]) { super(`Asset manifest invalid:\n${issues.join("\n")}`); } }

/** Registry of sprites with stable numeric ids (u16) assigned from string keys + lock table. */
export class AssetRegistry {
  constructor(readonly atlases: Map<string, Atlas>, private sprites: Map<number, SpriteDef>, readonly ids: StableIdRegistry) {}
  get hash(): number { return this.ids.hash; }
  get size(): number { return this.sprites.size; }
  id(key: string): number { return this.ids.id(key); }
  sprite(id: number): SpriteDef { const s = this.sprites.get(id); if (!s) throw new Error(`unknown sprite ${id}`); return s; }
  byKey(key: string): SpriteDef { return this.sprite(this.ids.id(key)); }
  byCategory(c: Category): SpriteDef[] { return [...this.sprites.values()].filter((s) => s.category === c); }
  /** Direction index for a facing angle (radians, 0 = +x tile axis) quantized to the animation's directions. */
  static directionIndex(facing: number, directions: Directions): number {
    if (directions === 1) return 0; const a = ((facing % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    return Math.round(a / ((2 * Math.PI) / directions)) % directions;
  }
  /** Resolve the atlas rect for sprite/animation/facing at time t (seconds or ticks/tickHz). */
  frame(spriteId: number, anim: string, facing: number, timeSec: number): FrameRef {
    const s = this.sprite(spriteId); const a = s.animations.get(anim) ?? s.animList[0]!;
    const n = a.frames.length; let i = Math.floor(timeSec * a.fps); i = a.loop ? i % n : Math.min(i, n - 1);
    const f = a.frames[i]! + AssetRegistry.directionIndex(facing, a.directions) * a.dirStride;
    const at = s.atlas;
    return { atlas: at, frame: f, x: (f % at.columns) * at.frameW, y: Math.floor(f / at.columns) * at.frameH, w: at.frameW, h: at.frameH, anchorX: s.anchor.x * at.frameW, anchorY: s.anchor.y * at.frameH };
  }
}

/** Validate + build a registry. Throws ManifestError listing every issue. Returns the updated id lock to persist. */
export function loadManifest(json: unknown, opts: { lock?: Record<string, number> } = {}): { registry: AssetRegistry; lock: Record<string, number> } {
  const issues: string[] = []; const m = json as ManifestJson;
  if (!m || typeof m !== "object") throw new ManifestError(["manifest is not an object"]);
  if (m.version !== MANIFEST_VERSION) issues.push(`version must be ${MANIFEST_VERSION}`);
  if (!Array.isArray(m.atlases)) issues.push("atlases must be an array");
  if (!Array.isArray(m.sprites)) issues.push("sprites must be an array");
  if (issues.length) throw new ManifestError(issues);
  const atlases = new Map<string, Atlas>(); const KEY = /^[a-z0-9_]+$/;
  m.atlases.forEach((a, i) => {
    const p = `atlases[${i}](${a.key})`;
    if (!KEY.test(a.key ?? "")) issues.push(`${p}: bad key`);
    if (atlases.has(a.key)) issues.push(`${p}: duplicate key`);
    if (!a.image || !/\.(png|webp)$/.test(a.image)) issues.push(`${p}: image must be .png/.webp`);
    for (const f of ["frameW", "frameH", "columns", "rows"] as const) if (!(Number.isInteger(a[f]) && a[f] > 0)) issues.push(`${p}: ${f} must be a positive integer`);
    atlases.set(a.key, { ...a, id: atlases.size + 1 });
  });
  const keys: string[] = [];
  m.sprites.forEach((s, i) => {
    const p = `sprites[${i}](${s.key})`;
    if (!KEY.test(s.key ?? "")) issues.push(`${p}: bad key`);
    if (keys.includes(s.key)) issues.push(`${p}: duplicate key`); keys.push(s.key);
    if (!CATEGORIES.includes(s.category)) issues.push(`${p}: unknown category "${s.category}"`);
    const at = atlases.get(s.atlas); if (!at) issues.push(`${p}: unknown atlas "${s.atlas}"`);
    if (s.anchor && !(s.anchor.x >= 0 && s.anchor.x <= 1 && s.anchor.y >= 0 && s.anchor.y <= 1)) issues.push(`${p}: anchor must be within [0,1]`);
    const anims = Object.entries(s.animations ?? {}); if (!anims.length) issues.push(`${p}: needs at least one animation`);
    for (const [name, a] of anims) {
      const q = `${p}.${name}`; const dirs = a.directions ?? 1;
      if (![1, 4, 8].includes(dirs)) issues.push(`${q}: directions must be 1, 4 or 8`);
      if (!(a.fps > 0)) issues.push(`${q}: fps must be > 0`);
      if (!Array.isArray(a.frames) || !a.frames.length) issues.push(`${q}: frames required`);
      else if (at) {
        const stride = a.dirStride ?? at.columns; const total = at.columns * at.rows;
        for (const f of a.frames) if (!(Number.isInteger(f) && f >= 0 && f + (dirs - 1) * stride < total)) issues.push(`${q}: frame ${f} out of atlas range`);
      }
    }
  });
  if (issues.length) throw new ManifestError(issues);
  const ids = new StableIdRegistry("sprites"); const lock = ids.assign(keys, opts.lock);
  const sprites = new Map<number, SpriteDef>();
  for (const s of m.sprites) {
    const at = atlases.get(s.atlas)!; const animList: Animation[] = [];
    Object.entries(s.animations).forEach(([name, a], i) => animList.push({ id: i, name, frames: a.frames, fps: a.fps, directions: a.directions ?? 1, dirStride: a.dirStride ?? at.columns, loop: a.loop ?? true }));
    const id = ids.id(s.key);
    sprites.set(id, { id, key: s.key, category: s.category, atlas: at, anchor: s.anchor ?? { x: 0.5, y: 0.9 }, animations: new Map(animList.map((a) => [a.name, a])), animList });
  }
  return { registry: new AssetRegistry(atlases, sprites, ids), lock };
}

/** Mix the asset id hash into the world schema hash so client/server handshakes reject mismatched content. */
export function installAssetHash(world: World, reg: AssetRegistry): void { world.addSchemaSalt("assets", reg.hash); }

/** Browser/Node fetch-based loader: manifest + optional lock (ids.lock.json next to it). */
export async function fetchManifest(url: string, fetcher: (u: string) => Promise<{ ok: boolean; json(): Promise<unknown> }> = fetch): Promise<ReturnType<typeof loadManifest>> {
  const res = await fetcher(url); if (!res.ok) throw new Error(`manifest fetch failed: ${url}`);
  const lockUrl = url.replace(/[^/]+$/, "ids.lock.json"); let lock: Record<string, number> | undefined;
  try { const l = await fetcher(lockUrl); if (l.ok) lock = (await l.json()) as Record<string, number>; } catch { /* optional */ }
  return loadManifest(await res.json(), lock ? { lock } : {});
}
