import { describe, expect, it } from "vitest";
import { liftFaceOverHair } from "./layers";
import { FACE_LAYER, FACE_SLOTS, OUTLINE_ONLY } from "../sprites";

const L = (...s: string[]) => s.map((slot) => ({ slot }));
describe("face readability", () => {
  it("lifts face/eyes above hair on front facings, keeps hat/accessory on top", () => {
    const out = liftFaceOverHair(L("body", "top", "face", "eyes", "hair", "accessory", "hat"), Math.PI / 2);
    expect(out.map((l) => l.slot)).toEqual(["body", "top", "hair", "face", "eyes", "accessory", "hat"]);
  });
  it("keeps authored order on back facings and without hair", () => {
    const back = L("body", "face", "eyes", "hair");
    expect(liftFaceOverHair(back, -Math.PI / 2)).toBe(back);
    const bald = L("body", "face", "eyes", "hat");
    expect(liftFaceOverHair(bald, 0)).toBe(bald);
  });
  it("FACE_LAYER flag is a free bit", () => {
    expect(FACE_LAYER & OUTLINE_ONLY).toBe(0);
    expect(FACE_LAYER & 255).toBe(0);
    expect(FACE_SLOTS).toEqual(["face", "eyes"]);
  });
});
