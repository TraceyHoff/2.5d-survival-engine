import { describe, expect, it } from "vitest";
import { CommandRegistry, InputState, defineComponent, Owner, Transform, inputFrameFromBytes, inputFrameToBytes, type Entity, type World } from "@engine/core";
import { BitReader } from "../src/bits.js";
import { AimModeWire, LoopbackNetwork, NetClient, NetServer, decodeInput, encodeInput, quantizeInput, readHeader, type InputCmd } from "../src/index.js";
import { DT, SPEED, frames, join, makeWorld } from "./fixture.js";

/** Local analog control written by applyInput, consumed by a predicted simulation system (as gameplay movement would). */
const Analog = defineComponent("AnalogCtl", { mx: "f32", my: "f32" });
const mkWorld = (): World => {
  const w = makeWorld(); w.register(Analog);
  w.addSystem("simulation", "analog", (world, dt) => {
    for (const e of world.query([Analog, Transform])) { const a = world.get(e, Analog)!; if (a.mx || a.my) world.set(e, Transform, { x: world.getField(e, Transform, "x")! + a.mx * SPEED * dt, y: world.getField(e, Transform, "y")! + a.my * SPEED * dt }); }
  });
  return w;
};
const rt = (m: Parameters<typeof encodeInput>[0]) => { const r = new BitReader(encodeInput(m)); readHeader(r); return decodeInput(r); };

describe("InputCmd v2 wire", () => {
  it("round-trips v2 fields with exactly core's q8 quantization; v1-shaped cmds stay v1-shaped", () => {
    const reg = new CommandRegistry();
    const vals = [-1.5, -1, -0.999, -0.5, -0.3333, -0.004, 0, 0.004, 0.1, 0.37, 0.5, 0.75, 0.9961, 1, 2];
    const cmds: InputCmd[] = vals.map((v, i) => ({ seq: 100 + i, buttons: 0x80000001 + i, aimX: v * 10, aimY: -v, moveX: v, moveY: -v * 0.5, ghostNudgeX: v * 0.25, ghostNudgeY: v, aimMode: i % 2 ? AimModeWire.WorldPoint : AimModeWire.Direction }));
    const d = rt({ ackTick: 5, viewTick: 4, cmds });
    d.cmds.forEach((c, i) => {
      const src = cmds[i]!;
      const core = inputFrameFromBytes(inputFrameToBytes({ tick: 0, actions: src.buttons, aimX: src.aimX, aimY: src.aimY, commands: [], moveX: src.moveX!, moveY: src.moveY!, ghostNudgeX: src.ghostNudgeX!, ghostNudgeY: src.ghostNudgeY!, ...(src.aimMode ? { aimMode: 1 } : {}) }, reg), reg);
      expect(c.seq).toBe(src.seq); expect(c.buttons).toBe(core.actions);
      expect([c.moveX, c.moveY, c.ghostNudgeX, c.ghostNudgeY]).toEqual([core.moveX, core.moveY, core.ghostNudgeX, core.ghostNudgeY]);
      expect(c.aimX).toBe(core.aimX); expect(c.aimMode ?? 0).toBe(core.aimMode ?? 0);
      // client-side quantization == what the server decodes (prediction uses the same numbers)
      const q = quantizeInput(src); expect([q.moveX, q.moveY, q.ghostNudgeX, q.ghostNudgeY]).toEqual([c.moveX, c.moveY, c.ghostNudgeX, c.ghostNudgeY]);
    });
    const v1 = rt({ ackTick: 1, cmds: [{ seq: 7, buttons: 3, aimX: 1, aimY: 2 }] }).cmds[0]!;
    expect(v1).toEqual({ seq: 7, buttons: 3, aimX: 1, aimY: 2 });
    // edges never ride in cmds, only in records (old seqs allowed, before the window)
    const e = rt({ ackTick: 1, cmds: [{ seq: 50, buttons: 0, aimX: 0, aimY: 0, edges: 9 }], edges: [{ seq: 31, edges: 4 }, { seq: 50, edges: 9 }] });
    expect(e.cmds[0]!.edges).toBeUndefined(); expect(e.edges).toEqual([{ seq: 31, edges: 4 }, { seq: 50, edges: 9 }]);
    expect(rt({ ackTick: 1, cmds: [], edges: [{ seq: 12, edges: 1 }] }).edges).toEqual([{ seq: 12, edges: 1 }]);
  });
});

