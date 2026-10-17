import { defineComponent, type ComponentDef } from "./component.js";
import { entityIndex, type Entity } from "./entity.js";
import { defineResource, type World } from "./world.js";

/**
 * Deterministic tick-keyed scheduler (binary min-heap on (tick, seq)). Callbacks fire in (tick, insertion) order
 * when run(world) is called for a tick >= their due tick. Reusable for decay, respawns, raid timers, crafting.
 * Callbacks are code, so the scheduler itself is not persisted: persist the absolute due ticks in data and
 * re-schedule on load (see JobQueue for the pattern).
 */
export type TimerCallback = (world: World, dueTick: number) => void;
interface Timer { tick: number; seq: number; fn: TimerCallback; id: number; cancelled: boolean }
export class Scheduler {
  private heap: Timer[] = []; private seq = 0; private byId = new Map<number, Timer>();
  get size(): number { return this.byId.size; }
  at(tick: number, fn: TimerCallback): number {
    const t: Timer = { tick, seq: this.seq++, fn, id: this.seq, cancelled: false }; this.byId.set(t.id, t); this.push(t); return t.id;
  }
  after(world: World, ticks: number, fn: TimerCallback): number { return this.at(world.tick + ticks, fn); }
  cancel(id: number): boolean { const t = this.byId.get(id); if (!t) return false; t.cancelled = true; this.byId.delete(id); return true; }
  nextTick(): number | undefined { this.skip(); return this.heap[0]?.tick; }
  /** Fire everything due at or before `tick` (default world.tick). Timers scheduled during run for <= tick also fire. */
  run(world: World, tick = world.tick): number {
    let n = 0;
    for (;;) { this.skip(); const t = this.heap[0]; if (!t || t.tick > tick) break; this.pop(); this.byId.delete(t.id); t.fn(world, t.tick); n++; }
    return n;
  }
  private skip(): void { while (this.heap.length && this.heap[0]!.cancelled) this.pop(); }
  private less(a: Timer, b: Timer): boolean { return a.tick < b.tick || (a.tick === b.tick && a.seq < b.seq); }
  private push(t: Timer): void { const h = this.heap; h.push(t); let i = h.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (!this.less(h[i]!, h[p]!)) break; [h[i], h[p]] = [h[p]!, h[i]!]; i = p; } }
  private pop(): Timer { const h = this.heap; const top = h[0]!; const last = h.pop()!; if (h.length) { h[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < h.length && this.less(h[l]!, h[m]!)) m = l; if (r < h.length && this.less(h[r]!, h[m]!)) m = r; if (m === i) break; [h[i], h[m]] = [h[m]!, h[i]!]; i = m; } } return top; }
}
export const SchedulerRes = defineResource<Scheduler>("Scheduler");
/** Installs a world Scheduler run in the simulation phase as system "scheduler" (first call wins). */
export function installScheduler(world: World): Scheduler {
  let s = world.getResource(SchedulerRes); if (s) return s;
  s = new Scheduler(); world.setResource(SchedulerRes, s); const sch = s;
  world.addSystem("simulation", "scheduler", (w) => { if (!w.isReplaying) sch.run(w); }); return s;
}

// ---------------- timed job queues ----------------
export const enum JobState { Empty = 0, Queued = 1, Running = 2, Paused = 3, Done = 4 }
export type JobQueueDef = ComponentDef<{
  recipeId: { type: "u16"; length: number }; startTick: { type: "u32"; length: number }; endTick: { type: "u32"; length: number };
  count: { type: "u16"; length: number }; state: { type: "u8"; length: number }; remaining: { type: "u32"; length: number };
}>;
/** Fixed-capacity timed job queue component; slot 0 is the head. Networked so clients can show progress bars. */
export function defineJobQueue(name: string, capacity = 4, opts: { networked?: boolean; persistent?: boolean } = {}): JobQueueDef {
  return defineComponent(name, {
    recipeId: { type: "u16", length: capacity }, startTick: { type: "u32", length: capacity }, endTick: { type: "u32", length: capacity },
    count: { type: "u16", length: capacity }, state: { type: "u8", length: capacity }, remaining: { type: "u32", length: capacity },
  }, { networked: opts.networked ?? true, persistent: opts.persistent ?? true }) as JobQueueDef;
}
export interface JobInfo { slot: number; recipeId: number; startTick: number; endTick: number; count: number; state: JobState }
export interface JobHooks {
  /** Job finished one unit (count-1 remaining repeats re-run with the same duration). */
  onComplete(world: World, e: Entity, job: JobInfo): void;
  /** Cancelled: gameplay refunds ingredients here. */
  onCancel?(world: World, e: Entity, job: JobInfo): void;
  /** Duration in ticks for a recipe (gameplay rule: station bonus, skill). */
  duration(world: World, e: Entity, recipeId: number): number;
}
/**
 * Runs JobQueue heads via the Scheduler: only the head job of each entity has a timer, so there is no per-tick work.
 * Gameplay validates/consumes ingredients before enqueue and handles outputs in onComplete.
 */
