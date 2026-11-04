import { describe, expect, it } from "vitest";
import { installPermissions, PlayerId, Transform, type Entity, type World } from "@engine/core";
import * as G from "../src/index.js";
import { makeWorld, steps } from "./helpers.js";

const d = G.defaultDefs(); const WOOD = d.itemId("wood");
const mk = (w: World, id: number, x = 0, y = 0) => { const p = G.spawnPlayer(w, { x, y, clientId: id }); w.add(p, PlayerId, { id }); return p; };
function place(w: World, b: Entity, key: string, x: number, y: number): Entity {
  const sn = G.snapPlacement(w, { piece: d.pieceId(key), x, y, level: 0, rot: 0, tier: 0, variant: 0 }); if (typeof sn === "number") throw new Error(`snap ${sn}`);
  return G.placePiece(w, b, sn, { pay: false });
}

describe("Task 4: storage chests, death bags and dropped items", () => {
  it("Interact opens a plain storage chest (previously there was no chest case at all)", () => {
    const w = makeWorld(); installPermissions(w); const me = mk(w, 1, 10, 10);
    const chest = place(w, me, "basic_storage_box", 11, 10);
    expect(G.interactPanel({ world: w, player: me })).toEqual({ panel: "storage", piece: chest });
    // the server open path for the piece target resolves to its Storage attachment
    G.setIntent(w, me, { action: G.IntentAction.OpenContainer, target: chest }); steps(w, 1);
    expect(w.getField(me, G.Viewing, "container")).toBeDefined();
  });
  it("Interact on another player's death bag inside the 60s window reports it locked instead of opening the bare inventory", () => {
    const w = makeWorld(); installPermissions(w); const me = mk(w, 1, 10, 10); const other = mk(w, 2, 10.5, 10);
    G.addItem(w, other, WOOD, 3); G.applyDamage(w, other, 1e6, other); steps(w, 1);
    const bag = [...w.query([G.LootBag])].find((x) => w.getField(x, G.LootBag, "owner") === 2)!;
    expect(G.interactPanel({ world: w, player: me })).toEqual({ panel: "lootLocked", bag });
    steps(w, 20 * G.PVP.bagOwnerOnlySeconds);
    expect(G.interactPanel({ world: w, player: me })).toEqual({ panel: "loot", bag });
  });
  it("dropped items are lootable immediately by another player (no death-bag owner window)", () => {
    const w = makeWorld(); installPermissions(w); const me = mk(w, 1, 10, 10); const other = mk(w, 2, 10.5, 10);
    G.addItem(w, other, WOOD, 3); const dropped = G.dropItem(w, other, WOOD, 3)!;
    expect(G.canLootBag(w, me, dropped)).toBe(true);
    expect(G.interactPanel({ world: w, player: me })).toEqual({ panel: "loot", bag: dropped });
  });
});
