// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { FEMALE_FIRST_NAMES, firstNamesFor, MALE_FIRST_NAMES, randomName, SURNAMES } from "../src/random-names.js";
import { NAME_MAX, showCharacterCreator } from "../src/character-creator.js";
import type { CosmeticCatalogLike, WearableDef } from "@engine/core";

const NAME_RE = /^[A-Za-z]+ [A-Za-z]+$/;

describe("Task 27: random name generator", () => {
  it("lists are 48/48/48, disjoint first-name lists, plain ASCII, every combination fits NAME_MAX", () => {
    expect(MALE_FIRST_NAMES).toHaveLength(48);
    expect(FEMALE_FIRST_NAMES).toHaveLength(48);
    expect(SURNAMES).toHaveLength(48);
    expect(new Set(MALE_FIRST_NAMES).size).toBe(48);
    expect(new Set(FEMALE_FIRST_NAMES).size).toBe(48);
    expect(new Set(SURNAMES).size).toBe(48);
    expect(MALE_FIRST_NAMES.filter((n) => FEMALE_FIRST_NAMES.includes(n))).toEqual([]);
    for (const n of [...MALE_FIRST_NAMES, ...FEMALE_FIRST_NAMES, ...SURNAMES]) {
      expect(n).toMatch(/^[A-Za-z]+$/);
      expect(n.length).toBeLessThanOrEqual(9);
    }
    for (const f of [...MALE_FIRST_NAMES, ...FEMALE_FIRST_NAMES]) for (const s of SURNAMES) {
      expect(`${f} ${s}`).toMatch(NAME_RE);
      expect(`${f} ${s}`.length).toBeLessThanOrEqual(NAME_MAX);
    }
  });

  it("randomName picks from the right sex list for a body key or index", () => {
    expect(randomName("male", () => 0)).toBe("Aaron Adams");
    expect(randomName("female", () => 0)).toBe("Ada Adams");
    expect(randomName(0, () => 0.999)).toBe("Dominic James");
    expect(randomName(1, () => 0.999)).toBe("Catherine James");
    expect(randomName(5, () => 0)).toBe("Aaron Adams"); // unknown body index reads as male
    expect(firstNamesFor("female")).toBe(FEMALE_FIRST_NAMES);
    expect(firstNamesFor(0)).toBe(MALE_FIRST_NAMES);
    for (let i = 0; i < 200; i++) {
      const m = randomName("male"); const [f, s] = m.split(" ");
      expect(MALE_FIRST_NAMES).toContain(f); expect(SURNAMES).toContain(s); expect(m).toMatch(NAME_RE);
      const w = randomName("female"); const [f2, s2] = w.split(" ");
      expect(FEMALE_FIRST_NAMES).toContain(f2); expect(SURNAMES).toContain(s2); expect(w).toMatch(NAME_RE);
    }
  });

  it("avoid re-rolls once when the first pick repeats the current name", () => {
    const seq = [0, 0, 0.5, 0.5]; let i = 0;
    const rnd = (): number => seq[i++ % seq.length]!;
    expect(randomName("male", rnd, "Aaron Adams")).toBe("Chris Cruz");
    expect(randomName("male", () => 0)).toBe("Aaron Adams"); // no avoid: repeats are fine
  });
});

describe("Task 27: creator Roll button", () => {
  it("fills the Name input from the current body type's list; switching Body switches the list", async () => {
    const W = (id: number, key: string, slot: WearableDef["slot"]): WearableDef => ({ id, key, slot, bodies: { male: { sprite: 1, anim: "idle" }, female: { sprite: 1, anim: "idle" } }, hidesSlots: [], hatHair: false, unlockTags: [], layer: 0, z: 0, tintChannels: 1 }) as unknown as WearableDef;
    const parts = [W(1, "hair_short", "hair"), W(8, "eyes_round", "eyes")];
    const C = (n: number) => Array.from({ length: n }, (_, i) => ({ index: i, key: `c${i}`, color: 0x102030 * (i + 1) }));
    const cat: CosmeticCatalogLike = { wearable: (id) => parts.find((p) => p.id === id), bodySprite: () => ({ sprite: 1, anim: "idle" }), skinTones: C(6), hairColors: C(5), clothingColors: C(8), defaults: { eyes: 8 } };
    const root = document.createElement("div"); document.body.append(root);
    const p = showCharacterCreator({ root, catalog: cat, pads: () => [] });
    const tick = () => new Promise((r) => setTimeout(r, 0));
    await tick(); await tick();
    const nameIn = root.querySelector<HTMLInputElement>("#creator-name-input")!;
    const roll = root.querySelector<HTMLButtonElement>("[data-action=roll-name]")!;
    expect(roll).toBeTruthy(); expect(roll.getAttribute("aria-label")).toBe("Roll a random name");
    expect(nameIn.value).toBe("");
    // The starter body is a random roll, so read the label instead of assuming male.
    const listFor = (): readonly string[] => (root.querySelector("[data-role=creator-body]")!.textContent === "Female" ? FEMALE_FIRST_NAMES : MALE_FIRST_NAMES);
    roll.click();
    expect(nameIn.value).toMatch(NAME_RE);
    let [first, last] = nameIn.value.split(" ");
    expect(listFor()).toContain(first); expect(SURNAMES).toContain(last);
    // Switch Body once, then roll again: the other list.
    const before = root.querySelector("[data-role=creator-body]")!.textContent;
    root.querySelector<HTMLButtonElement>("[data-action=next-body]")!.click();
    const after = root.querySelector("[data-role=creator-body]")!.textContent;
    expect(after).not.toBe(before);
    roll.click();
    expect(nameIn.value).toMatch(NAME_RE);
    [first, last] = nameIn.value.split(" ");
    expect(listFor()).toContain(first); expect(SURNAMES).toContain(last);
    // Rolling does not blank the name-required message path: Enter world with a rolled name works.
    root.querySelector<HTMLButtonElement>("[data-action=creator-done]")!.click();
    const done = await p;
    expect(done?.name).toBe(nameIn.value);
    root.remove();
  });
});
