/**
 * ADR-214: base life for AI humans, driven by the planner (planner.ts). Every behaviour here only moves the bot and
 * emits the action strings a human client sends (craft / build / copen / cdeposit / cwithdraw / cclose / fire / door /
 * wear / attack / gather); the server validates reach, stations, recipes, costs and placement exactly as for players.
 *  - base_work: the planner's step (withdraw from storage, craft at a station - lighting it first -, build the next
 *    station / base piece from the stand point, wear clothes / armour).
 *  - stash: deposit surplus into the base storage box. - hunt / loot: kill passive animals for planner items, empty loot.
 *  - trip: outbound gathering / hunting trip 18..36 tiles from the base and back (counts trips / max distance).
 *  - refuel: keep the base fire burning through the night. - leave_base / sleep: door-aware in / out of the 2x2 base.
 */
import { timeOfDay, Transform, type Agent, type AgentContext, type Entity, type World } from "@engine/core";
import { installSpatialIndex } from "@engine/world";
import type { AgentWorldView, GameBehavior } from "../agents.js";
import { Animal, AttachKind, BuildPiece, Container, Dead, Fuel, LootBag, Survival, Worn } from "../components.js";
import { resolveAttachment } from "../building/links.js";
import { readSlots, slotFreshness } from "../inventory.js";
import { spoilStageIndex, spoilStages } from "../food.js";
import { StationKind, type GameDefs } from "../defs.js";
import { animalDefs } from "../population.js";
import { BASE_SLOTS, DOOR_IN, DOOR_OUT, HEARTH_SIT, aiMemoryOf, bumpStat, insideBase, makePlan, markAiDirty, pickBaseSite, plannerIndex, scanBase, type BaseState, type Plan } from "./planner.js";
import { stuckOn } from "./autonomy.js";

export interface PlanSensors {
  plan?: Plan; base?: { x: number; y: number }; bs?: BaseState; craftCount?: number; craftTicks?: number;
  huntTarget?: { id: number; x: number; y: number }; lootBag?: { id: number; x: number; y: number }; tripWanted?: boolean;
  surplus?: { item: number; count: number }[]; woodTotal?: number; stoneTotal?: number; junk?: { item: number; count: number };
}
export const PLAN_SENSOR_KEYS = ["plan", "base", "bs", "craftCount", "craftTicks", "huntTarget", "lootBag", "tripWanted", "surplus", "woodTotal", "stoneTotal", "junk"] as const;
type Ctx = AgentContext<AgentWorldView>;
const hash = (s: string): number => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0) / 4294967296; };
const KEEP_WOOD = 12, KEEP_FOOD = 6;
const GOAL_PATIENCE = 6000;
const animalsCache = { defs: undefined as ReturnType<typeof animalDefs> | undefined };

