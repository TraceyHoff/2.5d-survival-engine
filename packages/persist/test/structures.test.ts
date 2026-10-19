import { describe, it, expect, afterEach } from "vitest";
import { World, entityIndex } from "@engine/core";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChunkManager, ProceduralGenerator, encodeChunk } from "@engine/world";
import { BuildPiece, Container, DoorState, PieceLink, gameplayDefs, installGameplay, placePiece, snapPlacement, structures, type PlaceRequest } from "@engine/gameplay";
import { MemoryWorldStore, WorldPersistence, type WorldStore } from "../src/index.js";
import { gameplayStructures, STRUCTURES_NS } from "../src/gameplay.js";
import { SqliteWorldStore } from "../src/node.js";

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function host(store: WorldStore, sidecars = true) {
  const world = new World({ seed: 5, maxEntities: 1 << 17 }); installGameplay(world, { role: "server" });
  const persist = new WorldPersistence({ world, store, generator: new ProceduralGenerator({ seed: 5 }), autosaveSeconds: 0, playerSaveSeconds: 0, ...(sidecars ? { sidecars: [gameplayStructures()] } : {}) });
  const chunks = new ChunkManager({ provider: persist.provider, loadRadius: 0, unloadMargin: 0, cacheSize: 0 });
  persist.attach(chunks); world.addSystem("postSim", "test.chunks", () => chunks.update());
  chunks.setSource({ id: 1, x: 16, y: 16 }); chunks.update();
  return { world, persist, chunks, step: (n = 1) => { for (let i = 0; i < n; i++) world.step(1 / 20); } };
}
/** 32x32 foundations + every north/west wall edge (3072 pieces), doorways with doors, storage boxes with items. */
function buildBase(world: World): number {
  const d = gameplayDefs(world); const id = (k: string) => [...d.pieces.values()].find((p) => p.key === k)!.id;
  const place = (r: Omit<PlaceRequest, "tier" | "variant">): void => {
    const sn = snapPlacement(world, { tier: 0, variant: 0, ...r }); if (typeof sn === "number") throw new Error(`snap ${JSON.stringify(r)}: ${sn}`);
    placePiece(world, 0, sn, { pay: false });
  };
  for (let ty = 0; ty < 32; ty++) for (let tx = 0; tx < 32; tx++) place({ piece: id("foundation"), x: tx + 0.5, y: ty + 0.5, level: 0, rot: 0 });
  for (let ty = 1; ty < 32; ty++) for (let tx = 0; tx < 32; tx++) place({ piece: id(tx % 8 === 3 ? "wall_doorway" : "wall"), x: tx + 0.5, y: ty, level: 0, rot: 0 });
  for (let ty = 0; ty < 32; ty++) for (let tx = 1; tx < 32; tx++) place({ piece: id("wall"), x: tx, y: ty + 0.5, level: 0, rot: 1 });
  for (let ty = 1; ty < 32; ty += 6) place({ piece: id("door_wood"), x: 3.5, y: ty, level: 0, rot: 0 });
  for (let i = 0; i < 20; i++) place({ piece: id("storage_box"), x: 1.5 + i, y: 30.5, level: 0, rot: 0 });
  return structures(world).chunkPieces.get("0,0")?.size ?? 0;
}
function summary(world: World) {
  const pieces = [...world.query([BuildPiece])].map((e) => world.get(e, BuildPiece)!).map((b) => `${b.type}/${b.rot}/${b.hp}`).sort();
  const doors = [...world.query([DoorState])].map((e) => world.get(e, DoorState)!.open).sort();
  const items = [...world.query([Container])].flatMap((e) => [...world.getArray(e, Container, "items")!].filter(Boolean)).sort();
  return { pieces, doors, items, links: [...world.query([PieceLink])].length };
}
function decorate(world: World): void {
  const doors = [...world.query([DoorState])]; world.setField(doors[0]!, DoorState, "open", 1);
  const boxes = [...world.query([Container])];
  boxes.forEach((b, i) => { world.getArray(b, Container, "items")![0] = 1 + (i % 5); world.getArray(b, Container, "counts")![0] = 3; world.store(Container).markChanged(entityIndex(b)); });
  const p = [...world.query([BuildPiece])][7]!; world.setField(p, BuildPiece, "hp", 33);
}

