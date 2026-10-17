export const DEFAULT_TICK_HZ = 20;
export interface LoopOptions {
  tickHz?: number;
  maxStepsPerFrame?: number; // spiral-of-death guard
  step: (dt: number) => void;
  render?: (alpha: number) => void;
}
/**
 * Fixed-timestep accumulator loop. Time source is injected (advance(elapsedMs)),
 * so the sim never reads wall clock; client drives it from rAF, server from setInterval/hrtime.
 */
export class FixedLoop {
  readonly dt: number; readonly dtMs: number;
  private acc = 0; private readonly maxSteps: number;
  ticks = 0;
  constructor(private opts: LoopOptions) {
    const hz = opts.tickHz ?? DEFAULT_TICK_HZ;
    this.dt = 1 / hz; this.dtMs = 1000 / hz; this.maxSteps = opts.maxStepsPerFrame ?? 5;
  }
  /** Returns number of sim steps executed. */
  advance(elapsedMs: number): number {
    this.acc += Math.max(0, elapsedMs);
    let n = 0;
    while (this.acc >= this.dtMs && n < this.maxSteps) { this.opts.step(this.dt); this.acc -= this.dtMs; n++; this.ticks++; }
    if (n === this.maxSteps && this.acc >= this.dtMs) this.acc = 0; // drop backlog
    this.opts.render?.(this.alpha);
    return n;
  }
  get alpha(): number { return this.acc / this.dtMs; }
}

/** Standard engine loop: world.step(dt) each fixed tick, then render(world, alpha) once per frame. */
export function createGameLoop<W extends { step(dt: number): void }>(
  world: W, opts: { tickHz?: number; maxStepsPerFrame?: number; render?: (world: W, alpha: number) => void } = {},
): FixedLoop {
  const r = opts.render;
  return new FixedLoop({
    step: (dt) => world.step(dt),
    ...(opts.tickHz !== undefined && { tickHz: opts.tickHz }),
    ...(opts.maxStepsPerFrame !== undefined && { maxStepsPerFrame: opts.maxStepsPerFrame }),
    ...(r && { render: (a: number) => r(world, a) }),
  });
}
