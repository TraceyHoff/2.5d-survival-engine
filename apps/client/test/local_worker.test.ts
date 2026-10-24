// ADR-104: the singleplayer server's Web Worker path, run in-process (the worker module talks to globalThis.postMessage /
// onmessage; a fake Worker bridges both ways through structuredClone like the real postMessage does).
import { describe, expect, test } from "vitest";
import { snapshotCatalog, catalogFromSnapshot } from "../src/catalog-snapshot.js";
import { startWorkerServer } from "../src/local-bridge.js";
import { ClientSession, type KeyValue } from "../src/session.js";
import { BODY_TYPES, defaultAppearance, type CosmeticCatalogLike, type WearableDef } from "@engine/core";

class MapStorage implements KeyValue { m = new Map<string, string>(); getItem(k: string): string | null { return this.m.get(k) ?? null; } setItem(k: string, v: string): void { this.m.set(k, v); } removeItem(k: string): void { this.m.delete(k); } }

describe("singleplayer server in a Web Worker", () => {
  test("catalog snapshot round-trips through structuredClone", () => {
    const w = { id: 3, slot: "hat", bodies: { male: { sprite: 1, anim: "a" } }, unlockTags: [] } as unknown as WearableDef;
    const cat: CosmeticCatalogLike = { wearable: (id) => (id === 3 ? w : undefined), bodySprite: (b) => ({ sprite: b === "male" ? 7 : 8, anim: "idle" }),
      skinTones: [{ index: 0, key: "s", color: 1 }], hairColors: [], clothingColors: [], tintNeutral: 5 };
    const back = catalogFromSnapshot(structuredClone(snapshotCatalog(cat)));
    expect(back.wearable(3)).toEqual(w); expect(back.wearable(4)).toBeUndefined(); expect(back.size).toBe(1);
    for (const b of BODY_TYPES) expect(back.bodySprite(b)).toEqual(cat.bodySprite(b));
    expect(back.tintNeutral).toBe(5); expect(defaultAppearance(back, 0)).toEqual(defaultAppearance(cat, 0));
  });

  test("falls back (undefined) when the worker fails to start", async () => {
    const fake = { onmessage: null as ((e: { data: unknown }) => void) | null, onerror: null, postMessage() { setTimeout(() => fake.onmessage?.({ data: { t: "fail", error: "boom" } }), 0); }, terminate() {} };
    expect(await startWorkerServer({ dbName: "x", bots: 0, status: { state: "", store: "", error: undefined }, makeWorker: () => fake as never })).toBeUndefined();
  });

  test("player connects, plays and saves through the worker bridge", async () => {
    const g = globalThis as unknown as { postMessage?: (m: unknown) => void; onmessage?: ((e: { data: unknown }) => void) | null };
    const fake = { onmessage: null as ((e: { data: unknown }) => void) | null, onerror: null,
      postMessage(m: unknown) { const c = structuredClone(m); setTimeout(() => g.onmessage?.({ data: c }), 0); }, terminate() {} };
    g.postMessage = (m) => { const c = structuredClone(m); setTimeout(() => fake.onmessage?.({ data: c }), 0); };
    await import("../src/local-worker.js");
    const status = { state: "", store: "", error: undefined as string | undefined };
    const h = await startWorkerServer({ dbName: "engine-local-test", bots: 2, status, makeWorker: () => fake as never });
    expect(h?.inWorker).toBe(true); expect(status.state).toBe("starting");
    const session = new ClientSession({ storage: new MapStorage(), slot: "1", sampleButtons: () => 0 });
    const world = await session.connect("local", "Tess", h!.createTransport());
    for (let i = 0; i < 30; i++) { world.step(1 / 20); session.poll(); await new Promise((r) => setTimeout(r, 20)); }
    expect(session.client?.stats.snapshots ?? 0).toBeGreaterThan(5);
    await h!.save(); session.disconnect(); await h!.stop();
    delete g.postMessage; g.onmessage = null;
  }, 30_000);
});
