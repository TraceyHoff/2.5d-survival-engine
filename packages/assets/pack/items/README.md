# items sub-manifest (content expansion art)

Art for `packages/gameplay/docs/ART_KEYS_ITEMS.md`, merged at runtime after pack/ui-kit/branding/customization (apps/client/src/view.ts MANIFEST_INDEX).

- `items_icons` — 191 inventory icons, 32×32 cells (same size as pack `items`/`equipment`), art inset 2px per cell, 16 cols.
- `items_nodes` — 14 gatherable nodes, 64×64 cells, 2:1 iso footprint, pivot at feet (anchor 0.5, 0.875 like pack `resources`); `idle` + `depleted` (regrow) frames.
- `items_held_a` / `items_held_b` — `held_<item>` for 54 tools/weapons, 48×48, grip pivot (0.5, 0.75), 8 facings, `dirStride: 1` (pack `held` convention, hands.json anchors).
- Every atlas has a scale-1 page and an `@2x` page (max 1536px).
- Reused pack keys (not redefined): `herbs` (icon), `stone_spear` (+ `held_stone_spear`), `reeds` and `flax` (pack resource sprites already own these keys).

Regenerate: `cd src && python3 build.py .. <preview dir>` then `pnpm --filter @engine/assets lock:ids:pack`.

Seasons HUD temperature gauge (`src/temps.py`, items_temp, resident, 32px + @2x, solid cel): `icon_temp`, `icon_temp_hot`,
`icon_temp_cold` (CSS aliases `data-icon="temp"|"temp_hot"|"temp_cold"`). Run after adr224.py:
`CEL=1 python3 packages/assets/pack/items/src/temps.py [preview dir]`, then ktx2.py, gen_icon_css.py, lock:ids:pack.
