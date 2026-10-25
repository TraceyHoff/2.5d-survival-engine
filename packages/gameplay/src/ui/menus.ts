/**
 * Menu view-models + command builders for the client's in-game menus (apps/client game-menus.ts, ADR-095 shell).
 * Pure reads over a World (client replica or server world) and plain {cmd, args} intents; no DOM, browser-safe.
 * The client sends intents through its net bridge (`gameplayNet(cmd)`); entity args (target/stall) are Entities here
 * and the sender maps them to NetIds. Server handlers re-validate everything; reasons here are only hints.
 */
import { Appearance, GroupRole, Membership, PlayerId, Transform, WEARABLE_SLOTS, getAppearance, type CommandDef, type CosmeticCatalogLike, type Entity, type World } from "@engine/core";
import { BuildPiece, CraftingStation, Dead, Container, ClanInvitePending, ClanStatus, CraftQueue, PartyInvitePending, PartyRank, StallHeader, Wardrobe } from "../components.js";
import { gameplayDefs } from "../config.js";
import type { ItemCount } from "../defs.js";
import { countItem, listSlots, readSlots } from "../inventory.js";
import { itemInfo, type NameLookup } from "../economy/provenance.js";
import { BuyFromStallCmd, CollectTillCmd, SetListingCmd, SetStallNameCmd, SetStallOpenCmd, StockStallCmd, UnstockStallCmd, listingRevision, stallListings, stallName, tillOf } from "../economy/stall.js";
import { CancelQueuedCraftCmd, MAX_CRAFT_COUNT, QueueCraftCmd, craftQueueReason, owedOf } from "../systems/craft_queue.js";
import { pieceCost } from "../building/place.js";
import { DepositCmd, EquipCmd, PaintCmd, PlaceCmd, ToggleFireCmd, UseCmd, WearCmd, WithdrawCmd } from "../input.js";
import { Equipment, Worn } from "../components.js";
import { ItemCategory, WEAR_SLOTS } from "../defs.js";
import { entityIndex } from "@engine/core";
import { installSpatialIndex } from "@engine/world";
import { isAuthority } from "../config.js";
import { NO_SLOT } from "../components.js";
import { Fuel } from "../components.js";
import { fuelSecondsLeft } from "../systems/fuel.js";
import { KEY_ITEM, keyTooltip } from "../vehicle_keys.js";
const itemDefKey = (w: World, item: number): string => gameplayDefs(w).items.get(item)?.key ?? "";
import { COSMETICS, EquipCosmeticCmd, SetAppearanceCmd, canEditAppearance, hasCreatedLook, nearWardrobe, unlocksOf } from "../customization.js";
import { PartyAcceptCmd, PartyDeclineCmd, PartyInviteCmd, PartyKickCmd, PartyLeaveCmd, PARTY_RULES } from "../party.js";
import { ClanAcceptCmd, ClanDeclineCmd, ClanCreateCmd, ClanDemoteCmd, ClanDisbandCmd, ClanInviteCmd, ClanKickCmd, ClanLeaveCmd, ClanPromoteCmd, ClanSetGoalCmd, ClanSetRankPermsCmd } from "../clan.js";
import { CLAN_GOAL_COUNT, CLAN_PERMS, clanPermBit, clanState, defaultRankMasks, type ClanPerm } from "../clan_state.js";

export const TICKS_PER_SECOND = 20;
/** One command intent for the client to send (`client.sendCommand(gameplayNet(cmd), args)` after NetId mapping). */
export interface MenuIntent { cmd: CommandDef; args: Record<string, number | number[]>; /** arg names holding Entities (sender maps to NetIds) */ entities?: readonly string[] }
export interface MenuCtx { world: World; player: Entity; names?: NameLookup; catalog?: CosmeticCatalogLike }
const intent = (cmd: CommandDef, args: MenuIntent["args"], entities?: readonly string[]): MenuIntent => (entities ? { cmd, args, entities } : { cmd, args });
const itemName = (w: World, item: number): string => gameplayDefs(w).items.get(item)?.name ?? (item ? `#${item}` : "");
const pidOf = (w: World, e: Entity): number => w.getField(e, PlayerId, "id") ?? 0;
const nameOf = (c: MenuCtx, playerId: number): string => (playerId ? c.names?.get(playerId) ?? `Player ${playerId}` : "");
const withNames = (w: World, l: readonly ItemCount[], who?: Entity) => l.map((i) => ({ item: i.item, name: itemName(w, i.item), count: i.count, have: who !== undefined ? countItem(w, who, i.item) : 0 }));

// ---- inventory --------------------------------------------------------------------------------------
export interface InventorySlotView { slot: number; item: number; /** manifest icon key (ItemDef.spriteKey: `sprite` override, else item key) */ icon: string; name: string; count: number; durability: number; crafterId: number; crafterName: string; tooltip: string; /** ADR-128: context action for consumables ("eat" | "drink"), else undefined */ consume?: "eat" | "drink";
  /** ADR-135: how the slot equips ("hand" = main hand via EquipCmd, "wear" = gear slot via WearCmd) and whether it is equipped now */ equip?: "hand" | "wear"; equipped?: boolean }
