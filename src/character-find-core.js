/**
 * Finding the character you want to join you (fork): the pure part. Search and sort for every list of characters in combat, games and
 * activities. No DOM, no SillyTavern imports, so node can test it.
 *
 * An entry is { name, faction? }. A context says what the sorts need to know: who is in the scene, how close each bond is, who was
 * picked lately, and the order the Characters menu lists the factions in. Anything the context lacks simply does not move an entry.
 */

/** The ways to order a list, in the order the menu shows them: [id, label]. */
export const FIND_SORTS = Object.freeze([
    ['scene', 'In the scene first'],
    ['name', 'A to Z'],
    ['bond', 'Closest bond first'],
    ['recent', 'Picked lately first'],
    ['faction', 'By faction'],
]);
export const FIND_SORT_IDS = Object.freeze(FIND_SORTS.map(([id]) => id));
export const DEFAULT_FIND_SORT = 'scene';

/** How many recent picks are kept. */
export const RECENT_MAX = 12;

/** Lower case, accents taken off, spaces tidied: "Éowyn" and "eowyn" are the same word to a search. */
export function fold(text) {
    return String(text ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}

/** A sort id repaired: an unknown one is the default. */
export const cleanSort = (id) => (FIND_SORT_IDS.includes(id) ? id : DEFAULT_FIND_SORT);

/**
 * Whether an entry matches what was typed. Every word typed has to appear in the name or the faction, in any order, so "ing gr"
 * finds "Ingrid" in "Gryphon Riders". An empty search matches everyone.
 */
export function matchesQuery(entry, query) {
    const words = fold(query).split(' ').filter(Boolean);
    if (!words.length) return true;
    const hay = `${fold(entry?.name)} ${fold(entry?.faction)}`;
    return words.every(w => hay.includes(w));
}

const byName = (a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base', numeric: true });

/**
 * The entries in the order a sort asks for, as a new array. A tie is always settled by name, so the order never jumps about.
 * @param {{ name: string, faction?: string }[]} entries
 * @param {string} mode one of FIND_SORT_IDS
 * @param {{ scene?: Set<string>|string[], bond?: Map<string, number>|Record<string, number>, recent?: string[], factionOrder?: string[] }} [ctx]
 */
export function sortEntries(entries, mode, ctx = {}) {
    const list = [...(entries || [])];
    const key = (n) => fold(n);
    const scene = ctx.scene instanceof Set ? ctx.scene : new Set((ctx.scene || []).map(key));
    const bondOf = (n) => {
        const b = ctx.bond;
        const v = b instanceof Map ? b.get(key(n)) : b?.[key(n)] ?? b?.[n];
        return Number.isFinite(Number(v)) ? Number(v) : -Infinity;
    };
    const recent = (ctx.recent || []).map(key);
    const rank = (n) => { const i = recent.indexOf(key(n)); return i < 0 ? Infinity : i; };
    const order = (ctx.factionOrder || []).map(key);
    const factionRank = (f) => { if (!fold(f)) return -1; const i = order.indexOf(key(f)); return i < 0 ? order.length : i; };
    const cmp = {
        name: byName,
        scene: (a, b) => Number(scene.has(key(b.name))) - Number(scene.has(key(a.name))) || byName(a, b),
        bond: (a, b) => bondOf(b.name) - bondOf(a.name) || byName(a, b),
        recent: (a, b) => (rank(a.name) === rank(b.name) ? byName(a, b) : rank(a.name) - rank(b.name)),
        faction: (a, b) => factionRank(a.faction) - factionRank(b.faction) || fold(a.faction).localeCompare(fold(b.faction)) || byName(a, b),
    }[cleanSort(mode)];
    // Number.isNaN guards: -Infinity - -Infinity is NaN, which `||` treats as "equal" and falls through to the name.
    return list.sort((a, b) => { const r = cmp(a, b); return Number.isNaN(r) ? byName(a, b) : r; });
}

/** The entries that match, in sort order. */
export const findEntries = (entries, query, mode, ctx) => sortEntries((entries || []).filter(e => matchesQuery(e, query)), mode, ctx);

/** A recent list with a name moved to the front (no repeats, capped), as a new array. */
export function pushRecent(list, name, max = RECENT_MAX) {
    const n = String(name ?? '').trim();
    if (!n) return Array.isArray(list) ? [...list] : [];
    const rest = (Array.isArray(list) ? list : []).filter(x => fold(x) !== fold(n));
    return [n, ...rest].slice(0, max);
}

/** The name an option stands for: its own data-name, else its text without a trailing "(...)" such as " (defaults)". */
export function nameFromLabel(text) {
    return String(text ?? '').replace(/\s*\([^)]*\)\s*$/, '').trim();
}
