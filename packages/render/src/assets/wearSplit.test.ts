import { describe, expect, it } from "vitest";
import { WEAR_SMALL_PX, WEAR_SPLIT_MIN } from "./atlasManager";

const al16 = (n: number) => Math.ceil(n / 16) * 16;
const perAxis = (slot: number, S: number) => Math.floor((S - slot) / al16(slot + 4)) + 1;

describe("wear pool split", () => {
  it("small wear slots pack 3x3 per 2048 layer, large ones 2x2", () => {
    expect(perAxis(WEAR_SMALL_PX, 2048) ** 2).toBe(9);
    expect(perAxis(1016, 2048) ** 2).toBe(4);
    expect(WEAR_SPLIT_MIN).toBeGreaterThan(0);
  });
});
