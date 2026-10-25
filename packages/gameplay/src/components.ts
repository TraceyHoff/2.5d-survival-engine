/**
 * Gameplay components: numeric SoA schemas (ADR-007), array fields + defaults (core batch 2).
 * Registration order = component ids: append new components at the END of GAMEPLAY_COMPONENTS.
 * Replication scope/class per component lives in replication.ts (net applies it); persistence in
 * building/persist.ts. Render-facing fields are numeric references only (Art & Assets owns visuals).
 */
import { defineComponent, defineJobQueue, defineModifierStack, type ComponentDef, type FieldSpec, type FieldType } from "@engine/core";
import { Emitter } from "@engine/world";
export { Emitter };

const pct = (bits = 8): FieldSpec => ({ type: "f32", quant: { bits, min: 0, max: 100 } });

export const Health = defineComponent("Health", {
  hp: { type: "f32", quant: { bits: 12, min: 0, max: 4000 } },
  max: { type: "f32", quant: { bits: 12, min: 0, max: 4000 } },
}, { networked: true });

/** persistent: saved with the chunk (core chunk codec), so depleted nodes and their absolute respawnAtTick survive reloads. */
export const ResourceNode = defineComponent("ResourceNode", { kind: "u16", amount: "u16", respawnAtTick: "u32" }, { networked: true, persistent: true });

export const Survival = defineComponent("Survival", {
  hunger: pct(), thirst: pct(), stamina: pct(), maxStamina: pct(),
  bodyTemp: { type: "f32", quant: { bits: 10, min: 25, max: 45 } },
  staminaDelayTicks: "u16", // remaining regen delay (replicates as u16 ticks, per Netcode)
}, { networked: true });

export const enum DamageCause { None = 0, Starvation = 1, Dehydration = 2, Hypothermia = 3, Hyperthermia = 4, Combat = 5, Sunlight = 6, Fire = 7, Contact = 8, Explosion = 9, Turret = 10, Trap = 11 }
export const VitalsState = defineComponent("VitalsState", { lastDamageCause: "u8" });
/** Buff/debuff stat ids (core modifier stacks; 1..255, append only). */
export const enum Stat { HungerRate = 1, ThirstRate = 2, StaminaRegen = 3, HealthRegen = 4, Insulation = 5, MoveSpeed = 6 }
/** Buff kinds are just (stat, op) pairs with expiry; see systems/environment.ts + vitals.ts for the rules. */
export const Buffs = defineModifierStack("gameplay.Buffs", 8, { networked: true });
export const Exposure = defineComponent("Exposure", {
  insulation: "f32", sheltered: "u8",
  wetness: { type: "f32", quant: { bits: 7, min: 0, max: 1 } },
  feltTemp: { type: "f32", quant: { bits: 10, min: -40, max: 60 }, default: 20 },
}, { networked: true });
export const Dead = defineComponent("Dead", { cause: "u8", tick: "u32" }, { networked: true });

/** Shared shape of Inventory and Container so inventory ops work on both. */
export type InvSchema = {
  slotCount: FieldSpec; maxWeight: FieldSpec; weight: FieldSpec; spoilMul: FieldSpec;
  items: { type: FieldType; length: number }; counts: { type: FieldType; length: number };
  /** Per-slot effective creation tick for spoilage (core decayAt); re-based when storage conditions change. */
  createdTick: { type: FieldType; length: number };
  /** Per-slot durability (tools/weapons; non-stackable items have count 1). 0 = n/a. */
  durability: { type: FieldType; length: number };
  /** Per-slot crafter provenance: persistent PlayerId (u32) of whoever crafted the item, 0 = gathered. Part of the stack key. */
  crafterId: { type: FieldType; length: number };
};
export const INVENTORY_SLOTS = 16;
/** Container array width (ADR-098): the hard per-instance cap. Real capacity is per-instance `slotCount`, set from the def
 *  (piece `container`, vehicle class storage, bag size); slots >= slotCount are always empty. */
