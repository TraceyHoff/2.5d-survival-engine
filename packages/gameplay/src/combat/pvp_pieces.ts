/**
 * PvP / clan pieces (Art & Assets pvp_clan proposal) and the Burning status. Authority only; all randomness via
 * world.rngFor; no wall clock. Feature data lives in pieces.json `features`, fire tuning in data/fire.json.
 *  - contact (barricade_spiked): creatures (Health, not Dead) within radius take dps and a MoveSpeed slow; the
 *    piece's own Tribe is spared. Checked every CONTACT_EVERY ticks.
 *  - alarm (raid_bell): when a piece within radius is damaged, the bell emits RaidAlarm (cooldownSeconds per bell).
 *  - breachAt (gate_clan): at hp/max <= breachAt the door is forced open and unlocked; DoorState.open = 2
 *    (DOOR_BREACHED, render "breached" state) cannot be closed again until repaired above the threshold.
 *  - clanLock (gate_clan, clan_hall_door): the door spawns locked to the builder's tribe.
 *  - sightBonus (watchtower): `sightBonusAt(world, x, y)` for vision/AOI consumers (hook only).
 *  - Burning: `ignite(world, e)`; pieces burn per fire.json (dps x intensity/255, grow, spread to flammable tiers,
 *    rain/storm quench); creatures take dps x intensity/255 and the flame decays by growPerCheck per check.
 */
import { addModifier, ModOp, PlayerId, Transform, Weather, type Entity, type World } from "@engine/core";
import fireRaw from "../../data/fire.json";
import { BuildPiece, Buffs, Burning, DamageCause, Dead, DoorState, Health, Stat, Tribe } from "../components.js";
import { gameplayDefs, isAuthority } from "../config.js";
import { secondsToTicks, WeatherKind, type PieceDef } from "../defs.js";
import { emit, Extinguished, Ignited, RaidAlarm } from "../events.js";
import { applyDamage } from "./combat.js";
import { damagePiece, maxHpOf } from "../building/integrity.js";
import { attachmentsOf } from "../building/links.js";
import { noteUnlockEvent } from "../customization.js";
import { GateBreached, hasPlayerId } from "./pvp.js";

export interface FireTuning { checkSeconds: number; dps: number; igniteIntensity: number; growPerCheck: number; spreadRadius: number; spreadChance: number; rainQuench: number; flammableTiers: number[] }
export const FIRE: Readonly<FireTuning> = fireRaw;
export const CONTACT_EVERY = 4;
export const DOOR_BREACHED = 2;

const bellCooldown = new WeakMap<World, Map<Entity, number>>();
const defOf = (world: World, e: Entity): PieceDef | undefined => { const t = world.getField(e, BuildPiece, "type"); return t === undefined ? undefined : gameplayDefs(world).pieces.get(t); };
const pos = (world: World, e: Entity): { x: number; y: number } | undefined => world.get(e, Transform);
function piecesWith(world: World, pick: (d: PieceDef) => boolean): Entity[] {
  const out: Entity[] = []; for (const e of world.query([BuildPiece, Transform])) { const d = defOf(world, e); if (d && pick(d)) out.push(e); } return out;
}

/** Sets a target burning (authority). Pieces only ignite when their tier is flammable. Returns true if now burning. */
export function ignite(world: World, e: Entity, intensity = FIRE.igniteIntensity): boolean {
  if (!isAuthority(world) || world.isReplaying || !world.isAlive(e)) return false;
  if (world.has(e, BuildPiece) && !FIRE.flammableTiers.includes(world.getField(e, BuildPiece, "tier")!)) return false;
  if (!world.has(e, BuildPiece) && !world.has(e, Health)) return false;
  const cur = world.get(e, Burning);
  if (cur && cur.lit) { world.setField(e, Burning, "intensity", Math.max(cur.intensity, Math.min(255, intensity))); return true; }
  const v = { lit: 1, intensity: Math.min(255, intensity), startTick: world.tick };
  if (cur) world.set(e, Burning, v); else world.add(e, Burning, v);
  emit(world, Ignited, { entity: e }); return true;
}
export function extinguish(world: World, e: Entity): void {
  if (!world.has(e, Burning)) return; world.remove(e, Burning); emit(world, Extinguished, { entity: e });
}

