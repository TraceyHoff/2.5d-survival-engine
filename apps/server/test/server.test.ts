import { describe, it, expect } from "vitest";
import { createServerSim } from "../src/main.js";
describe("server sim", () => {
  it("is deterministic for a given seed", () => {
    const a = createServerSim(7), b = createServerSim(7);
    for (let i = 0; i < 20; i++) { a.loop.advance(50); b.loop.advance(50); }
    expect(a.world.tick).toBe(20); expect(a.map.getTile(10, 10)).toBe(b.map.getTile(10, 10));
    expect(a.world.rng.state).toBe(b.world.rng.state);
  });
});
describe("server networking", () => {
  it("assigns NetIds through NetServer (no hand-made ids; env singleton keeps ENV_NET_ID)", async () => {
    const { ENV_NET_ID, NetId } = await import("@engine/core");
    const { world, net, loop } = createServerSim(3);
    loop.advance(50);
    expect(world.getField(world.environment, NetId, "id")).toBe(ENV_NET_ID);
    expect(net.netIds.size).toBeGreaterThanOrEqual(2);
  });
});