export const CONTAINER_MAX_SLOTS = 96;
/** Array width before ADR-098 (persist migration: old rows are zero-padded from 24 to CONTAINER_MAX_SLOTS). */
export const CONTAINER_LEGACY_SLOTS = 24;
/** @deprecated alias of CONTAINER_MAX_SLOTS (kept so existing imports compile). */
export const CONTAINER_SLOTS = CONTAINER_MAX_SLOTS;
export const Inventory = defineComponent("Inventory", {
  slotCount: { type: "u8", default: INVENTORY_SLOTS }, maxWeight: { type: "f32", default: 60 }, weight: "f32", spoilMul: { type: "f32", default: 1 },
  items: { type: "u16", length: INVENTORY_SLOTS }, counts: { type: "u16", length: INVENTORY_SLOTS }, createdTick: { type: "u32", length: INVENTORY_SLOTS }, durability: { type: "u16", length: INVENTORY_SLOTS }, crafterId: { type: "u32", length: INVENTORY_SLOTS },
}, { networked: true, persistent: true }) as ComponentDef<InvSchema>;

export const NO_SLOT = 255;
export const Equipment = defineComponent("Equipment", { mainHandSlot: { type: "u8", default: NO_SLOT }, mainHandItem: "u16" }, { networked: true });
export const Gatherer = defineComponent("Gatherer", { reach: { type: "f32", default: 1.5 }, cooldownUntilTick: "u32" }, { networked: true });
export const CraftingStation = defineComponent("CraftingStation", { kind: "u8", range: { type: "f32", default: 2.5 } }, { networked: true });
/** Crafting job: progress is derived (tick - startTick) so nothing is written per tick; the client predicts only that. */
export const Crafter = defineComponent("Crafter", { recipe: "u16", startTick: "u32", totalTicks: "u16" }, { networked: true });

export const enum IntentAction {
  None = 0, Gather = 1, Craft = 2, Use = 3, CancelCraft = 4, Equip = 5,
  Place = 10, Upgrade = 11, Repair = 12, Demolish = 13, Paint = 14,
  ToggleDoor = 20, LockDoor = 21, OpenContainer = 22, CloseContainer = 23, Deposit = 24, Withdraw = 25, ToggleFire = 26,
  Attack = 30, Reload = 31, Wear = 32,
}
/** Per-tick intent, written in the input phase by applyGameplayInput (sim-local; rebuilt from inputs). */
export const PlayerIntent = defineComponent("PlayerIntent", {
  moving: "u8", sprint: "u8", action: "u8", target: "u32", recipe: "u16", slot: "u8",
  piece: "u16", x: "f32", y: "f32", level: "u8", rot: "u8", tier: "u8", variant: "u8", paint: "u8", item: "u16", count: "u16",
  /** Charge hold bit this tick (bows / crossbow draw); set by applyGameplayInput. */
  charge: "u8",
});

// ---- building ----------------------------------------------------------------------------------
/** Agreed with Netcode: static replication class, persisted per chunk. hp is written at most once per tick. */
export const BuildPiece = defineComponent("BuildPiece", {
  type: "u16", rot: "u8", variant: "u8", tier: "u8", hp: "u16", damageStage: "u8", paint: "u8",
  /** Clan color index (set on place / claim change); render uses paint when paint != 0, else tint. */
  tint: "u8",
}, { networked: true, persistent: true });
export const enum EdgeSide { None = 0, North = 1, West = 2 }
/** Derived on every peer from Transform + def when the piece is indexed. */
export const PieceSlot = defineComponent("PieceSlot", { tx: "i32", ty: "i32", z: "u8", side: "u8", gridId: "u32", parent: "u32" });
/** Server-only, never replicated. */
export const PieceStability = defineComponent("PieceStability", { value: "u8", placedTick: "u32", lastDamagedTick: "u32" });
export const Tribe = defineComponent("Tribe", { id: "u16" }, { networked: true, persistent: true });
export const PrivilegeZone = defineComponent("PrivilegeZone", { radius: "f32", tribe: "u16" }, { networked: true, persistent: true });
export const DoorState = defineComponent("DoorState", { open: "u8", lockTribe: "u16" }, { networked: true, persistent: true });
/** burnUntilTick is absolute so burning causes no per-tick writes (low-rate replication). */
/** ADR-108 turret / trap state on a placed defense piece: readyTick = next shot or re-arm tick, owner = builder PlayerId
 *  (never targeted, nor their party/clan), target = current turret target (render aim). Ammo lives in the piece's Container. */
