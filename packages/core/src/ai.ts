/**
 * Engine-side agent AI framework (no gameplay knowledge). Gameplay registers behaviors (actions) with
 * considerations; the framework does perception memory, a per-agent blackboard, utility selection with
 * response curves, personality weighting, schedules, a budgeted/staggered think, human imperfections and
 * templated, rate-limited chat. An AgentController only ever produces an AgentOutput (the same input stream a
 * human client produces: move axes, aim, action buttons, chat) - it never mutates the sim. See docs/AI_AGENTS.md.
 */
import { Rng } from "./rng.js";

// ---------------- curves + considerations ----------------
export type Curve =
  | { type: "linear"; m?: number; b?: number }
  | { type: "quadratic"; exp?: number }
  | { type: "logistic"; k?: number; mid?: number }
  | { type: "inverse" }
  | { type: "step"; at: number };
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : Number.isFinite(x) ? x : 0);
export function evalCurve(c: Curve, x: number): number {
  x = clamp01(x);
  switch (c.type) {
    case "linear": return clamp01((c.m ?? 1) * x + (c.b ?? 0));
    case "quadratic": return clamp01(x ** (c.exp ?? 2));
    case "logistic": return clamp01(1 / (1 + Math.exp(-(c.k ?? 10) * (x - (c.mid ?? 0.5)))));
    case "inverse": return 1 - x;
    case "step": return x >= c.at ? 1 : 0;
  }
}

export interface Traits { bravery: number; sociability: number; greed: number; industriousness: number; chattiness: number }
export const TRAIT_KEYS = ["bravery", "sociability", "greed", "industriousness", "chattiness"] as const;
export function randomTraits(rng: Rng): Traits {
  return { bravery: rng.next(), sociability: rng.next(), greed: rng.next(), industriousness: rng.next(), chattiness: rng.next() };
}

/** Blackboard: per-agent key/value scratch (perception facts, goals, current targets). */
export class Blackboard {
  private m = new Map<string, unknown>();
  get<T>(k: string): T | undefined { return this.m.get(k) as T | undefined; }
  set(k: string, v: unknown): void { this.m.set(k, v); }
  has(k: string): boolean { return this.m.has(k); }
  delete(k: string): void { this.m.delete(k); }
  num(k: string, d = 0): number { const v = this.m.get(k); return typeof v === "number" ? v : d; }
}

// ---------------- perception ----------------
export interface Percept { id: number; kind: string; x: number; y: number; tick: number; confidence: number; heard?: boolean }
export interface PerceptionConfig { sightRange: number; sightConeDeg: number; hearingRange: number; memorySeconds: number }
export const DEFAULT_PERCEPTION: PerceptionConfig = { sightRange: 12, sightConeDeg: 140, hearingRange: 18, memorySeconds: 20 };
/** Sight cone + range test (facing in radians). */
export function canSee(cfg: PerceptionConfig, ax: number, ay: number, facing: number, tx: number, ty: number): boolean {
  const dx = tx - ax, dy = ty - ay, d = Math.hypot(dx, dy); if (d > cfg.sightRange) return false; if (d < 1.5) return true;
  let a = Math.atan2(dy, dx) - facing; a = Math.atan2(Math.sin(a), Math.cos(a));
  return Math.abs(a) <= (cfg.sightConeDeg * Math.PI) / 360;
}
/** Memory with linear confidence decay: seen/heard things fade after memorySeconds. */
export class AgentMemory {
  readonly items = new Map<number, Percept>();
  constructor(private cfg: PerceptionConfig, private tickHz: number) {}
  see(p: Omit<Percept, "confidence">): void { this.items.set(p.id, { ...p, confidence: 1 }); }
  hear(p: Omit<Percept, "confidence" | "heard">, loudness = 1): void {
    const cur = this.items.get(p.id); const c = Math.min(1, 0.6 * loudness);
    if (!cur || cur.confidence < c) this.items.set(p.id, { ...p, confidence: c, heard: true });
  }
  decay(tick: number): void {
    const life = this.cfg.memorySeconds * this.tickHz;
    for (const [id, p] of this.items) { const c = 1 - (tick - p.tick) / life; if (c <= 0) this.items.delete(id); else if (!p.heard) p.confidence = Math.min(p.confidence, c); }
  }
  /** Sorted by distance then id (deterministic). */
  nearest(kind: string, x: number, y: number, minConfidence = 0.1): Percept | undefined {
    let best: Percept | undefined, bd = Infinity;
    for (const p of this.items.values()) { if (p.kind !== kind || p.confidence < minConfidence) continue; const d = (p.x - x) ** 2 + (p.y - y) ** 2; if (d < bd || (d === bd && best && p.id < best.id)) { bd = d; best = p; } }
    return best;
  }
}

