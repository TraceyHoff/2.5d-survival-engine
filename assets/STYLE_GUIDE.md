# Art Direction & Style Guide: "Cozy-Wild"

Working name for the look: **Cozy-Wild**. It mixes the quirky, hand-inked, slightly wild world of *Don't Starve*
(made much cuter and softer) with the cozy, clean readability of *Stardew Valley*.
This file is the source of truth for every sprite, tile, icon, FX and UI element (UI lives in `ui/`, which the UI worker owns).
Palette data is in `palette.json` (machine-readable) and `palette.png` (swatches).

## 1. Reference mood
- **Don't Starve, but cuter.** Ink-like outlines that wobble a little and change weight. Readable, quirky silhouettes.
  Big expressive eyes. Twisty trees and odd mushrooms. Glowing eyes and little glowing fungi at night. A world that feels alive and a bit wild.
  Edges stay soft and colors stay warm. Never grimdark, never gory.
- **Stardew Valley.** Cozy and charming. Crisp at 1x (close to pixel-art clarity). Colors are vibrant but soft and harmonious.
  Friendly characters, lush cute nature, warm farm-life building pieces (warm wood, thatch, cobblestone, flower boxes).
- **Zombies are goofy, not scary.** Googly or mismatched eyes, little stitches, droopy hats, tongue out, chubby proportions,
  pastel mint, teal and lilac skin. A zombie that is defeated goes *poof* into a cartoon cloud with stars. No blood, ever.
- Keywords: *storybook, plush toy, autumn picnic, lantern-lit, slightly spooky forest*.

## 2. Do / Don't
| Do | Don't |
|---|---|
| Bold, soft outlines in dark plum or brown (`ink` ramp, `#3b2433`) | Pure black `#000` outlines or no outline |
| Lines a bit heavier on the bottom-right (shadow side) and lighter top-left | Uniform, vector-perfect strokes |
| Slight hand-drawn wobble on silhouettes | Perfect circles and ruler-straight boxes everywhere |
| Chunky, rounded, toy-like shapes; big heads (chibi ~1:1.1 head:body) | Realistic anatomy, thin spindly limbs (except deliberate twisty trees) |
| 3 tones per material (highlight / base / shade) + outline | Gradients that look airbrushed, or more than 4 tones |
| Hue-shift: shadows go cool (plum/teal), highlights go warm (yellow) | Shading by just multiplying toward black/grey |
| Light from the **top-left**, always | Mixed light directions |
| Soft plum contact shadow under everything that stands on the ground | Hard black drop shadows |
| Small details: stitches, tufts, knots, flowers, patches, sparkles | Flat placeholder blobs |
| Saturated but harmonious colors from `palette.json` | Neon, colors from outside the palette, desaturated grey mud |
| Eerie accents (glow eyes, glow mushrooms) as small spots of `eerie` and `glow` | Gore, blood, skulls as main motifs, horror imagery |

## 3. Projection, grid and scale (matches the engine)
- **Projection:** 2:1 dimetric ("iso"), `tileW = 64`, `tileH = 32`, `zStep = 16` px per height level
  (`@engine/world` `DEFAULT_ISO`). `screen.x = (x − y)·32`, `screen.y = (x + y)·16 − z·16`.
- **World axes on screen:** +x goes down-right, +y goes down-left, and +z goes up.
- **Facing index** (engine `AssetRegistry.directionIndex`): `facing = 0` means +x. 8 directions are
  `index = round(facing / 45°)`. In screen terms the row order is:
  `0 down-right, 1 down (toward camera), 2 down-left, 3 left, 4 up-left, 5 up (away), 6 up-right, 7 right`.
  4-direction sprites use `0 down-right, 1 down-left, 2 up-left, 3 up-right`.
  Every direction is **baked** into the atlas (mirrored rows are pre-flipped), so the renderer never has to flip characters.
