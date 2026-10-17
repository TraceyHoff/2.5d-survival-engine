/**
 * Vitals: consumables, hunger/thirst decay, stamina drain/regen, body temperature, damage and death.
 * Order (simulation phase): vitals.consume -> vitals.tick -> vitals.death.
 * Deterministic and RNG-free, so the client predicts it for its own entity.
 */
import { entityIndex, type Entity, type World } from "@engine/core";
import { DamageCause, Dead, Exposure, Health, IntentAction, PlayerIntent, Survival, VitalsModifiers, VitalsState } from "../components.js";
import { gameplayDefs, isAuthority } from "../config.js";
import { secondsToTicks } from "../defs.js";
import { Died, ItemConsumed, Vital, VitalDepleted } from "../events.js";
import { slotItem, takeFromSlot } from "../inventory.js";

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** IntentAction.Use on a food slot: eat/drink one unit. */
export function consumeSystem(world: World): void {
  const defs = gameplayDefs(world);
  const intent = world.store(PlayerIntent);
  for (const e of world.query([PlayerIntent, Survival, Health], [Dead])) {
    const s = intent.slot(entityIndex(e));
    if (intent.data.action[s] !== IntentAction.Use) continue;
    const { item } = slotItem(world, e, intent.data.slot[s]!);
    const food = defs.items.get(item)?.food; if (!food) continue;
    takeFromSlot(world, e, intent.data.slot[s]!);
    const sv = world.get(e, Survival)!; const hp = world.get(e, Health)!;
    world.set(e, Survival, { hunger: clamp(sv.hunger + food.hunger, 0, 100), thirst: clamp(sv.thirst + food.thirst, 0, 100) });
    world.set(e, Health, { hp: clamp(hp.hp + food.health, 0, hp.max) });
    world.events.emit(ItemConsumed, { entity: e, item });
  }
}

/** Blocks stamina regen for the configured delay (called by sprinting and by gathering). */
export function spendStamina(world: World, e: Entity, amount: number, dt: number): boolean {
  const st = world.getField(e, Survival, "stamina"); if (st === undefined || st < amount) return false;
  world.setField(e, Survival, "stamina", st - amount);
  if (world.has(e, VitalsState)) {
    world.setField(e, VitalsState, "staminaRegenAtTick", world.tick + secondsToTicks(gameplayDefs(world).vitals.staminaRegenDelaySeconds, dt));
  }
  if (st - amount <= 0) world.events.emit(VitalDepleted, { entity: e, vital: Vital.Stamina });
  return true;
}

