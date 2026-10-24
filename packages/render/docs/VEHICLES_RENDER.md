# Vehicle rendering — asset spec (packages/render)

Implements docs/VEHICLES.md on the render side. Procedural placeholder art is built by `buildVehicleDebugPack(defs)`
(src/vehicles/atlas.ts); real art must follow the same layout and drop in unchanged.

## Atlas / sprite keys
- One atlas per vehicle def: `veh_<id>` (manifest category: **vehicle** — requested from core/assets; the debug pack patches it in).
- Columns = segments along the body (front→rear; long bodies are split ~1.5 tiles per segment so depth sorts per segment).
  Campers add one extra column per segment for the interior: key suffix `_int`.
- Rows = 8 directions, row r = heading r·45°, 0 = +x world, counter-clockwise (heading quantised by `quantizeHeading`).
- Sprite keys: `veh_<id>_s<i>` and `veh_<id>_s<i>_int`; frame = direction row.
- Pivot: the segment centre **on the ground** (z = 0). Placeholder frame for camper_rv: 134×106, pivot (67,71).
- Pixel scale: 64 px per tile across (iso 2:1), 16 px per z unit.

## Anchors (src/vehicles/layout.ts, in vehicle-local u/v tiles, u forward)
- `seats[]` — rider position + facing; riders keep their own sprite, placed at the seat (gameplay sets AnimState Sit = 13; atlas falls back sit → idle). Anchors come from vehicles.json `seatAnchors` (fallback `defaultSeatAnchors`).
- `hitch` — rear pin for trailers; trailer heading follows the pin joint (`hitchU`, trailer heading from snapshots, fallback solver).
- `headlamps[]` — front lamp positions; emit cone lights into the lightmap when the engine/lights are on (night/dusk). Gameplay replicates `VehicleState.flags` (bit 0 engine, bit 1 headlights; `isEngineOn` / `headlightsOn`). Hitch points: vehicles.json `hitches[].anchor`.

## Sprite flags (src/ids.ts)
- `Footprint` (128): pixels below the pivot take ground-plane depth, so long bodies don't staircase into terrain; footprint
  sprites never auto-fade (vehicles only occlude via an explicit Occluder).
- `Footprint|Cutaway` (192): interior sprite while the local player is inside — no height term, so occupants draw on top.

## Runtime
`VehicleView` (src/vehicles/view.ts): consumes `VehicleSnapshot`s at tick rate; smooths position, heading (shortest-arc wrap)
and drift; spawns/destroys segment entities; swaps to `_int` + Cutaway for the vehicle the local player is inside.
Works on normal, `?gl=lowend` and `?gl=safe`. Demo: `?vehicles=1`, `?vehicles=camper`.

## Known limitations
- Cutaway depth: the nearest interior segment's front wall may clip the occupant's legs; terrain can nibble the extreme
  near corner of interior floors. Proper fix = a dedicated interior pass (open question).

## Target sprite sizes for Art (per-type scale, render scale.ts)

Player sprite = 74 px pivot-to-head at 1x. Length = footprint x 45.25 px (E view); height = roof above pivot; segment = length / segments. Clearance = lowest non-wheel body z. Seat = rider hip height (vehicles.json z x stretch). Art column: measured d40bc37 sprite (length x height) and the scale the renderer applies.

