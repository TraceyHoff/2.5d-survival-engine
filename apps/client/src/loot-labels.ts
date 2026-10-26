/**
 * ADR-161 floating world labels for loot bags and dropped items. One 2D overlay canvas (#loot-labels, pointer-events
 * none) redrawn per frame only while labels are on screen: no DOM nodes per label, so no layout work at all (ADR-158).
 * Text comes from the replicated LootSummary (lootLabelText); labels within LOOT_LABEL.range tiles of the local player
 * show, nearest first, merged when they overlap on screen (mergeLabels). Each bag gets a soft gold ground glow; the
 * nearest bag inside containerReach also shows the Interact prompt for the active device ([E] / gamepad / "Tap").
 */
import { PlayerId, Transform, type Entity, type World } from "@engine/core";
import { gameplayDefs, LOOT_LABEL, lootLabelText, LootBag, LootSummary, mergeLabels, type LabelPoint } from "@engine/gameplay";
import { DEFAULT_ISO, screenToWorld, worldToScreen } from "@engine/world";
import type { CameraLike } from "./world-tools.js";
import type { PromptDevice } from "./farm-prompt.js";

export interface LootLabelDeps {
  world(): World; player(): Entity | undefined; camera(): CameraLike | undefined; hidden(): boolean;
  device(): PromptDevice; key(): string;
}
/** Prompt line for the nearest bag in reach. */
export const lootPrompt = (device: PromptDevice, key: string): string => (device === "touch" ? "Tap ✋ to open" : key ? `[${key}] Open` : "Open");

/** Pure: label points (css px) for the bags around the player. Exported for tests / QA. */
export function lootLabelPoints(w: World, p: Entity, cam: CameraLike): (LabelPoint & { gx: number; gy: number })[] {
  if (!w.isRegistered(LootBag) || !w.isRegistered(LootSummary)) return [];
  const me = w.get(p, Transform); if (!me) return [];
  const myId = w.getField(p, PlayerId, "id"); const defs = gameplayDefs(w); const z = cam.drawZoom;
  const hw = cam.viewW / cam.dpr / 2, hh = cam.viewH / cam.dpr / 2; const out: (LabelPoint & { gx: number; gy: number })[] = [];
  for (const e of w.query([LootBag, LootSummary, Transform])) {
    const t = w.get(e, Transform)!; const dist = Math.hypot(t.x - me.x, t.y - me.y); if (dist > LOOT_LABEL.range) continue;
    const s = w.get(e, LootSummary)!; if (!s.stacks) continue;
    const owner = w.getField(e, LootBag, "owner") ?? 0;
    const text = lootLabelText(s, (id) => defs.items.get(id)?.name, !!owner && owner === myId);
    const g = worldToScreen(t.x, t.y, t.z ?? 0, DEFAULT_ISO); const gx = (g.sx - cam.x) * z + hw, gy = (g.sy - cam.y) * z + hh;
    if (gx < -80 || gy < -80 || gx > hw * 2 + 80 || gy > hh * 2 + 80) continue;
    out.push({ key: e, x: gx, y: gy - 30 * Math.max(0.7, Math.min(1.6, z)), dist, text, gx, gy });
  }
  return out;
}

/** ADR-164: CameraLike for the Canvas2D debug/fallback view (zoom 1, centred on `cam` = worldToScreen(player)), so labels
 * also show when WebGL2 / the art is unavailable. `tileH / 2 - 12` lines labels up with the fallback's entity dots. */
export function debugCamera(cam: { sx: number; sy: number }, cssW: number, cssH: number, dpr: number): CameraLike {
  const lift = DEFAULT_ISO.tileH / 2 - 12;
  return { x: cam.sx, y: cam.sy - lift, viewW: cssW * dpr, viewH: cssH * dpr, dpr, drawZoom: 1,
    cssToWorld: (x, y) => screenToWorld(x - cssW / 2 + cam.sx, y - cssH / 2 + cam.sy) };
}

