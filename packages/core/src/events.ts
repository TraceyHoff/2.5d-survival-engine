export interface EventType<_T> { readonly name: string }
export const defineEvent = <T>(name: string): EventType<T> => ({ name });
type Handler = (payload: never) => void;
/** Queued event bus: emit() enqueues, flush() (end of tick) delivers in emission order. emitNow() is immediate. */
export class EventBus {
  private handlers = new Map<EventType<unknown>, Handler[]>();
  private queue: [EventType<unknown>, unknown][] = [];
  on<T>(type: EventType<T>, fn: (p: T) => void): () => void {
    const l = this.handlers.get(type) ?? []; l.push(fn as Handler); this.handlers.set(type, l);
    return () => { const i = l.indexOf(fn as Handler); if (i >= 0) l.splice(i, 1); };
  }
  emit<T>(type: EventType<T>, payload: T): void { this.queue.push([type, payload]); }
  emitNow<T>(type: EventType<T>, payload: T): void { for (const h of [...(this.handlers.get(type) ?? [])]) (h as (p: T) => void)(payload); }
  /** Number of queued (undelivered) events. */
  get queued(): number { return this.queue.length; }
  /** Drop queued events beyond the first `n` (used to discard events emitted during replay). */
  truncate(n: number): void { if (n < this.queue.length) this.queue.length = n; }
  flush(): void { const q = this.queue; this.queue = []; for (const [t, p] of q) this.emitNow(t, p); }
}
