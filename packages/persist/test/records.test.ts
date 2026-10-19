import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IDBFactory } from "fake-indexeddb";
import { IndexedDbWorldStore, MemoryWorldStore, OwnerKind, type StoredRecord, type WorldStore } from "../src/index.js";
import { SqliteWorldStore } from "../src/node.js";

/**
 * Generic records table: the extension point for row-per-object systems (the planned trade-stall economy uses ns
 * "stall" / "listing" / "earnings"). Same contract on every backend: upsert/delete by (ns, id), owner + chunk filters,
 * read-your-writes before commit, atomic with the rest of a batch, survives a reopen.
 */
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const rec = (ns: string, id: string, ownerKind: number, ownerId: number, chunk: StoredRecord["chunk"], v: number): StoredRecord =>
  ({ ns, id, format: 1, bytes: new Uint8Array([v, v + 1, 255]), tick: 10, ownerKind, ownerId, chunk });

type Backend = { name: string; open(): Promise<WorldStore>; reopen?: () => Promise<WorldStore> };
function backends(): Backend[] {
  const d = mkdtempSync(join(tmpdir(), "persist-rec-")); dirs.push(d); const path = join(d, "w.db");
  const f = new IDBFactory();
  return [
    { name: "memory", open: async () => new MemoryWorldStore() },
    { name: "sqlite (worker)", open: () => SqliteWorldStore.open(path), reopen: () => SqliteWorldStore.open(path) },
    { name: "indexeddb", open: () => IndexedDbWorldStore.open("w", { factory: f }), reopen: () => IndexedDbWorldStore.open("w", { factory: f }) },
  ];
}

describe("generic records (stall-economy extension point)", () => {
  for (const b of backends()) {
    it(`${b.name}: upsert, query by owner / chunk, delete, read-your-writes, reopen`, async () => {
      const s = await b.open();
      const w = s.write({
        records: [
          rec("stall", "s1", OwnerKind.Player, 7, "0,0", 1), rec("stall", "s2", OwnerKind.Group, 3, "1,0", 2),
          rec("listing", "l1", OwnerKind.Player, 7, "0,0", 3), rec("listing", "l2", OwnerKind.Group, 3, "1,0", 4),
          rec("earnings", "p7", OwnerKind.Player, 7, "", 5),
        ],
      });
      expect(s.readRecord("stall", "s1")?.ownerId).toBe(7); // visible before commit
      await w;
      expect(s.listRecords("stall").map((r) => r.id)).toEqual(["s1", "s2"]);
      expect(s.listRecords("listing", { ownerKind: OwnerKind.Group, ownerId: 3 }).map((r) => r.id)).toEqual(["l2"]);
      expect(s.listRecords("listing", { chunk: "0,0" }).map((r) => r.id)).toEqual(["l1"]);
      expect(s.listRecords("earnings", { ownerKind: OwnerKind.Player, ownerId: 7 })[0]?.chunk).toBe("");
      // a sale: listing removed, earnings updated, same transaction
      const sale = s.write({ deleteRecords: [{ ns: "listing", id: "l1" }], records: [rec("earnings", "p7", OwnerKind.Player, 7, "", 9)] });
      expect(s.readRecord("listing", "l1")).toBeUndefined(); expect(s.listRecords("listing").map((r) => r.id)).toEqual(["l2"]);
      await sale;
      expect([...s.readRecord("earnings", "p7")!.bytes]).toEqual([9, 10, 255]);
      expect(s.count("records")).toBe(4);
      await s.close();
      if (!b.reopen) return;
      const s2 = await b.reopen();
      expect(s2.listRecords("listing").map((r) => r.id)).toEqual(["l2"]);
      expect(s2.readRecord("stall", "s2")).toMatchObject({ ownerKind: OwnerKind.Group, ownerId: 3, chunk: "1,0", format: 1, tick: 10 });
      expect([...s2.readRecord("earnings", "p7")!.bytes]).toEqual([9, 10, 255]);
      expect(s2.count("records")).toBe(4);
      await s2.close();
    });
  }
  it("sqlite: a failing batch rolls back its records with everything else", async () => {
    const s = await SqliteWorldStore.open(":memory:", { writer: "inline" });
    await s.write({ records: [rec("stall", "a", 1, 1, "", 1)] });
    // NOT NULL violation on a chunk row aborts the whole transaction, including the record upsert in it.
    const bad = s.write({ records: [rec("stall", "b", 1, 1, "", 2)], chunks: [{ key: "0,0", format: 1, bytes: null as never, tick: 1 }] });
    await expect(bad).rejects.toThrow();
    expect(s.readRecord("stall", "b")).toBeUndefined(); expect(s.count("records")).toBe(1);
    await s.close();
  });
});
