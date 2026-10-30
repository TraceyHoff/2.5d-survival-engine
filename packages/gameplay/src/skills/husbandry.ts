/**
 * ADR-113 minimal domestication: Use animal_feed next to a passive farm animal (skill husbandry >= 1) -> chance to tame
 * (Tamed persists, despawn skipped, threat scan off, leashed wander). Feeding keeps it "fed"; fed tamed animals within
 * troughRange of a feeding_trough produce eggs/milk/wool into the trough container; with the breeding perk two fed animals
 * of one kind at a trough breed (cap maxPerTrough). Fences + trough = pen. Animal/AnimState are re-added after a load.
 */
import { DEFAULT_TICK_HZ, entityIndex, Transform, type Entity, type World } from "@engine/core";
import { Animal, AnimState, BuildPiece, Container, Dead, Equipment, IntentAction, PlayerIntent, Tamed } from "../components.js";
import { gameplayDefs, isAuthority } from "../config.js";
import { emit, ev } from "../events.js";
import { addItem, slotItem, takeFromSlot } from "../inventory.js";
import { animalDefs, spawnAnimal } from "../population.js";
import { awardXp } from "./progression.js";
import { hasPerk, SKILLS, skillLevelOf, skillMod } from "./tree.js";

const H = SKILLS.husbandry;
export const AnimalTamed = ev<{ entity: Entity; animal: Entity }>("gameplay.AnimalTamed");
export const AnimalBred = ev<{ owner: Entity; baby: Entity }>("gameplay.AnimalBred");
export const enum TameFail { None = 0, NoAnimal = 1, NotDomestic = 2, NeedsSkill = 3, Failed = 4, NotYours = 5 }
export const TAME_FAIL_TEXT: Readonly<Record<number, string>> = {
  [TameFail.NoAnimal]: "No animal close enough", [TameFail.NotDomestic]: "This animal can't be domesticated",
  [TameFail.NeedsSkill]: "Needs Animal Husbandry skill", [TameFail.Failed]: "It shied away — try again", [TameFail.NotYours]: "Someone else's animal",
};
const domestic = (kind: number): boolean => { const k = animalDefs()[kind]?.key; return !!k && k in H.animals; };
const sec = (s: number): number => Math.round(s * DEFAULT_TICK_HZ);

/** Nearest live animal within reach of e (deterministic tie-break by id). */
export function animalNear(world: World, e: Entity, r = H.reach): Entity | undefined {
  const t = world.get(e, Transform); if (!t) return undefined; let best: Entity | undefined, bd = r * r;
  for (const a of world.query([Animal, Transform], [Dead])) { const at = world.get(a, Transform)!; const d = (at.x - t.x) ** 2 + (at.y - t.y) ** 2; if (d <= bd && (best === undefined || d < bd || a < best)) { bd = d; best = a; } }
  return best;
}
/** ADR-234: taming chance for e (base x (1 + "tame" mod), capped at 95%). */
export const livestockTameChance = (world: World, e: Entity): number => Math.min(0.95, H.tameBase * (1 + skillMod(world, e, "tame")));
/** ADR-234: Husbandry 2 ("pens"): an owner's tamed animals settle, produce and breed at feeding troughs. Owners without
 *  Progression (NPCs, legacy) or offline owners (no live entity to read) are not gated. */
export const canUsePens = (world: World, owner: Entity): boolean => !owner || !world.isAlive(owner) || (skillLevelOf(world, owner, "husbandry") ?? 2) >= 2;
/** Dry-run (dryRun) or perform feeding/taming of the animal in front. Returns failure and whether feed should be consumed. */
export function feedAnimal(world: World, e: Entity, dryRun = false): { fail: TameFail; tame: boolean; consumed: boolean } {
  const a = animalNear(world, e); if (a === undefined) return { fail: TameFail.NoAnimal, tame: false, consumed: false };
  const tamed = world.get(a, Tamed);
  if (tamed) {
    if (tamed.owner !== e && tamed.owner !== 0) return { fail: TameFail.NotYours, tame: false, consumed: false };
    if (!dryRun) { world.set(a, Tamed, { fedUntil: world.tick + sec(H.fedSeconds) }); awardXp(world, e, "husbandry"); }
    return { fail: TameFail.None, tame: false, consumed: true };
  }
  const kind = world.get(a, Animal)!.kind; if (!domestic(kind)) return { fail: TameFail.NotDomestic, tame: true, consumed: false };
  if ((skillLevelOf(world, e, "husbandry") ?? 1) < 1) return { fail: TameFail.NeedsSkill, tame: true, consumed: false };
  if (dryRun) return { fail: TameFail.None, tame: true, consumed: true };
  const chance = livestockTameChance(world, e);
  if (world.rngFor(`husbandry.tame.${world.tick}`, a).next() >= chance) return { fail: TameFail.Failed, tame: true, consumed: true };
  const now = world.tick; const p = H.animals[animalDefs()[kind]!.key]!;
  world.add(a, Tamed, { kind, owner: e, fedUntil: now + sec(H.fedSeconds), produceAt: now + sec(p.seconds), breedAt: now + sec(H.breedSeconds) });
  emit(world, AnimalTamed, { entity: e, animal: a }); awardXp(world, e, "tame");
  return { fail: TameFail.None, tame: true, consumed: true };
}

