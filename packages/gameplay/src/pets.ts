/**
 * ADR-145 companion pets (data/pets.json). A wild pet-species animal (dogs, cats, birds, rabbit, ferret) is tamed by
 * offering a treat (PetTameCmd; chance = baseTame x the species' preference for that treat; hated treats are refused and
 * kept). Players and AI humans use the same command. A pet keeps: owner (PlayerId), a renameable name, a small owner-only
 * inventory (Container, opened through the normal container intents), fullness + loyalty, level/xp with hp/damage/speed
 * growth, and a Follow / Stay command. petSystem (authority, every tick) drives it: hunger + auto-eating (own inventory ->
 * food on the ground (loot bags) -> its owner's pet_trough), starvation (slow hp loss floored at 1 hp, loyalty decay, never
 * death), follow / stay movement, defence (owner / stay point / owner's structures + other pets) and item pickup.
 * Pet + Tamed + Container are persistent; Health is rebuilt from Pet.hp + level after a load.
 */
import { LootSource, tagLootSource } from "./loot_labels.js";
import { defineCommand, DEFAULT_TICK_HZ, entityIndex, PlayerId, Transform, type CommandDef, type CommandHandlers, type Entity, type World } from "@engine/core";
import { installSpatialIndex } from "@engine/world";
import raw from "../data/pets.json";
import {
  Anim, Animal, AnimState, BuildPiece, Container, ContainerViewers, Dead, Health, Inventory, LootBag, Pet, PET_NAME_MAX, PetBrain, PetCmd, PieceOwner,
  Survival, Tamed, Tribe, TroughOwner, Zombie,
} from "./components.js";
import { gameplayDefs, isAuthority } from "./config.js";
import { emit, ev, Damaged, PiecePlaced, PieceDamaged } from "./events.js";
import { addItem, canAddItem, countItem, listSlots, moveSlotTuples, removeItem, takeFromSlot, transferItem } from "./inventory.js";
import { animalDefs, populationTile } from "./population.js";
import { applyDamage, setAnim } from "./combat/combat.js";
import { awardXp } from "./skills/progression.js";
import { indexEntity } from "./spawn.js";
import { maskProfanity } from "./signs.js";
import { swimSpeedMulAt } from "./systems/movement.js";
import { creatureStep, navNeeded, reachableSpotNear, walledOff } from "./systems/creature_nav.js";
import { PVP } from "./combat/pvp.js";

