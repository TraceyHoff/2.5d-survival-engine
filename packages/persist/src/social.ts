/**
 * World-level social state: core's GroupRegistry (parties, clans, banners) and ClaimRegistry (area claims / zones).
 *
 * - Groups are stored in core's own format (`GroupRegistry.encode()`, v2 with banners; v1 still decodes) as blob
 *   "groups". Persist does not reinterpret the bytes.
 * - Core has no ClaimRegistry codec yet, so persist owns a small versioned format, blob "claims" (below).
 * - Per-entity privilege data (OwnedBy, AccessList, PlayerId, Membership) are persistent components: they travel with
 *   the chunk codec (structures/containers) or the player record (players), not here.
 */
import { BinaryReader, BinaryWriter, ClaimRegistry, GroupRegistry, type Claim } from "@engine/core";
import type { StoredBlob, WorldStore } from "./types.js";

export const GROUPS_BLOB = "groups";
export const CLAIMS_BLOB = "claims";
const CLAIMS_MAGIC = 0x4d4c4c43; // "CLLM" little endian
export const CLAIMS_VERSION = 1;
export class SocialCodecError extends Error {}

/**
 * Claims format v1 (little endian, core BinaryWriter):
 *   u32 magic "CLLM" | u8 version | u32 nextId | u32 defaultFlags | u32 count |
 *   count x (u32 id, u32 ownerGroup, f64 x0, f64 y0, f64 x1, f64 y1, u32 flags, i32 priority), sorted by id.
 */
export function encodeClaims(reg: ClaimRegistry): Uint8Array {
  const all = reg.all(); const w = new BinaryWriter(16 + all.length * 48);
  w.write("u32", CLAIMS_MAGIC); w.write("u8", CLAIMS_VERSION); w.write("u32", claimsNextId(reg)); w.write("u32", reg.defaultFlags >>> 0); w.write("u32", all.length);
  for (const c of all) {
    w.write("u32", c.id); w.write("u32", c.ownerGroup); w.write("f64", c.x0); w.write("f64", c.y0); w.write("f64", c.x1); w.write("f64", c.y1);
    w.write("u32", c.flags >>> 0); w.write("i32", c.priority | 0);
  }
  return w.finish();
}
export function decodeClaims(bytes: Uint8Array): ClaimRegistry {
  const r = new BinaryReader(bytes);
  if (bytes.length < 17 || r.read("u32") !== CLAIMS_MAGIC) throw new SocialCodecError("not a claims record");
  const v = r.read("u8"); if (v !== CLAIMS_VERSION) throw new SocialCodecError(`unsupported claims format v${v} (this build reads v${CLAIMS_VERSION})`);
  const nextId = r.read("u32"); const reg = new ClaimRegistry(); reg.defaultFlags = r.read("u32"); const n = r.read("u32");
  for (let i = 0; i < n; i++) {
    const c: Claim = { id: r.read("u32"), ownerGroup: r.read("u32"), x0: r.read("f64"), y0: r.read("f64"), x1: r.read("f64"), y1: r.read("f64"), flags: r.read("u32"), priority: r.read("i32") };
    reg.add(c);
  }
  // Restore nextId (ids of removed claims are never reused) through the public API: add(id) bumps it, remove keeps it.
  if (nextId > claimsNextId(reg)) { const tmp = reg.add({ id: nextId - 1, ownerGroup: 0, x0: 0, y0: 0, x1: 0, y1: 0, flags: 0 }); reg.remove(tmp.id); }
  return reg;
}
/** ClaimRegistry keeps nextId private (TODO(core): ClaimRegistry.encode/decode). Falls back to max id + 1. */
function claimsNextId(reg: ClaimRegistry): number {
  const n = (reg as unknown as { nextId?: unknown }).nextId;
  if (typeof n === "number" && Number.isFinite(n)) return n;
  let m = 0; for (const c of reg.all()) m = Math.max(m, c.id); return m + 1;
}

export interface SocialState { groups: GroupRegistry; claims: ClaimRegistry }

/**
 * Loads the saved GroupRegistry / ClaimRegistry (fresh ones when the save has none). Pass the result to core's
 * `installPermissions(world, social)` and to `WorldPersistence({ social })`. A record that does not decode throws:
 * starting with empty clans and claims would overwrite them on the next autosave.
 */
export function loadSocial(store: WorldStore): SocialState {
  const g = store.readBlob(GROUPS_BLOB), c = store.readBlob(CLAIMS_BLOB);
  let groups: GroupRegistry, claims: ClaimRegistry;
  try { groups = g ? GroupRegistry.decode(g.bytes) : new GroupRegistry(); } catch (e) { throw new SocialCodecError(`saved groups (format v${g?.format}) failed to decode: ${String(e)}`); }
  try { claims = c ? decodeClaims(c.bytes) : new ClaimRegistry(); } catch (e) { throw e instanceof SocialCodecError ? e : new SocialCodecError(`saved claims failed to decode: ${String(e)}`); }
  return { groups, claims };
}

/** Tracks what was last written so autosave only re-writes social records that changed. */
export class SocialSaver {
  private groupsSeq = -1; private claimsBytes: Uint8Array | undefined;
  constructor(readonly state: SocialState, store?: WorldStore) {
    // A freshly loaded registry equals the stored record: nothing to write until it changes.
    if (store?.readBlob(GROUPS_BLOB)) this.groupsSeq = state.groups.seq;
    const c = store?.readBlob(CLAIMS_BLOB); if (c) this.claimsBytes = encodeClaims(state.claims);
  }
  /** A write carrying our blobs failed: write everything again next time. */
  invalidate(): void { this.groupsSeq = -1; this.claimsBytes = undefined; }
  /** Changed records as blobs (and remembers them as saved). `force` returns both. */
  changed(tick: number, force = false): StoredBlob[] {
    const out: StoredBlob[] = []; const { groups, claims } = this.state;
    if (force || groups.seq !== this.groupsSeq) { const bytes = groups.encode(); out.push({ key: GROUPS_BLOB, format: bytes[0] ?? 0, bytes, tick }); this.groupsSeq = groups.seq; }
    const cb = encodeClaims(claims);
    if (force || !this.claimsBytes || !sameBytes(cb, this.claimsBytes)) { out.push({ key: CLAIMS_BLOB, format: CLAIMS_VERSION, bytes: cb, tick }); this.claimsBytes = cb; }
    return out;
  }
}
function sameBytes(a: Uint8Array, b: Uint8Array): boolean { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; }
