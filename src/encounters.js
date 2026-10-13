// Sky encounters: which flying Pokémon live above which part of Kanto, and at what level.
// Levels follow the routes underneath (FireRed's own land encounter ranges), so the sky over
// Route 1 is gentle and the sky over Victory Road is not.
import { rand, range } from './rng.js';
import { species } from './data.js';

// Level band per map, from src/data/wild_encounters.json (land slots) with towns taking the
// band of the route beside them and sea routes taking their surfing range, clipped.
const BANDS = {
  MAP_PALLET_TOWN: [2, 5], MAP_ROUTE1: [2, 5], MAP_VIRIDIAN_CITY: [3, 6], MAP_ROUTE22: [3, 6], MAP_ROUTE2: [3, 6],
  MAP_PEWTER_CITY: [5, 9], MAP_ROUTE3: [5, 9], MAP_ROUTE4: [8, 12], MAP_CERULEAN_CITY: [10, 14], MAP_ROUTE24: [8, 14],
  MAP_ROUTE25: [9, 14], MAP_ROUTE5: [10, 16], MAP_ROUTE6: [10, 16], MAP_VERMILION_CITY: [12, 18], MAP_ROUTE11: [11, 17],
  MAP_ROUTE9: [11, 17], MAP_ROUTE10: [12, 18], MAP_LAVENDER_TOWN: [15, 22], MAP_ROUTE8: [15, 20], MAP_ROUTE7: [17, 22],
  MAP_CELADON_CITY: [18, 24], MAP_SAFFRON_CITY: [20, 26], MAP_ROUTE12: [22, 30], MAP_ROUTE13: [22, 30], MAP_ROUTE14: [22, 30],
  MAP_ROUTE15: [22, 30], MAP_ROUTE16: [18, 25], MAP_ROUTE17: [20, 29], MAP_ROUTE18: [20, 29], MAP_FUCHSIA_CITY: [22, 30],
  MAP_ROUTE19: [25, 33], MAP_ROUTE20: [26, 35], MAP_ROUTE21_NORTH: [25, 32], MAP_ROUTE21_SOUTH: [25, 32],
  MAP_CINNABAR_ISLAND: [28, 36], MAP_ROUTE23: [32, 44], MAP_INDIGO_PLATEAU_EXTERIOR: [40, 50],
};

const ZONE_OF_MAP = {
  MAP_LAVENDER_TOWN: 'ghost', MAP_ROUTE8: 'ghost',
  MAP_ROUTE10: 'power',
  MAP_ROUTE3: 'mountain', MAP_ROUTE4: 'mountain', MAP_ROUTE9: 'mountain', MAP_ROUTE22: 'mountain', MAP_ROUTE23: 'mountain',
  MAP_INDIGO_PLATEAU_EXTERIOR: 'mountain',
  MAP_ROUTE2: 'forest', MAP_ROUTE24: 'forest', MAP_ROUTE25: 'forest', MAP_ROUTE12: 'forest', MAP_ROUTE13: 'forest',
  MAP_ROUTE14: 'forest', MAP_ROUTE15: 'forest',
  MAP_CELADON_CITY: 'city', MAP_SAFFRON_CITY: 'city', MAP_VERMILION_CITY: 'city', MAP_CERULEAN_CITY: 'city',
  MAP_ROUTE5: 'city', MAP_ROUTE6: 'city', MAP_ROUTE7: 'city',
  MAP_CINNABAR_ISLAND: 'volcano',
};

