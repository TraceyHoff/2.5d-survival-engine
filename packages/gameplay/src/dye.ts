/**
 * Task 25 dye system: players and AI humans craft Dye (3 berries -> 1 dye, hand recipe) and spend it to dye
 * things a different colour. A paint brush must sit in the hotbar (slots 16-23) to dye anything — the same
 * rule the Paint action enforces for build pieces (building/actions.ts, BuildFail.NoBrush).
 *
 * What can be dyed (DyeCmd, one dye per application):
 *   kind 0 (hair) — the character's hair colour (appearance primary[hair], hair palette). Needs a hair style
 *     equipped; the colour is stored even though the style is what shows it.
 *   kind 1 (worn) — a worn clothing / equipment slot's colour (appearance primary[slot], the slot's own
 *     palette: hair palette for hair/face, clothing palette otherwise). Needs a wearable equipped there.
 *   kind 2 (held) — the tool / weapon in an inventory slot (SlotDye colours[slot], packed 0xRRGGBB from the
 *     clothing palette). The main-hand held sprite is tinted in the renderer; the inventory icon shows it too.
 * Build pieces / furniture / decorations / crafting stations are dyed through the existing Paint action
 * (PaintCmd + BuildPiece.paint -> clan palette), which the brush rule now also gates.
 *
 * Dyeing is server-authoritative and atomic: the brush + dye checks run first, then the dye is removed, then
 * the colour is applied — a failed apply never consumes the dye, and a consumed dye always applies. The
 * command is a pet-style direct handler (NOT the server INPUT_QUEUE — it is not an intent-frame action) and
 * is bridged append-only in apps/server/src/protocol.ts GAMEPLAY_NET_COMMANDS.
 *
 * Bots (Task 16 guard, still in force): a bot crafts dye ONLY as a purpose-gated goal — see the dye goal in
 * ai/survivor_behaviors.ts. It crafts exactly one dye, only when it holds a paint brush in its hotbar, only
 * when it has an immediate dye target (its own hair), only once per in-game day, and the dye is consumed by
 * the dye action in the same behaviour step — never stockpiled, never junk-dropped (dye is junk-eligible only
 * for brush-less bots, see ai/base_behaviors.ts). The Task 16 idle-craft loop cannot return through this path.
 */
import { Appearance, defineCommand, entityIndex, getAppearance, setAppearance, SLOT_COUNT, SLOT_PALETTE, slotIndex, WEARABLE_SLOTS, type CommandDef, type CommandHandlers, type Entity, type World } from "@engine/core";
import { INVENTORY_SLOTS, SlotDye } from "./components.js";
import { gameplayDefs } from "./config.js";
import { Customization, onAppearanceChanged } from "./customization.js";
import { exchangeItems, hasBrushInHotbar, hasDye, slotItem } from "./inventory.js";

/** Dye target kinds (DyeCmd.kind). */
export const DyeKind = { Hair: 0, Worn: 1, Held: 2 } as const;
/** Dye palettes (DyeCmd.palette): hair palette / clothing palette. */
export const DyePalette = { Hair: 0, Clothing: 1 } as const;

/** Dye one thing: kind (0 hair / 1 worn slot / 2 held inventory slot), slot (appearance slot or inventory slot), palette (0 hair / 1 clothing), index (palette index). */
export const DyeCmd = defineCommand("gameplay.dye", { kind: "u8", slot: "u8", palette: "u8", index: "u8" });
export const DYE_COMMANDS: readonly CommandDef[] = [DyeCmd];
export const DYE_REJECT_REASONS = ["no_brush", "no_dye", "no_wearable", "bad_palette", "not_dyeable", "bad_dye_kind"] as const;
export type DyeReject = (typeof DYE_REJECT_REASONS)[number];

/** Palette length for a DyePalette value (0 = hair, 1 = clothing); undefined when the catalog is missing. */
function paletteLength(world: World, palette: number): number | undefined {
  const cat = world.getResource(Customization)?.catalog;
  if (!cat) return undefined;
  return palette === DyePalette.Hair ? cat.hairColors.length : palette === DyePalette.Clothing ? cat.clothingColors.length : undefined;
}

