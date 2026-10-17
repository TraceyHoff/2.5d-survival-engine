# engine
2.5D isometric co-op survival engine. `pnpm install && pnpm test && pnpm -r build`. Client: `pnpm --filter @engine/client dev`. Server: `pnpm --filter @engine/server start`. Docs in `docs/`.

## How to test multiplayer

```sh
pnpm install
pnpm demo                 # server (ws://localhost:7777, save ./saves/demo.db) + Vite client; prints two client URLs
pnpm demo --bots 5        # ...plus 5 headless bot players (wander + gather)
pnpm demo --fresh         # start a new world (deletes ./saves/demo.db)
pnpm demo:bots            # headless load run: fresh server + 20 bots, prints ms/tick, bytes/client/s, clients every 3 s
pnpm demo:bots --bots 50 --duration 60
pnpm test:net             # net + testkit + server/client multiplayer integration tests
pnpm bench                # benchmarks with strict timing ceilings (PERF=1)
```

- Open both printed URLs (`?player=1` and `?player=2` keep separate saved players on one browser). Use the overlay
  (top-left) to connect: server URL, name, Connect; it shows status and RTT. WASD moves, Shift sprints, E gathers.
- Reload a tab: it reconnects as the same player (account token in `localStorage`). Stop with Ctrl-C (the server does
  a full save), run `pnpm demo` again: players come back where they were, world edits persist.
- Options: `--port` (or `PORT`), `--client-port`, `--save <file>`, `--duration <s>`, `--open`. Server alone:
  `pnpm --filter @engine/server start -- --save saves/demo.db [--fresh]`; bots alone: `pnpm --filter @engine/server bots -- --url ws://127.0.0.1:7777 --count 5`.
- Server stats line: `rate` (ticks/s, target 20), `ms/tick avg/p99/max`, `clients`, `bytes/client/s`, and persistence
  (`dirty` chunks, autosave `rounds`, `maxPersistMs` = worst per-tick persistence cost). Persistence design: `packages/persist/README.md`.
