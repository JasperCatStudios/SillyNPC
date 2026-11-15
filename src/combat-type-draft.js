import { normalizeType, validateType } from './combat-types.js';
import { STAT_ROLES, POOL_ROLES } from './combat-roles.js';

/**
 * The guided editor's side of a custom world type (fork): turning a form draft into a type and
 * back. Pure: no DOM, no SillyTavern imports, so it is tested in node.
 *
 * The form covers the parts most worlds need: stats, damage channels, which stat fills each
 * role, pools, the modifier and the roll/damage formulas. Everything else (ladders,
 * proficiencies, abilities, gear, elements, advantage rules) rides along untouched in `extra`,
 * which the editor shows as JSON. A copy of an existing type therefore keeps all of it.
 */

const clone = (v) => structuredClone(v);
const text = (v, d = '') => (typeof v === 'string' ? v : d);
const num = (v, d) => (Number.isFinite(Number(v)) && String(v).trim() !== '' ? Number(v) : d);

/** Keys the form owns; every other key of a type is carried in `extra`. */
const FORM_KEYS = ['id', 'name', 'description', 'stats', 'channels', 'roles', 'pools', 'modifier', 'format', 'version',
    'roleSchema', 'builtin', 'dataKey'];
/** Parts of `resolution` the form owns. */
const RES_FORM_KEYS = ['mode', 'roll', 'damage', 'initiative', 'followUpChance', 'bands'];

export const POOL_KEYS = Object.keys(POOL_ROLES);
export const ROLE_KEYS = Object.keys(STAT_ROLES);

