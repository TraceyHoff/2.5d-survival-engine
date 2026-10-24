/**
 * ADR-126 client overlay: a small symbol over the nearest resource node (within ~1.5 tiles) naming the tool it needs,
 * a hand for bare-handed nodes. Owned tool: drawn normally; missing: greyed with a red lock. Fades in / out.
 * Renderer-agnostic (a DOM canvas over #game positioned from the shared camera), so it is identical on WebGL2 and the
 * Canvas2D fallback, and passive, so it works the same on touch, gamepad and keyboard / mouse (larger on touch).
 * Art: `art/ui/tool_req_<icon>.png` (Art & Assets) replaces the canvas-drawn placeholder per icon once it exists.
 * Settings: `toolHints` (on by default). DOM hook: `#tool-hint[data-icon][data-have][data-show]`.
 */
import type { Entity, World } from "@engine/core";
import { toolHint, toolReqIconPath, type ToolHint, type ToolReqIcon } from "@engine/gameplay";
import { isoToCss, type CameraLike } from "./world-tools.js";

export interface ToolHintDeps {
  world(): World; player(): Entity | undefined; camera(): CameraLike | undefined;
  /** menus open / build mode */ hidden(): boolean; /** Settings toggle */ enabled(): boolean;
  device?(): "keyboardMouse" | "gamepad" | "touch"; /** art root, e.g. `${BASE_URL}art/` (omit: placeholders only) */ artBase?: string;
}

type G = CanvasRenderingContext2D;
const line = (g: G, pts: number[][]): void => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x!, y!) : g.moveTo(x!, y!))); g.stroke(); };
/** Vector placeholder for each icon in a 0..32 box (no emoji, no fonts). */
export function drawToolPlaceholder(g: G, icon: ToolReqIcon, color = "#FFFAF0"): void {
  g.save(); g.lineCap = "round"; g.lineJoin = "round"; g.strokeStyle = color; g.fillStyle = color; g.lineWidth = 2.5;
  const handle = (): void => { g.strokeStyle = "#C8955A"; g.lineWidth = 3.5; line(g, [[9, 27], [22, 8]]); g.strokeStyle = color; g.lineWidth = 2.5; };
  switch (icon) {
    case "hand": // open palm: palm + four fingers + thumb
      g.beginPath(); g.roundRect(9, 14, 14, 13, 4); g.fill();
      for (const [x, top] of [[10, 6], [14, 4], [18, 5], [22, 8]] as const) { g.lineWidth = 3.2; line(g, [[x, 16], [x, top]]); }
      g.lineWidth = 3.2; line(g, [[10, 21], [5, 15]]); break;
    case "axe": handle(); g.beginPath(); g.moveTo(17, 7); g.quadraticCurveTo(27, 5, 27, 14); g.lineTo(20, 13); g.closePath(); g.fill(); break;
    case "pickaxe": handle(); g.lineWidth = 3; g.beginPath(); g.moveTo(8, 9); g.quadraticCurveTo(19, 2, 29, 13); g.stroke(); break;
    case "shovel": g.strokeStyle = "#C8955A"; g.lineWidth = 3.5; line(g, [[8, 26], [19, 13]]); line(g, [[6, 24], [10, 28]]);
      g.beginPath(); g.ellipse(23, 9, 4.5, 7, Math.PI / 4, 0, Math.PI * 2); g.fill(); break;
    case "hoe": handle(); g.beginPath(); g.moveTo(20, 9); g.lineTo(28, 9); g.lineTo(28, 15); g.closePath(); g.fill(); break;
    case "knife": g.beginPath(); g.moveTo(10, 23); g.lineTo(26, 5); g.quadraticCurveTo(25, 16, 14, 25); g.closePath(); g.fill();
      g.strokeStyle = "#C8955A"; g.lineWidth = 4; line(g, [[11, 23], [6, 28]]); break;
    case "sickle": g.strokeStyle = "#C8955A"; g.lineWidth = 3.5; line(g, [[7, 28], [12, 21]]);
      g.strokeStyle = color; g.lineWidth = 3; g.beginPath(); g.arc(18, 14, 9, Math.PI * 0.75, Math.PI * 2.1); g.stroke(); break;
  }
  g.restore();
}
/** Red lock badge (bottom-right) for a tool the player does not have. */
export function drawLock(g: G): void {
  g.save(); g.fillStyle = "#C0392B"; g.strokeStyle = "#FFFFFF"; g.lineWidth = 1.5;
  g.beginPath(); g.arc(25, 25, 7, 0, Math.PI * 2); g.fill(); g.stroke();
  g.fillStyle = "#FFFFFF"; g.fillRect(21.5, 24, 7, 5); g.beginPath(); g.arc(25, 24, 2.3, Math.PI, 0); g.stroke(); g.restore();
}
/** Visual state for a hint (pure, tested). */
export function hintVisual(h: Pick<ToolHint, "have" | "equipped">): { grey: boolean; lock: boolean; ring: string } {
  return h.have ? { grey: false, lock: false, ring: h.equipped ? "#7BC86C" : "#E6C47E" } : { grey: true, lock: true, ring: "#C0584A" };
}

