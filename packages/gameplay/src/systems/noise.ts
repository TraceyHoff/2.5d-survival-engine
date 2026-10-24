/**
 * Noise: actions raise the actor's NoiseLevel (server-only); zombies hear an entity when
 * distance <= NoiseLevel.value * hearingMul. Decays exponentially (noise.decayPerSec fraction per second).
 */
import { entityIndex, type Entity, type World } from "@engine/core";
import { NoiseLevel } from "../components.js";
import { gameplayDefs, isAuthority } from "../config.js";
import { skillMul } from "../skills/tree.js";

export function makeNoise(world: World, e: Entity, amount: number): void {
  if (!isAuthority(world) || world.isReplaying || !world.isAlive(e)) return;
  amount *= skillMul(world, e, "noise"); // ADR-113 stealth
  const cur = world.getField(e, NoiseLevel, "value");
  if (cur === undefined) world.add(e, NoiseLevel, { value: amount });
  else if (amount > cur) world.setField(e, NoiseLevel, "value", amount);
}

export function noiseDecaySystem(world: World, dt: number): void {
  if (!isAuthority(world)) return;
  const k = Math.max(0, 1 - gameplayDefs(world).noise.decayPerSec * dt);
  const st = world.store(NoiseLevel);
  for (let i = 0; i < st.size; i++) { const v = st.data.value[i]! * k; st.data.value[i] = v < 0.05 ? 0 : v; }
  void entityIndex; // server-only component: no markChanged needed (never replicated)
}
