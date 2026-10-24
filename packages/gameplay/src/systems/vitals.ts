/**
 * Vitals: consumables, hunger/thirst decay, stamina drain/regen, body temperature, damage and death.
 * Order (simulation phase): vitals.consume -> vitals.tick -> vitals.death.
 * Deterministic and RNG-free, so the client predicts it for its own entity.
 */
import { addModifier, defineResource, entityIndex, evaluate, ModOp, Transform, type Entity, type World } from "@engine/core";
import { Anim, AnimState, BodyTemp, NO_SLOT, Buffs, DamageCause, Dead, Exposure, Health, IntentAction, PlayerIntent, Stat, Survival, VitalsState } from "../components.js";
import { gameplayDefs, isAuthority } from "../config.js";
import { secondsToTicks } from "../defs.js";
import { ConsumeFail, ConsumeFailed, Died, emit, ItemConsumed, WaterDrunk, Vital, VitalDepleted } from "../events.js";
import { readSlots, slotFreshness, slotItem, takeFromSlot } from "../inventory.js";
import { hasPerk, skillMul } from "../skills/tree.js";
import { fillContainer, spoilStageIndex, spoilStages, takeSip } from "../food.js";
import { inWater } from "./movement.js";
import { TerrainRes } from "../world.js";

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** ADR-128: minimum ticks between two eats/drinks (server-validated; the client predicts the same). */
export const CONSUME_COOLDOWN_TICKS = 10;
/** ADR-128: thirst restored by one gulp straight from a water tile (Use with NO_SLOT while standing in/next to water). */
export const WATER_TILE_THIRST = 12;
const nextUse = new WeakMap<World, Map<Entity, number>>();
/** Tick at which `e` may eat/drink again (0 = now). */
export function consumeReadyTick(world: World, e: Entity): number { return nextUse.get(world)?.get(e) ?? 0; }
/** ADR-128: client replicas without TerrainRes register a tile lookup (replicated tiles) so UI can offer "Drink water". */
export const WaterProbeRes = defineResource<{ tileAt(tx: number, ty: number): number }>("gameplay.WaterProbe");
/** True when (x, y) is a water tile or touches one (drink from / refill at the tile). */
export function nearWater(world: World, x: number, y: number): boolean {
  const probe = world.getResource(TerrainRes) ? undefined : world.getResource(WaterProbeRes); const swim = gameplayDefs(world).movement.swimTiles;
  const wet = (px: number, py: number): boolean => (probe ? swim.has(probe.tileAt(Math.floor(px), Math.floor(py))) : inWater(world, px, py));
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (wet(x + dx * 0.75, y + dy * 0.75)) return true;
  return false;
}
function setAnimOf(world: World, e: Entity, anim: Anim): void {
  const cur = world.getField(e, AnimState, "anim");
  if (cur === undefined) world.add(e, AnimState, { anim, startTick: world.tick });
  else world.set(e, AnimState, { anim, startTick: world.tick });
}

/**
 * IntentAction.Use on a food slot: eat/drink one unit (ADR-128: CONSUME_COOLDOWN_TICKS between uses, rotten food refused
 * unless iron_stomach, Eat/Drink anim). Use on an EMPTY liquid container next to water refills it; Use with NO_SLOT next
 * to water drinks from the tile.
 */
