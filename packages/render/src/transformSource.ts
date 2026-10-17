/**
 * Pluggable render-transform source. The renderer's built-in path is the standalone/offline
 * PrevTransform -> Transform lerp by alpha. A TransformSource can override specific entities, e.g.
 * the netcode client's predicted local player (sim + visual correction offset that decays after a
 * server correction). Remote entities need nothing special: the net client writes their interpolated
 * Transform (2 ticks behind) into the world every tick, so the standard lerp already shows the
 * interpolation output. Sources must never write to sim state.
 */
import { entityIndex, lerpAngle, PrevTransform, Transform, type Entity, type World } from "@engine/core";

export interface TransformSource {
  /** Entities whose transform comes from sample(); all others use the default lerp. */
  readonly entities: ReadonlySet<number>;
  /** Fill out = [x, y, z, facing]. Return false to fall back to the default lerp. */
  sample(world: World, e: Entity, alpha: number, out: Float32Array): boolean;
}

/** Default lerp (exported so sources can build on it). */
export function lerpTransform(world: World, e: Entity, alpha: number, out: Float32Array): boolean {
  const tr = world.store(Transform), pv = world.store(PrevTransform); const i = entityIndex(e);
  const ts = tr.slot(i); if (ts < 0) return false; const ps = pv.slot(i);
  const x = tr.data.x[ts]!, y = tr.data.y[ts]!, z = tr.data.z[ts]!, f = tr.data.facing[ts]!;
  if (ps < 0) { out[0] = x; out[1] = y; out[2] = z; out[3] = f; return true; }
  out[0] = pv.data.x[ps]! + (x - pv.data.x[ps]!) * alpha; out[1] = pv.data.y[ps]! + (y - pv.data.y[ps]!) * alpha;
  out[2] = pv.data.z[ps]! + (z - pv.data.z[ps]!) * alpha; out[3] = lerpAngle(pv.data.facing[ps]!, f, alpha);
  return true;
}

/** Structural view of @engine/net's NetClient (no dependency on the net package). */
export interface CorrectionProvider { correctionOffset(e: Entity): Record<string, number> | undefined }

/**
 * Predicted entities (world.predicted) render at lerp(sim) + client.correctionOffset(e).
 * Usage: renderer.setTransformSource(netTransformSource(world, client)).
 */
export function netTransformSource(world: World, client: CorrectionProvider): TransformSource {
  return {
    entities: world.predicted as ReadonlySet<number>,
    sample(w, e, alpha, out) {
      if (!lerpTransform(w, e, alpha, out)) return false;
      const off = client.correctionOffset(e);
      if (off) { out[0]! += off.x ?? 0; out[1]! += off.y ?? 0; out[2]! += off.z ?? 0; out[3]! += off.facing ?? 0; }
      return true;
    },
  };
}