export const Defense = defineComponent("Defense", { readyTick: "u32", owner: "u32", target: "u32" }, { networked: true, persistent: true });
/** ADR-109 vehicle keys (append-only): keyId = stable lock id a vehicle_key slot carries in crafterId (0 = open, no key); owner = PlayerId the key was issued to; issued = key handed out. */
export const VehicleLock = defineComponent("VehicleLock", { keyId: "u32", owner: "u32", issued: "u8" }, { networked: true, persistent: true });
export const Fuel = defineComponent("Fuel", { burnUntilTick: "u32", lit: "u8" }, { networked: true, persistent: true });
export const Container = defineComponent("Container", {
  slotCount: { type: "u8", default: 12 }, maxWeight: "f32", weight: "f32", spoilMul: { type: "f32", default: 1 },
  items: { type: "u16", length: CONTAINER_SLOTS }, counts: { type: "u16", length: CONTAINER_SLOTS }, createdTick: { type: "u32", length: CONTAINER_SLOTS }, durability: { type: "u16", length: CONTAINER_SLOTS }, crafterId: { type: "u32", length: CONTAINER_SLOTS },
}, { networked: true, persistent: true }) as ComponentDef<InvSchema>;
export const MAX_VIEWERS = 8;
/** Who has the container open (server-only; net reads it for the "viewers" scope). */
export const ContainerViewers = defineComponent("ContainerViewers", { clients: { type: "u16", length: MAX_VIEWERS }, count: "u8" });
export const Viewing = defineComponent("Viewing", { container: "u32" });
/** Client-only placement preview (the only predicted building state). */
export const BuildGhost = defineComponent("BuildGhost", {
  /** inputs (client UI): builder entity, piece type, pointer position (tiles), level, rotation step, tier, variant */
  builder: "u32", piece: "u16", px: "f32", py: "f32", level: "u8", rot: "u8", tier: "u8", variant: "u8",
  /** outputs (render): snapped position/height/facing, validity and BuildFail reason */
  x: "f32", y: "f32", z: "f32", facing: "f32", valid: "u8", reason: "u8",
});

// ---- combat / zombies ----------------------------------------------------------------------------
export const Attacker = defineComponent("Attacker", { cooldownUntilTick: "u32" }, { networked: true });
export const Zombie = defineComponent("Zombie", { kind: "u8", variant: "u8" }, { networked: true });
export const enum ZState { Wander = 0, Investigate = 1, Chase = 2, AttackPlayer = 3, AttackStructure = 4, Dead = 5 }
export const ZombieBrain = defineComponent("ZombieBrain", {
  state: "u8", target: "u32", goalX: "f32", goalY: "f32", homeX: "f32", homeY: "f32",
  thinkAt: "u32", repathAt: "u32", attackAt: "u32", stateTick: "u32", blockPiece: "u32",
});
/** Shared, wire-stable anim ids (core AnimState, ADR-093); `Anim` kept as gameplay's name. */
export { AnimState as Anim, ANIM_STATE_NAMES } from "@engine/core";
export const AnimState = defineComponent("AnimState", { anim: "u8", startTick: "u32" }, { networked: true });
export const NoiseLevel = defineComponent("NoiseLevel", { value: "f32" });
/**
 * Links an attachment entity (door state, fire/fuel, container) to its piece by grid slot, so peers resolve it
 * without entity references. Attachments are separate entities because BuildPiece entities use net's static class
 * (all their components ride the static channel, scopes don't apply).
 */
