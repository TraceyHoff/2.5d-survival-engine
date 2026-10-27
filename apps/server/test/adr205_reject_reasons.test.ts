// ADR-205: every inventory-op reject reason is a known wire reason (specific client text instead of the generic fallback).
import { describe, it, expect } from "vitest";
import { INVENTORY_OP_REJECT_REASONS } from "@engine/gameplay";
import { COMMAND_REJECT_REASONS, rejectReasonCode } from "../src/protocol.js";

describe("ADR-205 inventory reject reasons", () => {
  it("each reason the ops can return maps to its own non-zero code", () => {
    for (const r of ["bad_holder", "no_container", "bad_slot", "bad_count", "empty_slot", "no_space", "same_slot", "too_heavy", "equipped"]) {
      const c = rejectReasonCode(r); expect(c, r).toBeGreaterThan(0); expect(COMMAND_REJECT_REASONS[c - 1]).toBe(r);
    }
    for (const r of INVENTORY_OP_REJECT_REASONS) expect(rejectReasonCode(r)).toBeGreaterThan(0);
  });
});
