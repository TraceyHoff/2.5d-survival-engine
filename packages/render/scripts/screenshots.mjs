// Headless verification: serves dist/ with `vite preview`, opens it in Chromium (SwiftShader
// software WebGL2) and captures shots/*.png plus a software-rendered benchmark (shots/bench.json).
// Usage: pnpm build && pnpm shots      Env: CHROME=/path/to/chrome (default: system google-chrome)
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { chromium } from "playwright-core";
import { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const shots = join(root, "shots"); mkdirSync(shots, { recursive: true });
const PORT = Number(process.env.PORT ?? 4791);
const chrome = process.env.CHROME ?? ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(existsSync);

const viteBin = join(dirname(createRequire(join(root, "package.json")).resolve("vite/package.json")), "bin", "vite.js");
const server = spawn(process.execPath, [viteBin, "preview", "--port", String(PORT), "--strictPort"], { cwd: root, stdio: ["ignore", "pipe", "inherit"] });
const stop = () => { try { server.kill("SIGTERM"); } catch {} };
process.on("exit", stop); process.on("uncaughtException", (e) => { console.error(e); stop(); process.exit(1); });
await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error("preview server timeout")), 20000);
  server.on("exit", (c) => rej(new Error("preview server exited " + c)));
  server.stdout.on("data", (d) => { if (String(d).includes(String(PORT))) { clearTimeout(t); res(); } });
});

const browser = await chromium.launch({
  ...(chrome ? { executablePath: chrome } : {}),
  args: ["--use-angle=swiftshader", "--use-gl=angle", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));

async function shot(name, query, settleMs = 2500) {
  await page.goto(`http://localhost:${PORT}/?${query}`);
  await page.waitForFunction(() => window.__iso?.ready === true, null, { timeout: 30000 });
  await page.waitForTimeout(settleMs);
  await page.screenshot({ path: join(shots, `${name}.png`) });
  const info = await page.evaluate(() => window.__iso);
  console.log(name, JSON.stringify({ fps: info.fps?.toFixed(1), stats: info.stats, total: info.totalSprites }));
  return info;
}

const results = {};
results.day = await shot("day", "time=10&weather=clear&shot=1");
results.night = await shot("night", "time=22&weather=clear&shot=1");
results.rain = await shot("rain", "time=15&weather=rain&shot=1");
results.dusk = await shot("dusk", "time=18.6&weather=fog&intensity=0.6&shot=1");
results.snow = await shot("snow", "time=12&weather=snow&shot=1");
results.zoomout = await shot("zoomout", "time=11&weather=clear&zoom=0.35&shot=1");

// Benchmark: zoomed out so thousands of sprites are visible. SOFTWARE (SwiftShader) numbers.
await page.goto(`http://localhost:${PORT}/?time=21&weather=rain&zoom=0.3&bench=6`);
await page.waitForFunction(() => window.__iso?.bench, null, { timeout: 60000 });
const bench = await page.evaluate(() => window.__iso);
results.benchZoomedOut = bench.bench; results.benchTotalSprites = bench.totalSprites;
await page.goto(`http://localhost:${PORT}/?time=21&weather=rain&zoom=1&bench=6`);
await page.waitForFunction(() => window.__iso?.bench, null, { timeout: 60000 });
results.benchDefaultZoom = (await page.evaluate(() => window.__iso)).bench;

const gl = await page.evaluate(() => {
  const c = document.createElement("canvas").getContext("webgl2"); const ext = c?.getExtension("WEBGL_debug_renderer_info");
  return ext ? c.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "unknown";
});
writeFileSync(join(shots, "bench.json"), JSON.stringify({ note: "SOFTWARE-RENDERED (SwiftShader, headless Chromium) - not representative of GPU performance", glRenderer: gl, viewport: "1280x720", ...results }, null, 2));
console.log("bench", JSON.stringify({ gl, zoomedOut: results.benchZoomedOut, defaultZoom: results.benchDefaultZoom }));
if (errors.length) console.log("PAGE ERRORS:\n" + errors.join("\n"));
await browser.close();
server.kill();
