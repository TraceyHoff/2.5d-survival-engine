import { describe, expect, it } from "vitest";
import { Transform } from "@engine/core";
import { Container, Pet, Tamed, TroughOwner } from "@engine/gameplay";
import { MemoryWorldStore } from "../src/index.js";
import { makeWorld, step } from "./helpers.js";

describe("ADR-145 pets persist in chunk saves", () => {
  it("Pet (owner, name, level, xp, fullness, command), its bag and a trough owner round-trip", async () => {
    const store = new MemoryWorldStore(); const reg = (w: import("@engine/core").World): void => { w.register(Pet); w.register(Tamed); w.register(Container); w.register(TroughOwner); };
    const a = makeWorld(store, { setup: reg }); a.chunks.setSource({ id: 1, x: 16, y: 16 }); step(a.world);
    const e = a.world.create(); const name = [...new TextEncoder().encode("Rex")];
    a.world.add(e, Transform, { x: 5, y: 6 }).add(e, Pet, { species: 1, owner: 42, cmd: 1, level: 4, xp: 33, fullness: 50, loyalty: 70, hp: 20, stayX: 5, stayY: 6, len: 3, name })
      .add(e, Container, { slotCount: 6, items: [3], counts: [2] });
    const t = a.world.create(); a.world.add(t, Transform, { x: 8, y: 8 }).add(t, TroughOwner, { player: 42 });
    step(a.world); await a.persist.saveAll();
    const b = makeWorld(store, { setup: reg }); b.chunks.setSource({ id: 1, x: 16, y: 16 }); step(b.world);
    const [x] = [...b.world.query([Pet])]; expect(x).toBeDefined();
    const p = b.world.get(x!, Pet)!; expect([p.species, p.owner, p.cmd, p.level, p.xp, p.len]).toEqual([1, 42, 1, 4, 33, 3]);
    expect(p.fullness).toBeCloseTo(50, 0); expect(p.hp).toBeCloseTo(20);
    expect(b.world.getField(x!, Container, "slotCount")).toBe(6);
    expect([...b.world.query([TroughOwner])].map((q) => b.world.getField(q, TroughOwner, "player"))).toEqual([42]);
  });
});
