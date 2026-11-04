/**
 * World map (Task 9): a north-up top-down canvas of the client's known terrain, the player's position + facing, and
 * map markers. North is up (world -y), east is right (world +x). Tiles are coloured with the renderer's TILE_COLORS
 * by TileId; only chunks the client has received are drawn (unknown tiles stay dark), so the map never invents terrain.
 * Input: touch/mouse drag to pan, wheel to zoom, tap/click to place a marker (opens a creation form: label + visibility
 * Private/Party/Clan, set at creation and enforced server-side). Gamepad/keyboard: the panel is a normal UINav modal —
 * pan buttons move the centre crosshair, "Mark here" (pad X) places a marker at the crosshair, "Mark my location"
 * places one at the player, "Centre on me" (pad Y) recentres; D-pad/Tab/Enter navigate the controls (UINav owns the
 * D-pad for focus, so there is no free gamepad cursor — the crosshair is the gamepad placement point).
 * Compass: a rose on the canvas (fixed N/E/S/W, needle = facing) plus the HUD compass strip (compass-hud.ts).
 */
import { Transform, type Entity, type World } from "@engine/core";
import { compassOf, placeMapMarkerIntent, removeMapMarkerIntent, visibleMarkers, type MenuIntent } from "@engine/gameplay";
import { TILE_COLORS } from "@engine/render";
import type { TileMap } from "@engine/world";

export interface WorldMapSource {
  world(): World | undefined;
  player(): Entity | undefined;
  tiles(): TileMap | undefined;
  send(i: MenuIntent): boolean;
  status?(t: string): void;
}
/** Pin colour by MarkerVisibility (0 private, 1 party, 2 clan). */
export const markerPinColor = (visibility: number): string => visibility === 1 ? "#7dff9b" : visibility === 2 ? "#ffb347" : "#7fb3ff";
export const MARKER_VISIBILITY_LABELS = ["Private", "Party", "Clan"] as const;
/** World tile coords of a canvas pixel. Centre = world point at canvas centre; scale = px per tile. */
export function canvasToWorld(px: number, py: number, w: number, h: number, centre: { x: number; y: number }, scale: number): { x: number; y: number } {
  return { x: centre.x + (px - w / 2) / scale, y: centre.y + (py - h / 2) / scale };
}
/** Canvas pixel of a world point (inverse of canvasToWorld). */
export function worldToCanvas(x: number, y: number, w: number, h: number, centre: { x: number; y: number }, scale: number): { px: number; py: number } {
  return { px: (x - centre.x) * scale + w / 2, py: (y - centre.y) * scale + h / 2 };
}

