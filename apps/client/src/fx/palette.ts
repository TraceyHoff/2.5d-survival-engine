/** ADR-214: VFX palette (matches the painted art: warm fire, desaturated blood, olive zombie ichor, earthy dust). */
export const PALETTE: ReadonlyArray<readonly [number, number, number]> = [
  [255, 255, 255], // 0 white
  [255, 214, 120], // 1 spark (hot yellow)
  [255, 138, 46], // 2 fire orange
  [150, 22, 20], // 3 blood
  [88, 98, 40], // 4 zombie ichor (olive / dark)
  [168, 148, 112], // 5 dust (dirt)
  [214, 192, 140], // 6 sand
  [136, 150, 96], // 7 grass dust / pollen
  [150, 146, 140], // 8 smoke
  [58, 54, 52], // 9 dark smoke / soot
  [176, 214, 236], // 10 water
  [150, 102, 58], // 11 wood chip
  [140, 138, 132], // 12 stone
  [255, 236, 170], // 13 ore glint
  [96, 140, 54], // 14 leaf green
  [196, 120, 44], // 15 leaf autumn
  [255, 120, 30], // 16 ember
  [214, 255, 120], // 17 firefly
  [255, 240, 200], // 18 dust mote (warm)
  [255, 250, 230], // 19 crit flash
  [130, 240, 140], // 20 heal green
  [150, 200, 255], // 21 cold blue
  [190, 220, 255], // 22 metal spark (cool white-blue)
  [120, 118, 116], // 23 exhaust
  [255, 200, 90], // 24 muzzle
  [120, 96, 72], // 25 fur / hide
  [220, 230, 210], // 26 sizzle steam
  [200, 150, 255], // 27 tree: perks (violet)
  [120, 220, 110], // 28 tree: survival (green)
  [240, 170, 90], // 29 tree: homestead (amber)
  [255, 120, 150], // 30 tree: medicine (rose)
  [255, 205, 90], // 31 tree: crafting (gold)
  [255, 90, 70], // 32 tree: combat (red)
  [110, 200, 255], // 33 tree: vehicles (cyan)
  [255, 225, 150], // 34 god ray (warm sun)
  [70, 140, 200], // 35 deep water ripple
];
export const C = { White: 0, Spark: 1, Fire: 2, Blood: 3, Ichor: 4, Dust: 5, Sand: 6, Grass: 7, Smoke: 8, Soot: 9, Water: 10, Wood: 11, Stone: 12, Ore: 13, Leaf: 14, Autumn: 15, Ember: 16,
  Firefly: 17, Mote: 18, Crit: 19, Heal: 20, Cold: 21, Metal: 22, Exhaust: 23, Muzzle: 24, Fur: 25, Steam: 26, TreeBase: 27, Ray: 34, Ripple: 35 } as const;
export const COLORS = PALETTE.length;
/** skills.json category order (ADR-209): perks, survival, homestead, medicine, crafting, combat, vehicles. */
export const treeColor = (tree: number): number => C.TreeBase + Math.max(0, Math.min(6, tree | 0));
