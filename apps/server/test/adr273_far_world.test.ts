import { expect, it } from "vitest";
import { Transform, World } from "@engine/core";
import { LoopbackNetwork, NetClient } from "@engine/net";
import { MemoryWorldStore } from "@engine/persist";
import { ProceduralGenerator } from "@engine/world";
import { createGameServer, installDemoWorld, DEMO_COMMANDS, DEMO_EVENTS } from "../src/main.js";

it("two multiplayer peers receive actual far-world terrain and edits inside bounded interest sets", async () => {
  const net = new LoopbackNetwork(273), gen = new ProceduralGenerator({ seed: 424242 });
  const spawn = { x: 50000.5, y: -50000.5 };
  const gs = createGameServer({ transport: net.createServer(), seed: 424242, spawnPoints: [spawn], store: new MemoryWorldStore(), population: false });
  const clients: NetClient[] = [];
  const tick = (n: number) => { for (let i = 0; i < n; i++) { net.advance(50); gs.step(.05); for (const c of clients) { c.world.step(.05); c.pollEvents(Infinity); } } };
  try {
    for (let i = 0; i < 2; i++) {
      const world = new World(); installDemoWorld(world, "client"); const c = new NetClient({ world, transport: net.createClient(), commands: DEMO_COMMANDS, events: DEMO_EVENTS });
      const connected = c.connect(); await new Promise(r => setTimeout(r, 0)); net.advance(100); await connected; clients.push(c); tick(10);
    }
    tick(30); expect(gs.players.size).toBe(2);
    const x = Math.floor(spawn.x), y = Math.floor(spawn.y), key = `${Math.floor(x / 32)},${Math.floor(y / 32)}`;
    for (const p of gs.players.values()) expect(gs.world.get(p.entity, Transform)!.x).toBeGreaterThan(49000);
    for (const c of clients) {
      expect(c.tiles.getTile(x, y)).toBe(gen.tileAt(x, y)); expect(c.tiles.tiles.getChunkByKey(key)?.height).toEqual(gs.chunks.getChunkByKey(key)?.height);
      expect(c.tiles.tiles.chunkCount).toBeLessThan(100);
    }
    gs.chunks.setTile(x, y, 3); tick(10); for (const c of clients) expect(c.tiles.getTile(x, y)).toBe(3);
    expect(gs.chunks.chunkCount).toBeLessThan(150);
  } finally { for (const c of clients) c.close(); await gs.shutdown(); }
});
