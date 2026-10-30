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
    const r = b.get(q, G.Progression)!; expect(r.level).toBe(9); expect(r.points).toBe(0); expect(r.tver).toBe(G.PROGRESSION_TVER); // ADR-221: tver 2 (legacy: unlock nodes granted)
    // ADR-221: legacy nodes kept; the free unlock nodes are OR'd on top (placed pieces/recipes keep working).
    nodes.forEach((x, i) => expect((r.nodes[i]! & (x >>> 0)) >>> 0).toBe(x >>> 0));
    for (const k of ["firecraft", "workbench_craft", "reinforcement"]) { const i = G.skillNodeIndex(k); expect((r.nodes[i >> 5]! >>> (i & 31)) & 1).toBe(1); }
    const t = G.treesOf(b, q)!; expect(t).toEqual(G.convertLegacyProgression(8, nodes));
    expect(t.reduce((s2, x) => s2 + x.points, 0)).toBeGreaterThanOrEqual(8);
  });
});
