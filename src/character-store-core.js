/**
 * The characters file, the rules (fork). Pure, so node can test it; the browser side is character-store.js.
 *
 * Worldkit's characters used to live inside SillyTavern's settings.json, which SillyTavern rewrites whole on every
 * save. They now live in their own file, user/files/worldkit-characters.json, one per profile:
 *   { format: 'worldkit-characters-store', version: 1, savedAt, characters: [...] }
 * The file holds the characters exactly as they are in memory (portraits as paths, never as data). It holds no
 * credentials: a card has none, and nothing here adds any.
 */

export const STORE_FORMAT = 'worldkit-characters-store';
export const STORE_VERSION = 1;
export const STORE_FILE = 'worldkit-characters.json';
export const STORE_URL = `/user/files/${STORE_FILE}`;

/** The file's text for a list of characters. */
export function packStore(characters, now = Date.now()) {
    return JSON.stringify({ format: STORE_FORMAT, version: STORE_VERSION, savedAt: now, characters: Array.isArray(characters) ? characters : [] }, null, 1);
}

/**
 * The characters in a file's text, or null when it is not this file (not JSON, another format, a newer version,
 * or no list). An empty list is a real answer and comes back as [].
 */
export function parseStore(text) {
    let data;
    try { data = JSON.parse(String(text)); } catch { return null; }
    if (!data || typeof data !== 'object' || data.format !== STORE_FORMAT) return null;
    if (Number(data.version) > STORE_VERSION) return null;
    if (!Array.isArray(data.characters)) return null;
    return data.characters.filter(c => c && typeof c === 'object' && !Array.isArray(c));
}

/**
 * Which characters win at start-up.
 *
 * The file is the truth. The only time the inline list (the old place, inside settings.json) is used is when there
 * is no file yet, or the file is empty while the settings still hold some: that is a profile from before the split,
 * and its characters are moved into the file.
 *
 * @param {object[]|null} fromFile  null when there is no usable file
 * @param {object[]} inline         characters found inside settings.json (the old place)
 * @returns {{ use: object[], source: 'file'|'inline'|'none', migrate: boolean }}
 */
export function chooseCharacters(fromFile, inline) {
    const inlineList = Array.isArray(inline) ? inline : [];
    if (fromFile && (fromFile.length || !inlineList.length)) return { use: fromFile, source: 'file', migrate: false };
    if (inlineList.length) return { use: inlineList, source: 'inline', migrate: true };
    return { use: [], source: 'none', migrate: false };
}

/** A short fingerprint of a string, to tell whether a write would change anything. */
export function digest(text) {
    let h = 5381;
    const s = String(text);
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return `${s.length}:${h >>> 0}`;
}

/** Base64 of a UTF-8 string (btoa alone throws outside Latin-1, and names here are not all ASCII). */
export function toBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(binary);
}
