/** ADR-253: camera rotation input — camera-relative move / ghost nudge, stick aim through dirToWorld, rotate bindings per device. */
import { describe, expect, it } from "vitest";
import { InputState, AimMode } from "@engine/core";
import {
  InputSystem, GamepadDevice, KeyboardMouseDevice, TouchDevice, AimResolver, rotateScreenVec,
  DEFAULT_ACTIONS, DEFAULT_CONTEXTS, DEFAULT_PROFILES, DEFAULT_FRAME_MAPPING,
} from "../src/index.js";

function setup() {
  const c = { t: 0, now: () => c.t }; const sys = new InputSystem(c, { actions: DEFAULT_ACTIONS, contexts: DEFAULT_CONTEXTS, profiles: DEFAULT_PROFILES });
  const kbm = new KeyboardMouseDevice(); const pad = new GamepadDevice(0); const touch = new TouchDevice();
  sys.addDevice(kbm); sys.addDevice(pad); sys.addDevice(touch); sys.push("Gameplay");
  const st = new InputState(); let seq = 0;
  const tick = () => { c.t += 50; sys.update(); sys.writeFrame(st, DEFAULT_FRAME_MAPPING); return st.sample(++seq); };
  return { sys, kbm, pad, touch, tick, st };
}
const HOTBAR = ["Hotbar1", "Hotbar2", "Hotbar3", "Hotbar4", "Hotbar5", "Hotbar6", "Hotbar7", "Hotbar8"];

describe("ADR-253 rotateScreenVec", () => {
  it("q0 is the identity and each quarter is a 90° turn back into the q0 screen frame", () => {
    expect(rotateScreenVec([0.3, -0.7], 0)).toEqual([0.3, -0.7]);
    expect(rotateScreenVec([0, -1], 1)).toEqual([-1, 0]); // screen up in q1 = q0 screen left
    expect(rotateScreenVec([0, -1], 2)).toEqual([0, 1]);
    expect(rotateScreenVec([0, -1], 3)).toEqual([1, 0]);
    expect(rotateScreenVec([1, 0], -1)).toEqual(rotateScreenVec([1, 0], 3)); // negative quarters wrap
    for (let q = 0; q < 4; q++) { const [x, y] = rotateScreenVec([0.6, 0.8], q); expect(Math.hypot(x, y)).toBeCloseTo(1, 12); }
    for (const q of [1, 2, 3]) for (const v of rotateScreenVec([0, 0], q)) expect(Object.is(v, -0)).toBe(false); // no -0 on the wire
  });
});

describe("ADR-253 writeFrame is camera-relative", () => {
  it("analog move + digital fallback bits rotate with viewQuarter (W = up on screen in every view)", () => {
    const { sys, kbm, tick } = setup(); const B = DEFAULT_FRAME_MAPPING.move!;
    kbm.set("key.KeyW", 1);
    const want: [number, number, number][] = [[0, -1, B.up], [-1, 0, B.left], [0, 1, B.down], [1, 0, B.right]];
    for (let q = 0; q < 4; q++) {
      sys.viewQuarter = q; const f = tick(); const [x, y, bit] = want[q]!;
      expect(f.moveX).toBeCloseTo(x, 6); expect(f.moveY).toBeCloseTo(y, 6);
      expect(f.actions & (B.up | B.down | B.left | B.right)).toBe(bit);
    }
  });
  it("viewQuarter 0 leaves the frame exactly as before", () => {
    const { sys, pad, tick } = setup(); sys.viewQuarter = 0; pad.set("pad.lx", 0.5); pad.set("pad.ly", -0.25);
    const f = tick(); const [x, y] = [sys.vector("Move")[0], sys.vector("Move")[1]]; expect(f.moveX).toBeCloseTo(x!, 2); expect(f.moveY).toBeCloseTo(y!, 2);
  });
  it("the build ghost nudge rotates too", () => {
    const { sys, st, pad, tick } = setup(); sys.push("Building"); pad.set("pad.rx", 1); tick();
    const base = [st.ghostNudgeX ?? 0, st.ghostNudgeY ?? 0]; expect(Math.hypot(base[0]!, base[1]!)).toBeGreaterThan(0.5);
    sys.viewQuarter = 2; tick(); expect(st.ghostNudgeX).toBeCloseTo(-base[0]!, 6); expect(st.ghostNudgeY).toBeCloseTo(-base[1]!, 6);
  });
});

