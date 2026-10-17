import { describe, it, expect } from "vitest";
import {
  World, Transform, defineComponent, defineCommand, CommandRegistry, BinaryWriter, BinaryReader, writeString, readString, stepN,
  GroupRegistry, GroupKind, GroupRole, PlayerId, Membership, OwnedBy, AccessList, AclSubject, ZoneFlag, ClaimRegistry,
  installPermissions, definePermissionActions, can, canAt, zoneAt, addPermissionRule, entityIndex,
  installDamage, DamageApplied, installContainers, scalarFieldsContainer, arrayFieldsContainer, transfer, transaction,
  Scheduler, installScheduler, defineJobQueue, JobQueues, JobState,
  ChannelRegistry, ChannelKind, MuteList, TokenBucket, encodeChatMessage, decodeChatMessage,
  installCommandHandlers, CommandRejected, CommandAccepted,
} from "../src/index.js";

const A = definePermissionActions(["Open", "Build", "Demolish", "Use", "Loot"]);
function player(w: World, id: number, x = 0, y = 0) { const e = w.create(); w.add(e, PlayerId, { id }).add(e, Transform, { x, y }); return e; }

describe("groups", () => {
  it("roles, change log, persistence, mirror", () => {
    const g = new GroupRegistry(); const clan = g.create(GroupKind.Clan, 10); g.addMember(clan.id, 11);
    const party = g.create(GroupKind.Party, 11); g.addMember(party.id, 12);
    expect(g.role(clan.id, 10)).toBe(GroupRole.Leader); expect(g.groupsOf(11).map((x) => x.kind)).toEqual([GroupKind.Clan, GroupKind.Party]);
    expect(g.shareGroup(10, 12)).toBe(false); expect(g.shareGroup(11, 12, GroupKind.Party)).toBe(true);
    const mirror = new GroupRegistry(); for (const c of g.changesSince(0)!) mirror.apply(c);
    expect(mirror.encode()).toEqual(g.encode()); const s = g.seq; g.removeMember(clan.id, 11);
    expect(g.changesSince(s)).toEqual([{ op: "member", seq: s + 1, group: clan.id, player: 11, role: 0 }]);
    const back = GroupRegistry.decode(g.encode()); expect(back.isMember(clan.id, 11)).toBe(false); expect(back.create(1).id).toBe(3);
    const small = new GroupRegistry(2); small.create(1); small.create(1); small.create(1); expect(small.changesSince(0)).toBeUndefined();
  });
});

describe("permissions & claims", () => {
  it("OwnedBy, roles, AccessList, claims, rules, zoneAt", () => {
    const w = new World(); const P = installPermissions(w); P.policy.minRole.set(A.Demolish, GroupRole.Officer);
    const clan = P.groups.create(GroupKind.Clan, 1); P.groups.addMember(clan.id, 2);
    const leader = player(w, 1), member = player(w, 2), stranger = player(w, 3);
    const box = w.create(); w.add(box, Transform, { x: 5, y: 5 }).add(box, OwnedBy, { groupId: clan.id });
    expect(can(w, member, box, A.Open)).toBe(true); expect(can(w, member, box, A.Demolish)).toBe(false); expect(can(w, leader, box, A.Demolish)).toBe(true);
    expect(can(w, stranger, box, A.Open)).toBe(false);
    w.add(box, AccessList); const acl = w.store(AccessList); const s = acl.slot(entityIndex(box));
    acl.data.kind[s * 8] = AclSubject.Player; acl.data.subject[s * 8] = 3; acl.data.allow[s * 8] = A.Open;
    acl.data.kind[s * 8 + 1] = AclSubject.Group; acl.data.subject[s * 8 + 1] = clan.id; acl.data.deny[s * 8 + 1] = A.Loot;
    expect(can(w, stranger, box, A.Open)).toBe(true); expect(can(w, member, box, A.Loot)).toBe(false);
    P.claims.add({ ownerGroup: clan.id, x0: 0, y0: 0, x1: 40, y1: 40, flags: ZoneFlag.Raidable });
    P.claims.add({ ownerGroup: 0, x0: 100, y0: 100, x1: 110, y1: 110, flags: ZoneFlag.Safe });
    const rock = w.create(); w.add(rock, Transform, { x: 35, y: 35 });
    expect(can(w, stranger, rock, A.Build)).toBe(false); expect(can(w, member, rock, A.Build)).toBe(true);
    expect(canAt(w, stranger, 200, 200, A.Build)).toBe(true); expect(canAt(w, stranger, 39, 1, A.Build)).toBe(false);
    expect(zoneAt(w, 105, 105)).toBe(ZoneFlag.Safe); expect(zoneAt(w, 39.9, 39.9)).toBe(ZoneFlag.Raidable); expect(zoneAt(w, 40, 40)).toBe(0);
    const off = addPermissionRule(w, (c) => (c.action === A.Loot && c.claim && c.claim.flags & ZoneFlag.Raidable ? "allow" : undefined)); // raid window
    expect(can(w, stranger, box, A.Loot)).toBe(true); off(); expect(can(w, stranger, box, A.Loot)).toBe(false);
    const c = new ClaimRegistry(); const id = c.add({ ownerGroup: 1, x0: -64, y0: -64, x1: 64, y1: 64, flags: 0 }).id;
    expect(c.claimAt(-1, -1)?.id).toBe(id); c.remove(id); expect(c.claimAt(-1, -1)).toBeUndefined();
  });
});

