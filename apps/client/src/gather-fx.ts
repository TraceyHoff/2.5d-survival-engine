/**
 * ADR-128 client overlays (renderer-agnostic DOM, positioned from the shared camera like ADR-126's tool hint, so WebGL2
 * and the Canvas2D fallback look the same):
 *  - node health bars: when a ResourceNode's REPLICATED amount drops (any player's hit, so every client agrees) a small
 *    bar of remaining yield (amount / capacity) shows above the node, then fades out ~3 s after the last hit;
 *  - hit particles: wood chips + leaves (axe nodes), stone chips (pickaxe nodes) or leaves (hand nodes) burst away;
 *  - pickup toasts: "+3 Wood" with the item icon for every rise in the local player's inventory (gather, harvest,
 *    loot, pickup, crafting output), merged per item while it is still on screen; a short stack bottom-left, smaller
 *    and higher on touch so it never covers the sticks.
 * Pure state machines (NodeHits, ToastStack) are exported and tested; the DOM layer only draws them.
 * DOM hooks: `#gather-fx` (canvas), `#pickup-toasts > [data-role=toast][data-item]`.
 */
import { Transform, type Entity, type World } from "@engine/core";
import { gameplayDefs, listSlots, ResourceNode } from "@engine/gameplay";
import { isoToCss, type CameraLike } from "./world-tools.js";

export const NODE_BAR_MS = 3000;
export const NODE_BAR_FADE_MS = 600;
export interface NodeBar { node: Entity; x: number; y: number; frac: number; at: number; kind: "wood" | "stone" | "plant" }
/** Alpha of a node bar `ms` after its last hit (1 -> fades over the last NODE_BAR_FADE_MS of NODE_BAR_MS, then 0). */
export const nodeBarAlpha = (ms: number): number => (ms < 0 ? 0 : ms <= NODE_BAR_MS - NODE_BAR_FADE_MS ? 1 : ms >= NODE_BAR_MS ? 0 : (NODE_BAR_MS - ms) / NODE_BAR_FADE_MS);
/** Particle family for a node by the tool it asks for. */
export const particleKind = (tool: number): NodeBar["kind"] => // ToolKind 1 axe, 2 pickaxe
  (tool === 1 ? "wood" : tool === 2 ? "stone" : "plant");

/** Tracks replicated ResourceNode amounts and reports hits (amount went down) with the remaining fraction. */
export class NodeHits {
  private amt = new Map<Entity, number>(); readonly bars = new Map<Entity, NodeBar>();
  /** Scan the replica; returns the bars that were hit this call. */
  scan(world: World, now: number): NodeBar[] {
    const defs = gameplayDefs(world); const hits: NodeBar[] = []; const seen = new Set<Entity>();
    for (const e of world.query([ResourceNode, Transform])) {
      seen.add(e); const n = world.get(e, ResourceNode)!; const was = this.amt.get(e); this.amt.set(e, n.amount);
      if (was === undefined || n.amount >= was) continue;
      const def = defs.resources.get(n.kind); const cap = Math.max(1, def?.capacity ?? was); const t = world.get(e, Transform)!;
      const bar: NodeBar = { node: e, x: t.x, y: t.y, frac: Math.max(0, Math.min(1, n.amount / cap)), at: now, kind: particleKind(def?.requiredTool ?? 0) };
      this.bars.set(e, bar); hits.push(bar);
    }
    for (const e of [...this.amt.keys()]) if (!seen.has(e)) { this.amt.delete(e); this.bars.delete(e); }
    for (const [e, b] of this.bars) if (now - b.at >= NODE_BAR_MS) this.bars.delete(e);
    return hits;
  }
}

