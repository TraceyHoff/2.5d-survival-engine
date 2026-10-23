/**
 * Data-only spawn tables, per-archetype behavior and human-bot steering data (data/spawns.json, ai.json, bots.json).
 * Gameplay owns no spawn loop or controller: an external PopulationSpawner / AgentController consumes these.
 * Validators return error strings (empty = valid); loaders throw on invalid data. Browser-safe, pure.
 */
import spawnsRaw from "../../data/spawns.json";
import aiRaw from "../../data/ai.json";
import botsRaw from "../../data/bots.json";
import zombiesRaw from "../../data/zombies.json";
import itemsRaw from "../../data/items.json";

export type SpawnPhase = "night" | "dawn" | "day" | "dusk";
export const DAY_PHASES: readonly SpawnPhase[] = ["night", "dawn", "day", "dusk"];
export type GameMode = "sp" | "mp";
export type SpawnCategory = "zombies" | "animals" | "humans";
export type PhaseRecord = Record<SpawnPhase, number>;
export interface SpawnEntry {
  archetype: string; fromZombies?: boolean; densityPerChunk: number; phaseMul?: PhaseRecord; biomeWeights: Record<string, number>;
  group: { min: number; max: number; spread: number }; modes: Record<GameMode, boolean>; capPerChunk: number; globalCap: number;
}
export interface SpawnData {
  chunkTiles: number; phases: string[]; biomes: Record<string, number>;
  modes: Record<GameMode, { densityMul: number; capMul: number }>; tables: Record<SpawnCategory, SpawnEntry[]>;
}
export type AggroMode = "hostile" | "territorial" | "defensive" | "passive";
export interface Perception { sightRange: number; hearingMul: number; fovDeg: number }
export interface AttackData { damage: number; range: number; cooldownSeconds: number; structureDamage?: number }
export interface LootEntry { item: string; min: number; max: number; chance: number }
export interface ArchetypeBehavior {
  kind: "zombie" | "animal" | "human"; fromZombies?: boolean; hp?: number; speed?: number; perception?: Perception;
  aggro: { mode: AggroMode; range: number; leashRange: number }; flee: { hpFrac: number; range: number };
  wander: { radius: number; idleSeconds: [number, number] }; attack?: AttackData | null; loot: LootEntry[];
}
export interface AiData { archetypes: Record<string, ArchetypeBehavior> }
/** Fully resolved behavior (zombie fields merged from zombies.json). */
export interface ResolvedBehavior extends ArchetypeBehavior { hp: number; speed: number; perception: Perception; attack: AttackData | null }

export type Range = [number, number];
export interface Consideration { base: number; inputs: Record<string, number> }
export interface BotArchetype {
  role: string; traits: Record<string, Range>; routine: string; goals: { base: number; gear: number; food: number };
  imperfection: { reactionDelayTicks: Range; aimErrorDeg: number; idleLookChancePerSec: number; idleLookSeconds: Range };
  chat: Record<string, string[]>; utility: Record<string, Consideration>;
}
export interface BotData {
  traits: string[]; actions: string[]; situations: string[];
  routines: Record<string, { phase: SpawnPhase; activity: string }[]>; archetypes: Record<string, BotArchetype>;
}

type Z = { zombies: { key: string; hp: number; speed: number; damage: number; structureDamage: number; attackRange: number; attackCooldownSeconds: number; sightRange: number; hearingMul: number }[];
  spawning: { ratePerMinute: PhaseRecord; cap: PhaseRecord; weights: PhaseRecord extends never ? never : Record<SpawnPhase, number[]> } };
const ZOMBIES = zombiesRaw as unknown as Z;
const ITEM_KEYS = new Set((itemsRaw as unknown as { items: { key: string }[] }).items.map((i) => i.key));

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const nonNeg = (v: unknown): boolean => num(v) && v >= 0;
const frac = (v: unknown): boolean => num(v) && v >= 0 && v <= 1;
const range = (v: unknown, ok: (n: unknown) => boolean): boolean => Array.isArray(v) && v.length === 2 && ok(v[0]) && ok(v[1]) && (v[0] as number) <= (v[1] as number);

