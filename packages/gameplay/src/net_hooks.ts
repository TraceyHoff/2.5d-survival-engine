/**
 * Gameplay-side adapters for Netcode server APIs (7ed4157). Structural types only: gameplay never imports @engine/net.
 *  - installStallBuyHook(stalls): net StallServer.setBuyHook → buyFromStall (one core transaction, all-or-nothing).
 *    Net runs range/open/permission/rate checks first and sends notifications after.
 *  - Watchtower AOI: installViewBonus(world, setBonus) where setBonus = (clientId, chunks) => server.setViewRadiusBonus(...).
 *    System gameplay.viewBonus (postSim, every VIEW_BONUS_EVERY ticks, authority, not while replaying) converts
 *    sightBonusAt (tiles) to chunks (ceil(tiles / CHUNK_SIZE), net caps at 2 and holds 60 ticks before lowering) and
 *    calls setBonus only on change. It writes no components.
 */
import { Owner, Transform, defineResource, type Entity, type World } from "@engine/core";
import { CHUNK_SIZE } from "@engine/world";
import { Dead } from "./components.js";
import { isAuthority } from "./config.js";
import { buyFromStallResult } from "./economy/stall.js";
import { sightBonusAt } from "./combat/pvp_pieces.js";

export interface StallBuyRequestLike { listing: number; qty: number; expectedRevision: number; expectedPriceItem: number; expectedPriceCount: number }
export type StallBuyHookLike = (world: World, buyer: Entity, stall: Entity, req: StallBuyRequestLike) => string | undefined | { crafterId?: number; reason?: string };
export const gameplayStallBuyHook: StallBuyHookLike = (w, b, s, r) =>
  buyFromStallResult(w, b, s, { listingSlot: r.listing, qty: r.qty, expectedRevision: r.expectedRevision, expectedPriceItem: r.expectedPriceItem, expectedPriceCount: r.expectedPriceCount });
export function installStallBuyHook(stalls: { setBuyHook(fn: StallBuyHookLike | undefined): void }): void { stalls.setBuyHook(gameplayStallBuyHook); }

export const VIEW_BONUS_EVERY = 10;
export type SetViewBonus = (clientId: number, chunks: number) => unknown;
interface ViewBonusState { set: SetViewBonus; last: Map<number, number> }
export const ViewBonusRes = defineResource<ViewBonusState>("gameplay.ViewBonus");
export function installViewBonus(world: World, set: SetViewBonus): void { world.setResource(ViewBonusRes, { set, last: new Map() }); }
export const sightChunks = (tiles: number): number => (tiles > 0 ? Math.ceil(tiles / CHUNK_SIZE) : 0);
export function viewBonusSystem(world: World): void {
  const st = world.getResource(ViewBonusRes); if (!st || !isAuthority(world) || world.isReplaying) return;
  const seen = new Set<number>();
  for (const e of [...world.query([Owner, Transform])].sort((a, b) => a - b)) {
    const cid = world.getField(e, Owner, "clientId")!; seen.add(cid);
    const t = world.get(e, Transform)!; const chunks = world.has(e, Dead) ? 0 : sightChunks(sightBonusAt(world, t.x, t.y));
    if ((st.last.get(cid) ?? 0) !== chunks) { st.last.set(cid, chunks); st.set(cid, chunks); }
  }
  for (const cid of [...st.last.keys()]) if (!seen.has(cid)) st.last.delete(cid);
}