export const enum AttachKind { Door = 1, Fire = 2, Storage = 3, Light = 4, Till = 5 }
export const PieceLink = defineComponent("PieceLink", { tx: "i32", ty: "i32", z: "u8", side: "u8", layer: "u8", kind: "u8" }, { networked: true, persistent: true });
/** Render-facing (renderer contract): wetness 0..255 on characters and zombies, replicated to all. */
export const Wetness = defineComponent("Wetness", { level: "u8" }, { networked: true });
/** Render-facing (renderer contract): cold/heat stress 0..255 and shivering 0/1. Precise bodyTemp stays owner-scoped in Survival. */
export const BodyTemp = defineComponent("BodyTemp", { cold: "u8", heat: "u8", shivering: "u8" }, { networked: true });
/** Per-chunk surface wetness (0..1 as u8 0..255), one entity per active chunk at its center; server-driven, render reads it. */
export const ChunkSurface = defineComponent("ChunkSurface", { cx: "i32", cy: "i32", wetness: "u8" }, { networked: true });
/** Social summary for render/UI (scope all). Ids come from core GroupRegistry (party, clan); rank is clan rank. */
export const GroupSummary = defineComponent("GroupSummary", { partyId: "u32", clanId: "u32", rank: "u8" }, { networked: true });
/** Last tick this entity dealt or took combat damage (combat tag: blocks trade/logout rules, UI timer). */
export const CombatTag = defineComponent("CombatTag", { untilTick: "u32" }, { networked: true });
/** Death loot container marker (player corpse / bag): owner PlayerId, despawn tick. Contents in Container. */
export const LootBag = defineComponent("LootBag", { owner: "u32", despawnAtTick: "u32" }, { networked: true, persistent: true });
/** Written by net on the server (per-connection RTT) for range slack. */
export const Latency = defineComponent("Latency", { rttMs: "u16" });

// ---- economy (trade stalls) ----------------------------------------------------------------------
export const MAX_LISTINGS = 24;
export const LEDGER_SIZE = 16;
export const enum StallOwnerKind { None = 0, Player = 1, Clan = 2 }
/** Lives on the stall's stock attachment (the entity with Container = stock). Scope all (AOI): owner kind/id, open, listing count. */
export const StallHeader = defineComponent("StallHeader", { ownerKind: "u8", ownerId: "u32", open: "u8", listingCount: "u8" }, { networked: true, persistent: true });
/** Stall sign + derived flags, replicated to all (Art & Assets): soldOut = no enabled listing has stock (server-maintained);
 * name = owner-editable sign text, sanitized printable ASCII, nameLen bytes used (max STALL_NAME_MAX). Saved in STRC v3. */
export const STALL_NAME_MAX = 24;
export const StallSign = defineComponent("StallSign", { soldOut: "u8", nameLen: "u8", name: { type: "u8", length: STALL_NAME_MAX } }, { networked: true });
/** Per player customization state: created = first-join creator done; unlocks = bitmask over data/cosmetics.json
 * unlockTags (index = bit, 64 max). Networked (owner UI shows locked/unlocked), persistent with the player. */
export const Wardrobe = defineComponent("Wardrobe", { created: "u8", unlocks: { type: "u32", length: 2 } }, { networked: true, persistent: true });
/** Per listing slot i (stock slot i): price {item,count}, quantity per sale, enabled. revision bumps on every change. Scope viewers. */
export const Listings = defineComponent("Listings", {
  priceItem: { type: "u16", length: MAX_LISTINGS }, priceCount: { type: "u16", length: MAX_LISTINGS },
  qty: { type: "u16", length: MAX_LISTINGS }, enabled: { type: "u8", length: MAX_LISTINGS }, revision: "u32",
}, { networked: true, persistent: true });
/** Sales ledger ring buffer (capped, persisted); head = next write index, total = sales ever. Scope viewers (owner UI). */
export const StallLedger = defineComponent("StallLedger", {
  tick: { type: "u32", length: LEDGER_SIZE }, item: { type: "u16", length: LEDGER_SIZE }, count: { type: "u16", length: LEDGER_SIZE },
  priceItem: { type: "u16", length: LEDGER_SIZE }, priceCount: { type: "u32", length: LEDGER_SIZE }, buyerId: { type: "u32", length: LEDGER_SIZE },
  crafterId: { type: "u32", length: LEDGER_SIZE }, head: "u8", total: "u32",
}, { networked: true, persistent: true });

/**
 * Burning status (render contract, packages/render/src/burning.ts): on BuildPiece entities (structure fire,
 * data/fire.json) and creatures (damage over time). lit 0/1, intensity 0..255, startTick = ignition tick.
 */
