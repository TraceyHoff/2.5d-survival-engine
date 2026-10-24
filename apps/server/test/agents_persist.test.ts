import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LoopbackNetwork } from "@engine/net";
import { SqliteWorldStore } from "@engine/persist/node";
import { createGameServer } from "../src/main.js";

describe("bot AgentIdentity persistence (dedicated server: SQLite)", () => {
  it("relationship survives shutdown + restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agents-")); const path = join(dir, "w.sqlite");
    try {
      const g1 = createGameServer({ transport: new LoopbackNetwork(1).createServer(), store: await SqliteWorldStore.open(path), seed: 3 });
      g1.agents.put("bot-a", { name: "Ann", relationship: -0.4, clan: { id: 7, memory: ["helped"] } } as never);
      await g1.shutdown();
      const g2 = createGameServer({ transport: new LoopbackNetwork(1).createServer(), store: await SqliteWorldStore.open(path), seed: 3 });
      const v = g2.agents.get("bot-a");
      expect(v?.relationship).toBe(-0.4); expect(v?.name).toBe("Ann"); expect(v?.["clan"]).toEqual({ id: 7, memory: ["helped"] });
      expect(g2.agents.put("bot-a", { relationship: 0.1 }).name).toBe("Ann"); // merge keeps other fields
      await g2.shutdown();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
