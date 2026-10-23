import { describe, it, expect } from "vitest";
import * as G from "../src/index.js";
import { makeWorld } from "./helpers.js";

const frame = (o: Partial<import("@engine/core").InputFrame> = {}) => ({ tick: 0, actions: 0, aimX: 0, aimY: 0, commands: [], ...o });
describe("input hooks (slice 7)", () => {
  it("bit orders mirror @engine/input defaults", () => {
    expect(G.GameplayHoldBits.Build).toBe(G.GameplayActions.Build);
    expect(G.GameplayHoldBits.Crouch).toBe(1 << 9); expect(G.GameplayHoldBits.Charge).toBe(1 << 10);
    expect(G.GameplayEdgeBits.Hotbar1).toBe(1 << 2); expect(G.extendGameplayActions(["Emote"]).Emote).toBe(1 << 11);
  });
  it("analog move, hotbar edges and custom hooks", () => {
    const w = makeWorld(); const reg = G.registerGameplayCommands(); const p = G.spawnPlayer(w, { x: 0, y: 0 });
    G.applyGameplayInput(w, p, frame({ moveX: 0.1, moveY: 0 }), reg); expect(w.getField(p, G.PlayerIntent, "moving")).toBe(0);
    G.applyGameplayInput(w, p, frame({ moveX: 0.6, moveY: 0.2 }), reg); expect(w.getField(p, G.PlayerIntent, "moving")).toBe(1);
    const seen: number[] = []; G.addInputHook(w, { name: "t", onFrame: (_w, _e, f) => seen.push(f.edges ?? 0) });
    G.applyGameplayInput(w, p, frame({ edges: G.GameplayEdgeBits.Hotbar3 }), reg);
    expect(w.getResource(G.CommandQueues)!.get(p)![0]).toEqual({ action: G.IntentAction.Equip, values: { slot: 2 } });
    expect(seen).toEqual([G.GameplayEdgeBits.Hotbar3]);
    expect(() => G.addInputHook(w, { name: "t", onFrame: () => {} })).toThrow();
  });
  it("touch helpers: context command, pick, radius, ghost offset", () => {
    const w = makeWorld(); const p = G.spawnPlayer(w, { x: 0, y: 0 });
    const n = G.spawnResourceNode(w, "fallen_branches", 2, 0);
    const defs = { open: G.OpenContainerCmd, gather: G.GatherCmd, door: G.ToggleDoorCmd, fire: G.ToggleFireCmd, attack: G.AttackCmd };
    expect(G.contextCommandFor(w, p, n, defs)?.def).toBe(G.GatherCmd);
    expect(G.contextCommandFor(w, p, p, defs)).toBeUndefined();
    expect(G.pickContextTarget(w, 1.8, 0, 1, (e) => G.contextCommandFor(w, p, e, defs) !== undefined)).toBe(n);
    expect(G.touchPickRadiusTiles(2, 32)).toBeCloseTo(1.5);
    expect(G.touchGhostPoint(5, 5)).toEqual({ x: 5, y: 3.5 });
  });
});
