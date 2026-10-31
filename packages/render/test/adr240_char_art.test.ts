import { describe, expect, it } from "vitest";
import { FIDELITY_ATLAS_RE } from "../src/assets/atlasManager.js";
import { CharArtMapper, parseCharArt, withCharArt, isV2BodyKey, isV2WearKey } from "../src/character/charArt.js";

const keys = ["body_male", "cz_top_tee_male", "cz_top_tee_male_sleeves", "cz_hair_bun_female_hathair", "cz_acc_backpack_female", "cz_eyes_round_male",
  "v2s_body_male", "v2s_cz_top_scrap_male", "v2s_cz_top_scrap_male_sleeves", "v2s_cz_hair_buzz_male_hathair", "v2s_cz_eyes_round_male"];
const ids = { key: (i: number) => keys[i], tryId: (k: string) => { const i = keys.indexOf(k); return i < 0 ? undefined : i; } };
const id = (k: string) => keys.indexOf(k);

describe("ADR-240 charArt", () => {
  it("defaults to v1; query beats stored; junk ignored", () => {
    expect(parseCharArt(null, null)).toBe("v1");
    expect(parseCharArt("v2s", "v1")).toBe("v2s");
    expect(parseCharArt("nope", "v2s-all")).toBe("v2s-all");
    expect(parseCharArt("probe", undefined)).toBe("v1");
  });
  it("maps twins first, then slot aliases for any v1 key (no _male dependency), else keeps v1", () => {
    const m = new CharArtMapper(ids);
    const out = m.map([{ sprite: id("body_male"), slot: "body" }, { sprite: id("cz_eyes_round_male"), slot: "eyes" }, { sprite: id("cz_top_tee_male_sleeves"), slot: "top" },
      { sprite: id("cz_hair_bun_female_hathair"), slot: "hair" }, { sprite: id("cz_acc_backpack_female"), slot: "acc" }]);
    expect(out.map((l) => keys[l.sprite])).toEqual(["v2s_body_male", "v2s_cz_eyes_round_male", "v2s_cz_top_scrap_male_sleeves", "v2s_cz_hair_buzz_male_hathair", "cz_acc_backpack_female"]);
    expect(m.stats).toEqual({ twin: 2, alias: 2, v1: 1 });
  });
  it("withCharArt is the identity for v1 or when the sample is missing", () => {
    const b = { resolve: () => [{ sprite: id("body_male"), slot: "body" }] } as never as Parameters<typeof withCharArt>[0];
    expect(withCharArt(b, "v1", ids)).toBe(b);
    expect(withCharArt(b, "v2s", { key: () => undefined, tryId: () => undefined })).toBe(b);
    const w = withCharArt(b, "v2s", ids); expect(keys[(w.resolve({} as never, 0, {}) as unknown as { sprite: number }[])[0]!.sprite]).toBe("v2s_body_male");
  });
  it("classifies v2 body/wear sprite keys for the character pools", () => {
    expect(isV2BodyKey("v2s_body_male")).toBe(true); expect(isV2BodyKey("body_male")).toBe(false);
    expect(isV2WearKey("v2s_cz_hat_scrap_male")).toBe(true); expect(isV2WearKey("cz_hat_cap_male")).toBe(false);
  });
  it("v2 character sheets get the ADR-237 x1 pin (lowmem/mobile budgets)", () => {
    for (const k of ["v2s_wr_body_male", "v2s_wr_cz_top_scrap_male", "v2_body_female"]) expect(FIDELITY_ATLAS_RE.test(k)).toBe(true);
    expect(FIDELITY_ATLAS_RE.test("v2x_tiles")).toBe(false);
  });
});
