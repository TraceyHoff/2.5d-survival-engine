// fake-indexeddb is a dev dependency of @engine/persist (same import as agents_persist.test.ts).
import { describe, expect, test } from "vitest";
// @ts-expect-error untyped relative path into persist's dev dependency
import { IDBFactory } from "../../../packages/persist/node_modules/fake-indexeddb/build/esm/index.js";
import { IndexedDbWorldStore } from "@engine/persist";
import { createLocalServer } from "../src/local.js";
import { ClientSession, type KeyValue } from "../src/session.js";
import { localDbName, wipeHostedWorld, wipeSingleplayerSave } from "../src/delete-progress.js";

class MapStorage implements KeyValue { m = new Map<string, string>(); getItem(k: string): string | null { return this.m.get(k) ?? null; } setItem(k: string, v: string): void { this.m.set(k, v); } removeItem(k: string): void { this.m.delete(k); } }

describe("singleplayer Delete save", () => {
  async function play(factory: IDBFactory, storage: MapStorage): Promise<{ restored: boolean; players: number }> {
    const store = await IndexedDbWorldStore.open(localDbName("1"), { factory });
    const local = await createLocalServer({ store, seed: 3, bots: 0, population: false });
    const session = new ClientSession({ storage, slot: "1", sampleButtons: () => 0 });
    const connecting = session.connect("local", "Tess", local.createTransport());
    let world: { step(dt: number): void } | undefined;
    for (let i = 0; i < 40 && !world; i++) { local.pump(5); world = (await Promise.race([connecting, new Promise((r) => setTimeout(r, 0))])) as never; }
    for (let i = 0; i < 40; i++) { local.pump(50); world?.step(1 / 20); session.poll(); await new Promise((r) => setTimeout(r, 0)); }
    const restored = session.restored;
    session.disconnect(); await local.stop(); // saves + closes the DB (what "Delete save" does before wiping)
    return { restored, players: store.count("players") };
  }
  test("wipes the slot DB (character, world, bot memory) and the next start is a fresh character; settings kept unless opted in", async () => {
    const factory = new IDBFactory(); const storage = new MapStorage();
    const s = { m: new Map([["engine-settings", "{}"], ["engine.input.bindings", "{}"]]), removeItem(k: string) { this.m.delete(k); } };
    const a = await play(factory, storage); expect(a.restored).toBe(false); expect(a.players).toBe(1); // saved character row
    expect((await factory.databases()).map((d: { name?: string }) => d.name)).toContain(localDbName("1"));
    const r = await wipeSingleplayerSave({ slot: "1", resetSettings: false, factory, storage: s, blockedMs: 500 });
    expect(r).toMatchObject({ ok: true, deleted: [localDbName("1")] }); expect(s.m.size).toBe(2);
    expect((await factory.databases()).map((d: { name?: string }) => d.name)).not.toContain(localDbName("1"));
    const c = await play(factory, storage); expect(c.restored).toBe(false); // same account token, no saved character
    const r2 = await wipeSingleplayerSave({ slot: "1", resetSettings: true, factory, storage: s, blockedMs: 500 });
    expect(r2.ok).toBe(true); expect(s.m.size).toBe(0);
  }, 60_000);
  test("hosted world can't be deleted while hosting", async () => {
    expect((await wipeHostedWorld({ slot: "1", hosting: true, factory: new IDBFactory() })).ok).toBe(false);
    expect((await wipeHostedWorld({ slot: "1", hosting: false, factory: new IDBFactory(), blockedMs: 500 })).ok).toBe(true);
  });
});

