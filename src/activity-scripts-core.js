/**
 * Your own activity scripts (fork): the list of scripts the Activities module loads at start-up, and how a script file is named.
 *
 * SillyTavern refuses to store a file ending in .js (its upload endpoint blocks script types), so a script added through the
 * settings is kept as a text file (name.js.txt) in the user's files folder and run by Worldkit from its text. A script can also be
 * put in the user's files folder by hand under any name and added by its address.
 *
 * Pure: no DOM, no SillyTavern imports, so node can test it.
 */

export const SCRIPT_MAX = 20;
export const SCRIPT_PREFIX = 'worldkit-activity-';
export const FILES_URL = '/user/files/';

const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** A safe stored name for a chosen file: worldkit-activity-<name>.txt, letters, numbers, dashes and dots only. */
export function storedNameFor(fileName) {
    const base = String(fileName ?? '').toLowerCase().replace(/\.(js|mjs|txt)$/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'activity';
    return `${SCRIPT_PREFIX}${base}.js.txt`;
}

/** The address a stored file is served from. */
export const urlForStored = (storedName) => `${FILES_URL}${storedName}`;

/** Whether an address is one the loader may fetch: a path on this server (never another site). */
export function isLocalScriptUrl(url) {
    const u = String(url ?? '').trim();
    return /^\/[A-Za-z0-9_\-./%]+$/.test(u) && !u.includes('..') && !u.startsWith('//');
}

/** The saved list repaired: { name, url } pairs, local addresses only, no repeats, at most SCRIPT_MAX. */
export function normalizeScripts(raw) {
    const out = [];
    const seen = new Set();
    for (const item of Array.isArray(raw) ? raw : []) {
        const url = text(item?.url, 200);
        if (!isLocalScriptUrl(url) || seen.has(url)) continue;
        seen.add(url);
        out.push({ name: text(item?.name, 60) || url.split('/').pop(), url });
        if (out.length >= SCRIPT_MAX) break;
    }
    return out;
}

/** Adds (or renames) one script in a list. Returns a new list. */
export function addScript(list, entry) {
    const current = normalizeScripts(list);
    const clean = normalizeScripts([entry])[0];
    if (!clean) return current;
    const at = current.findIndex(s => s.url === clean.url);
    if (at >= 0) { current[at] = clean; return current; }
    return normalizeScripts(current.concat([clean]));
}

/** Removes one script by address. Returns a new list. */
export const removeScript = (list, url) => normalizeScripts(list).filter(s => s.url !== url);
