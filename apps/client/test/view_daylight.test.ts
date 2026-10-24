import { describe, expect, it } from "vitest";
import { daylightOf } from "../src/view.js";

describe("view black-frame check daylight (Canvas2D has no lighting)", () => {
  it("does not throw without lighting", () => { expect(daylightOf({} as never)).toBe(0); expect(daylightOf({ lighting: undefined })).toBe(0); });
  it("reads WebGL2 lighting", () => { expect(daylightOf({ lighting: { daylight: 0.8 } })).toBe(0.8); });
});
