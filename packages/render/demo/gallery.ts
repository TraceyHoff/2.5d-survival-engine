/** Contact sheet: every frame of every loaded atlas (as packed on the GPU side) with frame index + sprite ids. */
import type { AssetRegistry } from "@engine/assets";
import type { AtlasManager } from "../src/index.js";

export function showGallery(atlas: AtlasManager, reg: AssetRegistry, title: string): void {
  document.body.innerHTML = "";
  document.documentElement.style.cssText = "overflow:auto;height:auto";
  document.body.style.cssText = "margin:0;background:#1d1f27;color:#dfe6ee;font:12px ui-monospace,monospace;overflow:visible;height:auto";
  const h = document.createElement("div"); h.style.cssText = "padding:10px 14px;font-size:14px";
  const st = atlas.stats;
  h.textContent = `${title} — ${st.atlases} atlases, ${st.sprites} sprites, ${st.frames} frames, ${st.layers} texture-array layer(s) @ ${st.layerSize}px`;
  document.body.appendChild(h);
  const byAtlas = new Map<string, string[]>();
  for (const s of reg.allSprites()) {
    const anims = s.animList.map((a) => `${a.name}[${a.frames.length}${a.directions > 1 ? `x${a.directions}d` : ""}]`).join(" ");
    const list = byAtlas.get(s.atlas.key) ?? []; list.push(`#${s.id} ${s.key} (${s.category}) ${anims}${s.building ? ` fp ${s.building.footprint.w}x${s.building.footprint.h} L${s.building.layer}` : ""}`); byAtlas.set(s.atlas.key, list);
  }
  const wrap = document.createElement("div"); wrap.style.cssText = "display:flex;flex-wrap:wrap;gap:12px;padding:0 12px 12px"; document.body.appendChild(wrap);
  for (const a of atlas.listAtlases()) {
    const box = document.createElement("div"); box.style.cssText = "background:#2a2d38;border-radius:6px;padding:8px;max-width:1240px";
    const t = document.createElement("div"); t.style.cssText = "font-weight:bold;margin-bottom:4px"; t.textContent = `atlas "${a.key}" #${a.id} — ${a.count} frames${a.rects ? " (TexturePacker rects)" : ` (grid ${a.fw}x${a.fh})`}${a.emissive ? " + emissive" : ""}`;
    box.appendChild(t);
    const scale = Math.max(1, Math.min(3, Math.floor(96 / Math.max(a.fh, a.fw))));
    const cell = (i: number): { x: number; y: number; w: number; h: number } => a.rects ? a.rects[i]! : { x: (i % a.cols) * a.fw, y: Math.floor(i / a.cols) * a.fh, w: a.fw, h: a.fh };
    const maxW = Math.max(...Array.from({ length: a.count }, (_, i) => cell(i).w)), maxH = Math.max(...Array.from({ length: a.count }, (_, i) => cell(i).h));
    const cw = maxW * scale + 6, ch = maxH * scale + 16; const perRow = Math.max(1, Math.min(a.count, Math.floor(1220 / cw)));
    const c = document.createElement("canvas"); c.width = perRow * cw; c.height = Math.ceil(a.count / perRow) * ch;
    const g = c.getContext("2d")!; g.imageSmoothingEnabled = false; g.font = "10px monospace";
    for (let i = 0; i < a.count; i++) {
      const r = cell(i); const x = (i % perRow) * cw, y = Math.floor(i / perRow) * ch;
      g.fillStyle = (i + Math.floor(i / perRow)) % 2 ? "#3a3e4c" : "#343846"; g.fillRect(x, y, cw - 2, ch - 2);
      if (a.image) g.drawImage(a.image as CanvasImageSource, r.x, r.y, r.w, r.h, x + 2, y + 2, r.w * scale, r.h * scale);
      if (a.emissive) { g.globalAlpha = 0.9; g.globalCompositeOperation = "lighter"; g.drawImage(a.emissive as CanvasImageSource, r.x, r.y, r.w, r.h, x + 2, y + 2, r.w * scale, r.h * scale); g.globalAlpha = 1; g.globalCompositeOperation = "source-over"; }
      g.fillStyle = "#cfd6e0"; g.fillText(String(i), x + 3, y + ch - 5);
    }
    box.appendChild(c);
    const l = document.createElement("pre"); l.style.cssText = "margin:4px 0 0;white-space:pre-wrap;opacity:.85"; l.textContent = (byAtlas.get(a.key) ?? []).join("\n"); box.appendChild(l);
    wrap.appendChild(box);
  }
}
