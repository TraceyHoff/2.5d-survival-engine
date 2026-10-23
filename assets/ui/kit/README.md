# Cozy Camp UI kit (engine layout)

| What | Where |
|---|---|
| Screens (`ui-screen/1`, `ui-partial/1`) | `assets/ui/screens/<name>.json`, partials in `screens/_partials/` |
| Screen JSON Schema | `assets/ui/screen.schema.json` (screens: `"$schema": "../screen.schema.json"`, partials `../../`) |
| Kit atlases (1x + `@2x` pages, nineSlice) | `assets/ui/kit/*.png` + `manifest.ui.kit.json` (paths relative to this dir) |
| Strings | `assets/ui/strings/en.json` (hooks `craftq.*`/`event.*`/`respawn.*`/`ctx.*`, wardrobe unlock hints/reasons, `stall.*`) |

`manifest.ui.kit.json` = `ui_kit_*` (frames/panels/buttons, nineSlice) + `input_glyphs_*`/`input_touch_*` (pad/keyboard glyphs, touch kit, `glyphs` table)
+ `ui_hooks_*` (craft queue, survival-event banners, touch context). The same entries are merged into
`packages/assets/pack/manifest.json` (category `ui`/`glyph`) with copies in `pack/atlases/` — the branding pattern
(`assets/ui/branding/tools/make_engine_pack.py`) — since the client loads only the pack manifest.
Hook VFX (`death_bag`, `respawn_poof`, gate breach …) come from `assets/survival_events/manifest.fragment.json`.

Stall screens (from `assets/stalls/ui/screens`) are copied here; `_partials/item_tooltip.json` is the stalls drop-in successor
(rarity border, crafted-by, durability, price). Stall mock state: `screens/mock/stall_state.json`.

Regenerate from the art repo with `python3 assets/ui/tools/sync_engine_kit.py` (edit the S/EN paths), then `pnpm --filter @engine/assets lock:ids:pack && pnpm check`.
Served by vite under `<base>art/ui/` (kit, screens, strings, schema, fonts, input, hooks/atlas).
