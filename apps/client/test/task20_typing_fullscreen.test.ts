// @vitest-environment jsdom
// Task 20: two phone-keyboard layers that turned out to be one problem.
// (1) The creator Name row felt picky: only a tap squarely on the input (or the "Name" glyphs)
// focused it, so on a phone the keyboard seemed to open only from one odd spot. The label cell is
// now the full 44px row height and taps in the row's dead zones (grid gap, empty grid area) are
// retargeted to the input.
// (2) The black bar persisted: on Chrome Android the IME surface can stay black while the game is
// in element fullscreen, and repeated taps only eventually force it to composite. Text fields now
// leave fullscreen on tap (fullscreen.ts exitFullscreenForTyping), which removes the failing
// condition; the existing next-tap restore re-enters fullscreen once typing ends, and never fires
// while a text field is focused (it would otherwise undo the exit on the focusing tap itself).
// A true on-device keyboard test is not feasible here (jsdom has no virtual keyboard); these tests
// pin the tap/focus paths and the fullscreen exit/restore state machine the keyboard depends on.
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { CosmeticCatalogLike, WearableDef } from "@engine/core";
import { showCharacterCreator } from "../src/character-creator.js";
import { bindTypingFullscreenExit, enterFullscreen, exitFullscreenForTyping, installFullscreenRestore } from "../src/fullscreen.js";
import { uiRoot } from "../src/ui-root.js";

const W = (id: number, key: string, slot: WearableDef["slot"]): WearableDef =>
  ({ id, key, slot, bodies: { male: { sprite: 1, anim: "idle" }, female: { sprite: 1, anim: "idle" } }, hidesSlots: [], hatHair: false, unlockTags: [], layer: 0, z: 0, tintChannels: 1 }) as unknown as WearableDef;
const C = (n: number) => Array.from({ length: n }, (_, i) => ({ index: i, key: `c${i}`, color: 0x102030 * (i + 1) }));
const cat: CosmeticCatalogLike = { wearable: (id) => [W(1, "hair_short", "hair"), W(4, "top_tee", "top"), W(6, "bottom_jeans", "bottom"), W(7, "shoes_boots", "shoes"), W(8, "eyes_round", "eyes")].find((p) => p.id === id), bodySprite: () => ({ sprite: 1, anim: "idle" }), skinTones: C(6), hairColors: C(5), clothingColors: C(8), defaults: { top: 4, bottom: 6, shoes: 7, eyes: 8 } };

const open = () => {
  document.body.innerHTML = "";
  return showCharacterCreator({ root: document.body, catalog: cat, pads: () => [] });
};
const close = async (p: Promise<unknown>) => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); await p; };
const nameRow = () => {
  const inp = document.querySelector<HTMLInputElement>("[data-role=creator-name]")!;
  const label = Array.from(document.querySelectorAll("label")).find((l) => l.textContent === "Name")!;
  return { inp, label, right: inp.parentElement! };
};

describe("Task 20: creator Name row tap targets", () => {
  it("the Name label fills the 44px row height (whole label column is tappable)", async () => {
    const p = open();
    const { label } = nameRow();
    expect(label.style.minHeight).toBe("44px");
    expect(label.style.display).toBe("flex");
    await close(p);
  });
  it("a tap in the Name row's dead zone focuses the input; outside the row band it does not", async () => {
    const p = open();
    const { inp, right } = nameRow();
    (inp as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = () =>
      ({ top: 100, bottom: 144, left: 0, right: 300, width: 300, height: 44, x: 0, y: 100, toJSON: () => ({}) }) as DOMRect;
    inp.blur();
    expect(document.activeElement).not.toBe(inp);
    right.dispatchEvent(new MouseEvent("click", { bubbles: true, clientY: 120 })); // the grid gap in the row
    expect(document.activeElement).toBe(inp);
    inp.blur();
    right.dispatchEvent(new MouseEvent("click", { bubbles: true, clientY: 500 })); // another row's band
    expect(document.activeElement).not.toBe(inp);
    await close(p);
  });
  it("the required-name gate still blocks an empty name", async () => {
    const p = open();
    const { inp } = nameRow();
    inp.value = "";
    inp.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector<HTMLButtonElement>("button[data-action=creator-done]")!.click();
    expect(document.querySelector("[data-role=creator-msg]")!.textContent).toContain("Pick a name");
    await close(p);
  });
});

describe("Task 20: typing leaves fullscreen, restore waits until typing ends", () => {
  const exitSpy = vi.fn(() => Promise.resolve());
  let reqSpy: ReturnType<typeof vi.fn>;
  let root: HTMLElement;
  const setFs = (el: Element | null): void => {
    Object.defineProperty(document, "fullscreenElement", { value: el, configurable: true });
  };
  const setTouch = (n: number): void => {
    Object.defineProperty(navigator, "maxTouchPoints", { value: n, configurable: true });
  };
  beforeAll(() => {
    // This jsdom has no matchMedia; standalone() (fullscreen.ts) calls it bare.
    Object.defineProperty(window, "matchMedia", { value: vi.fn(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })), configurable: true });
    document.body.innerHTML = "";
    root = uiRoot();
    reqSpy = vi.fn(() => Promise.resolve());
    (root as unknown as { requestFullscreen: unknown }).requestFullscreen = reqSpy;
    Object.defineProperty(document, "exitFullscreen", { value: exitSpy, configurable: true, writable: true });
    setTouch(1);
    setFs(null);
    installFullscreenRestore();
  });
  it("typing exit does not clear playing, and restore is suppressed while typing", () => {
    enterFullscreen(); // playing = true; fullscreen requested
    expect(reqSpy).toHaveBeenCalledTimes(1);
    setFs(root); // now actually fullscreen
    exitFullscreenForTyping();
    expect(exitSpy).toHaveBeenCalledTimes(1);
    setFs(null); // the exit landed
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    window.dispatchEvent(new Event("pointerup"));
    expect(reqSpy).toHaveBeenCalledTimes(1); // suppressed: a text field is focused
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "a" }));
    expect(reqSpy).toHaveBeenCalledTimes(1); // suppressed mid-typing, not just on pointerup
    input.blur();
    window.dispatchEvent(new Event("pointerup"));
    expect(reqSpy).toHaveBeenCalledTimes(2); // typing ended: fullscreen restored on the next tap
    input.remove();
  });
  it("bindTypingFullscreenExit exits on tap, and exit is a no-op off touch / when windowed", () => {
    const input = document.createElement("input");
    document.body.append(input);
    bindTypingFullscreenExit(input);
    setFs(root);
    input.dispatchEvent(new Event("pointerdown"));
    expect(exitSpy).toHaveBeenCalledTimes(2);
    setTouch(0); // a device with no touch never leaves fullscreen for typing
    exitFullscreenForTyping();
    expect(exitSpy).toHaveBeenCalledTimes(2);
    setTouch(1);
    setFs(null); // windowed already: nothing to exit
    exitFullscreenForTyping();
    expect(exitSpy).toHaveBeenCalledTimes(2);
    input.remove();
  });
});
