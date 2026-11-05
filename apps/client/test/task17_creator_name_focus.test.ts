// @vitest-environment jsdom
// Task 17, Problem C: on phones the virtual keyboard often fails to appear for
// character name entry. The creator opens asynchronously (after art/catalog
// loads), so its focus() on open runs outside any tap gesture and mobile
// browsers will not open the keyboard for it. The fix: the Name label is
// associated with the input (htmlFor/id) and tapping it focuses the input
// inside the tap handler — a real gesture — which summons the keyboard.
// A true mobile-keyboard test is not feasible in this harness (jsdom has no
// virtual keyboard); these tests pin the focus path the keyboard depends on.
import { describe, expect, it } from "vitest";
import type { CosmeticCatalogLike, WearableDef } from "@engine/core";
import { showCharacterCreator } from "../src/character-creator.js";

const W = (id: number, key: string, slot: WearableDef["slot"]): WearableDef =>
  ({ id, key, slot, bodies: { male: { sprite: 1, anim: "idle" }, female: { sprite: 1, anim: "idle" } }, hidesSlots: [], hatHair: false, unlockTags: [], layer: 0, z: 0, tintChannels: 1 }) as unknown as WearableDef;
const C = (n: number) => Array.from({ length: n }, (_, i) => ({ index: i, key: `c${i}`, color: 0x102030 * (i + 1) }));
const cat: CosmeticCatalogLike = { wearable: (id) => [W(1, "hair_short", "hair"), W(4, "top_tee", "top"), W(6, "bottom_jeans", "bottom"), W(7, "shoes_boots", "shoes"), W(8, "eyes_round", "eyes")].find((p) => p.id === id), bodySprite: () => ({ sprite: 1, anim: "idle" }), skinTones: C(6), hairColors: C(5), clothingColors: C(8), defaults: { top: 4, bottom: 6, shoes: 7, eyes: 8 } };

const open = () => {
  document.body.innerHTML = "";
  return showCharacterCreator({ root: document.body, catalog: cat, pads: () => [] });
};
const close = async (p: Promise<unknown>) => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); await p; };

describe("Task 17: creator name field summons the phone keyboard", () => {
  it("the Name label is associated with the name input", async () => {
    const p = open();
    const inp = document.querySelector<HTMLInputElement>("[data-role=creator-name]")!;
    const label = Array.from(document.querySelectorAll("label")).find((l) => l.textContent === "Name")!;
    expect(inp.id).not.toBe("");
    expect(label.htmlFor).toBe(inp.id);
    expect(inp.getAttribute("enterkeyhint")).toBe("done"); // mobile keyboards show a Done key
    await close(p);
  });
  it("tapping the label focuses the name input inside the tap gesture", async () => {
    const p = open();
    const inp = document.querySelector<HTMLInputElement>("[data-role=creator-name]")!;
    const label = Array.from(document.querySelectorAll("label")).find((l) => l.textContent === "Name")!;
    (document.activeElement as HTMLElement | null)?.blur?.();
    expect(document.activeElement).not.toBe(inp);
    label.click(); // a tap: the handler focuses the input synchronously, in-gesture
    expect(document.activeElement).toBe(inp);
    await close(p);
  });
  it("opening the creator still focuses the name field for first-time creators", async () => {
    const p = open();
    expect(document.activeElement).toBe(document.querySelector("[data-role=creator-name]"));
    await close(p);
  });
});
