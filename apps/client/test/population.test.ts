import { describe, it, expect } from "vitest";
import { MemoryWorldStore } from "@engine/persist";
import { Zombie, Animal } from "@engine/gameplay";
import { createLocalServer } from "../src/local.js";
import { ClientSession, type KeyValue } from "../src/session.js";

class MapStorage implements KeyValue { m = new Map<string, string>(); getItem(k: string): string | null { return this.m.get(k) ?? null; } setItem(k: string, v: string): void { this.m.set(k, v); } }

async function boot(mode: "singleplayer" | "multiplayer", bots = 0) {
  const local = await createLocalServer({ store: new MemoryWorldStore(), seed: 9, mode, bots });
  const session = new ClientSession({ storage: new MapStorage(), slot: "1", sampleButtons: () => 0 });
  const connecting = session.connect("local", "Tess", local.createTransport());
  let world; for (let i = 0; i < 40 && !world; i++) { local.pump(5); world = await Promise.race([connecting, Promise.resolve(undefined)]); }
  world ??= await connecting;
  for (let t = 0; t < 12000; t += 50) { local.pump(50); world.step(1 / 20); session.poll(); await Promise.resolve(); }
  return { local, session };
}
const count = (local: Awaited<ReturnType<typeof boot>>["local"], c: Parameters<typeof local.game.world.query>[0][number]) => [...local.game.world.query([c])].length;

describe("ambient population", () => {
  it("singleplayer: zombies/animals/human bots spawn without commands; bots are real players", async () => {
    const { local, session } = await boot("singleplayer");
    expect(local.game.mode).toBe("singleplayer");
    expect(count(local, Animal)).toBeGreaterThan(0);
    expect(count(local, Zombie) + count(local, Animal)).toBeGreaterThan(0);
    expect(local.bots.length).toBeGreaterThan(0);
    expect([...local.game.players.values()].filter((p) => p.bot).length).toBe(local.bots.length);
    session.disconnect(); await local.stop();
  }, 60000);
  it("multiplayer: zero human bots even when bots are requested; markVirtual refused", async () => {
    const { local, session } = await boot("multiplayer", 3);
    expect(local.bots.length).toBe(0);
    expect([...local.game.players.values()].filter((p) => p.bot).length).toBe(0);
    expect(local.game.players.size).toBe(1);
    expect(local.game.markVirtual([...local.game.players.keys()][0]!)).toBe(false);
    expect(count(local, Animal)).toBeGreaterThan(0);
    session.disconnect(); await local.stop();
  }, 60000);
});
