// Mobile perf profile: apps/client (vite dev) in headless Chromium (SwiftShader) at 412x915 DPR 2.625, Android UA,
// CDP CPU throttle (THROTTLE, default 4). Records frame ms p50/p95, draw calls, GL state changes, instances, overdraw
// estimate, light/bloom pass cost (gl.finish-bracketed sample window), CPU split (view.ts sync / renderer prepare =
// cull+sort / rest), JS heap allocation per frame and GCs, and a CDP CPU profile split by package (sim/net cost).
// NOSYNC=1: no GPU sync points (no ?diag/?shot, watchdog readPixels off, no gl.finish pass bracketing) = honest pipelined timings.
// Usage: PORT=5341 THROTTLE=4 node scripts/perfMobile.mjs <tag> [extra query, e.g. quality=low]
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const client = resolve(root, "../../apps/client");
const shots = join(root, "shots"); mkdirSync(shots, { recursive: true });
const tag = process.argv[2] ?? "run"; const extra = process.argv[3] ?? "";
const NOSYNC = process.env.NOSYNC === "1";
const PORT = Number(process.env.PORT ?? 5341); if (PORT === 5199) throw new Error("port 5199 is reserved");
const THROTTLE = Number(process.env.THROTTLE ?? 4); const SECS = Number(process.env.SECS ?? 10);
const vite = spawn(process.execPath, [resolve(root, "../../node_modules/vite/bin/vite.js"), "--port", String(PORT), "--strictPort", "--host", "127.0.0.1"], { cwd: client, stdio: ["ignore", "pipe", "pipe"] });
process.on("exit", () => { try { vite.kill("SIGTERM"); } catch {} });
await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("vite timeout")), 30000); vite.stdout.on("data", (d) => { if (String(d).includes(String(PORT))) { clearTimeout(t); res(); } }); });
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/usr/bin/google-chrome", args: ["--use-angle=swiftshader", "--use-gl=angle", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-precise-memory-info", "--js-flags=--expose-gc"] });
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true,
  userAgent: "Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36" });
