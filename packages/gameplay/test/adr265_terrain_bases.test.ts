import { describe, expect, it } from "vitest";
import { Transform, type Entity, type World } from "@engine/core";
import { TileMap, WATER_TILE } from "@engine/world";
import * as G from "../src/index.js";
import { nextTerrainWork, planTerrainBase } from "../src/ai/terrain_base.js";
import { aiMemoryOf, makePlan, scanBase } from "../src/ai/planner.js";
import { fillHireSensors } from "../src/ai/hire_behaviors.js";
import { fillGoalSensors } from "../src/ai/autonomy.js";
import { fillPlanSensors } from "../src/ai/base_behaviors.js";
import { walkerWaypoint } from "../src/systems/creature_nav.js";
import { type AgentWorldView } from "../src/agents.js";
import { makeWorld } from "./helpers.js";

function setup() {
  const w = makeWorld(), map = new TileMap();
  for (let y = -10; y < 20; y++) for (let x = -10; x < 20; x++) map.setTile(x, y, 3);
  w.setResource(G.TerrainRes, G.terrainFromTileMap(map));
  const p = G.spawnPlayer(w, { x: .5, y: 2.5, maxWeight: 0 }); w.add(p, G.Worker, {} as never);
  G.grantSkillUnlocks(w,p);
  const d = G.gameplayDefs(w); G.addItem(w, p, d.itemId("stone_shovel"), 1);
  for (const k of ["wood", "sticks", "stone", "fiber"]) G.addItem(w, p, d.itemId(k), 50);
  return { w, map, p, d };
}
const req = (d: G.GameDefs, x = .5, y = 2) => ({ piece: d.pieceId("ladder"), x, y, level: 0, rot: 0, tier: 0, variant: 0 });

describe("ADR-265 full-height face-mounted ladders", () => {
  it("places on a pit face with no deck/socket; players and pathfinders traverse in both directions, any depth", () => {
    const { w, p, d } = setup();
    for (const [x,y] of [[0,0],[1,0],[0,1],[1,1]]) G.setTerrainDig(w, x!, y!, -25);
    expect(G.movementBlocked(w, .5, 2.5, .5, 1.5, 0)).toBe(true);
    const r = G.tryPlace(w, p, req(d)); expect(r.ok).toBe(true);
    expect(G.structures(w).ladder(0, 2, G.EdgeSide.North)).toBe(r.ok ? r.piece : 0);
    expect(G.movementBlocked(w, .5, 2.5, .5, 1.5, 0)).toBe(false);
    expect(G.movementBlocked(w, .5, 1.5, .5, 2.5, 0)).toBe(false);
    expect(G.bodyAxisMove(w, .5, 2.05, 1.95, 1, 0, false)).toBe(1.95);
    expect(G.findPath(w, 0, 2, 1, 0, () => 9999)?.tiles.at(-1)).toEqual([1,0]);
    expect(G.findPath(w, 1, 0, 0, 2, () => 9999)?.tiles.at(-1)).toEqual([0,2]);
    expect(G.candidateStability(w, G.snapPlacement(w, req(d)) as G.Snapped)).toBeGreaterThan(0);
    G.structures(w).removePiece(r.ok ? r.piece : 0 as Entity);
    expect(G.movementBlocked(w, .5, 1.5, .5, 2.5, 0)).toBe(true);
  });
  it("rejects flat land, duplicate faces, water, foreign claims and blocked landings", () => {
    const { w, p, d, map } = setup();
    expect(G.tryPlace(w, p, req(d))).toEqual({ok:false,reason:G.BuildFail.NoTerrainFace});
    G.setTerrainDig(w, 0, 1, -3); expect(G.tryPlace(w,p,req(d)).ok).toBe(true);
    expect(G.tryPlace(w,p,req(d))).toEqual({ok:false,reason:G.BuildFail.Occupied});
    G.setTerrainDig(w, 1, 1, -3); map.setTile(1,2,WATER_TILE);
    expect(G.tryPlace(w,p,req(d,1.5))).toEqual({ok:false,reason:G.BuildFail.Terrain});
    map.setTile(1,2,3);
    const zone=w.create(); w.add(zone,Transform,{x:1.5,y:1.5}).add(zone,G.PrivilegeZone,{radius:1,tribe:99}); G.indexEntity(w,zone);
    expect(G.tryPlace(w,p,req(d,1.5))).toEqual({ok:false,reason:G.BuildFail.NoPrivilege});
  });
  it("preserves natural surface walking, but routes around an unladdered shovel pit on an otherwise empty map",()=>{
    const {w,p}=setup();w.resource(G.TerrainRes).setRawHeight!(0,1,-3);
    expect(G.movementBlocked(w,.5,2.5,.5,1.5,0)).toBe(false); // existing generated terrain contract
    w.resource(G.TerrainRes).setRawHeight!(0,1,0);G.setTerrainDig(w,0,1,-3);
    expect(G.movementBlocked(w,.5,2.5,.5,1.5,0)).toBe(true);
    const next=walkerWaypoint(w,p,.5,2.5,.5,.5);expect(next).toBeDefined();
    expect(next).not.toMatchObject({x:.5,y:.5});
  });
  it("rejects a solid landing and abandons a newly claimed entrance instead of endlessly retrying it",()=>{
    const {w,p,d}=setup();G.setTerrainDig(w,0,1,-3);
    const sn=G.snapPlacement(w,{...req(d,.5,1.5),piece:d.pieceId("workbench")});if(typeof sn!=="number")G.placePiece(w,p,sn,{pay:false});
    expect(G.tryPlace(w,p,req(d))).toEqual({ok:false,reason:G.BuildFail.Blocked});
    const fresh=setup();const plan=planTerrainBase(fresh.w,fresh.p,{x:0,y:0},"pit")!;G.setTerrainDig(fresh.w,0,1,-1);
    const zone=fresh.w.create();fresh.w.add(zone,Transform,{x:.5,y:2.5}).add(zone,G.PrivilegeZone,{radius:1,tribe:99});G.indexEntity(fresh.w,zone);
    expect(nextTerrainWork(fresh.w,fresh.p,plan)).toBeUndefined();expect(plan.abandoned).toBe(true);
  });

});

