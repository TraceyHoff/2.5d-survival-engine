import { defineComponent } from "./component.js";
import { Transform } from "./builtins.js";
import { entityIndex, type Entity } from "./entity.js";
import { defineResource, type World } from "./world.js";
import { Membership, OwnedBy, PlayerId, GroupRegistry } from "./social.js";

/**
 * Generic permissions. Gameplay defines action bits with definePermissionActions (like defineActions).
 * can(world, actor, target, action) resolves, in order:
 *   1. gameplay rule hooks (may return allow/deny/undefined = no opinion), e.g. raid windows, decay
 *   2. per-entity AccessList deny, then allow entries
 *   3. OwnedBy: owner player → allow; owner group member with role >= the action's min role → allow
 *   4. area claim at the target position (owner group / flags)
 *   5. unowned & unclaimed → policy.defaultAllow (default true)
 */
export type PermissionActions<K extends string> = { readonly [P in K]: number };
export function definePermissionActions<const K extends string>(names: readonly K[]): PermissionActions<K> {
  if (names.length > 32) throw new Error("at most 32 permission actions");
  const o: Record<string, number> = {}; names.forEach((n, i) => { if (n in o) throw new Error(`duplicate ${n}`); o[n] = (1 << i) >>> 0; });
  return Object.freeze(o) as PermissionActions<K>;
}

export const ACL_ENTRIES = 8;
/** Subject kinds for AccessList entries. */
export const enum AclSubject { None = 0, Player = 1, Group = 2, Everyone = 3 }
/** Per-entity overrides: up to 8 (subject kind, subject id, allow mask, deny mask). Persistent + networked. */
export const AccessList = defineComponent("AccessList", {
  kind: { type: "u8", length: ACL_ENTRIES }, subject: { type: "u32", length: ACL_ENTRIES },
  allow: { type: "u32", length: ACL_ENTRIES }, deny: { type: "u32", length: ACL_ENTRIES },
}, { networked: true, persistent: true });

/** Zone/claim flags (bitmask). */
export const enum ZoneFlag { Raidable = 1, PvP = 2, Safe = 4, NoBuild = 8 }
export interface Claim { id: number; ownerGroup: number; x0: number; y0: number; x1: number; y1: number; flags: number; priority: number }

/** Area claims bucketed by 32-tile cells (same grid as world chunks) for O(1)-ish lookup. */
export class ClaimRegistry {
  static readonly CELL = 32;
  private claims = new Map<number, Claim>();
  private cells = new Map<string, number[]>();
  private nextId = 1;
  defaultFlags = 0;
  private keys(c: Claim): string[] {
    const C = ClaimRegistry.CELL, out: string[] = [];
    for (let cy = Math.floor(c.y0 / C); cy <= Math.floor((c.y1 - 1e-9) / C); cy++) for (let cx = Math.floor(c.x0 / C); cx <= Math.floor((c.x1 - 1e-9) / C); cx++) out.push(`${cx},${cy}`);
    return out;
  }
  /** Rect is [x0,x1) × [y0,y1) in tile units. Higher priority wins on overlap (ties: lower id). */
  add(c: Omit<Claim, "id" | "priority"> & { id?: number; priority?: number }): Claim {
    const claim: Claim = { priority: 0, ...c, id: c.id ?? this.nextId }; this.nextId = Math.max(this.nextId, claim.id + 1);
    if (this.claims.has(claim.id)) throw new Error(`claim ${claim.id} exists`);
    this.claims.set(claim.id, claim); for (const k of this.keys(claim)) { let l = this.cells.get(k); if (!l) this.cells.set(k, (l = [])); l.push(claim.id); }
    return claim;
  }
  remove(id: number): boolean {
    const c = this.claims.get(id); if (!c) return false;
    for (const k of this.keys(c)) { const l = this.cells.get(k)!; l.splice(l.indexOf(id), 1); if (!l.length) this.cells.delete(k); }
    this.claims.delete(id); return true;
  }
  get(id: number): Claim | undefined { return this.claims.get(id); }
  all(): Claim[] { return [...this.claims.values()].sort((a, b) => a.id - b.id); }
  /** All claims containing (x,y). */
  claimsAt(x: number, y: number): Claim[] {
    const C = ClaimRegistry.CELL; const l = this.cells.get(`${Math.floor(x / C)},${Math.floor(y / C)}`); if (!l) return [];
    return l.map((id) => this.claims.get(id)!).filter((c) => x >= c.x0 && x < c.x1 && y >= c.y0 && y < c.y1)
      .sort((a, b) => b.priority - a.priority || a.id - b.id);
  }
  claimAt(x: number, y: number): Claim | undefined { return this.claimsAt(x, y)[0]; }
  /** Union of flags of all claims at (x,y), or defaultFlags when unclaimed. */
  zoneAt(x: number, y: number): number { const cs = this.claimsAt(x, y); if (!cs.length) return this.defaultFlags; let f = 0; for (const c of cs) f |= c.flags; return f; }
}

