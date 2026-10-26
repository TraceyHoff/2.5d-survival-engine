/**
 * ADR-173: small name tags over other players. Built like the loot labels (ADR-161): one 2D overlay canvas
 * (#name-tags, pointer-events none), redrawn only while tags are on screen, with no DOM nodes per tag and so no layout
 * work. It works over WebGL and the Canvas2D fallback (same CameraLike, via debugCamera).
 * - Names come from the replicated name directory (NetClient.names; unknown ids are requested).
 * - Party mates are tinted green, clan mates blue.
 * - Your own player never gets a tag. Tags fade with distance and vanish past NAME_TAG.range tiles.
 * - Toggle: Settings → "Show player names" (Settings.nameTags, on by default).
 */
import { Membership, PlayerId, PrevTransform, Transform, lerp, type Entity, type World } from "@engine/core";
import { Dead } from "@engine/gameplay";
import { DEFAULT_ISO, worldToScreen } from "@engine/world";
import type { CameraLike } from "./world-tools.js";

export const NAME_TAG = { range: 22, fullUntil: 8, minAlpha: 0.25, font: 12, lift: 78 } as const;
export const TAG_COLORS = { other: "#FFFAF0", party: "#8EF08A", clan: "#8CC8FF" } as const;
export type TagKind = keyof typeof TAG_COLORS;
export interface NameTagPoint { e: Entity; x: number; y: number; dist: number; name: string; kind: TagKind; alpha: number }
export interface NameLookupLike { get(id: number): string | undefined }

/** Pure: the tags for every other living player near `p`, in CSS px, farthest first so nearer tags draw on top. */
export function nameTagPoints(w: World, p: Entity, cam: CameraLike, names: NameLookupLike, alpha = 1): NameTagPoint[] {
  const me = w.get(p, Transform); if (!me) return [];
  const myParty = w.getField(p, Membership, "partyId") ?? 0, myClan = w.getField(p, Membership, "clanId") ?? 0;
  const z = cam.drawZoom; const hw = cam.viewW / cam.dpr / 2, hh = cam.viewH / cam.dpr / 2;
  const dead = w.isRegistered(Dead); const out: NameTagPoint[] = [];
  for (const e of w.query([PlayerId, Transform])) {
    if (e === p || (dead && w.has(e, Dead))) continue;
    const t = w.get(e, Transform)!; const pv = w.get(e, PrevTransform) ?? t;
    const x = lerp(pv.x, t.x, alpha), y = lerp(pv.y, t.y, alpha); const dist = Math.hypot(x - me.x, y - me.y); if (dist > NAME_TAG.range) continue;
    const id = w.getField(e, PlayerId, "id") ?? 0; const name = (id && names.get(id)) || ""; if (!name) continue;
    const g = worldToScreen(x, y, t.z ?? 0, DEFAULT_ISO); const sx = (g.sx - cam.x) * z + hw, sy = (g.sy - cam.y) * z + hh - NAME_TAG.lift * z; // sprite scales with drawZoom, so the lift must too
    if (sx < -60 || sy < -30 || sx > hw * 2 + 60 || sy > hh * 2 + 30) continue;
    const party = w.getField(e, Membership, "partyId") ?? 0, clan = w.getField(e, Membership, "clanId") ?? 0;
    const kind: TagKind = myParty && party === myParty ? "party" : myClan && clan === myClan ? "clan" : "other";
    const fade = dist <= NAME_TAG.fullUntil ? 1 : 1 - (dist - NAME_TAG.fullUntil) / (NAME_TAG.range - NAME_TAG.fullUntil);
    out.push({ e, x: sx, y: sy, dist, name: name.slice(0, 24), kind, alpha: Math.max(NAME_TAG.minAlpha, fade) });
  }
  return out.sort((a, b) => b.dist - a.dist);
}

export interface NameTagDeps { world(): World; player(): Entity | undefined; camera(): CameraLike | undefined; hidden(): boolean; enabled(): boolean; names(): NameLookupLike | undefined; alpha(): number }
export function mountNameTags(root: HTMLElement, d: NameTagDeps): { destroy(): void } {
  const cv = document.createElement("canvas"); cv.id = "name-tags"; cv.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:4"; root.append(cv);
  let raf = 0, drewLast = false, lastSig = ""; const widths = new Map<string, number>(); // measureText cache (names rarely change)
  const tick = (): void => {
    raf = requestAnimationFrame(tick);
    try {
      const w = d.world(), p = d.player(), cam = d.camera(), names = d.names();
      const pts = p === undefined || !cam || !names || d.hidden() || !d.enabled() ? [] : nameTagPoints(w, p, cam, names, d.alpha());
      const sig = pts.map((q) => `${q.name}:${q.kind}`).join(","); // test hooks; only touch the DOM when they change
      if (sig !== lastSig) { lastSig = sig; cv.dataset["count"] = String(pts.length); cv.dataset["names"] = sig; }
      if (!pts.length && !drewLast) return;
      const dpr = Math.min(3, globalThis.devicePixelRatio || 1); const W = root.clientWidth || innerWidth, H = root.clientHeight || innerHeight;
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = `${W}px`; cv.style.height = `${H}px`; }
      const g = cv.getContext("2d"); if (!g) return; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
      drewLast = pts.length > 0; if (!drewLast) return;
      const fs = NAME_TAG.font; g.font = `600 ${fs}px Fredoka,system-ui,sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
      for (const q of pts) {
        let tw = widths.get(q.name); if (tw === undefined) { tw = g.measureText(q.name).width; if (widths.size > 256) widths.clear(); widths.set(q.name, tw); }
        const bw = tw + 12, bh = fs + 6; g.globalAlpha = q.alpha;
        g.fillStyle = "rgba(16,14,12,.62)"; g.beginPath(); g.roundRect(q.x - bw / 2, q.y - bh / 2, bw, bh, 6); g.fill();
        if (q.kind !== "other") { g.strokeStyle = TAG_COLORS[q.kind]; g.lineWidth = 1; g.stroke(); }
        g.fillStyle = TAG_COLORS[q.kind]; g.fillText(q.name, q.x, q.y + 0.5);
      }
      g.globalAlpha = 1;
    } catch { /* replica mid-swap */ }
  };
  raf = requestAnimationFrame(tick);
  return { destroy: () => { cancelAnimationFrame(raf); cv.remove(); } };
}