/** Fire system (every checkSeconds). */
export function burningSystem(world: World, dt: number): void {
  if (!isAuthority(world) || world.isReplaying) return;
  const every = Math.max(1, secondsToTicks(FIRE.checkSeconds, dt)); if (world.tick % every !== 0) return;
  const wk = world.env(Weather).kind; const wet = wk === WeatherKind.Rain || wk === WeatherKind.Storm;
  const burning = [...world.query([Burning])].sort((a, b) => a - b);
  const pieces = burning.some((e) => world.has(e, BuildPiece)) ? [...world.query([BuildPiece, Transform])].sort((a, b) => a - b) : [];
  for (const e of burning) {
    const b = world.get(e, Burning)!; if (!b.lit) continue;
    const isPiece = world.has(e, BuildPiece);
    const dmg = FIRE.dps * FIRE.checkSeconds * (b.intensity / 255);
    if (isPiece) damagePiece(world, e, dmg); else applyDamage(world, e, dmg, e, DamageCause.Fire);
    let next = b.intensity + (isPiece ? FIRE.growPerCheck : -FIRE.growPerCheck) - (wet ? FIRE.rainQuench : 0);
    if (world.has(e, Dead)) next = 0;
    next = Math.max(0, Math.min(255, next));
    if (next === 0) { extinguish(world, e); continue; }
    if (next !== b.intensity) world.setField(e, Burning, "intensity", next);
    if (isPiece) {
      const p = pos(world, e)!; const rng = world.rngFor("fire.spread", e);
      for (const o of pieces) {
        if (o === e || world.getField(o, Burning, "lit")) continue;
        const q = pos(world, o)!; if (Math.hypot(q.x - p.x, q.y - p.y) > FIRE.spreadRadius) continue;
        if (rng.next() < FIRE.spreadChance) ignite(world, o);
      }
    }
  }
}

/** Contact damage + slow (barricade_spiked), every CONTACT_EVERY ticks. */
export function contactSystem(world: World, dt: number): void {
  if (!isAuthority(world) || world.isReplaying || world.tick % CONTACT_EVERY !== 0) return;
  const spikes = piecesWith(world, (d) => d.features.contact !== undefined); if (spikes.length === 0) return;
  const victims = [...world.query([Health, Transform], [Dead, BuildPiece])].sort((a, b) => a - b);
  const period = CONTACT_EVERY * dt;
  for (const s of spikes.sort((a, b) => a - b)) {
    const c = defOf(world, s)!.features.contact!; const p = pos(world, s)!; const tribe = world.getField(s, Tribe, "id") ?? 0;
    for (const v of victims) {
      if (tribe !== 0 && world.getField(v, Tribe, "id") === tribe) continue;
      const q = pos(world, v)!; if (Math.hypot(q.x - p.x, q.y - p.y) > c.radius) continue;
      applyDamage(world, v, c.dps * period, s, DamageCause.Contact);
      addModifier(world, v, Buffs, { stat: Stat.MoveSpeed, op: ModOp.Mul, value: c.slowMul, expiresAtTick: world.tick + secondsToTicks(c.slowSeconds, dt) });
    }
  }
}

/** Called by structureDamageSystem after a piece's hp drops (authority): gate breach + raid bells. */
export function onPieceDamaged(world: World, e: Entity, hp: number, attacker: Entity = 0 as Entity): void {
  const def = defOf(world, e); if (!def) return;
  const breachAt = def.features.breachAt;
  if (breachAt !== undefined && def.door && hp / Math.max(1, maxHpOf(world, e)) <= breachAt) {
    let breached = false;
    for (const a of attachmentsOf(world, e)) if (world.has(a, DoorState) && world.getField(a, DoorState, "open") !== DOOR_BREACHED) { world.set(a, DoorState, { open: DOOR_BREACHED, lockTribe: 0 }); breached = true; }
    if (breached) {
      emit(world, GateBreached, { piece: e, attacker });
      if (attacker && world.isAlive(attacker) && hasPlayerId(world, attacker)) noteUnlockEvent(world, attacker, "raidBreach");
    }
  }
  const p = pos(world, e); if (!p) return;
  let cd = bellCooldown.get(world); if (!cd) bellCooldown.set(world, cd = new Map());
  const dt = 1 / 20;
  for (const bell of piecesWith(world, (d) => d.features.alarm !== undefined).sort((a, b) => a - b)) {
    const al = defOf(world, bell)!.features.alarm!; const q = pos(world, bell)!;
    if (Math.hypot(q.x - p.x, q.y - p.y) > al.radius || (cd.get(bell) ?? -1) > world.tick) continue;
    cd.set(bell, world.tick + secondsToTicks(al.cooldownSeconds, dt));
    emit(world, RaidAlarm, { bell, piece: e, tribe: world.getField(bell, Tribe, "id") ?? 0 });
  }
}

/** Repair above breachAt restores a breached gate to closed (called from repair). */
export function clearBreach(world: World, e: Entity): void {
  const def = defOf(world, e); if (def?.features.breachAt === undefined) return;
  if ((world.getField(e, BuildPiece, "hp") ?? 0) / Math.max(1, maxHpOf(world, e)) <= def.features.breachAt) return;
  for (const a of attachmentsOf(world, e)) if (world.getField(a, DoorState, "open") === DOOR_BREACHED) world.setField(a, DoorState, "open", 0);
}

/** Max sightBonus of watchtower-like pieces covering (x, y) (within their footprint radius). */
export function sightBonusAt(world: World, x: number, y: number): number {
  let best = 0;
  for (const e of piecesWith(world, (d) => (d.features.sightBonus ?? 0) > 0)) {
    const d = defOf(world, e)!; const p = pos(world, e)!; const r = Math.max(d.footprint.w, d.footprint.h);
    if (Math.hypot(p.x - x, p.y - y) <= r) best = Math.max(best, d.features.sightBonus!);
  }
  return best;
}
