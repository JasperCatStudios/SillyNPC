import { validateExpr } from './combat-formula.js';
import { ladderOf, rungIndex } from './combat-roles.js';
import {
    GEAR_VERSION, GENERIC_LADDER, GENERIC_KINDS, GENERIC_TOOLS, GENERIC_DUAL, GENERIC_FLEE, GENERIC_TEAMS,
    TOOL_EFFECTS, MAX_BELT,
} from './combat-gear-defaults.js';

/**
 * Weapons, tiers and tools (fork): the rules a world type carries and what a character holds.
 *
 * Two halves.
 *
 *   type.gear     The rules, as data: tier ladders (names, colours, four numbers per tier), weapon
 *                 and focus kinds, tool kinds, dual-wield, flee and team numbers. Optional; a type
 *                 with none, or a partial block, is filled in from combat-gear-defaults.js.
 *   char gear     What one character owns: items, what is equipped, which tools are on the belt.
 *
 * A character with no gear block at all still fights: their old `weapon` (name, proficiency,
 * power bonus) is read as one item, and with no weapon either they get a default weapon named
 * from the tier and their best trained proficiency, or Fists. Nothing here is written unless the
 * caller asks (see combat-edit.js), so reading never changes a save.
 *
 * Pure: no DOM, no SillyTavern imports.
 */

export { MAX_BELT, TOOL_EFFECTS };

const SLUG = /^[a-z][a-z0-9_]{0,39}$/i;
const SLOTS = ['hand', 'focus', 'natural'];
const AREAS = ['one', 'side', 'all', 'self'];
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const list = (v) => (Array.isArray(v) ? v : []);
const str = (v, max = 80) => String(v ?? '').trim().slice(0, max);
const num = (v, d = 0) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? Number(v) : d);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const int = (v, lo, hi, d) => Math.round(clamp(num(v, d), lo, hi));

