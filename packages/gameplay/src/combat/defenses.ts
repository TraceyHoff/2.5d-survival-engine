/**
 * ADR-108 defensive structures (authority; all randomness via world.rngFor, no wall clock).
 *  - turret (arrow_turret, bolt_turret, flame_turret): every cooldownSeconds shoots the nearest hostile within range,
 *    spending one ammo item (features.turret.ammo, first match in slot order) from the piece's storage Container.
 *    Flame turrets burn crude_oil / lamp_oil and may ignite the target. No ammo = idle (Defense.target = 0).
 *  - trap (bear_trap): springs on the first hostile within radius: damage + MoveSpeed x0 root for rootSeconds; re-arms
 *    after rearmSeconds (Defense.readyTick).
 * Hostile = living zombie or animal-free creature with Health, never: the owner (Defense.owner PlayerId), the piece's
 * Tribe (clan bases carry the clan id), the owner's party or clan. Players are only targeted when the raid rule
 * (setRaidRule, combat/arms.ts) allows that player to raid this piece; with no rule set, DEFENSES.playersWithoutRaidRule.
 */
import { addModifier, Membership, ModOp, Permissions, PlayerId, Transform, type Entity, type World } from "@engine/core";
import { installSpatialIndex } from "@engine/world";
import { BuildPiece, Buffs, Container, DamageCause, Dead, Defense, Health, PlayerIntent, Stat, Tribe, Zombie } from "../components.js";
import { gameplayDefs, isAuthority } from "../config.js";
import { secondsToTicks, type PieceDef } from "../defs.js";
import { emit, ev } from "../events.js";
import { listSlots, removeItem } from "../inventory.js";
import { attachmentsOf } from "../building/links.js";
import { partyOf } from "../party.js";
import { RaidRuleRes } from "./arms.js";
import { applyDamage } from "./combat.js";
import { ignite } from "./pvp_pieces.js";

export const DEFENSES = { checkEvery: 2, playersWithoutRaidRule: false };
export const TurretFired = ev<{ turret: Entity; target: Entity; ammo: number }>("gameplay.TurretFired");
export const TrapSprung = ev<{ trap: Entity; victim: Entity }>("gameplay.TrapSprung");
export const DEFENSE_EVENT_RELIABILITY = { "gameplay.TurretFired": "unreliable", "gameplay.TrapSprung": "reliable" } as const;

const defOf = (world: World, e: Entity): PieceDef | undefined => { const t = world.getField(e, BuildPiece, "type"); return t === undefined ? undefined : gameplayDefs(world).pieces.get(t); };
/** Player identity: PlayerId when the world has one (net/server), else the entity itself for anything that takes player input. */
const hasPid = (world: World): boolean => world.isRegistered(PlayerId);
const pid = (world: World, e: Entity): number => (hasPid(world) && world.has(e, PlayerId) ? world.getField(e, PlayerId, "id") ?? 0 : world.has(e, PlayerIntent) ? (e as number) : 0);
const clanOf = (world: World, e: Entity): number => (world.isRegistered(Membership) ? world.getField(e, Membership, "clanId") ?? 0 : 0);

/** Adds Defense state to a freshly placed turret / trap piece (building/place.ts). */
export function initDefense(world: World, piece: Entity, def: PieceDef, builder: Entity | undefined): void {
  if (!def.features.turret && !def.features.trap) return;
  world.add(piece, Defense, { readyTick: world.tick, owner: builder ? pid(world, builder) : 0, target: 0 });
}