async function rig(o: { loss: number; redundancy?: number; latencyMs?: number; analog?: boolean }) {
  const net = new LoopbackNetwork(23); const sw = mkWorld(); const serverEdges: { seq: number; edges: number }[] = [];
  const move = (w: World, e: Entity, c: InputCmd | null) => { if (!w.has(e, Analog)) w.add(e, Analog); w.set(e, Analog, { mx: c?.moveX ?? 0, my: c?.moveY ?? 0 }); };
  const server = new NetServer({ world: sw, transport: net.createServer(), interest: false,
    applyInput: (w, e, c) => { if (c?.edges) serverEdges.push({ seq: c.seq, edges: c.edges }); move(w, e, c); },
    onClientJoin: (s, w) => { const e = w.create(); w.add(e, Transform, { x: 10, y: 10 }).add(e, Owner, { clientId: s.clientId }); } });
  const cw = mkWorld();
  const A = new NetClient({ world: cw, transport: net.createClient({ latencyMs: o.latencyMs ?? 60, jitterMs: 10, loss: o.loss }), inputRedundancy: o.redundancy ?? 8, applyInput: (w, e, c) => move(w, e, c) });
  await join(net, A);
  const step = (k = 1) => frames(net, [sw, cw], k);
  step(5); A.stats.maxCorrection = 0; // ignore the spawn snap
  const serverPos = () => { const e = [...sw.query([Owner, Transform])][0]!; return sw.get(e, Transform)!; };
  const clientPos = () => { const e = [...cw.query([Transform])].find((x) => cw.predicted.has(x))!; return cw.get(e, Transform)!; };
  return { net, sw, server, A, step, serverEdges, serverPos, clientPos };
}

describe("edges: exactly once under loss", () => {
  for (const [name, loss, redundancy] of [["10% loss, window 8", 0.1, 8], ["30% loss, window 2 (pulses slide out of the window)", 0.3, 2]] as const) {
    it(name, async () => {
      const x = await rig({ loss, redundancy });
      const input = new InputState(); let fired = 0; let fedTwice = 0;
      for (let t = 0; t < 600; t++) {
        input.setActions(t & 4 ? 1 : 0);
        if (t % 3 === 0) { input.pulse(1 << (t % 8)); fired++; }
        x.A.feedInput(input.sample(t));
        if (t % 50 === 7) { input.pulse(1 << 20); x.A.feedInput(input.sample(t)); fedTwice++; fired++; } // two feeds in one tick: edges OR'd, not lost
        x.step(1);
      }
      for (let t = 0; t < 40; t++) { x.A.feedInput(input.sample(600 + t)); x.step(1); }
      const bits = x.serverEdges.reduce((n, e) => { let v = e.edges, k = 0; while (v) { k += v & 1; v >>>= 1; } return n + k; }, 0);
      expect(bits).toBe(fired); // every pulse applied, none twice
      expect(new Set(x.serverEdges.map((e) => e.seq)).size).toBe(x.serverEdges.length); // one application per seq
      expect(fedTwice).toBe(12);
      if (redundancy === 2) expect(x.server.sessions.get(1)!.stats.lateEdges).toBeGreaterThan(0);
    });
  }
});

describe("analog movement prediction + reconciliation", () => {
  it("predicts with the quantized analog vector; zero correction without loss, converges exactly under 10% loss", async () => {
    for (const loss of [0, 0.1]) {
      const x = await rig({ loss, latencyMs: 100 });
      const input = new InputState(); input.moveX = 0.37; input.moveY = -0.6;
      for (let t = 0; t < 80; t++) { x.A.feedInput(input.sample(t)); x.step(1); }
      input.moveX = 0; input.moveY = 0;
      for (let t = 0; t < 40; t++) { x.A.feedInput(input.sample(80 + t)); x.step(1); }
      const s = x.serverPos(), c = x.clientPos();
      expect(Math.abs(c.x - s.x)).toBeLessThan(1e-4); expect(Math.abs(c.y - s.y)).toBeLessThan(1e-4);
      const stepX = Math.fround((Math.round(0.37 * 127) / 127)) * SPEED * DT; const k = (s.x - 10) / stepX;
      expect(Math.abs(k - Math.round(k))).toBeLessThan(2e-2); // server applied the q8 value, a whole number of ticks
      expect(Math.round(k)).toBeGreaterThan(60);
      if (loss === 0) expect(x.A.stats.maxCorrection).toBeLessThan(1e-4);
    }
  });
});
