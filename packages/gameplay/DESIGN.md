# @engine/gameplay — Survival Systems Design

Status: v1, implemented against `@engine/core` (engine commit d457153+). Owner: Survival Systems team.
Read with `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` and `packages/net/ARCHITECTURE.md`.

Implemented: **vitals, inventory, crafting, gathering, day/night + weather effects**.
Design only (no code yet): **combat, building**.

## 0. Ground rules (from the engine)

- Components are numeric schemas (`defineComponent(name, {field: "f32" | ...}, {networked})`), SoA, sparse-set. No strings,
  objects or nested data. Item, recipe and resource definitions are referenced by **u16 numeric ids**. Enums are `const enum` stored in `u8`.
- Systems are `(world, dt) => void`, registered in phases `input → simulation → postSim → network → renderPrep`.
  The order is explicit and exported as `GAMEPLAY_SYSTEM_ORDER`. A test asserts it.
- Fixed 20 Hz tick by default. All tuning is **per second** in JSON. Systems multiply rates by `dt`, and durations become ticks through
  `secondsToTicks(seconds, dt)`. Timers are stored as absolute ticks (`*UntilTick`, `*AtTick`) and compared with `world.tick`.
- There is no `Date.now`, `performance.now` or `Math.random`. Randomness comes only from `world.rng` (core `Rng`), and only on the authority.
- The server is authoritative and runs the same sim. `installGameplay(world, { role })`:
  - `server` / `standalone` run everything.
  - `client` runs only the deterministic, RNG-free parts for prediction: vitals, stamina, gather cooldown and stamina cost, and crafting progress and completion.
    It never rolls yields, never changes node state, never decides death and never drives weather. Those arrive by replication.
- Writes go through `world.set`/`setField` (which mark the change) or through raw `store.data[f][slot]` followed by `store.markChanged(index)` (ADR-015).
- Events go through `world.events.emit` (core `EventBus`) and are delivered at the end of the tick in emission order. Payloads are numeric, and entity fields are **local** ids.

### Replication legend

core replicates **whole components** (`networked: true`). The *Scope* column is the intended relevancy. Owner-only scoping is not yet in core or net (see N1).

| Mark | Meaning |
|---|---|
| **all** | networked, every client in interest range |
| **owner** | networked, intended for the owning client only (HUD state) |
| **local** | `networked: false`. Each side derives it. Never on the wire |
| **P** | the client predicts this for its own entity and reconciles to the server value |

## 1. Component registry (registration order = component ids, append-only)

Built-ins first (core: NetId=0, Owner=1, Transform=2, PrevTransform=3), then `GAMEPLAY_COMPONENTS`:

| # | Component | Fields (type) | Net | Scope | Written by |
|---|---|---|---|---|---|
| 4 | `Health` | hp f32 q10[0,1000] **P**, max f32 | yes | all | vitals, (combat) |
| 5 | `ResourceNode` | kind u16 (resource id), amount u16, respawnAtTick u32 | yes | all | gathering (server) |
| 6 | `Survival` | hunger, thirst, stamina, maxStamina f32 q8[0,100] **P**, bodyTemp f32 q10[25,45] **P** | yes | owner | vitals |
| 7 | `VitalsState` | staminaRegenAtTick u32, lastDamageCause u8 (`DamageCause`) | no | local | vitals, gathering |
| 8 | `VitalsModifiers` | hungerMul, thirstMul, staminaRegenMul f32 | no | local (derived) | exposure |
| 9 | `Exposure` | insulation f32, sheltered u8, wetness f32 q7[0,1] **P**, feltTemp f32 q10[-40,60] **P** | yes | owner | exposure; insulation from equipment, sheltered from building |
| 10 | `Dead` | cause u8, tick u32 | yes | all | vitals.death (server) |
| 11 | `Inventory` | slotCount u8, maxWeight f32, weight f32, item0..item15 u16, count0..count15 u16 **P** | yes | owner (and container viewers) | inventory ops |
| 12 | `Equipment` | mainHandSlot u8 (255 = none), mainHandItem u16 (derived) | yes | all | input adapter; equipmentSync |
| 13 | `Gatherer` | reach f32, cooldownUntilTick u32 **P** | yes | owner | gathering |
| 14 | `CraftingStation` | kind u8 (`StationKind`), range f32 | yes | all | spawn/building |
| 15 | `HeatSource` | heat f32 (°C at centre), radius f32, lit u8 | yes | all | spawn/building |
| 16 | `Crafter` | recipe u16 (0 = idle), progressTicks u16, totalTicks u16 **P** | yes | owner | crafting |
| 17 | `PlayerIntent` | moving u8, sprint u8, action u8 (`IntentAction`), target u32 (local entity), recipe u16, slot u8 | no | local (rebuilt from inputs) | input phase |

