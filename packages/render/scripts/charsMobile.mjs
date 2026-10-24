// Character close-up on the mobile repro (spMobile setup: 412x915 @ DPR 2.625, Android UA, SwiftShader, PORT 5341).
// Usage: PORT=5341 node scripts/charsMobile.mjs <tag>  -> shots/chars_mobile_<tag>.png (+ full frame, diag text)
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
const root = join(dirname(fileURLToPath(import.meta.url)), ".."); const client = resolve(root, "../../apps/client");
const shots = join(root, "shots"); mkdirSync(shots, { recursive: true }); const tag = process.argv[2] ?? "run";
const PORT = Number(process.env.PORT ?? 5341); if (PORT === 5199) throw new Error("port 5199 is reserved");
const vite = spawn(process.execPath, [resolve(root, "../../node_modules/vite/bin/vite.js"), "--port", String(PORT), "--strictPort", "--host", "127.0.0.1"], { cwd: client, stdio: ["ignore", "pipe", "pipe"] });
process.on("exit", () => { try { vite.kill("SIGTERM"); } catch {} });
await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("vite timeout")), 30000); vite.stdout.on("data", (d) => { if (String(d).includes(String(PORT))) { clearTimeout(t); res(); } }); });
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/usr/bin/google-chrome", args: ["--use-angle=swiftshader", "--use-gl=angle", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true,
  userAgent: "Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36" });
const page = await ctx.newPage(); const logs = [];
page.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`)); page.on("pageerror", (e) => logs.push(`pageerror: ${e}`));
await page.goto(`http://127.0.0.1:${PORT}/?offline=1&bots=${process.env.BOTS ?? 6}&diag=1&shot=1&time=12&weather=clear&player=chars${Date.now()}`);
await page.waitForFunction(() => window.__view?.ready === true, null, { timeout: 150000 }).catch(() => { console.log(logs.slice(-20).join("\n")); process.exit(1); });
await page.waitForTimeout(Number(process.env.WAIT_MS ?? 25000));
const diag = await page.evaluate(() => { const d = document.getElementById("diag"); const t = d?.textContent ?? ""; if (d) d.style.visibility = "hidden"; return t; });
await page.waitForTimeout(300);
await page.screenshot({ path: join(shots, `chars_mobile_${tag}_full.png`) });
// close-up: centre of the screen (camera follows the local player), 2x device crop
await page.screenshot({ path: join(shots, `chars_mobile_${tag}.png`), clip: { x: 206 - 90, y: 457 - 130, width: 180, height: 200 } });
writeFileSync(join(shots, `chars_mobile_${tag}.txt`), diag + "\n---\n" + logs.filter((l) => /render|error|warn/i.test(l)).slice(-30).join("\n"));
console.log(diag.split("\n").filter((l) => /vram|tiers|wear|dress|char|pool|backbuffer/i.test(l)).join("\n"));
await browser.close(); vite.kill("SIGTERM"); process.exit(0);
