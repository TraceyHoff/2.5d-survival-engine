/** Economy data (data/economy.json): no NPC vendors, currency, stall rules and clan rank policies. */
import raw from "../../data/economy.json";

export type StallAction = "list" | "price" | "collect" | "stock" | "remove";
export interface EconomyConfig {
  /** Asserts there are no vendor sources: every item comes from gathering or crafting (tested). */
  readonly noVendorSources: boolean;
  /** Conventional price item key (players may price in any item: barter). */
  readonly currency: string;
  /** Sales while the owner is offline credit the till. */
  readonly offlineSales: boolean;
  /** Destroyed stalls spill stock (and till) into a loot bag. */
  readonly stallStockLootable: boolean;
  readonly browseRange: number;
  readonly tillSlots: number;
  readonly ledgerSize: number;
  readonly buyRatePerSecond: number;
  /** Core clan role (1 member, 2 officer, 3 leader) -> allowed stall actions. Unlisted roles (recruits) may only buy. */
  readonly rankPolicy: Readonly<Record<number, readonly StallAction[]>>;
  /** Item keys that never record a crafter (fungible currency). */
  readonly anonymousItems: readonly string[];
  /** Max sign text length (capped by STALL_NAME_MAX). */
  readonly stallNameMax: number;
  /** Land-claim rules for stalls (core ClaimRegistry). */
  readonly claims: { readonly placeInForeignClaim: boolean; readonly tradeInForeignClaim: boolean };
}
const r = raw as unknown as Omit<EconomyConfig, "rankPolicy" | "anonymousItems"> & { rankPolicy: Record<string, StallAction[]>; anonymousItems?: string[] };
export const ECONOMY: EconomyConfig = Object.freeze({
  ...r, anonymousItems: r.anonymousItems ?? [],
  rankPolicy: Object.fromEntries(Object.entries(r.rankPolicy).map(([k, v]) => [Number(k), v])),
});
export const tillSlots = (): number => ECONOMY.tillSlots;
