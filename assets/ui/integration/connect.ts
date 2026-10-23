/**
 * Cozy Camp connect / lobby view: drop-in replacement for apps/client/src/connect.ts.
 * Owned by UI (Art & Assets). Exports, signature and every `#connect-overlay` / `[data-role=...]` hook
 * match the engine placeholder. Logic stays in ./session.ts; this module only renders and forwards clicks.
 *
 *  - Disconnected (idle | disconnected | error): full-screen "main menu" card (wood frame, parchment fields,
 *    chunky green Connect button), matching ui/screens/main_menu.json and ui/preview/main_menu.png.
 *  - Connecting / connected: the card collapses into a small corner chip (status, RTT, Disconnect), so the
 *    HUD and game stay visible (top-centre: the only HUD-free strip). Pass `hideWhenConnected: true` once the
 *    HUD overlay (ping/players at top-right) and pause menu (net.disconnect) are mounted.
 *
 * Art comes from the UI kit's 1x frame PNGs (ui/atlas/frames/*.png, 9-slice insets match the `nineSlice`
 * values in ui_atlas.json / manifest.ui.json) through CSS border-image. Fonts are ui/fonts (OFL).
 * `opts.uiBase` (optional, default "/ui/") is the URL where /workspace/assets/ui is served.
 */
import type { ClientSession } from "./session.js";

export interface ConnectOverlay { root: HTMLElement; update(): void; destroy(): void }

const STYLE_ID = "cozy-connect-style";

/** Theme tokens copied from ui/theme.json (palette.json v2 swatches). Keep in sync with theme.json. */
const T = {
  ink: "#3B2433", inkSoft: "#4A2F3D", inkFaint: "#6B4A5A",
  parchment50: "#FFFAF0", parchment100: "#F6EAD2", parchment300: "#E6C47E",
  wood900: "#432C24", choc800: "#2A1B2E",
  leaf500: "#479B55", leaf700: "#2D7050", red: "#C8434E", sun: "#F2C14E", sky: "#3A9CCC",
} as const;