// ---------------- output = the human input stream ----------------
/** What a controller emits each tick: the same stream a human client sends (mapped to InputFrame/commands by the host). */
export interface AgentOutput { moveX: number; moveY: number; aimX: number; aimY: number; sprint: boolean; actions: string[]; chat?: { channel: string; text: string }; emote?: string;
  /** Discrete commands (buy, place, craft…) by registered command name; sent through the same client command path and server
   *  validation as a human's. Entity-typed payload fields hold the bot's replica entities (the host maps them to network ids). */
  commands?: { type: string; payload: unknown }[] }
export const idleOutput = (): AgentOutput => ({ moveX: 0, moveY: 0, aimX: 0, aimY: 0, sprint: false, actions: [] });

// ---------------- behaviors ----------------
export interface AgentSelf { x: number; y: number; facing: number; hp: number; hunger: number; thirst: number; stamina: number; tick: number; dayT: number; phase: string }
export interface AgentContext<B = unknown> { self: AgentSelf; bb: Blackboard; memory: AgentMemory; traits: Traits; rng: Rng; agent: Agent; world: B }
export interface Consideration<B = unknown> { name: string; input: (ctx: AgentContext<B>) => number; curve: Curve; weight?: number }
export interface BehaviorDef<B = unknown> {
  name: string;
  considerations: Consideration<B>[];
  /** Trait multipliers: utility *= 1 + sum(traits[k] - 0.5) * w. */
  traits?: Partial<Record<keyof Traits, number>>;
  /** Utility bonus while the agent's schedule slot lists this behavior. */
  scheduleBonus?: number;
  /** Bonus when already running (hysteresis). */
  inertia?: number;
  /** Optional chat situation emitted (via ChatTemplates) on start. */
  chatOnStart?: string;
  /** Per-tick output while selected. Returning false ends the behavior (re-think next tick). */
  run(ctx: AgentContext<B>, out: AgentOutput): boolean | void;
}
export class BehaviorRegistry<B = unknown> {
  readonly defs = new Map<string, BehaviorDef<B>>();
  register(d: BehaviorDef<B>): this { if (this.defs.has(d.name)) throw new Error(`behavior ${d.name} already registered`); this.defs.set(d.name, d); return this; }
  get(name: string): BehaviorDef<B> | undefined { return this.defs.get(name); }
  list(): BehaviorDef<B>[] { return [...this.defs.values()]; }
}
/** Utility = product of curve(considerations) with compensation (Dave Mark), times trait and schedule factors. */
export function scoreBehavior<B>(d: BehaviorDef<B>, ctx: AgentContext<B>, current: string | undefined, scheduled: readonly string[]): number {
  let s = 1; const n = d.considerations.length;
  for (const c of d.considerations) { const v = evalCurve(c.curve, c.input(ctx)) * (c.weight ?? 1); s *= v; if (s === 0) return 0; }
  if (n > 1) { const mod = 1 - 1 / n; s = s + (1 - s) * mod * s; }
  let t = 1; for (const [k, w] of Object.entries(d.traits ?? {})) t += (ctx.traits[k as keyof Traits] - 0.5) * (w ?? 0);
  s *= Math.max(0, t);
  if (scheduled.includes(d.name)) s += d.scheduleBonus ?? 0.15;
  if (current === d.name) s += d.inertia ?? 0.1;
  return s;
}

