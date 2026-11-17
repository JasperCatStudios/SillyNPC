import { loadWorldInfo, world_names } from '../../../../world-info.js';
import { debugLog } from './constants.js';

/** Reading a character's linked lorebook entry. (The Fill feature that lived here is gone.) */

/** The linked entry's text, or an empty string. Read fresh: it may have just been written. */
export async function readLoreEntry(char) {
    if (!char?.lorebook?.world) return '';
    // A lorebook that has been deleted is not asked for again: once SillyTavern's list of lorebooks is loaded, a name that is not in it is skipped.
    if (Array.isArray(world_names) && world_names.length && !world_names.includes(char.lorebook.world)) return '';
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
