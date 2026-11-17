import { detectLegacy } from './combat-migrate.js';
import { emptyTypeData, normalizeCombatBlock, getTypeData } from './combat-store.js';

/**
 * Moving combat data into the new block, safely (fork).
 *
 * Planning turns what was found - in the old flat keys, or in a lorebook table - into a list
 * of writes per character, and flags any that would replace a value already there. Applying
 * copies: the old keys are never touched by a migration, only by the separate tidy step. A
 * backup of every record a migration will touch is built first, so it can be undone.
 *
 * Pure: no DOM, no SillyTavern imports. Uploading the backup is src/combat-backup.js.
 */

const getPath = (data, target) => {
    const [group, id] = target.split('.');
    return group === 'profs' ? data.profs?.[id]?.rank : data[group]?.[id];
};

/** True when two stored values mean the same thing. */
const same = (a, b) => ((typeof a === 'number' || typeof b === 'number')
    ? Number(a) === Number(b) : String(a) === String(b));

/**
 * What a migration would write for one character.
 *
 * @typedef {object} PlanItem
 * @property {string} recordId
 * @property {string} name
 * @property {'statusOverrides'|'lore'} source
 * @property {{ target: string, value: (string|number), key?: string }[]} writes
 * @property {string[]} conflicts Targets that already hold a different value. Skipped unless
 *   the caller asks to overwrite.
 * @property {{ key: string, value: any, reason?: string }[]} unknown Kept in the unknown bucket.
 * @property {string[]} skipped Tracker keys left alone.
 */

/** Attaches the conflicts for one record to an item. */
export function withConflicts(record, type, item) {
    const data = getTypeData(record, type.dataKey);
    item.conflicts = item.writes
        .filter(w => {
            const have = getPath(data, w.target);
            return have !== undefined && have !== null && have !== '' && !same(have, w.value);
        })
        .map(w => w.target);
    return item;
}

/** A plan from the old flat keys: one item per character that has any. */
export function planFromLegacy(records, type) {
    const items = [];
    for (const record of records) {
        const found = detectLegacy(record, type);
        if (!found.matches.length) continue;
        items.push(withConflicts(record, type, {
            recordId: record.id,
            name: record.name,
            source: 'statusOverrides',
            writes: found.matches.map(m => ({ target: m.target, value: m.parsed, key: m.key })),
            unknown: found.unknown,
            skipped: found.skipped,
        }));
    }
    return items;
}

/**
 * Copies an item's writes onto the record. Does not touch statusOverrides. A target that holds
 * a different value is kept unless overwrite is set.
 *
 * @returns {{ target: string, from: any, to: any }[]} What actually changed.
 */
export function applyItem(record, type, item, { migrationId, at = Date.now(), overwrite = false } = {}) {
    const block = normalizeCombatBlock(record.combat);
    const data = block.types[type.dataKey] || emptyTypeData();
    block.types[type.dataKey] = data;
    const skip = overwrite ? new Set() : new Set(item.conflicts || []);

    const changes = [];
    for (const w of item.writes) {
        if (skip.has(w.target)) continue;
        const [group, id] = w.target.split('.');
        const from = getPath(data, w.target) ?? null;
        if (from !== null && same(from, w.value)) continue;
        if (group === 'profs') data.profs[id] = { rank: w.value, xp: data.profs[id]?.xp || 0 };
        else data[group][id] = w.value;
        changes.push({ target: w.target, from, to: w.value });
    }
    for (const u of item.unknown || []) {
        if (data.unknown[u.key] === undefined) data.unknown[u.key] = u.value;
    }

    data.source = { kind: item.source, migrationId, at };
    data.history.push({ at, kind: 'migrate', migrationId, changes: changes.length });
    data.history = data.history.slice(-50);
    record.combat = block;
    return changes;
}

/* --------------------------------------------------------------- backup, undo */