await ctx.addInitScript(() => {
  const P = WebGL2RenderingContext.prototype; const C = (window.__glc = { draw: 0, state: 0, inst: 0 });
  for (const n of ["drawArrays", "drawElements"]) { const f = P[n]; P[n] = function () { C.draw++; return f.apply(this, arguments); }; }
  for (const n of ["drawArraysInstanced", "drawElementsInstanced"]) { const f = P[n]; P[n] = function () { C.draw++; C.inst += arguments[3] ?? 0; return f.apply(this, arguments); }; }
  const ST = ["useProgram", "bindTexture", "activeTexture", "bindVertexArray", "bindFramebuffer", "bindBuffer", "enable", "disable", "blendFunc", "blendFuncSeparate", "depthFunc", "depthMask", "viewport", "drawBuffers"];
  for (const n of ST) { const f = P[n]; P[n] = function () { C.state++; return f.apply(this, arguments); }; }
  const U = Object.getOwnPropertyNames(P).filter((n) => /^uniform/.test(n)); C.uni = 0;
  for (const n of U) { const f = P[n]; P[n] = function () { C.uni++; return f.apply(this, arguments); }; }
});
const page = await ctx.newPage(); const logs = [];
page.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`)); page.on("pageerror", (e) => logs.push(`pageerror: ${e}`));
await page.goto(`http://127.0.0.1:${PORT}/?offline=1&bots=6${NOSYNC ? "" : "&diag=1&shot=1"}&time=21&weather=rain&player=perf${Date.now()}${extra ? "&" + extra : ""}`);
await page.waitForFunction(() => window.__view?.ready === true, null, { timeout: 120000 }).catch((e) => { console.log(logs.slice(-30).join("\n")); throw e; });
await page.waitForTimeout(Number(process.env.WAIT_MS ?? 15000));
const cdp = await ctx.newCDPSession(page);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
await page.waitForTimeout(3000);
// instrumentation
await page.evaluate((nosync) => {
  const v = window.__view.iso, r = v.renderer; if (nosync) r.syncPoints = false; const S = (window.__perf = { frames: [], sync: [], rend: [], prep: [], draw: [], inst: [], ov: [], st: [], uni: [], heap: [], gcs: 0, last: 0, gov: [] });
  const wrap = (o, k, arr) => { const f = o[k].bind(o); o[k] = (...a) => { const t = performance.now(); const x = f(...a); arr.push(performance.now() - t); return x; }; };
  const rt = []; wrap(r, "render", rt); S.rendT = rt; const pt = []; wrap(r.sprites, "prepare", pt); S.prepT = pt;
  const vf = v.render.bind(v); v.render = (...a) => { const C = window.__glc; const d0 = C.draw, s0 = C.state, u0 = C.uni, i0 = C.inst; const t = performance.now(); const n0 = rt.length; vf(...a); const tt = performance.now() - t;
    S.sync.push(tt - (rt.length > n0 ? rt[rt.length - 1] : 0)); S.draw.push(C.draw - d0); S.st.push(C.state - s0); S.uni.push(C.uni - u0); S.inst.push(C.inst - i0); S.ov.push(r.stats.overdraw ?? -1);
    const m = performance.memory?.usedJSHeapSize ?? 0; S.heap.push(m); if (r.quality) S.gov.push(r.quality.level); };
  const raf = (t) => { if (S.last) S.frames.push(t - S.last); S.last = t; requestAnimationFrame(raf); }; requestAnimationFrame(raf);
}, NOSYNC);
await cdp.send("Profiler.enable"); await cdp.send("Profiler.setSamplingInterval", { interval: 500 }); await cdp.send("Profiler.start");
await page.waitForTimeout(SECS * 1000);
const { profile } = await cdp.send("Profiler.stop");
// pass costs: gl.finish-bracketed (serialises the GPU = SwiftShader CPU raster) over 30 frames
const pass = NOSYNC ? { skipped: "NOSYNC" } : await page.evaluate(async () => {
  const r = window.__view.iso.renderer, gl = r.gl; const out = {};
  const br = (o, k, name) => { const f = o[k].bind(o); out[name] = []; o[k] = (...a) => { gl.finish(); const t = performance.now(); const x = f(...a); gl.finish(); out[name].push(performance.now() - t); return x; }; return () => { o[k] = f; }; };
  const un = [br(r.lights, "draw", "lightmap"), br(r.bloom, "draw", "bloom"), br(r.composite, r.diagState.safe ? "drawSafe" : "draw", "composite"), br(r.weather, "draw", "weather"), br(r.sprites, "drawStatic", "statics"), br(r.sprites, "draw", "sprites"), br(r.terrain, "draw", "terrain")];
  if (r.tiles) un.push(br(r.tiles, "draw", "tiles"));
  await new Promise((res) => setTimeout(res, 4000)); un.forEach((u) => u());
  const med = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return +s[s.length >> 1].toFixed(2); };
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, med(v)]));
});
const res = await page.evaluate(() => {
  const S = window.__perf; const q = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(2); };
  const avg = (a) => +(a.reduce((x, y) => x + y, 0) / Math.max(1, a.length)).toFixed(2);
  let alloc = 0, gcs = 0; for (let i = 1; i < S.heap.length; i++) { const d = S.heap[i] - S.heap[i - 1]; if (d > 0) alloc += d; else if (d < 0) gcs++; }
  const r = window.__view.iso.renderer;
  return { frames: S.frames.length, frameP50: q(S.frames, 0.5), frameP95: q(S.frames, 0.95), fps: +(1000 / avg(S.frames)).toFixed(1),
    drawCalls: avg(S.draw), stateChanges: avg(S.st), uniforms: avg(S.uni), instances: avg(S.inst), overdraw: avg(S.ov),
    renderCpuP50: q(S.rendT, 0.5), renderCpuP95: q(S.rendT, 0.95), cullSortP50: q(S.prepT, 0.5), syncP50: q(S.sync, 0.5), syncP95: q(S.sync, 0.95),
    allocKBPerFrame: +(alloc / Math.max(1, S.heap.length) / 1024).toFixed(1), heapDrops: gcs,
    backbuffer: `${r.w}x${r.h}`, quality: r.quality ? { level: r.quality.level, ...r.quality.current, hist: [...new Set(S.gov)] } : null, diag: document.getElementById("diag")?.textContent?.split("\n").filter((l) => /frame|quality|vram/.test(l)) };
});
// CPU profile self time by source area
const byId = new Map(profile.nodes.map((n) => [n.id, n])); const self = new Map(); const dts = profile.timeDeltas; let total = 0;
profile.samples.forEach((id, i) => { const n = byId.get(id); const u = n.callFrame.url || `(${n.callFrame.functionName || "native"})`; const m = u.match(/packages\/([a-z]+)\/|apps\/([a-z]+)\/|node_modules\/\.vite\/deps\/([^?]+)|\((.*)\)/); const k = m ? (m[1] ? `pkg/${m[1]}` : m[2] ? `app/${m[2]}` : m[3] ? `dep/${m[3]}` : m[4]) : "other"; const d = (dts[i] ?? 0) / 1000; self.set(k, (self.get(k) ?? 0) + d); total += d; });
const fn = new Map(); profile.samples.forEach((id, i) => { const n = byId.get(id); const u = n.callFrame.url; if (!/packages\/(net|gameplay|core|world|persist)|apps\/client\/src\/(local|session|host)/.test(u)) return; const k = `${n.callFrame.functionName || "anon"} ${u.split("/").slice(-2).join("/").split("?")[0]}:${n.callFrame.lineNumber + 1}`; fn.set(k, (fn.get(k) ?? 0) + (dts[i] ?? 0) / 1000); });
const perSec = (ms) => +(ms / SECS).toFixed(1);
res.profileMsPerSec = Object.fromEntries([...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => [k, perSec(v)]));
res.simTopFns = [...fn.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k} ${perSec(v)}ms/s`);
res.passMs = pass; res.nosync = NOSYNC; res.throttle = THROTTLE; res.query = extra;
await page.screenshot({ path: join(shots, `perf_${tag}.png`) });
res.errors = logs.filter((l) => /error/i.test(l)).slice(-8);
writeFileSync(join(shots, `perf_${tag}.json`), JSON.stringify(res, null, 1));
console.log(JSON.stringify(res, null, 1));
await browser.close(); vite.kill("SIGTERM"); process.exit(0);
