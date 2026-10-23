/**
 * MOCKS of the gameplay/core-owned render-facing components (schemas exactly as agreed). Replace with the real
 * ones (@engine/gameplay Wetness/BodyTemp/Fuel, core Emitter) once they are exported; the renderer only needs the defs.
 */
import { defineComponent } from "@engine/core";
export const BuildPiece = defineComponent("BuildPiece", { visualId: "u16", variant: "u8", tint: "u32", damageStage: "u8", rotation: "u8", level: "u8", layer: "u8", ghost: "u8" });
export const AnimState = defineComponent("AnimState", { state: "u8", startTick: "u32" });
/** Anim ids are core's wire-stable AnimState (ADR-093). */
export { AnimState as AnimStateId } from "@engine/core";
export const Wetness = defineComponent("Wetness", { level: "u8" });
export const BodyTemp = defineComponent("BodyTemp", { cold: "u8", heat: "u8", shivering: "u8" });
/** Core Emitter (Engine Architect, upcoming): kind ids from gameplay (Heat = 1, Light = 2). */
export const Emitter = defineComponent("Emitter", { kind: "u8", radius: "f32", strength: "f32", falloff: "u8" });
export const Fuel = defineComponent("Fuel", { burnUntilTick: "u32", lit: "u8" });
export const enum EmitterKind { Heat = 1, Light = 2 }
/** Gameplay Burning (contract): on building pieces; drives fire/ember/smoke VFX. */
export const Burning = defineComponent("Burning", { lit: "u8", intensity: "u8", startTick: "u32" });
/** gameplay Equipment (packages/gameplay/src/components.ts schema). */
export const Equipment = defineComponent("Equipment", { mainHandSlot: { type: "u8", default: 255 }, mainHandItem: "u16" });
