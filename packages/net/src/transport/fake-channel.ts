/**
 * In-memory paired fake data channels for CI (no real WebRTC). `FakeRtcNetwork.link()` returns the two ends of a
 * peer connection (an RtcPeerLink each) whose reliable pipe is ordered + lossless and whose unreliable pipe can drop
 * (`loss`) and reorder (`reorder`, chance a message is delayed behind later ones). Nothing moves until `flush()`.
 */
import { Rng } from "@engine/core";
import type { DataPipe, RtcPeerLink } from "./rtc.js";

export interface FakeLinkOptions { loss?: number; reorder?: number }
interface Msg { to: FakePipe; bytes: Uint8Array; reliable: boolean; holds: number }

class FakePipe implements DataPipe {
  open = false; closed = false; bufferedAmount = 0; peer!: FakePipe;
  openFns: (() => void)[] = []; msgFns: ((b: Uint8Array) => void)[] = []; closeFns: (() => void)[] = [];
  constructor(private readonly net: FakeRtcNetwork, readonly reliable: boolean, private readonly opts: FakeLinkOptions) {}
  send(bytes: Uint8Array): void { if (this.open) this.net.enqueue({ to: this.peer, bytes: bytes.slice(), reliable: this.reliable, holds: 0 }, this.opts); }
  close(): void { if (this.closed) return; this.net.later(() => { this.shut(); this.peer.shut(); }); }
  shut(): void { if (this.closed) return; this.closed = true; this.open = false; for (const f of this.closeFns) f(); }
  onOpen(fn: () => void): void { if (this.open) queueMicrotask(fn); else this.openFns.push(fn); }
  onMessage(fn: (b: Uint8Array) => void): void { this.msgFns.push(fn); }
  onClose(fn: () => void): void { this.closeFns.push(fn); }
}

export class FakeRtcNetwork {
  private q: Msg[] = []; private tasks: (() => void)[] = [];
  private readonly rng: Rng;
  stats = { sent: 0, dropped: 0, reordered: 0, delivered: 0 };
  constructor(seed = 1) { this.rng = new Rng(seed); }
  /** One peer connection: [offerer end, answerer end]. Both pipes open on the next flush (unless `autoOpen` false). */
  link(opts: FakeLinkOptions = {}, autoOpen = true): [RtcPeerLink, RtcPeerLink] {
    const mk = (): [FakePipe, FakePipe] => { const r = new FakePipe(this, true, {}); const u = new FakePipe(this, false, opts); return [r, u]; };
    const [ar, au] = mk(), [br, bu] = mk(); ar.peer = br; br.peer = ar; au.peer = bu; bu.peer = au;
    const end = (r: FakePipe, u: FakePipe): RtcPeerLink => ({ reliable: r, unreliable: u, close: () => { r.close(); u.close(); } });
    if (autoOpen) this.later(() => { for (const p of [ar, au, br, bu]) { if (p.closed) continue; p.open = true; for (const f of p.openFns.splice(0)) f(); } });
    return [end(ar, au), end(br, bu)];
  }
  /** @internal */ later(fn: () => void): void { this.tasks.push(fn); }
  /** @internal */ enqueue(m: Msg, o: FakeLinkOptions): void {
    this.stats.sent++;
    if (!m.reliable) {
      if ((o.loss ?? 0) > 0 && this.rng.next() < o.loss!) { this.stats.dropped++; return; }
      if ((o.reorder ?? 0) > 0 && this.rng.next() < o.reorder!) { m.holds = 1 + Math.floor(this.rng.next() * 3); this.stats.reordered++; }
    }
    this.q.push(m);
  }
  /** Delivers queued traffic (and messages sent while delivering); held unreliable messages slip behind later ones. */
  flush(): void {
    for (let guard = 0; guard < 1000 && (this.tasks.length || this.q.length); guard++) {
      const tasks = this.tasks.splice(0);
      const batch = this.q.splice(0); const held: Msg[] = [];
      for (const m of batch) {
        if (m.holds > 0) { m.holds--; held.push(m); continue; }
        if (m.to.closed || !m.to.open) continue;
        this.stats.delivered++; for (const f of m.to.msgFns) f(m.bytes);
      }
      for (const t of tasks) t(); // closes/opens after the traffic queued before them (a "bye" lands before the close)
      this.q.unshift(...held); // delivered after this round's later traffic
      if (held.length === batch.length && !tasks.length && !this.tasks.length) break; // only held traffic left: it slips behind the next flush's
    }
  }
}
