// Start the client's vite dev server for render scripts. peerjs is not installed in this checkout (p2p.ts imports it
// dynamically, which vite's import analysis still resolves); alias it to a throwing stub so local.ts loads offline.
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const clientDir = resolve(root, "../../apps/client");
export async function startClientVite(port) {
  if (port === 5199) throw new Error("port 5199 is reserved");
  const dir = mkdtempSync(join(tmpdir(), "client-vite-"));
  writeFileSync(join(dir, "peerjs-stub.mjs"), "export class Peer { constructor() { throw new Error('peerjs stub'); } }\n");
  writeFileSync(join(dir, "vite.config.mts"), `import base from ${JSON.stringify(resolve(clientDir, "vite.config.ts"))};\nexport default async (env: any) => { const c: any = typeof base === "function" ? await (base as any)(env) : base; return { ...c, root: ${JSON.stringify(clientDir)}, resolve: { ...(c.resolve ?? {}), alias: { ...(c.resolve?.alias ?? {}), peerjs: ${JSON.stringify(join(dir, "peerjs-stub.mjs"))} } } }; };\n`);
  const vite = spawn(process.execPath, [resolve(root, "../../node_modules/vite/bin/vite.js"), "--config", join(dir, "vite.config.mts"), "--port", String(port), "--strictPort", "--host", "127.0.0.1"], { cwd: clientDir, stdio: ["ignore", "pipe", "pipe"] });
  process.on("exit", () => { try { vite.kill("SIGTERM"); } catch {} });
  await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("vite timeout")), 30000); vite.stdout.on("data", (d) => { if (String(d).includes(String(port))) { clearTimeout(t); res(); } }); vite.stderr.on("data", (d) => process.stderr.write(d)); });
  return vite;
}