export const TOAST_MS = 2200;
export const TOAST_MAX = 4;
export interface Toast { item: number; count: number; name: string; icon: string; at: number; id: number }
/** Inventory-diff pickup toasts: one line per item, merged while visible, newest last, at most TOAST_MAX. */
export class ToastStack {
  private last: Map<number, number> | undefined; private seq = 0; toasts: Toast[] = [];
  /** Feed the current item totals; the first call (join / respawn) only primes. */
  update(totals: ReadonlyMap<number, number>, now: number, label: (item: number) => { name: string; icon: string }): void {
    const prev = this.last; this.last = new Map(totals);
    this.toasts = this.toasts.filter((t) => now - t.at < TOAST_MS);
    if (!prev) return;
    for (const [item, n] of totals) {
      const gain = n - (prev.get(item) ?? 0); if (gain <= 0) continue;
      const cur = this.toasts.find((t) => t.item === item);
      if (cur) { cur.count += gain; cur.at = now; this.toasts = [...this.toasts.filter((t) => t !== cur), cur]; }
      else { const l = label(item); this.toasts.push({ item, count: gain, name: l.name, icon: l.icon, at: now, id: ++this.seq }); }
    }
    if (this.toasts.length > TOAST_MAX) this.toasts = this.toasts.slice(-TOAST_MAX);
  }
  reset(): void { this.last = undefined; this.toasts = []; }
}
export const toastText = (t: Pick<Toast, "count" | "name">): string => `+${t.count} ${t.name}`;
export function inventoryTotals(world: World, e: Entity): Map<number, number> {
  const m = new Map<number, number>(); for (const s of listSlots(world, e)) m.set(s.item, (m.get(s.item) ?? 0) + s.count); return m;
}

interface Particle { x: number; y: number; vx: number; vy: number; life: number; age: number; color: string; size: number; leaf: boolean }
const COLORS: Record<NodeBar["kind"], string[]> = { wood: ["#C8955A", "#8B5A2B", "#5E8C3A"], stone: ["#9A9A9A", "#6E6E6E", "#C4C0B8"], plant: ["#5E8C3A", "#7FB24A", "#A3C76B"] };

export interface GatherFxDeps {
  world(): World; player(): Entity | undefined; camera(): CameraLike | undefined; hidden(): boolean;
  device?(): "keyboardMouse" | "gamepad" | "touch"; icon?(item: number, key: string): string;
}
const CSS = `#gather-fx{position:absolute;inset:0;z-index:3;pointer-events:none}
#pickup-toasts{position:absolute;left:12px;bottom:96px;z-index:5;display:flex;flex-direction:column;gap:4px;pointer-events:none;font:600 14px/1.2 system-ui,sans-serif}
#pickup-toasts[data-device=touch]{bottom:auto;top:84px;left:8px;font-size:12px}
#pickup-toasts [data-role=toast]{display:flex;align-items:center;gap:6px;padding:3px 8px 3px 4px;border-radius:6px;background:rgba(20,16,12,.62);color:#FFFAF0;transition:opacity .3s ease,transform .3s ease;text-shadow:0 1px 1px #000}
#pickup-toasts [data-role=toast][data-fade=true]{opacity:0;transform:translateX(-8px)}
#pickup-toasts .ic{width:20px;height:20px;flex:none;background:var(--cz-icon,#6b5a45) var(--cz-ipos,center)/var(--cz-isize,contain) no-repeat;border-radius:3px}`;

