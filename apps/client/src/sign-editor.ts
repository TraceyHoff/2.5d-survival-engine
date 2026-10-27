/**
 * ADR-122 in-game sign editor (replaces ADR-120's prompt()). A modal opened on the shared UINav stack (ui-nav.ts), so
 * Esc, gamepad B, Android/browser back (popstate via back-history.ts) and the visible "← Back" button all close it.
 * - Live preview of exactly what will be stored (sanitizeSignText: printable ASCII, collapsed spaces, per-kind limit,
 *   profanity masked) and a per-kind character counter.
 * - On-screen keyboard (D-pad / A on gamepad, tap on touch) for devices without a usable system keyboard
 *   (e.g. the Xbox Edge browser); open by default on gamepad, toggleable everywhere.
 * - Scrolls inside the viewport on small / landscape phones (max-height uses dvh + safe-area insets).
 * DOM hooks: `#sign-editor`, `[data-role=sign-input|sign-preview|sign-count|submit|close|osk-toggle]`, `.osk [data-osk]`.
 */
import { sanitizeSignText, SIGN_TEXT_MAX } from "@engine/gameplay";

export interface SignEditorOptions {
  kindName: string; maxLen: number; initial: string;
  /** Submit button text (default "Save sign"; ADR-145 pet rename uses "Save name"). */
  saveLabel?: string;
  /** Show the on-screen keyboard immediately (gamepad). */
  keyboard?: boolean;
  onSave(text: string): void;
  close(): void;
}
/** Pure model for the editor: what will be stored, how many characters are used / allowed. */
export function signEditorState(raw: string, maxLen: number): { stored: string; used: number; max: number; empty: boolean; masked: boolean } {
  const max = Math.max(1, Math.min(SIGN_TEXT_MAX, maxLen)); const clean = raw.replace(/[^\x20-\x7e]/g, " ").replace(/\s+/g, " ").trim();
  const stored = sanitizeSignText(raw, max);
  return { stored, used: Math.min(clean.length, max), max, empty: stored.length === 0, masked: stored !== clean.slice(0, max).trimEnd() };
}
export const OSK_ROWS = ["1234567890", "QWERTYUIOP", "ASDFGHJKL'", "ZXCVBNM-.,", "!?&:/#()+"] as const;
const CSS = `#sign-editor{position:absolute;inset:0;z-index:30;display:flex;align-items:center;justify-content:center;background:rgba(20,14,18,.55);padding:calc(8px + var(--sat,0px)) 8px calc(8px + var(--sab,0px))}
#sign-editor .se-panel{box-sizing:border-box;width:min(520px,100%);max-height:calc(100dvh - 16px - var(--sat,0px) - var(--sab,0px));overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;touch-action:pan-y;
background:#F6EAD2;color:#3B2433;border:3px solid #74432C;border-radius:14px;box-shadow:0 4px 0 #432C24;padding:12px 14px;font:500 15px Fredoka,system-ui,sans-serif}
#sign-editor h2{margin:0 0 8px;font-size:18px}#sign-editor .se-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0}
#sign-editor input[data-role=sign-input]{flex:1;min-width:0;min-height:44px;font:600 16px Fredoka,system-ui,sans-serif;padding:4px 10px;border:2px solid #74432C;border-radius:8px;background:#fffaf0;color:#3B2433}
#sign-editor [data-role=sign-preview]{display:inline-block;max-width:100%;overflow-wrap:anywhere;font:600 13px Fredoka,system-ui,sans-serif;background:#F6EAD2;border:2px solid #74432C;border-radius:6px;padding:2px 8px;box-shadow:0 2px 0 #432C24;min-height:1.3em}
#sign-editor [data-role=sign-preview][data-empty=true]{opacity:.55;font-style:italic}
#sign-editor [data-role=sign-count]{font-variant-numeric:tabular-nums;margin-left:auto}#sign-editor [data-role=sign-count][data-full=true]{color:#a3261b;font-weight:700}
#sign-editor button{min-height:44px;min-width:44px;font:600 15px Fredoka,system-ui,sans-serif;border-radius:8px;border:2px solid #74432C;background:#e9c98f;color:#3B2433;cursor:pointer}
#sign-editor button:focus-visible,#sign-editor input:focus-visible{outline:3px solid #ffd45a;outline-offset:2px}
#sign-editor .osk{display:grid;gap:4px;margin-top:6px}#sign-editor .osk[hidden]{display:none}#sign-editor .osk .r{display:flex;gap:4px;justify-content:center}
#sign-editor .osk button{flex:1 1 0;min-width:28px;padding:0}#sign-editor .se-actions{justify-content:flex-end}`;

