import { describe, expect, it } from "vitest";
import { CameraTargetGuard, formatSceneDiag, validTarget } from "../src/sceneDiag.js";
import { worldToScreen, DEFAULT_ISO } from "@engine/world";

describe("scene diagnostics", () => {
  it("formats entity/player/camera/local-server fields", () => {
    const s = formatSceneDiag({ entities: 0, cameraTarget: { x: 16, y: 16, z: 1, kind: "fallback" }, localServer: "opening-store", snapshots: 0, lastError: "IndexedDB open blocked" });
    expect(s).toContain("entities=0"); expect(s).toContain("player=none"); expect(s).toContain("camTarget=fallback@16.0,16.0,1.0");
    expect(s).toContain("localServer=opening-store"); expect(s).toContain("snapshots=0"); expect(s).toContain("IndexedDB open blocked");
    expect(formatSceneDiag(undefined)).toContain("no client scene info");
  });
  it("rejects NaN / huge targets", () => {
    expect(validTarget({ x: 1, y: 2, z: 0 })).toBe(true); expect(validTarget({ x: NaN, y: 2 })).toBe(false); expect(validTarget({ x: 1, y: Infinity })).toBe(false);
    expect(validTarget({ x: 1e9, y: 0 })).toBe(false); expect(validTarget(undefined)).toBe(false);
  });
  it("cam 0,496 at zoom 1.6 is the iso position of tile 16,16,z1 (the no-player default), not a NaN", () => {
    const s = worldToScreen(16, 16, 1, DEFAULT_ISO); expect(s.sx).toBe(0); expect(s.sy).toBe(496);
  });
});

describe("CameraTargetGuard", () => {
  it("follows a valid target and holds the last one during a short gap", () => {
    const g = new CameraTargetGuard({ x: 19, y: 8, z: 0 }, 3);
    expect(g.resolve({ x: 5, y: 6, z: 0 })).toEqual({ x: 5, y: 6, z: 0, kind: "player" });
    expect(g.resolve(undefined)).toMatchObject({ x: 5, y: 6 }); expect(g.error).toBeUndefined();
  });
  it("falls back to spawn/camp after N frames without a target and surfaces an error", () => {
    const g = new CameraTargetGuard({ x: 19, y: 8, z: 0 }, 3);
    for (let i = 0; i < 2; i++) g.resolve(undefined, "player", "local server not running");
    expect(g.error).toBeUndefined();
    expect(g.resolve(undefined, "player", "local server not running")).toEqual({ x: 19, y: 8, z: 0, kind: "fallback" });
    expect(g.error).toContain("after 3 frames"); expect(g.error).toContain("local server not running");
    expect(g.resolve({ x: 1, y: 1, z: 0 }).kind).toBe("player"); expect(g.error).toBeUndefined();
  });
  it("treats a NaN target as missing", () => {
    const g = new CameraTargetGuard({ x: 16, y: 16, z: 0 }, 1);
    expect(g.resolve({ x: NaN, y: 0, z: 0 }).kind).toBe("fallback"); expect(g.error).toContain("invalid NaN");
  });
});

describe("cloneData without structuredClone", () => {
  it("deep-clones plain config data", async () => {
    const { cloneData } = await import("../src/style.js");
    const g = globalThis as { structuredClone?: unknown }; const sc = g.structuredClone; g.structuredClone = undefined;
    try { const a = { x: [1, { y: 2 }], f: new Float32Array([1, 2]) }; const b = cloneData(a); expect(b).toEqual(a); expect(b.x).not.toBe(a.x); expect(b.f).not.toBe(a.f); }
    finally { g.structuredClone = sc; }
  });
});
