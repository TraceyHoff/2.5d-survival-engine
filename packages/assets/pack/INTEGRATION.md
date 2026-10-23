# Integration notes (art/audio pack → engine)

## What's where
- `/workspace/assets/manifest.json` is the engine **manifest v1** (`@engine/assets` `loadManifest`), with `ids.lock.json` next to it.
  Paths are relative to the manifest folder (`atlases/*.png`, `audio/**/*.ogg`).
- Engine copy: `/workspace/engine/packages/assets/pack/` (same manifest, lock, atlases, OGGs; WAV masters are not copied).
  Load it with `fetchManifest("<base>/pack/manifest.json")`. The lock is picked up automatically because it sits next to the manifest.
- Validated with the real loader. Every key from `sample/` is present with its **original id**: sprites, sounds, vfx, variants, tints and palettes.
  New keys were appended. Registry hash is in `pack/ids.lock.json`; the handshake hash changes vs. sample, as expected.

## Why `sample/` was not replaced
`packages/assets/test/manifest.test.ts` and `extended.test.ts` assert placeholder specifics. Examples: player frames are 32×48, `wall` frames are `[1,5,9,13]`,
the palette source is `#78aa5a`, `validateBuildingSprites` returns exactly 2 issues, and the campfire emissive is `buildings_emissive.png`. Swapping the art in would break
tests owned by Engine Architect. So the real pack lives in `pack/` and has its own test (`test/pack.test.ts`) and lock script (`scripts/write-lock-pack.ts`).
**Requested change (Engine Architect):** either point the shipping game at `pack/`, or move the placeholder assertions to a fixture and make `pack/` the sample.
Then add `"lock:ids:pack": "tsx scripts/write-lock-pack.ts"` to `packages/assets/package.json`. I did not edit that file.

### Updating ids after adding keys
1. `python3 tools/build_all.py` (in `/workspace/assets`).
2. Re-seed the lock: `cd /workspace/engine && node_modules/.bin/tsx packages/assets/scripts/write-lock-pack.ts /workspace/assets`
   (keeps every existing id and appends new keys. Never renumber: the asset hash is part of the multiplayer handshake).
3. Copy to `packages/assets/pack/`. `pnpm lock:ids` (sample) and `pnpm check` must stay green.
4. Commit **only** our paths: `git commit -m "..." -- packages/assets/pack packages/assets/test/pack.test.ts packages/assets/scripts/write-lock-pack.ts`.
   Never `git add -A`.

## Projection / pivots
- `tileW 64, tileH 32, zStep 16` (`@engine/world DEFAULT_ISO`).
- Character, zombie and critter pivot: feet. The sprite is drawn at the Transform foot point (renderer convention).
- Directions are baked for all 8 (or 4) rows in engine `directionIndex` order. No runtime flip is needed.
- Tiles are 64×48: the top diamond (64×32) plus a 16 px camera-facing side skirt (exactly one `zStep`). The pivot is the diamond center `(32,16)`.
  For a column of height h, draw the tile at z = h. The skirt covers the one-level drop; taller cliffs repeat the skirt or use the renderer's cliff faces.
- Building pivot: **footprint center on the ground plane** `(64,96)` of a 128×128 cell.
  The renderer computes the world center as `(tx + w'/2, ty + h'/2)`, where `w',h'` are the footprint after rotation (swapped for odd `rot`).

## Rotation rule (agreed with Survival Systems)
- `rotation 0–3` = logical 90° steps. Local→world for step r applies `(x, y) → (−y, x)` r times, so `rot 1` maps local +x onto world +y.
  This matches `BuildingGrid.footprintTiles` (w/h swap on odd rotations).
- Every building sprite carries `rotationArt: "mirror" | "unique4"` and `building.frames[rotation][damageStage]` (4 × 4):
  - Walls, wall variants, roof ridges, fences, openings, anvil (two drawn orientations; rot 1 is **re-rendered as mirrored geometry**,
    not a pixel flip, so top-left lighting stays correct) ship **4 explicit rows** `[r0, r1, r0, r1]` and are tagged `unique4`
    (`tools/finalize_manifest.py fix_rotation_art`): rot 2/3 must keep the rot 0/1 axis, and the engine never flips a 4-row table.
  - True `mirror` = **2 rows** `[r0, r1]`; the engine draws rot 2/3 as rows 0/1 with FlipX. Used only where a pixel flip looks right
    (`MIRROR_OK`: rugs; pvp_clan: raid_bell, watchtower, storage_box_locked; stalls: blankets, booths).
  - `unique4` (wall_corner, door, door_open, bed, chest, workbench, chair): four rendered rotations.
  - Rotation-symmetric pieces (floor, floor_stone, pillar, table, planter, campfire, torch) list a **single** rotation row (`frames.length === 1`).
    The engine's `buildingFrame` then reuses row 0, and they are tagged `rotationArt: "mirror"`.
