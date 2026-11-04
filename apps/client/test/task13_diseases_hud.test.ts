// @vitest-environment jsdom
// Task 13: HUD disease chips — one small chip per active disease on the local player,
// disappearing when the disease is cured.
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { World } from "@engine/core";
import * as G from "@engine/gameplay";
import { mountHud } from "../src/hud.js";

const world = (): World => { const w = new World({ seed: 1, maxEntities: 1 << 12 }); G.installGameplay(w, {}); return w; };
let h: { destroy(): void } | undefined;
beforeEach(() => { document.head.innerHTML = ""; document.body.innerHTML = `<div id="game-root"></div>`; localStorage.clear(); });
afterEach(() => { h?.destroy(); h = undefined; });

describe("Task 13: HUD disease chips", () => {
  test("a chip per active disease appears, and disappears on cure", () => {
    const w = world(); const p = G.spawnPlayer(w, { x: 0, y: 0, clientId: 1 });
    h = mountHud(() => w, () => p, {});
    expect(document.querySelector("#hud [data-role=disease-chips]")).not.toBeNull();
    expect(document.querySelectorAll("#hud .dchip").length).toBe(0);
    expect(G.contractDisease(w, p, "common_cold")).toBe(true);
    h.destroy(); h = mountHud(() => w, () => p, {}); // mount calls update() synchronously
    const chips = Array.from(document.querySelectorAll<HTMLElement>("#hud .dchip"));
    expect(chips.map((c) => c.dataset["disease"])).toEqual(["common_cold"]);
    expect(chips[0]!.textContent).toBe("Cold");
    expect(chips[0]!.title).toBe("Common Cold");
    expect(G.cureDisease(w, p, "common_cold")).toBe(true);
    h.destroy(); h = mountHud(() => w, () => p, {});
    expect(document.querySelectorAll("#hud .dchip").length).toBe(0);
  });

  test("multiple diseases render multiple chips", () => {
    const w = world(); const p = G.spawnPlayer(w, { x: 0, y: 0, clientId: 1 });
    G.contractDisease(w, p, "dysentery"); G.contractDisease(w, p, "heatstroke");
    h = mountHud(() => w, () => p, {});
    expect(Array.from(document.querySelectorAll<HTMLElement>("#hud .dchip")).map((c) => c.dataset["disease"]).sort())
      .toEqual(["dysentery", "heatstroke"]);
  });
});
