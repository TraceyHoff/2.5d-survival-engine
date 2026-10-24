# building sub-manifest

Tiered base-building pieces (tier1 wood, tier2 stone, tier3 metal, tier4 reinforced); keys in `assets/building/KEYS.md`.

Rebuild: `cd src && python3 build.py ..` (uses `assets/tools` box/roof toolkit), then `python3 preview.py /workspace/assets/building/preview`
and `pnpm --filter @engine/assets lock:ids:pack`.

- 24 pieces x 4 tiers, 4 damage stages each (baked), `crackOverlay: bld_crack`.
- Rotation rows: symmetric pieces 1 row (`mirror`), axis pieces (walls, ceilings with an axis, gable) 2 drawn rows as `[r0,r1,r0,r1]` `unique4`, asymmetric pieces 4 rows.
- Cells cropped from the 128x128 render cell at (22,24) to 84x96; pivot (42,72). Pages 2016x960, one per tier, 1x only.
- `roof_chimney` has a `smoke` attach point.
