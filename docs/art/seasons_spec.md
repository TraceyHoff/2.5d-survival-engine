# SurVivaZ seasonal art spec (ADR-239 loader, engine ad6399b4+)

Status: shipped on origin/main (ADR-239 / ADR-246). Ground art is the `gt_*` tileset: see `ground_tileset_spec.md`.
Generator: `packages/assets/pack/nature/src/seasons_art.py` (deterministic). Run it with `--no-manifest` to make atlases and previews only. Without the flag it also merges entries into `manifest.nature.json`.

## How the loader picks art
`SeasonArt.resolve(key, season)` uses `<key>_fall` (or `<key>_autumn`), `<key>_winter` or `<key>_summer` when the registry has that key. Otherwise it falls back to the procedural tint flags.
- Twin keys get no procedural pass. They keep the summer key's frame count, animation names, anchor, footprint, sway and building data (frames, layer, rotationArt).
- Every twin has `placeholder: <summer key>`, and its atlas residency is `"stream"`. While a twin streams in, the resident summer sprite shows.
- Building twins use `building.piece = "<piece>@winter"`, because the first declared piece wins in `spriteForPiece`. The season swap goes by key: `wall_stone` becomes `wall_stone_winter`.

## 1. HUD temperature icons (PUSHED)
| key | atlas | where |
|---|---|---|
| `icon_temp`, `icon_temp_hot`, `icon_temp_cold` | UI atlas `assets/ui/atlas/ui_atlas(.png/@2x)` | 1x 32x32 at (588,62) (624,62) (660,62); @2x 64x64 |
| same 3 keys | `items_temp` (items pack, resident, ids 3356-3358) | item/CSS icons |

Commits: 8ec5b90c (items_temp + CSS) and 8fc5a4b7 (UI atlas, append-only `assets/ui/tools/add_temp_icons.py`; run it again after `gen_kit.py`).

## 2. Foliage twins (atlases season_res 64x64, season_tall 96x128, season_huge 128x160; each with a `_sway` mask)
| summer key | fall | winter |
|---|---|---|
| `tree` | `tree_fall` (red-orange, ember islands) | `tree_winter` (snow-laden canopy, slate shade) |
| `oak_tree` | `oak_tree_fall` (crimson + amber; acorns kept) | `oak_tree_winter` (snow canopy, acorns removed) |
| `tree_apple` | `tree_apple_fall` (golden, apples kept) | `tree_apple_winter` (snow, no apples) |
| `tree_pine` | none (evergreen) | `tree_pine_winter` (snow on every tier, heavy caps) |
| `bush` | `bush_fall` | `bush_winter` |
| `berry_bush` (idle + depleted) | `berry_bush_fall` (berries kept) | `berry_bush_winter`: both frames use the picked bush, so **no red berries** |
| `fiber_grass` ("grass") | `fiber_grass_fall` (straw gold) | `fiber_grass_winter` (dry brown + frost tips) |
| `flowers` | `flowers_fall` (rusty petals) | `flowers_winter` (frosted seed heads) |

Note: main already has `tree_autumn`. `tree_fall` takes precedence once it is registered, because the loader checks `_fall` before `_autumn`.

## 3. Snow on roofs and walls (baked `_winter` building pieces, 128x128, anchor 0.5/0.75, unique4 frames)
Atlases: `season_bld_winter`, `season_bld_twig_winter`, `season_bld_stone_winter`, `season_bld_metal_winter`. Each is 2048x1024 with 128 frames.
- Wood: `wall_winter wall_low_winter wall_window_winter wall_doorway_winter wall_corner_winter roof_slope_winter roof_ridge_winter roof_hip_winter roof_corner_winter roof_valley_winter roof_peak_winter roof_flat_winter roof_winter`
- Twig / stone / metal: the same pieces with the tier suffix before `_winter`, for example `wall_twig_winter`, `roof_peak_stone_winter` and `roof_flat_metal_winter`. Twig, stone and metal have no bare `roof` key.

Roofs get a snow blanket on their upward planes, a 3px bare eave, a few bare patches, a drift tone and a hard shade row. Walls get caps 3-6 px thick on the wall top only.

## 4. Weather FX (stream, binary alpha)
| key | atlas | frames |
|---|---|---|
| `fx_snowflake` | season_snowflake | 4 x 32x32 rotating chunky flake |
| `fx_blizzard` | season_blizzard | 6 x 128x64 wind-streak sheet (tileable horizontally) |
| `fx_heat_haze` (optional) | season_heat_haze | 6 x 64x64 warm shimmer strokes |

## 5. Ground, water and ice
Ground cells are `gt_*` sprites: 68x52 (1x) / 136x104 (@2x) frames, anchor (0.5, 18/52), per-season resident pages
`gt_<season>_p<N>`. Winter water is `gt_water_winter` / `gt_water_shallow_winter` plus the `gt_ice` … `gt_ice_f` decals and
winter ice shore edges `gt_shore_<mask>_winter` / `gt_bank_<mask>_winter`. Fall water uses the summer frames plus
`gt_water_leaves_a/b/c`. The engine picks the season set itself (groundArt.ts); full details in `ground_tileset_spec.md`.

## 6. Road twins (stream)
`road_<style>[_m<0..15>]_fall` and `_winter` for path, gravel and paved (102 keys) in `season_roads_fall` /
`season_roads_winter`, each with `placeholder: <summer key>`.

## Palettes (hex)
- Snow `#f6faff`, snow shade `#c9d7ee`, drift `#e6eefb`, snow rim ink `#4f5878`.
- Fall ramps (dark to light), for example tree `#8e3f26 #cf6a2c #f09a3c #ffd27a` plus a secondary ramp in noise islands.
- Winter canopy: two slate shade bands plus two snow bands, for example tree `#3a5560 #5b7f8a`, then snow.
- Grass winter: `#5e4a34 #87683f #ad8c55 #d2b77c`.
All of them are checked under the day, dusk and night grades in `seasons_scene_*.png`.

## Budgets
- `season_*` atlases are stream; `gt_*` ground pages are resident (kept at 1x by the atlas manager).
- Every atlas ships 1x, @2x and KTX2 and stays <=2048 px; every manifest shard stays below 20 MiB.

## Engine leftovers
1. Draw `gt_side_*` faces at height drops (one per level) instead of the flat mesh cliff colour.
2. Separate snow overlay sprites need an overlay attach pass. Until then, snow ships as baked `_winter` pieces.
3. FX director: spawn `fx_snowflake` and `fx_blizzard` by weather, and `fx_heat_haze` for heat.
4. `tree_autumn` vs `tree_fall` precedence (decide whether to drop `tree_autumn`).

## Previews (/workspace/assets/preview)
`seasons_foliage.png` (+ `@2x_view`), `seasons_buildings.png` (+ `@2x_view`), `seasons_fx.png`, `seasons_scene_{summer,fall,winter}.png` (day/dusk/night), `seasons_temp_icons.png`; ground: `ground_seamless_<season>.png`, `ground_slopes.png`, `ground_fixes_ice_grass.png`, `roads_seasons.png`.
