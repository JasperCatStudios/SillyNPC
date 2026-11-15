import { ladderOf, rungIndex } from './combat-roles.js';
import { emptyTypeData, normalizeCombatBlock, normalizeWeapon } from './combat-store.js';
import { isStatus } from './combat-status.js';
import { MAX_ABILITIES } from './combat-abilities.js';
import { applyXp, readLevel, hasLevelMeta, XP_PER_LEVEL } from './combat-level.js';

/**
 * Editing a character's combat data by hand (fork).
 *
 * Every function takes a record (a character or the player card) and a world type, changes one
 * thing, and says what happened. Values are stored under the type's immutable ids. Out-of-scale
 * numbers are accepted and flagged rather than refused: a boss may well exceed the scale.
 * Changes leave a history entry, and repeated edits of the same field within a minute are
 * folded into one so typing does not flood it.
 *
 * Pure: no DOM, no SillyTavern imports. The caller saves settings.
 */

const FOLD_MS = 60_000;
const HISTORY_CAP = 50;

/** The record's data for this type, created (with the block around it) if it is not there yet. */
export function ensureTypeData(record, dataKey) {
    if (!record.combat || typeof record.combat !== 'object') record.combat = normalizeCombatBlock(undefined);
    if (!record.combat.types) record.combat.types = {};
    if (!record.combat.types[dataKey]) record.combat.types[dataKey] = emptyTypeData();
    return record.combat.types[dataKey];
}

function log(data, target, from, to, at) {
    const last = data.history[data.history.length - 1];
    if (last && last.kind === 'edit' && last.target === target && at - last.at < FOLD_MS) {
        last.to = to;
        last.at = at;
        return;
    }
    data.history.push({ at, kind: 'edit', target, from, to });
    if (data.history.length > HISTORY_CAP) data.history.splice(0, data.history.length - HISTORY_CAP);
}

const blank = (v) => v === '' || v === null || v === undefined;

/**
 * @param {object} record
 * @param {object} type
 * @param {string} id A stat id of the type.
 * @param {number|string|null} value Blank removes the value.
 * @returns {{ ok: boolean, reason?: string, from?: any, to?: any, outOfScale?: boolean }}
 */
export function setStat(record, type, id, value, at = Date.now()) {
    const stat = type.stats.find(s => s.id === id);
    if (!stat) return { ok: false, reason: 'That type has no such stat.' };

    if (blank(value)) {
        const data = record.combat?.types?.[type.dataKey];
        if (!data || data.stats[id] === undefined) return { ok: true, from: null, to: null };
        const from = data.stats[id];
        delete data.stats[id];
        log(data, `stats.${id}`, from, null, at);
        return { ok: true, from, to: null };
    }
    const n = Number(value);
    if (!Number.isFinite(n)) return { ok: false, reason: 'A stat must be a number.' };

    const data = ensureTypeData(record, type.dataKey);
    const from = data.stats[id] ?? null;
    if (from !== n) {
        data.stats[id] = n;
        log(data, `stats.${id}`, from, n, at);
    }
    const scale = stat.scale;
    const outOfScale = Boolean(scale && (n < scale.min || n > scale.max));
    return { ok: true, from, to: n, outOfScale };
}

/** @returns {{ ok: boolean, reason?: string, from?: any, to?: any }} */
export function setMeta(record, type, id, value, at = Date.now()) {
    const meta = type.meta.find(m => m.id === id);
    if (!meta) return { ok: false, reason: 'That type has no such field.' };

    let next;
    if (blank(value)) next = null;
    else if (meta.type === 'number') {
        next = Number(value);
        if (!Number.isFinite(next)) return { ok: false, reason: `${meta.label} must be a number.` };
    } else if (meta.type === 'choice') {
        if (!(meta.options || []).includes(value)) return { ok: false, reason: `${meta.label} must be one of its choices.` };
        next = String(value);
    } else {
        next = String(value);
    }

    const existing = record.combat?.types?.[type.dataKey];
    if (next === null && (!existing || existing.meta[id] === undefined)) return { ok: true, from: null, to: null };
    const data = ensureTypeData(record, type.dataKey);
    const from = data.meta[id] ?? null;
    if (from === next) return { ok: true, from, to: next };
    if (next === null) delete data.meta[id];
    else data.meta[id] = next;
    log(data, `meta.${id}`, from, next, at);
    return { ok: true, from, to: next };
}

/**
 * Sets or clears a proficiency's rank. A blank rank clears it; the XP is kept if there is any.
 * @returns {{ ok: boolean, reason?: string, from?: any, to?: any }}
 */
export function setRank(record, type, profId, rank, at = Date.now()) {
    const prof = type.proficiencies.find(p => p.id === profId);
    if (!prof) return { ok: false, reason: 'That type has no such proficiency.' };
    const ladder = ladderOf(type, prof.ladder);

    let next = null;
    if (!blank(rank)) {
        const idx = rungIndex(ladder, rank);
        if (idx < 0) return { ok: false, reason: `${rank} is not on the ${prof.label} ladder.` };
        next = ladder.rungs[idx];
    }

    const existing = record.combat?.types?.[type.dataKey];
    if (next === null && !existing?.profs?.[profId]) return { ok: true, from: null, to: null };
    const data = ensureTypeData(record, type.dataKey);
    const held = data.profs[profId];
    const from = held?.rank ?? null;
    if (from === next) return { ok: true, from, to: next };
    if (next === null) {
        if (held && held.xp) held.rank = null;
        else delete data.profs[profId];
    } else {
        data.profs[profId] = { rank: next, xp: held?.xp || 0 };
    }
    log(data, `profs.${profId}`, from, next, at);
    return { ok: true, from, to: next };
}

