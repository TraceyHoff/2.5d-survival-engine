/**
 * Survival behaviors for virtual players: party, stall_trade, eat, drink, sleep, craft, build. Like the reference set
 * they read only the bot's own replica (fillAgentSensors) and write AgentOutput (action strings, see agent_output.ts).
 * Entity ids in the view are replica ids; hosts whose replica ids differ from the server's translate open/buy targets.
 */
import { Membership, StallDisplay, Transform, type Entity, type World } from "@engine/core";
import type { AgentWorldView, GameBehavior } from "../agents.js";
import { BuildPiece, Listings } from "../components.js";
import { GameplayConfig } from "../config.js";
import { readSlots, countItem } from "../inventory.js";
import { pieceCost } from "../building/place.js";
import { StationKind } from "../defs.js";

export interface StallOffer { id: number; x: number; y: number; slot: number; item: number; qty: number; priceItem: number; priceCount: number; revision?: number }
export interface AgentSensors { food?: number; water?: number; partyMates?: { id: number; x: number; y: number }[]; stall?: StallOffer }
export const BUILD_PLAN_PIECES = ["campfire", "storage_box", "workbench"] as const;

/** Fills optional AgentWorldView sensors from the replica (no writes). Missing gameplay config/inventory = skipped. */
export function fillAgentSensors(world: World, self: Entity, view: AgentWorldView, hungry = false): void {
  const cfg = world.getResource(GameplayConfig); const t = world.get(self, Transform); if (!cfg || !t) return; const defs = cfg.defs;
  let slots: ReturnType<typeof readSlots> | undefined; try { slots = readSlots(world, self); } catch { slots = undefined; }
  if (slots) {
    let empty = 0, bestFood = -1, bestWater = -1, fScore = 0, wScore = 0;
    for (let i = 0; i < slots.items.length; i++) {
      const it = slots.items[i]!; if (!it || !slots.counts[i]) { empty++; continue; }
      const f = defs.items.get(it)?.food; if (!f || f.health < 0) continue;
      if (f.hunger > fScore) { fScore = f.hunger; bestFood = i; }
      if (f.thirst > wScore) { wScore = f.thirst; bestWater = i; }
    }
    view.invSpaceFree = slots.items.length ? empty / slots.items.length : 0;
    if (bestFood >= 0) view.food = bestFood; if (bestWater >= 0) view.water = bestWater;
    const have = (item: number, n: number): boolean => countItem(world, self, item) >= n;
    for (const r of defs.recipes.values()) if (r.station === StationKind.None && countItem(world, self, r.output.item) === 0 && r.ingredients.every((g) => have(g.item, g.count))) { view.craftRecipe = r.id; break; }
    let based = false; for (const e of world.query([BuildPiece, Transform])) { const p = world.get(e, Transform)!; if (Math.hypot(p.x - view.home.x, p.y - view.home.y) < 6) { based = true; break; } }
    if (!based) for (const key of BUILD_PLAN_PIECES) {
      const def = [...defs.pieces.values()].find((p) => p.key === key); if (!def) continue;
      if (pieceCost(defs, def, 0).every((c) => have(c.item, c.count))) { view.buildPlan = { piece: def.id, x: Math.round(view.home.x) + 1, y: Math.round(view.home.y) }; break; }
    }
  }
  const party = world.getField(self, Membership, "partyId") ?? 0;
  if (party) { const mates: { id: number; x: number; y: number }[] = []; for (const e of world.query([Membership, Transform])) if (e !== self && world.getField(e, Membership, "partyId") === party) { const p = world.get(e, Transform)!; mates.push({ id: e, x: p.x, y: p.y }); } if (mates.length) view.partyMates = mates; }
  let best: StallOffer | undefined, bd = 12;
  for (const e of world.query([StallDisplay, Transform])) {
    const p = world.get(e, Transform)!; const d = Math.hypot(p.x - t.x, p.y - t.y); if (d >= bd) continue;
    const item = world.getArray(e, StallDisplay, "item")!, qty = world.getArray(e, StallDisplay, "qty")!, price = world.getArray(e, StallDisplay, "price")!, cur = world.getArray(e, StallDisplay, "currency")!;
    for (let i = 0; i < item.length; i++) {
      if (!item[i] || !price[i]) continue; const isFood = !!defs.items.get(item[i]!)?.food; if (hungry && !isFood) continue;
      if (slots && countItem(world, self, cur[i]!) < price[i]!) continue;
      best = { id: e, x: p.x, y: p.y, slot: i, item: item[i]!, qty: qty[i]!, priceItem: cur[i]!, priceCount: price[i]!, ...(world.has(e, Listings) ? { revision: world.getField(e, Listings, "revision")! } : {}) }; bd = d; break;
    }
  }
  if (best) view.stall = best;
}

const toward = (o: { moveX: number; moveY: number; aimX: number; aimY: number }, fx: number, fy: number, tx: number, ty: number, s = 1): number => {
  const dx = tx - fx, dy = ty - fy, d = Math.hypot(dx, dy) || 1; o.moveX = (dx / d) * s; o.moveY = (dy / d) * s; o.aimX = dx / d; o.aimY = dy / d; return d;
};
const cooled = (tick: number, at: number, ticks: number): number => (tick - at >= ticks ? 1 : 0);
const night = (p: string): number => (p === "night" ? 1 : p === "dusk" ? 0.6 : 0);