/** ADR-128: "eat" / "drink" for consumables (liquid containers and thirst-only food drink), undefined otherwise. */
export function consumeKind(w: World, item: number): "eat" | "drink" | undefined {
  const d = gameplayDefs(w).items.get(item); if (!d?.food) return undefined;
  return d.sips > 0 || (d.food.thirst > 0 && d.food.hunger <= 0) ? "drink" : "eat";
}
/** ADR-128: tooltip line(s) with food/water values ("Food +24 · Water +2 · Health +3"; containers add "Water 3/6 sips"). */
export function foodTooltip(w: World, item: number, durability = 0): string {
  const d = gameplayDefs(w).items.get(item); const f = d?.food; if (!f) return "";
  const per = d.sips > 0 ? 1 / d.sips : 1; const r = (v: number): string => `${v > 0 ? "+" : ""}${Math.round(v * per * 10) / 10}`;
  const parts = [f.hunger ? `Food ${r(f.hunger)}` : "", f.thirst ? `Water ${r(f.thirst)}` : "", f.health ? `Health ${r(f.health)}` : ""].filter(Boolean);
  const line = parts.join(" · ") + (d.sips > 0 ? " per sip" : "");
  return d.sips > 0 ? `${line}\n${durability > 0 ? `Water ${durability}/${d.sips} sips` : "Empty: use next to water to refill"}` : line;
}
/** ADR-128: eat/drink the item in `slot` (server validates cooldown, rot, refill-at-water). */
export function useIntent(slot: number): MenuIntent { return intent(UseCmd, { slot }); }
/** ADR-135: main-hand equip (same command the hotbar keys send) and wear/unwear toggle for gear slots. */
export const equipIntent = (slot: number): MenuIntent => intent(EquipCmd, { slot });
export const wearIntent = (slot: number): MenuIntent => intent(WearCmd, { slot });
export const EQUIP_SLOT_LABELS = ["Head", "Body", "Legs", "Feet", "Hands", "Back", "Off hand", "Accessory"] as const;
export interface EquipSlotView { slot: number; label: string; invSlot: number; item: number; name: string; icon: string }
/** ADR-135: paper-doll slots: Main hand (index -1) then the 8 Worn slots; invSlot -1 = empty. */
export function equipmentView(c: MenuCtx): EquipSlotView[] {
  const w = c.world; const d = gameplayDefs(w); const out: EquipSlotView[] = [];
  const mk = (slot: number, label: string, inv: number, item: number): EquipSlotView => ({ slot, label, invSlot: item ? inv : -1, item, name: item ? itemName(w, item) : "", icon: item ? d.items.get(item)?.spriteKey ?? "" : "" });
  const eq = w.isRegistered(Equipment) ? w.get(c.player, Equipment) : undefined;
  out.push(mk(-1, "Main hand", eq?.mainHandSlot ?? -1, eq && eq.mainHandSlot !== NO_SLOT ? eq.mainHandItem : 0));
  const st = w.isRegistered(Worn) && w.has(c.player, Worn) ? w.store(Worn) : undefined; const s = st ? st.slot(entityIndex(c.player)) : -1;
  for (let i = 0; i < WEAR_SLOTS; i++) { const sl = st && s >= 0 ? st.data.slot[s * WEAR_SLOTS + i]! : 0; out.push(mk(i, EQUIP_SLOT_LABELS[i]!, sl - 1, sl ? st!.data.item[s * WEAR_SLOTS + i]! : 0)); }
  return out;
}
/** ADR-128: drink straight from an adjacent water tile (UseCmd with NO_SLOT). */
export function drinkWaterIntent(): MenuIntent { return intent(UseCmd, { slot: NO_SLOT }); }
function equippedSlots(c: MenuCtx): Set<number> { const o = new Set<number>(); for (const v of equipmentView(c)) if (v.invSlot >= 0) o.add(v.invSlot); return o; }
export function inventoryView(c: MenuCtx): InventorySlotView[] {
  const w = c.world; const out: InventorySlotView[] = []; let equipped: Set<number> | undefined;
  for (const s of listSlots(w, c.player)) {
    if (!s.item || !s.count) continue;
    const info = itemInfo(w, c.player, s.slot, c.names ?? { get: () => undefined });
    const crafterName = info?.crafterName || nameOf(c, s.crafterId);
    const name = itemName(w, s.item); const ck = consumeKind(w, s.item);
    const tip = [`${name} ×${s.count}`, s.durability && !gameplayDefs(w).items.get(s.item)?.sips && gameplayDefs(w).items.get(s.item)?.maxDurability ? `Durability ${s.durability}/${gameplayDefs(w).items.get(s.item)!.maxDurability}` : "", foodTooltip(w, s.item, s.durability), itemDefKey(w, s.item) === KEY_ITEM ? keyTooltip(w, s.crafterId) : crafterName ? `Crafted by ${crafterName}` : ""].filter(Boolean).join("\n");
    const def = gameplayDefs(w).items.get(s.item); const handy = def?.weapon || def?.tool || def?.ranged || def?.thrown;
    const eqv = equipped ??= equippedSlots(c); const equip = def?.wear && (def.category === ItemCategory.Clothing || def.category === ItemCategory.Armor) ? "wear" as const : handy ? "hand" as const : def?.wear ? "wear" as const : undefined;
    out.push({ slot: s.slot, item: s.item, icon: def?.spriteKey ?? "", name, count: s.count, durability: s.durability, crafterId: s.crafterId, crafterName, tooltip: tip, ...(ck ? { consume: ck } : {}), ...(equip ? { equip, equipped: eqv.has(s.slot) } : {}) });
  }
  return out;
}