export function buildSignEditor(o: SignEditorOptions): HTMLElement {
  if (!document.getElementById("sign-editor-css")) { const st = document.createElement("style"); st.id = "sign-editor-css"; st.textContent = CSS; document.head.append(st); }
  const max = Math.max(1, Math.min(SIGN_TEXT_MAX, o.maxLen));
  const root = document.createElement("div"); root.id = "sign-editor";
  const panel = document.createElement("div"); panel.className = "se-panel gm-panel"; root.append(panel);
  const mk = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, role?: string): HTMLElementTagNameMap[K] => { const e = Object.assign(document.createElement(tag), props); if (role) (e as HTMLElement).dataset["role"] = role; return e; };
  const back = mk("button", { type: "button", textContent: "← Back", className: "alt ui-back" }, "close"); back.setAttribute("aria-label", "Back");
  const h = mk("h2", { textContent: `Edit ${o.kindName}` }); h.id = "sign-editor-title"; root.setAttribute("aria-labelledby", h.id);
  const input = mk("input", { type: "text", value: o.initial.slice(0, max), maxLength: max, autocomplete: "off", spellcheck: false, placeholder: "Sign text" }, "sign-input");
  input.setAttribute("aria-label", `Sign text, up to ${max} characters`); input.setAttribute("enterkeyhint", "done"); input.autofocus = !o.keyboard;
  const count = mk("span", {}, "sign-count"); count.setAttribute("aria-live", "polite");
  const preview = mk("span", {}, "sign-preview");
  const toggle = mk("button", { type: "button", textContent: "⌨ Keyboard" }, "osk-toggle"); toggle.dataset["pad"] = "Y";
  const osk = mk("div", { className: "osk" }); osk.setAttribute("aria-label", "On-screen keyboard");
  let upper = true;
  const insert = (s: string): void => {
    const a = input.selectionStart ?? input.value.length, b = input.selectionEnd ?? a;
    const v = (input.value.slice(0, a) + s + input.value.slice(b)).slice(0, max); input.value = v;
    const c = Math.min(a + s.length, v.length); try { input.setSelectionRange(c, c); } catch { /* jsdom */ } update();
  };
  const del = (): void => {
    const a = input.selectionStart ?? input.value.length, b = input.selectionEnd ?? a;
    if (a === b && a === 0) return; const from = a === b ? a - 1 : a; input.value = input.value.slice(0, from) + input.value.slice(b);
    try { input.setSelectionRange(from, from); } catch { /* jsdom */ } update();
  };
  const keyBtn = (label: string, fn: () => void, data: string): HTMLButtonElement => { const b = mk("button", { type: "button", textContent: label }); b.dataset["osk"] = data; b.addEventListener("click", fn); return b; };
  const letters: HTMLButtonElement[] = [];
  for (const row of OSK_ROWS) { const r = mk("div", { className: "r" }); for (const ch of row) { const b = keyBtn(ch, () => insert(/[A-Z]/.test(ch) && !upper ? ch.toLowerCase() : ch), ch); if (/[A-Z]/.test(ch)) letters.push(b); r.append(b); } osk.append(r); }
  const shift = keyBtn("⇧ abc", () => { upper = !upper; shift.textContent = upper ? "⇧ abc" : "⇧ ABC"; for (const b of letters) b.textContent = upper ? b.dataset["osk"]! : b.dataset["osk"]!.toLowerCase(); }, "shift");
  const last = mk("div", { className: "r" }); last.append(shift, keyBtn("Space", () => insert(" "), "space"), keyBtn("⌫", del, "backspace"), keyBtn("Clear", () => { input.value = ""; update(); }, "clear")); osk.append(last);
  osk.hidden = !o.keyboard; if (o.keyboard) { const k0 = osk.querySelector<HTMLButtonElement>("button"); if (k0) k0.autofocus = true; } // gamepad: start on the keys toggle.setAttribute("aria-expanded", String(!osk.hidden));
  toggle.addEventListener("click", () => { osk.hidden = !osk.hidden; toggle.setAttribute("aria-expanded", String(!osk.hidden)); if (!osk.hidden) osk.querySelector<HTMLElement>("button")?.focus(); });
  const save = mk("button", { type: "button", textContent: o.saveLabel ?? "Save sign" }, "submit"); save.dataset["pad"] = "X";
  const cancel = mk("button", { type: "button", textContent: "Cancel", className: "alt" }, "cancel");
  function update(): void {
    const s = signEditorState(input.value, max);
    count.textContent = `${s.used}/${s.max}`; count.dataset["full"] = String(s.used >= s.max);
    preview.textContent = s.empty ? "(blank — sign shows nothing)" : s.stored; preview.dataset["empty"] = String(s.empty); preview.dataset["masked"] = String(s.masked);
  }
  input.addEventListener("input", update);
  input.addEventListener("focus", () => { input.scrollIntoView?.({ block: "nearest" }); });
  save.addEventListener("click", () => { o.onSave(signEditorState(input.value, max).stored); o.close(); });
  cancel.addEventListener("click", () => o.close()); back.addEventListener("click", () => o.close());
  const r1 = mk("div", { className: "se-row" }); r1.append(input, toggle);
  const r2 = mk("div", { className: "se-row" }); r2.append(mk("span", { textContent: "Preview:" }), preview, count);
  const r3 = mk("div", { className: "se-row se-actions" }); r3.append(cancel, save);
  panel.append(back, h, r1, r2, osk, r3);
  // keep taps on the backdrop from reaching the game; tap outside the panel = Back
  root.addEventListener("pointerdown", (e) => { if (e.target === root) { e.preventDefault(); o.close(); } });
  update();
  return root;
}
