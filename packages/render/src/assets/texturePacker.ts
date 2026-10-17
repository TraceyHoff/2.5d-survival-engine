/**
 * TexturePacker "JSON (Hash)" importer -> @engine/assets manifest entries + a render-side rect table.
 *
 * The @engine/assets manifest describes grid atlases (frameW/frameH/columns/rows). TexturePacker atlases
 * have arbitrary trimmed rects with per-frame pivots, so the importer emits:
 *   - an AtlasJson with a *virtual* grid (columns = frame count, rows = 1; frame index = packed order),
 *   - SpriteJson entries whose animation frame indices point into that virtual grid,
 *   - a RectTable the renderer uses to resolve the real rect + pivot for each frame index.
 * Sprite ids/animations/directions then work exactly as for native manifests (AssetRegistry.frame etc).
 *
 * Frame naming convention (extension stripped):
 *   <sprite>                              static, 1 frame        e.g. "tree_oak"
 *   <sprite>/<anim>/<index>               non-directional anim   e.g. "campfire/burn/0"
 *   <sprite>/<anim>/<DIR>/<index>         directional anim       e.g. "zombie/walk/SE/003"
 *   DIR in E,SE,S,SW,W,NW,N,NE (8 facings) or E,S,W,N... any subset of 4 = SE,SW,NW,NE or E,S,W,N.
 *   Damage stages: anim names "damage0".."damage3" (or a "damaged" anim with stages as frames).
 */
import type { AtlasJson, SpriteJson, AnimationJson, Category, BuildingSpriteJson, ManifestJson } from "@engine/assets";

export interface TPRect { x: number; y: number; w: number; h: number }
export interface TPFrame {
  frame: TPRect; rotated?: boolean; trimmed?: boolean;
  spriteSourceSize?: TPRect; sourceSize?: { w: number; h: number };
  pivot?: { x: number; y: number }; duration?: number;
}
export interface TPJsonHash { frames: Record<string, TPFrame>; meta: { image: string; size?: { w: number; h: number }; scale?: string | number } }

/** Real rect of each virtual-grid frame index; anchor (ax, ay) is in px relative to the rect's top-left. */
export interface RectFrame { x: number; y: number; w: number; h: number; ax: number; ay: number }
export type RectTable = RectFrame[];

export interface TPImportOptions {
  /** Atlas key in the manifest (default: image file name without extension). */
  key?: string;
  /** Category for every sprite, or a resolver by sprite key. */
  category: Category | ((spriteKey: string) => Category);
  /** fps when frames carry no `duration` (default 10). */
  defaultFps?: number;
  /** Non-looping animation names (default death). */
  oneShot?: readonly string[];
  /** An `<image>_emissive.png` page with the same layout exists (sets AtlasJson.emissive). */
  emissive?: boolean;
  /** Building metadata per sprite key (footprint/layer/frames[rot][damage] as indices into this atlas' frames by name). */
  buildings?: Record<string, { piece: string; footprint: { w: number; h: number }; layer: number; frames: string[][] }>;
}
export interface TPImportResult { atlas: AtlasJson; sprites: SpriteJson[]; rects: RectTable; issues: string[] }

export const DIRS8 = ["E", "SE", "S", "SW", "W", "NW", "N", "NE"] as const;
const DIRS4_DIAG = ["SE", "SW", "NW", "NE"] as const;
const DIRS4_CARD = ["E", "S", "W", "N"] as const;
const KEY = /^[a-z0-9_]+$/;

interface Parsed { name: string; sprite: string; anim: string; dir: string | null; index: number; f: TPFrame }

