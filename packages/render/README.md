# @engine/render

A 2.5D isometric WebGL2 renderer for the engine, with no engine dependencies beyond `@engine/core`, `@engine/world` and `@engine/assets`.
- Reads the ECS world read-only with `render(world, alpha)` and interpolates between `PrevTransform` and `Transform`.
- Content comes from the `@engine/assets` registry. The content integration spec is in [docs/TILESETS.md](docs/TILESETS.md).

## Run
```
pnpm --filter @engine/render dev        # demo at http://localhost:5173
pnpm --filter @engine/render build      # tsc + vite build
pnpm --filter @engine/render shots      # headless screenshots + software benchmark (needs Chrome; NOT part of vitest)
pnpm vitest run packages/render         # unit tests
```

### Demo content
- When `/workspace/assets/manifest.json` exists, the demo loads it, plus the `survival_fx` fragments (served read-only at `/@art/`).
- Otherwise it falls back to the `@engine/assets` sample (debug placeholders, at `/@sample/`) plus a TexturePacker fixture.

### Demo URL params
| param | values |
|---|---|
| `time` | `0..24` |
| `weather` | `clear\|rain\|storm\|snow\|fog\|<id>` |
| `intensity` | |
| `wind`, `windDir` | |
| `zoom` | |
| `inside=1` | player under the roof, shows the cutaway |
| `theme=alt` | runtime atlas theme switch (debug hue copy) |
| `gallery=1` | contact sheet of every atlas frame with ids |
| `cam=fire` | |
| `bloom=0` | |
| `look=<url>\|0` | |
| `art=0` | force the sample |
| `density`, `zombies`, `size`, `seed`, `freeze`, `ui=0`, `lights=0`, `shadows=0`, `interp=0`, `bench=SECONDS` | |

Controls: drag/WASD to pan, wheel to zoom, arrow keys move the player, F follows, H hides the UI.

## Pass order (per frame)
0. Prep (CPU):
   - time and weather through `env.ts` (the only reader)
   - grading keyframes, wind, surface wetness, lightning
   - sprite gather: spatial-index chunk iteration (`ChunkedSpatialIndex.entitiesInChunk` over visible and active chunks), interpolation or the transform source, AnimState frame resolve, cull, 16-bit depth-key radix-free u32 sort
   - build pieces into per-chunk static caches; lights and emitters
1. Scene into an FBO with MRT (colour + emissive/bloom mask) and depth:
   1. terrain chunk meshes (water, wet ground, puddles, snow cover)
   2. static piece chunks
   3. shadows (blob or projected, tinted)
   4. dynamic sprites (instanced, texture array, wetness/frost/flush/shiver/sway, ghosts, cracks, cutaway alpha, VFX)
2. Lightmap (half-res): ambient clear plus additive point lights (LightSource plus light-kind Emitters, with flicker)
3. Bloom (half-res, 3 draws), from emissive/light-source pixels only
4. Composite: scene × light, emissive bypass, heat shimmer, cloud shadows, fog/haze, storm, lightning flash, bloom, LUT grading (A/B blend), parametric grading, vignette
5. Weather particles (instanced rain, splashes, snow; zero CPU state)

## Integration (ECS contract)
- Components (core `defineComponent`, numeric only):

  | component | fields |
  |---|---|
  | `Sprite` | spriteId u16, frameId u16, flags u8, scale f32, tint u32 |
  | `LightSource` | r, g, b, radius, intensity, flicker |
  | `Shadow` | alpha, length |
  | `Occluder` | fade |

  `IsoRenderer.registerComponents(world)` registers them.
- Gameplay components are injected, not imported: `renderer.bindGameplay({buildPiece, animState, wetness, bodyTemp, emitter, lit})`.
- Spatial and building data:
  - `renderer.setSpatialIndex(index, chunkManager.activeKeys)`
  - `renderer.setBuildingGrid(grid)`
  - `renderer.setActiveChunks(keys)`
  - `renderer.setFocusEntity(localPlayer)`
- Netcode (`packages/net/ARCHITECTURE.md` §8):
  - `renderer.setTransformSource(netTransformSource(world, client))`. The predicted local player renders at sim + `correctionOffset`. Remote entities use the Transform that the net client writes from interpolation.
  - VFX: `for (const ev of client.pollEvents(client.renderTick)) renderer.vfx.handle(ev)`, with mappers registered by `renderer.vfx.onEvent(name, ev => ({spriteId, x, y}))`.
- Look: `renderer.setStyle(patch)` or `await renderer.loadLook(url)` (`render_tuning.json`). The defaults are neutral.
- Content: `renderer.atlas.setRegistry(registry, sourcesFromManifest(...))`, `atlas.registerTheme/setTheme`, `atlas.swapAtlas`.
- Loop: `createGameLoop(world, { render: (w, a) => renderer.render(w, a) })` at a 20 Hz fixed tick.

## Files
- `src/IsoRenderer.ts`: orchestration and passes
- `src/sprites.ts`: instanced sprites, pieces, static caches
- `src/tilemap.ts`
- `src/lighting.ts`: lights and emitters
- `src/bloom.ts`
- `src/composite.ts`
- `src/weather.ts`: table and particles
- `src/grading.ts`: LUT and keyframes
- `src/style.ts`: StyleConfig and tuning validation
- `src/env.ts`: time/weather/wind accessor
- `src/assets/atlasManager.ts`: texture array, themes, ref-counting, sway
- `src/assets/texturePacker.ts`
- `src/transformSource.ts`
- `src/vfx.ts`
- `src/camera.ts`
- `src/depth.ts`
- `src/timeOfDay.ts`
- `src/components.ts`
- `demo/`: scene, systems, mocks of gameplay components, content loading, gallery, debug UI
- `scripts/screenshots.mjs`: headless shots to `shots/` and `shots/bench.json`
- `scripts/make-tp-fixture.mjs`
- `test/`: unit tests

## Character customization
Layered paper-doll characters (core `Appearance` + `resolveLayers`), tintmask tinting, a per-entity layer cache and
`createCharacterPreview` for the creator UI (`preview.html`). See [docs/CHARACTERS.md](docs/CHARACTERS.md).
Shots: `shots/chars_lineup.png`, `chars_facings.png`, `chars_crowd.png`, `chars_preview.png`.

## Performance
`shots/bench.json` is **software-rendered** (SwiftShader in headless Chromium on a shared, loaded box) and does **not** represent GPU performance.
- Render CPU per frame is about 0.5–1 ms for roughly 600–1,000 visible sprites.
- Sprites take one draw for the dynamic batch plus one per visible static chunk.
- The SwiftShader frame rate is fill-bound and noisy: 2.5 FPS with ~10k visible sprites zoomed out, 5 FPS at default zoom, 1280x720 with real art.

## Known limitations
- Not yet consumed: `_sheen`, `_sway` and `_tintmask` masks; light cookies; exhausted tint.
- Heat shimmer runs in the composite (full-res UV distortion) rather than as a separate half-res pass.
- Per-chunk surface wetness is waiting on gameplay's value.
- No tile-sprite terrain yet. Terrain is a procedural mesh with a palette, so the art `tile_*` sprites are not used.
- Facing convention: registry facing 0 = +x. TP "E" is +x (screen down-right), which matches the art guide.
