import { describe, it, expect } from "vitest";
import { World, defineComponent, entityIndex, TimeOfDay, Weather, NetId, ENV_NET_ID, defineEvent, defineActions, defineCommand,
  CommandRegistry, InputState, inputFrameToBytes, inputFrameFromBytes, encodeSnapshot, decodeSnapshot, applySnapshot, schemaHash, BinaryWriter, BinaryReader, writeRecord, readRecord } from "../src/index.js";

const Inv = defineComponent("Inv", { items: { type: "u16", length: 4 }, slots: { type: "u8", default: 4 }, hand: { type: "u8", default: 255 } }, { networked: true });

describe("array fields", () => {
  it("get/set elements, subarray views, swap-remove keeps arrays", () => {
    const w = new World(); w.register(Inv);
    const a = w.create(), b = w.create(), c = w.create();
    w.add(a, Inv, { items: [1, 2, 3, 4] }); w.add(b, Inv, { items: [5, 6] }); w.add(c, Inv);
    expect(w.get(b, Inv)!.items).toEqual([5, 6, 0, 0]);
    w.setElement(c, Inv, "items", 3, 99); expect(w.getElement(c, Inv, "items", 3)).toBe(99);
    const view = w.getArray(a, Inv, "items")!; view[0] = 7; expect(w.get(a, Inv)!.items[0]).toBe(7);
    expect(() => w.setElement(c, Inv, "items", 4, 1)).toThrow(RangeError);
    w.destroy(a); expect(w.get(c, Inv)!.items).toEqual([0, 0, 0, 99]); expect(w.get(b, Inv)!.items).toEqual([5, 6, 0, 0]);
    for (let i = 0; i < 200; i++) w.add(w.create(), Inv, { items: [i, i, i, i] }); // grow
    expect(w.get(b, Inv)!.items).toEqual([5, 6, 0, 0]);
  });
  it("defaults applied on add, overridable", () => {
    const w = new World(); w.register(Inv); const e = w.create();
    w.add(e, Inv); expect(w.get(e, Inv)).toEqual({ items: [0, 0, 0, 0], slots: 4, hand: 255 });
    const f = w.create(); w.add(f, Inv, { hand: 2 }); expect(w.getField(f, Inv, "hand")).toBe(2);
  });
  it("serialized in records and snapshots; length/default in hash", () => {
    const wr = new BinaryWriter(); writeRecord(wr, Inv.schema, { items: [1, 2, 3, 4], slots: 4, hand: 1 });
    expect(readRecord(new BinaryReader(wr.finish()), Inv.schema)).toEqual({ items: [1, 2, 3, 4], slots: 4, hand: 1 });
    expect(schemaHash({ a: { type: "u16", length: 4 } })).not.toBe(schemaHash({ a: { type: "u16", length: 5 } }));
    expect(schemaHash({ a: { type: "u8", default: 1 } })).not.toBe(schemaHash({ a: "u8" }));
    const a = new World(); a.register(Inv); const e = a.create(); a.add(e, Inv, { items: [9, 8, 7, 6] });
    const b = new World(); b.register(Inv); b.create();
    applySnapshot(b, decodeSnapshot(b, encodeSnapshot(a))); expect(b.get(e, Inv)!.items).toEqual([9, 8, 7, 6]);
  });
});

describe("simulate()", () => {
  it("sets tick per replayed tick, restores it, flags isReplaying", () => {
    const w = new World(); for (let i = 0; i < 10; i++) w.step(0.05);
    const seen: [number, boolean][] = [];
    w.addSystem("simulation", "s", (wd) => seen.push([wd.tick, wd.isReplaying]));
    w.simulate(3, 0.05); expect(seen).toEqual([[7, true], [8, true], [9, true]]);
    expect(w.tick).toBe(10); expect(w.isReplaying).toBe(false);
    seen.length = 0; w.simulate(2, 0.05, { startTick: 4 }); expect(seen.map((s) => s[0])).toEqual([4, 5]);
  });
  it("discards events by default, keeps with keepEvents", () => {
    const E = defineEvent<number>("E"); const w = new World(); const got: number[] = [];
    w.events.on(E, (n) => got.push(n)); w.events.emit(E, 0);
    w.addSystem("simulation", "emit", (wd) => wd.events.emit(E, wd.isReplaying ? 1 : 2));
    w.simulate(2, 0.05); w.simulate(1, 0.05, { keepEvents: true });
    w.step(0.05); expect(got).toEqual([0, 1, 2]);
  });
  it("runs only named systems; predicted set visible; legacy callback form", () => {
    const w = new World(); const log: string[] = [];
    w.addSystem("simulation", "a", () => log.push("a")).addSystem("simulation", "b", (wd) => log.push(`b${wd.predicted.size}`));
    const e = w.create(); w.predicted.add(e);
    w.simulate(1, 0.05, { systems: ["b"] }); expect(log).toEqual(["b1"]);
    log.length = 0; const calls: number[] = []; w.simulate(2, 0.05, (i) => calls.push(i)); expect(calls).toEqual([0, 1]); expect(log).toEqual(["a", "b1", "a", "b1"]);
  });
});

