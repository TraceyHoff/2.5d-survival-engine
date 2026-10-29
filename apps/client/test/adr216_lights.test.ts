import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_LIGHTS, HELD_LIGHT_ITEMS, LightTable } from "../src/lights.js";

const tuning = JSON.parse(readFileSync(new URL("../../../assets/survival_fx/render_tuning.json", import.meta.url), "utf8"));
const pieces = (JSON.parse(readFileSync(new URL("../../../packages/gameplay/data/pieces.json", import.meta.url), "utf8")) as { pieces?: unknown[] } | unknown[]);
const list = (Array.isArray(pieces) ? pieces : (pieces as { pieces: unknown[] }).pieces) as Array<{ key: string; light?: boolean; lightRadius?: number }>;

describe("ADR-216 client light table", () => {
  const t = new LightTable(); t.load(tuning);
  it("campfire lights 6-8 tiles, torches/lanterns proportionally (render_tuning merged)", () => {
    expect(t.get("campfire")!.radius).toBeGreaterThanOrEqual(6); expect(t.get("campfire")!.radius).toBeLessThanOrEqual(8);
    for (const k of ["torch_stand", "lantern", "held_torch"]) { expect(t.get(k)!.radius, k).toBeGreaterThanOrEqual(5); expect(t.get(k)!.radius, k).toBeLessThanOrEqual(t.get("campfire")!.radius); }
    expect(t.get("bonfire")!.radius).toBeGreaterThanOrEqual(t.get("campfire")!.radius);
  });
  it("every gameplay light piece has its own entry whose radius equals the gameplay lightRadius", () => {
    const lights = list.filter((p) => p.light); expect(lights.length).toBeGreaterThan(10);
    for (const p of lights) { const s = t.get(p.key); expect(s, p.key).toBeDefined(); expect(s!.radius, p.key).toBe(p.lightRadius); }
  });
  it("held lights: torch / lantern / candle only", () => {
    for (const k of HELD_LIGHT_ITEMS) expect(t.held(k), k).toBeDefined();
    expect(t.held("torch")!.radius).toBeGreaterThanOrEqual(5); expect(t.held("stone_axe")).toBeUndefined(); expect(t.held(undefined)).toBeUndefined();
  });
  it("withRadius overrides only a positive, different radius", () => {
    const c = DEFAULT_LIGHTS.campfire!; expect(LightTable.withRadius(c, undefined)).toBe(c); expect(LightTable.withRadius(c, 0)).toBe(c);
    expect(LightTable.withRadius(c, 9).radius).toBe(9); expect(LightTable.withRadius(c, 9).intensity).toBe(c.intensity);
  });
});
