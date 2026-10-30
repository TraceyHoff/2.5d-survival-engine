/**
 * ADR-218: fire animation clock + hearth particles shared by the WebGL and Canvas2D renderers.
 *
 * Fires used to freeze: placed fired pieces (campfire/bonfire, furnace, fireplace, stoves, torch stands) resolved their
 * static building frame and were baked into the static chunk VBOs, the free-standing station bonfire drew frame 0 of its
 * idle anim, and the held torch resolved its sprite at t = 0. Lit fires now pick their looping `idle` frame from the
 * renderer clock (render time, not sim ticks, so it is smooth at any tick rate and keeps running while the sim stalls),
 * offset by a per-entity phase and a small per-entity rate jitter so neighbouring fires never flicker in lockstep.
 */

/** Deterministic 0..1 hash of an integer seed (entity index etc.). */
export function hash01(seed: number): number {
  let h = Math.imul((seed | 0) ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Piece fire state reported by the client (GameplayBindings.pieceLit). */
export const FireState = { Out: 0, Lit: 1, Hearth: 2 } as const;

/** Animation time (s) for a fire on entity `seed` at renderer time `now` (s): phase 0..8 s and rate 0.85..1.15x per entity. */
export function fireAnimTime(now: number, seed: number): number {
  const phase = hash01(seed) * 8; const rate = 0.85 + 0.3 * hash01(seed * 7 + 3);
  return now * rate + phase;
}

/** Frame index a looping animation of `count` frames at `fps` shows at fireAnimTime(now, seed). */
export function fireFrameIndex(now: number, seed: number, count: number, fps: number): number {
  if (count <= 1 || !(fps > 0)) return 0;
  const i = Math.floor(fireAnimTime(now, seed) * fps); return ((i % count) + count) % count;
}

/** One stateless hearth particle (Canvas2D embers/smoke): offsets in px from the flame base, size px and alpha 0..1. */
export interface HearthParticle { dx: number; dy: number; size: number; alpha: number; ember: boolean }

/**
 * Stateless ember + smoke particles for a lit hearth (Canvas2D has no particle layer): particle k of `n` cycles over
 * its own lifetime with a hashed start offset, so the set looks continuous with no per-frame state. `scale` = px per tile.
 */
export function hearthParticles(time: number, seed: number, n: number, scale: number, out: HearthParticle[] = []): HearthParticle[] {
  out.length = 0;
  for (let k = 0; k < n; k++) {
    const ember = k % 3 !== 2; const life = ember ? 1.1 : 2.4;
    const h0 = hash01(seed * 31 + k), h1 = hash01(seed * 17 + k * 5 + 1);
    const cyc = (time + h0 * life) / life; const c = Math.floor(cyc); const u = cyc - c; // 0..1 through this particle's life
    const hc = hash01(seed * 13 + k * 7 + c * 101); // re-rolled each cycle: new drift direction
    const rise = (ember ? 1.4 : 1.1) * scale * u; const drift = (hc - 0.5) * scale * (ember ? 0.5 : 0.7) * u + Math.sin((time + h1 * 6) * 3) * scale * 0.04;
    out.push({ dx: (h1 - 0.5) * scale * 0.3 + drift, dy: -scale * 0.35 - rise, size: ember ? Math.max(1, scale * 0.03 * (1 - u)) : scale * (0.09 + 0.16 * u),
      alpha: ember ? (1 - u) * (u < 0.1 ? u / 0.1 : 1) : 0.35 * (1 - u) * Math.min(1, u * 4), ember });
  }
  return out;
}

/** True when `anim` on sprite `def` is a looping multi-frame flame (the `idle` of bonfire / furnace / held torch art). */
export function isFireAnim(def: { animations: ReadonlyMap<string, { frames: readonly number[]; fps: number; loop: boolean }> }, anim = "idle"): boolean {
  const a = def.animations.get(anim); return !!a && a.loop && a.fps > 0 && a.frames.length > 1;
}

/**
 * Canvas2D / test path for a fired build piece's frame (mirrors the WebGL piece loop): the static building frame, except
 * a lit piece (fire > 0, intact, not a ghost) whose sprite has a looping `idle` flame plays it at fireAnimTime(time, seed),
 * and an out piece (fire = 0) with no own building state shows its `unlit` anim frame. Keeps the building frame's flipX.
 */
export function pieceFireFrame<F extends { flipX?: boolean }>(reg: {
  buildingFrame(id: number, rot: number, dmg: number, state?: number): F; animFrame(id: number, anim: string, rot: number, t: number): F;
  sprite(id: number): { animations: ReadonlyMap<string, { frames: readonly number[]; fps: number; loop: boolean }> };
}, vis: number, rot: number, dmg: number, state: number, fire: number | undefined, ghost: boolean, time: number, seed: number): F {
  const base = reg.buildingFrame(vis, rot, dmg, state);
  if (fire === undefined || dmg > 0 || ghost) return base;
  const def = reg.sprite(vis);
  if (fire > 0 && isFireAnim(def)) return { ...reg.animFrame(vis, "idle", rot, fireAnimTime(time, seed)), flipX: !!base.flipX };
  if (fire === 0 && state < 0 && def.animations.has("unlit")) return { ...reg.animFrame(vis, "unlit", rot, 0), flipX: !!base.flipX };
  return base;
}
