/** Demo simulation systems (fixed 20 Hz tick). These stand in for @engine/gameplay systems. */
import { Action, Transform, entityIndex, type InputState, type World, type Entity } from "@engine/core";
import type { TileMap, ChunkedSpatialIndex } from "@engine/world";
import { TileId, tileHeight } from "../src/index.js";
import { AnimState, AnimStateId, Wetness, BodyTemp } from "./mockGameplay.js";
import { readWeather, weatherTargets, readDayFraction } from "../src/index.js";
import { Wander } from "./scene.js";
import { freezeTick } from "./time.js";

export interface DemoSimOptions { map: TileMap; index: ChunkedSpatialIndex; input: InputState; player: Entity; freezeTime: () => boolean; onHit?: (x: number, y: number) => void }

const walkable = (map: TileMap, x: number, y: number, fromZ: number): boolean => {
  const tx = Math.floor(x), ty = Math.floor(y); const h = tileHeight(map, tx, ty);
  return h >= 0 && map.getTile(tx, ty) !== TileId.Water && Math.abs(h - fromZ) <= 1;
};
function setAnim(w: World, e: Entity, state: number): void {
  const st = w.store(AnimState); const s = st.slot(entityIndex(e)); if (s < 0) return;
  if (st.data.state[s] !== state) { st.data.state[s] = state; st.data.startTick[s] = w.tick; }
}

export function installDemoSystems(world: World, o: DemoSimOptions): void {
  // MOCK exposure (gameplay owns this): wetness follows rain, cold follows snow/night, shivering above a threshold
  world.addSystem("simulation", "mockExposure", (w, dt) => {
    const wr = readWeather(w); const tg = weatherTargets(wr.kind, wr.intensity);
    const night = Math.max(0, Math.cos(readDayFraction(w) * Math.PI * 2)); // 1 at midnight
    const we = w.store(Wetness), bt = w.store(BodyTemp);
    for (let k = 0; k < we.size; k++) { const v = we.data.level[k]!; const target = tg.rain * 255; we.data.level[k] = Math.round(v + Math.sign(target - v) * Math.min(Math.abs(target - v), (target > v ? 60 : 10) * dt)); }
    for (let k = 0; k < bt.size; k++) {
      const cold = Math.min(255, 255 * (tg.snow * 0.9 + night * 0.25 + tg.rain * 0.2));
      bt.data.cold[k] = Math.round(cold); bt.data.shivering[k] = cold > 150 ? 1 : 0; bt.data.heat[k] = 0;
    }
  });

  world.addSystem("simulation", "timeFreeze", (w) => { if (o.freezeTime()) freezeTick(w); });

  world.addSystem("simulation", "playerMove", (w, dt) => {
    const tr = w.store(Transform); const i = entityIndex(o.player); const s = tr.slot(i); if (s < 0) return;
    let dx = 0, dy = 0;
    if (o.input.isDown(Action.MoveUp)) { dx -= 1; dy -= 1; } if (o.input.isDown(Action.MoveDown)) { dx += 1; dy += 1; }
    if (o.input.isDown(Action.MoveLeft)) { dx -= 1; dy += 1; } if (o.input.isDown(Action.MoveRight)) { dx += 1; dy -= 1; }
    if (!dx && !dy) { setAnim(w, o.player, AnimStateId.Idle); return; }
    const len = Math.hypot(dx, dy); dx /= len; dy /= len;
    const sp = 4.5 * dt; const x = tr.data.x[s]!, y = tr.data.y[s]!, z = tr.data.z[s]!;
    const nx = x + dx * sp, ny = y + dy * sp;
    tr.data.facing[s] = Math.atan2(dy, dx);
    if (walkable(o.map, nx, ny, z)) { tr.data.x[s] = nx; tr.data.y[s] = ny; tr.data.z[s] = tileHeight(o.map, Math.floor(nx), Math.floor(ny)); o.index.insert(o.player, nx, ny); }
    tr.markChanged(i);
    setAnim(w, o.player, AnimStateId.Walk);
  });

  world.addSystem("simulation", "zombieWander", (w, dt) => {
    const wa = w.store(Wander), tr = w.store(Transform), an = w.store(AnimState);
    const ps = tr.slot(entityIndex(o.player)); const px = tr.data.x[ps]!, py = tr.data.y[ps]!;
    for (let k = 0; k < wa.size; k++) {
      const e = wa.dense[k]! as Entity; const i = entityIndex(e); const s = tr.slot(i); if (s < 0) continue;
      wa.data.timer[k]! -= dt;
      const x = tr.data.x[s]!, y = tr.data.y[s]!, z = tr.data.z[s]!;
      const a = an.slot(i); const shambler = a >= 0 && (i % 3 === 0);
      if (Math.hypot(px - x, py - y) < 1.2) { // attack the player: face them, play attack, emit a hit vfx every second
        tr.data.facing[s] = Math.atan2(py - y, px - x); setAnim(w, e, AnimStateId.Attack); tr.markChanged(i);
        if ((w.tick + i) % 20 === 0) o.onHit?.(px, py);
        continue;
      }
      if (wa.data.timer[k]! <= 0) {
        if (Math.random() < 0.3) { wa.data.dx[k] = 0; wa.data.dy[k] = 0; }
        else { const ang = Math.random() * Math.PI * 2; wa.data.dx[k] = Math.cos(ang); wa.data.dy[k] = Math.sin(ang); }
        wa.data.timer[k] = 1 + Math.random() * 4;
      }
      const dx = wa.data.dx[k]!, dy = wa.data.dy[k]!;
      if (!dx && !dy) { setAnim(w, e, AnimStateId.Idle); continue; }
      const sp = wa.data.speed[k]! * (shambler ? 0.5 : 1) * dt; const nx = x + dx * sp, ny = y + dy * sp;
      if (walkable(o.map, nx, ny, z)) { tr.data.x[s] = nx; tr.data.y[s] = ny; tr.data.z[s] = tileHeight(o.map, Math.floor(nx), Math.floor(ny)); o.index.insert(e, nx, ny); }
      else wa.data.timer[k] = 0;
      tr.data.facing[s] = Math.atan2(dy, dx); tr.markChanged(i);
      setAnim(w, e, shambler ? AnimStateId.Shamble : AnimStateId.Walk);
    }
  });
}
