import { GENERIC_TIERS } from './combat-gear-defaults.js';

/**
 * Black Clover gear (fork): data only, like combat-gear-fe.js.
 *
 * Two ladders.
 *
 *   default   Regular weapons (swords, daggers, spears, bows, gauntlets, anti-magic blades) use the
 *             generic ladder every world shares, the one Fire Emblem uses: Training, Common,
 *             Bronze, Iron, Steel, Silver, Hero Relic. The Armoury has every ordinary kind at
 *             every metal from Training to Silver, as Fire Emblem's does.
 *   grimoire  A grimoire is a mage's focus, so it has a ladder of its own: the leaf count (three,
 *             four, five) and, between them, the condition of the book (a tattered hand-me-down,
 *             a tempered one that has grown with its owner, an awakened four-leaf, an ascended
 *             five-leaf). Numbers never go down from one step to the next. The Advanced Abilities
 *             key off this ladder (combat-abilities-bc.js).
 *
 * A grimoire sits in the focus slot and adds its step to the world's basic spell (Mana Control),
 * like a tome in Fire Emblem. Kind power and hit are relative to the world's basic attack for the
 * proficiency, which is power 0 here, so a sword's +2 stands on its own.
 */

export const BC_GRIMOIRE_TIERS = Object.freeze([
    { id: 'tattered_three', label: 'Tattered Three-Leaf', prefix: 'Tattered Three-Leaf', leaves: 3, color: '#8d6e63', icon: 'fa-solid fa-book', rarity: 'Worn', power: -1, hit: 0, crit: 0, mult: 0.9 },
    { id: 'three_leaf', label: 'Three-Leaf', prefix: 'Three-Leaf', leaves: 3, color: '#9ccc65', icon: 'fa-solid fa-book', rarity: 'Common', power: 0, hit: 0, crit: 0, mult: 1 },
    { id: 'tempered_three', label: 'Tempered Three-Leaf', prefix: 'Tempered Three-Leaf', leaves: 3, color: '#43a047', icon: 'fa-solid fa-book-open', rarity: 'Grown', power: 1, hit: 1, crit: 2, mult: 1.05 },
    { id: 'four_leaf', label: 'Four-Leaf', prefix: 'Four-Leaf', leaves: 4, color: '#26a69a', icon: 'fa-solid fa-clover', rarity: 'Rare', power: 2, hit: 1, crit: 4, mult: 1.1 },
    { id: 'awakened_four', label: 'Awakened Four-Leaf', prefix: 'Awakened Four-Leaf', leaves: 4, color: '#00897b', icon: 'fa-solid fa-clover', rarity: 'Awakened', power: 2, hit: 1, crit: 6, mult: 1.15 },
    { id: 'five_leaf', label: 'Five-Leaf', prefix: 'Five-Leaf', leaves: 5, color: '#5e35b1', icon: 'fa-solid fa-skull', rarity: 'Devil-bound', power: 3, hit: 2, crit: 8, mult: 1.2 },
    { id: 'ascended_five', label: 'Ascended Five-Leaf', prefix: 'Ascended Five-Leaf', leaves: 5, color: '#311b92', icon: 'fa-solid fa-crown', rarity: 'Legendary', power: 4, hit: 2, crit: 10, mult: 1.3, signature: true },
]);

const item = (id, name, kind, tier, desc = '', bonus = {}) => ({
    id: `bc_${id}`, name, kind, tier, desc, bonus: { power: 0, hit: 0, crit: 0, ...bonus },
});