function css(base: string): string {
  const f = (n: string): string => `url("${base}atlas/frames/${n}.png")`;
  // border-image: slice = nineSlice insets (1x px), width = same, so 1 CSS px = 1 art px at 100% zoom.
  const nine = (n: string, l: number, t: number, r: number, b: number): string =>
    `border-style:solid;border-width:${t}px ${r}px ${b}px ${l}px;border-image:${f(n)} ${t} ${r} ${b} ${l} fill / ${t}px ${r}px ${b}px ${l}px stretch;`;
  return `
@font-face{font-family:"Fredoka";src:url("${base}fonts/Fredoka.ttf") format("truetype");font-weight:300 700;font-stretch:75% 125%;font-display:swap}
@font-face{font-family:"Nunito";src:url("${base}fonts/Nunito.ttf") format("truetype");font-weight:200 1000;font-display:swap}
#connect-overlay{position:fixed;inset:0;z-index:900;display:flex;align-items:center;justify-content:center;
  font:600 15px/1.3 "Nunito",system-ui,sans-serif;color:${T.ink};image-rendering:auto;
  background:radial-gradient(ellipse at 50% 40%,rgba(42,27,46,.15),rgba(42,27,46,.6));
  cursor:url("${base}atlas/frames/cursor_default.png") 3 2,auto}
#connect-overlay button,#connect-overlay label{cursor:url("${base}atlas/frames/cursor_pointer.png") 10 2,pointer}
#connect-overlay input{cursor:url("${base}atlas/frames/cursor_text.png") 16 16,text}
#connect-overlay .cc-card{${nine("panel_wood_vine", 24, 24, 24, 24)}width:380px;box-sizing:border-box;position:relative;
  filter:drop-shadow(0 6px 0 rgba(42,27,46,.35)) drop-shadow(0 14px 18px rgba(42,27,46,.35));animation:cc-pop .22s cubic-bezier(.3,1.6,.5,1)}
#connect-overlay .cc-paper{${nine("panel_parchment", 18, 18, 18, 18)}padding:10px 8px 6px;display:flex;flex-direction:column;gap:10px}
#connect-overlay .cc-title{${nine("ribbon_title", 30, 16, 30, 16)}position:absolute;left:50%;top:-22px;transform:translateX(-50%);
  padding:0 8px;height:8px;line-height:8px;white-space:nowrap;font:700 26px/8px "Fredoka",sans-serif;color:${T.parchment50};
  -webkit-text-stroke:0;text-shadow:0 2px 0 ${T.ink},2px 0 0 ${T.ink},-2px 0 0 ${T.ink},0 -2px 0 ${T.ink},2px 2px 0 ${T.ink},-2px 2px 0 ${T.ink},0 4px 0 ${T.ink}}
#connect-overlay .cc-sub{text-align:center;margin-top:14px;color:${T.inkFaint};font-size:13px}
#connect-overlay label{display:flex;flex-direction:column;gap:4px;font:600 14px "Fredoka",sans-serif;letter-spacing:.2px}
#connect-overlay input{${nine("input_normal", 14, 14, 14, 14)}padding:0 2px;height:20px;outline:none;background:none;
  font:700 15px "Nunito",sans-serif;color:${T.ink}}
#connect-overlay input::placeholder{color:${T.inkFaint};opacity:.8}
#connect-overlay input:focus{border-image-source:${f("input_focus")}}
#connect-overlay input:disabled{border-image-source:${f("input_disabled")};color:${T.inkFaint}}
#connect-overlay button[data-role=connect]{${nine("btn_primary_normal", 16, 14, 16, 18)}height:56px;padding:0 4px;background:none;
  font:700 22px/1 "Fredoka",sans-serif;color:${T.parchment50};text-shadow:0 2px 0 ${T.ink},1.5px 0 0 ${T.ink},-1.5px 0 0 ${T.ink},0 -1.5px 0 ${T.ink};
  transition:transform .08s}
#connect-overlay button[data-role=connect]:hover{border-image-source:${f("btn_primary_hover")};transform:translateY(-1px)}
#connect-overlay button[data-role=connect]:active{border-image-source:${f("btn_primary_pressed")};transform:translateY(2px)}
#connect-overlay button[data-role=connect]:focus-visible{outline:3px solid ${T.sky};outline-offset:2px;border-radius:12px}
#connect-overlay button[data-role=connect]:disabled{border-image-source:${f("btn_disabled")};color:${T.parchment100};text-shadow:none}
#connect-overlay.cc-live button[data-role=connect]{border-image-source:${f("btn_danger_normal")}}
#connect-overlay.cc-live button[data-role=connect]:hover{border-image-source:${f("btn_danger_hover")}}
#connect-overlay.cc-live button[data-role=connect]:active{border-image-source:${f("btn_danger_pressed")}}
#connect-overlay .cc-status{display:flex;align-items:center;gap:8px;min-height:24px}
#connect-overlay .cc-status::before{content:"";flex:none;width:24px;height:24px;background:${f("ic_info")} center/24px no-repeat}
#connect-overlay[data-status=connecting] .cc-status::before{background-image:${f("cursor_loading")};animation:cc-spin 1.2s linear infinite}
#connect-overlay[data-status=connected] .cc-status::before{background-image:${f("ic_check")}}
#connect-overlay[data-status=error] .cc-status::before{background-image:${f("ic_warn")}}
#connect-overlay[data-status=error] [data-role=status]{color:#A24E34}
#connect-overlay .cc-meta{display:flex;justify-content:space-between;gap:8px;font-size:12px;color:${T.inkFaint}}
#connect-overlay [data-role=rtt]::before{content:"";display:inline-block;width:16px;height:16px;vertical-align:-3px;margin-right:4px;background:${f("ic_signal")} center/16px no-repeat}
/* live: collapse to a corner chip */
#connect-overlay.cc-live{inset:8px auto auto 50%;transform:translateX(-50%);background:none;display:block;cursor:auto}
#connect-overlay.cc-live.cc-hide-live{display:none}
#connect-overlay.cc-live .cc-card{${nine("panel_hud", 14, 14, 14, 14)}width:auto;filter:drop-shadow(0 3px 0 rgba(42,27,46,.35));animation:none;color:${T.parchment100}}
#connect-overlay.cc-live .cc-paper{border:0;border-image:none;padding:0;display:flex;flex-direction:row;align-items:center;gap:10px}
#connect-overlay.cc-live .cc-title,#connect-overlay.cc-live .cc-sub,#connect-overlay.cc-live label{display:none}
#connect-overlay.cc-live button[data-role=connect]{height:36px;font-size:15px;border-width:10px 12px 14px 12px;border-image-width:10px 12px 14px 12px}
#connect-overlay.cc-live .cc-meta{color:${T.parchment300};flex-direction:column;gap:0}
#connect-overlay.cc-live [data-role=status]{color:${T.parchment50}}
@keyframes cc-pop{from{transform:scale(.92);opacity:0}to{transform:none;opacity:1}}
@keyframes cc-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){#connect-overlay *{animation:none!important;transition:none!important}}
`;
}

