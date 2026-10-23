/**
 * Client bootstrap: fixed-step loop + WebGL2 IsoRenderer view (./view.ts, Art's pack) + network session.
 * Falls back to the Canvas2D debug draw with ?renderer=debug or when WebGL2 / the art fails to load.
 * URL params: ?server=ws://host:7777 (default: same host, port 7777), ?player=N (separate saved account per N),
 *             ?renderer=debug, ?time=0..24 / ?weather=clear|rain|storm|snow|fog &intensity=0..1 (view-only overrides), ?hud=0.
 */
import { createGameLoop, World, Transform, PrevTransform, lerp, entityIndex, InputState, type FixedLoop } from "@engine/core";
import { TileMap, worldToScreen, screenToWorld, DEFAULT_ISO } from "@engine/world";
import { InputSystem, AimResolver, DEFAULT_ACTIONS, DEFAULT_CONTEXTS, DEFAULT_PROFILES, DEFAULT_TOUCH_LAYOUTS, type FrameMapping } from "@engine/input";
import { attachBrowserInput } from "@engine/input/browser";
import { Act, installDemoWorld } from "@engine/server/protocol";
import { ClientSession } from "./session.js";
import { mountConnectOverlay } from "./connect.js";
import { IsoView } from "./view.js";
import { mountHud } from "./hud.js";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const params = new URLSearchParams(location.search);
let ctx: CanvasRenderingContext2D | null = null;
let iso: IsoView | undefined;
const WEATHERS = ["clear", "rain", "storm", "snow", "fog"];
const wantIso = params.get("renderer") !== "debug" && typeof WebGL2RenderingContext !== "undefined";
const isoReady: Promise<void> = wantIso ? (async () => {
  const num = (k: string): number | undefined => { const v = params.get(k); return v === null || !Number.isFinite(Number(v)) ? undefined : Number(v); };
  const wq = params.get("weather"); const wi = wq ? WEATHERS.indexOf(wq) : -1;
  const v = await IsoView.create(canvas, import.meta.env.BASE_URL, { ...(num("time") !== undefined ? { hours: num("time")! } : {}), ...(wi >= 0 ? { weather: wi, intensity: num("intensity") ?? 1 } : {}) });
  const onResize = (): void => v.resize(innerWidth, innerHeight, devicePixelRatio || 1); addEventListener("resize", onResize); onResize();
  iso = v; (window as { __view?: unknown }).__view = { ready: true, renderer: "iso" };
})().catch((e: unknown) => { console.warn("IsoRenderer unavailable, using debug renderer", e); fallback(); }) : Promise.resolve(fallback());
function fallback(): void {
  // a WebGL context may already own #game: draw Canvas2D on an overlay (input stays bound to #game)
  const c = document.createElement("canvas"); c.id = "game-debug"; c.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none";
  document.body.append(c); debugCanvas = c; ctx = c.getContext("2d");
  (window as { __view?: unknown }).__view = { ready: true, renderer: "debug" };
}
let debugCanvas = canvas;
void isoReady;

// Input (@engine/input, see packages/input/README.md): keyboard/mouse, gamepad and touch -> one InputFrame per tick.
const input = new InputSystem(performance, { actions: DEFAULT_ACTIONS, contexts: DEFAULT_CONTEXTS, profiles: DEFAULT_PROFILES });
input.push("Gameplay");
attachBrowserInput(canvas, input, { ...(matchMedia("(pointer: coarse)").matches ? { virtualLayout: DEFAULT_TOUCH_LAYOUTS.gameplay } : {}) });
let cam = { sx: 0, sy: 0 }; // camera offset from render(), for mouse aim
const aim = new AimResolver(input, { screenToWorld: (x, y) => iso ? iso.renderer.camera.cssToWorld(x, y) : screenToWorld(x - innerWidth / 2 + cam.sx, y - innerHeight / 2 + cam.sy) });
/** Input actions -> the demo's action bits (server protocol `Act`); analog move/aim/edges ride along as InputFrame v2 fields. */
const FRAME_MAPPING: FrameMapping = { holdBits: { Sprint: Act.Sprint, Interact: Act.Gather, Primary: Act.Gather }, move: { action: "Move", up: Act.MoveUp, down: Act.MoveDown, left: Act.MoveLeft, right: Act.MoveRight } };
const inputState = new InputState();
function sampleInput(): { buttons: number; aimX: number; aimY: number } {
  const p = session.player; const pt = p !== undefined ? world.get(p, Transform) : undefined;
  input.update(); input.writeFrame(inputState, FRAME_MAPPING, p !== undefined && pt ? aim.resolve(world, p, pt) : undefined);
  const { tick: _t, commands: _c, actions, ...rest } = inputState.sample(world.tick);
  // Every frame field goes to NetClient (spread into its InputCmd); net encodes the v2 fields once its InputCmd carries them.
  const cmd = { buttons: actions, ...rest }; return cmd;
}