The inventory is a fixed-slot array. Core has no array fields yet (E1), so it is flattened into `itemN`/`countN`. Item id 0 means an empty slot.
Core resources used: `TimeOfDay {t, dayLengthTicks, day}` and `Weather {kind, intensity, ticksRemaining}`.
Gameplay adds the resource `GameplayConfig {defs, role}`, which is config and not replicated.

## 2. System update order

| # | Phase | System | Role | Reads → Writes |
|---|---|---|---|---|
| – | input | *(net/app adapter)* | both | InputFrame/commands → `PlayerIntent`, `Equipment.mainHandSlot` |
| 1 | simulation | `gameplay.clock` | both | TimeOfDay (integer tick math, no drift) |
| 2 | simulation | `gameplay.weather` | server | Weather, `world.rng` |
| 3 | simulation | `gameplay.exposure` | both | TimeOfDay, Weather, HeatSource, Transform → Exposure, VitalsModifiers |
| 4 | simulation | `gameplay.respawn` | server | ResourceNode |
| 5 | simulation | `gameplay.gather` | both (yields: server) | PlayerIntent, Gatherer, Equipment, Inventory, Survival → ResourceNode, Inventory |
| 6 | simulation | `gameplay.craft` | both | PlayerIntent, Crafter, CraftingStation, Inventory |
| 7 | simulation | `gameplay.consume` | both | PlayerIntent(Use) → Inventory, Survival, Health |
| 8 | simulation | `gameplay.vitals` | both | VitalsModifiers, Exposure, PlayerIntent → Survival, Health, VitalsState |
| 9 | simulation | `gameplay.death` | server | Health → Dead |
| 10 | simulation | `gameplay.clearIntents` | both | clears one-shot `PlayerIntent.action` |
| 11 | postSim | `gameplay.equipmentSync` | both | Equipment.mainHandItem from the inventory slot |
| – | network | *(net)* | | snapshots and deltas |
| – | renderPrep | *(render)* | client | |

Why this order:
- Environment runs first so that exposure modifiers apply in the same tick.
- Actions that spend stamina (gather) run before vitals regen, so the regen delay takes effect immediately.
- Death runs after every damage source.
- One-shot actions are cleared at the **end of simulation**, not in postSim. `world.simulate()` runs only the simulation phase, so a replayed tick consumes its own action and does not repeat it.

## 3. Systems

### 3.1 Resources and gathering (implemented)
- **Components:** `ResourceNode`, `Gatherer`, `Equipment`, `Inventory`, `Transform`, `PlayerIntent`.
- **Definitions:** `data/resources.json`. Each entry has `id, key, requiredTool (none|axe|pickaxe), minTier, capacity, respawnSeconds, cooldownSeconds, staminaCost, bonusPerTier, yields[{item,min,max,chance}]`.
- **Tick** (`gather`, for each entity with `action == Gather`), validated in this order:
  1. cooldown (`Cooldown`)
  2. target alive and is a node (`InvalidTarget`)
  3. amount > 0 (`Depleted`)
  4. 2D distance ≤ reach (`OutOfRange`)
  5. held tool kind and tier (`WrongTool`)
  6. stamina ≥ cost (`Exhausted`)

  On success the system spends stamina (which also delays regen), sets the cooldown and emits `GatherSwing`.
  **Authority only:** for each yield it rolls `chance`, then `rng.int(min, max+1)`, and adds `bonusPerTier × (tier − minTier)` to the first yield.
  It adds the result to the inventory and emits `ItemGathered`. Anything that does not fit raises `InventoryOverflow` and is lost; world drops come later.
  It then decrements `amount`. At 0 it sets `respawnAtTick = tick + respawn` and emits `NodeDepleted`.
- **`respawn`** (server): a node with `amount == 0` and `tick ≥ respawnAtTick` is refilled to capacity, and `NodeRespawned` is emitted.
- **Authority:** the server decides yields and node state, and nodes replicate to all. The client predicts cooldown, stamina and swing feedback, and gets the items through the Inventory snapshot. Because of this, client RNG never diverges.
- **Events:** `GatherSwing`, `GatherFailed{reason}`, `ItemGathered`, `InventoryOverflow`, `NodeDepleted`, `NodeRespawned`.

