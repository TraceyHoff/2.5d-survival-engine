/**
 * ADR-238: a small dust puff where a ground bag despawned. The server removes a LootBag when its replicated timer
 * runs out (bagExpiryTick: despawnAtTick, or emptiedTick + the emptied grace), so the client remembers each bag's
 * position + expiry and puffs when one vanishes at (about) that tick; bags that merely leave interest range (or
 * the bag a chunk unload drops) vanish early and get no puff. No per-frame allocation once a bag is known.
 */
import { Transform, type Entity, type World } from "@engine/core";
import { LootBag, bagExpiryTick, PERMANENT_DESPAWN } from "@engine/gameplay";

/** Removal counts as a despawn from this many ticks before the expiry (system cadence + replication) ... */
export const PUFF_EARLY_TICKS = 20;
/** ... up to this many after it (a late snapshot). */
export const PUFF_LATE_TICKS = 80;
const MAX_TRACKED = 1024;

export class LootPuffTracker {
  /** entity -> [x, y, z, expiryTick, lastSeenFrame] */
  private readonly bags = new Map<Entity, Float64Array>();
  private readonly sb = { owner: 0, despawnAtTick: 0, spawnTick: 0, kind: 0, emptiedTick: 0 }; private readonly tf = { x: 0, y: 0, z: 0 };
  private frame = 0;
  private readonly sweep = (r: Float64Array, e: Entity): void => {
    if (r[4] === this.frame) return; this.bags.delete(e);
    const t = this.tick; if (this.live && r[3]! < PERMANENT_DESPAWN && t >= r[3]! - PUFF_EARLY_TICKS && t <= r[3]! + PUFF_LATE_TICKS) this.onPuff!(r[0]!, r[1]!, r[2]!);
  };
  private tick = 0; private live = false; private onPuff: ((x: number, y: number, z: number) => void) | undefined;
  reset(): void { this.bags.clear(); }
  get tracked(): number { return this.bags.size; }
  /** Call once per frame with the replica world; `puff` fires for every bag that despawned since the last call. */
  step(w: World, live: boolean, puff: (x: number, y: number, z: number) => void): void {
    this.frame++; if (!w.isRegistered(LootBag)) return;
    const st = w.store(LootBag);
    for (let k = 0; k < st.size; k++) {
      const e = st.dense[k]! as Entity; const lb = w.getInto(e, LootBag, this.sb); const t = w.getInto(e, Transform, this.tf); if (!lb || !t) continue;
      let r = this.bags.get(e); if (!r) { if (this.bags.size >= MAX_TRACKED) continue; r = new Float64Array(5); this.bags.set(e, r); }
      r[0] = t.x; r[1] = t.y; r[2] = t.z; r[3] = bagExpiryTick(lb); r[4] = this.frame;
    }
    this.tick = w.tick; this.live = live; this.onPuff = puff; this.bags.forEach(this.sweep); this.onPuff = undefined;
  }
}
