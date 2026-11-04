/**
 * World-map marker command definitions (kept free of gameplay imports so input.ts can register them without an
 * import cycle: map_markers.ts itself imports signs.ts, which reaches back to input.ts through building/place.ts).
 */
import { defineCommand } from "@engine/core";
import { MAP_MARKER_LABEL_MAX } from "./components.js";

export const PlaceMapMarkerCmd = defineCommand("gameplay.placeMapMarker", { x: "f32", y: "f32", visibility: "u8", len: "u8", label: { type: "u8", length: MAP_MARKER_LABEL_MAX } });
export const RemoveMapMarkerCmd = defineCommand("gameplay.removeMapMarker", { marker: "u32" });
/** Registration order = wire order. Append only. */
export const MAP_MARKER_COMMANDS = [PlaceMapMarkerCmd, RemoveMapMarkerCmd] as const;
/** Entity fields (NetId on the wire) per command. */
export const MAP_MARKER_ENTITY_FIELDS: Readonly<Record<string, readonly string[]>> = { [RemoveMapMarkerCmd.name]: ["marker"] };
/** Reject reasons (append to the server reason list in this order). */
export const MAP_MARKER_REJECT_REASONS = ["no_player", "bad_visibility", "no_party", "no_clan", "bad_coords", "not_owner", "not_found"] as const;
