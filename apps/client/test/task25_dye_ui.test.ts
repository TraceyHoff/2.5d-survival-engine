// @vitest-environment jsdom
// Task 25: Character panel dye section (brush/dye gating + swatches) and Build panel tint row (all 16 clan palettes,
// tiered pieces paintable, Paint-nearest gated on brush + dye).
import { beforeEach, describe, expect, test } from "vitest";
import { installPermissions, Membership, PlayerId, World, defaultAppearance, setAppearance, slotIndex, type CosmeticCatalogLike, type WearableDef } from "@engine/core";
import * as G from "@engine/gameplay";
import { GameMenus } from "../src/game-menus.js";

const wd = (id: number, slot: WearableDef["slot"]): WearableDef => ({
  id, key: `w${id}`, slot, bodies: { male: { sprite: id, anim: "idle" }, female: { sprite: id, anim: "idle" } }, layer: 1, z: 0, tintChannels: 2, hidesSlots: [], hatHair: false, unlockTags: [],
});
const hairPal = [{ index: 0, key: "black", color: 0x2e2630 }, { index: 1, key: "brown", color: 0x6b4a2f }, { index: 2, key: "teal", color: 0x3aa6a0 }];
const clothPal = [{ index: 0, key: "white", color: 0xf4f0e8 }, { index: 1, key: "red", color: 0xd9503e }, { index: 2, key: "blue", color: 0x4f8fd6 }];
const cat: CosmeticCatalogLike = { wearable: (i) => new Map([[1, wd(1, "hair")], [2, wd(2, "top")]]).get(i), bodySprite: () => ({ sprite: 0, anim: "idle" }), skinTones: hairPal, hairColors: hairPal, clothingColors: clothPal };

beforeEach(() => { document.head.innerHTML = ""; document.body.innerHTML = `<div id="game-root"><canvas id="game"></canvas></div>`; localStorage.clear(); (globalThis as { matchMedia?: unknown }).matchMedia = () => ({ matches: false }); });

function setup() {
  const w = new World({ seed: 1, maxEntities: 1 << 12 }); G.installGameplay(w, {}); installPermissions(w); G.installEconomy(w); G.installCustomization(w, { catalog: cat });
  const me = G.spawnPlayer(w, { x: 0, y: 0, maxWeight: 0, clientId: 7 }); w.add(me, PlayerId, { id: 7 }).add(me, Membership, { partyId: 0, clanId: 3 });
  const a = defaultAppearance(cat); a.parts[slotIndex("hair")] = 1; a.parts[slotIndex("top")] = 2; setAppearance(w, me, a);
  const d = G.gameplayDefs(w); const id = (k: string) => d.itemId(k);
  return { w, me, id };
}
const putInSlot = (w: World, e: number, slot: number, item: number, count = 1): void => {
  const v = G.readSlots(w, e); v.items[slot] = item; v.counts[slot] = count; G.writeSlots(w, e, v, G.gameplayDefs(w));
};
const menus = (w: World, me: number, clanTint?: (t: number) => number | undefined, send: (i: unknown) => boolean = () => true) => new GameMenus({ root: document.getElementById("game-root")!, onQuit: () => {}, pollGamepads: false, getGamepads: () => [],
  gameplay: { ctx: () => ({ world: w, player: me, catalog: cat }), send: send as never, startPlacing: () => {}, clanTint: clanTint ?? (() => undefined), clanTint2: () => undefined } as never });
const q = (sel: string): HTMLElement | null => document.querySelector<HTMLElement>(sel);
const qa = (sel: string): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>(sel));

describe("Task 25: dye UI", () => {
  test("Character panel shows the dye status and gates the swatches on brush + dye", () => {
    const { w, me, id } = setup();
    const sent: unknown[] = []; const m = menus(w, me, undefined, (i) => { sent.push(i); return true; }); m.open("character");
    const status = q("[data-role=dye-status]")!;
    expect(status.textContent).toContain("paint brush in your hotbar"); // no brush yet
    // hair swatches exist (3 hair colours) but are disabled without brush/dye
    const hairSwatches = qa("[data-key^=dye-0-]");
    expect(hairSwatches.length).toBe(3);
    expect(hairSwatches.every((b) => b.hasAttribute("disabled"))).toBe(true);
    // brush in the hotbar but no dye: still disabled
    putInSlot(w, me, 16, id("paint_brush")); m.open("character");
    expect(q("[data-role=dye-status]")!.textContent).toContain("no dye");
    expect(qa("[data-key^=dye-0-]").every((b) => b.hasAttribute("disabled"))).toBe(true);
    // brush + dye: swatches enabled, status shows the dye count
    G.addItem(w, me, id("dye"), 2); m.open("character");
    expect(q("[data-role=dye-status]")!.textContent).toContain("2 dye");
    expect(qa("[data-key^=dye-0-]").every((b) => !b.hasAttribute("disabled"))).toBe(true);
    // worn top row uses the clothing palette (3 swatches, kind 1)
    expect(qa("[data-key^=dye-1-]").length).toBe(3);
    // clicking a hair swatch sends the dye intent (kind 0, hair slot, hair palette, index 2)
    q("[data-key=dye-0-0-2]")!.click();
    expect((sent[0] as { cmd: { name: string }; args: Record<string, number> }).cmd.name).toBe("gameplay.dye");
    expect((sent[0] as { args: Record<string, number> }).args).toEqual({ kind: 0, slot: 0, palette: 0, index: 2 });
  });
  test("Build panel shows all 16 clan tints and gates Paint-nearest on brush + dye", () => {
    const { w, me, id } = setup();
    const m = menus(w, me, (t) => (t >= 1 && t <= 16 ? 0x112233 + t : undefined));
    // a paintable rug next to the player, so "Paint nearest" has a target
    const d = G.gameplayDefs(w);
    const sn = G.snapPlacement(w, { piece: d.pieceId("rug"), x: 1, y: 0, level: 0, rot: 0, tier: 1, variant: 0 });
    if (typeof sn === "number") throw new Error(`snap rug ${sn}`);
    G.placePiece(w, me, sn, { pay: false });
    m.open("build");
    // select a tiered piece (wall) — the tint row must show for tiered pieces too, not just flagged paintable ones
    const wall = [...d.pieces.values()].find((x) => (x as { key?: string }).key === "wall")!;
    document.querySelector<HTMLElement>(`[data-key=piece-${wall.id}]`)!.click();
    const tints = qa("[data-key^=tint-]").map((b) => b.dataset["key"]);
    expect(tints).toContain("tint-0"); expect(tints).toContain("tint-16"); expect(tints).not.toContain("tint-17");
    expect(tints.length).toBe(17); // Clan/none + 16 palettes
    // no brush/dye: pick a tint first (paint 0 = free clear), then Paint nearest is disabled with a hint
    q("[data-key=tint-3]")!.click();
    const paint = q("[data-key=paint-apply]")!;
    expect(paint.hasAttribute("disabled")).toBe(true);
    expect(q("[data-role=build-paint-hint]")!.textContent).toContain("paint brush");
    // brush + dye: enabled
    putInSlot(w, me, 16, id("paint_brush")); G.addItem(w, me, id("dye"), 1); m.open("build");
    document.querySelector<HTMLElement>(`[data-key=piece-${wall.id}]`)!.click();
    q("[data-key=tint-3]")!.click();
    expect(q("[data-key=paint-apply]")!.hasAttribute("disabled")).toBe(false);
  });
});