/** The named pieces of the Armoury: grimoires at every step, and weapons with a story. */
const NAMED = [
    // Grimoires, one per step.
    item('grimoire_tattered', 'Tattered Three-Leaf Grimoire', 'grimoire', 'tattered_three', 'A hand-me-down book, its pages soft with age. It still answers, a little slowly.'),
    item('grimoire_three', 'Three-Leaf Grimoire', 'grimoire', 'three_leaf', 'The grimoire given at the Grimoire Tower: faith, hope and love on its cover.'),
    item('grimoire_tempered', 'Tempered Three-Leaf Grimoire', 'grimoire', 'tempered_three', 'Years of use have filled it with spells; the cover has worn to the owner\'s hand.'),
    item('grimoire_four', 'Four-Leaf Grimoire', 'grimoire', 'four_leaf', 'The fourth leaf is luck: a rare book that holds rare magic.'),
    item('grimoire_awakened', 'Awakened Four-Leaf Grimoire', 'grimoire', 'awakened_four', 'Its last pages have finally written themselves.'),
    item('grimoire_five', 'Five-Leaf Grimoire', 'grimoire', 'five_leaf', 'A black book with a devil in the fifth leaf.'),
    item('grimoire_ascended', 'Ascended Five-Leaf Grimoire', 'grimoire', 'ascended_five', 'Owner and devil have come to terms, and the book holds both.'),
    // Swords, daggers and spears.
    item('training_sword', 'Training Sword', 'sword', 'training', 'A blunt practice blade from the Magic Knights\' yard.'),
    item('knight_sword', 'Magic Knight\'s Sword', 'sword', 'common', 'The plain issued sidearm of a Magic Knight.'),
    item('steel_longsword', 'Steel Longsword', 'sword', 'steel'),
    item('silver_rapier', 'Silver Rapier', 'sword', 'silver', 'A noble\'s blade, light and quick.', { power: -1, hit: 1, crit: 5 }),
    item('iron_dagger', 'Iron Dagger', 'dagger', 'iron'),
    item('bronze_spear', 'Bronze Spear', 'spear', 'bronze'),
    item('steel_halberd', 'Steel Halberd', 'spear', 'steel', 'A long polearm for holding a line.', { power: 1, hit: -1 }),
    // Bows and gauntlets.
    item('hunting_bow', 'Hunting Bow', 'bow', 'common'),
    item('silver_longbow', 'Silver Longbow', 'bow', 'silver'),
    item('iron_gauntlets', 'Iron Gauntlets', 'gauntlets', 'iron'),
    item('steel_gauntlets', 'Steel Gauntlets', 'gauntlets', 'steel'),
    // Anti-magic blades (the Anti-Magic arts need one in hand).
    item('anti_magic_shard', 'Anti-Magic Shard Blade', 'anti_magic_blade', 'iron', 'A short blade cut from an anti-magic sword. Turns small spells aside.'),
    item('demon_destroyer', 'Demon-Destroyer Sword', 'anti_magic_blade', 'silver', 'A thin anti-magic blade that cuts magic and can heal what magic has done.'),
    item('demon_dweller', 'Demon-Dweller Sword', 'anti_magic_blade', 'relic', 'A katana of anti-magic that draws spells toward it and sends them back.'),
    item('demon_slayer', 'Demon-Slayer Sword', 'anti_magic_blade', 'relic', 'A huge, rough anti-magic blade that negates any spell it touches.', { power: 1 }),
];

/**
 * Ordinary weapons, Fire Emblem style: every ordinary kind at every metal from Training to Silver,
 * so a fighter can be handed a plain weapon of any grade. Hero Relic is left to named weapons. A
 * named piece above already at that kind and tier takes the place of the plain one.
 */
export const BC_ORDINARY_KINDS = Object.freeze(['sword', 'dagger', 'spear', 'bow', 'gauntlets']);
export const BC_ORDINARY_TIERS = Object.freeze(['training', 'bronze', 'iron', 'steel', 'silver']);
const KIND_WORD = { sword: 'Sword', dagger: 'Dagger', spear: 'Spear', bow: 'Bow', gauntlets: 'Gauntlets' };
const TIER_WORD = { training: 'Training', bronze: 'Bronze', iron: 'Iron', steel: 'Steel', silver: 'Silver' };

