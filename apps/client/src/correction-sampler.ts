/**
 * ADR-208: render predicted entities at sim + NetClient reconciliation offset.
 *
 * Before ADR-208 the client never consumed NetClient.correctionOffset, so every reconciliation that moved the local
 * player (lost/late input, server-side collision, knockback) showed up as a one-frame pop of the whole correction, and
 * the camera (which follows the player) popped the whole screen with it. The offset decays once per network tick
 * (tau correctionSmoothingSec), so it is sampled once per tick ("cur") and the previous tick's sample is kept for
 * PrevTransform: lerp(prev + offPrev, cur + offCur, alpha) is continuous across a reconciliation. Allocation-free per frame.
 */
import type { Entity } from "@engine/core";

export interface CorrectionSource { correctionInto(e: Entity, out: { x: number; y: number; z: number }): boolean }
type Xyz = { x: number; y: number; z: number };
interface Slot { tick: number; cx: number; cy: number; cz: number; px: number; py: number; pz: number }

export class CorrectionSampler {
  private at = new Map<Entity, Slot>(); private s = { x: 0, y: 0, z: 0 };
  /** Offsets cur/prev in place (prev may be === cur: then `scratch` becomes prev). Returns the prev to use. */
  apply<P extends Xyz>(src: CorrectionSource, e: Entity, tick: number, cur: Xyz, prev: P, scratch: P): P {
    const has = src.correctionInto(e, this.s); let c = this.at.get(e);
    if (!c) { if (!has) return prev; c = { tick: -1, cx: 0, cy: 0, cz: 0, px: 0, py: 0, pz: 0 }; this.at.set(e, c); }
    if (c.tick !== tick) { c.px = c.cx; c.py = c.cy; c.pz = c.cz; c.tick = tick; c.cx = has ? this.s.x : 0; c.cy = has ? this.s.y : 0; c.cz = has ? this.s.z : 0; }
    if ((prev as Xyz) === cur) { Object.assign(scratch, cur); prev = scratch; }
    cur.x += c.cx; cur.y += c.cy; cur.z += c.cz; prev.x += c.px; prev.y += c.py; prev.z += c.pz;
    if (!has && !c.cx && !c.cy && !c.cz && !c.px && !c.py && !c.pz) this.at.delete(e);
    return prev;
  }
  forget(e: Entity): void { this.at.delete(e); }
  get size(): number { return this.at.size; }
}
