import { ROLE_SCHEMA_VERSION } from './combat-roles.js';
import { FE_ABILITIES } from './combat-abilities-fe.js';
import { BLEACH_ABILITIES } from './combat-abilities-bleach.js';
import { FE_GEAR } from './combat-gear-fe.js';
import { FE_CLASSES } from './combat-classes-fe.js';
import { BLEACH_GEAR } from './combat-gear-bleach.js';

/**
 * The combat world types that ship with the extension (fork).
 *
 * Data, not code: the engine reads roles, and these say which stat fills each one. Duplicate
 * one to make your own. Frozen, so nothing can edit a built-in by accident.
 *
 * The Bleach numbers are original, in the proportions of the series, and are not quoted from
 * any databook. The Fire Emblem ranks and the weapon triangle follow the series.
 *
 * Pure: no DOM, no SillyTavern imports.
 */

function deepFreeze(obj) {
    if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
        Object.freeze(obj);
        for (const v of Object.values(obj)) deepFreeze(v);
    }
    return obj;
}

/* ------------------------------------------------------------------ Fire Emblem */

const FE = {
    format: 'sillynpc-combat-type',
    version: 2,
    roleSchema: ROLE_SCHEMA_VERSION,
    id: 'fe',
    name: 'Fire Emblem',
    builtin: true,
    dataKey: 'fe',
    description: 'Weapon ranks E- to S+, the weapon triangle, d20 bands. Stats on 0 to 100.',
    stats: [
        { id: 'hp', label: 'Hit Points', abbr: 'HP', scale: { min: 0, max: 100 }, default: 30, aliases: ['HP'] },
        { id: 'str', label: 'Strength', abbr: 'STR', scale: { min: 0, max: 100 }, default: 20 },
        { id: 'mag', label: 'Magic', abbr: 'MAG', scale: { min: 0, max: 100 }, default: 20 },
        { id: 'dex', label: 'Dexterity', abbr: 'DEX', scale: { min: 0, max: 100 }, default: 20 },
        { id: 'spd', label: 'Speed', abbr: 'SPD', scale: { min: 0, max: 100 }, default: 20 },
        { id: 'ini', label: 'Initiative', abbr: 'INI', scale: { min: 0, max: 100 }, default: 20, defaultFrom: 'spd', aliases: ['Initiative'] },
        { id: 'lck', label: 'Luck', abbr: 'LCK', scale: { min: 0, max: 100 }, default: 20 },
        { id: 'def', label: 'Defence', abbr: 'DEF', scale: { min: 0, max: 100 }, default: 20 },
        { id: 'res', label: 'Resistance', abbr: 'RES', scale: { min: 0, max: 100 }, default: 20 },
        { id: 'cha', label: 'Charm', abbr: 'CHA', scale: { min: 0, max: 100 }, default: 20 },
    ],
    meta: [
        { id: 'class', label: 'Class', type: 'choice', options: FE_CLASSES, aliases: ['Class'] },
        { id: 'level', label: 'Level', type: 'number', min: 1, max: 40, default: 1, aliases: ['Level'] },
    ],
    modifier: { type: 'linear', center: 50, per: 10 },
    channels: [{ id: 'physical', label: 'Physical' }, { id: 'magic', label: 'Magic' }],
    roles: {
        attack: { physical: 'stat.str', magic: 'stat.mag' },
        defense: { physical: 'stat.def', magic: 'stat.res' },
        speed: 'stat.spd',
        initiative: 'stat.ini',
        accuracy: 'stat.dex',
        evasion: 'stat.spd + stat.lck/2',
        luck: 'stat.lck',
        presence: 'stat.cha',
        level: 'meta.level',
        class: 'meta.class',
    },
    pools: [
        { role: 'health', label: 'HP', abbr: 'HP', max: 'stat.hp', color: '#c0392b' },
        { role: 'guard', label: 'Energy', abbr: 'EN', max: '20 + stat.hp/5', color: '#2e86c1' },
    ],
    ladders: {
        rank: {
            rungs: ['E-', 'E', 'E+', 'D', 'D+', 'C', 'C+', 'B', 'B+', 'A', 'A+', 'S', 'S+'],
            zeroAt: 'E',
            bonusPerRung: 1,
        },
    },
    proficiencies: [
        { id: 'sword', label: 'Sword', ladder: 'rank', roles: ['weapon'], channel: 'physical', tags: ['melee', 'red'] },
        { id: 'lance', label: 'Lance', ladder: 'rank', roles: ['weapon'], channel: 'physical', tags: ['melee', 'blue'] },
        { id: 'axe', label: 'Axe', ladder: 'rank', roles: ['weapon'], channel: 'physical', tags: ['melee', 'green'] },
        { id: 'bow', label: 'Bow', ladder: 'rank', roles: ['weapon'], channel: 'physical', tags: ['ranged', 'bow'] },
        { id: 'brawling', label: 'Brawling', ladder: 'rank', roles: ['weapon'], channel: 'physical', tags: ['melee'] },
        { id: 'reason', label: 'Reason', ladder: 'rank', roles: ['magic'], channel: 'magic', tags: ['ranged', 'tome'] },
        { id: 'faith', label: 'Faith', ladder: 'rank', roles: ['magic', 'heal'], channel: 'magic', tags: ['tome'] },
        { id: 'authority', label: 'Authority', ladder: 'rank', roles: ['support'], channel: 'physical', rollRole: 'presence' },
        { id: 'riding', label: 'Riding', ladder: 'rank', roles: ['passive', 'movement'], grantsTag: { tag: 'mounted', from: 'C' } },
        { id: 'flying', label: 'Flying', ladder: 'rank', roles: ['passive', 'movement'], grantsTag: { tag: 'flying', from: 'C' } },
        { id: 'heavyArmor', label: 'Heavy Armor', ladder: 'rank', roles: ['passive', 'defense'], grantsTag: { tag: 'armored', from: 'C' } },
    ],
    skillCards: null,
    /* The weapon triangle: red beats green beats blue beats red. */
    advantage: [
        { if: "has(a,'red') && has(d,'green')", hit: 2, dmgMult: 1.2, label: 'Weapon triangle' },
        { if: "has(a,'green') && has(d,'blue')", hit: 2, dmgMult: 1.2, label: 'Weapon triangle' },
        { if: "has(a,'blue') && has(d,'red')", hit: 2, dmgMult: 1.2, label: 'Weapon triangle' },
        { if: "has(a,'bow') && has(d,'flying')", hit: 0, dmgMult: 1.2, label: 'Bow against flyers' },
        { if: "has(a,'tome') && has(d,'armored')", hit: 0, dmgMult: 1.2, label: 'Magic against armour' },
    ],
    actions: [
        { key: 'iron_sword', label: 'Iron Sword', prof: 'sword', power: 5 },
        { key: 'iron_lance', label: 'Iron Lance', prof: 'lance', power: 5 },
        { key: 'iron_axe', label: 'Iron Axe', prof: 'axe', power: 6 },
        { key: 'iron_bow', label: 'Iron Bow', prof: 'bow', power: 5 },
        { key: 'fire', label: 'Fire', prof: 'reason', power: 5, cost: { pool: 'guard', amount: 0 } },
    ],
    abilities: FE_ABILITIES,
    gear: FE_GEAR,
    resolution: {
        mode: 'threshold',
        roll: 'd20 + diff + (a.prof.bonus - d.prof.bonus) + (a.speed >= d.speed + 15 ? 2 : (a.speed <= d.speed - 15 ? -2 : 0)) + a.mod.accuracy - d.mod.evasion + adv.hit',
        bands: [
            { upTo: 5, result: 'miss' },
            { upTo: 14, result: 'hit' },
            { upTo: 19, result: 'strong' },
            { upTo: 999, result: 'crit' },
        ],
        natural: { 1: 'miss', 20: 'crit' },
        damage: 'max(1, round((act.power + a.attack/3) * adv.dmgMult * band.mult - d.defense/3))',
        bandMult: { miss: 0, hit: 1, strong: 1.5, crit: 2 },
        initiative: 'a.initiative + d10',
        // Speed over the opponent's is the chance to strike twice.
        followUpChance: 'clamp((a.speed - d.speed) * 0.8, 0, 50)',
        difficulty: [
            { level: 1, mod: 1 }, { level: 2, mod: 0 }, { level: 3, mod: 0 },
            { level: 4, mod: -1 }, { level: 5, mod: -2 },
        ],
    },
    stakes: { injuries: false, death: false },
};

