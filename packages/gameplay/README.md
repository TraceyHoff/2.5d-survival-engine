# @engine/gameplay

Survival gameplay systems for the engine: vitals, inventory, crafting, gathering, and day/night + weather effects.
They are built on `@engine/core`'s ECS. Design and open questions are in [DESIGN.md](./DESIGN.md).

```ts
import { World } from "@engine/core";
import { installGameplay, spawnPlayer, spawnResourceNode, setIntent, IntentAction } from "@engine/gameplay";

const world = new World({ seed: 1234 });
installGameplay(world, { role: "server" });        // "client" = prediction-safe subset
const p = spawnPlayer(world, { x: 8, y: 8 });
const bush = spawnResourceNode(world, "berry_bush", 9, 8);
setIntent(world, p, { action: IntentAction.Gather, target: bush }); // normally done by the input-phase adapter
world.step(1 / 20);
```

- `src/components.ts`: component schemas. The registration order is append-only.
- `src/systems/*`: environment (clock, weather, exposure), vitals, gathering, crafting.
- `src/inventory.ts`: inventory ops.
- `src/defs.ts` and `data/*.json`: data tables and their validation.
- `src/install.ts`: `installGameplay`, the system order and the spawn helpers.

Run from the repo root: `pnpm test`, or `pnpm vitest run packages/gameplay`. Then run `pnpm -r typecheck`.
