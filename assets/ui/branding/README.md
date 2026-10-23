# Branding (Cozy-Wild / Cozy Camp)

**Title: "SurVivaZ"** (exact casing; final, `titleIsPlaceholder: false`). Mid-word capitals (the V and Z) are drawn as
larger, tilted zombie-mint showpiece letters; the rest uses warm campfire ramps. To rename everything:

```sh
python3 tools/gen_branding.py --title "Real Name" --tagline "optional tagline"   # also saved to branding.json
python3 tools/make_engine_pack.py --engine /workspace/engine   # atlases + merge into packages/assets/pack/manifest.json
(cd /workspace/engine && pnpm --filter @engine/assets lock:ids:pack)          # keys are stable, so ids do not change
python3 tools/build_preview.py
```
Long titles wrap onto two lines automatically. Fonts are Fredoka (titles/buttons) and Nunito (body), both OFL, in `../fonts`.

| Path | What |
|---|---|
| `logo/logo_1024.png`, `logo/logo_512.png` | transparent logo: chunky lettering, plank sign, campfire, leaves, peeking zombie |
| `background/menu_bg_1920x1080.png`, `menu_bg_3840x2160.png` | dusk campsite menu backdrop (centre column kept clear for logo and buttons) |
| `background/parallax/menu_bg_{sky,far,near,fireflies,vignette}.png` | 1920x1080 parallax layers, back to front (suggested drift 0, 0.15, 0.35, 0.6, fixed) |
| `buttons/plates/btn_plate_<k>_<state>.png` (+@2x) | 96x76 nine-slice plates, insets l22 t18 r22 b20 @1x (incl. 6 px focus-ring margin) |
| `buttons/icons/ic_menu_<k>.png` (+@2x) | 40x40 icons |
| `buttons/labelled/btn_<k>_<state>.png` (+@2x) | 320x76 pre-labelled buttons (Fredoka 600) |
| `loading/loading_frame.png` (+@2x) | 64x32 nine-slice frame, l14 t12 r16 b15 |
| `loading/loading_fill.png` (+@2x) | 32x18 nine-slice fill, l8 t7 r8 b7 (anchor at the left) |
| `loading/loading_zombie_walk.png`, `loading_campfire.png` (+@2x) | 6 x 64x64 sheets: walk at 7 fps, fire at 10 fps |
| `engine/` | engine manifest-v1 atlases + `manifest.branding.pack.json` fragment |
| `preview/` | `main_menu_mock.png`, `loading_screen_mock.png`, `loading_anim.gif` (not shipped) |

`<k>` is one of `singleplayer|multiplayer|settings|quit`, and `<state>` is one of `normal|hover|pressed|disabled`. **hover doubles as gamepad/keyboard focus**:
it has a 3 px sky ring (`#3A9CCC`), so focus is never shown by colour alone. The visible plate is 64 px tall @1x (at least 48 dp), so it works as a touch target.
Pressed squashes the lip and drops the face by 3 px. Disabled is desaturated at 70% alpha.

## Engine sprite keys (category `ui`, pack `packages/assets/pack`)
`ui_brand_logo`, `ui_menu_bg`, `ui_menu_bg_{sky,far,near,fireflies,vignette}`, `ui_menu_btn_plate_<k>`, `ui_menu_btn_<k>`
(animations = the four state names), `ui_menu_ic_<k>`, `ui_loading_frame`, `ui_loading_fill`, `ui_loading_zombie` (anim `walk`),
`ui_loading_campfire` (anim `idle`). Atlases are `brand_*`, with @2x pages for everything except the parallax layers.
Text fallback: `screens/main_menu.json` renders the `logo` node with `text: {app.title}`. When `ui_brand_logo` is missing, the client should draw
that title in the Fredoka `hero` style, so keep `app.title` in sync with `branding.json`.
