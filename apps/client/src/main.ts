/**
 * Client bootstrap: fixed-step loop + Canvas2D debug draw (until the WebGL2 renderer is wired in) + network session.
 * URL params: ?server=ws://host:7777 (default: same host, port 7777), ?player=N (separate saved account per N).
 */
import { createGameLoop, World, Transform, PrevTransform, lerp, entityIndex, type FixedLoop } from "@engine/core";
import { TileMap, worldToScreen, DEFAULT_ISO } from "@engine/world";
import { installGameplay } from "@engine/gameplay";
import { Act } from "@engine/server/protocol";
import { ClientSession } from "./session.js";
import { mountConnectOverlay } from "./connect.js";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const params = new URLSearchParams(location.search);

// Input: buttons bitfield sampled by NetClient each tick.
let buttons = 0;
const keys: Record<string, number> = { KeyW: Act.MoveUp, KeyS: Act.MoveDown, KeyA: Act.MoveLeft, KeyD: Act.MoveRight, ShiftLeft: Act.Sprint, KeyE: Act.Gather };
addEventListener("keydown", (e) => { const a = keys[e.code]; if (a !== undefined && !(e.target instanceof HTMLInputElement)) buttons |= a; });
addEventListener("keyup", (e) => { const a = keys[e.code]; if (a !== undefined) buttons &= ~a; });
addEventListener("blur", () => { buttons = 0; });

const session = new ClientSession({ storage: localStorage, slot: params.get("player") ?? "1", sampleButtons: () => buttons });
let world = new World({ seed: 1234 }); installGameplay(world, { role: "client" });
// Tiles are not replicated yet (Netcode/world: chunk tile streaming); draw a placeholder ground.
const map = new TileMap();
for (let y = -64; y < 96; y++) for (let x = -64; x < 96; x++) map.setTile(x, y, 1 + ((x * 7 + y * 13) & 3) % 3);

const colors = ["#000", "#3a5", "#495", "#874"];
function render(w: World, alpha: number): void {
  const dpr = devicePixelRatio || 1;
  if (canvas.width !== innerWidth * dpr) { canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr; }
  const p = session.player; const pt = p !== undefined ? w.get(p, Transform) : undefined;
  const cam = worldToScreen(pt?.x ?? 16, pt?.y ?? 16);
  ctx.setTransform(dpr, 0, 0, dpr, (innerWidth / 2 - cam.sx) * dpr, (innerHeight / 2 - cam.sy) * dpr);
  ctx.clearRect(-1e5, -1e5, 2e5, 2e5);
  const { tileW: tw, tileH: th } = DEFAULT_ISO;
  const cx = Math.floor(pt?.x ?? 16), cy = Math.floor(pt?.y ?? 16);
  for (let y = cy - 20; y < cy + 20; y++) for (let x = cx - 20; x < cx + 20; x++) {
    const s = worldToScreen(x, y); ctx.fillStyle = colors[map.getTile(x, y)] ?? "#333";
    ctx.beginPath(); ctx.moveTo(s.sx, s.sy); ctx.lineTo(s.sx + tw / 2, s.sy + th / 2); ctx.lineTo(s.sx, s.sy + th); ctx.lineTo(s.sx - tw / 2, s.sy + th / 2); ctx.fill();
  }
  const ts = w.store(Transform), ps = w.store(PrevTransform);
  for (const e of w.query([Transform])) {
    const i = entityIndex(e); const cur = ts.get(i)!; const prev = ps.get(i) ?? cur;
    const s = worldToScreen(lerp(prev.x, cur.x, alpha), lerp(prev.y, cur.y, alpha));
    ctx.fillStyle = e === p ? "#fd4" : w.predicted.has(e) ? "#fd4" : "#9cf"; ctx.beginPath(); ctx.arc(s.sx, s.sy + th / 2 - 12, e === p ? 10 : 6, 0, Math.PI * 2); ctx.fill();
  }
}

let loop: FixedLoop = createGameLoop(world, { render });
function useWorld(w: World): void { world = w; loop = createGameLoop(w, { render }); }

const defaultUrl = params.get("server") ?? `ws://${location.hostname || "localhost"}:7777`;
const connect = (url: string, name: string): void => { session.connect(url, name).then(useWorld, (e: unknown) => console.warn("connect failed", e)); };
mountConnectOverlay(session, { defaultUrl, onConnect: connect, onDisconnect: () => session.disconnect() });
// Reload = reconnect as the same player (account token in localStorage).
if (session.account && session.savedUrl && params.get("autoconnect") !== "0") connect(params.get("server") ?? session.savedUrl, session.savedName ?? "");

let last = performance.now();
function frame(now: number): void { loop.advance(now - last); last = now; session.poll(); requestAnimationFrame(frame); }
requestAnimationFrame(frame);