export function vitalsSystem(world: World, dt: number): void {
  const vt = gameplayDefs(world).vitals;
  const sv = world.store(Survival); const hs = world.store(Health); const vs = world.store(VitalsState);
  const mods = world.store(VitalsModifiers); const intent = world.store(PlayerIntent); const ex = world.store(Exposure);
  const delayTicks = secondsToTicks(vt.staminaRegenDelaySeconds, dt);

  for (const e of world.query([Survival, Health, VitalsState], [Dead])) {
    const idx = entityIndex(e);
    const s = sv.slot(idx); const h = hs.slot(idx); const v = vs.slot(idx);
    const hungerMul = mods.has(idx) ? mods.data.hungerMul[mods.slot(idx)]! : 1;
    const thirstMul = mods.has(idx) ? mods.data.thirstMul[mods.slot(idx)]! : 1;
    const regenMul = mods.has(idx) ? mods.data.staminaRegenMul[mods.slot(idx)]! : 1;

    // hunger / thirst
    const hunger0 = sv.data.hunger[s]!, thirst0 = sv.data.thirst[s]!;
    const hunger = Math.max(0, hunger0 - vt.hungerDecayPerSec * hungerMul * dt);
    const thirst = Math.max(0, thirst0 - vt.thirstDecayPerSec * thirstMul * dt);
    sv.data.hunger[s] = hunger; sv.data.thirst[s] = thirst;
    if (hunger0 > 0 && hunger === 0) world.events.emit(VitalDepleted, { entity: e, vital: Vital.Hunger });
    if (thirst0 > 0 && thirst === 0) world.events.emit(VitalDepleted, { entity: e, vital: Vital.Thirst });

    // stamina
    const max = sv.data.maxStamina[s]!; let stamina = sv.data.stamina[s]!;
    const sprinting = intent.has(idx) && intent.data.sprint[intent.slot(idx)] === 1 && intent.data.moving[intent.slot(idx)] === 1;
    if (sprinting && stamina > 0) {
      stamina = Math.max(0, stamina - vt.sprintStaminaDrainPerSec * dt);
      vs.data.staminaRegenAtTick[v] = world.tick + delayTicks;
      if (stamina === 0) world.events.emit(VitalDepleted, { entity: e, vital: Vital.Stamina });
    } else if (world.tick >= vs.data.staminaRegenAtTick[v]!) {
      const needsMul = hunger < vt.lowNeedsThreshold || thirst < vt.lowNeedsThreshold ? vt.lowNeedsStaminaRegenMul : 1;
      stamina = Math.min(max, stamina + vt.staminaRegenPerSec * regenMul * needsMul * dt);
    }
    sv.data.stamina[s] = stamina;

    // body temperature drifts toward the felt temperature outside the comfort band
    let body = sv.data.bodyTemp[s]!;
    if (ex.has(idx)) {
      const felt = ex.data.feltTemp[ex.slot(idx)]!;
      if (felt < vt.comfortMin) body -= (vt.comfortMin - felt) * vt.bodyTempChangePerDegreePerSec * dt;
      else if (felt > vt.comfortMax) body += (felt - vt.comfortMax) * vt.bodyTempChangePerDegreePerSec * dt;
      else {
        const step = vt.bodyTempRecoverPerSec * dt; const d = vt.bodyTempNormal - body;
        body += Math.abs(d) <= step ? d : Math.sign(d) * step;
      }
      body = clamp(body, vt.bodyTempMin, vt.bodyTempMax);
      sv.data.bodyTemp[s] = body;
    }
    sv.markChanged(idx);

    // damage / regen
    let dmg = 0; let cause: DamageCause = DamageCause.None;
    const hurt = (amount: number, c: DamageCause): void => { if (amount > 0) { dmg += amount; cause = c; } };
    if (hunger === 0) hurt(vt.starvationDps * dt, DamageCause.Starvation);
    if (thirst === 0) hurt(vt.dehydrationDps * dt, DamageCause.Dehydration);
    if (body < vt.hypothermiaBelow) hurt(vt.exposureDps * dt, DamageCause.Hypothermia);
    if (body > vt.hyperthermiaAbove) hurt(vt.exposureDps * dt, DamageCause.Hyperthermia);
    let hp = hs.data.hp[h]!;
    if (dmg > 0) { hp -= dmg; vs.data.lastDamageCause[v] = cause; }
    else if (hunger >= vt.wellFedThreshold && thirst >= vt.wellFedThreshold) hp = Math.min(hs.data.max[h]!, hp + vt.healthRegenPerSec * dt);
    hs.data.hp[h] = Math.max(0, hp);
    hs.markChanged(idx); vs.markChanged(idx);
  }
}

/** hp <= 0 -> Dead {cause, tick} + Died event. Authority decides death; clients see Dead by replication. */
export function deathSystem(world: World): void {
  if (!isAuthority(world)) return;
  const hs = world.store(Health);
  for (const e of world.query([Health], [Dead])) {
    const idx = entityIndex(e);
    if (hs.data.hp[hs.slot(idx)]! > 0) continue;
    const cause = (world.getField(e, VitalsState, "lastDamageCause") ?? DamageCause.Combat) as DamageCause;
    world.add(e, Dead, { cause, tick: world.tick });
    world.events.emit(Died, { entity: e, cause });
  }
}
