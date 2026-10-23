/**
 * Gameplay behaviors for virtual players (human bots) on @engine/core's agent framework (ai.ts).
 * Behaviors read an AgentWorldView built from the bot's OWN client replica (what a human would see on screen) and
 * only write AgentOutput (move axes / aim / action names / chat) - the host maps that to the same InputFrame +
 * commands a human client sends. Survival Systems extends this with registerBehavior() and data/agents.json.
 */
import { Agent, AgentController, BehaviorRegistry, ChatTemplates, Rng, Transform, canSee, timeOfDay, type AgentContext, type AgentIdentity, type AgentSelf, type BehaviorDef, type ScheduleSlot, type World, type Entity, type Imperfections, type PerceptionConfig } from "@engine/core";
import raw from "../data/agents.json";
import { Animal, Dead, Health, ResourceNode, Survival, Zombie } from "./components.js";
import { currentPhaseKey } from "./combat/zombies.js";
import { populationData, rollTraits, scoreUtilities } from "./ai/population.js";
import { fillAgentSensors, survivalBehaviors, type AgentSensors } from "./ai/survivor_behaviors.js";
import { emitAgentCommands } from "./ai/agent_output.js";

export interface AgentsData {
  archetypes: Record<string, { perception: PerceptionConfig; imperfections: Imperfections; schedule: ScheduleSlot[]; goals: string[]; chatMinSeconds: number }>;
  names: string[]; chat: Record<string, string[]>;
}
export const AGENTS_DATA: AgentsData = raw as unknown as AgentsData;

export interface SeenThing { id: number; kind: "zombie" | "player" | "node" | "animal"; x: number; y: number }
export interface AgentWorldView extends AgentSensors {
  seen: SeenThing[]; home: { x: number; y: number }; playerName: string;
  /** Optional sensors (0..1 / plans) the host fills from the bot's replica; missing = neutral. */
  invSpaceFree?: number; craftRecipe?: number; buildPlan?: { piece: number; x: number; y: number };
}
export type GameBehavior = BehaviorDef<AgentWorldView>;

/** Perception from a client-side replica: everything replicated near `self` (sight cone + range is applied to memory). */
export function buildAgentView(world: World, self: Entity, a: Agent, home: { x: number; y: number }, playerName = "friend"): { self: AgentSelf; world: AgentWorldView } | undefined {
  const t = world.get(self, Transform); if (!t) return undefined;
  const sv = world.get(self, Survival); const hp = world.get(self, Health);
  const facing = a.bb.num("facing", t.facing);
  const seen: SeenThing[] = [];
  for (const e of world.query([Transform], [Dead])) {
    if (e === self) continue; const o = world.get(e, Transform)!;
    const kind = world.has(e, Zombie) ? "zombie" : world.has(e, ResourceNode) ? "node" : world.has(e, Animal) ? "animal" : world.has(e, Health) ? "player" : undefined;
    if (!kind) continue; if (kind === "node" && world.getField(e, ResourceNode, "amount") === 0) continue;
    const d = Math.hypot(o.x - t.x, o.y - t.y);
    const visible = canSee(a.perception, t.x, t.y, facing, o.x, o.y);
    if (visible) a.memory.see({ id: e, kind, x: o.x, y: o.y, tick: world.tick });
    else if (kind === "zombie" && d <= a.perception.hearingRange * 0.5) a.memory.hear({ id: e, kind, x: o.x, y: o.y, tick: world.tick }, 1);
    if (visible) seen.push({ id: e, kind, x: o.x, y: o.y });
  }
  const tod = timeOfDay(world);
  const view: AgentWorldView = { seen, home, playerName }; fillAgentSensors(world, self, view, (sv?.hunger ?? 100) < 50);
  return {
    self: { x: t.x, y: t.y, facing, hp: hp ? hp.hp / Math.max(1, hp.max) : 1, hunger: (sv?.hunger ?? 100) / 100, thirst: (sv?.thirst ?? 100) / 100, stamina: sv ? sv.stamina / Math.max(1, sv.maxStamina) : 1, tick: world.tick, dayT: tod.t, phase: currentPhaseKey(world) },
    world: view,
  };
}

const toward = (out: { moveX: number; moveY: number; aimX: number; aimY: number }, fx: number, fy: number, tx: number, ty: number, s = 1): number => {
  const dx = tx - fx, dy = ty - fy, d = Math.hypot(dx, dy) || 1; out.moveX = (dx / d) * s; out.moveY = (dy / d) * s; out.aimX = dx / d; out.aimY = dy / d; return d;
};
const night = (p: string): number => (p === "night" ? 1 : p === "dusk" ? 0.6 : 0);

