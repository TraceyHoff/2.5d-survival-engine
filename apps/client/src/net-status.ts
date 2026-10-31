/**
 * ADR-236: the in-game connection indicator. The old connect/P2P boxes (./connect.ts, ./p2p-overlay.ts) sat over the
 * game; everything they offered now lives in the start menu's Multiplayer page (./menu.ts) and Pause → Session
 * (./game-menus.ts). In play only this tiny pill remains, and only while something is wrong: disconnected, stuck
 * connecting, or high ping. It never takes input (pointer-events:none, not focusable) and tucks under the vitals
 * HUD (`#hud`, top-left), a spot no other HUD element uses at any viewport. Hook: `#net-status[data-level=warn|bad]`.
 */
export const HIGH_PING_MS = 250;
/** A fresh connect shows nothing for this long (a normal connect is quicker); after that, "Connecting…". */
export const CONNECTING_GRACE_MS = 3000;
/** High ping must persist this long before the pill shows (one slow sample, e.g. the initial world snapshot, doesn't count). */
export const HIGH_PING_SUSTAIN_MS = 3000;
export interface NetLike { status: string; rttMs: number | undefined }
export interface NetProblem { level: "warn" | "bad"; text: string }

/** undefined = all good (indicator hidden). `connectingMs`: how long the session has been in "connecting". */
export function netProblem(s: NetLike, connectingMs = 0, highPingMs = HIGH_PING_SUSTAIN_MS): NetProblem | undefined {
  if (s.status === "connected") return s.rttMs !== undefined && s.rttMs > HIGH_PING_MS && highPingMs >= HIGH_PING_SUSTAIN_MS ? { level: "warn", text: `High ping · ${s.rttMs} ms` } : undefined;
  if (s.status === "connecting") return connectingMs > CONNECTING_GRACE_MS ? { level: "warn", text: "Connecting…" } : undefined;
  if (s.status === "disconnected" || s.status === "error") return { level: "bad", text: "Disconnected · Pause → Session" };
  return undefined; // idle: not a network mode
}
export const pingLabel = (rtt: number | undefined): string => (rtt === undefined ? "measuring…" : `${rtt} ms${rtt > HIGH_PING_MS ? " (high)" : ""}`);

const CSS = `#net-status{position:absolute;z-index:5;pointer-events:none;display:none;max-width:min(220px,60vw);box-sizing:border-box;
padding:2px 8px;border-radius:9px;font:600 11px/1.3 Fredoka,system-ui,sans-serif;color:#FFFAF0;background:rgba(59,36,51,.82);
border:1px solid rgba(255,212,90,.55);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:0 1px 0 #3B2433}
#net-status[data-level=bad]{background:rgba(160,48,42,.88);border-color:#FFB0A0}
#net-status::before{content:"";display:inline-block;width:6px;height:6px;border-radius:50%;background:#FFD45A;margin-right:5px;vertical-align:1px}
#net-status[data-level=bad]::before{background:#FFE0D8}`;

export interface NetStatus { root: HTMLElement; update(): void; destroy(): void }
/** `parent`: the UI root (same layer as #hud). Re-reads `src` every 500 ms. */
export function mountNetStatus(src: NetLike, parent: HTMLElement, now: () => number = () => performance.now()): NetStatus {
  if (!document.getElementById("net-status-css")) { const st = document.createElement("style"); st.id = "net-status-css"; st.textContent = CSS; document.head.append(st); }
  const root = document.createElement("div"); root.id = "net-status"; root.setAttribute("role", "status"); root.setAttribute("aria-live", "polite");
  parent.append(root);
  let since = now(), last = "", highSince: number | undefined;
  const update = (): void => {
    if (src.status !== "connecting") since = now(); else if (last !== "connecting") since = now();
    last = src.status;
    const high = src.status === "connected" && src.rttMs !== undefined && src.rttMs > HIGH_PING_MS;
    highSince = high ? highSince ?? now() : undefined;
    const p = netProblem(src, now() - since, highSince === undefined ? 0 : now() - highSince);
    if (!p) { root.style.display = "none"; return; }
    root.textContent = p.text; root.dataset["level"] = p.level; root.title = p.text;
    // just under the vitals HUD (top-left); if the HUD is hidden (Settings → Show HUD off), take its spot
    const hud = document.getElementById("hud"); const pr = parent.getBoundingClientRect();
    const hr = hud && getComputedStyle(hud).display !== "none" ? hud.getBoundingClientRect() : undefined;
    root.style.left = hr && hr.width ? `${Math.round(hr.left - pr.left)}px` : "calc(6px + var(--sal,0px))";
    root.style.top = hr && hr.height ? `${Math.round(hr.bottom - pr.top + 4)}px` : "calc(6px + var(--sat,0px))";
    root.style.display = "block";
  };
  update(); const t = setInterval(update, 500);
  return { root, update, destroy: () => { clearInterval(t); root.remove(); } };
}
