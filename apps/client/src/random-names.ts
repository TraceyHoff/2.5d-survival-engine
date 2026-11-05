/**
 * Task 27: random survivor-name generator for the character creator.
 * Separate male / female first-name lists and one shared surname list; a
 * generated name is "First Last". All first names and surnames are plain
 * ASCII and at most 9 letters, so every generated name fits NAME_MAX (20)
 * without being cut off. Survival-game appropriate, readable names — no
 * joke names, no apostrophes or hyphens (cleanName would keep them, but
 * plain names read better on name tags).
 */
import { BODY_TYPES, type BodyType } from "@engine/core";

/** 48 male first names. */
export const MALE_FIRST_NAMES: readonly string[] = [
  "Aaron", "Adam", "Alan", "Alec", "Amos", "Andre", "Andrew", "Anthony",
  "Arthur", "Austin", "Barry", "Ben", "Blake", "Boyd", "Brad", "Brent",
  "Brett", "Brian", "Bruce", "Caleb", "Calvin", "Carl", "Cecil", "Chad",
  "Chris", "Chuck", "Clay", "Cliff", "Clint", "Cody", "Colin", "Corey",
  "Craig", "Curtis", "Dale", "Damon", "Dan", "Daryl", "Dave", "David",
  "Dean", "Dennis", "Derek", "Desmond", "Devon", "Dewey", "Dexter", "Dominic",
];

/** 48 female first names. */
export const FEMALE_FIRST_NAMES: readonly string[] = [
  "Ada", "Adele", "Agnes", "Alice", "Alicia", "Allison", "Alma", "Amanda",
  "Amber", "Amelia", "Amy", "Ana", "Andrea", "Angela", "Anita", "Anna",
  "Anne", "Annie", "April", "Arlene", "Ashley", "Audrey", "Aurora", "Barbara",
  "Beatrice", "Becky", "Belinda", "Bernice", "Bertha", "Bessie", "Beth", "Betsy",
  "Betty", "Beverly", "Bonnie", "Brenda", "Bridget", "Camille", "Candace", "Cara",
  "Carla", "Carmen", "Carol", "Caroline", "Carrie", "Casey", "Cassandra", "Catherine",
];

/** 48 surnames, shared by both sexes. */
export const SURNAMES: readonly string[] = [
  "Adams", "Allen", "Alvarez", "Anderson", "Andrews", "Armstrong", "Bailey", "Baker",
  "Barnes", "Bell", "Bennett", "Brooks", "Brown", "Bryant", "Burns", "Butler",
  "Campbell", "Carter", "Clark", "Coleman", "Collins", "Cook", "Cooper", "Cox",
  "Cruz", "Davis", "Diaz", "Edwards", "Evans", "Fisher", "Flores", "Foster",
  "Garcia", "Gomez", "Gonzales", "Gray", "Green", "Gutierrez", "Hall", "Harris",
  "Hayes", "Henderson", "Hernandez", "Hill", "Howard", "Hughes", "Jackson", "James",
];

/** The first-name list for a body type (index or key); unknown bodies read as male. */
export function firstNamesFor(body: BodyType | number): readonly string[] {
  const b = typeof body === "number" ? BODY_TYPES[body] ?? "male" : body;
  return b === "female" ? FEMALE_FIRST_NAMES : MALE_FIRST_NAMES;
}

/** "First Last" for the given body type. `avoid` (the name already in the
 *  field) is re-rolled once so a tap on Roll always looks like it did
 *  something when the first pick repeats. `rnd` is injectable for tests. */
export function randomName(body: BodyType | number, rnd: () => number = Math.random, avoid?: string): string {
  const firsts = firstNamesFor(body);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rnd() * list.length)]!;
  let name = `${pick(firsts)} ${pick(SURNAMES)}`;
  if (avoid !== undefined && name === avoid) name = `${pick(firsts)} ${pick(SURNAMES)}`;
  return name;
}