/** Pure validation (shared by the command handler and the bot dye goal): undefined = OK. */
export function dyeValidate(world: World, actor: Entity, kind: number, slot: number, palette: number, index: number): DyeReject | undefined {
  const defs = gameplayDefs(world);
  if (kind !== DyeKind.Hair && kind !== DyeKind.Worn && kind !== DyeKind.Held) return "bad_dye_kind";
  if (!hasBrushInHotbar(world, actor)) return "no_brush";
  if (!hasDye(world, actor)) return "no_dye";
  const len = paletteLength(world, palette);
  if (len === undefined || index >= len) return "bad_palette";
  if (kind === DyeKind.Hair) {
    if (palette !== DyePalette.Hair) return "bad_palette";
    // Task 25: getAppearance throws when the actor has no Appearance (World.get) — treat that as no wearable,
    // not a crash; a DyeCmd from an appearance-less entity is rejected, never fatal.
    const a = world.isRegistered(Appearance) && world.has(actor, Appearance) ? getAppearance(world, actor) : undefined; if (!a || !a.parts[slotIndex("hair")]) return "no_wearable";
    return undefined;
  }
  if (kind === DyeKind.Worn) {
    if (slot >= SLOT_COUNT) return "bad_dye_kind";
    const want = SLOT_PALETTE[WEARABLE_SLOTS[slot]!] === "hairColors" ? DyePalette.Hair : DyePalette.Clothing;
    if (palette !== want) return "bad_palette";
    const a = world.isRegistered(Appearance) && world.has(actor, Appearance) ? getAppearance(world, actor) : undefined; if (!a || !a.parts[slot]) return "no_wearable";
    return undefined;
  }
  // Held: an inventory slot holding a tool or weapon.
  if (slot >= INVENTORY_SLOTS) return "bad_dye_kind";
  if (palette !== DyePalette.Clothing) return "bad_palette";
  let item = 0; try { item = slotItem(world, actor, slot).item; } catch { return "not_dyeable"; }
  if (!item) return "not_dyeable";
  const d = defs.items.get(item);
  if (!d || (!d.tool && !d.weapon && !d.ranged && !d.thrown)) return "not_dyeable";
  return undefined;
}

/** Apply a validated dye (assumes dyeValidate passed): consumes 1 dye, then sets the colour. Returns false if the dye could not be taken (nothing is applied). */
export function dyeApply(world: World, actor: Entity, kind: number, slot: number, palette: number, index: number): boolean {
  const defs = gameplayDefs(world); const dye = defs.itemId("dye");
  if (!exchangeItems(world, actor, [{ item: dye, count: 1 }], [])) return false;
  if (kind === DyeKind.Held) {
    const cat = world.getResource(Customization)?.catalog; const color = cat?.clothingColors[index]?.color ?? 0;
    if (!world.has(actor, SlotDye)) world.add(actor, SlotDye, { colors: new Array<number>(INVENTORY_SLOTS).fill(0) });
    const arr = world.getArray(actor, SlotDye, "colors")!; arr[slot] = color >>> 0; world.store(SlotDye).markChanged(entityIndex(actor));
    return true;
  }
  const a = getAppearance(world, actor)!; const s = kind === DyeKind.Hair ? slotIndex("hair") : slot;
  // Dyeing works anywhere (that is the point of the portable dye + brush) — it must NOT go through
  // equipCosmetic/applyAppearance, whose edit gate requires standing at a wardrobe. The wearable itself is
  // unchanged (already owned and equipped), so only its primary colour is rewritten, via the sanctioned
  // writer (bumps Appearance.version, replicates). The palette index was range-checked in dyeValidate.
  const primary = [...a.primary]; primary[s] = index;
  setAppearance(world, actor, { bodyType: a.bodyType, skinTone: a.skinTone, parts: [...a.parts], primary, secondary: [...a.secondary] });
  onAppearanceChanged(world, actor);
  return true;
}

export function installDyeCommands(world: World, handlers: CommandHandlers): void {
  handlers.on(DyeCmd, {
    validate: (v, c) => dyeValidate(world, c.actor, v.kind, v.slot, v.palette, v.index),
    handle: (v, c) => { dyeApply(world, c.actor, v.kind, v.slot, v.palette, v.index); },
  });
}
