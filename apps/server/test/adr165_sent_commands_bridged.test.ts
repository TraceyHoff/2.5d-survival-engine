import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import * as G from "@engine/gameplay";
import { GAMEPLAY_NET_COMMANDS } from "../src/protocol.js";

const root = join(__dirname, "../../..");
const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((f) => f.isDirectory() ? files(join(dir, f.name)) : f.name.endsWith(".ts") ? [join(dir, f.name)] : []);

describe("ADR-165: every command the client UI sends is bridged", () => {
  it("menu intents and sendIntent({ cmd }) only use bridged commands", () => {
    const src = [...files(join(root, "packages/gameplay/src/ui")), ...files(join(root, "apps/client/src"))].map((f) => readFileSync(f, "utf8")).join("\n");
    const names = new Set([...src.matchAll(/(?:intent\(|cmd: )(\w+Cmd)\b/g)].map((m) => m[1]!));
    const bridged = new Set(GAMEPLAY_NET_COMMANDS.map((x) => x.core));
    const missing = [...names].filter((n) => { const d = (G as Record<string, unknown>)[n]; return d !== undefined && typeof d === "object" && "schema" in (d as object) && !bridged.has(d as never); });
    expect(names.size).toBeGreaterThan(20);
    expect(missing).toEqual([]);
  });
  it("Gather and ToggleFire map target as an entity", () => {
    for (const c of [G.GatherCmd, G.ToggleFireCmd]) expect(GAMEPLAY_NET_COMMANDS.find((x) => x.core === c)!.net.entityFields).toEqual(["target"]);
  });
});
