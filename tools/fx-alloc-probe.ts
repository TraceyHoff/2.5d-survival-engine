/** ADR-214: sampled-heap probe of the VFX hot path (director + effects + pool) after tier-up. Run: node_modules/.bin/tsx tools/fx-alloc-probe.ts */
import { Session } from "node:inspector/promises";
import { World } from "../packages/core/src/index.js";
import { applyDamage, defaultDefs, installGameplay, spawnZombie } from "../packages/gameplay/src/index.js";
import { Fx } from "../apps/client/src/fx/effects.js";
import { FxDirector, type FxFrame } from "../apps/client/src/fx/director.js";
const w = new World({ seed: 3, maxEntities: 2048 }); installGameplay(w, { defs: defaultDefs() } as never);
const zs = Array.from({ length: 60 }, (_, i) => spawnZombie(w, "zombie_walker", (i % 10) * 2, ((i / 10) | 0) * 2));
const fx = new Fx(2048, 1400), d = new FxDirector(fx);
const evs = [{ key: "footstep.grass", pos: { x: 1, y: 1 } }, { key: "melee.swing", pos: { x: 2, y: 2 } }];
const f: FxFrame = { world: w, local: undefined, snap: undefined, events: evs, dt: 1 / 60, daylight: 0.2, sunElev: 5, indoors: false, ground: () => 0, tile: () => 3,
  view: { x0: -20, y0: -20, x1: 40, y1: 40 }, weather: { kind: 2, intensity: 1, windDir: 1, windSpeed: 4 }, ambient: true };
const frameFx = (i: number): void => { if (i % 6 === 0) for (let k = 0; k < 4; k++) fx.impact(k, k, 0, 0, "blood", 1, true); d.step(f); fx.pool.update(fx.step(1 / 60)); };
const mode = process.argv[2] ?? "fx";
for (let i = 0; i < 20000; i++) frameFx(i); // warm up / tier up
const s = new Session(); s.connect(); await s.post("HeapProfiler.enable");
await s.post("HeapProfiler.startSampling", { samplingInterval: 64, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true } as never);
const N = 20000; for (let i = 0; i < N; i++) frameFx(i);
const { profile } = (await s.post("HeapProfiler.stopSampling")) as { profile: { head: Node } };
interface Node { callFrame: { functionName: string; url: string; lineNumber: number }; selfSize: number; children: Node[] }
const by = new Map<string, number>(); let tot = 0;
const walk = (n: Node, st: string[]): void => { const s2 = [...st, `${n.callFrame.functionName || "(anon)"}@${n.callFrame.url.replace(/^.*\/src\//, "")}:${n.callFrame.lineNumber + 1}`];
  if (n.selfSize) { const k = [...s2].reverse().find((x) => x.includes("fx/")); if (k) { tot += n.selfSize; by.set(k, (by.get(k) ?? 0) + n.selfSize); } } for (const c of n.children) walk(c, s2); };
walk(profile.head, []);
console.log(JSON.stringify({ mode, frames: N, fxBytes: tot, perFrame: tot / N, active: fx.pool.count, spawned: fx.pool.stats.spawned, top: [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10) }));
