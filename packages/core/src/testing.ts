import { World, type WorldOptions } from "./world.js";
import { DEFAULT_TICK_HZ } from "./loop.js";

/** Headless test helpers (no wall clock, deterministic seed). */
export const TEST_SEED = 0x5eed;
export function createTestWorld(opts: WorldOptions & { setup?: (w: World) => void } = {}): World {
  const w = new World({ seed: TEST_SEED, ...opts }); opts.setup?.(w); return w;
}
/** Steps the world n fixed ticks. */
export function stepN(world: World, n: number, dt = 1 / DEFAULT_TICK_HZ): World { for (let i = 0; i < n; i++) world.step(dt); return world; }
/** Manually advanced clock to drive FixedLoop / transports in tests. */
export class FakeClock {
  constructor(public nowMs = 0) {}
  now = (): number => this.nowMs;
  /** Advances and returns elapsed ms (feed to loop.advance). */
  advance(ms: number): number { this.nowMs += ms; return ms; }
}
