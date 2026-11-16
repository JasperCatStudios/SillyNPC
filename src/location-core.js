/**
 * Location backgrounds (fork): a table of place names and the background picture each one uses.
 *
 * When the story moves to a new place (the tracker's Location changes), the chat's background switches to the
 * picture set for that place. Nothing is generated and no model is asked: the place comes from the tracker and the
 * pictures are ones you already have in SillyTavern's backgrounds folder.
 *
 * Pure: no DOM, no SillyTavern imports, so it is tested in node. location-backgrounds.js is the SillyTavern side.
 */

export const LOCATION_DEFAULTS = Object.freeze({ enabled: false, entries: [] });

const str = (v) => (typeof v === 'string' ? v.trim() : '');

/** How a place name is compared: lower case, no accents, no punctuation, no leading "the". */
export function foldPlace(text) {
    return String(text ?? '')
        .normalize('NFKD').replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/['’`]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/^(the|a|an)\s+/, '')
        .trim();
}

/** Repairs the table: every entry has a name and a file; aliases are a list of words. */
export function normalizeLocations(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const seen = new Set();
    const entries = [];
    for (const e of Array.isArray(r.entries) ? r.entries : []) {
        const name = str(e?.name);
        if (!name) continue;
        const key = foldPlace(name);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const aliases = (Array.isArray(e.aliases) ? e.aliases : String(e.aliases || '').split(','))
            .map(a => str(a)).filter(Boolean);
        entries.push({ name, aliases: [...new Set(aliases)], file: str(e?.file) });
    }
    return { enabled: Boolean(r.enabled), entries };
}

/**
 * The entry for a place the story named, or null. An exact name or alias wins; otherwise the longest name or alias
 * that appears inside what the story wrote ("Garreg Mach Monastery, Training Grounds" finds Training Grounds) or that
 * the story's words appear inside. Very short names are only matched exactly, so "Inn" does not match "Winnowing".
 *
 * @param {Array<{ name: string, aliases?: string[], file: string }>} entries
 * @param {string} place
 */
export function matchLocation(entries, place) {
    const text = foldPlace(place);
    if (!text) return null;
    let best = null;
    let bestScore = 0;
    for (const entry of entries || []) {
        for (const label of [entry.name, ...(entry.aliases || [])]) {
            const key = foldPlace(label);
            if (!key) continue;
            let score = 0;
            if (key === text) score = 1000 + key.length;
            else if (key.length >= 4 && ` ${text} `.includes(` ${key} `)) score = 100 + key.length;
            else if (text.length >= 4 && ` ${key} `.includes(` ${text} `)) score = 50 + text.length;
            if (score > bestScore) { bestScore = score; best = entry; }
        }
    }
    return best;
}

/** A preset list from a file's text: either the whole settings object or just an entries array. */
export function parseLocationFile(text) {
    let data;
    try { data = JSON.parse(String(text)); } catch { return null; }
    const entries = Array.isArray(data) ? data : data?.entries;
    if (!Array.isArray(entries)) return null;
    return normalizeLocations({ entries }).entries;
}
