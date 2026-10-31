# SurVivaZ ground tileset (gt_*): Summer / Fall / Winter

Generator: `packages/assets/pack/nature/src/ground_{core,mats,paint,tiles,preview,pack}.py` (deterministic).
`python3 packages/assets/pack/nature/src/ground_pack.py` renders the cells missing from `$GROUND_CACHE`, packs the 1x and @2x
pages and merges the `gt_*` entries into `packages/assets/pack/manifest.json` (`--manifest-only` rewrites only the entries).
Then run the targeted chain (ktx2.py on the pack manifest, `pnpm --filter @engine/assets lock:ids:pack`,
`pnpm art:shard-manifest`, `pnpm art:check-manifest-size`); not the full build.py chain.

## Cell format (terrainTiles.ts, ADR-246 / ADR-249)
- Frame **68x52 at 1x, 136x104 at @2x**: the 64x32 diamond (rows 2..34 of the cell) plus a 16 px level area below it, padded 2 px on every side.
- Anchor **(0.5, 18/52)** = (34, 18) px at 1x: the diamond centre.
- The 16 px below the diamond (one height level, zStep 16) is the skirt area. **Base tiles leave it empty** (only a
  2 px front-edge bleed ring of the tile's own texture, which the shader keeps up to 1.02 of the diamond and the front
  neighbour covers). Side faces are the separate `gt_side_*` sprites.
- Binary alpha (0/255), flat cel fills (4 tones per material plus decoration inks). No per-tile outline or rim on any
  ground tile, in any season; outlines are only on objects/decorations painted on top (pebbles, tufts, flowers).
- RGB under alpha 0 is push-pull dilated per page (same as ktx2.py), so filtered, mipped or downscaled pages (atlas
  manager k<1) never pull black or a neighbour cell's colour into a tile edge.
- Pages: `gt_<season>_p<N>`, 15 columns, <=19 rows (<=1020x988 at 1x, <=2040x1976 @2x), each with a KTX2 sibling.
  Residency: resident (`RESIDENT_GROUND_RE = /^gt_/`, kept at 1x). Every sprite has a placeholder.

## Keys
| material | base keys (6 variants) | seasons |
|---|---|---|
| grass | `gt_grass`, `gt_grass_b` … `_f` | `<key>_fall`, `<key>_winter` |
| dirt | `gt_dirt` … `_f` | same |
| forest floor | `gt_forest` … `_f` | same |
| sand | `gt_sand` … `_f` | same |
| stone | `gt_rock` … `_f` | same |
| mud | `gt_mud` … `_f` | same |
| snow | `gt_snow` … `_f` | same |
| water | `gt_water`, `gt_water_shallow` (4 frames, 4 fps) | fall uses summer water + `gt_water_leaves_a/b/c`; `gt_water_winter`, `gt_water_shallow_winter` = ice; `gt_ice`, `gt_ice_b` … `_f` |
| side faces | `gt_side_<mat>` (top level, with lip), `gt_side_<mat>_low` (lower levels, no lip); `gt_side_rock[_low]` for stone | `_fall`, `_winter` |

- Variant pick: `((imul(x,374761393)^imul(y,668265263))>>>0) % 997 % 6`.
- Placeholders: bases -> the legacy terrain sprite of the same material; fall/winter twins -> their summer twin; summer edges -> the invader base;
  summer shore/bank -> `gt_water_shallow`; leaf decals -> `gt_water`; `gt_side_<mat>` -> `gt_<mat>`; `gt_side_<mat>_low` -> `gt_side_<mat>`.

### Water colour
`gt_water*` art carries baked colour (slate blue, `#4c646f #607984 #7a929d #94acb7 #d8f1fc`) with the luminance of the
old grey ripples. The ADR-249 water branch adds the art chroma on top of its tint
(`deep = (.09,.27,.56) + detail*.7 + (lum-.45)*.35`, `detail = art - lum`), so the bake is limited to 30 % of the
mid-depth tint chroma: emulated in-game result differs by <=13/255 per channel from the grey art. A fully coloured bake
would shift it by ~40/255 and saturate the deep tone, which reads as a doubled tint.

### Side faces (`gt_side_*`)
One 16 px level of camera-facing faces in the skirt area of a 68x52 cell: left half = +y face, right half = +x face
(darker). Strata of the material's side kind (soil, sand, rock) plus the top material's lip; no dark bottom line. The
engine would draw it where a +x/+y neighbour is lower (same mask bits as the skirt rule) and stack one per level of drop:
`gt_side_<mat>` for the top level, `gt_side_<mat>_low` (same strata, no lip) for each level below it.
Until it does, the vertex-colour mesh cliff faces show at drops.

## Seamlessness
- Every variant of a material shares only a high-frequency periodic field (period = 1 tile) along its edges, so
  neighbours always meet; low-frequency structure (islands, moss, slabs, puddles, flowers, litter) stays inside the tile.
- Verified with 8x8 mixed fields per season from the packed pages, with the ADR-249 shader emulated, at @2x and after
  a 4x page downscale: `/workspace/assets/preview/ground_seamless_<season>.png`.

## Transitions: blob-47 overlays
- `gt_<inv>_edge_<mask>[_fall|_winter]`, masks N=1 E=2 S=4 W=8 NE=16 SE=32 SW=64 NW=128; a corner bit is dropped when
  either adjacent edge is set (47 masks).
- Priority (low -> high): stone < sand < dirt < mud < forest < grass < snow. A cell draws its base, then one overlay per
  higher-priority neighbour material, in priority order.
- Shape: union of set edges/corners (1 - d/0.5) plus a per-invader periodic wobble, cut at 0.5. The boundary band uses
  the invader's mid tone: soft and organic, never a dark rim. Grass adds tufts, snow a light drift lip.
- Shores: `gt_shore_<mask>` (sand) and `gt_bank_<mask>` (soil bank, light mud tones), 4 frames of lapping foam in summer
  and fall; winter is a static ice edge. The water part is baked with the shader's shallow tint so it meets tinted water.

## Heights
Heights are integer levels (16 px each); water sits 0.25 level lower. See `ground_slopes.png` and the slope
recommendation in the ADR-246 follow-up report.
