// Customization-pack VRAM verification: headless Chromium (SwiftShader), real pack (packages/assets/pack/customization),
// ~N varied characters with and without ?gl=lowend + the creator preview. Logs atlas/VRAM stats, writes shots/cz_*.png
// and shots/cz_vram.json. Usage: pnpm build && node scripts/czShots.mjs   Env: N (default 160), TAG (json key, e.g. before)
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const shots = join(root, "shots"); mkdirSync(shots, { recursive: true });
const PORT = Number(process.env.PORT ?? 4793); const N = Number(process.env.N ?? 160); const TAG = process.env.TAG ?? "after";
const chrome = process.env.CHROME ?? ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(existsSync);
const viteBin = join(dirname(createRequire(join(root, "package.json")).resolve("vite/package.json")), "bin", "vite.js");
const server = spawn(process.execPath, [viteBin, "preview", "--port", String(PORT), "--strictPort"], { cwd: root, stdio: ["ignore", "pipe", "inherit"] });
const stop = () => { try { server.kill("SIGTERM"); } catch {} };
process.on("exit", stop);
await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("preview timeout")), 20000); server.stdout.on("data", (d) => { if (String(d).includes(String(PORT))) { clearTimeout(t); res(); } }); });
const browser = await chromium.launch({ ...(chrome ? { executablePath: chrome } : {}), args: ["--use-angle=swiftshader", "--use-gl=angle", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = []; page.on("pageerror", (e) => errors.push(String(e))); page.on("console", (m) => { if (m.type() === "error" || /\[render\]/.test(m.text())) console.log("  [console]", m.text().slice(0, 300)); });
const out = {};
const pick = (o) => ({ atlas: o.atlasStats, vram: o.vram ?? null, chars: o.chars, textureBudgetMB: o.capabilities?.textureBudgetMB, lowEnd: o.capabilities?.lowEnd });
for (const [name, extra] of [["cz_streaming", ""], ["cz_lowend", "&gl=lowend"]]) {
  await page.goto(`http://localhost:${PORT}/?time=10&weather=clear&chars=crowd&n=${N}&cam=chars&zombies=0&ui=0&zoom=1.6&shot=1${extra}`);
  await page.waitForFunction(() => window.__iso?.ready === true || window.__iso?.error, null, { timeout: 240000 });
  const err = await page.evaluate(() => window.__iso.error); if (err) { console.log(name, "ERROR", err); out[name] = { error: err }; continue; }
  await page.waitForTimeout(Number(process.env.SETTLE ?? 9000));
  await page.screenshot({ path: join(shots, `${name}.png`) });
  out[name] = pick(await page.evaluate(() => window.__iso)); console.log(name, JSON.stringify(out[name]));
}
await page.goto(`http://localhost:${PORT}/preview.html?seed=5&zoom=1.2${process.env.PV_LOWEND ? "&gl=lowend" : ""}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
await page.waitForTimeout(4000);
// page in on selection: change a few slots, then shoot
const select = await page.evaluate(async () => {
  const pv = window.__pv; const cat = pv.renderer.atlas.registry.cosmetics; const before = pv.renderer.vram.pageIns; const t0 = performance.now();
  for (const [slot, i] of [["hat", 1], ["top", 3], ["bottom", 4]]) {
    const a = pv.getAppearance(); const parts = [...a.parts]; const opts = cat.bySlot(slot).map((w) => w.id).filter((id) => id !== parts[i]);
    parts[i] = opts[Math.floor(opts.length / 2)] ?? parts[i]; await pv.setAppearance({ ...a, parts });
  }
  return { pageInsOnSelect: pv.renderer.vram.pageIns - before, ms: Math.round(performance.now() - t0) };
});
await page.waitForTimeout(3000);
await page.screenshot({ path: join(shots, "cz_preview.png") });
out.cz_preview = await page.evaluate((select) => ({ select, atlas: window.__pv.renderer.atlas.stats, vram: window.__pv.renderer.vram ?? null, chars: window.__pv.renderer.characterStats }), select);
console.log("cz_preview", JSON.stringify(out.cz_preview));
const f = join(shots, "cz_vram.json"); const prev = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : {};
prev[TAG] = { note: "SwiftShader headless Chromium, 1280x720, real customization pack", characters: N, ...out, errors };
writeFileSync(f, JSON.stringify(prev, null, 2));
if (errors.length) console.log("page errors:", errors);
await browser.close(); stop(); process.exit(0);
