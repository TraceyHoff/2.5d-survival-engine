/**
 * Input: action bits (core defineActions) and commands (core defineCommand). Net decodes frames, resolves
 * NetId-typed fields (COMMAND_ENTITY_FIELDS) to local Entities, rate-limits, and calls applyGameplayInput in the
 * input phase. Gameplay queues commands per entity and turns ONE per tick into PlayerIntent (so a burst of commands
 * is processed in order over consecutive ticks, identically on server and predicting client).
 */
import { PARTY_COMMANDS } from "./party.js";
import { CLAN_COMMANDS, ClanDeclineCmd } from "./clan.js";
import { CommandRegistry, defineActions, defineCommand, defineResource, type Command, type CommandDef, type Entity, type InputFrame, type World } from "@engine/core";
import { IntentAction, PlayerIntent } from "./components.js";
import { CUSTOMIZATION_COMMANDS } from "./customization.js";
import { PVP_COMMANDS } from "./combat/pvp.js";
import { CancelQueuedCraftCmd, CRAFT_QUEUE_COMMANDS, QueueCraftCmd } from "./systems/craft_queue.js";
import { EXPRESSION_COMMANDS } from "./expression.js";
import { analogMoving, hotbarSlotFromEdges, runInputHooks } from "./input_hooks.js";
import { ECONOMY_COMMAND_RATES, ECONOMY_COMMANDS, ECONOMY_ENTITY_FIELDS } from "./economy/stall.js";

export const GameplayActions = defineActions(["MoveUp", "MoveDown", "MoveLeft", "MoveRight", "Sprint", "Primary", "Secondary", "Interact", "Build"] as const);
const MOVE = GameplayActions.MoveUp | GameplayActions.MoveDown | GameplayActions.MoveLeft | GameplayActions.MoveRight;

const T = { target: "u32" } as const;
export const GatherCmd = defineCommand("gameplay.gather", T);
export const CraftCmd = defineCommand("gameplay.craft", { recipe: "u16" });
export const CancelCraftCmd = defineCommand("gameplay.cancelCraft", {});
export const UseCmd = defineCommand("gameplay.use", { slot: "u8" });
export const EquipCmd = defineCommand("gameplay.equip", { slot: "u8" });
/** x,y in tiles (piece center / pointer), level = z, rot 0..3 (cell/edge) or 0..freeRotSteps-1 (free). */
export const PlaceCmd = defineCommand("gameplay.place", { piece: "u16", x: "f32", y: "f32", level: "u8", rot: "u8", tier: "u8", variant: "u8" });
export const UpgradeCmd = defineCommand("gameplay.upgrade", { target: "u32", tier: "u8" });
export const RepairCmd = defineCommand("gameplay.repair", T);
export const DemolishCmd = defineCommand("gameplay.demolish", T);
export const PaintCmd = defineCommand("gameplay.paint", { target: "u32", paint: "u8" });
export const ToggleDoorCmd = defineCommand("gameplay.toggleDoor", T);
export const LockDoorCmd = defineCommand("gameplay.lockDoor", T);
export const OpenContainerCmd = defineCommand("gameplay.openContainer", T);
export const CloseContainerCmd = defineCommand("gameplay.closeContainer", {});
export const DepositCmd = defineCommand("gameplay.deposit", { target: "u32", item: "u16", count: "u16" });
export const WithdrawCmd = defineCommand("gameplay.withdraw", { target: "u32", item: "u16", count: "u16" });
export const ToggleFireCmd = defineCommand("gameplay.toggleFire", T);
export const AttackCmd = defineCommand("gameplay.attack", T);

