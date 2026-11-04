/**
 * Task 15: per-animal skill trees for tameable / farmable animals.
 *
 * Design notes (see also data/animal_skills.json):
 * - One tree per animal kind (a pet chicken and a farm chicken share `animal_chicken`). Trees are data-driven
 *   and validated in defs.ts; a node whose effect does not apply to an animal's role (e.g. a produce node on a
 *   pet) is inert for that animal.
 * - Skill-point cadence: an animal gains a point every 5 levels COUNTING the starting level, i.e. at levels
 *   1, 6, 11, 16, ... . There was no prior animal point system to "change": pets previously gained only
 *   health/damage/speed on level-up and farm animals had no level at all, so this module introduces the
 *   points system with the requested cadence from the start.
 * - Migration: total points are recomputed from level with pointsForAnimalLevel(); already-spent points are
 *   never taken away (grandfathered); only the non-negative difference is granted. Pets read their level from
 *   Pet.level (authoritative); farm animals keep their level in AnimalSkills.
 * - Spending is a direct-handler command (pet-command pattern): registered append-only in input.ts, bridged
 *   in protocol.ts, installed in the server game loop. It is NOT an intent-queue command, so no INPUT_QUEUE
 *   change is needed.
 */
import { defineCommand, PlayerId, Transform, type CommandDef, type CommandHandlers, type Entity, type World } from "@engine/core";
import { Animal, AnimalSkills, Dead, Health, Pet, Tamed } from "./components.js";
import { gameplayDefs } from "./config.js";
import { animalDefs } from "./population.js";
import type { AnimalSkillEffectType, AnimalSkillTree } from "./defs.js";

export const ANIMAL_SKILL_FAIL = { None: 0, NotFound: 1, NotOwner: 2, TooFar: 3, NoTree: 4, NoPoints: 5, Owned: 6, MissingReq: 7 } as const;
export const ANIMAL_SKILL_FAIL_REASONS = ["", "not_found", "not_owner", "too_far", "no_tree", "no_points", "owned", "missing_req"] as const;
export const ANIMAL_SKILL_REJECT_REASONS = ["not_found", "not_owner", "too_far", "no_tree", "no_points", "owned", "missing_req"] as const;

/** Skill points an animal has earned in total by `level`: points at levels 1, 6, 11, 16, ... */
export const pointsForAnimalLevel = (level: number, every = 5): number => Math.floor((level - 1) / every) + 1;
/** XP to go from `level` to `level + 1` on the animal curve (same shape as the pet curve). */
export const animalXpToNext = (world: World, level: number): number => {
  const t = gameplayDefs(world).animalSkillsTuning.xp; return Math.round(t.base * Math.pow(t.growth, level - 1));
};
/** Animal kind key (e.g. "animal_cow") for an entity, or undefined when it is not an animal. */
export const animalKindKey = (world: World, e: Entity): string | undefined => {
  const k = world.getField(e, Animal, "kind") ?? world.getField(e, Tamed, "kind"); if (k === undefined) return undefined; return animalDefs()[k]?.key;
};
/** Authoritative level: Pet.level for pets, AnimalSkills.level for farm animals, 1 when neither exists. */
export const animalSkillLevel = (world: World, e: Entity): number =>
  world.has(e, Pet) ? (world.getField(e, Pet, "level") ?? 1) : (world.getField(e, AnimalSkills, "level") ?? 1);

const pidOf = (world: World, e: Entity): number => (world.isRegistered(PlayerId) && world.has(e, PlayerId) ? world.getField(e, PlayerId, "id") ?? 0 : 0);
/** Owner PlayerId: Pet.owner is already a PlayerId; Tamed.owner is the owner *entity* (resolved to its PlayerId). */
const ownerIdOf = (world: World, e: Entity): number => {
  if (world.has(e, Pet)) return world.getField(e, Pet, "owner") ?? 0;
  if (world.has(e, Tamed)) { const oe = world.getField(e, Tamed, "owner"); return oe ? pidOf(world, oe as Entity) : 0; }
  return 0;
};
/** True when `actor` owns this animal (pet owner or livestock owner). Wild animals have no owner. */
export const isAnimalSkillOwner = (world: World, actor: Entity, e: Entity): boolean => { const id = pidOf(world, actor); return id !== 0 && ownerIdOf(world, e) === id; };

