/** Entity = uint32: low 20 bits index, high 12 bits generation. */
export type Entity = number;
export const INDEX_BITS = 20;
export const INDEX_MASK = (1 << INDEX_BITS) - 1;
export const MAX_ENTITIES = 1 << INDEX_BITS;
export const GEN_MASK = 0xfff;
export const makeEntity = (index: number, gen: number): Entity => ((gen & GEN_MASK) << INDEX_BITS | index) >>> 0;
export const entityIndex = (e: Entity): number => e & INDEX_MASK;
export const entityGen = (e: Entity): number => (e >>> INDEX_BITS) & GEN_MASK;
