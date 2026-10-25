// @vitest-environment jsdom
// Wardrobe panel (in-game "character"): skin keeps the body type, eyes use the curated eye list, full palettes, and a
// secondary (G mask) row for tintChannels-2 pieces. Regression for "eye / skin colour picks don't apply".
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, test } from "vitest";
import { Appearance, installPermissions, Membership, PlayerId, setAppearance, slotIndex, World, type CosmeticCatalogLike, type WearableDef } from "@engine/core";
import * as G from "@engine/gameplay";
import { GameMenus } from "../src/game-menus.js";
import { colorChoices } from "../src/character-creator.js";
import { readManifestJson } from "@engine/assets/read-manifest";

const W = (id: number, key: string, slot: WearableDef["slot"], tc = 2): WearableDef =>
  ({ id, key, slot, bodies: { male: { sprite: 1, anim: "idle" }, female: { sprite: 1, anim: "idle" } }, hidesSlots: [], hatHair: false, unlockTags: [], layer: 0, z: 0, tintChannels: tc }) as unknown as WearableDef;
const parts = [W(1, "hair_long", "hair"), W(4, "top_tee", "top", 1), W(8, "eyes_round", "eyes")];
const manifest = readManifestJson("packages/assets/pack/customization/manifest.customization.json") as Record<string, { key: string; color: string }[]>;
const pal = (k: string) => manifest[k]!.map((c, index) => ({ index, key: c.key, color: parseInt(c.color.slice(1), 16) }));
const cat = { wearable: (id: number) => parts.find((p) => p.id === id), bodySprite: () => ({ sprite: 1, anim: "idle" }), skinTones: pal("skinTones"), hairColors: pal("hairColors"), clothingColors: pal("clothingColors"), defaults: {} } as unknown as CosmeticCatalogLike;

function setup() {
  const w = new World({ seed: 1, maxEntities: 1 << 12 }); G.installGameplay(w, {}); installPermissions(w); if (!w.isRegistered(Appearance)) w.register(Appearance);
  const names = G.playerNames(w); const me = G.spawnPlayer(w, { x: 0, y: 0, maxWeight: 0, clientId: 7 });
  w.add(me, PlayerId, { id: 7 }).add(me, Membership, { partyId: 0, clanId: 0 }); names.set(7, "Ada");
  const p = [1, 0, 0, 4, 0, 0, 0, 8], pr = [2, 0, 0, 3, 0, 0, 0, 16], se = [5, 0, 0, 0, 0, 0, 0, 1];
  setAppearance(w, me, { bodyType: 1, skinTone: 2, parts: p, primary: pr, secondary: se });
  const sent: G.MenuIntent[] = [];
  const menus = new GameMenus({ root: document.getElementById("game-root")!, onQuit: () => {}, pollGamepads: false, gameplay: { ctx: () => ({ world: w, player: me, names, catalog: cat }), send: (i) => { sent.push(i); return true; } } });
  return { sent, menus };
}
const q = (sel: string): HTMLElement => { const e = document.querySelector<HTMLElement>(sel); if (!e) throw new Error(`missing ${sel}`); return e; };
const all = (sel: string) => Array.from(document.querySelectorAll<HTMLElement>(sel));
beforeEach(() => { document.body.innerHTML = `<div id="game-root"><canvas id="game"></canvas></div>`; localStorage.clear(); (globalThis as { matchMedia?: unknown }).matchMedia = () => ({ matches: false }); });

describe("wardrobe colours", () => {
  test("skin: every tone offered, and a pick keeps the female body + the rest of the look", () => {
    const { sent, menus } = setup(); menus.open("character");
    expect(all("button[data-key^=skin-]").length).toBe(cat.skinTones.length);
    expect(q("[data-key=skin-2]").getAttribute("aria-pressed")).toBe("true");
    q(`[data-key=skin-${cat.skinTones.length - 1}]`).click();
    expect(sent.at(-1)).toMatchObject({ cmd: G.SetAppearanceCmd, args: { bodyType: 1, skinTone: cat.skinTones.length - 1, parts: [1, 0, 0, 4, 0, 0, 0, 8, 0], primary: [2, 0, 0, 3, 0, 0, 0, 16, 0], secondary: [5, 0, 0, 0, 0, 0, 0, 1, 0] } });
    menus.destroy();
  });
  test("eyes: curated eye colours + a secondary row; picks keep the other channel", () => {
    const { sent, menus } = setup(); menus.open("character"); q(`[data-key=wslot-${slotIndex("eyes")}]`).click();
    const keys = all("button[data-key^=color-]").map((b) => Number(b.dataset["key"]!.slice(6)));
    expect(keys).toEqual(colorChoices(cat, "eyes"));
    const pick = keys.find((k) => k !== 16)!; q(`[data-key=color-${pick}]`).click();
    expect(sent.at(-1)).toMatchObject({ cmd: G.EquipCosmeticCmd, args: { slot: slotIndex("eyes"), wearable: 8, primary: pick, secondary: 1 } });
    expect(all("button[data-key^=color2-]").length).toBe(cat.clothingColors.length);
    q("[data-key=color2-12]").click();
    expect(sent.at(-1)).toMatchObject({ cmd: G.EquipCosmeticCmd, args: { slot: slotIndex("eyes"), wearable: 8, primary: 16, secondary: 12 } });
    menus.destroy();
  });
  test("hair: full hair palette + secondary row; 1-channel top has no secondary row", () => {
    const { sent, menus } = setup(); menus.open("character"); q(`[data-key=wslot-${slotIndex("hair")}]`).click();
    expect(all("button[data-key^=color-]").length).toBe(cat.hairColors.length);
    q("[data-key=color2-3]").click(); expect(sent.at(-1)).toMatchObject({ args: { slot: 0, wearable: 1, primary: 2, secondary: 3 } });
    q(`[data-key=wslot-${slotIndex("top")}]`).click(); expect(all("button[data-key^=color2-]").length).toBe(0);
    expect(all("button[data-key^=color-]").length).toBe(cat.clothingColors.length);
    menus.destroy();
  });
});
