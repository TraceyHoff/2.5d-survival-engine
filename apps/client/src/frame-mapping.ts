/**
 * ADR-180: the client's InputSystem -> InputFrame mapping. Hold bits are the demo protocol's `Act`; edge pulses use the
 * sim's GameplayEdgeBits for EVERY edge action (bits must match: the server decodes them with GameplayEdgeBits and
 * turns the sim ones into commands via edgeCommands). Before ADR-180 there were no edgeBits, so Reload / Hotbar1..8
 * never reached the server.
 */
import type { FrameMapping } from "@engine/input";
import { GAMEPLAY_EDGES, GameplayEdgeBits, SIM_EDGE_ACTIONS } from "@engine/gameplay";
import { Act } from "@engine/server/protocol";

export const CLIENT_FRAME_MAPPING: FrameMapping = {
  holdBits: { Sprint: Act.Sprint, Interact: Act.Gather, Primary: Act.Gather, Secondary: Act.Guard, Crouch: Act.Crouch }, // ADR-244 Guard / Crouch
  edgeBits: Object.fromEntries(GAMEPLAY_EDGES.map((a) => [a, GameplayEdgeBits[a]])),
  move: { action: "Move", up: Act.MoveUp, down: Act.MoveDown, left: Act.MoveLeft, right: Act.MoveRight },
};
/** Edges with a sim effect; the client strips these outside plain gameplay (menus, build mode, world tools, death) where the D-pad / R mean something else. */
export const SIM_EDGE_MASK = SIM_EDGE_ACTIONS.reduce((m, a) => (m | GameplayEdgeBits[a]) >>> 0, 0);
/** Frame edges to send: all of them in gameplay, else the sim ones removed. */
export const gateEdges = (edges: number | undefined, gameplay: boolean): number | undefined => {
  if (edges === undefined || gameplay) return edges; const r = (edges & ~SIM_EDGE_MASK) >>> 0; return r || undefined;
};
