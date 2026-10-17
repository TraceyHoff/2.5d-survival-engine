import { describe, it, expect } from "vitest";
import { NullRenderer } from "../src/index.js";
describe("render stub", () => { it("NullRenderer counts frames", () => { const r = new NullRenderer(); r.draw(); expect(r.frames).toBe(1); }); });
