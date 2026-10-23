# survival_fx: survival-system art and FX for the Cozy-Wild pack

Supporting art for rain/wetness, cold and heat, wind, food decay, stamina, heat sources and day/night.
It follows `../STYLE_GUIDE.md` and `../palette.json`. Everything is procedural (Python + Pillow + numpy), drawn at 4x
supersampling and downscaled with premultiplied LANCZOS. The 2x atlases are rendered from an 8x source, so they are not upscaled.
Outlines use the plum/brown `ink` ramp and never pure black. Light comes from the top-left. Nothing has baked lighting or cast shadows.

Rebuild everything with `python3 tools/build_all.py [--skip-previews]`. That runs the generators, preview copies of the masks, the tuning file, the manifest fragment + main-pack patch and the previews.
**Flame light:** heat-source light colours are natural (campfire `#ff9a4a`, large fire/fireplace `#ff8f40`, torch `#ffa54f`, stove `#ff8238`, lantern `#ffb060`, window `#ffb469`). Emissive pixels bypass scene lighting since engine d30cdda, so the old compensated set (`#ffb273`, ...) is gone; previews simulate unlit emissive too.
To validate against the real engine loader: `cd /workspace/engine && node_modules/.bin/tsx /workspace/assets/survival_fx/tools/validate_fragment.ts`.
This loads the fragment on its own, then merged (plus `main_pack.patch.json`) into `../manifest.json` and into `/workspace/engine/packages/assets/pack/manifest.json`, and fails on any key collision. All three pass with zero warnings: 68 sprites and 29 vfx alone, 169 and 43 merged.

## Renderer decisions this pack follows
- **No baked wet or frost overlays.** Wetness is a shader tint plus sheen driven by `<atlas>_sheen.png`. The frost rim is the renderer's outline-rim effect.
  Exhausted and flush are tint parameters. Shiver is a shader offset (amplitudes are in `render_tuning.json`).
- **No sway frames.** Wind sway is a vertex shader. Per-sprite `{amp, freq, stiffness}` are typed `sprite.sway` (own sprites in the fragment, main-pack sprites in `main_pack.patch.json`).
  Weight masks are atlas `masks.sway` pages named `<atlas>_sway.png`, next to the atlas.
- Drips, sweat and breath are **particle sprites** that the renderer spawns.
- LUTs are **256x16 strips** (details below). There is also a **256x8 time-of-day ramp**.
- Heat shimmer is a **tileable RG offset texture** that the renderer scrolls upward. Light cookies are **grayscale, power-of-two**.
- Puddle, wet ground, snow cover and frost are **tileable on the 64x32 iso tile** and blended by mask. Cloud shadows are **one 1024 tileable grayscale** texture.
  Lightning is a set of bolt sprites, and the renderer does the screen flash.

## Layout
```
manifest.fragment.json   engine manifest v1 with typed fields only (no x_survival): atlases with pages [{scale 2}] and
                         masks {emissive: true}; sprites (sway on own props); vfx
main_pack.patch.json     typed fields for the MAIN pack's entries: atlases[].masks {sheen|sway: atlases/<atlas>_<kind>.png},
                         sprites[].sway (trees/plants), sprites[].tints {wet, frost, flush, exhausted} on every character/zombie
key_claims.json          gameplay keys this pack provides art for, fallback keys used on collision, texture list
render_tuning.json       HOW TO APPLY every overlay: blend, anchor, intensity mapping, rates, light params
daynight_grading.json    7 grading keyframes + LUT/ramp format docs + StyleConfig suggestions
atlases/surv_*.png|json  grid atlases (1x), *_2x.png|json (2x), *_emissive.png (same layout); TexturePacker JSON-hash
lut/                     lut_<keyframe>.png (256x16), lut_identity.png, tod_ramp_256x8.png
textures/                tileable / standalone textures (cookies, noise, rain, clouds, stars, vignettes, shimmer)
sheen/, sway/            PREVIEW copies of the masks (the shipped ones are written next to the main atlases by the main-pack build)
preview/                 contact sheets, day/night strip, status sheet (+gif), food grid, campfire/rain/snow GIFs
tools/                   generators (gen_*.py), make_sheen_mask.py, make_sway_mask.py, build_manifest.py, tuning.py,
                         previews.py, build_all.py, validate_fragment.ts; ftoon.py/vpalette.py are vendored read-only
                         copies of ../tools/toon.py and palette.py (+ a 2x scale factor)
build/                   intermediate json + demo test inputs (not shipped)
```

