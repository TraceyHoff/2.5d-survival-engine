// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { InputSystem, KeyboardMouseDevice, GamepadDevice, DEFAULT_ACTIONS, DEFAULT_CONTEXTS, DEFAULT_PROFILES } from "@engine/input";
import { RoadTool, lineTiles } from "../src/road-tool.js";
import { signEditorState, buildSignEditor } from "../src/sign-editor.js";
import { roadPrompt } from "../src/world-tools.js";
import { UINav } from "../src/ui-nav.js";

describe("ADR-122 road tool", () => {
  it("cycles surfaces and off", () => { const t = new RoadTool(2); expect([t.cycle(), t.cycle(), t.cycle()]).toEqual([1, 2, 0]); expect(t.active).toBe(false); });
  it("mouse drag sends immediately; touch waits for confirm/cancel", () => {
    const t = new RoadTool(3); t.select(1);
    t.down({ x: 0, y: 0 }); expect(t.up({ x: 3, y: 0 }, "keyboardMouse")).toEqual({ a: { x: 0, y: 0 }, b: { x: 3, y: 0 } });
    t.down({ x: 0, y: 0 }); expect(t.up({ x: 0, y: 2 }, "touch")).toBeUndefined(); expect(t.pending).toBeDefined();
    t.down({ x: 9, y: 9 }); expect(t.start).toBeUndefined(); // ignored while pending
    expect(t.confirm()).toEqual({ a: { x: 0, y: 0 }, b: { x: 0, y: 2 } });
    t.down({ x: 0, y: 0 }); t.up({ x: 1, y: 1 }, "touch"); expect(t.cancel()).toBe(false); expect(t.pending).toBeUndefined(); expect(t.active).toBe(true);
    expect(t.cancel()).toBe(true); expect(t.active).toBe(false);
  });
  it("gamepad cursor: nudge, mark start/end, confirm", () => {
    const t = new RoadTool(1); t.select(1);
    expect(t.nudge([0, 0], 0.1, { x: 5, y: 5 })).toEqual({ x: 5, y: 5 });
    t.mark(); expect(t.start).toEqual({ x: 5, y: 5 });
    const end = t.nudge([1, 0], 0.5, { x: 0, y: 0 }); expect(end.x).toBeGreaterThan(5); expect(end.y).toBeLessThan(5);
    expect(t.mark()).toBeUndefined(); expect(t.pending).toBeDefined();
    expect(t.mark()).toEqual({ a: { x: 5, y: 5 }, b: end });
  });
  it("lineTiles matches server walk and is capped", () => {
    expect(lineTiles({ a: { x: 0, y: 0 }, b: { x: 2, y: 0 } })).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }]);
    expect(lineTiles({ a: { x: 0, y: 0 }, b: { x: 100, y: 0 } }).length).toBeLessThanOrEqual(32);
  });
  it("prompts per device", () => {
    expect(roadPrompt("gamepad", { start: false, pending: false })).toContain("Ⓐ");
    expect(roadPrompt("touch", { start: false, pending: true })).toContain("Confirm");
    expect(roadPrompt("keyboardMouse", { start: false, pending: false })).toContain("G");
  });
});

describe("ADR-122 bindings", () => {
  const mk = () => { let now = 0; const clock = { now: () => now, advance: (ms: number) => { now += ms; } };
    const sys = new InputSystem(clock as never, { actions: DEFAULT_ACTIONS, contexts: DEFAULT_CONTEXTS, profiles: DEFAULT_PROFILES });
    const kbm = new KeyboardMouseDevice(); const pad = new GamepadDevice(0); sys.addDevice(kbm); sys.addDevice(pad); sys.push("Gameplay");
    return { sys, kbm, pad, tick: () => { clock.advance(50); sys.update(); } }; };
  it("G / N trigger RoadTool / PlaceSign", () => {
    const { sys, kbm, tick } = mk();
    kbm.press("key.KeyG"); tick(); expect(sys.pressed("RoadTool")).toBe(true); kbm.releaseAll(); tick();
    kbm.press("key.KeyN"); tick(); expect(sys.pressed("PlaceSign")).toBe(true);
  });
  it("Road context shadows Jump on pad A", () => {
    const { sys, pad, tick } = mk(); sys.push("Road");
    pad.set("pad.a", 1); tick(); expect(sys.pressed("Road.Mark")).toBe(true); expect(sys.pressed("Jump")).toBe(false);
    pad.set("pad.a", 0); tick(); pad.set("pad.b", 1); tick(); expect(sys.pressed("Road.Cancel")).toBe(true);
  });
});

describe("ADR-122 sign editor", () => {
  it("state: sanitized, counted, masked", () => {
    const s = signEditorState("  hi\u0007 there  ", 8); expect(s.max).toBe(8); expect(s.used).toBe(s.stored.length); expect(s.stored).not.toContain("\u0007");
    expect(signEditorState("", 8).empty).toBe(true);
  });
  it("live preview, counter, OSK, save and Esc close via UINav", () => {
    document.body.innerHTML = ""; const root = document.createElement("div"); document.body.append(root);
    const nav = new UINav({ root, pollGamepads: false, history: false });
    const onSave = vi.fn(); let closed = 0;
    const el = buildSignEditor({ kindName: "Wooden sign", maxLen: 10, initial: "Camp", keyboard: true, onSave, close: () => nav.close() });
    nav.open("sign", el, () => { closed++; });
    const input = el.querySelector<HTMLInputElement>("[data-role=sign-input]")!; expect(input.maxLength).toBe(10);
    expect(el.querySelector("[data-role=sign-count]")!.textContent).toContain("4");
    el.querySelector<HTMLButtonElement>("[data-osk]")!.click();
    expect(input.value.length).toBe(5); expect(el.querySelector("[data-role=sign-preview]")!.textContent!.length).toBeGreaterThan(0);
    el.querySelector<HTMLButtonElement>("[data-role=submit]")!.click(); expect(onSave).toHaveBeenCalledTimes(1);
    const el2 = buildSignEditor({ kindName: "x", maxLen: 10, initial: "", onSave, close: () => nav.close() }); nav.open("sign2", el2, () => { closed++; });
    dispatchEvent(new KeyboardEvent("keydown", { code: "Escape", key: "Escape" })); expect(nav.isOpenId("sign2")).toBe(false); expect(closed).toBeGreaterThanOrEqual(1);
    nav.destroy();
  });
});
