import { describe, it, expect } from "vitest";
import { installPermissions, PlayerId, Transform, type Entity, type World } from "@engine/core";
import * as G from "../src/index.js";
import { addItem, countItem, defaultDefs, DESPAWN, LootBag, LootSource, spawnPlayer } from "../src/index.js";
import { collect, makeWorld, steps } from "./helpers.js";

/** ADR-238: ground loot (dropped stacks, death bags, ...) despawns on a persisted, server-side timer. */
const d = defaultDefs(); const WOOD = d.itemId("wood");
const T = (s: number) => Math.ceil(s * 20);
const mk = (w: World, id: number, x = 0) => { const p = spawnPlayer(w, { x, y: 0, clientId: id }); w.add(p, PlayerId, { id }); return p; };
const drop = (w: World, p: Entity, n = 5): Entity => { addItem(w, p, WOOD, n); return G.dropItem(w, p, WOOD, n)!; };
/** Jump the clock (the system reads absolute ticks, so this is what a long wait / a restart looks like). */
const jump = (w: World, to: number) => { w.tick = to; steps(w, 20); };
const deathBag = (w: World, p: Entity): Entity => { const ev = collect(w, G.DeathBagDropped); addItem(w, p, WOOD, 3); G.applyDamage(w, p, 1e6, p); steps(w, 1); return ev[0]!.bag; };

