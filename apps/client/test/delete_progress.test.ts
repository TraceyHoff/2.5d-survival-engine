// @vitest-environment jsdom
// fake-indexeddb is a dev dependency of @engine/persist (same import as agents_persist.test.ts).
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { GameMenus } from "../src/game-menus.js";
import { uiRoot } from "../src/ui-root.js";
import { deleteConfirm, HOLD_MS } from "../src/delete-progress.js";

const key = (k: string, type = "keydown"): void => { (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent(type, { key: k, code: k === " " ? "Space" : k, bubbles: true, cancelable: true })); };
const q = <T extends HTMLElement>(s: string): T => document.querySelector<T>(s)!;

beforeEach(() => { document.body.innerHTML = `<div id="game-root"><canvas id="game"></canvas></div>`; localStorage.clear(); (globalThis as { matchMedia?: unknown }).matchMedia = () => ({ matches: false }); });

describe("confirm flow (keyboard / gamepad / touch)", () => {
  let menus: GameMenus | undefined;
  afterEach(() => menus?.destroy());
  test("Settings → Delete save is reachable with UINav; typed DELETE + Enter confirms; wrong word doesn't", async () => {
    const run = vi.fn(async () => "deleted");
    menus = new GameMenus({ root: uiRoot(), onQuit: () => {}, pollGamepads: false, deleteProgress: () => ({ label: "Delete save", message: "m", settingsOption: true, run }) });
    menus.open("settings");
    const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Delete save")!; expect(btn).toBeDefined();
    btn.focus(); key("Enter"); expect(menus.nav.top).toBe("delete-progress");
    const word = q<HTMLInputElement>("[data-role=confirm-word]"); expect(menus.nav.focusables()).toContain(word);
    word.focus(); word.value = "nope"; key("Enter"); await Promise.resolve(); expect(run).not.toHaveBeenCalled();
    word.value = "delete"; word.dispatchEvent(new Event("input")); key("Enter"); await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(run).toHaveBeenCalledWith({ resetSettings: false });
    await vi.waitFor(() => expect(q("[data-role=delete-status]").textContent).toBe("deleted"));
  });
  test("Cancel closes; hold button: a tap never deletes, holding Enter/Space, pointer or gamepad A for HOLD_MS does", async () => {
    let t = 0; const pads = [{ buttons: [{ pressed: false }], axes: [] as number[] }];
    const mk = () => { const onConfirm = vi.fn(async (_o: { resetSettings: boolean }) => "ok"); const onCancel = vi.fn();
      const c = deleteConfirm({ message: "m", settingsOption: true, onConfirm, onCancel, now: () => t, getGamepads: () => pads as never, manualTick: true });
      document.body.append(c.el); return { c, onConfirm, onCancel, hold: c.el.querySelector<HTMLButtonElement>("[data-action=hold-delete]")! }; };
    const a = mk(); a.c.el.querySelector<HTMLButtonElement>("[data-action=cancel-delete]")!.click(); expect(a.onCancel).toHaveBeenCalled();
    a.hold.click(); a.c.tick(); expect(a.onConfirm).not.toHaveBeenCalled();
    // keyboard hold (UINav lets data-hold buttons own Enter/Space)
    a.hold.focus(); key(" "); a.c.tick(); t += HOLD_MS / 2; a.c.tick(); key(" ", "keyup"); a.c.tick(); t += HOLD_MS; a.c.tick();
    expect(a.onConfirm).not.toHaveBeenCalled(); // released early
    key("Enter"); a.c.tick(); t += HOLD_MS + 1; a.c.tick(); await Promise.resolve();
    expect(a.onConfirm).toHaveBeenCalledTimes(1);
    // gamepad A held while focused
    const b = mk(); b.hold.focus(); pads[0]!.buttons[0]!.pressed = true; b.c.tick(); t += HOLD_MS + 1; b.c.tick(); await Promise.resolve();
    expect(b.onConfirm).toHaveBeenCalledTimes(1); pads[0]!.buttons[0]!.pressed = false;
    // touch / pointer hold, with the settings opt-in
    const c = mk(); c.c.el.querySelector<HTMLInputElement>("[data-role=reset-settings]")!.checked = true;
    c.hold.dispatchEvent(new Event("pointerdown")); c.c.tick(); t += HOLD_MS + 1; c.c.tick(); await Promise.resolve();
    expect(c.onConfirm).toHaveBeenCalledWith({ resetSettings: true });
  });
});