describe("rngFor", () => {
  it("deterministic from seed+tick+key+entity, independent of global rng", () => {
    const a = new World({ seed: 9 }), b = new World({ seed: 9 });
    b.rng.next(); b.rng.next();
    expect(a.rngFor("loot", 5).next()).toBe(b.rngFor("loot", 5).next());
    const x = a.rngFor("loot", 5).next();
    expect(a.rngFor("loot", 6).next()).not.toBe(x); expect(a.rngFor("other", 5).next()).not.toBe(x);
    expect(a.rngFor(3).next()).not.toBe(a.rngFor("3").next());
    a.step(0.05); expect(a.rngFor("loot", 5).next()).not.toBe(x);
    expect(new World({ seed: 10 }).rngFor("loot", 5).next()).not.toBe(x);
  });
});

describe("environment singleton", () => {
  it("has NetId ENV_NET_ID, TimeOfDay, Weather; env() view reads/writes and marks changed", () => {
    const w = new World(); const env = w.environment;
    expect(w.getField(env, NetId, "id")).toBe(ENV_NET_ID); expect(TimeOfDay.networked && Weather.networked).toBe(true);
    w.step(0.05);
    w.env(Weather).kind = 3; w.env(TimeOfDay).t = 0.5;
    expect(w.get(env, Weather)!.kind).toBe(3); expect([...w.changed(Weather)]).toEqual([env]);
    expect(w.resource(TimeOfDay).t).toBe(0.5); // deprecated alias
  });
});

describe("systemOrder", () => {
  it("lists phase/name in execution order", () => {
    const w = new World(); w.addSystem("postSim", "p", () => {}).addSystem("simulation", "s", () => {}).addSystem("input", "i", () => {});
    expect(w.systemOrder()).toEqual([{ phase: "input", name: "i" }, { phase: "simulation", name: "s" }, { phase: "postSim", name: "p" }]);
  });
});

describe("generic input", () => {
  it("defineActions masks, InputState, command roundtrip", () => {
    const A = defineActions(["Up", "Down", "Sprint"]);
    expect(A).toEqual({ Up: 1, Down: 2, Sprint: 4 });
    expect(() => defineActions(Array.from({ length: 33 }, (_, i) => `a${i}`))).toThrow();
    const Craft = defineCommand("Craft", { recipe: "u16", target: "u32" });
    const Place = defineCommand("Place", { piece: "u16", x: "i32", y: "i32", rot: "u8" });
    const reg = new CommandRegistry(); reg.register(Craft); reg.register(Place);
    const inp = new InputState(); inp.press(A.Up | A.Sprint); inp.release(A.Up); inp.aimX = 1.5;
    inp.queue(reg.make(Craft, { recipe: 3, target: 77 })); inp.queue(reg.make(Place, { piece: 2, x: -5, y: 9, rot: 1 }));
    const f = inp.sample(42); expect(inp.sample(43).commands).toEqual([]);
    const back = inputFrameFromBytes(inputFrameToBytes(f, reg), reg);
    expect(back).toEqual({ tick: 42, actions: 4, aimX: 1.5, aimY: 0, commands: [{ type: 0, values: { recipe: 3, target: 77 } }, { type: 1, values: { piece: 2, rot: 1, x: -5, y: 9 } }] });
    expect(reg.is(back.commands[1]!, Place)).toBe(true);
  });
});