/** Everything a migration can change on the records in a plan, copied out before it runs. */
export function buildBackup(records, items, type, { migrationId, at = Date.now() } = {}) {
    const wanted = new Set(items.map(i => i.recordId));
    return {
        format: 'worldkit-combat-backup',
        version: 1,
        migrationId,
        typeId: type.id,
        dataKey: type.dataKey,
        at,
        records: records.filter(r => wanted.has(r.id)).map(r => ({
            id: r.id,
            name: r.name,
            statusOverrides: structuredClone(r.statusOverrides || {}),
            combat: r.combat === undefined ? null : structuredClone(r.combat),
        })),
    };
}

/**
 * Puts records back as the backup found them: any old keys changed since, and the combat block -
 * but only where nothing was edited after the migration (its entry is still the newest in that
 * type's history). Anything edited since is left alone and reported.
 *
 * @returns {{ restored: number, kept: string[] }} kept: names of characters left as they are.
 */
export function undoMigration(records, backup) {
    const out = { restored: 0, kept: [] };
    const byId = new Map(records.map(r => [r.id, r]));
    for (const saved of backup.records || []) {
        const record = byId.get(saved.id);
        if (!record) { out.kept.push(saved.name); continue; }

        const data = record.combat?.types?.[backup.dataKey];
        const last = data?.history?.[data.history.length - 1];
        const untouched = !data || (last?.kind === 'migrate' && last.migrationId === backup.migrationId);
        if (!untouched) { out.kept.push(record.name); continue; }

        // The old keys come back whichever way the combat block goes: tidy may have removed them.
        if (!record.statusOverrides) record.statusOverrides = {};
        for (const [key, value] of Object.entries(saved.statusOverrides || {})) {
            if (record.statusOverrides[key] !== value) record.statusOverrides[key] = value;
        }

        if (saved.combat === null) {
            if (record.combat?.types) delete record.combat.types[backup.dataKey];
            if (record.combat && !Object.keys(record.combat.types || {}).length
                && !record.combat.conditions?.length) delete record.combat;
        } else {
            record.combat = structuredClone(saved.combat);
        }
        out.restored++;
    }
    return out;
}

/* ----------------------------------------------------------------------- tidy */

/**
 * The old keys that can be removed safely: ones the combat block now holds with the same value,
 * and whose old value is still what was copied. Anything changed since is left in place.
 *
 * @returns {string[]} Keys of statusOverrides.
 */
export function tidyKeys(record, type) {
    const data = getTypeData(record, type.dataKey);
    return detectLegacy(record, type).matches
        .filter(m => {
            const have = getPath(data, m.target);
            return have !== undefined && have !== null && same(have, m.parsed);
        })
        .map(m => m.key);
}

/** Removes the keys tidyKeys returns. @returns {{ key: string, value: any }[]} What was removed. */
export function applyTidy(record, type) {
    const removed = [];
    for (const key of tidyKeys(record, type)) {
        removed.push({ key, value: record.statusOverrides[key] });
        delete record.statusOverrides[key];
    }
    return removed;
}

/* ------------------------------------------------------------ tidy: backup, undo */

/**
 * What tidy is about to remove, kept so it can be put back. Built before anything is removed,
 * and only for records that have something to remove.
 */
export function buildTidyBackup(records, type, { migrationId, at = Date.now() } = {}) {
    const out = [];
    for (const record of records) {
        const keys = tidyKeys(record, type);
        if (!keys.length) continue;
        out.push({
            id: record.id,
            name: record.name,
            removed: Object.fromEntries(keys.map(k => [k, record.statusOverrides[k]])),
        });
    }
    return { format: 'worldkit-combat-tidy-backup', version: 1, migrationId, typeId: type.id, at, records: out };
}

/** Puts removed keys back. Never overwrites a key that has been set again since. */
export function undoTidy(records, backup) {
    const byId = new Map(records.map(r => [r.id, r]));
    let restored = 0;
    for (const saved of backup.records || []) {
        const record = byId.get(saved.id);
        if (!record) continue;
        if (!record.statusOverrides) record.statusOverrides = {};
        for (const [key, value] of Object.entries(saved.removed || {})) {
            if (record.statusOverrides[key] === undefined) { record.statusOverrides[key] = value; restored++; }
        }
    }
    return { restored };
}
