// ADR-115: every gameplay module must be importable as the FIRST module of a fresh ESM graph (no TDZ cycles such as
// "Cannot access CROP_EVERY before initialization", which broke the client dev page / spMobile when world.ts led).
import { describe, expect, it, vi } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(__dirname, "../src");
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : /\.ts$/.test(n) && !n.endsWith(".d.ts") ? [p] : []; });

describe("gameplay ESM import order", () => {
  for (const file of walk(SRC)) {
    it(`imports cleanly when ${relative(SRC, file)} is the entry`, async () => {
      vi.resetModules();
      await expect(import(file)).resolves.toBeDefined();
    });
  }
  it("the crops system cadence is initialized", async () => {
    vi.resetModules();
    await import(join(SRC, "world.ts"));
    const { GAMEPLAY_SYSTEM_ORDER } = await import(join(SRC, "install.ts"));
    const crops = GAMEPLAY_SYSTEM_ORDER.find((e: readonly unknown[]) => e[1] === "gameplay.crops");
    expect(typeof crops?.[2]).toBe("number");
  });
});