- Damage stages: 0 intact, 1 scuffed, 2 cracked + chipped, 3 wrecked (also darker and desaturated).
- `campfire` / `torch`: `building.frames` hold the static, damage-staged frames. `animations.idle` is the lit loop (6 / 4 frames @10 fps).
  `campfire.animations.unlit` and `torch.animations.static` are the unlit frames.

### Build pieces the gameplay registry must define (sprite cross-check: `validateBuildingSprites`)
| sprite key | piece | footprint w×h | layer | notes |
|---|---|---|---|---|
| floor, floor_stone | floor / floor_stone | 2×2 | 0 | 4 px thick |
| wall, wall_stone, wall_window | same | 2×1 | 1 | **48 px tall = 3 zSteps** |
| wall_corner | wall_corner | 1×1 | 1 | L corner: arms toward local −x and −y |
| door, door_open | door | 2×1 | 1 | open/closed are separate sprite keys of one piece |
| pillar | pillar | 1×1 | 1 | sample lists layer 1 (the test fixture uses 2) |
| roof | roof | 2×2 | 1 | gable, ridge along local x; draw at z = wall top (3 levels) |
| fence | fence | 2×1 | 1 | 24 px |
| bed | bed | 1×2 | 2 | headboard at local −y |
| chest, chair | same | 1×1 | 2 | chest latch / chair front at local +y |
| workbench | workbench | 2×1 | 2 | vise at local +x |
| table | table | 1×1 | 2 | |
| planter | planter | 1×1 | 3 | flower box decor |
| campfire | campfire | 1×1 | 2 | emissive page |
| torch | torch | 1×1 | 3 | emissive page |

## Renderer notes
- **Sway:** there are no sway frames. Trees, bushes, fiber grass, flowers and mushrooms carry `sway: {amp, freq, stiffness}` (amp in px at the frame top, freq in Hz,
  stiffness 0..1 where higher = stiffer). Weight is 0 at the pivot and grows with height.
- **Emissive pages** (`<image>_emissive.png`, same layout): `buildings` (campfire/torch flames), `resources` (glow mushrooms), `resources_tall` (twisty-tree lanterns).
  Zombie glowing eyes at night are not done yet (wave 2).
- **Shadows:** characters, zombies and critters have none baked in (survival_fx sheen/sway masks stay clean). Use the renderer `Shadow` component or the `fx_shadow_blob` sprite.
  Static props include a soft 30% contact shadow; set `Shadow.alpha` lower for them if the projected sun shadow doubles up.
