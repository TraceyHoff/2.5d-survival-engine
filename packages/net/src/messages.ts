import { fieldType, fnv1a, schemaFields, schemaSignature, type Schema } from "@engine/core";
import type { BitReader, BitWriter } from "./bits.js";

/** Token bucket config: sustained `perSec`, bursts up to `burst`. */
export interface RateLimit { perSec: number; burst: number }
export const DEFAULT_COMMAND_RATE: RateLimit = { perSec: 10, burst: 20 };

/**
 * A schema'd message type (client->server command or server->client event). Payload fields are scalar
 * core field types, encoded in sorted field order. Fields listed in `entityFields` are entity references:
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
export type Payload<S extends Schema> = { [K in keyof S]: number };

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

export function writePayload(w: BitWriter, def: MessageDefBase, p: Readonly<Record<string, number>>): void {
  for (const f of schemaFields(def.schema)) w.write(fieldType(def.schema[f]!), p[f] ?? 0);
}
export function readPayload(r: BitReader, def: MessageDefBase): Record<string, number> {
  const o: Record<string, number> = {}; for (const f of schemaFields(def.schema)) o[f] = r.read(fieldType(def.schema[f]!)); return o;
}

/** Deterministic token bucket driven by server ticks (no wall clock). */
export class TokenBucket {
  tokens: number;
  constructor(readonly limit: RateLimit) { this.tokens = limit.burst; }
  refill(dtSeconds: number): void { this.tokens = Math.min(this.limit.burst, this.tokens + this.limit.perSec * dtSeconds); }
  take(): boolean { if (this.tokens < 1) return false; this.tokens -= 1; return true; }
}
