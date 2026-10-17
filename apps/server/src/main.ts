/** Headless authoritative server: same sim packages as client, no renderer. Transport is wired by Netcode team. */
import { FixedLoop, World, Transform, NetId, DEFAULT_TICK_HZ } from "@engine/core";
import { TileMap } from "@engine/world";
import { installGameplay } from "@engine/gameplay";
import { PROTOCOL_VERSION } from "@engine/net";

export function createServerSim(seed = 1234, tickHz = DEFAULT_TICK_HZ) {
  const world = new World({ seed });
  installGameplay(world);
  const map = new TileMap();
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) map.setTile(x, y, 1 + world.rng.int(0, 3));
  const e = world.create(); world.add(e, NetId, { id: 1 }).add(e, Transform, { x: 8, y: 8 });
  const loop = new FixedLoop({ tickHz, step: (dt) => world.step(dt) });
  return { world, map, loop };
}

const isMain = process.argv[1]?.endsWith("main.ts") || process.argv[1]?.endsWith("main.js");
if (isMain) {
  const { world, loop } = createServerSim();
  let last = performance.now(); // wall clock lives OUTSIDE the sim
  console.log(`server: protocol v${PROTOCOL_VERSION}, ${1000 / loop.dtMs}Hz, schema ${world.getSchemaHash().toString(16)}`);
  setInterval(() => { const now = performance.now(); loop.advance(now - last); last = now; }, loop.dtMs / 2);
  setInterval(() => console.log(`tick ${world.tick} entities ${world.entityCount}`), 5000);
}
