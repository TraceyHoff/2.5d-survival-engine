/**
 * AgentOutput (core ai.ts) -> the inputs a human sends. Pure except applyAgentEmote (queues an emote request).
 * Action strings: "gather" | "gather:<target>" | "attack:<target>" | "eat:<slot>" | "drink:<slot>" | "craft:<recipe>[:<count>]"
 * | "build:<piece>:<x>:<y>" | "open:<target>" | "buy:<stall>:<slot>:<qty>:<revision>:<priceItem>:<priceCount>" | "sleep" (stand still).
 */
import type { AgentOutput, CommandRegistry, Entity, InputFrame, World } from "@engine/core";
import { intentToFrame, type BotIntent } from "./bot_input.js";
import { GameplayActions } from "../input.js";
import { requestEmote } from "../expression.js";

export function actionIntent(action: string): BotIntent | undefined {
  const [k, ...rest] = action.split(":"); const n = rest.map(Number); if (n.some((v) => !Number.isFinite(v))) return undefined;
  switch (k) {
    case "gather": return { kind: "gather", target: n[0] ?? 0 };
    case "attack": return n.length >= 1 ? { kind: "attack", target: n[0]! } : undefined;
    case "eat": case "drink": return n.length >= 1 ? { kind: "eat", slot: n[0]! } : undefined;
    case "craft": return n.length >= 1 ? { kind: "craft", recipe: n[0]!, count: n[1] ?? 1 } : undefined;
    case "build": return n.length >= 3 ? { kind: "build", piece: n[0]!, x: n[1]!, y: n[2]! } : undefined;
    case "open": return n.length >= 1 ? { kind: "open", target: n[0]! } : undefined;
    case "buy": return n.length >= 6 ? { kind: "buy", stall: n[0]!, listingSlot: n[1]!, qty: n[2]!, expectedRevision: n[3]!, expectedPriceItem: n[4]!, expectedPriceCount: n[5]! } : undefined;
    default: return undefined;
  }
}
/** Actions -> intents (unknown / malformed actions dropped). */
export const agentOutputIntents = (out: AgentOutput): BotIntent[] => out.actions.map(actionIntent).filter((x): x is BotIntent => x !== undefined);

/**
 * One InputFrame for an AgentOutput via intentToFrame: move (+sprint) with the output's aim, then each action's bits and
 * commands merged in. Target 0 gathers (Primary bit, no command): the bot hits whatever is in front, like a human.
 */
export function agentOutputFrame(out: AgentOutput, tick: number, reg: CommandRegistry): InputFrame {
  const aim = out.aimX || out.aimY ? { x: out.aimX, y: out.aimY } : undefined;
  const f = intentToFrame({ kind: "move", dx: out.moveX, dy: out.moveY, sprint: out.sprint }, tick, reg, aim);
  if (!out.moveX && !out.moveY) f.actions |= out.sprint ? GameplayActions.Sprint : 0;
  for (const it of agentOutputIntents(out)) {
    const g = intentToFrame(it, tick, reg, aim); f.actions |= g.actions;
    for (const c of g.commands) if (!(it.kind === "gather" && it.target === 0)) f.commands.push(c);
  }
  return f;
}
/**
 * Bot-side emote: AgentOutput.emote -> requestEmote on the bot's authoritative entity (the host that owns the
 * server world calls this once per agent tick). Skipped while replaying; unknown names ignored. Returns true if queued.
 */
export function applyAgentEmote(world: World, e: Entity, out: AgentOutput): boolean {
  if (!out.emote || world.isReplaying) return false;
  return requestEmote(world, e, out.emote);
}
