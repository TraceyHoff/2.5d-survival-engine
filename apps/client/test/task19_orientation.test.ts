// @vitest-environment jsdom
// Task 19: the game was locked to landscape — screen.orientation.lock("landscape")
// on entering fullscreen, plus "orientation": "landscape" in the web manifest —
// so a phone could not be rotated into portrait. The lock is removed: entering
// fullscreen must not request any orientation lock, the installed-app manifest
// must allow any orientation, and the existing resize-driven reflow (renderer,
// camera zoom, keyboard viewport) must keep working across a rotation, including
// the keyboard inset when the keyboard is open in the new orientation. A true
// on-device rotation test is not feasible here (jsdom has no orientation
// sensor); these tests pin the lock removal, the manifest, and the resize wiring.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { enterFullscreen, exitFullscreen } from "../src/fullscreen.js";
import { installKeyboardViewport, type KeyboardViewportSource } from "../src/keyboard-viewport.js";
import { defaultZoom, visibleIso } from "../src/camera-zoom.js";
import { uiRoot } from "../src/ui-root.js";

if (!(globalThis as { matchMedia?: unknown }).matchMedia) {
  (globalThis as { matchMedia?: unknown }).matchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} });
}

type Listener = () => void;
function fakeWin(innerHeight: number, vvHeight: number): KeyboardViewportSource & {
  vv: { height: number; offsetTop: number };
  fire: (t: string) => void;
} {
  const regs = new Map<string, Set<Listener>>();
  const on = (t: string, f: Listener) => { let s = regs.get(t); if (!s) { s = new Set(); regs.set(t, s); } s.add(f); };
  const off = (t: string, f: Listener) => { regs.get(t)?.delete(f); };
  const vv = { height: vvHeight, offsetTop: 0, addEventListener: on, removeEventListener: off };
  return {
    innerHeight,
    visualViewport: vv,
    addEventListener: on,
    removeEventListener: off,
    vv,
    fire: (t: string) => { for (const f of [...(regs.get(t) ?? [])]) f(); },
  };
}

beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = `<div id="game-root"><canvas id="game"></canvas></div>`;
  localStorage.clear();
});

describe("Task 19: no orientation lock", () => {
  it("entering fullscreen requests fullscreen but never locks the orientation", async () => {
    const lock = vi.fn(() => Promise.resolve());
    const unlock = vi.fn();
    Object.defineProperty(screen, "orientation", { value: { lock, unlock }, configurable: true });
    const root = uiRoot();
    const req = vi.fn(() => Promise.resolve());
    (root as unknown as { requestFullscreen: unknown }).requestFullscreen = req;
    enterFullscreen();
    await new Promise((r) => setTimeout(r, 0));
    expect(req).toHaveBeenCalledTimes(1);
    expect(lock).not.toHaveBeenCalled();
    expect(unlock).not.toHaveBeenCalled();
  });

  it("leaving fullscreen still clears any orientation lock as a safeguard", () => {
    const unlock = vi.fn();
    Object.defineProperty(screen, "orientation", { value: { lock: vi.fn(), unlock }, configurable: true });
    exitFullscreen();
    expect(unlock).toHaveBeenCalledTimes(1);
  });

  it("the installed-app manifest allows any orientation", () => {
    const manifest = JSON.parse(readFileSync(resolve(__dirname, "../public/manifest.webmanifest"), "utf8")) as { orientation?: string };
    expect(manifest.orientation).toBe("any");
  });
});

describe("Task 19: portrait stays playable and reflows on rotation", () => {
  it("camera zoom is orientation-symmetric, so portrait shows the same world scale as landscape", () => {
    expect(defaultZoom(390, 844)).toBeCloseTo(defaultZoom(844, 390), 9);
    const portrait = visibleIso(390, 844);
    expect(portrait.h).toBeGreaterThan(portrait.w);
    expect(Number.isFinite(portrait.w) && portrait.w > 0).toBe(true);
  });

  it("the keyboard helper recomputes the inset after rotating with the keyboard open", () => {
    // Portrait, no keyboard: 844px tall, visual viewport fills the window.
    const win = fakeWin(844, 844);
    const overlay = document.createElement("div");
    document.body.append(overlay);
    const uninstall = installKeyboardViewport(overlay, win);
    expect(overlay.style.getPropertyValue("--kb-inset")).toBe("0px");
    // Rotate to landscape with the keyboard already open: the layout viewport
    // is now 390px tall and the visual viewport is 150px tall (240px keyboard).
    (win as { innerHeight: number }).innerHeight = 390;
    win.vv.height = 150;
    win.fire("resize");
    expect(overlay.style.getPropertyValue("--kb-inset")).toBe("240px");
    expect(overlay.style.getPropertyValue("height")).toBe("calc(100% - 240px)");
    // Keyboard closes in the new orientation: the dialog restores fully.
    win.vv.height = 390;
    win.fire("resize");
    expect(overlay.style.getPropertyValue("--kb-inset")).toBe("0px");
    expect(overlay.style.getPropertyValue("height")).toBe("");
    uninstall();
  });
});
