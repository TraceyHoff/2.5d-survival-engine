/**
 * AgentOutput (core ai.ts) -> the inputs a human sends. Pure except applyAgentEmote (queues an emote request).
 * Action strings: "gather" | "gather:<target>" | "attack:<target>" | "eat:<slot>" | "drink:<slot>" | "craft:<recipe>[:<count>]"
 * | "build:<piece>:<x>:<y>" | "open:<target>" | "buy:<stall>:<slot>:<qty>:<revision>:<priceItem>:<priceCount>" | "sleep" (stand still).
 */
import type { AgentOutput, CommandRegistry, Entity, InputFrame, World } from "@engine/core";
import { intentToFrame, type BotIntent } from "./bot_input.js";
import { GameplayActions, PlaceCmd, UseCmd } from "../input.js";
import { BuyFromStallCmd, OpenStallCmd } from "../economy/stall.js";
import { QueueCraftCmd } from "../systems/craft_queue.js";
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

// ---------------- AgentOutput.commands (net command path) ----------------
/** One discrete command by registered (net) command name; matches core AgentOutput.commands entries. */
export interface AgentCommand { type: string; payload: unknown }
/** Structural view of AgentOutput with the commands field. Kept so gameplay compiles against a core without it. */
export type AgentOutputWithCommands = AgentOutput & { commands?: AgentCommand[] };

/** Action string -> a net command (buy, use, craft, place, plus open of a stall). Other actions return undefined and stay frame-only. */
/** Entity fields hold the bot's replica entity; the host (local.ts sendAgentCommands -> NetClient.sendCommand) maps them to NetIds. */
export function actionCommand(action: string): AgentCommand | undefined {
  const it = actionIntent(action); if (!it) return undefined;
  switch (it.kind) {
    case "eat": return { type: UseCmd.name, payload: { slot: it.slot } };
    case "craft": return { type: QueueCraftCmd.name, payload: { recipe: it.recipe, count: Math.max(1, Math.min(255, it.count ?? 1)) } }; // CraftCmd is not on the wire
    case "build": return { type: PlaceCmd.name, payload: { piece: it.piece, x: it.x, y: it.y, level: it.level ?? 0, rot: it.rot ?? 0, tier: it.tier ?? 0, variant: it.variant ?? 0 } };
    case "open": return { type: OpenStallCmd.name, payload: { stall: it.target } };
    case "buy": return { type: BuyFromStallCmd.name, payload: { stall: it.stall, listingSlot: it.listingSlot, qty: it.qty, expectedRevision: it.expectedRevision, expectedPriceItem: it.expectedPriceItem, expectedPriceCount: it.expectedPriceCount } };
    default: return undefined;
  }
}
const COMMAND_ACTIONS = new Set(["eat", "drink", "craft", "build", "open", "buy"]);
/**
 * Moves the command-type actions (eat, drink, craft, build, open, buy) out of out.actions and into out.commands, in order.
  Movement and gather/attack/sleep stay
 * as actions for the input frame. Mutates and returns out.
 */
export function emitAgentCommands<O extends AgentOutputWithCommands>(out: O): O {
  const keep: string[] = [];
  for (const a of out.actions) {
    if (!COMMAND_ACTIONS.has(a.split(":")[0]!)) { keep.push(a); continue; }
    const c = actionCommand(a); if (c) (out.commands ??= []).push(c);
  }
  out.actions = keep; return out;
}
