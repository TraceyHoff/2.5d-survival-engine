import { BinaryReader, BinaryWriter, readRecord, writeRecord, type FieldReader, type FieldWriter } from "./serialize.js";
import type { Schema, SchemaValues } from "./schema.js";

/**
 * Generic input. Gameplay defines action bits with defineActions(); core only carries a u32 mask.
 * Commands are schema-defined records (numeric fields only) registered in a CommandRegistry (ids = registration order).
 */
export type ActionMasks<K extends string> = { readonly [P in K]: number };
/** Extend an existing mask set append-only (keeps existing bits; new names get the next free bits). */
export function extendActions<const B extends string, const K extends string>(base: ActionMasks<B>, names: readonly K[]): ActionMasks<B | K> {
  const o: Record<string, number> = { ...base }; let next = Object.keys(base).length;
  for (const n of names) { if (n in o) throw new Error(`duplicate action ${n}`); if (next >= 32) throw new Error("at most 32 actions"); o[n] = (1 << next++) >>> 0; }
  return Object.freeze(o) as ActionMasks<B | K>;
}
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

/** How aimX/aimY are interpreted. */
export const enum AimMode { Direction = 0, WorldPoint = 1 }
/**
 * One sampled input tick. v2 appends optional analog/extended fields (absent = legacy behavior):
 *  moveX/moveY analog [-1,1] (q8 on the wire; the digital move bits stay as fallback), aimMode, ghostNudgeX/Y [-1,1] (q8),
 *  edges = edge-triggered action pulses (gameplay-defined bit order), set only on the tick they fire.
 */
export interface InputFrame {
  tick: number; actions: number; aimX: number; aimY: number; commands: Command[];
  moveX?: number; moveY?: number; aimMode?: AimMode; ghostNudgeX?: number; ghostNudgeY?: number; edges?: number;
}
/** Input frame codec version: 1 = legacy layout; 2 = legacy + u8 ext flags + optional ext fields. */
export const INPUT_FRAME_VERSION = 2;
const q8 = (v: number): number => Math.max(-127, Math.min(127, Math.round(Math.max(-1, Math.min(1, v)) * 127)));

