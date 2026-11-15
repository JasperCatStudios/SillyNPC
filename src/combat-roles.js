import { compile, run, validateExpr } from './combat-formula.js';

/**
 * Abstract combat roles (fork).
 *
 * The combat engine and its screens never name a stat. They ask for a role - "health",
 * "speed", "attack in the physical channel" - and the world type says which stat, or which
 * formula over its stats, fills it, and what the world calls it. Fire Emblem's health is
 * "HP"; Bleach's is "Spirit Body". The engine cannot tell the difference.
 *
 * Pure: no DOM, no SillyTavern imports.
 */

export const ROLE_SCHEMA_VERSION = 1;

/** Live, depleting values. Bound through type.pools, not type.roles. */
export const POOL_ROLES = Object.freeze({
    health: { label: 'Health', required: true, help: 'Reaching 0 means defeat.' },
    guard: { label: 'Guard', required: false, help: 'Takes the damage in sparring, in place of health.' },
    resource: { label: 'Resource', required: false, help: 'Pays for techniques: mana, reiatsu, stamina.' },
    armor: { label: 'Armor', required: false, help: 'Absorbs damage before health.' },
});

/** Numbers read from the character. attack and defense are bound once per damage channel. */
export const STAT_ROLES = Object.freeze({
    attack: { label: 'Attack', channeled: true, help: 'Damage dealt, per channel.' },
    defense: { label: 'Defense', channeled: true, help: 'Damage soaked, per channel.' },
    initiative: { label: 'Initiative', help: 'Who acts first in the turn order.' },
    speed: { label: 'Speed', help: 'Chance to strike twice, and to evade.' },
    accuracy: { label: 'Accuracy', help: 'Bonus to hit.' },
    evasion: { label: 'Evasion', help: 'Penalty to the attacker\'s hit.' },
    luck: { label: 'Luck', help: 'Critical and avoidance tweaks.' },
    endurance: { label: 'Endurance', help: 'Resistance to injury.' },
    presence: { label: 'Presence', help: 'Intimidation and morale.' },
    awareness: { label: 'Awareness', help: 'Ambush and reading feints.' },
});

/** Facts about the character that are not numbers in a fight. Bound as meta.<id>. */
export const META_ROLES = Object.freeze({
    level: { label: 'Level' },
    tier: { label: 'Tier' },
    class: { label: 'Class' },
    faction: { label: 'Faction' },
});

/** What a proficiency may be, as far as the engine is concerned. */
export const PROF_ROLES = Object.freeze(['weapon', 'magic', 'support', 'heal', 'movement', 'defense', 'passive']);

/* ------------------------------------------------------------------ modifiers */

/**
 * The type's stat-to-modifier rule.
 * linear: { type:'linear', center, per }  -> trunc((value - center) / per)
 * table:  { type:'table', table:[[below, mod], ...] } ascending; the first row whose `below`
 *         is above the value wins, and the last row catches everything higher.
 */
export function modifierOf(type, value) {
    const rule = type?.modifier;
    const v = Number(value);
    if (!Number.isFinite(v)) return 0;
    if (rule?.type === 'table' && Array.isArray(rule.table) && rule.table.length) {
        for (const row of rule.table) {
            if (v < Number(row[0])) return Number(row[1]);
        }
        return Number(rule.table[rule.table.length - 1][1]);
    }
    const center = Number(rule?.center ?? 0);
    const per = Number(rule?.per ?? 1) || 1;
    return Math.trunc((v - center) / per);
}

/* ------------------------------------------------------------------- ladders */

export function ladderOf(type, id) {
    return type?.ladders?.[id] || null;
}

/** Index of a rung in its ladder, or -1 when it is not one. Case-insensitive. */
export function rungIndex(ladder, rung) {
    if (!ladder || rung === undefined || rung === null) return -1;
    const want = String(rung).trim().toLowerCase();
    return ladder.rungs.findIndex(r => String(r).toLowerCase() === want);
}

/** The bonus a rung is worth: rungs above the zero rung, times bonusPerRung. Never negative. */
export function rungBonus(ladder, rung) {
    const idx = rungIndex(ladder, rung);
    if (idx < 0) return 0;
    const zero = Math.max(0, rungIndex(ladder, ladder.zeroAt));
    return Math.max(0, idx - zero) * Number(ladder.bonusPerRung ?? 1);
}

/* ------------------------------------------------------------------ bindings */

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);

