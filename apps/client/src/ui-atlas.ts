/** Art's shared UI atlas, loaded once for HUD and character-sheet status icons. */
export type Frame = { frame: { x: number; y: number; w: number; h: number }; nineSlice?: { l: number; t: number; r: number; b: number } };

/** Art's ui_atlas sprites (assets/ui/atlas) as data URLs, so CSS can nine-slice them via border-image. */
async function loadUiSprites(base: string): Promise<{ url(k: string): string | undefined; frame(k: string): Frame | undefined }> {
  const empty = { url: () => undefined, frame: () => undefined };
  try {
    const j = await fetch(`${base}art/ui/atlas/ui_atlas.json`).then((r) => r.json()) as { frames: Record<string, Frame> };
    const img = new Image(); img.src = `${base}art/ui/atlas/ui_atlas.png`; await img.decode();
    const cache = new Map<string, string>();
    return {
      frame: (k) => j.frames[k],
      url: (k) => {
        const f = j.frames[k]; if (!f) return undefined; let u = cache.get(k);
        if (!u) { const c = document.createElement("canvas"); c.width = f.frame.w; c.height = f.frame.h; c.getContext("2d")!.drawImage(img, f.frame.x, f.frame.y, f.frame.w, f.frame.h, 0, 0, f.frame.w, f.frame.h); u = c.toDataURL(); cache.set(k, u); }
        return u;
      },
    };
  } catch { return empty; }
}
const cache = new Map<string, ReturnType<typeof loadUiSprites>>();
export function uiSprites(base: string): ReturnType<typeof loadUiSprites> {
  let sprites = cache.get(base);
  if (!sprites) { sprites = loadUiSprites(base); cache.set(base, sprites); }
  return sprites;
}
