/**
 * FUNCTIONAL PLACEHOLDER — owned by Art & Assets for styling (or replacement).
 * In-game P2P session overlay (host: room code + live player list; guest: host code + status), plain DOM like
 * ./connect.ts. Restyling hooks: `#p2p-overlay` with `data-mode="host"|"guest"`, and `[data-role=code|cap|players|status|leave]`;
 * each player row is `li[data-role=player]` with `data-host` on the host's row. Only position/background are set.
 */
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
  root.style.cssText = "position:fixed;top:8px;left:8px;z-index:10;background:#fff;padding:6px;font:12px sans-serif;max-width:240px";
  const code = document.createElement("div"); code.dataset["role"] = "code";
  code.textContent = m.mode === "host" ? `Room code: ${m.code}` : `Joined: ${m.code}`;
  const cap = document.createElement("div"); cap.dataset["role"] = "cap";
  const list = document.createElement("ul"); list.dataset["role"] = "players"; list.style.cssText = "margin:4px 0;padding-left:16px";
  const status = document.createElement("div"); status.dataset["role"] = "status";
  const leave = document.createElement("button"); leave.dataset["role"] = "leave"; leave.textContent = m.mode === "host" ? "End session" : "Leave";
  leave.addEventListener("click", () => m.onLeave());
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
  document.body.append(root); update();
  const timer = setInterval(update, 500);
  return { root, update, destroy: () => { clearInterval(timer); root.remove(); } };
}
