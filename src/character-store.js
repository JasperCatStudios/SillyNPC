import { getRequestHeaders } from '../../../../../script.js';
import { LOG_PREFIX, PRODUCT_NAME, debugLog } from './constants.js';
import { STORE_FILE, STORE_URL, packStore, parseStore, chooseCharacters, digest, toBase64 } from './character-store-core.js';

/**
 * Keeps the characters in their own file, out of settings.json (fork).
 *
 * In memory nothing changes: the code still reads settings.characters, and the list keeps its identity (it is
 * emptied and refilled, never replaced, because other code caches it). What changes is how it is kept:
 *
 *   - the property is made non-enumerable, so SillyTavern's JSON.stringify of the settings leaves it out;
 *   - every save writes the list to user/files/worldkit-characters.json (debounced, and only when it changed);
 *   - start-up reads that file. A profile from before the split has its characters inside settings.json: they are
 *     written to the file first, and only once that write has succeeded are they hidden from settings.json.
 *
 * Safety nets: nothing is written until the file has been read (a failed read must never save an empty list over the
 * file); and if a write fails, the list is put back into settings.json until a write succeeds again, so a failed
 * write can never be the only place where the characters are missing.
 */

const SAVE_DELAY_MS = 400;
const WATCH_MS = 20000;

const state = { settings: null, loaded: false, timer: null, lastDigest: '', failed: false, warned: false, watching: false, writing: Promise.resolve() };

/** Shows or hides the list from JSON.stringify, keeping the same array. */
function setVisible(settings, visible) {
    const list = Array.isArray(settings.characters) ? settings.characters : [];
    Object.defineProperty(settings, 'characters', { value: list, enumerable: visible, writable: true, configurable: true });
}

async function upload(text) {
    const response = await fetch('/api/files/upload', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ name: STORE_FILE, data: toBase64(text) }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

function warnOnce(text) {
    if (state.warned) return;
    state.warned = true;
    try { toastr.warning(text, PRODUCT_NAME); } catch { /* no toast available */ }
}

/**
 * Reads the characters file into settings.characters, migrating a profile that still has them inside settings.json.
 * Call once, right after the settings object exists and before anything reads the characters.
 *
 * @param {object} settings The live extension_settings.sillynpc object.
 * @returns {Promise<boolean>} true when the characters are now kept in their file.
 */
export async function loadCharacterStore(settings) {
    state.settings = settings;
    const own = Object.getOwnPropertyDescriptor(settings, 'characters');
    const inline = own && Array.isArray(own.value) ? own.value.slice() : [];

    let fromFile = null;
    try {
        const response = await fetch(STORE_URL, { cache: 'no-store' });
        if (response.ok) {
            fromFile = parseStore(await response.text());
            if (!fromFile) throw new Error('the characters file could not be read');
        } else if (response.status !== 404) {
            throw new Error(`HTTP ${response.status}`);
        }
    } catch (err) {
        // Not knowing what is in the file is not the same as it being empty: leave everything where it is and write nothing.
        console.error(LOG_PREFIX, 'Could not read the characters file; leaving the characters in settings', err);
        warnOnce('Could not read the characters file. Your characters are untouched, and nothing will be saved to it this session.');
        return false;
    }

    const choice = chooseCharacters(fromFile, inline);
    const list = Array.isArray(settings.characters) ? settings.characters : (settings.characters = []);
    list.splice(0, list.length, ...choice.use);

    if (choice.migrate) {
        try {
            const text = packStore(list);
            await upload(text);
            state.lastDigest = digest(packStore(list, 0));
            console.info(LOG_PREFIX, `Moved ${list.length} characters out of settings.json into ${STORE_FILE}`);
        } catch (err) {
            // Nothing has been hidden yet, so settings.json still holds every character.
            console.error(LOG_PREFIX, 'Could not write the characters file; leaving the characters in settings', err);
            warnOnce('Could not write the characters file. Your characters are untouched, and are still kept in settings.');
            return false;
        }
    } else {
        state.lastDigest = digest(packStore(list, 0));
    }

    state.loaded = true;
    setVisible(settings, false);
    startWatching();
    return true;
}

/** Writes the list now, if it changed. Never throws. */
export function flushCharacterSave() {
    clearTimeout(state.timer);
    state.timer = null;
    const settings = state.settings;
    if (!state.loaded || !settings) return state.writing;
    state.writing = state.writing.then(async () => {
        // The time stamp is left out of the comparison, so an untouched list is not rewritten for it.
        const same = digest(packStore(settings.characters, 0)) === state.lastDigest;
        if (same && !state.failed) return;
        try {
            const text = packStore(settings.characters);
            await upload(text);
            state.lastDigest = digest(packStore(settings.characters, 0));
            if (state.failed) { state.failed = false; setVisible(settings, false); }
        } catch (err) {
            console.error(LOG_PREFIX, 'Could not save the characters file; keeping them in settings until it works again', err);
            state.failed = true;
            setVisible(settings, true);
            warnOnce('Could not save the characters file. They are kept in settings for now, so nothing is lost.');
        }
    });
    return state.writing;
}

/** Asks for a save soon. Safe to call as often as you like, and before the file has been read. */
export function scheduleCharacterSave() {
    if (!state.loaded) return;
    clearTimeout(state.timer);
    state.timer = setTimeout(() => { flushCharacterSave(); }, SAVE_DELAY_MS);
}

function startWatching() {
    if (state.watching) return;
    state.watching = true;
    // A change made without going through saveSettings() is still caught, within a few seconds.
    setInterval(() => scheduleCharacterSave(), WATCH_MS);
    try {
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushCharacterSave(); });
        window.addEventListener('pagehide', () => { flushCharacterSave(); });
    } catch (err) { debugLog('No page events to flush on', err); }
}
