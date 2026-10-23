# Character customization rendering

## Layers
Bind `renderer.bindGameplay({ appearance: coreAppearanceBinding(registry.cosmetics) })`. For every entity with
`Sprite` + core `Appearance`, `SpriteRenderer` asks core `resolveLayers(catalog, appearance, facing)` for the ordered
layers and draws one instance per layer in the instanced batch. Every layer shares the body's pivot, anim state,
facing row, frame time, flipX and depth key. Layer *j* gets `key + j * LAYER_BIAS`, with `LAYER_BIAS` = 0.001. That
keeps all layers below `HELD_BIAS` (0.05), so held items still sort in front of or behind the whole character.
- **Outline:** union. Outline-only copies of every layer sit at `key - LAYER_BIAS/2`, so the silhouette goes around
  the combined doll and not around each layer. Use `setCharacterOptions({ outline: "body" })` for a body-only outline.
- **Shared effects:** occlusion fade, cutaway, status tints (wet/cold/heat), hit flash (`bindings.hitFlash`) and
  shiver all apply uniformly. The focus silhouette uses the body only.
- **Cache:** `LayerCache` is keyed on (entity, `Appearance.version`, facing4). `version` is a wrapping u16, so it is
  only ever compared for equality. Layers are re-resolved only on an Appearance write (`setAppearance`) or a
  facing-bucket change. `renderer.characterStats` reports `{characters, layerInstances, resolves, cached}`.
- **LOD:** `setCharacterOptions({ minorLayerMinZoom })` drops minor layers (accessory, shoes by default) when the zoom
  is below the threshold. The default is 0.75.

## Tintmask
Tinted art needs the atlas `masks.tintmask` at the same layout. R = primary, G = secondary, grey (R=G) = partial
neutral tint. Modes are `multiply | add | screen | lerp`, with strength and saturation (instance floats 33..35).
Per-slot defaults are set via `binding.slotTint`.

## Preview (character creator)
```ts
const pv = await createCharacterPreview(containerOrCanvas, { registry, sources, appearance, facing: 1, zoom: 1, anim: "idle" });
pv.setAppearance(next);          // goes through core setAppearance (version bump -> cache miss)
pv.getAppearance();              // copy; edit it and pass it back
pv.setFacing(0..7); pv.rotate(±1); pv.setZoom(z); pv.setAnim("walk");
const unbind = pv.bindKeys();    // ←/→ Q/E rotate, +/- zoom; LB/RB or right stick poll (pollGamepad: false to disable)
pv.resize(w, h, dpr);            // automatic via ResizeObserver when given a container
pv.dispose();
```
The preview has its own IsoRenderer and a mini World, with a neutral backdrop (`renderer.backdrop`), a blob shadow,
a warm key light and a cool rim light. Drag rotates in 45° steps, and wheel or pinch zooms. The demo is
`preview.html` (`demo/preview.ts`), which has DOM selects for body, skin, every slot and its colour.

## Debug art
The pack does not ship per-layer art yet. `demo/` passes `debugCharacters: true` to `loadContent`, and
`src/character/debugPack.ts` then auto-segments the existing player sheets into body, hair, hat, top, bottom,
shoes and accessory layers with a tintmask (`debugLayers.ts`). This art is only for exercising the pipeline. The
segmentation is rough: some faces get hair-coloured pixels.

## Perf (SOFTWARE-rendered: SwiftShader, headless Chromium, 1280x720)
See `shots/chars_bench.json`. With 200 players: 933 layer instances and 200 resolves total (no per-frame resolves),
and SpriteRenderer CPU is about 1.8 ms/frame. SwiftShader frame time is fill-bound and is not representative of a GPU.
