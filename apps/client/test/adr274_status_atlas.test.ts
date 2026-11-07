// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { World } from "@engine/core";
import * as G from "@engine/gameplay";
const atlas = vi.hoisted(() => ({ url: vi.fn((key: string) => key === "broken_leg" ? "data:image/png;base64,aW5qdXJ5" : undefined), frame: () => undefined }));
vi.mock("../src/ui-atlas.js", () => ({ uiSprites: async () => atlas }));
import { conditionIconImg } from "../src/game-icons.js";
import { mountHud } from "../src/hud.js";

afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ""; });
describe("ADR-274 atlas-backed condition icons", () => {
  it("resolves the stable status key through ui.url without an embedded-image or category fallback", async () => {
    const img = conditionIconImg("broken_leg", 14, "Broken Leg"); await Promise.resolve();
    expect(atlas.url).toHaveBeenCalledWith("broken_leg"); expect(img.src).toBe("data:image/png;base64,aW5qdXJ5");
    expect(img.dataset["uiIcon"]).toBe("broken_leg"); expect(img.style.width).toBe("14px");
  });
  it("shows the dedicated status icon on the actual HUD and removes the chip after splint treatment", async () => {
    vi.useFakeTimers(); document.body.innerHTML = '<div id="game-root"></div>';
    const w = new World({ seed: 1, maxEntities: 4096 }); G.installGameplay(w, {});
    const p = G.spawnPlayer(w, { x: 0, y: 0 }); G.contractDisease(w, p, "broken_leg");
    const hud = mountHud(() => w, () => p); await Promise.resolve(); await Promise.resolve();
    const chip = document.querySelector('[data-disease="broken_leg"]');
    expect(chip?.textContent).toContain("Broken Leg"); expect(chip?.querySelector("img")?.src).toBe("data:image/png;base64,aW5qdXJ5");
    G.addItem(w, p, G.gameplayDefs(w).itemId("leg_splint"), 1);
    G.setIntent(w, p, { action: G.IntentAction.Use, slot: 0 }); G.consumeSystem(w); vi.advanceTimersByTime(250);
    expect(document.querySelector('[data-disease="broken_leg"]')).toBeNull(); hud.destroy();
  });
});