describe("damage pipeline", () => {
  it("ordered hooks, mitigation clamp, cancel, friendly fire, safe zones", () => {
    const w = new World(); const P = installPermissions(w); const d = installDamage(w); const seen: number[] = [];
    w.events.on(DamageApplied, (e) => seen.push(e.amount));
    d.add("mitigation", "armor", (_w, e) => { e.amount -= 30; }); d.add("pre", "crit", (_w, e) => { e.amount *= 2; }, 1); d.add("pre", "base", (_w, e) => { e.amount += 1; }, 0);
    const a = player(w, 1), b = player(w, 2), zombie = w.create();
    expect(d.hookNames("pre")).toEqual(["base", "crit"]);
    expect(d.apply(w, { source: a, target: b, amount: 20, type: 0 }).amount).toBe(12);
    expect(d.apply(w, { source: zombie, target: b, amount: 5, type: 0 }).amount).toBe(0); // clamped
    const party = P.groups.create(GroupKind.Party, 1); P.groups.addMember(party.id, 2);
    expect(d.canDamage(w, a, b)).toBe(false); d.friendlyFire = true; expect(d.canDamage(w, a, b)).toBe(true); d.friendlyFire = false;
    P.groups.removeMember(party.id, 2); w.add(a, Membership, { clanId: 7 }).add(b, Membership, { clanId: 7 }); expect(d.canDamage(w, a, b)).toBe(false);
    w.set(b, Membership, { clanId: 8 }); P.claims.add({ ownerGroup: 0, x0: -5, y0: -5, x1: 5, y1: 5, flags: ZoneFlag.Safe });
    expect(d.apply(w, { source: a, target: b, amount: 50, type: 0 }).cancelled).toBe(true); expect(d.canDamage(w, zombie, b)).toBe(true);
    d.addCanDamage(() => true); expect(d.canDamage(w, a, b)).toBe(true);
    stepN(w, 1); expect(seen).toEqual([12]);
  });
});

