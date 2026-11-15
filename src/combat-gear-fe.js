import { GENERIC_TIERS } from './combat-gear-defaults.js';
import { FE_CATALOGUE } from './combat-gear-fe-weapons.js';

/**
 * Fire Emblem gear (fork): data only, like combat-abilities-fe.js. The tier ladder is the one the
 * generic rules use (Training, Common, Bronze, Iron, Steel, Silver, Hero Relic), which is the
 * series' own order of metals. Weapon kinds name the
 * proficiency they are trained with, and the old fixed attacks (Iron Sword, Iron Lance...) keep
 * their keys for old saves. Kind power and hit are relative to those basic attacks (a plain sword
 * is 0 and 0); brawling has no basic attack, so gauntlets and fists carry their own numbers.
 */

export const FE_GEAR = {
    version: 1,
    ladders: {
        default: { label: 'Tier', defaultTier: 'common', tiers: GENERIC_TIERS },
    },
    kinds: [
        { id: 'sword', label: 'Sword', slot: 'hand', hands: 1, dualable: true, range: 'melee', prof: 'sword', channel: 'physical', power: 0, hit: 0, weight: 5, verb: 'slashes' },
        { id: 'dagger', label: 'Dagger', slot: 'hand', hands: 1, dualable: true, range: 'melee', prof: 'sword', channel: 'physical', power: -2, hit: 1, weight: 2, verb: 'stabs' },
        { id: 'lance', label: 'Lance', slot: 'hand', hands: 1, dualable: false, range: 'melee', prof: 'lance', channel: 'physical', power: 0, hit: 0, weight: 7, verb: 'thrusts' },
        { id: 'axe', label: 'Axe', slot: 'hand', hands: 1, dualable: false, range: 'melee', prof: 'axe', channel: 'physical', power: 0, hit: 0, weight: 9, verb: 'cleaves' },
        { id: 'bow', label: 'Bow', slot: 'hand', hands: 2, dualable: false, range: 'ranged', prof: 'bow', channel: 'physical', power: 0, hit: 0, weight: 5, verb: 'looses an arrow at' },
        { id: 'gauntlets', label: 'Gauntlets', slot: 'hand', hands: 1, dualable: true, range: 'melee', prof: 'brawling', channel: 'physical', power: 3, hit: 0, weight: 3, verb: 'punches' },
        { id: 'fists', label: 'Fists', slot: 'natural', hands: 0, dualable: false, range: 'melee', prof: 'brawling', channel: 'physical', power: 2, hit: 0, weight: 0, verb: 'strikes' },
        { id: 'tome', label: 'Tome', slot: 'focus', hands: 0, dualable: false, range: 'ranged', prof: 'reason', channel: 'magic', power: 0, hit: 0, weight: 2, verb: 'casts at' },
        { id: 'staff', label: 'Staff', slot: 'focus', hands: 0, dualable: false, range: 'ranged', prof: 'faith', channel: 'magic', power: 0, hit: 0, weight: 2, verb: 'channels' },
    ],
    // Named weapons (the Armoury's built-in half), including the relics that used to be abilities.
    catalogue: FE_CATALOGUE,
    unarmed: 'fists',
};
