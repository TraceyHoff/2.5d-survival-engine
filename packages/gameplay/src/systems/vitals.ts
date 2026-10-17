/**
 * Vitals: consumables, hunger/thirst decay, stamina drain/regen, body temperature, damage and death.
 * Order (simulation phase): vitals.consume -> vitals.tick -> vitals.death.
 * Deterministic and RNG-free, so the client predicts it for its own entity.
 */
import { addModifier, entityIndex, evaluate, ModOp, type Entity, type World } from "@engine/core";
import { BodyTemp, Buffs, DamageCause, Dead, Exposure, Health, IntentAction, PlayerIntent, Stat, Survival, VitalsState } from "../components.js";
import { gameplayDefs, isAuthority } from "../config.js";
import { secondsToTicks } from "../defs.js";
import { Died, emit, ItemConsumed, Vital, VitalDepleted } from "../events.js";
import { slotFreshness, slotItem, takeFromSlot } from "../inventory.js";

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** IntentAction.Use on a food slot: eat/drink one unit. */
export function consumeSystem(world: World, dt = 1 / 20): void {
  const defs = gameplayDefs(world);
  const intent = world.store(PlayerIntent);
  for (const e of world.query([PlayerIntent, Survival, Health], [Dead])) {
    const s = intent.slot(entityIndex(e));
    if (intent.data.action[s] !== IntentAction.Use) continue;
    const { item } = slotItem(world, e, intent.data.slot[s]!);
    const food = defs.items.get(item)?.food; if (!food) continue;
    // freshness scales the benefit; stale food (below staleFreshness) makes you sick
    const fresh = slotFreshness(world, e, intent.data.slot[s]!);
    takeFromSlot(world, e, intent.data.slot[s]!);
    const sv = world.get(e, Survival)!; const hp = world.get(e, Health)!; const k = 0.25 + 0.75 * fresh;
    world.set(e, Survival, { hunger: clamp(sv.hunger + food.hunger * k, 0, 100), thirst: clamp(sv.thirst + food.thirst * k, 0, 100) });
    world.set(e, Health, { hp: clamp(hp.hp + food.health * k, 0, hp.max) });
    const sp = defs.environment.spoilage;
    if (fresh < sp.staleFreshness) {
      const until = world.tick + secondsToTicks(sp.sickSeconds, dt);
      addModifier(world, e, Buffs, { stat: Stat.HealthRegen, op: ModOp.Add, value: -defs.vitals.healthRegenPerSec * 2, expiresAtTick: until });
      addModifier(world, e, Buffs, { stat: Stat.StaminaRegen, op: ModOp.Add, value: -defs.vitals.staminaRegenPerSec * 0.5, expiresAtTick: until });
    }
    emit(world, ItemConsumed, { entity: e, item });
  }
}

/** Blocks stamina regen for the configured delay (called by sprinting and by gathering). */
export function spendStamina(world: World, e: Entity, amount: number, dt: number): boolean {
  const st = world.getField(e, Survival, "stamina"); if (st === undefined || st < amount) return false;
  world.setField(e, Survival, "stamina", st - amount);
  world.setField(e, Survival, "staminaDelayTicks", Math.min(0xffff, secondsToTicks(gameplayDefs(world).vitals.staminaRegenDelaySeconds, dt)));
  if (st - amount <= 0) emit(world, VitalDepleted, { entity: e, vital: Vital.Stamina });
  return true;
}

export function vitalsSystem(world: World, dt: number): void {
  const vt = gameplayDefs(world).vitals;
  const sv = world.store(Survival); const hs = world.store(Health); const vs = world.store(VitalsState);
  const intent = world.store(PlayerIntent); const ex = world.store(Exposure);
  const delayTicks = Math.min(0xffff, secondsToTicks(vt.staminaRegenDelaySeconds, dt));

  for (const e of world.query([Survival, Health, VitalsState], [Dead])) {
    const idx = entityIndex(e);
    const s = sv.slot(idx); const h = hs.slot(idx); const v = vs.slot(idx);
    // buff/debuff modifier stack (core): (base + adds) x muls
    const hungerMul = evaluate(world, e, Buffs, Stat.HungerRate, 1);
    const thirstMul = evaluate(world, e, Buffs, Stat.ThirstRate, 1);

    // hunger / thirst
    const hunger0 = sv.data.hunger[s]!, thirst0 = sv.data.thirst[s]!;
    const hunger = Math.max(0, hunger0 - vt.hungerDecayPerSec * hungerMul * dt);
    const thirst = Math.max(0, thirst0 - vt.thirstDecayPerSec * thirstMul * dt);
    sv.data.hunger[s] = hunger; sv.data.thirst[s] = thirst;
    if (hunger0 > 0 && hunger === 0) emit(world, VitalDepleted, { entity: e, vital: Vital.Hunger });
    if (thirst0 > 0 && thirst === 0) emit(world, VitalDepleted, { entity: e, vital: Vital.Thirst });

    // stamina
    const max = sv.data.maxStamina[s]!; let stamina = sv.data.stamina[s]!;
    const sprinting = intent.has(idx) && intent.data.sprint[intent.slot(idx)] === 1 && intent.data.moving[intent.slot(idx)] === 1;
    if (sprinting && stamina > 0) {
      stamina = Math.max(0, stamina - vt.sprintStaminaDrainPerSec * dt);
      sv.data.staminaDelayTicks[s] = delayTicks;
      if (stamina === 0) emit(world, VitalDepleted, { entity: e, vital: Vital.Stamina });
    } else if (sv.data.staminaDelayTicks[s]! > 0) {
      sv.data.staminaDelayTicks[s] = sv.data.staminaDelayTicks[s]! - 1;
    } else {
      const needsMul = hunger < vt.lowNeedsThreshold || thirst < vt.lowNeedsThreshold ? vt.lowNeedsStaminaRegenMul : 1;
      const regen = Math.max(0, evaluate(world, e, Buffs, Stat.StaminaRegen, vt.staminaRegenPerSec));
      stamina = Math.min(max, stamina + regen * needsMul * dt);
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
    else {
      const wellFed = hunger >= vt.wellFedThreshold && thirst >= vt.wellFedThreshold;
      const regen = evaluate(world, e, Buffs, Stat.HealthRegen, wellFed ? vt.healthRegenPerSec : 0);
      hp = Math.min(hs.data.max[h]!, hp + regen * dt);
    }
    hs.data.hp[h] = Math.max(0, hp);
    hs.markChanged(idx); vs.markChanged(idx);
    writeBodyTemp(world, e, body);
  }
}

/** Render-facing BodyTemp (cold/heat 0..255, shivering) derived from the precise owner-only bodyTemp; writes on change. */
export function writeBodyTemp(world: World, e: Entity, body: number): void {
  const vt = gameplayDefs(world).vitals;
  const cold = Math.round(clamp((vt.bodyTempNormal - body) / (vt.bodyTempNormal - vt.bodyTempMin), 0, 1) * 255);
  const heat = Math.round(clamp((body - vt.bodyTempNormal) / (vt.bodyTempMax - vt.bodyTempNormal), 0, 1) * 255);
  const shivering = body < vt.hypothermiaBelow + 1 ? 1 : 0;
  const cur = world.get(e, BodyTemp);
  if (!cur) world.add(e, BodyTemp, { cold, heat, shivering });
  else if (cur.cold !== cold || cur.heat !== heat || cur.shivering !== shivering) world.set(e, BodyTemp, { cold, heat, shivering });
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
    emit(world, Died, { entity: e, cause });
  }
}
