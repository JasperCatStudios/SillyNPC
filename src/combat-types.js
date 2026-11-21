import { validateExpr } from './combat-formula.js';
import { validateAbilities } from './combat-abilities.js';
import { resolveBindings, ROLE_SCHEMA_VERSION, PROF_ROLES, STAT_ROLES } from './combat-roles.js';
import { BUILTIN_TYPES, BUILTIN_IDS } from './combat-builtins.js';
import { normalizeGear, validateGear } from './combat-gear.js';
import { validateElements } from './combat-elements.js';

/**
 * Combat world types: checking, normalising and finding them (fork).
 *
 * Built-ins come from combat-builtins.js and are frozen. Custom types live in the global
 * library (settings.combatTypes), keyed by id, and are validated before use because they can
 * be imported from anybody.
 *
 * Pure: no DOM, no SillyTavern imports.
 */

const SLUG = /^[a-z][a-z0-9_]{0,39}$/i;
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);

const text = (v, d = '') => (typeof v === 'string' ? v : d);
const list = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

/** Duplicate ids in a list, as a Set. */
function duplicates(items, key = 'id') {
    const seen = new Set();
    const dup = new Set();
    for (const it of items) {
        const id = it?.[key];
        if (seen.has(id)) dup.add(id);
        seen.add(id);
    }
    return dup;
}

/**
 * @param {object} type
 * @returns {{ errors: string[], warnings: string[] }} A type with errors cannot be used.
 */