/** Wire: u32 tick, u32 actions, f32 aimX, f32 aimY, u8 count, count x (u8 type, record). */
export function encodeInputFrame(f: InputFrame, reg: CommandRegistry, w: FieldWriter = new BinaryWriter(64), version = INPUT_FRAME_VERSION): FieldWriter {
  w.write("u32", f.tick); w.write("u32", f.actions >>> 0); w.write("f32", f.aimX); w.write("f32", f.aimY);
  if (f.commands.length > 255) throw new Error("too many commands in frame");
  w.write("u8", f.commands.length);
  for (const c of f.commands) {
    const d = reg.def(c.type); if (!d) throw new Error(`unknown command ${c.type}`);
    w.write("u8", c.type); writeRecord(w, d.schema, c.values as never);
  }
  if (version >= 2) {
    const hasMove = f.moveX !== undefined || f.moveY !== undefined, hasNudge = f.ghostNudgeX !== undefined || f.ghostNudgeY !== undefined, hasEdges = !!f.edges;
    w.write("u8", (hasMove ? 1 : 0) | (f.aimMode === AimMode.WorldPoint ? 2 : 0) | (hasNudge ? 4 : 0) | (hasEdges ? 8 : 0));
    if (hasMove) { w.write("i8", q8(f.moveX ?? 0)); w.write("i8", q8(f.moveY ?? 0)); }
    if (hasNudge) { w.write("i8", q8(f.ghostNudgeX ?? 0)); w.write("i8", q8(f.ghostNudgeY ?? 0)); }
    if (hasEdges) w.write("u32", f.edges! >>> 0);
  }
  return w;
}
export function decodeInputFrame(r: FieldReader, reg: CommandRegistry, version = INPUT_FRAME_VERSION): InputFrame {
  const tick = r.read("u32"), actions = r.read("u32"), aimX = r.read("f32"), aimY = r.read("f32"); const n = r.read("u8");
  const commands: Command[] = [];
  for (let i = 0; i < n; i++) {
    const type = r.read("u8"); const d = reg.def(type); if (!d) throw new Error(`unknown command ${type}`);
    commands.push({ type, values: readRecord(r, d.schema) as Command["values"] });
  }
  const f: InputFrame = { tick, actions, aimX, aimY, commands };
  if (version >= 2) {
    const fl = r.read("u8");
    if (fl & 1) { f.moveX = r.read("i8") / 127; f.moveY = r.read("i8") / 127; }
    if (fl & 2) f.aimMode = AimMode.WorldPoint;
    if (fl & 4) { f.ghostNudgeX = r.read("i8") / 127; f.ghostNudgeY = r.read("i8") / 127; }
    if (fl & 8) f.edges = r.read("u32");
  }
  return f;
}
/** Analog move if present, else derived from the 4 digital move bits (normalized). */
export function frameMove(f: Pick<InputFrame, "actions" | "moveX" | "moveY">, bits: { up: number; down: number; left: number; right: number }): { x: number; y: number } {
  if (f.moveX !== undefined || f.moveY !== undefined) return { x: f.moveX ?? 0, y: f.moveY ?? 0 };
  let x = (f.actions & bits.right ? 1 : 0) - (f.actions & bits.left ? 1 : 0), y = (f.actions & bits.down ? 1 : 0) - (f.actions & bits.up ? 1 : 0);
  const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; } return { x, y };
}
export const inputFrameToBytes = (f: InputFrame, reg: CommandRegistry, version = INPUT_FRAME_VERSION): Uint8Array => (encodeInputFrame(f, reg, new BinaryWriter(64), version) as BinaryWriter).finish();
export const inputFrameFromBytes = (b: Uint8Array, reg: CommandRegistry, version = INPUT_FRAME_VERSION): InputFrame => decodeInputFrame(new BinaryReader(b), reg, version);

/** Device-side accumulator: devices press/release action masks and queue commands; sample() drains commands. */
export class InputState {
  private actions = 0; private commands: Command[] = []; aimX = 0; aimY = 0;
  private edges = 0;
  /** Optional v2 fields; left undefined they are omitted from frames. */
  moveX: number | undefined; moveY: number | undefined; aimMode: AimMode | undefined; ghostNudgeX: number | undefined; ghostNudgeY: number | undefined;
  /** Edge-triggered pulse: included in the next sampled frame only. */
  pulse(edgeMask: number): void { this.edges = (this.edges | edgeMask) >>> 0; }
  /** Replace the held action mask (used by input systems that recompute all bits each tick). */
  setActions(mask: number): void { this.actions = mask >>> 0; }
  press(mask: number): void { this.actions = (this.actions | mask) >>> 0; }
  release(mask: number): void { this.actions = (this.actions & ~mask) >>> 0; }
  isDown(mask: number): boolean { return (this.actions & mask) !== 0; }
  queue(cmd: Command): void { this.commands.push(cmd); }
  sample(tick: number): InputFrame {
    const c = this.commands; this.commands = [];
    const f: InputFrame = { tick, actions: this.actions, aimX: this.aimX, aimY: this.aimY, commands: c };
    if (this.moveX !== undefined || this.moveY !== undefined) { f.moveX = this.moveX ?? 0; f.moveY = this.moveY ?? 0; }
    if (this.aimMode !== undefined) f.aimMode = this.aimMode;
    if (this.ghostNudgeX !== undefined || this.ghostNudgeY !== undefined) { f.ghostNudgeX = this.ghostNudgeX ?? 0; f.ghostNudgeY = this.ghostNudgeY ?? 0; }
    if (this.edges) { f.edges = this.edges; this.edges = 0; }
    return f;
  }
}

/** @deprecated legacy default action masks for demos; gameplay should use defineActions(). */
export const enum Action { MoveUp = 1, MoveDown = 2, MoveLeft = 4, MoveRight = 8, Primary = 16, Secondary = 32, Interact = 64, Build = 128 }
