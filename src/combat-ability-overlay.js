import { ABILITY_KINDS, ABILITY_TRIGGERS } from './combat-abilities.js';

/**
 * Your own abilities, and your edits to the built-in ones (fork).
 *
 * A world type's abilities come with the type and cannot be changed in place, so what you do in
 * the ability editor is kept beside it as an overlay per type:
 *
 *   added    abilities you made
 *   edited   built-in abilities you changed, by id
 *   removed  built-in abilities you hid, by id
 *
 * The type's abilities are then the built-ins with the overlay laid over them. Nothing is lost:
 * resetting an edited or removed built-in just takes it out of the overlay.
 *
 * Pure: no DOM, no SillyTavern imports.
 */

const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);

export function slug(text) {
    return String(text ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
}

/** An ability with only the fields it may have, all of them sane. Unknown keys are dropped. */
export function normalizeAbility(raw) {
    const a = raw && typeof raw === 'object' ? raw : {};
    const kind = ABILITY_KINDS.includes(a.kind) ? a.kind : 'active';
    const out = {
        id: slug(a.id) || slug(a.label),
        label: str(a.label, 60) || str(a.id, 60),
        category: str(a.category, 40) || 'General',
        kind,
        desc: str(a.desc, 300),
    };
    if (kind === 'passive') {
        out.trigger = ABILITY_TRIGGERS.includes(a.trigger) ? a.trigger : 'attack';
        out.chance = str(a.chance, 160);
        if (num(a.whenBelow) > 0 && num(a.whenBelow) <= 1) out.whenBelow = num(a.whenBelow);
    }
    if (kind === 'active') {
        if (a.prof) out.prof = str(a.prof, 60);
        out.power = num(a.power);
    }
    if (kind !== 'passive' && a.cost && a.cost.pool && num(a.cost.amount) > 0) {
        out.cost = { pool: str(a.cost.pool, 40), amount: num(a.cost.amount) };
    }
    const effect = {};
    const e = a.effect && typeof a.effect === 'object' ? a.effect : {};
    if (num(e.dmgMult, 1) !== 1 && kind !== 'defensive') effect.dmgMult = num(e.dmgMult, 1);
    if (num(e.block) > 0) effect.block = Math.min(1, num(e.block));
    if (num(e.heal) > 0) effect.heal = Math.min(1, num(e.heal));
    if (num(e.missingBonus) > 0 && kind !== 'defensive') effect.missingBonus = Math.min(5, num(e.missingBonus));
    if (num(e.drain) > 0 && kind !== 'defensive') effect.drain = Math.min(1, num(e.drain));
    if (num(e.counter) > 0 && kind === 'passive' && a.trigger === 'defend') effect.counter = Math.min(3, num(e.counter));
    out.effect = effect;
    return out;
}

export function emptyOverlay() {
    return { added: [], edited: {}, removed: [] };
}

export function normalizeOverlay(raw) {
    const o = raw && typeof raw === 'object' ? raw : {};
    const edited = {};
    for (const [id, a] of Object.entries(o.edited && typeof o.edited === 'object' ? o.edited : {})) {
        const n = normalizeAbility({ ...a, id });
        if (n.id) edited[n.id] = n;
    }
    const seen = new Set();
    const added = [];
    for (const a of Array.isArray(o.added) ? o.added : []) {
        const n = normalizeAbility(a);
        if (n.id && !seen.has(n.id)) { seen.add(n.id); added.push(n); }
    }
    return {
        added,
        edited,
        removed: [...new Set((Array.isArray(o.removed) ? o.removed : []).map(String))],
    };
}

/** The built-ins with the overlay laid over them. Each entry says where it came from: source. */
export function mergeAbilities(base, overlay) {
    const ov = normalizeOverlay(overlay);
    const out = [];
    for (const a of base || []) {
        if (ov.removed.includes(a.id)) continue;
        out.push(ov.edited[a.id] ? { ...ov.edited[a.id], source: 'edited' } : { ...a, source: 'built-in' });
    }
    const have = new Set(out.map(a => a.id));
    for (const a of ov.added) if (!have.has(a.id)) out.push({ ...a, source: 'custom' });
    return out;
}

const isBase = (base, id) => (base || []).some(a => a.id === id);

/** Saves an ability: a change to a built-in becomes an edit, anything else is one of yours. */
export function saveInOverlay(base, overlay, ability) {
    const ov = normalizeOverlay(overlay);
    const a = normalizeAbility(ability);
    if (!a.id) return ov;
    ov.removed = ov.removed.filter(id => id !== a.id);
    if (isBase(base, a.id)) {
        ov.edited[a.id] = a;
        ov.added = ov.added.filter(x => x.id !== a.id);
    } else {
        const at = ov.added.findIndex(x => x.id === a.id);
        if (at >= 0) ov.added[at] = a; else ov.added.push(a);
    }
    return ov;
}

/** Deletes one of yours, or hides a built-in. */
export function removeFromOverlay(base, overlay, id) {
    const ov = normalizeOverlay(overlay);
    ov.added = ov.added.filter(x => x.id !== id);
    delete ov.edited[id];
    if (isBase(base, id) && !ov.removed.includes(id)) ov.removed.push(id);
    return ov;
}

/** Puts a built-in back as it came. */
export function resetInOverlay(overlay, id) {
    const ov = normalizeOverlay(overlay);
    delete ov.edited[id];
    ov.removed = ov.removed.filter(x => x !== id);
    return ov;
}

/** An id not used by any ability in the list. */
export function freeId(list, wanted) {
    const taken = new Set((list || []).map(a => a.id));
    const root = slug(wanted) || 'ability';
    if (!taken.has(root)) return root;
    for (let n = 2; n < 1000; n++) if (!taken.has(`${root}_${n}`)) return `${root}_${n}`;
    return `${root}_${Date.now()}`;
}

/** Abilities grouped by category, in the order the categories first appear. */
export function groupByCategory(list) {
    const groups = new Map();
    for (const a of list || []) {
        const c = a.category || 'General';
        if (!groups.has(c)) groups.set(c, []);
        groups.get(c).push(a);
    }
    return [...groups.entries()].map(([category, items]) => ({ category, items }));
}