export function validateSpawnData(d: SpawnData, ai: AiData = aiRaw as unknown as AiData): string[] {
  const err: string[] = [];
  if (!(num(d.chunkTiles) && d.chunkTiles > 0)) err.push("chunkTiles must be > 0");
  for (const m of ["sp", "mp"] as const) if (!d.modes?.[m] || !nonNeg(d.modes[m].densityMul) || !nonNeg(d.modes[m].capMul)) err.push(`modes.${m} invalid`);
  const zKeys = new Set(ZOMBIES.zombies.map((z) => z.key)); const seen = new Set<string>();
  for (const cat of ["zombies", "animals", "humans"] as const) {
    const t = d.tables?.[cat]; if (!Array.isArray(t)) { err.push(`tables.${cat} missing`); continue; }
    for (const e of t) {
      const p = `${cat}.${e.archetype}`;
      if (seen.has(e.archetype)) err.push(`${p}: duplicate`); seen.add(e.archetype);
      if (!ai.archetypes[e.archetype]) err.push(`${p}: no behavior in ai.json`);
      if (e.fromZombies) { if (!zKeys.has(e.archetype)) err.push(`${p}: fromZombies but not in zombies.json`); }
      else if (!e.phaseMul || DAY_PHASES.some((ph) => !nonNeg(e.phaseMul![ph]))) err.push(`${p}: phaseMul needs night/dawn/day/dusk >= 0`);
      if (!nonNeg(e.densityPerChunk)) err.push(`${p}: densityPerChunk`);
      const bw = Object.entries(e.biomeWeights ?? {});
      if (!bw.length) err.push(`${p}: biomeWeights empty`);
      for (const [b, w] of bw) { if (!(b in d.biomes)) err.push(`${p}: unknown biome ${b}`); if (!nonNeg(w)) err.push(`${p}: biome weight ${b}`); }
      const g = e.group; if (!g || !(Number.isInteger(g.min) && g.min >= 1 && Number.isInteger(g.max) && g.max >= g.min && nonNeg(g.spread))) err.push(`${p}: group`);
      if (!(Number.isInteger(e.capPerChunk) && e.capPerChunk >= 1 && Number.isInteger(e.globalCap) && e.globalCap >= e.capPerChunk)) err.push(`${p}: caps`);
      if (g && e.capPerChunk < g.min) err.push(`${p}: capPerChunk below group.min`);
      if (typeof e.modes?.sp !== "boolean" || typeof e.modes?.mp !== "boolean") err.push(`${p}: modes`);
      if (cat === "humans" && e.modes?.mp) err.push(`${p}: human bots must be disabled in mp`);
    }
  }
  return err;
}

export function validateAiData(d: AiData): string[] {
  const err: string[] = []; const zKeys = new Set(ZOMBIES.zombies.map((z) => z.key));
  for (const [k, a] of Object.entries(d.archetypes ?? {})) {
    if (!["zombie", "animal", "human"].includes(a.kind)) err.push(`${k}: kind`);
    if (a.fromZombies) { if (!zKeys.has(k)) err.push(`${k}: fromZombies but not in zombies.json`); }
    else {
      if (!(num(a.hp) && a.hp > 0) || !(num(a.speed) && a.speed > 0)) err.push(`${k}: hp/speed`);
      const pc = a.perception; if (!pc || !nonNeg(pc.sightRange) || !nonNeg(pc.hearingMul) || !(num(pc.fovDeg) && pc.fovDeg > 0 && pc.fovDeg <= 360)) err.push(`${k}: perception`);
      if (a.attack != null && (!(num(a.attack.damage) && a.attack.damage > 0) || !(num(a.attack.range) && a.attack.range > 0) || !(num(a.attack.cooldownSeconds) && a.attack.cooldownSeconds > 0))) err.push(`${k}: attack`);
    }
    if (!["hostile", "territorial", "defensive", "passive"].includes(a.aggro?.mode)) err.push(`${k}: aggro.mode`);
    if (!nonNeg(a.aggro?.range) || !nonNeg(a.aggro?.leashRange) || (a.aggro.mode !== "passive" && a.aggro.leashRange < a.aggro.range)) err.push(`${k}: aggro ranges`);
    if (a.aggro?.mode !== "passive" && !a.fromZombies && !a.attack) err.push(`${k}: aggressive archetype needs attack`);
    if (!frac(a.flee?.hpFrac) || !nonNeg(a.flee?.range)) err.push(`${k}: flee`);
    if (!nonNeg(a.wander?.radius) || !range(a.wander?.idleSeconds, nonNeg)) err.push(`${k}: wander`);
    for (const l of a.loot ?? []) {
      if (!ITEM_KEYS.has(l.item)) err.push(`${k}: unknown loot item ${l.item}`);
      if (!(Number.isInteger(l.min) && l.min >= 0 && Number.isInteger(l.max) && l.max >= l.min) || !frac(l.chance)) err.push(`${k}: loot ${l.item}`);
    }
  }
  return err;
}

