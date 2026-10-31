import { describe, it, expect } from "vitest";
import { Appearance, SLOT_COUNT, WEARABLE_SLOTS, defineComponent, schemaHash, slotIndex, type ComponentDef, type Schema } from "@engine/core";
import { decodePlayerInto, encodePlayer, MemoryWorldStore } from "../src/index.js";
import { oldSchemaOf } from "../src/migrate.js";
import { makeWorld } from "./helpers.js";

/** ADR-137: Appearance before the "hands" slot (8-wide arrays), with and without version. */
const legacy = (version: boolean): Schema => ({
  bodyType: "u8", skinTone: "u8", ...(version ? { version: "u16" } : {}),
  parts: { type: "u16", length: 8 }, primary: { type: "u8", length: 8 }, secondary: { type: "u8", length: 8 },
}) as Schema;

describe("Appearance 8 -> 9 slot (hands) persist migration (ADR-137)", () => {
  it("hands is appended (old slot indices unchanged)", () => {
    expect(WEARABLE_SLOTS.slice(0, 8)).toEqual(["hair", "hat", "accessory", "top", "bottom", "shoes", "face", "eyes"]);
    expect(slotIndex("hands")).toBe(8); expect(SLOT_COUNT).toBe(9);
    expect(schemaHash(oldSchemaOf(Appearance.schema, ["skinScheme"], { parts: 8, primary: 8, secondary: 8 }))).toBe(schemaHash(legacy(true)));
  });
  for (const v of [true, false]) it(`player records with an 8-slot Appearance${v ? "" : " (pre-version)"} restore padded`, () => {
    const Old = defineComponent("Appearance", legacy(v), { networked: true, persistent: true }) as ComponentDef;
    const a = makeWorld(new MemoryWorldStore(), { setup: (w) => w.register(Old) }).world; const p = a.create();
    a.add(p, Old, { bodyType: 1, skinTone: 3, parts: [1, 2, 3, 4, 5, 6, 7, 8], primary: [1, 1, 1, 1, 1, 1, 1, 2], secondary: [3, 3, 3, 3, 3, 3, 3, 4] } as never);
    const bytes = encodePlayer(a, p);
    const b = makeWorld(new MemoryWorldStore(), { setup: (w) => w.register(Appearance) }).world; const q = b.create();
    const r = decodePlayerInto(b, q, bytes); expect(r.migrated).toContain("Appearance");
    const got = b.get(q, Appearance)!;
    expect(got.bodyType).toBe(1); expect(got.skinTone).toBe(3); expect(got.skinScheme).toBe(0); // decode only: the remap is restorePlayer's (ADR-245)
    expect([...got.parts]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 0]); expect([...got.primary]).toEqual([1, 1, 1, 1, 1, 1, 1, 2, 0]); expect([...got.secondary]).toEqual([3, 3, 3, 3, 3, 3, 3, 4, 0]);
  });
});
