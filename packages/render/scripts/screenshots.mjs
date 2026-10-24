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
const shots = process.env.SHOTS_DIR ?? join(root, "shots"); mkdirSync(shots, { recursive: true });
const PORT = Number(process.env.PORT ?? 4791);
const chrome = process.env.CHROME ?? ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(existsSync);

const viteBin = join(dirname(createRequire(join(root, "package.json")).resolve("vite/package.json")), "bin", "vite.js");
const server = spawn(process.execPath, [viteBin, "preview", "--port", String(PORT), "--strictPort"], { cwd: root, stdio: ["ignore", "pipe", "inherit"] });
const stop = () => { try { server.kill("SIGTERM"); } catch {} };
process.on("exit", stop); process.on("uncaughtException", (e) => { console.error(e); if (globalThis.__errs?.length) console.error("page errors:", globalThis.__errs.slice(0, 10)); stop(); process.exit(1); });
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
const errors = []; globalThis.__errs = errors;
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));

async function shot(name, query, settleMs = 2500) {
  const [path, q] = query.startsWith("/") ? query.split("?") : ["/", query];
  await page.goto(`http://localhost:${PORT}${path}?${q}`);
  if (path !== "/") { await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 }); await page.waitForTimeout(settleMs); await page.screenshot({ path: join(shots, `${name}.png`) }); console.log(name, JSON.stringify(await page.evaluate(() => window.__pv?.renderer.characterStats))); return {}; }
  await page.waitForFunction(() => window.__iso?.ready === true, null, { timeout: 120000 });
  // vehicle shots: wait (soft, 45 s) until every visible Art vehicle's streamed page is resident (no placeholders)
  await page.waitForFunction(() => !window.__iso?.vehArtPending, null, { timeout: 45000 }).catch(() => console.warn(name, "vehicle Art still pending:", "placeholders in shot"));
  await page.waitForTimeout(settleMs);
  await page.screenshot({ path: join(shots, `${name}.png`), fullPage: name === "gallery" });
  const info = await page.evaluate(() => window.__iso);
  console.log(name, JSON.stringify({ fps: info.fps?.toFixed(1), stats: info.stats, total: info.totalSprites, ...(info.held ? { held: info.held } : {}), ...(info.chars?.characters ? { chars: info.chars } : {}) }));
  return info;
}

const results = {};
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;
const SHOTS = {
  ghost_valid: "time=22&weather=clear&ghost=valid&gl=lowend&zoom=2.4&shot=1",
  ghost_invalid: "time=22&weather=clear&ghost=invalid&ghostrot=2&gl=safe&zoom=2.4&shot=1",
  vehicles_day: "time=11&weather=clear&vehicles=1&zombies=0&ui=0&zoom=1.3&shot=1",
  vehicles_night: "time=22&weather=clear&vehicles=1&zombies=0&ui=0&zoom=1.3&gl=lowend&shot=1",
  camper_interior: "time=15&weather=clear&vehicles=camper&zombies=0&ui=0&zoom=2.6&gl=safe&shot=1",
  vehicles_art_day: "time=11&weather=clear&vehicles=1&zombies=0&ui=0&zoom=1.3&shot=1",
  vehicles_art_night: "time=22&weather=clear&vehicles=1&zombies=0&ui=0&zoom=1.3&gl=lowend&shot=1",
  camper_interior_fixed: "time=15&weather=clear&vehicles=camper&zombies=0&ui=0&zoom=2.6&gl=safe&shot=1",
  vehicles_scale_lineup: "time=11&weather=clear&vehicles=lineup&zombies=0&ui=0&zoom=0.85&shot=1",
  day: "time=10&weather=clear&shot=1",
  night: "time=22&weather=clear&shot=1",
  rain: "time=15&weather=rain&shot=1",
  inside: "time=21&weather=clear&inside=1&zoom=2.2&shot=1",
  theme: "time=10&weather=clear&theme=alt&shot=1",
  gallery: "gallery=1&shot=1",
  snow: "time=8&weather=snow&zoom=2.4&shot=1",
  storm: "time=17&weather=storm&shot=1",
  fire: "time=22.5&weather=clear&cam=fire&zoom=3&shot=1",
  dusk: "time=18.6&weather=fog&intensity=0.6&shot=1",
  zoomout: "time=11&weather=clear&zoom=0.35&shot=1",
  occlusion: "time=10&weather=clear&occtest=1&zoom=2.4&shot=1",
  occlusion_dither: "time=10&weather=clear&occtest=1&zoom=2.4&occ=dither&shot=1",
  occlusion_off: "time=10&weather=clear&occtest=1&zoom=2.4&occ=off&shot=1",
  chars_lineup: "time=10&weather=clear&chars=lineup&n=9&cam=chars&zombies=0&density=0&ui=0&zoom=3&shot=1",
  chars_facings: "time=10&weather=clear&chars=facings&cam=chars&zombies=0&density=0&ui=0&zoom=3.2&shot=1",
  chars_crowd: "time=10&weather=clear&chars=crowd&n=200&cam=chars&zombies=0&ui=0&zoom=1.1&shot=1",
  chars_preview: "/preview.html?seed=2&zoom=1.2",
  chars_preview_b: "/preview.html?seed=6&facing=3&anim=walk",
  fixture: "time=10&weather=clear&content=sample&shot=1",
};
if (process.env.EXTRA) for (const [i, q] of process.env.EXTRA.split("|").entries()) { SHOTS[`extra${i}`] = q; ONLY?.add(`extra${i}`); }
for (const [name, query] of Object.entries(SHOTS)) {
  if (ONLY && !ONLY.has(name)) continue;
  if (name === "gallery") { await page.setViewportSize({ width: 1280, height: 1400 }); results[name] = await shot(name, query, 800); await page.setViewportSize({ width: 1280, height: 720 }); }
  else results[name] = await shot(name, query);
}
if (!ONLY || ONLY.has("charbench")) {
  // 200 layered players (SOFTWARE-rendered): full layers vs LOD (minor layers dropped below zoom 1.5) vs body-only.
  const cb = {};
  for (const [k, q] of Object.entries({ layered: "chars=crowd&n=200&zombies=0&zoom=1&cam=chars&bench=6", lod: "chars=crowd&n=200&zombies=0&zoom=1&cam=chars&lod=1.5&bench=6", bodyOnly: "chars=crowd&n=200&zombies=0&zoom=1&cam=chars&layers=0&bench=6" })) {
    await page.goto(`http://localhost:${PORT}/?time=10&weather=clear&${q}`);
    await page.waitForFunction(() => window.__iso?.bench, null, { timeout: 90000 });
    const r = await page.evaluate(() => ({ bench: window.__iso.bench, chars: window.__iso.chars }));
    cb[k] = r; console.log("charbench", k, JSON.stringify(r));
  }
  writeFileSync(join(shots, "chars_bench.json"), JSON.stringify({ note: "SOFTWARE-RENDERED (SwiftShader, headless Chromium) - not representative of GPU performance", viewport: "1280x720", players: 200, ...cb }, null, 2));
}
if (ONLY && !ONLY.has("bench")) { if (errors.length) console.log("PAGE ERRORS:\n" + errors.join("\n")); await browser.close(); server.kill(); process.exit(0); }

// Benchmark: zoomed out so thousands of sprites are visible. SOFTWARE (SwiftShader) numbers.
await page.goto(`http://localhost:${PORT}/?time=21&weather=rain&zoom=0.3&density=1.6&zombies=1500&bench=6`);
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