// ---- crafting ---------------------------------------------------------------------------------------
export interface RecipeView { id: number; key: string; name: string; seconds: number; station: number; output: { item: number; name: string; count: number }; ingredients: { item: number; name: string; count: number; have: number }[]; reason: string | undefined }
export interface QueueJobView { slot: number; recipe: number; name: string; count: number; state: number; progress: number; secondsLeft: number }
export interface OwedView { item: number; name: string; count: number; crafterName: string }
/** ADR-136: `station` = which list this is (0 = on your person / hand only); `elsewhere` = recipes hidden here, per station kind (hint text). */
export interface CraftingView { station: number; stationName: string; recipes: RecipeView[]; queue: QueueJobView[]; owed: OwedView[]; maxCount: number; elsewhere: { station: number; name: string; count: number }[] }
/** Display names per StationKind (0 hand … 5 garage). */
export const STATION_NAMES: Readonly<Record<number, string>> = { 0: "By hand", 1: "Campfire / stove", 2: "Workbench", 3: "Furnace", 4: "Anvil / forge", 5: "Garage" };
// ---- container panel (ADR-098: up to 96 slots, paged) ------------------------------------------------
/** Slots per page in the container panel (one page = the old 24-slot box). */
export const CONTAINER_PAGE_SIZE = 24;
export interface ContainerSlotView { slot: number; item: number; icon: string; name: string; count: number; tooltip: string }
export interface ContainerView { entity: Entity; slotCount: number; page: number; pages: number; first: number; slots: ContainerSlotView[]; weight: number; maxWeight: number }
/** The container the player has open on this replica: Container replicates only to viewers (containerViewersScope),
 *  so on a client the nearest non-player Container within reach is the open one. */
export function openContainer(c: MenuCtx): Entity | undefined {
  const w = c.world; const p = w.get(c.player, Transform); if (!p) return undefined;
  const reach = gameplayDefs(w).building.containerReach + 1; let best: Entity | undefined; let bd = reach * reach;
  for (const e of w.query([Container, Transform])) {
    if (e === c.player) continue; const t = w.get(e, Transform)!; const d = (t.x - p.x) ** 2 + (t.y - p.y) ** 2;
    if (d <= bd) { bd = d; best = e; }
  }
  return best;
}
/** One page of a container (every slot in the page, empties included, so focus positions stay stable). `page` is clamped. */
export function containerView(c: MenuCtx, e: Entity, page = 0, pageSize = CONTAINER_PAGE_SIZE): ContainerView | undefined {
  const w = c.world; const box = w.get(e, Container); if (!box) return undefined;
  const v = readSlots(w, e); const n = v.slotCount; const pages = Math.max(1, Math.ceil(n / pageSize));
  const pg = Math.max(0, Math.min(pages - 1, page | 0)); const first = pg * pageSize; const slots: ContainerSlotView[] = [];
  for (let i = first; i < Math.min(n, first + pageSize); i++) {
    const item = v.item(i), count = v.count(i); const name = item ? itemName(w, item) : "";
    slots.push({ slot: i, item, count, name, icon: item ? gameplayDefs(w).items.get(item)?.spriteKey ?? "" : "", tooltip: item ? `${name} ×${count} · slot ${i + 1}/${n}` : `Empty · slot ${i + 1}/${n}` });
  }
  return { entity: e, slotCount: n, page: pg, pages, first, slots, weight: box.weight, maxWeight: box.maxWeight };
}
export const withdrawIntent = (target: Entity, item: number, count: number): MenuIntent => intent(WithdrawCmd, { target, item, count }, ["target"]);
/** ADR-108 station fuel panel: lit state, burn time left, and the fuel items the player can drop in. */
export interface FuelView { lit: boolean; secondsLeft: number; fuels: { item: number; key: string; name: string; count: number; seconds: number }[] }
export function fuelView(c: MenuCtx, fire: Entity): FuelView | undefined {
  const w = c.world; if (!w.has(fire, Fuel)) return undefined; const defs = gameplayDefs(w);
  const fuels: FuelView["fuels"] = [];
  for (const x of listSlots(w, c.player)) { const it = defs.items.get(x.item); if (!it || !it.fuelSeconds) continue; const f = fuels.find((y) => y.item === x.item); if (f) f.count += x.count; else fuels.push({ item: x.item, key: it.key, name: it.name, count: x.count, seconds: it.fuelSeconds }); }
  return { lit: (w.getField(fire, Fuel, "lit") ?? 0) > 0, secondsLeft: fuelSecondsLeft(w, fire), fuels };
}
export const toggleFireIntent = (target: Entity): MenuIntent => intent(ToggleFireCmd, { target }, ["target"]);
export const depositIntent = (target: Entity, item: number, count: number): MenuIntent => intent(DepositCmd, { target, item, count }, ["target"]);

