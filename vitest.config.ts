import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts"],
    // These live-world suites run thousands of sim ticks; give each its own forked process so a busy worker can't miss vitest RPC deadlines.
    poolMatchGlobs: [["apps/server/test/spawn_world.test.ts", "forks"], ["apps/client/test/adr252_ai_humans_live.test.ts", "forks"]],
    teardownTimeout: 60_000,
  },
});
