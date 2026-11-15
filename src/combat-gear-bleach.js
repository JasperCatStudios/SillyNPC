import { GENERIC_TIERS } from './combat-gear-defaults.js';

/**
 * Bleach gear (fork): data only, like combat-abilities-bleach.js. A zanpakuto's tier is its
 * release (Asauchi, Sealed, Shikai, Bankai); a fight starts at the tier the weapon is set to.
 * Release forms and the moves that come with them are abilities, not tiers (a later phase adds
 * state abilities for that). Kidō is an art, not a held thing, so it has its own ladder of
 * levels and sits in the focus slot.
 */

export const BLEACH_GEAR = {
    version: 1,
    ladders: {
        default: { label: 'Tier', defaultTier: 'common', tiers: GENERIC_TIERS },
        release: {
            label: 'Release',
            defaultTier: 'sealed',
            tiers: [
                { id: 'asauchi', label: 'Asauchi', prefix: '', color: '#9e9e9e', icon: 'fa-solid fa-circle', rarity: 'Unnamed', power: -1, hit: 0, crit: 0, mult: 0.9 },
                { id: 'sealed', label: 'Sealed', prefix: '', color: '#b0bec5', icon: 'fa-solid fa-lock', rarity: 'Sealed', power: 0, hit: 0, crit: 0, mult: 1 },
                { id: 'shikai', label: 'Shikai', prefix: '', color: '#4fc3f7', icon: 'fa-solid fa-bolt', rarity: 'Released', power: 3, hit: 1, crit: 4, mult: 1.15 },
                { id: 'bankai', label: 'Bankai', prefix: '', color: '#e53935', icon: 'fa-solid fa-fire', rarity: 'Final release', power: 6, hit: 2, crit: 8, mult: 1.35, signature: true },
            ],
        },
        kido: {
            label: 'Level',
            defaultTier: 'low',
            tiers: [
                { id: 'low', label: 'Low (1-30)', prefix: '', color: '#90caf9', icon: 'fa-solid fa-circle', rarity: 'Low', power: 0, hit: 0, crit: 0, mult: 0.9 },
                { id: 'mid', label: 'Mid (31-60)', prefix: '', color: '#42a5f5', icon: 'fa-solid fa-circle-dot', rarity: 'Mid', power: 2, hit: 1, crit: 2, mult: 1 },
                { id: 'high', label: 'High (61-90)', prefix: '', color: '#7e57c2', icon: 'fa-solid fa-star', rarity: 'High', power: 4, hit: 1, crit: 5, mult: 1.15 },
                { id: 'forbidden', label: 'Forbidden', prefix: '', color: '#d81b60', icon: 'fa-solid fa-skull', rarity: 'Forbidden', power: 7, hit: 2, crit: 8, mult: 1.3, signature: true },
            ],
        },
    },
    kinds: [
        { id: 'zanpakuto', label: 'Zanpakutō', slot: 'hand', hands: 1, dualable: true, range: 'melee', ladder: 'release', prof: 'zanjutsu', channel: 'physical', power: 0, hit: 0, weight: 4, verb: 'cuts' },
        { id: 'hakuda', label: 'Fists', slot: 'natural', hands: 0, dualable: false, range: 'melee', ladder: 'default', prof: 'hakuda', channel: 'physical', power: 0, hit: 0, weight: 0, verb: 'strikes' },
        { id: 'spirit_bow', label: 'Spirit Bow', slot: 'hand', hands: 2, dualable: false, range: 'ranged', ladder: 'default', prof: 'archery', channel: 'spiritual', power: 4, hit: 0, weight: 2, verb: 'looses a spirit arrow at' },
        { id: 'fullbring', label: 'Fullbring Object', slot: 'hand', hands: 1, dualable: false, range: 'melee', ladder: 'default', prof: 'fullbring_control', channel: 'spiritual', power: 4, hit: 0, weight: 3, verb: 'strikes' },
        { id: 'kido_art', label: 'Kidō', slot: 'focus', hands: 0, dualable: false, range: 'ranged', ladder: 'kido', prof: 'kido', channel: 'spiritual', power: 0, hit: 0, weight: 0, verb: 'casts at' },
    ],
    unarmed: 'hakuda',
};