### 3.2 Inventory and items (implemented)
- **Components:** `Inventory` (16 fixed slots, `slotCount` active, `maxWeight` in kg where 0 means unlimited, cached `weight`) and `Equipment`.
- **Definitions:** `data/items.json`. Each entry has `id, key, name, category (resource|food|tool|placeable), maxStack, weight, food{hunger,thirst,health}?, tool{kind,tier}?`.
- **Operations** (`inventory.ts`), all running over a `SlotView` so the same code works on the live store or a scratch copy:
  - `addItem` fills existing stacks first, then empty slots, lowest index first. It is partial and limited by both slots and weight, and returns the amount added.
  - `removeItem` is all-or-nothing and takes from the highest slot first.
  - `transferItem` moves `min(have, fits)`.
  - `exchangeItems(take, give, dryRun)` is atomic, and crafting uses it.
  - Also: `countItem`, `canAddItem`, `takeFromSlot`, `listSlots`.

  Every write rewrites `weight` and calls `markChanged`.
- **Authority:** the server is authoritative, and the client predicts the results of its own crafting and eating. Inventory replicates to the owner only (N1). Others see the held item through `Equipment.mainHandItem`.
- **Events:** emitted by the callers (gather, craft, consume).

### 3.3 Vitals: hunger, thirst, stamina, health, temperature (implemented)
- **Components:** `Health`, `Survival`, `VitalsState`, `VitalsModifiers`, `Exposure`, `Dead`.
- **Definitions:** `data/vitals.json`. It holds the decay rates, damage per second, regen, the stamina drain, regen and delay, the body-temperature model, the comfort band and the cold/heat multipliers.
- **Tick:**
  - `consume`: `Use` on a food slot takes one unit and adds hunger, thirst and health, clamped.
  - `vitals`:
    - hunger and thirst decay at `rate × modifier × dt`, emitting `VitalDepleted` on the crossing to 0;
    - sprinting while moving drains stamina and pushes `staminaRegenAtTick`; otherwise stamina regenerates at `rate × weatherMul × (0.5 if hunger or thirst is low)`;
    - body temperature moves toward the felt temperature when felt is outside `[comfortMin, comfortMax]`, and otherwise recovers toward 37 °C;
    - damage comes from starvation, dehydration, hypothermia (< 35 °C) and hyperthermia (> 39 °C). The last cause is recorded;
    - when well fed and undamaged, health regenerates.
  - `death` (server): hp ≤ 0 adds `Dead{cause, tick}` and emits `Died`. Dead entities are excluded from every gameplay query.
- **Authority:** the server is authoritative. The client predicts Survival and Health for its own entity, and death is never predicted.
- **Events:** `VitalDepleted{vital}`, `ItemConsumed`, `Died{cause}`.

### 3.4 Crafting (implemented); building (design)
- **Components:** `Crafter`, `CraftingStation`, `Inventory`, `Transform`, `PlayerIntent`.
- **Definitions:** `data/recipes.json`. Each entry has `id, key, station (none|campfire|workbench), seconds, ingredients[{item,count}], output{item,count}`.
- **Tick** (`craft`):
  - `CancelCraft` clears the job.
  - `Craft` validates:
    1. idle (`Busy`)
    2. recipe exists (`UnknownRecipe`)
    3. a station of the right kind within its `range` (`NoStation`)
    4. ingredients present (`MissingIngredients`)
    5. the output fits **after** the ingredients are removed (`InventoryFull`, a dry-run `exchangeItems`)

    If all pass it starts the job (`totalTicks = secondsToTicks`) and emits `CraftStarted`.
  - While a job is running, the station must stay in range or the job is cancelled with `NoStation`, and `progressTicks++`.
  - At completion it re-validates and runs one atomic exchange: consume the ingredients and add the output, then emit `CraftCompleted`. If validation fails it emits `CraftFailed`.
  - Nothing is consumed up front, so there are never refunds.