export function createWorldMap(src: WorldMapSource, doc: Document = document): { el: HTMLElement; destroy(): void } {
  const el = doc.createElement("div"); el.dataset["role"] = "world-map"; el.style.cssText = "display:flex;flex-direction:column;gap:8px";
  const canvas = doc.createElement("canvas"); canvas.dataset["role"] = "map-canvas"; canvas.width = 480; canvas.height = 360;
  canvas.style.cssText = "width:100%;height:360px;touch-action:none;background:#1b1f1a;border:2px solid #74432C;border-radius:8px;cursor:crosshair";
  canvas.setAttribute("aria-label", "World map — drag to pan, tap a spot to place a marker");
  const state = { centre: { x: 0, y: 0 }, scale: 8, following: true, drag: null as null | { px: number; py: number; cx: number; cy: number }, placed: null as null | { x: number; y: number } };
  const controls = doc.createElement("div"); controls.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;align-items:center";
  const btn = (t: string, fn: () => void, extra?: Record<string, string>): HTMLButtonElement => { const b = doc.createElement("button"); b.type = "button"; b.textContent = t; if (extra) for (const [k, v] of Object.entries(extra)) b.dataset[k] = v; b.addEventListener("click", fn); controls.append(b); return b; };
  const pan = (dx: number, dy: number): void => { state.following = false; state.centre.x += dx; state.centre.y += dy; draw(); };
  btn("↑", () => pan(0, -4), { key: "pan-up" }); btn("↓", () => pan(0, 4), { key: "pan-down" }); btn("←", () => pan(-4, 0), { key: "pan-left" }); btn("→", () => pan(4, 0), { key: "pan-right" });
  btn("Centre on me", () => { state.following = true; draw(); }, { pad: "Y", padLabel: "Centre on me" });
  btn("Mark here", () => { state.placed = { ...state.centre }; showForm(); }, { pad: "X", padLabel: "Mark here" });
  btn("Mark my location", () => { const w = src.world(), p = src.player(); if (!w || p === undefined) return; const t = w.get(p, Transform); if (!t) return; state.placed = { x: t.x, y: t.y }; showForm(); });
  btn("Zoom +", () => { state.scale = Math.min(32, state.scale * 1.5); draw(); }); btn("Zoom −", () => { state.scale = Math.max(2, state.scale / 1.5); draw(); });
  const note = doc.createElement("p"); note.dataset["role"] = "map-note"; note.style.cssText = "margin:0;font-size:13px"; note.textContent = "Tap a spot on the map (or use Mark here / Mark my location) to place a marker. Markers are small pins; tap one in the list to remove it.";
  // Marker creation form (hidden until a spot is picked).
  const form = doc.createElement("div"); form.dataset["role"] = "marker-form"; form.hidden = true; form.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;align-items:center";
  const labelInput = doc.createElement("input"); labelInput.type = "text"; labelInput.maxLength = 24; labelInput.placeholder = "Marker name"; labelInput.setAttribute("aria-label", "Marker name");
  const visSelect = doc.createElement("select"); visSelect.setAttribute("aria-label", "Marker visibility");
  for (let i = 0; i < 3; i++) { const o = doc.createElement("option"); o.value = String(i); o.textContent = MARKER_VISIBILITY_LABELS[i]!; visSelect.append(o); }
  const placeBtn = doc.createElement("button"); placeBtn.type = "button"; placeBtn.textContent = "Place marker"; placeBtn.dataset["role"] = "submit";
  const cancelBtn = doc.createElement("button"); cancelBtn.type = "button"; cancelBtn.className = "alt"; cancelBtn.textContent = "Cancel";
  form.append(labelInput, visSelect, placeBtn, cancelBtn);
  const showForm = (): void => { form.hidden = false; labelInput.value = ""; labelInput.focus(); };
  placeBtn.addEventListener("click", () => { if (!state.placed) return; const ok = src.send(placeMapMarkerIntent(state.placed.x, state.placed.y, Number(visSelect.value), labelInput.value || "Marker")); note.textContent = ok ? "Marker placed." : "Could not place marker — are you connected?"; src.status?.(note.textContent); form.hidden = true; state.placed = null; draw(); });
  cancelBtn.addEventListener("click", () => { form.hidden = true; state.placed = null; draw(); });
  // Own markers list (removal is owner-only server-side, so only own markers get a Remove button).
  const list = doc.createElement("div"); list.dataset["role"] = "marker-list"; list.style.cssText = "display:flex;flex-direction:column;gap:4px";
  let listKey = "";
  const rebuildList = (): void => { const w = src.world(), p = src.player(); if (!w || p === undefined) { if (listKey !== "") { listKey = ""; list.replaceChildren(); } return; }
    // Every visible marker is listed; removal of a marker the viewer does not own is rejected server-side (not_owner).
    const all = visibleMarkers(w, p);
    const key = all.map((m) => `${m.entity}:${m.label}:${m.visibility}`).join("|"); if (key === listKey) return; listKey = key; list.replaceChildren();
    for (const m of all) { const row = doc.createElement("div"); row.style.cssText = "display:flex;gap:6px;align-items:center;font-size:13px";
      const dot = doc.createElement("span"); dot.textContent = "📍"; dot.style.color = markerPinColor(m.visibility); row.append(dot);
      const t = doc.createElement("span"); t.textContent = `${m.label || "Marker"} (${MARKER_VISIBILITY_LABELS[m.visibility] ?? "Private"})`; row.append(t);
      const rm = doc.createElement("button"); rm.type = "button"; rm.className = "alt"; rm.textContent = "Remove"; rm.dataset["marker"] = String(m.entity);
      rm.addEventListener("click", () => { const ok = src.send(removeMapMarkerIntent(m.entity)); note.textContent = ok ? "Marker removed." : "Could not remove marker (only the owner can remove it)."; src.status?.(note.textContent); });
      row.append(rm); list.append(row); } };
  el.append(canvas, controls, note, form, list);
  // Pointer: drag pans; a click without drag opens the creation form at that spot.
  canvas.addEventListener("pointerdown", (e) => { canvas.setPointerCapture(e.pointerId); state.drag = { px: e.clientX, py: e.clientY, cx: state.centre.x, cy: state.centre.y }; });
  canvas.addEventListener("pointermove", (e) => { if (!state.drag) return; const r = canvas.getBoundingClientRect(); const sx = canvas.width / Math.max(1, r.width), sy = canvas.height / Math.max(1, r.height);
    state.centre.x = state.drag.cx - (e.clientX - state.drag.px) * sx / state.scale; state.centre.y = state.drag.cy - (e.clientY - state.drag.py) * sy / state.scale; state.following = false; draw(); });
  canvas.addEventListener("pointerup", (e) => { const d = state.drag; state.drag = null; if (!d) return; const moved = Math.hypot(e.clientX - d.px, e.clientY - d.py);
    if (moved < 6) { const r = canvas.getBoundingClientRect(); state.placed = canvasToWorld((e.clientX - r.left) * canvas.width / Math.max(1, r.width), (e.clientY - r.top) * canvas.height / Math.max(1, r.height), canvas.width, canvas.height, state.centre, state.scale); showForm(); } });
  canvas.addEventListener("wheel", (e) => { e.preventDefault(); state.scale = Math.min(32, Math.max(2, state.scale * (e.deltaY < 0 ? 1.25 : 0.8))); draw(); }, { passive: false });
  const draw = (): void => { const ctx = canvas.getContext("2d"); if (!ctx) return; const w = src.world(), p = src.player(); if (w && p !== undefined) { const t = w.get(p, Transform); if (t && state.following) state.centre = { x: t.x, y: t.y }; }
    const W = canvas.width, H = canvas.height, s = state.scale, c = state.centre;
    ctx.clearRect(0, 0, W, H); ctx.fillStyle = "#1b1f1a"; ctx.fillRect(0, 0, W, H);
    const tiles = src.tiles(); const x0 = Math.floor(c.x - W / 2 / s) - 1, x1 = Math.ceil(c.x + W / 2 / s) + 1, y0 = Math.floor(c.y - H / 2 / s) - 1, y1 = Math.ceil(c.y + H / 2 / s) + 1;
    if (tiles) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const id = tiles.getTile(x, y); if (!id) continue; ctx.fillStyle = TILE_COLORS[id % TILE_COLORS.length]!; ctx.fillRect((x - c.x) * s + W / 2, (y - c.y) * s + H / 2, Math.ceil(s) + 0.5, Math.ceil(s) + 0.5); }
    // Crosshair at the centre (the gamepad placement point).
    ctx.strokeStyle = "rgba(255,250,240,.8)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(W / 2 - 8, H / 2); ctx.lineTo(W / 2 + 8, H / 2); ctx.moveTo(W / 2, H / 2 - 8); ctx.lineTo(W / 2, H / 2 + 8); ctx.stroke();
    // Markers (small but visible pins).
    if (w && p !== undefined) for (const m of visibleMarkers(w, p)) { const { px, py } = worldToCanvas(m.x, m.y, W, H, c, s); if (px < -20 || px > W + 20 || py < -20 || py > H + 20) continue;
      ctx.fillStyle = markerPinColor(m.visibility); ctx.beginPath(); ctx.arc(px, py - 4, 5, 0, Math.PI * 2); ctx.fill(); ctx.fillRect(px - 1, py - 4, 2, 8);
      ctx.font = "bold 11px system-ui,sans-serif"; ctx.strokeStyle = "rgba(0,0,0,.8)"; ctx.lineWidth = 3; ctx.strokeText(m.label || "Marker", px + 8, py); ctx.fillStyle = "#FFFAF0"; ctx.fillText(m.label || "Marker", px + 8, py); }
    // Player arrow + compass rose.
    if (w && p !== undefined) { const t = w.get(p, Transform); if (t) { const { px, py } = worldToCanvas(t.x, t.y, W, H, c, s); const { heading } = compassOf(t.facing);
      ctx.save(); ctx.translate(px, py); ctx.rotate(heading * Math.PI / 180); ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(6, 8); ctx.lineTo(0, 4); ctx.lineTo(-6, 8); ctx.closePath(); ctx.fill(); ctx.restore();
      // Rose: fixed N/E/S/W, needle = facing.
      const rx = W - 34, ry = 34; ctx.save(); ctx.translate(rx, ry); ctx.fillStyle = "rgba(43,28,36,.85)"; ctx.beginPath(); ctx.arc(0, 0, 26, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#FFFAF0"; ctx.font = "bold 11px system-ui,sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("N", 0, -17); ctx.fillText("S", 0, 17); ctx.fillText("E", 17, 0); ctx.fillText("W", -17, 0);
      ctx.rotate(heading * Math.PI / 180); ctx.fillStyle = "#ff6b5e"; ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(4, 0); ctx.lineTo(-4, 0); ctx.closePath(); ctx.fill(); ctx.restore(); } }
    rebuildList(); };
  let raf = 0; const loop = (): void => { if (!el.isConnected) return; draw(); raf = requestAnimationFrame(loop); }; raf = requestAnimationFrame(loop);
  draw();
  return { el, destroy: () => { cancelAnimationFrame(raf); } };
}
