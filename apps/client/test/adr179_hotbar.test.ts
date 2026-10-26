// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { InputSystem, KeyboardMouseDevice, GamepadDevice, DEFAULT_ACTIONS, DEFAULT_CONTEXTS, DEFAULT_PROFILES } from "@engine/input";
import { hotbarCells, hotbarCycle, hotbarKey, mountHotbar, pressedHotbarSlot, HOTBAR_SLOTS } from "../src/hotbar.js";

const view = [{ slot: 0, item: 1, icon: "stone_axe", name: "Stone axe", count: 1, equipped: true }, { slot: 2, item: 5, icon: "wood", name: "Wood", count: 16 }, { slot: 12, item: 9, icon: "stone", name: "Stone", count: 3 }];

describe("ADR-179 hotbar model", () => {
  it("8 cells for slots 0..7, empties included, bag slots beyond ignored", () => {
    const c = hotbarCells(view); expect(c).toHaveLength(HOTBAR_SLOTS); expect(c[0]).toMatchObject({ icon: "stone_axe", equipped: true }); expect(c[1]!.count).toBe(0); expect(c[2]!.count).toBe(16);
    expect(c.some((x) => x.icon === "stone")).toBe(false);
  });
  it("cycle skips empties and wraps", () => {
    const c = hotbarCells(view); expect(hotbarCycle(c, 0, 1)).toBe(2); expect(hotbarCycle(c, 2, 1)).toBe(0); expect(hotbarCycle(c, 0, -1)).toBe(2); expect(hotbarCycle(c, -1, 1)).toBe(0);
    expect(hotbarCycle(hotbarCells([]), -1, 1)).toBe(-1);
  });
  it("key changes only with content / equip / device", () => {
    const k = hotbarKey(hotbarCells(view), "gamepad"); expect(hotbarKey(hotbarCells([...view]), "gamepad")).toBe(k);
    expect(hotbarKey(hotbarCells(view), "touch")).not.toBe(k); expect(hotbarKey(hotbarCells([{ ...view[0]!, equipped: false }, view[1]!]), "gamepad")).not.toBe(k);
  });
});

describe("ADR-179 hotbar input (keys, simulated gamepad)", () => {
  const mk = () => { let now = 0; const clock = { now: () => now, advance: (ms: number) => { now += ms; } };
    const sys = new InputSystem(clock as never, { actions: DEFAULT_ACTIONS, contexts: DEFAULT_CONTEXTS, profiles: DEFAULT_PROFILES });
    const kbm = new KeyboardMouseDevice(); const pad = new GamepadDevice(0); sys.addDevice(kbm); sys.addDevice(pad); sys.push("Gameplay");
    return { sys, kbm, pad, tick: () => { clock.advance(16); sys.update(); } }; };
  it("digit keys map to slots", () => { const { sys, kbm, tick } = mk(); kbm.press("key.Digit4"); tick(); expect(pressedHotbarSlot((a) => sys.pressed(a))).toBe(3); });
  it("D-pad = slots 1-4, LB + D-pad = slots 5-8, RB + D-pad (zoom) selects nothing", () => {
    const { sys, pad, tick } = mk();
    pad.set("pad.dright", 1); tick(); expect(pressedHotbarSlot((a) => sys.pressed(a))).toBe(1); pad.set("pad.dright", 0); tick();
    pad.set("pad.lb", 1); tick(); pad.set("pad.ddown", 1); tick(); expect(pressedHotbarSlot((a) => sys.pressed(a))).toBe(6); pad.set("pad.ddown", 0); pad.set("pad.lb", 0); tick();
    pad.set("pad.rb", 1); tick(); pad.set("pad.dup", 1); tick(); expect(pressedHotbarSlot((a) => sys.pressed(a))).toBe(-1);
  });
});

describe("ADR-179 hotbar DOM", () => {
  it("bottom-centre strip, change-only rebuild, click equips, hidden when not visible", () => {
    const equip = vi.fn(); let v = view; const h = mountHotbar({ view: () => v, equip, device: () => "keyboardMouse" });
    expect(document.head.textContent).toMatch(/#hotbar\{position:absolute;left:50%;bottom:calc\(8px \+ var\(--sab,0px\)\);transform:translateX\(-50%\)/);
    h.update(true); expect(h.el.hidden).toBe(false); expect(h.el.querySelectorAll("button")).toHaveLength(8); expect(h.el.className).toContain("hotbar");
    const first = h.el.querySelector("button"); h.update(true); expect(h.el.querySelector("button")).toBe(first); // ADR-158: no rebuild without change
    (h.el.querySelector('[data-slot="2"]') as HTMLElement).click(); expect(equip).toHaveBeenCalledWith(2);
    v = [{ ...view[1]!, count: 15 }]; h.update(true); expect(h.el.querySelector("button")).not.toBe(first); expect(h.el.querySelector('[data-slot="2"] .c')!.textContent).toBe("15");
    h.update(false); expect(h.el.hidden).toBe(true); h.destroy();
  });
});
