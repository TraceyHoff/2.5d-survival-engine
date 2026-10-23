import { fieldLength, fieldType, fnv1a, isArrayField, schemaFields, schemaSignature, type Schema } from "@engine/core";
import type { BitReader, BitWriter } from "./bits.js";

/** Token bucket config: sustained `perSec`, bursts up to `burst`. */
export interface RateLimit { perSec: number; burst: number }
export const DEFAULT_COMMAND_RATE: RateLimit = { perSec: 10, burst: 20 };

/**
 * A schema'd message type (client->server command or server->client event). Payload fields are core field types
 * (scalars, or fixed-length arrays such as `name: { type: "u8", length: 24 }`, sent as exactly `length` elements;
 * short arrays are zero-padded, long ones truncated), encoded in sorted field order. Fields listed in `entityFields` are entity references:
 * callers pass LOCAL entity ids, net sends NetIds and resolves them back to local entities on the other side.
 */
/** Non-generic view used for registries/lists (MessageDef<S> is invariant in S because of keyof). */
export interface MessageDefBase {
  readonly kind: "command" | "event";
  readonly name: string;
  readonly schema: Schema;
  readonly entityFields: readonly string[];
  readonly rate?: RateLimit;
}
export interface MessageDef<S extends Schema = Schema> extends MessageDefBase {
  readonly schema: S;
  readonly entityFields: readonly (keyof S & string)[];
}
export type Payload<S extends Schema> = { [K in keyof S]: S[K] extends string ? number : S[K] extends { length: number } ? ArrayLike<number> : number };
/** Untyped payload as handlers see it: entity / scalar fields are numbers, array fields number[]. */
export type PayloadValues = Record<string, number | ArrayLike<number>>;

export function defineCommand<S extends Schema>(name: string, schema: S, opts: { entityFields?: (keyof S & string)[]; rate?: RateLimit } = {}): MessageDef<S> {
  return { kind: "command", name, schema, entityFields: opts.entityFields ?? [], ...(opts.rate && { rate: opts.rate }) };
}
export function defineNetEvent<S extends Schema>(name: string, schema: S, opts: { entityFields?: (keyof S & string)[] } = {}): MessageDef<S> {
  return { kind: "event", name, schema, entityFields: opts.entityFields ?? [] };
}

/** Ordered registry; ids = index. Both peers must register the same list (checked via the "netdefs" handshake hash). */
export class MessageRegistry {
  readonly defs: MessageDefBase[];
  private ids = new Map<MessageDefBase, number>();
  constructor(defs: readonly MessageDefBase[] = []) { this.defs = [...defs]; this.defs.forEach((d, i) => this.ids.set(d, i)); }
  id(def: MessageDefBase): number { const i = this.ids.get(def); if (i === undefined) throw new Error(`unregistered ${def.kind} ${def.name}`); return i; }
  get(id: number): MessageDefBase | undefined { return this.defs[id]; }
  hash(seed = 0x811c9dc5): number {
    let h = seed;
    for (const d of this.defs) h = fnv1a(`${d.kind}|${d.name}|${schemaSignature(d.schema)}|${d.entityFields.join(",")}\n`, h);
    return h;
  }
}

export function writePayload(w: BitWriter, def: MessageDefBase, p: Readonly<Record<string, unknown>>): void {
  for (const f of schemaFields(def.schema)) {
    const spec = def.schema[f]!; const t = fieldType(spec); const v = p[f];
    if (isArrayField(spec)) { const a = (v ?? []) as ArrayLike<number>; for (let i = 0, n = fieldLength(spec); i < n; i++) w.write(t, a[i] ?? 0); }
    else w.write(t, typeof v === "number" ? v : 0);
  }
}
export function readPayload(r: BitReader, def: MessageDefBase): Record<string, number> {
  const o: Record<string, number | number[]> = {};
  for (const f of schemaFields(def.schema)) {
    const spec = def.schema[f]!; const t = fieldType(spec);
    if (isArrayField(spec)) { const a: number[] = []; for (let i = 0, n = fieldLength(spec); i < n; i++) a.push(r.read(t)); o[f] = a; }
    else o[f] = r.read(t);
  }
  return o as Record<string, number>; // array fields are number[] at runtime (Payload<S> types them as ArrayLike<number>)
}

/** Deterministic token bucket driven by server ticks (no wall clock). */
export class TokenBucket {
  tokens: number;
  constructor(readonly limit: RateLimit) { this.tokens = limit.burst; }
  refill(dtSeconds: number): void { this.tokens = Math.min(this.limit.burst, this.tokens + this.limit.perSec * dtSeconds); }
  take(): boolean { if (this.tokens < 1) return false; this.tokens -= 1; return true; }
}
