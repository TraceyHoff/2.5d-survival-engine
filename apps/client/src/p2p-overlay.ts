/**
 * FUNCTIONAL PLACEHOLDER — owned by Art & Assets for styling (or replacement).
 * In-game P2P session overlay (host: room code + live player list; guest: host code + status), plain DOM like
 * ./connect.ts. Restyling hooks: `#p2p-overlay` with `data-mode="host"|"guest"`, and `[data-role=code|cap|players|status|leave]`;
 * each player row is `li[data-role=player]` with `data-host` on the host's row. Only position/background are set.
 * Mounted in the UI root (visible in fullscreen), top-center clear of the HUD (top-left) and menu bar (top-right); its
 * Leave button is a 40px tap target, and gamepad/keyboard reach the same action via the pause menu's Session entry.
 */
import { mountUi } from "./ui-root.js";
export interface P2POverlayModel {
  mode: "host" | "guest";
  code: string;
  cap?: number;
  players?: () => { name: string; host: boolean }[];
  status: () => string;
  onLeave: () => void;
}
export interface P2POverlay { root: HTMLElement; update(): void; destroy(): void }

export function mountP2POverlay(m: P2POverlayModel): P2POverlay {
  const root = document.createElement("div");
  root.id = "p2p-overlay"; root.dataset["mode"] = m.mode;
  root.style.cssText = "position:absolute;top:calc(4px + var(--sat,0px));left:50%;transform:translateX(-50%);z-index:10;background:#fff;padding:4px 8px;font:12px sans-serif;max-width:min(240px,40vw);pointer-events:auto;max-height:calc(100dvh - var(--sat,0px) - var(--sab,0px) - 16px);overflow-y:auto;-webkit-overflow-scrolling:touch;touch-action:pan-y;overscroll-behavior:contain;box-sizing:border-box";
  const code = document.createElement("div"); code.dataset["role"] = "code";
  code.textContent = m.mode === "host" ? `Room code: ${m.code}` : `Joined: ${m.code}`;
  const cap = document.createElement("div"); cap.dataset["role"] = "cap";
  const list = document.createElement("ul"); list.dataset["role"] = "players"; list.style.cssText = "margin:4px 0;padding-left:16px";
  const status = document.createElement("div"); status.dataset["role"] = "status";
  const leave = document.createElement("button"); leave.dataset["role"] = "leave"; leave.textContent = m.mode === "host" ? "End session" : "Leave";
  leave.style.cssText = "min-height:40px;min-width:88px;font:600 13px sans-serif;touch-action:manipulation"; leave.addEventListener("click", () => m.onLeave());
  root.append(code, cap, list, status, leave);
  let last = "";
  const update = (): void => {
    const ps = m.players?.() ?? [];
    const key = ps.map((p) => `${p.host ? "*" : ""}${p.name}`).join("|");
    if (key !== last) {
      last = key;
      list.replaceChildren(...ps.map((p) => { const li = document.createElement("li"); li.dataset["role"] = "player"; if (p.host) li.dataset["host"] = ""; li.textContent = p.host ? `${p.name} (host)` : p.name; return li; }));
    }
    cap.textContent = m.players && m.cap ? `Players: ${ps.length}/${m.cap}` : "";
    status.textContent = m.status();
  };
  mountUi(root); update();
  const timer = setInterval(update, 500);
  return { root, update, destroy: () => { clearInterval(timer); root.remove(); } };
}
