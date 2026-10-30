import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HEARTH_PIECES, pieceFireState } from "../src/fire-state.js";

const ROOT = join(__dirname, "../../..");
const pieces = (JSON.parse(readFileSync(join(ROOT, "packages/gameplay/data/pieces.json"), "utf8")) as { pieces: { key: string; fired?: boolean }[] }).pieces;

describe("ADR-218 piece fire state", () => {
  it("out = 0, hearth = 2, small light = 1", () => {
    expect(pieceFireState("campfire", false)).toBe(0);
    expect(pieceFireState("campfire", true)).toBe(2);
    expect(pieceFireState("furnace", true)).toBe(2);
    expect(pieceFireState("lantern", true)).toBe(1);
    expect(pieceFireState(undefined, true)).toBe(1);
  });
  it("every hearth key is a fired piece in the gameplay data", () => {
    const fired = new Set(pieces.filter((p) => p.fired).map((p) => p.key));
    for (const k of HEARTH_PIECES) expect(fired.has(k), k).toBe(true);
  });
  it("view feeds the renderer pieceLit / litPieces bindings; animated fires never go into static chunks", () => {
    const view = readFileSync(join(__dirname, "../src/view.ts"), "utf8");
    expect(view).toMatch(/pieceLit: \(e\) =>/); expect(view).toMatch(/litPieces: \(\) =>/);
    const spr = readFileSync(join(ROOT, "packages/render/src/sprites.ts"), "utf8");
    expect(spr).toMatch(/dynamic[^\n]*animated/);
  });
});
