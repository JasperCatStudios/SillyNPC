/**
 * Content keys for portraits, so the same picture is only ever written to disk once.
 *
 * Files are named with a timestamp, so choosing the same picture twice (or importing a
 * character you already have) used to write a second copy each time. A key made from the
 * picture's bytes lets the writer find the copy it already made.
 *
 * Not crypto.subtle: that only exists on secure pages, and a phone reaching SillyTavern
 * over http://192.168.x.x is not one. This is a plain 53-bit string hash (cyrb53) plus the
 * length, which is plenty to tell portraits apart and works on every device.
 */

/**
 * @param {string} text
 * @returns {string} Hex key, stable for the same text.
 */
export function contentKey(text) {
    const s = String(text ?? '');
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < s.length; i++) {
        const ch = s.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    const hash = 4294967296 * (2097151 & h2) + (h1 >>> 0);
    return `${hash.toString(16)}-${s.length.toString(16)}`;
}

/**
 * Finds the stored copy of a picture, if there is one and it is still on disk.
 *
 * @param {Record<string, string>} known Key to served path, as kept in settings.
 * @param {string} key
 * @param {(path: string) => Promise<boolean>} exists
 * @returns {Promise<string>} The path, or '' when the picture has to be written.
 */
export async function findStoredCopy(known, key, exists) {
    const path = known && Object.prototype.hasOwnProperty.call(known, key) ? known[key] : '';
    if (!path) return '';
    try {
        return (await exists(path)) ? path : '';
    } catch {
        return '';
    }
}
