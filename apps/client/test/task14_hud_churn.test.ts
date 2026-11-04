// @vitest-environment jsdom
// Task 14 smoothness: with a static world, the HUD's 250 ms update must not touch the DOM when nothing
// changed. A MutationObserver over #hud after the first tick proves it: before the fix, every tick rewrote
// texts and bar widths (style recalc + paint scheduling for zero visual change).
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { Weather, World } from "@engine/core";
import * as G from "@engine/gameplay";
import { mountHud } from "../src/hud.js";

let h: { destroy(): void } | undefined;
beforeEach(() => { document.head.innerHTML = ""; document.body.innerHTML = `<div id="game-root"></div>`; localStorage.clear(); });
afterEach(() => { h?.destroy(); h = undefined; });
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("Task 14: HUD update churn", () => {
  test("a steady-state HUD tick writes nothing to the DOM", async () => {
    const w = new World({ seed: 1, maxEntities: 1 << 12 }); G.installGameplay(w, {});
    h = mountHud(() => w, () => undefined, { hours: 14, season: 0, weather: 0, unit: "C" });
    await sleep(300); // first interval tick settles every field
    const root = document.querySelector("#hud")!;
    const seen: MutationRecord[] = [];
    const ob = new MutationObserver((rs) => seen.push(...rs));
    ob.observe(root, { childList: true, attributes: true, characterData: true, subtree: true });
    await sleep(600); // two more ticks with nothing changed
    ob.disconnect();
    expect(seen).toEqual([]);
  }, 10000);
  test("changed values still reach the DOM (the cache is not a freeze)", async () => {
    const w = new World({ seed: 1, maxEntities: 1 << 12 }); G.installGameplay(w, {});
    h = mountHud(() => w, () => undefined, { hours: 14, season: 0, unit: "C" });
    const weather = document.querySelector("#hud [data-hud=weather]")!;
    expect(weather.textContent).toBe("Clear");
    w.env(Weather).kind = 1; // Rain
    await sleep(300);
    expect(weather.textContent).toBe("Rain");
  }, 10000);
});
