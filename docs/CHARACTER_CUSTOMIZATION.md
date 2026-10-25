# Character Customization: Engine Contract

The engine provides the data contract only: no art, UI or rendering. Rationale is in ADR-080 and ARCHITECTURE §20.
Players choose a body type (`male` | `female`), a skin tone, and wearables in 8 slots, with a primary and secondary color for each slot.

Slots (fixed order; this order is the wire/save layout, so only append): `hair, hat, accessory, top, bottom, shoes, face, eyes, hands` (hands appended by ADR-137).
Palettes: `hair` and `face` (beards, brows) use `hairColors`; all other slots use `clothingColors`; the body uses `skinTones`.

## Writing Appearance (everyone)
**All writers must use `setAppearance(world, e, value)`**: the server command handler, load-time repair, spawn defaults and tools. It writes the whole value and bumps `Appearance.version` (u16, wraps 0xffff → 0, networked and persistent). Never use `world.set`, `setField` or `setElement` on Appearance directly, because Renderer caches would go stale. Validate first (`validateAppearance`); `setAppearance` doesn't validate. Read with `getAppearance(world, e)`.

## Art: what to author
Add these to `packages/assets/pack/manifest.json`, then run `pnpm --filter @engine/assets lock:ids` to write the `wearables` lock section:
```jsonc
"bodyTypes": { "male": { "sprite": "body_male" }, "female": { "sprite": "body_female" } },
"skinTones":      [{ "key": "skin_01", "color": "#f1c27d" }],   // index = array order (u8, ≤256). Never reorder; only append.
"hairColors":     [{ "key": "black", "color": "#1a1a1a" }],
"clothingColors": [{ "key": "red", "color": "#aa2222" }],
"wearables": [{
  "key": "hair_ponytail", "slot": "hair",
  "bodies": {                                   // every body type the part supports, each with its own art
    "male":   { "sprite": "hair_ponytail_m", "anim": "idle", "hatHair": { "sprite": "hair_ponytail_m_hat" } },
    "female": { "sprite": "hair_ponytail_f" }
  },
  "layer": 40, "layerByDir": [40, 40, 40, 5],   // optional per facing E,S,W,N (e.g. hair goes behind the body facing north)
  "z": 0,                                       // tie-break inside a layer
  "tintChannels": 1,                            // 0 none, 1 tintmask R <- primary, 2 + G <- secondary
  "hidesSlots": [],                             // e.g. a full helm: ["hair"]
  "hatHair": false,                             // hats only: the hair swaps to its hatHair art (or is hidden if it has none)
  "unlockTags": []                              // empty = always available
}]
```
- Each sprite is a normal `character` sprite. Its anims must have per-direction frames (`directions` 4|8 or `rotations`) and the same anim names and frame timing as the body (`idle`, `walk`, ...), so the layers stay in sync. Use the same atlas frame size and anchor as the body.
- The body sprite is tinted by skin tone through tintmask R. Any tinted part needs a `tintmask` mask on its atlas (the existing `masks.tintmask` convention: R = primary, G = secondary).
- Suggested layers: body 10 (`BODY_LAYER`), shoes 15, bottom 18, top 20, accessory 30, face 32, hands 33 (22 on back facings, ADR-137), eyes 34, hair 40, hat 50.
- Validation errors to expect: unknown sprite or anim, body type without `bodyTypes` base art, single-direction anim, tint without a tintmask, a part hiding its own slot, two slots hiding each other, `hatHair` together with `hidesSlots: ["hair"]`, bad colors, and palettes over 256 entries.

## Renderer
```ts
const cat = registry.cosmetics!;
// cache per entity: recompute only when Appearance.version or the 4-way facing changes
const a = getAppearance(world, e)!; const key = a.version * 4 + directionIndex4(transform.facing);
const layers = cache.get(e)?.key === key ? cache.get(e)!.layers : (cache.set(e, { key, layers: resolveLayers(cat, a, transform.facing) }), cache.get(e)!.layers);
for (const l of layers) {   // back to front
  const ref = registry.frame(l.sprite, currentAnim /* or l.anim */, transform.facing, t);
  draw(ref, { tintR: l.tintR, tintG: l.tintG });  // tintmask R/G -> 0xRRGGBB, undefined = untinted
}
```
`DrawLayer = { slot: "body" | WearableSlot, wearable, sprite, anim, layer, z, tintR?, tintG?, tintMode?, tintStrength?, tintSaturation?, minor?, outline? }`. The last five are optional per-wearable render hints copied from the manifest when set (`tintMode` multiply|add|screen|lerp, `tintStrength` 0..1, `tintSaturation` 0..2, `minor` = droppable by the crowd LOD, `outline: false` = skip the outline pass); absent means renderer defaults. Hidden slots are already left out. Read the Appearance arrays with the store's array accessors, or build an `AppearanceValue` from them.