- **Wet / cold / shadow variants** are not baked (that is the survival_fx worker's job). Frame layouts and atlas JSONs are stable, and each JSON sits next to its PNG.
- **Fog:** `fx_fog` (atlas `fog`, 256×256, two tileable layers, white/lilac with alpha). Scroll at different speeds.
- **Palette swaps:** `zombie_pale` / `player_dark_hair` sources are the actual ramp colors. Pixels are anti-aliased and shaded, though, so an exact-color map only hits the core tones.
  Recommend a nearest-ramp or hue-range swap in the shader. Variant sets also list sprite-based variants (`player_farmer` → `player_b`, `player_ranger` → `player_c`, `zombie_big`, `zombie_fast`).
- **UI:** the `ui` atlas is the sample placeholder copied through (`atlases/ui.png`, keys `ui_panel`, `ui_button`). The UI worker owns `/workspace/assets/ui` and replaces it.

## Mismatches / questions
1. **Tile ids differ across codebases.** `iso-renderer/src/view.ts` uses `TileType` with `Water=0 … Snow=5`. `engine/packages/render` uses `TileId` with `Empty=0, Water=1 … Snow=6`.
   Sprite keys map to engine TileId: Water→`tile_water`, Sand→`tile_sand`, Grass→`tile_grass` (+`_b`, `_c`), Dirt→`tile_dirt`, Stone→`tile_rock`, Snow→`tile_snow`.
   Sample key `tile_forest` is kept as a forest-floor variant.
2. **SpriteFlag bits differ.** iso-renderer has `FlipX=1, NoShadow=2, Emissive=4, Sway=8`. engine render has `FlipX=1, Emissive=2, Sway=4`.
3. The engine terrain is currently **vertex-colored** (no textures). The tile atlas is ready for a textured or decal pass.
   The terrain palette in `tilemap.ts` could adopt `palette.json` base colors: grass `#8fd15c`, sand `#f6dfa4`, dirt `#c08a5a`, stone `#b8b2b0`, water `#3484bc`, snow `#eef4fb`.
4. **Building level height vs zStep:** `BuildPieceDef.levels` counts levels, but 1 terrain level = 16 px. Walls are drawn 48 px tall (3 zSteps).
   Should one building floor be 3 terrain levels? Roofs assume they sit at +3 levels.
5. **Schema gaps (for Engine Architect, not hacked):** (a) there is no `critter`/`animal` category, so the bunny is `category: "character"` (`critter_bunny`).
   (b) There is no piece-state dimension (door open/closed), so these are two sprite keys for one piece. A `building.states` map would be cleaner.
   (c) `rotationArt` and `sway` are extra, untyped fields: please add them to `SpriteJson`.
   (d) There is no per-sound `loopStart/loopEnd`. The ambience loops are sample-exact as WAV. OGG decoders may add priming, so use the WAV or gapless decoding for loops.
6. Gameplay item keys `iron_axe` and `iron_pickaxe` have icons. Extra icons have no gameplay item yet: `mushroom`, `cooked_meat`, `apple`, `carrot`, `bandage`, `spear`, `club`,
   `helmet_leather`, `armor_leather`, `boots_leather`. Resource keys match `gameplay/data/resources.json`
   (`fallen_branches`, `fiber_grass`, `berry_bush` (+`depleted` anim), `loose_rocks`, `tree`, `boulder`, `iron_vein`).

---
## Wave 2 (Oct 19)

**Schema (batch 9/11) adopted, workaround fields removed:** `critter` category (critter_bunny, critter_chick, critter_frog, critter_hedgehog); door/hatch/shutter open-closed are `building.states` on one key (`door_open` retired, its id stays reserved in the lock); ambience sounds use `loop: {start, end}` in seconds; typed `sway`, sprite `tints` and atlas `masks` (emissive / sheen / sway) come from `survival_fx/main_pack.patch.json`, merged by `tools/finalize_manifest.py`, which build_all also runs. Mask pages are generated by survival_fx tools during the build. Mirror pieces still ship **4 explicit rotation rows**. The 2-row form would flip rotation 0 for rotation 2, and that is wrong for walls on the same axis.

**Build scale = gameplay pieces.json:** one build cell = 1 tile (64×32). Every structural piece is 1×1. Walls are edge pieces drawn centred on the cell centre line, so placement shifts them half a tile to the edge. Wall height = 1 floor = 48 px (FLOOR_HEIGHT_LEVELS=3). Wave-1 2×2 floors and 2×1 walls were re-rendered at 1 tile under the same keys.

**Tiers:** `<piece>` = wood, `<piece>_twig`, `<piece>_stone`, `<piece>_metal` for foundation, floor, floor_hatch_frame, wall, wall_low (half wall), wall_window, wall_doorway, wall_corner, pillar, stairs (unique4), roof_slope / roof_corner / roof_valley / roof_hip (unique4), roof_ridge (mirror), roof_peak and roof_flat (single). Roofs are layer 0 and drawn from their level's floor. Openings: door_wood, door_metal (states closed/open), hatch_wood (states), window_shutters (states), window_glass, window_bars. Every piece has damage stages 0-3.

**Held equipment:** atlas `held` (48×48 frames, pivot = grip at (0.5, 0.75), 8 facings per row, `dirStride: 1`). Sprites: held_<item> for stone/bronze/iron axe and pickaxe, stone_spear, wooden_club, bronze/iron sword, bow, and held_torch (4 frames, emissive). Each character atlas has `atlases/<atlas>.hands.json` with, per frame index, `{x, y, angle, len, behind}`. Put the held pivot at (x, y) in frame pixels, rotate by `angle` (degrees, 0 = up, clockwise) and draw it behind the body when `behind` is true. Player attack frames no longer bake an axe. **Schema gap (for Engine Architect):** there is no per-frame metadata field, so hand anchors live in a sidecar file.

**New animations:** player `run` (6f @14). Zombies get `run` (6f @12), `crawl` (6f @6) and `feed` (4f, munching a carrot, blood-free). Zombie atlases use 19 columns with `dirStride: 38`. There is no AnimState for crawl or feed yet (renderer STATE_ANIMS). New zombies: zombie_mummy and zombie_pumpkin. Zombie eyes and pumpkin carvings have emissive pages, so they glow at night.

**Key claims (survival_fx):** the main pack no longer ships `campfire`, `torch_stand`, `lantern`, `fireplace`, `wood_stove` or `rot`. survival_fx art takes these keys, and their ids stay reserved in `pack/ids.lock.json` (campfire stays 4). Main-pack fire art: `bonfire`, `furnace`, `cooking_pot`, `fx_fire_big`, `fx_fire_huge`.

**Aliases:** wave-1 keys and gameplay keys both resolve. door→door_wood, chest→storage_box, planter→flower_box, spear→stone_spear, club→wooden_club. Wave-1 keys keep their ids.

**Decor variants:** `piece_variants.json` maps BuildPiece.variant to a sprite key for rug, flower_box, potted_plant and painting. variantSets only accept character/zombie bases, and the renderer ignores `variant` for building sprites. **Schema gap.**

**Gameplay proposals:** `data/items_proposed.json` covers 20 orphan icons. water_flask is a single icon with a fill level and no stages. `data/pieces_proposed.json` covers art pieces that are not in pieces.json yet.

**Mismatches to resolve:** gameplay `building.levelHeight = 2` vs engine FLOOR_HEIGHT_LEVELS = 3. The renderer TILESETS.md says layer 3 = roof (cutaway), but gameplay and world say 3 = decor and roofs are layer 0. Banners are left to pvp_clan. The reinforced tier has no art yet.
