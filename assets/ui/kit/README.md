# Cozy Camp UI kit (engine layout)

| What | Where |
|---|---|
| Screens (`ui-screen/1`, `ui-partial/1`) | `assets/ui/screens/<name>.json`, partials in `screens/_partials/` |
| Screen JSON Schema | `assets/ui/screen.schema.json` (screens: `"$schema": "../screen.schema.json"`, partials `../../`) |
| Kit atlases (1x + `@2x` pages, nineSlice) | `assets/ui/kit/*.png` + `manifest.ui.kit.json` (paths relative to this dir) |
| Strings | `assets/ui/strings/en.json` (hooks `craftq.*`/`event.*`/`respawn.*`/`ctx.*`, wardrobe unlock hints/reasons, `stall.*`) |

`manifest.ui.kit.json` = `ui_kit_*` (frames/panels/buttons, nineSlice) + `input_glyphs_*`/`input_touch_*` (pad/keyboard glyphs, touch kit, `glyphs` table)
+ `ui_hooks_*` (craft queue, survival-event banners, touch context). This is the client's `ui-kit`
sub-manifest: `apps/client/src/view.ts` loads it with `mergeManifests` alongside the pack, branding and customization
manifests, so none of these entries (or their PNGs) live in `packages/assets/pack`. `tools/sync_engine_kit.py` writes only
this sub-manifest; ids stay reserved in the single `packages/assets/pack/ids.lock.json` (`pnpm lock:ids:pack` locks the merge
and fails on duplicate keys).
Hook VFX (the only part still written into the pack manifest) (`death_bag`, `respawn_poof`, gate breach …) come from `assets/survival_events/manifest.fragment.json`.

Stall screens (from `assets/stalls/ui/screens`) are copied here; `_partials/item_tooltip.json` is the stalls drop-in successor
(rarity border, crafted-by, durability, price). Stall mock state: `screens/mock/stall_state.json`.

Regenerate from the art repo with `python3 assets/ui/tools/sync_engine_kit.py` (edit the S/EN paths), then `pnpm --filter @engine/assets lock:ids:pack && pnpm check`.
Served by vite under `<base>art/ui/` (kit, screens, strings, schema, fonts, input, hooks/atlas).
