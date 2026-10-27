import { describe, it, expect } from "vitest";
import { defineComponent, type ComponentDef, type Schema } from "@engine/core";
import * as G from "@engine/gameplay";
import { decodePlayerInto, encodePlayer, MemoryWorldStore } from "../src/index.js";
import { makeWorld } from "./helpers.js";

/** ADR-209: a pre-per-tree Progression record (no tver/txp/tlevel/tpoints) loads and converts. */
describe("Progression per-tree persist migration (ADR-209)", () => {
  it("old player record restores zero-filled, then converts on the authority", () => {
    const s = { ...(G.Progression.schema as Record<string, unknown>) }; for (const f of ["tver", "txp", "tlevel", "tpoints"]) delete s[f];
    const Old = defineComponent("Progression", s as Schema, { networked: true, persistent: true }) as ComponentDef;
    const a = makeWorld(new MemoryWorldStore(), { setup: (w) => w.register(Old) }).world; const p = a.create();
    const fi = G.skillNodeIndex("forager"), bi = G.skillNodeIndex("brawler"); const nodes = new Array(G.SKILL_NODE_WORDS).fill(0);
    nodes[fi >> 5] |= 1 << (fi & 31); nodes[bi >> 5] |= 1 << (bi & 31);
    a.add(p, Old, { xp: 5, level: 9, points: 8, nodes: nodes.map((x) => x >>> 0) } as never);
    const bytes = encodePlayer(a, p);
    const b = makeWorld(new MemoryWorldStore(), { setup: (w) => G.installGameplay(w, {}) }).world; const q = b.create();
    expect(decodePlayerInto(b, q, bytes).migrated).toContain("Progression");
    expect(b.get(q, G.Progression)!.tver).toBe(0);
    expect(G.migrateProgression(b, q)).toBe(true);
    const r = b.get(q, G.Progression)!; expect(r.level).toBe(9); expect(r.points).toBe(0); expect(r.tver).toBe(1);
    expect([...r.nodes]).toEqual(nodes.map((x) => x >>> 0));
    const t = G.treesOf(b, q)!; expect(t).toEqual(G.convertLegacyProgression(8, nodes));
    expect(t.reduce((s2, x) => s2 + x.points, 0)).toBeGreaterThanOrEqual(8);
  });
});
