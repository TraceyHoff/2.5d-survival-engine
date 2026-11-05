// @vitest-environment jsdom
// Task 18: on a phone in landscape the character creator's footer ("Enter
// world") sat behind the virtual keyboard and the keyboard area showed as a
// black bar, so the user could not enter a name or enter the game at all.
// Root cause: Chrome Android 108+ defaults to interactive-widget=
// resizes-visual — the keyboard shrinks only the visual viewport, while the
// layout viewport, dvh units, and position:fixed overlays do NOT change, so
// the dvh-sized creator panel stayed full-height behind the keyboard. The
// fix is threefold: (1) the viewport meta gains interactive-widget=
// resizes-content (Chrome Android then shrinks the layout viewport), (2) a
// visualViewport helper shrinks the dialog above the keyboard even where
// the meta does not apply (Safari, element fullscreen), and (3) the focused
// input scrolls into view. A true on-device keyboard test is not feasible
// in this harness (jsdom has no virtual keyboard); these tests pin the
// inset math, the resize wiring, and the creator/sign-editor integration.
import { describe, expect, it, vi } from "vitest";
import { keyboardInset, installKeyboardViewport, type KeyboardViewportSource } from "../src/keyboard-viewport.js";
import { showCharacterCreator } from "../src/character-creator.js";
import { buildSignEditor } from "../src/sign-editor.js";
import { BootUI } from "../src/menu.js";
import type { CosmeticCatalogLike, WearableDef } from "@engine/core";

(globalThis as { matchMedia?: unknown }).matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

type Listener = () => void;
function fakeWin(innerHeight: number, vvHeight: number, vvTop = 0): KeyboardViewportSource & {
  vv: { height: number; offsetTop: number };
  fire: (t: string) => void;
  listenerCount: () => number;
} {
  const regs = new Map<string, Set<Listener>>();
  const on = (t: string, f: Listener) => { let s = regs.get(t); if (!s) { s = new Set(); regs.set(t, s); } s.add(f); };
  const off = (t: string, f: Listener) => { regs.get(t)?.delete(f); };
  const vv = { height: vvHeight, offsetTop: vvTop, addEventListener: on, removeEventListener: off };
  return {
    innerHeight,
    visualViewport: vv,
    addEventListener: on,
    removeEventListener: off,
    vv,
    fire: (t: string) => { for (const f of [...(regs.get(t) ?? [])]) f(); },
    listenerCount: () => [...regs.values()].reduce((n, s) => n + s.size, 0),
  };
}

describe("Task 18: keyboard inset math", () => {
  it("is 0 without a visualViewport", () => {
    expect(keyboardInset({ innerHeight: 800 })).toBe(0);
  });
  it("is 0 when the visual viewport still fills the window", () => {
    expect(keyboardInset(fakeWin(800, 800))).toBe(0);
  });
  it("is the shrink amount when the keyboard opens", () => {
    expect(keyboardInset(fakeWin(800, 500))).toBe(300);
  });
  it("subtracts the visual viewport offset", () => {
    expect(keyboardInset(fakeWin(800, 480, 20))).toBe(300);
  });
  it("never goes negative", () => {
    expect(keyboardInset(fakeWin(800, 900))).toBe(0);
  });
});

describe("Task 18: keyboard viewport wiring", () => {
  it("sets --kb-inset and caps the overlay height while the keyboard is open", () => {
    const win = fakeWin(800, 800);
    const overlay = document.createElement("div");
    document.body.append(overlay);
    const uninstall = installKeyboardViewport(overlay, win);
    expect(overlay.style.getPropertyValue("--kb-inset")).toBe("0px");
    win.vv.height = 500;
    win.fire("resize");
    expect(overlay.style.getPropertyValue("--kb-inset")).toBe("300px");
    expect(overlay.style.getPropertyValue("height")).toBe("calc(100% - 300px)");
    expect(overlay.style.getPropertyValue("box-sizing")).toBe("border-box");
    win.vv.height = 800;
    win.fire("resize");
    expect(overlay.style.getPropertyValue("--kb-inset")).toBe("0px");
    expect(overlay.style.getPropertyValue("height")).toBe("");
    uninstall();
    expect(overlay.style.getPropertyValue("--kb-inset")).toBe("");
    expect(win.listenerCount()).toBe(0);
    overlay.remove();
  });
  it("scrolls the focused control into view only when the inset grows", () => {
    const win = fakeWin(800, 800);
    const overlay = document.createElement("div");
    const inp = document.createElement("input");
    overlay.append(inp);
    document.body.append(overlay);
    inp.focus();
    const scroll = vi.fn();
    (inp as unknown as { scrollIntoView: unknown }).scrollIntoView = scroll;
    installKeyboardViewport(overlay, win);
    win.vv.height = 500;
    win.fire("resize");
    expect(scroll).toHaveBeenCalledWith({ block: "nearest" });
    scroll.mockClear();
    win.vv.height = 800;
    win.fire("resize");
    expect(scroll).not.toHaveBeenCalled();
    overlay.remove();
  });
  it("self-cleans when the overlay is removed from the document", () => {
    const win = fakeWin(800, 800);
    const overlay = document.createElement("div");
    document.body.append(overlay);
    installKeyboardViewport(overlay, win);
    expect(win.listenerCount()).toBeGreaterThan(0);
    overlay.remove();
    win.fire("resize");
    expect(win.listenerCount()).toBe(0);
  });
});

