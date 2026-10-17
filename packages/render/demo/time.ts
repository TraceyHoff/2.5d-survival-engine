/** Demo-side time/weather writers (the game would do this in gameplay systems). */
import { TimeOfDay, Weather, setDayLength, setTimeOfDay, type World } from "@engine/core";
import { readDayFraction } from "../src/index.js";

export function initTime(world: World, hours: number, dayLengthTicks: number): void { setDayLength(world, dayLengthTicks); setTimeOfDay(world, hours); }
export const setHours = (world: World, hours: number): void => setTimeOfDay(world, hours);
export const getHours = (world: World): number => readDayFraction(world) * 24;
/** Call once per tick to hold the clock still (time is derived from world.tick, so shift the epoch along). */
export function freezeTick(world: World): void { world.env(TimeOfDay).epochTick += 1; }
export function setWeather(world: World, kind: number, intensity: number): void { const w = world.env(Weather); w.kind = kind; w.intensity = intensity; w.endsAtTick = 0; }