/** Planner pass on a sense tick: base anchor, plan, needs (returned), craft / hunt / loot / stash sensors. */
export function fillPlanSensors(world: World, self: Entity, view: AgentWorldView, a: Agent, defs: GameDefs, slots: ReturnType<typeof readSlots>): Set<number> | undefined {
  const mem = aiMemoryOf(a); const tick = world.tick; const t = world.get(self, Transform); if (!t) return undefined;
  if (!mem.base && tick - a.bb.num("sitePickAt", -1e9) >= 200) {
    a.bb.set("sitePickAt", tick); const s = pickBaseSite(world, self, view.home, hash(a.identity.id) + mem.stats.relocations * 0.37);
    if (s) { mem.base = s; markAiDirty(a, tick); }
  }
  const base = mem.base; const bs = base ? scanBase(world, defs, base) : undefined;
  if (base && bs) {
    for (const sl of BASE_SLOTS) if (bs.pieces.has(sl.id) && mem.fails[sl.id]) delete mem.fails[sl.id];
    const n = bs.pieces.size + bs.stations.size + (bs.storage ? 1 : 0); if (n > mem.stats.built) { mem.stats.built = n; markAiDirty(a, tick); }
    if (n === 0 && (mem.fails["f00"] ?? 0) >= 4) { delete mem.base; mem.fails = {}; mem.stats.relocations++; markAiDirty(a, tick); return undefined; } // the site is unusable: pick another
    view.base = base; view.bs = bs;
  }
  const hungry = (view as { self?: unknown }) && a.bb.num("hungerSeen", 1) < 0.5;
  const woodId = plannerIndex(defs).item.get("wood")?.id; let woodBag = 0; if (woodId !== undefined) for (let i = 0; i < slots.items.length; i++) if (slots.items[i] === woodId) woodBag += slots.counts[i] ?? 0;
  const body = world.getField(self, Survival, "bodyTemp") ?? 37; const dayT = timeOfDay(world).t;
  const freezing = body < 36.4 && woodBag < 7 && !(bs?.complete) && !(bs?.stations.get(StationKind.Campfire)?.lit);
  const evening = dayT >= 0.55 && dayT < 0.85;
  const plan = makePlan({ world, self, defs, ...(base ? { base } : {}), ...(bs ? { bs } : {}), fails: mem.fails, hungry, freezing, evening, ...(mem.snooze ? { snooze: mem.snooze } : {}) }); view.plan = plan; a.bb.set("planGoal", plan.goal); a.bb.set("planStep", plan.step);
  { // patience: a goal with no step and no leaf gathered for GOAL_PATIENCE ticks is snoozed half a day (persisted), like a player giving up on reeds
    let leafN = 0; for (let i = 0; i < slots.items.length; i++) if (slots.items[i] && plan.leaves.includes(slots.items[i]!)) leafN += slots.counts[i] ?? 0;
    const gs = a.bb.get("goalSeen") as { g: string; last: number; n: number } | undefined;
    if (!gs || gs.g !== plan.goal || plan.step || leafN > gs.n) a.bb.set("goalSeen", { g: plan.goal, last: tick, n: leafN });
    else if (tick - gs.last > GOAL_PATIENCE && plan.goal !== "idle") { (mem.snooze ??= {})[plan.goal] = tick + 36000; mem.stats.snoozed++; a.bb.set("goalSeen", undefined); markAiDirty(a, tick); }
  }
  const ix = plannerIndex(defs);
  for (const d of ix.tools) if (plan.keep.has(d.id) && d.tool!.tier > mem.stats.bestTier) { for (let i = 0; i < slots.items.length; i++) if (slots.items[i] === d.id) { mem.stats.bestTier = d.tool!.tier; markAiDirty(a, tick); } }
  const st = plan.step;
  // crafts are counted when the output really lands in the bag (CraftCompleted is server-side; the bot only sees its inventory)
  const have = (id: number): number => { let n = 0; for (let i = 0; i < slots.items.length; i++) if (slots.items[i] === id) n += slots.counts[i] ?? 0; return n; };
  const pend = a.bb.get<{ item: number; n: number; until: number; station: boolean }>("craftPend");
  if (pend) { if (have(pend.item) > pend.n) { bumpStat(a, "crafts", tick); if (pend.station) bumpStat(a, "stationCrafts", tick); a.bb.set("craftPend", undefined); } else if (tick > pend.until) a.bb.set("craftPend", undefined); }
  if (st?.k === "craft") { const out = defs.recipes.get(st.recipe)?.output.item; if (out !== undefined) a.bb.set("craftNext", { item: out, n: have(out), until: tick + st.ticks + 200, station: st.station !== StationKind.None }); }
  else if (view.craftRecipe !== undefined) { const out = defs.recipes.get(view.craftRecipe)?.output.item; if (out !== undefined) a.bb.set("craftNext", { item: out, n: have(out), until: tick + 400, station: false }); }
  if (st?.k === "craft" && st.station === StationKind.None) { view.craftRecipe = st.recipe; view.craftCount = st.count; view.craftTicks = st.ticks; } else if (base) delete view.craftRecipe;
  if (base) delete view.buildPlan;
  const needs = new Set(plan.leaves);
  const wood = ix.item.get("wood")?.id; let woodN = 0; if (wood !== undefined) for (let i = 0; i < slots.items.length; i++) if (slots.items[i] === wood) woodN += slots.counts[i] ?? 0;
  view.woodTotal = woodN; { const sw = ix.item.get("stone")?.id; view.stoneTotal = sw === undefined ? 0 : have(sw); }
  if (st?.k === "craft" && st.station !== StationKind.None && wood !== undefined) { const s = bs?.stations.get(st.station); if (s?.fired && !s.lit && woodN < 4) needs.add(wood); }
  if (wood !== undefined && bs?.stations.has(StationKind.Campfire) && woodN < 6) needs.add(wood);
  for (const h of plan.hunt) needs.add(h);
  // hunt: a passive animal in memory that drops a wanted item, only with a weapon in hand
  if (plan.hunt.length) {
    const ad = animalsCache.defs ?? (animalsCache.defs = animalDefs()); let best: PlanSensors["huntTarget"], bd = 26 * 26;
    const hasWeapon = slots.items.some((it, i) => it && slots.counts[i] && defs.items.get(it)?.weapon);
    if (hasWeapon) for (const p of a.memory.items.values()) { if (p.kind !== "animal" || !world.isAlive(p.id) || world.has(p.id, Dead) || !world.has(p.id, Animal)) continue;
      const def = ad[world.getField(p.id, Animal, "kind") ?? -1]; if (!def || def.attack || def.hp > 60) continue;
      if (!def.loot.some((l) => plan.hunt.includes(defs.itemId(l.item)))) continue;
      const d = (p.x - t.x) ** 2 + (p.y - t.y) ** 2; if (d < bd) { bd = d; best = { id: p.id, x: p.x, y: p.y }; } }
    if (best) view.huntTarget = best;
  }
  for (const e of installSpatialIndex(world).queryRadius(t.x, t.y, 8)) if (world.has(e, LootBag) && world.has(e, Container)) { const o = world.getField(e, LootBag, "owner") ?? 0; if (o !== 0 && o !== self) continue;
    const s = readSlots(world, e); if (s.counts.some((c) => c > 0)) { const p = world.get(e, Transform)!; view.lootBag = { id: e, x: p.x, y: p.y }; break; } }
  // junk: with <= 2 free slots, drop a stack nothing on the ladder uses (a player bins seed / grain clutter)
  { let free = 0; for (let i = 0; i < slots.items.length; i++) if (!slots.items[i] || !slots.counts[i]) free++;
    const stages = spoilStages(defs);
    for (let i = 0; i < slots.items.length && !view.junk; i++) { const it = slots.items[i]!; if (it && slots.counts[i] && defs.items.get(it)?.food && stages[spoilStageIndex(slotFreshness(world, self, i), stages)]?.sick) view.junk = { item: it, count: slots.counts[i]! }; }
    if (free <= 2 && !view.junk) for (let i = 0; i < slots.items.length; i++) { const it = slots.items[i]!; if (!it || !slots.counts[i] || ix.useful.has(it) || plan.keep.has(it)) continue; view.junk = { item: it, count: slots.counts[i]! }; break; } }
  // stash: bag items the plan does not need (never tools / weapons / worn / food stock / fire wood)
  if (bs?.storage && bs.storage.free > 0) {
    const worn = new Set<number>(); const wi = world.getArray(self, Worn, "item"); if (wi) for (const x of wi) if (x) worn.add(x);
    const tot = new Map<number, number>(); for (let i = 0; i < slots.items.length; i++) { const it = slots.items[i]!; if (it && slots.counts[i]) tot.set(it, (tot.get(it) ?? 0) + slots.counts[i]!); }
    const sur: { item: number; count: number }[] = [];
    for (const [it, n] of tot) { const d = defs.items.get(it); if (!d || d.tool || d.weapon || d.wear || worn.has(it)) continue;
      const keep = it === wood ? KEEP_WOOD : d.food && d.food.health >= 0 ? KEEP_FOOD : plan.keep.has(it) ? n : 0; if (n > keep) sur.push({ item: it, count: n - keep }); }
    if (sur.length) view.surplus = sur;
  }
  return needs;
}
/** Called after gather selection: a trip is worth it when the plan needs something no known node near home gives. */
export function noteTripWanted(view: AgentWorldView, needs: Set<number>, wantedKnown: boolean): void { if (view.base && needs.size && !wantedKnown) view.tripWanted = true; }

