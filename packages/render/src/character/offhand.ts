/**
 * ADR-135 off-hand worn slot (e.g. reverse-grip knives): sprite lookup, hand anchor and per-facing draw order.
 * Pure helpers so the policy is unit-testable without GL; SpriteRenderer.emitHeld does the drawing.
 */
import type { HandAnchor } from "../assets/atlasManager.js";

/** Sprite keys to try for an off-hand item, in order: dedicated `offhand_<key>` art, then the main-hand `held_<key>`. */
export function offHandSpriteKeys(itemKey: string): readonly [string, string] { return [`offhand_${itemKey}`, `held_${itemKey}`]; }

/** First existing sprite id for an off-hand item key (`tryId` = registry.ids.sprites.tryId); undefined = draw nothing. */
export function resolveOffHandSprite(itemKey: string | undefined, tryId: (key: string) => number | undefined): number | undefined {
  if (!itemKey) return undefined;
  for (const k of offHandSpriteKeys(itemKey)) { const id = tryId(k); if (id !== undefined) return id; }
  return undefined;
}

/** Facing index 0=SE,1=S,2=SW,3=W,4=NW,5=N,6=NE,7=E. Facing away from the camera (NW, N, NE): left hand is behind the body. */
export const OFFHAND_BEHIND_FACINGS: ReadonlySet<number> = new Set([4, 5, 6]);

/** Draw the off-hand item behind the body? The anchor's own `behind` flag (Art's frameMeta) wins; else facing away. */
export function offHandBehind(facing: number, anchorBehind = false): boolean { return anchorBehind || OFFHAND_BEHIND_FACINGS.has(((facing % 8) + 8) % 8); }

/**
 * Off-hand anchor for a body frame: frameMeta `handL` when Art has authored it; otherwise the `handR` anchor mirrored
 * across the body pivot (x' = 2*ax - x, angle negated) as a stand-in; undefined (skip the draw) when neither exists.
 */
export function offHandAnchor<F extends { ax: number }>(handOf: (r: F, name?: string) => HandAnchor | undefined, body: F): { anchor: HandAnchor; fallback: boolean } | undefined {
  const l = handOf(body, "handL"); if (l) return { anchor: l, fallback: false };
  const r = handOf(body, "handR"); if (!r) return undefined;
  return { anchor: { ...r, x: 2 * body.ax - r.x, angle: -r.angle, behind: false }, fallback: true };
}