- **Scale rules (1x):**
  | Thing | Frame | Visible height | Pivot (anchor) |
  |---|---|---|---|
  | Terrain tile | 64×48 | 32 px diamond + 16 px side skirt | diamond center (32,16) → (0.5, 0.333) |
  | Player / survivors | 48×64 | ~46 px (≈1.45 tiles tall) | feet (24,59) → (0.5, 0.92) |
  | Zombie walker / runner | 48×64 | 44 / 38 px | feet → (0.5, 0.92) |
  | Zombie brute | 64×80 | ~60 px | feet (32,74) → (0.5, 0.925) |
  | Critter (bunny) | 32×32 | ~16 px | feet (16,28) → (0.5, 0.875) |
  | Trees | 96×128 | 90–115 px | trunk base (48,118) → (0.5, 0.92) |
  | Small resources (rocks, bushes, ore, plants) | 64×64 | 12–44 px | base (32,56) → (0.5, 0.875) |
  | Building pieces | 128×128 | walls 48 px (3 z levels) | footprint center on the ground (64,96) → (0.5, 0.75) |
  | Item / equipment icons | 32×32 | ~26 px | center (0.5, 0.5) |
  | FX | 32×32 (fog: 256×256 tileable) | – | center (0.5, 0.5); rain splash bottom (0.5, 0.85) |
- A survivor is about 1.45 tiles tall. A wall is 48 px, which is shoulder-height to the chibi on purpose so you can still read what is behind it.
  Trees are 2–3.5× player height.

## 4. Rendering and shading rules
1. Draw at **4× supersampling**, then downscale with premultiplied-alpha **LANCZOS**. A tiny unsharp mask and alpha tightening
   keep the sprite crisp at 1x.
2. Every part has a **base** color. A **shade** band runs along its bottom-right edge (cel step, slightly noisy). A **rim highlight** runs along its top-left edge.
   Optional gloss blobs (eyes, berries, metal).
3. **Outline:** `mix(material.deep, ink.shade, 0.55)`. It is about 1 px at 1x, plus 0.35 px extra on the bottom-right. The threshold is noise-modulated
   so the line weight wobbles like ink. Each part is outlined on its own, so overlapping parts get interior lines.
4. **Iso boxes** (buildings, furniture): the top face uses the highlight/base color, the left face (+y, faces the light) uses the base color, and the right face (+x) uses the shade color.
   Material textures (planks, bricks, cobble, thatch) are drawn in face space and affine-mapped onto the face.
5. **Contact shadow:** a soft ellipse `#2a1b2e` at 30% alpha under the pivot. The renderer may add its own projected sun shadow on top.
   Pass `SpriteFlag.NoShadow`/no `Shadow` component if that doubles up.
6. **Emissive:** fire, torch flames, glowing eyes and glow mushrooms also go on a `_emissive.png` page with the same layout
   (pure emissive color on a transparent background).

## 5. Palette (summary; full ramps in `palette.json`)
Ramps are `[highlight, base, shade, deep]`.
- Ink: `#6b4a5a #4a2f3d #3b2433 #2a1b2e` (default outline `#3b2433`)
- Grass `#c4ec7a #8fd15c #64b04c #3f8a47` · Leaf `#b4ea80 #72c45c #479b55 #2d7050` · Pine `#7fd39a #4fa37a #34806a #22605a`
- Bark `#b88058 #8a5a3c #654130 #472d26` · Wood `#f0b878 #d08c52 #a2633a #74432c` · Thatch `#ffe08a #f0c060 #cc9440 #94662e`
- Stone `#e4e0d8 #b8b2b0 #8a8494 #5f5a70` · Cobble `#d6cfc2 #a9a094 #7d7480 #575064`
- Dirt `#dca878 #c08a5a #9a6a45 #74503a` · Sand `#fff1c4 #f6dfa4 #e6c47e #c9a265`
- Water `#bdf2f0 #5cc6dc #3a9ccc #2d70a8` · Deep water `#5cb8d8 #3484bc #2a62a0 #244a80`
- Berry `#ff9fb2 #e8475f #b8304f #7e2140` · Mushroom red `#ff9a8c #ec5a4d #c03d41 #8a2a38` · Glow shroom `#e6fff4 #9ff5d8 #5fd1c0 #3a9a9a`
- Zombie mint `#c8f5c8 #94dca8 #62b48e #3f8676` · teal `#b4f0e4 #74d0c4 #45a8a6 #2e7a84` · lilac `#e4d4ff #bba4f0 #8f78cc #65539e`
- Fire `#fff6c2 #ffd04a #ff8a2a #e8492e` · Eerie glow `#e8fff8 #9ffff0 #5ce0d8 #2fa8b0`
- Cloth: red, blue, teal, yellow, cream, denim, green, purple, leather. Skin: light, tan, deep. Hair: brown, pink, black, blonde.
- UI should take its panel wood/cream/ink colors from `wood`, `cloth_cream` and `ink`.