describe("containers & transactions", () => {
  const items = Array.from({ length: 4 }, (_, i) => `item${i}`), counts = items.map((_, i) => `count${i}`);
  const Inv = defineComponent("Inv", Object.fromEntries([...items.map((k) => [k, "u16"]), ...counts.map((k) => [k, "u16"])]) as Record<string, "u16">);
  const Box = defineComponent("Box", { item: { type: "u16", length: 2 }, count: { type: "u16", length: 2 }, meta: { type: "u32", length: 2 } });
  it("transfer merge/swap/limits, validators, all-or-nothing transactions with rollback", () => {
    const w = new World(); w.register(Inv); w.register(Box); const C = installContainers(w, (it) => (it === 9 ? 1 : 10));
    C.register(Inv, scalarFieldsContainer(Inv, { items, counts })); C.register(Box, arrayFieldsContainer(Box, { item: "item", count: "count", meta: "meta" }));
    const p = w.create(); w.add(p, Inv, { item0: 1, count0: 8, item1: 2, count1: 3 }); const b = w.create(); w.add(b, Box);
    expect(transfer(w, p, 0, b, 0, 5)).toEqual({ ok: true }); expect(w.getField(p, Inv, "count0")).toBe(3); expect(w.get(b, Box)!.count[0]).toBe(5);
    expect(transfer(w, p, 0, b, 0, 3)).toEqual({ ok: true }); expect(w.getField(p, Inv, "item0")).toBe(0);
    w.set(p, Inv, { item0: 1, count0: 5 }); expect(transfer(w, p, 0, b, 0, 5)).toEqual({ ok: false, reason: "stack_full" });
    expect(transfer(w, p, 1, b, 0, 1)).toEqual({ ok: false, reason: "occupied" }); expect(transfer(w, p, 1, b, 0, 3)).toEqual({ ok: true }); // swap
    expect(w.getField(p, Inv, "item1")).toBe(1); expect(w.getField(p, Inv, "count1")).toBe(8);
    C.validators.push((_w, op) => (op.to === b && op.actor === p ? "forbidden" : undefined)); expect(transfer(w, p, 0, b, 1, 1, p)).toEqual({ ok: false, reason: "forbidden" }); C.validators.length = 0;
    const before = JSON.stringify([w.get(p, Inv), w.get(b, Box)]);
    const r = transaction(w, (tx) => { const x = tx.remove(p, 1, 13); if (!x.ok) return x; return tx.add(b, 7, 30); }); // craft-like: fails (no space)
    expect(r).toEqual({ ok: false, reason: "no_space" }); expect(JSON.stringify([w.get(p, Inv), w.get(b, Box)])).toBe(before);
    expect(transaction(w, (tx) => { tx.remove(p, 1, 13); return tx.add(p, 7, 12); })).toEqual({ ok: true });
    expect(w.getField(p, Inv, "item0")).toBe(7); expect(() => transaction(w, () => { throw new Error("x"); })).toThrow();
  });
});

describe("scheduler & job queues", () => {
  it("fires in (tick, insertion) order, cancel", () => {
    const w = new World(); const s = new Scheduler(); const log: string[] = [];
    s.at(5, () => log.push("b")); s.at(3, () => log.push("a")); const c = s.at(5, () => log.push("x")); s.at(5, () => log.push("c"));
    s.cancel(c); expect(s.nextTick()).toBe(3); s.run(w, 4); expect(log).toEqual(["a"]); s.run(w, 10); expect(log).toEqual(["a", "b", "c"]); expect(s.size).toBe(0);
  });
  it("timed crafting queue completes by scheduler only; pause/resume/cancel/refund", () => {
    const w = new World(); const sched = installScheduler(w); const Q = defineJobQueue("CraftQueue", 3); w.register(Q);
    const done: number[] = [], refunds: number[] = [];
    const jq = new JobQueues(w, Q, sched, { duration: (_w, _e, r) => r * 10, onComplete: (_w, _e, j) => done.push(j.recipeId), onCancel: (_w, _e, j) => refunds.push(j.recipeId) });
    const e = w.create(); jq.enqueue(e, 1, 2); jq.enqueue(e, 2); jq.enqueue(e, 3); expect(jq.enqueue(e, 4)).toBe(-1);
    expect(jq.jobs(e)[0]).toMatchObject({ recipeId: 1, state: JobState.Running, endTick: 10 });
    stepN(w, 11); expect(done).toEqual([1]); stepN(w, 10); expect(done).toEqual([1, 1]);
    stepN(w, 5); jq.pause(e); stepN(w, 50); expect(done).toEqual([1, 1]); jq.resume(e); stepN(w, 15); expect(done).toEqual([1, 1, 2]);
    expect(jq.cancel(e, 0)).toBe(true); expect(refunds).toEqual([3]); expect(jq.jobs(e)).toEqual([]); expect(sched.size).toBe(0);
  });
});

