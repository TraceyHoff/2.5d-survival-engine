/**
 * ADR-126 client overlay: a small symbol over the nearest resource node (within ~1.5 tiles) naming the tool it needs,
 * a hand for bare-handed nodes. Owned tool: drawn normally; missing: greyed with a red lock. Fades in / out.
 * Renderer-agnostic (a DOM canvas over #game positioned from the shared camera), so it is identical on WebGL2 and the
 * Canvas2D fallback, and passive, so it works the same on touch, gamepad and keyboard / mouse (larger on touch).
 * Art: sprite keys `tool_req_<icon>` (nature_toolicons atlas, 32px + @2x, resident) via the asset registry; the
 * canvas-drawn vector placeholder is only a fallback (registry not loaded, key missing, image failed).
 * Settings: `toolHints` (on by default). DOM hook: `#tool-hint[data-icon][data-have][data-show]`.
 */
import type { Entity, World } from "@engine/core";
import { toolHint, toolReqSpriteKey, type ToolHint, type ToolReqIcon } from "@engine/gameplay";

export interface ArtFrame { src: string; sx: number; sy: number; sw: number; sh: number }
/** Sprite key of an icon in the nature_toolicons atlas. */
export const toolIconKey = toolReqSpriteKey;
interface RegistryLike { byKey(key: string): { atlas: { frameW: number; frameH: number; columns: number; pages: { scale: number; image: string }[] }; animations: Map<string, { frames: number[] }> } }
/** Resolve `tool_req_<icon>` to an atlas page rect, preferring the page nearest `scale` (dpr x CSS size / 32). */
export function toolIconFrame(reg: RegistryLike | undefined, icon: ToolReqIcon, scale = 1): ArtFrame | undefined {
  try {
    const sp = reg?.byKey(toolIconKey(icon)); if (!sp) return undefined; const a = sp.atlas; const f = sp.animations.get("idle")?.frames[0] ?? 0;
    const page = [...a.pages].sort((x, y) => Math.abs(x.scale - scale) - Math.abs(y.scale - scale))[0]; if (!page) return undefined;
    const k = page.scale; return { src: page.image, sx: (f % a.columns) * a.frameW * k, sy: Math.floor(f / a.columns) * a.frameH * k, sw: a.frameW * k, sh: a.frameH * k };
  } catch { return undefined; }
}
import { isoToCss, type CameraLike } from "./world-tools.js";

export interface ToolHintDeps {
  world(): World; player(): Entity | undefined; camera(): CameraLike | undefined;
  /** menus open / build mode */ hidden(): boolean; /** Settings toggle */ enabled(): boolean;
  device?(): "keyboardMouse" | "gamepad" | "touch";
  /** Atlas frame for `tool_req_<icon>` (see toolIconFrame); undefined: placeholder. */ art?(icon: ToolReqIcon): ArtFrame | undefined;
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
  const imgs = new Map<string, HTMLImageElement | null>(); // by src; null = loading / failed: placeholder
  const image = (icon: ToolReqIcon): { im: HTMLImageElement; f: ArtFrame } | null => {
    const f = d.art?.(icon); if (!f) return null;
    if (!imgs.has(f.src)) { imgs.set(f.src, null); const im = new Image(); im.onload = () => { imgs.set(f.src, im); drawn = ""; }; im.src = f.src; }
    const im = imgs.get(f.src); return im ? { im, f } : null;
  };
  let cur: ToolHint | undefined; let shown: ToolHint | undefined; let drawn = ""; let lastScan = 0; let raf = 0;
  const draw = (h: ToolHint, size: number): void => {
    const art = image(h.icon); const key = `${h.icon}|${h.have}|${h.equipped}|${size}|${art ? 1 : 0}`; if (key === drawn) return; drawn = key;
    const dpr = Math.min(3, globalThis.devicePixelRatio || 1); cv.width = cv.height = Math.round(size * dpr); cv.style.width = cv.style.height = `${size}px`;
    const g = cv.getContext("2d"); if (!g) return;
    const v = hintVisual(h); g.setTransform(cv.width / 32, 0, 0, cv.height / 32, 0, 0); g.clearRect(0, 0, 32, 32);
    g.fillStyle = "rgba(20,16,12,.72)"; g.strokeStyle = v.ring; g.lineWidth = 2; g.beginPath(); g.arc(16, 16, 14.5, 0, Math.PI * 2); g.fill(); g.stroke();
    if (art) { if (v.grey) g.globalAlpha = 0.55; g.drawImage(art.im, art.f.sx, art.f.sy, art.f.sw, art.f.sh, 5, 5, 22, 22); g.globalAlpha = 1; } else { g.save(); g.translate(4, 4); g.scale(0.75, 0.75); drawToolPlaceholder(g, h.icon, v.grey ? "#B8B0A8" : "#FFFAF0"); g.restore(); }
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
