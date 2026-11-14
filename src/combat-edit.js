import { ladderOf, rungIndex } from './combat-roles.js';
import { emptyTypeData, normalizeCombatBlock } from './combat-store.js';

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

/** The proficiencies worth showing for a character under a type: its skill card, plus any it holds. */
export function visibleProfs(type, data) {
    const cards = type.skillCards;
    const faction = data?.meta?.faction;
    const card = cards && faction && Array.isArray(cards[faction]) ? new Set(cards[faction]) : null;
    return type.proficiencies.filter(p => !card || card.has(p.id) || data?.profs?.[p.id]?.rank);
}
