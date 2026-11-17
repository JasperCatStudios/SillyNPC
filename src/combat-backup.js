import { getRequestHeaders } from '../../../../../script.js';
import { LOG_PREFIX } from './constants.js';
import { toBase64 } from './status-logic.js';

/**
 * Backup files for combat migrations (fork).
 *
 * Written through SillyTavern's own file upload, the same way system checkpoints are, so they
 * sit in the user's files folder next to them and survive a settings reset. A migration that
 * cannot write its backup does not run.
 */

/**
 * @param {object} backup A buildBackup / buildTidyBackup result.
 * @returns {Promise<string>} The path the file was saved under.
 * @throws {Error} When the upload fails.
 */
export async function uploadBackup(backup) {
    const tidy = backup.format === 'worldkit-combat-tidy-backup' || backup.format === 'sillynpc-combat-tidy-backup';   // either spelling: older files say sillynpc
    const name = `worldkit-combat-${tidy ? 'tidy' : 'backup'}-${backup.at}.json`;
    const response = await fetch('/api/files/upload', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ name, data: toBase64(JSON.stringify(backup)) }),
    });
    if (!response.ok) throw new Error(`The backup could not be saved (HTTP ${response.status}).`);
    const { path } = await response.json();
    if (!path) throw new Error('The backup could not be saved (no path returned).');
    return path;
}

/** @returns {Promise<object>} The backup, parsed. */
export async function readBackup(path) {
    const response = await fetch(String(path).startsWith('/') ? path : `/${path}`);
    if (!response.ok) throw new Error(`The backup file could not be read (HTTP ${response.status}).`);
    const backup = await response.json();
    if (!backup || !String(backup.format || '').startsWith('sillynpc-combat-')) {
        throw new Error('That file is not a combat backup.');
    }
    return backup;
}

/** Best effort: a leftover backup file is harmless, so failure to delete is only logged. */
export async function deleteBackupFile(path) {
    try {
        await fetch('/api/files/delete', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ path }),
        });
    } catch (err) {
        console.warn(LOG_PREFIX, 'Could not delete a combat backup file', err);
    }
}