const ordinary = BC_ORDINARY_KINDS.flatMap(kind => BC_ORDINARY_TIERS
    .filter(tier => !NAMED.some(i => i.kind === kind && i.tier === tier))
    .map(tier => item(`${tier}_${kind}`, `${TIER_WORD[tier]} ${KIND_WORD[kind]}`, kind, tier)));

/** The world's built-in Armoury: grimoires at every step, ordinary weapons at every metal, and the named blades. */
export const BC_CATALOGUE = Object.freeze([...NAMED, ...ordinary]);

export const BC_GEAR = {
    version: 1,
    ladders: {
        default: { label: 'Tier', defaultTier: 'common', tiers: GENERIC_TIERS },
        grimoire: { label: 'Grimoire', defaultTier: 'three_leaf', tiers: BC_GRIMOIRE_TIERS },
    },
    kinds: [
        { id: 'sword', label: 'Sword', slot: 'hand', hands: 1, dualable: true, range: 'melee', ladder: 'default', prof: 'hand_to_hand', channel: 'physical', power: 2, hit: 0, weight: 5, verb: 'slashes' },
        { id: 'dagger', label: 'Dagger', slot: 'hand', hands: 1, dualable: true, range: 'melee', ladder: 'default', prof: 'hand_to_hand', channel: 'physical', power: 0, hit: 1, weight: 2, verb: 'stabs' },
        { id: 'spear', label: 'Spear', slot: 'hand', hands: 2, dualable: false, range: 'melee', ladder: 'default', prof: 'hand_to_hand', channel: 'physical', power: 3, hit: 0, weight: 7, verb: 'thrusts at' },
        { id: 'bow', label: 'Bow', slot: 'hand', hands: 2, dualable: false, range: 'ranged', ladder: 'default', prof: 'hand_to_hand', channel: 'physical', power: 2, hit: 0, weight: 4, verb: 'looses an arrow at' },
        { id: 'gauntlets', label: 'Gauntlets', slot: 'hand', hands: 1, dualable: true, range: 'melee', ladder: 'default', prof: 'hand_to_hand', channel: 'physical', power: 1, hit: 0, weight: 3, verb: 'punches' },
        { id: 'anti_magic_blade', label: 'Anti-Magic Blade', slot: 'hand', hands: 1, dualable: true, range: 'melee', ladder: 'default', prof: 'hand_to_hand', channel: 'physical', power: 3, hit: 0, weight: 9, verb: 'cleaves' },
        { id: 'fists', label: 'Fists', slot: 'natural', hands: 0, dualable: false, range: 'melee', ladder: 'default', prof: 'hand_to_hand', channel: 'physical', power: 0, hit: 0, weight: 0, verb: 'strikes' },
        { id: 'grimoire', label: 'Grimoire', slot: 'focus', hands: 0, dualable: false, range: 'ranged', ladder: 'grimoire', prof: 'mana_control', channel: 'magic', power: 0, hit: 0, weight: 1, verb: 'casts at' },
    ],
    tools: [
        { id: 'healing_potion', label: 'Healing potion', uses: 1, verb: 'drinks', effect: { type: 'heal', share: 0.25, area: 'self', fightOnly: true } },
        { id: 'magic_stone_shard', label: 'Magic stone shard', uses: 2, verb: 'cracks', effect: { type: 'damage', power: 4, area: 'one', range: 'ranged' } },
        { id: 'smoke_orb', label: 'Smoke orb', uses: 1, verb: 'hurls', effect: { type: 'smoke', flee: 35, hit: -3, turns: 1, area: 'side' } },
        { id: 'flash_stone', label: 'Flash stone', uses: 1, verb: 'throws', effect: { type: 'blind', hit: -4, turns: 2, chance: 70, area: 'one' } },
        { id: 'sealing_tag', label: 'Sealing tag', uses: 1, verb: 'slaps on', effect: { type: 'stun', turns: 1, chance: 55, area: 'one' } },
    ],
    catalogue: BC_CATALOGUE,
    unarmed: 'fists',
};
