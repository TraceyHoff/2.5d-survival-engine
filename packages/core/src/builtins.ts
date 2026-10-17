import { defineComponent } from "./component.js";
/** Stable network identity (server-assigned); entity ids are local, NetIds are shared. */
export const NetId = defineComponent("NetId", { id: "u32" }, { networked: true });
/** Owning connection id (0 = server). */
export const Owner = defineComponent("Owner", { clientId: "u16" }, { networked: true });
/** Position in float tile units; z = height; facing in radians. */
export const Transform = defineComponent("Transform", { x: "f32", y: "f32", z: "f32", facing: "f32" }, { networked: true });
/** Copy of Transform at start of tick, for render interpolation. Local only. */
export const PrevTransform = defineComponent("PrevTransform", { x: "f32", y: "f32", z: "f32", facing: "f32" });


/** Environment singleton components (live on world.environment). `t` = fraction of day [0,1). */
export const TimeOfDay = defineComponent("TimeOfDay", { t: "f64", dayLengthTicks: "u32", day: "u32" }, { networked: true });
/** Weather kind is a plain u8 id; gameplay defines the kinds. */
export const Weather = defineComponent("Weather", { kind: "u8", intensity: "f32", ticksRemaining: "u32" }, { networked: true });
/** Reserved NetId of the environment singleton entity. Server NetId allocation must start above it. */
export const ENV_NET_ID = 1;
export const BUILTIN_COMPONENTS = [NetId, Owner, Transform, PrevTransform, TimeOfDay, Weather] as const;
