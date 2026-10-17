import { describe, it, expect } from "vitest";
import { World, defineComponent, Transform, PrevTransform, NetId, Owner, entityIndex, entityGen, defineResource } from "../src/index.js";

const Vel = defineComponent("Vel", { dx: "f32", dy: "f32" });
const Tag = defineComponent("Tag", { v: "u8" });

describe("ECS", () => {
  it("creates, destroys, recycles with generation", () => {
    const w = new World();
    const a = w.create(); expect(w.isAlive(a)).toBe(true);
    w.destroy(a); expect(w.isAlive(a)).toBe(false);
    const b = w.create();
    expect(entityIndex(b)).toBe(entityIndex(a)); expect(entityGen(b)).toBe(entityGen(a) + 1);
    expect(w.isAlive(a)).toBe(false); expect(w.entityCount).toBe(1);
  });
  it("builtins registered first with stable ids", () => {
    const w = new World();
    expect([NetId, Owner, Transform, PrevTransform].map((c) => w.componentId(c))).toEqual([0, 1, 2, 3]);
    expect(w.register(Vel)).toBe(4); expect(w.register(Vel)).toBe(4);
    expect(NetId.networked && Owner.networked && Transform.networked).toBe(true);
    expect(PrevTransform.networked).toBe(false);
  });
  it("add/get/set/remove components, field accessors", () => {
    const w = new World(); w.register(Vel);
    const e = w.create().valueOf();
    w.add(e, Transform, { x: 1.5, y: 2 }).add(e, Vel, { dx: 1 });
    expect(w.get(e, Transform)).toEqual({ x: 1.5, y: 2, z: 0, facing: 0 });
    w.set(e, Vel, { dy: 3 }); expect(w.getField(e, Vel, "dy")).toBe(3);
    expect(w.setField(e, Vel, "dx", 9)).toBe(true); expect(w.get(e, Vel)).toEqual({ dx: 9, dy: 3 });
    w.remove(e, Vel); expect(w.has(e, Vel)).toBe(false); expect(w.get(e, Vel)).toBeUndefined();
    w.destroy(e); expect(w.has(e, Transform)).toBe(false);
  });
  it("swap-remove keeps data consistent", () => {
    const w = new World({ maxEntities: 1000 }); w.register(Tag);
    const es = Array.from({ length: 200 }, (_, i) => { const e = w.create(); w.add(e, Tag, { v: i % 256 }); return e; });
    for (let i = 0; i < 200; i += 3) w.destroy(es[i]!);
    for (let i = 0; i < 200; i++) if (i % 3) expect(w.get(es[i]!, Tag)!.v).toBe(i % 256);
  });
  it("queries with all/none", () => {
    const w = new World(); w.register(Vel); w.register(Tag);
    const a = w.create(); w.add(a, Transform).add(a, Vel);
    const b = w.create(); w.add(b, Transform).add(b, Vel).add(b, Tag);
    const c = w.create(); w.add(c, Transform);
    expect(new Set(w.query([Transform, Vel]))).toEqual(new Set([a, b]));
    expect([...w.query([Transform, Vel], [Tag])]).toEqual([a]);
    expect(new Set(w.query([Transform]))).toEqual(new Set([a, b, c]));
  });
  it("change tracking: marked on add/write, cleared after step", () => {
    const w = new World(); w.register(Vel);
    const a = w.create(); const b = w.create();
    w.add(a, Vel); w.add(b, Vel); w.step(0.05);
    expect([...w.changed(Vel)]).toEqual([]);
    w.setField(b, Vel, "dx", 1);
    expect([...w.changed(Vel)]).toEqual([b]);
    w.store(Vel).markChanged(entityIndex(a));
    expect([...w.changed(Vel)]).toEqual([a, b]);
    w.step(0.05); expect([...w.changed(Vel)]).toEqual([]);
  });
  it("spawn/despawn hooks; despawn sees components", () => {
    const w = new World(); const log: string[] = [];
    w.onSpawn((e) => log.push(`s${e}`));
    const off = w.onDespawn((e, wd) => log.push(`d${wd.getField(e, NetId, "id")}`));
    const e = w.create(); w.add(e, NetId, { id: 42 }); w.destroy(e);
    off(); w.destroy(w.create());
    expect(log).toEqual([`s${e}`, "d42", expect.stringMatching(/^s/)]);
  });
  it("phases run in order, custom phases, simulate() runs only simulation", () => {
    const w = new World(); const log: string[] = [];
    for (const p of w.phases) w.addSystem(p, p, () => log.push(p));
    w.addPhase("physics", { after: "simulation" }).addSystem("physics", "phys", () => log.push("physics"));
    w.step(0.05);
    expect(log).toEqual(["input", "simulation", "physics", "postSim", "network"]);
    log.length = 0; const ticks: number[] = [];
    w.simulate(3, 0.05, (i) => ticks.push(i));
    expect(log).toEqual(["simulation", "simulation", "simulation"]); expect(ticks).toEqual([0, 1, 2]);
    expect(w.tick).toBe(1);
  });
  it("PrevTransform copied at start of each tick", () => {
    const w = new World(); const e = w.create(); w.add(e, Transform, { x: 0 });
    w.addSystem("simulation", "move", (wd) => { for (const q of wd.query([Transform])) wd.setField(q, Transform, "x", wd.getField(q, Transform, "x")! + 1); });
    w.step(0.05); expect(w.get(e, PrevTransform)!.x).toBe(0); expect(w.get(e, Transform)!.x).toBe(1);
    w.step(0.05); expect(w.get(e, PrevTransform)!.x).toBe(1);
  });
  it("resources and schema hash", () => {
    const R = defineResource<{ n: number }>("R"); const w = new World();
    w.setResource(R, { n: 1 }); w.resource(R).n++; expect(w.getResource(R)!.n).toBe(2);
    const w2 = new World(); expect(w2.getSchemaHash()).toBe(w.getSchemaHash());
    w2.register(Vel); expect(w2.getSchemaHash()).not.toBe(w.getSchemaHash());
    const w3 = new World(); w3.register(Tag); w3.register(Vel);
    const w4 = new World(); w4.register(Vel); w4.register(Tag);
    expect(w3.getSchemaHash()).not.toBe(w4.getSchemaHash());
  });
});
