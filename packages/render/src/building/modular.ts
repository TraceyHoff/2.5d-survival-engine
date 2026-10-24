/**
 * Modular building rendering helpers (ADR-104, gameplay building/modular.ts). Pure functions, unit-tested.
 *  - Triangle pieces (Placement.Tri, 12 rotation steps of 30°): an equilateral triangle repeats every 120°, so the 12
 *    steps are only 4 distinct orientations (0/30/60/90°). Art's unique4 rows are drawn at 0/90/180/270° = 0/90/60/30°
 *    modulo 120°, so every step maps EXACTLY onto one row (no quarter-turn snapping).
 *  - BuildPiece.rotation bit 0x80 (ROT_EXACT_PIVOT): pivot at the piece's exact Transform x/y (triangle centroid,
 *    free/vertex-snapped corner) instead of the floored footprint tile. Low 2 bits stay the art row.
 *  - Streaming fallback chain for a `<piece>@tier<N>` sprite whose tier page is not resident yet.
 *  - Gridless cutaway: a cover index built from the drawn pieces themselves (the client has no BuildingGrid).
 */
export const ROT_EXACT_PIVOT = 0x80;
export const TRI_ROT_STEPS = 12;

/** Art row (0-3, unique4 rows at 0/90/180/270°) for a triangle rotation step (0-11, 30° each). */
export function triArtRow(rot: number): number {
  const r = ((Math.round(rot) % 4) + 4) % 4; // orientation mod 120° in 30° units
  return [0, 3, 2, 1][r]!;
}

/** Art row for any piece: triangles map exactly (triArtRow); others round to the nearest quarter turn. */
export function pieceArtRow(rot: number, rotSteps: number): number {
  if (rotSteps === TRI_ROT_STEPS) return triArtRow(rot);
  if (rotSteps === 4) return ((rot % 4) + 4) % 4;
  return (((Math.round((rot * 4) / Math.max(1, rotSteps))) % 4) + 4) % 4;
}

/** Family default art for pieces that have no bare-key art of their own (ADR-104 pieces 52-67). */
const FAMILY: [RegExp, string[]][] = [
  [/^wall_corner/, ["wall_corner", "pillar"]],
  [/^wall_/, ["wall"]],
  [/^foundation_/, ["foundation"]],
  [/^floor_/, ["floor"]],
  [/^ceiling/, ["floor"]],
  [/^roof_(gable|ridge)/, ["roof_ridge", "roof_slope"]],
  [/^roof_/, ["roof_flat", "roof_slope"]],
];

/** Split "wall@tier2" -> { base: "wall", tier: 2 }. */
export function splitTierKey(piece: string): { base: string; tier: number } {
  const m = /^(.*)@tier(\d+)$/.exec(piece); return m ? { base: m[1]!, tier: Number(m[2]) } : { base: piece, tier: 0 };
}

/**
 * Keys to try (in order) while `<base>@tier<N>` streams in: the bare key, the other tiers (only if already resident;
 * caller checks), then the family default. Never contains the piece's own key.
 */
export function streamingFallbackKeys(piece: string): string[] {
  const { base, tier } = splitTierKey(piece); const out: string[] = [];
  if (tier) out.push(base);
  for (let t = 1; t <= 4; t++) if (t !== tier) out.push(`${base}@tier${t}`);
  for (const [re, keys] of FAMILY) if (re.test(base)) { for (const k of keys) if (k !== base) out.push(k); break; }
  return out;
}

/** Crack overlay anim name for damage stage 1-3 (gameplay crackOverlayAnim). */
export const crackAnim = (stage: number): string | undefined => (stage >= 1 && stage <= 3 ? `stage${stage}` : undefined);

/**
 * Attach-point px offset (from the sprite pivot, 1x) -> world offset. dx is screen-horizontal (negated when mirrored),
 * dy screen-vertical (negative = up = height).
 */
export function attachToWorld(dx: number, dy: number, flipX: boolean, iso: { tileW: number; zStep: number }): { x: number; y: number; z: number } {
  const sx = flipX ? -dx : dx; const k = sx / iso.tileW; // (x - y) * tileW/2 = sx, x + y unchanged
  return { x: k, y: -k, z: -dy / iso.zStep };
}

/**
 * Painter's depth key of a building piece (centre pivot): front corner of its front-most tile + height. Stacked
 * floors sort by level because every level adds FLOOR_HEIGHT_LEVELS * zf (= 1.0 with the default iso = one full tile
 * row), which is exactly the screen offset of one floor.
 */
export function pieceDepthKey(ax: number, ay: number, fw: number, fh: number, z: number, zf: number, bias: number): number {
  return ax + fw + ay + fh - 2 + 1.95 + z * zf + bias;
}

/** Cover index: which tiles have a deck/roof piece per level (from the pieces drawn last frame). */
export class PieceCoverIndex {
  /** "x,y" -> bit mask of levels with any piece; roofs/decks tracked separately */
  private any = new Map<string, number>(); private deck = new Map<string, number>(); private roof = new Map<string, number>();
  size = 0;
  clear(): void { this.any.clear(); this.deck.clear(); this.roof.clear(); this.size = 0; }
  add(ax: number, ay: number, fw: number, fh: number, level: number, deck: boolean, roof: boolean): void {
    const bit = 1 << Math.min(30, level); this.size++;
    for (let y = ay; y < ay + fh; y++) for (let x = ax; x < ax + fw; x++) {
      const k = `${x},${y}`;
      this.any.set(k, (this.any.get(k) ?? 0) | bit);
      if (deck) this.deck.set(k, (this.deck.get(k) ?? 0) | bit);
      if (roof) this.roof.set(k, (this.roof.get(k) ?? 0) | bit);
    }
  }
  /** Same semantics as cutawayRegion(grid): tiles of the building around (tx,ty) when covered above `level`. */
  region(tx: number, ty: number, level: number, maxTiles = 600): Set<string> | null {
    const above = ~((2 << Math.min(30, level)) - 1); const bit = 1 << Math.min(30, level);
    const covered = (k: string): boolean => (((this.any.get(k) ?? 0) & above) !== 0) || (((this.roof.get(k) ?? 0) & (bit | above)) !== 0);
    const k0 = `${tx},${ty}`; if (!covered(k0)) return null;
    const inside = (k: string): boolean => covered(k) || ((this.deck.get(k) ?? 0) & bit) !== 0;
    const seen = new Set<string>([k0]); const q: [number, number][] = [[tx, ty]];
    while (q.length && seen.size < maxTiles) {
      const [x, y] = q.shift()!;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx, ny = y + dy, k = `${nx},${ny}`;
        if (!seen.has(k) && inside(k)) { seen.add(k); q.push([nx, ny]); }
      }
    }
    return seen;
  }
}
