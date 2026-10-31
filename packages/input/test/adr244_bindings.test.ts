/** ADR-244: block / crouch / carry / rest bindings per device (Xbox pad first, KBM, minimal touch), hold vs toggle, frame bits. */
import { describe, expect, it } from "vitest";
import { InputState } from "@engine/core";
import {
  InputSystem, GamepadDevice, KeyboardMouseDevice, TouchDevice, VirtualControls,
  DEFAULT_ACTIONS, DEFAULT_CONTEXTS, DEFAULT_PROFILES, DEFAULT_FRAME_MAPPING, DefaultHoldBits, DefaultEdgeBits, DEFAULT_TOUCH_LAYOUTS,
} from "../src/index.js";

function setup() {
  const c = { t: 0, now: () => c.t }; const sys = new InputSystem(c, { actions: DEFAULT_ACTIONS, contexts: DEFAULT_CONTEXTS, profiles: DEFAULT_PROFILES });
  const kbm = new KeyboardMouseDevice(); const pad = new GamepadDevice(0); const touch = new TouchDevice();
  sys.addDevice(kbm); sys.addDevice(pad); sys.addDevice(touch); sys.push("Gameplay");
  const st = new InputState(); let seq = 0;
  const tick = () => { c.t += 50; sys.update(); sys.writeFrame(st, DEFAULT_FRAME_MAPPING); return st.sample(++seq); };
  return { sys, kbm, pad, touch, tick };
}
const hold = (f: { actions: number }, bit: number) => (f.actions & bit) !== 0;
const edge = (f: { edges?: number }, bit: number) => ((f.edges ?? 0) & bit) !== 0;

describe("ADR-244 gamepad (Xbox)", () => {
  it("LT = block/aim hold, R3 = crouch hold bit (sim toggles on the rising edge)", () => {
    const { pad, tick } = setup();
    pad.set("pad.lt", 1); expect(hold(tick(), DefaultHoldBits.Secondary)).toBe(true); expect(hold(tick(), DefaultHoldBits.Secondary)).toBe(true);
    pad.set("pad.lt", 0); tick(); expect(hold(tick(), DefaultHoldBits.Secondary)).toBe(false);
    pad.set("pad.rs", 1); expect(hold(tick(), DefaultHoldBits.Crouch)).toBe(true); pad.set("pad.rs", 0); tick(); expect(hold(tick(), DefaultHoldBits.Crouch)).toBe(false);
  });
  it("RB+X = Carry edge (not Interact), RB+A = Rest edge (not Jump); plain X / A keep Interact / Jump", () => {
    const { sys, pad, tick } = setup();
    pad.set("pad.rb", 1); tick(); pad.set("pad.x", 1); let f = tick(); expect(edge(f, DefaultEdgeBits.Carry)).toBe(true); expect(sys.pressed("Interact")).toBe(false);
    pad.set("pad.x", 0); tick(); tick(); expect(sys.pressed("Interact")).toBe(false);
    pad.set("pad.a", 1); f = tick(); expect(edge(f, DefaultEdgeBits.Rest)).toBe(true); expect(sys.pressed("Jump")).toBe(false);
    pad.set("pad.a", 0); pad.set("pad.rb", 0); tick(); tick();
    pad.set("pad.a", 1); f = tick(); expect(sys.pressed("Jump")).toBe(true); expect(edge(f, DefaultEdgeBits.Rest)).toBe(false); pad.set("pad.a", 0); tick();
    pad.set("pad.x", 1); f = tick(); expect(edge(f, DefaultEdgeBits.Carry)).toBe(false);
  });
});

describe("ADR-244 keyboard + mouse", () => {
  it("RMB = block/aim hold, Ctrl = crouch, Q = carry/drop, Z = sleep/wake", () => {
    const { kbm, tick } = setup();
    kbm.press("mouse.right"); expect(hold(tick(), DefaultHoldBits.Secondary)).toBe(true); kbm.release("mouse.right"); tick(); expect(hold(tick(), DefaultHoldBits.Secondary)).toBe(false);
    kbm.press("key.ControlLeft"); expect(hold(tick(), DefaultHoldBits.Crouch)).toBe(true); kbm.release("key.ControlLeft"); tick(); expect(hold(tick(), DefaultHoldBits.Crouch)).toBe(false);
    kbm.press("key.KeyQ"); expect(edge(tick(), DefaultEdgeBits.Carry)).toBe(true); expect(edge(tick(), DefaultEdgeBits.Carry)).toBe(false); kbm.release("key.KeyQ"); tick();
    kbm.press("key.KeyZ"); expect(edge(tick(), DefaultEdgeBits.Rest)).toBe(true); kbm.release("key.KeyZ"); tick();
  });
  it("new keys do not collide with existing Gameplay bindings (RoadTool G, PlaceSign N stay)", () => {
    const kb = DEFAULT_PROFILES.find((p) => p.deviceClass === "keyboardMouse")!.bindings.Gameplay!;
    const by = (c: string) => kb.filter((b) => b.control === c && !b.modifiers?.length).map((b) => b.action);
    expect(by("key.KeyQ")).toEqual(["Carry"]); expect(by("key.KeyZ")).toEqual(["Rest"]); expect(by("key.KeyG")).toEqual(["RoadTool"]); expect(by("key.KeyN")).toEqual(["PlaceSign"]);
  });
});

describe("ADR-244 touch", () => {
  const mk = () => { const s = setup(); const vc = new VirtualControls(DEFAULT_TOUCH_LAYOUTS.gameplay, s.touch); vc.resize({ w: 844, h: 390 }); const at = (id: string) => vc.geometry().find((g) => g.id === id)!; return { ...s, vc, at }; };
  it("block button is a hold; crouch button is momentary (each tap = one toggle edge in the sim)", () => {
    const { vc, at, tick } = mk();
    const b = at("secondary"); vc.pointerDown(1, b.x, b.y); expect(hold(tick(), DefaultHoldBits.Secondary)).toBe(true); expect(hold(tick(), DefaultHoldBits.Secondary)).toBe(true);
    vc.pointerUp(1); tick(); expect(hold(tick(), DefaultHoldBits.Secondary)).toBe(false);
    const c = at("crouch"); vc.pointerDown(2, c.x, c.y); expect(hold(tick(), DefaultHoldBits.Crouch)).toBe(true); vc.pointerUp(2); tick(); expect(hold(tick(), DefaultHoldBits.Crouch)).toBe(false);
  });
  it("carry / sleep buttons fire their edges; hidden when not contextual", () => {
    const { vc, at, tick } = mk();
    const c = at("carry"); vc.pointerDown(3, c.x, c.y); expect(edge(tick(), DefaultEdgeBits.Carry)).toBe(true); vc.pointerUp(3); tick(); tick();
    const s = at("sleep"); vc.pointerDown(4, s.x, s.y); expect(edge(tick(), DefaultEdgeBits.Rest)).toBe(true); vc.pointerUp(4); tick(); tick();
    vc.hidden.add("carry"); expect(vc.pointerDown(5, c.x, c.y)).toBe(false);
  });
});