export function mountLootLabels(root: HTMLElement, d: LootLabelDeps): { destroy(): void } {
  const cv = document.createElement("canvas"); cv.id = "loot-labels";
  cv.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:4"; root.append(cv);
  let raf = 0; let drewLast = false;
  const tick = (now: number): void => {
    raf = requestAnimationFrame(tick);
    try {
      const w = d.world(); const p = d.player(); const cam = d.camera();
      const pts = p === undefined || !cam || d.hidden() ? [] : lootLabelPoints(w, p, cam);
      cv.dataset["count"] = String(pts.length);
      if (!pts.length && !drewLast) return; // idle: zero canvas work
      const dpr = Math.min(3, globalThis.devicePixelRatio || 1); const W = root.clientWidth || innerWidth, H = root.clientHeight || innerHeight;
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = `${W}px`; cv.style.height = `${H}px`; }
      const g = cv.getContext("2d"); if (!g) return; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
      drewLast = pts.length > 0; if (!drewLast || !cam || p === undefined) return;
      const zs = Math.max(0.7, Math.min(1.6, cam.drawZoom)); const pulse = 0.22 + 0.08 * Math.sin(now / 420);
      for (const q of pts) { // subtle ground glow under every bag in range
        const rx = 20 * zs, ry = 10 * zs; const gr = g.createRadialGradient(q.gx, q.gy, 0, q.gx, q.gy, rx);
        gr.addColorStop(0, `rgba(255,214,120,${pulse.toFixed(3)})`); gr.addColorStop(1, "rgba(255,214,120,0)");
        g.save(); g.translate(q.gx, q.gy); g.scale(1, ry / rx); g.translate(-q.gx, -q.gy); g.fillStyle = gr; g.beginPath(); g.arc(q.gx, q.gy, rx, 0, Math.PI * 2); g.fill(); g.restore();
      }
      const reach = gameplayDefs(w).building.containerReach; const merged = mergeLabels(pts);
      const nearest = merged[0]; const prompt = nearest && nearest.dist <= reach ? lootPrompt(d.device(), d.key()) : undefined;
      const fs = Math.round(13 * Math.max(1, Math.min(1.25, zs))); // >= 13 css px: readable at 1080p
      g.textAlign = "center"; g.textBaseline = "middle";
      for (const m of merged) {
        const near = m === nearest && !!prompt; const fade = near ? 1 : Math.max(0.45, 1 - m.dist / LOOT_LABEL.range);
        g.font = `600 ${fs}px Fredoka,system-ui,sans-serif`; const tw = g.measureText(m.text).width;
        let pw = 0; if (near) { g.font = `700 ${fs - 1}px Fredoka,system-ui,sans-serif`; pw = g.measureText(prompt!).width; }
        const bw = Math.max(tw, pw) + 16, bh = near ? fs * 2 + 12 : fs + 10; const x = m.x - bw / 2, y = m.y - bh;
        g.globalAlpha = fade; g.shadowColor = "rgba(255,200,90,.55)"; g.shadowBlur = near ? 10 : 6;
        g.fillStyle = "rgba(20,16,12,.78)"; g.beginPath(); g.roundRect(x, y, bw, bh, 8); g.fill(); g.shadowBlur = 0;
        g.strokeStyle = near ? "#F2D27E" : "rgba(230,196,126,.7)"; g.lineWidth = near ? 2 : 1.25; g.stroke();
        g.font = `600 ${fs}px Fredoka,system-ui,sans-serif`; g.fillStyle = "#FFFAF0"; g.fillText(m.text, m.x, y + fs / 2 + 5);
        if (near) { g.font = `700 ${fs - 1}px Fredoka,system-ui,sans-serif`; g.fillStyle = "#F2D27E"; g.fillText(prompt!, m.x, y + fs * 1.5 + 7); }
      }
      g.globalAlpha = 1;
    } catch { /* replica mid-swap */ }
  };
  raf = requestAnimationFrame(tick);
  return { destroy: () => { cancelAnimationFrame(raf); cv.remove(); } };
}
