import type { DeviceClass } from "./devices.js";
import type { Binding } from "./model.js";
import type { InputSystem } from "./system.js";

export type PadLayout = "xbox" | "playstation" | "switch" | "generic";
const PS: Record<string, string> = { a: "cross", b: "circle", x: "square", y: "triangle", lb: "l1", rb: "r1", lt: "l2", rt: "r2", select: "share", start: "options", ls: "l3", rs: "r3" };
const NS: Record<string, string> = { a: "b", b: "a", x: "y", y: "x", lb: "l", rb: "r", lt: "zl", rt: "zr", select: "minus", start: "plus", ls: "lstick", rs: "rstick" };
const XB: Record<string, string> = { select: "view", start: "menu" };
/** Glyph id for one control (Art supplies sprites under these ids in the manifest `glyphs` map). */
export function glyphFor(control: string, layout: PadLayout = "generic"): string {
  const [dev, ...rest] = control.split("."); const name = rest.join(".");
  if (dev === "key") return `kbm.key.${name.replace(/^Key/, "").replace(/^Digit/, "").replace(/(Left|Right)$/, "").toLowerCase()}`;
  if (dev === "mouse") return `kbm.mouse.${name.startsWith("wheel") ? "wheel" : name.toLowerCase()}`;
  if (dev === "pad") {
    const stick = /^([lr])[xy]$/.exec(name); const n = stick ? `${stick[1]}s` : name;
    const mapped = layout === "playstation" ? PS[n] ?? n : layout === "switch" ? NS[n] ?? n : layout === "xbox" ? XB[n] ?? n : n;
    return `gamepad.${layout}.${mapped}`;
  }
  if (dev === "touch") { const [kind, id] = name.split("."); return kind === "btn" ? `touch.button.${id}` : kind === "move" || kind === "aim" ? `touch.joystick` : `touch.${(kind ?? "tap").toLowerCase()}`; }
  return `generic.${control}`;
}
export interface Prompt { glyphs: string[]; interaction: string; modifiers: string[] }
/** Glyph ids for an action on a device class (first binding in the given or active contexts). */
export function promptFor(input: InputSystem, action: string, device: DeviceClass, layout: PadLayout = (input.profile(device)?.layout as PadLayout) ?? "generic", context?: string): Prompt | undefined {
  const ctxs = context ? [context] : [...input.contextStack].reverse().concat(Object.keys(input.profile(device)?.bindings ?? {}));
  for (const c of ctxs) {
    const b = input.bindings(device, c).find((x) => x.binding.action === action)?.binding; if (!b) continue;
    return { glyphs: dedupe(controlsFor(b).map((x) => glyphFor(x, layout))), interaction: b.interaction?.type ?? "press", modifiers: (b.modifiers ?? []).map((m) => glyphFor(m, layout)) };
  }
  return undefined;
}
const controlsFor = (b: Binding): string[] => b.control ? [b.control] : b.chord ? b.chord : b.composite ? Object.values(b.composite).filter((v): v is string => typeof v === "string") : [];
const dedupe = (a: string[]) => [...new Set(a)];
