// ADR-113: generates data/skills.json (skill/tech tree). Node ORDER IS APPEND-ONLY: a node's index is its bit in
// Progression.nodes, so never reorder/delete — retire a node by setting "retired": true. Run: node scripts/gen-skills.mjs
import { writeFileSync } from "node:fs";
const nodes = [];
let branchIdx = -1, branchKey = "";
const branches = [];
function branch(key, name, icon) { branchIdx++; branchKey = key; branches.push({ key, name, icon }); }
/** n(key, name, tier, lane, requires, effects, desc, cost) */
function n(key, name, tier, lane, requires, effects, desc, cost = tier >= 4 ? 3 : tier >= 2 ? 2 : 1) {
  nodes.push({ key, name, branch: branchKey, tier, x: branchIdx * 260 + lane * 80, y: tier * 110, cost, requires, effects, desc, icon: `skill_${key}` });
}
const m = (o) => ({ mods: o });
const sk = (key, level, extra = {}) => ({ skill: { key, level }, ...extra });

branch("survival", "Survival", "skill_branch_survival");
n("forager", "Forager", 0, 1, [], m({ gather: 0.1 }), "+10% gathering yield.");
n("pack_mule", "Pack Mule", 1, 0, ["forager"], m({ carry: 0.15 }), "+15% carry weight.");
n("firekeeper", "Firekeeper", 1, 2, ["forager"], m({ fuel: 0.15 }), "Fires you tend burn fuel 15% slower.");
n("iron_stomach", "Iron Stomach", 2, 1, ["forager"], { perk: "iron_stomach" }, "Eat spoiled/rotten food without getting sick, but each such meal costs 4 health.");
n("scavenger", "Scavenger", 2, 0, ["pack_mule"], m({ gather: 0.1 }), "+10% gathering yield.");
n("beast_of_burden", "Beast of Burden", 3, 0, ["scavenger"], m({ carry: 0.25, noise: 0.1 }), "+25% carry weight; your gear rattles (+10% noise).");
n("ember_saver", "Ember Saver", 3, 2, ["firekeeper"], m({ fuel: 0.2 }), "Fires you tend burn fuel 20% slower.");
n("hardy", "Hardy", 3, 1, ["iron_stomach"], m({ nutrition: 0.1 }), "+10% nutrition from all food.");
n("lumberjack", "Lumberjack", 4, 0, ["beast_of_burden"], m({ gather: 0.2 }), "+20% gathering yield.");
n("wilderness_master", "Wilderness Master", 5, 1, ["lumberjack", "hardy", "ember_saver"], m({ gather: 0.1, carry: 0.1, xp: 0.1 }), "Capstone: +10% yield, carry and XP.");

branch("combat", "Combat", "skill_branch_combat");
n("brawler", "Brawler", 0, 1, [], m({ dmg_unarmed: 0.25 }), "+25% unarmed damage.");
n("battle_hardened", "Battle Hardened", 1, 1, ["brawler"], m({ xp: 0.05 }), "+5% XP.");
const W = [["blade", "Blades"], ["blunt", "Blunt"], ["axe", "Axes"], ["spear", "Spears"], ["bow", "Bows"], ["crossbow", "Crossbows"], ["firearm", "Firearms"]];
W.forEach(([c, nm], i) => {
  const lane = i - 2;
  n(`${c}_training`, `${nm} Training`, 2, lane, ["battle_hardened"], m({ [`dmg_${c}`]: 0.1 }), `+10% damage with ${nm.toLowerCase()}.`);
  n(`${c}_expert`, `${nm} Expert`, 3, lane, [`${c}_training`], m({ [`dmg_${c}`]: 0.15 }), `+15% damage with ${nm.toLowerCase()}.`);
  n(`${c}_mastery`, `${nm} Mastery`, 4, lane, [`${c}_expert`], m({ [`dmg_${c}`]: 0.25 }), `Mastery: +25% damage with ${nm.toLowerCase()}.`);
});
n("berserker", "Berserker", 5, 0, ["blade_mastery", "blunt_mastery", "axe_mastery"], m({ dmg_blade: 0.2, dmg_blunt: 0.2, dmg_axe: 0.2, carry: -0.1 }), "+20% melee damage, but -10% carry weight.");
n("deadeye", "Deadeye", 5, 3, ["bow_mastery", "crossbow_mastery", "firearm_mastery"], m({ dmg_bow: 0.15, dmg_crossbow: 0.15, dmg_firearm: 0.15, noise: 0.15 }), "+15% ranged damage, but +15% noise.");