function troughs(world: World): Entity[] {
  let id: number; try { id = gameplayDefs(world).pieceId(H.trough); } catch { return []; }
  const out: Entity[] = []; for (const b of world.query([BuildPiece, Transform, Container], [Dead])) if (world.get(b, BuildPiece)!.type === id) out.push(b);
  return out.sort((x, y) => x - y);
}
export const HUSBANDRY_EVERY = DEFAULT_TICK_HZ; // once per second
/** Restore Animal after load; production + breeding at troughs. */
export function husbandrySystem(world: World): void {
  if (!isAuthority(world) || world.isReplaying) return;
  const defs = gameplayDefs(world); const now = world.tick; const tr = troughs(world);
  const animals = [...world.query([Tamed, Transform], [Dead])].sort((a, b) => a - b);
  for (const a of animals) if (!world.has(a, Animal)) {
    const t = world.get(a, Transform)!; world.add(a, Animal, { kind: world.get(a, Tamed)!.kind, homeX: t.x, homeY: t.y, goalX: t.x, goalY: t.y, thinkAt: now });
    if (!world.has(a, AnimState)) world.add(a, AnimState, { anim: 0, startTick: now });
  }
  const atTrough = (a: Entity): Entity | undefined => { const t = world.get(a, Transform)!; return tr.find((b) => { const bt = world.get(b, Transform)!; return (bt.x - t.x) ** 2 + (bt.y - t.y) ** 2 <= H.troughRange ** 2; }); };
  const perTrough = new Map<Entity, Entity[]>();
  for (const a of animals) { const b = canUsePens(world, world.get(a, Tamed)!.owner) ? atTrough(a) : undefined; if (b !== undefined) { const l = perTrough.get(b) ?? []; l.push(a); perTrough.set(b, l); } }
  for (const [b, list] of perTrough) {
    for (const a of list) {
      const t = world.get(a, Tamed)!; if (t.fedUntil <= now) continue;
      const bt = world.get(b, Transform)!; world.set(a, Animal, { homeX: bt.x, homeY: bt.y });
      const p = H.animals[animalDefs()[t.kind]?.key ?? ""]; if (!p || t.produceAt > now) continue;
      const owner = t.owner && world.isAlive(t.owner) ? t.owner : 0;
      const mul = 1 + (owner ? skillMod(world, owner, "produce") : 0);
      world.set(a, Tamed, { produceAt: now + sec(p.seconds / mul) });
      try { addItem(world, b, defs.itemId(p.produce), 1); } catch { /* unknown produce item */ }
    }
    if (list.length >= H.maxPerTrough) continue;
    const byKind = new Map<number, Entity[]>();
    for (const a of list) { const t = world.get(a, Tamed)!; if (t.fedUntil > now && t.breedAt <= now && t.owner && world.isAlive(t.owner) && hasPerk(world, t.owner, "breeding")) { const l = byKind.get(t.kind) ?? []; l.push(a); byKind.set(t.kind, l); } }
    for (const [kind, l] of byKind) {
      if (l.length < 2) continue; const [m, f] = l as [Entity, Entity]; const owner = world.get(m, Tamed)!.owner;
      const ft = world.get(f, Transform)!; const baby = spawnAnimal(world, kind, ft.x + 0.5, ft.y);
      world.add(baby, Tamed, { kind, owner, fedUntil: now, produceAt: now + sec(H.breedSeconds), breedAt: now + sec(H.breedSeconds * 2) });
      for (const x of [m, f]) world.set(x, Tamed, { breedAt: now + sec(H.breedSeconds) });
      emit(world, AnimalBred, { owner, baby }); awardXp(world, owner, "tame", 0.5);
      break;
    }
  }
}

export const TameFailed = ev<{ entity: Entity; reason: TameFail }>("gameplay.TameFailed");
/** IntentAction.Use with animal_feed in hand: tame / feed the animal in front (authority). */
export function husbandryUseSystem(world: World): void {
  if (!isAuthority(world) || world.isReplaying) return;
  const defs = gameplayDefs(world); const intent = world.store(PlayerIntent);
  for (const e of world.query([PlayerIntent, Transform], [Dead])) {
    const s = intent.slot(entityIndex(e)); if (intent.data.action[s] !== IntentAction.Use) continue;
    const slot = intent.data.slot[s]!; const { item, count } = slotItem(world, e, slot); if (!count || defs.items.get(item)?.key !== H.feed) continue;
    const r = feedAnimal(world, e); if (r.consumed) takeFromSlot(world, e, slot);
    if (r.fail !== TameFail.None) emit(world, TameFailed, { entity: e, reason: r.fail });
  }
}
export interface HusbandryPrompt { action: "Tame" | "Feed"; slot: number; target?: Entity | undefined; fail: TameFail; label: string }
/** Context prompt when holding animal_feed (pure dry run; shown by the client farm prompt). */
export function husbandryPrompt(world: World, e: Entity): HusbandryPrompt | undefined {
  const slot = world.get(e, Equipment)?.mainHandSlot ?? 255; if (slot === 255) return undefined;
  const { item, count } = slotItem(world, e, slot); if (!count || gameplayDefs(world).items.get(item)?.key !== H.feed) return undefined;
  const r = feedAnimal(world, e, true); const action = r.tame ? "Tame" : "Feed";
  return { action, slot, target: animalNear(world, e), fail: r.fail, label: r.fail ? `${action}: ${TAME_FAIL_TEXT[r.fail]}` : action };
}