/** Minimal reference set (works end to end today): flee, gather, explore, return_home, rest, greet. */
export function referenceBehaviors(): GameBehavior[] {
  return [
    { name: "flee", chatOnStart: "flee", inertia: 0.3, traits: { bravery: -1.2 },
      considerations: [{ name: "zombieNear", curve: { type: "inverse" }, input: (c) => { const z = c.memory.nearest("zombie", c.self.x, c.self.y, 0.3); return z ? Math.hypot(z.x - c.self.x, z.y - c.self.y) / 12 : 1; } }],
      run: (c, o) => { const z = c.memory.nearest("zombie", c.self.x, c.self.y, 0.3); if (!z) return false; toward(o, z.x, z.y, c.self.x * 2 - z.x, c.self.y * 2 - z.y); o.sprint = c.self.stamina > 0.2; o.aimX = -o.aimX; o.aimY = -o.aimY; } },
    { name: "gather", chatOnStart: "gather", scheduleBonus: 0.25, traits: { industriousness: 0.8, greed: 0.4 },
      considerations: [
        { name: "nodeKnown", curve: { type: "inverse" }, input: (c) => { const n = c.memory.nearest("node", c.self.x, c.self.y); return n ? Math.hypot(n.x - c.self.x, n.y - c.self.y) / 20 : 1; } },
        { name: "daylight", curve: { type: "linear", m: -0.8, b: 1 }, input: (c) => night(c.self.phase) },
      ],
      run: (c, o) => {
        const n = c.memory.nearest("node", c.self.x, c.self.y); if (!n) return false;
        const d = toward(o, c.self.x, c.self.y, n.x, n.y, 0.8);
        if (d < 1.6) { o.moveX = 0; o.moveY = 0; o.actions.push("gather"); if (c.self.tick - c.bb.num("behaviorStart") > 120) { c.memory.items.delete(n.id); return false; } }
      } },
    { name: "explore", scheduleBonus: 0.15, traits: { industriousness: 0.3 },
      considerations: [{ name: "base", curve: { type: "linear", m: 0, b: 0.35 }, input: () => 0 }],
      run: (c, o) => {
        let g = c.bb.get<{ x: number; y: number }>("exploreGoal");
        if (!g || Math.hypot(g.x - c.self.x, g.y - c.self.y) < 1.5) { const a = c.rng.range(-Math.PI, Math.PI), r = c.rng.range(4, 14); g = { x: c.world.home.x + Math.cos(a) * r, y: c.world.home.y + Math.sin(a) * r }; c.bb.set("exploreGoal", g); }
        toward(o, c.self.x, c.self.y, g.x, g.y, 0.7); c.bb.set("facing", Math.atan2(o.aimY, o.aimX));
      } },
    { name: "return_home", chatOnStart: "return_home", scheduleBonus: 0.4,
      considerations: [{ name: "farFromHome", curve: { type: "logistic", k: 10, mid: 0.3 }, input: (c) => Math.hypot(c.world.home.x - c.self.x, c.world.home.y - c.self.y) / 30 }, { name: "evening", curve: { type: "linear", m: 0.8, b: 0.2 }, input: (c) => night(c.self.phase) }],
      run: (c, o) => { if (toward(o, c.self.x, c.self.y, c.world.home.x, c.world.home.y) < 2) return false; } },
    { name: "rest", chatOnStart: "rest", scheduleBonus: 0.3,
      considerations: [{ name: "night", curve: { type: "step", at: 0.5 }, input: (c) => night(c.self.phase) }, { name: "nearHome", curve: { type: "inverse" }, input: (c) => Math.hypot(c.world.home.x - c.self.x, c.world.home.y - c.self.y) / 10 }],
      run: () => { /* stand still (sleep hook: Survival adds a sleep action) */ } },
    { name: "greet", chatOnStart: "greet", traits: { sociability: 1.2 }, inertia: 0,
      considerations: [{ name: "playerSeen", curve: { type: "inverse" }, input: (c) => { const p = c.memory.nearest("player", c.self.x, c.self.y, 0.5); return p ? Math.hypot(p.x - c.self.x, p.y - c.self.y) / 10 : 1; } },
        { name: "notGreetedRecently", curve: { type: "step", at: 0.5 }, input: (c) => (c.self.tick - c.bb.num("greetedAt", -1e9) > 1200 ? 1 : 0) }],
      run: (c, o) => { const p = c.memory.nearest("player", c.self.x, c.self.y); c.bb.set("greetedAt", c.self.tick); if (p) { toward(o, c.self.x, c.self.y, p.x, p.y, 0); o.emote = "wave"; } return false; } },
  ];
}

