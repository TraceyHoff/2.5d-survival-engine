// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { uiRoot, mountUi, ROOT_ID } from "../src/ui-root.js";
import { enterFullscreen, fullscreenTarget } from "../src/fullscreen.js";
import { padMenuAction, GameMenus } from "../src/game-menus.js";
import { mountP2POverlay } from "../src/p2p-overlay.js";
import { mountTouchOverlay } from "../src/touch-overlay.js";
import { PAD } from "../src/ui-nav.js";

type Pad = { buttons: { pressed: boolean }[]; axes: number[] };
const pad = (): Pad => ({ buttons: Array.from({ length: 17 }, () => ({ pressed: false })), axes: [0, 0, 0, 0] });
const key = (k: string, code = k, extra: KeyboardEventInit = {}): void => { (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key: k, code, bubbles: true, cancelable: true, ...extra })); };
const active = (): string => (document.activeElement as HTMLElement | null)?.textContent ?? "";

beforeEach(() => {
  document.head.innerHTML = ""; document.body.innerHTML = `<div id="game-root"><canvas id="game"></canvas></div>`;
  localStorage.clear();
  (globalThis as { matchMedia?: unknown }).matchMedia = () => ({ matches: false });
});

describe("fullscreen target", () => {
  test("is the UI root holding the canvas, HUD/overlays, touch controls and modals", () => {
    const root = uiRoot(); const req = vi.fn(() => Promise.resolve());
    (root as unknown as { requestFullscreen: unknown }).requestFullscreen = req;
    const canvasReq = vi.fn(); (document.getElementById("game") as unknown as { requestFullscreen: unknown }).requestFullscreen = canvasReq;
    expect(fullscreenTarget()).toBe(root); expect(root.id).toBe(ROOT_ID);
    enterFullscreen();
    expect(req).toHaveBeenCalledTimes(1); expect(canvasReq).not.toHaveBeenCalled();
    const p2p = mountP2POverlay({ mode: "host", code: "ABC-234", status: () => "ok", onLeave: () => {} });
    const touch = mountTouchOverlay(root, () => [{ id: "move", kind: "joystick", x: 50, y: 50, r: 40, pressed: false, visible: true }]); touch.draw();
    const menus = new GameMenus({ root, onQuit: () => {}, pollGamepads: false }); menus.pause();
    const hud = mountUi(Object.assign(document.createElement("div"), { id: "hud" }));
    for (const el of [document.getElementById("game"), p2p.root, document.getElementById("touch-overlay"), document.getElementById("game-menubar"), document.querySelector("[data-modal=pause]"), hud])
      expect(root.contains(el)).toBe(true);
    menus.destroy(); touch.destroy(); p2p.destroy();
  });
  test("uiRoot wraps a bare canvas", () => {
    document.body.innerHTML = `<canvas id="game"></canvas>`;
    const root = uiRoot(); expect(root.contains(document.getElementById("game"))).toBe(true); expect(document.body.contains(root)).toBe(true);
  });
});