## Atlases (uniform grids, max 2048 px, one category per page set)
Each atlas is a grid in engine manifest v1 format, plus a TexturePacker JSON hash with frame names `<sprite>/<anim>/<i>`, a normalized `pivot` and `duration`.
**Padding:** the engine grid math (`x = (f % columns) * frameW`) has no gutter, so every frame keeps a **2 px transparent margin inside the frame**.
The generator checks this. That gives a 4 px gap between neighbouring content. The tile-overlay atlas is the exception: its diamonds reach the frame edge on purpose, just like terrain tiles.

| atlas | frame | contents | emissive |
|---|---|---|---|
| surv_heat | 64x64 | campfire* (idle 6f@10 / embers 4f@5 / unlit; medium = idle/embers/unlit, plus *_small and *_large anims), torch_stand (idle 4f, unlit), lantern (idle 4f, unlit), heat_brazier (6f, not a piece) | yes |
| surv_heat_large | 128x128 | fireplace (stone, chimney, 6f), wood_stove (pot-belly, heart window, 6f) | yes |
| surv_fire_particles | 16x16 | fx_ember, fx_fire_spark | yes |
| surv_heat_ring | 256x128 | fx_heat_ring (4f subtle dashed pulse) | no |
| surv_status | 32x32 | fx_drip, fx_sweat_drop, fx_breath_puff, fx_splash_feet, fx_icicles, fx_tired_spiral, fx_sweat_swirl, fx_zzz, fx_bubble_hungry/freezing/overheating/exhausted | no |
| surv_wind_particles | 32x32 | fx_wind_leaf_green/autumn (8f tumble), fx_wind_petal_pink/white, fx_dust_gust, fx_smoke_puff (8f) | no |
| surv_wind | 64x64 | fx_wind_streak (8f draw-on swoosh) | no |
| surv_wind_props | 64x64 | windsock (calm/breeze/gust), prop_flag (6f flap) | no |
| surv_tiles | 64x48 (diamond in the top 32, anchor 0.5,1/3 like terrain) | tile_ov_puddle_s/m/l (idle + ripple 6f), tile_ov_wet_ground, tile_ov_snow_cover, tile_ov_snow_edge (16-frame neighbour bitmask), tile_ov_frost | no |
| surv_weather_particles | 32x32 | fx_rain_splash_crown, fx_snowflake (6 variants) | no |
| surv_lightning | 96x256 | fx_lightning_bolt strike_a/b/c (3f each) | yes |
| surv_rainbow | 256x128 | fx_rainbow | no |
| surv_food | 32x32 | food_<itemKey> x 10 foods + food_water_flask: anim `stages` (frame index = spoil stage 0-3) + aliases fresh/stale/spoiling/rotten; water flask also `fill` (0 full .. 3 empty); rot (compost lump), food_badge_*, food_overlay_fuzz (light/heavy), food_overlay_stink, fx_flies | no |
| surv_night | 64x64 | prop_glow_mushroom_a/b/c (6f pulse + spores) | yes |
| surv_moon | 64x64 | fx_moon phases (full, gibbous, half, crescent; sleepy face) | yes |
| surv_night_particles | 16x16 | fx_firefly_glow | yes |
| surv_window_glow | 32x32 | window_glass_lit, window_bars_lit (left/right), window_shutters_lit (left/right closed with lit slats + heart, left_open/right_open); 4f flicker, skewed per wall face | yes |

Emissive pages are **clipped to the sprite alpha**, because the composite uses emissive as an "ignore darkness" weight on the scene colour.
A halo outside the sprite would brighten the ground at full strength. Real glow comes from `LightSource` and cookies.
All keys avoid collisions with the main manifest (the build checks this). Prefixes: `fx_`, `heat_`, `prop_`, `tile_ov_`, `food_`.