export function validateBotData(d: BotData, ai: AiData = aiRaw as unknown as AiData): string[] {
  const err: string[] = []; const acts = new Set(d.actions); const activities = new Set([...d.actions, "wander"]);
  for (const [r, steps] of Object.entries(d.routines ?? {})) {
    const phases = new Set(steps.map((s) => s.phase));
    if (DAY_PHASES.some((p) => !phases.has(p)) || phases.size !== steps.length) err.push(`routine ${r}: needs each day phase exactly once`);
    for (const s of steps) if (!activities.has(s.activity)) err.push(`routine ${r}: unknown activity ${s.activity}`);
  }
  for (const [k, b] of Object.entries(d.archetypes ?? {})) {
    if (ai.archetypes[k]?.kind !== "human") err.push(`${k}: needs a human behavior in ai.json`);
    for (const t of d.traits) if (!range(b.traits?.[t], frac)) err.push(`${k}: trait ${t} range`);
    for (const t of Object.keys(b.traits ?? {})) if (!d.traits.includes(t)) err.push(`${k}: unknown trait ${t}`);
    if (!d.routines[b.routine]) err.push(`${k}: unknown routine ${b.routine}`);
    const g = b.goals; if (!g || ![g.base, g.gear, g.food].every(frac) || Math.abs(g.base + g.gear + g.food - 1) > 1e-6) err.push(`${k}: goals must be 0..1 and sum to 1`);
    const im = b.imperfection;
    if (!im || !range(im.reactionDelayTicks, (n) => Number.isInteger(n) && (n as number) >= 0) || !(num(im.aimErrorDeg) && im.aimErrorDeg >= 0 && im.aimErrorDeg <= 90)
      || !frac(im.idleLookChancePerSec) || !range(im.idleLookSeconds, nonNeg)) err.push(`${k}: imperfection`);
    for (const s of d.situations) { const lines = b.chat?.[s]; if (!Array.isArray(lines) || !lines.length || lines.some((l) => typeof l !== "string" || !/^[a-z0-9_.]+$/i.test(l))) err.push(`${k}: chat ${s} needs text keys`); }
    for (const s of Object.keys(b.chat ?? {})) if (!d.situations.includes(s)) err.push(`${k}: unknown chat situation ${s}`);
    for (const a of d.actions) { const c = b.utility?.[a]; if (!c || !num(c.base) || Object.values(c.inputs ?? {}).some((w) => !num(w))) err.push(`${k}: utility ${a}`); }
    for (const a of Object.keys(b.utility ?? {})) if (!acts.has(a)) err.push(`${k}: unknown utility action ${a}`);
  }
  return err;
}

const must = (what: string, errs: string[]): void => { if (errs.length) throw new Error(`${what} invalid:\n  ${errs.join("\n  ")}`); };
export function loadPopulationData(raw: { spawns?: unknown; ai?: unknown; bots?: unknown } = {}): { spawns: SpawnData; ai: AiData; bots: BotData } {
  const ai = (raw.ai ?? aiRaw) as AiData, spawns = (raw.spawns ?? spawnsRaw) as SpawnData, bots = (raw.bots ?? botsRaw) as BotData;
  must("ai.json", validateAiData(ai)); must("spawns.json", validateSpawnData(spawns, ai)); must("bots.json", validateBotData(bots, ai));
  return { spawns, ai, bots };
}
let cached: ReturnType<typeof loadPopulationData> | undefined;
export const populationData = (): ReturnType<typeof loadPopulationData> => (cached ??= loadPopulationData());

