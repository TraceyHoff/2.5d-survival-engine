# Building piece art keys (sub-manifest `packages/assets/pack/building/manifest.building.json`)

Status: art landed (4 tier pages). Survival: adopt these **piece keys** (`BuildPieceDef.key`); the renderer resolves
`building.piece` = `<pieceKey>@tier<N>` from `BuildPiece.tier` (render 9b50b7d) and falls back to the bare `<pieceKey>` sprite.
If `packages/gameplay/docs/ART_KEYS_BUILDING.md` lands, that doc wins and this file will be aligned to it.

## Tiers (gameplay `tiers.json` index)
| tier | material | look |
|---|---|---|
| 0 | twig | main pack `<piece>_twig` art (unchanged, no @tier0 art) |
| 1 | wood | planks, cobble plinth, shingles |
| 2 | stone | ashlar/cobble, slate roof |
| 3 | metal | bolted teal-iron panels, corrugated roof |
| 4 | reinforced | riveted steel plates, cross bracing, hazard trim |

## Piece keys (every one has `@tier1` .. `@tier4`)
Existing gameplay keys (bare sprite stays the main pack's wood art; this pack adds `@tierN` only):
`foundation`, `floor` (solid ceiling), `floor_hatch_frame` (hatch ceiling), `wall`, `wall_low` (half wall), `wall_window`, `wall_doorway`, `pillar`, `roof_flat`, `roof_slope`.
Existing art-only keys (main pack art, this pack adds `@tierN`): `wall_corner` (= outer corner art), `roof_ridge` (= gable art), `roof_hip`, `roof_corner`.
New keys (bare key = tier1 art + `@tier1..4`):

| group | keys | placement | rotation art |
|---|---|---|---|
| foundations | `foundation_triangle`, `foundation_steps`, `foundation_stilt` | cell | triangle/steps unique4, stilt symmetric |
| walls | `wall_arched`, `wall_fortified` | edge | 2 drawn rows (axis), rows reused for rot 2/3 |
| ceilings | `floor_stairwell`, `floor_skylight` | cell, level >= 1 | stairwell 2 rows, skylight symmetric |
| corners | `wall_corner_outer`, `wall_corner_inner`, `wall_corner_angled` | cell (corner post) | unique4 |
| roofs | `roof_gable`, `roof_chimney` | cell, roof | gable 2 rows, chimney symmetric |

## Damage
`BuildPiece.damageStage` 0 intact, 1 scuffed, 2 cracked/chipped, 3 wrecked (frames baked per rotation).
Every sprite declares `crackOverlay: "bld_crack"` (anims `stage1..3`).

## Attach points
`roof_chimney*`: `smoke` (chimney mouth, pivot-relative px) for a smoke VFX.

## Grid
1 cell = 1 iso tile 64x32, pivot = cell centre on the ground, wall height 48 px (1 floor); ceilings and roofs are drawn
from their own level's floor (z = level * floor height), so they sit on wall tops.

## Sprite keys (manifest)
`bld_<piece>_t<N>` -> `building.piece` `<piece>@tier<N>`; new pieces also have `bld_<piece>` -> bare `<piece>` (tier1 art).
`wall_corner@tierN` / `roof_ridge@tierN` reuse the `wall_corner_outer` / `roof_gable` frames. Crack overlay sprite: `bld_crack`.

## Atlas
One page per tier, `building_t1..t4`: 2016x960, 84x96 cells, pivot (42,72) = anchor (0.5, 0.75), 1x only, ~7.7 MB RGBA each.
