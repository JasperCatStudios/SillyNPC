/**
 * Elemental matchups (fork): a world's own wheel of magic types, read from BOTH fighters.
 *
 * This is not the `advantage` rule list (that one reads tags on the attack, the way a weapon
 * triangle does). It is a separate, optional block, type.elements, for worlds where what matters
 * is which element each side wields, and where the side holding the beating element gets the
 * edge whether it is attacking or defending.
 *
 *   type.elements = {
 *     meta:     'affinity'            the meta field naming a fighter's element (free text is fine:
 *                                     "Wind Magic", "wind" and an alias all find the same entry)
 *     bonus:    2                     roll bonus for the side whose element beats the other's
 *     dmgMult:  1                     optional: the winning side's blow is multiplied by this
 *                                     (attacker wins) or divided by it (defender wins)
 *     channels: ['magic']             optional: only attacks in these channels clash (all if absent)
 *     label:    'Elemental edge'      optional: a word for the log
 *     list:     [{ id, label, group, option, aliases }]
 *     beats:    { id: [ids] }         one-way: id beats each listed element; '*' = every other one
 *     wards:    { id: [ids] }         defending only: a defender of id turns aside attacks of the
 *                                     listed elements ('*' = every other one, even an unknown one)
 *   }
 *
 * The formula, with s(x, y) = 1 when x beats y, w(d, a) = 1 when a defender d wards off a:
 *
 *   net = clamp(s(a, d) - s(d, a) - w(d, a), -1, 1)
 *   net = +1  the attacker's roll gets +bonus (and the blow x dmgMult)
 *   net = -1  the defender's roll gets +bonus (and the blow / dmgMult); in a threshold world,
 *             which has no defender roll, the attacker's roll gets -bonus instead
 *   net =  0  nothing: same element, unrelated elements, or one nobody lists (a GM-ruled magic)
 *
 * An element that appears in no beats or wards entry is neutral against everything until a world
 * declares a relation for it. A type with no elements block is untouched: no edge, no dice.
 *
 * Two magics on one sheet ("Fire & Wind"): the attacker casts the better of theirs, the defender
 * meets it with the better of theirs (bestMatchup), so net stays within -1..+1. An elemental spell
 * may name its own `element`, which then stands in for the caster's affinity.
 *
 * Pure: no DOM, no SillyTavern imports.
 */

const WILD = '*';
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const list = (v) => (Array.isArray(v) ? v : []);
const SLUG = /^[a-z][a-z0-9_]{0,39}$/i;

/** Lower case, accents folded, letters and digits only: "Anti-Magic" -> "antimagic". */
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '');

const cache = new WeakMap();

/** Name -> element id, from ids, labels, options and aliases (each with and without a trailing "magic"). */
function indexOf(block) {
    if (cache.has(block)) return cache.get(block);
    const index = new Map();
    const add = (name, id) => {
        const key = norm(name);
        if (!key) return;
        if (!index.has(key)) index.set(key, id);
        const bare = key.endsWith('magic') && key.length > 5 ? key.slice(0, -5) : '';
        if (bare && !index.has(bare)) index.set(bare, id);
    };
    for (const e of list(block.list)) {
        if (!e?.id) continue;
        for (const n of [e.id, e.label, e.option, ...list(e.aliases)]) add(n, e.id);
    }
    const out = { index, labels: new Map(list(block.list).filter(e => e?.id).map(e => [e.id, e.label || e.id])) };
    cache.set(block, out);
    return out;
}

/** The element a free-text name stands for, or '' when the world does not know it. */
export function findElement(type, name) {
    const block = type?.elements;
    if (!block) return '';
    const { index } = indexOf(block);
    const key = norm(name);
    if (!key) return '';
    if (index.has(key)) return index.get(key);
    if (key.endsWith('magic') && index.has(key.slice(0, -5))) return index.get(key.slice(0, -5));
    return '';
}

/** Where a sheet joins two magics: "Fire & Wind", "Ice/Water", "Lightning-Thunder", "Flame (Explosion)". */
const JOINS = /\s*(?:&|\+|,|;|\/|\(|\)|\[|\]|\band\b|\bwith\b|\s-\s|-|–|—)\s*/i;

/** Most elements one fighter holds. */
export const MAX_ELEMENTS = 3;

/**
 * Every element a free-text affinity names, in the order written. The whole text is tried first
 * ("Psychic/Illusion", "Anti-Magic" are single names); then its parts ("Fire & Wind Magic" is two);
 * then, only if no part is known, its single words ("Crimson Flame Magic" is Fire). Unknown parts
 * are skipped, so a flavour name beside a real one ("Lightning-Something") still reads.
 */
