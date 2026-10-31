// ADR-252: AI humans live on the authoritative world (DirectClient bots): build campfire -> storage box -> workbench in order,
// one container action per think tick, never walk through structures (ADR-215), stable distinct looks (ADR-245).
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { Appearance, Transform, setTimeOfDay, type CosmeticCatalogLike, type Entity } from "@engine/core";
import { MemoryWorldStore } from "@engine/persist";
import { BASE_SLOTS, Health, StanceMode, ZombieBrain, spawnZombie, ContainerClosed, ContainerOpened, PiecePlaced, Stance, addItem, gameplayDefs, grantSkillUnlocks, movementBlocked, pieceCost, isBaseStoragePiece } from "@engine/gameplay";
import { loadServerCatalog } from "@engine/server";
import { createLocalServer, type LocalServer } from "../src/local.js";

const KEYS = ["campfire", "basic_storage_box", "workbench"] as const;
let local: LocalServer; let cat: CosmeticCatalogLike;
const built = new Map<number, string[]>(); const cOps = new Map<string, number>(); const crossings: string[] = []; let opens = 0; const stances = new Set<number>();

describe("ADR-252 AI humans live", () => {
  beforeAll(async () => {
    cat = (await loadServerCatalog(() => {}))!;
    local = await createLocalServer({ store: new MemoryWorldStore(), seed: 11, bots: 3, catalog: cat });
    const W = local.game.world; const d = gameplayDefs(W); setTimeOfDay(W, 8);
    const bots = local.bots.map((b) => local.game.players.get(b.client.clientId)!.entity);
    const iid = (k: string) => [...d.items.values()].find((i) => i.key === k)!.id;
    for (const e of bots) {
      grantSkillUnlocks(W, e); addItem(W, e, iid("stone_axe"), 1); addItem(W, e, iid("stone_pickaxe"), 1);
      for (const k of KEYS) { const def = [...d.pieces.values()].find((p) => p.key === k)!; for (const c of pieceCost(d, def, def.fixedTier)) addItem(W, e, c.item, c.count); }
      addItem(W, e, iid("wood"), 30); addItem(W, e, iid("stone"), 40);
    }
    const isBot = new Set<number>(bots as number[]);
    W.events.on(PiecePlaced as never, (ev: { builder: number; type: number }) => {
      if (!isBot.has(ev.builder)) return; const def = d.pieces.get(ev.type); const k = def?.key ?? "?";
      const kk = k === "campfire" || k === "workbench" ? k : isBaseStoragePiece(def) ? "basic_storage_box" : k;
      let a = built.get(ev.builder); if (!a) built.set(ev.builder, (a = [])); a.push(kk);
    });
    const cop = (ev: { entity: number }) => { if (!isBot.has(ev.entity)) return; const k = `${ev.entity}@${W.tick}`; cOps.set(k, (cOps.get(k) ?? 0) + 1); };
    W.events.on(ContainerOpened as never, (ev: { entity: number }) => { opens++; cop(ev); }); W.events.on(ContainerClosed as never, cop);
    const prev = new Map<number, { x: number; y: number; z: number }>();
    for (let i = 0; i < 3000; i++) {
      local.pump(50); await Promise.resolve();
      for (const e of bots) {
        const t = W.get(e as Entity, Transform); if (!t) continue; const p = prev.get(e as number); prev.set(e as number, { x: t.x, y: t.y, z: t.z ?? 0 });
        const m = W.getField(e as Entity, Stance, "mode"); if (m !== undefined) stances.add(m);
        if (!p || Math.hypot(t.x - p.x, t.y - p.y) > 1.5 || Math.abs(t.z ?? 0) > 0.3 || Math.abs(p.z) > 0.3) continue; // respawn / decks: ground walkers only
        if (movementBlocked(W, p.x, p.y, t.x, t.y, 0)) crossings.push(`${e}@${W.tick}: ${p.x.toFixed(2)},${p.y.toFixed(2)} -> ${t.x.toFixed(2)},${t.y.toFixed(2)}`);
      }
    }
  }, 600_000);
  afterAll(async () => { await local?.stop(); });

  it("bots build in the ADR-250 order: campfire, then a storage box, then the workbench", () => {
    let full = 0;
    for (const seq of built.values()) {
      const idx = KEYS.map((k) => seq.indexOf(k)).filter((i) => i >= 0);
      expect(idx).toEqual([...idx].sort((a, b) => a - b)); // first of each in ladder order
      const present = KEYS.filter((k) => seq.includes(k)); expect(KEYS.slice(0, present.length)).toEqual(present); // no skipping
      if (present.length === 3) full++;
    }
    expect(full).toBeGreaterThan(0);
  });
  it("container work is one action per think tick (never open + close in the same tick)", () => {
    expect(opens).toBeGreaterThan(0); // they do store (ADR-250 API through the validated container commands)
    for (const n of cOps.values()) expect(n).toBe(1);
  });
  it("bots never step through walls / pieces (ADR-215 collision holds for AI humans)", () => {
    expect(crossings).toEqual([]);
  });
  it("every bot wears a valid, stable ADR-245 look", () => {
    const W = local.game.world; const looks = local.bots.map((b) => W.get(local.game.players.get(b.client.clientId)!.entity, Appearance));
    for (const a of looks) { expect(a).toBeDefined(); expect(a!.skinTone).toBeLessThan(cat.skinTones.length); }
  });
});

