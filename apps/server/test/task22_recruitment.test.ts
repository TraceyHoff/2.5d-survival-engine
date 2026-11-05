import { describe, it, expect } from "vitest";
import * as G from "@engine/gameplay";
import { GAMEPLAY_NET_COMMANDS } from "../src/protocol.js";
import { gameModeConfig } from "../src/game.js";
import { parseServerArgs } from "../src/main.js";

const bridged = new Set(GAMEPLAY_NET_COMMANDS.map((x) => x.core));

describe("Task 22: AI-human recruitment (server)", () => {
  it("worker commands are bridged with their entity fields", () => {
    for (const c of G.WORKER_COMMANDS) expect(bridged.has(c)).toBe(true);
    expect(GAMEPLAY_NET_COMMANDS.find((x) => x.core === G.HireWorkerCmd)!.net.entityFields).toEqual(["target"]);
    expect(GAMEPLAY_NET_COMMANDS.find((x) => x.core === G.SetWorkerJobCmd)!.net.entityFields).toEqual(["worker"]);
    expect(GAMEPLAY_NET_COMMANDS.find((x) => x.core === G.DismissWorkerCmd)!.net.entityFields).toEqual(["worker"]);
    // worker commands are the tail of the bridged list (append-only, wire indices stable)
    expect(GAMEPLAY_NET_COMMANDS.slice(-G.WORKER_COMMANDS.length).map((x) => x.core)).toEqual([...G.WORKER_COMMANDS]);
  });
  it("gameModeConfig: human bots in singleplayer, and in multiplayer only when AI humans are on", () => {
    expect(gameModeConfig("singleplayer", true, true).humanBots).toBe(true);
    expect(gameModeConfig("singleplayer", true, false).humanBots).toBe(true);
    expect(gameModeConfig("multiplayer", true, true).humanBots).toBe(true);
    expect(gameModeConfig("multiplayer", true, false).humanBots).toBe(false);
    expect(gameModeConfig("multiplayer", false, true).humanBots).toBe(false);
    expect(gameModeConfig("multiplayer").humanBots).toBe(true); // defaults: want bots, AI humans on
  });
  it("dedicated server: --ai-humans / --no-ai-humans and AI_HUMANS env", () => {
    expect(parseServerArgs([], {}).aiHumans).toBe(true);
    expect(parseServerArgs(["--no-ai-humans"], {}).aiHumans).toBe(false);
    expect(parseServerArgs(["--ai-humans"], { AI_HUMANS: "0" }).aiHumans).toBe(true);
    expect(parseServerArgs([], { AI_HUMANS: "0" }).aiHumans).toBe(false);
    expect(parseServerArgs([], { AI_HUMANS: "false" }).aiHumans).toBe(false);
  });
  it("worker reject reasons include ai_humans_off (hire gate reads WorldRules)", () => {
    // the hire gate itself is covered in packages/gameplay/test/task22_recruitment.test.ts (setWorldRules off -> AiHumansOff)
    expect(G.WORKER_REJECT_REASONS).toContain("ai_humans_off");
  });
});