/* ----------------------------------------------------------------------- Bleach */

/** [id, label, roles, channel, rollRole, aliases] */
const BLEACH_PROFS = [
    ['zanjutsu', 'Zanjutsu', ['weapon'], 'physical', 'attack', ['Zanjutsu']],
    ['hakuda', 'Hakuda', ['weapon'], 'physical', 'attack', ['Hand-to-Hand']],
    ['hand_to_hand', 'Hand-to-Hand', ['weapon'], 'physical', 'attack', []],
    ['hierro', 'Hierro', ['defense'], 'physical', 'defense', []],
    ['durability', 'Durability', ['defense'], 'physical', 'defense', ['Defensive Resilience']],
    ['hoho', 'Hohō', ['movement'], 'physical', 'speed', ['Hoho', 'Shunpo']],
    ['sonido', 'Sonído', ['movement'], 'physical', 'speed', ['Sonido']],
    ['hirenkyaku', 'Hirenkyaku', ['movement'], 'physical', 'speed', []],
    ['mod_speed', 'Speed', ['movement'], 'physical', 'speed', []],
    ['mod_strength', 'Strength', ['weapon'], 'physical', 'attack', []],
    ['kido', 'Kidō – General', ['magic'], 'spiritual', 'attack', ['Kido', 'Kido (General)', 'Kidō', 'Kido - General']],
    ['bakudo', 'Bakudō', ['magic', 'support'], 'spiritual', 'attack', ['Bakudo']],
    ['healing_kido', 'Healing Kidō', ['magic', 'heal'], 'spiritual', 'attack', ['Healing Kido']],
    ['cero', 'Cero', ['magic'], 'spiritual', 'attack', []],
    ['bala', 'Bala', ['magic'], 'spiritual', 'attack', []],
    ['gintou', 'Gintō Usage', ['magic'], 'spiritual', 'attack', ['Ginto', 'Gintō']],
    ['reishi_manipulation', 'Reishi Manipulation', ['magic'], 'spiritual', 'attack', []],
    ['reiatsu_manipulation', 'Reiatsu Manipulation', ['magic'], 'spiritual', 'attack', []],
    ['archery', 'Archery', ['weapon'], 'spiritual', 'accuracy', []],
    ['aim_precision', 'Aim & Precision', ['support'], 'spiritual', 'accuracy', ['Aim and Precision']],
    ['pesquisa', 'Pesquisa', ['support'], 'spiritual', 'awareness', []],
    ['sensory', 'Sensory', ['support'], 'spiritual', 'awareness', []],
    ['strategic_analysis', 'Strategic Analysis', ['support'], 'spiritual', 'awareness', []],
    ['spiritual_awareness', 'Spiritual Awareness', ['support'], 'spiritual', 'awareness', []],
    ['combat_instinct', 'Combat Instinct', ['support'], 'physical', 'awareness', []],
    ['fullbring_control', 'Fullbring Control', ['magic'], 'spiritual', 'attack', []],
    ['object_resonance', 'Object Resonance', ['support'], 'spiritual', 'attack', []],
    ['combat_adaptation', 'Combat Adaptation', ['support'], 'physical', 'awareness', []],
    ['reiryoku_sensitivity', 'Reiryoku Sensitivity', ['support'], 'spiritual', 'awareness', []],
    ['barrier_generation', 'Barrier Generation', ['defense', 'magic'], 'spiritual', 'defense', []],
    ['healing_restoration', 'Healing/Restoration', ['heal', 'magic'], 'spiritual', 'attack', []],
    ['spiritual_projection', 'Spiritual Projection', ['magic'], 'spiritual', 'attack', []],
    ['defensive_resilience', 'Defensive Resilience', ['defense'], 'physical', 'defense', []],
];

