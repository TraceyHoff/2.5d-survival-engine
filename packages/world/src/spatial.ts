/** Uniform-grid spatial hash keyed by cell; stores numeric entity ids. */
export class SpatialHash {
  private cells = new Map<number, Set<number>>();
  private where = new Map<number, number>();
  constructor(readonly cellSize = 4) {}
  private key(x: number, y: number): number {
    return ((Math.floor(x / this.cellSize) & 0xffff) << 16 | (Math.floor(y / this.cellSize) & 0xffff)) >>> 0;
  }
  insert(id: number, x: number, y: number): void {
    const k = this.key(x, y); const old = this.where.get(id);
    if (old === k) return; if (old !== undefined) this.cells.get(old)?.delete(id);
    let s = this.cells.get(k); if (!s) { s = new Set(); this.cells.set(k, s); }
    s.add(id); this.where.set(id, k);
  }
  remove(id: number): void { const k = this.where.get(id); if (k !== undefined) { this.cells.get(k)?.delete(id); this.where.delete(id); } }
  /** Candidates within AABB around (x,y) of radius r (broad phase; caller does exact test). */
  queryRadius(x: number, y: number, r: number, out: number[] = []): number[] {
    const cs = this.cellSize;
    for (let cx = Math.floor((x - r) / cs); cx <= Math.floor((x + r) / cs); cx++)
      for (let cy = Math.floor((y - r) / cs); cy <= Math.floor((y + r) / cs); cy++) {
        const s = this.cells.get(((cx & 0xffff) << 16 | (cy & 0xffff)) >>> 0); if (s) for (const id of s) out.push(id);
      }
    return out;
  }
  clear(): void { this.cells.clear(); this.where.clear(); }
}