/** Names a binding formula may use: stat.<id> and meta.<id> of this type, and mod(). */
function bindingNames(type) {
    const stats = new Set((type?.stats || []).map(s => s.id));
    const metas = new Set((type?.meta || []).map(m => m.id));
    return (name) => {
        const [root, id, extra] = name.split('.');
        if (extra !== undefined || !id) return false;
        if (root === 'stat') return stats.has(id);
        if (root === 'meta') return metas.has(id);
        return false;
    };
}

/** Every formula-valued binding on a type, flattened: [{ key, role, channel, expr }]. */
function listBindings(type) {
    const out = [];
    const roles = type?.roles || {};
    for (const [role, value] of Object.entries(roles)) {
        if (typeof value === 'string') out.push({ key: role, role, channel: null, expr: value });
        else if (value && typeof value === 'object') {
            for (const [channel, expr] of Object.entries(value)) {
                out.push({ key: `${role}.${channel}`, role, channel, expr: String(expr) });
            }
        }
    }
    for (const pool of type?.pools || []) {
        out.push({ key: `pool.${pool.role}`, role: pool.role, channel: null, expr: String(pool.max), pool: true });
    }
    return out;
}

/**
 * Checks every binding against the type. Errors make the type unusable; warnings do not.
 * A type is invalid only if health is unbound or no channel has an attack binding.
 */
export function resolveBindings(type) {
    const errors = [];
    const warnings = [];
    const known = bindingNames(type);
    const channels = new Set((type?.channels || []).map(c => c.id));

    for (const b of listBindings(type)) {
        const check = validateExpr(b.expr, { names: known, calls: ['mod'] });
        if (!check.ok) errors.push(`Binding "${b.key}": ${check.error}`);
        if (!b.pool) {
            if (!hasOwn(STAT_ROLES, b.role) && !hasOwn(META_ROLES, b.role)) {
                warnings.push(`Role "${b.role}" is not known to this version and is ignored.`);
            } else if (STAT_ROLES[b.role]?.channeled) {
                if (b.channel === null) errors.push(`Role "${b.role}" must be bound per channel.`);
                else if (!channels.has(b.channel)) errors.push(`Binding "${b.key}" names an unknown channel.`);
            }
        } else if (!hasOwn(POOL_ROLES, b.role)) {
            warnings.push(`Pool role "${b.role}" is not known to this version and is ignored.`);
        }
    }

    const poolRoles = new Set((type?.pools || []).map(p => p.role));
    if (!poolRoles.has('health')) errors.push('The health role has no pool.');
    const attack = type?.roles?.attack;
    if (!attack || typeof attack !== 'object' || !Object.keys(attack).length) {
        errors.push('No channel has an attack binding.');
    }
    return { errors, warnings };
}

/** What the engine can and cannot do with this type, so screens hide controls that do nothing. */
export function capabilities(type) {
    const roles = type?.roles || {};
    const pools = new Set((type?.pools || []).map(p => p.role));
    return {
        initiative: hasOwn(roles, 'initiative') || hasOwn(roles, 'speed'),
        followUps: hasOwn(roles, 'speed'),
        accuracy: hasOwn(roles, 'accuracy'),
        evasion: hasOwn(roles, 'evasion'),
        guardPool: pools.has('guard'),
        resourcePool: pools.has('resource'),
        armorPool: pools.has('armor'),
    };
}

/* ----------------------------------------------------------------- projection */

const channelsOf = (type) => (type?.channels || []).map(c => c.id);

/**
 * A character, as the engine sees it under one world type.
 *
 * @param {object} data The character's block for this type: { stats, meta, profs, pools }.
 * @param {object} type The world type.
 * @returns {object} Combatant
 */
