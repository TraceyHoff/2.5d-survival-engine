import { BinaryReader, BinaryWriter, readRecord, writeRecord, type FieldReader, type FieldWriter } from "./serialize.js";
import type { Schema, SchemaValues } from "./schema.js";

/**
 * Generic input. Gameplay defines action bits with defineActions(); core only carries a u32 mask.
 * Commands are schema-defined records (numeric fields only) registered in a CommandRegistry (ids = registration order).
 */
export type ActionMasks<K extends string> = { readonly [P in K]: number };
export function defineActions<const K extends string>(names: readonly K[]): ActionMasks<K> {
  if (names.length > 32) throw new Error("defineActions: at most 32 actions");
  const o = {} as Record<string, number>;
  names.forEach((n, i) => { if (n in o) throw new Error(`duplicate action ${n}`); o[n] = (1 << i) >>> 0; });
  return Object.freeze(o) as ActionMasks<K>;
}

export interface CommandDef<S extends Schema = Schema> { readonly name: string; readonly schema: S }
export const defineCommand = <S extends Schema>(name: string, schema: S): CommandDef<S> => ({ name, schema });
export interface Command { type: number; values: Record<string, number | number[]> }

export class CommandRegistry {
  private defs: CommandDef[] = [];
  private ids = new Map<CommandDef, number>();
  register(def: CommandDef): number {
    const ex = this.ids.get(def); if (ex !== undefined) return ex;
    if (this.defs.length >= 255) throw new Error("too many command types");
    this.defs.push(def); this.ids.set(def, this.defs.length - 1); return this.defs.length - 1;
  }
  idOf(def: CommandDef): number { const id = this.ids.get(def); if (id === undefined) throw new Error(`command not registered: ${def.name}`); return id; }
  def(id: number): CommandDef | undefined { return this.defs[id]; }
  make<S extends Schema>(def: CommandDef<S>, values: SchemaValues<S>): Command { return { type: this.idOf(def), values: values as Command["values"] }; }
  is<S extends Schema>(cmd: Command, def: CommandDef<S>): cmd is Command & { values: SchemaValues<S> } { return this.ids.get(def) === cmd.type; }
}

export interface InputFrame { tick: number; actions: number; aimX: number; aimY: number; commands: Command[] }

/** Wire: u32 tick, u32 actions, f32 aimX, f32 aimY, u8 count, count x (u8 type, record). */
export function encodeInputFrame(f: InputFrame, reg: CommandRegistry, w: FieldWriter = new BinaryWriter(64)): FieldWriter {
  w.write("u32", f.tick); w.write("u32", f.actions >>> 0); w.write("f32", f.aimX); w.write("f32", f.aimY);
  if (f.commands.length > 255) throw new Error("too many commands in frame");
  w.write("u8", f.commands.length);
  for (const c of f.commands) {
    const d = reg.def(c.type); if (!d) throw new Error(`unknown command ${c.type}`);
    w.write("u8", c.type); writeRecord(w, d.schema, c.values as never);
  }
  return w;
}
export function decodeInputFrame(r: FieldReader, reg: CommandRegistry): InputFrame {
  const tick = r.read("u32"), actions = r.read("u32"), aimX = r.read("f32"), aimY = r.read("f32"); const n = r.read("u8");
  const commands: Command[] = [];
  for (let i = 0; i < n; i++) {
    const type = r.read("u8"); const d = reg.def(type); if (!d) throw new Error(`unknown command ${type}`);
    commands.push({ type, values: readRecord(r, d.schema) as Command["values"] });
  }
  return { tick, actions, aimX, aimY, commands };
}
export const inputFrameToBytes = (f: InputFrame, reg: CommandRegistry): Uint8Array => (encodeInputFrame(f, reg) as BinaryWriter).finish();
export const inputFrameFromBytes = (b: Uint8Array, reg: CommandRegistry): InputFrame => decodeInputFrame(new BinaryReader(b), reg);

/** Device-side accumulator: devices press/release action masks and queue commands; sample() drains commands. */
export class InputState {
  private actions = 0; private commands: Command[] = []; aimX = 0; aimY = 0;
  press(mask: number): void { this.actions = (this.actions | mask) >>> 0; }
  release(mask: number): void { this.actions = (this.actions & ~mask) >>> 0; }
  isDown(mask: number): boolean { return (this.actions & mask) !== 0; }
  queue(cmd: Command): void { this.commands.push(cmd); }
  sample(tick: number): InputFrame {
    const c = this.commands; this.commands = [];
    return { tick, actions: this.actions, aimX: this.aimX, aimY: this.aimY, commands: c };
  }
}

/** @deprecated legacy default action masks for demos; gameplay should use defineActions(). */
export const enum Action { MoveUp = 1, MoveDown = 2, MoveLeft = 4, MoveRight = 8, Primary = 16, Secondary = 32, Interact = 64, Build = 128 }
