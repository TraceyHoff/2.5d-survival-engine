/**
 * Gameplay components. Plain numeric data only (ADR-007). Registration order below is part of the
 * world schema hash (ADR-008/009): append new components at the END of GAMEPLAY_COMPONENTS.
 *
 * networked: true  -> replicated by @engine/net (all fields; core replicates per component).
 * networked: false -> sim-local; each side derives it (caches, intents, timers).
 * "Owner-only" below is the intended relevancy; see DESIGN.md open question N1.
 */
import { defineComponent, type FieldSpec } from "@engine/core";

const pct = (bits = 8): FieldSpec => ({ type: "f32", quant: { bits, min: 0, max: 100 } });

/** Hit points. Networked to everyone (health bars). */
export const Health = defineComponent("Health", {
  hp: { type: "f32", quant: { bits: 10, min: 0, max: 1000 } },
  max: { type: "f32", quant: { bits: 10, min: 0, max: 1000 } },
}, { networked: true });

/** Survival needs. Networked, intended owner-only (HUD). 100 = full. bodyTemp in deg C. */
export const Survival = defineComponent("Survival", {
  hunger: pct(), thirst: pct(), stamina: pct(), maxStamina: pct(),
  bodyTemp: { type: "f32", quant: { bits: 10, min: 25, max: 45 } },
}, { networked: true });

export const enum DamageCause { None = 0, Starvation = 1, Dehydration = 2, Hypothermia = 3, Hyperthermia = 4, Combat = 5 }

/** Sim-local vitals bookkeeping (both sides run it; reconciliation corrects drift). */
export const VitalsState = defineComponent("VitalsState", {
  staminaRegenAtTick: "u32", // stamina regen blocked until this tick
  lastDamageCause: "u8",     // DamageCause
});

/** Per-tick multipliers computed by environment.exposure, consumed by vitals. Sim-local, derived. */
export const VitalsModifiers = defineComponent("VitalsModifiers", {
  hungerMul: "f32", thirstMul: "f32", staminaRegenMul: "f32",
});

/** Environmental exposure. Networked, intended owner-only (HUD: wet/cold icons). */
export const Exposure = defineComponent("Exposure", {
  insulation: "f32", // deg C added to felt temperature (clothing; set by equipment system later)
  sheltered: "u8",   // 1 = under roof (set by building system later)
  wetness: { type: "f32", quant: { bits: 7, min: 0, max: 1 } },
  feltTemp: { type: "f32", quant: { bits: 10, min: -40, max: 60 } },
}, { networked: true });

/** Marker + cause of death. Networked to all. */
export const Dead = defineComponent("Dead", { cause: "u8", tick: "u32" }, { networked: true });

// ---- inventory: fixed-slot arrays flattened to item0..itemN / count0..countN (core has no array fields) ----
export const INVENTORY_SLOTS = 16;
export const ITEM_FIELDS: readonly string[] = Array.from({ length: INVENTORY_SLOTS }, (_, i) => `item${i}`);
export const COUNT_FIELDS: readonly string[] = Array.from({ length: INVENTORY_SLOTS }, (_, i) => `count${i}`);
const slotFields: Record<string, FieldSpec> = {};
for (let i = 0; i < INVENTORY_SLOTS; i++) { slotFields[ITEM_FIELDS[i]!] = "u16"; slotFields[COUNT_FIELDS[i]!] = "u16"; }

/** Fixed-slot inventory (players, chests). item id 0 = empty. Networked, intended owner-only (or viewers of a container). */
type InventorySchema = { slotCount: "u8"; maxWeight: "f32"; weight: "f32" } & Record<string, FieldSpec>;
export const Inventory = defineComponent("Inventory", {
  slotCount: "u8",  // active slots (<= INVENTORY_SLOTS)
  maxWeight: "f32", // kg; 0 = unlimited
  weight: "f32",    // cached total, always rewritten by inventory ops
  ...slotFields,    // item0..item15, count0..count15 (u16)
} as InventorySchema, { networked: true });

export const NO_SLOT = 255;
/** Held item. Networked to all so remote players render the right tool. */
export const Equipment = defineComponent("Equipment", {
  mainHandSlot: "u8", // inventory slot index or NO_SLOT
  mainHandItem: "u16", // derived in postSim from the slot (remote clients cannot see the inventory)
}, { networked: true });

/** Harvestable node. kind = resource def id; amount = gathers left (0 = depleted). Networked to all. */
export const ResourceNode = defineComponent("ResourceNode", {
  kind: "u16", amount: "u16", respawnAtTick: "u32",
}, { networked: true });

/** Can gather. Networked (owner) so the predicted cooldown reconciles. */
export const Gatherer = defineComponent("Gatherer", { reach: "f32", cooldownUntilTick: "u32" }, { networked: true });

/** Crafting station (campfire, workbench). kind = StationKind. Networked to all. */
export const CraftingStation = defineComponent("CraftingStation", { kind: "u8", range: "f32" }, { networked: true });

/** Warms nearby entities: +heat deg C at the centre, linear falloff to 0 at radius. Networked to all. */
export const HeatSource = defineComponent("HeatSource", { heat: "f32", radius: "f32", lit: "u8" }, { networked: true });

/** Current crafting job (recipe 0 = idle). Networked (owner) for the progress bar. */
export const Crafter = defineComponent("Crafter", { recipe: "u16", progressTicks: "u16", totalTicks: "u16" }, { networked: true });

export const enum IntentAction { None = 0, Gather = 1, Craft = 2, Use = 3, CancelCraft = 4 }
/**
 * Per-tick player intent written in the input phase from the InputFrame/command stream (not replicated:
 * the server rebuilds it from inputs). One-shot `action` is cleared at the end of the simulation phase,
 * so world.simulate() replays stay correct. `target` is a LOCAL entity id resolved from a NetId by the
 * input adapter.
 */
export const PlayerIntent = defineComponent("PlayerIntent", {
  moving: "u8", sprint: "u8",
  action: "u8", target: "u32", recipe: "u16", slot: "u8",
});

/** Registration order (append only!). */
export const GAMEPLAY_COMPONENTS = [
  Health, ResourceNode, Survival, VitalsState, VitalsModifiers, Exposure, Dead,
  Inventory, Equipment, Gatherer, CraftingStation, HeatSource, Crafter, PlayerIntent,
] as const;
