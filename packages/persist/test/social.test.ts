import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BinaryWriter, ClaimRegistry, GroupRegistry, Membership, Owner, OwnedBy, AccessList, PlayerId, Permissions, Transform, can, definePermissionActions, installPermissions, type World } from "@engine/core";
import { CLAIMS_BLOB, GROUPS_BLOB, MemoryWorldStore, SocialCodecError, decodeClaims, encodeClaims, loadSocial } from "../src/index.js";
import { SqliteWorldStore } from "../src/node.js";
import { makeWorld, step } from "./helpers.js";

const PARTY = 1, CLAN = 2, MEMBER = 1, OFFICER = 2, LEADER = 3;
const RAIDABLE = 1, NO_BUILD = 8, ACL_PLAYER = 1, ACL_GROUP = 2;
const Act = definePermissionActions(["Open", "Build", "Demolish"]);
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe("social persistence (groups, claims, privileges)", () => {
  it("claims codec round-trips every field, defaultFlags and nextId; rejects foreign bytes", () => {
    const reg = new ClaimRegistry(); reg.defaultFlags = RAIDABLE;
    reg.add({ ownerGroup: 7, x0: 0, y0: 0, x1: 31.5, y1: 40, flags: NO_BUILD, priority: -3 });
    const gone = reg.add({ ownerGroup: 8, x0: 100, y0: 100, x1: 110, y1: 110, flags: 0 });
    reg.add({ id: 40, ownerGroup: 9, x0: -64, y0: -64, x1: -1, y1: -1, flags: RAIDABLE | NO_BUILD, priority: 5 });
    reg.remove(40); reg.add({ id: 12, ownerGroup: 9, x0: -64, y0: -64, x1: -1, y1: -1, flags: RAIDABLE, priority: 5 }); reg.remove(gone.id);
    const back = decodeClaims(encodeClaims(reg));
    expect(back.all()).toEqual(reg.all()); expect(back.defaultFlags).toBe(RAIDABLE);
    expect(back.zoneAt(10, 10)).toBe(NO_BUILD); expect(back.claimAt(-10, -10)?.ownerGroup).toBe(9);
    expect(back.add({ ownerGroup: 1, x0: 0, y0: 0, x1: 1, y1: 1, flags: 0 }).id).toBe(41); // removed ids are not reused
    expect(encodeClaims(decodeClaims(encodeClaims(reg)))).toEqual(encodeClaims(reg)); // stable bytes
    expect(() => decodeClaims(new Uint8Array(20))).toThrow(SocialCodecError);
  });

  it("clans (with banners), parties, membership, a claim and building privileges survive a server restart", async () => {
    const d = mkdtempSync(join(tmpdir(), "persist-social-")); dirs.push(d); const path = join(d, "w.db");
    const setup = (social: ReturnType<typeof loadSocial>) => (w: World) => { installPermissions(w, social); };
    // ---- run 1
    const s1 = await SqliteWorldStore.open(path);
    const social1 = loadSocial(s1); expect(social1.groups.all()).toEqual([]);
    const a = makeWorld(s1, { social: social1, setup: setup(social1) });
    a.chunks.setSource({ id: 1, x: 5, y: 5 }); step(a.world);
    const alice = a.persist.allocatePlayerId(), bob = a.persist.allocatePlayerId(), eve = a.persist.allocatePlayerId();
    const clan = a.world.resource(Permissions).groups.create(CLAN, alice);
    const g = a.world.resource(Permissions).groups;
    g.addMember(clan.id, bob, OFFICER);
    g.setBanner(clan.id, { shape: 3, pattern: 1, colors: [0xff2200ff, 0x00112233], emblemId: 517 });
    const party = g.create(PARTY, bob); g.addMember(party.id, eve);
    const claim = a.world.resource(Permissions).claims.add({ ownerGroup: clan.id, x0: 0, y0: 0, x1: 32, y1: 32, flags: RAIDABLE | NO_BUILD, priority: 2 });
    // a cupboard-like privilege entity in chunk 0,0: owned by the clan, plus a personal ACL grant for eve
    const box = a.world.create();
    a.world.add(box, Transform, { x: 5, y: 6 }).add(box, OwnedBy, { playerId: alice, groupId: clan.id })
      .add(box, AccessList, { kind: [ACL_PLAYER, ACL_GROUP, 0, 0, 0, 0, 0, 0], subject: [eve, party.id, 0, 0, 0, 0, 0, 0], allow: [Act.Open, Act.Open | Act.Build, 0, 0, 0, 0, 0, 0], deny: [Act.Demolish, 0, 0, 0, 0, 0, 0, 0] });
    // bob, online: PlayerId + Membership travel in the player record
    const pb = a.world.create();
    a.world.add(pb, Transform, { x: 3, y: 3 }).add(pb, Owner, { clientId: 2 }).add(pb, PlayerId, { id: bob }).add(pb, Membership, { partyId: party.id, clanId: clan.id });
    a.persist.trackPlayer("bb".repeat(16), pb, "bob");
    step(a.world, 2);
    expect(a.persist.beginRound()).toBe(true); await a.persist.continueRound(Infinity);
    expect(s1.readBlob(GROUPS_BLOB)?.format).toBe(2); expect(s1.readBlob(CLAIMS_BLOB)).toBeDefined();
    const saves = a.persist.stats.socialSaves;
    await a.persist.saveSocial(); expect(a.persist.stats.socialSaves).toBe(saves); // unchanged: not rewritten
    g.setRole(party.id, eve, OFFICER); // change after the round: picked up by saveAll
    await a.persist.saveAll(); expect(a.persist.stats.socialSaves).toBe(saves + 1);
    const canEveOpen = can(a.world, a.world.create(), box, Act.Open);
    await s1.close();

    // ---- run 2: fresh process state, same file
    const s2 = await SqliteWorldStore.open(path);
    const social2 = loadSocial(s2);
    const b = makeWorld(s2, { social: social2, setup: setup(social2) });
    b.chunks.setSource({ id: 1, x: 5, y: 5 }); step(b.world);
    const g2 = b.world.resource(Permissions).groups;
    expect(g2).toBe(social2.groups);
    const clan2 = g2.get(clan.id)!;
    expect(clan2.kind).toBe(CLAN);
    expect([...clan2.members]).toEqual([[alice, LEADER], [bob, OFFICER]]);
    expect(clan2.banner).toEqual({ shape: 3, pattern: 1, colors: [0xff2200ff, 0x00112233], emblemId: 517 });
    expect(g2.role(party.id, eve)).toBe(OFFICER); expect(g2.groupsOf(bob).map((x) => x.id).sort()).toEqual([clan.id, party.id].sort());
    expect(g2.create(CLAN).id).toBe(party.id + 1); // nextId survives
    const c2 = b.world.resource(Permissions).claims;
    expect(c2.get(claim.id)).toEqual(claim); expect(c2.zoneAt(10, 10)).toBe(RAIDABLE | NO_BUILD); expect(c2.claimAt(10, 10)?.ownerGroup).toBe(clan.id);
    // privilege entity came back with its chunk
    const [box2] = [...b.world.query([OwnedBy, AccessList])];
    expect(box2).toBeDefined();
    expect(b.world.get(box2!, OwnedBy)).toEqual({ playerId: alice, groupId: clan.id });
    expect([...b.world.getArray(box2!, AccessList, "subject")!].slice(0, 2)).toEqual([eve, party.id]);
    expect([...b.world.getArray(box2!, AccessList, "deny")!][0]).toBe(Act.Demolish);
    expect(can(b.world, b.world.create(), box2!, Act.Open)).toBe(canEveOpen);
    // player record: PlayerId + Membership
    const pb2 = b.world.create(); b.world.add(pb2, Owner, { clientId: 5 });
    const r = b.persist.restorePlayer("bb".repeat(16), pb2)!;
    expect(r.restored).toEqual(expect.arrayContaining(["PlayerId", "Membership"]));
    expect(b.world.getField(pb2, PlayerId, "id")).toBe(bob);
    expect(b.world.get(pb2, Membership)).toEqual({ partyId: party.id, clanId: clan.id });
    // a bob actor can open the box via clan ownership; eve via her ACL entry (deny Demolish wins)
    const actorBob = b.world.create(); b.world.add(actorBob, PlayerId, { id: bob });
    const actorEve = b.world.create(); b.world.add(actorEve, PlayerId, { id: eve });
    expect(can(b.world, actorBob, box2!, Act.Open)).toBe(true);
    expect(can(b.world, actorEve, box2!, Act.Build)).toBe(true); // party grant
    expect(can(b.world, actorEve, box2!, Act.Demolish)).toBe(false);
    // the PlayerId counter continues
    expect(b.persist.allocatePlayerId()).toBe(eve + 1);
    await s2.close();
  });

  it("loads a v1 GroupRegistry record (no banners) and refuses to start on a corrupt one", () => {
    const w = new BinaryWriter(64); w.write("u8", 1); w.write("u32", 5); w.write("u32", 1);
    w.write("u32", 4); w.write("u8", CLAN); w.write("u32", 3); w.write("u16", 1); w.write("u32", 77); w.write("u8", LEADER);
    const st = new MemoryWorldStore(); void st.write({ blobs: [{ key: GROUPS_BLOB, format: 1, bytes: w.finish(), tick: 0 }] });
    const s = loadSocial(st);
    expect(s.groups.get(4)?.members.get(77)).toBe(LEADER); expect(s.groups.get(4)?.banner).toBeUndefined();
    expect(s.groups.create(PARTY).id).toBe(5);
    void st.write({ blobs: [{ key: GROUPS_BLOB, format: 9, bytes: new Uint8Array([9, 0, 0]), tick: 0 }] });
    expect(() => loadSocial(st)).toThrow(SocialCodecError);
    expect(new GroupRegistry().encode()[0]).toBe(2);
  });
});
