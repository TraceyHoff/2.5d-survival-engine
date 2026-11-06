// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { World } from "@engine/core";
import { InputSystem, GamepadDevice, DEFAULT_ACTIONS, DEFAULT_CONTEXTS, DEFAULT_PROFILES } from "@engine/input";
import { mountHud } from "../src/hud.js";
import { GameMenus, GAME_MENUS, padMenuAction } from "../src/game-menus.js";
import { renderTokens, placeCard, playerZone } from "../src/tutorial/overlay.js";
import { loadSettings, saveSettings, newWorldRules } from "../src/menu.js";
import { CLIENT_FRAME_MAPPING } from "../src/frame-mapping.js";
import { Act } from "@engine/server/protocol";

const source = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const input = () => new InputSystem({ now: () => 0 } as never, { actions: DEFAULT_ACTIONS, contexts: DEFAULT_CONTEXTS, profiles: DEFAULT_PROFILES });
afterEach(() => { document.body.innerHTML = ""; localStorage.clear(); vi.restoreAllMocks(); });
describe("ADR-258 portrait HUD and tutorial", () => {
  it("anchors portrait pickup toasts to the measured HUD bottom, without changing landscape anchors", () => {
    const css = source("../src/gather-fx.ts");
    expect(css).toContain("@media (orientation:portrait){#pickup-toasts,#pickup-toasts[data-device=touch]{bottom:auto;top:calc(var(--hud-bottom,140px) + 8px)");
    expect(css).toContain("left:12px;bottom:96px"); expect(css).toContain("bottom:auto;top:84px;left:8px");
  });
  it("keeps the portrait player clear even when the HUD and controls surround the centre", () => {
    const view = { w: 390, h: 844 }, card = { w: 245, h: 174 };
    const avoid = [{ x: 4, y: 4, w: 118, h: 160 }, { x: 8, y: 172, w: 120, h: 140 }, { x: 0, y: 630, w: 390, h: 214 }];
    const p = placeCard(view, card, { x: 140, y: 4, w: 240, h: 50 }, avoid);
    const z = playerZone(view);
    expect(p.y + card.h <= z.y || p.y >= z.y + z.h).toBe(true);
    expect(p.x).toBeGreaterThanOrEqual(8); expect(p.y + card.h).toBeLessThanOrEqual(836);
    for (const a of avoid) expect(Math.max(0, Math.min(p.x + card.w, a.x + a.w) - Math.max(p.x, a.x)) * Math.max(0, Math.min(p.y + card.h, a.y + a.h) - Math.max(p.y, a.y))).toBe(0);
  });
  it("renders PNG prompts as images, not literal filenames, and renders keyboard/pad glyph art", () => {
    const i = input(); const el = document.createElement("div");
    el.innerHTML = renderTokens("Use {A:Interact} then {M:inventory}", i, "touch");
    expect(el.querySelectorAll("img").length).toBeGreaterThanOrEqual(2);
    expect(el.textContent).not.toContain(".png"); expect(el.querySelector("img")!.getAttribute("src")).toBeTruthy();
    for (const d of ["gamepad", "keyboardMouse"] as const) {
      el.innerHTML = renderTokens("{A:Interact}", i, d); expect(el.querySelector(".tut-glyph")).not.toBeNull();
    }
  });
});
describe("ADR-258 contextual menus and character access", () => {
  it("removes character/wardrobe/stalls from pause and HUD, but preserves world interaction entry points and K", () => {
    const m = new GameMenus({ root: document.body, onQuit: () => {}, pollGamepads: false });
    try {
      m.pause();
      for (const title of ["Character", "Wardrobe", "Trade stalls"]) expect(m.nav.focusables().some((n) => n.textContent === title)).toBe(false);
      for (const id of ["character", "wardrobe", "trade"]) expect(m.bar?.querySelector(`[data-open="${id}"]`)).toBeNull();
      expect(GAME_MENUS.find((d) => d.id === "trade")!.hotkeys).toEqual([]);
      m.nav.closeAll(); document.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyK", key: "k", bubbles: true }));
      expect(m.nav.top).toBe("character");
      m.open("wardrobe"); expect(m.nav.top).toBe("wardrobe");
      m.openStall(123); expect(m.nav.top).toBe("trade"); expect(m.stallTarget).toBe(123);
      const main = source("../src/main.ts"); expect(main).toContain('t?.panel === "wardrobe"'); expect(main).toContain('t?.panel === "trade"');
    } finally { m.destroy(); }
  });
  it("health stats activate by tap/click, Enter and Space without forwarding gameplay pointer input", () => {
    const open = vi.fn(); const hud = mountHud(() => new World(), () => undefined, {}, open);
    try {
      const el = document.getElementById("hud")!; expect(el.tabIndex).toBe(0); expect(el.getAttribute("role")).toBe("button");
      const pointer = vi.fn(); document.body.addEventListener("pointerdown", pointer, { once: true });
      el.dispatchEvent(new Event("pointerdown", { bubbles: true })); expect(pointer).not.toHaveBeenCalled(); document.body.removeEventListener("pointerdown", pointer);
      el.click(); for (const key of ["Enter", " "]) el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      expect(open).toHaveBeenCalledTimes(3);
    } finally { hud.destroy(); }
  });
  it("gamepad LB + right-stick click opens character without crouching (no menu button required)", () => {
    const i = input(), pad = new GamepadDevice(0); i.addDevice(pad); i.push("Gameplay");
    pad.set("pad.lb", 1); pad.set("pad.rs", 1); i.update();
    expect(i.pressed("ToggleCharacter")).toBe(true); expect(i.down("Crouch")).toBe(false);
    expect(padMenuAction(i)).toBe("character");
    const css = source("../src/gameplay-panels.css"); expect(css).toContain(".gm-modal[data-menu=character]"); expect(css).toContain("[data-role^=sheet-]");
  });
  it("uses distinct wire actions for the hand and attack on every device", () => {
    expect(CLIENT_FRAME_MAPPING.holdBits?.Interact).toBe(Act.Gather);
    expect(CLIENT_FRAME_MAPPING.holdBits?.Primary).toBe(Act.Attack); expect(Act.Attack & Act.Gather).toBe(0);
  });
  it("saved AI-off preference survives settings reload and is passed as a host rule", () => {
    saveSettings({ ...loadSettings(), aiHumans: false });
    expect(loadSettings().aiHumans).toBe(false); expect(newWorldRules().aiHumans).toBe(false);
  });
});
