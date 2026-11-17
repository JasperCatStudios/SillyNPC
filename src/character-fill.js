import { loadWorldInfo } from '../../../../world-info.js';
import { debugLog } from './constants.js';

/** Reading a character's linked lorebook entry. (The Fill feature that lived here is gone.) */

/** The linked entry's text, or an empty string. Read fresh: it may have just been written. */
export async function readLoreEntry(char) {
    if (!char?.lorebook?.world) return '';
    try {
        const worldData = await loadWorldInfo(char.lorebook.world);
        const entries = worldData?.entries;
        const entry = Array.isArray(entries)
            ? entries.find(e => Number(e.uid) === Number(char.lorebook.uid))
            : entries?.[char.lorebook.uid];
        return entry?.content || '';
    } catch (err) {
        debugLog('Could not read the linked lore entry', err);
        return '';
    }
}
