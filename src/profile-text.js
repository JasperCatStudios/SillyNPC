import { eventSource } from '../../../../events.js';
import { getSettings } from './settings.js';
import { debugLog } from './constants.js';
import { readLoreEntry } from './character-fill.js';

/**
 * What somebody is like, as text, for anything that has to write as them (fork).
 *
 * One answer for the whole extension: the phone, the games and whatever comes next all ask
 * here, so a character is described the same way everywhere and is set up in one place - their
 * page. In order of say:
 *
 *   the lorebook entry linked to them on their SillyNPC character page - the one place
 *      the link is made - as their personality and profile.
 *
 * Entries are read into memory ahead of time, because the callers ask for text synchronously.
 * A linked entry that has not been read yet is fetched when first asked for, and 'sillynpc-profile-updated'
 * is emitted when it arrives so anything that drew without it can draw again.
 */

export const PROFILE_UPDATED_EVENT = 'sillynpc-profile-updated';

const loreText = new Map();
const loading = new Set();
const loreKey = (link) => `${link.world}\u0000${link.uid}`;

/** Reads every linked entry. Call at start-up, on a chat change, and after a link is edited. */
export async function primeLore() {
    const next = new Map();
    for (const char of getSettings().characters || []) {
        const link = char?.lorebook;
        if (!link?.world) continue;
        try {
            next.set(loreKey(link), String(await readLoreEntry(char) || '').trim());
        } catch { /* a missing entry simply leaves the profile fields in charge */ }
    }
    loreText.clear();
    for (const [key, value] of next) loreText.set(key, value);
    await eventSource.emit(PROFILE_UPDATED_EVENT);
}

/** Fetches one linked entry that is not in memory yet, without making the caller wait. */
function fetchLater(char) {
    const key = loreKey(char.lorebook);
    if (loading.has(key)) return;
    loading.add(key);
    readLoreEntry(char)
        .then(text => { loreText.set(key, String(text || '').trim()); return eventSource.emit(PROFILE_UPDATED_EVENT); })
        .catch(err => debugLog('Could not read a linked lore entry', err))
        .finally(() => loading.delete(key));
}

/** Where the text for a character comes from, in words, for the page that edits it. */
export function profileSource(char) {
    if (char?.lorebook?.world && loreText.get(loreKey(char.lorebook))) return `their lorebook entry in "${char.lorebook.world}"`;
    return 'nothing yet - link a lorebook entry on their page';
}

/**
 * The text describing somebody.
 *
 * @param {object} char A SillyNPC character record.
 * @returns {string}
 */
export function profileText(char) {
    if (char?.lorebook?.world) {
        const key = loreKey(char.lorebook);
        const entry = loreText.get(key);
        if (entry) return entry;
        if (!loreText.has(key)) fetchLater(char);
    }

    return '';
}
