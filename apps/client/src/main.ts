/** Client bootstrap: boots fixed-step loop + canvas. Uses Canvas2D debug draw until the WebGL2 renderer lands. */
import { createGameLoop, World, Transform, PrevTransform, lerp, InputState, defineActions, entityIndex } from "@engine/core";
import { TileMap, worldToScreen, DEFAULT_ISO } from "@engine/world";
import { installGameplay } from "@engine/gameplay";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const world = new World({ seed: 1234 });
installGameplay(world);
const map = new TileMap();
for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) map.setTile(x, y, 1 + world.rng.int(0, 3));
const input = new InputState();
const player = world.create(); world.add(player, Transform, { x: 16, y: 16 });
const Action = defineActions(["MoveUp", "MoveDown", "MoveLeft", "MoveRight"]);
const keys: Record<string, number> = { KeyW: Action.MoveUp, KeyS: Action.MoveDown, KeyA: Action.MoveLeft, KeyD: Action.MoveRight };
addEventListener("keydown", (e) => { const a = keys[e.code]; if (a !== undefined) input.press(a); });
addEventListener("keyup", (e) => { const a = keys[e.code]; if (a !== undefined) input.release(a); });

world.addSystem("simulation", "playerMove", (w, dt) => {
  const sp = 4 * dt; const t = w.get(player, Transform)!;
  let dx = 0, dy = 0;
  if (input.isDown(Action.MoveUp)) { dx -= sp; dy -= sp; } if (input.isDown(Action.MoveDown)) { dx += sp; dy += sp; }
  if (input.isDown(Action.MoveLeft)) { dx -= sp; dy += sp; } if (input.isDown(Action.MoveRight)) { dx += sp; dy -= sp; }
  if (dx || dy) w.set(player, Transform, { x: t.x + dx, y: t.y + dy });
});

const colors = ["#000", "#3a5", "#495", "#874"];
function render(_w: World, alpha: number): void {
  const dpr = devicePixelRatio || 1;
  if (canvas.width !== innerWidth * dpr) { canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr; }
  ctx.setTransform(dpr, 0, 0, dpr, innerWidth / 2 * dpr, 80 * dpr - 200 * dpr);
  ctx.clearRect(-1e4, -1e4, 2e4, 2e4);
  const { tileW: w, tileH: h } = DEFAULT_ISO;
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const s = worldToScreen(x, y); ctx.fillStyle = colors[map.getTile(x, y)] ?? "#f0f";
    ctx.beginPath(); ctx.moveTo(s.sx, s.sy); ctx.lineTo(s.sx + w / 2, s.sy + h / 2); ctx.lineTo(s.sx, s.sy + h); ctx.lineTo(s.sx - w / 2, s.sy + h / 2); ctx.fill();
  }
  const ts = world.store(Transform), ps = world.store(PrevTransform);
  for (const e of world.query([Transform])) {
    const i = entityIndex(e); const cur = ts.get(i)!; const prev = ps.get(i) ?? cur;
    const s = worldToScreen(lerp(prev.x, cur.x, alpha), lerp(prev.y, cur.y, alpha));
    ctx.fillStyle = "#fd4"; ctx.beginPath(); ctx.arc(s.sx, s.sy + h / 2 - 12, 10, 0, Math.PI * 2); ctx.fill();
  }
}
/** Loop contract: step(world) at fixed dt, then render(world, alpha). */
const loop = createGameLoop(world, { render });
let last = performance.now();
function frame(now: number): void { loop.advance(now - last); last = now; requestAnimationFrame(frame); }
requestAnimationFrame(frame);