const CSS = `#tool-hint{position:absolute;left:0;top:0;z-index:4;pointer-events:none;opacity:0;transition:opacity .25s ease;will-change:transform,opacity}
#tool-hint[data-show="true"]{opacity:1}#tool-hint[data-have="false"] canvas.icon{filter:grayscale(1) brightness(.8)}`;

export function mountToolHint(root: HTMLElement, d: ToolHintDeps): { destroy(): void; current(): ToolHint | undefined } {
  const style = document.createElement("style"); style.textContent = CSS; document.head.append(style);
  const el = document.createElement("div"); el.id = "tool-hint"; el.setAttribute("role", "img"); el.dataset["show"] = "false";
  const cv = document.createElement("canvas"); cv.className = "icon"; el.append(cv); root.append(el);
  const art = new Map<ToolReqIcon, HTMLImageElement | null>(); // null = no art yet: placeholder
  const image = (icon: ToolReqIcon): HTMLImageElement | null => {
    if (!d.artBase) return null;
    if (!art.has(icon)) { art.set(icon, null); const im = new Image(); im.onload = () => { art.set(icon, im); drawn = ""; }; im.src = d.artBase + toolReqIconPath(icon); }
    return art.get(icon) ?? null;
  };
  let cur: ToolHint | undefined; let shown: ToolHint | undefined; let drawn = ""; let lastScan = 0; let raf = 0;
  const draw = (h: ToolHint, size: number): void => {
    const key = `${h.icon}|${h.have}|${h.equipped}|${size}|${art.get(h.icon) ? 1 : 0}`; if (key === drawn) return; drawn = key;
    const dpr = Math.min(3, globalThis.devicePixelRatio || 1); cv.width = cv.height = Math.round(size * dpr); cv.style.width = cv.style.height = `${size}px`;
    const g = cv.getContext("2d"); if (!g) return;
    const v = hintVisual(h); g.setTransform(cv.width / 32, 0, 0, cv.height / 32, 0, 0); g.clearRect(0, 0, 32, 32);
    g.fillStyle = "rgba(20,16,12,.72)"; g.strokeStyle = v.ring; g.lineWidth = 2; g.beginPath(); g.arc(16, 16, 14.5, 0, Math.PI * 2); g.fill(); g.stroke();
    const im = image(h.icon);
    if (im) g.drawImage(im, 5, 5, 22, 22); else { g.save(); g.translate(4, 4); g.scale(0.75, 0.75); drawToolPlaceholder(g, h.icon, v.grey ? "#B8B0A8" : "#FFFAF0"); g.restore(); }
    if (v.lock) drawLock(g);
  };
  const tick = (now: number): void => {
    raf = requestAnimationFrame(tick);
    try {
      if (now - lastScan > 150) {
        lastScan = now; const p = d.player();
        cur = p === undefined || d.hidden() || !d.enabled() ? undefined : toolHint(d.world(), p);
      }
      const cam = d.camera();
      el.dataset["show"] = String(!!cur && !!cam);
      if (cur) shown = cur; // keep the last hint while fading out
      if (!shown || !cam) return;
      const size = d.device?.() === "touch" ? 44 : 34; draw(shown, size);
      el.dataset["icon"] = shown.icon; el.dataset["have"] = String(shown.have); el.setAttribute("aria-label", shown.label); el.title = shown.label;
      const s = isoToCss(cam, shown.x, shown.y); const lift = 40 * Math.max(0.6, Math.min(2, cam.drawZoom));
      el.style.transform = `translate(${Math.round(s.x - size / 2)}px,${Math.round(s.y - lift - size)}px)`;
    } catch { el.dataset["show"] = "false"; }
  };
  raf = requestAnimationFrame(tick);
  return { current: () => cur, destroy: () => { cancelAnimationFrame(raf); el.remove(); style.remove(); } };
}