function slugOf(text) {
    return String(text ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
}

/* ---- the rules a type carries -------------------------------------------------------- */

function normalizeTier(raw) {
    const t = obj(raw);
    const out = {
        id: slugOf(t.id) || slugOf(t.label),
        label: str(t.label, 40) || str(t.id, 40),
        prefix: str(t.prefix, 30),
        color: /^#[0-9a-f]{3,8}$/i.test(String(t.color ?? '').trim()) ? String(t.color).trim() : '#9e9e9e',
        icon: str(t.icon, 60) || 'fa-solid fa-circle',
        rarity: str(t.rarity, 30),
        power: clamp(num(t.power), -20, 20),
        hit: clamp(num(t.hit), -20, 20),
        crit: clamp(num(t.crit), 0, 100),
        mult: clamp(num(t.mult, 1), 0.1, 5),
    };
    if (t.signature) out.signature = true;
    return out;
}

function normalizeLadder(raw) {
    const l = obj(raw);
    const seen = new Set();
    const tiers = [];
    for (const raw of list(l.tiers)) {
        const t = normalizeTier(raw);
        if (!t.id || seen.has(t.id)) continue;
        seen.add(t.id);
        tiers.push(t);
    }
    const wanted = slugOf(l.defaultTier);
    return {
        label: str(l.label, 40) || 'Tier',
        defaultTier: seen.has(wanted) ? wanted : (tiers[0]?.id || ''),
        tiers,
    };
}

function normalizeKind(raw) {
    const k = obj(raw);
    const slot = SLOTS.includes(k.slot) ? k.slot : 'hand';
    const hands = slot === 'hand' ? int(k.hands, 1, 2, 1) : 0;
    return {
        id: slugOf(k.id) || slugOf(k.label),
        label: str(k.label, 40) || str(k.id, 40),
        slot,
        hands,
        dualable: slot === 'hand' && hands === 1 && Boolean(k.dualable),
        range: k.range === 'ranged' ? 'ranged' : 'melee',
        ladder: str(k.ladder, 40) || 'default',
        prof: str(k.prof, 60),
        channel: str(k.channel, 40),
        power: clamp(num(k.power), -20, 40),
        hit: clamp(num(k.hit), -20, 20),
        weight: clamp(num(k.weight), 0, 50),
        verb: str(k.verb, 30) || 'strikes',
    };
}

const EFFECT_NUMBERS = ['power', 'flee', 'hit', 'turns', 'share', 'slow'];

function normalizeEffect(raw) {
    const e = obj(raw);
    const out = {
        type: TOOL_EFFECTS.includes(e.type) ? e.type : 'damage',
        area: AREAS.includes(e.area) ? e.area : 'one',
    };
    for (const key of EFFECT_NUMBERS) if (e[key] !== undefined && e[key] !== null && Number.isFinite(Number(e[key]))) out[key] = Number(e[key]);
    // A chance is a number of percent, or a formula over a (the user) and d (the target).
    if (typeof e.chance === 'string' && e.chance.trim()) out.chance = e.chance.trim().slice(0, 160);
    else if (Number.isFinite(Number(e.chance)) && e.chance !== '' && e.chance !== null && e.chance !== undefined) out.chance = Number(e.chance);
    if (e.range === 'ranged' || e.range === 'melee') out.range = e.range;
    if (e.fightOnly) out.fightOnly = true;
    return out;
}

function normalizeToolKind(raw) {
    const t = obj(raw);
    return {
        id: slugOf(t.id) || slugOf(t.label),
        label: str(t.label, 40) || str(t.id, 40),
        uses: int(t.uses, 1, 99, 1),
        verb: str(t.verb, 30) || 'uses',
        effect: normalizeEffect(t.effect),
    };
}

function uniqueById(items) {
    const seen = new Set();
    return items.filter(i => i.id && !seen.has(i.id) && seen.add(i.id));
}

const numbersOver = (defaults, raw) => {
    const r = obj(raw);
    const out = {};
    for (const [k, v] of Object.entries(defaults)) out[k] = Number.isFinite(Number(r[k])) && r[k] !== '' && r[k] !== null ? Number(r[k]) : v;
    return out;
};

const cache = new WeakMap();

/**
 * The gear rules of a type, complete: ladders, kinds, tools and numbers all present. Idempotent
 * and never edits its input. Results are cached per input object, so asking every turn is cheap.
 */
export function normalizeGear(raw) {
    if (raw && typeof raw === 'object' && cache.has(raw)) return cache.get(raw);
    const g = obj(raw);

    const ladders = {};
    for (const [id, l] of Object.entries(obj(g.ladders))) {
        const n = normalizeLadder(l);
        if (n.tiers.length && slugOf(id)) ladders[slugOf(id)] = n;
    }
    if (!ladders.default) ladders.default = normalizeLadder(GENERIC_LADDER);

    let kinds = uniqueById(list(g.kinds).map(normalizeKind));
    if (!kinds.length) kinds = GENERIC_KINDS.map(normalizeKind);
    let unarmed = slugOf(g.unarmed);
    if (!kinds.some(k => k.id === unarmed)) {
        unarmed = kinds.find(k => k.slot === 'natural')?.id || '';
        if (!unarmed) {
            const fists = normalizeKind(GENERIC_KINDS.find(k => k.slot === 'natural'));
            kinds.push(kinds.some(k => k.id === fists.id) ? { ...fists, id: `${fists.id}_default` } : fists);
            unarmed = kinds[kinds.length - 1].id;
        }
    }

    const tools = g.tools === undefined ? GENERIC_TOOLS.map(normalizeToolKind) : uniqueById(list(g.tools).map(normalizeToolKind));

    const teams = obj(g.teams);
    const out = {
        version: GEAR_VERSION,
        ladders,
        kinds,
        unarmed,
        dual: numbersOver(GENERIC_DUAL, g.dual),
        burden: str(g.burden, 200),
        tools,
        flee: numbersOver(GENERIC_FLEE, g.flee),
        teams: {
            maxPerSide: int(teams.maxPerSide, 1, 4, GENERIC_TEAMS.maxPerSide),
            backToWall: numbersOver(GENERIC_TEAMS.backToWall, teams.backToWall),
            crowding: numbersOver(GENERIC_TEAMS.crowding, teams.crowding),
        },
    };
    if (raw && typeof raw === 'object') cache.set(raw, out);
    return out;
}

/** The gear rules of a type (built-in, custom or none). */
export const gearRules = (type) => normalizeGear(type?.gear);

/**
 * Problems in a gear block, for validateType. Only a block that is present is checked: no block
 * is fine. Errors stop the type being used; warnings only inform.
 * @param {object} raw type.gear as written
 * @param {object} type the type, for the proficiencies and channels the kinds point at
 */
export function validateGear(raw, type) {
    const errors = [];
    const warnings = [];
    if (raw === undefined || raw === null) return { errors, warnings };
    if (typeof raw !== 'object' || Array.isArray(raw)) return { errors: ['The gear block is not an object.'], warnings };

    const profIds = new Set(list(type?.proficiencies).map(p => p.id));
    const channelIds = new Set(list(type?.channels).map(c => c.id));

    for (const [id, l] of Object.entries(obj(raw.ladders))) {
        if (!SLUG.test(id)) errors.push(`Gear ladder id "${id}" is not valid.`);
        const tiers = list(l?.tiers);
        if (!tiers.length) { errors.push(`Gear ladder "${id}" has no tiers.`); continue; }
        const seen = new Set();
        for (const t of tiers) {
            const tid = slugOf(t?.id) || slugOf(t?.label);
            if (!tid) errors.push(`A tier in gear ladder "${id}" has no id.`);
            else if (seen.has(tid)) errors.push(`Tier "${tid}" is used twice in gear ladder "${id}".`);
            seen.add(tid);
            for (const key of ['power', 'hit', 'crit', 'mult']) {
                if (t?.[key] !== undefined && !Number.isFinite(Number(t[key]))) errors.push(`Tier "${tid}": ${key} is not a number.`);
            }
        }
        if (l.defaultTier && !seen.has(slugOf(l.defaultTier))) errors.push(`Gear ladder "${id}": the default tier is not on the ladder.`);
    }

    const ladderIds = new Set(['default', ...Object.keys(obj(raw.ladders)).map(slugOf)]);
    const kindIds = new Set();
    for (const k of list(raw.kinds)) {
        const id = slugOf(k?.id) || slugOf(k?.label);
        if (!id) { errors.push('A weapon kind has no id.'); continue; }
        if (kindIds.has(id)) errors.push(`Weapon kind "${id}" is used twice.`);
        kindIds.add(id);
        if (k.slot !== undefined && !SLOTS.includes(k.slot)) errors.push(`Weapon kind "${id}": slot must be hand, focus or natural.`);
        if (k.prof && !profIds.has(k.prof)) errors.push(`Weapon kind "${id}" uses an unknown proficiency "${k.prof}".`);
        if (k.channel && !channelIds.has(k.channel)) errors.push(`Weapon kind "${id}" uses an unknown channel "${k.channel}".`);
        if (k.ladder && !ladderIds.has(slugOf(k.ladder))) errors.push(`Weapon kind "${id}" uses an unknown tier ladder "${k.ladder}".`);
    }
    if (raw.unarmed && kindIds.size && !kindIds.has(slugOf(raw.unarmed))) errors.push(`The unarmed kind "${raw.unarmed}" is not one of the kinds.`);

    const toolIds = new Set();
    for (const t of list(raw.tools)) {
        const id = slugOf(t?.id) || slugOf(t?.label);
        if (!id) { errors.push('A tool kind has no id.'); continue; }
        if (toolIds.has(id)) errors.push(`Tool kind "${id}" is used twice.`);
        toolIds.add(id);
        if (t.effect?.type !== undefined && !TOOL_EFFECTS.includes(t.effect.type)) {
            errors.push(`Tool "${id}": effect type must be one of ${TOOL_EFFECTS.join(', ')}.`);
        }
        if (typeof t.effect?.chance === 'string' && t.effect.chance.trim()) {
            const check = validateExpr(t.effect.chance, { names: () => true, calls: ['has'] });
            if (!check.ok) errors.push(`Tool "${id}": chance: ${check.error}`);
        }
    }
    if (raw.burden) {
        const check = validateExpr(String(raw.burden), { names: () => true, calls: ['has'] });
        if (!check.ok) errors.push(`Gear burden: ${check.error}`);
    }
    return { errors, warnings };
}

/* ---- tiers and kinds ----------------------------------------------------------------- */

export const kindOf = (rules, id) => rules.kinds.find(k => k.id === id) || null;
export const toolKindOf = (rules, id) => rules.tools.find(t => t.id === id) || null;

/** The ladder a kind uses, falling back to the default one. */
export const ladderFor = (rules, kind) => rules.ladders[kind?.ladder] || rules.ladders.default;

/** A tier on a ladder: the named one, else the ladder's default, else its first. */
export function tierOf(ladder, tierId) {
    const tiers = ladder?.tiers || [];
    return tiers.find(t => t.id === tierId) || tiers.find(t => t.id === ladder?.defaultTier) || tiers[0] || null;
}

/** A default weapon's name: the tier's prefix and the kind ("Iron Axe"), or just the kind. */
export function defaultName(kind, tier) {
    // Fists and claws are not made of iron: a natural weapon takes no tier prefix.
    if (kind?.slot === 'natural') return kind.label || 'Weapon';
    return [tier?.prefix, kind?.label].filter(Boolean).join(' ') || 'Weapon';
}

/* ---- what a character owns ----------------------------------------------------------- */

const ID = /[^a-z0-9_-]/gi;

/** An item with only the fields it may have. Ids are left for the caller or normalizeCharGear. */
export function normalizeItem(raw) {
    const i = obj(raw);
    const b = obj(i.bonus);
    const out = {
        id: str(i.id, 40).replace(ID, ''),
        name: str(i.name, 60),
        kind: str(i.kind, 40),
        tier: str(i.tier, 40),
        pair: Boolean(i.pair),
        desc: str(i.desc, 300),
        special: str(i.special, 60),
        bonus: { power: clamp(num(b.power), -20, 40), hit: clamp(num(b.hit), -20, 20), crit: clamp(num(b.crit), 0, 100) },
    };
    if (i.tool) {
        out.tool = true;
        out.maxUses = int(i.maxUses ?? i.uses, 1, 99, 1);
        out.uses = int(i.uses ?? out.maxUses, 0, out.maxUses, out.maxUses);
    }
    return out;
}

/** The next item id not already in use: g1, g2, ... */
export function nextItemId(items) {
    const taken = new Set(list(items).map(i => i?.id));
    for (let n = 1; n < 10000; n++) if (!taken.has(`g${n}`)) return `g${n}`;
    return `g${Date.now()}`;
}

/**
 * A character's gear block, repaired: unique ids, equipped and belt entries that point at real
 * items of the right sort. Null when there is no block (so "no gear yet" stays distinguishable
 * from "gear with nothing in it"). Idempotent.
 */
export function normalizeCharGear(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const items = [];
    const seen = new Set();
    for (const r of list(raw.items).slice(0, 60)) {
        const item = normalizeItem(r);
        if (!item.name && !item.kind) continue;
        if (!item.id || seen.has(item.id)) item.id = nextItemId([...items, ...seen].map(x => (typeof x === 'string' ? { id: x } : x)));
        seen.add(item.id);
        items.push(item);
    }
    const weapons = new Set(items.filter(i => !i.tool).map(i => i.id));
    const tools = new Set(items.filter(i => i.tool).map(i => i.id));
    const eq = obj(raw.equipped);
    const pick = (id) => (weapons.has(String(id ?? '')) ? String(id) : null);
    const equipped = { main: pick(eq.main), off: pick(eq.off), focus: pick(eq.focus) };
    if (equipped.off && equipped.off === equipped.main) equipped.off = null;
    const belt = [...new Set(list(raw.belt).map(String))].filter(id => tools.has(id)).slice(0, MAX_BELT);
    return { items, equipped, belt };
}

/** Does this name read as two blades in one item? ("Dual Scimitars", "Twin daggers") */
export const looksPaired = (name) => /\b(dual|twin|pair|paired|two)\b/i.test(String(name ?? ''));

/**
 * What an old-style weapon (name, proficiency, power bonus) becomes: one item, equipped as the
 * main hand. Pure and read-only: it returns the gear block, the caller decides whether to store
 * it. Null when there is no weapon.
 */
export function migrateLegacyWeapon(type, data) {
    const w = data?.weapon;
    if (!w || (!w.name && !w.prof && !w.power)) return null;
    const rules = gearRules(type);
    const kind = rules.kinds.find(k => k.slot === 'hand' && w.prof && k.prof === w.prof)
        || rules.kinds.find(k => w.prof && k.prof === w.prof)
        || rules.kinds.find(k => k.slot === 'hand')
        || rules.kinds[0];
    const ladder = ladderFor(rules, kind);
    const tier = tierOf(ladder, '');
    const item = normalizeItem({
        id: 'g1',
        name: w.name || defaultName(kind, tier),
        kind: kind.id,
        tier: tier?.id || '',
        pair: kind.dualable && looksPaired(w.name),
        bonus: { power: Number(w.power) || 0 },
    });
    return { items: [item], equipped: { main: item.id, off: null, focus: null }, belt: [] };
}

/** The gear a character effectively has: their block if they have one, else the old weapon as one item. */
export function effectiveGear(type, data) {
    if (data?.gear) return normalizeCharGear(data.gear);
    return migrateLegacyWeapon(type, data);
}

/* ---- at fight time ------------------------------------------------------------------- */

/** The held weapon proficiency a character is best at, or '' (for naming their default weapon). */
function bestWeaponProf(type, data) {
    let best = '';
    let at = -1;
    for (const p of list(type?.proficiencies)) {
        if (!list(p.roles).includes('weapon')) continue;
        const rank = data?.profs?.[p.id]?.rank;
        if (rank === null || rank === undefined || rank === '') continue;
        const i = rungIndex(ladderOf(type, p.ladder), rank);
        if (i > at) { at = i; best = p.id; }
    }
    return best;
}

/** The numbers and words of one strike, from an item (or a default) of a kind and a tier. */
function strike(rules, kind, tier, item, extra = {}) {
    const bonus = item?.bonus || { power: 0, hit: 0, crit: 0 };
    return {
        name: item?.name || defaultName(kind, tier),
        kind: kind.id,
        kindLabel: kind.label,
        ladder: kind.ladder,
        tier: tier?.id || '',
        tierLabel: tier?.label || '',
        power: kind.power + (tier?.power || 0) + bonus.power,
        hit: kind.hit + (tier?.hit || 0) + bonus.hit,
        crit: clamp((tier?.crit || 0) + bonus.crit, 0, 100),
        mult: tier?.mult ?? 1,
        weight: kind.weight,
        range: kind.range,
        prof: kind.prof,
        channel: kind.channel,
        verb: kind.verb,
        special: item?.special || '',
        pair: Boolean(item?.pair),
        hands: kind.hands,
        default: !item,
        ...extra,
    };
}

/**
 * Everything a fighter attacks with, ready for the fight engine: the main hand, the off hand, a
 * focus and the tools on the belt.
 *
 *   main   always present: the equipped weapon, else a default one named from their best trained
 *          proficiency's kind (an unarmed kind when they have none)
 *   off    a second blade when the main item is a pair, or a separate one-handed item; never with
 *          a two-handed main weapon
 *   focus  a book or staff, if equipped
 *   tools  the belt, each with its effect and uses left
 *
 * @param {object} type the world type
 * @param {object} data the character's data for this type (stats, profs, gear, weapon)
 * @param {{ weapon?: object }} [opts] an old-style weapon to use when the data has no gear
 */
export function resolveLoadout(type, data, opts = {}) {
    const rules = gearRules(type);
    const source = data?.gear ? data : { ...(data || {}), weapon: opts.weapon ?? data?.weapon };
    const gear = effectiveGear(type, source);
    const items = new Map((gear?.items || []).map(i => [i.id, i]));
    const forItem = (item) => {
        const kind = kindOf(rules, item?.kind);
        if (!kind) return null;
        return strike(rules, kind, tierOf(ladderFor(rules, kind), item.tier), item);
    };

    let main = gear?.equipped.main ? forItem(items.get(gear.equipped.main)) : null;
    if (!main) {
        const prof = bestWeaponProf(type, data);
        const kind = (prof && rules.kinds.find(k => k.prof === prof && k.slot === 'hand'))
            || kindOf(rules, rules.unarmed) || rules.kinds[0];
        main = strike(rules, kind, tierOf(ladderFor(rules, kind), ''), null);
    }

    let off = null;
    if (main.hands !== 2) {
        if (main.pair && kindOf(rules, main.kind)?.dualable) off = { ...main, off: true };
        else if (gear?.equipped.off) {
            const o = forItem(items.get(gear.equipped.off));
            if (o && o.hands === 1) off = { ...o, off: true };
        }
    }
    const focus = gear?.equipped.focus ? forItem(items.get(gear.equipped.focus)) : null;

    const tools = [];
    for (const id of gear?.belt || []) {
        const item = items.get(id);
        const toolKind = toolKindOf(rules, item?.kind);
        if (!item || !toolKind) continue;
        tools.push({ itemId: id, name: item.name || toolKind.label, kind: toolKind.id, verb: toolKind.verb, effect: toolKind.effect, uses: item.uses ?? item.maxUses ?? toolKind.uses });
    }
    return { main, off, focus, tools };
}

/** A fighter's weapon(s) in words: "Dual Scimitars", "Silver Sword and Dagger", "Fists". */
export function weaponName(loadout) {
    const main = loadout?.main;
    if (!main) return '';
    const off = loadout.off;
    return off && off.name !== main.name ? `${main.name} and ${off.name}` : main.name;
}
