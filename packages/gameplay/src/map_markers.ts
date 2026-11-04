/**
 * World-map markers: player-placed points of interest on the map.
 *  - PlaceMapMarkerCmd { x, y, visibility, len, label[24] }: server-authoritative. The marker entity carries
 *    Transform (world position, so chunk persistence saves it), Owner (placing client's session, so the owner
 *    always passes the replication scope) and MapMarker (persistent PlayerId owner, visibility, the party/clan
 *    id it was placed under, and a sanitized label, max MAP_MARKER_LABEL_MAX chars, like Sign text).
 *  - RemoveMapMarkerCmd { marker }: only the marker's owner may remove it (server resolves the NetId entity).
 * Visibility is set at creation and never changes:
 *  - private (0): only the owner sees it (replication scope returns false for everyone else; the Owner pass
 *    still lets the owner see it).
 *  - party (1): the owner's party at creation is recorded; any current member of that party sees it, including
 *    players who join the party after the marker was placed (the scope checks live membership, not a snapshot).
 *  - clan (2): same, for the owner's clan.
 * The client applies the same rule locally (visibleMarkers) so a marker stops showing the moment the viewer
 * leaves the party/clan, even before the next snapshot arrives. The server also flags marker entities global
 * (net.setGlobal, in apps/server) so they replicate regardless of AOI — a map marker for a far-away location
 * must show on the map even when the player is nowhere near it.
 */
import { entityIndex, GroupKind, Membership, Owner, Permissions, PlayerId, Transform, type CommandHandlers, type Entity, type GroupRegistry, type World } from "@engine/core";
import { MAP_MARKER_LABEL_MAX, MapMarker, MarkerVisibility } from "./components.js";
import { PlaceMapMarkerCmd, RemoveMapMarkerCmd } from "./map_marker_commands.js";
import { sanitizeSignText } from "./signs.js";


const pidOf = (w: World, e: Entity): number => (w.isRegistered(PlayerId) ? w.getField(e, PlayerId, "id") ?? 0 : 0);
const groupsOf = (w: World): GroupRegistry | undefined => { try { return w.resource(Permissions).groups; } catch { return undefined; } };

/** Party / clan id of a player right now (0 = none). Prefers the core GroupRegistry; falls back to the player's mirrored Membership. */
export const partyOfPlayer = (w: World, player: number): number => {
  const g = groupsOf(w); if (g) return g.groupsOf(player, GroupKind.Party)[0]?.id ?? 0;
  for (const e of w.query([PlayerId])) if (w.getField(e, PlayerId, "id") === player) return w.getField(e, Membership, "partyId") ?? 0;
  return 0;
};
export const clanOfPlayer = (w: World, player: number): number => {
  const g = groupsOf(w); if (g) return g.groupsOf(player, GroupKind.Clan)[0]?.id ?? 0;
  for (const e of w.query([PlayerId])) if (w.getField(e, PlayerId, "id") === player) return w.getField(e, Membership, "clanId") ?? 0;
  return 0;
};