export function project(data, type) {
    const d = data || {};
    const stats = {};
    const given = (s) => {
        const raw = d.stats?.[s.id];
        const n = Number(raw);
        return raw === undefined || raw === null || raw === '' || !Number.isFinite(n) ? null : n;
    };
    for (const s of type.stats || []) {
        if (s.defaultFrom) continue;
        stats[s.id] = given(s) ?? Number(s.default ?? s.scale?.min ?? 0);
    }
    // A stat that falls back to another one (so sheets written before it existed keep working).
    for (const s of type.stats || []) {
        if (!s.defaultFrom) continue;
        stats[s.id] = given(s) ?? stats[s.defaultFrom] ?? Number(s.default ?? s.scale?.min ?? 0);
    }
    const meta = {};
    for (const m of type.meta || []) {
        const raw = d.meta?.[m.id];
        meta[m.id] = raw === undefined || raw === null ? (m.default ?? (m.type === 'number' ? 0 : '')) : raw;
    }

    const ctx = { stat: stats, meta };
    const fns = { mod: (v) => modifierOf(type, v) };
    const evalBinding = (expr) => Number(run(expr, ctx, { fns })) || 0;

    const cache = new Map();
    const firstChannel = channelsOf(type)[0] || null;

    const role = (id, channel) => {
        const ch = STAT_ROLES[id]?.channeled ? (channel || firstChannel) : null;
        const key = `${id}.${ch ?? ''}`;
        if (cache.has(key)) return cache.get(key);
        const binding = STAT_ROLES[id]?.channeled ? type.roles?.[id]?.[ch] : type.roles?.[id];
        const value = typeof binding === 'string' ? evalBinding(binding) : 0;
        cache.set(key, value);
        return value;
    };

    const metaRole = (id) => {
        const binding = type.roles?.[id];
        if (typeof binding !== 'string') return undefined;
        return run(binding, ctx, { fns });
    };

    const pools = {};
    for (const p of type.pools || []) {
        const max = Math.max(0, Math.round(evalBinding(p.max)));
        const stored = d.pools?.[p.role];
        const cur = stored === null || stored === undefined ? max : Math.min(max, Math.max(0, Number(stored)));
        pools[p.role] = { cur, max, label: p.label, abbr: p.abbr || p.label, color: p.color || '' };
    }

    const profs = [];
    const tags = new Set();
    for (const p of type.proficiencies || []) {
        const ladder = ladderOf(type, p.ladder);
        const held = d.profs?.[p.id];
        const rank = held?.rank ?? null;
        const idx = ladder ? rungIndex(ladder, rank) : -1;
        const entry = {
            id: p.id, label: p.label, abbr: p.abbr || p.label,
            roles: p.roles || [], tags: p.tags || [], channel: p.channel || null,
            ladderId: p.ladder, rank: idx >= 0 ? ladder.rungs[idx] : null, rankIndex: idx,
            bonus: idx >= 0 ? rungBonus(ladder, rank) : 0,
            xp: Number(held?.xp) || 0, rollRole: p.rollRole || 'attack', group: p.group || null,
        };
        profs.push(entry);
        if (p.grantsTag && idx >= 0 && idx >= rungIndex(ladder, p.grantsTag.from)) tags.add(p.grantsTag.tag);
    }
    if (meta.faction) tags.add(String(meta.faction).toLowerCase());

    const self = {
        stats, meta, pools, profs, tags,
        role,
        /** The type's modifier applied to a role's value. */
        mod: (id, channel) => modifierOf(type, role(id, channel)),
        /** A meta role (level, tier...), through its binding. */
        metaRole,
        prof: (id) => profs.find(p => p.id === id) || null,
    };
    return self;
}

/* --------------------------------------------------------------------- labels */

/** The world's own name for a role, for screens and prompts. */
export function roleLabel(type, roleId, channel) {
    const pool = (type?.pools || []).find(p => p.role === roleId);
    if (pool) return pool.label;
    const binding = STAT_ROLES[roleId]?.channeled ? type?.roles?.[roleId]?.[channel] : type?.roles?.[roleId];
    if (typeof binding === 'string') {
        const m = /^(stat|meta)\.([A-Za-z0-9_]+)$/.exec(binding.trim());
        if (m) {
            const list = m[1] === 'stat' ? type.stats : type.meta;
            const hit = (list || []).find(x => x.id === m[2]);
            if (hit) return hit.label;
        }
    }
    return STAT_ROLES[roleId]?.label || META_ROLES[roleId]?.label || POOL_ROLES[roleId]?.label || roleId;
}

export { compile };

/**
 * Which roles read each stat, by the world's own names: stat id -> ["Attack (Physical)", "Speed"].
 * For the editor, so a number is never just a number: it says what it drives.
 */
export function rolesUsingStat(type) {
    const out = new Map();
    const add = (expr, label) => {
        for (const name of compile(String(expr)).names || []) {
            const [root, id] = name.split('.');
            if (root !== 'stat' || !id) continue;
            if (!out.has(id)) out.set(id, []);
            if (!out.get(id).includes(label)) out.get(id).push(label);
        }
    };
    const channels = Object.fromEntries((type.channels || []).map(c => [c.id, c.label]));
    for (const [role, binding] of Object.entries(type.roles || {})) {
        const def = STAT_ROLES[role] || META_ROLES[role];
        if (!def) continue;
        if (typeof binding === 'string') add(binding, def.label);
        else for (const [ch, expr] of Object.entries(binding || {})) add(expr, `${def.label} (${channels[ch] || ch})`);
    }
    for (const pool of type.pools || []) add(pool.max, pool.label);
    return out;
}
