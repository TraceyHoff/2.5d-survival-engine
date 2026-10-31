import { describe, it, expect } from "vitest";
import { installPermissions, PlayerId, Transform, type Entity, type World } from "@engine/core";
import * as G from "../src/index.js";
import { addItem, attachmentsOf, CombatTag, countItem, damagePiece, Dead, defaultDefs, DoorState, Health, IntentAction, LootBag, placePiece, setIntent, snapPlacement, spawnPlayer, Tribe } from "../src/index.js";
import { collect, makeWorld, steps } from "./helpers.js";

const d = defaultDefs(); const WOOD = d.itemId("wood");
const mk = (w: World, id: number, x = 0) => { const p = spawnPlayer(w, { x, y: 0, clientId: id }); w.add(p, PlayerId, { id }); return p; };
function place(w: World, b: Entity, key: string, x: number, y: number): Entity {
  const sn = snapPlacement(w, { piece: d.pieceId(key), x, y, level: 0, rot: 0, tier: 0, variant: 0 }); if (typeof sn === "number") throw new Error(`snap ${sn}`);
  return placePiece(w, b, sn, { pay: false });
}
const kill = (w: World, p: Entity) => { G.applyDamage(w, p, 1e6, p); steps(w, 1); };

describe("pvp (slice 6)", () => {
  it("death drops a bag with the inventory; owner-only loot window; despawns shortly after emptied", () => {
    const w = makeWorld(); installPermissions(w); const a = mk(w, 1, 3); const b = mk(w, 2, 3);
    addItem(w, a, WOOD, 7); const drops = collect(w, G.DeathBagDropped);
    kill(w, a);
    expect(w.has(a, Dead)).toBe(true); expect(countItem(w, a, WOOD)).toBe(0); expect(drops.length).toBe(1);
    const bag = drops[0]!.bag; expect(countItem(w, bag, WOOD)).toBe(7); expect(w.getField(bag, LootBag, "owner")).toBe(1);
    expect(G.canLootBag(w, b, bag)).toBe(false); expect(G.canLootBag(w, a, bag)).toBe(true);
    steps(w, 20 * G.PVP.bagOwnerOnlySeconds); expect(G.canLootBag(w, b, bag)).toBe(true);
    G.transferItem(w, bag, b, WOOD, 7); steps(w, 20); expect(w.isAlive(bag)).toBe(true); // ADR-238: short emptied grace (fade + puff)
    steps(w, 20 * (G.DESPAWN.emptiedSeconds + 1)); expect(w.isAlive(bag)).toBe(false);
  });
  it("respawn waits respawnSeconds, then restores at a spawn point", () => {
    const w = makeWorld(); installPermissions(w); const a = mk(w, 1, 30); kill(w, a);
    expect(G.respawnPlayer(w, a)).toBe("too_soon");
    steps(w, 20 * G.PVP.respawnSeconds);
    const ev = collect(w, G.Respawned); expect(G.respawnPlayer(w, a)).toBeUndefined();
    expect(w.has(a, Dead)).toBe(false); expect(w.getField(a, Health, "hp")).toBeGreaterThan(0);
    const sp = G.PVP.spawnPoints[0]!; const t = w.get(a, Transform)!; expect(Math.hypot(t.x - sp.x, t.y - sp.y)).toBeLessThanOrEqual(G.SPAWN_JITTER + 1e-9); // pvp.json fallback + jitter
    steps(w, 1); expect(ev.length).toBe(1);
    expect(G.respawnPlayer(w, a)).toBe("not_dead");
  });
  it("hit validator vetoes player hits; accepted PvP hits combat-tag both", () => {
    const w = makeWorld(); installPermissions(w); const a = mk(w, 1, 0); const b = mk(w, 2, 0.8); const h0 = w.getField(b, Health, "hp")!;
    const rej = collect(w, G.HitRejected); G.setHitValidator(w, () => "reach");
    setIntent(w, a, { action: IntentAction.Attack, target: b }); steps(w, 1);
    expect(w.getField(b, Health, "hp")).toBe(h0); expect(rej[0]?.reason).toBe("reach");
    G.setHitValidator(w, undefined); steps(w, 20);
    setIntent(w, a, { action: IntentAction.Attack, target: b }); steps(w, 1);
    expect(w.getField(b, Health, "hp")).toBeLessThan(h0);
    expect(G.inCombat(w, a)).toBe(true); expect(w.has(b, CombatTag)).toBe(true);
  });
  it("raid damage tracks the attacker; breaching a gate grants raider", () => {
    const w = makeWorld(); installPermissions(w); const owner = mk(w, 1, 0); w.add(owner, Tribe, { id: 7 }); const raider = mk(w, 2, 0);
    const gate = place(w, owner, "gate_clan", 4, 4);
    const dmg = collect(w, G.PieceDamaged); const br = collect(w, G.GateBreached);
    damagePiece(w, gate, 100, raider); steps(w, 1); expect(dmg[0]!.attacker).toBe(raider);
    damagePiece(w, gate, 1500 * 0.8, raider); steps(w, 1);
    expect(br.length).toBe(1); expect(br[0]!.attacker).toBe(raider);
    expect(attachmentsOf(w, gate).some((x) => w.getField(x, DoorState, "open") === G.DOOR_BREACHED)).toBe(true);
    expect(G.hasUnlock(w, raider, "raider")).toBe(true);
  });
});