// w = weight; min/max = level window the species appears in (evolutions take over as levels rise).
// Legendary entries only appear over their home maps.
const TABLES = {
  fields: { rate: 6, mons: [
    { sp: 'PIDGEY', w: 30, max: 22 }, { sp: 'PIDGEOTTO', w: 22, min: 16, max: 40 }, { sp: 'PIDGEOT', w: 6, min: 34 },
    { sp: 'SPEAROW', w: 25, max: 24 }, { sp: 'FEAROW', w: 12, min: 20 }, { sp: 'TAILLOW', w: 14, max: 24 },
    { sp: 'SWELLOW', w: 8, min: 22 }, { sp: 'HOOTHOOT', w: 8, max: 22 }, { sp: 'NOCTOWL', w: 5, min: 20 },
    { sp: 'FARFETCHD', w: 4 }, { sp: 'SWABLU', w: 6, max: 34 }, { sp: 'ALTARIA', w: 2, min: 33 },
  ] },
  forest: { rate: 8, mons: [
    { sp: 'BUTTERFREE', w: 24 }, { sp: 'BEEDRILL', w: 22 }, { sp: 'PIDGEY', w: 20, max: 22 }, { sp: 'PIDGEOTTO', w: 14, min: 16 },
    { sp: 'VENOMOTH', w: 10, min: 24 }, { sp: 'HOOTHOOT', w: 10, max: 22 }, { sp: 'NOCTOWL', w: 6, min: 20 },
    { sp: 'NATU', w: 6, max: 26 }, { sp: 'XATU', w: 3, min: 25 },
  ] },
  sea: { rate: 5, mons: [
    { sp: 'WINGULL', w: 45, max: 28 }, { sp: 'PELIPPER', w: 25, min: 20 }, { sp: 'FEAROW', w: 12, min: 20 },
    { sp: 'GOLBAT', w: 10, min: 22 }, { sp: 'SWABLU', w: 6, max: 34 }, { sp: 'ALTARIA', w: 3, min: 30 },
    { sp: 'DRAGONITE', w: 1, min: 30, fixed: 55 },
    { sp: 'ARTICUNO', w: 1, fixed: 50, maps: ['MAP_ROUTE20', 'MAP_ROUTE19'] },
  ] },
  mountain: { rate: 6, mons: [
    { sp: 'SPEAROW', w: 28, max: 24 }, { sp: 'FEAROW', w: 18, min: 20 }, { sp: 'ZUBAT', w: 22, max: 24 },
    { sp: 'GOLBAT', w: 16, min: 22 }, { sp: 'SKARMORY', w: 8, min: 10 }, { sp: 'MURKROW', w: 6 },
    { sp: 'AERODACTYL', w: 2, min: 8 },
  ] },
  ghost: { rate: 8, mons: [
    { sp: 'GASTLY', w: 40, max: 26 }, { sp: 'HAUNTER', w: 22, min: 18 }, { sp: 'ZUBAT', w: 16, max: 24 },
    { sp: 'GOLBAT', w: 8, min: 22 }, { sp: 'MURKROW', w: 12 }, { sp: 'NOCTOWL', w: 6, min: 16 },
  ] },
  power: { rate: 7, mons: [
    { sp: 'MAGNEMITE', w: 34, max: 30 }, { sp: 'MAGNETON', w: 14, min: 18 }, { sp: 'SPEAROW', w: 24, max: 24 },
    { sp: 'FEAROW', w: 14, min: 18 }, { sp: 'SKARMORY', w: 6 },
    { sp: 'ZAPDOS', w: 1, fixed: 50, maps: ['MAP_ROUTE10'] },
  ] },
  city: { rate: 5, mons: [
    { sp: 'PIDGEY', w: 30, max: 22 }, { sp: 'PIDGEOTTO', w: 16, min: 16 }, { sp: 'SPEAROW', w: 18, max: 24 },
    { sp: 'KOFFING', w: 14, max: 34 }, { sp: 'WEEZING', w: 6, min: 30 }, { sp: 'MAGNEMITE', w: 8, max: 30 },
    { sp: 'MURKROW', w: 8 }, { sp: 'TAILLOW', w: 8, max: 24 },
  ] },
  volcano: { rate: 6, mons: [
    { sp: 'FEAROW', w: 26, min: 20 }, { sp: 'PELIPPER', w: 20, min: 20 }, { sp: 'WINGULL', w: 16, max: 28 },
    { sp: 'KOFFING', w: 12, max: 34 }, { sp: 'WEEZING', w: 10, min: 30 }, { sp: 'CHARIZARD', w: 2, min: 36, fixed: 40 },
    { sp: 'MOLTRES', w: 1, fixed: 50, maps: ['MAP_CINNABAR_ISLAND'] },
  ] },
};
// Mew hides above the clouds anywhere, very rarely.
const MEW_CHANCE = 1 / 200;

export function zoneAt(world, tx, ty) {
  const map = world.nearestMap(tx, ty);
  const id = map ? map.id : 'MAP_ROUTE1';
  const zone = world.isWater(tx, ty) || (!world.mapAt(tx, ty) && world.seaBorderAt(tx, ty)) ? 'sea' : ZONE_OF_MAP[id] || 'fields';
  return { zone, mapId: id, band: BANDS[id] || [20, 30] };
}

export function encounterRate(zone) { return TABLES[zone].rate; }

export function rollEncounter(world, tx, ty) {
  const { zone, mapId, band } = zoneAt(world, tx, ty);
  if (rand() < MEW_CHANCE) return { species: 'MEW', level: 30, zone };
  const [lo, hi] = band;
  const options = [];
  for (const e of TABLES[zone].mons) {
    if (e.maps && !e.maps.includes(mapId)) continue;
    if (e.fixed) { if ((e.min || 0) <= hi) options.push({ e, lo: e.fixed, hi: e.fixed }); continue; }
    const a = Math.max(lo, e.min || 1), b = Math.min(hi, e.max || 100);
    if (a <= b) options.push({ e, lo: a, hi: b });
  }
  if (!options.length) options.push({ e: { sp: 'PIDGEY', w: 1 }, lo, hi });
  let total = 0;
  for (const o of options) total += o.e.w;
  let r = rand() * total;
  let pickd = options[options.length - 1];
  for (const o of options) { r -= o.e.w; if (r < 0) { pickd = o; break; } }
  return { species: pickd.e.sp, level: range(pickd.lo, pickd.hi), zone };
}

// FireRed's step logic (src/wild_encounter.c): a cooldown of 8 - rate/10 steps after an encounter
// during which only 5% of steps may roll, then (rate*16 + buff*16/200)/1600 per step, where the
// buff grows by `rate` on every step that did not produce an encounter.
export class EncounterClock {
  constructor() { this.steps = 0; this.buff = 0; this.prevZone = null; }
  reset() { this.steps = 0; this.buff = 0; }
  step(zone) {
    const rate = encounterRate(zone);
    const minSteps = rate >= 80 ? 0 : rate < 10 ? 8 : 8 - Math.floor(rate / 10);
    const changed = this.prevZone !== null && this.prevZone !== zone;
    this.prevZone = zone;
    if (this.steps < minSteps) {
      this.steps++;
      if (rand() * 100 >= 5) return false;
    }
    if (changed && rand() * 100 >= 60) return false;
    const p = Math.min(1600, rate * 16 + Math.floor((this.buff * 16) / 200));
    if (rand() * 1600 < p) { this.reset(); return true; }
    this.buff += rate;
    return false;
  }
}

export function speciesExists(key) { return !!species(key); }