export class JobQueues {
  private timers = new Map<number, number>(); // entity index -> timer id
  constructor(readonly world: World, readonly def: JobQueueDef, readonly sched: Scheduler, readonly hooks: JobHooks) {}
  private st() { return this.world.store(this.def); }
  private cap(): number { return this.st().lengths["recipeId"]!; }
  private base(e: Entity): number { return this.st().slot(entityIndex(e)) * this.cap(); }
  info(e: Entity, slot: number): JobInfo { const d = this.st().data, j = this.base(e) + slot; return { slot, recipeId: d.recipeId[j]!, startTick: d.startTick[j]!, endTick: d.endTick[j]!, count: d.count[j]!, state: d.state[j]! as JobState }; }
  jobs(e: Entity): JobInfo[] { if (!this.world.has(e, this.def)) return []; const out: JobInfo[] = []; for (let k = 0; k < this.cap(); k++) { const j = this.info(e, k); if (j.state !== JobState.Empty) out.push(j); } return out; }
  /** Append a job; returns slot or -1 when full. */
  enqueue(e: Entity, recipeId: number, count = 1): number {
    const w = this.world; if (!w.has(e, this.def)) w.add(e, this.def);
    const d = this.st().data, b = this.base(e);
    for (let k = 0; k < this.cap(); k++) if (d.state[b + k] === JobState.Empty) {
      d.recipeId[b + k] = recipeId; d.count[b + k] = count; d.state[b + k] = JobState.Queued; d.startTick[b + k] = 0; d.endTick[b + k] = 0; d.remaining[b + k] = 0;
      this.st().markChanged(entityIndex(e)); this.startHead(e); return k;
    }
    return -1;
  }
  private startHead(e: Entity): void {
    const d = this.st().data, b = this.base(e); const i = entityIndex(e);
    if (d.state[b] !== JobState.Queued || this.timers.has(i)) return;
    const dur = d.remaining[b]! > 0 ? d.remaining[b]! : Math.max(1, this.hooks.duration(this.world, e, d.recipeId[b]!));
    d.startTick[b] = this.world.tick; d.endTick[b] = this.world.tick + dur; d.remaining[b] = 0; d.state[b] = JobState.Running;
    this.st().markChanged(i); this.arm(e, d.endTick[b]!);
  }
  private arm(e: Entity, tick: number): void {
    const i = entityIndex(e);
    this.timers.set(i, this.sched.at(tick, () => { this.timers.delete(i); if (this.world.isAlive(e) && this.world.has(e, this.def)) this.finish(e); }));
  }
  private finish(e: Entity): void {
    const d = this.st().data, b = this.base(e); if (d.state[b] !== JobState.Running) return;
    this.hooks.onComplete(this.world, e, this.info(e, 0));
    if (d.count[b]! > 1) { d.count[b]!--; d.state[b] = JobState.Queued; } else this.shift(e);
    this.st().markChanged(entityIndex(e)); this.startHead(e);
  }
  private shift(e: Entity): void {
    const st = this.st(), b = this.base(e), n = this.cap();
    for (const f of ["recipeId", "startTick", "endTick", "count", "state", "remaining"] as const) { const a = st.data[f]; for (let k = 0; k < n - 1; k++) a[b + k] = a[b + k + 1]!; a[b + n - 1] = 0; }
  }
  /** Cancel a slot (head or queued); onCancel hook refunds. */
  cancel(e: Entity, slot: number): boolean {
    if (!this.world.has(e, this.def)) return false; const st = this.st(), b = this.base(e); if (st.data.state[b + slot] === JobState.Empty) return false;
    this.hooks.onCancel?.(this.world, e, this.info(e, slot));
    if (slot === 0) { const t = this.timers.get(entityIndex(e)); if (t !== undefined) { this.sched.cancel(t); this.timers.delete(entityIndex(e)); } }
    const n = this.cap(); for (const f of ["recipeId", "startTick", "endTick", "count", "state", "remaining"] as const) { const a = st.data[f]; for (let k = slot; k < n - 1; k++) a[b + k] = a[b + k + 1]!; a[b + n - 1] = 0; }
    st.markChanged(entityIndex(e)); this.startHead(e); return true;
  }
  pause(e: Entity): boolean {
    const st = this.st(), b = this.base(e); if (!this.world.has(e, this.def) || st.data.state[b] !== JobState.Running) return false;
    const t = this.timers.get(entityIndex(e)); if (t !== undefined) { this.sched.cancel(t); this.timers.delete(entityIndex(e)); }
    st.data.remaining[b] = Math.max(1, st.data.endTick[b]! - this.world.tick); st.data.state[b] = JobState.Paused; st.markChanged(entityIndex(e)); return true;
  }
  resume(e: Entity): boolean {
    const st = this.st(), b = this.base(e); if (!this.world.has(e, this.def) || st.data.state[b] !== JobState.Paused) return false;
    st.data.state[b] = JobState.Queued; this.startHead(e); return true;
  }
  /** After loading persisted queues: re-arm timers from stored endTick (jobs that ended while offline complete on next run). */
  rearmAll(): void { for (const e of this.world.query([this.def])) { const d = this.st().data, b = this.base(e); if (d.state[b] === JobState.Running && !this.timers.has(entityIndex(e))) this.arm(e, d.endTick[b]!); else this.startHead(e); } }
}