/** Ensure an AnimalSkills row exists. Fresh farm animal: level 1, 0 XP, 1 point. Pet: mirrors Pet.level/Pet.xp. */
export function ensureAnimalSkills(world: World, e: Entity): void {
  if (world.has(e, AnimalSkills)) return;
  const isPet = world.has(e, Pet);
  const level = isPet ? (world.getField(e, Pet, "level") ?? 1) : 1;
  const xp = isPet ? (world.getField(e, Pet, "xp") ?? 0) : 0;
  world.add(e, AnimalSkills, { level, xp, points: pointsForAnimalLevel(level, gameplayDefs(world).animalSkillsTuning.pointsEvery), nodes: 0 });
}
/** Points already spent on bought nodes (sum of node costs for set bits). */
export const spentAnimalSkillPoints = (world: World, e: Entity, tree: AnimalSkillTree | undefined): number => {
  if (!tree || !world.has(e, AnimalSkills)) return 0;
  const bits = world.getField(e, AnimalSkills, "nodes") ?? 0; let spent = 0;
  tree.nodes.forEach((n, i) => { if (bits & (1 << i)) spent += n.cost; });
  return spent;
};
/**
 * Migration / reconciliation: total points from level, minus spent points, never negative, never taking spent
 * points away. Also syncs the stored level to the authoritative one (Pet.level for pets).
 */
export function reconcileAnimalSkills(world: World, e: Entity): void {
  if (!world.has(e, AnimalSkills)) { ensureAnimalSkills(world, e); return; }
  const level = animalSkillLevel(world, e);
  const total = pointsForAnimalLevel(level, gameplayDefs(world).animalSkillsTuning.pointsEvery);
  const spent = spentAnimalSkillPoints(world, e, gameplayDefs(world).animalSkillTree(animalKindKey(world, e) ?? ""));
  world.set(e, AnimalSkills, { level, points: Math.max(0, total - spent) });
}

export interface AnimalSkillMods { produce: number; produceSpeed: number; fertility: number; damageMul: number; healthMul: number; speedMul: number }
/** Summed effect of all bought nodes (multipliers are 1 + sum of fractions; produce is an extra-unit count). */
export function animalSkillMods(world: World, e: Entity): AnimalSkillMods {
  const mods: AnimalSkillMods = { produce: 0, produceSpeed: 0, fertility: 0, damageMul: 1, healthMul: 1, speedMul: 1 };
  const tree = gameplayDefs(world).animalSkillTree(animalKindKey(world, e) ?? ""); if (!tree || !world.has(e, AnimalSkills)) return mods;
  const bits = world.getField(e, AnimalSkills, "nodes") ?? 0;
  tree.nodes.forEach((n, i) => {
    if (!(bits & (1 << i))) return;
    const v = n.effect.value;
    if (n.effect.type === "produce") mods.produce += v;
    else if (n.effect.type === "produceSpeed") mods.produceSpeed += v;
    else if (n.effect.type === "fertility") mods.fertility += v;
    else if (n.effect.type === "damage") mods.damageMul += v;
    else if (n.effect.type === "health") mods.healthMul += v;
    else if (n.effect.type === "speed") mods.speedMul += v;
  });
  return mods;
}
/** Farm-animal XP: production and feeding award XP; level-ups grant points via reconcile (cap = tuning maxLevel). */
export function awardAnimalXp(world: World, e: Entity, amount: number): void {
  if (world.has(e, Pet)) return; // pets level through grantXp in pets.ts
  ensureAnimalSkills(world, e);
  const s = world.get(e, AnimalSkills)!; const maxLevel = gameplayDefs(world).animalSkillsTuning.xp.maxLevel;
  let xp = s.xp + Math.max(0, Math.round(amount)); let level = s.level;
  while (level < maxLevel && xp >= animalXpToNext(world, level)) { xp -= animalXpToNext(world, level); level++; }
  if (level >= maxLevel) xp = Math.min(xp, animalXpToNext(world, level));
  world.set(e, AnimalSkills, { xp, level }); reconcileAnimalSkills(world, e);
}

export interface AnimalSkillNodeView { index: number; key: string; name: string; desc: string; cost: number; owned: boolean; available: boolean; requires: string | null }
export interface AnimalSkillView { kind: string; level: number; xp: number; xpNext: number; points: number; nodes: AnimalSkillNodeView[] }
/** Panel view-model (replica reads only; never mutates). Undefined when the animal has no tree or no skills row yet. */
export function animalSkillView(world: World, e: Entity): AnimalSkillView | undefined {
  if (!world.isAlive(e) || world.has(e, Dead) || !world.has(e, Animal)) return undefined;
  const kind = animalKindKey(world, e); if (!kind) return undefined;
  const tree = gameplayDefs(world).animalSkillTree(kind); if (!tree) return undefined;
  if (!world.has(e, AnimalSkills)) return undefined;
  const s = world.get(e, AnimalSkills)!; const bits = s.nodes;
  const owned = new Set<string>(); tree.nodes.forEach((n, i) => { if (bits & (1 << i)) owned.add(n.key); });
  const nodes: AnimalSkillNodeView[] = tree.nodes.map((n, i) => ({
    index: i, key: n.key, name: n.name, desc: n.desc, cost: n.cost, owned: owned.has(n.key), requires: n.requires,
    available: !owned.has(n.key) && (n.requires === null || owned.has(n.requires)) && s.points >= n.cost,
  }));
  const level = animalSkillLevel(world, e);
  return { kind, level, xp: s.xp, xpNext: animalXpToNext(world, level), points: s.points, nodes };
}