export const Burning = defineComponent("Burning", { lit: "u8", intensity: "u8", startTick: "u32" }, { networked: true, persistent: true });

/**
 * The shared registration module: registration order = component ids on every peer (append only!).
 * Includes engine-provided gameplay-facing components (world Emitter, the Buffs modifier stack).
 */
/** Ambient wildlife (population spawner). kind = index into animalDefs() (ai.json animal_* archetypes; spawn rows in spawns.json). Not persistent: respawned by density. */
export const Animal = defineComponent("Animal", { kind: "u8", state: "u8", homeX: "f32", homeY: "f32", goalX: "f32", goalY: "f32", thinkAt: "u32" }, { networked: true });

/** Slice 5 queued crafting (core JobQueue layout, 4 slots; see systems/craft_queue.ts). */
export const CraftQueue = defineJobQueue("gameplay.CraftQueue", 4);
/** Queued-craft outputs that didn't fit at completion; persistent so they survive restarts (old saves: absent = nothing owed). */
export const CRAFT_OWED_SLOTS = 8;
export const CraftOwed = defineComponent("CraftOwed", {
  item: { type: "u16", length: CRAFT_OWED_SLOTS }, count: { type: "u16", length: CRAFT_OWED_SLOTS }, crafterId: { type: "u32", length: CRAFT_OWED_SLOTS },
}, { networked: false, persistent: true });
/** Face expression (id = data/expressions.json index + 1, 0 = none) shown until untilTick. Broadcast, not persisted, kept off Appearance. */
export const Expression = defineComponent("Expression", { id: "u8", untilTick: "u32" }, { networked: true });
/** Latest pending party invite for this player (owner-scoped mirror of PartyInvites; server writes it in party handlers only). */
/** Mirror of the player's party role (GroupRole; 0 = none) so the client can hide leader-only buttons (ADR-141). */
export const PartyRank = defineComponent("PartyRank", { role: "u8" }, { networked: true });
export const PartyInvitePending = defineComponent("PartyInvitePending", { party: "u32", from: "u32", expiresTick: "u32" }, { networked: true });
/** Latest pending clan invite (owner-scoped mirror of ClanInvites; written in clan handlers only). */
export const ClanInvitePending = defineComponent("ClanInvitePending", { clan: "u32", from: "u32", expiresTick: "u32" }, { networked: true });
/** Clan view on each online member (AOI): clan, role, current clan goal (ClanGoal) + point, own contribution count. Clan handlers only. */
export const ClanStatus = defineComponent("ClanStatus", { clan: "u32", role: "u8", goal: "u8", goalX: "f32", goalY: "f32", contrib: "u32" }, { networked: true });
// ---- vehicles (docs/VEHICLES.md, ADR-096) ---------------------------------------------------------
export const VEHICLE_MAX_SEATS = 8;
/** A drivable vehicle or trailer. defId = data/vehicles.json index + 1. heading radians; drift = velocity angle minus heading
 * (arcade slide); steer = current steering angle. Storage lives in Container on the same entity. */