/** ADR-136: the personal menu (station 0) lists ONLY hand recipes; a station's panel lists ONLY that station's recipes. */
export function craftingView(c: MenuCtx, station = 0): CraftingView { // station -1 = every recipe (camper station filters itself)
  const w = c.world; const defs = gameplayDefs(w); const all = [...defs.recipes.values()];
  // ADR-141: a client replica never runs the postSim spatial-index system, so station range checks saw no stations
  // and every station recipe read "no_station" (greyed, "light it / move closer") while standing at the workbench.
  if (!isAuthority(w)) installSpatialIndex(w).rebuild();
  const counts = new Map<number, number>(); for (const r of all) if (station >= 0 && r.station !== station) counts.set(r.station, (counts.get(r.station) ?? 0) + 1);
  const elsewhere = [...counts].sort((a, b) => a[0] - b[0]).map(([k, n]) => ({ station: k, name: STATION_NAMES[k] ?? `Station ${k}`, count: n }));
  const recipes = all.filter((r) => station < 0 || r.station === station).map((r): RecipeView => ({ id: r.id, key: r.key, name: itemName(w, r.output.item), seconds: r.seconds, station: r.station,
    output: { item: r.output.item, name: itemName(w, r.output.item), count: r.output.count }, ingredients: withNames(w, r.ingredients, c.player), reason: craftQueueReason(w, c.player, r.id, 1) }));
  const queue: QueueJobView[] = []; const q = w.get(c.player, CraftQueue);
  if (q) for (let i = 0; i < q.state.length; i++) {
    const st = q.state[i]!; if (!st) continue; const r = defs.recipes.get(q.recipeId[i]!);
    const s0 = q.startTick[i]!, s1 = q.endTick[i]!; const running = st === 2 && s1 > s0;
    const progress = running ? Math.min(1, Math.max(0, (w.tick - s0) / (s1 - s0))) : 0;
    queue.push({ slot: i, recipe: q.recipeId[i]!, name: r ? itemName(w, r.output.item) : `#${q.recipeId[i]}`, count: q.count[i]!, state: st, progress, secondsLeft: running ? Math.max(0, (s1 - w.tick) / TICKS_PER_SECOND) : (r?.seconds ?? 0) });
  }
  const owed = owedOf(w, c.player).map((o) => ({ item: o.item, name: itemName(w, o.item), count: o.count, crafterName: nameOf(c, o.crafterId) }));
  return { station, stationName: STATION_NAMES[station] ?? `Station ${station}`, recipes, queue, owed, maxCount: MAX_CRAFT_COUNT, elsewhere };
}
export const JOB_STATE_LABEL = ["", "Queued", "Crafting", "Paused", "Done"] as const;
export const queueCraftIntent = (recipe: number, count = 1): MenuIntent => intent(QueueCraftCmd, { recipe, count: Math.max(1, Math.min(MAX_CRAFT_COUNT, count | 0)) });
export const cancelQueuedCraftIntent = (slot: number): MenuIntent => intent(CancelQueuedCraftCmd, { slot });

// ---- build ------------------------------------------------------------------------------------------
export interface BuildPieceView { id: number; key: string; tiers: { tier: number; key: string; cost: { item: number; name: string; count: number; have: number }[]; affordable: boolean }[]; variants: string[]; paintable: boolean; category: string }
export interface BuildSelection { piece: number; tier: number; variant: number; paint: number }
export function buildView(c: MenuCtx): BuildPieceView[] {
  const w = c.world; const defs = gameplayDefs(w);
  return [...defs.pieces.values()].map((p) => {
    const tierIds = p.tiered ? defs.tiers.map((t) => t.id) : [p.fixedTier];
    const tiers = tierIds.map((t) => { const cost = withNames(w, pieceCost(defs, p, t), c.player); return { tier: t, key: defs.tiers.find((d) => d.id === t)?.key ?? String(t), cost, affordable: cost.every((x) => x.have >= x.count) }; });
    const variants = Array.from({ length: Math.max(1, p.variants) }, (_, i) => p.variantNames[i] || `Variant ${i + 1}`);
    return { id: p.id, key: (p as { key?: string }).key ?? String(p.id), tiers, variants, paintable: p.paintable, category: p.category };
  });
}
/** Placement intent at a world point (the placement ghost / aim supplies x, y, level, rot). */
export const placeIntent = (s: BuildSelection, at: { x: number; y: number; level?: number; rot?: number }): MenuIntent =>
  intent(PlaceCmd, { piece: s.piece, x: at.x, y: at.y, level: at.level ?? 0, rot: at.rot ?? 0, tier: s.tier, variant: s.variant });
/** Tint an existing piece (PaintCmd; needs the net bridge, see DESIGN.md asks). */
export const paintIntent = (target: Entity, paint: number): MenuIntent => intent(PaintCmd, { target, paint }, ["target"]);

