# AI agents (human bots)

Human bots are **virtual players**: real sessions that only send input. They exist in singleplayer only (ADR-090/091).

## Core (`@engine/core`, src/ai.ts)
- `AgentController({ behaviors, chat?, thinkBudget, thinkEvery, tickHz })`
  - `tick(tick, agent => { self, world }) → Map<Agent, AgentOutput>`
  - `thinksLastTick` reports the budget actually used.
- `AgentOutput { moveX, moveY, aimX, aimY, sprint, actions[], chat?, emote? }` is the only thing an agent produces.
- `BehaviorRegistry.register({ name, considerations: [{ name, input(ctx), curve, weight? }], traits?, scheduleBonus?, inertia?, chatOnStart?, run(ctx, out) })`
  - Utility is the compensated product of the curves, multiplied by the trait factor, plus the schedule bonus and inertia.
- Curves: `linear`, `quadratic`, `logistic`, `inverse`, `step`.
- `Traits`: bravery, sociability, greed, industriousness, chattiness.
- `PerceptionConfig`, `canSee` and `AgentMemory` (see, hear, decay, nearest), plus `Blackboard`.
- Schedules use `ScheduleSlot { from, to, prefer[] }` with day fraction t. Goals use `Goal`.
- `Imperfections`: reaction ticks, aim error, input jitter, idle pauses, look-around, path wobble.
- Chat: `ChatProvider.line(situation, vars, agent)`. `ChatTemplates` is the default. Plug in an LLM by implementing `ChatProvider`; the engine never calls out. Chat is rate-limited (`chatMinSeconds`) and gated by chattiness.
- `AgentIdentity { id, name, appearance?, relationship, traits, archetype, goals }` is persisted by local.ts in record namespace `agents`.

## Gameplay (`@engine/gameplay`, src/agents.ts + data/agents.json)
- `referenceBehaviors()`: flee, gather, explore, return_home, rest, greet.
- `survivorController({ seed, thinkBudget?, thinkEvery?, extra?: BehaviorDef[], chat? })`
- `makeAgentIdentity(seed, slot)`, `makeAgent(identity, seed, tickHz)`
- `buildAgentView(clientWorld, self, agent, home)` perceives from the bot's own replicated client world.
- Archetypes, schedules, names and chat lines are in `data/agents.json`.

## Adding behaviors (Survival)
Pass `extra` behaviors that emit actions. local.ts currently maps `gather` to `Act.Gather`. New actions need a mapping in local.ts's `sample()`, or a command sent through `client.sendCommand`.
