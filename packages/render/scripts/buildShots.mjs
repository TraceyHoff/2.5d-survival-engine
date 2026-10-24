// Modular building shots + tier-streaming check in the real client (apps/client, ?offline=1).
// Injects a two-storey house (foundations, walls, corner walls, upper floor, triangle foundations, gable/chimney roof,
// tiers 1-4, damage stages) into the client's replicated world next to the local player, then:
//   build_modular_day.png (outside, noon), build_modular_inside.png (player inside: roof + upper floor cut away),
//   build_damage.png (damage stages 0-3 with the bld_crack overlay).
// Usage: PORT=5341 node scripts/buildShots.mjs [outDir]
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { startClientVite } from "./clientVite.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const client = resolve(root, "../../apps/client");
const out = process.argv[2] ?? join(root, "shots"); mkdirSync(out, { recursive: true });
const PORT = Number(process.env.PORT ?? 5341); if (PORT === 5199) throw new Error("port 5199 is reserved");
const vite = await startClientVite(PORT);
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/usr/bin/google-chrome", args: ["--use-angle=swiftshader", "--use-gl=angle", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }); const logs = [];
page.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`)); page.on("pageerror", (e) => logs.push(`pageerror: ${e}`));
await page.goto(`http://127.0.0.1:${PORT}/?offline=1&bots=0&hud=0&shot=1&time=12&weather=clear&player=bld${Date.now()}`);
await page.waitForFunction(() => window.__view?.ready === true, null, { timeout: 120000 }).catch((e) => { console.log(logs.slice(-30).join("\n")); throw e; });
await page.waitForTimeout(6000);
const report = { steps: [] };
// capture the replicated world + player from IsoView.render, inject the house
const t0 = await page.evaluate(async () => {
  const v = window.__view.iso; const cap = (window.__cap = {});
  const f = v.render.bind(v); v.render = (net, tiles, player, a) => { cap.net = net; cap.player = player; return f(net, tiles, player, a); };
  for (let i = 0; i < 1200 && (!cap.net || cap.player === undefined); i++) await new Promise((r) => setTimeout(r, 50));
  const urls = performance.getEntriesByType("resource").map((e) => e.name).filter((n) => /packages\/(core|gameplay)\/src\/index\.ts/.test(n));
  return { ok: !!cap.net, player: cap.player, urls, ents: cap.net?.entityCount };
}).catch((e) => ({ err: String(e) }));
report.steps.push({ capture: t0 });
if (!t0.ok || t0.player === undefined) { console.log(logs.slice(-25).join("\n")); throw new Error("no client world/player"); }
// in-page helpers: import the app's own core/gameplay module instances (same vite URLs) and spawn local BuildPiece entities.
await page.evaluate(async (urls) => {
  const core = await import(urls.find((u) => u.includes("/core/"))); const gp = await import(urls.find((u) => u.includes("/gameplay/")));
  const w = window.__cap.net, defs = gp.gameplayDefs(w); const H = (window.__bld = { ents: [] });
  H.player = () => { const t = w.get(window.__cap.player, core.Transform); return { x: t.x, y: t.y }; };
  H.put = (key, x, y, z, rot = 0, tier = 1, damageStage = 0, variant = 0) => {
    const e = w.create(); w.add(e, core.Transform, { x, y, z, facing: 0 });
    w.add(e, gp.BuildPiece, { type: defs.pieceId(key), rot, variant, tier, hp: 100, damageStage, paint: 0, tint: 0 }); H.ents.push(e); return e;
  };
  H.clear = () => { for (const e of H.ents) if (w.isAlive(e)) w.destroy(e); H.ents = []; };
  // a two-storey 3x3 house centred on tile (cx,cy): stone foundations, mixed-tier walls, corner walls, upper floor, gable roof + chimney
  H.house = (cx, cy) => {
    const tiers = [1, 2, 3, 4];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { H.put("foundation", cx + dx + 0.5, cy + dy + 0.5, 0, 0, 2); H.put("floor", cx + dx + 0.5, cy + dy + 0.5, 3, 0, 1); }
    for (let lv = 0; lv < 2; lv++) for (let i = -1; i <= 1; i++) {
      const z = lv * 3, t = tiers[(i + 1 + lv) % 4];
      H.put(i === 0 && lv === 0 ? "wall_doorway" : i === 0 ? "wall_window" : "wall", cx + i + 0.5, cy + 2, z, 0, t);
      H.put("wall", cx + i + 0.5, cy - 1, z, 0, tiers[(i + 2) % 4]);
      H.put("wall", cx - 1, cy + i + 0.5, z, 1, tiers[(i + 3) % 4]);
      H.put(i === 0 ? "wall_window" : "wall", cx + 2, cy + i + 0.5, z, 1, t);
    }
    for (const [x, y, r] of [[cx - 1, cy - 1, 0], [cx + 2, cy - 1, 1], [cx + 2, cy + 2, 2], [cx - 1, cy + 2, 3]]) H.put("wall_corner_outer", x, y, 6, r, 3);
    for (let dx = -1; dx <= 1; dx++) { H.put("roof_gable", cx + dx + 0.5, cy - 0.5, 6, 0, 1); H.put("roof_gable", cx + dx + 0.5, cy + 1.5, 6, 2, 1); H.put("roof_flat", cx + dx + 0.5, cy + 0.5, 6, 0, 2); }
    H.put("roof_chimney", cx + 1.5, cy + 0.5, 6, 0, 2);
    // triangle foundations stepping through 30-degree turns, and a tier strip
    for (let r = 0; r < 12; r++) H.put("foundation_triangle", cx + 3.5 + (r % 4) * 1.2, cy - 1 + Math.floor(r / 4) * 1.2, 0, r, 1 + (r % 4));
    for (let t = 1; t <= 4; t++) H.put("wall", cx - 3.5 + t, cy - 3, 0, 0, t);
  };
  H.damage = (cx, cy) => { for (let s = 0; s < 4; s++) for (let t = 1; t <= 2; t++) { H.put("foundation", cx - 2 + s + 0.5, cy + t * 2 - 2 + 0.5, 0, 0, t, s); H.put("wall", cx - 2 + s + 0.5, cy + t * 2 - 2, 0, 0, t, s); } };
  H.stats = () => ({ ...window.__view.iso.renderer?.buildingStats ?? window.__view.renderer?.buildingStats, held: (window.__view.iso.renderer ?? window.__view.renderer)?.buildingTiersHeld });
}, t0.urls);
const stats = () => page.evaluate(() => window.__bld.stats());
const P = await page.evaluate(() => window.__bld.player()); report.player = P;
const cx = Math.floor(P.x), cy = Math.floor(P.y);
// 1) day: house north of the player; sample streaming right after injection
await page.evaluate(([x, y]) => window.__bld.house(x, y), [cx, cy - 6]);
const samples = [];
for (let i = 0; i < 40; i++) { await page.waitForTimeout(i < 10 ? 100 : 500); samples.push({ t: i < 10 ? (i + 1) * 100 : 1000 + (i - 9) * 500, ...(await stats()) }); }
report.streaming = samples;
report.probe = await page.evaluate(() => {
  const iso = window.__view.iso, r = iso.renderer, at = r.atlas, vw = iso.view, bp = r.bindings?.buildPiece;
  if (!bp) return { bindings: false, stream: at.streamBuildingTiers };
  const st = vw.store(bp); const vis = st.data.visualId; const seen = {};
  for (let k = 0; k < st.size; k++) { const id = vis[k]; if (seen[id]) continue; const sp = iso.registry.sprites?.[id] ?? iso.registry.spriteList?.[id]; seen[id] = { name: sp?.key ?? sp?.name ?? sp?.id, cls: at.streamClass(id), page: at.pageKey(id), ready: at.pageReady(id, 0) }; }
  return { bindings: true, stream: at.streamBuildingTiers, n: st.size, seen: Object.values(seen).slice(0, 40) };
}).catch((e) => ({ err: String(e) }));
await page.screenshot({ path: join(out, "build_modular_day.png") }); report.day = await stats();
// 2) inside: rebuild around the player
await page.evaluate(([x, y]) => { window.__bld.clear(); window.__bld.house(x, y); }, [cx, cy]); await page.waitForTimeout(2500);
await page.screenshot({ path: join(out, "build_modular_inside.png") }); report.inside = await stats();
// 3) damage stages 0-3 (tier 1 row and tier 2 row)
await page.evaluate(([x, y]) => { window.__bld.clear(); window.__bld.damage(x, y); }, [cx, cy - 2]); await page.waitForTimeout(2500);
await page.screenshot({ path: join(out, "build_damage.png") }); report.damage = await stats();
report.errors = logs.filter((l) => /^(error|pageerror)/.test(l) && !/Failed to load resource/.test(l)).slice(-20);
await browser.close(); vite.kill("SIGTERM");
writeFileSync(join(out, "build_report.json"), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
