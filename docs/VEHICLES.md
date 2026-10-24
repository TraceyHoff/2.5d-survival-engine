# Vehicles (engine foundation)

Owner: Engine. Survival owns recipes and station behaviour, Art owns sprites, Renderer draws, Netcode syncs.
Decision record: ADR-096 in DECISIONS.md. Code: `packages/gameplay/src/vehicles.ts`. Data: `packages/gameplay/data/vehicles.json`
(JSON Schema `vehicles.schema.json`). Tests: `packages/gameplay/test/vehicles.test.ts`.

## Classes and defs
Classes: `bicycle`, `car`, `truck`, `van`, `camper`, `semi`, `trailer`. Sizes: `xs`, `s`, `m`, `l`, `xl`.

| field | meaning |
|---|---|
| `id` | stable key (`bike_bmx`, `semi_trailer_box`) |
| `class`, `size` | see above. Storage grows with size (tested: average maxWeight strictly increases by size). |
| `seats` | 0..8, seat 0 = driver. Trailers have 0. |
| `mass` | kg. Scales collision damage. |
| `maxSpeed`, `accel`, `brake` | tiles/s, tiles/s². |
| `turn` | max yaw rate (rad/s). |
| `grip` | 0..1. Lower means more drift. |
| `fuel` | `{capacity, perSecond}` at full throttle, or `null`. Required for motor classes, forbidden on bicycles. |
| `stamina` | `{perSecond}` (bicycles): drains the rider's Survival.stamina. At 0 the bike runs at 35% throttle. |
| `health` | vehicle HP. At 0 the vehicle is wrecked: no throttle and no entering. |
| `storage` | `{slots, maxWeight}` → `Container` on the vehicle. Slots are capped at `CONTAINER_SLOTS` (24), so weight is the main way capacity scales. |
| `hitches` | `[{at: front|rear, offset, accepts: [class…]}]`. Towing needs the trailer's front hitch to accept the tow's class AND the tow's rear hitch to accept the trailer's class. |
| `interior.stations` | station keys from `stations.json` (campers and camper trailers). |
| `footprint` | `{length, width}` in tiles. Collision tests its 4 corners and centre. |
| `collider.radius` | broad-phase radius for Renderer and Netcode. |

`Vehicle.defId` = index in vehicles.json + 1. **Append only.** `VEHICLE_DEFS_HASH` is mixed into the world schema hash
(salt `gameplay.vehicles`). `loadVehicleDefs(doc)` validates the data and throws if anything is wrong.

Shipped: 9 bicycles (basic, road, mountain, bmx, fat tire, cruiser, tandem, cargo, trike), 5 cars, 3 trucks, 2 vans,
2 campers (van, rv; both with interiors), the semi tractor, and 8 trailers (small utility, medium cargo, large flatbed,
livestock, tanker, camper trailer, semi box, semi flatbed). Semi trailers hitch only to a semi.

## Components (appended after ClanStatus; registration order is append-only)
- `Vehicle {defId u16, speed, heading, fuel, health, drift, steer}`: networked and persistent.
- `VehicleSeats {occupant u32[8]}`: rider NetIds (0 = empty). Networked, not persistent.
- `Driver {vehicleNetId u32, seat u8}`: on the rider. Networked.
- `Hitch {towNetId, parentNetId}`: NetIds. Networked and persistent.
- Storage is the existing `Container` (spawnVehicle sizes it from the def), so open, deposit, withdraw, viewers and persistence all work unchanged.

World schema hash with default gameplay installed (`new World(); installGameplay(w)`): **0x7c9a353e** (was 0x524667f7).

## Simulation (`gameplay.vehicles`, simulation phase, right after weather, every peer)
1. Powered vehicles, in NetId order: an arcade kinematic bicycle model. Throttle and steering come from the drive
   input: the target heading is the input direction, and pulling back while slow reverses. Yaw = v·tan(steer)/(0.6·length),
   capped at `turn`. Drift: the velocity angle lags the heading by (1 - grip). Boosting at speed loosens grip.
2. Collision: footprint corners are checked against `movementBlocked` (terrain, walls, doors, solid cells), or against
   `setVehicleBlocker(world, fn)` if one is set. Each axis slides separately. If less than half the step survives, it
   counts as an impact: the vehicle stops, bounces back at -20%, and takes |v|·mass/1000·4 damage.
3. Trailers, parents first: a pin joint places the trailer's front hitch on the tow's rear hitch, and the trailer's
   heading follows the drawbar, clamped to ±1.75 rad (jackknife). Chains such as truck→trailer→trailer work when the allowlists permit them.
4. Riders snap to the vehicle's Transform. `applyMovementInput` ignores entities that have `Driver`.

## Input
The driver's frame goes through `applyGameplayInput`. Analog `moveX/moveY` (or the move bits) and `Sprint` (boost) are
stored with `setDriveInput`, and PlayerIntent.moving is forced to 0 while riding. Bots therefore drive through
`AgentOutput` (moveX, moveY, sprint), and keyboard, gamepad and touch need nothing extra.

## Commands (validated, ADR-092 path; registered after ClanDeclineCmd)
`gameplay.vehicleEnter {target, seat (255 = first free)}`, `gameplay.vehicleExit {}`, `gameplay.vehicleHitch {target = trailer, tow}`,
`gameplay.vehicleUnhitch {target}`, `gameplay.vehicleStation {target, station}`. NetId fields are listed in
`COMMAND_ENTITY_FIELDS`. Server: `installVehicleCommands(world, handlers)` (wired in apps/server game.ts).
Interact: the client calls `vehicleInteractCommand(world, player, target)`, which returns exit while riding and enter otherwise.
Rejection reasons: `dead, already_riding, not_vehicle, no_seats, no_net_id, wrecked, too_far, moving, full, bad_seat,
seat_taken, not_riding, no_hitch, incompatible, already_hitched, tow_busy, cycle, actor_too_far, not_hitched, no_station`.

## Camper interior hook API (Survival wires the station logic)
- `vehicleStations(world, v)` → `{index, key, kind}[]` (kind = StationKind from stations.json).
- `usableVehicleStations(world, player, v)`: non-empty only while parked (|speed| < 0.25), with the player seated in
  the vehicle or within length/2 + 2.5 tiles of it.
- `nearbyVehicleStationKinds(world, player)`: a set of usable kinds, for crafting and cooking station checks.
- `addVehicleStationHook(world, {name, onUse(world, player, vehicle, station)})` runs after `useVehicleStation` or the `vehicleStation` command validates.

## EDGE_ACTIONS (append-only)
`EDGE_ACTIONS` in `packages/input/src/defaults.ts` (mirrored by `GAMEPLAY_EDGES` in gameplay input_hooks.ts) is
**append-only**: a bit index is wire format. New edges go at the end of both lists, the tests pin the order, and removed
edges keep their slot. Vehicles add no edges: enter and exit use the existing Interact hold bit through a client-issued command, and boost is Sprint.

## Not done yet / for other teams
Vehicle vs vehicle and vehicle vs creature collision, damage to riders, render interpolation of heading and drift, net
AOI and prediction tuning, recipes that craft vehicles (Survival: spawn with `spawnVehicle`), and sprites keyed by def id (Art).