export function validateType(type) {
    const errors = [];
    const warnings = [];
    if (!type || typeof type !== 'object') return { errors: ['Not a world type.'], warnings };

    if (!SLUG.test(String(type.id || ''))) errors.push('The id must be letters, digits and underscores.');
    if (!String(type.name || '').trim()) errors.push('The type has no name.');
    if (!SLUG.test(String(type.dataKey || ''))) errors.push('The data key must be letters, digits and underscores.');
    if (Number(type.roleSchema) > ROLE_SCHEMA_VERSION) {
        warnings.push('This type was made for a newer role schema; unknown roles are ignored.');
    }

    const stats = list(type.stats);
    if (!stats.length) errors.push('The type has no stats.');
    for (const s of stats) {
        if (!SLUG.test(String(s?.id || ''))) errors.push(`Stat id "${s?.id}" is not valid.`);
        if (!String(s?.label || '').trim()) errors.push(`Stat "${s?.id}" has no label.`);
    }
    for (const d of duplicates(stats)) errors.push(`Stat id "${d}" is used twice.`);

    for (const d of duplicates(list(type.meta))) errors.push(`Meta id "${d}" is used twice.`);

    const channels = list(type.channels);
    if (!channels.length) errors.push('The type has no damage channels.');
    for (const d of duplicates(channels)) errors.push(`Channel "${d}" is used twice.`);
    const channelIds = new Set(channels.map(c => c.id));

    const mod = type.modifier;
    if (mod?.type === 'table') {
        if (!list(mod.table).length) errors.push('The modifier table is empty.');
    } else if (mod?.type === 'linear') {
        if (!Number.isFinite(Number(mod.per)) || Number(mod.per) === 0) errors.push('The modifier needs a non-zero "per".');
    } else {
        errors.push('The modifier must be linear or a table.');
    }

    const ladders = obj(type.ladders);
    for (const [id, ladder] of Object.entries(ladders)) {
        if (!list(ladder?.rungs).length) errors.push(`Ladder "${id}" has no rungs.`);
        else if (ladder.zeroAt !== undefined && !ladder.rungs.includes(ladder.zeroAt)) {
            errors.push(`Ladder "${id}": the zero rung is not on the ladder.`);
        }
    }

    const profs = list(type.proficiencies);
    for (const d of duplicates(profs)) errors.push(`Proficiency id "${d}" is used twice.`);
    for (const p of profs) {
        if (!SLUG.test(String(p?.id || ''))) errors.push(`Proficiency id "${p?.id}" is not valid.`);
        if (!hasOwn(ladders, p?.ladder)) errors.push(`Proficiency "${p?.id}" uses an unknown ladder.`);
        if (p?.channel && !channelIds.has(p.channel)) errors.push(`Proficiency "${p.id}" uses an unknown channel.`);
        for (const r of list(p?.roles)) {
            if (!PROF_ROLES.includes(r)) warnings.push(`Proficiency "${p.id}": role "${r}" is not known.`);
        }
        if (p?.rollRole && !hasOwn(STAT_ROLES, p.rollRole)) errors.push(`Proficiency "${p.id}": unknown roll role "${p.rollRole}".`);
    }

    const bound = resolveBindings(type);
    errors.push(...bound.errors);
    warnings.push(...bound.warnings);

    const res = type.resolution;
    if (!res || typeof res !== 'object') {
        warnings.push('The type has no resolution rules, so it cannot run a fight yet.');
    } else {
        if (!['threshold', 'opposed'].includes(res.mode)) errors.push('Resolution mode must be threshold or opposed.');
        for (const key of ['roll', 'damage']) {
            if (!res[key]) { errors.push(`Resolution is missing "${key}".`); continue; }
            const check = validateExpr(String(res[key]), { names: () => true, calls: ['has'] });
            if (!check.ok) errors.push(`Resolution "${key}": ${check.error}`);
        }
        if (!list(res.bands).length) errors.push('Resolution has no result bands.');
        for (const key of ['initiative', 'followUpChance']) {
            if (!res[key]) continue;
            const check = validateExpr(String(res[key]), { names: () => true, calls: ['has'] });
            if (!check.ok) errors.push(`Resolution "${key}": ${check.error}`);
        }
    }

    for (const a of list(type.advantage)) {
        const check = validateExpr(String(a?.if || ''), { names: () => true, calls: ['has'] });
        if (!check.ok) errors.push(`Advantage rule "${a?.label || a?.if}": ${check.error}`);
    }

    const profIds = new Set(profs.map(p => p.id));
    for (const act of list(type.actions)) {
        if (act?.prof && !profIds.has(act.prof)) errors.push(`Action "${act.key}" uses an unknown proficiency.`);
    }

    {
        const found = validateAbilities(type, validateExpr);
        errors.push(...found.errors);
        warnings.push(...found.warnings);
    }

    {
        // Weapons, tiers and tools. No block is fine; a block that is there must be sound.
        const found = validateGear(type.gear, type);
        errors.push(...found.errors);
        warnings.push(...found.warnings);
    }

    {
        // An elemental wheel read from both fighters. Optional, like gear.
        const found = validateElements(type);
        errors.push(...found.errors);
        warnings.push(...found.warnings);
    }

    const cards = type.skillCards;
    if (cards && typeof cards === 'object') {
        for (const [card, ids] of Object.entries(cards)) {
            for (const id of list(ids)) {
                if (!profIds.has(id)) errors.push(`Skill card "${card}" lists an unknown proficiency "${id}".`);
            }
        }
    }
    return { errors, warnings };
}

/**
 * A copy of a type with the optional parts present, so readers need not check for them.
 * Idempotent, and never edits its input.
 */
export function normalizeType(raw) {
    const t = structuredClone(raw && typeof raw === 'object' ? raw : {});
    t.format = 'worldkit-combat-type';
    t.version = 2;
    t.roleSchema = Number(t.roleSchema) || ROLE_SCHEMA_VERSION;
    t.id = text(t.id).trim();
    t.name = text(t.name).trim() || t.id;
    t.description = text(t.description);
    t.builtin = Boolean(t.builtin);
    t.dataKey = text(t.dataKey).trim() || t.id;
    t.stats = list(t.stats);
    t.meta = list(t.meta);
    t.channels = list(t.channels);
    t.roles = obj(t.roles);
    t.pools = list(t.pools);
    t.ladders = obj(t.ladders);
    t.proficiencies = list(t.proficiencies);
    t.advantage = list(t.advantage);
    t.actions = list(t.actions);
    t.abilities = list(t.abilities);
    // Weapons, tiers and tools, complete: a type that says nothing gets the generic rules.
    t.gear = structuredClone(normalizeGear(t.gear));
    t.modifier = t.modifier && typeof t.modifier === 'object' ? t.modifier : { type: 'linear', center: 50, per: 10 };
    t.stakes = { injuries: false, death: false, ...obj(t.stakes) };
    if (t.skillCards !== null && (typeof t.skillCards !== 'object')) t.skillCards = null;
    return t;
}

