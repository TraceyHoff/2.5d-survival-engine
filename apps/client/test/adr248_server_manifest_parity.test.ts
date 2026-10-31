// ADR-248: the dedicated server's merged manifest is the client's: same fragments, same cosmetics catalog and hash.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { cosmeticsHashes } from "@engine/core";
import { loadMergedManifestWith, servedManifestIndex } from "@engine/assets";
import { loadMergedPackManifest } from "@engine/assets/node";
import { artFile, artServed } from "../vite.config.js";

const ART = "http://client.test/art/";
/** The client's fetch, replayed against what the dev server serves (vite.config MOUNTS + manifests.index.json). */
const clientGet = async (url: string): Promise<unknown> => {
  if (!url.startsWith(ART)) return undefined;
  const rel = decodeURIComponent(url.slice(ART.length));
  if (rel === "manifests.index.json") return servedManifestIndex(artServed);
  const f = artFile(rel); return f ? JSON.parse(readFileSync(f, "utf8")) : undefined;
};

describe("ADR-248 server/client manifest parity", () => {
  it("the server's merged manifest has the client's cosmetics (18 skin tones, same wearables, same hash)", async () => {
    const idx = await clientGet(ART + "manifests.index.json") as ReturnType<typeof servedManifestIndex>;
    const client = await loadMergedManifestWith(idx.fragments, { get: clientGet, artUrl: ART });
    const server = await loadMergedPackManifest();
    const c = client.result.registry.cosmetics!, s = server.result.registry.cosmetics!;
    expect(s).toBeDefined(); expect(c).toBeDefined();
    expect(server.fragments).toEqual(client.fragments);
    expect(server.fragments).toContain("customization");
    expect(s.skinTones.length).toBe(18);
    expect(s.size).toBe(c.size);
    expect(s.skinTones.map((t) => t.key)).toEqual(c.skinTones.map((t) => t.key));
    expect(cosmeticsHashes(s)).toEqual(cosmeticsHashes(c));
    expect(server.result.registry.hash).toBe(client.result.registry.hash);
  });
});