branch("crafting", "Crafting & Engineering", "skill_branch_crafting");
n("tinkerer", "Tinkerer", 0, 1, [], m({ xp: 0.05 }), "+5% XP.");
n("smithing_1", "Apprentice Smith", 1, 0, ["tinkerer"], sk("smithing", 1), "Smithing 1.");
n("smithing_2", "Journeyman Smith", 2, 0, ["smithing_1"], sk("smithing", 2), "Smithing 2.");
n("smithing_3", "Master Smith", 3, 0, ["smithing_2"], sk("smithing", 3), "Smithing 3: alloy tools and weapons.");
n("armorsmithing_1", "Armorer", 2, 1, ["smithing_1"], sk("armorsmithing", 1), "Armorsmithing 1.");
n("armorsmithing_2", "Plate Armorer", 3, 1, ["armorsmithing_1"], sk("armorsmithing", 2), "Armorsmithing 2.");
n("armorsmithing_3", "Composite Armorer", 4, 1, ["armorsmithing_2", "chemistry_2"], sk("armorsmithing", 3), "Armorsmithing 3: composite armor.");
n("tailoring_1", "Tailor", 1, 2, ["tinkerer"], sk("tailoring", 1), "Tailoring 1.");
n("tailoring_2", "Outfitter", 2, 2, ["tailoring_1"], sk("tailoring", 2), "Tailoring 2: oilskin.");
n("tailoring_3", "Master Tailor", 3, 2, ["tailoring_2"], sk("tailoring", 3), "Tailoring 3: tactical packs, aramid.");
n("chemistry_1", "Chemist", 1, 3, ["tinkerer"], sk("chemistry", 1), "Chemistry 1.");
n("chemistry_2", "Polymer Chemist", 2, 3, ["chemistry_1"], sk("chemistry", 2), "Chemistry 2: polymer sheets.");
n("demolitions_1", "Sapper", 3, 3, ["chemistry_1"], sk("demolitions", 1), "Demolitions 1: grenades, satchels.");
n("demolitions_2", "Bombardier", 4, 3, ["demolitions_1"], sk("demolitions", 2), "Demolitions 2.");
n("demolitions_3", "Breacher", 5, 3, ["demolitions_2"], sk("demolitions", 3), "Demolitions 3: breaching charges.");
n("bowyery_1", "Fletcher", 1, -1, ["tinkerer"], sk("bowyery", 1), "Bowyery 1.");
n("bowyery_2", "Bowyer", 2, -1, ["bowyery_1"], sk("bowyery", 2), "Bowyery 2.");
n("bowyery_3", "Master Bowyer", 3, -1, ["bowyery_2"], sk("bowyery", 3), "Bowyery 3: compound bows.");
n("gunsmithing_1", "Gunsmith", 3, 4, ["smithing_2"], sk("gunsmithing", 1), "Gunsmithing 1: ammunition.");
n("gunsmithing_2", "Armsmaker", 4, 4, ["gunsmithing_1"], sk("gunsmithing", 2), "Gunsmithing 2: revolvers, shotguns, rifles.");
n("gunsmithing_3", "Precision Gunsmith", 5, 4, ["gunsmithing_2"], sk("gunsmithing", 3), "Gunsmithing 3.");
n("gunsmithing_4", "Master Gunsmith", 6, 4, ["gunsmithing_3"], sk("gunsmithing", 4), "Gunsmithing 4: automatic rifles.");

