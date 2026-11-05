/**
 * Task 25: custom pixel-art icons replacing emoji used as icons / placeholders.
 * The icons are embedded as data URIs in ./game-icons-data.ts (the snapshot push
 * route carries text files only, so binary PNGs cannot be pushed that way).
 * `iconImg` builds a crisp <img> at the requested pixel size; text glyphs
 * (», ↻, ☰, ▲, ✓) are not emoji and stay as text.
 */
import { ICON_DATA } from "./game-icons-data.js";
export const iconUrl = (file: string): string => ICON_DATA[file] ?? `${import.meta.env.BASE_URL}icons/${file}`;
export function iconImg(file: string, size = 20, alt = ""): HTMLImageElement {
  const img = document.createElement("img");
  img.src = iconUrl(file); img.alt = alt; img.draggable = false;
  img.style.cssText = `width:${size}px;height:${size}px;image-rendering:pixelated;vertical-align:middle;flex:none`;
  return img;
}
/** True when an icon string is one of the new icon files (vs a text glyph like » or ☰). */
export const isIconFile = (icon: string): boolean => icon.endsWith(".png");
