import { describe, expect, test } from "vitest";
import { chatLine, chatSender, UNKNOWN_SURVIVOR } from "../src/chat-line.js";

describe("QA2 chat sender names", () => {
  test("unknown / old senders read 'Unknown survivor', never '#3'", () => {
    const names = new Map([[5, "Ana"]]);
    expect(chatSender(3, (id) => names.get(id))).toBe(UNKNOWN_SURVIVOR);
    expect(chatSender(5, (id) => names.get(id))).toBe("Ana");
    expect(chatSender(0, (id) => names.get(id))).toBe("");
    expect(chatLine(1, chatSender(3, () => undefined), "hi")).toBe("[Local] Unknown survivor: hi");
    expect(chatLine(6, "", "Server restarting")).toBe("[System] Server restarting");
    expect(chatLine(1, chatSender(3, () => undefined), "hi")).not.toMatch(/#\d/);
  });
});