export function mountGatherFx(root: HTMLElement, d: GatherFxDeps): { destroy(): void } {
  const style = document.createElement("style"); style.textContent = CSS; document.head.append(style);
  const cv = document.createElement("canvas"); cv.id = "gather-fx"; root.append(cv);
  const box = document.createElement("div"); box.id = "pickup-toasts"; box.setAttribute("aria-live", "polite"); root.append(box);
  const hits = new NodeHits(); const stack = new ToastStack(); let parts: Particle[] = []; let raf = 0; let last = performance.now(); let player: Entity | undefined; let lastInv = 0;
  const label = (item: number): { name: string; icon: string } => { const it = gameplayDefs(d.world()).items.get(item); const key = it?.spriteKey ?? ""; return { name: it?.name ?? `#${item}`, icon: d.icon ? d.icon(item, key) : key }; };
  const tick = (now: number): void => {
    raf = requestAnimationFrame(tick); const dt = Math.min(0.05, (now - last) / 1000); last = now;
    try {
      const w = d.world(); const cam = d.camera(); const p = d.player();
      for (const b of hits.scan(w, now)) for (let i = 0; i < 7; i++) {
        const a = Math.random() * Math.PI * 2; const sp = 0.6 + Math.random() * 1.2; const cs = COLORS[b.kind];
        parts.push({ x: b.x, y: b.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.45 + Math.random() * 0.35, age: 0, color: cs[i % cs.length]!, size: b.kind === "stone" ? 3 : 4, leaf: b.kind !== "stone" && i % 3 === 2 });
      }
      if (p !== player) { player = p; stack.reset(); }
      if (p !== undefined && now - lastInv > 100) { lastInv = now; stack.update(inventoryTotals(w, p), now, label); }
      drawToasts(now);
      const dpr = Math.min(3, globalThis.devicePixelRatio || 1); const W = root.clientWidth || innerWidth, H = root.clientHeight || innerHeight;
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = `${W}px`; cv.style.height = `${H}px`; }
      const g = cv.getContext("2d"); if (!g) return; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
      if (!cam || d.hidden()) { parts = []; return; }
      const z = Math.max(0.6, Math.min(2, cam.drawZoom)); const touch = d.device?.() === "touch";
      for (const b of hits.bars.values()) {
        const al = nodeBarAlpha(now - b.at); if (al <= 0) continue; const s = isoToCss(cam, b.x, b.y);
        const bw = (touch ? 44 : 36) * z, bh = Math.max(4, 5 * z), x = s.x - bw / 2, y = s.y - 58 * z;
        g.globalAlpha = al; g.fillStyle = "rgba(20,16,12,.75)"; g.fillRect(x - 1, y - 1, bw + 2, bh + 2);
        g.fillStyle = b.frac > 0.5 ? "#7BC86C" : b.frac > 0.25 ? "#E6C47E" : "#C0584A"; g.fillRect(x, y, bw * b.frac, bh);
      }
      parts = parts.filter((q) => (q.age += dt) < q.life);
      for (const q of parts) {
        q.x += q.vx * dt; q.y += q.vy * dt; const s = isoToCss(cam, q.x, q.y); const lift = (24 + 40 * q.age - 90 * q.age * q.age) * z;
        g.globalAlpha = 1 - q.age / q.life; g.fillStyle = q.color;
        if (q.leaf) { g.beginPath(); g.ellipse(s.x, s.y - lift, q.size * z, q.size * 0.5 * z, q.age * 6, 0, Math.PI * 2); g.fill(); } else g.fillRect(s.x - q.size * z / 2, s.y - lift, q.size * z, q.size * z);
      }
      g.globalAlpha = 1;
    } catch { /* overlays must never break a frame */ }
  };
  const drawToasts = (now: number): void => {
    box.dataset["device"] = d.device?.() ?? "keyboardMouse"; box.hidden = d.hidden();
    const keep = new Set(stack.toasts.map((t) => String(t.id)));
    for (const el of Array.from(box.children) as HTMLElement[]) if (!keep.has(el.dataset["id"] ?? "")) el.remove();
    for (const t of stack.toasts) {
      let el = box.querySelector<HTMLElement>(`[data-id="${t.id}"]`);
      if (!el) { el = document.createElement("div"); el.dataset["role"] = "toast"; el.dataset["id"] = String(t.id); el.dataset["item"] = String(t.item); const ic = document.createElement("span"); ic.className = "ic"; ic.setAttribute("data-icon", t.icon); const tx = document.createElement("span"); el.append(ic, tx); }
      box.append(el); (el.lastChild as HTMLElement).textContent = toastText(t); el.dataset["fade"] = String(now - t.at > TOAST_MS - 350);
    }
  };
  raf = requestAnimationFrame(tick);
  return { destroy: () => { cancelAnimationFrame(raf); cv.remove(); box.remove(); style.remove(); } };
}
