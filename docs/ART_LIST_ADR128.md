# Art list — ADR-128 gathering animations, eat/drink, cooked foods

Everything below already renders via fallbacks; these are the frames/icons to author for full quality.

## Player / character animation frames (8 directions, same rig + frame size as `punch`/`attack`)
| Anim (AnimState) | Frames | Notes | Current fallback |
|---|---|---|---|
| `harvest` (16) | 6 | Crouch, reach, pull hand back (bushes, crops, fiber, herbs) | `gather` → `punch` → `attack` → `idle` |
| `chop` (17) | 6 | Two-handed overhead axe swing, impact on frame 4 | `attack` → `punch` → `idle` |
| `mine` (18) | 6 | Pickaxe downward strike, impact on frame 4 | `attack` → `punch` → `idle` |
| `drink` (19) | 5 | Raise canteen/cupped hands to mouth (also used for drinking at water tiles) | `eat` → `idle` |
| `eat` (14) | 5 | Hand to mouth (existing state; author if missing) | `idle` |

## Item icons (32×32, same style as existing food icons)
Cooked: stewed_berries, stewed_blueberry, stewed_raspberry, stewed_blackberry, stewed_strawberry, stewed_cherry,
baked_apple, baked_pear, baked_orange, baked_peach, baked_coconut,
roasted_carrot, roasted_tomato, roasted_pumpkin, roasted_squash, roasted_cabbage, roasted_onion, roasted_wild_onion
(fallback: the raw item's icon).
Containers: canteen, water_bottle (fallback: water_flask). Optional "empty" variants: canteen_empty, water_bottle_empty.

## FX sprites (optional; procedural shapes drawn today)
- particle_wood_chip, particle_stone_chip, particle_leaf (4 frames each, 8×8)
- node health bar frame (9-slice, 32×4)
- pickup toast background (9-slice)
