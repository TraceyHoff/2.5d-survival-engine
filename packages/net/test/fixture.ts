import { Transform, World, defineComponent, type Entity } from "@engine/core";
import type { InputCmd } from "../src/index.js";

export const SPEED = 4; // tiles/s
export const DT = 1 / 20;
/** Local (non-networked) per-entity input, set by applyInput, read by the move system. */
export const Control = defineComponent("Control", { buttons: "u16" });
/** Networked, quantized; used to test component add/remove replication. */
export const Buff = defineComponent("Buff", { power: { type: "f32", quant: { bits: 10, min: 0, max: 10 } }, kind: "u8" }, { networked: true });
export const BTN_RIGHT = 1, BTN_LEFT = 2, BTN_UP = 4, BTN_DOWN = 8;

export function makeWorld(opts: { wallX?: number; extra?: boolean } = {}): World {
  const w = new World({ seed: 7 });
  w.register(Control); w.register(Buff);
  if (opts.extra) w.register(defineComponent("Extra", { a: "u8" }, { networked: true }));
  w.addSystem("simulation", "move", (world, dt) => {
    for (const e of world.query([Control, Transform])) {
      const b = world.getField(e, Control, "buttons")!;
      const dx = ((b & BTN_RIGHT ? 1 : 0) - (b & BTN_LEFT ? 1 : 0)) * SPEED * dt;
      const dy = ((b & BTN_DOWN ? 1 : 0) - (b & BTN_UP ? 1 : 0)) * SPEED * dt;
      if (dx || dy) world.set(e, Transform, { x: world.getField(e, Transform, "x")! + dx, y: world.getField(e, Transform, "y")! + dy });
    }
  });
  if (opts.wallX !== undefined) {
    const wall = opts.wallX; // server-only rule the client does not predict
    w.addSystem("simulation", "wall", (world) => {
      for (const e of world.query([Transform])) if (world.getField(e, Transform, "x")! > wall) world.setField(e, Transform, "x", wall);
    });
  }
  return w;
}

export function applyInput(world: World, e: Entity, cmd: InputCmd | null): void {
  if (!world.has(e, Control)) world.add(e, Control);
  world.setField(e, Control, "buttons", cmd ? cmd.buttons : 0);
}

/** Connect a NetClient over loopback: lets the async transport connect + Hello happen, then delivers. */
export async function join<T>(net: { advance(ms: number): void }, client: { connect(token?: Uint8Array): Promise<T> }, token?: Uint8Array): Promise<T> {
  const p = client.connect(token);
  p.catch(() => undefined);
  await new Promise((r) => setTimeout(r, 0));
  net.advance(250); // covers simulated round-trip latency
  return p;
}
