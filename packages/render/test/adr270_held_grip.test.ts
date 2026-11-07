import { describe, expect, it } from "vitest";
import { AssetRegistry, loadManifest, mergeManifests } from "@engine/assets";
import { PACK_DIR, readManifestJson } from "@engine/assets/node";
import { AtlasManager, newResolved, type ResolvedFrame } from "../src/assets/atlasManager.js";
import { SpriteBatch } from "../src/sprites.js";

const manifest = mergeManifests(["manifest.json", "items/manifest.items.json", "customization/manifest.customization.json"].map((p) => ({ name: p, manifest: readManifestJson(PACK_DIR + p) })) as never).manifest;
const reg = loadManifest(manifest).registry;
function resolved(id: number, anim: string, facing: number, time: number): ResolvedFrame {
  const ref = reg.dirFrame(id, anim, facing, time); const a = reg.byKey(reg.sprite(id).key).animations.get(anim)!;
  const i = Math.min(a.frames.length - 1, Math.floor(time * a.fps));
  return { ...newResolved(), sprite: id, anim, frame: ref.frame, dfi: a.dirFrames ? i * a.directions + AssetRegistry.directionIndex(facing, a.directions) : -1, w: ref.w, h: ref.h, ax: ref.anchorX, ay: ref.anchorY };
}

describe("ADR-270: shared player/AI handheld grip", () => {
  it("every shipped held/offhand frame has a data-driven grip, including every torch fire frame", () => {
    let count = 0;
    for (const s of reg.allSprites()) if (/^(held_|offhand_)/.test(s.key)) {
      count++;
      for (const a of s.animList) for (let f = 0; f < a.directions; f++) for (let i = 0; i < a.frames.length; i++) {
        const ref = reg.dirFrame(s.id, a.name, f * Math.PI / 4, (i + .01) / a.fps);
        expect(ref.anchors?.grip, `${s.key}/${f}/${i}`).toBeDefined();
      }
    }
    expect(count).toBeGreaterThan(70);
    const torch = reg.frame(reg.id("held_torch"), "idle", 0, 0);
    expect(AssetRegistry.anchorPoint(torch, "grip")).toMatchObject({ x: -3, y: -5 });
  });
  it("emitHeld puts the visible grip at each animated hand in all facings and flips, rather than the old packing pivot", () => {
    const am = Object.create(AtlasManager.prototype) as AtlasManager;
    Object.assign(am, { registry: reg, handByEntry: new Map(), fireAnim: () => -1, isCrisp: () => false });
    // Exercise the real emitHeld + real handOf with CPU-only resolve/write stubs (no GL required).
    const renderer = Object.create(SpriteBatch.prototype) as any;
    Object.assign(renderer, { heldRes: newResolved(), heldStats: [0, 0, 0], offHandStats: [0, 0, 0, 0], pushOcc: () => {} });
    let written: { x: number; y: number; ax: number; ay: number; data: Float32Array };
    renderer.writeOne = (x: number, y: number, _k: number, _s: number, r: ResolvedFrame) => { const data = new Float32Array(40); written = { x, y, ax: r.ax, ay: r.ay, data }; return data; };
    for (const bodyKey of ["body_male", "body_female"]) for (const anim of ["idle", "walk", "run"]) {
      const id = reg.id(bodyKey); if (!reg.sprite(id).animations.has(anim)) continue;
      for (let f = 0; f < 8; f++) for (const time of [0, .26]) for (const flip of [false, true]) for (const off of [false, true]) {
        const facing = f * Math.PI / 4; const body = resolved(id, anim, facing, time);
        const h = am.handOf(body, off ? "handL" : "handR")!; expect(h).toBeDefined();
        for (const tool of ["held_torch", "held_lantern", "held_tallow_candle", "held_stone_axe", "held_stone_shovel", "held_iron_sword", "held_short_bow", "held_revolver", "offhand_stone_knife"]) {
          const hid = reg.id(tool); const item = resolved(hid, "idle", facing, 0); const grip = am.handOf(item, "grip")!;
          am.resolve = ((_id: number, _a: number, _f: number, _t: number, _frame: number, out: ResolvedFrame) => { Object.assign(out, item); return true; }) as typeof am.resolve;
          renderer.emitHeld(am, () => hid, 1, body, 100, 200, 1, 2, facing, flip, 1, 0, "fade", 0, off);
          expect(written!.ax).toBeCloseTo(grip.x, 5); expect(written!.ay).toBeCloseTo(grip.y, 5);
          expect(written!.x).toBeCloseTo(100 + (h.x - body.ax) * 2 * (flip ? -1 : 1), 5);
          expect(written!.y).toBeCloseTo(200 + (h.y - body.ay) * 2, 5);
          expect(written!.data[32]).toBeCloseTo(h.angle * Math.PI / 180 * (flip ? -1 : 1), 5);
        }
      }
    }
  });
});
