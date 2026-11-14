import { getSettings, saveSettings } from './settings.js';
import { LOG_PREFIX, debugLog } from './constants.js';
import { saveCheckpoint } from './status-logic.js';
import { combatPrefs } from './combat-access.js';
import {
    applyItem, buildBackup, undoMigration, buildTidyBackup, applyTidy, undoTidy,
} from './combat-plan.js';
import { uploadBackup, readBackup } from './combat-backup.js';

/**
 * Running a migration against the live settings (fork): backup first, then copy, then record.
 *
 * Every step that can fail comes before any record is changed, so a failed upload leaves the
 * characters exactly as they were.
 */

const characters = () => getSettings().characters || [];

function newId(prefix) {
    return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * @param {object} type World type.
 * @param {object[]} items Plan items (combat-plan.js), already filtered to what the user chose.
 * @param {{ label?: string, overwrite?: boolean }} [opts]
 * @returns {Promise<{ ok: boolean, reason?: string, migrationId?: string, characters?: number, values?: number }>}
 */
export async function runMigration(type, items, { label = 'Migration', overwrite = false } = {}) {
    if (!items.length) return { ok: false, reason: 'Nothing was chosen.' };
    const records = characters();
    const migrationId = newId('m');
    const at = Date.now();

    // A system checkpoint too, best effort: it covers the whole world, the backup only what this
    // migration touches. Not a reason to stop if the checkpoint itself is unchanged or fails.
    try { await saveCheckpoint('Before combat migration'); } catch (err) { debugLog('Checkpoint skipped', err); }

    const backup = buildBackup(records, items, type, { migrationId, at });
    let path;
    try {
        path = await uploadBackup(backup);
    } catch (err) {
        console.warn(LOG_PREFIX, 'Combat migration stopped: no backup', err);
        return { ok: false, reason: err.message || 'The backup could not be saved, so nothing was changed.' };
    }

    let values = 0;
    let touched = 0;
    for (const item of items) {
        const record = records.find(r => r.id === item.recordId);
        if (!record) continue;
        values += applyItem(record, type, item, { migrationId, at, overwrite }).length;
        touched++;
    }

    const prefs = combatPrefs();
    prefs.migrations.unshift({
        id: migrationId, at, path, typeId: type.id, dataKey: type.dataKey, kind: 'migrate',
        label, count: touched, values,
    });
    prefs.migrations = prefs.migrations.slice(0, 50);
    saveSettings();
    return { ok: true, migrationId, characters: touched, values };
}

/** @returns {Promise<{ ok: boolean, reason?: string, restored?: number, kept?: string[] }>} */
export async function undoById(migrationId) {
    const prefs = combatPrefs();
    const entry = prefs.migrations.find(m => m.id === migrationId);
    if (!entry) return { ok: false, reason: 'That migration is not in the list.' };
    if (entry.undone) return { ok: false, reason: 'It has already been undone.' };

    let backup;
    try {
        backup = await readBackup(entry.path);
    } catch (err) {
        return { ok: false, reason: err.message };
    }

    if (entry.kind === 'tidy') {
        const { restored } = undoTidy(characters(), backup);
        entry.undone = true;
        saveSettings();
        return { ok: true, restored, kept: [] };
    }
    const result = undoMigration(characters(), backup);
    entry.undone = true;
    saveSettings();
    return { ok: true, ...result };
}

/**
 * Removes the old flat keys a migration has already copied. Needs a migration for this type
 * to have happened, and writes its own backup of what it removes first.
 */
export async function runTidy(type) {
    const prefs = combatPrefs();
    if (!prefs.migrations.some(m => m.kind === 'migrate' && m.typeId === type.id && !m.undone)) {
        return { ok: false, reason: 'Migrate first: tidy only removes keys that have been copied.' };
    }
    const records = characters();
    const migrationId = newId('t');
    const at = Date.now();
    const backup = buildTidyBackup(records, type, { migrationId, at });
    if (!backup.records.length) return { ok: true, characters: 0, keys: 0 };

    let path;
    try {
        path = await uploadBackup(backup);
    } catch (err) {
        return { ok: false, reason: err.message || 'The backup could not be saved, so nothing was removed.' };
    }

    let keys = 0;
    for (const entry of backup.records) {
        const record = records.find(r => r.id === entry.id);
        if (record) keys += applyTidy(record, type).length;
    }
    prefs.migrations.unshift({
        id: migrationId, at, path, typeId: type.id, dataKey: type.dataKey, kind: 'tidy',
        label: 'Removed old keys', count: backup.records.length, values: keys,
    });
    prefs.migrations = prefs.migrations.slice(0, 50);
    saveSettings();
    return { ok: true, characters: backup.records.length, keys };
}
