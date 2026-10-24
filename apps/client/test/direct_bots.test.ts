import { describe, it, expect } from "vitest";
import { Transform } from "@engine/core";
import { MemoryWorldStore } from "@engine/persist";
import { MsgType } from "@engine/net";
import { createLocalServer, defaultMaxBots, MOBILE_MAX_BOTS, DESKTOP_MAX_BOTS } from "../src/local.js";

describe("direct local bots (ADR-105)", () => {
  it("bots are direct sessions: no snapshots, yet they move via validated inputs", async () => {
    const local = await createLocalServer({ store: new MemoryWorldStore(), seed: 11, bots: 3, population: false });
    let snaps = 0; for (const b of local.bots) { expect(local.game.net.isDirect(b.client.clientId)).toBe(true); b.client.onRawMessage(MsgType.Snapshot, () => { snaps++; }); }
    const pos = (): string[] => local.bots.map((b) => { const p = local.game.players.get(b.client.clientId)!; const t = local.game.world.get(p.entity, Transform)!; return `${t.x.toFixed(2)},${t.y.toFixed(2)}`; });
    const before = pos();
    for (let i = 0; i < 200; i++) { local.pump(50); await Promise.resolve(); }
    expect(snaps).toBe(0);
    expect(pos()).not.toEqual(before);
    expect(local.bots.every((b) => b.world === local.game.world)).toBe(true);
    await local.stop();
  });

  it("caps virtual players at maxBots (population config); default is device-scaled", async () => {
    const local = await createLocalServer({ store: new MemoryWorldStore(), seed: 12, bots: 5, maxBots: 2, population: false });
    expect(local.bots.length).toBe(2);
    await local.stop();
    expect(defaultMaxBots({ coarsePointer: true, uaMobile: undefined })).toBe(MOBILE_MAX_BOTS);
    expect(defaultMaxBots({ coarsePointer: false, uaMobile: true })).toBe(MOBILE_MAX_BOTS);
    expect(defaultMaxBots({ coarsePointer: false, uaMobile: false })).toBe(DESKTOP_MAX_BOTS);
    expect(MOBILE_MAX_BOTS).toBeLessThan(DESKTOP_MAX_BOTS);
  });
});