export function findElements(type, text) {
    const whole = findElement(type, text);
    if (whole) return [whole];
    const out = [];
    const add = (id) => { if (id && !out.includes(id) && out.length < MAX_ELEMENTS) out.push(id); };
    const parts = String(text ?? '').split(JOINS).filter(Boolean);
    for (const part of parts) add(findElement(type, part));
    if (!out.length) for (const word of parts.join(' ').split(/\s+/)) add(findElement(type, word));
    return out;
}

/** A fighter's elements, read from the meta field the world names. [] when none or unknown. */
export function elementsOf(type, view) {
    const field = type?.elements?.meta;
    if (!field) return [];
    return findElements(type, view?.meta?.[field]);
}

/** A fighter's first element. '' when none or unknown. */
export function elementOf(type, view) {
    return elementsOf(type, view)[0] || '';
}

/** Does x's list (beats or wards) cover y? '*' covers every element other than x itself. */
function covers(table, x, y) {
    const targets = list(obj(table)[x]);
    if (!targets.length || !x) return false;
    if (targets.includes(WILD)) return y !== x;
    return Boolean(y) && targets.includes(y);
}

/**
 * The matchup of an attacking element against a defending one.
 * @returns {{ net: -1|0|1, hit: number, defHit: number, dmgMult: number, label: string, a: string, d: string }}
 */
export function matchup(type, a, d) {
    const block = obj(type?.elements);
    const bonus = Number(block.bonus) || 0;
    const step = Number(block.dmgMult) > 0 ? Number(block.dmgMult) : 1;
    const beatsAD = covers(block.beats, a, d) ? 1 : 0;
    const beatsDA = covers(block.beats, d, a) ? 1 : 0;
    const ward = covers(block.wards, d, a) ? 1 : 0;
    const net = Math.max(-1, Math.min(1, beatsAD - beatsDA - ward));
    const { labels } = indexOf(block);
    const name = (id) => labels.get(id) || id || 'none';
    let label = '';
    if (net > 0) label = `${name(a)} over ${name(d)}`;
    else if (net < 0) label = ward && !beatsDA ? `${name(d)} wards off ${name(a)}` : `${name(d)} over ${name(a)}`;
    return {
        net,
        hit: net > 0 ? bonus : 0,
        defHit: net < 0 ? bonus : 0,
        dmgMult: net > 0 ? step : (net < 0 ? 1 / step : 1),
        label,
        a, d,
    };
}

/**
 * The matchup of one side's elements against the other's, for fighters with two magics. The
 * attacker casts whichever of theirs does best; the defender meets it with whichever of theirs
 * does best for them: net = max over a of (min over d of net(a, d)). With one element each it is
 * exactly matchup(); it never leaves -1..+1, so two magics are an extra option, never a bigger bonus.
 */
export function bestMatchup(type, aIds, dIds) {
    const A = list(aIds).length ? list(aIds) : [''];
    const D = list(dIds).length ? list(dIds) : [''];
    let best = null;
    for (const a of A) {
        let worst = null;
        for (const d of D) {
            const m = matchup(type, a, d);
            if (!worst || m.net < worst.net) worst = m;
        }
        if (!best || worst.net > best.net) best = worst;
    }
    return best;
}

/**
 * The elemental edge of one attack, or null when the world has no wheel or this channel does not clash.
 * @param {object} type world type
 * @param {object} attacker projected combatant
 * @param {object} defender projected combatant
 * @param {string|null} channel the attack's damage channel
 * @param {string} [cast] the element the attack itself is of (an elemental spell's `element`).
 *   When the world knows it, it stands in for the attacker's affinity: a Fire spell is Fire,
 *   whoever casts it. Otherwise the attacker's own affinity is used.
 */
export function elementalEdge(type, attacker, defender, channel, cast = '') {
    const block = type?.elements;
    if (!block || typeof block !== 'object') return null;
    const channels = list(block.channels);
    if (channels.length && !channels.includes(channel)) return null;
    const own = cast ? findElement(type, cast) : '';
    return bestMatchup(type, own ? [own] : elementsOf(type, attacker), elementsOf(type, defender));
}

/**
 * One line for the equipment screen: how two fighters' affinities meet on the wheel. '' for a world
 * with no wheel. "Elemental Interaction Wheel: Ana (Fire) against Ben (Plant). Spells of their own
 * affinity: Ana +2 (Fire over Plant), Ben -2 (Fire over Plant)."
 */
