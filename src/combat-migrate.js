import { ladderOf, rungIndex } from './combat-roles.js';
import { emptyTypeData } from './combat-store.js';

/**
 * Finding combat data in old places (fork). Detection only: this module never writes.
 *
 * The Fire Emblem cards keep their stats and ranks as flat keys in statusOverrides
 * ("STR": "94", "Axe Proficiency": "A"). A world type says what each of those is called
 * through aliases, so the same detector works for any type, built-in or custom.
 *
 * Pure: no DOM, no SillyTavern imports.
 */

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Tracker keys that live in statusOverrides but are not combat data. */
const TRACKER_KEYS = new Set(['health', 'energy', 'condition', 'stamina', 'status']);

/** Normalised name -> what it means, from a type's ids, labels, abbreviations and aliases. */
function buildIndex(type) {
    const index = new Map();
    const add = (name, entry) => {
        const key = norm(name);
        if (key && !index.has(key)) index.set(key, entry);
    };
    for (const s of type.stats || []) {
        for (const n of [s.id, s.label, s.abbr, ...(s.aliases || [])]) add(n, { kind: 'stat', id: s.id });
    }
    for (const m of type.meta || []) {
        for (const n of [m.id, m.label, ...(m.aliases || [])]) add(n, { kind: 'meta', id: m.id });
    }
    const profs = new Map();
    for (const p of type.proficiencies || []) {
        for (const n of [p.id, p.label, p.abbr, ...(p.aliases || [])]) {
            const key = norm(n);
            if (key && !profs.has(key)) profs.set(key, p.id);
        }
    }
    return { index, profs };
}

/** A leading number from "94", "92/100", "12 (rising)". NaN when there is none. */
function leadingNumber(value) {
    const m = /^\s*(-?\d+(?:\.\d+)?)/.exec(String(value ?? ''));
    return m ? Number(m[1]) : NaN;
}

/**
 * @param {object} record A SillyNPC character record or the player card.
 * @param {object} type A world type.
 * @returns {{ matches: object[], unknown: object[], skipped: string[], ignored: string[] }}
 *   matches: { key, value, target: 'stats.str' | 'profs.sword' | 'meta.level', parsed }
 *   unknown: understood as combat data but not storable as it is (an off-ladder rank, a word
 *            where a number goes)
 *   skipped: tracker keys, deliberately left alone
 *   ignored: keys that mean nothing to this type
 */
export function detectLegacy(record, type) {
    const result = { matches: [], unknown: [], skipped: [], ignored: [] };
    const overrides = record?.statusOverrides;
    if (!overrides || typeof overrides !== 'object') return result;
    const { index, profs } = buildIndex(type);

    for (const [key, value] of Object.entries(overrides)) {
        const bare = norm(key);
        if (TRACKER_KEYS.has(bare)) { result.skipped.push(key); continue; }

        const profKey = /^(.+?)\s*proficiency$/i.exec(String(key).trim());
        const profId = profKey ? profs.get(norm(profKey[1])) : undefined;
        if (profId) {
            const prof = type.proficiencies.find(p => p.id === profId);
            const ladder = ladderOf(type, prof.ladder);
            const idx = rungIndex(ladder, String(value).trim());
            if (idx >= 0) {
                result.matches.push({ key, value, target: `profs.${profId}`, parsed: ladder.rungs[idx] });
            } else {
                result.unknown.push({ key, value, reason: 'rank is not on the ladder' });
            }
            continue;
        }

        const hit = index.get(bare);
        if (!hit) { result.ignored.push(key); continue; }

        if (hit.kind === 'stat') {
            const n = leadingNumber(value);
            if (Number.isFinite(n)) result.matches.push({ key, value, target: `stats.${hit.id}`, parsed: n });
            else result.unknown.push({ key, value, reason: 'not a number' });
        } else {
            const meta = type.meta.find(m => m.id === hit.id);
            if (meta.type === 'number') {
                const n = leadingNumber(value);
                if (Number.isFinite(n)) result.matches.push({ key, value, target: `meta.${hit.id}`, parsed: n });
                else result.unknown.push({ key, value, reason: 'not a number' });
            } else {
                result.matches.push({ key, value, target: `meta.${hit.id}`, parsed: String(value).trim() });
            }
        }
    }
    return result;
}

/** What detectLegacy found, in the shape of a type's combat data, for showing without saving. */
export function legacyPreviewData(record, type) {
    const found = detectLegacy(record, type);
    const data = emptyTypeData();
    for (const m of found.matches) {
        const [group, id] = m.target.split('.');
        if (group === 'profs') data.profs[id] = { rank: m.parsed, xp: 0 };
        else data[group][id] = m.parsed;
    }
    for (const u of found.unknown) data.unknown[u.key] = u.value;
    data.legacy = found.matches.length > 0;
    return data;
}