export function parseFrameName(raw: string): { sprite: string; anim: string; dir: string | null; index: number } | null {
  const name = raw.replace(/\.(png|webp)$/i, "");
  const parts = name.split("/");
  if (parts.length === 1) return { sprite: parts[0]!, anim: "idle", dir: null, index: 0 };
  if (parts.length === 2) return /^\d+$/.test(parts[1]!) ? { sprite: parts[0]!, anim: "idle", dir: null, index: Number(parts[1]) } : { sprite: parts[0]!, anim: parts[1]!, dir: null, index: 0 };
  if (parts.length === 3) return { sprite: parts[0]!, anim: parts[1]!, dir: null, index: Number(parts[2]) };
  if (parts.length === 4) return { sprite: parts[0]!, anim: parts[1]!, dir: parts[2]!.toUpperCase(), index: Number(parts[3]) };
  return null;
}

export function importTexturePacker(json: TPJsonHash, opts: TPImportOptions): TPImportResult {
  const issues: string[] = [];
  if (!json || typeof json !== "object" || !json.frames || !json.meta?.image) {
    return { atlas: { key: opts.key ?? "invalid", image: "invalid.png", frameW: 1, frameH: 1, columns: 1, rows: 1 }, sprites: [], rects: [], issues: ["not a TexturePacker JSON-hash file (needs frames{} and meta.image)"] };
  }
  const key = opts.key ?? json.meta.image.replace(/^.*\//, "").replace(/\.[a-z]+$/i, "").toLowerCase().replace(/[^a-z0-9_]/g, "_");
  const parsed: Parsed[] = [];
  for (const [name, f] of Object.entries(json.frames)) {
    const p = parseFrameName(name);
    if (!p || !Number.isInteger(p.index) || p.index < 0) { issues.push(`${name}: name must be <sprite>[/<anim>[/<DIR>]/<index>]`); continue; }
    if (!KEY.test(p.sprite)) issues.push(`${name}: sprite key must match [a-z0-9_]+`);
    if (f.rotated) issues.push(`${name}: rotated frames are not supported (disable "Allow rotation")`);
    if (!(f.frame?.w > 0 && f.frame?.h > 0)) issues.push(`${name}: empty frame rect`);
    if (p.dir !== null && !(DIRS8 as readonly string[]).includes(p.dir)) issues.push(`${name}: unknown direction ${p.dir}`);
    parsed.push({ name, ...p, f });
  }
  // group sprite -> anim -> dir -> frames
  const sprites = new Map<string, Map<string, Map<string, Parsed[]>>>();
  for (const p of parsed) {
    let s = sprites.get(p.sprite); if (!s) sprites.set(p.sprite, (s = new Map()));
    let a = s.get(p.anim); if (!a) s.set(p.anim, (a = new Map()));
    const d = p.dir ?? "-"; let l = a.get(d); if (!l) a.set(d, (l = [])); l.push(p);
  }
  const rects: RectTable = []; const out: SpriteJson[] = [];
  let maxW = 1, maxH = 1;
  const nameIndex = new Map<string, number>();
  const push = (p: Parsed): number => {
    nameIndex.set(p.name.replace(/\.(png|webp)$/i, ""), rects.length);
    const f = p.f; const sss = f.spriteSourceSize ?? { x: 0, y: 0, w: f.frame.w, h: f.frame.h };
    const src = f.sourceSize ?? { w: f.frame.w, h: f.frame.h }; const piv = f.pivot ?? { x: 0.5, y: 1 };
    rects.push({ x: f.frame.x, y: f.frame.y, w: f.frame.w, h: f.frame.h, ax: piv.x * src.w - sss.x, ay: piv.y * src.h - sss.y });
    maxW = Math.max(maxW, src.w); maxH = Math.max(maxH, src.h);
    return rects.length - 1;
  };
  for (const sk of [...sprites.keys()].sort()) {
    const anims = sprites.get(sk)!; const animations: Record<string, AnimationJson> = {};
    let anchor: { x: number; y: number } | undefined;
    for (const ak of [...anims.keys()].sort()) {
      const dirs = anims.get(ak)!;
      const dirKeys = [...dirs.keys()];
      let order: readonly string[];
      if (dirKeys.length === 1 && dirKeys[0] === "-") order = ["-"];
      else if (dirKeys.length === 8) order = DIRS8;
      else if (dirKeys.length === 4 && DIRS4_DIAG.every((d) => dirs.has(d))) order = DIRS4_DIAG;
      else if (dirKeys.length === 4 && DIRS4_CARD.every((d) => dirs.has(d))) order = DIRS4_CARD;
      else if (dirKeys.length === 1) order = dirKeys; // single named direction: treat as non-directional
      else { issues.push(`${sk}/${ak}: directions must be all 8, or 4 (SE,SW,NW,NE | E,S,W,N); got ${dirKeys.join(",")}`); continue; }
      const lists = order.map((d) => (dirs.get(d) ?? []).sort((a, b) => a.index - b.index));
      const count = lists[0]!.length;
      if (lists.some((l) => l.length !== count)) { issues.push(`${sk}/${ak}: every direction needs the same frame count`); continue; }
      const base = rects.length;
      let dur = 0, durN = 0;
      for (const l of lists) for (const p of l) { push(p); if (p.f.duration) { dur += p.f.duration; durN++; } }
      const first = lists[0]![0]!.f; const src = first.sourceSize ?? { w: first.frame.w, h: first.frame.h }; const piv = first.pivot ?? { x: 0.5, y: 1 };
      anchor ??= { x: Math.min(1, Math.max(0, piv.x)), y: Math.min(1, Math.max(0, piv.y)) }; void src;
      const fps = durN ? Math.max(0.1, 1000 / (dur / durN)) : opts.defaultFps ?? 10;
      const directions = (order.length === 8 ? 8 : order.length === 4 ? 4 : 1) as 1 | 4 | 8;
      animations[ak] = {
        frames: Array.from({ length: count }, (_, i) => base + i), fps,
        ...(directions > 1 ? { directions, dirStride: count } : {}),
        ...((opts.oneShot ?? ["death"]).includes(ak) ? { loop: false } : {}),
      };
    }
    if (!Object.keys(animations).length) continue;
    const category = typeof opts.category === "function" ? opts.category(sk) : opts.category;
    const bm = opts.buildings?.[sk];
    let building: BuildingSpriteJson | undefined;
    if (bm) {
      const idx = (n: string): number => { const i = nameIndex.get(n.replace(/\.(png|webp)$/i, "")); if (i === undefined) { issues.push(`${sk}: building frame "${n}" not found`); return 0; } return i; };
      building = { piece: bm.piece, footprint: bm.footprint, layer: bm.layer, frames: bm.frames.map((row) => row.map(idx)) };
    }
    out.push({ key: sk, category, atlas: key, ...(anchor ? { anchor } : {}), animations, ...(building ? { building } : {}) });
  }
  const atlas: AtlasJson = { key, image: json.meta.image, frameW: maxW, frameH: maxH, columns: Math.max(1, rects.length), rows: 1, ...(opts.emissive ? { emissive: true } : {}) };
  return { atlas, sprites: out, rects, issues };
}

/** Merge imported TexturePacker atlases into a manifest (or a fresh one). Returns the manifest + rect tables by atlas key. */
export function mergeTexturePacker(base: ManifestJson | null, imports: TPImportResult[]): { manifest: ManifestJson; rects: Record<string, RectTable>; issues: string[] } {
  const manifest: ManifestJson = base ? { ...base, atlases: [...base.atlases], sprites: [...base.sprites] } : { version: 1, atlases: [], sprites: [] };
  const rects: Record<string, RectTable> = {}; const issues: string[] = [];
  for (const r of imports) {
    issues.push(...r.issues.map((i) => `${r.atlas.key}: ${i}`));
    const ai = manifest.atlases.findIndex((a) => a.key === r.atlas.key);
    if (ai >= 0) manifest.atlases[ai] = r.atlas; else manifest.atlases.push(r.atlas);
    for (const s of r.sprites) { const si = manifest.sprites.findIndex((x) => x.key === s.key); if (si >= 0) manifest.sprites[si] = s; else manifest.sprites.push(s); }
    rects[r.atlas.key] = r.rects;
  }
  return { manifest, rects, issues };
}
