/**
 * World-level social state: core's GroupRegistry (parties, clans, banners) and ClaimRegistry (area claims / zones).
 *
 * - Groups are stored in core's own format (`GroupRegistry.encode()`, v2 with banners; v1 still decodes) as blob
 *   "groups". Persist does not reinterpret the bytes.
 * - Claims use core's ClaimRegistry codec (v1, magic "CLLM"), blob "claims".
 * - Per-entity privilege data (OwnedBy, AccessList, PlayerId, Membership) are persistent components: they travel with
 *   the chunk codec (structures/containers) or the player record (players), not here.
 */
import { BinaryReader, BinaryWriter, ClaimRegistry, GroupRegistry, PlayerNameRegistry, SaleLedger, type SaleEntry } from "@engine/core";
import { OwnerKind, type RecordRef, type StoredBlob, type StoredRecord, type WorldStore } from "./types.js";

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

/**
 * `names` (core PlayerNameRegistry) and `ledger` (core SaleLedger) are optional so existing callers keep working;
 * loadSocial always returns both. They live in the records table, not blobs:
 * - ns "names", id "registry": core's own registry format (`encode()`, v1), rewritten when `seq` changes.
 * - ns "sale", id = zero-padded seq: one row per SaleEntry (persist sale format v1, see encodeSale), owner-indexed
 *   (OwnerKind.Player/Group) so "sales of player 7" is a listRecords query. Written incrementally via
 *   `entriesSince`; rows older than the ledger's capacity are deleted in the same batch.
 */
export interface SocialState { groups: GroupRegistry; claims: ClaimRegistry; names?: PlayerNameRegistry; ledger?: SaleLedger }

export const NAMES_NS = "names";
export const NAMES_ID = "registry";
export const SALE_NS = "sale";
export const SALE_VERSION = 1;
export const saleRecordId = (seq: number): string => String(seq).padStart(10, "0");

/**
 * Sale v1 (LE): u32 seq, u32 tick, u32 stallId, u16 listing, u32 buyerPlayer, u32 ownerPlayer, u32 ownerGroup,
 * u32 item, u32 qty, u32 currency, u32 price, u16 n, n x u32 crafterId.
 * The runtime `stall` / `buyer` entity handles are not saved (they do not survive a restart): decode yields 0.
 */
export function encodeSale(e: SaleEntry): Uint8Array {
  const w = new BinaryWriter(48 + 4 * e.crafterIds.length);
  w.write("u32", e.seq); w.write("u32", e.tick); w.write("u32", e.stallId); w.write("u16", e.listing);
  w.write("u32", e.buyerPlayer); w.write("u32", e.ownerPlayer); w.write("u32", e.ownerGroup);
  w.write("u32", e.item); w.write("u32", e.qty); w.write("u32", e.currency); w.write("u32", e.price);
  w.write("u16", e.crafterIds.length); for (const c of e.crafterIds) w.write("u32", c);
  return w.finish();
}
export function decodeSale(bytes: Uint8Array): SaleEntry {
  const r = new BinaryReader(bytes);
  const seq = r.read("u32"), tick = r.read("u32"), stallId = r.read("u32"), listing = r.read("u16");
  const buyerPlayer = r.read("u32"), ownerPlayer = r.read("u32"), ownerGroup = r.read("u32");
  const item = r.read("u32"), qty = r.read("u32"), currency = r.read("u32"), price = r.read("u32");
  const n = r.read("u16"); const crafterIds: number[] = []; for (let i = 0; i < n; i++) crafterIds.push(r.read("u32"));
  return { seq, tick, stallId, stall: 0 as SaleEntry["stall"], listing, buyer: 0 as SaleEntry["buyer"], buyerPlayer, ownerPlayer, ownerGroup, item, qty, currency, price, crafterIds };
}
const saleRecord = (e: SaleEntry, tick: number): StoredRecord => ({
  ns: SALE_NS, id: saleRecordId(e.seq), format: SALE_VERSION, bytes: encodeSale(e), tick,
  ownerKind: e.ownerGroup ? OwnerKind.Group : e.ownerPlayer ? OwnerKind.Player : OwnerKind.None, ownerId: e.ownerGroup || e.ownerPlayer, chunk: "",
});

