/**
 * ADR-117 audio rows for the Settings panel: per bus a "−" / "+" pair (10 % steps), the value, and a mute toggle,
 * plus the low-CPU mode. Plain buttons so touch, gamepad (UINav A / d-pad focus) and mouse/keyboard all work; every
 * change applies live and persists immediately.
 */
import { BUSES, type BusName } from "./bank.js";
import type { AudioSettings } from "./settings.js";
export interface AudioControls { settings: AudioSettings; setVolume(b: BusName, v: number): void; setMuted(b: BusName, m: boolean): void; setSettings(s: AudioSettings): void; play(key: string): number }
const LABEL: Record<BusName, string> = { master: "Master", music: "Music", ambient: "Ambience", sfx: "Effects", ui: "Interface", voice: "Voices" };
export function audioSettingsRows(a: AudioControls, doc: Document = document): HTMLElement {
  const box = doc.createElement("div"); box.dataset["role"] = "audio-settings";
  const h = doc.createElement("h3"); h.textContent = "Audio"; box.append(h);
  for (const b of BUSES) {
    const row = doc.createElement("div"); row.className = "gm-grid"; row.dataset["bus"] = b; row.style.cssText = "display:flex;align-items:center;gap:6px";
    const name = doc.createElement("span"); name.textContent = LABEL[b]; name.style.minWidth = "6.5em";
    const val = doc.createElement("span"); val.dataset["role"] = "value"; val.style.minWidth = "3.5em"; val.style.textAlign = "center";
    const mk = (text: string, key: string, label: string, fn: () => void): HTMLButtonElement => { const x = doc.createElement("button"); x.type = "button"; x.className = "alt"; x.textContent = text; x.dataset["key"] = key; x.setAttribute("aria-label", label); x.addEventListener("click", () => { fn(); show(); }); return x; };
    const step = (d: number): void => { a.setVolume(b, Math.round((a.settings.volume[b] + d) * 10) / 10); a.play("ui.slider"); };
    const minus = mk("−", `vol-${b}-down`, `${LABEL[b]} volume down`, () => step(-0.1));
    const plus = mk("+", `vol-${b}-up`, `${LABEL[b]} volume up`, () => step(0.1));
    const mute = mk("", `mute-${b}`, `Mute ${LABEL[b]}`, () => { a.setMuted(b, !a.settings.muted[b]); a.play("ui.click"); });
    const show = (): void => { val.textContent = `${Math.round(a.settings.volume[b] * 100)}%`; mute.textContent = a.settings.muted[b] ? "Muted" : "Mute"; mute.setAttribute("aria-pressed", String(a.settings.muted[b])); mute.className = a.settings.muted[b] ? "" : "alt"; };
    show(); row.append(name, minus, val, plus, mute); box.append(row);
  }
  const lc = doc.createElement("button"); lc.type = "button"; lc.className = "alt"; lc.dataset["key"] = "audio-lowcpu";
  const modes = ["auto", "on", "off"] as const; const showLc = (): void => { lc.textContent = `Low-CPU audio: ${a.settings.lowCpu === "auto" ? "Auto" : a.settings.lowCpu === "on" ? "On" : "Off"}`; };
  lc.addEventListener("click", () => { const i = modes.indexOf(a.settings.lowCpu); a.setSettings({ ...a.settings, lowCpu: modes[(i + 1) % 3]! }); a.play("ui.click"); showLc(); });
  showLc(); box.append(lc); return box;
}
