# @engine/input

Client-only, DOM-free input system (see docs/ARCHITECTURE.md §18). Browser wiring:

```ts
import { InputState } from "@engine/core";
import { InputSystem, AimResolver, DEFAULT_ACTIONS, DEFAULT_CONTEXTS, DEFAULT_PROFILES, DEFAULT_FRAME_MAPPING, DEFAULT_TOUCH_LAYOUTS } from "@engine/input";
import { attachBrowserInput } from "@engine/input/browser";

const input = new InputSystem(performance, { actions: DEFAULT_ACTIONS, contexts: DEFAULT_CONTEXTS, profiles: DEFAULT_PROFILES });
input.push("Gameplay");
attachBrowserInput(canvas, input, { virtualLayout: matchMedia("(pointer: coarse)").matches ? DEFAULT_TOUCH_LAYOUTS.gameplay : undefined });
const aim = new AimResolver(input, { screenToWorld: (x, y) => screenToWorld(x - cx, y - cy) });
const state = new InputState();
// once per sim tick (e.g. NetClient sampleInput):
input.update(); input.writeFrame(state, DEFAULT_FRAME_MAPPING, aim.resolve(world, player, playerPos));
const f = state.sample(world.tick); // f.actions -> buttons, f.aimX/aimY; f.moveX/moveY/edges for v2-aware consumers
```

Regenerate default profiles: `python3 scripts/gen-profiles.py`; binding tables: `python3 scripts/bindings-table.py`.
