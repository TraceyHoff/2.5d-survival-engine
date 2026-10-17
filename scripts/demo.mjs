#!/usr/bin/env node
/**
 * pnpm demo [--bots N] [--fresh] [--port 7777] [--client-port 5173] [--save saves/demo.db] [--duration S] [--open]
 * pnpm demo:bots [--bots 20] ...   (= --headless --fresh: server + bots only, prints load stats)
 *
 * Starts apps/server (persistent SQLite save, ws on PORT), the Vite client dev server, and optionally N headless bots.
 * Packages are source-first (tsx/Vite consume TS directly), so the only "build" step is making sure the native
 * SQLite binding is present. Ctrl-C (or --duration) stops everything; the server does a full save on SIGINT.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const flag = (k) => argv.includes(k);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d; };
const headless = flag("--headless");
const bots = Number(opt("--bots", headless ? "20" : "0"));
const port = Number(opt("--port", process.env.PORT ?? "7777"));
const clientPort = Number(opt("--client-port", "5173"));
const save = resolve(root, opt("--save", headless ? "saves/bots.db" : "saves/demo.db"));
const fresh = flag("--fresh") || (headless && !flag("--keep"));
const duration = Number(opt("--duration", "0"));
const statsSec = opt("--stats", headless ? "3" : "5");
const tokens = save.replace(/\.db$/, "") + "-bots.json";
const bin = (n) => join(root, "node_modules", ".bin", n);

// "Build": verify the native better-sqlite3 binding (prebuilt for Node 20/22); rebuild if missing.
const requireFromPersist = createRequire(join(root, "packages/persist/package.json"));
try { const D = requireFromPersist("better-sqlite3"); new D(":memory:").close(); }
catch (e) {
  console.log(`[demo] better-sqlite3 binding missing (${e.message.split("\n")[0]}); running pnpm rebuild better-sqlite3`);
  const r = spawnSync("pnpm", ["rebuild", "better-sqlite3"], { cwd: root, stdio: "inherit" }); if (r.status !== 0) process.exit(1);
}
if (fresh && existsSync(tokens)) rmSync(tokens);

const children = [];
function run(name, cmd, args, cwd, onLine) {
  const c = spawn(cmd, args, { cwd, env: { ...process.env, FORCE_COLOR: "0" }, stdio: ["ignore", "pipe", "pipe"] });
  const pipe = (s) => { let buf = ""; s.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); console.log(`[${name}] ${l}`); onLine?.(l); } }); };
  pipe(c.stdout); pipe(c.stderr); children.push({ name, c }); return c;
}
const waitFor = (pred, ms = 30000) => new Promise((res, rej) => { const t0 = Date.now(); const i = setInterval(() => { if (pred()) { clearInterval(i); res(); } else if (Date.now() - t0 > ms) { clearInterval(i); rej(new Error("timeout")); } }, 50); });

let serverUp = false, viteUrl;
const server = run("server", bin("tsx"), ["src/main.ts", "--port", String(port), "--save", save, "--stats", statsSec, ...(fresh ? ["--fresh"] : [])], join(root, "apps/server"),
  (l) => { if (l.includes("listening ws://")) serverUp = true; });
let stopping = false;
server.on("exit", (code) => { if (!stopping) { console.log(`[demo] server exited (${code})`); shutdown(code ?? 1); } });
await waitFor(() => serverUp).catch(() => { console.log("[demo] server did not start"); shutdown(1); });

if (!headless) {
  run("vite", bin("vite"), ["--port", String(clientPort), "--host", "127.0.0.1"], join(root, "apps/client"), (l) => { const m = l.match(/Local:\s+(http:\/\/\S+)/); if (m) viteUrl = m[1]; });
  await waitFor(() => viteUrl).catch(() => console.log("[demo] vite did not report a URL"));
  if (viteUrl) {
    const base = viteUrl.replace(/\/$/, "");
    const urls = [1, 2].map((p) => `${base}/?player=${p}&server=ws://localhost:${port}`);
    console.log(`\n[demo] open two clients (separate saved players):\n  ${urls[0]}\n  ${urls[1]}\n[demo] WASD move, Shift sprint, E gather. Reload = same player. Ctrl-C saves and stops.\n`);
    if (flag("--open")) for (const u of urls) spawn(process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open", [u], { stdio: "ignore", detached: true }).on("error", () => {});
  }
}
if (bots > 0) run("bots", bin("tsx"), ["src/bots.ts", "--url", `ws://127.0.0.1:${port}`, "--count", String(bots), "--tokens", tokens, "--stats", statsSec], join(root, "apps/server"));

function shutdown(code = 0) {
  if (stopping) return; stopping = true;
  console.log("[demo] stopping...");
  for (const { name, c } of children) if (name !== "server" && c.exitCode === null) c.kill("SIGTERM");
  const s = children.find((x) => x.name === "server")?.c;
  if (!s || s.exitCode !== null) process.exit(code);
  s.kill("SIGINT"); // graceful: full save
  const force = setTimeout(() => { s.kill("SIGKILL"); process.exit(1); }, 15000);
  s.on("exit", (c) => { clearTimeout(force); process.exit(code || (c ?? 0)); });
}
process.on("SIGINT", () => shutdown(0)); process.on("SIGTERM", () => shutdown(0));
if (duration > 0) setTimeout(() => shutdown(0), duration * 1000);
