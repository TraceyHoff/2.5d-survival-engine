/**
 * FUNCTIONAL PLACEHOLDER — owned by Art & Assets for styling (or replacement).
 * Connect/lobby overlay: plain DOM, no theme/art decisions. Hooks for restyling: `#connect-overlay` and
 * `[data-role=...]` on every control. Only `position: fixed` and a plain background are set so it is usable
 * over the canvas. Logic lives in ./session.ts; this module only renders and forwards clicks.
 */
import { mountUi } from "./ui-root.js";
import type { ClientSession } from "./session.js";

/** ADR-142: the plain lobby box sat over the HUD for the whole session; once connected it gets out of the way (leave via ☰ → Main menu; it returns if the link drops). */
export const connectOverlayVisible = (status: string): boolean => status !== "connected";

export interface ConnectOverlay { root: HTMLElement; update(): void; destroy(): void }

export function mountConnectOverlay(session: ClientSession, opts: { defaultUrl: string; onConnect: (url: string, name: string) => void; onDisconnect: () => void }): ConnectOverlay {
  const root = document.createElement("div");
  root.id = "connect-overlay";
  root.style.cssText = "position:absolute;top:calc(4px + var(--sat,0px));left:50%;transform:translateX(-50%);z-index:10;background:#fff;padding:6px;font:12px sans-serif";
  const field = (label: string, role: string, value: string): HTMLInputElement => {
    const l = document.createElement("label"); l.textContent = `${label} `;
    const i = document.createElement("input"); i.dataset["role"] = role; i.value = value; l.append(i);
    root.append(l, document.createElement("br")); return i;
  };
  const url = field("Server", "server-url", session.savedUrl ?? opts.defaultUrl);
  const name = field("Name", "player-name", session.savedName ?? "");
  const button = document.createElement("button"); button.dataset["role"] = "connect";
  const status = document.createElement("div"); status.dataset["role"] = "status";
  const rtt = document.createElement("div"); rtt.dataset["role"] = "rtt";
  const account = document.createElement("div"); account.dataset["role"] = "account";
  root.append(button, status, rtt, account);
  button.addEventListener("click", () => {
    if (session.status === "connected" || session.status === "connecting") opts.onDisconnect();
    else opts.onConnect(url.value.trim(), name.value.trim());
  });
  const update = (): void => {
    const live = session.status === "connected" || session.status === "connecting";
    root.style.display = connectOverlayVisible(session.status) ? "" : "none";
    button.textContent = live ? "Disconnect" : "Connect";
    url.disabled = live; name.disabled = live;
    status.textContent = `Status: ${session.status}${session.detail ? ` (${session.detail})` : ""}`;
    rtt.textContent = `RTT: ${session.rttMs === undefined ? "-" : `${session.rttMs} ms`}`;
    const a = session.account;
    account.textContent = a ? `Account: ${a.slice(0, 8)}…${session.restored ? " (restored)" : ""}` : "Account: new";
  };
  mountUi(root); update();
  const timer = setInterval(update, 250);
  return { root, update, destroy: () => { clearInterval(timer); root.remove(); } };
}
