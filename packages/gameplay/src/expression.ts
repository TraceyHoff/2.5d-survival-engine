/**
 * Face expressions (Expression component, networked + broadcast, not persisted, separate from Appearance).
 * gameplay.expression (authority) writes it from moods (data/expressions.json, first match wins) and emotes
 * (EmoteCmd from players/bots, or requestEmote from host code such as bot AgentOutput.emote). An emote beats
 * moods until untilTick. id = expressions index + 1 (0 = none); expressionKey() gives Render's resolveLayers key.
 */
import { defineCommand, defineResource, DEFAULT_TICK_HZ, type CommandHandlers, type Entity, type World } from "@engine/core";
import raw from "../data/expressions.json";
import { Animal, Dead, Expression, Health, Survival } from "./components.js";
import { isAuthority } from "./config.js";

export type MoodSensor = "lowHealth" | "fleeing" | "hungry" | "thirsty" | "tired";
export interface MoodRule { when: MoodSensor; below?: number; expression: string; holdSeconds: number }
export interface ExpressionData { expressions: string[]; moods: MoodRule[]; emotes: Record<string, { expression: string; seconds: number }> }
export const EXPRESSION_DATA: ExpressionData = raw as unknown as ExpressionData;
export const EXPRESSION_EVERY = 5;
const FLEE_STATE = 2; // AnimalState.Flee

export function validateExpressionData(d: ExpressionData): string[] {
  const errs: string[] = []; const known = new Set(d.expressions);
  if (d.expressions.length > 254) errs.push("too many expressions (u8)");
  for (const m of d.moods) if (!known.has(m.expression)) errs.push(`mood ${m.when}: unknown expression ${m.expression}`);
  for (const [k, e] of Object.entries(d.emotes)) { if (!known.has(e.expression)) errs.push(`emote ${k}: unknown expression ${e.expression}`); if (!(e.seconds > 0)) errs.push(`emote ${k}: seconds`); }
  return errs;
}
export const expressionId = (key: string): number => EXPRESSION_DATA.expressions.indexOf(key) + 1;
export const expressionKey = (id: number): string => EXPRESSION_DATA.expressions[id - 1] ?? "";
/** Emote ids for the net chat u16 / EmoteCmd: index into Object.keys(emotes) + 1. */
export const emoteNames = (): string[] => Object.keys(EXPRESSION_DATA.emotes);
export const emoteId = (name: string): number => emoteNames().indexOf(name) + 1;

export const EmoteCmd = defineCommand("gameplay.emote", { emote: "u16" });
export const EXPRESSION_COMMANDS = [EmoteCmd] as const;
/** Pending emotes (entity -> emote id), drained by the expression system. */
export const EmoteRequests = defineResource<Map<Entity, number>>("gameplay.EmoteRequests");
const requests = (w: World): Map<Entity, number> => { let m = w.getResource(EmoteRequests); if (!m) { m = new Map(); w.setResource(EmoteRequests, m); } return m; };
export function requestEmote(world: World, e: Entity, emote: number | string): boolean {
  const id = typeof emote === "string" ? emoteId(emote) : emote; if (id < 1 || id > emoteNames().length) return false;
  requests(world).set(e, id); return true;
}
export function installExpressionCommands(world: World, handlers: CommandHandlers): void {
  handlers.on(EmoteCmd, { validate: (v) => (v.emote >= 1 && v.emote <= emoteNames().length ? undefined : "bad_emote"), handle: (v, c) => { requestEmote(world, c.actor, v.emote); } });
}

function mood(world: World, e: Entity): MoodRule | undefined {
  const h = world.get(e, Health), s = world.get(e, Survival), a = world.get(e, Animal);
  for (const m of EXPRESSION_DATA.moods) {
    const b = m.below ?? 0;
    if (m.when === "lowHealth" && h && h.max > 0 && h.hp / h.max < b) return m;
    if (m.when === "fleeing" && a && a.state === FLEE_STATE) return m;
    if (m.when === "hungry" && s && s.hunger < b) return m;
    if (m.when === "thirsty" && s && s.thirst < b) return m;
    if (m.when === "tired" && s && s.maxStamina > 0 && s.stamina / s.maxStamina < b) return m;
  }
  return undefined;
}

/** Server-side emote expiry (not replicated; the component only carries id + untilTick). */
const EmoteUntil = defineResource<Map<Entity, number>>("gameplay.EmoteUntil");

export function expressionSystem(world: World): void {
  if (!isAuthority(world)) return;
  const tick = world.tick; const req = requests(world); const emotes = emoteNames();
  let emoteUntil = world.getResource(EmoteUntil); if (!emoteUntil) { emoteUntil = new Map(); world.setResource(EmoteUntil, emoteUntil); }
  const ents = new Set<Entity>([...world.query([Survival], [Dead]), ...world.query([Animal], [Dead]), ...world.query([Expression])]);
  for (const e of [...ents].sort((a, b) => a - b)) {
    if (!world.isAlive(e)) { emoteUntil.delete(e); continue; }
    const cur = world.get(e, Expression); const r = req.get(e);
    let id = 0, until = 0;
    if (r !== undefined) {
      const em = EXPRESSION_DATA.emotes[emotes[r - 1]!]!; id = expressionId(em.expression); until = tick + Math.round(em.seconds * DEFAULT_TICK_HZ); emoteUntil.set(e, until);
    } else if ((emoteUntil.get(e) ?? 0) > tick) continue; // emote showing
    else {
      emoteUntil.delete(e);
      const m = world.has(e, Dead) ? undefined : mood(world, e);
      if (m) {
        id = expressionId(m.expression);
        if (cur && cur.id === id && cur.untilTick > tick + EXPRESSION_EVERY) continue; // still held; avoid churn
        until = tick + Math.round(m.holdSeconds * DEFAULT_TICK_HZ) + EXPRESSION_EVERY;
      }
    }
    if (!cur) { if (id) world.add(e, Expression, { id, untilTick: until }); continue; }
    if (!id) { if (cur.id && cur.untilTick <= tick) world.set(e, Expression, { id: 0, untilTick: 0 }); continue; }
    if (cur.id !== id || cur.untilTick !== until) world.set(e, Expression, { id, untilTick: until });
  }
  req.clear();
}