const W = (id: number, key: string, slot: WearableDef["slot"]): WearableDef =>
  ({ id, key, slot, bodies: { male: { sprite: 1, anim: "idle" }, female: { sprite: 1, anim: "idle" } }, hidesSlots: [], hatHair: false, unlockTags: [], layer: 0, z: 0, tintChannels: 1 }) as unknown as WearableDef;
const C = (n: number) => Array.from({ length: n }, (_, i) => ({ index: i, key: `c${i}`, color: 0x102030 * (i + 1) }));
const cat: CosmeticCatalogLike = { wearable: (id) => [W(1, "hair_short", "hair"), W(4, "top_tee", "top"), W(6, "bottom_jeans", "bottom"), W(7, "shoes_boots", "shoes"), W(8, "eyes_round", "eyes")].find((p) => p.id === id), bodySprite: () => ({ sprite: 1, anim: "idle" }), skinTones: C(6), hairColors: C(5), clothingColors: C(8), defaults: { top: 4, bottom: 6, shoes: 7, eyes: 8 } };
const openCreator = () => {
  document.body.innerHTML = "";
  return showCharacterCreator({ root: document.body, catalog: cat, pads: () => [] });
};
const closeCreator = async (p: Promise<unknown>) => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); await p; };

describe("Task 18: creator + sign editor integration", () => {
  it("the creator panel subtracts the keyboard inset from its max-height", async () => {
    const p = openCreator();
    const panel = document.querySelector(".panel")!;
    expect(panel.getAttribute("style") ?? "").toContain("var(--kb-inset,0px)");
    await closeCreator(p);
  });
  it("focusing the name field scrolls it into view inside the panel", async () => {
    const p = openCreator();
    const inp = document.querySelector<HTMLInputElement>("[data-role=creator-name]")!;
    const scroll = vi.fn();
    (inp as unknown as { scrollIntoView: unknown }).scrollIntoView = scroll;
    inp.blur();
    inp.focus();
    expect(scroll).toHaveBeenCalledWith({ block: "nearest" });
    await closeCreator(p);
  });
  it("the sign editor panel also subtracts the keyboard inset", () => {
    document.body.innerHTML = "";
    buildSignEditor({ kindName: "Wooden sign", maxLen: 10, initial: "Camp", keyboard: true, onSave: () => undefined, close: () => undefined });
    const css = document.getElementById("sign-editor-css")?.textContent ?? "";
    expect(css).toContain("var(--kb-inset,0px)");
  });
});

describe("Task 18: main-menu Multiplayer page inputs (the second input)", () => {
  it("the Multiplayer page exposes room-code + server-url inputs in a keyboard-shrunk panel, and choosing uninstalls the helper", async () => {
    vi.useFakeTimers();
    try {
      document.head.innerHTML = "";
      document.body.innerHTML = `<div id="game-root"><canvas id="game"></canvas></div>`;
      localStorage.clear();
      const ui = new BootUI("/");
      expect(document.head.innerHTML).toContain("var(--kb-inset,0px)");
      // Stub the reachability probe: the real one opens a WebSocket, which
      // jsdom's cookie jar rejects for the example domain.
      const choice = ui.menu({ hostedStatic: true, defaultUrl: "wss://example:7777", mp: { probe: () => Promise.resolve(31) } });
      expect(ui.root.style.getPropertyValue("--kb-inset")).toBe("0px");
      const btn = (t: string) => Array.from(ui.root.querySelectorAll("button")).find((b) => b.textContent === t)!;
      btn("Multiplayer").click();
      expect(ui.root.querySelector<HTMLInputElement>("[data-role=room-code]")).not.toBeNull();
      expect(ui.root.querySelector<HTMLInputElement>("[data-role=server-url]")).not.toBeNull();
      btn("Back").click();
      btn("Singleplayer").click();
      await expect(choice).resolves.toEqual({ kind: "singleplayer" });
      // Choosing uninstalled the keyboard helper from the menu root, so the
      // loading screens that reuse this root are untouched.
      expect(ui.root.style.getPropertyValue("--kb-inset")).toBe("");
      ui.hide();
    } finally {
      vi.useRealTimers();
    }
  });
});