/** Removes one value from the unknown bucket. */
export function removeUnknown(record, type, key, at = Date.now()) {
    const data = record.combat?.types?.[type.dataKey];
    if (!data || data.unknown[key] === undefined) return { ok: false };
    const from = data.unknown[key];
    delete data.unknown[key];
    log(data, `unknown.${key}`, from, null, at);
    return { ok: true, from };
}

/**
 * Writes the current value of each pool after a blow. No history entry: a fight logs itself,
 * and a pool ticking down every exchange would flood the edit history. Unknown roles are ignored.
 *
 * @param {object} record
 * @param {object} type
 * @param {Record<string, number>} currents role -> current value
 * @returns {string[]} Roles that changed.
 */
export function setPoolCurrents(record, type, currents) {
    const known = new Set((type?.pools || []).map(p => p.role));
    const data = ensureTypeData(record, type.dataKey);
    const changed = [];
    for (const [role, cur] of Object.entries(currents || {})) {
        if (!known.has(role)) continue;
        const next = Math.max(0, Math.round(Number(cur)));
        if (!Number.isFinite(next) || data.pools[role] === next) continue;
        data.pools[role] = next;
        changed.push(role);
    }
    return changed;
}

/** Writes a level where the type keeps it. */
function writeLevel(data, type, level) {
    if (hasLevelMeta(type)) data.meta.level = level; else data.level = level;
}

/**
 * Gives XP. Filling the bar raises the level by one each time, and the level goes where the
 * type keeps it. Returns what happened, for showing.
 */
export function addXp(record, type, gain, at = Date.now()) {
    const data = ensureTypeData(record, type.dataKey);
    const before = { level: readLevel(type, data), xp: data.xp || 0 };
    const next = applyXp(before.level, before.xp, gain);
    data.xp = next.xp;
    writeLevel(data, type, next.level);
    log(data, 'xp', `${before.xp}`, `${next.xp}`, at);
    return { ok: true, gained: Math.max(0, Math.floor(Number(gain)) || 0), level: next.level, xp: next.xp, levelsGained: next.levelsGained };
}

/** Sets the progress toward the next level by hand, 0 to 199. */
export function setXp(record, type, xp, at = Date.now()) {
    const data = ensureTypeData(record, type.dataKey);
    const next = Math.max(0, Math.min(XP_PER_LEVEL - 1, Math.floor(Number(xp)) || 0));
    if ((data.xp || 0) !== next) { log(data, 'xp', `${data.xp || 0}`, `${next}`, at); data.xp = next; }
    return { ok: true, xp: next };
}

/** Sets the level by hand. */
export function setLevel(record, type, level, at = Date.now()) {
    const data = ensureTypeData(record, type.dataKey);
    const next = Math.max(1, Math.floor(Number(level)) || 1);
    const from = readLevel(type, data);
    if (from !== next) { log(data, 'level', `${from}`, `${next}`, at); writeLevel(data, type, next); }
    return { ok: true, level: next };
}

/** Sets which of the type's abilities the character has. Unknown ids are refused. */
export function setAbilities(record, type, ids, at = Date.now()) {
    const known = new Set((type.abilities || []).map(a => a.id));
    const next = [...new Set((ids || []).map(String))].filter(id => known.has(id));
    if (next.length > MAX_ABILITIES) return { ok: false, reason: `At most ${MAX_ABILITIES} abilities can be equipped.` };
    const data = ensureTypeData(record, type.dataKey);
    const from = [...(data.abilities || [])];
    if (JSON.stringify(from) !== JSON.stringify(next)) {
        data.abilities = next;
        log(data, 'abilities', from.join(', ') || null, next.join(', ') || null, at);
    }
    return { ok: true, from, to: next };
}

/** Sets the condition grade (E- near death ... S+ healthy). Blank clears it, which reads as S+. */
export function setStatus(record, type, grade, at = Date.now()) {
    const next = grade === '' || grade === null || grade === undefined ? null : String(grade);
    if (next !== null && !isStatus(next)) return { ok: false, reason: 'That is not a status grade.' };
    const data = ensureTypeData(record, type.dataKey);
    const from = data.status ?? null;
    if (from !== next) {
        data.status = next;
        log(data, 'status', from, next, at);
    }
    return { ok: true, from, to: next };
}

/** Sets what the character fights with. All blank clears it. */
export function setWeapon(record, type, weapon, at = Date.now()) {
    const next = normalizeWeapon(weapon);
    if (next?.prof && !(type.proficiencies || []).some(p => p.id === next.prof)) {
        return { ok: false, reason: 'That type has no such proficiency.' };
    }
    const data = ensureTypeData(record, type.dataKey);
    const from = data.weapon || null;
    data.weapon = next;
    log(data, 'weapon', from, next, at);
    return { ok: true, from, to: next };
}

/** The proficiencies worth showing for a character under a type: its skill card, plus any it holds. */
export function visibleProfs(type, data) {
    const cards = type.skillCards;
    const faction = data?.meta?.faction;
    const card = cards && faction && Array.isArray(cards[faction]) ? new Set(cards[faction]) : null;
    return type.proficiencies.filter(p => !card || card.has(p.id) || data?.profs?.[p.id]?.rank);
}
