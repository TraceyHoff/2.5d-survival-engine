/** ADR-134 per-species stumps (nature_adr134_stumps). */
export const STUMP_SPECIES = ["oak", "pine", "birch", "maple", "willow", "palm", "apple", "pear", "cherry", "orange", "peach"] as const;
export type StumpSpecies = (typeof STUMP_SPECIES)[number];
/** Species from a resource node kind's sprite key: "oak_tree" / "tree_oak" / "oak" -> "oak"; unknown -> undefined. */
export function stumpSpecies(nodeKey: string | undefined): StumpSpecies | undefined {
  if (!nodeKey) return undefined;
  return STUMP_SPECIES.find((s) => nodeKey === s || nodeKey.startsWith(`${s}_`) || nodeKey.endsWith(`_${s}`));
}
/** Sprite keys to try, in order: the species stump then the generic tree_stump. */
export function stumpKeys(nodeKey: string | undefined): [string, string] {
  const s = stumpSpecies(nodeKey); return [s ? `${s}_tree_stump` : "tree_stump", "tree_stump"];
}