branch("farming", "Farming", "skill_branch_farming");
n("green_thumb", "Green Thumb", 0, 1, [], m({ cropYield: 0.1 }), "+10% crop harvest yield.");
n("composter", "Composter", 1, 0, ["green_thumb"], m({ cropYield: 0.1 }), "+10% crop harvest yield.");
n("seed_saver", "Seed Saver", 1, 2, ["green_thumb"], m({ gather: 0.05 }), "+5% gathering yield.");
n("irrigator", "Irrigator", 2, 1, ["composter"], m({ cropYield: 0.15 }), "+15% crop harvest yield.");
n("orchardist", "Orchardist", 3, 0, ["irrigator"], m({ cropYield: 0.15 }), "+15% crop harvest yield.");
n("herbalist", "Herbalist", 3, 2, ["irrigator", "seed_saver"], m({ heal: 0.1 }), "+10% healing from medicine and food.");
n("master_farmer", "Master Farmer", 4, 1, ["orchardist", "herbalist"], m({ cropYield: 0.25, xp: 0.05 }), "Capstone: +25% crop yield, +5% XP.");
n("monoculture", "Monoculture", 5, 1, ["master_farmer"], m({ cropYield: 0.3, gather: -0.1 }), "+30% crop yield but -10% wild gathering.");

branch("husbandry", "Animal Husbandry", "skill_branch_husbandry");
n("husbandry_1", "Animal Handler", 0, 1, [], sk("husbandry", 1), "Craft animal feed; tame passive animals by using feed next to them.");
n("husbandry_pens", "Pen Builder", 1, 0, ["husbandry_1"], sk("husbandry", 2), "Tamed animals settle at your feeding troughs (pens).");
n("husbandry_gentle", "Gentle Hands", 1, 2, ["husbandry_1"], m({ tame: 0.25 }), "+25% taming chance.");
n("husbandry_dairy", "Dairy & Wool", 2, 0, ["husbandry_pens"], m({ produce: 0.25 }), "Fed animals produce 25% faster (milk, wool, eggs).");
n("husbandry_breeding", "Breeder", 2, 2, ["husbandry_pens"], { perk: "breeding" }, "Two fed tamed animals of a kind at a trough can breed.");
n("husbandry_whisperer", "Beast Whisperer", 3, 2, ["husbandry_gentle", "husbandry_breeding"], m({ tame: 0.5 }), "+50% taming chance.");
n("husbandry_rancher", "Rancher", 3, 0, ["husbandry_dairy"], m({ produce: 0.5 }), "Fed animals produce 50% faster.");
n("husbandry_butcher", "Butcher", 4, 1, ["husbandry_rancher"], m({ gather: 0.1, dmg_blade: 0.05 }), "+10% yield, +5% blade damage.");

branch("cooking", "Cooking", "skill_branch_cooking");
n("camp_cook", "Camp Cook", 0, 1, [], m({ nutrition: 0.1 }), "+10% nutrition from food.");
n("seasoning", "Seasoning", 1, 0, ["camp_cook"], m({ nutrition: 0.1 }), "+10% nutrition.");
n("preserver", "Preserver", 1, 2, ["camp_cook"], m({ nutrition: 0.05, xp: 0.05 }), "+5% nutrition, +5% XP.");
n("baker", "Baker", 2, 0, ["seasoning"], m({ nutrition: 0.1 }), "+10% nutrition.");
n("brewer", "Brewer", 2, 2, ["preserver"], m({ heal: 0.05, nutrition: 0.05 }), "+5% healing and nutrition.");
n("butcher_block", "Butcher's Block", 3, 0, ["baker"], m({ nutrition: 0.1 }), "+10% nutrition.");
n("gourmet", "Gourmet", 3, 2, ["brewer"], m({ nutrition: 0.15 }), "+15% nutrition.");
n("glutton", "Glutton", 4, 1, ["gourmet", "butcher_block"], m({ nutrition: 0.3, carry: -0.05 }), "+30% nutrition but -5% carry weight.");
n("master_chef", "Master Chef", 5, 1, ["glutton"], m({ nutrition: 0.2, xp: 0.05 }), "Capstone: +20% nutrition, +5% XP.");

