// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import { installPermissions, World } from "@engine/core";
import * as G from "@engine/gameplay";
import { InputSystem, KeyboardMouseDevice, GamepadDevice, DEFAULT_ACTIONS, DEFAULT_CONTEXTS, DEFAULT_PROFILES } from "@engine/input";
import { BuildMode } from "../src/build-mode.js";
import { renderBuildHud, mountBuildHud } from "../src/build-hud.js";

const mk = () => { let now = 0; const clock = { now: () => now };
  const sys = new InputSystem(clock as never, { actions: DEFAULT_ACTIONS, contexts: DEFAULT_CONTEXTS, profiles: DEFAULT_PROFILES });
  const kbm = new KeyboardMouseDevice(); const pad = new GamepadDevice(0); sys.addDevice(kbm); sys.addDevice(pad); sys.push("Gameplay"); sys.push("Building");
  return { sys, kbm, pad, tick: () => { now += 50; sys.update(); } }; };

describe("ADR-171: road + sign tools from build mode on every input", () => {
  test("KBM T / N and pad LT+X / LT+Y fire Build.RoadTool / Build.PlaceSign without repair/upgrade", () => {
    const { sys, kbm, pad, tick } = mk();
    kbm.press("key.KeyT"); tick(); expect(sys.pressed("Build.RoadTool")).toBe(true); kbm.releaseAll(); tick();
    kbm.press("key.KeyN"); tick(); expect(sys.pressed("Build.PlaceSign")).toBe(true); kbm.releaseAll(); tick();
    pad.set("pad.lt", 1); tick(); pad.set("pad.x", 1); tick(); expect(sys.pressed("Build.RoadTool")).toBe(true);
    pad.set("pad.x", 0); tick(); expect(sys.pressed("Build.RepairMode")).toBe(false);
    pad.set("pad.y", 1); tick(); expect(sys.pressed("Build.PlaceSign")).toBe(true); pad.set("pad.y", 0); tick(); expect(sys.pressed("Build.UpgradeMode")).toBe(false);
  });
  test("action / HUD button stops build mode then opens the tool", () => {
    const w = new World({ seed: 1, maxEntities: 1 << 12 }); G.installGameplay(w, {}); installPermissions(w);
    const me = G.spawnPlayer(w, { x: 0, y: 0, maxWeight: 0, clientId: 1 }); const d = G.gameplayDefs(w);
    const piece = [...d.pieces.values()].find((x) => x.placement === G.Placement.Cell)!;
    const down = new Set<string>(); const calls: string[] = [];
    const bm = new BuildMode({ input: { pressed: (a) => down.has(a), push: () => {}, pop: () => {} }, device: () => "touch",
      ctx: () => ({ world: w, player: me, names: new Map() }), aim: () => ({ x: 1, y: 0, mode: 0 }), send: () => true,
      tools: { road: () => calls.push("road"), sign: () => calls.push("sign") } });
    const start = () => bm.start({ piece: piece.id, tier: 0, variant: 0, paint: 0 });
    start(); expect(renderBuildHud(bm, "touch")).toContain(`data-bh="road"`); expect(renderBuildHud(bm, "gamepad")).toContain("LT+Y");
    down.add("Build.RoadTool"); bm.update(); down.clear(); expect(bm.active).toBe(false); expect(calls).toEqual(["road"]);
    start(); const host = document.createElement("div"); document.body.append(host);
    const hud = mountBuildHud(host, { buildMode: bm, device: () => "touch" } as never); hud.update();
    const btn = document.querySelector<HTMLButtonElement>(`[data-bh="sign"]`); expect(btn).toBeTruthy(); btn!.click();
    expect(bm.active).toBe(false); expect(calls).toEqual(["road", "sign"]);
  });
});
