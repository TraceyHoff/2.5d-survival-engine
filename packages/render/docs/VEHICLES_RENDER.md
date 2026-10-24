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
