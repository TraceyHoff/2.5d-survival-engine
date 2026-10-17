import type { DeviceClass } from "./devices.js";
import type { Processor } from "./processors.js";

export type ActionType = "button" | "axis1D" | "axis2D";
export interface ActionDef { name: string; type: ActionType; /** human label key for UI */ label?: string }
export type Interaction =
  | { type: "press" }
  | { type: "hold"; ms: number }
  | { type: "longPress"; ms: number }
  | { type: "tap"; maxMs?: number }
  | { type: "doubleTap"; gapMs?: number; maxMs?: number }
  | { type: "toggle" }
  | { type: "repeat"; delayMs?: number; rateMs?: number };
export type Composite =
  | { up?: string; down?: string; left?: string; right?: string }
  | { x: string; y: string }
  | { negative: string; positive: string };
export interface Binding {
  action: string;
  /** Single control path (see devices.ts). */
  control?: string;
  /** Several controls combined into an axis (WASD -> 2D, stick axes, Q/E -> 1D). */
  composite?: Composite;
  /** Controls that must also be held (Shift+click). Bindings with more satisfied modifiers shadow plainer ones on the same control. */
  modifiers?: string[];
  /** All controls must be held together (order-free). Alternative to `control`. */
  chord?: string[];
  interaction?: Interaction;
  processors?: Processor[];
  /** Press point for analog controls acting as buttons (default 0.5). */
  threshold?: number;
}
/** Binding profile for one device class (JSON files in packages/input/profiles/). */
export interface BindingProfile { id: string; deviceClass: DeviceClass; layout?: string; bindings: Record<string, Binding[]> }
export interface ContextDef {
  name: string;
  /** Higher = evaluated first. */
  priority: number;
  /** Block lower contexts entirely (except passthrough actions). */
  consume?: boolean;
  /** Actions of lower contexts still allowed while this context consumes; per device class or for all. */
  passthrough?: readonly string[] | Partial<Record<DeviceClass, readonly string[]>>;
  /** Text entry: keyboard keys never reach lower contexts (except passthrough); gameplay keys are suppressed. */
  textEntry?: boolean;
}
export const controlsOf = (b: Binding): string[] => {
  const out: string[] = []; if (b.control) out.push(b.control); if (b.chord) out.push(...b.chord);
  if (b.composite) for (const v of Object.values(b.composite)) if (typeof v === "string") out.push(v);
  return out;
};
export const bindingSignature = (b: Binding): string => `${[...controlsOf(b)].sort().join("+")}|${[...(b.modifiers ?? [])].sort().join("+")}|${b.interaction?.type ?? "press"}`;
