// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { BootUI } from "../src/menu.js";
import { TIPS, TIP_COLOR, TIP_ROTATION_MS } from "../src/tips.js";

beforeEach(() => { document.head.innerHTML = ""; document.body.innerHTML = `<div id="game-root"><canvas id="game"></canvas></div>`; localStorage.clear(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("Task 16: longer, darker loading-screen tips", () => {
  test("rotation interval is 10 s and the tip color is the darker value", () => {
    expect(TIP_ROTATION_MS).toBe(10000);
    expect(TIP_COLOR).toBe("#9C968C");
  });
  test("both loading screens rotate on the 10 s interval, and the stylesheet carries the darker color", () => {
    const ui = new BootUI("/");
    const tip = () => ui.root.querySelector<HTMLElement>("[data-role=tip]")!;
    expect(tip().textContent).toBe(TIPS[0]);
    expect(document.head.innerHTML).toContain("#9C968C");
    expect(document.head.innerHTML).not.toContain("#C9C2B8");
    // First screen: no rotation before the interval, one step at it.
    vi.advanceTimersByTime(9999); expect(tip().textContent).toBe(TIPS[0]);
    vi.advanceTimersByTime(1); expect(tip().textContent).toBe(TIPS[1]);
    // Second screen (post-mode-select showLoading): same rotation, same interval.
    ui.showLoading("Loading world…");
    expect(tip().textContent).toBe(TIPS[1]);
    vi.advanceTimersByTime(9999); expect(tip().textContent).toBe(TIPS[1]);
    vi.advanceTimersByTime(1); expect(tip().textContent).toBe(TIPS[2]);
    ui.hide();
  });
});