const SHINIGAMI = ['bakudo', 'kido', 'hoho', 'hakuda', 'zanjutsu', 'healing_kido'];

const BLEACH = {
    format: 'sillynpc-combat-type',
    version: 2,
    roleSchema: ROLE_SCHEMA_VERSION,
    id: 'bleach',
    name: 'Bleach',
    builtin: true,
    dataKey: 'bleach',
    description: 'Reiatsu-driven opposed rolls, grades E to SS, faction skill cards. Stats on 0 to 100.',
    stats: [
        { id: 'offense', label: 'Offense', abbr: 'OFF', scale: { min: 0, max: 100 }, default: 40, aliases: ['Attack'] },
        { id: 'defense', label: 'Defense', abbr: 'DEF', scale: { min: 0, max: 100 }, default: 40 },
        { id: 'mobility', label: 'Mobility', abbr: 'MOB', scale: { min: 0, max: 100 }, default: 40 },
        { id: 'initiative', label: 'Initiative', abbr: 'INI', scale: { min: 0, max: 100 }, default: 40, defaultFrom: 'mobility' },
        { id: 'kido', label: 'Kidō', abbr: 'KID', scale: { min: 0, max: 100 }, default: 40, aliases: ['Kido'] },
        { id: 'intellect', label: 'Intellect', abbr: 'INT', scale: { min: 0, max: 100 }, default: 40 },
        { id: 'endurance', label: 'Endurance', abbr: 'END', scale: { min: 0, max: 100 }, default: 40 },
        { id: 'reiatsu', label: 'Reiatsu', abbr: 'REI', scale: { min: 0, max: 100 }, default: 40 },
    ],
    meta: [
        { id: 'level', label: 'Level', type: 'number', min: 1, max: 99, default: 1, aliases: ['Level'] },
        { id: 'tier', label: 'Tier', type: 'choice', options: ['S', 'A', 'B', 'C', 'D'], default: 'C' },
        {
            id: 'faction', label: 'Faction', type: 'choice', default: 'Shinigami',
            options: ['Shinigami', 'Arrancar', 'Vizard', 'Quincy', 'Mod Soul', 'Fullbringer', 'Spiritual Human'],
        },
    ],
    modifier: {
        type: 'table',
        table: [[10, -3], [25, -2], [40, -1], [60, 0], [75, 1], [85, 2], [95, 3], [1000000, 4]],
    },
    channels: [{ id: 'physical', label: 'Physical' }, { id: 'spiritual', label: 'Spiritual' }],
    roles: {
        attack: { physical: 'stat.offense', spiritual: 'stat.kido*0.7 + stat.reiatsu*0.3' },
        defense: { physical: 'stat.defense', spiritual: 'stat.defense*0.4 + stat.reiatsu*0.6' },
        speed: 'stat.mobility',
        initiative: 'stat.initiative',
        evasion: 'stat.mobility*0.8 + stat.intellect*0.2',
        accuracy: 'stat.intellect*0.5 + stat.mobility*0.5',
        awareness: 'stat.intellect',
        presence: 'stat.reiatsu',
        endurance: 'stat.endurance',
        level: 'meta.level',
        tier: 'meta.tier',
        faction: 'meta.faction',
    },
    pools: [
        { role: 'health', label: 'Spirit Body', abbr: 'SB', max: '40 + stat.endurance*0.6 + stat.defense*0.2', color: '#c0392b' },
        { role: 'resource', label: 'Reiryoku', abbr: 'RYK', max: '20 + stat.reiatsu*0.8', color: '#5dade2' },
        { role: 'guard', label: 'Stamina', abbr: 'STA', max: '20 + stat.endurance*0.6', color: '#58d68d' },
    ],
    ladders: {
        grade: { rungs: ['E', 'D', 'C', 'B', 'A', 'S', 'SS'], zeroAt: 'E', bonusPerRung: 1 },
    },
    proficiencies: BLEACH_PROFS.map(([id, label, roles, channel, rollRole, aliases]) => ({
        id, label, ladder: 'grade', roles, channel, rollRole, aliases,
    })),
    skillCards: {
        Shinigami: SHINIGAMI,
        Arrancar: ['cero', 'bala', 'hierro', 'pesquisa', 'sonido', 'zanjutsu', 'hakuda'],
        Vizard: [...SHINIGAMI, 'cero', 'bala', 'hierro', 'pesquisa', 'sonido'],
        Quincy: ['reishi_manipulation', 'archery', 'hirenkyaku', 'strategic_analysis', 'aim_precision', 'gintou', 'durability', 'hand_to_hand'],
        'Mod Soul': ['mod_speed', 'mod_strength', 'reiatsu_manipulation', 'sensory'],
        Fullbringer: ['fullbring_control', 'object_resonance', 'combat_adaptation', 'reiatsu_manipulation', 'spiritual_awareness', 'durability', 'hand_to_hand'],
        'Spiritual Human': ['reiryoku_sensitivity', 'barrier_generation', 'healing_restoration', 'spiritual_projection', 'combat_instinct', 'defensive_resilience'],
    },
    /* Reading the Combat-Bleach lore table (six stats, 1 to 15) into this type. An approximation:
       the lore has no Kidō or Intellect as such, so Intelligence feeds Kidō and Wisdom Intellect. */
    loreImport: {
        statMap: {
            CON: ['endurance', 'defense'], STR: ['offense'], DEX: ['mobility', 'initiative'],
            WIS: ['intellect'], INT: ['kido'], CHA: ['reiatsu'],
        },
        scale: { from: [1, 15], to: [0, 100] },
    },
    advantage: [],
    actions: [
        { key: 'slash', label: 'Slash', prof: 'zanjutsu' },
        { key: 'strike', label: 'Strike', prof: 'hakuda' },
        { key: 'kido_bolt', label: 'Kidō Bolt', prof: 'kido', power: 2, cost: { pool: 'resource', amount: 10 } },
        { key: 'cero', label: 'Cero', prof: 'cero', power: 6, cost: { pool: 'resource', amount: 18 } },
        { key: 'bala', label: 'Bala', prof: 'bala', cost: { pool: 'resource', amount: 5 } },
    ],
    abilities: BLEACH_ABILITIES,
    gear: BLEACH_GEAR,
    resolution: {
        mode: 'opposed',
        roll: 'd20 + diff + a.mod.roll + a.prof.bonus',
        bands: [
            { upTo: 0, result: 'stalemate' },
            { upTo: 4, result: 'hit' },
            { upTo: 9, result: 'strong' },
            { upTo: 999, result: 'crit' },
        ],
        natural: { 20: 'crit' },
        // Power counts here too, so Cero and Getsuga Tenshō hit harder than a plain slash.
        damage: 'max(1, round(band.base + act.power + a.attack*0.25 - d.defense*0.15))',
        bandBase: { stalemate: 0, miss: 0, hit: 6, strong: 10, crit: 16 },
        initiative: 'a.initiative + d10',
        // Speed over the opponent's is the chance to strike twice, for a weaker second blow.
        followUpChance: 'clamp((a.speed - d.speed) * 0.2, 0, 10)',
        followUpMult: 0.5,
        difficulty: [
            { level: 1, mod: 1 }, { level: 2, mod: 0 }, { level: 3, mod: 0 },
            { level: 4, mod: -1 }, { level: 5, mod: -2 },
        ],
    },
    stakes: { injuries: false, death: false },
};

export const BUILTIN_TYPES = deepFreeze({ fe: FE, bleach: BLEACH });
export const BUILTIN_IDS = Object.freeze(Object.keys(BUILTIN_TYPES));