/** The global library of custom types: only valid-shaped objects, keyed by their own id. */
export function normalizeTypeLibrary(raw) {
    const out = {};
    for (const [key, value] of Object.entries(obj(raw))) {
        if (!value || typeof value !== 'object') continue;
        const t = normalizeType(value);
        // A custom type is never a built-in, whatever the file said, and never shadows one.
        t.builtin = false;
        if (!t.id) t.id = key;
        if (BUILTIN_IDS.includes(t.id)) continue;
        out[t.id] = t;
    }
    return out;
}

/** Built-ins first, then custom, each with its validation result attached by listTypes. */
export function listTypes(library) {
    const custom = Object.values(normalizeTypeLibrary(library));
    return [...BUILTIN_IDS.map(id => BUILTIN_TYPES[id]), ...custom];
}

export function getType(library, id) {
    if (hasOwn(BUILTIN_TYPES, id)) return BUILTIN_TYPES[id];
    const custom = normalizeTypeLibrary(library)[id];
    return custom || null;
}

/** A custom type as a file others can import: the type itself, never marked built-in. */
export function typeToFile(type) {
    const t = normalizeType(type);
    t.builtin = false;
    return t;
}

/**
 * Reads a world type file: one type, or { format: 'worldkit-combat-types', types: [...] }.
 * Each type is repaired and checked; a type that cannot be used is reported, not imported.
 * A type whose id is a built-in's is refused rather than renamed, so an import never changes
 * which world a saved character belongs to.
 *
 * @param {string} source
 * @returns {{ types: object[], errors: string[], warnings: string[] }}
 */
export function parseTypeFile(source) {
    const out = { types: [], errors: [], warnings: [] };
    let data;
    try {
        data = JSON.parse(source);
    } catch {
        out.errors.push('That file is not JSON.');
        return out;
    }
    // The old sillynpc-* names are still read.
    const raws = (data?.format === 'worldkit-combat-types' || data?.format === 'sillynpc-combat-types') ? list(data.types) : [data];
    for (const raw of raws) {
        if (!raw || typeof raw !== 'object' || (raw.format !== 'worldkit-combat-type' && raw.format !== 'sillynpc-combat-type')) {
            out.errors.push('That is not a Worldkit world type file.');
            continue;
        }
        const t = normalizeType(raw);
        t.builtin = false;
        if (BUILTIN_IDS.includes(t.id)) {
            out.errors.push(`${t.name || t.id}: the id ${t.id} belongs to a built-in world. Change the id in the file and try again.`);
            continue;
        }
        const found = validateType(t);
        if (found.errors.length) { out.errors.push(`${t.name || t.id}: ${found.errors.join(' ')}`); continue; }
        out.warnings.push(...found.warnings.map(w => `${t.name}: ${w}`));
        out.types.push(t);
    }
    if (!out.types.length && !out.errors.length) out.errors.push('That file has no world type in it.');
    return out;
}

/** Per-System module preferences. Only repairs the shape. */
export function normalizeCombatPrefs(raw) {
    const p = obj(raw);
    const map = obj(p.trackerMap);
    return {
        enabled: Boolean(p.enabled),
        activeType: text(p.activeType),
        reviewGrowth: p.reviewGrowth === undefined ? true : Boolean(p.reviewGrowth),
        // What the fight setup screen was last set to, so it is not put back to the middle level every time: the difficulty level
        // ('' means the type's even level) and the stakes ('spar', 'fight' or '').
        playDifficulty: text(typeof p.playDifficulty === 'number' ? String(p.playDifficulty) : p.playDifficulty).slice(0, 8),
        playStakes: p.playStakes === 'spar' || p.playStakes === 'fight' ? p.playStakes : '',
        trackerMap: { health: text(map.health), condition: text(map.condition) },
        // Migrations done in this System, newest first: { id, at, path, typeId, count, label }.
        migrations: list(p.migrations).filter(m => m && typeof m === 'object' && m.id).slice(0, 50),
    };
}