describe("gameplay structures as a chunk sidecar (STRC)", () => {
  it("3000+ piece base built with gameplay's building code survives a restart (SQLite), saved once (not as entities)", async () => {
    const d = mkdtempSync(join(tmpdir(), "persist-strc-")); dirs.push(d); const path = join(d, "w.db");
    const s1 = await SqliteWorldStore.open(path); const a = host(s1);
    a.step(); const n = buildBase(a.world); expect(n).toBeGreaterThanOrEqual(3000);
    decorate(a.world); a.step(3);
    const before = summary(a.world);
    expect(a.persist.isDirty("0,0")).toBe(true);
    const t0 = performance.now(); const part = a.persist.encodePart("0,0")!; const ms = performance.now() - t0;
    const warm: number[] = []; for (let i = 0; i < 5; i++) { const t = performance.now(); a.persist.encodePart("0,0"); warm.push(performance.now() - t); }
    console.log(`[strc] warm encodePart ms: ${warm.map((x) => x.toFixed(2)).join(" ")}`);
    console.log(`[strc] ${n} pieces: chunk row ${part.chunks![0]!.bytes.length} B, STRC ${part.records![0]!.bytes.length} B, encode ${ms.toFixed(2)} ms`);
    // pieces are in the sidecar only: the chunk row carries no piece entities
    const noPieces = encodeChunk(a.chunks.getChunk(0, 0)!, { world: a.world, entities: [] });
    expect(part.chunks![0]!.bytes.length).toBe(noPieces.length);
    expect(part.records![0]!.ns).toBe(STRUCTURES_NS);
    await a.persist.saveAll(); await s1.close();

    const s2 = await SqliteWorldStore.open(path); const b = host(s2); b.step(3);
    expect(s2.readRecord(STRUCTURES_NS, "0,0")).toBeDefined();
    expect(summary(b.world)).toEqual(before);
    expect(structures(b.world).chunkPieces.get("0,0")?.size).toBe(n);
    expect(b.persist.isDirty("0,0")).toBe(false); // loading is not a change
    // unload saves nothing new and drops every piece entity; reload restores them
    b.chunks.setSource({ id: 1, x: 500, y: 500 }); b.step(2);
    expect([...b.world.query([BuildPiece])].length).toBe(0); expect([...b.world.query([PieceLink])].length).toBe(0);
    b.chunks.setSource({ id: 1, x: 16, y: 16 }); b.step(3);
    expect(summary(b.world)).toEqual(before);
    await s2.close();
  }, 60_000);

  it("migrates an old save that stored pieces as chunk entities", async () => {
    const store = new MemoryWorldStore();
    const old = host(store, false); old.step(); buildBase(old.world); decorate(old.world); old.step(3);
    const before = summary(old.world);
    await old.persist.saveAll();
    expect(store.readRecord(STRUCTURES_NS, "0,0")).toBeUndefined(); // legacy layout: pieces inside the chunk row
    const legacyBytes = store.readChunk("0,0")!.bytes.length;

    const nu = host(store); nu.step(3);
    expect(nu.persist.stats.migratedChunks).toBe(1);
    expect(summary(nu.world)).toEqual(before);
    expect(structures(nu.world).chunkPieces.get("0,0")?.size).toBe(before.pieces.length);
    await nu.persist.saveAll();
    expect(store.readRecord(STRUCTURES_NS, "0,0")).toBeDefined();
    expect(store.readChunk("0,0")!.bytes.length).toBeLessThan(legacyBytes / 4);
    const again = host(store); again.step(3);
    expect(again.persist.stats.migratedChunks).toBe(0); expect(summary(again.world)).toEqual(before);
  }, 60_000);
});
