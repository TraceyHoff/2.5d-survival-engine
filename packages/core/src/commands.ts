import { defineEvent } from "./events.js";
import type { Entity } from "./entity.js";
import type { Command, CommandDef, CommandRegistry } from "./input.js";
import type { Schema, SchemaValues } from "./schema.js";
import { defineResource, type World } from "./world.js";
import { can } from "./permissions.js";

/**
 * Server-authoritative command validation. Net (or the server app) enqueues commands decoded from InputFrames;
 * the input-phase system "commands" processes them in deterministic order (tick, actor entity, arrival seq),
 * runs permission check → validator → handler, and emits CommandRejected with a reason string on failure.
 */
export interface CommandContext { world: World; actor: Entity; clientId: number; seq: number }
export interface CommandSpec<S extends Schema> {
  /** Optional permission: action mask + resolver for the target entity from the payload. */
  permission?: { action: number; target: (values: SchemaValues<S>, ctx: CommandContext) => Entity | undefined };
  /** Return a reason to reject. */
  validate?: (values: SchemaValues<S>, ctx: CommandContext) => string | undefined;
  handle: (values: SchemaValues<S>, ctx: CommandContext) => void;
}
export interface CommandRejection { actor: Entity; clientId: number; seq: number; type: number; command: string; reason: string }
export const CommandRejected = defineEvent<CommandRejection>("core.CommandRejected");
export const CommandAccepted = defineEvent<{ actor: Entity; clientId: number; seq: number; type: number }>("core.CommandAccepted");

export class CommandHandlers {
  private specs = new Map<number, { def: CommandDef; spec: CommandSpec<Schema> }>();
  private pending: { actor: Entity; clientId: number; seq: number; cmd: Command; n: number }[] = [];
  private arrival = 0;
  constructor(readonly registry: CommandRegistry) {}
  on<S extends Schema>(def: CommandDef<S>, spec: CommandSpec<S>): void {
    const id = this.registry.register(def); if (this.specs.has(id)) throw new Error(`handler exists for ${def.name}`);
    this.specs.set(id, { def, spec: spec as unknown as CommandSpec<Schema> });
  }
  enqueue(actor: Entity, clientId: number, seq: number, cmd: Command): void { this.pending.push({ actor, clientId, seq, cmd, n: this.arrival++ }); }
  get queued(): number { return this.pending.length; }
  /** Process all queued commands (called by the "commands" system). */
  process(world: World): void {
    const q = this.pending.sort((a, b) => a.actor - b.actor || a.seq - b.seq || a.n - b.n); this.pending = [];
    for (const p of q) {
      const reject = (reason: string, name = "?") => world.events.emit(CommandRejected, { actor: p.actor, clientId: p.clientId, seq: p.seq, type: p.cmd.type, command: name, reason });
      const h = this.specs.get(p.cmd.type); if (!h) { reject("unknown_command"); continue; }
      if (!world.isAlive(p.actor)) { reject("no_actor", h.def.name); continue; }
      const ctx: CommandContext = { world, actor: p.actor, clientId: p.clientId, seq: p.seq };
      const v = p.cmd.values as SchemaValues<Schema>;
      try {
        if (h.spec.permission) { const t = h.spec.permission.target(v, ctx); if (t === undefined || !world.isAlive(t)) { reject("no_target", h.def.name); continue; } if (!can(world, p.actor, t, h.spec.permission.action)) { reject("forbidden", h.def.name); continue; } }
        const r = h.spec.validate?.(v, ctx); if (r) { reject(r, h.def.name); continue; }
        h.spec.handle(v, ctx); world.events.emit(CommandAccepted, { actor: p.actor, clientId: p.clientId, seq: p.seq, type: p.cmd.type });
      } catch (err) { reject(`error:${(err as Error).message}`, h.def.name); }
    }
  }
}
export const CommandHandlersRes = defineResource<CommandHandlers>("CommandHandlers");
/** Server only: installs the handler registry and input-phase system "commands" (skipped during replay). */
export function installCommandHandlers(world: World, registry: CommandRegistry): CommandHandlers {
  const h = new CommandHandlers(registry); world.setResource(CommandHandlersRes, h);
  world.addSystem("input", "commands", (w) => { if (!w.isReplaying) h.process(w); }); return h;
}
