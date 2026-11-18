import { ladderOf, rungIndex } from './combat-roles.js';
import { normalizeStyle } from './combat-style.js';
import { isStatus } from './combat-status.js';
import { normalizeCharGear } from './combat-gear.js';

/**
 * A character's combat data (fork): char.combat, on character records and the player card.
 *
 *   char.combat = {
 *     version: 2,
 *     types: { <dataKey>: { stats, meta, profs: { id: { rank, xp } }, pools, growth, unknown, history } },
 *     conditions: [], dead: false,
 *   }
 *
 * Values are stored under the world type's immutable stat and proficiency ids. Labels and
 * role bindings are never stored on the character, so renaming "HP" to "Vitality" touches no
 * character data.
 *
 * Nothing here creates a block on its own: a character with no combat data keeps no block,
 * and readers get an empty shape. Systems swap whole casts without normalising, so every
 * reader has to cope with a missing block anyway.
 *
 * Pure: no DOM, no SillyTavern imports.
 */

const HISTORY_CAP = 50;
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

/** An empty block for one type. A fresh object every time, so callers may edit it. */
export function emptyTypeData() {
    return { stats: {}, meta: {}, profs: {}, pools: {}, growth: {}, unknown: {}, history: [], weapon: null, status: null, abilities: [], xp: 0, level: null };
}

/** What a character fights with: a name, the proficiency it uses, and a power bonus. Null when unset. */
export function normalizeWeapon(raw) {
    const w = obj(raw);
    const name = String(w.name ?? '').trim();
    const prof = String(w.prof ?? '').trim();
    const power = Number(w.power) || 0;
    return name || prof || power ? { name, prof, power } : null;
}

/** The most level XP a card can hold. Matches normalizeLeveling's xpBase limit. */
export const XP_CEILING = 1000000;

function normalizeTypeData(raw) {
    const d = obj(raw);
    const out = emptyTypeData();
    out.stats = { ...obj(d.stats) };
    out.meta = { ...obj(d.meta) };
    out.profs = {};
    for (const [id, held] of Object.entries(obj(d.profs))) {
        const h = obj(held);
        out.profs[id] = { rank: h.rank ?? null, xp: Number(h.xp) || 0 };
    }
    out.pools = { ...obj(d.pools) };
    out.growth = { ...obj(d.growth) };
    out.unknown = { ...obj(d.unknown) };
    out.history = Array.isArray(d.history) ? d.history.slice(-HISTORY_CAP) : [];
    if (d.source && typeof d.source === 'object') out.source = { ...d.source };
    out.weapon = normalizeWeapon(d.weapon);
    // Gear is absent until something writes it (see combat-edit.js); reading never adds it, so a
    // save is unchanged. The old weapon above is read as one item when there is no gear.
    const gear = normalizeCharGear(d.gear);
    if (gear) out.gear = gear;
    out.status = isStatus(d.status) ? d.status : null;
    // A ceiling only for nonsense: a world's xpBase can be far above 200, and the XP held is below that level's need.
    out.xp = Math.max(0, Math.min(XP_CEILING, Math.floor(Number(d.xp)) || 0));
    out.level = Number(d.level) >= 1 ? Math.floor(Number(d.level)) : null;
    // A combat style written on the character (combat-style.js); absent means the default for their sheet.
    const style = normalizeStyle(d.style);
    if (style) out.style = style;
    out.abilities = Array.isArray(d.abilities) ? [...new Set(d.abilities.map(String))] : [];
    // Abilities reached through proficiency ranks; absent until one is (see activity-progress-core.js).
    if (Array.isArray(d.unlocked) && d.unlocked.length) out.unlocked = [...new Set(d.unlocked.map(String))];
    return out;
}

/** Repairs an existing block. Idempotent; does not add data that is not there. */
export function normalizeCombatBlock(raw) {
    const b = obj(raw);
    const types = {};
    for (const [key, data] of Object.entries(obj(b.types))) types[key] = normalizeTypeData(data);
    return {
        version: 2,
        types,
        conditions: Array.isArray(b.conditions) ? b.conditions.filter(c => c && typeof c === 'object') : [],
        dead: Boolean(b.dead),
    };
}

/**
 * A character's combat block as it travels in a character file: the sheet and the gear, without
 * the edit history (timestamps of this machine) or the leftovers the type could not place.
 * Null when there is nothing to send.
 */
export function portableCombat(raw) {
    const block = normalizeCombatBlock(raw);
    const types = {};
    for (const [key, data] of Object.entries(block.types)) {
        const copy = structuredClone(data);
        copy.history = [];
        copy.unknown = {};
        delete copy.source;
        types[key] = copy;
    }
    return Object.keys(types).length ? { ...block, types, conditions: [], dead: false } : null;
}

/** The data for one type, read-only: an empty shape when the record has none. Never mutates. */
export function getTypeData(record, dataKey) {
    const held = record?.combat?.types?.[dataKey];
    return held ? normalizeTypeData(held) : emptyTypeData();
}

export function hasTypeData(record, dataKey) {
    const held = record?.combat?.types?.[dataKey];
    return Boolean(held && (Object.keys(obj(held.stats)).length || Object.keys(obj(held.profs)).length
        || Object.keys(obj(held.meta)).length));
}

/** Index of a rank on its proficiency's ladder, or -1. */
export function rankIndex(type, profId, rank) {
    const prof = (type?.proficiencies || []).find(p => p.id === profId);
    return prof ? rungIndex(ladderOf(type, prof.ladder), rank) : -1;
}
