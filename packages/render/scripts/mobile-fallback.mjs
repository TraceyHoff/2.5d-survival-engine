// Mobile fallback verification: headless Chromium (SwiftShader) with a MOCKED mobile GPU — float colour-buffer
// and float-linear extensions removed, fragment highp reported unsupported (mediump-only shader path), a
// 412x915 @ DPR 3 Android viewport — plus `?gl=lowend`. Captures shots/mobile_fallback_{day,night}.png and
// fails (exit 1) when the frame is black, a shader fails, or the atlas arrays exceed the mobile budget.
// Usage: pnpm build && node scripts/mobile-fallback.mjs
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const shots = join(root, "shots"); mkdirSync(shots, { recursive: true });
const PORT = Number(process.env.PORT ?? 4793);
const chrome = process.env.CHROME ?? ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(existsSync);
const viteBin = join(dirname(createRequire(join(root, "package.json")).resolve("vite/package.json")), "bin", "vite.js");
const server = spawn(process.execPath, [viteBin, "preview", "--port", String(PORT), "--strictPort"], { cwd: root, stdio: ["ignore", "pipe", "inherit"] });
process.on("exit", () => { try { server.kill("SIGTERM"); } catch {} });
await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("preview timeout")), 20000); server.stdout.on("data", (d) => { if (String(d).includes(String(PORT))) { clearTimeout(t); res(); } }); });

const browser = await chromium.launch({ ...(chrome ? { executablePath: chrome } : {}), args: ["--use-angle=swiftshader", "--use-gl=angle", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36" });
await ctx.addInitScript(() => {
  const P = WebGL2RenderingContext.prototype;
  const DROP = new Set(["EXT_color_buffer_float", "EXT_color_buffer_half_float", "OES_texture_float_linear", "EXT_float_blend"]);
  const ge = P.getExtension; P.getExtension = function (n) { return DROP.has(n) ? null : ge.call(this, n); };
  const gs = P.getSupportedExtensions; P.getSupportedExtensions = function () { return (gs.call(this) ?? []).filter((n) => !DROP.has(n)); };
  const gp = P.getShaderPrecisionFormat; P.getShaderPrecisionFormat = function (st, pt) { const r = gp.call(this, st, pt); return st === this.FRAGMENT_SHADER && pt === this.HIGH_FLOAT ? { rangeMin: 0, rangeMax: 0, precision: 0 } : r; };
  const ts = P.texStorage3D; window.__atlasBytes = 0;
  P.texStorage3D = function (t, l, f, w, h, d) { window.__atlasBytes += w * h * d * 4 * (l > 1 ? 4 / 3 : 1); return ts.apply(this, arguments); };
  const sh = P.shaderSource; window.__mediump = 0; window.__highpFrag = 0;
  P.shaderSource = function (s, src) { if (/out vec4|out highp vec4|gl_FragColor|layout\(location=\d\) out/.test(src) && !/gl_Position/.test(src)) { if (/precision highp float/.test(src)) window.__highpFrag++; else window.__mediump++; } return sh.call(this, s, src); };
});
const page = await ctx.newPage();
const errors = [], logs = [];
page.on("console", (m) => { logs.push(`${m.type()}: ${m.text()}`); if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));

const result = {}; let fail = false;
for (const [name, q] of Object.entries({ day: "time=10&weather=clear", night: "time=22&weather=clear" })) {
  await page.goto(`http://localhost:${PORT}/?${q}&shot=1&gl=lowend`);
  try { await page.waitForFunction(() => window.__iso?.ready === true, null, { timeout: 180000 }); }
  catch (e) { console.error(`${name}: renderer never became ready\n` + [...errors, ...logs.slice(-30)].join("\n")); await page.screenshot({ path: join(shots, `mobile_fallback_${name}_timeout.png`) }); await browser.close(); server.kill("SIGTERM"); process.exit(1); }
  await page.waitForTimeout(2500);
  const file = join(shots, `mobile_fallback_${name}.png`); await page.screenshot({ path: file });
  const r = await page.evaluate(() => {
    const c = document.querySelector("canvas"); const t = document.createElement("canvas"); t.width = 128; t.height = 128;
    const g = t.getContext("2d"); g.drawImage(c, 0, 0, 128, 128); const d = g.getImageData(0, 0, 128, 128).data;
    let sum = 0, lit = 0; for (let i = 0; i < d.length; i += 4) { const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; sum += l; if (l > 24) lit++; }
    const caps = window.__iso?.capabilities; const atlas = window.__iso?.atlasStats;
    return { meanLuma: +(sum / (d.length / 4)).toFixed(1), litFraction: +(lit / (d.length / 4)).toFixed(3), canvas: [c.width, c.height], atlasMB: Math.round(window.__atlasBytes / 1048576), mediumpFrag: window.__mediump, highpFrag: window.__highpFrag, caps: caps ? { precision: caps.precision, formats: caps.formats, fallbacks: caps.fallbacks, atlasLayerSize: caps.atlasLayerSize, textureBudgetMB: caps.textureBudgetMB, maxDpr: caps.maxDpr } : null, atlas };
  });
  result[name] = { file, ...r };
  console.log(name, JSON.stringify(r));
  const minLuma = name === "day" ? 40 : 8;
  if (r.meanLuma < minLuma || r.litFraction < 0.05) { console.error(`${name}: frame is black (mean luma ${r.meanLuma})`); fail = true; }
  if (r.highpFrag > 0) { console.error(`${name}: ${r.highpFrag} fragment shaders still highp under the mediump mock`); fail = true; }
  if (r.atlasMB > 260) { console.error(`${name}: atlas arrays ${r.atlasMB} MB exceed the mobile budget`); fail = true; }
}
const fatal = errors.filter((e) => !/Failed to load resource/.test(e)); // 404s (optional art probes) are not render failures
if (fatal.length) { console.error("errors:\n" + fatal.join("\n")); fail = true; }
writeFileSync(join(shots, "mobile_fallback.json"), JSON.stringify({ result, errors, logs: logs.filter((l) => l.includes("[render]")) }, null, 2));
await browser.close(); server.kill("SIGTERM");
process.exit(fail ? 1 : 0);
