# @engine/render

WebGL2 2.5D isometric renderer for the engine (see `docs/` in this package once the tileset spec lands).
`render(world, alpha)` is **read-only** on the `@engine/core` World and interpolates `PrevTransform → Transform`.

Run the standalone demo: `pnpm --filter @engine/render dev` · screenshots: `pnpm --filter @engine/render build && pnpm --filter @engine/render shots`

(Full architecture notes are added in the follow-up commit.)