// ---- character / wardrobe ---------------------------------------------------------------------------
export interface WardrobeSlotView { slot: number; key: string; equipped: number; primary: number; secondary: number }
export interface WardrobeView { canEdit: boolean; created: boolean; /** current body / skin (0 if none): whole-look writes (skin) must keep them */ bodyType: number; skinTone: number; slots: WardrobeSlotView[]; unlocks: { tag: string; unlocked: boolean }[]; palettes: { skin: number; hair: number; clothing: number } }
export function wardrobeView(c: MenuCtx): WardrobeView {
  const w = c.world; const created = w.has(c.player, Wardrobe) ? hasCreatedLook(w, c.player) : false;
  const a = w.isRegistered(Appearance) ? getAppearance(w, c.player) : undefined;
  const have = unlocksOf(w, c.player);
  return { canEdit: canEditAppearance(w, c.player, !created), created, bodyType: a?.bodyType ?? 0, skinTone: a?.skinTone ?? 0,
    slots: WEARABLE_SLOTS.map((k, i) => ({ slot: i, key: k, equipped: a?.parts[i] ?? 0, primary: a?.primary[i] ?? 0, secondary: a?.secondary[i] ?? 0 })),
    unlocks: COSMETICS.unlockTags.map((t) => ({ tag: t, unlocked: have.has(t) })),
    palettes: { skin: c.catalog?.skinTones.length ?? 0, hair: c.catalog?.hairColors.length ?? 0, clothing: c.catalog?.clothingColors.length ?? 0 } };
}
export const equipCosmeticIntent = (slot: number, wearable: number, primary = 0, secondary = 0): MenuIntent => intent(EquipCosmeticCmd, { slot, wearable, primary, secondary });
export const setAppearanceIntent = (v: { bodyType: number; skinTone: number; parts: number[]; primary: number[]; secondary: number[] }): MenuIntent =>
  intent(SetAppearanceCmd, { bodyType: v.bodyType, skinTone: v.skinTone, parts: [...v.parts], primary: [...v.primary], secondary: [...v.secondary] });

// ---- social helpers -------------------------------------------------------------------------------------
export interface PlayerRef { entity: Entity; playerId: number; name: string; distance: number }
/** Replicated players near me (invite / kick targets), nearest first. */
export function nearbyPlayers(c: MenuCtx, radius = 32): PlayerRef[] {
  const w = c.world; const me = w.get(c.player, Transform); const out: PlayerRef[] = [];
  for (const e of w.query([PlayerId, Transform])) {
    if (e === c.player) continue; const t = w.get(e, Transform)!; const d = me ? Math.hypot(t.x - me.x, t.y - me.y) : 0;
    if (d <= radius) out.push({ entity: e, playerId: pidOf(w, e), name: nameOf(c, pidOf(w, e)), distance: d });
  }
  return out.sort((a, b) => a.distance - b.distance);
}
const groupMembers = (c: MenuCtx, field: "partyId" | "clanId", id: number): PlayerRef[] => {
  if (!id) return []; const w = c.world; const me = w.get(c.player, Transform); const out: PlayerRef[] = [];
  for (const e of w.query([PlayerId, Membership])) if (w.getField(e, Membership, field) === id) { const t = w.get(e, Transform); out.push({ entity: e, playerId: pidOf(w, e), name: nameOf(c, pidOf(w, e)), distance: me && t ? Math.hypot(t.x - me.x, t.y - me.y) : 0 }); }
  return out;
};
const pending = (w: World, e: Entity, def: typeof PartyInvitePending | typeof ClanInvitePending) => {
  const p = w.get(e, def as typeof PartyInvitePending) as unknown as { from: number; expiresTick: number; party?: number; clan?: number } | undefined;
  return p && p.expiresTick > w.tick && (p.party ?? p.clan) ? p : undefined;
};

// ---- party ------------------------------------------------------------------------------------------
export interface PartyView { party: number; members: PlayerRef[]; maxSize: number; invite: { party: number; from: number; fromName: string; secondsLeft: number } | undefined; candidates: PlayerRef[]; /** my PartyRank role (0 = none) */ myRole: number; canInvite: boolean; /** kick allowed by rank (PARTY_RULES; the server still validates) */ canKick: (m: PlayerRef) => boolean }
export function partyView(c: MenuCtx): PartyView {
  const w = c.world; const party = w.getField(c.player, Membership, "partyId") ?? 0; const members = groupMembers(c, "partyId", party);
  const p = pending(w, c.player, PartyInvitePending);
  const rank = (e: Entity): number => w.getField(e, PartyRank, "role") ?? 0; const myRole = party ? rank(c.player) : 0;
  return { party, members, maxSize: PARTY_RULES.maxSize, myRole, canInvite: !party || myRole >= PARTY_RULES.minInviteRole,
    canKick: (m) => m.entity !== c.player && myRole >= PARTY_RULES.minKickRole && myRole > rank(m.entity),
    invite: p ? { party: p.party!, from: p.from, fromName: nameOf(c, p.from), secondsLeft: Math.ceil((p.expiresTick - w.tick) / TICKS_PER_SECOND) } : undefined,
    candidates: nearbyPlayers(c).filter((x) => !members.some((m) => m.entity === x.entity)) };
}
export const partyInviteIntent = (target: Entity): MenuIntent => intent(PartyInviteCmd, { target }, ["target"]);
export const partyAcceptIntent = (party: number): MenuIntent => intent(PartyAcceptCmd, { party });
export const partyDeclineIntent = (party: number): MenuIntent => intent(PartyDeclineCmd, { party });
export const partyLeaveIntent = (): MenuIntent => intent(PartyLeaveCmd, {});
export const partyKickIntent = (target: Entity): MenuIntent => intent(PartyKickCmd, { target }, ["target"]);