describe("focus navigation", () => {
  let pads: Pad[]; let menus: GameMenus; let ctx: string[]; let quit: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    pads = [pad()]; ctx = []; quit = vi.fn();
    menus = new GameMenus({ root: uiRoot(), onQuit: quit as () => void, pollGamepads: false, getGamepads: () => pads,
      input: { push: (n) => ctx.push(n), pop: (n) => { ctx.splice(ctx.lastIndexOf(n ?? ctx.at(-1)!), 1); } } });
  });
  afterEach(() => menus.destroy());
  const poll = (set: (p: Pad) => void): void => { const p = pad(); set(p); pads[0] = p; menus.nav.pollGamepad(); pads[0] = pad(); menus.nav.pollGamepad(); };

  test("keyboard: Esc opens pause, arrows/Tab move (wrapping), Enter activates, Esc closes", () => {
    key("Escape"); expect(menus.nav.top).toBe("pause"); expect(ctx).toEqual(["Dialog"]);
    const f = menus.nav.focusables(); expect(document.activeElement).toBe(f[0]); // close ✕
    key("ArrowDown"); expect(active()).toBe("Resume");
    key("Tab", "Tab", { shiftKey: true }); key("Tab", "Tab", { shiftKey: true }); expect(document.activeElement).toBe(f.at(-1));
    key("Tab"); expect(document.activeElement).toBe(f[0]);
    key("ArrowDown"); key("ArrowDown"); expect(active()).toContain("Inventory");
    key("Enter"); expect(menus.nav.top).toBe("inventory");
    key("Escape"); expect(menus.nav.top).toBe("pause"); key("Escape"); expect(menus.nav.isOpen).toBe(false); expect(ctx).toEqual([]);
  });
  test("keyboard hotkeys toggle menus; typing in chat doesn't trigger them", () => {
    key("i", "KeyI"); expect(menus.nav.top).toBe("inventory"); key("i", "KeyI"); expect(menus.nav.isOpen).toBe(false);
    key("Enter"); expect(menus.nav.top).toBe("chat");
    const input = document.querySelector<HTMLInputElement>("[data-role=chat-input]")!; expect(document.activeElement).toBe(input);
    input.value = "hi"; key("c", "KeyC"); expect(menus.nav.top).toBe("chat");
    key("Enter"); expect(document.querySelector("[data-role=chat-log]")!.textContent).toContain("hi");
  });
  test("ADR-139 gamepad: Select no longer pauses (it is the inventory action); Select closes an open inventory", () => {
    poll((p) => { p.buttons[PAD.SELECT]!.pressed = true; }); expect(menus.nav.isOpen).toBe(false);
    menus.open("inventory"); poll((p) => { p.buttons[PAD.SELECT]!.pressed = true; }); expect(menus.nav.isOpen).toBe(false);
    const act = (on: string[]) => padMenuAction({ pressed: (a) => on.includes(a) });
    expect(act(["ToggleInventory"])).toBe("inventory"); expect(act(["ToggleCrafting", "ToggleInventory"])).toBe("crafting");
    expect(act(["OpenChat"])).toBe("chat"); expect(act([])).toBeUndefined();
  });
  test("ADR-139 gamepad: Start pressed in the character creator does not pause the game it enters", () => {
    const boot = document.createElement("div"); boot.dataset["boot"] = "creator"; document.body.append(boot);
    pads[0] = pad(); menus.nav.pollGamepad(); boot.remove();
    const held = pad(); held.buttons[PAD.START]!.pressed = true; pads[0] = held; menus.nav.pollGamepad(); expect(menus.nav.isOpen).toBe(false);
    pads[0] = pad(); menus.nav.pollGamepad(); poll((p) => { p.buttons[PAD.START]!.pressed = true; }); expect(menus.nav.top).toBe("pause");
  });
  test("ADR-139 gamepad: menus created while Start is still held (entering the world) ignore it until released", () => {
    menus.destroy(); const held = pad(); held.buttons[PAD.START]!.pressed = true; pads[0] = held;
    menus = new GameMenus({ root: uiRoot(), onQuit: () => {}, pollGamepads: false, getGamepads: () => pads });
    menus.nav.pollGamepad(); menus.nav.pollGamepad(); expect(menus.nav.isOpen).toBe(false);
    pads[0] = pad(); menus.nav.pollGamepad(); poll((p) => { p.buttons[PAD.START]!.pressed = true; }); expect(menus.nav.top).toBe("pause");
  });
  test("gamepad: Start pauses, D-pad/stick move, A confirms, B backs out, Start resumes", () => {
    poll((p) => { p.buttons[PAD.START]!.pressed = true; }); expect(menus.nav.top).toBe("pause");
    poll((p) => { p.buttons[PAD.DOWN]!.pressed = true; }); expect(active()).toBe("Resume");
    poll((p) => { p.axes[1] = 0.9; }); expect(active()).toContain("Inventory");
    poll((p) => { p.buttons[PAD.A]!.pressed = true; }); expect(menus.nav.top).toBe("inventory");
    poll((p) => { p.buttons[PAD.B]!.pressed = true; }); expect(menus.nav.top).toBe("pause");
    poll((p) => { p.buttons[PAD.START]!.pressed = true; }); expect(menus.nav.isOpen).toBe(false);
    poll((p) => { p.buttons[PAD.SELECT]!.pressed = true; }); expect(menus.nav.isOpen).toBe(false); // ADR-139: Select = inventory (gameplay action), not pause
  });
  test("touch: menu bar opens each menu; every pause entry is reachable; Quit to main menu", () => {
    const bar = document.getElementById("game-menubar")!;
    for (const b of Array.from(bar.querySelectorAll<HTMLButtonElement>("button"))) { if (b.dataset["open"] === "more") continue; b.click(); expect(menus.nav.top).toBe(b.dataset["open"]); menus.nav.closeAll(); }
    // ADR-133: secondary menus fold behind "More" on phones; More toggles them and opening a menu folds them again
    const more = bar.querySelector<HTMLButtonElement>('[data-open="more"]')!; expect(bar.firstElementChild).toBe(more);
    expect(bar.querySelector('[data-open="inventory"]')!.classList.contains("gm-secondary")).toBe(false); expect(bar.querySelector('[data-open="skills"]')!.classList.contains("gm-secondary")).toBe(true);
    more.click(); expect(bar.dataset["expanded"]).toBe("true"); expect(more.getAttribute("aria-expanded")).toBe("true");
    bar.querySelector<HTMLButtonElement>('[data-open="skills"]')!.click(); expect(bar.dataset["expanded"]).toBe("false"); menus.nav.closeAll();
    menus.pause(); const labels = menus.nav.focusables().map((e) => e.textContent ?? "");
    for (const m of ["Inventory", "Crafting", "Build", "Character", "Party", "Clan", "Trade stalls", "Chat", "Settings", "Quit to main menu"]) expect(labels.some((l) => l.includes(m))).toBe(true);
    Array.from(document.querySelectorAll<HTMLButtonElement>("[data-modal=pause] button")).find((b) => b.textContent === "Quit to main menu")!.click();
    expect(quit).toHaveBeenCalledTimes(1); expect(menus.nav.isOpen).toBe(false); expect(ctx).toEqual([]);
  });
});
