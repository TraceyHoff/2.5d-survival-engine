import { defineEvent } from "./events.js";
import { defineResource, type World } from "./world.js";
import type { Entity } from "./entity.js";
import { Membership, PlayerId } from "./social.js";
import { Permissions, ZoneFlag } from "./permissions.js";
import { Transform } from "./builtins.js";

/**
 * Damage plumbing only: ordered hook stages and a friendly-fire resolver. Gameplay owns damage types, armor
 * math and death; Netcode owns lag compensation (PositionHistory / rangeCheckWithSlack in @engine/net).
 */
export const DamageRecordSchema = { source: "u32", target: "u32", amount: "f32", type: "u8", tick: "u32" } as const;
export interface DamageEvent { source: Entity; target: Entity; amount: number; type: number; tick: number; /** set by a hook to drop the hit */ cancelled?: boolean; /** free-form flags (crit, headshot...) */ flags?: number }
/** Emitted (queued) after a hit is applied with amount > 0. */
export const DamageApplied = defineEvent<DamageEvent>("core.DamageApplied");
export type DamageStage = "pre" | "mitigation" | "post";
export type DamageHook = (world: World, ev: DamageEvent) => void;
export type CanDamageHook = (world: World, source: Entity, target: Entity, type: number) => boolean | undefined;

export class DamagePipeline {
  private stages: Record<DamageStage, { order: number; name: string; fn: DamageHook }[]> = { pre: [], mitigation: [], post: [] };
  private canHooks: CanDamageHook[] = [];
  /** Friendly fire: allow damage between players sharing a party/clan (default false). */
  friendlyFire = false;
  /** Add a hook; lower order runs first (ties: insertion order). */
  add(stage: DamageStage, name: string, fn: DamageHook, order = 0): () => void {
    const l = this.stages[stage]; const h = { order, name, fn }; l.push(h); l.sort((a, b) => a.order - b.order);
    return () => { const i = l.indexOf(h); if (i >= 0) l.splice(i, 1); };
  }
  /** Gameplay override for canDamage; first non-undefined answer wins. */
  addCanDamage(fn: CanDamageHook): () => void { this.canHooks.push(fn); return () => { const i = this.canHooks.indexOf(fn); if (i >= 0) this.canHooks.splice(i, 1); }; }
  hookNames(stage: DamageStage): string[] { return this.stages[stage].map((h) => h.name); }
  /**
   * Default resolution: hooks → safe zone at either position blocks player-vs-player → PvP requires a PvP zone flag
   * at the target if `requirePvPZone` → shared party/clan blocks unless friendlyFire. Non-player damage is allowed.
   */
  requirePvPZone = false;
  canDamage(world: World, source: Entity, target: Entity, type = 0): boolean {
    for (const h of this.canHooks) { const r = h(world, source, target, type); if (r !== undefined) return r; }
    const sp = world.getField(source, PlayerId, "id") as number | undefined, tp = world.getField(target, PlayerId, "id") as number | undefined;
    if (!sp || !tp || source === target) return true;
    const perms = world.getResource(Permissions);
    if (perms) {
      const zone = (e: Entity) => { const t = world.get(e, Transform); return t ? perms.claims.zoneAt(t.x, t.y) : 0; };
      const zs = zone(source), zt = zone(target);
      if ((zs | zt) & ZoneFlag.Safe) return false;
      if (this.requirePvPZone && !(zt & ZoneFlag.PvP)) return false;
      if (!this.friendlyFire && perms.groups.shareGroup(sp, tp)) return false;
    }
    if (!this.friendlyFire) {
      const a = world.get(source, Membership), b = world.get(target, Membership);
      if (a && b && ((a.partyId && a.partyId === b.partyId) || (a.clanId && a.clanId === b.clanId))) return false;
    }
    return true;
  }
  /** Runs canDamage then pre → mitigation → post. Returns the final record (amount 0 / cancelled if blocked). */
  apply(world: World, ev: Omit<DamageEvent, "tick"> & { tick?: number }): DamageEvent {
    const e: DamageEvent = { ...ev, tick: ev.tick ?? world.tick };
    if (!this.canDamage(world, e.source, e.target, e.type)) { e.cancelled = true; e.amount = 0; return e; }
    for (const st of ["pre", "mitigation", "post"] as const) {
      for (const h of this.stages[st]) { h.fn(world, e); if (e.cancelled) { e.amount = 0; return e; } }
      if (st === "mitigation") e.amount = Math.max(0, e.amount);
    }
    if (e.amount > 0) world.events.emit(DamageApplied, e);
    return e;
  }
}
export const Damage = defineResource<DamagePipeline>("DamagePipeline");
export function installDamage(world: World): DamagePipeline { world.register(PlayerId); world.register(Membership); let d = world.getResource(Damage); if (!d) world.setResource(Damage, (d = new DamagePipeline())); return d; }