const near = (world: World, a: Entity, b: Entity, r: number): boolean => { const p = world.get(a, Transform), q = world.get(b, Transform); return !!p && !!q && Math.hypot(p.x - q.x, p.y - q.y) <= r; };
/** Validate a skill purchase (node index into the animal's tree). Returns an ANIMAL_SKILL_FAIL code. */
export function spendAnimalSkillValidate(world: World, actor: Entity, e: Entity, nodeIndex: number): number {
  if (!world.isAlive(e) || world.has(e, Dead) || !world.has(e, Animal)) return ANIMAL_SKILL_FAIL.NotFound;
  const tree = gameplayDefs(world).animalSkillTree(animalKindKey(world, e) ?? ""); if (!tree) return ANIMAL_SKILL_FAIL.NoTree;
  if (!isAnimalSkillOwner(world, actor, e)) return ANIMAL_SKILL_FAIL.NotOwner;
  if (!near(world, actor, e, 40)) return ANIMAL_SKILL_FAIL.TooFar;
  const node = tree.nodes[nodeIndex]; if (!node) return ANIMAL_SKILL_FAIL.NoTree;
  ensureAnimalSkills(world, e); const bits = world.getField(e, AnimalSkills, "nodes") ?? 0;
  if (bits & (1 << nodeIndex)) return ANIMAL_SKILL_FAIL.Owned;
  if (node.requires !== null) { const reqIdx = tree.nodes.findIndex((n) => n.key === node.requires); if (reqIdx < 0 || !(bits & (1 << reqIdx))) return ANIMAL_SKILL_FAIL.MissingReq; }
  if ((world.getField(e, AnimalSkills, "points") ?? 0) < node.cost) return ANIMAL_SKILL_FAIL.NoPoints;
  return ANIMAL_SKILL_FAIL.None;
}
/** Apply a validated skill purchase. Returns an ANIMAL_SKILL_FAIL code (None on success). */
export function spendAnimalSkill(world: World, actor: Entity, e: Entity, nodeIndex: number): number {
  const fail = spendAnimalSkillValidate(world, actor, e, nodeIndex); if (fail) return fail;
  const tree = gameplayDefs(world).animalSkillTree(animalKindKey(world, e) ?? "")!;
  const node = tree.nodes[nodeIndex]!; const bits = world.getField(e, AnimalSkills, "nodes") ?? 0;
  const points = (world.getField(e, AnimalSkills, "points") ?? 0) - node.cost;
  world.set(e, AnimalSkills, { nodes: bits | (1 << nodeIndex), points });
  // Health nodes apply to the live Health row at once (pet rebuilds later recompute the same absolute value,
  // so this never double-counts; farm animals have no rebuild path).
  if (node.effect.type === "health") {
    const h = world.get(e, Health);
    if (h) { const gain = Math.round(h.max * node.effect.value); world.set(e, Health, { max: h.max + gain, hp: Math.min(h.max + gain, h.hp + gain) }); }
  }
  return ANIMAL_SKILL_FAIL.None;
}

export const AnimalSkillCmd = defineCommand("gameplay.animalSkill", { animal: "u32", node: "u8" });
export const ANIMAL_SKILL_COMMANDS: readonly CommandDef[] = [AnimalSkillCmd];
export const ANIMAL_SKILL_ENTITY_FIELDS: Readonly<Record<string, readonly string[]>> = { [AnimalSkillCmd.name]: ["animal"] };
export function installAnimalSkillCommands(world: World, handlers: CommandHandlers): void {
  const r = (f: number): string | undefined => (f ? ANIMAL_SKILL_FAIL_REASONS[f] : undefined);
  handlers.on(AnimalSkillCmd, {
    validate: (v, c) => r(spendAnimalSkillValidate(world, c.actor, v.animal as Entity, v.node)),
    handle: (v, c) => { spendAnimalSkill(world, c.actor, v.animal as Entity, v.node); },
  });
}

// Re-export the effect type for consumers that build panel copy.
export type { AnimalSkillEffectType };
