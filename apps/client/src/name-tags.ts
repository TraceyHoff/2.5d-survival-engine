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
/**
 * ADR-242: Art's pvp_clan nameplates (atlas `nameplates`, 64x24 frames, nine-slice 9/8/9/8; @2x page): neutral 0,
 * party 2, clan 3 (self 1 / enemy 4 unused: you never get a tag, PvP hostility is not replicated). Text colours from
 * pvp_clan/world_ui_colors.json nameplateText. Falls back to the dark rounded box until (or unless) the image loads.
 */
export const NAMEPLATE = { url: "pvp_clan/atlases/nameplates@2x.png", scale: 2, fw: 64, fh: 24, slice: { l: 9, t: 8, r: 9, b: 8 },
  frame: { other: 0, party: 2, clan: 3 } as Record<TagKind, number>, text: "#F6EAD2", stroke: "#2A1B2E", padX: 10 } as const;
/** Pure nine-slice: [sx, sy, sw, sh, dx, dy, dw, dh] x9 for `frame` of a 1-row atlas page at `scale`, into the dst box
 *  (border px scaled by dh / fh so a short plate keeps its proportions). */
export function nineSlice(frame: number, dx: number, dy: number, dw: number, dh: number, p: { scale: number; fw: number; fh: number; slice: { l: number; t: number; r: number; b: number } } = NAMEPLATE): number[][] {
  const k = p.scale, sx0 = frame * p.fw * k, { l, t, r, b } = p.slice, f = dh / p.fh;
  const sxs = [0, l, p.fw - r, p.fw].map((v) => sx0 + v * k), sys = [0, t, p.fh - b, p.fh].map((v) => v * k);
  const dl = Math.min(l * f, dw / 2), dr = Math.min(r * f, dw / 2);
  const dxs = [dx, dx + dl, dx + dw - dr, dx + dw], dys = [dy, dy + t * f, dy + dh - b * f, dy + dh];
  const out: number[][] = [];
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) out.push([sxs[i]!, sys[j]!, sxs[i + 1]! - sxs[i]!, sys[j + 1]! - sys[j]!, dxs[i]!, dys[j]!, dxs[i + 1]! - dxs[i]!, dys[j + 1]! - dys[j]!]);
  return out;
}
export interface NameTagPoint { e: Entity; x: number; y: number; dist: number; name: string; kind: TagKind; alpha: number }
export interface NameLookupLike { get(id: number): string | undefined }

/** Pure: the tags for every other living player near `p`, in CSS px, in screen depth order (top of screen first, entity id
 *  tie-break) so a tag stacks like its sprite. ADR-185: the old farthest-from-me order flipped every few frames when two
 *  overlapping players were about equally far (interpolation jitter), so their dark tag boxes blinked over each other. */
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
  return out.sort((a, b) => a.y - b.y || a.e - b.e); // ADR-185: stable screen-depth order
}

export const TAG_GAP = 2;
/** ADR-189: pure vertical declutter. The tag lowest on screen (nearest the camera) keeps its spot; each tag above it that
 *  would overlap an already placed tag is nudged straight up just clear of it. Deterministic from positions alone (same
 *  input -> same layout, no frame-to-frame state), so tags never jitter; the mount eases the result so a new overlap
 *  slides apart instead of snapping. Returns the target y per tag (index-aligned with `pts`). */
export function declutterTags(pts: readonly NameTagPoint[], widthOf: (name: string) => number, bh = NAME_TAG.font + 6): number[] {
  const ys = pts.map((q) => q.y); const order = pts.map((_, i) => i).sort((a, b) => pts[b]!.y - pts[a]!.y || pts[a]!.e - pts[b]!.e);
  const placed: number[] = [];
  for (const i of order) {
    const q = pts[i]!; const w = widthOf(q.name) + 12; let y = q.y;
    for (let pass = 0; pass < placed.length + 1; pass++) {
      let moved = false;
      for (const k of placed) {
        const o = pts[k]!; const ow = widthOf(o.name) + 12;
        if (Math.abs(q.x - o.x) < (w + ow) / 2 + TAG_GAP && Math.abs(y - ys[k]!) < bh + TAG_GAP) { y = ys[k]! - bh - TAG_GAP; moved = true; }
      }
      if (!moved) break;
    }
    ys[i] = y; placed.push(i);
  }
  return ys;
}