// ---------------- movement helpers ----------------
const toward = (o: { moveX: number; moveY: number; aimX: number; aimY: number }, fx: number, fy: number, tx: number, ty: number, s = 1): number => {
  const dx = tx - fx, dy = ty - fy, d = Math.hypot(dx, dy) || 1; o.moveX = (dx / d) * s; o.moveY = (dy / d) * s; o.aimX = dx / d; o.aimY = dy / d; return d;
};
const stop = (o: { moveX: number; moveY: number }): void => { o.moveX = 0; o.moveY = 0; };
/** Door-aware walk: crossing the base wall goes through the door (open, pass, close behind) like a player. Returns the distance to (tx, ty). */
export function goTo(c: Ctx, o: { moveX: number; moveY: number; aimX: number; aimY: number; actions: string[] }, tx: number, ty: number, s = 0.85): number {
  const b = c.world.base, door = c.world.bs?.door; const d = Math.hypot(tx - c.self.x, ty - c.self.y);
  if (b && door) {
    const inS = insideBase(b, c.self.x, c.self.y), inT = insideBase(b, tx, ty);
    const shut = c.bb.get<number>("doorShut");
    if (shut !== undefined && c.world.bs?.door?.open && Math.hypot(door.x - c.self.x, door.y - c.self.y) > 1.1 && c.self.tick - c.bb.num("doorAt", -1e9) > 10) { o.actions.push(`door:${door.id}`); c.bb.set("doorAt", c.self.tick); c.bb.set("doorShut", undefined); }
    if (inS !== inT) {
      const near = inS ? { x: b.x + DOOR_IN.x, y: b.y + DOOR_IN.y } : { x: b.x + DOOR_OUT.x, y: b.y + DOOR_OUT.y };
      const far = inS ? { x: b.x + DOOR_OUT.x, y: b.y + DOOR_OUT.y } : { x: b.x + DOOR_IN.x, y: b.y + DOOR_IN.y };
      const dn = Math.hypot(near.x - c.self.x, near.y - c.self.y);
      if (dn > 0.45 && c.bb.num("doorPhase") === 0) { toward(o, c.self.x, c.self.y, near.x, near.y, s); return d; }
      if (!door.open) { stop(o); if (c.self.tick - c.bb.num("doorAt", -1e9) > 20) { o.actions.push(`door:${door.id}`); c.bb.set("doorAt", c.self.tick); } return d; }
      c.bb.set("doorPhase", 1); c.bb.set("doorShut", 1); toward(o, c.self.x, c.self.y, far.x, far.y, 0.6); return d;
    }
    c.bb.set("doorPhase", 0);
  }
  toward(o, c.self.x, c.self.y, tx, ty, s); return d;
}
/** Container sequence (open -> each op -> close), one command every 8 ticks; returns true when done. */
function containerSeq(c: Ctx, o: { actions: string[] }, id: number, ops: string[]): boolean {
  const at = c.bb.num("cseqAt", -1e9); if (c.self.tick - at < 8) return false;
  let i = c.self.tick - at > 60 || c.bb.num("cseqId", -1) !== id ? 0 : c.bb.num("cseqStep"); c.bb.set("cseqAt", c.self.tick); c.bb.set("cseqId", id);
  if (i === 0) o.actions.push(`copen:${id}`); else if (i <= ops.length) o.actions.push(ops[i - 1]!); else { o.actions.push(`cclose:${id}`); c.bb.set("cseqStep", 0); c.bb.set("cseqId", -1); return true; }
  c.bb.set("cseqStep", ++i); return false;
}
const night = (p: string): number => (p === "night" ? 1 : p === "dusk" ? 0.6 : 0);
const cooled = (c: Ctx, k: string, n: number): boolean => c.self.tick - c.bb.num(k, -1e9) >= n;
const step01 = { type: "step" as const, at: 0.5 };
const mark = (c: Ctx, k: Parameters<typeof bumpStat>[1], by = 1): void => bumpStat(c.agent, k, c.self.tick, by);