- **Authority:** deterministic and RNG-free, so the client predicts it fully. The server result wins.
- **Events:** `CraftStarted`, `CraftCompleted`, `CraftFailed{reason}`.
- **Building (design only):**
  - Components:
    - `BuildIntent` (local): piece id, tile x/y, rotation;
    - `Structure` {piece u16, hp f32, ownerClientId u16, stability u8} (all);
    - `Shelter` derived per tile.
  - Definitions: `data/pieces.json` {id, key, item (kit) id, footprint, hp, providesRoof, stationKind?, heat?}.
  - System `build.place` runs after craft and checks Action.Build, tile validity (`@engine/world` TileMap/height), overlap through SpatialHash, and reach. It consumes the kit item and spawns a Structure. If the piece is a station it also gets `CraftingStation`/`HeatSource`.
  - System `build.shelter` (before exposure) sets `Exposure.sheltered` for entities under roof tiles.
  - Events: `StructurePlaced`, `StructureDamaged`, `StructureDestroyed`.
  - Authority: server only. The client may show a predicted ghost, but placement is not predicted.

### 3.5 Combat (design only)
- **Components:**
  - `Attacker` {cooldownUntilTick u32 P} (owner);
  - `Armor` {value f32} (all);
  - weapon stats come from the item def of the held item: `weapon{damage, range, arcDeg, cooldownSeconds, staminaCost, toolKind?}` in items.json;
  - `Health` (exists); `DamageCause.Combat` (exists).
