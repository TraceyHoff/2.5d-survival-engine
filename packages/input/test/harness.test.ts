import { describe, it, expect } from "vitest";
import { World, Transform, Owner, InputState, defineComponent, type Entity } from "@engine/core";
import { createHarness } from "@engine/testkit";
import { InputSystem, GamepadDevice, TouchDevice, VirtualControls, applyScript, DEFAULT_ACTIONS, DEFAULT_CONTEXTS, DEFAULT_PROFILES, DEFAULT_FRAME_MAPPING, DEFAULT_TOUCH_LAYOUTS, DefaultHoldBits, type InputScript } from "../src/index.js";

const Control = defineComponent("Control", { buttons: "u16" });
function makeWorld(): World {
  const w = new World({ seed: 7 }); w.register(Control);
  w.addSystem("simulation", "move", (world, dt) => {
    for (const e of world.query([Control, Transform])) {
      const b = world.getField(e, Control, "buttons")!; const dx = (b & DefaultHoldBits.MoveRight ? 1 : 0) - (b & DefaultHoldBits.MoveLeft ? 1 : 0);
      if (dx) world.setField(e, Transform, "x", world.getField(e, Transform, "x")! + 4 * dx * dt);
    }
  });
  return w;
}
const applyInput = (w: World, e: Entity, cmd: { buttons: number } | null) => { if (!w.has(e, Control)) w.add(e, Control); w.setField(e, Control, "buttons", cmd ? cmd.buttons : 0); };

describe("input -> testkit harness integration", () => {
  it("scripted gamepad (client 0) and touch joystick (client 1) drive replicated movement", async () => {
    const h = await createHarness({ clients: 2, makeWorld, applyInput, onClientJoin: (s, w) => { const e = w.create(); w.add(e, Transform, { x: 0, y: s.clientId }).add(e, Owner, { clientId: s.clientId }); } });
    const clock = { now: () => h.clock.now() };
    const mk = () => { const s = new InputSystem(clock, { actions: DEFAULT_ACTIONS, contexts: DEFAULT_CONTEXTS, profiles: DEFAULT_PROFILES }); s.push("Gameplay"); return s; };
    const sysA = mk(), sysB = mk(); const pad = new GamepadDevice(0); sysA.addDevice(pad); const touch = new TouchDevice(); sysB.addDevice(touch);
    const vc = new VirtualControls(DEFAULT_TOUCH_LAYOUTS.gameplay, touch); vc.resize({ w: 844, h: 390 });
    const script: InputScript = [{ tick: 5, device: "pad0", control: "pad.lx", value: 0.9 }, { tick: 25, device: "pad0", control: "pad.lx", value: 0 }];
    const stA = new InputState(), stB = new InputState();
    for (let t = 0; t < 60; t++) {
      applyScript(script, [pad], t);
      if (t === 5) { vc.pointerDown(1, 100, 300); vc.pointerMove(1, 40, 300); } if (t === 25) vc.pointerUp(1);
      for (const [sys, st, c] of [[sysA, stA, h.clients[0]!], [sysB, stB, h.clients[1]!]] as const) {
        sys.update(); sys.writeFrame(st, DEFAULT_FRAME_MAPPING); const f = st.sample(t); c.input.buttons = f.actions; c.input.aimX = f.aimX; c.input.aimY = f.aimY;
      }
      h.tick();
    }
    const xs = new Map([...h.serverWorld.query([Owner, Transform])].map((e) => [h.serverWorld.get(e, Owner)!.clientId, h.serverWorld.get(e, Transform)!.x]));
    const ids = h.clients.map((c) => c.client.clientId!);
    expect(xs.get(ids[0]!)!).toBeGreaterThan(3); expect(xs.get(ids[1]!)!).toBeLessThan(-3);
  });
});
