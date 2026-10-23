import { describe, it, expect } from "vitest";
import { getAppearance, defaultAppearance, type CosmeticCatalogLike, type WearableDef } from "@engine/core";
import * as G from "../src/index.js";
import { makeWorld } from "./helpers.js";

const wd = (id: number, slot: WearableDef["slot"], unlockTags: string[] = []): WearableDef => ({
  id, key: `w${id}`, slot, bodies: { male: { sprite: id, anim: "idle" }, female: { sprite: id, anim: "idle" } }, layer: 1, z: 0, tintChannels: 1, hidesSlots: [], hatHair: false, unlockTags,
});
const W = new Map([[1, wd(1, "hair")], [2, wd(2, "hat", ["chef"])]]);
const pal = [{ index: 0, key: "a", color: 0 }, { index: 1, key: "b", color: 1 }];
const cat: CosmeticCatalogLike = { wearable: (i) => W.get(i), bodySprite: () => ({ sprite: 0, anim: "idle" }), skinTones: pal, hairColors: pal, clothingColors: pal };
const d = G.defaultDefs();
function setup() {
  const w = makeWorld(); G.installCustomization(w, { catalog: cat });
  const p = G.spawnPlayer(w, { x: 0, y: 0, maxWeight: 0, clientId: 1 });
  return { w, p };
}
const look = (hat = 0) => { const a = defaultAppearance(cat); a.parts[0] = 1; a.parts[1] = hat; return a; };

describe("customization (slice 8)", () => {
  it("first-join creator once, grants founder, then needs a wardrobe", () => {
    const { w, p } = setup();
    expect(G.canEditAppearance(w, p, true)).toBe(true);
    expect(G.applyAppearance(w, p, look())).toBeUndefined();
    expect(getAppearance(w, p)!.parts[0]).toBe(1);
    expect(G.hasCreatedLook(w, p)).toBe(true);
    expect(G.hasUnlock(w, p, "founder")).toBe(true);
    expect(G.canEditAppearance(w, p, true)).toBe(false);
    expect(G.applyAppearance(w, p, look())).toBe("not_allowed");
  });
  it("locked wearable rejected until the unlock tag is granted (craft rule)", () => {
    const { w, p } = setup(); G.applyAppearance(w, p, look());
    expect(G.checkAppearance(w, p, look(2), true).reason).toBe("not_allowed");
    // pretend near a wardrobe: test the validation layer via the bypassed gate
    expect(G.hasUnlock(w, p, "chef")).toBe(false);
    G.noteUnlockEvent(w, p, "craft", "stew_bowl");
    expect(G.hasUnlock(w, p, "chef")).toBe(true);
    expect(G.grantUnlock(w, p, "chef")).toBe(false);
    expect(() => G.grantUnlock(w, p, "nope")).toThrow();
  });
  it("locked part rejected with a reason on first join", () => {
    const { w, p } = setup();
    const r = G.checkAppearance(w, p, look(2));
    expect(r.value).toBeUndefined(); expect(typeof r.reason).toBe("string");
  });
  it("near a mirror piece the player may re-edit and wear unlocked items", () => {
    const { w, p } = setup(); G.applyAppearance(w, p, look()); G.grantUnlock(w, p, "chef");
    const sn = G.snapPlacement(w, { piece: d.pieceId("mirror"), x: 1, y: 0, level: 0, rot: 0, tier: 0, variant: 0 });
    if (typeof sn === "number") throw new Error(`snap ${sn}`);
    G.placePiece(w, p, sn, { pay: false });
    expect(G.nearWardrobe(w, p)).toBe(true);
    expect(G.equipCosmetic(w, p, 1, 2, 1)).toBeUndefined();
    expect(getAppearance(w, p)!.parts[1]).toBe(2);
  });
  it("net hooks are structural and mirror the gate", () => {
    const { w, p } = setup(); let dirty = 0;
    const h = G.appearanceServerHooks(w, () => dirty++);
    expect(h.allow(null, p, true)).toBe(true);
    h.onChanged(null, p); expect(dirty).toBe(1); expect(G.hasCreatedLook(w, p)).toBe(true);
    expect(h.unlocksOf(null, p).has("founder")).toBe(true);
  });
  it("mirror piece is data-driven with features.wardrobe", () => {
    expect(d.pieces.get(d.pieceId("mirror"))!.features.wardrobe).toBe(true);
    expect(G.COSMETICS.unlockTags.length).toBeLessThanOrEqual(64);
  });
});
