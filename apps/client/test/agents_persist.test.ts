import { describe, it, expect } from "vitest";
// fake-indexeddb is a dev dependency of @engine/persist (not re-declared here to avoid an install in this app).
// @ts-expect-error untyped relative path into persist's dev dependency
import { IDBFactory } from "../../../packages/persist/node_modules/fake-indexeddb/build/esm/index.js";
import { IndexedDbWorldStore } from "@engine/persist";
import { createLocalServer } from "../src/local.js";

describe("bot AgentIdentity persistence (offline Pages: IndexedDB)", () => {
  it("relationship / party memory survive save + reload", async () => {
    const factory = new IDBFactory();
    const s1 = await IndexedDbWorldStore.open("agents-test", { factory });
    const a = await createLocalServer({ store: s1, seed: 5, bots: 1, population: false });
    const id = a.bots[0]!.agent.identity.id;
    const seen: string[] = []; a.game.agents.onChange((i) => seen.push(i));
    a.game.agents.put(id, { relationship: 0.75, party: "p1" });
    expect(seen).toEqual([id]);
    await a.stop();
    const s2 = await IndexedDbWorldStore.open("agents-test", { factory });
    const b = await createLocalServer({ store: s2, seed: 5, bots: 1, population: false });
    expect(b.game.agents.get(id)?.relationship).toBe(0.75);
    expect(b.game.agents.get(id)?.["party"]).toBe("p1");
    expect(b.bots[0]!.agent.identity.relationship).toBe(0.75);
    await b.stop();
  });
});