## How the renderer applies the overlays (full numbers in `render_tuning.json`)
| effect | input | how |
|---|---|---|
| Wet | wet 0..3 → wetness 0/85/170/255 | `<atlas>_sheen.png`: R = sheen, G = darken weight, B = drip-start, A = alpha. `col *= mix(1,[.80,.85,.97], G*w*.9)`; sat +10%·w; `col += #e8f6ff * R * w * 0.35`. Drips: `status_drips` at 0/0.8/1.8/3.2 per s, spawned on B>0.5 pixels. Footstep splash `status_feet_splash` at the feet in puddles or rain. Normal blend. |
| Cold | 0..3 | Frost rim `#cfeaff`, width 0/1/1/1.5 px, alpha 0/.35/.6/.85 (renderer rim). Tint ×[.92,.96,1.08] and sat .86 at level 3 (optionally skin-weighted by 1-G for blue cheeks). Shiver x-offset 0/.35/.7/1.2 px at 16 Hz in bursts. Breath `status_breath` every 3/2/1.3 s at the mouth, drifting with wind. `fx_icicles` snow cap on the head top at level 3. `emote_freezing`. |
| Hot | 0..3 | Flush ×[1.10,.95,.92] and sat 1.08 at level 3. Sweat `status_sweat` 0/.4/1/1.8 per s at the head. Shimmer: `heat_shimmer_rg_128` (offset = (rg-.5)·2·px, 0/0/.6/1.2 px) scrolling up at 18 px/s, masked by `heat_shimmer_mask_64x128`. `emote_overheating`. |
| Exhausted | stamina s | Tint ×[.95,.94,1.0], sat .78, brightness .94, lerped by (0.35-s)/0.35. Optional 3% Y-squash ("droopy" pose). `status_tired_spiral` above the head when s<0.15, `status_sweat_swirl` when sprinting tired, `status_zzz` when resting. |
| Hungry | hunger<25% | `emote_hungry` bubble at the bubble anchor, 20 s cooldown. |
| Emote bubbles | | Anchor at (+8,-52) from the feet for survivors. Fade in 0.15 s and out 0.25 s. One per entity. Priority: freezing > overheating > hungry > exhausted. |

Attach points measured from the pivot (feet), in 1x px: head top (0,-48) for survivors, (0,-46) for zombies, (0,-62) for the brute; mouth (6,-30), mirrored for left facings.

**Heat sources:** each has a light preset (radius in tiles, natural colour `#ff9a4a`, flicker) in `render_tuning.json`. The embers and smoke emitters are
`heat_embers`, `heat_smoke` and `heat_chimney_smoke`. `fx_heat_ring` is the heat-radius indicator, additive at about 45%; scale = radiusTiles·45.25/118.
Light cookies are in `textures/light_cookie_{64,128,256,512}.png`. Also included: a lobed `light_cookie_fire_256` for flicker and a `light_cookie_window_256` pane pattern.

**Wind:** the sway formula is in render_tuning.json; per-sprite values are typed `sway` (trees 1.4 to 2.6 px at 0.24 to 0.36 Hz, grass 1.8 px at 0.85 Hz, rocks and stumps 0).
Particle drift factors cover smoke, breath, leaves, petals, dust, snow, embers and fireflies. Smoke bends because puffs rise at about 22 px/s while drifting downwind. The windsock anim is picked by wind strength.

**Weather:** the rain streak texture has 2 parallax layers, with slant `wind*0.45+0.08` to match weather.ts. Puddles grow s→m→l with rain accumulation, and the ripple anim is layered on top.
`tile_ov_wet_ground` alpha = ground wetness. Snow edges are a 16-frame bitmask: bit0 +x (SE edge), bit1 +y (SW), bit2 -x (NW), bit3 -y (NE).
They draw on non-snow tiles next to snow. The fog noise can stand in for the composite fbm. Cloud shadows scroll at windVec·0.6+6 px/s with strength 0.18 to 0.30.
Lightning: a bolt sprite plus the renderer's lilac flash `#e8e4ff`. The rainbow appears after rain in daylight.

## Day/night grading (`daynight_grading.json`)
`ambient` is a linear light multiplier, the same meaning as `render/timeOfDay.ts` AMBIENT. sat, contrast, lift and gain map 1:1 to `StyleConfig.grading`.
| key | hour | ambient | sun | shadow | fog | sat | lift | gain |
|---|---|---|---|---|---|---|---|---|
| dawn | 5.8 | .84 .66 .72 | #ffb08a ×.5 | #5a3c6e | #d9a8b8 | 1.04 | .035 .012 .035 | 1.05 .96 1.00 |
| morning | 8.5 | .96 .95 .90 | #fff0d0 ×.9 | #5a5a8a | #cfe0ec | 1.05 | 0 .004 .012 | 1 1 .99 |
| noon | 12.5 | 1.02 1.00 .97 | #fffaf0 ×1 | #4c5a8c | #d8e8f0 | 1.08 | 0 0 .01 | 1 1 .99 |
| golden_hour | 17.3 | 1.00 .76 .62 | #ffb070 ×.85 | #6a4a7a | #f0c890 | 1.04 | .03 0 .025 | 1.06 .95 .97 |
| dusk | 19.0 | .72 .52 .70 | #ff8a70 ×.35 | #4a3268 | #a07aa8 | 1.05 | .035 .01 .055 | 1.02 .92 1.04 |
| night | 21.5 | .43 .41 .70 | moon #b0c0ff ×.3 | #2e2a5c | #4a5088 | 0.92 | .03 .018 .065 | .97 .95 1.08 |
| deep_night | 2.0 | .33 .31 .58 | moon #9fb0ff ×.22 | #2a2350 | #3a3f6e | 0.86 | .03 .016 .06 | .95 .94 1.08 |