const STATUS_TEXT: Record<string, string> = {
  idle: "Ready when you are!", connecting: "Walking to camp…", connected: "At camp", disconnected: "Left camp", error: "Couldn't reach camp",
};

export function mountConnectOverlay(
  session: ClientSession,
  opts: { defaultUrl: string; onConnect: (url: string, name: string) => void; onDisconnect: () => void; uiBase?: string; hideWhenConnected?: boolean },
): ConnectOverlay {
  const base = (opts.uiBase ?? "/ui/").replace(/\/?$/, "/");
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) { style = document.createElement("style"); style.id = STYLE_ID; style.textContent = css(base); document.head.append(style); }

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, role?: string): HTMLElementTagNameMap[K] => {
    const e = document.createElement(tag); if (cls) e.className = cls; if (role) e.dataset["role"] = role; return e;
  };
  const root = el("div"); root.id = "connect-overlay";
  const card = el("div", "cc-card"); card.setAttribute("role", "dialog"); card.setAttribute("aria-labelledby", "cc-title");
  const paper = el("div", "cc-paper");
  const title = el("div", "cc-title"); title.id = "cc-title"; title.textContent = "Cozy Camp";
  const sub = el("div", "cc-sub"); sub.textContent = "Pack a snack. Find your friends. Survive the night.";
  const field = (label: string, role: string, value: string, placeholder: string): HTMLInputElement => {
    const l = el("label"); l.textContent = label;
    const i = el("input", undefined, role); i.value = value; i.placeholder = placeholder; i.spellcheck = false; i.autocomplete = "off";
    l.append(i); paper.append(l); return i;
  };
  paper.append(sub);
  const url = field("Server", "server-url", session.savedUrl ?? opts.defaultUrl, "ws://localhost:8080");
  const name = field("Camper name", "player-name", session.savedName ?? "", "Maple");
  name.maxLength = 24;
  const button = el("button", undefined, "connect"); button.type = "button";
  const statusRow = el("div", "cc-status");
  const status = el("div", undefined, "status"); status.setAttribute("aria-live", "polite");
  statusRow.append(status);
  const meta = el("div", "cc-meta");
  const rtt = el("div", undefined, "rtt");
  const account = el("div", undefined, "account");
  meta.append(rtt, account);
  paper.append(button, statusRow, meta);
  card.append(title, paper); root.append(card);

  const act = (): void => {
    if (session.status === "connected" || session.status === "connecting") opts.onDisconnect();
    else opts.onConnect(url.value.trim(), name.value.trim());
  };
  button.addEventListener("click", act);
  const onKey = (e: KeyboardEvent): void => { if (e.key === "Enter") act(); };
  url.addEventListener("keydown", onKey); name.addEventListener("keydown", onKey);

  let last = "";
  const update = (): void => {
    const s = session.status;
    const live = s === "connected" || s === "connecting";
    root.classList.toggle("cc-live", live);
    root.classList.toggle("cc-hide-live", live && s === "connected" && opts.hideWhenConnected === true);
    root.dataset["status"] = s;
    button.textContent = live ? (s === "connecting" ? "Cancel" : "Disconnect") : "Connect";
    url.disabled = live; name.disabled = live;
    status.textContent = `${STATUS_TEXT[s] ?? s}${session.detail && (s === "error" || s === "disconnected") ? ` (${session.detail})` : ""}`;
    rtt.textContent = session.rttMs === undefined ? "–" : `${session.rttMs} ms`;
    const a = session.account;
    account.textContent = a ? `Camper ${a.slice(0, 8)}…${session.restored ? " · welcome back!" : ""}` : "New camper";
    if (s !== last) { if (!live && last) name.focus(); last = s; }
  };
  document.body.append(root); update();
  if (!session.savedName) name.focus();
  const timer = setInterval(update, 250);
  return {
    root, update,
    destroy: () => { clearInterval(timer); root.remove(); if (!document.getElementById("connect-overlay")) style?.remove(); },
  };
}
