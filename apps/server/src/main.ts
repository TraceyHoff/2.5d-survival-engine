/** Headless authoritative server: same sim packages as client, no renderer. Networking via @engine/net. */
import { FixedLoop, World, Transform, Owner, DEFAULT_TICK_HZ } from "@engine/core";
import { TileMap } from "@engine/world";
import { installGameplay } from "@engine/gameplay";
import { LoopbackNetwork, NetServer, PROTOCOL_VERSION, type ServerTransport } from "@engine/net";

export function createServerSim(seed = 1234, tickHz = DEFAULT_TICK_HZ, transport?: ServerTransport) {
  const world = new World({ seed });
  installGameplay(world);
  const net = new NetServer({
    world, tickHz, transport: transport ?? new LoopbackNetwork().createServer(),
    // TODO(gameplay): spawnPlayer + input adapter once gameplay exposes them for net sessions.
    onClientJoin: (s, w) => { const p = w.create(); w.add(p, Transform, { x: 8, y: 8 }).add(p, Owner, { clientId: s.clientId }); net.netIds.assign(p); },
  });
  const map = new TileMap();
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) map.setTile(x, y, 1 + world.rng.int(0, 3));
  const e = world.create(); world.add(e, Transform, { x: 8, y: 8 }); net.netIds.assign(e);
  const loop = new FixedLoop({ tickHz, step: (dt) => world.step(dt) });
  return { world, map, loop, net };
}

const isMain = process.argv[1]?.endsWith("main.ts") || process.argv[1]?.endsWith("main.js");
if (isMain) {
  const { WsServerTransport } = await import("@engine/net/node");
  const transport = new WsServerTransport();
  const port = await transport.listen(Number(process.env["PORT"] ?? 7777), process.env["HOST"] ?? "0.0.0.0");
  const { world, loop } = createServerSim(1234, DEFAULT_TICK_HZ, transport);
  let last = performance.now(); // wall clock lives OUTSIDE the sim
  console.log(`server: ws://:${port} protocol v${PROTOCOL_VERSION}, ${1000 / loop.dtMs}Hz, schema ${world.getSchemaHash().toString(16)}`);
  setInterval(() => { const now = performance.now(); loop.advance(now - last); last = now; }, loop.dtMs / 2);
  setInterval(() => console.log(`tick ${world.tick} entities ${world.entityCount}`), 5000);
}
