import { describe, expect, test } from "vitest";
import { World, TimeOfDay, Weather } from "@engine/core";
import { installDemoWorld } from "@engine/server/protocol";

/** Boots the client world the way main.ts does (offline/singleplayer and dev/multiplayer paths) and checks the
 * env singletons the HUD reads are registered — guards 'Component not registered: TimeOfDay'. */
describe("client world boot", () => {
  for (const mode of ["offline", "dev"] as const) test(mode, () => {
    const w = new World({ seed: 1234 });
    expect(() => installDemoWorld(w, "client")).not.toThrow();
    expect(w.isRegistered(TimeOfDay)).toBe(true);
    expect(w.isRegistered(Weather)).toBe(true);
    if (mode === "dev") { for (let i = 0; i < 5; i++) w.tick++; }
    expect(w.entityCount).toBeGreaterThan(0);
  });
});