describe("ADR-238 ground loot despawn", () => {
  it("balance data: dropped ~10 min, death bags ~30 min, emptied 10-15 s, fade 30 s, death bags safe from the cap for 5 min", () => {
    expect(DESPAWN.droppedSeconds).toBe(600); expect(DESPAWN.deathBagSeconds).toBe(1800); expect(DESPAWN.fadeSeconds).toBe(30);
    expect(DESPAWN.emptiedSeconds).toBeGreaterThanOrEqual(10); expect(DESPAWN.emptiedSeconds).toBeLessThanOrEqual(15);
    expect(DESPAWN.deathBagMinAgeSeconds).toBe(300); expect(DESPAWN.maxGroundBags).toBeGreaterThan(50);
  });
  it("a dropped stack stores its spawn tick + kind and goes at spawn + droppedSeconds (with a despawn event)", () => {
    const w = makeWorld(); installPermissions(w); const p = mk(w, 1); steps(w, 5); const bag = drop(w, p); const lb = w.get(bag, LootBag)!;
    expect(lb.spawnTick).toBe(w.tick); expect(lb.kind).toBe(LootSource.Dropped); expect(lb.despawnAtTick - lb.spawnTick).toBe(T(DESPAWN.droppedSeconds));
    const gone = collect(w, G.LootBagDespawned);
    jump(w, lb.spawnTick + T(DESPAWN.droppedSeconds) - 40); expect(w.isAlive(bag)).toBe(true);
    jump(w, lb.spawnTick + T(DESPAWN.droppedSeconds)); expect(w.isAlive(bag)).toBe(false);
    steps(w, 1); expect(gone.map((g) => g.reason)).toEqual(["expired"]); expect(gone[0]!.kind).toBe(LootSource.Dropped);
  });
  it("a death bag lasts deathBagSeconds (long enough to run back)", () => {
    const w = makeWorld(); installPermissions(w); const p = mk(w, 1); const bag = deathBag(w, p); const lb = w.get(bag, LootBag)!;
    expect(lb.kind).toBe(LootSource.Death); expect(lb.despawnAtTick - lb.spawnTick).toBe(T(DESPAWN.deathBagSeconds));
    jump(w, lb.spawnTick + T(DESPAWN.droppedSeconds) + 100); expect(w.isAlive(bag)).toBe(true); // outlives a dropped stack
    jump(w, lb.spawnTick + T(DESPAWN.deathBagSeconds) + 1); expect(w.isAlive(bag)).toBe(false);
  });
  it("opening / partly looting never resets the timer; canLootBag's owner window uses the stored spawn tick", () => {
    const w = makeWorld(); installPermissions(w); const a = mk(w, 1, 2); const b = mk(w, 2, 2); const bag = deathBag(w, a); const before = { ...w.get(bag, LootBag)! };
    steps(w, 20 * G.PVP.bagOwnerOnlySeconds + 20); expect(G.canLootBag(w, b, bag)).toBe(true);
    w.set(b, G.PlayerIntent, { action: G.IntentAction.OpenContainer, target: bag }); steps(w, 1);
    expect(G.transferItem(w, bag, b, WOOD, 1)).toBe(1); steps(w, 40);
    const now = w.get(bag, LootBag)!; expect(now.spawnTick).toBe(before.spawnTick); expect(now.despawnAtTick).toBe(before.despawnAtTick); expect(now.emptiedTick).toBe(0);
  });
  it("a bag looted to EMPTY despawns emptiedSeconds later (fades over that grace); refilling cancels the grace", () => {
    const w = makeWorld(); installPermissions(w); const a = mk(w, 1, 2); const bag = deathBag(w, a); const gone = collect(w, G.LootBagDespawned);
    G.transferItem(w, bag, a, WOOD, 3); steps(w, 20); const e1 = w.getField(bag, LootBag, "emptiedTick")!; expect(e1).toBeGreaterThan(0);
    expect(G.bagExpiryTick(w.get(bag, LootBag)!)).toBe(e1 + T(DESPAWN.emptiedSeconds));
    expect(G.despawnFadeAlpha(w.get(bag, LootBag)!, e1 + T(DESPAWN.emptiedSeconds / 2))).toBeLessThan(0.9); // fading during the short grace
    addItem(w, bag, WOOD, 1); steps(w, 20); expect(w.getField(bag, LootBag, "emptiedTick")).toBe(0); // refilled
    steps(w, T(DESPAWN.emptiedSeconds) + 40); expect(w.isAlive(bag)).toBe(true);
    G.transferItem(w, bag, a, WOOD, 1); steps(w, 20); expect(w.isAlive(bag)).toBe(true);
    steps(w, T(DESPAWN.emptiedSeconds) + 20); expect(w.isAlive(bag)).toBe(false);
    steps(w, 1); expect(gone.map((g) => g.reason)).toEqual(["emptied"]); expect(gone[0]!.kind).toBe(LootSource.Death);
  });
  it("the emptied grace is 10-15 s, far below the death bag timer", () => {
    const w = makeWorld(); installPermissions(w); const a = mk(w, 1, 2); const bag = deathBag(w, a); const t0 = w.tick;
    G.transferItem(w, bag, a, WOOD, 3); let n = 0; while (w.isAlive(bag) && n < 20 * 60) { steps(w, 1); n++; }
    expect((w.tick - t0) / 20).toBeGreaterThanOrEqual(10); expect((w.tick - t0) / 20).toBeLessThanOrEqual(16);
  });
  it("permanent caches never time out; legacy (pre-ADR-238) bags derive spawn from their old fixed lifetime", () => {
    const w = makeWorld(); installPermissions(w); const crate = w.create(); w.add(crate, Transform, { x: 4, y: 4 }).add(crate, G.Container, { slotCount: 4 }).add(crate, LootBag, { owner: 0, despawnAtTick: G.PERMANENT_DESPAWN });
    addItem(w, crate, WOOD, 2); jump(w, 4_000_000_000); expect(w.isAlive(crate)).toBe(true);
    const legacy = { owner: 3, despawnAtTick: 100_000, spawnTick: 0, kind: 0, emptiedTick: 0 };
    expect(G.bagSpawnTick(legacy)).toBe(100_000 - T(DESPAWN.legacyBagSeconds)); expect(G.bagExpiryTick(legacy)).toBe(100_000);
  });
  it("cap: past maxGroundBags the oldest go first (normal fade, then gone); a death bag younger than 5 min is never taken", () => {
    const w = makeWorld(); installPermissions(w); const cap = DESPAWN.maxGroundBags; const p = mk(w, 1, 0); const v = mk(w, 2, 50);
    const oldDeath = deathBag(w, v); steps(w, 2); // oldest of all, but protected (young death bag)
    const bags: Entity[] = []; for (let i = 0; i < cap + 3; i++) { bags.push(drop(w, p, 1)); w.tick += 1; }
    steps(w, 20); // over by 4 -> 4 oldest unprotected (bags[0..3]) scheduled out; the young death bag is skipped
    const sched = (e: Entity) => w.getField(e, LootBag, "despawnAtTick")! <= w.tick + T(DESPAWN.fadeSeconds);
    expect(sched(oldDeath)).toBe(false); expect(bags.slice(0, 4).every(sched)).toBe(true); expect(sched(bags[4]!)).toBe(false);
    expect(G.despawnFadeAlpha(w.get(bags[0]!, LootBag)!, w.tick + 1)).toBeGreaterThan(0.95); // starts at full alpha: a fade, not a pop
    steps(w, T(DESPAWN.fadeSeconds) + 20);
    expect(bags.slice(0, 4).some((e) => w.isAlive(e))).toBe(false); expect(w.isAlive(bags[4]!)).toBe(true); expect(w.isAlive(oldDeath)).toBe(true);
  });
  it("cap: once past its 5 min protection a death bag is evictable like any old bag", () => {
    const w = makeWorld(); installPermissions(w); const p = mk(w, 1, 0); const v = mk(w, 2, 50); const old = deathBag(w, v);
    w.tick += T(DESPAWN.deathBagMinAgeSeconds) + 20;
    for (let i = 0; i < DESPAWN.maxGroundBags; i++) drop(w, p, 1);
    steps(w, 20); expect(w.getField(old, LootBag, "despawnAtTick")!).toBeLessThanOrEqual(w.tick + T(DESPAWN.fadeSeconds));
    expect(G.capProtected(w.get(old, LootBag)!, w.tick)).toBe(false);
  });
  it("a permanent crate (sandbox pet corner) still vanishes IMMEDIATELY when emptied: no 12 s grace, no fade", () => {
    const w = makeWorld(); installPermissions(w); const p = mk(w, 1, 2); const gone = collect(w, G.LootBagDespawned);
    const crate = w.create(); w.add(crate, Transform, { x: 2, y: 0 }).add(crate, G.Container, { slotCount: 4 }).add(crate, G.ContainerViewers)
      .add(crate, LootBag, { owner: 0, despawnAtTick: G.PERMANENT_DESPAWN, spawnTick: w.tick, kind: LootSource.Crate });
    addItem(w, crate, WOOD, 3); steps(w, 40); expect(w.isAlive(crate)).toBe(true);
    expect(G.transferItem(w, crate, p, WOOD, 2)).toBe(2); steps(w, 20); expect(w.isAlive(crate)).toBe(true); // partly looted: stays, unfaded
    expect(G.despawnFadeAlpha(w.get(crate, LootBag)!, w.tick + 10_000)).toBe(1);
    expect(G.transferItem(w, crate, p, WOOD, 1)).toBe(1); steps(w, 20); // one despawn pass (same cadence as before ADR-238)
    expect(w.isAlive(crate)).toBe(false); steps(w, 1); expect(gone.map((g) => g.reason)).toEqual(["emptied"]); expect(gone[0]!.kind).toBe(LootSource.Crate);
    // a death bag emptied at the same moment keeps its emptiedSeconds fade
    const v = mk(w, 3, 2); const bag = deathBag(w, v); G.transferItem(w, bag, v, WOOD, 3); steps(w, 20); expect(w.isAlive(bag)).toBe(true);
    steps(w, T(DESPAWN.emptiedSeconds) + 20); expect(w.isAlive(bag)).toBe(false);
  });
  it("fade: 1 until the last fadeSeconds, then an eased, bounded fall (no blink: never back to full, never below the floor)", () => {
    const b = { owner: 0, despawnAtTick: 10_000, spawnTick: 0, kind: LootSource.Dropped, emptiedTick: 0 };
    expect(G.despawnFadeAlpha(b, 10_000 - T(DESPAWN.fadeSeconds) - 1)).toBe(1);
    let prev = 1; let maxRise = 0;
    for (let t = 10_000 - T(DESPAWN.fadeSeconds); t <= 10_000; t += 2) { const a = G.despawnFadeAlpha(b, t); expect(a).toBeGreaterThanOrEqual(0.25); expect(a).toBeLessThanOrEqual(1); maxRise = Math.max(maxRise, a - prev); prev = a; }
    expect(maxRise).toBeLessThan(0.02); expect(G.despawnFadeAlpha(b, 9_990)).toBeLessThan(0.4);
    expect(G.despawnFadeAlpha({ ...b, despawnAtTick: G.PERMANENT_DESPAWN }, 5)).toBe(1);
  });
  it("AI / players can't act on a despawned bag: open -> InvalidTarget, an open loot window auto-closes", () => {
    const w = makeWorld(); installPermissions(w); const a = mk(w, 1, 2); const bag = drop(w, a); const fails = collect(w, G.BuildFailed);
    w.set(a, G.PlayerIntent, { action: G.IntentAction.OpenContainer, target: bag }); steps(w, 1); expect(w.getField(a, G.Viewing, "container")).toBe(bag);
    w.set(a, G.PlayerIntent, { action: 0, target: 0 });
    jump(w, w.get(bag, LootBag)!.despawnAtTick); expect(w.isAlive(bag)).toBe(false); expect(w.has(a, G.Viewing)).toBe(false);
    w.set(a, G.PlayerIntent, { action: G.IntentAction.OpenContainer, target: bag }); steps(w, 1);
    expect(fails.some((f) => f.reason === G.BuildFail.InvalidTarget)).toBe(true); expect(countItem(w, a, WOOD)).toBe(0);
  });
});