/** Saved PlayerNameRegistry (fresh one if none). */
export function loadNames(store: WorldStore): PlayerNameRegistry {
  const r = store.readRecord(NAMES_NS, NAMES_ID); if (!r) return new PlayerNameRegistry();
  try { return PlayerNameRegistry.decode(r.bytes); } catch (e) { throw new SocialCodecError(`saved player names failed to decode: ${String(e)}`); }
}
/** Saved sale log, oldest first, restored into a SaleLedger with the same seq numbers (fresh one if none). */
export function loadSaleLedger(store: WorldStore, capacity?: number): SaleLedger {
  const led = new SaleLedger(capacity);
  const rows = store.listRecords(SALE_NS);
  for (const row of rows.slice(Math.max(0, rows.length - led.capacity))) {
    if (row.format > SALE_VERSION) throw new SocialCodecError(`sale ${row.id}: unsupported format ${row.format}`);
    let e: SaleEntry; try { e = decodeSale(row.bytes); } catch (x) { throw new SocialCodecError(`sale ${row.id} failed to decode: ${String(x)}`); }
    led.seq = e.seq - 1; const { seq: _s, ...rest } = e; led.append(rest);
  }
  return led;
}

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
  return { groups, claims, names: loadNames(store), ledger: loadSaleLedger(store) };
}

/** Tracks what was last written so autosave only re-writes social records that changed. */
export class SocialSaver {
  private groupsSeq = -1; private claimsBytes: Uint8Array | undefined; private namesSeq = -1; private saleSeq = -1;
  /** Ledger entries with seq <= saleLow are not in memory; rows <= diskLow are already deleted on disk. */
  private saleLow = 0; private diskLow = 0;
  constructor(readonly state: SocialState, store?: WorldStore) {
    // A freshly loaded registry equals the stored record: nothing to write until it changes.
    if (store?.readBlob(GROUPS_BLOB)) this.groupsSeq = state.groups.seq;
    const c = store?.readBlob(CLAIMS_BLOB); if (c) this.claimsBytes = encodeClaims(state.claims);
    if (state.names && store?.readRecord(NAMES_NS, NAMES_ID)) this.namesSeq = state.names.seq;
    if (state.ledger) {
      const led = state.ledger; const rows = store?.listRecords(SALE_NS) ?? [];
      const last = rows.length ? decodeSale(rows[rows.length - 1]!.bytes).seq : -1;
      const low = led.entriesSince(0) ? 0 : rows.length ? decodeSale(rows[0]!.bytes).seq - 1 : Math.max(0, led.seq - led.capacity);
      this.saleLow = low; this.diskLow = rows.length ? decodeSale(rows[0]!.bytes).seq - 1 : low;
      this.saleSeq = last; // rows already on disk (a loaded ledger); -1 = write everything in memory
    }
  }
  /** A write carrying our blobs failed: write everything again next time. */
  invalidate(): void { this.groupsSeq = -1; this.claimsBytes = undefined; this.namesSeq = -1; this.saleSeq = -1; }
  /**
   * Changed name registry / new sales as records (and remembers them as saved). Sale rows are upserts, so a rewrite
   * after `invalidate` (every entry still in memory) is idempotent; rows that fell out of the ledger are deleted.
   */
  changedRecords(tick: number, force = false): { records: StoredRecord[]; deleteRecords: RecordRef[] } {
    const records: StoredRecord[] = []; const deleteRecords: RecordRef[] = []; const { names, ledger } = this.state;
    if (names && (force || names.seq !== this.namesSeq)) {
      const bytes = names.encode(); records.push({ ns: NAMES_NS, id: NAMES_ID, format: bytes[0] ?? 0, bytes, tick, ownerKind: 0, ownerId: 0, chunk: "" });
      this.namesSeq = names.seq;
    }
    if (ledger && (force || ledger.seq !== this.saleSeq)) {
      // In-memory window: seq > low. `low` only grows (append-only ledger, capacity-bounded).
      this.saleLow = Math.max(this.saleLow, ledger.seq - ledger.capacity);
      const all = ledger.entriesSince(this.saleLow) ?? [];
      const since = force || this.saleSeq < 0 ? this.saleLow : Math.max(this.saleSeq, this.saleLow);
      for (const e of all) if (e.seq > since) records.push(saleRecord(e, tick));
      // Rows that fell out of the window since the last save.
      for (let q = this.diskLow + 1; q <= this.saleLow; q++) deleteRecords.push({ ns: SALE_NS, id: saleRecordId(q) });
      this.diskLow = this.saleLow; this.saleSeq = ledger.seq;
    }
    return { records, deleteRecords };
  }
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
