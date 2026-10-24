/**
 * ADR-126: "what tool does this need?" hint over the nearest resource node (pure; the client draws it).
 * Source of truth: resources.json requiredTool / minTier and the bareHands block (ADR-107).
 * - requiredTool none, or a tool node fists can work (bareHands) and the player owns no fitting tool: "hand".
 * - player owns a fitting tool (equipped or anywhere in the inventory): that tool, best tier first, `have` true.
 * - otherwise: the required tool with `have` false (drawn greyed with a lock).
 */
import { Transform, type Entity, type World } from "@engine/core";
import { Dead, Equipment, Inventory, NO_SLOT, ResourceNode } from "./components.js";
import { gameplayDefs } from "./config.js";
import { ToolKind, type GameDefs } from "./defs.js";
import { listSlots } from "./inventory.js";
import { bareHandsCan } from "./systems/gathering.js";

/** Icon names, also the art keys `ui/tool_req_<name>.png` (Art & Assets). hoe / sickle are reserved for future nodes. */
export const TOOL_REQ_ICONS = ["hand", "axe", "pickaxe", "shovel", "hoe", "knife", "sickle"] as const;
export type ToolReqIcon = (typeof TOOL_REQ_ICONS)[number];
export const toolReqIconPath = (icon: ToolReqIcon): string => `ui/tool_req_${icon}.png`;
const KIND_ICON: Record<number, ToolReqIcon> = { [ToolKind.None]: "hand", [ToolKind.Axe]: "axe", [ToolKind.Pickaxe]: "pickaxe", [ToolKind.Shovel]: "shovel", [ToolKind.Knife]: "knife" };
/** Default show radius in tiles. */
export const TOOL_HINT_RADIUS = 1.5;

export interface ToolHint {
  node: Entity; x: number; y: number; resource: string;
  icon: ToolReqIcon; /** tier the node needs (0 = none) */ minTier: number;
  /** the player can gather it now with this icon's tool (owned, or fists) */ have: boolean;
  /** the fitting tool is in the main hand (or fists suffice) */ equipped: boolean;
  /** fists work, at bareHands.yieldMul (e.g. 25%) */ bare: boolean; label: string;
}

/** Best owned tool of `kind` with tier >= minTier: tier and whether it is the main-hand slot. */
export function bestOwnedTool(world: World, e: Entity, defs: GameDefs, kind: ToolKind, minTier: number): { tier: number; equipped: boolean } | undefined {
  if (!world.has(e, Inventory)) return undefined;
  const main = world.getField(e, Equipment, "mainHandSlot") ?? NO_SLOT;
  let best: { tier: number; equipped: boolean } | undefined;
  for (const s of listSlots(world, e)) {
    const t = defs.items.get(s.item)?.tool; if (!t || t.kind !== kind || t.tier < minTier) continue;
    const eq = s.slot === main;
    if (!best || t.tier > best.tier || (t.tier === best.tier && eq)) best = { tier: t.tier, equipped: eq };
  }
  return best;
}

const name = (s: string): string => s.replace(/_/g, " ");
/** Hint for one node definition (exported for tests / tooling). */
export function toolHintFor(world: World, e: Entity, defs: GameDefs, def: { key: string; requiredTool: ToolKind; minTier: number }): Omit<ToolHint, "node" | "x" | "y"> {
  const base = { resource: def.key, minTier: def.minTier };
  if (def.requiredTool === ToolKind.None) return { ...base, icon: "hand", have: true, equipped: true, bare: true, label: `${name(def.key)}: bare hands` };
  const icon = KIND_ICON[def.requiredTool] ?? "hand"; const owned = bestOwnedTool(world, e, defs, def.requiredTool, def.minTier);
  const tierTxt = def.minTier > 1 ? ` (tier ${def.minTier}+)` : "";
  if (owned) return { ...base, icon, have: true, equipped: owned.equipped, bare: false, label: `${name(def.key)}: ${icon}${tierTxt}${owned.equipped ? "" : " — equip it"}` };
  if (bareHandsCan(defs, def)) return { ...base, icon: "hand", have: true, equipped: true, bare: true, label: `${name(def.key)}: bare hands (${Math.round(defs.bareHands.yieldMul * 100)}% yield; ${icon} for full)` };
  return { ...base, icon, have: false, equipped: false, bare: false, label: `${name(def.key)}: needs ${icon}${tierTxt}` };
}

/** Nearest non-depleted resource node within `radius` tiles of the player, with its tool hint. */
export function toolHint(world: World, e: Entity, radius = TOOL_HINT_RADIUS): ToolHint | undefined {
  const t = world.get(e, Transform); if (!t || world.has(e, Dead)) return undefined;
  const defs = gameplayDefs(world);
  let best: Entity | undefined, bd = radius * radius, bx = 0, by = 0;
  for (const n of world.query([ResourceNode, Transform])) {
    const nt = world.get(n, Transform)!; const d = (nt.x - t.x) ** 2 + (nt.y - t.y) ** 2;
    if (d > bd || world.getField(n, ResourceNode, "amount") === 0) continue;
    bd = d; best = n; bx = nt.x; by = nt.y;
  }
  if (best === undefined) return undefined;
  const def = defs.resources.get(world.getField(best, ResourceNode, "kind")!); if (!def) return undefined;
  return { node: best, x: bx, y: by, ...toolHintFor(world, e, defs, def) };
}