## 6. Animation rules
- Timing is snappy and bouncy (squash and stretch on the hop, landing and hit).
  Characters: idle 4 frames @ 4 fps, walk 6 @ 10 fps, attack 4 @ 12 fps (loop false), gather 4 @ 8 fps.
  Zombies: idle 4 @ 4, walk 6 @ 7 (wobbly shamble), attack 4 @ 10, hurt 2 @ 10, death 6 @ 10 (loop false, ends invisible: spawn `fx_poof`).
- Trees sway 4 frames @ 3 fps (crown shear ±1.5 px). The renderer's `Sway` flag can be used instead.
- Water: 4 frames @ 4 fps. Campfire/torch: 6/4 frames @ 10 fps.

## 7. Naming conventions
- Keys are `snake_case`, `[a-z0-9_]` (engine rule). Keys are **stable forever** because the id lock and multiplayer handshake hash depend on them.
- Prefixes: `tile_*`, `zombie_*`, `fx_*`, `sfx_*`, `amb_*`, `ui_*`. Items use gameplay item keys (`wood`, `stone_axe`, …).
  Resources use gameplay resource keys (`tree`, `boulder`, `berry_bush`, `iron_vein`, `fiber_grass`, `loose_rocks`, `fallen_branches`).
  Building sprites use build piece keys (`wall`, `floor`, `door`, …).
- Individual frames: `sprites/<category>/<key>/<anim>_d<dir>_<frame>.png` (or `<key>_r<rot>_s<damage>.png` for building pieces).

## 8. Folder layout (`/workspace/assets` is the canonical shared asset folder)
```
assets/
  STYLE_GUIDE.md  palette.json  palette.png  README.md  INTEGRATION.md
  manifest.json            # engine-format manifest v1 (atlases, sprites, sounds, vfx, tints, palettes, variants)
  ids.lock.json            # stable id lock (namespaced), seeded from engine sample lock
  atlases/<atlas>.png  atlases/<atlas>.json (TexturePacker-hash compatible)  atlases/<atlas>_emissive.png
  sprites/<category>/...   # individual frames
  audio/sfx/*.ogg|wav  audio/ambience/*  audio/ui/*  audio/manifest.json
  preview/                 # preview scene, contact sheets, GIFs (not shipped)
  tools/                   # generators (python3 + Pillow + numpy). `python3 tools/build_all.py` rebuilds everything.
  ui/                      # owned by the UI worker (not generated here)
```

## 9. Loading atlases
- **Engine:** `fetchManifest("/assets/manifest.json")` → `registry.frame(id, anim, facing, t)` returns the rect plus pivot.
  Atlases are uniform grids (`frameW, frameH, columns, rows`). The frame index runs row-major. Direction rows are offset by `dirStride` (= columns).
- **Generic / other tools:** every `atlases/<atlas>.json` is TexturePacker "JSON hash" format
  (`frames{name:{frame,rotated,trimmed,spriteSourceSize,sourceSize,pivot}}`, `meta{image,size,scale}`), with `pivot` normalized.
