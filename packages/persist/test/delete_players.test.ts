import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IDBFactory } from "fake-indexeddb";
import { IndexedDbWorldStore, MemoryWorldStore, PLAYER_VERSION, type StoredPlayer, type WorldStore } from "../src/index.js";
import { SqliteWorldStore } from "../src/node.js";

/** SaveBatch.deletePlayers (ADR-099 "delete my progress"): removes only the named rows, read-your-writes, survives a reopen. */
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const pl = (token: string, v: number): StoredPlayer => ({ token, name: token, format: PLAYER_VERSION, bytes: new Uint8Array([v]), tick: 1 });
function backends(): { name: string; open(): Promise<WorldStore>; reopen?: () => Promise<WorldStore> }[] {
  const d = mkdtempSync(join(tmpdir(), "persist-del-")); dirs.push(d); const path = join(d, "w.db"); const f = new IDBFactory();
  return [
    { name: "memory", open: async () => new MemoryWorldStore() },
    { name: "sqlite", open: () => SqliteWorldStore.open(path), reopen: () => SqliteWorldStore.open(path) },
    { name: "indexeddb", open: () => IndexedDbWorldStore.open("w", { factory: f }), reopen: () => IndexedDbWorldStore.open("w", { factory: f }) },
  ];
}
describe("SaveBatch.deletePlayers", () => {
  for (const b of backends()) it(`${b.name}: deletes only the caller's row`, async () => {
    const s = await b.open();
    await s.write({ players: [pl("a", 1), pl("b", 2)] });
    const w = s.write({ deletePlayers: ["a"] });
    expect(s.readPlayer("a")).toBeUndefined(); // before commit
    expect([...(s.readPlayer("b")?.bytes ?? [])]).toEqual([2]);
    await w;
    expect(s.readPlayer("a")).toBeUndefined(); expect(s.count("players")).toBe(1);
    await s.close();
    if (!b.reopen) return;
    const r = await b.reopen();
    expect(r.readPlayer("a")).toBeUndefined(); expect(r.readPlayer("b")?.name).toBe("b"); expect(r.count("players")).toBe(1);
    await r.write({ players: [pl("a", 9)] }); expect([...(r.readPlayer("a")?.bytes ?? [])]).toEqual([9]); // a fresh row can come back
    await r.close();
  });
});
