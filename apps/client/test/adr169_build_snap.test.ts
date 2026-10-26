// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import { installPermissions, World } from "@engine/core";
import * as G from "@engine/gameplay";
import { InputSystem, KeyboardMouseDevice, DEFAULT_ACTIONS, DEFAULT_CONTEXTS, DEFAULT_PROFILES } from "@engine/input";
import { BuildMode } from "../src/build-mode.js";
import { renderBuildHud } from "../src/build-hud.js";

describe("ADR-169: Build.ToggleSnap toggles grid snap with a HUD indicator", () => {
  test("G (Building context) fires Build.ToggleSnap", () => {
    const c = { t: 0, now: () => c.t }; const sys = new InputSystem(c, { actions: DEFAULT_ACTIONS, contexts: DEFAULT_CONTEXTS, profiles: DEFAULT_PROFILES });
    const kbm = new KeyboardMouseDevice(); sys.addDevice(kbm); sys.push("Gameplay"); sys.push("Building");
    kbm.press("key.KeyG"); c.t += 50; sys.update(); expect(sys.pressed("Build.ToggleSnap")).toBe(true); expect(sys.pressed("RoadTool")).toBe(false);
  });
  test("toggle flips snap, shows Snap / Free on the chip, and off never assists", () => {
    const w = new World({ seed: 1, maxEntities: 1 << 12 }); G.installGameplay(w, {}); installPermissions(w);
    const me = G.spawnPlayer(w, { x: 0, y: 0, maxWeight: 0, clientId: 1 }); const d = G.gameplayDefs(w);
    const piece = [...d.pieces.values()].find((x) => x.placement === G.Placement.Cell)!;
    const down = new Set<string>();
    const bm = new BuildMode({ input: { pressed: (a) => down.has(a), push: () => {}, pop: () => {} }, device: () => "gamepad",
      ctx: () => ({ world: w, player: me, names: new Map() }), aim: () => ({ x: 1, y: 0, mode: 0 }), send: () => true });
    bm.start({ piece: piece.id, tier: 0, variant: 0, paint: 0 });
    expect(bm.snap).toBe(true); expect(renderBuildHud(bm, "gamepad")).toContain(`data-snap="on"`); expect(renderBuildHud(bm, "gamepad")).toContain("R3");
    down.add("Build.ToggleSnap"); bm.update(); down.clear();
    expect(bm.snap).toBe(false); expect(bm.toast).toBe("Snap off"); expect(bm.preview?.assisted).toBeFalsy();
    const html = renderBuildHud(bm, "touch"); expect(html).toContain(`data-snap="off"`); expect(html).toContain("Free");
    bm.toggleSnap(); expect(bm.snap).toBe(true);
  });
});