/** A lower-case id made from a label: "Magic Power" -> "magic_power". */
export function slug(label, fallback = 'item') {
    const s = String(label ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    const out = /^[a-z]/.test(s) ? s : (s ? `x${s}` : fallback);
    return out.slice(0, 39);
}

/** An id not in `taken`, made from the label. */
export function uniqueId(label, taken, fallback = 'item') {
    const base = slug(label, fallback);
    let id = base;
    for (let i = 2; taken.has(id); i++) id = `${base.slice(0, 36)}_${i}`;
    taken.add(id);
    return id;
}

/** A small, valid starting point: five stats, two channels, an opposed d20. */
export function blankDraft() {
    return {
        id: '',
        name: '',
        description: '',
        stats: [
            { id: 'health', label: 'Health', abbr: 'HP', min: 10, max: 100, default: 40 },
            { id: 'strength', label: 'Strength', abbr: 'STR', min: 0, max: 100, default: 30 },
            { id: 'magic', label: 'Magic', abbr: 'MAG', min: 0, max: 100, default: 30 },
            { id: 'defense', label: 'Defense', abbr: 'DEF', min: 0, max: 100, default: 30 },
            { id: 'speed', label: 'Speed', abbr: 'SPD', min: 0, max: 100, default: 30 },
        ],
        channels: [{ id: 'physical', label: 'Physical' }, { id: 'magic', label: 'Magic' }],
        roles: {
            attack: { physical: 'stat.strength', magic: 'stat.magic' },
            defense: { physical: 'stat.defense', magic: 'stat.defense' },
            speed: 'stat.speed', initiative: 'stat.speed',
            accuracy: '', evasion: '', luck: '', endurance: '', presence: '', awareness: '',
        },
        pools: {
            health: { on: true, label: 'Health', abbr: 'HP', max: 'stat.health', color: '#c0392b' },
            guard: { on: false, label: 'Stamina', abbr: 'STA', max: '20 + stat.health*0.3', color: '#58d68d' },
            resource: { on: false, label: 'Mana', abbr: 'MP', max: '20 + stat.magic*0.8', color: '#8e44ad' },
            armor: { on: false, label: 'Armor', abbr: 'ARM', max: 'stat.defense', color: '#95a5a6' },
        },
        modifier: { type: 'table', center: 50, per: 10, table: '10:-3, 25:-2, 40:-1, 60:0, 75:1, 85:2, 95:3, 1000000:4' },
        resolution: {
            mode: 'opposed',
            roll: 'd20 + diff + a.mod.roll',
            damage: 'max(1, round(band.base + act.power + a.attack*0.25 - d.defense*0.15))',
            initiative: 'a.initiative + d10',
            followUpChance: '',
            bands: [
                { upTo: 0, result: 'stalemate' }, { upTo: 4, result: 'hit' },
                { upTo: 9, result: 'strong' }, { upTo: 999, result: 'crit' },
            ],
        },
        extra: {
            // What the engine needs next to the form's roll and damage, for the starter's formulas to run.
            resolution: {
                natural: { 20: 'crit' },
                bandBase: { stalemate: 0, miss: 0, hit: 6, strong: 10, crit: 16 },
            },
            meta: [],
            proficiencies: [],
            ladders: {},
            actions: [{ key: 'strike', label: 'Strike' }],
        },
        baseId: '',
    };
}

const tableToText = (rows) => (Array.isArray(rows) ? rows.map(r => `${r[0]}:${r[1]}`).join(', ') : '');

/** A form draft from an existing type (a copy, or the one being edited). */
export function draftFromType(type) {
    const t = normalizeType(type);
    const draft = blankDraft();
    draft.id = t.builtin ? '' : t.id;
    draft.baseId = t.id;
    draft.name = t.builtin ? `${t.name} (copy)` : t.name;
    draft.description = t.description;
    draft.stats = t.stats.map(s => ({
        id: s.id, label: s.label || s.id, abbr: s.abbr || '',
        min: s.scale?.min ?? 0, max: s.scale?.max ?? 100, default: s.default ?? '',
    }));
    draft.channels = t.channels.map(c => ({ id: c.id, label: c.label || c.id }));

    const roles = { attack: {}, defense: {} };
    for (const key of ROLE_KEYS) {
        const bound = t.roles[key];
        if (STAT_ROLES[key].channeled) roles[key] = { ...(bound && typeof bound === 'object' ? bound : {}) };
        else roles[key] = text(bound);
    }
    draft.roles = roles;

    for (const key of POOL_KEYS) {
        const p = t.pools.find(x => x.role === key);
        draft.pools[key] = p
            ? { on: true, label: p.label || key, abbr: p.abbr || '', max: text(p.max), color: p.color || draft.pools[key].color }
            : { ...draft.pools[key], on: false };
    }

    const m = t.modifier;
    draft.modifier = m.type === 'table'
        ? { type: 'table', center: 50, per: 10, table: tableToText(m.table) }
        : { type: 'linear', center: num(m.center, 50), per: num(m.per, 10), table: draft.modifier.table };

    const res = t.resolution || {};
    draft.resolution = {
        mode: res.mode || 'opposed', roll: text(res.roll), damage: text(res.damage),
        initiative: text(res.initiative), followUpChance: text(res.followUpChance),
        bands: (Array.isArray(res.bands) ? res.bands : []).map(b => ({ upTo: b.upTo, result: b.result })),
    };

    const extra = {};
    for (const [key, value] of Object.entries(t)) {
        if (FORM_KEYS.includes(key) || key === 'resolution') continue;
        extra[key] = clone(value);
    }
    const resExtra = {};
    for (const [key, value] of Object.entries(res)) if (!RES_FORM_KEYS.includes(key)) resExtra[key] = clone(value);
    if (Object.keys(resExtra).length) extra.resolution = resExtra;
    draft.extra = extra;
    return draft;
}

function parseTable(textValue) {
    const rows = [];
    for (const part of String(textValue || '').split(',')) {
        const bit = part.trim();
        if (!bit) continue;
        const [a, b] = bit.split(':').map(s => s.trim());
        if (!Number.isFinite(Number(a)) || !Number.isFinite(Number(b)) || a === '' || b === '') return null;
        rows.push([Number(a), Number(b)]);
    }
    return rows.sort((x, y) => x[0] - y[0]);
}

/**
 * The type a draft describes, with its problems.
 * @param {object} draft
 * @param {{ takenIds?: string[], builtinIds?: string[], editingId?: string }} [ctx]
 * @returns {{ type: object|null, errors: string[], warnings: string[] }}
 */
export function buildType(draft, ctx = {}) {
    const errors = [];
    const taken = new Set(ctx.takenIds || []);
    const name = text(draft.name).trim();
    if (!name) errors.push('Give the world a name.');

    let id = text(draft.id).trim() || ctx.editingId || '';
    if (!id) id = uniqueId(name || 'world', taken, 'world');
    if ((ctx.builtinIds || []).includes(id)) id = uniqueId(`${id}_custom`, taken, 'world');

    const statIds = new Set();
    const stats = [];
    for (const s of draft.stats || []) {
        const label = text(s.label).trim();
        if (!label) continue;
        const sid = s.id || uniqueId(label, statIds, 'stat');
        statIds.add(sid);
        const lo = num(s.min, 0);
        const hi = num(s.max, 100);
        if (hi <= lo) errors.push(`Stat "${label}": the highest value must be above the lowest.`);
        const out = { id: sid, label, abbr: text(s.abbr).trim() || label.slice(0, 3).toUpperCase(), scale: { min: lo, max: hi } };
        if (String(s.default ?? '').trim() !== '') out.default = num(s.default, lo);
        stats.push(out);
    }

    const chanIds = new Set();
    const channels = [];
    for (const c of draft.channels || []) {
        const label = text(c.label).trim();
        if (!label) continue;
        const cid = c.id || uniqueId(label, chanIds, 'channel');
        chanIds.add(cid);
        channels.push({ id: cid, label });
    }

    const roles = {};
    for (const key of ROLE_KEYS) {
        const bound = draft.roles?.[key];
        if (STAT_ROLES[key].channeled) {
            const per = {};
            for (const c of channels) {
                const expr = text(bound?.[c.id]).trim();
                if (expr) per[c.id] = expr;
            }
            if (Object.keys(per).length) roles[key] = per;
        } else if (text(bound).trim()) roles[key] = text(bound).trim();
    }

    const pools = [];
    for (const key of POOL_KEYS) {
        const p = draft.pools?.[key];
        if (!p?.on) continue;
        pools.push({ role: key, label: text(p.label).trim() || POOL_ROLES[key].label, abbr: text(p.abbr).trim(), max: text(p.max).trim(), color: text(p.color) || '#888888' });
    }

    let modifier;
    if (draft.modifier?.type === 'table') {
        const rows = parseTable(draft.modifier.table);
        if (!rows || !rows.length) errors.push('The modifier table must look like  25:-2, 50:0, 75:1  (a value below the first number gives the second).');
        modifier = { type: 'table', table: rows || [] };
    } else {
        modifier = { type: 'linear', center: num(draft.modifier?.center, 50), per: num(draft.modifier?.per, 10) };
    }

    const bands = [];
    for (const b of draft.resolution?.bands || []) {
        const result = text(b.result).trim();
        if (!result) continue;
        if (!Number.isFinite(Number(b.upTo))) { errors.push(`Result band "${result}": "up to" must be a number.`); continue; }
        bands.push({ upTo: Number(b.upTo), result });
    }
    bands.sort((a, b) => a.upTo - b.upTo);

    // Carried parts first, then the form on top so an edit is never undone by stale JSON.
    const extra = clone(draft.extra || {});
    const resExtra = extra.resolution && typeof extra.resolution === 'object' ? extra.resolution : {};
    delete extra.resolution;
    const r = draft.resolution || {};
    const resolution = {
        ...resExtra,
        mode: r.mode === 'threshold' ? 'threshold' : 'opposed',
        roll: text(r.roll).trim(), damage: text(r.damage).trim(), bands,
    };
    if (text(r.initiative).trim()) resolution.initiative = text(r.initiative).trim();
    if (text(r.followUpChance).trim()) resolution.followUpChance = text(r.followUpChance).trim();

    const raw = {
        ...extra,
        format: 'sillynpc-combat-type', version: 2, id, name, builtin: false, dataKey: id,
        description: text(draft.description).trim(), stats, channels, roles, pools, modifier, resolution,
    };
    const type = normalizeType(raw);
    type.builtin = false;
    const found = validateType(type);
    return { type, errors: [...errors, ...found.errors], warnings: found.warnings };
}

/** Parses the editor's JSON box. */
export function parseExtra(jsonText) {
    const src = String(jsonText || '').trim();
    if (!src) return { ok: true, value: {} };
    try {
        const value = JSON.parse(src);
        if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, reason: 'The advanced box must hold one JSON object, { ... }.' };
        for (const key of FORM_KEYS) {
            if (key in value) return { ok: false, reason: `"${key}" is set by the form above, not here.` };
        }
        return { ok: true, value };
    } catch (err) {
        return { ok: false, reason: `The advanced box is not valid JSON: ${err.message}` };
    }
}