## Netcode: replication and persistence
- `Appearance` is a networked, persistent component, about 44 bytes per character (including `version`). Clients use the replicated `version` only for cache invalidation and never write it. It changes rarely, so the delta stays at 0 bytes per tick otherwise.
- **Schema hash:** registering `Appearance` changes `world.getSchemaHash()`, and new wearables change `registry.hash` (both are part of the handshake). Bump the client and server together.
- **Existing saves:** they have no Appearance records. On load, add `Appearance` to every player entity that lacks it, through `setAppearance(world, e, defaultAppearance(cat))`. Then run `validateAppearance(cat, value)` in clamp mode on every loaded Appearance, so removed or retired parts and out-of-range palette indices fall back to 0 and don't crash rendering.
- **Server validation:** the `setAppearance` command is handled server-side with `validateAppearance(cat, payload, { mode: "reject", unlocked: playerUnlockTags })`. Reject with the first issue as the `CommandRejected` reason, and write the component only when it passes, via `setAppearance`.

## Survival: creator flow, command and unlocks
- **Creator screen:** pick a body type, then a skin tone (`cat.skinTones`), then each slot from `cat.bySlot(slot, body)`, filtered by unlocks, with colors from that slot's palette. Preview with `resolveLayers` locally. Changing the body type re-runs `validateAppearance` in clamp mode, which drops parts the new body doesn't support.
- **Command** (define it in gameplay): `defineCommand("gameplay.setAppearance", { bodyType: "u8", skinTone: "u8", parts: { type: "u16", length: SLOT_COUNT }, primary: { type: "u8", length: SLOT_COUNT }, secondary: { type: "u8", length: SLOT_COUNT } })`. Allow it on first spawn and at a mirror/barber station, as game rules decide.
- **Unlocks:** wearables with `unlockTags` need the player to own at least one of those tags. Tags are plain strings that gameplay grants (achievements, raid rewards) and stores per player.
- **Equipment override (not wired):** an item def may later carry `equipCosmetic: "<wearable key>"`. While it is equipped, the renderer-side composition would swap that wearable into its slot without changing the stored Appearance.

## Extensions (ADR-082, all optional, backward compatible)
Existing packs validate unchanged. Art's 89d1f55 cosmetics content (84 wearables) loads with 0 warnings.

- **Multi-layer wearables:** `wearable.layers: [{name, layer, z?, layerByDir?, tintChannels?, tintMode?, tintStrength?, tintSaturation?, tintNeutral?, minor?, outline?, bodies}]`. When `layers` is present, `bodies` and `layer` on the wearable become optional, and each layer inherits any props it doesn't set from the wearable. Every layer must cover the same set of bodies. `resolveLayers` emits one `DrawLayer` per layer (`layerName` is set), sorted by `layer`, then `z`, then slot order, then layer index.
- **8 facings:** `layerByDir` takes a 4-entry array [E,S,W,N], an 8-entry array [E,SE,S,SW,W,NW,N,NE], or a compass object (`{E,SE,…}`, normalized to 8 entries). The renderer draws 8 facings because body anims have 8 directions. `directionIndex8(facing)` is in core, and `layerForFacing` picks idx8 or idx4 depending on the array length.
- **Per-frame metadata:** `frameMeta: {"<frame>": {anchors: {handR: {x, y, angle?, len?, behind?}}}}` can go on a sprite or an animation (the animation overrides the sprite). Accessors: `registry.frameMeta(spriteId, frame, anim?)`, `registry.frameAnchors(...)`, and `FrameRef.anchors`. `AssetRegistry.anchorPoint(ref, name)` mirrors `x` and `angle` on flipX. Coordinates are pivot-relative (the same as attach points), not frame-top-left. Anchor names may be camelCase. This replaces `hands.json`.
- **Expressions:** set `faceAnims` (expression → anim name) at the cosmetics top level and/or on a face/eyes wearable. `expressions` are auto-filled from the sprite's anims. Call `resolveLayers(cat, a, facing, {anim?, expression?})`. The runtime `expression` wins over the wearable's `faceAnims`, which wins over the catalog's. It applies to layer 0 of face/eyes, and `DrawLayer.expression` and `anim` are set.
- **Tint:** the default `tintMode` is `multiply`. Set `tintNeutral` at the top level, per wearable or per layer (default **0.78**). The contract formula is `out = base * mix(1, color / tintNeutral, strength * mask)`, so a mask pixel at grey `tintNeutral` reproduces `color` exactly. **Shader mismatch (today):** `sprites.ts` computes `mix(c, sat(c)*tc, k)`, which is `base*mix(1,color,k)` with no `/tintNeutral` and saturation applied first, so multiply results come out about 22% darker than the contract. The `lerp` mode uses 0.55 as its neutral. The Renderer must divide by `DrawLayer.tintNeutral`.
- **Per-body defaults:** `bodyTypes[b].cosmeticDefaults: {slot: wearableKey}` is applied by `defaultAppearance` after the global defaults. `requiredSlots` (top level) defaults to `["face","eyes"]` when any body declares defaults, and to `[]` otherwise. `validateAppearance` fills a missing required slot from the defaults, and reports an issue only when no default exists.
- **Names:** `displayName` / `locKey` on wearables and body types.
- **Outline:** `outline: "body" | "none"`. Booleans are still accepted (true → body). `DrawLayer.outlineMode` is set, and the boolean `outline` is still emitted.
- **UI widgets:** `charpreview` `{appearance, rotate?, zoom?, anim?, expression?}` and `cosmeticslot` `{slot, bodyType?, unlocked?: all|unlocked|locked|<binding>, paletteChannel?: primary|secondary|none}`. Both are in `UI_WIDGET_TYPES`, which `validateUiScreen` (`@engine/assets`) checks.
