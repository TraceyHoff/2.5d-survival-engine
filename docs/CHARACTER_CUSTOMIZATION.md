# Character Customization: Engine Contract

The engine provides the data contract only: no art, UI or rendering. Rationale is in ADR-080 and ARCHITECTURE §20.
Players choose a body type (`male` | `female`), a skin tone, and wearables in 8 slots, with a primary and secondary color for each slot.

Slots (fixed order; this order is the wire/save layout, so only append): `hair, hat, accessory, top, bottom, shoes, face, eyes`.
Palettes: `hair` and `face` (beards, brows) use `hairColors`; all other slots use `clothingColors`; the body uses `skinTones`.

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
- Suggested layers: body 10 (`BODY_LAYER`), shoes 15, bottom 18, top 20, accessory 30, face 32, eyes 34, hair 40, hat 50.
- Validation errors to expect: unknown sprite or anim, body type without `bodyTypes` base art, single-direction anim, tint without a tintmask, a part hiding its own slot, two slots hiding each other, `hatHair` together with `hidesSlots: ["hair"]`, bad colors, and palettes over 256 entries.

## Renderer
```ts
const cat = registry.cosmetics!;
for (const l of resolveLayers(cat, appearanceOf(e), transform.facing)) {   // back to front
  const ref = registry.frame(l.sprite, currentAnim /* or l.anim */, transform.facing, t);
  draw(ref, { tintR: l.tintR, tintG: l.tintG });  // tintmask R/G -> 0xRRGGBB, undefined = untinted
}
```
`DrawLayer = { slot: "body" | WearableSlot, wearable, sprite, anim, layer, z, tintR?, tintG? }`. Hidden slots are already left out. Read the Appearance arrays with the store's array accessors, or build an `AppearanceValue` from them.

## Netcode: replication and persistence
- `Appearance` is a networked, persistent component, about 42 bytes per character. It changes rarely, so the delta stays at 0 bytes per tick otherwise.
- **Schema hash:** registering `Appearance` changes `world.getSchemaHash()`, and new wearables change `registry.hash` (both are part of the handshake). Bump the client and server together.
- **Existing saves:** they have no Appearance records. On load, add `Appearance` to every player entity that lacks it, using `defaultAppearance(cat)`. Then run `validateAppearance(cat, value)` in clamp mode on every loaded Appearance, so removed or retired parts and out-of-range palette indices fall back to 0 and don't crash rendering.
- **Server validation:** the `setAppearance` command is handled server-side with `validateAppearance(cat, payload, { mode: "reject", unlocked: playerUnlockTags })`. Reject with the first issue as the `CommandRejected` reason, and write the component only when it passes.

## Survival: creator flow, command and unlocks
- **Creator screen:** pick a body type, then a skin tone (`cat.skinTones`), then each slot from `cat.bySlot(slot, body)`, filtered by unlocks, with colors from that slot's palette. Preview with `resolveLayers` locally. Changing the body type re-runs `validateAppearance` in clamp mode, which drops parts the new body doesn't support.
- **Command** (define it in gameplay): `defineCommand("gameplay.setAppearance", { bodyType: "u8", skinTone: "u8", parts: { type: "u16", length: SLOT_COUNT }, primary: { type: "u8", length: SLOT_COUNT }, secondary: { type: "u8", length: SLOT_COUNT } })`. Allow it on first spawn and at a mirror/barber station, as game rules decide.
- **Unlocks:** wearables with `unlockTags` need the player to own at least one of those tags. Tags are plain strings that gameplay grants (achievements, raid rewards) and stores per player.
- **Equipment override (not wired):** an item def may later carry `equipCosmetic: "<wearable key>"`. While it is equipped, the renderer-side composition would swap that wearable into its slot without changing the stored Appearance.