export type TreatPref = "love" | "like" | "ok" | "hate";
export interface PetSpecies { key: string; name: string; animal: string; family: string; baseTame: number; damageMul: number; treats: Record<string, TreatPref>; diet: string[] }
export type PetTuning = typeof raw.tuning;
export const PET_TUNING: Readonly<PetTuning> = raw.tuning;
export const PET_SPECIES: readonly PetSpecies[] = raw.species as PetSpecies[];
export const PET_TREATS: readonly string[] = raw.treats;
export const PREF_MUL: Readonly<Record<TreatPref, number>> = raw.prefMul as Record<TreatPref, number>;
const T = PET_TUNING;
const sec = (s: number): number => Math.max(1, Math.round(s * DEFAULT_TICK_HZ));
/** Species (1-based) by index; undefined for 0 / out of range. */
export const petSpecies = (species: number): PetSpecies | undefined => PET_SPECIES[species - 1];
export const petSpeciesOfKey = (key: string): number => PET_SPECIES.findIndex((s) => s.key === key) + 1;
/** Species (1-based) of an animal entity's kind, 0 = not a pet species. */
export function speciesOfAnimal(world: World, e: Entity): number {
  const k = world.getField(e, Animal, "kind"); if (k === undefined) return 0; const key = animalDefs()[k]?.key; if (!key) return 0;
  return PET_SPECIES.findIndex((s) => s.animal === key) + 1;
}
export const treatPref = (species: number, treat: string): TreatPref | undefined => petSpecies(species)?.treats[treat];
/** Tame chance of offering `treat` (item key) to a wild animal of `species` (0 = refuses / not a treat). */
export function tameChance(species: number, treat: string): number {
  const s = petSpecies(species); const p = s?.treats[treat]; return s && p ? Math.min(0.95, s.baseTame * PREF_MUL[p]) : 0;
}
/** Fullness gained eating `item` (0 = not edible for this species). Treats (not hated) or diet items. */
export function petFoodValue(species: number, item: string): number {
  const s = petSpecies(species); if (!s) return 0; const p = s.treats[item];
  if (p) return p === "hate" ? 0 : T.treatFullness; return s.diet.includes(item) ? T.foodFullness : 0;
}
// ---- level curve --------------------------------------------------------------------------------------
export const petXpToNext = (level: number): number => Math.round(T.xpBase * Math.pow(T.xpGrowth, Math.max(0, level - 1)));
export interface PetStats { maxHp: number; damage: number; walk: number; run: number; attackRange: number }
export function petStats(species: number, level: number): PetStats {
  const s = petSpecies(species); const def = s ? animalDefs().find((a) => a.key === s.animal) : undefined; const l = Math.max(1, level) - 1;
  const base = def?.hp ?? 30; const dmg = (def?.attack?.damage ?? 3) * (s?.damageMul ?? 1); const fast = def?.fleeSpeed ?? 3.5;
  return { maxHp: Math.round(base * (1 + T.hpPerLevel * l)), damage: dmg * (1 + T.damagePerLevel * l), walk: fast * 0.62 * (1 + T.speedPerLevel * l), run: fast * 1.25 * (1 + T.speedPerLevel * l), attackRange: T.attackRange };
}
// ---- names --------------------------------------------------------------------------------------------
export function sanitizePetName(rawName: string): string {
  return maskProfanity(rawName.replace(/[^\x20-\x7e]/g, " ").replace(/\s+/g, " ").trim().slice(0, Math.min(T.nameMax, PET_NAME_MAX)).trimEnd());
}
export function petName(world: World, e: Entity): string {
  const n = world.getField(e, Pet, "len") ?? 0; const a = world.getArray(e, Pet, "name");
  if (!a || !n) return petSpecies(world.getField(e, Pet, "species") ?? 0)?.name ?? "Pet";
  let o = ""; for (let i = 0; i < Math.min(n, PET_NAME_MAX); i++) o += String.fromCharCode(a[i] ?? 32); return o;
}
function writeName(world: World, e: Entity, name: string): void {
  const a = world.getArray(e, Pet, "name"); if (!a) return; for (let i = 0; i < PET_NAME_MAX; i++) a[i] = i < name.length ? name.charCodeAt(i) : 0;
  world.setField(e, Pet, "len", name.length); world.store(Pet).markChanged(entityIndex(e));
}
// ---- ownership ----------------------------------------------------------------------------------------
const pidOf = (world: World, e: Entity): number => (world.isRegistered(PlayerId) && world.has(e, PlayerId) ? world.getField(e, PlayerId, "id") ?? 0 : 0);
export const petOwnerId = (world: World, pet: Entity): number => world.getField(pet, Pet, "owner") ?? 0;
export const isPetOwner = (world: World, actor: Entity, pet: Entity): boolean => { const id = pidOf(world, actor); return id !== 0 && world.has(pet, Pet) && petOwnerId(world, pet) === id; };
/** Live entity of a PlayerId (owner of a pet), undefined when offline / dead. */
export function playerEntity(world: World, id: number): Entity | undefined {
  if (!id || !world.isRegistered(PlayerId)) return undefined;
  for (const e of world.query([PlayerId, Transform], [Dead])) if (world.getField(e, PlayerId, "id") === id) return e;
  return undefined;
}
/** Pets owned by PlayerId `id` (sorted). */
export function petsOf(world: World, id: number): Entity[] {
  const out: Entity[] = []; if (!id) return out; for (const e of world.query([Pet])) if (world.getField(e, Pet, "owner") === id) out.push(e); return out.sort((a, b) => a - b);
}
// ---- events -------------------------------------------------------------------------------------------
export const enum PetResult { Tamed = 1, Refused = 2, Shied = 3, Fed = 4, NotHungry = 5, LevelUp = 6, Renamed = 7, Command = 8 }
export const PetEvent = ev<{ entity: Entity; pet: Entity; result: PetResult; value: number }>("gameplay.PetEvent");
export const PetAte = ev<{ pet: Entity; item: number; source: number }>("gameplay.PetAte");
// ---- taming / feeding by hand -------------------------------------------------------------------------
export const enum PetFail { None = 0, NotFound = 1, TooFar = 2, NotPetSpecies = 3, NoItem = 4, NotTreat = 5, NotOwner = 6, NotFood = 7 }
export const PET_FAIL_REASONS = ["", "not_found", "too_far", "not_pet", "no_item", "not_treat", "not_owner", "not_food"] as const;
const near = (world: World, a: Entity, b: Entity, r: number): boolean => { const p = world.get(a, Transform), q = world.get(b, Transform); return !!p && !!q && Math.hypot(p.x - q.x, p.y - q.y) <= r; };
export function checkOffer(world: World, actor: Entity, target: Entity, item: number): PetFail {
  if (!world.isAlive(target) || world.has(target, Dead) || !world.has(target, Animal)) return PetFail.NotFound;
  if (!near(world, actor, target, T.interactRange + 0.75)) return PetFail.TooFar;
  const sp = world.has(target, Pet) ? world.getField(target, Pet, "species")! : speciesOfAnimal(world, target); if (!sp) return PetFail.NotPetSpecies;
  if (countItem(world, actor, item) < 1) return PetFail.NoItem;
  const key = gameplayDefs(world).items.get(item)?.key ?? "";
  if (world.has(target, Pet)) { if (!isPetOwner(world, actor, target)) return PetFail.NotOwner; return petFoodValue(sp, key) > 0 ? PetFail.None : PetFail.NotFood; }
  if (world.has(target, Tamed)) return PetFail.NotOwner;
  return treatPref(sp, key) ? PetFail.None : PetFail.NotTreat;
}
/** Turn a wild animal into `owner`'s pet (no checks). */
export function makePet(world: World, animal: Entity, owner: Entity, species = speciesOfAnimal(world, animal)): void {
  const ownerId = pidOf(world, owner); const t = world.get(animal, Transform)!; const st = petStats(species, 1);
  const kind = world.getField(animal, Animal, "kind")!;
  world.add(animal, Pet, { species, owner: ownerId, cmd: PetCmd.Follow, level: 1, xp: 0, fullness: 80, loyalty: T.startLoyalty, hp: st.maxHp, stayX: t.x, stayY: t.y, len: 0 });
  if (!world.has(animal, Tamed)) world.add(animal, Tamed, { kind, owner, fedUntil: world.tick, produceAt: world.tick + sec(600), breedAt: world.tick + sec(1e6) });
  if (!world.has(animal, Container)) world.add(animal, Container, { slotCount: T.inventorySlots, maxWeight: 0 }).add(animal, ContainerViewers);
  world.set(animal, Health, { hp: st.maxHp, max: st.maxHp });
  if (!world.has(animal, PetBrain)) world.add(animal, PetBrain, {});
}
/** Offer one `item` from actor's inventory: tame (wild) or feed (own pet). Consumes the item unless refused. */
export function offerTreat(world: World, actor: Entity, target: Entity, item: number): { fail: PetFail; result?: PetResult } {
  const fail = checkOffer(world, actor, target, item); if (fail) return { fail };
  const key = gameplayDefs(world).items.get(item)!.key;
  if (world.has(target, Pet)) {
    const p = world.get(target, Pet)!; const v = petFoodValue(p.species, key);
    if (p.fullness >= 99.5 && !PET_TREATS.includes(key)) { emit(world, PetEvent, { entity: actor, pet: target, result: PetResult.NotHungry, value: 0 }); return { fail, result: PetResult.NotHungry }; }
    removeItem(world, actor, item, 1);
    world.set(target, Pet, { fullness: Math.min(100, p.fullness + v), loyalty: Math.min(100, p.loyalty + (PET_TREATS.includes(key) ? T.loyaltyPerTreat : 2)) });
    emit(world, PetAte, { pet: target, item, source: 0 }); emit(world, PetEvent, { entity: actor, pet: target, result: PetResult.Fed, value: item });
    setAnim(world, target, Anim.Eat); return { fail, result: PetResult.Fed };
  }
  const sp = speciesOfAnimal(world, target); const chance = tameChance(sp, key);
  if (chance <= 0) { emit(world, PetEvent, { entity: actor, pet: target, result: PetResult.Refused, value: item }); return { fail, result: PetResult.Refused }; }
  removeItem(world, actor, item, 1);
  if (world.rngFor(`pet.tame.${world.tick}`, target).next() >= chance) {
    emit(world, PetEvent, { entity: actor, pet: target, result: PetResult.Shied, value: item }); return { fail, result: PetResult.Shied };
  }
  makePet(world, target, actor, sp); awardXp(world, actor, "tame");
  emit(world, PetEvent, { entity: actor, pet: target, result: PetResult.Tamed, value: sp }); return { fail, result: PetResult.Tamed };
}
export function setPetCommand(world: World, actor: Entity, pet: Entity, cmd: number): PetFail {
  if (!world.isAlive(pet) || !world.has(pet, Pet)) return PetFail.NotFound; if (!isPetOwner(world, actor, pet)) return PetFail.NotOwner;
  const t = world.get(pet, Transform)!; world.set(pet, Pet, { cmd: cmd === PetCmd.Stay ? PetCmd.Stay : PetCmd.Follow, stayX: t.x, stayY: t.y });
  world.setField(pet, PetBrain, "target", 0); emit(world, PetEvent, { entity: actor, pet, result: PetResult.Command, value: cmd }); return PetFail.None;
}
export function renamePet(world: World, actor: Entity, pet: Entity, name: string): PetFail {
  if (!world.isAlive(pet) || !world.has(pet, Pet)) return PetFail.NotFound; if (!isPetOwner(world, actor, pet)) return PetFail.NotOwner;
  writeName(world, pet, sanitizePetName(name)); emit(world, PetEvent, { entity: actor, pet, result: PetResult.Renamed, value: 0 }); return PetFail.None;
}
// ---- dropping items on the ground ---------------------------------------------------------------------
/** Drop `count` of `item` from e's inventory into a new owner-tagged loot bag at its feet (pets fetch these). */
export function dropItem(world: World, e: Entity, item: number, count: number): Entity | undefined {
  const have = countItem(world, e, item); const n = Math.min(have, Math.max(1, count)); if (!n) return undefined;
  const t = world.get(e, Transform); if (!t) return undefined;
  const bag = world.create(); const ang = t.facing ?? 0;
  world.add(bag, Transform, { x: t.x + Math.cos(ang) * 0.6, y: t.y + Math.sin(ang) * 0.6, z: t.z }).add(bag, Container, { slotCount: 4 }).add(bag, ContainerViewers)
    .add(bag, LootBag, { owner: pidOf(world, e), despawnAtTick: world.tick + sec(PVP.bagDespawnSeconds) });
  transferItem(world, e, bag, item, n); tagLootSource(world, bag, LootSource.Dropped); indexEntity(world, bag); return bag;
}
// ---- commands -----------------------------------------------------------------------------------------
export const PetOfferCmd = defineCommand("gameplay.petOffer", { target: "u32", item: "u16" });
export const PetCommandCmd = defineCommand("gameplay.petCommand", { pet: "u32", cmd: "u8" });
export const PetRenameCmd = defineCommand("gameplay.petRename", { pet: "u32", len: "u8", text: { type: "u8", length: PET_NAME_MAX } });
export const DropItemCmd = defineCommand("gameplay.dropItem", { item: "u16", count: "u16" });
export const PET_COMMANDS: readonly CommandDef[] = [PetOfferCmd, PetCommandCmd, PetRenameCmd, DropItemCmd];
export const PET_ENTITY_FIELDS: Readonly<Record<string, readonly string[]>> = { [PetOfferCmd.name]: ["target"], [PetCommandCmd.name]: ["pet"], [PetRenameCmd.name]: ["pet"] };
export const PET_REJECT_REASONS = ["not_pet", "not_treat", "not_food"] as const;
export const encodePetName = (name: string): { len: number; text: number[] } => {
  const s = sanitizePetName(name); return { len: s.length, text: Array.from({ length: PET_NAME_MAX }, (_, i) => (i < s.length ? s.charCodeAt(i) : 0)) };
};
const decode = (len: number, b: ArrayLike<number>): string => Array.from({ length: Math.min(len, PET_NAME_MAX) }, (_, i) => String.fromCharCode(b[i] ?? 32)).join("");
export function installPetCommands(world: World, handlers: CommandHandlers): void {
  const r = (f: PetFail): string | undefined => (f ? PET_FAIL_REASONS[f] : undefined);
  const owned = (actor: Entity, pet: Entity): PetFail => (!world.isAlive(pet) || !world.has(pet, Pet) ? PetFail.NotFound : !isPetOwner(world, actor, pet) ? PetFail.NotOwner : near(world, actor, pet, 40) ? PetFail.None : PetFail.TooFar);
  handlers.on(PetOfferCmd, { validate: (v, c) => r(checkOffer(world, c.actor, v.target as Entity, v.item)), handle: (v, c) => { offerTreat(world, c.actor, v.target as Entity, v.item); } });
  handlers.on(PetCommandCmd, { validate: (v, c) => r(owned(c.actor, v.pet as Entity)), handle: (v, c) => { setPetCommand(world, c.actor, v.pet as Entity, v.cmd); } });
  handlers.on(PetRenameCmd, { validate: (v, c) => r(owned(c.actor, v.pet as Entity)), handle: (v: { pet: number; len: number; text: ArrayLike<number> }, c) => { renamePet(world, c.actor, v.pet as Entity, decode(v.len, v.text)); } });
  handlers.on(DropItemCmd, { validate: (v, c) => (countItem(world, c.actor, v.item) > 0 ? undefined : "no_item"), handle: (v, c) => { dropItem(world, c.actor, v.item, v.count); } });
}
// ---- runtime hooks --------------------------------------------------------------------------------------
interface Aggro { attacker: Entity; tick: number }
/** Recent attackers per owner PlayerId (owner / their pets / their structures were hit). */
const aggroOf = new WeakMap<World, Map<number, Aggro[]>>();
const troughKind = new WeakMap<World, number>();
function noteAggro(world: World, ownerId: number, attacker: Entity): void {
  if (!ownerId || !world.isAlive(attacker) || world.has(attacker, BuildPiece)) return; let m = aggroOf.get(world); if (!m) aggroOf.set(world, (m = new Map()));
  const l = (m.get(ownerId) ?? []).filter((a) => a.attacker !== attacker && world.tick - a.tick < sec(15)); l.push({ attacker, tick: world.tick }); m.set(ownerId, l.slice(-6));
}
/** Registers event hooks (aggro memory for defence, pet_trough ownership). Call once per authority world. */
export function installPets(world: World): void {
  world.events.on(Damaged, (p: { target: Entity; source: Entity }) => {
    if (!isAuthority(world) || p.source === p.target || !world.isAlive(p.source)) return;
    if (world.has(p.source, Pet) && world.has(p.target, Pet) && petOwnerId(world, p.source) === petOwnerId(world, p.target)) return;
    const victimOwner = world.has(p.target, Pet) ? petOwnerId(world, p.target) : pidOf(world, p.target);
    if (victimOwner && !(world.has(p.source, Pet) && petOwnerId(world, p.source) === victimOwner) && pidOf(world, p.source) !== victimOwner) noteAggro(world, victimOwner, p.source);
  });
  world.events.on(PieceDamaged, (p: { piece: Entity; attacker: Entity }) => {
    if (!isAuthority(world) || !world.isAlive(p.piece)) return;
    const owner = (world.isRegistered(PieceOwner) ? world.getField(p.piece, PieceOwner, "player") : 0) || (world.getField(p.piece, TroughOwner, "player") ?? 0);
    if (owner && p.attacker && pidOf(world, p.attacker) !== owner) noteAggro(world, owner, p.attacker);
  });
  world.events.on(PiecePlaced, (p: { piece: Entity; type: number; builder: Entity }) => {
    if (!isAuthority(world) || p.type !== troughId(world)) return; const id = pidOf(world, p.builder);
    if (id && world.isAlive(p.piece)) world.add(p.piece, TroughOwner, { player: id });
  });
}
function troughId(world: World): number {
  let id = troughKind.get(world); if (id === undefined) { try { id = gameplayDefs(world).pieceId("pet_trough"); } catch { id = -1; } troughKind.set(world, id); } return id;
}
/** LootBag.despawnAtTick of a permanent cache (e.g. the sandbox pet-corner crate): pets never eat from or loot those. */
export const PERMANENT_BAG = 0xffffffff;
// ---- system ---------------------------------------------------------------------------------------------
const hostile = (world: World, e: Entity): boolean => world.has(e, Zombie);
const valid = (world: World, e: Entity): boolean => !!e && world.isAlive(e) && !world.has(e, Dead) && world.has(e, Health) && world.has(e, Transform);
export function grantXp(world: World, pet: Entity, amount: number): void {
  const p = world.get(pet, Pet)!; let xp = p.xp + Math.max(0, Math.round(amount)); let level = p.level; let up = false;
  while (level < T.maxLevel && xp >= petXpToNext(level)) { xp -= petXpToNext(level); level++; up = true; }
  if (level >= T.maxLevel) xp = Math.min(xp, petXpToNext(level));
  world.set(pet, Pet, { xp, level });
  if (up) {
    const st = petStats(p.species, level); const h = world.get(pet, Health)!; const hp = Math.min(st.maxHp, h.hp + (st.maxHp - h.max));
    world.set(pet, Health, { max: st.maxHp, hp }); world.setField(pet, Pet, "hp", hp);
    const owner = playerEntity(world, p.owner); emit(world, PetEvent, { entity: owner ?? pet, pet, result: PetResult.LevelUp, value: level });
  }
}
export { grantXp as grantPetXp };
function edibleSlot(world: World, from: Entity, species: number): { item: number; slot: number; value: number } | undefined {
  const defs = gameplayDefs(world); let best: { item: number; slot: number; value: number } | undefined;
  for (const s of listSlots(world, from)) {
    if (!s.item || !s.count) continue; const v = petFoodValue(species, defs.items.get(s.item)?.key ?? "");
    if (v > 0 && (!best || v > best.value)) best = { item: s.item, slot: s.slot, value: v };
  }
  return best;
}
function eatFrom(world: World, pet: Entity, from: Entity, source: number): boolean {
  const p = world.get(pet, Pet)!; const f = edibleSlot(world, from, p.species); if (!f) return false;
  if (!removeItem(world, from, f.item, 1)) return false;
  world.set(pet, Pet, { fullness: Math.min(100, p.fullness + f.value), loyalty: Math.min(100, p.loyalty + 1) });
  setAnim(world, pet, Anim.Eat); emit(world, PetAte, { pet, item: f.item, source }); return true;
}
/** Owned food sources within `r` of (x, y): loot bags (any open bag or one the owner dropped) and the owner's pet troughs. */
function foodSources(world: World, pet: Entity, x: number, y: number): { e: Entity; d: number; source: number }[] {
  const p = world.get(pet, Pet)!; const out: { e: Entity; d: number; source: number }[] = []; const tid = troughId(world);
  const ownerE = playerEntity(world, p.owner); const tribe = ownerE !== undefined ? world.getField(ownerE, Tribe, "id") ?? 0 : 0;
  for (const e of installSpatialIndex(world).queryRadius(x, y, Math.max(T.groundSearchRange, T.troughRange))) {
    if (!world.isAlive(e) || !world.has(e, Container) || e === pet) continue; const t = world.get(e, Transform); if (!t) continue; const d = Math.hypot(t.x - x, t.y - y);
    if (world.has(e, LootBag)) {
      const o = world.getField(e, LootBag, "owner") ?? 0; if (world.getField(e, LootBag, "despawnAtTick") === PERMANENT_BAG) continue; // caches/crates are not "the ground"
      if (d <= T.groundSearchRange && (o === 0 || o === p.owner) && edibleSlot(world, e, p.species)) out.push({ e, d, source: 1 });
    } else if (world.getField(e, BuildPiece, "type") === tid && d <= T.troughRange) {
      const own = world.getField(e, TroughOwner, "player") || (world.isRegistered(PieceOwner) ? world.getField(e, PieceOwner, "player") ?? 0 : 0);
      const ok = own === p.owner || (tribe !== 0 && world.getField(e, Tribe, "id") === tribe);
      if (ok && edibleSlot(world, e, p.species)) out.push({ e, d, source: 2 });
    }
  }
  return out.sort((a, b) => a.d - b.d || a.e - b.e);
}
function pickupTarget(world: World, pet: Entity, x: number, y: number): Entity | undefined {
  const p = world.get(pet, Pet)!; let best: Entity | undefined, bd = Infinity;
  for (const e of installSpatialIndex(world).queryRadius(x, y, T.pickupRange)) {
    if (!world.isAlive(e) || !world.has(e, LootBag) || !world.has(e, Container)) continue; const o = world.getField(e, LootBag, "owner") ?? 0;
    if (o !== p.owner) continue; // only fetch what the owner dropped
    if (!listSlots(world, e).some((s) => s.item && s.count && canAddItem(world, pet, s.item, 1) > 0)) continue;
    const t = world.get(e, Transform)!; const d = Math.hypot(t.x - x, t.y - y); if (d < bd) { bd = d; best = e; }
  }
  return best;
}
function threatNear(world: World, pet: Entity, x: number, y: number, r: number): Entity | undefined {
  const p = world.get(pet, Pet)!; let best: Entity | undefined, bd = Infinity;
  const aggro = (aggroOf.get(world)?.get(p.owner) ?? []).filter((a) => world.tick - a.tick < sec(15) && valid(world, a.attacker));
  const consider = (e: Entity): void => { const t = world.get(e, Transform)!; const d = Math.hypot(t.x - x, t.y - y); if (d <= r && (d < bd || (d === bd && best !== undefined && e < best))) { bd = d; best = e; } };
  for (const a of aggro) if (!(world.has(a.attacker, Pet) && petOwnerId(world, a.attacker) === p.owner)) consider(a.attacker);
  if (best !== undefined) return best;
  for (const e of installSpatialIndex(world).queryRadius(x, y, r)) if (e !== pet && valid(world, e) && hostile(world, e)) consider(e);
  return best;
}
/** Move pet toward (gx, gy) at `speed` tiles/s; returns true if it moved. */
function step(world: World, e: Entity, gx: number, gy: number, speed: number, dt: number, stopAt = 0.15): boolean {
  const t = world.get(e, Transform)!; const dx = gx - t.x, dy = gy - t.y, d = Math.hypot(dx, dy); if (d <= stopAt) return false;
  const sp = speed * swimSpeedMulAt(world, t.x, t.y) * dt; const k = Math.min(sp, d - stopAt) / d;
  const unwalk = gameplayDefs(world).worldgen.unwalkableTiles;
  const nav = creatureStep(world, e, gx, gy, sp, stopAt, petBlocked(world), dt); // ADR-214: walls, closed doors, stations
  if (nav !== undefined) return nav;
  const nx = t.x + dx * k, ny = t.y + dy * k;
  if (unwalk.has(populationTile(world, Math.floor(nx), Math.floor(ny)))) {
    // slide along one axis
    if (!unwalk.has(populationTile(world, Math.floor(nx), Math.floor(t.y)))) world.set(e, Transform, { x: nx, facing: Math.atan2(dy, dx) });
    else if (!unwalk.has(populationTile(world, Math.floor(t.x), Math.floor(ny)))) world.set(e, Transform, { y: ny, facing: Math.atan2(dy, dx) });
    else return false; return true;
  }
  world.set(e, Transform, { x: nx, y: ny, facing: Math.atan2(dy, dx) }); return true;
}
/** ADR-214: within followDistance of the owner but walled off, the pet paths round until this close (or in sight). */
const WALLED_STOP = 0.8;
const petBlocked = (world: World) => { const unwalk = gameplayDefs(world).worldgen.unwalkableTiles; return (tx: number, ty: number): boolean => unwalk.has(populationTile(world, tx, ty)); };
/** ADR-214: a trough is a solid piece the pet body now stops against (bodyRadius off its tile), so its reach covers a 1-tile footprint. */
const TROUGH_REACH = 1.5;
/** Catch-up spot beside the owner: legacy (-1, +0.5); near structures (ADR-214) the first offset in body-sized sight of the owner, so a pet never lands on the far side of a wall or inside a station. */
const TELEPORT_OFFSETS: readonly [number, number][] = [[-1, 0.5], [1, 0.5], [0.5, 1], [0.5, -1], [-1, -0.5], [1, -0.5], [-0.5, 1], [-0.5, -1], [-0.6, 0], [0.6, 0], [0, 0.6], [0, -0.6]];
function teleportSpot(world: World, ot: { x: number; y: number; z?: number }): { x: number; y: number; z?: number } {
  if (!navNeeded(world, ot.x - 1.5, ot.y - 1.5, ot.x + 1.5, ot.y + 1.5)) return { x: ot.x - 1, y: ot.y + 0.5 };
  const z = ot.z ?? 0;
  const unwalk = gameplayDefs(world).worldgen.unwalkableTiles;
  return { ...reachableSpotNear(world, ot.x, ot.y, z, (tx, ty) => unwalk.has(populationTile(world, tx, ty)), TELEPORT_OFFSETS), z };
}
/** ADR-146: a pet on Stay sits when idle (render: AnimState Sit = 13 -> the pet atlas's `sit` animation). Client-safe (replicated Pet.cmd). */
export function petSits(world: World, e: Entity): boolean { return world.isRegistered(Pet) && world.has(e, Pet) && world.getField(e, Pet, "cmd") === PetCmd.Stay; }
const animAt = (world: World, e: Entity, anim: Anim): void => {
  const cur = world.getField(e, AnimState, "anim"); if (cur === Anim.Hurt || ((cur === Anim.Attack || cur === Anim.Eat) && world.tick - (world.getField(e, AnimState, "startTick") ?? 0) < sec(0.5))) return; setAnim(world, e, anim);
};
/** Authority, every tick (after animal AI): pet needs, movement, defence, pickup. */
export function petSystem(world: World, dt: number): void {
  if (!isAuthority(world) || world.isReplaying) return;
  const now = world.tick; const defs = gameplayDefs(world);
  // dead pets: inventory -> loot bag for the owner (animalAI then plays the corpse + removes the entity)
  for (const e of [...world.query([Pet, Dead, Container])].sort((a, b) => a - b)) {
    const moves = listSlots(world, e).filter((s) => s.item && s.count).map((s) => ({ slot: s.slot, count: s.count })); if (!moves.length) continue;
    const t = world.get(e, Transform)!; const bag = world.create();
    world.add(bag, Transform, { x: t.x + 0.3, y: t.y, z: t.z }).add(bag, Container, { slotCount: Math.max(4, moves.length) }).add(bag, ContainerViewers)
      .add(bag, LootBag, { owner: petOwnerId(world, e), despawnAtTick: now + sec(PVP.bagDespawnSeconds) });
    moveSlotTuples(world, e, bag, moves); tagLootSource(world, bag, LootSource.Animal); indexEntity(world, bag);
  }
  for (const e of [...world.query([Pet, Transform], [Dead])].sort((a, b) => a - b)) {
    const p = world.get(e, Pet)!; const st = petStats(p.species, p.level);
    if (!world.has(e, PetBrain)) world.add(e, PetBrain, { nextEat: now, nextStarve: now + sec(10) });
    if (!world.has(e, Animal) || !world.has(e, AnimState)) continue; // husbandrySystem restores these after a load
    if (!world.has(e, ContainerViewers)) world.add(e, ContainerViewers);
    // Health is not persistent: rebuild from Pet.hp / level once after a load
    const h = world.get(e, Health);
    if (!h) { world.add(e, Health, { hp: Math.max(1, p.hp || st.maxHp), max: st.maxHp }); }
    else if (h.max !== st.maxHp) world.set(e, Health, { max: st.maxHp, hp: Math.min(h.hp, st.maxHp) });
    const hp = world.getField(e, Health, "hp")!; if (Math.abs(hp - p.hp) >= 0.5) world.setField(e, Pet, "hp", hp);
    const b = world.get(e, PetBrain)!; const t = world.get(e, Transform)!;
    // hunger
    const fullness = Math.max(0, p.fullness - (T.hungerPerMinute / 60) * dt); if (Math.abs(fullness - p.fullness) > 1e-6) world.setField(e, Pet, "fullness", fullness);
    if (fullness <= 0 && now >= b.nextStarve) {
      world.setField(e, PetBrain, "nextStarve", now + sec(10));
      const cur = world.getField(e, Health, "hp")!; if (cur > 1) world.setField(e, Health, "hp", Math.max(1, cur - T.starveHpPerTenSeconds));
      world.setField(e, Pet, "loyalty", Math.max(0, p.loyalty - T.starveLoyaltyPerTenSeconds));
    } else if (fullness > 50 && now >= b.nextStarve) { // well fed: slow regen
      world.setField(e, PetBrain, "nextStarve", now + sec(10)); const cur = world.getField(e, Health, "hp")!; if (cur < st.maxHp) world.setField(e, Health, "hp", Math.min(st.maxHp, cur + 1));
    }
    const ownerE = playerEntity(world, p.owner); const ot = ownerE !== undefined ? world.get(ownerE, Transform) : undefined;
    const stay = p.cmd === PetCmd.Stay; const ax = stay ? p.stayX : ot?.x ?? p.stayX, ay = stay ? p.stayY : ot?.y ?? p.stayY;
    let moved = false; let run = false; let busy = false;
    // defend
    if (!busy) {
      let target = b.target as Entity;
      const guardR = T.defendRange; const leash = Math.hypot(t.x - ax, t.y - ay) > T.leashRange;
      if (!valid(world, target) || leash) target = (leash ? undefined : threatNear(world, e, ax, ay, guardR)) ?? (0 as Entity);
      if (target !== b.target) world.setField(e, PetBrain, "target", target);
      if (target && valid(world, target)) {
        busy = true; const tt = world.get(target, Transform)!; const d = Math.hypot(tt.x - t.x, tt.y - t.y);
        if (d <= st.attackRange + 0.4) {
          world.set(e, Transform, { facing: Math.atan2(tt.y - t.y, tt.x - t.x) });
          if (now >= b.nextAttack) {
            const before = world.getField(target, Health, "hp") ?? 0; const thp = world.getField(target, Health, "max") ?? before;
            applyDamage(world, target, st.damage, e); setAnim(world, e, Anim.Attack); world.setField(e, PetBrain, "nextAttack", now + sec(T.attackCooldownSeconds));
            const after = world.getField(target, Health, "hp") ?? 0;
            grantXp(world, e, T.xpPerHit * Math.max(1, before - after) + (after <= 0 && before > 0 ? thp * T.xpPerKillHp : 0));
            if (after <= 0) world.setField(e, PetBrain, "target", 0);
          }
        } else { moved = step(world, e, tt.x, tt.y, st.run, dt, st.attackRange); run = true; }
      }
    }
    // eat
    const hungry = fullness < T.eatBelow;
    if (!busy && hungry && now >= b.nextEat) { // ADR-145: defence beats dinner (a hungry pet still fights back)
      if (eatFrom(world, e, e, 0)) { world.setField(e, PetBrain, "nextEat", now + sec(T.eatCooldownSeconds)); busy = true; }
      else {
        const src = foodSources(world, e, t.x, t.y)[0];
        if (src) {
          const sxy = world.get(src.e, Transform)!; busy = true;
          if (src.d <= (src.source === 2 ? TROUGH_REACH : 1.0)) { if (eatFrom(world, e, src.e, src.source)) world.setField(e, PetBrain, "nextEat", now + sec(T.eatCooldownSeconds)); }
          else { moved = step(world, e, sxy.x, sxy.y, st.walk, dt, 0.6); }
        } else world.setField(e, PetBrain, "nextEat", now + sec(2));
      }
    }
    // fetch dropped items (follow only)
    if (!busy && !stay && ownerE !== undefined) {
      const bag = pickupTarget(world, e, t.x, t.y);
      if (bag !== undefined) {
        busy = true; const bt = world.get(bag, Transform)!; const d = Math.hypot(bt.x - t.x, bt.y - t.y);
        if (d <= 0.9) {
          for (const s of listSlots(world, bag)) if (s.item && s.count) { const n = Math.min(s.count, canAddItem(world, e, s.item, s.count)); if (n > 0) { const moved1 = moveSlotTuples(world, bag, e, [{ slot: s.slot, count: n }]); if (moved1) break; } }
        } else moved = step(world, e, bt.x, bt.y, st.walk * 1.3, dt, 0.5) || moved;
      }
    }
    // follow / stay
    if (!busy) {
      const d = Math.hypot(ax - t.x, ay - t.y);
      if (!stay && ot && d > T.teleportDistance) { world.set(e, Transform, teleportSpot(world, ot)); }
      else if (!stay && ot && d > T.followDistance) { run = d > T.runDistance; moved = step(world, e, ax, ay, run ? st.run : st.walk, dt, T.followDistance * 0.7); }
      else if (!stay && ot && d > WALLED_STOP && walledOff(world, t.x, t.y, ax, ay, t.z ?? 0, petBlocked(world))) moved = step(world, e, ax, ay, st.walk, dt, WALLED_STOP); // ADR-214: close but through a wall: go round
      else if (stay && d > 0.4) moved = step(world, e, ax, ay, st.walk, dt, 0.2);
    }
    world.set(e, Animal, { homeX: ax, homeY: ay, state: moved ? (run ? 2 : 1) : 0 });
    animAt(world, e, moved ? (run ? Anim.Run : Anim.Walk) : !busy && stay ? Anim.Sit : Anim.Idle);
  }
  void defs; void Survival; void Inventory; void addItem; void takeFromSlot;
}
// ---- client view-model (replica reads only) ------------------------------------------------------------
export interface PetOffer { item: number; key: string; name: string; count: number; chance: number; pref: TreatPref | "food"; fullness: number }
export interface PetView {
  entity: Entity; species: number; speciesName: string; name: string; owned: boolean; wild: boolean; ownerId: number;
  level: number; xp: number; xpNext: number; hp: number; maxHp: number; fullness: number; loyalty: number; cmd: number; offers: PetOffer[];
}
/** Pet / tameable animal panel data for `player` looking at `e` (undefined = not a pet species). */
export function petView(world: World, player: Entity, e: Entity): PetView | undefined {
  if (!world.isAlive(e) || world.has(e, Dead)) return undefined; const p = world.get(e, Pet); const sp = p?.species ?? speciesOfAnimal(world, e); const s = petSpecies(sp); if (!s) return undefined;
  if (!p && world.has(e, Tamed)) return undefined; // husbandry livestock
  const defs = gameplayDefs(world); const offers: PetOffer[] = [];
  for (const sl of listSlots(world, player)) {
    if (!sl.item || !sl.count || offers.some((o) => o.item === sl.item)) continue; const d = defs.items.get(sl.item); if (!d) continue;
    const pref = s.treats[d.key]; const full = petFoodValue(sp, d.key);
    if (p) { if (full > 0) offers.push({ item: d.id, key: d.key, name: d.name, count: countItem(world, player, d.id), chance: 1, pref: pref ?? "food", fullness: full }); }
    else if (pref) offers.push({ item: d.id, key: d.key, name: d.name, count: countItem(world, player, d.id), chance: tameChance(sp, d.key), pref, fullness: full });
  }
  offers.sort((a, b) => b.chance - a.chance || b.fullness - a.fullness || a.item - b.item);
  const level = p?.level ?? 1; const st = petStats(sp, level); const h = world.get(e, Health);
  return {
    entity: e, species: sp, speciesName: s.name, name: p ? petName(world, e) : `Wild ${s.name}`, owned: !!p && isPetOwner(world, player, e), wild: !p, ownerId: p?.owner ?? 0,
    level, xp: p?.xp ?? 0, xpNext: petXpToNext(level), hp: h?.hp ?? p?.hp ?? st.maxHp, maxHp: h?.max ?? st.maxHp, fullness: p?.fullness ?? 0, loyalty: p?.loyalty ?? 0, cmd: p?.cmd ?? 0, offers,
  };
}
/** Nearest pet (own first) or tameable wild animal within `range` of the player. */
export function nearestPet(world: World, player: Entity, range = T.interactRange + 0.5): { entity: Entity; d: number } | undefined {
  const me = world.get(player, Transform); if (!me) return undefined; let best: { entity: Entity; d: number } | undefined;
  for (const e of world.query([Animal, Transform], [Dead])) {
    if (!world.has(e, Pet) && (world.has(e, Tamed) || !speciesOfAnimal(world, e))) continue;
    const t = world.get(e, Transform)!; const d = Math.hypot(t.x - me.x, t.y - me.y) - (isPetOwner(world, player, e) ? 0.3 : 0);
    if (d <= range && (!best || d < best.d)) best = { entity: e, d };
  }
  return best;
}
/** Short one-line help (also shown in the panel and the help menu); independent of the tutorial. */
export const PET_HELP = [
  "Pets: craft a treat (dog biscuit, meaty chew, fish treat, egg crunch at a campfire; seed mix, veggie bites by hand), walk up to a wild dog, cat, bird, rabbit or ferret and interact (E / X / tap) to offer it.",
  "Each species loves some treats and hates others: the panel shows your chance. A refused treat is kept; a failed try uses it.",
  "Your pet's panel: Follow (fights for you and fetches what you drop) or Stay (guards the spot, your buildings and pets), rename, feed, and a small bag you can fill or empty.",
  "Hungry pets eat from their bag, food lying on the ground, then your pet trough (Build > pet trough). Starving pets lose health slowly and trust, but never die of it.",
  "Pets gain XP fighting; every level adds health, damage and speed.",
] as const;
