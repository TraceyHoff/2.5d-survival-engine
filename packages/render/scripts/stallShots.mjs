// Stall screenshots: serves dist/ (vite preview, /@art -> repo assets or $ART_DIR), opens stalls.html in headless Chromium
// (SwiftShader WebGL2) and writes shots/stalls_*.png.   Usage: pnpm build && node scripts/stallShots.mjs
import { spawn } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const shots = process.env.SHOTS_DIR ?? join(root, "shots"); mkdirSync(shots, { recursive: true });
const PORT = Number(process.env.PORT ?? 4797);
const chrome = process.env.CHROME ?? ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(existsSync);
const viteBin = join(dirname(createRequire(join(root, "package.json")).resolve("vite/package.json")), "bin", "vite.js");
const server = spawn(process.execPath, [viteBin, "preview", "--port", String(PORT), "--strictPort"], { cwd: root, stdio: ["ignore", "pipe", "inherit"] });
const stop = () => { try { server.kill("SIGTERM"); } catch {} };
process.on("exit", stop);
await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("preview timeout")), 20000); server.stdout.on("data", (d) => { if (String(d).includes(String(PORT))) { clearTimeout(t); res(); } }); });
const browser = await chromium.launch({ ...(chrome ? { executablePath: chrome } : {}), args: ["--use-angle=swiftshader", "--use-gl=angle", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = []; page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(m.text()); }); page.on("requestfailed", (r) => errors.push("reqfail " + r.url())); page.on("response", (r) => { if (r.status() >= 400) errors.push(r.status() + " " + r.url()); }); page.on("pageerror", (e) => errors.push(String(e)));
const SHOTS = {
  stalls_rotations: "mode=rotations&time=11&zoom=0.95",
  stalls_states: "mode=states&time=11&zoom=1.7",
  stalls_clan_tints: "mode=tints&time=11&zoom=1.2",
  stalls_lanterns_day: "mode=lanterns&time=12&zoom=1.6",
  stalls_lanterns_night: "mode=lanterns&time=22.5&zoom=1.6",
  stalls_sale_vfx: "mode=states&time=11&zoom=2.4&sale=1",
};
let failed = false;
for (const [name, query] of Object.entries(SHOTS)) {
  if (process.env.ONLY && !process.env.ONLY.split(",").includes(name)) continue;
  await page.goto(`http://localhost:${PORT}/stalls.html?${query}&shot=1`);
  await page.waitForFunction(() => window.__iso?.ready === true || window.__iso?.error, null, { timeout: 120000 });
  await page.waitForTimeout(name === "stalls_sale_vfx" ? 2300 : 1200);
  const info = await page.evaluate(() => window.__iso);
  if (info.error) { console.error(name, info.error); failed = true; continue; }
  await page.screenshot({ path: join(shots, `${name}.png`) });
  console.log(name, JSON.stringify({ font: info.font, fragments: info.fragments, collisions: info.collisions, issues: info.issues, stalls: info.stalls, glyphs: info.glyphs, draws: info.stats?.drawCalls, sprites: info.stats?.sprites }));
}
if (errors.length) console.log("PAGE MESSAGES:\n" + errors.join("\n"));
await browser.close(); stop(); process.exit(failed ? 1 : 0);