/** Registration order = command ids (same list on both peers). Append only. */
export const GAMEPLAY_COMMANDS: readonly [CommandDef, IntentAction][] = [
  [GatherCmd, IntentAction.Gather], [CraftCmd, IntentAction.Craft], [CancelCraftCmd, IntentAction.CancelCraft], [UseCmd, IntentAction.Use],
  [EquipCmd, IntentAction.Equip], [PlaceCmd, IntentAction.Place], [UpgradeCmd, IntentAction.Upgrade], [RepairCmd, IntentAction.Repair],
  [DemolishCmd, IntentAction.Demolish], [PaintCmd, IntentAction.Paint], [ToggleDoorCmd, IntentAction.ToggleDoor], [LockDoorCmd, IntentAction.LockDoor],
  [OpenContainerCmd, IntentAction.OpenContainer], [CloseContainerCmd, IntentAction.CloseContainer], [DepositCmd, IntentAction.Deposit],
  [WithdrawCmd, IntentAction.Withdraw], [ToggleFireCmd, IntentAction.ToggleFire], [AttackCmd, IntentAction.Attack],
];
/** Command fields carrying a NetId that net must resolve to a local Entity before applyGameplayInput. */
export const COMMAND_ENTITY_FIELDS: Readonly<Record<string, readonly string[]>> = {
  ...Object.fromEntries(GAMEPLAY_COMMANDS.filter(([d]) => "target" in d.schema).map(([d]) => [d.name, ["target"]])),
  ...ECONOMY_ENTITY_FIELDS,
};
/** Suggested per-command rate limits (per second) for net's limiter; gameplay still enforces cooldowns. */
export const COMMAND_RATES: Readonly<Record<string, number>> = {
  ...Object.fromEntries(GAMEPLAY_COMMANDS.map(([d]) => [d.name, d === PlaceCmd ? 8 : 20])), ...ECONOMY_COMMAND_RATES,
};

export function registerGameplayCommands(reg: CommandRegistry = new CommandRegistry()): CommandRegistry {
  for (const [d] of GAMEPLAY_COMMANDS) reg.register(d);
  for (const d of ECONOMY_COMMANDS) reg.register(d); // append-only: ids after GAMEPLAY_COMMANDS
  for (const d of CUSTOMIZATION_COMMANDS) reg.register(d);
  for (const d of PVP_COMMANDS) reg.register(d);
  for (const d of CRAFT_QUEUE_COMMANDS) reg.register(d);
  for (const d of EXPRESSION_COMMANDS) reg.register(d);
  for (const d of PARTY_COMMANDS) reg.register(d);
  for (const d of CLAN_COMMANDS) reg.register(d); // append-only, after party
  reg.register(ClanDeclineCmd);
  return reg;
}

interface Pending { readonly action: IntentAction; readonly values: Record<string, number> }
export const CommandQueues = defineResource<Map<Entity, Pending[]>>("gameplay.CommandQueues");
const MAX_QUEUE = 16;

/** Input phase: actions -> moving/sprint, commands -> queue (one becomes the tick's intent). */
export function applyGameplayInput(world: World, e: Entity, frame: InputFrame | null, reg: CommandRegistry): void {
  if (!world.has(e, PlayerIntent)) return;
  const actions = frame?.actions ?? 0;
  world.set(e, PlayerIntent, { moving: actions & MOVE || analogMoving(frame) ? 1 : 0, sprint: actions & GameplayActions.Sprint ? 1 : 0 });
  for (const c of frame?.commands ?? []) queueCommand(world, e, reg, c);
  if (!frame) return;
  const slot = hotbarSlotFromEdges(frame.edges ?? 0);
  if (slot >= 0) { try { queueCommand(world, e, reg, reg.make(EquipCmd, { slot })); } catch { /* EquipCmd not in this registry */ } }
  runInputHooks(world, e, frame, reg);
}
export function queueCommand(world: World, e: Entity, reg: CommandRegistry, c: Command): boolean {
  const def = reg.def(c.type); const entry = def && GAMEPLAY_COMMANDS.find(([d]) => d.name === def.name);
  if (!entry) return false;
  let qs = world.getResource(CommandQueues); if (!qs) world.setResource(CommandQueues, (qs = new Map()));
  let q = qs.get(e); if (!q) qs.set(e, (q = []));
  if (q.length >= MAX_QUEUE) return false;
  q.push({ action: entry[1], values: c.values as Record<string, number> });
  return true;
}
/** Input-phase system: pops one queued command per entity into PlayerIntent. */
export function commandIntentSystem(world: World): void {
  const qs = world.getResource(CommandQueues); if (!qs) return;
  for (const [e, q] of qs) {
    if (!world.isAlive(e) || !world.has(e, PlayerIntent)) { qs.delete(e); continue; }
    const p = q.shift(); if (!p) continue;
    world.set(e, PlayerIntent, { ...p.values, action: p.action, ...(p.values.level !== undefined && { level: p.values.level }) });
    if (q.length === 0) qs.delete(e);
  }
}