const session = new ClientSession({ storage: localStorage, slot: params.get("player") ?? "1", sampleInput });
let world = new World({ seed: 1234 }); installDemoWorld(world, "client");
// Ground: replicated tiles from the server (net TileClient, `session.client.tiles.tiles`) once connected;
// a placeholder ground is drawn only while offline.
const placeholder = new TileMap();
for (let y = -64; y < 96; y++) for (let x = -64; x < 96; x++) placeholder.setTile(x, y, 1 + ((x * 7 + y * 13) & 3) % 3);

const colors = ["#000", "#3a5", "#495", "#874"];
function render(w: World, alpha: number): void {
  if (iso) { iso.render(w, session.client?.tiles.tiles, session.player, alpha); return; }
  if (!ctx) return;
  const canvas = debugCanvas;
  const dpr = devicePixelRatio || 1;
  if (canvas.width !== innerWidth * dpr) { canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr; }
  const p = session.player; const pt = p !== undefined ? w.get(p, Transform) : undefined;
  cam = worldToScreen(pt?.x ?? 16, pt?.y ?? 16);
  ctx.setTransform(dpr, 0, 0, dpr, (innerWidth / 2 - cam.sx) * dpr, (innerHeight / 2 - cam.sy) * dpr);
  ctx.clearRect(-1e5, -1e5, 2e5, 2e5);
  const { tileW: tw, tileH: th } = DEFAULT_ISO;
  const map: TileMap = session.client?.tiles.tiles ?? placeholder;
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

const serverParam = params.get("server");
/** Offline mode: no `server` param on a static host (Pages build sets VITE_DEFAULT_OFFLINE=1), or ?offline=1. */
const offline = !serverParam && (params.get("offline") === "1" || import.meta.env["VITE_DEFAULT_OFFLINE"] === "1");
let pumpLocal: ((ms: number) => void) | undefined;
if (offline) {
  // Lazy chunk: the in-browser authoritative server is only loaded in offline mode.
  void (async () => {
    const { createLocalServer, openBrowserStore } = await import("./local.js");
    const bots = Number(params.get("bots") ?? 3);
    const local = await createLocalServer({ store: await openBrowserStore(`engine-local-${params.get("player") ?? "1"}`), bots, log: (m) => console.info(`[local] ${m}`) });
    pumpLocal = local.pump;
    addEventListener("pagehide", () => { void local.game.persist?.saveAll(); });
    useWorld(await session.connect("local", session.savedName ?? "", local.createTransport()));
  })().catch((e: unknown) => console.error("local server failed", e));
} else {
  const defaultUrl = serverParam ?? `ws://${location.hostname || "localhost"}:7777`;
  const connect = (url: string, name: string): void => { session.connect(url, name).then(useWorld, (e: unknown) => console.warn("connect failed", e)); };
  mountConnectOverlay(session, { defaultUrl, onConnect: connect, onDisconnect: () => session.disconnect() });
  // Reload = reconnect as the same player (account token in localStorage).
  if (session.account && session.savedUrl && params.get("autoconnect") !== "0") connect(serverParam ?? session.savedUrl, session.savedName ?? "");
}

if (params.get("hud") !== "0") mountHud(() => world, () => session.player);

let last = performance.now();
function frame(now: number): void { const dt = Math.min(now - last, 250); pumpLocal?.(dt); loop.advance(now - last); last = now; session.poll(); requestAnimationFrame(frame); }
requestAnimationFrame(frame);