export function wheelNote(type, aView, bView, aName = 'You', bName = 'Foe') {
    const block = type?.elements;
    if (!block || typeof block !== 'object') return '';
    const { labels } = indexOf(block);
    const ea = elementsOf(type, aView);
    const eb = elementsOf(type, bView);
    const names = (ids) => (ids.length ? ids.map(id => labels.get(id) || id).join(' & ') : 'no known affinity');
    const bonus = Number(block.bonus) || 0;
    const word = (m) => (m.net > 0 ? `+${bonus} (${m.label})` : m.net < 0 ? `-${bonus} (${m.label})` : 'neutral');
    const head = `${block.label || 'Elements'}: ${aName} (${names(ea)}) against ${bName} (${names(eb)}).`;
    return `${head} Spells of their own affinity: ${aName} ${word(bestMatchup(type, ea, eb))}, ${bName} ${word(bestMatchup(type, eb, ea))}.`;
}

/**
 * A free-text affinity as the world writes it: each element it names, by its sheet option, joined
 * with " & " ("Fire Magic & Wind Magic"). '' when the text names no element. For setMeta.
 */
export function canonicalAffinity(type, text) {
    const block = obj(type?.elements);
    const ids = findElements(type, text);
    const byId = new Map(list(block.list).filter(e => e?.id).map(e => [e.id, e.option || e.label || e.id]));
    return ids.map(id => byId.get(id) || id).join(' & ');
}

/** Every attacking element against every defending one: { [a]: { [d]: net } }, for screens and tests. */
export function wheelTable(type) {
    const ids = list(type?.elements?.list).map(e => e.id).filter(Boolean);
    const out = {};
    for (const a of ids) {
        out[a] = {};
        for (const d of ids) out[a][d] = matchup(type, a, d).net;
    }
    return out;
}

/** Problems in an elements block, for validateType. No block is fine. */
export function validateElements(type) {
    const errors = [];
    const warnings = [];
    const raw = type?.elements;
    if (raw === undefined || raw === null) return { errors, warnings };
    if (typeof raw !== 'object' || Array.isArray(raw)) return { errors: ['The elements block is not an object.'], warnings };

    const metas = new Set(list(type.meta).map(m => m?.id));
    if (!raw.meta || !metas.has(raw.meta)) errors.push(`Elements: "${raw.meta}" is not one of the meta fields.`);
    const bonus = Number(raw.bonus);
    if (!Number.isFinite(bonus) || bonus < 0 || bonus > 10) errors.push('Elements: bonus must be a number from 0 to 10.');
    if (raw.dmgMult !== undefined && !(Number(raw.dmgMult) >= 1 && Number(raw.dmgMult) <= 2)) errors.push('Elements: dmgMult must be between 1 and 2.');
    const channelIds = new Set(list(type.channels).map(c => c?.id));
    for (const ch of list(raw.channels)) if (!channelIds.has(ch)) errors.push(`Elements: unknown channel "${ch}".`);

    const ids = new Set();
    if (!list(raw.list).length) errors.push('Elements: the list is empty.');
    for (const e of list(raw.list)) {
        if (!SLUG.test(String(e?.id || ''))) { errors.push(`Elements: id "${e?.id}" is not valid.`); continue; }
        if (ids.has(e.id)) errors.push(`Elements: "${e.id}" is listed twice.`);
        ids.add(e.id);
    }
    for (const key of ['beats', 'wards']) {
        for (const [x, targets] of Object.entries(obj(raw[key]))) {
            if (!ids.has(x)) errors.push(`Elements ${key}: "${x}" is not in the list.`);
            if (!Array.isArray(targets)) { errors.push(`Elements ${key}.${x} must be a list.`); continue; }
            for (const y of targets) if (y !== WILD && !ids.has(y)) errors.push(`Elements ${key}.${x}: "${y}" is not in the list.`);
            if (targets.includes(x)) warnings.push(`Elements ${key}.${x} names itself, which does nothing.`);
        }
    }
    // An elemental spell names its element; one the wheel does not know falls back to the caster's affinity.
    for (const a of list(type.abilities)) {
        if (a?.element && !findElement(type, a.element)) warnings.push(`Ability ${a.label || a.id}: element "${a.element}" is not on the wheel, so the caster's affinity is used.`);
    }
    // Two elements that each beat the other cancel out silently: say so.
    for (const x of ids) {
        for (const y of ids) {
            if (x < y && covers(raw.beats, x, y) && covers(raw.beats, y, x)) warnings.push(`Elements: ${x} and ${y} each beat the other, so they cancel out.`);
        }
    }
    return { errors, warnings };
}
