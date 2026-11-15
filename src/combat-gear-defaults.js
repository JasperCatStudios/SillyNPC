/**
 * The generic gear rules (fork): what a world type gets when it says nothing about weapons.
 *
 * Gear is data per world type (type.gear). This file is the floor under every type: a type with
 * no gear block, or a partial one, is filled in from here, key by key. It names no world and no
 * stat, so it is safe in the engine. The tier numbers are small on purpose: a better weapon
 * helps, it does not make a novice a master.
 *
 * A tier has four numbers:
 *   power  added to the weapon's damage power
 *   hit    added to the attack roll
 *   crit   percent chance of upgrading a strike to a critical
 *   mult   multiplier on the damage that comes out of the world's own formula
 *
 * Pure: no DOM, no SillyTavern imports.
 */

export const GEAR_VERSION = 1;

/** Lowest first: the order IS the rank. `prefix` names a default weapon of that tier. */
export const GENERIC_TIERS = Object.freeze([
    { id: 'training', label: 'Training', prefix: 'Wooden', color: '#8d6e63', icon: 'fa-solid fa-seedling', rarity: 'Practice', power: -1, hit: 0, crit: 0, mult: 0.85 },
    { id: 'common', label: 'Common', prefix: 'Iron', color: '#9e9e9e', icon: 'fa-solid fa-circle', rarity: 'Common', power: 0, hit: 0, crit: 0, mult: 1 },
    { id: 'bronze', label: 'Bronze', prefix: 'Bronze', color: '#b87333', icon: 'fa-solid fa-medal', rarity: 'Uncommon', power: 1, hit: 1, crit: 2, mult: 1.05 },
    { id: 'silver', label: 'Silver', prefix: 'Silver', color: '#c0c7d0', icon: 'fa-solid fa-star', rarity: 'Rare', power: 2, hit: 1, crit: 5, mult: 1.12 },
    { id: 'relic', label: 'Hero Relic', prefix: '', color: '#e0b040', icon: 'fa-solid fa-crown', rarity: 'Legendary', power: 3, hit: 2, crit: 10, mult: 1.25, signature: true },
]);

export const GENERIC_LADDER = Object.freeze({ label: 'Tier', defaultTier: 'common', tiers: GENERIC_TIERS });

/**
 * Kinds: what a weapon or focus is. A kind's power and hit are RELATIVE to the world's basic attack
 * for its proficiency (so a plain sword of a world whose basic sword attack is already balanced is 0 and 0);
 * when the world has no basic attack for the proficiency (archery, brawling), they stand on their own.
 *   slot   hand (held, one or two hands), focus (a book or staff: takes no hand), natural (fists, claws)
 *   hands  how many hands a hand weapon needs
 *   prof   the proficiency it is used with (set by a world; empty here)
 */
export const GENERIC_KINDS = Object.freeze([
    { id: 'weapon', label: 'Weapon', slot: 'hand', hands: 1, dualable: true, range: 'melee', power: 0, hit: 0, weight: 5, verb: 'strikes' },
    { id: 'fists', label: 'Fists', slot: 'natural', hands: 0, dualable: false, range: 'melee', power: 0, hit: 0, weight: 0, verb: 'strikes' },
    { id: 'focus', label: 'Focus', slot: 'focus', hands: 0, dualable: false, range: 'ranged', power: 0, hit: 0, weight: 1, verb: 'channels' },
]);

/** Tools: consumables used instead of an attack. Effect types are listed in TOOL_EFFECTS. */
export const TOOL_EFFECTS = Object.freeze(['damage', 'smoke', 'blind', 'stun', 'heal']);

export const GENERIC_TOOLS = Object.freeze([
    { id: 'knives', label: 'Throwing knives', uses: 3, verb: 'throws', effect: { type: 'damage', power: 3, area: 'one', range: 'ranged' } },
    { id: 'smoke', label: 'Smoke bomb', uses: 1, verb: 'hurls', effect: { type: 'smoke', flee: 35, hit: -3, turns: 1, area: 'side' } },
    { id: 'flash', label: 'Flash powder', uses: 1, verb: 'throws', effect: { type: 'blind', hit: -4, turns: 2, chance: 70, area: 'one' } },
    { id: 'snare', label: 'Snare', uses: 1, verb: 'sets', effect: { type: 'stun', turns: 1, chance: 55, area: 'one' } },
    { id: 'salve', label: 'Healing salve', uses: 1, verb: 'applies', effect: { type: 'heal', share: 0.25, area: 'self', fightOnly: true } },
    { id: 'caltrops', label: 'Caltrops', uses: 1, verb: 'scatters', effect: { type: 'damage', power: 1, area: 'all', range: 'ranged', slow: 10, turns: 2 } },
]);

/** Dual wielding: the second blade strikes for less and misses more. */
export const GENERIC_DUAL = Object.freeze({ offMult: 0.5, offHit: -3 });

/** Fleeing (used by a later phase; kept here so the numbers live with the rest of the gear data). */
export const GENERIC_FLEE = Object.freeze({
    base: 45, perSpeed: 1, perCover: 15, perTry: 10, perExtraFoe: 8, min: 5, max: 95, cleanMargin: 30, partingMult: 0.5,
});

/** Team fights (used by a later phase). */
export const GENERIC_TEAMS = Object.freeze({
    maxPerSide: 4,
    backToWall: Object.freeze({ hitPerFoe: 1, multPerFoe: 0.1, max: 3 }),
    crowding: Object.freeze({ hitPerAttacker: -1, max: -3 }),
});

/** The most tools a fighter takes into a fight. */
export const MAX_BELT = 3;