// ---------------- schedule, goals, imperfections ----------------
/** Daily routine: slots by time of day (t in [0,1)), each listing preferred behaviors. */
export interface ScheduleSlot { from: number; to: number; prefer: string[] }
export function scheduledAt(s: readonly ScheduleSlot[], t: number): string[] {
  for (const x of s) if (x.from <= x.to ? t >= x.from && t < x.to : t >= x.from || t < x.to) return x.prefer; return [];
}
export interface Goal { name: string; progress: number; done?: boolean }
export interface Imperfections { reactionTicks: [number, number]; aimErrorRad: number; inputJitter: number; idlePauseChance: number; lookAroundChance: number; pathWobble: number }
export const DEFAULT_IMPERFECTIONS: Imperfections = { reactionTicks: [4, 12], aimErrorRad: 0.15, inputJitter: 0.08, idlePauseChance: 0.004, lookAroundChance: 0.01, pathWobble: 0.2 };

// ---------------- chat ----------------
/** Optional later: an LLM-backed line provider. Never called by the engine unless the host installs one. */
export interface ChatProvider { line(situation: string, vars: Record<string, string>, agent: Agent): string | undefined }
export class ChatTemplates implements ChatProvider {
  constructor(private lines: Record<string, string[]>, private rng: () => number) {}
  line(situation: string, vars: Record<string, string>): string | undefined {
    const l = this.lines[situation]; if (!l?.length) return undefined;
    return l[Math.floor(this.rng() * l.length)]!.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "");
  }
}

// ---------------- agent + controller ----------------
export interface AgentIdentity { id: string; name: string; appearance?: Record<string, number>; relationship: number; traits: Traits; archetype: string; goals: Goal[] }
export interface AgentConfig { perception?: Partial<PerceptionConfig>; imperfections?: Partial<Imperfections>; schedule?: ScheduleSlot[]; chatMinSeconds?: number; tickHz?: number }
export class Agent {
  readonly bb = new Blackboard(); readonly memory: AgentMemory;
  readonly perception: PerceptionConfig; readonly imperfect: Imperfections; readonly schedule: ScheduleSlot[];
  current: string | undefined; readonly rng: Rng;
  /** Last decided output, replayed (with jitter) until the next think. */
  plan: AgentOutput = idleOutput();
  pendingSwitch: { name: string; atTick: number } | undefined;
  lastChatTick = -1e9; pauseUntil = 0;
  constructor(readonly identity: AgentIdentity, seed: number, readonly cfg: AgentConfig = {}) {
    this.perception = { ...DEFAULT_PERCEPTION, ...cfg.perception }; this.imperfect = { ...DEFAULT_IMPERFECTIONS, ...cfg.imperfections };
    this.schedule = cfg.schedule ?? []; this.memory = new AgentMemory(this.perception, cfg.tickHz ?? 20); this.rng = new Rng(seed);
  }
}

export interface ControllerOptions<B> { behaviors: BehaviorRegistry<B>; chat?: ChatProvider; /** Max agents thinking per tick. */ thinkBudget?: number; /** Ticks between an agent's thinks. */ thinkEvery?: number; tickHz?: number }
/**
 * Drives many agents. tick() is called once per agent tick with each agent's self/world view; it thinks at most
 * `thinkBudget` agents per tick (round robin, staggered), applies reaction delay to switches, and returns one
 * AgentOutput per agent.
 */
