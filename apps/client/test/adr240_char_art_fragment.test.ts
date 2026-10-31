import { describe, expect, it } from "vitest";
import { CHAR_ART_V2_FRAGMENT, MANIFEST_INDEX, withCharArtFragment } from "../src/manifest-index.js";

describe("ADR-240: the v2 sample fragment is fetched only with charArt", () => {
  it("v1 (default) keeps the index as is; v2s / v2s-all append the sample once", () => {
    expect(withCharArtFragment(MANIFEST_INDEX, "v1")).toBe(MANIFEST_INDEX);
    const on = withCharArtFragment(MANIFEST_INDEX, "v2s");
    expect(on.at(-1)).toBe(CHAR_ART_V2_FRAGMENT); expect(on.length).toBe(MANIFEST_INDEX.length + 1);
    expect(withCharArtFragment(on, "v2s-all")).toBe(on);
    expect(CHAR_ART_V2_FRAGMENT.optional).toBe(true);
  });
});