/** Pure: why a placement fails, or undefined. Coordinates must be finite and inside the world (checked by the caller against its own bounds if any). */
export function placeMarkerReject(w: World, actor: Entity, x: number, y: number, visibility: number): string | undefined {
  const me = pidOf(w, actor); if (!me) return "no_player";
  if (!Number.isFinite(x) || !Number.isFinite(y)) return "bad_coords";
  if (visibility !== 0 && visibility !== 1 && visibility !== 2) return "bad_visibility";
  if (visibility === 1 && !partyOfPlayer(w, me)) return "no_party";
  if (visibility === 2 && !clanOfPlayer(w, me)) return "no_clan";
  return undefined;
}
/** Raw spawn (no checks): returns the marker entity. Label is sanitized like sign text. */
export function spawnMarker(w: World, actor: Entity, x: number, y: number, visibility: number, label = ""): Entity {
  const me = pidOf(w, actor); const clientId = w.has(actor, Owner) ? w.getField(actor, Owner, "clientId") ?? 0 : 0;
  const clean = sanitizeSignText(label, MAP_MARKER_LABEL_MAX);
  const e = w.create();
  w.add(e, Transform, { x, y, z: 0 }).add(e, Owner, { clientId }).add(e, MapMarker, { owner: me, visibility, party: visibility === 1 ? partyOfPlayer(w, me) : 0, clan: visibility === 2 ? clanOfPlayer(w, me) : 0, len: 0 });
  const a = w.getArray(e, MapMarker, "label")!; for (let i = 0; i < MAP_MARKER_LABEL_MAX; i++) a[i] = i < clean.length ? clean.charCodeAt(i) : 0;
  w.setField(e, MapMarker, "len", clean.length); w.store(MapMarker).markChanged(entityIndex(e));
  return e;
}
export function placeMarker(w: World, actor: Entity, x: number, y: number, visibility: number, label = ""): string | Entity {
  const r = placeMarkerReject(w, actor, x, y, visibility); if (r) return r;
  return spawnMarker(w, actor, x, y, visibility, label);
}
/** Marker label (decoded from the u8 array). */
export function markerLabel(w: World, e: Entity): string {
  const n = w.getField(e, MapMarker, "len") ?? 0; const a = w.getArray(e, MapMarker, "label"); if (!a) return "";
  let o = ""; for (let i = 0; i < Math.min(n, MAP_MARKER_LABEL_MAX); i++) o += String.fromCharCode(a[i] ?? 32); return o;
}
/** Is this marker visible to `viewer` (a player entity)? Same rule the server scope uses, evaluated locally. */
export function markerVisibleTo(w: World, marker: Entity, viewer: Entity): boolean {
  if (!w.has(marker, MapMarker)) return false;
  const me = pidOf(w, viewer); if (!me) return false;
  const m = w.get(marker, MapMarker)!; if (m.owner === me) return true;
  if (m.visibility === 1) return m.party !== 0 && partyOfPlayer(w, me) === m.party;
  if (m.visibility === 2) return m.clan !== 0 && clanOfPlayer(w, me) === m.clan;
  return false;
}
/** All markers visible to `viewer`, sorted by label then position. */
export function visibleMarkers(w: World, viewer: Entity): { entity: Entity; x: number; y: number; visibility: number; owner: number; label: string }[] {
  const out: { entity: Entity; x: number; y: number; visibility: number; owner: number; label: string }[] = [];
  if (!w.isRegistered(MapMarker)) return out;
  for (const e of w.query([MapMarker])) {
    if (!markerVisibleTo(w, e, viewer)) continue;
    const t = w.get(e, Transform); const m = w.get(e, MapMarker)!;
    out.push({ entity: e, x: t?.x ?? 0, y: t?.y ?? 0, visibility: m.visibility, owner: m.owner, label: markerLabel(w, e) });
  }
  out.sort((a, b) => (a.label || "Marker").localeCompare(b.label || "Marker") || a.x - b.x || a.y - b.y);
  return out;
}
/** Server-side replication scope for MapMarker: the owner always passes via the Owner component (net handles that
 * before calling this); everyone else passes only if they currently share the marker's party / clan. */
export function markerScope(w: World, e: Entity, clientId: number): boolean {
  if (!w.has(e, MapMarker)) return false;
  const m = w.get(e, MapMarker)!; if (m.visibility !== 1 && m.visibility !== 2) return false;
  // viewer PlayerId: the entity owned by this client that carries a PlayerId
  let viewer = 0;
  for (const p of w.query([PlayerId])) if (w.has(p, Owner) && w.getField(p, Owner, "clientId") === clientId) { viewer = w.getField(p, PlayerId, "id") ?? 0; break; }
  if (!viewer || viewer === m.owner) return false;
  const g = groupsOf(w); if (!g) return false;
  const kind = m.visibility === 1 ? GroupKind.Party : GroupKind.Clan; const id = m.visibility === 1 ? m.party : m.clan;
  const grp = id ? g.get(id) : undefined; return !!grp && grp.kind === kind && grp.members.has(viewer);
}
/** Only the owner may remove a marker. */
export function removeMarkerReject(w: World, actor: Entity, marker: Entity): string | undefined {
  const me = pidOf(w, actor); if (!me) return "no_player";
  if (!w.isAlive(marker) || !w.has(marker, MapMarker)) return "not_found";
  if (w.getField(marker, MapMarker, "owner") !== me) return "not_owner";
  return undefined;
}
export function removeMarker(w: World, actor: Entity, marker: Entity): string | undefined {
  const r = removeMarkerReject(w, actor, marker); if (r) return r;
  w.destroy(marker); return undefined;
}
/** Server: marker command handlers. */
export function installMapMarkerCommands(world: World, handlers: CommandHandlers): void {
  handlers.on(PlaceMapMarkerCmd, {
    validate: (v, c) => placeMarkerReject(world, c.actor, v.x, v.y, v.visibility),
    handle: (v, c) => { const label = Array.from({ length: Math.min(v.len, MAP_MARKER_LABEL_MAX) }, (_, i) => String.fromCharCode(v.label[i] ?? 32)).join(""); placeMarker(world, c.actor, v.x, v.y, v.visibility, label); },
  });
  handlers.on(RemoveMapMarkerCmd, {
    validate: (v, c) => removeMarkerReject(world, c.actor, v.marker as Entity),
    handle: (v, c) => { removeMarker(world, c.actor, v.marker as Entity); },
  });
}