export function consumeSystem(world: World, dt = 1 / 20): void {
  const defs = gameplayDefs(world);
  const intent = world.store(PlayerIntent);
  let ready = nextUse.get(world); if (!ready) nextUse.set(world, (ready = new Map()));
  for (const e of world.query([PlayerIntent, Survival, Health], [Dead])) {
    const s = intent.slot(entityIndex(e));
    if (intent.data.action[s] !== IntentAction.Use) continue;
    const slot = intent.data.slot[s]!;
    const tf = world.get(e, Transform); const wet = !!tf && nearWater(world, tf.x, tf.y);
    const anim = (a: Anim): void => { if (isAuthority(world) || world.has(e, AnimState)) setAnimOf(world, e, a); };
    if (slot === NO_SLOT) {
      if (!wet) continue;
      if (world.tick < (ready.get(e) ?? 0)) { emit(world, ConsumeFailed, { entity: e, item: 0, reason: ConsumeFail.Cooldown }); continue; }
      ready.set(e, world.tick + CONSUME_COOLDOWN_TICKS);
      const sv = world.get(e, Survival)!; world.setField(e, Survival, "thirst", clamp(sv.thirst + WATER_TILE_THIRST, 0, 100));
      anim(Anim.Drink); emit(world, WaterDrunk, { entity: e, item: 0, sips: 0 });
      continue;
    }
    const { item } = slotItem(world, e, slot);
    const food = defs.items.get(item)?.food; if (!food) continue;
    const idef = defs.items.get(item)!;
    if (world.tick < (ready.get(e) ?? 0)) { emit(world, ConsumeFailed, { entity: e, item, reason: ConsumeFail.Cooldown }); continue; }
    // liquid containers (water_flask, canteen): one sip of food/sips per use, the container stays; empty -> refill at water
    const per = idef.sips > 0 ? 1 / idef.sips : 1;
    if (idef.sips > 0 && readSlots(world, e).durability(slot) <= 0) {
      const added = wet && isAuthority(world) ? fillContainer(world, e, slot) : 0;
      if (wet) { ready.set(e, world.tick + CONSUME_COOLDOWN_TICKS); anim(Anim.Drink); if (added) emit(world, WaterDrunk, { entity: e, item, sips: added }); }
      else emit(world, ConsumeFailed, { entity: e, item, reason: ConsumeFail.Empty });
      continue;
    }
    // freshness stage (environment.spoilage.stages) scales the benefit; sick stages make you ill; the last (rotten) is refused
    const stages = spoilStages(defs); const si = spoilStageIndex(slotFreshness(world, e, slot), stages); const stage = stages[si]!;
    const ironPerk = hasPerk(world, e, "iron_stomach");
    if (si === stages.length - 1 && stage.sick && !ironPerk && idef.sips === 0) { emit(world, ConsumeFailed, { entity: e, item, reason: ConsumeFail.Rotten }); continue; }
    if (idef.sips > 0 && !takeSip(world, e, slot)) continue;
    if (idef.sips === 0) takeFromSlot(world, e, slot);
    ready.set(e, world.tick + CONSUME_COOLDOWN_TICKS);
    anim(idef.sips > 0 || (food.thirst > 0 && food.hunger <= 0) ? Anim.Drink : Anim.Eat);
    const sv = world.get(e, Survival)!; const hp = world.get(e, Health)!; const k = stage.nutritionMul * per * skillMul(world, e, "nutrition");
    const iron = stage.sick && ironPerk; // ADR-113: no sickness, flat hp cost instead
    world.set(e, Survival, { hunger: clamp(sv.hunger + food.hunger * k, 0, 100), thirst: clamp(sv.thirst + food.thirst * k, 0, 100) });
    world.set(e, Health, { hp: clamp(hp.hp + food.health * k * (food.health > 0 ? skillMul(world, e, "heal") : 1) - (iron ? IRON_STOMACH_HP : 0), 0, hp.max) });
    const sp = defs.environment.spoilage;
    if (stage.sick && !iron) {
      const until = world.tick + secondsToTicks(sp.sickSeconds, dt);
      addModifier(world, e, Buffs, { stat: Stat.HealthRegen, op: ModOp.Add, value: -defs.vitals.healthRegenPerSec * 2, expiresAtTick: until });
      addModifier(world, e, Buffs, { stat: Stat.StaminaRegen, op: ModOp.Add, value: -defs.vitals.staminaRegenPerSec * 0.5, expiresAtTick: until });
    }
    emit(world, ItemConsumed, { entity: e, item });
  }
}

/** Iron Stomach trade-off: spoiled food costs this much hp instead of sickness. */
export const IRON_STOMACH_HP = 4;

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
    else if (hp > 0) { // hp 0 = dying this tick (death system runs next); no regen back from 0
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