branch("medicine", "Medicine", "skill_branch_medicine");
n("first_aid", "First Aid", 0, 1, [], m({ heal: 0.15 }), "+15% healing from bandages and medicine.");
n("field_medic", "Field Medic", 1, 0, ["first_aid"], m({ heal: 0.15 }), "+15% healing.");
n("apothecary", "Apothecary", 1, 2, ["first_aid"], m({ heal: 0.1 }), "+10% healing.");
n("triage", "Triage", 2, 0, ["field_medic"], m({ heal: 0.15 }), "+15% healing.");
n("antiseptics", "Antiseptics", 2, 2, ["apothecary"], m({ heal: 0.1, nutrition: 0.05 }), "+10% healing, +5% nutrition.");
n("surgeon", "Surgeon", 3, 1, ["triage", "antiseptics"], m({ heal: 0.25 }), "+25% healing.");
n("pharmacologist", "Pharmacologist", 4, 2, ["surgeon", "chemistry_1"], m({ heal: 0.15 }), "+15% healing.");
n("doctor", "Doctor", 5, 1, ["pharmacologist"], m({ heal: 0.25, xp: 0.05 }), "Capstone: +25% healing, +5% XP.");

branch("building", "Building", "skill_branch_building");
n("carpenter", "Carpenter", 0, 1, [], m({ xp: 0.05 }), "+5% XP.");
n("mason", "Mason", 1, 0, ["carpenter"], m({ gather: 0.05 }), "+5% gathering yield (stone).");
n("joiner", "Joiner", 1, 2, ["carpenter"], m({ carry: 0.05 }), "+5% carry weight.");
n("architect", "Architect", 2, 1, ["mason", "joiner"], m({ xp: 0.05 }), "+5% XP.");
n("fortifier", "Fortifier", 3, 0, ["architect"], m({ gather: 0.05 }), "+5% gathering yield.");
n("interior_designer", "Interior Designer", 3, 2, ["architect"], m({ xp: 0.05 }), "+5% XP (decorating counts as building).");
n("hearth_builder", "Hearth Builder", 4, 2, ["interior_designer", "firekeeper"], m({ fuel: 0.15 }), "Fires you tend burn 15% slower.");
n("master_builder", "Master Builder", 5, 1, ["fortifier", "hearth_builder"], m({ carry: 0.1, xp: 0.05 }), "Capstone: +10% carry, +5% XP.");

branch("vehicles", "Vehicles & Mechanics", "skill_branch_vehicles");
n("grease_monkey", "Grease Monkey", 0, 1, [], sk("mechanics", 1, m({ repair: 0.15 })), "Mechanics 1: +15% vehicle repair.");
n("mechanic_2", "Mechanic", 1, 1, ["grease_monkey"], sk("mechanics", 2, m({ repair: 0.15 })), "Mechanics 2: +15% vehicle repair.");
n("hauler", "Hauler", 1, 0, ["grease_monkey"], m({ carry: 0.1 }), "+10% carry weight.");
n("fuel_economist", "Fuel Economist", 2, 2, ["mechanic_2"], m({ vfuel: 0.15, fuel: 0.05 }), "+15% liters per fuel item when refueling vehicles; fires burn 5% slower.");
n("mechanic_3", "Engineer", 3, 1, ["mechanic_2"], sk("mechanics", 3, m({ repair: 0.2 })), "Mechanics 3: +20% vehicle repair.");
n("road_warrior", "Road Warrior", 3, 0, ["hauler"], m({ dmg_firearm: 0.05, carry: 0.05 }), "+5% firearm damage, +5% carry.");
n("mechanic_4", "Master Mechanic", 4, 1, ["mechanic_3"], sk("mechanics", 4, m({ repair: 0.3 })), "Mechanics 4: +30% vehicle repair.");
n("salvager", "Salvager", 5, 1, ["mechanic_4"], m({ gather: 0.1 }), "+10% gathering yield.");

