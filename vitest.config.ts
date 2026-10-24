import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts"],
    // spawn_world runs thousands of sim ticks; give it its own forked process so a busy worker can't miss vitest RPC deadlines.
    poolMatchGlobs: [["apps/server/test/spawn_world.test.ts", "forks"]],
    teardownTimeout: 60_000,
  },
});
