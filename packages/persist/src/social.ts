/**
 * World-level social state: core's GroupRegistry (parties, clans, banners) and ClaimRegistry (area claims / zones).
 *
 * - Groups are stored in core's own format (`GroupRegistry.encode()`, v2 with banners; v1 still decodes) as blob
 *   "groups". Persist does not reinterpret the bytes.
 * - Claims use core's ClaimRegistry codec (v1, magic "CLLM"), blob "claims".
 * - Per-entity privilege data (OwnedBy, AccessList, PlayerId, Membership) are persistent components: they travel with
 *   the chunk codec (structures/containers) or the player record (players), not here.
 */
import { ClaimRegistry, GroupRegistry } from "@engine/core";
import type { StoredBlob, WorldStore } from "./types.js";

export const GROUPS_BLOB = "groups";
export const CLAIMS_BLOB = "claims";
export const CLAIMS_VERSION = 1;
export class SocialCodecError extends Error {}

/** Claims use core's codec (`ClaimRegistry.encode/decode/load`, ADR-079), byte-identical to persist's former v1 blob. */
export const encodeClaims = (reg: ClaimRegistry): Uint8Array => reg.encode();
export function decodeClaims(bytes: Uint8Array): ClaimRegistry {
  try { return ClaimRegistry.decode(bytes); } catch (e) { throw new SocialCodecError(`saved claims failed to decode: ${String(e)}`); }
}
/** In-place restore into an existing registry (e.g. the one held by the Permissions resource). */
export function loadClaimsInto(store: WorldStore, reg: ClaimRegistry): boolean {
  const c = store.readBlob(CLAIMS_BLOB); if (!c) return false;
  try { reg.load(c.bytes); } catch (e) { throw new SocialCodecError(`saved claims failed to decode: ${String(e)}`); }
  return true;
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
  claims = c ? decodeClaims(c.bytes) : new ClaimRegistry();
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
