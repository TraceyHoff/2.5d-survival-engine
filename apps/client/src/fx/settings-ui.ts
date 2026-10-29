/**
 * ADR-214 Visual-effects rows for the Settings panel: plain cycle/toggle buttons (touch, gamepad UINav A, mouse/keyboard);
 * every change applies live and persists immediately (same pattern as the ADR-117 audio rows).
 */
import type { FxSettings } from "./settings.js";
export interface FxControls { get(): FxSettings; set(s: FxSettings): void; click?(): void }
type Row = { key: keyof FxSettings; label: string; values: readonly (string | boolean)[]; names: readonly string[] };
const ROWS: readonly Row[] = [
  { key: "effects", label: "Effects", values: ["full", "reduced", "off"], names: ["Full", "Reduced", "Off"] },
  { key: "shake", label: "Screen shake", values: [true, false], names: ["On", "Off"] },
  { key: "hitStop", label: "Hit-stop", values: [true, false], names: ["On", "Off"] },
  { key: "vignette", label: "Damage vignette", values: [true, false], names: ["On", "Off"] },
  { key: "ambient", label: "Ambient life", values: [true, false], names: ["On", "Off"] },
  { key: "reduceMotion", label: "Reduce motion", values: ["auto", "on", "off"], names: ["Auto (system)", "On", "Off"] },
];
export function fxSettingsRows(c: FxControls, doc: Document = document): HTMLElement {
  const box = doc.createElement("div"); box.dataset["role"] = "fx-settings";
  const h = doc.createElement("h3"); h.textContent = "Visual effects"; box.append(h);
  for (const r of ROWS) {
    const b = doc.createElement("button"); b.type = "button"; b.className = "alt"; b.dataset["key"] = `fx-${r.key}`;
    const show = (): void => { const v = c.get()[r.key]; const i = Math.max(0, r.values.indexOf(v)); b.textContent = `${r.label}: ${r.names[i]}`; if (typeof v === "boolean") b.setAttribute("aria-pressed", String(v)); };
    b.addEventListener("click", () => { const s = c.get(); const i = r.values.indexOf(s[r.key]); c.set({ ...s, [r.key]: r.values[(i + 1) % r.values.length] } as FxSettings); c.click?.(); show(); });
    show(); box.append(b);
  }
  return box;
}
