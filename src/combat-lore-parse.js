import { buildIndex } from './combat-migrate.js';
import { ladderOf, rungIndex } from './combat-roles.js';
import { withConflicts } from './combat-plan.js';

/**
 * Reading combat tables out of lorebook text (fork).
 *
 * Lore entries like Combat-Bleach list people as
 *   Kenpachi Zaraki's Attributes{ CON: 15, STR: 15, DEX: 9, ... }
 *   Kenpachi Zaraki's Proficiencies{ Zanjutsu: Rank SS, Hakuda: Rank SS, ... }
 * This pulls those blocks apart, matches the names to the roster, and maps the values onto a
 * world type through the type's own aliases and its loreImport table. Nothing is written here;
 * the result is a plan for combat-plan.js.
 *
 * Pure: no DOM, no SillyTavern imports.
 */

/** Lower case, accents and punctuation gone: "Tōshirō Hitsugaya" -> "toshiro hitsugaya". */
export function foldName(name) {
    return String(name ?? '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** "KEY: v, KEY: v" -> [[key, value], ...]. Splits only on commas that start a new "key:". */
function pairs(body) {
    const out = [];
    const parts = String(body).split(/,\s*(?=[^,:{}]+:)/);
    for (const part of parts) {
        const at = part.indexOf(':');
        if (at < 0) continue;
        const key = part.slice(0, at).trim();
        const value = part.slice(at + 1).trim();
        if (key) out.push([key, value]);
    }
    return out;
}

/**
 * @param {string} text An entry's content.
 * @returns {{ name: string, attributes: Record<string, string>, proficiencies: Record<string, string> }[]}
 *   One row per person, with both blocks merged. Names are as written.
 */
export function parseCombatTables(text) {
    const rows = new Map();
    const re = /^[ \t>*-]*([^\n{]+?)['’]s\s+(Attributes|Profici\w+)\s*\{([^}]*)\}/gim;
    for (const m of String(text ?? '').matchAll(re)) {
        const name = m[1].trim();
        const key = foldName(name);
        if (!key) continue;
        if (!rows.has(key)) rows.set(key, { name, attributes: {}, proficiencies: {} });
        const row = rows.get(key);
        const target = /^attr/i.test(m[2]) ? row.attributes : row.proficiencies;
        for (const [k, v] of pairs(m[3])) target[k] = v;
    }
    return [...rows.values()];
}

/* ------------------------------------------------------------- name matching */

const tokens = (s) => foldName(s).split(' ').filter(Boolean);

/**
 * Which roster character a table name refers to.
 * Exact name, then an alias, then one name whose words all appear in the other ("Kenpachi" in
 * "Kenpachi Zaraki"). Several possible matches are reported rather than guessed.
 *
 * @param {string} name
 * @param {{ id: string, name: string, aliases?: { pattern: string, isRegex?: boolean }[] }[]} records
 * @returns {{ record: object|null, candidates: object[], how: 'name'|'alias'|'partial'|'none'|'ambiguous' }}
 */
export function matchName(name, records) {
    const want = foldName(name);
    const exact = records.filter(r => foldName(r.name) === want);
    if (exact.length === 1) return { record: exact[0], candidates: exact, how: 'name' };

    const byAlias = records.filter(r => (r.aliases || [])
        .some(a => a && !a.isRegex && foldName(a.pattern) === want));
    if (byAlias.length === 1) return { record: byAlias[0], candidates: byAlias, how: 'alias' };

    const wantTokens = new Set(tokens(name));
    const partial = records.filter(r => {
        const have = new Set(tokens(r.name));
        if (!have.size || !wantTokens.size) return false;
        const small = have.size <= wantTokens.size ? have : wantTokens;
        const large = small === have ? wantTokens : have;
        return [...small].every(t => large.has(t));
    });
    if (partial.length === 1) return { record: partial[0], candidates: partial, how: 'partial' };
    if (partial.length > 1 || exact.length > 1 || byAlias.length > 1) {
        return { record: null, candidates: [...new Set([...exact, ...byAlias, ...partial])], how: 'ambiguous' };
    }
    return { record: null, candidates: [], how: 'none' };
}

/* ----------------------------------------------------------------- mapping */

/** A table value rescaled from the lore's range to the type's, rounded. */
export function rescale(value, from, to) {
    const span = from[1] - from[0];
    if (!span) return to[0];
    const t = (Number(value) - from[0]) / span;
    return Math.round(Math.max(0, Math.min(1, t)) * (to[1] - to[0]) + to[0]);
}

/** "Rank SS", "SS", "A (Private training)" -> "SS" / "A", or null. */
function rankText(value) {
    const m = /^\s*(?:Rank\s+)?([A-Za-z]{1,2}[+-]?)(?![A-Za-z])/.exec(String(value ?? ''));
    return m ? m[1].toUpperCase() : null;
}

/**
 * One table row, as writes onto a world type.
 *
 * Attribute names are matched through the type's loreImport.statMap (lore name -> the type's
 * stat ids), and rescaled if the type says its lore uses a different range. Proficiency names
 * go through the type's own aliases. Anything that cannot be placed is listed in unknown, not
 * dropped.
 *
 * @returns {{ writes: object[], unknown: object[] }}
 */
export function mapRow(row, type, { rescaleValues = true } = {}) {
    const writes = [];
    const unknown = [];
    const imp = type.loreImport || {};
    const statMap = {};
    for (const [lore, ids] of Object.entries(imp.statMap || {})) statMap[foldName(lore)] = ids;
    const stats = new Set((type.stats || []).map(s => s.id));
    const { index, profs } = buildIndex(type);

    for (const [key, value] of Object.entries(row.attributes)) {
        const n = Number((/^\s*(-?\d+(?:\.\d+)?)/.exec(value) || [])[1]);
        if (!Number.isFinite(n)) { unknown.push({ key, value, reason: 'not a number' }); continue; }

        let ids = statMap[foldName(key)];
        if (!ids) {
            const hit = index.get(foldName(key).replace(/ /g, ''));
            if (hit?.kind === 'stat') ids = [hit.id];
        }
        const placed = (ids || []).filter(id => stats.has(id));
        if (!placed.length) { unknown.push({ key, value, reason: 'no matching stat' }); continue; }

        const useScale = rescaleValues && imp.scale?.from && imp.scale?.to;
        const out = useScale ? rescale(n, imp.scale.from, imp.scale.to) : n;
        for (const id of placed) writes.push({ target: `stats.${id}`, value: out, key });
    }

    for (const [key, value] of Object.entries(row.proficiencies)) {
        const id = profs.get(foldName(key).replace(/ /g, ''));
        const prof = id && type.proficiencies.find(p => p.id === id);
        if (!prof) { unknown.push({ key, value, reason: 'no matching proficiency' }); continue; }
        const ladder = ladderOf(type, prof.ladder);
        const text = rankText(value);
        const idx = text ? rungIndex(ladder, text) : -1;
        if (idx < 0) { unknown.push({ key, value, reason: 'rank is not on the ladder' }); continue; }
        writes.push({ target: `profs.${id}`, value: ladder.rungs[idx], key });
    }
    return { writes, unknown };
}

/**
 * Plans an import of every row in a lore entry.
 *
 * @returns {{ items: object[], unmatched: { name: string, candidates: object[], how: string }[] }}
 *   items are plan items (see combat-plan.js). Rows with no single matching character land in
 *   unmatched with their candidates, for the caller to resolve by hand.
 */
export function planFromLore(text, records, type, { rescaleValues = true } = {}) {
    const items = [];
    const unmatched = [];
    for (const row of parseCombatTables(text)) {
        const found = matchName(row.name, records);
        if (!found.record) { unmatched.push({ name: row.name, candidates: found.candidates, how: found.how, row }); continue; }
        const { writes, unknown } = mapRow(row, type, { rescaleValues });
        if (!writes.length) continue;
        items.push(withConflicts(found.record, type, {
            recordId: found.record.id,
            name: found.record.name,
            source: 'lore',
            loreName: row.name,
            matchedBy: found.how,
            writes, unknown, skipped: [],
        }));
    }
    return { items, unmatched };
}
