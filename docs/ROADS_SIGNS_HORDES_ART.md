# Roads, signs and hordes art list (ADR-119..121)

Every key has a fallback in `packages/gameplay/data/sprite_fallbacks.json`, so the game is playable before art lands. You can replace any key with no code change.

## Road tiles (flat ground decals, iso diamond 64×32, seamless)
For each surface `path`, `gravel` and `paved`:
- `road_<surface>`: the generic tile, used when a mask variant is missing.
- `road_<surface>_m0` … `road_<surface>_m15`: the 16 auto-connect variants. Mask bits: 1 = N, 2 = E, 4 = S, 8 = W, so for example m5 is a N–S straight and m15 is a crossroads.

That is 51 images in total.

## Signs (billboard sprites, ~48×64; billboard ~128×80)
`sign_wooden_post`, `sign_hanging`, `sign_wall_plaque`, `sign_billboard`, `sign_metal_road`, `sign_arrow` (4 facings or rotatable).

## Item icons (32×32)
`gravel`, `cement`, `asphalt`, plus the six sign items (same keys as the sprites above).

## Audio (see AUDIO_ASSETS.md)
- `horde.warning`: distant howl or horn, about 3 s.
- `horde.spawn`: massed growl, about 2.5 s.
- `horde.defeated`: relief sting, about 1.5 s.