// ---- clan -------------------------------------------------------------------------------------------
export const CLAN_GOAL_NAMES = ["None", "Build base", "Stock stalls", "Defend", "Raid"] as const;
export const CLAN_ROLE_NAMES: Readonly<Record<number, string>> = { [GroupRole.Member]: "Member", [GroupRole.Officer]: "Officer", [GroupRole.Leader]: "Leader" };
export interface ClanView {
  clan: number; role: number; roleName: string; goal: number; goalName: string; goalX: number; goalY: number; contrib: number; members: (PlayerRef & { role: number })[];
  invite: { clan: number; from: number; fromName: string; secondsLeft: number } | undefined; candidates: PlayerRef[];
  /** Rank perm masks [member, officer] (authoritative when the world holds ClanState, else the defaults). */
  perms: { role: number; roleName: string; mask: number; perms: { perm: ClanPerm; on: boolean }[] }[]; goals: readonly string[];
}
export function clanView(c: MenuCtx): ClanView {
  const w = c.world; const st = w.get(c.player, ClanStatus); const clan = st?.clan || (w.getField(c.player, Membership, "clanId") ?? 0);
  const members = groupMembers(c, "clanId", clan).map((m) => ({ ...m, role: w.get(m.entity, ClanStatus)?.role ?? GroupRole.Member }));
  const known = clan ? clanState(w).clans.get(clan) : undefined; const [dm, dof] = defaultRankMasks();
  const masks: [number, number] = known ? [known.member, known.officer] : [dm, dof];
  const p = pending(w, c.player, ClanInvitePending); const goal = st?.goal ?? 0;
  return { clan, role: st?.role ?? 0, roleName: CLAN_ROLE_NAMES[st?.role ?? 0] ?? "", goal, goalName: CLAN_GOAL_NAMES[goal] ?? "", goalX: st?.goalX ?? 0, goalY: st?.goalY ?? 0, contrib: st?.contrib ?? 0, members,
    invite: p ? { clan: p.clan!, from: p.from, fromName: nameOf(c, p.from), secondsLeft: Math.ceil((p.expiresTick - w.tick) / TICKS_PER_SECOND) } : undefined,
    candidates: nearbyPlayers(c).filter((x) => !members.some((m) => m.entity === x.entity)),
    perms: [GroupRole.Member, GroupRole.Officer].map((role, i) => ({ role, roleName: CLAN_ROLE_NAMES[role]!, mask: masks[i]!, perms: CLAN_PERMS.map((perm) => ({ perm, on: (masks[i]! & clanPermBit(perm)) !== 0 })) })),
    goals: CLAN_GOAL_NAMES.slice(0, CLAN_GOAL_COUNT) };
}
export const togglePermMask = (mask: number, perm: ClanPerm): number => (mask ^ clanPermBit(perm)) >>> 0;
export const clanCreateIntent = (): MenuIntent => intent(ClanCreateCmd, {});
export const clanInviteIntent = (target: Entity): MenuIntent => intent(ClanInviteCmd, { target }, ["target"]);
export const clanAcceptIntent = (clan: number): MenuIntent => intent(ClanAcceptCmd, { clan });
export const clanLeaveIntent = (): MenuIntent => intent(ClanLeaveCmd, {});
export const clanPromoteIntent = (target: Entity): MenuIntent => intent(ClanPromoteCmd, { target }, ["target"]);
export const clanDemoteIntent = (target: Entity): MenuIntent => intent(ClanDemoteCmd, { target }, ["target"]);
export const clanKickIntent = (target: Entity): MenuIntent => intent(ClanKickCmd, { target }, ["target"]);
export const clanSetRankPermsIntent = (role: number, mask: number): MenuIntent => intent(ClanSetRankPermsCmd, { role, mask });
export const clanSetGoalIntent = (goal: number, x = 0, y = 0): MenuIntent => intent(ClanSetGoalCmd, { goal, x, y });
export const clanDisbandIntent = (): MenuIntent => intent(ClanDisbandCmd, {});

