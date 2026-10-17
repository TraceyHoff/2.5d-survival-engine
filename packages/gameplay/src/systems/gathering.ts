/**
 * Gathering: IntentAction.Gather on a ResourceNode. Validates cooldown, target, range, tool, stamina;
 * then (authority only) rolls yields with world.rng, fills the inventory and depletes the node.
 * Order (simulation phase): gather.respawn -> gather.actions.
 *
 * Client prediction: the client runs the same validation and predicts stamina cost + cooldown and
 * emits GatherSwing for feedback, but does NOT roll yields or touch the node (RNG outcomes and shared
 * world state arrive by replication).
 */
import { entityIndex, Transform, type Entity, type World } from "@engine/core";
import { Dead, Equipment, Gatherer, IntentAction, Inventory, NO_SLOT, PlayerIntent, ResourceNode, Survival } from "../components.js";
import { gameplayDefs, isAuthority } from "../config.js";
import { secondsToTicks, ToolKind, type GameDefs, type ToolDef } from "../defs.js";
import { GatherFail, GatherFailed, GatherSwing, InventoryOverflow, ItemGathered, NodeDepleted, NodeRespawned } from "../events.js";
import { addItem, slotItem } from "../inventory.js";
import { spendStamina } from "./vitals.js";

const BARE_HANDS: ToolDef = { kind: ToolKind.None, tier: 0 };

export function heldTool(world: World, e: Entity, defs: GameDefs): ToolDef {
  const slot = world.getField(e, Equipment, "mainHandSlot");
  if (slot === undefined || slot === NO_SLOT || !world.has(e, Inventory)) return BARE_HANDS;
  return defs.items.get(slotItem(world, e, slot).item)?.tool ?? BARE_HANDS;
}

export function respawnSystem(world: World): void {
  if (!isAuthority(world)) return;
  const defs = gameplayDefs(world); const rn = world.store(ResourceNode);
  for (const node of world.query([ResourceNode])) {
    const idx = entityIndex(node); const s = rn.slot(idx);
    if (rn.data.amount[s] !== 0 || world.tick < rn.data.respawnAtTick[s]!) continue;
    const def = defs.resources.get(rn.data.kind[s]!); if (!def) continue;
    rn.data.amount[s] = def.capacity; rn.data.respawnAtTick[s] = 0; rn.markChanged(idx);
    world.events.emit(NodeRespawned, { node, kind: def.id });
  }
}

export function gatherSystem(world: World, dt: number): void {
  const defs = gameplayDefs(world); const authority = isAuthority(world);
  const intent = world.store(PlayerIntent); const tf = world.store(Transform); const rn = world.store(ResourceNode);
  for (const e of world.query([PlayerIntent, Gatherer, Inventory, Transform], [Dead])) {
    const idx = entityIndex(e); const is = intent.slot(idx);
    if (intent.data.action[is] !== IntentAction.Gather) continue;
    const node = intent.data.target[is]!;
    const fail = (reason: GatherFail): void => world.events.emit(GatherFailed, { entity: e, node, reason });

    if (world.tick < world.getField(e, Gatherer, "cooldownUntilTick")!) { fail(GatherFail.Cooldown); continue; }
    if (!world.has(node, ResourceNode) || !world.has(node, Transform)) { fail(GatherFail.InvalidTarget); continue; }
    const nIdx = entityIndex(node); const ns = rn.slot(nIdx);
    const def = defs.resources.get(rn.data.kind[ns]!); if (!def) { fail(GatherFail.InvalidTarget); continue; }
    if (rn.data.amount[ns] === 0) { fail(GatherFail.Depleted); continue; }
    const a = tf.slot(idx), b = tf.slot(nIdx);
    const dist = Math.hypot(tf.data.x[a]! - tf.data.x[b]!, tf.data.y[a]! - tf.data.y[b]!);
    if (dist > world.getField(e, Gatherer, "reach")!) { fail(GatherFail.OutOfRange); continue; }
    const tool = heldTool(world, e, defs);
    if (def.requiredTool !== ToolKind.None && (tool.kind !== def.requiredTool || tool.tier < def.minTier)) { fail(GatherFail.WrongTool); continue; }
    if (world.has(e, Survival) && !spendStamina(world, e, def.staminaCost, dt)) { fail(GatherFail.Exhausted); continue; }

    world.setField(e, Gatherer, "cooldownUntilTick", world.tick + secondsToTicks(def.cooldownSeconds, dt));
    world.events.emit(GatherSwing, { entity: e, node });
    if (!authority) continue;

    const bonus = def.requiredTool !== ToolKind.None ? Math.max(0, tool.tier - def.minTier) * def.bonusPerTier : 0;
    def.yields.forEach((y, i) => {
      if (y.chance < 1 && world.rng.next() >= y.chance) return;
      const n = world.rng.int(y.min, y.max + 1) + (i === 0 ? bonus : 0);
      if (n <= 0) return;
      const added = addItem(world, e, y.item, n);
      if (added > 0) world.events.emit(ItemGathered, { entity: e, node, item: y.item, count: added });
      if (added < n) world.events.emit(InventoryOverflow, { entity: e, item: y.item, lost: n - added });
    });
    const left = rn.data.amount[ns]! - 1;
    rn.data.amount[ns] = left;
    if (left === 0) {
      rn.data.respawnAtTick[ns] = world.tick + secondsToTicks(def.respawnSeconds, dt);
      world.events.emit(NodeDepleted, { node, kind: def.id });
    }
    rn.markChanged(nIdx);
  }
}