export class AgentController<B = unknown> {
  readonly agents: Agent[] = []; private cursor = 0; thinksLastTick = 0;
  constructor(readonly o: ControllerOptions<B>) {}
  add(a: Agent): Agent { this.agents.push(a); return a; }
  remove(a: Agent): void { const i = this.agents.indexOf(a); if (i >= 0) this.agents.splice(i, 1); }
  think(a: Agent, ctx: AgentContext<B>): string | undefined {
    const sched = scheduledAt(a.schedule, ctx.self.dayT); let best: string | undefined, bs = 0;
    for (const d of this.o.behaviors.list()) { const s = scoreBehavior(d, ctx, a.current, sched); if (s > bs) { bs = s; best = d.name; } }
    return best;
  }
  tick(tick: number, view: (a: Agent) => { self: AgentSelf; world: B } | undefined): Map<Agent, AgentOutput> {
    const out = new Map<Agent, AgentOutput>(); const n = this.agents.length; const every = this.o.thinkEvery ?? 10;
    const budget = Math.min(n, this.o.thinkBudget ?? 4, Math.ceil(n / every) || 0);
    const thinking = new Set<Agent>(); for (let i = 0; i < budget; i++) thinking.add(this.agents[(this.cursor + i) % n]!);
    this.cursor = n ? (this.cursor + budget) % n : 0; this.thinksLastTick = thinking.size;
    for (const a of this.agents) {
      const v = view(a); if (!v) { out.set(a, idleOutput()); continue; }
      a.memory.decay(tick);
      const ctx: AgentContext<B> = { self: v.self, bb: a.bb, memory: a.memory, traits: a.identity.traits, rng: a.rng, agent: a, world: v.world };
      if (thinking.has(a) || a.current === undefined) {
        const want = this.think(a, ctx);
        if (want !== a.current && want !== undefined && (!a.pendingSwitch || a.pendingSwitch.name !== want)) {
          const [lo, hi] = a.imperfect.reactionTicks; a.pendingSwitch = { name: want, atTick: tick + (a.current === undefined ? 0 : a.rng.int(lo, hi + 1)) };
        }
      }
      let chat: AgentOutput["chat"];
      if (a.pendingSwitch && tick >= a.pendingSwitch.atTick) {
        a.current = a.pendingSwitch.name; a.pendingSwitch = undefined; a.bb.set("behaviorStart", tick);
        const sit = this.o.behaviors.get(a.current)?.chatOnStart; if (sit) chat = this.say(a, sit, tick);
      }
      const o = idleOutput(); const im = a.imperfect;
      if (tick < a.pauseUntil) { out.set(a, o); continue; }
      if (a.rng.next() < im.idlePauseChance) { a.pauseUntil = tick + a.rng.int(10, 40); out.set(a, o); continue; }
      const d = a.current ? this.o.behaviors.get(a.current) : undefined;
      if (d && d.run(ctx, o) === false) a.current = undefined;
      if (o.moveX || o.moveY) { // imperfect pathing + input jitter
        const ang = Math.atan2(o.moveY, o.moveX) + (a.rng.next() - 0.5) * im.pathWobble; const m = Math.min(1, Math.hypot(o.moveX, o.moveY)) * (1 - a.rng.next() * im.inputJitter);
        o.moveX = Math.cos(ang) * m; o.moveY = Math.sin(ang) * m;
      }
      if (o.aimX || o.aimY) { const ang = Math.atan2(o.aimY, o.aimX) + (a.rng.next() - 0.5) * 2 * im.aimErrorRad; const m = Math.hypot(o.aimX, o.aimY); o.aimX = Math.cos(ang) * m; o.aimY = Math.sin(ang) * m; }
      else if (a.rng.next() < im.lookAroundChance) { const ang = a.rng.range(-Math.PI, Math.PI); o.aimX = Math.cos(ang); o.aimY = Math.sin(ang); }
      if (chat && !o.chat) o.chat = chat;
      out.set(a, o);
    }
    return out;
  }
  /** Rate-limited, chattiness-gated templated line. */
  say(a: Agent, situation: string, tick: number, vars: Record<string, string> = {}): AgentOutput["chat"] {
    const hz = this.o.tickHz ?? 20; if (!this.o.chat || tick - a.lastChatTick < (a.cfg.chatMinSeconds ?? 20) * hz) return undefined;
    if (a.rng.next() > a.identity.traits.chattiness) return undefined;
    const text = this.o.chat.line(situation, { name: a.identity.name, ...vars }, a); if (!text) return undefined;
    a.lastChatTick = tick; return { channel: "local", text };
  }
}