// ---- trade stall ------------------------------------------------------------------------------------
export interface StallListingView { slot: number; enabled: boolean; stockItem: number; stockName: string; stock: number; qty: number; priceItem: number; priceName: string; priceCount: number; canAfford: boolean }
export interface StallView { stall: Entity; name: string; open: boolean; mine: boolean; revision: number; listings: StallListingView[]; till: { item: number; name: string; count: number }[] }
/** Nearest replicated stall within `radius` tiles (the one the panel shows). */
export function nearestStall(c: MenuCtx, radius = 6): Entity | undefined {
  const w = c.world; const me = w.get(c.player, Transform); if (!me) return undefined; let best: Entity | undefined; let bd = radius;
  for (const e of w.query([StallHeader, Transform])) { const t = w.get(e, Transform)!; const d = Math.hypot(t.x - me.x, t.y - me.y); if (d <= bd) { bd = d; best = e; } }
  return best;
}
export function stallView(c: MenuCtx, stall: Entity): StallView | undefined {
  const w = c.world; const h = w.get(stall, StallHeader); if (!h) return undefined;
  const me = pidOf(w, c.player); const clan = w.getField(c.player, Membership, "clanId") ?? 0;
  const mine = (h.ownerKind === 1 && h.ownerId === me && me !== 0) || (h.ownerKind === 2 && h.ownerId === clan && clan !== 0);
  const listings = stallListings(w, stall).map((l) => ({ slot: l.slot, enabled: l.enabled, stockItem: l.stockItem, stockName: itemName(w, l.stockItem), stock: l.stock, qty: l.qty,
    priceItem: l.priceItem, priceName: itemName(w, l.priceItem), priceCount: l.priceCount, canAfford: l.priceItem ? countItem(w, c.player, l.priceItem) >= l.priceCount : false }));
  const t = tillOf(w, stall); const till = t !== undefined ? listSlots(w, t).filter((s) => s.item && s.count).map((s) => ({ item: s.item, name: itemName(w, s.item), count: s.count })) : [];
  return { stall, name: stallName(w, stall), open: h.open === 1, mine, revision: listingRevision(w, stall), listings, till };
}
export const buyFromStallIntent = (v: StallView, l: StallListingView, qty = 1): MenuIntent =>
  intent(BuyFromStallCmd, { stall: v.stall, listingSlot: l.slot, qty, expectedRevision: v.revision, expectedPriceItem: l.priceItem, expectedPriceCount: l.priceCount }, ["stall"]);
export const collectTillIntent = (stall: Entity): MenuIntent => intent(CollectTillCmd, { stall }, ["stall"]);
export const setListingIntent = (stall: Entity, slot: number, priceItem: number, priceCount: number, qty: number, enabled: boolean): MenuIntent =>
  intent(SetListingCmd, { stall, listingSlot: slot, priceItem, priceCount, qty, enabled: enabled ? 1 : 0 }, ["stall"]);
export const stockStallIntent = (stall: Entity, listingSlot: number, invSlot: number, count: number): MenuIntent => intent(StockStallCmd, { stall, listingSlot, invSlot, count }, ["stall"]);
export const unstockStallIntent = (stall: Entity, listingSlot: number, count: number): MenuIntent => intent(UnstockStallCmd, { stall, listingSlot, count }, ["stall"]);
export const setStallOpenIntent = (stall: Entity, open: boolean): MenuIntent => intent(SetStallOpenCmd, { stall, open: open ? 1 : 0 }, ["stall"]);
export function setStallNameIntent(stall: Entity, raw: string): MenuIntent {
  const bytes = Array.from(raw.replace(/[^\x20-\x7e]/g, "").slice(0, 24), (ch) => ch.charCodeAt(0));
  return intent(SetStallNameCmd, { stall, len: bytes.length, name: [...bytes, ...new Array<number>(24 - bytes.length).fill(0)] }, ["stall"]);
}

// ---- stall owner: stock + price ---------------------------------------------------------------------
/** Owner's "list an item" form state. */
export interface StallListDraft { listing: number; invSlot: number; count: number; priceItem: number; priceCount: number; qty: number }
/** Price currencies offered in the owner UI: coin first, then every distinct item in the owner's pack. */
export function priceItemChoices(c: MenuCtx): { item: number; name: string }[] {
  const d = gameplayDefs(c.world); let coin = 0; try { coin = d.itemId("coin"); } catch { /* no coin item */ }
  const out = coin ? [{ item: coin, name: itemName(c.world, coin) }] : [];
  for (const s of inventoryView(c)) if (!out.some((o) => o.item === s.item)) out.push({ item: s.item, name: s.name });
  return out;
}
/** Stock `count` from `invSlot` into the listing, then set its price/qty and enable it (two commands, in order). */
export function listItemIntents(stall: Entity, d: StallListDraft): MenuIntent[] {
  const out: MenuIntent[] = [];
  if (d.invSlot >= 0 && d.count > 0) out.push(stockStallIntent(stall, d.listing, d.invSlot, d.count));
  out.push(setListingIntent(stall, d.listing, d.priceItem, Math.max(1, d.priceCount), Math.max(1, d.qty), true));
  return out;
}