describe("ADR-252 AI humans live: base, bed sleep (ADR-244), defence with block", () => {
  const modes = new Map<string, number>(); const pieces = new Map<number, Set<string>>(); let sleptInBed = 0; let movedAsleep = 0; let zDead = false; let botAlive = true;
  beforeAll(async () => {
    const l = await createLocalServer({ store: new MemoryWorldStore(), seed: 11, bots: 2 });
    try {
      const W = l.game.world; const d = gameplayDefs(W); setTimeOfDay(W, 8);
      const bots = l.bots.map((b) => l.game.players.get(b.client.clientId)!.entity);
      const iid = (k: string) => [...d.items.values()].find((i) => i.key === k)!.id; const pc = (k: string) => [...d.pieces.values()].find((p) => p.key === k)!;
      for (const e of bots) { // a head start (skills + materials) so the ladder reaches the bed quickly; everything else is the bots' own doing
        grantSkillUnlocks(W, e); addItem(W, e, iid("stone_axe"), 1); addItem(W, e, iid("stone_pickaxe"), 1);
        for (const k of ["campfire", "basic_storage_box", "workbench", "bed", "campfire"]) for (const c of pieceCost(d, pc(k), pc(k).fixedTier)) addItem(W, e, c.item, c.count);
        for (const sl of BASE_SLOTS) for (const c of pieceCost(d, pc(sl.key), sl.tier ?? 0)) addItem(W, e, c.item, c.count);
        addItem(W, e, iid("wood"), 60); addItem(W, e, iid("stone"), 40);
      }
      W.events.on(PiecePlaced as never, (ev: { builder: number; type: number }) => { let s = pieces.get(ev.builder); if (!s) pieces.set(ev.builder, (s = new Set())); s.add(d.pieces.get(ev.type)?.key ?? "?"); });
      const prev = new Map<number, string>(); let z: Entity | undefined;
      for (let i = 0; i < 5200 && !zDead; i++) {
        if (i === 2200) setTimeOfDay(W, 23);
        if (i === 3200) { const t = W.get(bots[0] as Entity, Transform)!; z = spawnZombie(W, [...d.zombies.values()][0]!.id, t.x + 1.5, t.y); }
        l.pump(50); await Promise.resolve();
        const phase = i < 2200 ? "day" : i < 3200 ? "night" : "fight";
        for (const e of bots) {
          const m = W.getField(e as Entity, Stance, "mode") ?? 0; const k = `${phase}:${m}`; modes.set(k, (modes.get(k) ?? 0) + 1);
          const t = W.get(e as Entity, Transform)!; const pos = `${t.x.toFixed(3)},${t.y.toFixed(3)}`;
          if (m === StanceMode.Sleep) { if ((W.getField(e as Entity, Stance, "bedNetId") ?? 0) !== 0) sleptInBed++; if (prev.get(e as number)?.startsWith("S") && prev.get(e as number) !== `S${pos}`) movedAsleep++; prev.set(e as number, `S${pos}`); } else prev.set(e as number, pos);
        }
        if (z !== undefined && i % 10 === 0) { zDead = !W.has(z, Health) || (W.getField(z, Health, "hp") ?? 0) <= 0; botAlive = (W.getField(bots[0] as Entity, Health, "hp") ?? 0) > 0; }
      }
    } finally { await l.stop(); }
  }, 600_000);
  it("bots build the 2x2 base, the hearth and a bed", () => {
    expect(pieces.size).toBe(2);
    for (const s of pieces.values()) for (const k of ["foundation", "wall_corner_outer", "wall_doorway", "door_wood", "roof_flat", "bed"]) expect(s.has(k), k).toBe(true);
  });
  it("at night they lie down in their bed (Sleep stance bound to a bed) and keep still while asleep", () => {
    expect(modes.get(`night:${StanceMode.Sleep}`) ?? 0).toBeGreaterThan(500); expect(sleptInBed).toBeGreaterThan(500); expect(movedAsleep).toBe(0);
  });
  it("a zombie at the door: the bot wakes, blocks between strikes and kills it", () => {
    expect(modes.get(`fight:${StanceMode.Block}`) ?? 0).toBeGreaterThan(0); expect(zDead).toBe(true); expect(botAlive).toBe(true);
  });
});
