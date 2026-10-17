/**
 * Multi-client simulation harness: in-process authoritative server + N fake clients over Netcode's loopback
 * transport, all driven by one fake clock (deterministic, no wall time). Re-exports core's headless helpers.
 */
import { DEFAULT_TICK_HZ, FakeClock, type Entity, type World } from "@engine/core";
import { LoopbackNetwork, NetClient, NetServer, type InputCmd, type ClientSession } from "@engine/net";
export { createTestWorld, stepN, FakeClock, TEST_SEED } from "@engine/core";

export type ApplyInput = (world: World, entity: Entity, cmd: InputCmd | null) => void;
export interface LinkConditions { latencyMs?: number; jitterMs?: number; loss?: number }
export interface HarnessOptions {
  clients: number;
  /** Builds a world; called once for the server and once per client (must register identical components). */
  makeWorld: (role: "server" | "client", index: number) => World;
  applyInput?: ApplyInput;
  /** Spawn the player entity for a joining client (server side). */
  onClientJoin?: (session: ClientSession, world: World) => void;
  link?: LinkConditions;
  tickHz?: number;
  seed?: number;
}
export interface FakeClient { index: number; world: World; client: NetClient; input: { buttons: number; aimX: number; aimY: number } }
export interface Harness {
  net: LoopbackNetwork; server: NetServer; serverWorld: World; clients: FakeClient[]; clock: FakeClock;
  /** Advance one fixed tick: deliver network for dt, step server, step every client. */
  tick(n?: number): void;
  readonly dtMs: number;
}

/** Creates the server, connects every client (completing handshakes), and returns the harness. */
export async function createHarness(opts: HarnessOptions): Promise<Harness> {
  const tickHz = opts.tickHz ?? DEFAULT_TICK_HZ; const dtMs = 1000 / tickHz; const dt = 1 / tickHz;
  const net = new LoopbackNetwork(opts.seed ?? 1234); const clock = new FakeClock();
  const serverWorld = opts.makeWorld("server", 0);
  const server = new NetServer({
    world: serverWorld, transport: net.createServer(), tickHz,
    ...(opts.applyInput ? { applyInput: (w: World, e: Entity, cmd: InputCmd | null) => opts.applyInput!(w, e, cmd) } : {}),
    ...(opts.onClientJoin ? { onClientJoin: opts.onClientJoin } : {}),
  });
  const clients: FakeClient[] = [];
  for (let i = 0; i < opts.clients; i++) {
    const world = opts.makeWorld("client", i + 1); const input = { buttons: 0, aimX: 0, aimY: 0 };
    const client = new NetClient({
      world, transport: net.createClient(opts.link ?? {}), sampleInput: () => ({ ...input }),
      ...(opts.applyInput ? { applyInput: opts.applyInput } : {}),
    });
    const p = client.connect(); p.catch(() => undefined);
    await new Promise((r) => setTimeout(r, 0));
    net.advance(250 + 2 * (opts.link?.latencyMs ?? 0) + (opts.link?.jitterMs ?? 0)); clock.advance(0);
    await p;
    clients.push({ index: i, world, client, input });
  }
  return {
    net, server, serverWorld, clients, clock, dtMs,
    tick(n = 1) {
      for (let k = 0; k < n; k++) {
        clock.advance(dtMs); net.advance(dtMs);
        serverWorld.step(dt); for (const c of clients) c.world.step(dt);
      }
    },
  };
}