export const Vehicle = defineComponent("Vehicle", {
  defId: "u16", speed: "f32", heading: "f32", fuel: "f32", health: "f32", drift: "f32", steer: "f32",
}, { networked: true, persistent: true });
/** Seat occupancy on the vehicle: rider NetIds (0 = empty), seat 0 = driver. Not persisted (riders are ejected on load). */
export const VehicleSeats = defineComponent("VehicleSeats", { occupant: { type: "u32", length: VEHICLE_MAX_SEATS } }, { networked: true });
/** On a rider: the vehicle NetId and seat index (0 = driver). */
export const Driver = defineComponent("Driver", { vehicleNetId: "u32", seat: "u8" }, { networked: true });
/** Hitch links (NetIds, 0 = none): towNetId = what this entity tows at its rear; parentNetId = what tows this entity. */
export const Hitch = defineComponent("Hitch", { towNetId: "u32", parentNetId: "u32" }, { networked: true, persistent: true });
/** Worn clothing/armor: per WearSlot the inventory slot + 1 (0 = empty) and the item (broadcast for render). carryBonus applied to Inventory.maxWeight. */
export const Worn = defineComponent("Worn", { slot: { type: "u8", length: 8 }, item: { type: "u16", length: 8 }, carryBonus: "f32", waterproof: "f32", armor: "f32" }, { networked: true, persistent: true });
/** Main-hand ranged state: inventory slot + 1 the magazine belongs to, loaded rounds of ammoItem, reload timer, draw start (0 = not drawing). */
export const WeaponState = defineComponent("WeaponState", { slot: "u8", loaded: "u8", ammoItem: "u16", reloadUntilTick: "u32", chargeStartTick: "u32" }, { networked: true });
/** A thrown explosive waiting for its fuse (Transform = landing point). Replicated: only what clients render (item, fuse). */
export const LiveExplosive = defineComponent("LiveExplosive", { item: "u16", detonateTick: "u32" }, { networked: true });
/** Server-only side component of a LiveExplosive: thrower entity (raid attribution) and tribe (own-structure immunity). Never replicated. */
export const ExplosiveOwner = defineComponent("ExplosiveOwner", { owner: "u32", ownerTribe: "u16" }, { networked: false });
/** Crafted-vehicle provenance + condition (vehicle_craft.ts): crafterId = PlayerId from the kit slot (0 = world spawn);
 * wear 0..0.5 = fraction of max health lost to field repairs (garage repair clears it). */
export const VehicleCondition = defineComponent("VehicleCondition", { crafterId: "u32", wear: "f32" }, { networked: true, persistent: true });
/** Replicated toggles on a powered vehicle (ADR-101): bit 0 engineOn, bit 1 headlights. Separate 1-byte component so it
 * only goes on the wire when toggled, not with every moving-Vehicle delta. Written only by the vehicle state commands. */
export const VehicleState = defineComponent("VehicleState", { flags: "u8" }, { networked: true, persistent: true });
export const VEHICLE_ENGINE_ON = 1, VEHICLE_HEADLIGHTS = 2;
/** ADR-110 planted crop / sapling / bush (farming.ts). kind = farming.json plantables index + 1 (0 = tilled soil, nothing planted);
 *  growth 0..1, stage = render stage; waterUntilTick = watered boost end; fertilized 0/1. Matures into a resource node. */
export const Crop = defineComponent("Crop", { kind: "u8", stage: "u8", growth: "f32", waterUntilTick: "u32", fertilized: "u8" }, { networked: true, persistent: true });
/** ADR-113 skill progression (skills/progression.ts): xp toward next level, unspent points, respec count, nodes = bitset of
 * skills.json node indices (append-only order). Networked (own tree UI / toast) + persistent (saves, rejoin). */
export const Progression = defineComponent("Progression", { xp: "u32", level: "u16", points: "u16", respecs: "u8", nodes: { type: "u32", length: 8 } }, { networked: true, persistent: true });
/** ADR-113 domesticated animal (skills/husbandry.ts). owner = tamer PlayerId (0 = none); fedUntil / produceAt / breedAt are ticks. */
export const Tamed = defineComponent("Tamed", { kind: "u8", owner: "u32", fedUntil: "u32", produceAt: "u32", breedAt: "u32" }, { networked: true, persistent: true });

/** ADR-119 road tile (roads.ts). Standalone entity at tile centre. surface = RoadSurface; mask = auto-connect bits
 *  (1 N, 2 E, 4 S, 8 W) recomputed on place/remove; owner = placer PlayerId. Networked + persistent (chunk codec, like Crop). */
export const Road = defineComponent("Road", { surface: "u8", mask: "u8", owner: "u32" }, { networked: true, persistent: true });
export const enum RoadSurface { None = 0, Path = 1, Gravel = 2, Paved = 3 }
export const SIGN_TEXT_MAX = 48;
/** ADR-120 sign (signs.ts). kind = signs.json index + 1; rot = quarter turns; owner = PlayerId, clan = owner's clan at
 *  placement (edit rights); text = sanitized ASCII bytes, len used. Networked (rendered as a world label) + persistent. */
