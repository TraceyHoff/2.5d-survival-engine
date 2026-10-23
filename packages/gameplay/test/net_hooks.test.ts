import { describe, it, expect } from "vitest";
import { Transform, type Entity, type World } from "@engine/core";
import * as G from "../src/index.js";
import { makeWorld, steps } from "./helpers.js";

const d = G.defaultDefs();
function place(w: World, b: Entity, key: string, x: number, y: number): Entity {
  const sn = G.snapPlacement(w, { piece: d.pieceId(key), x, y, level: 0, rot: 0, tier: 0, variant: 0 }); if (typeof sn === "number") throw new Error(`snap ${sn}`);
  return G.placePiece(w, b, sn, { pay: false });
}
describe("netcode adapters", () => {
  it("stall buy hook maps listing -> listingSlot and returns a reason string", () => {
    let hook: G.StallBuyHookLike | undefined; G.installStallBuyHook({ setBuyHook: (f) => { hook = f; } });
    const w = makeWorld(); const p = G.spawnPlayer(w, { x: 0, y: 0 });
    expect(hook!(w, p, p, { listing: 0, qty: 1, expectedRevision: 0, expectedPriceItem: 0, expectedPriceCount: 0 })).toBe("not_stall");
  });
  it("watchtower sets the AOI bonus on change only, clears when leaving", () => {
    const w = makeWorld(); const calls: [number, number][] = []; G.installViewBonus(w, (c, n) => calls.push([c, n]));
    const p = G.spawnPlayer(w, { x: 10.5, y: 10.5, clientId: 4 }); place(w, p, "watchtower", 10, 10);
    steps(w, 30); expect(calls).toEqual([[4, 1]]);
    w.set(p, Transform, { x: 80, y: 80 }); steps(w, 20);
    expect(calls.at(-1)).toEqual([4, 0]);
  });
});
