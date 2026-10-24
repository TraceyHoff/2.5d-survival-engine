/**
 * ADR-119..121 client overlay: sign world labels (click to edit), the road drag tool (G cycles path -> gravel ->
 * paved -> off; drag with the mouse / touch to lay a line), sign placing (N places the first sign item you carry at
 * the cursor), the settlement HUD label (House / Village / Clan City) and horde warning toasts + audio cues.
 * DOM hooks: `#world-labels`, `.sign-label[data-sign]`, `#settlement-label[data-kind]`, `#horde-toast[data-phase]`,
 * `#road-tool[data-surface]`.
 */
import { Transform, type Entity, type World } from "@engine/core";
import { worldToScreen, DEFAULT_ISO } from "@engine/world";
import {
  Sign, HordeStatus, HordePhase, PlaceRoadCmd, PlaceSignCmd, SetSignTextCmd, SIGNS, ROADS, countItem, gameplayDefs,
  signText, sanitizeSignText, signDef, homesteads, classifySettlements, settlementNear, type MenuIntent,
} from "@engine/gameplay";

export interface CameraLike { x: number; y: number; viewW: number; viewH: number; dpr: number; readonly drawZoom: number; cssToWorld(x: number, y: number): { x: number; y: number } }
export interface WorldToolsDeps {
  world(): World; player(): Entity | undefined; camera(): CameraLike | undefined; send(i: MenuIntent): boolean;
  hidden(): boolean; sound?(key: string): void; canvas?: HTMLElement;
}
export const HORDE_TEXT = { warning: "A zombie horde is gathering — prepare your defenses!", active: "The horde is here!", defeated: "The horde has been defeated." } as const;
const CSS = `#world-labels{position:absolute;inset:0;pointer-events:none;z-index:4;overflow:hidden}
#world-labels .sign-label{position:absolute;transform:translate(-50%,-100%);pointer-events:auto;cursor:text;max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
font:600 12px Fredoka,system-ui,sans-serif;color:#3B2433;background:#F6EAD2;border:2px solid #74432C;border-radius:6px;padding:1px 6px;box-shadow:0 2px 0 #432C24}
#world-labels .sign-label[data-kind="5"]{background:#2f6b3a;color:#fff;border-color:#e8f0e8}
#settlement-label,#road-tool{position:absolute;left:50%;transform:translateX(-50%);z-index:5;font:600 13px Fredoka,system-ui,sans-serif;color:#FFFAF0;background:rgba(59,36,51,.75);border-radius:10px;padding:2px 10px;pointer-events:none}
#settlement-label{top:calc(6px + var(--sat,0px))}#road-tool{bottom:calc(90px + var(--sab,0px))}
#horde-toast{position:absolute;left:50%;top:calc(26% + var(--sat,0px));transform:translateX(-50%);z-index:6;font:700 15px Fredoka,system-ui,sans-serif;color:#FFE0D8;background:rgba(110,20,20,.88);border:2px solid #3B2433;border-radius:12px;padding:6px 14px;transition:opacity .4s;pointer-events:none}`;

export function isoToCss(cam: CameraLike, wx: number, wy: number): { x: number; y: number } {
  const s = worldToScreen(wx, wy, 0, DEFAULT_ISO); const z = cam.drawZoom;
  return { x: (s.sx - cam.x) * z + cam.viewW / cam.dpr / 2, y: (s.sy - cam.y) * z + cam.viewH / cam.dpr / 2 };
}
/** Horde HUD state machine (pure, tested): returns the cue for a HordeStatus change. */
export function hordeCue(prev: { phase: number; seq: number } | undefined, cur: { phase: number; seq: number } | undefined): "warning" | "active" | "defeated" | undefined {
  if (!cur || !prev) return undefined;
  if (cur.phase === HordePhase.Warning && (prev.phase !== HordePhase.Warning || prev.seq !== cur.seq)) return "warning";
  if (cur.phase === HordePhase.Active && prev.phase !== HordePhase.Active) return "active";
  if (cur.phase === HordePhase.Idle && prev.phase === HordePhase.Active) return "defeated";
  return undefined;
}
const encode = (t: string): { len: number; text: number[] } => { const b = Array.from({ length: 48 }, (_, i) => t.charCodeAt(i) || 0); return { len: Math.min(48, t.length), text: b }; };

