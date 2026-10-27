import { afterEach, describe, expect, it, vi } from "vitest";
import { basisTranscoder, setKtx2Workers, transcodeWorkerCount } from "../src/assets/ktx2.js";

// ADR-186: Basis transcoding runs in a worker pool so KTX2 page-ins never block the main thread.
class FakeWorker {
  static made: FakeWorker[] = []; static posted: any[] = [];
  onmessage: ((e: { data: unknown }) => void) | null = null; onerror: (() => void) | null = null;
  constructor(public url: string) { FakeWorker.made.push(this); }
  postMessage(d: any, transfer: ArrayBuffer[]): void {
    FakeWorker.posted.push({ d, transfer, worker: this });
    const lv = [new Uint8Array([1, 2, 3, 4]).buffer];
    queueMicrotask(() => this.onmessage?.({ data: { id: d.id, ok: true, width: 4, height: 4, levels: lv } }));
  }
}
afterEach(() => { vi.unstubAllGlobals(); setKtx2Workers(true); FakeWorker.made = []; FakeWorker.posted = []; });

describe("KTX2 transcode worker pool", () => {
  it("sizes the pool by core count", () => {
    expect(transcodeWorkerCount(2)).toBe(1); expect(transcodeWorkerCount(4)).toBe(1);
    expect(transcodeWorkerCount(8)).toBe(2); expect(transcodeWorkerCount(undefined)).toBe(1);
  });
  it("transcodes off the main thread, transferring the buffer, round-robin across workers", async () => {
    vi.stubGlobal("Worker", FakeWorker); vi.stubGlobal("navigator", { hardwareConcurrency: 8 });
    const origCreate = URL.createObjectURL; URL.createObjectURL = (() => "blob:x") as never;
    try {
      setKtx2Workers(true);
      const a = new ArrayBuffer(16), b = new ArrayBuffer(16);
      const [ia, ib] = await Promise.all([basisTranscoder(a, "astc", true), basisTranscoder(b, "s3tc")]);
      expect(FakeWorker.made.length).toBe(2);
      expect(FakeWorker.posted[0].transfer[0]).toBe(a); expect(FakeWorker.posted[0].d.fmt).toBe(10);
      expect(FakeWorker.posted[0].worker).not.toBe(FakeWorker.posted[1].worker);
      expect(ia.internalFormat).toBe(0x93d0); expect(ib.internalFormat).toBe(0x83f3);
      expect(Array.from(ia.levels[0] as Uint8Array)).toEqual([1, 2, 3, 4]);
    } finally { URL.createObjectURL = origCreate; }
  });
  it("reports worker errors as a rejected transcode (caller falls back to PNG)", async () => {
    class Bad extends FakeWorker { override postMessage(d: any): void { queueMicrotask(() => this.onmessage?.({ data: { id: d.id, ok: false, error: "boom" } })); } }
    vi.stubGlobal("Worker", Bad); const origCreate = URL.createObjectURL; URL.createObjectURL = (() => "blob:x") as never;
    try { setKtx2Workers(true); await expect(basisTranscoder(new ArrayBuffer(8), "etc2")).rejects.toThrow("boom"); }
    finally { URL.createObjectURL = origCreate; }
  });
});
