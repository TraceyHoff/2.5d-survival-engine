/**
 * ADR-144 tutorial: control labels read from the live binding profiles (never hardcoded key names).
 * A "chip" is one control as the player sees it: short text plus the @engine/input glyph id (Art can map it to a sprite).
 */
import { glyphFor, type PadLayout } from "@engine/input";
import { GAME_MENUS } from "../game-menus.js";
import { TOUCH_LABELS } from "../touch-overlay.js";

export type TutDevice = "keyboardMouse" | "gamepad" | "touch";
export interface Chip { text: string; glyph: string; icon?: string }
/** One way to do an action: chips pressed together (modifiers first). `how` = "tap" / "hold" / "longPress" … */
export interface Combo { chips: Chip[]; how: string; sep?: string }
interface BindingLike { action: string; control?: string; chord?: string[]; composite?: Record<string, string | undefined>; modifiers?: string[]; interaction?: { type: string } }
export interface BindingSource { bindings(device: TutDevice, context: string): readonly { binding: BindingLike }[]; profile?(device: TutDevice): { layout?: string } | undefined }

const KEY_NAMES: Record<string, string> = { ShiftLeft: "Shift", ShiftRight: "Shift", ControlLeft: "Ctrl", ControlRight: "Ctrl", AltLeft: "Alt", Space: "Space", Enter: "Enter", Escape: "Esc", Tab: "Tab", Slash: "/", Minus: "-", Equal: "+", Backspace: "Backspace", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", BracketLeft: "[", BracketRight: "]", PageUp: "PgUp", PageDown: "PgDn" };
const PAD_NAMES: Record<PadLayout, Record<string, string>> = {
  xbox: { select: "View", start: "Menu" },
  playstation: { a: "✕", b: "○", x: "□", y: "△", lb: "L1", rb: "R1", lt: "L2", rt: "R2", select: "Share", start: "Options", ls: "L3", rs: "R3" },
  switch: { a: "B", b: "A", x: "Y", y: "X", lb: "L", rb: "R", lt: "ZL", rt: "ZR", select: "−", start: "+" },
  generic: {},
};
const PAD_COMMON: Record<string, string> = { ls: "L-stick click", rs: "R-stick click", lx: "Left stick", ly: "Left stick", rx: "Right stick", ry: "Right stick", dup: "D-pad ↑", ddown: "D-pad ↓", dleft: "D-pad ←", dright: "D-pad →" };
const MENU_IDS: Record<string, string> = { inventory: "inventory", crafting: "crafting", map: "map", chat: "chat", social: "party", build: "build" };

/** Player-facing name of one control string ("key.KeyW" → "W", "pad.rt" → "RT"/"R2", "touch.btn.context" → "✋ Use"). */
export function controlChip(control: string, layout: PadLayout = "generic"): Chip {
  const glyph = glyphFor(control, layout);
  const [dev, ...rest] = control.split("."); const name = rest.join(".");
  if (dev === "key") return { text: KEY_NAMES[name] ?? name.replace(/^Key|^Digit/, ""), glyph };
  if (dev === "mouse") return { text: name === "left" ? "Left click" : name === "right" ? "Right click" : name.startsWith("wheel") ? "Mouse wheel" : name === "middle" ? "Middle click" : "Mouse", glyph };
  if (dev === "pad") return { text: PAD_NAMES[layout][name] ?? PAD_COMMON[name] ?? name.toUpperCase(), glyph };
  if (dev === "touch") {
    const [kind = "", id = ""] = name.split(".");
    if (kind === "move") return { text: "Left joystick", glyph, icon: "🕹" };
    if (kind === "aim") return { text: "Right joystick", glyph, icon: "🕹" };
    if (kind === "pinch") return { text: "Pinch with two fingers", glyph, icon: "🤏" };
    if (kind === "swipe") return { text: "Swipe", glyph, icon: "👆" };
    if (kind === "hotbar") return { text: `Slot ${id}`, glyph, icon: "◎" };
    if (kind === "btn") {
      const menu = MENU_IDS[id]; const m = menu ? GAME_MENUS.find((x) => x.id === menu) : undefined;
      if (m) return { text: `${m.title} button`, glyph, icon: m.icon };
      const l = TOUCH_LABELS[id]; return { text: l ? `${l.text} button` : `${id[0]?.toUpperCase() ?? ""}${id.slice(1)} button`, glyph, ...(l ? { icon: l.icon } : {}) };
    }
    return { text: kind === "tap" ? "Tap" : kind === "doubleTap" ? "Double tap" : kind === "longPress" ? "Press and hold" : kind, glyph, icon: "👆" };
  }
  return { text: control, glyph };
}
const COMP_ORDER = ["up", "left", "down", "right"]; const cOrd = (k: string): number => { const i = COMP_ORDER.indexOf(k); return i < 0 ? 9 : i; };
const controlsOf = (b: BindingLike): string[] => b.control ? [b.control] : b.chord ? [...b.chord] : b.composite ? Object.entries(b.composite).sort(([a], [c]) => cOrd(a) - cOrd(c)).map(([, v]) => v).filter((v): v is string => typeof v === "string") : [];

/** Every binding of `action` on `device` in `context`, as combos (modifiers + controls). Sticks collapse to one chip. */
export function actionCombos(src: BindingSource, device: TutDevice, action: string, context = "Gameplay"): Combo[] {
  const layout = (src.profile?.(device)?.layout as PadLayout | undefined) ?? (device === "gamepad" ? "xbox" : "generic");
  const out: Combo[] = []; const seen = new Set<string>();
  for (const { binding: b } of src.bindings(device, context)) {
    if (b.action !== action) continue;
    const chips: Chip[] = [];
    for (const c of [...(b.modifiers ?? []), ...controlsOf(b)]) { const ch = controlChip(c, layout); if (!chips.some((x) => x.text === ch.text)) chips.push(ch); }
    const key = chips.map((c) => c.text).join("+"); if (!chips.length || seen.has(key)) continue; seen.add(key);
    out.push({ chips, how: b.interaction?.type ?? "press", ...(b.composite && !b.modifiers?.length ? { sep: " " } : {}) });
  }
  return out;
}
/** Menus with a desktop hotkey but no Gameplay binding (Skills J, Party P …) come from GAME_MENUS. */
export function menuHotkeyCombos(menuId: string): Combo[] {
  const m = GAME_MENUS.find((x) => x.id === menuId); if (!m) return [];
  return m.hotkeys.map((h) => ({ chips: [controlChip(`key.${h}`)], how: "press" }));
}
const HOW: Record<string, string> = { hold: "hold ", longPress: "hold ", tap: "", press: "", toggle: "" };
/** Plain text for combos: "W A S D or ↑ ↓ ← →", "hold X", "LB + View". */
export function combosText(cs: readonly Combo[], max = 2): string {
  return cs.slice(0, max).map((c) => `${HOW[c.how] ?? ""}${c.chips.map((x) => x.text).join(c.sep ?? " + ")}`).join(" or ");
}