// ---- interact → panel -------------------------------------------------------------------------------
export const STALL_INTERACT_RANGE = 2.5;
/** What the Interact action should open: a nearby stall's trade panel, else the wardrobe (character panel). */
export function interactPanel(c: MenuCtx): { panel: "trade"; stall: Entity } | { panel: "character" } | { panel: "station"; station: Entity; kind: number } | undefined {
  const s = nearestStall(c, STALL_INTERACT_RANGE); if (s !== undefined) return { panel: "trade", stall: s };
  if (nearWardrobe(c.world, c.player)) return { panel: "character" };
  const st = nearestStation(c); if (st) return { panel: "station", ...st };
  return undefined;
}
/** ADR-136: nearest crafting station (placed piece or spawned) within its own range of the player; opens its crafting panel on Interact. */
export function nearestStation(c: MenuCtx): { station: Entity; kind: number } | undefined {
  const w = c.world; const me = w.get(c.player, Transform); if (!me) return undefined;
  let best: { station: Entity; kind: number } | undefined; let bd = Infinity;
  for (const e of w.query([CraftingStation, Transform])) {
    const cs = w.get(e, CraftingStation)!; if (!cs.kind || w.has(e, Dead)) continue; const t = w.get(e, Transform)!;
    const d = Math.hypot(t.x - me.x, t.y - me.y); if (d <= cs.range && d < bd) { bd = d; best = { station: e, kind: cs.kind }; }
  }
  return best;
}

// ---- social directory (owner-scoped net events: gameplay.clanRoster / clanRosterMember / onlinePlayer) ----------
export const clanDeclineIntent = (clan: number): MenuIntent => intent(ClanDeclineCmd, { clan });
export const ROLE_NAMES = ["", "Member", "Officer", "Leader"] as const;
/** Client-side store fed by client.onEvent(ClanRoster | ClanRosterMember | OnlinePlayer). Ids are account PlayerIds. */
export class SocialDirectory {
  clan = 0; memberMask = 0; officerMask = 0; size = 0;
  readonly roster = new Map<number, { role: number; online: boolean }>();
  readonly online = new Set<number>();
  /** Bumped on every change (cheap "did it change" for panels). */
  version = 0;
  reset(): void { this.clan = this.memberMask = this.officerMask = this.size = 0; this.roster.clear(); this.online.clear(); this.version++; }
  onRoster(e: { clan: number; memberMask: number; officerMask: number; size: number }): void {
    if (e.clan !== this.clan || !e.clan) this.roster.clear();
    this.clan = e.clan; this.memberMask = e.memberMask; this.officerMask = e.officerMask; this.size = e.size; this.version++;
  }
  /** role 1 Member, 2 Officer, 3 Leader; 0 = removed. */
  onMember(e: { clan: number; player: number; role: number; online: number }): void {
    if (!e.clan || e.clan !== this.clan) return;
    if (!e.role) this.roster.delete(e.player); else this.roster.set(e.player, { role: e.role, online: e.online === 1 }); this.version++;
  }
  onOnline(e: { player: number; online: number }): void { if (e.online) this.online.add(e.player); else this.online.delete(e.player); this.version++; }
}
const entityOfPlayer = (w: World, playerId: number): Entity | undefined => { for (const e of w.query([PlayerId])) if (pidOf(w, e) === playerId) return e; return undefined; };
export interface RosterRow { playerId: number; name: string; role: number; roleName: string; online: boolean; entity: Entity | undefined }
/** Clan members from the replicated roster (works beyond AOI; entity only when that player is replicated). */
export function clanRosterRows(c: MenuCtx, dir: SocialDirectory | undefined, clan: number): RosterRow[] | undefined {
  if (!dir || !clan || dir.clan !== clan || !dir.roster.size) return undefined;
  return [...dir.roster].map(([pid, r]) => ({ playerId: pid, name: nameOf(c, pid), role: r.role, roleName: ROLE_NAMES[r.role] ?? "Member", online: r.online, entity: entityOfPlayer(c.world, pid) }))
    .sort((a, b) => b.role - a.role || Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
}
export interface InviteTarget { playerId: number; name: string; entity: Entity | undefined; distance: number | undefined }
/** Invite / whisper candidates: online directory (plus nearby replicated players), minus me and `exclude`; replicated ones first by distance. */
export function onlineTargets(c: MenuCtx, dir: SocialDirectory | undefined, exclude: ReadonlySet<number> = new Set()): InviteTarget[] {
  const me = pidOf(c.world, c.player); const out = new Map<number, InviteTarget>();
  for (const p of nearbyPlayers(c)) if (!exclude.has(p.playerId)) out.set(p.playerId, { playerId: p.playerId, name: p.name, entity: p.entity, distance: p.distance });
  for (const pid of dir?.online ?? []) if (pid !== me && !exclude.has(pid) && !out.has(pid)) out.set(pid, { playerId: pid, name: nameOf(c, pid), entity: entityOfPlayer(c.world, pid), distance: undefined });
  return [...out.values()].sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity) || a.name.localeCompare(b.name));
}
/** Nearest paintable build piece within build reach (Build panel "Paint" target). */
export function paintTarget(c: MenuCtx): Entity | undefined {
  const w = c.world; const d = gameplayDefs(w); const me = w.get(c.player, Transform); if (!me) return undefined;
  let best: Entity | undefined; let bd = d.building.buildReach;
  for (const e of w.query([BuildPiece, Transform])) {
    if (!d.pieces.get(w.get(e, BuildPiece)!.type)?.paintable) continue;
    const t = w.get(e, Transform)!; const dist = Math.hypot(t.x - me.x, t.y - me.y); if (dist <= bd) { bd = dist; best = e; }
  }
  return best;
}
