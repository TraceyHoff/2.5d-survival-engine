// ADR-197: zombies hunt AI humans (virtual players) exactly like players.
import { describe, expect, it } from "vitest";
import { Transform, setTimeOfDay } from "@engine/core";
import { MemoryWorldStore } from "@engine/persist";
import { ZombieBrain, gameplayDefs, spawnZombie } from "@engine/gameplay";
import { createLocalServer, type LocalServer } from "../src/local.js";

const botEntities = (l: LocalServer) => new Set(l.bots.map((b) => l.game.players.get(b.client.clientId)!.entity));

describe("zombies hunt AI humans like players (ADR-197)", () => {
  it("a night zombie next to an AI human acquires it as its target", async () => {
    const local = await createLocalServer({ store: new MemoryWorldStore(), seed: 11, bots: 1 });
    const W = local.game.world; setTimeOfDay(W, 23);
    for (let i = 0; i < 10; i++) { local.pump(50); await Promise.resolve(); }
    const bot = [...botEntities(local)][0]!; const t = W.get(bot, Transform)!;
    const z = spawnZombie(W, [...gameplayDefs(W).zombies.values()][0]!.id, t.x + 3, t.y);
    for (let i = 0; i < 60 && W.getField(z, ZombieBrain, "target") !== bot; i++) { local.pump(50); await Promise.resolve(); }
    expect(W.getField(z, ZombieBrain, "target")).toBe(bot);
    await local.stop();
  });
});
