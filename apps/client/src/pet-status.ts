/**
 * Task 14: a small floating badge above each pet showing what it is currently doing (guarding, fighting,
 * returning, following, staying, eating). Built like the name tags (ADR-173): one 2D overlay canvas
 * (#pet-status, pointer-events none), no DOM nodes per pet, over WebGL and the Canvas2D fallback via the same
 * CameraLike. The status comes from the replicated PetStatus component (written by petSystem only when it
 * changes); idle pets get no badge, so the world is not cluttered with dots.
 */
import { PrevTransform, Transform, lerp, type Entity, type World } from "@engine/core";
import { Dead, Pet, PetStatusComp, petStatusLabel } from "@engine/gameplay";
import { worldToScreen } from "@engine/world";
import { camIso, type CameraLike } from "./world-tools.js";

export const PET_STATUS = { range: 22, fullUntil: 8, minAlpha: 0.25, lift: 84, radius: 11 } as const;
/** Glyph colour per status (Idle has no badge). */
export const PET_STATUS_COLORS: Record<number, string> = { 1: "#8EF08A", 2: "#C9C2B8", 3: "#FFD76A", 4: "#FF6B5E", 5: "#8CC8FF", 6: "#FFB86B" };
export interface PetStatusPoint { e: Entity; x: number; y: number; dist: number; status: number; label: string; alpha: number }

/** Pure: the badges for every living pet near the camera, in screen depth order (top of screen first). */
export function petStatusPoints(w: World, cam: CameraLike, alpha = 1): PetStatusPoint[] {
  const hw = cam.viewW / cam.dpr / 2, hh = cam.viewH / cam.dpr / 2; const iso = camIso(cam);
  const dead = w.isRegistered(Dead); const out: PetStatusPoint[] = [];
  for (const e of w.query([Pet, Transform])) {
    if (dead && w.has(e, Dead)) continue;
    const cmd = w.getField(e, Pet, "cmd") ?? 0;
    const status = w.has(e, PetStatusComp) ? w.getField(e, PetStatusComp, "status")! : cmd === 2 ? 3 : cmd === 1 ? 2 : 0;
    if (status === 0 || !(status in PET_STATUS_COLORS)) continue; // idle: no badge
    const t = w.get(e, Transform)!; const pv = w.get(e, PrevTransform) ?? t;
    const x = lerp(pv.x, t.x, alpha), y = lerp(pv.y, t.y, alpha);
    const g = worldToScreen(x, y, t.z ?? 0, iso); const sx = (g.sx - cam.x) * cam.drawZoom + hw, sy = (g.sy - cam.y) * cam.drawZoom + hh - PET_STATUS.lift * cam.drawZoom;
    if (sx < -30 || sy < -30 || sx > hw * 2 + 30 || sy > hh * 2 + 30) continue;
    out.push({ e, x: sx, y: sy, dist: 0, status, label: petStatusLabel(status), alpha: 1 });
  }
  return out.sort((a, b) => a.y - b.y || a.e - b.e);
}

/** Draw one status glyph (centred on 0,0, fitting in radius r) — plain canvas paths, no emoji, no images. */
export function drawPetGlyph(g: CanvasRenderingContext2D, status: number, r: number): void {
  const c = PET_STATUS_COLORS[status] ?? "#FFFFFF"; g.strokeStyle = c; g.fillStyle = c; g.lineWidth = Math.max(1.5, r * 0.18); g.lineCap = "round"; g.lineJoin = "round";
  g.beginPath();
  if (status === 3) { // guard: shield
    g.moveTo(0, -r); g.lineTo(r * 0.7, -r * 0.55); g.lineTo(r * 0.7, r * 0.2); g.quadraticCurveTo(r * 0.7, r * 0.75, 0, r); g.quadraticCurveTo(-r * 0.7, r * 0.75, -r * 0.7, r * 0.2); g.lineTo(-r * 0.7, -r * 0.55); g.closePath();
  } else if (status === 4) { // fight: crossed swords
    g.moveTo(-r * 0.7, -r * 0.7); g.lineTo(r * 0.7, r * 0.7); g.moveTo(r * 0.7, -r * 0.7); g.lineTo(-r * 0.7, r * 0.7);
  } else if (status === 5) { // return: arrow turning back
    g.moveTo(r * 0.75, r * 0.35); g.lineTo(-r * 0.25, r * 0.35); g.lineTo(-r * 0.25, -r * 0.55); g.moveTo(-r * 0.6, -r * 0.2); g.lineTo(-r * 0.25, -r * 0.6); g.lineTo(r * 0.1, -r * 0.2);
  } else if (status === 1) { // follow: forward arrow
    g.moveTo(-r * 0.75, 0); g.lineTo(r * 0.6, 0); g.moveTo(r * 0.25, -r * 0.45); g.lineTo(r * 0.7, 0); g.lineTo(r * 0.25, r * 0.45);
  } else if (status === 2) { // stay: anchor
    g.moveTo(0, -r * 0.8); g.lineTo(0, r * 0.7); g.moveTo(-r * 0.55, -r * 0.4); g.lineTo(r * 0.55, -r * 0.4); g.moveTo(-r * 0.6, r * 0.1); g.quadraticCurveTo(0, r * 0.9, r * 0.6, r * 0.1);
  } else if (status === 6) { // eat: drumstick
    g.ellipse(0, r * 0.1, r * 0.45, r * 0.55, -0.6, 0, Math.PI * 2); g.moveTo(r * 0.3, -r * 0.3); g.lineTo(r * 0.7, -r * 0.7);
  } else { g.arc(0, 0, r * 0.4, 0, Math.PI * 2); }
  if (status === 3 || status === 6) g.fill(); else g.stroke();
}

export interface PetStatusDeps { world(): World; camera(): CameraLike | undefined; hidden(): boolean; alpha(): number }
export function mountPetStatus(root: HTMLElement, d: PetStatusDeps): { destroy(): void } {
  const cv = document.createElement("canvas"); cv.id = "pet-status"; cv.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:4"; root.append(cv);
  let raf = 0, drewLast = false, lastSig = "";
  const tick = (): void => {
    raf = requestAnimationFrame(tick);
    try {
      const w = d.world(), cam = d.camera();
      const pts = !cam || d.hidden() ? [] : petStatusPoints(w, cam, d.alpha());
      const sig = pts.map((q) => `${q.e}:${q.status}`).join(",");
      if (sig !== lastSig) { lastSig = sig; cv.dataset["count"] = String(pts.length); cv.dataset["statuses"] = sig; }
      if (!pts.length && !drewLast) return;
      const dpr = Math.min(3, globalThis.devicePixelRatio || 1); const W = root.clientWidth || innerWidth, H = root.clientHeight || innerHeight;
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = `${W}px`; cv.style.height = `${H}px`; }
      const g = cv.getContext("2d"); if (!g) return; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
      drewLast = pts.length > 0; if (!drewLast) return;
      for (const q of pts) {
        g.save(); g.translate(q.x, q.y); g.globalAlpha = q.alpha;
        g.fillStyle = "rgba(16,14,12,.62)"; g.beginPath(); g.arc(0, 0, PET_STATUS.radius, 0, Math.PI * 2); g.fill();
        drawPetGlyph(g, q.status, PET_STATUS.radius * 0.62);
        g.restore();
      }
    } catch { /* overlay must never break the frame */ }
  };
  raf = requestAnimationFrame(tick);
  return { destroy(): void { cancelAnimationFrame(raf); cv.remove(); } };
}
