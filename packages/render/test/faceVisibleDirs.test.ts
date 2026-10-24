import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FACE_VISIBLE_DIRS, liftFaceOverHair } from "../src/character/layers.js";

const man = JSON.parse(readFileSync(fileURLToPath(new URL("../../assets/pack/customization/manifest.customization.json", import.meta.url)), "utf8")) as {
  sprites: { key: string; animations: Record<string, { directions: number; dirFrames?: { rect?: { w: number; h: number } }[] }> }[];
};
const L = (...s: string[]) => s.map((slot) => ({ slot }));

describe("face over hair facings (hair must not cover eyes on a facing that shows the face)", () => {
  it("FACE_VISIBLE_DIRS matches the facings where Art's face/eyes frames have pixels", () => {
    const seen = new Array<boolean>(8).fill(false); let n = 0;
    for (const s of man.sprites) {
      if (!/^cz_(face|eyes)_/.test(s.key)) continue;
      for (const a of Object.values(s.animations)) {
        if (a.directions !== 8 || !a.dirFrames) continue;
        a.dirFrames.forEach((d, i) => { if (d.rect && d.rect.w * d.rect.h > 1) { seen[i % 8] = true; n++; } });
      }
    }
    expect(n).toBeGreaterThan(0);
    expect(seen).toEqual([...FACE_VISIBLE_DIRS]);
  });
  it("lifts face/eyes over hair on both profiles, not on back facings", () => {
    const list = L("body", "face", "eyes", "hair");
    for (const d of [0, 1, 2, 3, 7]) expect(liftFaceOverHair(list, (d * Math.PI) / 4).map((l) => l.slot)).toEqual(["body", "hair", "face", "eyes"]);
    for (const d of [4, 5, 6]) expect(liftFaceOverHair(list, (d * Math.PI) / 4)).toBe(list);
  });
});