/** May `piece` (turret/trap) hurt `v`? */
export function isHostileTo(world: World, piece: Entity, v: Entity): boolean {
  if (v === piece || !world.isAlive(v) || !world.has(v, Health) || world.has(v, Dead) || world.has(v, BuildPiece)) return false;
  if (world.has(v, Zombie)) return true;
  const p = pid(world, v); if (!p) return false; // animals / bots without a PlayerId are left alone
  const owner = world.getField(piece, Defense, "owner") ?? 0; if (p === owner) return false;
  const tribe = world.getField(piece, Tribe, "id") ?? 0; if (tribe !== 0 && world.getField(v, Tribe, "id") === tribe) return false;
  if (owner) {
    const party = hasPid(world) && world.getResource(Permissions) ? partyOf(world, owner) : 0; if (party && partyOf(world, p) === party) return false;
    const clan = ownerClan(world, owner); if (clan && clanOf(world, v) === clan) return false;
  }
  const rule = world.getResource(RaidRuleRes)?.fn;
  return rule ? rule(v, piece) : DEFENSES.playersWithoutRaidRule;
}
function ownerClan(world: World, owner: number): number {
  if (!world.isRegistered(Membership) || !world.isRegistered(PlayerId)) return 0;
  for (const e of world.query([PlayerId, Membership])) if (world.getField(e, PlayerId, "id") === owner) return world.getField(e, Membership, "clanId") ?? 0;
  return 0;
}
const scratch: Entity[] = [];
function hostilesNear(world: World, piece: Entity, x: number, y: number, r: number): Entity[] {
  const idx = installSpatialIndex(world); idx.update(); scratch.length = 0; idx.queryRadius(x, y, r, scratch);
  return scratch.filter((v) => isHostileTo(world, piece, v)).sort((a, b) => a - b);
}
/** First ammo item (by slot order) in the turret's storage; 0 = none. */
export function turretAmmo(world: World, piece: Entity): { box: Entity; item: number } | undefined {
  const t = defOf(world, piece)?.features.turret; if (!t) return undefined; const defs = gameplayDefs(world);
  const ids = new Set(t.ammo.map((k) => defs.itemId(k)));
  for (const box of attachmentsOf(world, piece)) {
    if (!world.has(box, Container)) continue;
    for (const s of listSlots(world, box)) if (s.count > 0 && ids.has(s.item)) return { box, item: s.item };
  }
  return undefined;
}

export function defenseSystem(world: World, dt: number): void {
  if (!isAuthority(world) || world.isReplaying || world.tick % DEFENSES.checkEvery !== 0) return;
  const list = [...world.query([Defense, BuildPiece, Transform])].sort((a, b) => a - b);
  for (const d of list) {
    const def = defOf(world, d); if (!def) continue; if (world.tick < (world.getField(d, Defense, "readyTick") ?? 0)) continue;
    const p = world.get(d, Transform)!;
    if (def.features.turret) {
      const t = def.features.turret; const ammo = turretAmmo(world, d);
      const targets = ammo ? hostilesNear(world, d, p.x, p.y, t.range) : [];
      let best: Entity | undefined; let bd = Infinity;
      for (const v of targets) { const q = world.get(v, Transform)!; const dd = Math.hypot(q.x - p.x, q.y - p.y); if (dd <= t.range && dd < bd) { bd = dd; best = v; } }
      if (best === undefined || !ammo) { if (world.getField(d, Defense, "target")) world.setField(d, Defense, "target", 0); continue; }
      removeItem(world, ammo.box, ammo.item, 1);
      world.set(d, Defense, { readyTick: world.tick + secondsToTicks(t.cooldownSeconds, dt), target: best });
      applyDamage(world, best, t.damage, d, DamageCause.Turret);
      if ((t.igniteChance ?? 0) > 0 && world.rngFor("turret.ignite", d).next() < t.igniteChance!) ignite(world, best);
      emit(world, TurretFired, { turret: d, target: best, ammo: ammo.item });
    } else if (def.features.trap) {
      const tr = def.features.trap; const v = hostilesNear(world, d, p.x, p.y, tr.radius)[0]; if (v === undefined) continue;
      world.set(d, Defense, { readyTick: world.tick + secondsToTicks(tr.rearmSeconds, dt), target: v });
      applyDamage(world, v, tr.damage, d, DamageCause.Trap);
      addModifier(world, v, Buffs, { stat: Stat.MoveSpeed, op: ModOp.Mul, value: 0, expiresAtTick: world.tick + secondsToTicks(tr.rootSeconds, dt) });
      emit(world, TrapSprung, { trap: d, victim: v });
    }
  }
}
