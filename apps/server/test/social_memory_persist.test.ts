import { describe, it, expect } from "vitest";
import { makeAgent, makeAgentIdentity, noteSocialEvent, flushSocialMemory, socialMemoryOf, SOCIAL_MEMORY } from "@engine/gameplay";
import { LoopbackNetwork } from "@engine/net";
import { MemoryWorldStore } from "@engine/persist";
import { createGameServer } from "../src/main.js";

describe("bot social memory persists through game.agents", () => {
  it("debounced put on change; a returning bot (addBot merge of agents.get) gets it back after restart", async () => {
    const store = new MemoryWorldStore();
    const g1 = createGameServer({ transport: new LoopbackNetwork(1).createServer(), store, seed: 3 });
    const base = makeAgentIdentity(3, 0); g1.agents.put(base.id, { ...base });
    const agent = makeAgent({ ...base, ...(g1.agents.get(base.id) ?? {}) }, 1);
    let writes = 0; g1.agents.onChange(() => writes++);
    noteSocialEvent(agent, 42, "helped", 5); noteSocialEvent(agent, 42, "traded", 6);
    expect(flushSocialMemory([agent], g1.agents.put, 6)).toEqual([]); expect(writes).toBe(0); // debounced
    flushSocialMemory([agent], g1.agents.put, 5 + SOCIAL_MEMORY.writeDebounceTicks); expect(writes).toBe(1);
    const mem = JSON.parse(JSON.stringify(socialMemoryOf(agent)));
    await g1.shutdown();
    const g2 = createGameServer({ transport: new LoopbackNetwork(1).createServer(), store, seed: 3 });
    const rec = g2.agents.get(base.id); expect(rec?.name).toBe(base.name);
    const back = makeAgent({ ...makeAgentIdentity(3, 0), ...(rec ?? {}) }, 1); // what local.ts addBot does
    expect(socialMemoryOf(back)).toEqual(mem); expect(socialMemoryOf(back).relationships["42"]!.notableEvents.map((e) => e.kind)).toEqual(["helped", "traded"]);
    await g2.shutdown();
  });
});
