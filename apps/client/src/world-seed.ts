/** The existing generator takes one unsigned 32-bit numeric seed. Blank uses the displayed random choice. */
export function parseWorldSeed(text: string, generated: number): number | undefined {
  const t = text.trim();
  if (!t) return generated;
  if (!/^\d+$/.test(t)) return undefined;
  const n = Number(t);
  return Number.isInteger(n) && n >= 0 && n <= 0xffffffff ? n : undefined;
}
