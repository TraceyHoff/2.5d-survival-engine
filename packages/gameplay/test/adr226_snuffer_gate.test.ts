import { describe, expect, it } from "vitest";
import { installPermissions, Membership, PlayerId, type Entity, type World } from "@engine/core";
import * as G from "../src/index.js";
import { makeWorld } from "./helpers.js";

/** ADR-226: Snuffers (light destroyers) only spawn near a human player whose highest skill-tree level is >= 10. */
const d = G.defaultDefs();
const SN = d.zombieId("zombie_snuffer"), WALK = d.zombieId("zombie_walker");
function setup(): { w: World; p: Entity } {
  const w = makeWorld(); installPermissions(w);
  const p = G.spawnPlayer(w, { x: 10.5, y: 10.5, maxWeight: 0, clientId: 1 }); w.add(p, PlayerId, { id: 7 }).add(p, Membership, { partyId: 0, clanId: 0 }); G.migrateProgression(w, p);
  return { w, p };
}
const setTree = (w: World, p: Entity, tree: string, level: number) => w.setElement(p, G.Progression, "tlevel", G.treeIndex(tree), level);

describe("ADR-226 snuffer level gate", () => {
  it("data: snuffer gated at 10 within 64 tiles; other kinds ungated", () => {
    expect(d.zombies.get(SN)!.minPlayerLevel).toBe(10); expect(d.zombies.get(SN)!.levelRadius).toBe(64);
    for (const k of ["zombie_walker", "zombie_runner", "zombie_brute"]) expect(d.zombies.get(d.zombieId(k))!.minPlayerLevel).toBeUndefined();
  });
  it("highest tree level of a nearby human player decides; far players, dead players and AI humans do not count", () => {
    const { w, p } = setup();
    expect(G.zombieKindAllowed(w, SN, 30, 10)).toBe(false); expect(G.zombieKindAllowed(w, WALK, 30, 10)).toBe(true);
    setTree(w, p, "survival", 9); setTree(w, p, "combat", 4); expect(G.playerTreeLevelNear(w, 30, 10)).toBe(9); expect(G.zombieKindAllowed(w, SN, 30, 10)).toBe(false);
    setTree(w, p, "crafting", 10); expect(G.zombieKindAllowed(w, SN, 30, 10)).toBe(true);
    expect(G.zombieKindAllowed(w, SN, 10 + 70, 10)).toBe(false); // out of range
    G.setAiHumanPredicate(w, (e) => e === p); expect(G.zombieKindAllowed(w, SN, 30, 10)).toBe(false);
    G.setAiHumanPredicate(w, () => false); w.add(p, G.Dead); expect(G.zombieKindAllowed(w, SN, 30, 10)).toBe(false);
  });
  it("gateZombieKind swaps a gated roll for a walker (hordes keep their size)", () => {
    const { w, p } = setup();
    expect(G.gateZombieKind(w, SN, 20, 10)).toBe(WALK); setTree(w, p, "survival", 12); expect(G.gateZombieKind(w, SN, 20, 10)).toBe(SN);
  });
  it("hordes: a forced horde with snuffer composition spawns none below level 10", () => {
    const { w, p } = setup();
    const sn = G.snapPlacement(w, { piece: d.pieceId("foundation")!, x: 12, y: 12, level: 0, rot: 0, tier: 0, variant: 0 });
    if (typeof sn !== "object") throw new Error("snap"); G.placePiece(w, p, sn, { pay: false });
    const kinds = () => [...w.query([G.HordeMember])].map((z) => w.getField(z, G.Zombie, "kind"));
    for (let i = 0; i < 4; i++) G.forceHorde(w, G.hordeTargets(w)[0]!, 10);
    expect(kinds().length).toBeGreaterThan(10); expect(kinds()).not.toContain(SN);
  });
});