/** bots.json utility action each behavior answers to (behaviors without one are not biased). */
export const BEHAVIOR_ACTION: Readonly<Record<string, string>> = { flee: "flee", gather: "gather", rest: "sleep", sleep: "sleep", eat: "eat", drink: "eat", craft: "craft", build: "build", stall_trade: "trade" };
const ACTION_BEHAVIOR: Readonly<Record<string, string>> = { sleep: "sleep", trade: "stall_trade" };
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
/** scoreUtilities signals from what the bot perceives: traits + sensors in 0..1. */
export function botSignals(c: AgentContext<AgentWorldView>): Record<string, number> {
  const near = (k: string, r: number): number => { const m = c.memory.nearest(k, c.self.x, c.self.y, 0.3); return m ? clamp01(1 - Math.hypot(m.x - c.self.x, m.y - c.self.y) / r) : 0; };
  const w = c.world;
  return { ...c.traits, enemyNear: Math.max(near("zombie", 12), w.seen.some((s) => s.kind === "animal") ? 0.2 : 0), lowHealth: clamp01(1 - c.self.hp * 2), healthFrac: c.self.hp,
    hunger: clamp01(1 - c.self.hunger), thirst: clamp01(1 - c.self.thirst), fatigue: clamp01(1 - c.self.stamina), isNight: night(c.self.phase) >= 1 ? 1 : 0,
    playerNear: near("player", 10), invSpaceFree: w.invSpaceFree ?? 0.5, hasIngredients: w.craftRecipe !== undefined ? 1 : 0, baseMissing: w.buildPlan ? 1 : 0 };
}
/** Multiplier 0.5..1 from bots.json scoreUtilities for the agent's bot archetype (1 when the archetype is not a bots.json one). */
export function botUtilityFactor(c: AgentContext<AgentWorldView>, behavior: string): number {
  const act = BEHAVIOR_ACTION[behavior]; const arch = c.agent.identity.archetype;
  if (!act || !populationData().bots.archetypes[arch]) return 1;
  return 0.5 + 0.5 * clamp01(scoreUtilities(arch, botSignals(c))[act] ?? 0);
}
const withBotUtility = (b: GameBehavior): GameBehavior => (BEHAVIOR_ACTION[b.name] ? { ...b, considerations: [...b.considerations, { name: "botUtility", curve: { type: "linear", m: 1, b: 0 }, input: (c) => botUtilityFactor(c, b.name) }] } : b);

export function survivorRegistry(extra: readonly GameBehavior[] = []): BehaviorRegistry<AgentWorldView> {
  const r = new BehaviorRegistry<AgentWorldView>(); for (const b of [...referenceBehaviors(), ...survivalBehaviors(), ...extra]) r.register(withBotUtility(b)); return r;
}
/**
 * Deterministic identity for virtual player #slot of a world seed. archetype = a bots.json archetype (picked by the
 * seed when omitted); traits come from rollTraits within that archetype's ranges, goals from its goal weights.
 */
export function makeAgentIdentity(seed: number, slot: number, archetype?: string): AgentIdentity {
  const rng = new Rng((seed * 2654435761 + slot * 40503) >>> 0); const bots = populationData().bots; const keys = Object.keys(bots.archetypes);
  const arch = archetype ?? keys[rng.int(0, keys.length)]!; const b = bots.archetypes[arch]; if (!b) throw new Error(`unknown bot archetype ${arch}`);
  const name = AGENTS_DATA.names[(slot + rng.int(0, AGENTS_DATA.names.length)) % AGENTS_DATA.names.length]!;
  const goals = Object.entries(b.goals).sort((x, y) => y[1] - x[1]).map(([g]) => ({ name: g, progress: 0 }));
  return { id: `bot-${seed}-${slot}`, name, relationship: 0, traits: rollTraits(arch, () => rng.next()), archetype: arch, goals };
}
/** Agent from an identity: bots.json archetypes use their routine (as behavior names) + imperfections; others agents.json. */
export function makeAgent(identity: AgentIdentity, seed: number, tickHz = 20): Agent {
  const base = AGENTS_DATA.archetypes[identity.archetype] ?? AGENTS_DATA.archetypes["survivor"]!;
  const bots = populationData().bots; const b = bots.archetypes[identity.archetype];
  const schedule = b ? bots.routines[b.routine]!.map((s) => ({ ...s, prefer: s.prefer.map((p) => ACTION_BEHAVIOR[p] ?? p) })) : base.schedule;
  return new Agent(identity, seed, { perception: base.perception, imperfections: b ? b.imperfections : base.imperfections, schedule, chatMinSeconds: base.chatMinSeconds, tickHz });
}
/**
 * The survivor AgentController. Each output's buy, use, craft, place and stall-open actions become AgentOutput.commands
 * through emitAgentCommands. Set opts.commands to false to keep them as action strings only.
 */
export function survivorController(opts: { seed: number; thinkBudget?: number; thinkEvery?: number; extra?: readonly GameBehavior[]; chat?: ConstructorParameters<typeof AgentController<AgentWorldView>>[0]["chat"]; commands?: boolean }): AgentController<AgentWorldView> {
  const rng = new Rng(opts.seed ^ 0x5bd1e995);
  const ctl = makeSurvivorController(opts, rng);
  if (opts.commands === false) return ctl;
  const tick = ctl.tick.bind(ctl);
  ctl.tick = (t, view) => { const outs = tick(t, view); for (const o of outs.values()) emitAgentCommands(o); return outs; };
  return ctl;
}
function makeSurvivorController(opts: Parameters<typeof survivorController>[0], rng: Rng): AgentController<AgentWorldView> {
  return new AgentController<AgentWorldView>({ behaviors: survivorRegistry(opts.extra), chat: opts.chat ?? new ChatTemplates(AGENTS_DATA.chat, () => rng.next()), thinkBudget: opts.thinkBudget ?? 4, thinkEvery: opts.thinkEvery ?? 10 });
}