export const Sign = defineComponent("Sign", { kind: "u8", rot: "u8", owner: "u32", clan: "u32", len: "u8", text: { type: "u8", length: SIGN_TEXT_MAX } }, { networked: true, persistent: true });
/** ADR-121 roaming horde member (hordes.ts): horde id, target piece entity + target centroid (retarget if destroyed). Server-only. */
export const HordeMember = defineComponent("HordeMember", { horde: "u16", target: "u32", tx: "f32", ty: "f32" });
/** ADR-121 world rules on the environment singleton (replicated so clients show them): hordes 0/1, grace in in-game days. */
export const WorldRules = defineComponent("WorldRules", { hordes: "u8", hordeGraceDays: "f32" }, { networked: true });
export const enum HordePhase { Idle = 0, Warning = 1, Active = 2 }
/** ADR-121 horde director status on the environment singleton: drives client toasts + audio (snapshot diffs).
 *  seq bumps per horde; kind 1 solo / 2 clan; alive/size members; x,y = target centroid; owner = clan id or PlayerId. */
export const HordeStatus = defineComponent("HordeStatus", { phase: "u8", seq: "u16", kind: "u8", size: "u16", alive: "u16", x: "f32", y: "f32", owner: "u32", nextTick: "u32" }, { networked: true });
/** ADR-119 server-only runtime builder of a piece (PlayerId), for settlement classification + solo horde owners. */
export const PieceOwner = defineComponent("PieceOwner", { player: "u32" });

/**
 * ADR-134 hit reaction (authority writes on creature damage; broadcast, NOT persisted). startTick = tick of the hit,
 * dir = hit direction (attacker -> target) quantised to 0..255 over 2*pi, src = attacker NetId (0 = none), amount = damage (clamped u8).
 * Clients render a short flinch/knockback nudge + flash from it; health bars use src to spot their own combat targets.
 */
export const HitReact = defineComponent("HitReact", { startTick: "u32", dir: "u8", src: "u32", amount: "u8" }, { networked: true });
/**
 * ADR-134 depleted resource node waiting to regrow (authority; networked + persistent so it survives restarts).
 * Sits at the old node's position (a tree leaves a stump until stumpUntilTick); at respawnAtTick a fresh node of `kind`
 * spawns at a new valid spot near it (same tile/biome, clear of structures, roads and players) and this entity is removed.
 */
export const NodeRegrow = defineComponent("NodeRegrow", { kind: "u16", respawnAtTick: "u32", stumpUntilTick: "u32", tries: "u8" }, { networked: true, persistent: true });

export const GAMEPLAY_COMPONENTS = [
  Emitter, Buffs,
  Health, ResourceNode, Survival, VitalsState, Exposure, Dead,
  Inventory, Equipment, Gatherer, CraftingStation, Crafter, PlayerIntent,
  BuildPiece, PieceSlot, PieceStability, Tribe, PrivilegeZone, DoorState, Fuel, Container, ContainerViewers, Viewing, BuildGhost,
  Attacker, Zombie, ZombieBrain, AnimState, NoiseLevel, Latency, PieceLink, Wetness, BodyTemp, ChunkSurface,
  GroupSummary, CombatTag, LootBag,
  StallHeader, Listings, StallLedger,
  Burning,
  StallSign,
  Wardrobe,
  Animal,
  CraftQueue,
  CraftOwed,
  Expression,
  PartyInvitePending,
  ClanInvitePending,
  ClanStatus,
  Vehicle, VehicleSeats, Driver, Hitch, // append-only (ADR-096)
  Worn, WeaponState, LiveExplosive,
  ExplosiveOwner, // append-only (server-only)
  VehicleCondition, // vehicle crafting (DESIGN.md §31)
  VehicleState, // append-only (ADR-101)
  Defense, // append-only (ADR-108)
  VehicleLock, // append-only (ADR-109)
  Crop, // append-only (ADR-110)
  Progression, Tamed, // append-only (ADR-113)
  Road, Sign, HordeMember, WorldRules, HordeStatus, PieceOwner, // append-only (ADR-119..121)
  HitReact, NodeRegrow, // append-only (ADR-134)
  PartyRank, // append-only (ADR-141)
] as const;