export function baseBehaviors(): GameBehavior[] {
  return [
    { name: "base_work", scheduleBonus: 0.35, inertia: 0.35, traits: { industriousness: 0.6 }, considerations: [
        { name: "step", weight: 1.3, curve: step01, input: (c) => { const s = c.world.plan?.step; return s && (s.k !== "craft" || s.station !== StationKind.None) && cooled(c, "workFail", 120) ? 1 : 0; } },
        { name: "daylight", curve: { type: "linear", m: -0.7, b: 1 }, input: (c) => night(c.self.phase) },
        { name: "calm", curve: step01, input: (c) => (c.memory.nearest("zombie", c.self.x, c.self.y, 0.3) ? 0 : 1) }],
      run: (c, o) => {
        const s = c.world.plan?.step; const bs = c.world.bs; if (!s) return false;
        const fail = (): false => { c.bb.set("workFail", c.self.tick); return false; };
        if (s.k === "wear") { if (cooled(c, "wearAt", 60)) { o.actions.push(`wear:${s.invSlot}`); c.bb.set("wearAt", c.self.tick); mark(c, "wears"); } return false; }
        if (s.k === "withdraw") { const sb = bs?.storage; if (!sb) return fail();
          if (goTo(c, o, sb.x, sb.y) > 1.6) { if (stuckOn(c, sb.x, sb.y)) return fail(); return; } stop(o);
          if (containerSeq(c, o, sb.id, [`cwithdraw:${sb.id}:${s.item}:${s.count}`])) { mark(c, "withdraws"); return false; } return; }
        if (s.k === "craft") { const st = bs?.stations.get(s.station); if (!st) return fail();
          const wait = c.bb.num("craftUntil", -1); if (wait > c.self.tick) { if (Math.hypot(st.x - c.self.x, st.y - c.self.y) > 2) goTo(c, o, st.x, st.y); else stop(o); return; }
          if (goTo(c, o, st.x, st.y) > 1.7) { if (stuckOn(c, st.x, st.y)) return fail(); return; } stop(o);
          if (st.fired && !st.lit) { const wood = plannerIndex(gdefs(c)).item.get("wood")?.id; if (wood === undefined || !(c.world.woodTotal ?? 0)) return fail();
            if (containerSeq(c, o, st.id, [`cdeposit:${st.id}:${wood}:${Math.min(6, c.world.woodTotal!)}`, `fire:${st.id}`])) mark(c, "refuels"); return; }
          o.actions.push(`craft:${s.recipe}:${s.count}`); c.bb.set("craftUntil", c.self.tick + s.ticks); armCraft(c); return; }
        // build
        const d = goTo(c, o, s.stand.x, s.stand.y, 0.8);
        if (d > 0.5 && !(d < 3 && stuckOn(c, s.stand.x, s.stand.y, 40))) { if (d >= 3 && stuckOn(c, s.stand.x, s.stand.y)) return fail(); return; }
        stop(o); o.aimX = s.x - c.self.x; o.aimY = s.y - c.self.y;
        if (!cooled(c, "buildAt", 30)) return;
        o.actions.push(`build:${s.piece}:${s.x}:${s.y}:${s.level}:${s.rot ?? 0}:0`); c.bb.set("buildAt", c.self.tick);
        const m = aiMemoryOf(c.agent); m.fails[s.slot] = (m.fails[s.slot] ?? 0) + 1; markAiDirty(c.agent, c.self.tick); return false;
      } },
    { name: "stash", inertia: 0.4, traits: { greed: 0.3 }, considerations: [
        { name: "surplus", curve: step01, input: (c) => (c.world.surplus && cooled(c, "stashAt", 300) ? 1 : 0) },
        { name: "full", curve: { type: "linear", m: -0.6, b: 1 }, input: (c) => Math.min(1, c.world.invSpaceFree ?? 0.5) },
        { name: "nearBase", curve: { type: "inverse" }, input: (c) => { const sb = c.world.bs?.storage; return sb ? Math.min(1, Math.hypot(sb.x - c.self.x, sb.y - c.self.y) / 24) : 1; } }],
      run: (c, o) => { const sb = c.world.bs?.storage, sur = c.world.surplus; if (!sb || !sur) return false;
        if (goTo(c, o, sb.x, sb.y) > 1.6) { if (stuckOn(c, sb.x, sb.y)) { c.bb.set("stashAt", c.self.tick); return false; } return; } stop(o);
        const ops = sur.slice(0, 6).map((s) => `cdeposit:${sb.id}:${s.item}:${s.count}`);
        if (containerSeq(c, o, sb.id, ops)) { mark(c, "deposits", ops.length); c.bb.set("stashAt", c.self.tick); return false; } } },
    { name: "hunt", inertia: 0.5, traits: { bravery: 0.6 }, considerations: [
        { name: "prey", curve: { type: "inverse" }, input: (c) => { const h = c.world.huntTarget; return h && cooled(c, "huntFail", 300) ? Math.min(1, Math.hypot(h.x - c.self.x, h.y - c.self.y) / 30) : 1; } },
        { name: "healthy", curve: { type: "step", at: 0.5 }, input: (c) => c.self.hp }],
      run: (c, o) => {
        const h = c.world.huntTarget; if (!h) return false; const w = c.agent; void w;
        const p = c.memory.items.get(h.id) ?? h; const id = c.bb.num("huntId", -1);
        if (id !== h.id) { c.bb.set("huntId", h.id); c.bb.set("huntStart", c.self.tick); }
        if (c.self.tick - c.bb.num("huntStart") > 900) { c.bb.set("huntFail", c.self.tick); return false; }
        const d = toward(o, c.self.x, c.self.y, p.x, p.y, 1); o.sprint = d > 3 && c.self.stamina > 0.4;
        if (d < 1.4) { o.moveX *= 0.2; o.moveY *= 0.2; if (cooled(c, "hitAt", 10)) { o.actions.push(`attack:${h.id}`); c.bb.set("hitAt", c.self.tick); c.bb.set("huntHit", h.id); } }
      } },
    { name: "loot", inertia: 0.5, considerations: [{ name: "bag", curve: step01, input: (c) => (c.world.lootBag && cooled(c, "lootAt", 120) ? 1 : 0) }],
      run: (c, o) => { const b = c.world.lootBag; if (!b) return false;
        if (toward(o, c.self.x, c.self.y, b.x, b.y, 0.8) > 1.5) { if (stuckOn(c, b.x, b.y)) { c.bb.set("lootAt", c.self.tick); return false; } return; } stop(o);
        const ops: string[] = []; const ent = b.id as Entity; const wd = worldOf(c); if (!wd || !wd.isAlive(ent)) return false;
        const s = readSlots(wd, ent); for (let i = 0; i < s.items.length; i++) if (s.items[i] && s.counts[i]) ops.push(`cwithdraw:${b.id}:${s.items[i]}:${s.counts[i]}`);
        if (c.bb.num("huntHit", -1) >= 0) { mark(c, "hunts"); c.bb.set("huntHit", -1); }
        if (containerSeq(c, o, b.id, ops)) { mark(c, "loots"); c.bb.set("lootAt", c.self.tick); return false; } } },
    { name: "trip", inertia: 0.6, scheduleBonus: 0.2, traits: { industriousness: 0.4, bravery: 0.3 }, considerations: [
        { name: "want", curve: step01, input: (c) => (c.bb.get("trip") ? 1 : c.world.tripWanted && cooled(c, "tripEnd", 600) ? 0.8 : 0) },
        { name: "day", curve: { type: "linear", m: -1, b: 1 }, input: (c) => (c.bb.get<{ ret: boolean }>("trip")?.ret ? 0 : night(c.self.phase)) },
        { name: "fed", curve: step01, input: (c) => (c.bb.get("trip") || (c.self.hunger > 0.5 && c.self.thirst > 0.5) ? 1 : 0) }],
      run: (c, o) => {
        const home = c.world.home; let tr = c.bb.get<{ x: number; y: number; t0: number; ret: boolean; max: number }>("trip");
        if (!tr) { const a = c.rng.range(-Math.PI, Math.PI), r = c.rng.range(18, 36); tr = { x: home.x + Math.cos(a) * r, y: home.y + Math.sin(a) * r, t0: c.self.tick, ret: false, max: 0 }; c.bb.set("trip", tr); }
        const dh = Math.hypot(home.x - c.self.x, home.y - c.self.y); tr.max = Math.max(tr.max, dh);
        if (!tr.ret && (night(c.self.phase) > 0 || c.self.hunger < 0.35 || c.self.thirst < 0.35 || (c.world.invSpaceFree ?? 1) < 0.3 || c.self.tick - tr.t0 > 3600 || !c.world.tripWanted && tr.max > 12)) tr.ret = true;
        if (tr.ret) { if (goTo(c, o, home.x, home.y, 1) < 3 || stuckOn(c, home.x, home.y, 200)) { endTrip(c, tr.max); return false; } return; }
        if (toward(o, c.self.x, c.self.y, tr.x, tr.y, 0.9) < 2 || stuckOn(c, tr.x, tr.y, 120)) { const a = c.rng.range(-Math.PI, Math.PI); tr.x = c.self.x + Math.cos(a) * 10; tr.y = c.self.y + Math.sin(a) * 10; }
        return false; // re-evaluate every tick so gather / hunt take over when a wanted node or prey shows up
      } },
    { name: "refuel", inertia: 0.4, considerations: [
        { name: "low", weight: 1.5, curve: step01, input: (c) => { const f = c.world.bs?.stations.get(StationKind.Campfire); return f && f.lit && f.fuelTicks < 2400 && (c.world.woodTotal ?? 0) > 0 && cooled(c, "refuelAt", 200) ? 1 : 0; } },
        { name: "needed", curve: step01, input: (c) => (night(c.self.phase) > 0 || c.world.cold ? 1 : 0) }],
      run: (c, o) => { const f = c.world.bs?.stations.get(StationKind.Campfire); const wood = plannerIndex(gdefs(c)).item.get("wood")?.id; if (!f || wood === undefined || !c.world.woodTotal) return false;
        if (goTo(c, o, f.x, f.y) > 1.6) { if (stuckOn(c, f.x, f.y)) { c.bb.set("refuelAt", c.self.tick); return false; } return; } stop(o);
        if (containerSeq(c, o, f.id, [`cdeposit:${f.id}:${wood}:${Math.min(10, c.world.woodTotal)}`])) { mark(c, "refuels"); c.bb.set("refuelAt", c.self.tick); return false; } } },
    // ADR-214: cold kills in ~70 s once the body is under 35 C; get warm first (lit fire > light the fire > roofed base > a camp fire on the spot)
    { name: "warm_up", inertia: 0.6, considerations: [
        { name: "chilled", weight: 2.2, curve: step01, input: (c) => { const ch = c.world.chill; if (!ch) return 0;
          const on = c.bb.get("warming") ? ch.body < 36.8 || (ch.felt < 10 && ch.body < 37) : ch.body < 36.2 || (ch.felt < 8 && ch.body < 36.6); c.bb.set("warming", on); return on ? 1 : 0; } },
        { name: "canWarm", curve: step01, input: (c) => (warmOption(c) ? 1 : 0) }], // nothing to warm at: the planner's emergency wood/stone goal (gather) takes over
      run: warmRun },
    { name: "leave_base", inertia: 0.2, considerations: [
        { name: "inside", curve: step01, input: (c) => (c.world.base && c.world.bs?.door && insideBase(c.world.base, c.self.x, c.self.y) && night(c.self.phase) === 0 && (c.world.plan?.step || c.world.needs?.length) ? 1 : 0) }],
      run: (c, o) => { const b = c.world.base; if (!b) return false; const x = b.x + DOOR_OUT.x, y = b.y + DOOR_OUT.y + 0.6; if (goTo(c, o, x, y) < 0.6 || stuckOn(c, x, y, 120)) return false; } },
  ];
}
/** The craft command just went out: watch the bag for its output (fillPlanSensors counts it). */
export function armCraft(c: { bb: Agent["bb"]; self: { tick: number } }): void { const n = c.bb.get("craftNext"); if (n && !c.bb.get("craftPend")) c.bb.set("craftPend", n); }
function endTrip(c: Ctx, max: number): void { c.bb.set("trip", undefined); c.bb.set("tripEnd", c.self.tick); if (max >= 12) { const m = aiMemoryOf(c.agent); m.stats.trips++; m.stats.tripMax = Math.max(m.stats.tripMax, Math.round(max)); markAiDirty(c.agent, c.self.tick); } }
/** Sleep in the base (through the door) when it has one; else by the fire. Replaces the survivor sleep run. */
export function baseSleepRun(c: Ctx, o: { moveX: number; moveY: number; aimX: number; aimY: number; actions: string[] }): boolean | void {
  const b = c.world.base; let tx = c.world.home.x, ty = c.world.home.y;
  const f = c.world.bs?.stations.get(StationKind.Campfire); // ADR-214: a lit fire beats walls at 6 C nights; the roofed base when it is out
  if (b && f && c.world.bs?.hearth === f.id) { tx = b.x + HEARTH_SIT.x; ty = b.y + HEARTH_SIT.y; }
  else if (f && (f.lit || !c.world.bs?.door)) { tx = f.x - 1.1; ty = f.y + 0.4; }
  if (goTo(c, o, tx, ty, 0.8) < 0.9 || stuckOn(c, tx, ty, 200)) { stop(o); o.aimX = 0; o.aimY = 0; o.actions.push("sleep"); }
  if (night(c.self.phase) < 0.5) return false;
}
/** Any way to get warm right now: a fire (lit, or unlit with wood to hand), the finished base, or campfire materials in the bag. */
function warmOption(c: Ctx): boolean {
  const near = (x: number, y: number): boolean => Math.hypot(x - c.self.x, y - c.self.y) < 60; const woodN = c.world.woodTotal ?? 0;
  const st = c.world.bs?.stations.get(StationKind.Campfire); const vf = c.world.fire; const camp = c.bb.get<{ x: number; y: number }>("camp");
  const sbWood = (() => { const w = plannerIndex(gdefs(c)).item.get("wood")?.id; return w !== undefined ? (c.world.bs?.storage?.counts.get(w) ?? 0) : 0; })();
  for (const f of [st, vf]) if (f && near(f.x, f.y) && (f.lit || woodN > 0 || sbWood > 0)) return true;
  if (camp && near(camp.x, camp.y) && woodN > 0) return true;
  const b = c.world.base; if (b && c.world.bs?.complete && near(b.x, b.y)) return true;
  return woodN >= 7 && (c.world.stoneTotal ?? 0) >= 4;
}
function warmRun(c: Ctx, o: { moveX: number; moveY: number; aimX: number; aimY: number; actions: string[] }): boolean | void {
  if (!c.bb.get("warming")) return false;
  const wd = worldOf(c); if (!wd) return false; const ix = plannerIndex(gdefs(c)); const wood = ix.item.get("wood")?.id; const woodN = c.world.woodTotal ?? 0;
  const st = c.world.bs?.stations.get(StationKind.Campfire); const vf = c.world.fire;
  let f: { id: number; x: number; y: number; lit: boolean } | undefined = st ? { id: st.id, x: st.x, y: st.y, lit: st.lit } : vf;
  const camp = c.bb.get<{ id: number; x: number; y: number }>("camp"); // a fire lit on the road
  if (camp && wd.isAlive(camp.id as Entity) && (!f || Math.hypot(camp.x - c.self.x, camp.y - c.self.y) < Math.hypot(f.x - c.self.x, f.y - c.self.y))) {
    const fa = resolveAttachment(wd, camp.id as Entity, AttachKind.Fire); f = { ...camp, lit: (fa !== undefined && (wd.getField(fa, Fuel, "lit") ?? 0) > 0) }; }
  const fd = f ? Math.hypot(f.x - c.self.x, f.y - c.self.y) : Infinity;
  const b0 = c.world.base; const atHearth = !!b0 && st !== undefined && c.world.bs?.hearth === st.id && f?.id === st.id;
  if (f && f.lit && fd < 60) { const tx = atHearth ? b0!.x + HEARTH_SIT.x : f.x - 1.1, ty = atHearth ? b0!.y + HEARTH_SIT.y : f.y + 0.4; if (goTo(c, o, tx, ty, 1) < 0.5 || stuckOn(c, tx, ty, 200)) stop(o); return; }
  if (f && !f.lit && wood !== undefined && woodN > 0 && fd < 60) {
    if (goTo(c, o, f.x, f.y, 1) > 1.6) { if (stuckOn(c, f.x, f.y)) c.bb.set("warming", false); return; } stop(o);
    if (containerSeq(c, o, f.id, [`cdeposit:${f.id}:${wood}:${Math.min(8, woodN)}`, `fire:${f.id}`])) mark(c, "refuels"); return; }
  const sb = c.world.bs?.storage; // no wood in the bag: fetch some from the box (same container panel steps as a player)
  if (f && !f.lit && wood !== undefined && woodN === 0 && sb && (sb.counts.get(wood) ?? 0) > 0 && fd < 60) {
    if (goTo(c, o, sb.x, sb.y) > 1.6) { if (stuckOn(c, sb.x, sb.y)) c.bb.set("warming", false); return; } stop(o);
    if (containerSeq(c, o, sb.id, [`cwithdraw:${sb.id}:${wood}:${Math.min(12, sb.counts.get(wood)!)}`])) mark(c, "withdraws"); return; }
  const b = c.world.base;
  if (b && c.world.bs?.door && c.world.bs.complete && Math.hypot(b.x - c.self.x, b.y - c.self.y) < 60) { const h = { x: b.x + 1, y: b.y + 1 }; if (goTo(c, o, h.x, h.y, 1) < 0.5) stop(o); return; }
  // far from any fire: make camp like a player would (campfire from the bag, then light it)
  const cf = ix.piece.get("campfire"); const sw = ix.item.get("stone")?.id;
  if (cf && wood !== undefined && sw !== undefined && woodN >= 7 && c.self.tick - c.bb.num("campBuildAt", -1e9) > 200) {
    if ((c.world.stoneTotal ?? 0) >= 4) { const x = c.self.x + 1.2, y = c.self.y; stop(o); o.aimX = 1.2; o.aimY = 0; o.actions.push(`build:${cf.id}:${x}:${y}:0:0:0`); c.bb.set("campBuildAt", c.self.tick);
      c.bb.set("campPending", { x, y, t: c.self.tick }); return; } }
  const cp = c.bb.get<{ x: number; y: number; t: number }>("campPending");
  if (cp && cf && c.self.tick - cp.t < 100) { for (const e of installSpatialIndex(wd).queryRadius(cp.x, cp.y, 1.5)) if (wd.getField(e, BuildPiece, "type") === cf.id) { const p = wd.get(e, Transform)!; c.bb.set("camp", { id: e, x: p.x, y: p.y }); c.bb.set("campPending", undefined); break; } stop(o); return; }
  const h = c.world.home; goTo(c, o, h.x, h.y, 1);
}
/** return_home that respects the door. */
export function baseReturnRun(c: Ctx, o: { moveX: number; moveY: number; aimX: number; aimY: number; actions: string[] }): boolean | void {
  const h = c.world.home; const b = c.world.base; const tx = b && !c.world.bs?.door ? b.x + 1 : h.x, ty = b && !c.world.bs?.door ? b.y + 3.4 : h.y;
  if (goTo(c, o, tx, ty, 1) < 2 || stuckOn(c, tx, ty, 100)) return false;
}
const worldRef = new WeakMap<Agent, World>();
export function bindAgentWorld(a: Agent, w: World): void { worldRef.set(a, w); }
const worldOf = (c: Ctx): World | undefined => worldRef.get(c.agent);
import { GameplayConfig } from "../config.js";
const gdefs = (c: Ctx): GameDefs => worldOf(c)!.getResource(GameplayConfig)!.defs;
