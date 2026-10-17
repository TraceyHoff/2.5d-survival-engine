import { defineResource } from "./world.js";
/** Global resources. Numeric enums only. */
export interface TimeOfDayRes { /** 0..1 fraction of day */ t: number; dayLengthTicks: number; day: number }
export const enum WeatherKind { Clear = 0, Rain = 1, Storm = 2, Snow = 3, Fog = 4 }
export interface WeatherRes { kind: WeatherKind; intensity: number; ticksRemaining: number }
export const TimeOfDay = defineResource<TimeOfDayRes>("TimeOfDay");
export const Weather = defineResource<WeatherRes>("Weather");