describe("ADR-266 finite autonomous terrain bases", () => {
  it.each(["pad", "pit"] as const)("plans and finishes a %s, conserves Soil and installs its entrance ladder and underground light", (kind) => {
    const { w,p,d }=setup(); const plan=planTerrainBase(w,p,{x:0,y:0},kind)!; expect(plan).toBeDefined();
    const soil=d.itemId("soil"); let digs=0,raises=0, ladder=false, lit=false;
    // Execute the exact command-sized work chosen by the planner, not a scripted per-cell edit.
    for(let n=0;n<100&&!plan.done&&!plan.abandoned;n++) {
      const step=nextTerrainWork(w,p,plan); if(!step) break;
      if(step.k==="terrain") {
        w.set(p,Transform,step.stand); const old=G.countItem(w,p,soil);
        expect(G.editTerrain(w,p,step.x,step.y,step.dir,true)).toBe(G.TerrainFail.None);
        expect(G.countItem(w,p,soil)).toBe(old);
        expect(G.editTerrain(w,p,step.x,step.y,step.dir)).toBe(G.TerrainFail.None);
        expect(G.countItem(w,p,soil)).toBe(old-step.dir); if(step.dir<0)digs++;else raises++;
      } else if(step.k==="ladder"||step.k==="light") {
        w.set(p,Transform,{x:.5,y:2.5});
        const result=G.tryPlace(w,p,{...req(d,step.x,step.y),piece:d.pieceId(step.k==="ladder"?"ladder":"campfire")});
        expect(result.ok,JSON.stringify({step,result})).toBe(true); if(step.k==="ladder")ladder=true;
      } else {
        // Container/fire APIs are covered separately; model the command's resulting lit state here.
        w.set(step.piece,G.Fuel,{lit:1,burnUntilTick:99999}); lit=true;
      }
      w.tick++;
    }
    expect(plan.abandoned).not.toBe(true); expect(plan.done).toBe(true); expect(ladder).toBe(true);
    expect(G.countItem(w,p,soil)).toBe(digs-raises);
    expect(kind==="pit"?digs:raises).toBe(kind==="pit"?12:8); if(kind==="pit")expect(lit).toBe(true);
    for(let y=0;y<2;y++)for(let x=0;x<2;x++){expect(w.resource(G.TerrainRes).heightAt(x,y)).toBe(plan.height);if(kind==="pit")expect(G.isUnderground(w,x,y)).toBe(true);}
    const before=G.countItem(w,p,soil);for(let n=0;n<20;n++)expect(nextTerrainWork(w,p,plan)).toBeUndefined();expect(G.countItem(w,p,soil)).toBe(before);
  });
  it("chooses terrain commands through the real plan and net command pipeline",()=>{
    const {w,p,d}=setup();const earth=planTerrainBase(w,p,{x:0,y:0},"pit")!;
    const plan=makePlan({world:w,self:p,defs:d,base:{x:0,y:0},bs:scanBase(w,d,{x:0,y:0}),fails:{},earth,terrainOnly:true});
    expect(plan.step?.k).toBe("terrain");
    expect(G.actionCommand("terrain:0:1:-1")).toEqual({type:G.TerrainCmd.name,payload:{x:0,y:1,dir:-1}});
  });
  it("refuses claims, no shovel, no Soil raising, occupied/player foundations, and full inventories",()=>{
    const {w,p,d}=setup();
    const earth=planTerrainBase(w,p,{x:0,y:0},"pit")!;
    const zone=w.create();w.add(zone,Transform,{x:.5,y:.5}).add(zone,G.PrivilegeZone,{radius:3,tribe:99});G.indexEntity(w,zone);
    expect(planTerrainBase(w,p,{x:0,y:0},"pit")).toBeUndefined();expect(nextTerrainWork(w,p,earth)).toBeUndefined();expect(earth.abandoned).toBe(true);
    w.destroy(zone);w.resource(G.TerrainRes).heightAt(0,0);
    expect(G.editTerrain(w,p,1,1,1)).toBe(G.TerrainFail.NoSoil);
    const f=G.snapPlacement(w,{...req(d,.5,.5),piece:d.pieceId("foundation")});if(typeof f!=="number")G.placePiece(w,p,f,{pay:false});
    expect(planTerrainBase(w,p,{x:0,y:0},"pad")).toBeUndefined();
  });
  it("unhired survivors select a persisted base plan, and hired Maintain workers choose bounded owner earthworks without tile orders",()=>{
    const {w,p,d}=setup(); const a=G.makeAgent(G.makeAgentIdentity(1,1),1); aiMemoryOf(a).base={x:0,y:0};
    const view: AgentWorldView={seen:[],home:{x:0,y:0},playerName:"owner"};
    fillPlanSensors(w,p,view,a,d,G.readSlots(w,p));expect(aiMemoryOf(a).earth).toMatchObject({x:0,y:0});
    const own=aiMemoryOf(a).earth;fillPlanSensors(w,p,view,a,d,G.readSlots(w,p));expect(aiMemoryOf(a).earth).toBe(own);
    w.set(p,G.Worker,{owner:77,job:G.WorkerJob.Maintain,homeX:0,homeY:0});
    fillHireSensors(w,p,view,a);expect(aiMemoryOf(a).hireEarth).toMatchObject({x:0,y:0});
    expect(view.plan?.goal).toBe("earthworks");expect(view.plan?.step?.k).toBe("terrain");
    // Changing jobs must NOT issue terrain work.
    w.setField(p,G.Worker,"job",G.WorkerJob.Follow);fillHireSensors(w,p,view,a);expect(view.plan).toBeUndefined();
  });
  it("stops a finite plan on full bag/no shovel, refuses a foreign quarry, and protects BOTH tiles supporting an edge",()=>{
    const {w,p,d}=setup();const plan=planTerrainBase(w,p,{x:0,y:0},"pit")!;
    w.set(p,G.Inventory,{maxWeight:.1});expect(nextTerrainWork(w,p,plan)).toBeUndefined();expect(plan.abandoned).toBe(true);
    expect(G.terrainDigAt(w,0,1)).toBe(0);expect(G.countItem(w,p,d.itemId("soil"))).toBe(0);
    const {w:w2,p:p2,d:d2}=setup();const plan2=planTerrainBase(w2,p2,{x:0,y:0},"pad")!;
    w2.set(p2,Transform,{x:-.5,y:2.5});
    const zone=w2.create();w2.add(zone,Transform,{x:-3,y:3}).add(zone,G.PrivilegeZone,{radius:1.5,tribe:99});G.indexEntity(w2,zone);
    expect(nextTerrainWork(w2,p2,plan2)).toBeUndefined();expect(plan2.abandoned).toBe(true);
    const sn=G.snapPlacement(w2,{...req(d2,.5,2),piece:d2.pieceId("wall")});
    if(typeof sn!=="number")G.placePiece(w2,p2,sn,{pay:false});
    expect(G.editTerrain(w2,p2,0,1,-1)).toBe(G.TerrainFail.Occupied);
    expect(G.editTerrain(w2,p2,0,2,-1)).toBe(G.TerrainFail.Occupied);
    G.removeItem(w2,p2,d2.itemId("stone_shovel"),1);expect(G.editTerrain(w2,p2,1,1,-1)).toBe(G.TerrainFail.NoShovel);
  });

  it("hired Maintain gathers its OWNER plan's missing ladder materials, not a personal-base goal",()=>{
    const {w,p,d}=setup();const a=G.makeAgent(G.makeAgentIdentity(1,1),1);
    w.set(p,G.Worker,{owner:77,job:G.WorkerJob.Maintain,homeX:0,homeY:0});
    aiMemoryOf(a).hireEarth=planTerrainBase(w,p,{x:0,y:0},"pit")!;G.setTerrainDig(w,0,1,-1);
    G.removeItem(w,p,d.itemId("wood"),50);G.removeItem(w,p,d.itemId("sticks"),50);
    const node=G.spawnResourceNode(w,"fallen_branches",-1.5,2.5);a.memory.see({id:node,kind:"node",x:-1.5,y:2.5,tick:w.tick});
    const view:AgentWorldView={seen:[],home:{x:0,y:0},playerName:"owner"};fillGoalSensors(w,p,view,a);
    expect(view.plan?.goal).toBe("earthworks");expect(view.plan?.leaves.length).toBeGreaterThan(0);
    expect(view.gatherNode).toMatchObject({id:node,wanted:true});
  });

  it("neighbouring survivor identities choose both underground rooms and elevated pads",()=>{
    const kinds=new Set<string>();
    for(const id of ["survivor-a","survivor-b"]){const {w,p,d}=setup();const a=G.makeAgent({...G.makeAgentIdentity(1,1),id},1);aiMemoryOf(a).base={x:0,y:0};
      fillPlanSensors(w,p,{seen:[],home:{x:0,y:0},playerName:"owner"},a,d,G.readSlots(w,p));kinds.add(aiMemoryOf(a).earth!.kind);}
    expect(kinds).toEqual(new Set(["pad","pit"]));
  });

});