export type Decision = "allow" | "deny" | undefined;
export interface PermissionContext { world: World; actor: Entity; actorPlayer: number; target: Entity; action: number; claim: Claim | undefined }
export type PermissionRule = (ctx: PermissionContext) => Decision;
export interface PermissionPolicy {
  /** Min group role per action mask (default 1 = any member). */
  minRole: Map<number, number>;
  rules: PermissionRule[];
  defaultAllow: boolean;
  /** In a claim owned by a group the actor is not in: allow these actions anyway (e.g. Open in raidable windows via rule). */
  claimOutsiderMask: number;
}
export interface PermissionsRes { groups: GroupRegistry; claims: ClaimRegistry; policy: PermissionPolicy }
export const Permissions = defineResource<PermissionsRes>("Permissions");
export function installPermissions(world: World, opts: { groups?: GroupRegistry; claims?: ClaimRegistry; policy?: Partial<PermissionPolicy> } = {}): PermissionsRes {
  for (const c of [PlayerId, Membership, OwnedBy, AccessList]) world.register(c);
  const r: PermissionsRes = {
    groups: opts.groups ?? new GroupRegistry(), claims: opts.claims ?? new ClaimRegistry(),
    policy: { minRole: new Map(), rules: [], defaultAllow: true, claimOutsiderMask: 0, ...opts.policy },
  };
  world.setResource(Permissions, r); return r;
}
/** Register a gameplay rule; earlier rules win. Returns an unsubscribe. */
export function addPermissionRule(world: World, rule: PermissionRule): () => void {
  const l = world.resource(Permissions).policy.rules; l.push(rule); return () => { const i = l.indexOf(rule); if (i >= 0) l.splice(i, 1); };
}
export const playerOf = (world: World, e: Entity): number => world.getField(e, PlayerId, "id") as number | undefined ?? 0;
export function zoneAt(world: World, x: number, y: number): number { return world.resource(Permissions).claims.zoneAt(x, y); }

export function can(world: World, actor: Entity, target: Entity, action: number): boolean {
  const P = world.resource(Permissions); const player = playerOf(world, actor);
  const tx = world.getField(target, Transform, "x") as number | undefined, ty = world.getField(target, Transform, "y") as number | undefined;
  const claim = tx === undefined ? undefined : P.claims.claimAt(tx, ty!);
  const ctx: PermissionContext = { world, actor, actorPlayer: player, target, action, claim };
  for (const r of P.policy.rules) { const d = r(ctx); if (d) return d === "allow"; }
  const groups = P.groups;
  if (world.has(target, AccessList)) {
    const st = world.store(AccessList); const s = st.slot(entityIndex(target)); const d = st.data;
    let allowed = false;
    for (let k = 0; k < ACL_ENTRIES; k++) {
      const j = s * ACL_ENTRIES + k, kind = d.kind[j]!; if (kind === AclSubject.None) continue;
      const subj = d.subject[j]!;
      const match = kind === AclSubject.Everyone || (kind === AclSubject.Player && subj === player && player !== 0) || (kind === AclSubject.Group && groups.isMember(subj, player));
      if (!match) continue;
      if (d.deny[j]! & action) return false;
      if (d.allow[j]! & action) allowed = true;
    }
    if (allowed) return true;
  }
  const minRole = P.policy.minRole.get(action) ?? 1;
  const own = world.get(target, OwnedBy);
  if (own && (own.playerId || own.groupId)) {
    if (player && own.playerId === player) return true;
    if (own.groupId && groups.role(own.groupId, player) >= minRole) return true;
    return false;
  }
  if (claim && claim.ownerGroup) {
    if (groups.role(claim.ownerGroup, player) >= minRole) return true;
    return (P.policy.claimOutsiderMask & action) !== 0;
  }
  return P.policy.defaultAllow;
}



/** Permission check for an action at a position (e.g. placing a new piece): rules see target = 0. */
export function canAt(world: World, actor: Entity, x: number, y: number, action: number): boolean {
  const P = world.resource(Permissions); const player = playerOf(world, actor); const claim = P.claims.claimAt(x, y);
  const ctx: PermissionContext = { world, actor, actorPlayer: player, target: 0, action, claim };
  for (const r of P.policy.rules) { const d = r(ctx); if (d) return d === "allow"; }
  if (claim && claim.ownerGroup) return P.groups.role(claim.ownerGroup, player) >= (P.policy.minRole.get(action) ?? 1) || (P.policy.claimOutsiderMask & action) !== 0;
  return P.policy.defaultAllow;
}
