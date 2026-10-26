import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as G from "../src/index.js";

const items = JSON.parse(readFileSync(new URL("../data/items.json", import.meta.url), "utf8"));
const list: any[] = Array.isArray(items) ? items : items.items ?? Object.values(items);

describe("ADR-151 faster melee", () => {
  it("fists swing every 0.4 s", () => { expect(G.FISTS.cooldownSeconds).toBe(0.4); });
  it("melee cooldowns are 0.3..0.85 s and keep per-weapon ordering", () => {
    const cd = (k: string) => list.find((i) => i.key === k).weapon.cooldownSeconds;
    for (const i of list) if (i?.weapon) { expect(i.weapon.cooldownSeconds).toBeGreaterThanOrEqual(0.3); expect(i.weapon.cooldownSeconds).toBeLessThanOrEqual(0.85); }
    expect(cd("steel_dagger")).toBeLessThan(cd("iron_sword")); expect(cd("iron_sword")).toBeLessThan(cd("stone_maul"));
  });
  it("swing anim fits inside the fastest cooldown (server and client use the same ticks)", () => {
    expect(G.PLAYER_SWING_TICKS / 20).toBeLessThanOrEqual(0.3);
  });
});
