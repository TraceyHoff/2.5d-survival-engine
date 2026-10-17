/**
 * Basic combat (authority): Attack intent -> weapon from the held item (fists fallback), cooldown, range (+ slack),
 * stamina; damage to creatures (Health) or structures (batched piece damage x weapon.structureMul).
 * Death is handled by vitals deathSystem (hp <= 0 -> Dead); zombie corpses are removed after corpseSeconds.
 * The owning client may predict the swing (cooldown/stamina/AnimState) but never damage.
 */
import { entityIndex, Transform, type Entity, type World } from "@engine/core";
import { Anim, AnimState, Attacker, BuildPiece, DamageCause, Dead, Equipment, Health, IntentAction, Inventory, NO_SLOT, PlayerIntent, Survival, VitalsState, Zombie } from "../components.js";
import { gameplayDefs, isAuthority, rangeSlack } from "../config.js";
import { secondsToTicks, type WeaponDef } from "../defs.js";
import { AttackSwing, Damaged, emit } from "../events.js";
import { slotItem } from "../inventory.js";
import { damagePiece } from "../building/integrity.js";
import { makeNoise } from "../systems/noise.js";
import { distance } from "../systems/fuel.js";
import { spendStamina } from "../systems/vitals.js";

export const FISTS: WeaponDef = { damage: 5, range: 1.0, cooldownSeconds: 0.6, staminaCost: 3, structureMul: 0.2 };
export function heldWeapon(world: World, e: Entity): WeaponDef {
  const slot = world.getField(e, Equipment, "mainHandSlot");
  if (slot === undefined || slot === NO_SLOT || !world.has(e, Inventory)) return FISTS;
  return gameplayDefs(world).items.get(slotItem(world, e, slot).item)?.weapon ?? FISTS;
}

export function setAnim(world: World, e: Entity, anim: Anim): void {
  const cur = world.getField(e, AnimState, "anim");
  if (cur === undefined) world.add(e, AnimState, { anim, startTick: world.tick });
  else if (cur !== anim) world.set(e, AnimState, { anim, startTick: world.tick });
}

/** Applies damage (authority): creatures lose hp now; structures get batched damage. */
export function applyDamage(world: World, target: Entity, amount: number, source: Entity, cause: DamageCause = DamageCause.Combat): void {
  if (!isAuthority(world) || world.isReplaying || amount <= 0 || !world.isAlive(target)) return;
  if (world.has(target, BuildPiece)) { damagePiece(world, target, amount); return; }
  const hp = world.getField(target, Health, "hp"); if (hp === undefined || world.has(target, Dead)) return;
  world.setField(target, Health, "hp", Math.max(0, hp - amount));
  if (world.has(target, VitalsState)) world.setField(target, VitalsState, "lastDamageCause", cause);
  emit(world, Damaged, { target, source, amount, cause });
  if (world.has(target, AnimState) && hp - amount > 0) setAnim(world, target, Anim.Hurt);
}

export function combatSystem(world: World, dt: number): void {
  const it = world.store(PlayerIntent); const authority = isAuthority(world); const noise = gameplayDefs(world).noise;
  for (const e of world.query([PlayerIntent, Attacker, Transform], [Dead])) {
    const s = it.slot(entityIndex(e)); if (it.data.action[s] !== IntentAction.Attack) continue;
    const target = it.data.target[s]!;
    if (world.tick < world.getField(e, Attacker, "cooldownUntilTick")!) continue;
    if (!world.isAlive(target) || !(world.has(target, Health) || world.has(target, BuildPiece)) || world.has(target, Dead)) continue;
    const w = heldWeapon(world, e);
    const reach = w.range + (world.has(target, BuildPiece) ? 0.6 : 0.4) + rangeSlack(world, e);
    if (distance(world, e, target) > reach) continue;
    if (world.has(e, Survival) && !spendStamina(world, e, w.staminaCost, dt)) continue;
    world.setField(e, Attacker, "cooldownUntilTick", world.tick + secondsToTicks(w.cooldownSeconds, dt));
    if (world.has(e, AnimState)) setAnim(world, e, Anim.Attack);
    emit(world, AttackSwing, { entity: e, target });
    if (!authority) continue;
    applyDamage(world, target, world.has(target, BuildPiece) ? w.damage * w.structureMul : w.damage, e);
    makeNoise(world, e, noise.attack);
  }
}

/** Removes dead zombies after corpseSeconds (authority, postSim). */
export function corpseSystem(world: World, dt: number): void {
  if (!isAuthority(world) || world.isReplaying) return;
  const ticks = secondsToTicks(gameplayDefs(world).ai.corpseSeconds, dt);
  for (const z of world.query([Zombie, Dead])) {
    const at = world.getField(z, Dead, "tick")!;
    if (world.getField(z, AnimState, "anim") !== Anim.Die) setAnim(world, z, Anim.Die);
    if (world.tick >= at + ticks) world.destroy(z);
  }
  for (const p of world.query([Survival, Dead, AnimState])) if (world.getField(p, AnimState, "anim") !== Anim.Die) setAnim(world, p, Anim.Die);
}
export { Health };