| def | class | segs | seg WxH | full LxH | placeholder frame | clearance px | roof / player | seat z px | Art now -> scale |
|---|---|---|---|---|---|---|---|---|---|
| bike_basic | bicycle | 2 | 41x46 | 81x46 | 48x69 | 19 | 0.62 | 16 | - |
| bike_road | bicycle | 2 | 41x46 | 81x46 | 48x69 | 19 | 0.62 | 16 | bike_road 86x43 -> x1.07 |
| bike_mountain | bicycle | 2 | 41x47 | 81x47 | 48x70 | 20 | 0.64 | 17 | bike_mountain 86x48 -> x0.99 |
| bike_bmx | bicycle | 2 | 41x37 | 81x37 | 48x61 | 15 | 0.50 | 13 | bike_bmx 70x35 -> x1.06 |
| bike_fat_tire | bicycle | 2 | 41x47 | 81x47 | 48x70 | 20 | 0.64 | 17 | - |
| bike_cruiser | bicycle | 2 | 41x46 | 81x46 | 48x69 | 19 | 0.62 | 16 | - |
| bike_tandem | bicycle | 2 | 59x46 | 118x46 | 66x77 | 19 | 0.62 | 16/16 | bike_tandem 120x45 -> x1.02 |
| bike_cargo | bicycle | 2 | 55x49 | 109x49 | 62x78 | 20 | 0.66 | 17 | bike_cargo 113x45 -> x1.09 |
| bike_trike | bicycle | 2 | 43x46 | 86x46 | 66x74 | 19 | 0.62 | 16 | - |
| car_compact | car | 3 | 54x89 | 163x89 | 96x139 | 15 | 1.20 | 17/17 | car_hatchback 99x54 -> x1.64 |
| car_sedan | car | 4 | 52x95 | 208x95 | 102x148 | 16 | 1.28 | 18/18/18/18 | car_sedan 111x52 -> x1.82 |
| car_muscle | car | 4 | 54x89 | 217x89 | 106x143 | 15 | 1.20 | 17/17 | car_sports 117x45 -> x1.97 |
| car_offroad | car | 3 | 66x107 | 199x107 | 114x162 | 27 | 1.45 | 19/19/19/19 | car_suv 120x69 -> x1.56 |
| car_wagon | car | 4 | 56x96 | 222x96 | 104x149 | 16 | 1.30 | 19/19/19/19/19 | - |
| truck_pickup | truck | 4 | 61x111 | 244x111 | 114x170 | 20 | 1.50 | 17/17/17 | car_pickup 125x60 -> x1.85 |
| truck_flatbed | truck | 5 | 59x118 | 294x118 | 120x180 | 22 | 1.60 | 18/18 | - |
| truck_box | truck | 5 | 63x155 | 317x155 | 126x221 | 20 | 2.10 | 17/17 | truck_box 153x93 -> x1.67 |
| van_cargo | van | 4 | 59x126 | 235x126 | 112x185 | 17 | 1.70 | 17/17 | van_delivery 130x73 -> x1.72 |
| van_passenger | van | 4 | 61x122 | 244x122 | 114x181 | 16 | 1.65 | 16/16/16/16/16/16/16/16 | van_minivan 125x68 -> x1.80 |
| camper_van | camper | 4 | 68x137 | 272x137 | 122x201 | 17 | 1.85 | 15/15/15/15 | - |
| camper_rv | camper | 6 | 68x155 | 407x155 | 134x226 | 19 | 2.10 | 17/17/17/17/17/17 | camper_motorhome 140x82 -> x1.90 |
| semi_tractor | semi | 5 | 59x170 | 294x170 | 128x237 | 28 | 2.30 | 18/18 | truck_semi_cab 138x97 -> x1.75 |
| trailer_utility_small | trailer | 2 | 57x56 | 113x56 | 118x106 | 19 | 0.75 | - | trailer_utility 94x48 -> x1.16 |
| trailer_cargo_medium | trailer | 3 | 60x111 | 181x111 | 122x171 | 21 | 1.50 | - | trailer_box 196x95 -> x1.17 |
| trailer_flatbed_large | trailer | 4 | 68x67 | 272x67 | 130x132 | 36 | 0.90 | - | trailer_flatbed 189x41 -> x1.62 |
| trailer_livestock | trailer | 4 | 68x130 | 272x130 | 130x195 | 23 | 1.75 | - | - |
| trailer_tanker | trailer | 5 | 59x141 | 294x141 | 122x202 | 21 | 1.90 | - | trailer_tanker 196x69 -> x2.04 |
| trailer_camper | trailer | 5 | 59x133 | 294x133 | 122x198 | 18 | 1.80 | - | camper_trailer 128x73 -> x1.82 |
| semi_trailer_box | trailer | 8 | 74x178 | 588x178 | 138x248 | 17 | 2.40 | - | trailer_box 196x95 -> x1.87 |
| semi_trailer_flatbed | trailer | 8 | 74x74 | 588x74 | 138x144 | 21 | 1.00 | - | trailer_flatbed 189x41 -> x1.80 |