export interface NameTagDeps { world(): World; player(): Entity | undefined; camera(): CameraLike | undefined; hidden(): boolean; enabled(): boolean; names(): NameLookupLike | undefined; alpha(): number;
  /** ADR-242: `<art>/` base; when set, tags draw on Art's nameplate plates (NAMEPLATE). */ artBase?: string }
export function mountNameTags(root: HTMLElement, d: NameTagDeps): { destroy(): void } {
  const cv = document.createElement("canvas"); cv.id = "name-tags"; cv.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:4"; root.append(cv);
  const eased = new Map<Entity, number>(); let lastT = 0; // ADR-189: per-tag eased declutter offset
  let plate: HTMLImageElement | undefined; // ADR-242
  if (d.artBase !== undefined && typeof Image !== "undefined") { const im = new Image(); im.onload = () => { plate = im; }; im.src = d.artBase + NAMEPLATE.url; }
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
      const widthOf = (n: string): number => { let tw = widths.get(n); if (tw === undefined) { tw = g.measureText(n).width; if (widths.size > 256) widths.clear(); widths.set(n, tw); } return tw; };
      const ty = declutterTags(pts, widthOf); const now = performance.now(); const k = Math.min(1, Math.max(0, (now - (lastT || now)) / 1000) * 14); lastT = now;
      for (let qi = 0; qi < pts.length; qi++) { const q = pts[qi]!; const want = ty[qi]! - q.y; const o0 = eased.get(q.e); const o = o0 === undefined ? want : o0 + (want - o0) * k; eased.set(q.e, Math.abs(o - want) < 0.05 ? want : o); }
      if (eased.size > pts.length * 2 + 16) for (const e of eased.keys()) if (!pts.some((q) => q.e === e)) eased.delete(e);
      for (const q0 of pts) {
        const q = { ...q0, y: q0.y + (eased.get(q0.e) ?? 0) }; const tw = widthOf(q.name);
        const bw = tw + 12, bh = fs + 6; g.globalAlpha = q.alpha;
        if (plate) { // ADR-242: Art's nine-slice plate, cream text with a dark stroke
          const pw = tw + NAMEPLATE.padX * 2, ph = Math.round(bh * 1.25);
          for (const [sx, sy, sw, sh, dx, dy, dw, dh] of nineSlice(NAMEPLATE.frame[q.kind], q.x - pw / 2, q.y - ph / 2, pw, ph)) if (sw! > 0 && dw! > 0) g.drawImage(plate, sx!, sy!, sw!, sh!, dx!, dy!, dw!, dh!);
          g.lineWidth = 3; g.lineJoin = "round"; g.strokeStyle = NAMEPLATE.stroke; g.strokeText(q.name, q.x, q.y + 0.5); g.fillStyle = NAMEPLATE.text; g.fillText(q.name, q.x, q.y + 0.5);
        } else {
        g.fillStyle = "rgba(16,14,12,.62)"; g.beginPath(); g.roundRect(q.x - bw / 2, q.y - bh / 2, bw, bh, 6); g.fill();
        if (q.kind !== "other") { g.strokeStyle = TAG_COLORS[q.kind]; g.lineWidth = 1; g.stroke(); }
        g.fillStyle = TAG_COLORS[q.kind]; g.fillText(q.name, q.x, q.y + 0.5);
        }
      }
      g.globalAlpha = 1;
    } catch { /* replica mid-swap */ }
  };
  raf = requestAnimationFrame(tick);
  return { destroy: () => { cancelAnimationFrame(raf); cv.remove(); } };
}