branch("stealth", "Stealth", "skill_branch_stealth");
n("light_step", "Light Step", 0, 1, [], m({ noise: -0.15 }), "-15% noise.");
n("shadow", "Shadow", 1, 0, ["light_step"], m({ noise: -0.15 }), "-15% noise.");
n("backstabber", "Backstabber", 1, 2, ["light_step"], m({ dmg_blade: 0.1 }), "+10% blade damage.");
n("silent_hunter", "Silent Hunter", 2, 0, ["shadow"], m({ noise: -0.1, dmg_bow: 0.1 }), "-10% noise, +10% bow damage.");
n("assassin", "Assassin", 3, 2, ["backstabber", "silent_hunter"], m({ dmg_blade: 0.2, carry: -0.05 }), "+20% blade damage but travel light (-5% carry).");
n("ghost", "Ghost", 3, 0, ["silent_hunter"], m({ noise: -0.2 }), "-20% noise.");
n("phantom", "Phantom", 4, 1, ["ghost", "assassin"], m({ noise: -0.15, xp: 0.05 }), "Capstone: -15% noise, +5% XP.");
n("light_pack", "Light Pack", 5, 1, ["phantom"], m({ noise: -0.1, carry: -0.1 }), "-10% noise but -10% carry.");

branch("leadership", "Leadership & Clan", "skill_branch_leadership");
n("rally", "Rally", 0, 1, [], m({ share: 0.1 }), "Clanmates/partymates within 20 tiles get 10% of your XP.");
n("mentor", "Mentor", 1, 0, ["rally"], m({ share: 0.1 }), "+10% shared XP.");
n("quartermaster", "Quartermaster", 1, 2, ["rally"], m({ carry: 0.1 }), "+10% carry weight.");
n("diplomat", "Diplomat", 2, 0, ["mentor"], m({ xp: 0.05 }), "+5% XP.");
n("warlord", "Warlord", 2, 2, ["quartermaster"], m({ dmg_blade: 0.05, dmg_blunt: 0.05, dmg_axe: 0.05, dmg_spear: 0.05 }), "+5% melee damage.");
n("commander", "Commander", 3, 1, ["diplomat", "warlord"], m({ share: 0.15 }), "+15% shared XP.");
n("chieftain", "Chieftain", 4, 1, ["commander"], m({ share: 0.15, xp: 0.05 }), "Capstone: +15% shared XP, +5% XP.");
n("tactician", "Tactician", 5, 1, ["chieftain"], m({ xp: 0.1, noise: 0.1 }), "+10% XP but shouting orders adds +10% noise.");

const data = {
  $comment: "ADR-113 skill tree (generated by scripts/gen-skills.mjs; node order is append-only = Progression.nodes bit index). mods are additive fractions: repair/vfuel/gather/cropYield/carry/fuel/nutrition/heal/produce/tame/share/xp/noise/dmg_<class>. perks: iron_stomach, breeding.",
  xp: { gather: 2, craft: 4, combat: 0.5, kill: 15, farm: 6, hunt: 8, build: 5, tame: 25, cook: 6, heal: 4, repair: 5 },
  levels: { base: 100, growth: 1.18, pointsPerLevel: 1, maxLevel: 120, bonusEvery: 10, bonusPoints: 1 },
  respec: { item: "coin", base: 50, perRespec: 50, refundFraction: 1 },
  weaponClasses: {
    blade: ["sword", "knife", "dagger", "machete", "bayonet_musket"], blunt: ["club", "mace", "maul", "hammer", "bat", "warhammer"],
    axe: ["axe"], spear: ["spear", "throwing_axe"], bow: ["bow", "sling"], crossbow: ["crossbow"],
    firearm: ["pistol", "revolver", "shotgun", "rifle", "musket", "carbine"],
  },
  husbandry: {
    feed: "animal_feed", trough: "feeding_trough", reach: 2.5, troughRange: 10, penRadius: 3, fedSeconds: 600, tameBase: 0.35,
    breedSeconds: 1200, maxPerTrough: 6,
    animals: { animal_chicken: { produce: "egg", seconds: 300 }, animal_duck: { produce: "egg", seconds: 360 }, animal_goose: { produce: "egg", seconds: 420 }, animal_turkey: { produce: "egg", seconds: 420 }, animal_cow: { produce: "milk", seconds: 420 }, animal_goat: { produce: "milk", seconds: 360 }, animal_sheep: { produce: "wool", seconds: 480 } },
  },
  branches, nodes,
};
writeFileSync(new URL("../data/skills.json", import.meta.url), JSON.stringify(data, null, 1) + "\n");
console.log(`skills: ${branches.length} branches, ${nodes.length} nodes`);
