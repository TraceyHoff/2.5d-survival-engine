import { defineComponent } from "./component.js";
/** Stable network identity (server-assigned); entity ids are local, NetIds are shared. */
export const NetId = defineComponent("NetId", { id: "u32" }, { networked: true });
/** Owning connection id (0 = server). */
export const Owner = defineComponent("Owner", { clientId: "u16" }, { networked: true });
/** Position in float tile units; z = height; facing in radians. */
/** Wire quantization ranges (sim keeps f32): z q10 over [0, TRANSFORM_Z_MAX] (~0.0625 tile); facing q8 over [-π, π] (~1.4°). */
export const TRANSFORM_Z_MAX = 64;
export const Transform = defineComponent("Transform", {
  x: "f32", y: "f32",
  /** Height in tiles; wire-clamped to [0, TRANSFORM_Z_MAX]. */
  z: { type: "f32", quant: { bits: 10, min: 0, max: TRANSFORM_Z_MAX } },
  /** Radians; keep normalized to [-π, π] (see normalizeAngle) — values outside are clamped on the wire. */
  facing: { type: "f32", quant: { bits: 8, min: -Math.PI, max: Math.PI } },
}, { networked: true, persistent: true });
/** Copy of Transform at start of tick, for render interpolation. Local only. */
export const PrevTransform = defineComponent("PrevTransform", { x: "f32", y: "f32", z: "f32", facing: "f32" });


/**
 * Environment singleton components (live on world.environment). Both change only on jumps, never per tick.
 * TimeOfDay is derived from world.tick: elapsed = tick - epochTick; day = floor(elapsed / dayLengthTicks).
 * Read it with timeOfDay(world); change it with setTimeOfDay / setDayLength.
 */
export const TimeOfDay = defineComponent("TimeOfDay", { dayLengthTicks: "u32", epochTick: "i32" }, { networked: true });
/** Weather kind is a plain u8 id (gameplay defines kinds); the current weather lasts until endsAtTick. Wind is part of weather. */
export const Weather = defineComponent("Weather", {
  kind: "u8", intensity: "f32", endsAtTick: "u32",
  /** Direction the wind blows toward (radians, tile axes), q8 on the wire. */
  windDir: { type: "f32", quant: { bits: 8, min: -Math.PI, max: Math.PI } },
  /** Tiles per second, q8 over [0, 32] on the wire. */
  windSpeed: { type: "f32", quant: { bits: 8, min: 0, max: 32 } },
}, { networked: true });
/** Reserved NetId of the environment singleton entity. Server NetId allocation must start above it. */
export const ENV_NET_ID = 1;
export const BUILTIN_COMPONENTS = [NetId, Owner, Transform, PrevTransform, TimeOfDay, Weather] as const;