- **Systems** (simulation, between `craft` and `consume`):
  - `combat.attack` handles Action.Primary: cooldown and stamina checks, then a cone/arc query through SpatialHash. On the server it runs with **lag compensation** (rewind targets to the attacker's view tick, N7).
  - `combat.damage` applies the damage after armor, sets `lastDamageCause = Combat` and adds knockback to Transform.
  - Death goes through the existing `gameplay.death`.
  - Night `threatLevel()` (environment) feeds a future `ai.spawner` system.
- **Authority:** hits are decided only by the server. The client predicts the swing animation, its own cooldown and its stamina, and shows hit effects only when the server confirms (from replicated Health changes).
- **Events:** `AttackSwing`, `Hit{attacker, target, damage}`, `Died`.

### 3.6 Day/night survival pressure (implemented)
- **Core resource:** `TimeOfDay`. `gameplay.clock` advances it one tick at a time using integer math (`round(t·len)+1`), so there is no float drift. `t = 0` is midnight and `0.5` is noon.
- **Day phases:** Night [0.85, 0.2), Dawn [0.2, 0.3), Day [0.3, 0.75), Dusk [0.75, 0.85). `DayPhaseChanged` is emitted on each change.
- **Pressure:**
  - ambient = `baseTemp + amplitude·(−cos 2πt) + weather.tempOffset·intensity`, so night is 16 °C colder than noon with the default data;
  - cold raises `hungerMul`;
  - `threatLevel()` returns `nightThreatMul` at night, for spawners.
- **Definitions:** `data/environment.json` (`dayLengthSeconds`, `startTimeOfDay`, `baseTemp`, `dayNightAmplitude`, `nightThreatMul`, ...).
- **Authority:** deterministic from the tick, so both sides run it. The authoritative value arrives by resource replication (N3). Set `driveClock: false` if another owner drives it.

### 3.7 Weather effects (implemented)
- **Core resource:** `Weather {kind: WeatherKind, intensity, ticksRemaining}`.
- **`gameplay.weather`** (server only, `driveWeather`) counts down. At 0 it picks the next kind by weight with `world.rng`, rolls intensity and duration, and emits `WeatherChanged`.
- **Definitions:** `environment.json.weather[]` {kind (clear|rain|storm|snow|fog), weight, durationSeconds[min,max], intensity[min,max], tempOffset, wetnessPerSec, thirstMul, staminaRegenMul}.
- **`gameplay.exposure`** (both sides), per entity:
  - wetness rises with `wetnessPerSec·intensity` when the entity is not sheltered, and otherwise dries at `dryPerSec`, three times faster near heat;
  - felt temperature = ambient + insulation + shelter bonus + Σ campfire heat (linear falloff) − `wetChill·wetness`;
  - it writes `VitalsModifiers`: hungerMul (cold), thirstMul (weather × heat), and staminaRegenMul (weather, ignored when sheltered).
- **Events:** `WeatherChanged{from,to,intensity,ticks}`.

## 4. Events (all `gameplay.*`, delivered at end of tick)

`ItemGathered, GatherSwing, GatherFailed, NodeDepleted, NodeRespawned, InventoryOverflow, CraftStarted, CraftCompleted, CraftFailed, ItemConsumed, VitalDepleted, Died, WeatherChanged, DayPhaseChanged`.

Events are not replicated (N4). On the client they come from the predicted sim (feedback such as swings and craft progress) or are derived from snapshot changes.

## 5. Data tables (`data/*.json`)

| File | Contents |
|---|---|
| `items.json` | 14 items: resources, food, stone/iron axe and pickaxe, kits |
| `recipes.json` | 7 recipes: hand, campfire and workbench |
| `resources.json` | 7 node kinds: branches, grass, berry bush, loose rocks (no tool), tree (axe), boulder and iron vein (pickaxe) |
| `vitals.json` | vitals tuning |
| `environment.json` | day/night and weather table |

Numeric ids are stable wire and save ids. Never renumber them; only append. `loadDefs()` does the following:
- validates ids (1..65535, unique), keys, enums, counts and ranges;
- resolves string keys to ids;
- throws `DefsError` with every issue listed.

## 6. Open questions

### Engine Architect (core gaps; core was not modified)
- **E1 Array fields.** There is no fixed-length array field type, so the inventory is 32 named fields (`item0..15`, `count0..15`). Could we have `{type:"u16", length:N}` (one SoA array of stride N), and per-element change bits?
- **E2 Field defaults.** There are no per-field defaults or enum metadata in schemas. `add()` zeroes everything, so `mainHandSlot = 255` must be passed explicitly.
- **E3 Tick during replay.** `world.simulate()` does not advance `world.tick`. Our timers (`staminaRegenAtTick`, `cooldownUntilTick`, `respawnAtTick`, craft progress) compare against `world.tick`, so a replay runs with a stale tick. Should `simulate()` set `world.tick` for each replayed tick, or should systems receive the tick?
- **E4 Events during replay.** Events emitted during `simulate()` stay queued and flush at the next `step()`, which duplicates predicted events. Can we get an `isResimulating` flag or event suppression?
- **E5 RNG streams.** `world.rng` is one global stream, so any client-side RNG use desyncs every later roll. Could we have named per-system streams (`rng.fork` by a stable key) or a stateless hash RNG keyed by (tick, NetId, salt)? Either would make some outcomes predictable.
- **E6 Resource replication.** TimeOfDay and Weather are not in snapshots and have no owner. Gameplay drives them for now (`driveClock`/`driveWeather`). Should resources replicate, or should these become a networked singleton entity?
- **E7 System-order API.** There is no public introspection of system order. Our test reads a private field. Can we have `world.systemOrder()`?
- **E8 WeatherKind.** `WeatherKind` is a core `const enum` (Clear, Rain, Storm, Snow, Fog). Adding heatwave or sandstorm needs a core change. Could weather kinds be data-driven ids?
- **E9 Input actions.** `Action`/`InputFrame` (buttons and aim only) has no Sprint and no command payloads (craft recipeId, target NetId, inventory slot, build piece and rotation). We need a gameplay command channel.
- **E10 Spatial index.** Heat-source and station lookups are O(N·M). Should there be a shared per-tick SpatialHash resource maintained by world/core, and who updates it?

### Netcode
- **N1 Owner-only relevancy.** Replication is per component and goes to everyone. `Survival`, `Inventory`, `Exposure`, `Crafter` and `Gatherer` should go to the owner only (Inventory alone is 35 fields per player). Is that per-component relevancy, or a split into owner/public components?
- **N2 Entity references in commands.** Commands should carry the target's NetId. The input-phase adapter resolves it to the local entity in `PlayerIntent.target`. Who owns that adapter, net or gameplay?
- **N3 Time and weather replication.** TimeOfDay and Weather replication and late join: send them in the snapshot header, or as a singleton entity? (See E6.)
- **N4 Events.** Should a reliable event channel carry gameplay events (Died, ItemGathered for toasts), or should clients derive them from snapshot diffs?
- **N5 Sim-local state.** `VitalsState.staminaRegenAtTick` is sim-local, so after reconciliation the client's regen delay can drift. Should it be networked to the owner?
- **N6 Quantization.** Please review the quantization hints (hunger, thirst, stamina 8-bit; hp 10-bit; wetness 7-bit; temperatures 10-bit).
- **N7 Lag compensation.** Gathering range checks (and combat later) need it. What rewind window should server-side reach checks use?
- **N8 Inventory deltas.** Full-component deltas for inventory changes are wasteful. Per-field change bits (ARCHITECTURE Q3) would help.
- **N9 Command validation.** The server re-validates every intent (cooldowns, reach, ingredients). Do we also need per-connection rate limits for gameplay commands?
