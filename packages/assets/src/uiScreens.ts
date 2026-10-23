import { WEARABLE_SLOTS, BODY_TYPES } from "@engine/core";

/**
 * UI screen schema (`ui-screen/1` / `ui-partial/1`, authored in assets/ui/screens, see assets/ui/UI_GUIDE.md).
 * Engine-side widget type registry + validator. Widgets are `{ type, ...props, children? }` nodes anywhere in the tree.
 */
export const UI_WIDGET_TYPES = [
  "avatar", "backdrop", "badge", "banner", "bar", "box", "button", "card", "chatline", "checkbox", "divider", "foodbadge", "ghost",
  "icon", "include", "input", "keyhint", "list", "listitem", "lockstamp", "logo", "mapview", "minimap", "panel", "pips", "portrait",
  "rank", "repeat", "ribbon", "scrim", "slider", "slot", "stat", "statrow", "status", "stepper", "swatch", "tabs", "text", "toast",
  "toggle", "tooltip",
  // character customization (ADR-082)
  "charpreview", "cosmeticslot",
] as const;
export type UiWidgetType = (typeof UI_WIDGET_TYPES)[number];

/** Live character preview. `appearance` is a binding ("{creator.appearance}") to an AppearanceValue; drawn via resolveLayers. */
export interface CharPreviewWidget {
  type: "charpreview";
  /** Binding to an AppearanceValue (required), e.g. "{creator.appearance}". */
  appearance: string;
  /** true = drag/keys rotate through 8 facings; a number = fixed facing in radians (0 = E). Default true. */
  rotate?: boolean | number;
  /** Zoom factor (> 0, default 1) or true = user zoom (wheel/pinch). */
  zoom?: number | boolean;
  /** Body anim to play (default "idle"); may be a binding. */
  anim?: string;
  /** Optional expression key (resolveLayers `expression`). */
  expression?: string;
}
/** Picker for one wearable slot (lists catalog.bySlot(slot, bodyType)). */
export interface CosmeticSlotWidget {
  type: "cosmeticslot";
  /** WearableSlot name or a binding. */
  slot: string;
  /** Body type filter: "male" | "female" or a binding (e.g. "{creator.bodyType}"); absent = current appearance's body. */
  bodyType?: string;
  /** "all" | "unlocked" (default) | "locked", or a binding to a tag set. */
  unlocked?: string;
  /** Which palette channel the color row edits: "primary" | "secondary" | "none" (default primary). */
  paletteChannel?: "primary" | "secondary" | "none";
}

const isBinding = (v: unknown): boolean => typeof v === "string" && /^\{[^{}]+\}$/.test(v);

/** Validate a screen/partial JSON tree. Returns issues (empty = valid). Unknown widget types are errors. */
export function validateUiScreen(json: unknown, where = "screen"): string[] {
  const issues: string[] = [];
  const s = json as { schema?: unknown };
  if (!s || typeof s !== "object") return [`${where}: must be an object`];
  if (s.schema !== undefined && s.schema !== "ui-screen/1" && s.schema !== "ui-partial/1") issues.push(`${where}: unknown schema "${String(s.schema)}"`);
  const walk = (n: unknown, p: string): void => {
    if (Array.isArray(n)) { n.forEach((c, i) => walk(c, `${p}[${i}]`)); return; }
    if (!n || typeof n !== "object") return;
    const o = n as Record<string, unknown>;
    if (typeof o.type === "string") checkWidget(o, p, issues);
    for (const [k, v] of Object.entries(o)) if (k !== "type") walk(v, `${p}.${k}`);
  };
  walk(json, where);
  return issues;
}

function checkWidget(o: Record<string, unknown>, p: string, issues: string[]): void {
  const t = o.type as string; const q = `${p}(${t})`;
  if (!(UI_WIDGET_TYPES as readonly string[]).includes(t)) { issues.push(`${q}: unknown widget type`); return; }
  if (t === "charpreview") {
    if (!isBinding(o.appearance)) issues.push(`${q}: appearance must be a binding like "{creator.appearance}"`);
    if (o.rotate !== undefined && typeof o.rotate !== "boolean" && !(typeof o.rotate === "number" && Number.isFinite(o.rotate))) issues.push(`${q}: rotate must be a boolean or a facing in radians`);
    if (o.zoom !== undefined && typeof o.zoom !== "boolean" && !(typeof o.zoom === "number" && o.zoom > 0)) issues.push(`${q}: zoom must be > 0 or a boolean`);
    for (const k of ["anim", "expression"] as const) if (o[k] !== undefined && !(typeof o[k] === "string" && (isBinding(o[k]) || /^[a-z0-9_]+$/.test(o[k] as string)))) issues.push(`${q}: ${k} must be a key or a binding`);
  } else if (t === "cosmeticslot") {
    if (!(isBinding(o.slot) || (WEARABLE_SLOTS as readonly unknown[]).includes(o.slot))) issues.push(`${q}: slot must be one of ${WEARABLE_SLOTS.join("|")} or a binding`);
    if (o.bodyType !== undefined && !(isBinding(o.bodyType) || (BODY_TYPES as readonly unknown[]).includes(o.bodyType))) issues.push(`${q}: bodyType must be ${BODY_TYPES.join("|")} or a binding`);
    if (o.unlocked !== undefined && !(isBinding(o.unlocked) || ["all", "unlocked", "locked"].includes(o.unlocked as string))) issues.push(`${q}: unlocked must be all|unlocked|locked or a binding`);
    if (o.paletteChannel !== undefined && !["primary", "secondary", "none"].includes(o.paletteChannel as string)) issues.push(`${q}: paletteChannel must be primary|secondary|none`);
  }
}
