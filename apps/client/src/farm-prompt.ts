/**
 * ADR-110 follow-up: on-screen farming context prompt (Till / Plant / Water / Fertilize / Harvest) and short failure toasts.
 * The prompt names the key for the active device (keyboard / gamepad binding of QuickUse, or Interact for Harvest) and is
 * a tappable button on touch. Pure decisions live in @engine/gameplay farmPrompt; this is DOM only.
 * Hooks: `#farm-prompt` (`data-action`, `data-fail`), `#farm-toast`.
 */
import { FARM_FAIL_TEXT, FarmFail, farmPrompt, husbandryPrompt, TameFail, treesOf, treeShortName, type FarmPrompt } from "@engine/gameplay";
import type { Entity, World } from "@engine/core";

/** "key.KeyX" -> "X", "pad.b" -> "B", "mouse.left" -> "LMB". */
export function controlLabel(control: string | undefined): string {
  if (!control) return "";
  const [dev, c = ""] = control.split(/\.(.*)/s) as [string, string];
  if (dev === "key") return c.replace(/^Key|^Digit/, "");
  if (dev === "pad") return c.toUpperCase();
  if (dev === "mouse") return c === "left" ? "LMB" : c === "right" ? "RMB" : c;
  return "";
}
export type PromptDevice = "keyboardMouse" | "gamepad" | "touch";
export const promptText = (p: FarmPrompt, keyLabel: string, device: PromptDevice): string =>
  device === "touch" || !keyLabel ? p.label : `[${keyLabel}] ${p.label}`;

export interface FarmPromptDeps {
  world: () => World; player: () => Entity | undefined; device: () => PromptDevice;
  /** binding label for an action on the active device */ key: (action: "QuickUse" | "Interact") => string;
  hidden: () => boolean; use: (p: FarmPrompt) => void;
}
/** Keyboard / gamepad QuickUse press: Harvest stays on Interact (gather), so only the Use actions fire here. */
export const quickUseFires = (p: FarmPrompt | undefined): boolean => !!p && p.action !== "Harvest";
export function mountFarmPrompt(root: HTMLElement, d: FarmPromptDeps): { destroy(): void; toast(text: string): void; trigger(): void } {
  const style = document.createElement("style");
  style.textContent = `#farm-prompt{position:absolute;left:50%;bottom:calc(110px + var(--sab,0px));transform:translateX(-50%);z-index:5;font:600 13px Fredoka,system-ui,sans-serif;color:#FFFAF0;background:rgba(20,16,12,.72);border:2px solid #E6C47E;border-radius:10px;padding:6px 12px;pointer-events:none;white-space:nowrap}
#farm-prompt[data-touch="true"]{pointer-events:auto;min-height:44px;min-width:88px;cursor:pointer}#farm-prompt[data-fail]:not([data-fail="0"]){border-color:#C0584A;color:#FFD6C8}
#farm-toast{position:absolute;left:50%;top:calc(18% + var(--sat,0px));transform:translateX(-50%);z-index:6;font:600 13px Fredoka,system-ui,sans-serif;color:#FFFAF0;background:rgba(80,30,24,.85);border-radius:8px;padding:6px 12px;pointer-events:none;transition:opacity .3s}`;
  document.head.append(style);
  const btn = document.createElement("button"); btn.type = "button"; btn.id = "farm-prompt"; btn.style.display = "none";
  const toastEl = document.createElement("div"); toastEl.id = "farm-toast"; toastEl.setAttribute("role", "status"); toastEl.style.opacity = "0";
  root.append(btn, toastEl);
  let cur: FarmPrompt | undefined; let toastTimer: ReturnType<typeof setTimeout> | undefined;
  const toast = (text: string): void => { toastEl.textContent = text; toastEl.style.opacity = "1"; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toastEl.style.opacity = "0"; }, 1800); };
  const read = (): FarmPrompt | undefined => {
    const p = d.player(); if (p === undefined) return undefined;
    try {
      const f = farmPrompt(d.world(), p); if (f) return f;
      const h = husbandryPrompt(d.world(), p); // ADR-113 Tame / Feed with animal_feed in hand
      return h ? { action: h.action as FarmPrompt["action"], slot: h.slot, fail: h.fail === TameFail.None ? FarmFail.None : FarmFail.NothingToTend, label: h.label } : undefined;
    } catch { return undefined; }
  };
  let lastLevels: number[] | undefined; // ADR-113/206 per-tree level-up toast (Progression replicates; polled with the prompt)
  const levelCheck = (): void => {
    const p = d.player(); const tr = p === undefined ? undefined : treesOf(d.world(), p); if (!tr) { lastLevels = undefined; return; }
    if (lastLevels) for (let i = 0; i < tr.length; i++) { const t = tr[i]!; if (t.level > (lastLevels[i] ?? t.level)) { toastEl.dataset["kind"] = "levelup"; toast(`${treeShortName(i)} level ${t.level}! ${t.points} ${treeShortName(i)} point${t.points === 1 ? "" : "s"} — open Skills`); } }
    lastLevels = tr.map((t) => t.level);
  };
  const trigger = (): void => {
    const p = read(); if (!p) return;
    if (p.fail !== FarmFail.None) { toast(p.action === "Tame" || p.action === "Feed" ? p.label.replace(/^\w+: /, "") : FARM_FAIL_TEXT[p.fail] ?? "Can't do that here"); return; }
    d.use(p);
  };
  const update = (): void => {
    levelCheck();
    cur = d.hidden() ? undefined : read();
    if (!cur) { btn.style.display = "none"; return; }
    const dev = d.device();
    btn.style.display = ""; btn.dataset["action"] = cur.action; btn.dataset["fail"] = String(cur.fail); btn.dataset["touch"] = String(dev === "touch");
    btn.textContent = promptText(cur, d.key(cur.action === "Harvest" ? "Interact" : "QuickUse"), dev);
  };
  btn.addEventListener("click", (ev) => { ev.preventDefault(); trigger(); });
  const timer = setInterval(update, 200); update();
  return { toast, trigger, destroy: () => { clearInterval(timer); clearTimeout(toastTimer); btn.remove(); toastEl.remove(); style.remove(); } };
}
