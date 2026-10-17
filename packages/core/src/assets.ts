/** Minimal ref-counted async asset cache; loaders are registered per kind (renderer/audio supply real ones). */
export type Loader<T> = (url: string) => Promise<T>;
export class AssetManager {
  private loaders = new Map<string, Loader<unknown>>();
  private cache = new Map<string, { p: Promise<unknown>; refs: number }>();
  registerLoader<T>(kind: string, l: Loader<T>): void { this.loaders.set(kind, l); }
  load<T>(kind: string, url: string): Promise<T> {
    const key = `${kind}:${url}`; const hit = this.cache.get(key);
    if (hit) { hit.refs++; return hit.p as Promise<T>; }
    const l = this.loaders.get(kind); if (!l) return Promise.reject(new Error(`no loader for ${kind}`));
    const p = l(url); this.cache.set(key, { p, refs: 1 }); return p as Promise<T>;
  }
  release(kind: string, url: string): void {
    const key = `${kind}:${url}`; const e = this.cache.get(key); if (e && --e.refs <= 0) this.cache.delete(key);
  }
}
