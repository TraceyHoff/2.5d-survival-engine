import { describe, it, expect } from "vitest";
import { World, Transform, Owner, defineComponent, entityIndex, type Entity } from "@engine/core";
import { createHarness, createTestWorld, stepN, FakeClock, TEST_SEED } from "../src/index.js";

const Control = defineComponent("Control", { buttons: "u16" });
function makeWorld(): World {
  const w = new World({ seed: 7 }); w.register(Control);
  w.addSystem("simulation", "move", (world, dt) => {
    for (const e of world.query([Control, Transform])) if (world.getField(e, Control, "buttons")! & 1) world.setField(e, Transform, "x", world.getField(e, Transform, "x")! + 4 * dt);
  });
  return w;
}
const applyInput = (w: World, e: Entity, cmd: { buttons: number } | null) => { if (!w.has(e, Control)) w.add(e, Control); w.setField(e, Control, "buttons", cmd ? cmd.buttons : 0); };

describe("headless helpers", () => {
  it("createTestWorld/stepN/FakeClock are deterministic", () => {
    const w = createTestWorld(); expect(w.seed).toBe(TEST_SEED); stepN(w, 7); expect(w.tick).toBe(7);
    const c = new FakeClock(); expect(c.advance(50)).toBe(50); expect(c.now()).toBe(50);
  });
});

describe("multi-client harness", () => {
  it("server + 3 clients over loopback replicate and predict movement", async () => {
    const h = await createHarness({
      clients: 3, makeWorld, applyInput, link: { latencyMs: 40, jitterMs: 10 },
      onClientJoin: (s, w) => { const e = w.create(); w.add(e, Transform, { x: 0, y: s.clientId }).add(e, Owner, { clientId: s.clientId }); },
    });
    h.tick(10);
    for (const c of h.clients) { expect(c.client.owned.size).toBe(1); expect([...c.world.query([Owner])].length).toBe(3); }
    h.clients[0]!.input.buttons = 1; h.tick(20); h.clients[0]!.input.buttons = 0; h.tick(20);
    const c0 = h.clients[0]!; const self = c0.client.entities.get([...c0.client.owned][0]!)!;
    const serverX = [...h.serverWorld.query([Owner, Transform])].map((e) => h.serverWorld.get(e, Transform)!.x).sort((a, b) => b - a)[0]!;
    expect(serverX).toBeGreaterThan(3);
    expect(c0.world.get(self, Transform)!.x).toBeCloseTo(serverX, 1);
    const onOther = h.clients[1]!.client.entities.get([...c0.client.owned][0]!)!;
    expect(h.clients[1]!.world.get(onOther, Transform)!.x).toBeCloseTo(serverX, 1);
    void entityIndex;
  });
});