Suggested StyleConfig: `lightBands 4, bandMix 0.55, nightMinBrightness 0.30, nightTint [0.55,0.58,0.95], emissiveStrength 1.15`.
Vignette strength per key ranges from 0.08 to 0.55, using `textures/night_vignette_512.png`.
**LUT format:** 256x16, a 16³ cube laid out as 16 slices of 16x16. Red runs along x inside a slice, green runs along y (top row = 0), and blue is the slice index (left = 0).
It is sRGB in and sRGB out, applied after lighting, fog and haze. A LUT bakes grading only (sat, contrast, split-tone, gain, lift), so do not also apply `StyleConfig.grading` while a LUT is bound.
The split-tone protects saturated bright colours, so fire and glow stay vivid. Blend the two neighbouring LUTs by the smoothstep hour weight.
**tod_ramp_256x8:** x = hour·256/24. The rows are ambient/1.25, sun·intensity, shadowTint, fogTint, sky, lift·4, gain/1.25, and (sat/1.25, contrast/1.25, vignette).

## Masks
- Both mask tools write `<atlas>_<kind>.png` **next to the source atlas by default**; `--out-dir DIR` overrides (this pack's own build uses
  `--out-dir ../sheen|../sway` so it never writes into the main pack's folders). The main-pack worker runs them in its build — the exact commands
  are in `main_pack.patch.json.maskCommands` — and merges the patch so atlases reference them as `masks.sheen` / `masks.sway`.
  One 1x mask per atlas serves every `pages` scale (masks are sampled by UV).
- `tools/make_sheen_mask.py ATLAS.png ... [--out-dir]` or `--scan /workspace/assets` works on any layout, since all its operations are local.
- `tools/make_sway_mask.py ATLAS.png [--json|--manifest|--frame WxH --pivot-y]` gives 0 for trunk, roots and rock (bark/stone colour match plus height) and up to 255 at canopy tips.
  Ink lines inherit their neighbour's weight. It has been run on resources_tall and resources.

## Previews
`preview/contact_{heat,status,wind,weather,food,daynight}.png`, `daynight_strip.png` (the same scene graded through all 7 keys: lighting, bands, night floor, LUT and vignette, simulated with the engine formulas),
`luts.png`, `status_effects.png` and `.gif` (survivor and zombie: normal, wet, cold, hot, exhausted, plus bubbles), `food_decay_grid.png`, and `campfire.gif` (night with light pools, then a day row with torch, brazier and large fire),
`rain.gif`, `snow.gif`.

## Gameplay keys (source of truth: packages/gameplay/data/pieces.json, items.json, stations.json)
- Heat/wind pieces: `campfire`, `torch_stand`, `lantern`, `fireplace`, `wood_stove`, `windsock` (the last three are not in pieces.json yet).
  `campfire` is already a sprite in both main manifests, so it ships as **`surv_campfire`** until the main pack drops its own; `build_manifest.py`
  claims the key automatically once it is free (see `key_claims.json`). Old `heat_*`/`prop_windsock`/`prop_window_glow` keys are gone (nothing referenced them).
- Windows: lit emissive variants `<piece>_lit` for `window_glass`, `window_shutters`, `window_bars` (engine variantSets only allow character/zombie bases, so they are separate sprites).
- Food: spoil stage 0 fresh, 1 stale, 2 spoiling, 3 rotten → `registry.frame(id, "stages", 0, stage)` (fps 1, no loop, so time = stage). At 100% the stack becomes item `rot` → sprite `rot`.
  Food icons stay `food_<itemKey>` because the main pack already owns unstaged `berries`, `mushroom`, `carrot`, `apple`, `cooked_meat`, `water_flask` item icons.
