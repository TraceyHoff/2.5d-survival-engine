/** Demo simulation systems (fixed 20 Hz tick). These would live in @engine/gameplay in the real game. */
import { Action, TimeOfDay, Transform, entityIndex, type InputState, type World, type Entity } from "@engine/core";
import { type TileMap } from "@engine/world";
import { Sprite, SpriteFlag, TileId, FrameId, tileHeight } from "../src/index.js";
import { Anim, Wander } from "./worldgen.js";

export interface DemoSimOptions { map: TileMap; input: InputState; player: Entity; freezeTime: () => boolean }

const walkable = (map: TileMap, x: number, y: number, fromZ: number): boolean => {
  const tx = Math.floor(x), ty = Math.floor(y);
  const h = tileHeight(map, tx, ty);
  return h >= 0 && map.getTile(tx, ty) !== TileId.Water && Math.abs(h - fromZ) <= 1;
};

/** Facing -> front/back frame + horizontal flip (sprites have S and N views). */
function faceSprite(world: World, e: Entity, dx: number, dy: number, front: number, back: number): void {
  const sp = world.store(Sprite); const s = sp.slot(entityIndex(e)); if (s < 0) return;
  const sx = dx - dy, sy = dx + dy; // screen-space direction
  sp.data.frameId[s] = sy >= 0 ? front : back;
  sp.data.flags[s] = (sp.data.flags[s]! & ~SpriteFlag.FlipX) | (sx < 0 ? SpriteFlag.FlipX : 0);
}

export function installDemoSystems(world: World, o: DemoSimOptions): void {
  world.addSystem("simulation", "timeOfDay", (w) => {
    if (o.freezeTime()) return;
    const tod = w.env(TimeOfDay); tod.t += 1 / tod.dayLengthTicks;
    if (tod.t >= 1) { tod.t -= 1; tod.day++; }
  });

  world.addSystem("simulation", "playerMove", (w, dt) => {
    const tr = w.store(Transform); const s = tr.slot(entityIndex(o.player)); if (s < 0) return;
    let dx = 0, dy = 0;
    // arrow keys map to screen directions: up = -x-y, right = +x-y
    if (o.input.isDown(Action.MoveUp)) { dx -= 1; dy -= 1; } if (o.input.isDown(Action.MoveDown)) { dx += 1; dy += 1; }
    if (o.input.isDown(Action.MoveLeft)) { dx -= 1; dy += 1; } if (o.input.isDown(Action.MoveRight)) { dx += 1; dy -= 1; }
    if (!dx && !dy) return;
    const len = Math.hypot(dx, dy); dx /= len; dy /= len;
    const sp = 4.5 * dt; const x = tr.data.x[s]!, y = tr.data.y[s]!, z = tr.data.z[s]!;
    const nx = x + dx * sp, ny = y + dy * sp;
    if (walkable(o.map, nx, ny, z)) {
      tr.data.x[s] = nx; tr.data.y[s] = ny; tr.data.z[s] = tileHeight(o.map, Math.floor(nx), Math.floor(ny));
      tr.data.facing[s] = Math.atan2(dy, dx); tr.markChanged(entityIndex(o.player));
    }
    faceSprite(w, o.player, dx, dy, FrameId.PlayerS, FrameId.PlayerN);
  });

  world.addSystem("simulation", "wander", (w, dt) => {
    const wa = w.store(Wander), tr = w.store(Transform);
    for (let k = 0; k < wa.size; k++) {
      const e = wa.dense[k]!; const i = entityIndex(e); const s = tr.slot(i); if (s < 0) continue;
      let t = wa.data.timer[k]! - dt;
      let dx = wa.data.dx[k]!, dy = wa.data.dy[k]!;
      if (t <= 0) { const a = w.rng.range(0, Math.PI * 2); dx = Math.cos(a); dy = Math.sin(a); t = w.rng.range(1.5, 5); }
      const x = tr.data.x[s]!, y = tr.data.y[s]!, z = tr.data.z[s]!;
      const v = wa.data.speed[k]! * dt; const nx = x + dx * v, ny = y + dy * v;
      if (walkable(o.map, nx, ny, z)) {
        tr.data.x[s] = nx; tr.data.y[s] = ny; tr.data.z[s] = tileHeight(o.map, Math.floor(nx), Math.floor(ny));
        tr.data.facing[s] = Math.atan2(dy, dx); tr.markChanged(i);
      } else { dx = -dx; dy = -dy; t = w.rng.range(0.5, 2); }
      wa.data.dx[k] = dx; wa.data.dy[k] = dy; wa.data.timer[k] = t;
      const skin = wa.data.skin[k]!;
      faceSprite(w, e, dx, dy, skin ? FrameId.Survivor1S : FrameId.Survivor0S, skin ? FrameId.Survivor1N : FrameId.Survivor0N);
    }
  });

  world.addSystem("postSim", "spriteAnim", (w) => {
    const an = w.store(Anim), sp = w.store(Sprite);
    for (let k = 0; k < an.size; k++) {
      const i = entityIndex(an.dense[k]!); const s = sp.slot(i); if (s < 0) continue;
      const per = an.data.ticksPerFrame[k]! || 1;
      sp.data.frameId[s] = an.data.base[k]! + (Math.floor((w.tick + i) / per) % an.data.count[k]!);
    }
  });
}