describe("chat", () => {
  it("string codec, message record, channels, rate limit, mute/block", () => {
    const w = new BinaryWriter(4); writeString(w, "héllo 🌲"); writeString(w, "x".repeat(200)); const r = new BinaryReader(w.finish());
    expect(readString(r)).toBe("héllo 🌲"); expect(readString(r).length).toBe(200); expect(() => writeString(new BinaryWriter(), "abcd", 3)).toThrow();
    const m = { kind: ChannelKind.Party, channel: 1, from: 10, tick: 5, text: "raid at dusk" };
    expect(decodeChatMessage(new BinaryReader(encodeChatMessage(m).finish()))).toEqual(m);
    const g = new GroupRegistry(); const party = g.create(GroupKind.Party, 10); g.addMember(party.id, 11);
    const ch = new ChannelRegistry(g, new MuteList(), { capacity: 2, refillPerTick: 0.1 });
    const online = [{ playerId: 10, x: 0, y: 0 }, { playerId: 11, x: 100, y: 0 }, { playerId: 12, x: 5, y: 0 }];
    expect(ch.recipients(m, online)).toEqual([10, 11]); expect(ch.recipients({ ...m, kind: ChannelKind.Local, channel: 0 }, online)).toEqual([10, 12]);
    expect(ch.recipients({ ...m, kind: ChannelKind.Whisper, channel: 12 }, online)).toEqual([10, 12]);
    ch.mutes.block(12, 10); expect(ch.recipients({ ...m, kind: ChannelKind.Global, channel: 0 }, online)).toEqual([10, 11]);
    expect(ch.validate({ ...m, from: 12 })).toBe("not_member"); expect(ch.validate({ ...m, kind: ChannelKind.System })).toBe("system_only");
    expect(ch.validate(m)).toBeUndefined(); expect(ch.validate(m)).toBeUndefined(); expect(ch.validate(m)).toBe("rate_limited");
    expect(ch.validate({ ...m, tick: 15 })).toBeUndefined(); ch.mutes.mute(10, 100); expect(ch.validate({ ...m, tick: 50 })).toBe("muted");
    expect(MuteList.fromJSON(ch.mutes.toJSON()).isBlocked(12, 10)).toBe(true); expect(new TokenBucket(1, 0).take(0)).toBe(true);
  });
});

describe("command handlers", () => {
  it("permission → validate → handle in deterministic order, rejections as events", () => {
    const w = new World(); const P = installPermissions(w); const reg = new CommandRegistry(); const H = installCommandHandlers(w, reg);
    const Demolish = defineCommand("Demolish", { target: "u32" }); const Say = defineCommand("Say", { n: "u8" });
    const order: number[] = []; const rejected: string[] = []; let accepted = 0;
    H.on(Demolish, { permission: { action: A.Demolish, target: (v) => v.target }, handle: (v, c) => { c.world.destroy(v.target); } });
    H.on(Say, { validate: (v) => (v.n > 3 ? "too_big" : undefined), handle: (v) => order.push(v.n) });
    w.events.on(CommandRejected, (r) => rejected.push(`${r.command}:${r.reason}`)); w.events.on(CommandAccepted, () => accepted++);
    const clan = P.groups.create(GroupKind.Clan, 1); const owner = player(w, 1), thief = player(w, 2);
    const wall = w.create(); w.add(wall, OwnedBy, { groupId: clan.id });
    H.enqueue(thief, 2, 1, reg.make(Demolish, { target: wall })); H.enqueue(owner, 1, 2, reg.make(Say, { n: 2 })); H.enqueue(owner, 1, 1, reg.make(Say, { n: 1 }));
    H.enqueue(owner, 1, 3, reg.make(Say, { n: 9 })); H.enqueue(owner, 1, 4, { type: 99, values: {} });
    stepN(w, 1); expect(order).toEqual([1, 2]); expect(rejected).toEqual(["Say:too_big", "?:unknown_command", "Demolish:forbidden"]);
    H.enqueue(owner, 1, 5, reg.make(Demolish, { target: wall })); stepN(w, 1); expect(w.isAlive(wall)).toBe(false); expect(accepted).toBe(3);
    w.simulate(1, 0.05); expect(H.queued).toBe(0);
  });
});
