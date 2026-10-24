// Singleplayer-vs-host mobile repro: runs the CLIENT (apps/client vite dev) in headless Chromium (SwiftShader) with a
// MOCKED Mali-class GPU: Android UA (mobile -> 256 MB atlas budget), MAX_TEXTURE_SIZE 4096, MAX_ARRAY_TEXTURE_LAYERS 64,
// no float colour buffers, and a driver memory cap: any texStorage/texImage/renderbufferStorage allocation that would
// push live GPU bytes past GPU_CAP_MB is refused with GL_OUT_OF_MEMORY (the texture stays unallocated/incomplete).
// Usage: node scripts/spMobile.mjs [tag]   (env: PORT=5341 GPU_CAP_MB=200 MODES=sp,host BOTS=6)
// Device conditions: BLOCK_IDB=1 holds an old-version connection to the singleplayer DB (engine-local-<player>) so the
// app's IndexedDB open is blocked (an older tab / PWA on the phone; the SP flat-brown-screen root cause); NOFEAT=1 removes
// structuredClone, crypto.randomUUID, SharedArrayBuffer, OffscreenCanvas and module Workers; PLAYER=<slot> fixes the slot.
// "host" = ?offline=1&bots=0 (no human bots: the P2P host's multiplayer mode has none); "sp" = singleplayer with bots.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const client = resolve(root, "../../apps/client");
const shots = join(root, "shots"); mkdirSync(shots, { recursive: true });
const tag = process.argv[2] ?? "run";
const PORT = Number(process.env.PORT ?? 5341);
const CAP = Number(process.env.GPU_CAP_MB ?? 200);
const MODES = (process.env.MODES ?? "sp,host").split(",");
const BOTS = Number(process.env.BOTS ?? 6);
const vite = spawn(process.execPath, [resolve(root, "../../node_modules/vite/bin/vite.js"), "--port", String(PORT), "--strictPort", "--host", "127.0.0.1"], { cwd: client, stdio: ["ignore", "pipe", "pipe"] });
process.on("exit", () => { try { vite.kill("SIGTERM"); } catch {} });
await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("vite timeout")), 30000); vite.stdout.on("data", (d) => { if (String(d).includes(String(PORT))) { clearTimeout(t); res(); } }); vite.stderr.on("data", (d) => process.stderr.write(d)); });

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/usr/bin/google-chrome", args: ["--use-angle=swiftshader", "--use-gl=angle", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const out = {};
for (const mode of MODES) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true,
    userAgent: "Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36" });
  await ctx.addInitScript(([cap, lazy]) => {
    const P = WebGL2RenderingContext.prototype; const W = window;
    W.__gpu = { live: 0, peak: 0, oom: 0, refused: [] };
    const DROP = new Set(["EXT_color_buffer_float", "EXT_color_buffer_half_float", "OES_texture_float_linear", "EXT_float_blend"]);
    const ge = P.getExtension; P.getExtension = function (n) { return DROP.has(n) ? null : ge.call(this, n); };
    const gp = P.getParameter; P.getParameter = function (n) {
      if (n === this.MAX_TEXTURE_SIZE || n === this.MAX_RENDERBUFFER_SIZE) return 4096;
      if (n === this.MAX_ARRAY_TEXTURE_LAYERS) return 64;
      return gp.call(this, n); };
    const sizes = new WeakMap(); const bound = new WeakMap(); // ctx -> {target -> obj}
    const cur = (gl, t) => (bound.get(gl) ?? {})[t];
    const bt = P.bindTexture; P.bindTexture = function (t, x) { const m = bound.get(this) ?? {}; m[t] = x; bound.set(this, m); return bt.call(this, t, x); };
    const br = P.bindRenderbuffer; P.bindRenderbuffer = function (t, x) { const m = bound.get(this) ?? {}; m["rb"] = x; bound.set(this, m); return br.call(this, t, x); };
    let pending = 0; const gerr = P.getError; P.getError = function () { const e = gerr.call(this); if (e) return e; if (pending) { const p = pending; pending = 0; return p; } return 0; };
    const alloc = (obj, bytes, what) => { if (!obj) return true; const old = sizes.get(obj) ?? 0; if (W.__gpu.live - old + bytes > cap * 1048576) { pending = 0x0505; W.__gpu.oom++; W.__gpu.refused.push(`${what} ${Math.round(bytes / 1048576)}MB @live ${Math.round(W.__gpu.live / 1048576)}MB`); return false; } W.__gpu.live += bytes - old; W.__gpu.peak = Math.max(W.__gpu.peak, W.__gpu.live); sizes.set(obj, bytes); return true; };
    const bd = P.bufferData; P.bufferData = function (t, a) { const n = typeof a === "number" ? a : (a?.byteLength ?? 0); W.__gpu.bufPeak = Math.max(W.__gpu.bufPeak ?? 0, n); W.__gpu.bufCalls = (W.__gpu.bufCalls ?? 0) + 1; return bd.apply(this, arguments); };
    const mip = (l) => (l > 1 ? 4 / 3 : 1);
    // Mali-style lazy commit: texStorage3D only reserves address space; physical pages are committed per layer on
    // first upload. A refused commit leaves that layer undefined (here: never written) and raises GL_OUT_OF_MEMORY.
    const dims = new WeakMap(); const touched = new WeakMap();
    const ts3 = P.texStorage3D; P.texStorage3D = function (t, l, f, w, h, d) { const o = cur(this, t); if (lazy) { dims.set(o, { w, h, l }); touched.set(o, new Set()); return ts3.apply(this, arguments); } if (!alloc(o, w * h * d * 4 * mip(l), `texStorage3D ${w}x${h}x${d}`)) return; return ts3.apply(this, arguments); };
    const tsub3 = P.texSubImage3D; P.texSubImage3D = function (t, lvl, x, y, z, w, h, d) { const o = cur(this, t), dm = o && dims.get(o); if (lazy && dm) { const set = touched.get(o); for (let k = z; k < z + d; k++) { if (set.has(k)) continue; const b = dm.w * dm.h * 4 * mip(dm.l); if (W.__gpu.live + b > cap * 1048576) { pending = 0x0505; W.__gpu.oom++; if (W.__gpu.refused.length < 40) W.__gpu.refused.push(`commit layer ${k} ${dm.w}px @live ${Math.round(W.__gpu.live / 1048576)}MB`); return; } W.__gpu.live += b; W.__gpu.peak = Math.max(W.__gpu.peak, W.__gpu.live); set.add(k); sizes.set(o, (sizes.get(o) ?? 0) + b); } } return tsub3.apply(this, arguments); };
    const ts2 = P.texStorage2D; P.texStorage2D = function (t, l, f, w, h) { if (!alloc(cur(this, t), w * h * 4 * mip(l), `texStorage2D ${w}x${h}`)) return; return ts2.apply(this, arguments); };
    const ti2 = P.texImage2D; P.texImage2D = function (t, lvl, f, a3, a4, a5) { if (lvl === 0) { const w = typeof a3 === "number" && arguments.length >= 8 ? a3 : (a5?.width ?? arguments[5]?.width ?? 1); const h = typeof a4 === "number" && arguments.length >= 8 ? a4 : (arguments[5]?.height ?? 1); const bpp = f === this.RGBA32F ? 16 : f === this.RGBA16F ? 8 : 4; if (!alloc(cur(this, t), w * h * bpp, `texImage2D ${w}x${h}`)) return; } return ti2.apply(this, arguments); };
    const ti3 = P.texImage3D; P.texImage3D = function (t, lvl, f, w, h, d) { if (lvl === 0 && !alloc(cur(this, t), w * h * d * 4, `texImage3D ${w}x${h}x${d}`)) return; return ti3.apply(this, arguments); };
    const rbs = P.renderbufferStorage; P.renderbufferStorage = function (t, f, w, h) { if (!alloc(cur(this, "rb"), w * h * 4, `renderbuffer ${w}x${h}`)) return; return rbs.apply(this, arguments); };
    const dt = P.deleteTexture; P.deleteTexture = function (x) { if (x) { W.__gpu.live -= sizes.get(x) ?? 0; sizes.delete(x); } return dt.call(this, x); };
    const dr = P.deleteRenderbuffer; P.deleteRenderbuffer = function (x) { if (x) { W.__gpu.live -= sizes.get(x) ?? 0; sizes.delete(x); } return dr.call(this, x); };
  }, [CAP, process.env.LAZY === "1"]);
  const player = process.env.PLAYER ?? `${mode}${Date.now()}`;
  if (process.env.BLOCK_IDB === "1") await ctx.addInitScript((db) => { const r = indexedDB.open(db, 1); r.onupgradeneeded = () => r.result.createObjectStore("chunks", { keyPath: "key" }); r.onsuccess = () => { window.__heldDb = r.result; }; }, `engine-local-${player}`);
  if (process.env.NOFEAT === "1") await ctx.addInitScript(() => { delete window.structuredClone; delete window.SharedArrayBuffer; delete window.OffscreenCanvas; try { Object.defineProperty(crypto, "randomUUID", { value: undefined }); } catch {} const W = window.Worker; window.Worker = function (u, o) { if (o?.type === "module") throw new TypeError("module workers unsupported"); return new W(u, o); }; });
  const page = await ctx.newPage(); const logs = [];
  page.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`)); page.on("pageerror", (e) => logs.push(`pageerror: ${e}`));
  const q = mode === "host" ? "offline=1&bots=0" : `offline=1&bots=${BOTS}`;
  await page.goto(`http://127.0.0.1:${PORT}/?${q}${process.env.NODIAG === "1" ? "" : "&diag=1"}&shot=1&time=12&weather=clear&player=${player}`);
  await page.waitForFunction(() => window.__view?.ready === true, null, { timeout: 180000 }).catch(() => logs.push("view never ready"));
  await page.waitForTimeout(Number(process.env.WAIT_MS ?? 25000));
  const file = join(shots, process.env.SHOT ? process.env.SHOT : `sp_mobile_${tag}_${mode}.png`); await page.screenshot({ path: file });
  const r = await page.evaluate(() => {
    const c = document.querySelector("canvas"); const t = document.createElement("canvas"); t.width = 64; t.height = 64; const g = t.getContext("2d"); g.drawImage(c, 0, 0, 64, 64);
    const d = g.getImageData(0, 0, 64, 64).data; const cols = new Map(); let sum = 0;
    for (let i = 0; i < d.length; i += 4) { sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; const k = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4); cols.set(k, (cols.get(k) ?? 0) + 1); }
    const top = Math.max(...cols.values()) / (d.length / 4);
    return { meanLuma: +(sum / (d.length / 4)).toFixed(1), dominantShare: +top.toFixed(3), colours: cols.size, gpu: { ...window.__gpu, liveMB: Math.round(window.__gpu.live / 1048576), peakMB: Math.round(window.__gpu.peak / 1048576), refused: window.__gpu.refused.slice(0, 12) }, diag: document.getElementById("diag")?.textContent ?? null, error: document.getElementById("render-error")?.textContent ?? null };
  });
  r.flat = r.dominantShare > 0.9 || r.colours < 6;
  out[mode] = { file, ...r, logs: logs.filter((l) => /render|view|error|warn/i.test(l)).slice(-60) };
  console.log(`== ${mode}: flat=${r.flat} luma=${r.meanLuma} dominant=${r.dominantShare} colours=${r.colours} gpu live=${r.gpu.liveMB}MB peak=${r.gpu.peakMB}MB oom=${r.gpu.oom} bufPeak=${r.gpu.bufPeak} bufCalls=${r.gpu.bufCalls}`);
  await ctx.close();
}
writeFileSync(join(shots, `sp_mobile_${tag}.json`), JSON.stringify(out, null, 2));
await browser.close(); vite.kill("SIGTERM");
process.exit(0);