describe("ADR-253 AimResolver dirToWorld", () => {
  it("gamepad stick aim goes through dirToWorld and is normalised; omitted = legacy raw direction", () => {
    const { sys, pad, tick } = setup(); pad.set("pad.rx", 1); tick();
    const legacy = new AimResolver(sys).resolve(undefined, 0, { x: 10, y: 10 });
    expect(legacy.mode).toBe(AimMode.Direction); expect(legacy.x).toBeCloseTo(1, 6); expect(legacy.y).toBeCloseTo(0, 6);
    const calls: [number, number][] = [];
    const r = new AimResolver(sys, { dirToWorld: (x, y) => { calls.push([x, y]); return { x: 3 * y, y: -3 * x }; } }).resolve(undefined, 0, { x: 10, y: 10 });
    expect(calls.length).toBeGreaterThan(0); expect(r.x).toBeCloseTo(0, 6); expect(r.y).toBeCloseTo(-1, 6);
  });
});

describe("ADR-253 rotate bindings", () => {
  it("KBM [ / ] rotate in gameplay and in build mode", () => {
    const { sys, kbm, tick } = setup();
    kbm.set("key.BracketRight", 1); tick(); expect(sys.pressed("Camera.RotateCW")).toBe(true); expect(sys.pressed("Camera.RotateCCW")).toBe(false);
    kbm.set("key.BracketRight", 0); tick(); kbm.set("key.BracketLeft", 1); tick(); expect(sys.pressed("Camera.RotateCCW")).toBe(true);
    kbm.set("key.BracketLeft", 0); tick(); sys.push("Building"); kbm.set("key.BracketRight", 1); tick(); expect(sys.pressed("Camera.RotateCW")).toBe(true);
  });
  it("a consuming menu keeps [ / ] for its tabs (no rotation behind the panel)", () => {
    const { sys, kbm, tick } = setup(); sys.push("Inventory"); kbm.set("key.BracketRight", 1); tick();
    expect(sys.pressed("Camera.RotateCW")).toBe(false); expect(sys.pressed("UI.TabNext")).toBe(true);
  });
  it("pad RB + D-pad ←/→ rotates and shadows the plain D-pad hotbar", () => {
    const { sys, pad, tick } = setup();
    pad.set("pad.rb", 1); tick(); pad.set("pad.dright", 1); tick();
    expect(sys.pressed("Camera.RotateCW")).toBe(true); expect(HOTBAR.some((a) => sys.pressed(a))).toBe(false);
    pad.set("pad.dright", 0); tick(); pad.set("pad.dleft", 1); tick(); expect(sys.pressed("Camera.RotateCCW")).toBe(true);
    pad.set("pad.dleft", 0); pad.set("pad.rb", 0); tick(); tick();
    pad.set("pad.dleft", 1); tick(); expect(sys.pressed("Camera.RotateCCW")).toBe(false); // no modifier: no rotation
  });
  it("build mode: LT + D-pad ←/→ rotates the camera instead of cycling the piece; plain D-pad still cycles", () => {
    const { sys, pad, tick } = setup(); sys.push("Building");
    pad.set("pad.lt", 1); tick(); pad.set("pad.dright", 1); tick();
    expect(sys.pressed("Camera.RotateCW")).toBe(true); expect(sys.pressed("Build.PieceNext")).toBe(false);
    pad.set("pad.dright", 0); pad.set("pad.lt", 0); tick(); tick();
    pad.set("pad.dright", 1); tick(); expect(sys.pressed("Build.PieceNext")).toBe(true); expect(sys.pressed("Camera.RotateCW")).toBe(false);
  });
  it("touch profile exposes rotate buttons for virtual layouts", () => {
    const flat = JSON.stringify(DEFAULT_PROFILES.find((p) => p.deviceClass === "touch")); expect(flat).toContain("touch.btn.camcw"); expect(flat).toContain("touch.btn.camccw");
  });
});
