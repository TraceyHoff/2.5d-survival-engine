// ADR-119/120 client view: road autotile key + Flat flag, sign facing frame, road/sign item icons resolve.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { animFrameId, SpriteFlag } from "@engine/render";
import { iconForItem, gameplayDefs, installGameplay } from "@engine/gameplay";
import { World } from "@engine/core";
import { roadSpriteKeys, ROAD_FLAGS, signFrameId } from "../src/road-sign-view.js";
import { iconKeysFromCss } from "../src/gameplay-panels.js";

describe("road view", () => {
  it("picks road_<surface>_m<mask>, then the plain surface tile", () => {
    expect(roadSpriteKeys("gravel", 5)).toEqual(["road_gravel_m5", "road_gravel"]);
    expect(roadSpriteKeys(undefined, 0)).toEqual(["road_path_m0", "road_path"]);
    expect(roadSpriteKeys("paved", 31)[0]).toBe("road_paved_m15");
  });
  it("roads are Flat ground decals", () => { expect(ROAD_FLAGS & SpriteFlag.Flat).toBe(SpriteFlag.Flat); });
});

describe("sign view", () => {
  const names = ["idle", "idle_r1", "idle_r2", "idle_r3"];
  it("Sign.rot selects idle / idle_r<rot>", () => {
    expect([0, 1, 2, 3].map((r) => signFrameId(names, r))).toEqual([0, 1, 2, 3].map(animFrameId));
  });
  it("falls back to idle when the art lacks the facing", () => { expect(signFrameId(["idle"], 2)).toBe(animFrameId(0)); });
});

describe("road/sign item icons", () => {
  it("gravel, cement, asphalt and every sign item resolve to real icon art", () => {
    const icons = iconKeysFromCss([readFileSync("apps/client/src/gameplay-panels.css", "utf8")]); const has = (k: string) => icons.has(k);
    const w = new World({ seed: 1, maxEntities: 1 << 12 }); installGameplay(w, {}); const d = gameplayDefs(w);
    const want: Record<string, string> = { gravel: "gravel", cement: "cement", asphalt: "asphalt" };
    for (const s of ["wooden_post", "hanging", "wall_plaque", "billboard", "metal_road", "arrow"]) want[`sign_${s}`] = `icon_sign_${s}`;
    for (const [item, icon] of Object.entries(want)) {
      const it = [...d.items.values()].find((x) => x.key === item); expect(it, item).toBeDefined();
      expect(iconForItem(it!, has)).toBe(icon);
    }
  });
});