export function mountWorldTools(root: HTMLElement, d: WorldToolsDeps): { destroy(): void; roadSurface(): number } {
  const style = document.createElement("style"); style.textContent = CSS; document.head.append(style);
  const layer = document.createElement("div"); layer.id = "world-labels";
  const place = document.createElement("div"); place.id = "settlement-label"; place.style.display = "none";
  const tool = document.createElement("div"); tool.id = "road-tool"; tool.style.display = "none";
  const toast = document.createElement("div"); toast.id = "horde-toast"; toast.setAttribute("role", "alert"); toast.style.opacity = "0";
  root.append(layer, place, tool, toast);
  const pool = new Map<Entity, HTMLDivElement>();
  let surface = 0; let dragFrom: { x: number; y: number } | undefined; let pointer = { x: innerWidth / 2, y: innerHeight / 2 };
  let prevHorde: { phase: number; seq: number } | undefined; let toastTimer: ReturnType<typeof setTimeout> | undefined;
  const aimTile = (): { x: number; y: number } | undefined => { const c = d.camera(); if (!c) return undefined; const w = c.cssToWorld(pointer.x, pointer.y); return { x: Math.floor(w.x), y: Math.floor(w.y) }; };
  const edit = (e: Entity): void => {
    const w = d.world(); const cur = signText(w, e); const max = signDef(w.get(e, Sign)?.kind ?? 0)?.maxLen ?? 48;
    const t = globalThis.prompt?.(`Sign text (max ${max})`, cur); if (t == null) return;
    d.send({ cmd: SetSignTextCmd, args: { sign: e, ...encode(sanitizeSignText(t, max)) }, entities: ["sign"] } as unknown as MenuIntent);
  };
  layer.addEventListener("click", (ev) => { const el = (ev.target as HTMLElement).closest<HTMLElement>(".sign-label"); if (el) edit(Number(el.dataset["sign"]) as Entity); });
  const typing = (e: KeyboardEvent): boolean => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
  const onKey = (e: KeyboardEvent): void => {
    if (e.repeat || typing(e) || d.hidden()) return;
    if (e.code === "KeyG") { surface = (surface + 1) % (ROADS.surfaces.length + 1); }
    else if (e.code === "KeyN") {
      const w = d.world(), p = d.player(), at = aimTile(); if (p === undefined || !at) return; const defs = gameplayDefs(w);
      const kind = SIGNS.findIndex((s) => { try { return countItem(w, p, defs.itemId(s.item)) > 0; } catch { return false; } }) + 1;
      if (kind > 0) d.send({ cmd: PlaceSignCmd, args: { kind, x: at.x + 0.5, y: at.y + 0.5, rot: 0 } } as unknown as MenuIntent);
    }
  };
  const target = d.canvas ?? document;
  const down = (e: Event): void => { const pe = e as PointerEvent; pointer = { x: pe.clientX, y: pe.clientY }; if (surface && !d.hidden()) dragFrom = aimTile(); };
  const move = (e: Event): void => { const pe = e as PointerEvent; pointer = { x: pe.clientX, y: pe.clientY }; };
  const up = (e: Event): void => {
    const pe = e as PointerEvent; pointer = { x: pe.clientX, y: pe.clientY }; const a = dragFrom; dragFrom = undefined; const b = aimTile();
    if (surface && a && b) d.send({ cmd: PlaceRoadCmd, args: { x0: a.x, y0: a.y, x1: b.x, y1: b.y, surface } } as unknown as MenuIntent);
  };
  document.addEventListener("keydown", onKey); target.addEventListener("pointerdown", down); target.addEventListener("pointermove", move); target.addEventListener("pointerup", up);
  let raf = 0, slow = 0;
  const frame = (): void => {
    raf = requestAnimationFrame(frame);
    try {
      const w = d.world(), p = d.player(), cam = d.camera(); const hide = d.hidden() || p === undefined || !cam;
      layer.style.display = hide ? "none" : "";
      tool.style.display = surface && !hide ? "" : "none"; if (surface) { tool.dataset["surface"] = String(surface); tool.textContent = `Road tool: ${ROADS.surfaces[surface - 1]!.name} — drag to lay (G: next / off)`; }
      if (hide || !w.isRegistered(Sign)) return;
      const pt = w.get(p!, Transform); if (!pt) return;
      const seen = new Set<Entity>();
      for (const e of w.query([Sign, Transform])) {
        const t = w.get(e, Transform)!; if (Math.hypot(t.x - pt.x, t.y - pt.y) > 22 || seen.size >= 40) continue;
        const txt = signText(w, e); if (!txt) continue; seen.add(e);
        let el = pool.get(e); if (!el) { el = document.createElement("div"); el.className = "sign-label"; el.dataset["sign"] = String(e); layer.append(el); pool.set(e, el); }
        if (el.textContent !== txt) el.textContent = txt; el.dataset["kind"] = String(w.get(e, Sign)!.kind);
        const c = isoToCss(cam!, t.x, t.y); el.style.left = `${c.x.toFixed(1)}px`; el.style.top = `${(c.y - 28 * cam!.drawZoom).toFixed(1)}px`;
      }
      for (const [e, el] of pool) if (!seen.has(e)) { el.remove(); pool.delete(e); }
      const now = performance.now(); if (now - slow < 1000) return; slow = now;
      // settlement label
      const list = classifySettlements(homesteads(w, (tribe) => tribe !== 0));
      const s = settlementNear(list, pt.x, pt.y); place.style.display = s ? "" : "none";
      if (s) { place.dataset["kind"] = String(s.kind); place.textContent = `📍 ${s.label}${s.players.length > 1 ? ` · ${s.players.length} residents` : ""}`; }
      // hordes
      const st = w.has(w.environment, HordeStatus) ? w.get(w.environment, HordeStatus)! : undefined;
      const cur = st ? { phase: st.phase, seq: st.seq } : undefined;
      const cue = hordeCue(prevHorde, cur); prevHorde = cur;
      if (cue) {
        toast.dataset["phase"] = cue; toast.textContent = cue === "warning" ? `${HORDE_TEXT.warning} (~${st!.size} zombies)` : HORDE_TEXT[cue]; toast.style.opacity = "1";
        clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.style.opacity = "0"; }, 5000);
        d.sound?.(cue === "warning" ? "horde.warning" : cue === "active" ? "horde.spawn" : "horde.defeated");
      }
    } catch { /* overlay must never break a frame */ }
  };
  raf = requestAnimationFrame(frame);
  return {
    roadSurface: () => surface,
    destroy: () => { cancelAnimationFrame(raf); clearTimeout(toastTimer); document.removeEventListener("keydown", onKey); target.removeEventListener("pointerdown", down); target.removeEventListener("pointermove", move); target.removeEventListener("pointerup", up); layer.remove(); place.remove(); tool.remove(); toast.remove(); style.remove(); },
  };
}