/** Zombie fields come from zombies.json; others pass through. */
export function resolveBehavior(key: string, ai: AiData = populationData().ai): ResolvedBehavior {
  const a = ai.archetypes[key]; if (!a) throw new Error(`unknown archetype ${key}`);
  if (!a.fromZombies) return { ...a, hp: a.hp!, speed: a.speed!, perception: a.perception!, attack: a.attack ?? null };
  const z = ZOMBIES.zombies.find((q) => q.key === key)!;
  return { ...a, hp: z.hp, speed: z.speed, perception: { sightRange: z.sightRange, hearingMul: z.hearingMul, fovDeg: 360 },
    attack: { damage: z.damage, range: z.attackRange, cooldownSeconds: z.attackCooldownSeconds, structureDamage: z.structureDamage } };
}

/** Phase multiplier: explicit phaseMul, or (zombies) zombies.json ratePerMinute x weight share normalized so night of the walker = 1. */
export function phaseMultiplier(e: SpawnEntry, phase: SpawnPhase): number {
  if (!e.fromZombies) return e.phaseMul![phase];
  const i = ZOMBIES.zombies.findIndex((z) => z.key === e.archetype); const s = ZOMBIES.spawning;
  const share = (ph: SpawnPhase): number => { const w = s.weights[ph]; const t = w.reduce((a, b) => a + b, 0); return t > 0 ? (w[i] ?? 0) / t : 0; };
  const ref = s.ratePerMinute.night * share("night") || 1;
  return (s.ratePerMinute[phase] * share(phase)) / ref;
}

/** Target live count for one chunk (spawner input). 0 when disabled for the mode or biome. */
export function chunkTarget(e: SpawnEntry, biomeTile: number, phase: SpawnPhase, mode: GameMode, d: SpawnData = populationData().spawns): number {
  if (!e.modes[mode]) return 0;
  const biome = Object.keys(d.biomes).find((b) => d.biomes[b] === biomeTile); const bw = biome ? e.biomeWeights[biome] ?? 0 : 0;
  const raw = e.densityPerChunk * bw * phaseMultiplier(e, phase) * d.modes[mode].densityMul;
  return Math.min(raw, capFor(e, mode, d).perChunk);
}
export function capFor(e: SpawnEntry, mode: GameMode, d: SpawnData = populationData().spawns): { perChunk: number; global: number } {
  const m = d.modes[mode].capMul; return { perChunk: Math.max(1, Math.floor(e.capPerChunk * m)), global: Math.max(1, Math.floor(e.globalCap * m)) };
}
/** All entries enabled in a mode (game-mode config hook). */
export function entriesForMode(mode: GameMode, d: SpawnData = populationData().spawns): { category: SpawnCategory; entry: SpawnEntry }[] {
  return (["zombies", "animals", "humans"] as const).flatMap((category) => d.tables[category].filter((e) => e.modes[mode]).map((entry) => ({ category, entry })));
}
/** Routine activity for a phase. */
export function routineActivity(archetype: string, phase: SpawnPhase, b: BotData = populationData().bots): string {
  const a = b.archetypes[archetype]; if (!a) throw new Error(`unknown bot ${archetype}`);
  return b.routines[a.routine]!.find((s) => s.phase === phase)!.activity;
}
/** Roll traits in range from a caller-supplied rng (pass world.rngFor(...) - never Math.random). */
export function rollTraits(archetype: string, rand: () => number, b: BotData = populationData().bots): Record<string, number> {
  const a = b.archetypes[archetype]; if (!a) throw new Error(`unknown bot ${archetype}`);
  return Object.fromEntries(b.traits.map((t) => { const [lo, hi] = a.traits[t]!; return [t, lo + (hi - lo) * rand()]; }));
}
/** Score each utility action: base + sum(weight * signal), signals = traits + sensors (0..1; missing = 0). */
export function scoreUtilities(archetype: string, signals: Record<string, number>, b: BotData = populationData().bots): Record<string, number> {
  const a = b.archetypes[archetype]; if (!a) throw new Error(`unknown bot ${archetype}`);
  return Object.fromEntries(b.actions.map((act) => { const c = a.utility[act]!; let s = c.base; for (const [k, w] of Object.entries(c.inputs)) s += w * (signals[k] ?? 0); return [act, s]; }));
}