/** party, stall_trade, eat, drink, sleep, craft, build. */
export function survivalBehaviors(): GameBehavior[] {
  return [
    { name: "eat", inertia: 0, considerations: [
        { name: "hungry", curve: { type: "logistic", k: 12, mid: 0.55 }, input: (c) => 1 - c.self.hunger },
        { name: "hasFood", curve: { type: "step", at: 0.5 }, input: (c) => (c.world.food !== undefined ? cooled(c.self.tick, c.bb.num("ateAt", -1e9), 40) : 0) }],
      run: (c, o) => { if (c.world.food === undefined) return false; o.actions.push(`eat:${c.world.food}`); c.bb.set("ateAt", c.self.tick); return false; } },
    { name: "drink", inertia: 0, considerations: [
        { name: "thirsty", curve: { type: "logistic", k: 12, mid: 0.55 }, input: (c) => 1 - c.self.thirst },
        { name: "hasWater", curve: { type: "step", at: 0.5 }, input: (c) => (c.world.water !== undefined ? cooled(c.self.tick, c.bb.num("drankAt", -1e9), 40) : 0) }],
      run: (c, o) => { if (c.world.water === undefined) return false; o.actions.push(`drink:${c.world.water}`); c.bb.set("drankAt", c.self.tick); return false; } },
    { name: "sleep", chatOnStart: "rest", scheduleBonus: 0.4, inertia: 0.3, considerations: [
        { name: "night", curve: { type: "step", at: 0.5 }, input: (c) => night(c.self.phase) },
        { name: "safe", curve: { type: "step", at: 0.5 }, input: (c) => (c.memory.nearest("zombie", c.self.x, c.self.y, 0.3) ? 0 : 1) }],
      run: (c, o) => { if (toward(o, c.self.x, c.self.y, c.world.home.x, c.world.home.y, 0.8) < 1.5) { o.moveX = 0; o.moveY = 0; o.aimX = 0; o.aimY = 0; o.actions.push("sleep"); } if (night(c.self.phase) < 0.5) return false; } },
    { name: "craft", scheduleBonus: 0.3, traits: { industriousness: 0.6 }, considerations: [
        { name: "canCraft", curve: { type: "step", at: 0.5 }, input: (c) => (c.world.craftRecipe !== undefined ? cooled(c.self.tick, c.bb.num("craftedAt", -1e9), 200) : 0) },
        { name: "daylight", curve: { type: "linear", m: -0.6, b: 1 }, input: (c) => night(c.self.phase) }],
      run: (c, o) => { if (c.world.craftRecipe === undefined) return false; o.actions.push(`craft:${c.world.craftRecipe}`); c.bb.set("craftedAt", c.self.tick); return false; } },
    { name: "build", scheduleBonus: 0.3, traits: { industriousness: 0.6 }, considerations: [
        { name: "plan", curve: { type: "step", at: 0.5 }, input: (c) => (c.world.buildPlan ? cooled(c.self.tick, c.bb.num("builtAt", -1e9), 200) : 0) },
        { name: "daylight", curve: { type: "linear", m: -0.8, b: 1 }, input: (c) => night(c.self.phase) }],
      run: (c, o) => { const p = c.world.buildPlan; if (!p) return false; if (toward(o, c.self.x, c.self.y, p.x, p.y, 0.8) < 2) { o.moveX = 0; o.moveY = 0; o.actions.push(`build:${p.piece}:${p.x}:${p.y}`); c.bb.set("builtAt", c.self.tick); return false; } } },
    { name: "stall_trade", scheduleBonus: 0.3, traits: { greed: 0.5, sociability: 0.4 }, considerations: [
        { name: "offer", curve: { type: "inverse" }, input: (c) => { const s = c.world.stall; return s && cooled(c.self.tick, c.bb.num("tradedAt", -1e9), 300) ? Math.hypot(s.x - c.self.x, s.y - c.self.y) / 12 : 1; } },
        { name: "need", curve: { type: "linear", m: 0.6, b: 0.4 }, input: (c) => 1 - c.self.hunger }],
      run: (c, o) => {
        const s = c.world.stall; if (!s) return false;
        if (toward(o, c.self.x, c.self.y, s.x, s.y, 0.8) > 1.8) return;
        o.moveX = 0; o.moveY = 0;
        if (s.revision === undefined) { if (c.self.tick - c.bb.num("openedAt", -1e9) > 40) { o.actions.push(`open:${s.id}`); c.bb.set("openedAt", c.self.tick); } return; }
        o.actions.push(`buy:${s.id}:${s.slot}:1:${s.revision}:${s.priceItem}:${s.priceCount}`); c.bb.set("tradedAt", c.self.tick); return false;
      } },
    { name: "party", traits: { sociability: 1 }, inertia: 0.2, considerations: [
        { name: "mateAway", curve: { type: "logistic", k: 10, mid: 0.3 }, input: (c) => { const m = nearestMate(c.world, c.self.x, c.self.y); return m ? Math.min(1, m.d / 12) : 0; } }],
      run: (c, o) => {
        const m = nearestMate(c.world, c.self.x, c.self.y); if (!m) return false;
        if (c.self.tick - c.bb.num("behaviorStart") === 0 || !c.bb.get("partyWaved")) { o.emote = "wave"; c.bb.set("partyWaved", true); }
        if (toward(o, c.self.x, c.self.y, m.x, m.y, 0.9) < 2.5) { o.moveX = 0; o.moveY = 0; c.bb.set("partyWaved", false); return false; }
      } },
  ];
}
function nearestMate(w: AgentWorldView, x: number, y: number): { x: number; y: number; d: number } | undefined {
  let best: { x: number; y: number; d: number } | undefined; for (const m of w.partyMates ?? []) { const d = Math.hypot(m.x - x, m.y - y); if (!best || d < best.d) best = { x: m.x, y: m.y, d }; } return best;
}
