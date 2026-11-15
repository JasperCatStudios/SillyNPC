/**
 * The Bond Tracker (fork): how close each person in a story is to the player, how that
 * closeness grows, what it allows, and the moments that marked it.
 *
 * It used to be one paragraph inside the Internal States prompt (BOND, Sparks, Grudge), which
 * the writer model was trusted to follow. Rules a model is merely asked to follow drift: a
 * stranger became a lover in four messages because every message was "a positive
 * interaction". Here the model only proposes a change; the numbers it may move are clamped by
 * rules the user owns, so growth stays believable whatever the model's mood.
 *
 * This file owns the vocabulary and the arithmetic. bonds.js does the SillyTavern I/O.
 *
 * Pure: no DOM, no SillyTavern imports, so node can test it.
 */

import { chooseEntries } from './vector-core.js';

/* ---- vocabulary ---------------------------------------------------------------------- */

export const BOND_TIMINGS = Object.freeze({
    after: 'After the reply (separate request)',
    inline: 'With the reply (the story model writes it)',
    manual: 'Only when I press Update',
});

export const GATE_KINDS = Object.freeze({
    intimacy: 'Intimacy',
    social: 'Social',
    conduct: 'Conduct',
});

/** A gate set to this never unlocks, whatever the bond. */
export const NEVER = 'never';

export const INJECT_POSITIONS = Object.freeze({
    before: 'Before the story prompt',
    prompt: 'In the prompt',
    chat: 'In the chat, this many messages back',
});
export const INJECT_ROLES = Object.freeze({ system: 'System', user: 'User', assistant: 'Assistant' });
export const INJECT_TRIGGERS = Object.freeze({
    always: 'Always, for everyone tracked',
    scene: 'Only when they are in the scene',
    mentioned: 'Only when their name came up recently',
    random: 'Randomly, a few at a time',
});
export const INJECT_ORDERS = Object.freeze({
    bond: 'Closest bond first',
    recent: 'Most recently seen first',
    name: 'Alphabetical',
});

/** The block the story model is asked to append in the "with the reply" timing. */
export const INLINE_TAG = 'bond_update';

/*
 * Store version 2: a bond is two directed edges, each with its own meters.
 *
 *   toPlayer   - how the character feels about the player. The model proposes changes to it.
 *   fromPlayer - how the player feels about the character. Set by hand; the model never moves it.
 *
 * The platonic level of an edge is levelFor(min(affection, trust)): warmth without trust, or
 * trust without warmth, does not make a friend. Respect is kept and shown.
 *
 * Romance is a second, separate track read from desire (romantic and physical attraction) on
 * its own levels. It is off on every edge until switched on by hand (edge.romance), and only
 * counts while the person's lock is 'open'. Each edge has its own switch and its own desire, so
 * a romance can be one-sided either way.
 */
export const METERS = Object.freeze(['affection', 'trust', 'respect']);
export const ALL_METERS = Object.freeze(['affection', 'trust', 'respect', 'desire']);
export const METER_LABELS = Object.freeze({ affection: 'Affection', trust: 'Trust', respect: 'Respect', desire: 'Desire' });
export const EDGE_DIRS = Object.freeze({ toPlayer: 'Toward you', fromPlayer: 'Your side' });
/** What a bond may become. Anything but 'open' keeps romance off, whatever the switches say. */
export const BOND_LOCKS = Object.freeze({ open: 'Open', platonic: 'Platonic only', familial: 'Family' });
/** Which scale a gate is read from. */
export const GATE_TRACKS = Object.freeze({ platonic: 'Friendship', romance: 'Romance' });
/** Romance gates: whether the character alone may start it, or both must feel it. */
export const GATE_SCOPES = Object.freeze({ initiates: 'They may start it', mutual: 'Both must feel it' });
export const STORE_VERSION = 2;
/**
 * How a character's romance (their toPlayer edge) gets switched on. Manual: only by hand, and the
 * model is never asked. Suggest: the model may flag a romantic turn, which waits for the user.
 * Automatic: the flag switches it on. The player's own side is always set by hand.
 */
export const ROMANCE_UNLOCKS = Object.freeze({
    manual: 'Manual - I switch it on',
    suggest: 'Suggest - ask me',
    auto: 'Automatic',
});

/* ---- defaults ------------------------------------------------------------------------ */

/*
 * Levels are thresholds on one scale: a person is at the highest level whose threshold their
 * value has reached. Below zero is for people who dislike the player; most stories start at 0.
 */
export const DEFAULT_LEVELS = Object.freeze([
    { id: 'hostile', name: 'Hostile', familial: 'Bitter', min: -50, description: 'Openly hostile. Refuses help, may work against them.' },
    { id: 'wary', name: 'Wary', familial: 'Strained', min: -15, description: 'Distrustful and guarded. Short answers, keeps their distance.' },
    { id: 'stranger', name: 'Stranger', familial: 'Distant', min: 0, description: 'Polite or indifferent. Treats them like anyone else.' },
    { id: 'acquaintance', name: 'Acquaintance', familial: 'Cordial', min: 10, description: 'Recognises them and is friendly in passing. Small talk.' },
    { id: 'friend', name: 'Friend', familial: 'Warm', min: 25, description: 'Enjoys their company, seeks them out, jokes with them.' },
    { id: 'close_friend', name: 'Close friend', familial: 'Close', min: 40, description: 'Comfortable and warm. Opens up, worries about them.' },
    { id: 'trusted', name: 'Trusted', familial: 'Steadfast', min: 55, description: 'Deep trust. Would take risks for them and keep their secrets.' },
    { id: 'confidant', name: 'Confidant', familial: 'Inseparable', min: 70, description: 'Knows their heart. Would drop everything for them and expects the same.' },
    { id: 'kindred', name: 'Kindred', familial: 'Unbreakable', min: 85, description: 'Family by choice. Loyalty that would survive anything.' },
]);

/** The platonic defaults before romance had its own track. Saved levels equal to these are upgraded. */
export const LEGACY_DEFAULT_LEVELS = Object.freeze([
    ...DEFAULT_LEVELS.slice(0, 7),
    { id: 'romantic', name: 'Romantic interest', min: 70, description: 'Attracted to them and aware of it. Nervous, hopeful, tender.' },
    { id: 'partner', name: 'Partner', min: 85, description: 'Committed to each other. Open affection and shared plans.' },
]);

/** Thresholds on desire. Below the first, there is no romance yet. */
export const DEFAULT_ROMANCE_LEVELS = Object.freeze([
    { id: 'interest', name: 'Interest', min: 10, description: 'Notices them. A second glance, a little self-conscious around them.' },
    { id: 'attraction', name: 'Attraction', min: 25, description: 'Drawn to them and aware of it. Seeks their attention, hopeful and a little nervous.' },
    { id: 'courting', name: 'Courting', min: 40, description: 'Openly pursuing them: flirting with intent, invitations, small romantic gestures.' },
    { id: 'dating', name: 'Dating', min: 55, description: 'Seeing each other on purpose. Tender, a little giddy, learning each other.' },
    { id: 'devoted', name: 'Devoted', min: 70, description: 'Deeply in love. Puts them first and is not shy about showing it.' },
    { id: 'partner', name: 'Partner', min: 85, description: 'A committed couple. Open affection, shared plans, a life woven together.' },
    { id: 'bonded', name: 'Bonded', min: 95, description: 'A love that defines them both. Unshakeable devotion.' },
]);

/*
 * track: which scale the gate's level is on. scope (romance only): 'initiates' needs only the
 * character's feeling; 'mutual' needs both sides at the level. minBond: a platonic level both
 * sides must also have reached ('' for none).
 */
export const DEFAULT_GATES = Object.freeze([
    { id: 'personal_talk', label: 'Talks about personal matters', kind: 'social', track: 'platonic', level: 'acquaintance' },
    { id: 'first_name', label: 'Uses a nickname or pet name', kind: 'social', track: 'platonic', level: 'friend' },
    { id: 'favours', label: 'Asks for or offers favours unprompted', kind: 'social', track: 'platonic', level: 'friend' },
    { id: 'vulnerable', label: 'Shows fear, grief or weakness openly', kind: 'social', track: 'platonic', level: 'close_friend' },
    { id: 'secrets', label: 'Shares real secrets', kind: 'social', track: 'platonic', level: 'trusted' },
    { id: 'risk', label: 'Takes serious risks for them', kind: 'conduct', track: 'platonic', level: 'trusted' },
    { id: 'casual_touch', label: 'Casual touch (shoulder, arm)', kind: 'intimacy', track: 'platonic', level: 'friend' },
    { id: 'hug', label: 'Hugging', kind: 'intimacy', track: 'platonic', level: 'close_friend' },
    { id: 'flirting', label: 'Flirting', kind: 'intimacy', track: 'romance', level: 'interest', scope: 'initiates' },
    { id: 'hand_holding', label: 'Holding hands', kind: 'intimacy', track: 'romance', level: 'attraction', scope: 'mutual' },
    { id: 'kissing', label: 'Kissing', kind: 'intimacy', track: 'romance', level: 'courting', scope: 'mutual' },
    { id: 'love_words', label: 'Says "I love you"', kind: 'intimacy', track: 'romance', level: 'devoted', scope: 'initiates' },
    { id: 'intimacy', label: 'Sexual intimacy', kind: 'intimacy', track: 'romance', level: 'partner', scope: 'mutual', minBond: 'trusted' },
]);

/** Where the default gates used to open, before romance had its own track. */
const LEGACY_GATE_LEVELS = Object.freeze({
    flirting: 'close_friend', hand_holding: 'romantic', kissing: 'romantic', love_words: 'partner', intimacy: 'partner',
});
/** Old platonic level ids that became romance levels, for custom gates still pointing at them. */
const REMOVED_LEVEL_MAP = Object.freeze({ romantic: 'attraction', partner: 'partner' });

export const DEFAULT_MILESTONES = Object.freeze([
    { id: 'first_meeting', label: 'First meeting', hint: 'They meet for the first time on screen.' },
    { id: 'first_conversation', label: 'First real conversation', hint: 'A conversation of substance, beyond small talk.' },
    { id: 'first_argument', label: 'First argument', hint: 'A real disagreement with raised feelings.' },
    { id: 'first_reconciliation', label: 'First apology or reconciliation', hint: 'One of them sincerely apologises or they make up.' },
    { id: 'first_gift', label: 'First gift', hint: 'One gives the other a gift.' },
    { id: 'first_date', label: 'First date', hint: 'An outing both understand as a date.' },
    { id: 'first_touch', label: 'First touch or hand-hold', hint: 'The first deliberate affectionate touch or holding hands.' },
    { id: 'first_kiss', label: 'First kiss', hint: 'They kiss for the first time.' },
    { id: 'first_love', label: 'First "I love you"', hint: 'One says "I love you" (or plainly the same) for the first time.' },
    { id: 'first_intimacy', label: 'First intimacy', hint: 'They are sexually intimate for the first time.' },
    { id: 'first_betrayal', label: 'First betrayal', hint: 'One betrays the trust of the other.' },
    { id: 'first_fight', label: 'First fight', hint: 'They come to blows or fight each other.' },
    { id: 'promise', label: 'A promise made', hint: 'One makes the other a meaningful promise.', once: false },
    { id: 'secret', label: 'A secret shared', hint: 'One confides a real secret to the other.', once: false },
    { id: 'saved', label: 'Saved their life', hint: 'One rescues the other from real danger.', once: false },
]);

export const DEFAULT_GROWTH = Object.freeze({
    min: -50,
    max: 100,
    start: 0,
    /** Largest rise one turn may bring. */
    maxGain: 3,
    /** Largest fall one turn may bring. Falls are allowed to be sharper: trust breaks faster than it builds. */
    maxLoss: 8,
    /** At most windowGain points of rise over any windowTurns turns. 0 turns switches it off. */
    windowTurns: 10,
    windowGain: 12,
    /** Percent by which a rise shrinks as the bond nears the top of the scale. */
    slowdown: 50,
    /** Percent of the rise caps (per turn and per window) desire gets: romance builds slower than warmth. */
    desireRate: 50,
    decay: false,
    /** Turns a person can go unseen before their bond starts to fade. */
    decayAfter: 20,
    decayEvery: 10,
    decayAmount: 1,
    /** Fading never takes a bond below this. */
    decayFloor: 0,
    raises: [
        'Kindness, help or protection',
        'Honest conversation, shared laughter, time spent together',
        'Keeping a promise, remembering something that matters to them',
        'Respecting their boundaries',
    ].join('\n'),
    lowers: [
        'Insults, dismissal, being ignored',
        'Lies discovered, broken promises',
        'Pushing for something their bond level does not allow yet',
        'Betrayal or cruelty (the largest drops)',
    ].join('\n'),
});

export const DEFAULT_INJECT = Object.freeze({
    enabled: true,
    position: 'chat',
    depth: 2,
    role: 'system',
    trigger: 'scene',
    scanDepth: 6,
    chance: 100,
    order: 'bond',
    maxPeople: 4,
    /** Milestones written out per person, newest first. */
    historyCount: 6,
    /** Also list what is not allowed yet, and what unlocks it. */
    showLocked: true,
    instruction: 'Keep how each character treats {{user}} within what their bond level allows. Acts that are '
        + 'not allowed yet do not happen: if {{user}} pushes for one, the character hesitates, deflects or '
        + 'refuses in character. Milestones are shared memories they may bring up when it feels natural.',
});

export const BOND_DEFAULTS = Object.freeze({
    enabled: true,
    timing: 'after',
    maxTokens: 800,
    contextMessages: 2,
    /** Empty means the built-in instructions. */
    prompt: '',
    growth: DEFAULT_GROWTH,
    levels: DEFAULT_LEVELS,
    romanceLevels: DEFAULT_ROMANCE_LEVELS,
    gates: DEFAULT_GATES,
    milestones: DEFAULT_MILESTONES,
    inject: DEFAULT_INJECT,
    /** See ROMANCE_UNLOCKS. */
    romanceUnlock: 'manual',
    /** The platonic value (lower of affection and trust) a character needs before a romance suggestion counts. */
    romanceMinBond: 40,
    /** Turns after "Keep platonic" before the same person may be suggested again. */
    romanceCooldown: 10,
});

/* ---- small helpers ------------------------------------------------------------------- */

const str = (v, max = 400) => String(v ?? '').trim().slice(0, max);
const num = (v, lo, hi, d) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
};
const int = (v, lo, hi, d) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
};
const pick = (v, table, d) => (Object.prototype.hasOwnProperty.call(table, v) ? v : d);
/** One decimal place: small fractional rises survive the slowdown without the UI showing noise. */
const tenth = (n) => Math.round(n * 10) / 10;
export const sameName = (a, b) => str(a, 200).toLowerCase() === str(b, 200).toLowerCase();
export const slug = (v) => str(v, 60).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

export function newId(prefix = 'm') {
    return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

const clone = (v) => JSON.parse(JSON.stringify(v));

/* ---- settings ------------------------------------------------------------------------ */

export function normalizeGrowth(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const d = DEFAULT_GROWTH;
    const min = int(r.min, -1000, 0, d.min);
    const max = int(r.max, 1, 1000, d.max);
    return {
        min,
        max,
        start: int(r.start, min, max, Math.max(min, Math.min(max, d.start))),
        maxGain: num(r.maxGain, 0, 100, d.maxGain),
        maxLoss: num(r.maxLoss, 0, 100, d.maxLoss),
        windowTurns: int(r.windowTurns, 0, 500, d.windowTurns),
        windowGain: num(r.windowGain, 0, 1000, d.windowGain),
        slowdown: int(r.slowdown, 0, 95, d.slowdown),
        desireRate: int(r.desireRate, 5, 100, d.desireRate),
        decay: Boolean(r.decay),
        decayAfter: int(r.decayAfter, 1, 1000, d.decayAfter),
        decayEvery: int(r.decayEvery, 1, 1000, d.decayEvery),
        decayAmount: num(r.decayAmount, 0, 100, d.decayAmount),
        decayFloor: int(r.decayFloor, min, max, Math.max(min, Math.min(max, d.decayFloor))),
        raises: typeof r.raises === 'string' ? r.raises.slice(0, 2000) : d.raises,
        lowers: typeof r.lowers === 'string' ? r.lowers.slice(0, 2000) : d.lowers,
    };
}

function normalizeLevelList(raw, defaults, lo, { familial = false } = {}) {
    const list = Array.isArray(raw) ? raw : clone(defaults);
    const seen = new Set();
    const out = [];
    for (const l of list) {
        if (!l || typeof l !== 'object') continue;
        const name = str(l.name, 60);
        if (!name) continue;
        let id = slug(l.id) || slug(name) || newId('l');
        while (seen.has(id) || id === NEVER) id = `${id}_2`;
        seen.add(id);
        const level = { id, name, min: int(l.min, lo, 1000, Math.max(lo, 0)), description: str(l.description, 400) };
        // The name the level goes by between kin-like people. '' falls back to the name.
        if (familial) level.familial = typeof l.familial === 'string' ? str(l.familial, 40) : '';
        out.push(level);
    }
    if (!out.length) return clone(defaults);
    return out.sort((a, b) => a.min - b.min);
}

/** Platonic levels sorted by threshold, every id unique, never empty. Each has a familial name ('' for none). */
export function normalizeLevels(raw) {
    return normalizeLevelList(raw, DEFAULT_LEVELS, -1000, { familial: true });
}

/**
 * Levels saved before they had familial names: a level whose id is one of the default ids and
 * that has no familial field at all gets the default familial name. Custom levels, and levels
 * whose familial name was cleared on purpose (''), are left alone. Running it again changes nothing.
 */
export function migrateFamilial(raw) {
    if (!Array.isArray(raw)) return raw;
    return raw.map((l) => {
        if (!isObj(l) || hasOwn(l, 'familial')) return l;
        const d = DEFAULT_LEVELS.find(x => x.id === l.id);
        return d ? { ...l, familial: d.familial } : l;
    });
}

/**
 * The name a platonic level goes by for one person: its familial name when their bond is
 * Family and the level has one, otherwise its own name.
 */
export function levelName(level, person = null) {
    if (!level) return '';
    return person?.lock === 'familial' && level.familial ? level.familial : level.name;
}

/** Romance levels: thresholds on desire, which never goes below 0. */
export function normalizeRomanceLevels(raw) {
    return normalizeLevelList(raw, DEFAULT_ROMANCE_LEVELS, 0);
}

/**
 * Saved platonic levels that are exactly the old defaults (same ids, same thresholds) get the
 * new top two, Confidant and Kindred, in place of Romantic interest and Partner. Anything
 * customised is left alone. Running it again changes nothing.
 */
export function migrateLevels(raw) {
    if (!Array.isArray(raw) || raw.length !== LEGACY_DEFAULT_LEVELS.length) return raw;
    const key = (l) => `${slug(l?.id)}:${Number(l?.min)}`;
    const saved = new Set(raw.map(key));
    if (!LEGACY_DEFAULT_LEVELS.every(l => saved.has(key(l)))) return raw;
    const swap = { romantic: DEFAULT_LEVELS[7], partner: DEFAULT_LEVELS[8] };
    return raw.map(l => (swap[slug(l.id)] ? { ...swap[slug(l.id)] } : l));
}

/**
 * Gates saved before they had a track. A default gate still at its old default level takes the
 * new default (romance track); a gate pointing at a platonic level that no longer exists
 * (romantic, partner) moves to the matching romance level; every other gate becomes platonic,
 * unchanged. Gates that already have a track are not touched, so it runs once.
 */
export function migrateGates(raw, platonicIds) {
    if (!Array.isArray(raw)) return raw;
    const ids = platonicIds instanceof Set ? platonicIds : new Set(platonicIds || []);
    return raw.map((g) => {
        if (!isObj(g) || Object.prototype.hasOwnProperty.call(GATE_TRACKS, g.track)) return g;
        const id = slug(g.id);
        if (LEGACY_GATE_LEVELS[id] && g.level === LEGACY_GATE_LEVELS[id]) {
            const fresh = DEFAULT_GATES.find(d => d.id === id);
            return { ...fresh, label: str(g.label, 120) || fresh.label, kind: g.kind || fresh.kind };
        }
        if (REMOVED_LEVEL_MAP[g.level] && !ids.has(g.level)) {
            return { ...g, track: 'romance', level: REMOVED_LEVEL_MAP[g.level], scope: 'mutual' };
        }
        return { ...g, track: 'platonic' };
    });
}

/**
 * Gates repaired against both level lists. One pointing at a level that no longer exists on its
 * track unlocks at that track's top level rather than at once; a min-bond level that no longer
 * exists becomes the top platonic level.
 */
export function normalizeGates(raw, levels, romanceLevels = DEFAULT_ROMANCE_LEVELS) {
    const list = Array.isArray(raw) ? raw : clone(DEFAULT_GATES);
    const platonicIds = new Set(levels.map(l => l.id));
    const romanceIds = new Set(romanceLevels.map(l => l.id));
    const top = levels[levels.length - 1]?.id || NEVER;
    const romanceTop = romanceLevels[romanceLevels.length - 1]?.id || NEVER;
    const seen = new Set();
    const out = [];
    for (const g of list) {
        if (!g || typeof g !== 'object') continue;
        const label = str(g.label, 120);
        if (!label) continue;
        let id = slug(g.id) || slug(label) || newId('g');
        while (seen.has(id)) id = `${id}_2`;
        seen.add(id);
        const track = pick(g.track, GATE_TRACKS, 'platonic');
        const ids = track === 'romance' ? romanceIds : platonicIds;
        const level = g.level === NEVER ? NEVER : (ids.has(g.level) ? g.level : (track === 'romance' ? romanceTop : top));
        const minBond = !g.minBond || g.minBond === NEVER ? '' : (platonicIds.has(g.minBond) ? g.minBond : top);
        out.push({ id, label, kind: pick(g.kind, GATE_KINDS, 'social'), track, level, scope: pick(g.scope, GATE_SCOPES, 'initiates'), minBond });
    }
    return out;
}

export function normalizeMilestonePresets(raw) {
    const list = Array.isArray(raw) ? raw : clone(DEFAULT_MILESTONES);
    const seen = new Set();
    const out = [];
    for (const m of list) {
        if (!m || typeof m !== 'object') continue;
        const label = str(m.label, 80);
        if (!label) continue;
        let id = slug(m.id) || slug(label) || newId('p');
        while (seen.has(id) || id === 'custom') id = `${id}_2`;
        seen.add(id);
        out.push({
            id,
            label,
            hint: str(m.hint, 300),
            // Whether the per-turn update may record it on its own.
            auto: m.auto !== false,
            // A "first" happens once; a promise can be made many times.
            once: m.once !== false,
        });
    }
    return out;
}

export function normalizeBondInject(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const d = DEFAULT_INJECT;
    return {
        enabled: r.enabled === undefined ? d.enabled : Boolean(r.enabled),
        position: pick(r.position, INJECT_POSITIONS, d.position),
        depth: int(r.depth, 0, 100, d.depth),
        role: pick(r.role, INJECT_ROLES, d.role),
        trigger: pick(r.trigger, INJECT_TRIGGERS, d.trigger),
        scanDepth: int(r.scanDepth, 1, 50, d.scanDepth),
        chance: int(r.chance, 0, 100, d.chance),
        order: pick(r.order, INJECT_ORDERS, d.order),
        maxPeople: int(r.maxPeople, 1, 20, d.maxPeople),
        historyCount: int(r.historyCount, 0, 50, d.historyCount),
        showLocked: r.showLocked === undefined ? d.showLocked : Boolean(r.showLocked),
        instruction: typeof r.instruction === 'string' ? r.instruction.slice(0, 1200) : d.instruction,
    };
}

/** The whole settings object, repaired. Safe on undefined, on garbage, and on an older shape. */
export function normalizeBondSettings(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const levels = normalizeLevels(migrateFamilial(migrateLevels(r.levels)));
    const romanceLevels = normalizeRomanceLevels(r.romanceLevels);
    return {
        enabled: r.enabled === undefined ? BOND_DEFAULTS.enabled : Boolean(r.enabled),
        timing: pick(r.timing, BOND_TIMINGS, BOND_DEFAULTS.timing),
        maxTokens: int(r.maxTokens, 100, 32000, BOND_DEFAULTS.maxTokens),
        contextMessages: int(r.contextMessages, 0, 20, BOND_DEFAULTS.contextMessages),
        prompt: typeof r.prompt === 'string' ? r.prompt : '',
        growth: normalizeGrowth(r.growth),
        levels,
        romanceLevels,
        gates: normalizeGates(migrateGates(r.gates, new Set(levels.map(l => l.id))), levels, romanceLevels),
        milestones: normalizeMilestonePresets(r.milestones),
        inject: normalizeBondInject(r.inject),
        romanceUnlock: pick(r.romanceUnlock, ROMANCE_UNLOCKS, BOND_DEFAULTS.romanceUnlock),
        romanceMinBond: int(r.romanceMinBond, 0, 100, BOND_DEFAULTS.romanceMinBond),
        romanceCooldown: int(r.romanceCooldown, 0, 200, BOND_DEFAULTS.romanceCooldown),
    };
}

/* ---- timing -------------------------------------------------------------------------- */

/**
 * What a moment in the chat asks of the tracker, for one settings object.
 *
 *   'rendered'   - a reply has just been shown: 'parse' it (inline), 'request' an update
 *                  (after), or null.
 *   'generation' - a story request is starting: 'instruct' (ask the story model to write the
 *                  block) or null.
 *   'button'     - the user pressed Update: always 'request' while the tracker is on.
 *
 * One function so that "disabled means nothing happens" is decided in exactly one place.
 */
export function timingAction(settings, moment) {
    if (!settings?.enabled) return null;
    if (moment === 'button') return 'request';
    if (moment === 'rendered') {
        if (settings.timing === 'inline') return 'parse';
        if (settings.timing === 'after') return 'request';
        return null;
    }
    if (moment === 'generation') return settings.timing === 'inline' ? 'instruct' : null;
    return null;
}

/* ---- levels and gates ---------------------------------------------------------------- */

/** The level a value sits at, with its index and the next one up (or null at the top). */
export function levelFor(value, levels) {
    const list = levels?.length ? levels : DEFAULT_LEVELS;
    let index = 0;
    for (let i = 0; i < list.length; i++) if (Number(value) >= list[i].min) index = i;
    return { index, level: list[index], next: list[index + 1] || null };
}

/** The romance level a desire sits at: index -1 and level null below the first threshold. */
export function romanceLevelFor(desire, romanceLevels) {
    const list = romanceLevels?.length ? romanceLevels : DEFAULT_ROMANCE_LEVELS;
    let index = -1;
    for (let i = 0; i < list.length; i++) if (Number(desire) >= list[i].min) index = i;
    return { index, level: list[index] || null, next: list[index + 1] || null };
}

/** Whether romance counts on one edge: its switch is on and the person's lock allows it. */
export function romanceActive(person, dir = 'toPlayer') {
    return (person?.lock ?? 'open') === 'open' && person?.edges?.[dir]?.romance === true;
}

/**
 * Where one edge stands on the romance track. Inactive: no level, whatever desire is stored.
 * @returns {{ active: boolean, desire: number, index: number, level: object|null, next: object|null }}
 */
export function romanceState(person, dir, romanceLevels) {
    const active = romanceActive(person, dir);
    const desire = Number(person?.edges?.[dir]?.desire) || 0;
    if (!active) return { active, desire, index: -1, level: null, next: null };
    return { active, desire, ...romanceLevelFor(desire, romanceLevels) };
}

/* ---- per-person gate overrides --------------------------------------------------------- */

/*
 * person.gateOverrides: { [globalGateId]: { level?, off?, minBond?, scope? } }. An absent key
 * means the global gate. off: true reads Never for this person and wins over a level. level is
 * an id on the gate's own track; minBond a platonic level id, or '' for "nothing more"; scope
 * only on romance gates.
 */

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/**
 * One override checked against its global gate. Invalid fields are dropped; null when nothing
 * valid is left. A level of 'never' is read as off.
 */
export function cleanGateOverride(raw, gate, settings = null) {
    if (!isObj(raw) || !gate) return null;
    const levels = settings?.levels?.length ? settings.levels : DEFAULT_LEVELS;
    const rl = settings?.romanceLevels?.length ? settings.romanceLevels : DEFAULT_ROMANCE_LEVELS;
    const trackLevels = gate.track === 'romance' ? rl : levels;
    const out = {};
    if (raw.off === true || raw.level === NEVER) out.off = true;
    if (typeof raw.level === 'string' && trackLevels.some(l => l.id === raw.level)) out.level = raw.level;
    if (raw.minBond === '' || (typeof raw.minBond === 'string' && levels.some(l => l.id === raw.minBond))) out.minBond = raw.minBond;
    if (gate.track === 'romance' && typeof raw.scope === 'string' && hasOwn(GATE_SCOPES, raw.scope)) out.scope = raw.scope;
    return Object.keys(out).length ? out : null;
}

/**
 * A person's overrides, repaired. With settings, each is checked against the global gate of
 * that id and dropped when the gate is gone; without (a store read before settings are known),
 * only the shape is checked, and effectiveGate checks the rest when the gate is evaluated.
 */
export function normalizeGateOverrides(raw, settings = null) {
    const out = {};
    if (!isObj(raw)) return out;
    const gates = Array.isArray(settings?.gates) ? settings.gates : null;
    for (const [id, o] of Object.entries(raw)) {
        if (!id || slug(id) !== id || !isObj(o)) continue;
        if (gates) {
            const gate = gates.find(g => g?.id === id);
            const clean = gate ? cleanGateOverride(o, gate, settings) : null;
            if (clean) out[id] = clean;
            continue;
        }
        const clean = {};
        if (o.off === true || o.level === NEVER) clean.off = true;
        if (typeof o.level === 'string' && o.level !== NEVER && slug(o.level) === o.level && o.level) clean.level = o.level;
        if (o.minBond === '' || (typeof o.minBond === 'string' && slug(o.minBond) === o.minBond)) clean.minBond = o.minBond;
        if (typeof o.scope === 'string' && hasOwn(GATE_SCOPES, o.scope)) clean.scope = o.scope;
        if (Object.keys(clean).length) out[id] = clean;
    }
    return out;
}

/**
 * The gate as it applies to one person: the global gate with their override laid over it. The
 * one place an override is read, so every reader of a person's gates agrees.
 */
export function effectiveGate(gate, person, settings = null) {
    if (!gate) return gate;
    const all = person?.gateOverrides;
    const o = isObj(all) && hasOwn(all, gate.id) ? cleanGateOverride(all[gate.id], gate, settings) : null;
    if (!o) return gate;
    const g = { ...gate };
    if (o.level) g.level = o.level;
    if (o.off) g.level = NEVER;
    if (hasOwn(o, 'minBond')) g.minBond = o.minBond;
    if (o.scope) g.scope = o.scope;
    return g;
}

/** Whether a person's effective gate differs from the global one. */
export function gateOverridden(gate, person, settings = null) {
    const e = effectiveGate(gate, person, settings);
    if (!gate || e === gate) return false;
    return e.level !== gate.level || (e.minBond || '') !== (gate.minBond || '')
        || (gate.track === 'romance' && e.scope !== gate.scope);
}

/**
 * Sets the level part of one person's override for a global gate: '' (or nothing) goes back to
 * the global level, NEVER switches it off, anything else is a level on the gate's track. Other
 * override fields are kept; an override left empty is removed.
 */
export function setGateOverride(person, gate, value, settings = null) {
    if (!person || !gate?.id) return false;
    if (!isObj(person.gateOverrides)) person.gateOverrides = {};
    const all = person.gateOverrides;
    const cur = { ...(isObj(all[gate.id]) ? all[gate.id] : {}) };
    delete cur.level;
    delete cur.off;
    if (value === NEVER) cur.off = true;
    else if (value) cur.level = value;
    const clean = cleanGateOverride(cur, gate, settings);
    if (clean) all[gate.id] = clean;
    else delete all[gate.id];
    return true;
}

/**
 * Sets the scope or min-bond part of one person's override for a global gate. undefined or null
 * goes back to the global value; for minBond, '' means "nothing more" and a platonic level id
 * that level; scope is 'initiates' or 'mutual' (romance gates only, see cleanGateOverride).
 * Other override fields are kept; an override left empty is removed.
 */
export function setGateOverridePart(person, gate, field, value, settings = null) {
    if (!person || !gate?.id || (field !== 'scope' && field !== 'minBond')) return false;
    if (!isObj(person.gateOverrides)) person.gateOverrides = {};
    const all = person.gateOverrides;
    const cur = { ...(isObj(all[gate.id]) ? all[gate.id] : {}) };
    delete cur[field];
    if (value !== undefined && value !== null && (field === 'minBond' || value !== '')) cur[field] = value;
    const clean = cleanGateOverride(cur, gate, settings);
    if (clean) all[gate.id] = clean;
    else delete all[gate.id];
    return true;
}

/** Removes one person's override for a gate, or every override when no id is given. */
export function clearGateOverride(person, gateId = '') {
    if (!person) return false;
    if (!gateId) { person.gateOverrides = {}; return true; }
    if (!isObj(person.gateOverrides) || !hasOwn(person.gateOverrides, gateId)) return false;
    delete person.gateOverrides[gateId];
    return true;
}

/**
 * Whether one gate is open for a person, and if not, why. The person's override for it, if
 * any, is applied first (effectiveGate). A platonic or family lock beats any override.
 *
 * why: 'never' (set to never, or a level that no longer exists), 'lock' (the bond is platonic or
 * family), 'off' (the character's romance is switched off), 'level' (the character has not
 * reached it; needs is the level), 'one-sided' (mutual, and the player's romance is off),
 * 'player-level' (mutual, and the player's side has not reached it), 'bond' (minBond not reached
 * on both sides; needs is that platonic level).
 * @returns {{ open: boolean, why: string, needs: object|null }}
 */
export function evaluateGate(rawGate, person, settings) {
    const levels = settings.levels;
    const shut = (why, needs = null) => ({ open: false, why, needs });
    if (rawGate?.track === 'romance' && (person?.lock ?? 'open') !== 'open') return shut('lock');
    const gate = effectiveGate(rawGate, person, settings);
    if (!gate || gate.level === NEVER) return shut('never');
    const to = person?.edges?.toPlayer;
    const from = person?.edges?.fromPlayer;
    const toValue = to ? platonicValue(to) : Number(person?.value) || 0;
    if (gate.track === 'romance') {
        const rl = settings.romanceLevels?.length ? settings.romanceLevels : DEFAULT_ROMANCE_LEVELS;
        const at = rl.findIndex(l => l.id === gate.level);
        if (at === -1) return shut('never');
        const mine = romanceState(person, 'toPlayer', rl);
        if (!mine.active) return shut('off');
        if (mine.index < at) return shut('level', rl[at]);
        if (gate.scope === 'mutual') {
            const theirs = romanceState(person, 'fromPlayer', rl);
            if (!theirs.active) return shut('one-sided', rl[at]);
            if (theirs.index < at) return shut('player-level', rl[at]);
        }
    } else {
        const at = levels.findIndex(l => l.id === gate.level);
        if (at === -1) return shut('never');
        if (levelFor(toValue, levels).index < at) return shut('level', levels[at]);
    }
    if (gate.minBond) {
        const at = levels.findIndex(l => l.id === gate.minBond);
        const fromValue = from ? platonicValue(from) : toValue;
        if (at !== -1 && (levelFor(toValue, levels).index < at || levelFor(fromValue, levels).index < at)) return shut('bond', levels[at]);
    }
    return { open: true, why: '', needs: null };
}

/**
 * Every gate for one person, both tracks, with the reason each closed one is closed.
 * @returns {{ allowed: object[], locked: { gate: object, why: string, needs: object|null }[] }}
 */
export function personGateStatus(person, settings, { kind = '' } = {}) {
    const allowed = [];
    const locked = [];
    for (const gate of settings.gates || []) {
        if (kind && gate.kind !== kind) continue;
        const r = evaluateGate(gate, person, settings);
        if (r.open) allowed.push(gate);
        else locked.push({ gate, why: r.why, needs: r.needs });
    }
    return { allowed, locked };
}

/**
 * One person's gates as prompt text: what is allowed, then what is not and why, grouped so the
 * next step reads first. One-sided romance is said plainly.
 */
export function personGateText(person, settings, { kind = '', showLocked = true, playerName = 'the player' } = {}) {
    const chosen = (settings.gates || []).filter(g => !kind || g.kind === kind);
    if (!chosen.length) return '';
    const { allowed, locked } = personGateStatus(person, settings, { kind });
    const out = [`Allowed now: ${allowed.length ? allowed.map(g => g.label).join('; ') : 'nothing beyond ordinary courtesy'}.`];
    if (!showLocked || !locked.length) return out.join(' ');
    const groups = new Map();
    const add = (key, order, text, label) => {
        if (!groups.has(key)) groups.set(key, { order, text, labels: [] });
        groups.get(key).labels.push(label);
    };
    for (const { gate, why, needs } of locked) {
        const min = needs ? needs.min : 0;
        if (why === 'level' && gate.track !== 'romance') add(`p:${needs.id}`, min, `Not yet (needs ${levelName(needs, person)})`, gate.label);
        else if (why === 'level') add(`r:${needs.id}`, 1000 + min, `Not yet (needs romance at ${needs.name})`, gate.label);
        else if (why === 'player-level') add(`pl:${needs.id}`, 2000 + min, `Not until ${playerName} feels it too (needs both at ${needs.name})`, gate.label);
        else if (why === 'one-sided') add('one', 3000, `Not mutual (${playerName} does not return the feeling)`, gate.label);
        else if (why === 'bond') add(`b:${needs.id}`, 4000 + min, `Not until trust runs deeper (needs ${levelName(needs, person)} on both sides)`, gate.label);
        else if (why === 'lock' || why === 'off') add('noromance', 5000, 'Never (not a romantic bond)', gate.label);
        else add('never', 6000, 'Never', gate.label);
    }
    for (const g of [...groups.values()].sort((a, b) => a.order - b.order)) out.push(`${g.text}: ${g.labels.join('; ')}.`);
    return out.join(' ');
}

/**
 * Which platonic gates are open at a value, and for each closed one, the level that opens it.
 * Romance gates are left out: they depend on both edges, see personGateStatus.
 * @returns {{ allowed: object[], locked: { gate: object, needs: object|null }[] }}
 */
export function gateStatus(value, gates, levels, person = null) {
    const { index } = levelFor(value, levels);
    const allowed = [];
    const locked = [];
    for (const raw of gates || []) {
        if (raw.track === 'romance') continue;
        // A person's own gates, when there is a person: see effectiveGate.
        const gate = person ? effectiveGate(raw, person, { levels }) : raw;
        if (gate.level === NEVER) { locked.push({ gate, needs: null }); continue; }
        const at = levels.findIndex(l => l.id === gate.level);
        if (at !== -1 && at <= index) allowed.push(gate);
        else locked.push({ gate, needs: at === -1 ? null : levels[at] });
    }
    return { allowed, locked };
}

/**
 * The gates as prompt text: what is allowed, and what is not yet and why.
 * @param {{ kind?: string, showLocked?: boolean }} [opts] kind limits it to one kind, e.g. 'intimacy'.
 */
export function gateText(value, gates, levels, { kind = '', showLocked = true, person = null } = {}) {
    const chosen = (gates || []).filter(g => g.track !== 'romance' && (!kind || g.kind === kind));
    if (!chosen.length) return '';
    const { allowed, locked } = gateStatus(value, chosen, levels, person);
    const lines = [];
    lines.push(`Allowed now: ${allowed.length ? allowed.map(g => g.label).join('; ') : 'nothing beyond ordinary courtesy'}.`);
    if (showLocked && locked.length) {
        // Grouped by what unlocks them, lowest first, so the model sees the next step clearly.
        const groups = new Map();
        for (const { gate, needs } of locked) {
            const key = needs ? levelName(needs, person) : 'never';
            if (!groups.has(key)) groups.set(key, { needs, labels: [] });
            groups.get(key).labels.push(gate.label);
        }
        const ordered = [...groups.values()].sort((a, b) => (a.needs ? a.needs.min : Infinity) - (b.needs ? b.needs.min : Infinity));
        for (const g of ordered) {
            lines.push(g.needs
                ? `Not yet (needs ${levelName(g.needs, person)}): ${g.labels.join('; ')}.`
                : `Never: ${g.labels.join('; ')}.`);
        }
    }
    return lines.join(' ');
}

/* ---- the per-chat store -------------------------------------------------------------- */

const MAX_TURNS = 80;
const MAX_HISTORY = 200;

export function normalizeMilestone(raw) {
    const m = raw && typeof raw === 'object' ? raw : {};
    return {
        id: str(m.id, 40) || newId('m'),
        type: str(m.type, 60) || 'custom',
        label: str(m.label, 120),
        date: str(m.date, 80),
        dateSource: pick(m.dateSource, { story: 1, real: 1, manual: 1 }, 'manual'),
        at: Number.isFinite(Number(m.at)) ? Number(m.at) : Date.now(),
        note: str(m.note, 600),
        auto: Boolean(m.auto),
        messageId: Number.isInteger(m.messageId) ? m.messageId : null,
    };
}

const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

function normalizeGains(list) {
    return (Array.isArray(list) ? list : [])
        .filter(g => g && Number.isFinite(Number(g.turn)) && Number.isFinite(Number(g.amount)))
        .map(g => ({ turn: Number(g.turn), amount: Number(g.amount) }))
        .slice(-100);
}

/**
 * One directed edge, repaired. Missing meters come from `seed` (the migration's numbers), then
 * from the starting value.
 */
export function normalizeEdge(raw, growth = DEFAULT_GROWTH, seed = {}) {
    const e = isObj(raw) ? raw : {};
    const s = isObj(seed) ? seed : {};
    const meter = (k) => tenth(num(e[k], growth.min, growth.max, num(s[k], growth.min, growth.max, growth.start)));
    const gains = isObj(e.gains) ? e.gains : null;
    const seedGains = isObj(s.gains) ? s.gains : {};
    return {
        affection: meter('affection'),
        trust: meter('trust'),
        respect: meter('respect'),
        // Romantic and physical attraction: its own track, never below 0, starting at 0.
        desire: tenth(num(e.desire, 0, Math.max(0, growth.max), 0)),
        romance: Boolean(e.romance),
        gains: Object.fromEntries(ALL_METERS.map(k => [k, normalizeGains(gains ? gains[k] : seedGains[k])])),
    };
}

/** The value an edge's platonic level is read from: the lower of affection and trust. */
export function platonicValue(edge) {
    const a = Number(edge?.affection);
    const t = Number(edge?.trust);
    return tenth(Math.min(Number.isFinite(a) ? a : 0, Number.isFinite(t) ? t : 0));
}

/** Keeps the mirrored `person.value` (toPlayer's platonic value) in step with the edges. */
export function syncValue(person) {
    if (person?.edges?.toPlayer) person.value = platonicValue(person.edges.toPlayer);
    return person?.value;
}

/** The bottom of one meter's scale: desire starts at nothing and cannot go below it. */
export const meterFloor = (meter, growth = DEFAULT_GROWTH) => (meter === 'desire' ? 0 : growth.min);

/**
 * The level ticks on one meter's bar, as percentages along it. Affection, trust and respect
 * carry the platonic thresholds (named for the person, see levelName), desire the romance
 * ones on its own 0-to-top scale. Thresholds at or past either end of the bar are left out.
 * @returns {{ id: string, name: string, min: number, left: number }[]}
 */
export function meterTicks(meter, settings, person = null) {
    const g = settings?.growth || DEFAULT_GROWTH;
    const lo = meterFloor(meter, g);
    const span = Math.max(1, g.max - lo);
    const romance = meter === 'desire';
    const list = romance
        ? (settings?.romanceLevels?.length ? settings.romanceLevels : DEFAULT_ROMANCE_LEVELS)
        : (settings?.levels?.length ? settings.levels : DEFAULT_LEVELS);
    return list
        .filter(l => l.min > lo && l.min < g.max)
        .map(l => ({ id: l.id, name: romance ? l.name : levelName(l, person), min: l.min, left: ((l.min - lo) / span) * 100 }));
}

/** Sets one meter by hand, clamped to the scale, and keeps the mirror in step. */
export function setMeter(person, dir, meter, value, growth = DEFAULT_GROWTH) {
    const edge = person?.edges?.[dir];
    const v = Number(value);
    if (!edge || !ALL_METERS.includes(meter) || !Number.isFinite(v)) return false;
    edge[meter] = tenth(Math.max(meterFloor(meter, growth), Math.min(growth.max, v)));
    syncValue(person);
    return true;
}

/**
 * One person, repaired. With settings, their gate overrides are checked against the global
 * gates (overrides of deleted gates and invalid levels are dropped); people saved before
 * overrides existed get none.
 */
export function normalizePerson(raw, growth = DEFAULT_GROWTH, settings = null) {
    const p = raw && typeof raw === 'object' ? raw : {};
    const inj = p.inject && typeof p.inject === 'object' ? p.inject : {};
    const edges = isObj(p.edges) ? p.edges : {};
    // Version 1 had one number: it becomes affection and trust on both sides. Respect starts fresh.
    const legacy = tenth(num(p.value, growth.min, growth.max, growth.start));
    const oldGains = Array.isArray(p.gains) ? p.gains : [];
    const toPlayer = normalizeEdge(edges.toPlayer, growth, {
        affection: legacy, trust: legacy, respect: growth.start,
        gains: { affection: oldGains, trust: oldGains },
    });
    const fromPlayer = normalizeEdge(edges.fromPlayer, growth, {
        affection: toPlayer.affection, trust: toPlayer.trust, respect: growth.start,
    });
    return {
        name: str(p.name, 80),
        // Mirror of toPlayer's platonic value, kept for one release for older readers.
        value: platonicValue(toPlayer),
        // Off: never updated automatically and never injected. The numbers are kept.
        tracked: p.tracked !== false,
        lock: pick(p.lock, BOND_LOCKS, 'open'),
        /** This person's own gates, laid over the global ones. See effectiveGate. */
        gateOverrides: normalizeGateOverrides(p.gateOverrides, settings),
        edges: { toPlayer, fromPlayer },
        inject: {
            level: inj.level !== false,
            gates: inj.gates !== false,
            history: inj.history !== false,
        },
        history: (Array.isArray(p.history) ? p.history : []).map(normalizeMilestone).slice(-MAX_HISTORY),
        lastSeen: Number.isFinite(Number(p.lastSeen)) ? Number(p.lastSeen) : 0,
        lastReason: str(p.lastReason, 300),
        legacy: p.legacy && typeof p.legacy === 'object' ? { ...p.legacy } : null,
        /** A pending romance suggestion for their side, waiting for the user. See ROMANCE_UNLOCKS. */
        suggestion: normalizeSuggestion(p.suggestion),
        /** The store turn of the last "Keep platonic", for the cooldown. */
        declinedTurn: (typeof p.declinedTurn === 'number' || (typeof p.declinedTurn === 'string' && p.declinedTurn.trim() !== ''))
            ? int(p.declinedTurn, 0, 1e9, null) : null,
    };
}

/** A pending romance suggestion, repaired: { reason, messageId, turn, at }, or null. */
export function normalizeSuggestion(raw) {
    if (!isObj(raw)) return null;
    return {
        reason: str(raw.reason, 300),
        messageId: Number.isInteger(raw.messageId) && raw.messageId >= 0 ? raw.messageId : null,
        turn: int(raw.turn, 0, 1e9, 0),
        at: Number.isFinite(Number(raw.at)) && typeof raw.at !== 'boolean' ? Number(raw.at) : 0,
    };
}

export function normalizeStore(raw, growth = DEFAULT_GROWTH, settings = null) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const people = [];
    for (const p of Array.isArray(r.people) ? r.people : []) {
        const person = normalizePerson(p, growth, settings);
        if (person.name && !people.some(x => sameName(x.name, person.name))) people.push(person);
    }
    return {
        version: STORE_VERSION,
        turn: int(r.turn, 0, 1e9, 0),
        migrated: Boolean(r.migrated),
        /** The newest in-story date the tracker could work out, so a milestone with no clock in the reply still gets one. */
        lastDate: str(r.lastDate, 80),
        people,
        turns: (Array.isArray(r.turns) ? r.turns : []).filter(t => t && typeof t === 'object').slice(-MAX_TURNS),
    };
}

export function findPerson(store, name) {
    return store.people.find(p => sameName(p.name, name)) || null;
}

/** The person, created at the starting value if they are new. New people are NOT tracked: you switch tracking on for the ones you want. */
export function ensurePerson(store, name, growth = DEFAULT_GROWTH) {
    const existing = findPerson(store, name);
    if (existing) return existing;
    const person = normalizePerson({ name, value: growth.start, lastSeen: store.turn, tracked: false }, growth);
    store.people.push(person);
    return person;
}

/* ---- romance unlock suggestions ------------------------------------------------------ */

/**
 * Whether the model may flag a person's feelings as turning romantic at this turn, and if not,
 * why. The model is told who qualifies, but this is what decides: a flag for anyone else is
 * dropped. Only the character's side (toPlayer) is ever considered.
 *
 * why: 'mode' (unlock is Manual), 'untracked', 'lock' (not Open), 'on' (their romance is already
 * on), 'pending' (a suggestion already waits), 'cooldown' (declined too recently), 'bond' (below
 * romanceMinBond).
 * @returns {{ ok: boolean, why: string }}
 */
export function romanceEligibility(person, settings, turn) {
    const no = (why) => ({ ok: false, why });
    const mode = pick(settings?.romanceUnlock, ROMANCE_UNLOCKS, 'manual');
    if (mode === 'manual') return no('mode');
    if (!person || !person.tracked) return no('untracked');
    if ((person.lock ?? 'open') !== 'open') return no('lock');
    if (person.edges?.toPlayer?.romance === true) return no('on');
    if (person.suggestion) return no('pending');
    const cooldown = int(settings?.romanceCooldown, 0, 200, BOND_DEFAULTS.romanceCooldown);
    if (Number.isFinite(person.declinedTurn) && cooldown > 0) {
        // Without a turn to measure from, a recent decline is assumed to still hold.
        if (!Number.isFinite(Number(turn)) || Number(turn) - person.declinedTurn < cooldown) return no('cooldown');
    }
    const min = int(settings?.romanceMinBond, 0, 100, BOND_DEFAULTS.romanceMinBond);
    if (bondValue(person) < min) return no('bond');
    return { ok: true, why: '' };
}

/** "Turn romance on": their side's romance goes on and the suggestion is gone. */
export function acceptRomanceSuggestion(person) {
    if (!person?.edges?.toPlayer) return false;
    person.edges.toPlayer.romance = true;
    person.suggestion = null;
    return true;
}

/** "Keep platonic": the suggestion is gone and the cooldown starts at this turn. */
export function declineRomanceSuggestion(person, turn) {
    if (!person) return false;
    person.suggestion = null;
    person.declinedTurn = int(turn, 0, 1e9, 0);
    return true;
}

/* ---- growth -------------------------------------------------------------------------- */

/**
 * The growth rules one meter runs under. Desire has its own scale (0 to the top, starting at 0)
 * and only desireRate percent of the rise caps, so romance builds slower than warmth.
 */
export function meterGrowth(growth, meter) {
    const g = growth || DEFAULT_GROWTH;
    if (meter !== 'desire') return g;
    const rate = (Number.isFinite(Number(g.desireRate)) ? Number(g.desireRate) : DEFAULT_GROWTH.desireRate) / 100;
    return { ...g, min: 0, start: 0, maxGain: g.maxGain * rate, windowGain: g.windowGain * rate, decayFloor: 0 };
}

/**
 * The change a turn may really make, given what the model proposed.
 *
 * In order: the per-turn caps, the slowdown near the top, the rolling window, the scale.
 * Each step can only shrink a change, never grow or flip it.
 *
 * Each meter has its own caps and its own rolling window. `subject` is an edge (meter is one of
 * ALL_METERS, gains per meter) or anything with a number under `meter` and a flat gains list.
 *
 * @returns {{ delta: number, limited: string[] }} limited names the rules that bit.
 */
export function clampGrowth(subject, proposed, growth, turn, meter = 'value') {
    const g = meterGrowth(growth || DEFAULT_GROWTH, meter);
    let delta = Number(proposed);
    const limited = [];
    if (!Number.isFinite(delta) || delta === 0) return { delta: 0, limited };
    const current = Number(subject?.[meter]) || 0;
    const gains = Array.isArray(subject?.gains) ? subject.gains : (subject?.gains?.[meter] || []);

    if (delta > 0) {
        if (delta > g.maxGain) { delta = g.maxGain; limited.push('turn cap'); }
        if (g.slowdown > 0 && g.max > g.start) {
            const climbed = Math.max(0, Math.min(1, (current - g.start) / (g.max - g.start)));
            const factor = 1 - (g.slowdown / 100) * climbed;
            if (factor < 1) { delta *= factor; limited.push('slowdown'); }
        }
        if (g.windowTurns > 0) {
            const recent = gains
                .filter(x => x.turn > turn - g.windowTurns && x.turn <= turn)
                .reduce((sum, x) => sum + Math.max(0, x.amount), 0);
            const room = Math.max(0, g.windowGain - recent);
            if (delta > room) { delta = room; limited.push('window'); }
        }
    } else if (-delta > g.maxLoss) {
        delta = -g.maxLoss;
        limited.push('turn cap');
    }

    const target = Math.max(g.min, Math.min(g.max, current + delta));
    if (target !== current + delta) limited.push('scale');
    return { delta: tenth(target - current), limited };
}

/**
 * How much a person unseen this turn fades, or 0. With a meter, that meter of their toPlayer
 * edge; without, the mirrored value.
 */
export function decayFor(person, growth, turn, meter = '') {
    const g = growth || DEFAULT_GROWTH;
    if (!g.decay || !(g.decayAmount > 0)) return 0;
    const value = Number(meter ? person.edges?.toPlayer?.[meter] : person.value) || 0;
    if (value <= g.decayFloor) return 0;
    const away = turn - person.lastSeen;
    if (away < g.decayAfter) return 0;
    if ((away - g.decayAfter) % g.decayEvery !== 0) return 0;
    return -tenth(Math.min(g.decayAmount, value - g.decayFloor));
}

/* ---- milestones ---------------------------------------------------------------------- */

/** When something happened: the story's date when the story has a clock, the real one otherwise. */
export function milestoneDate(clock, now = Date.now()) {
    if (clock && clock.dateText) return { date: clock.dateText, dateSource: 'story' };
    const d = new Date(now);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { date: iso, dateSource: 'real' };
}

export function hasMilestone(person, type) {
    return (person.history || []).some(m => m.type === type);
}

/** Adds one to a person's history and returns it. The label falls back to the preset's. */
export function addMilestone(person, entry, presets = []) {
    const preset = presets.find(p => p.id === entry?.type);
    const m = normalizeMilestone({
        ...entry,
        id: undefined,
        type: preset ? preset.id : 'custom',
        label: str(entry?.label) || preset?.label || 'Milestone',
    });
    person.history.push(m);
    // Kept in story order by the time it was recorded; editing a date never reorders silently.
    if (person.history.length > MAX_HISTORY) person.history.splice(0, person.history.length - MAX_HISTORY);
    return m;
}

export function editMilestone(person, id, patch) {
    const m = person.history.find(x => x.id === id);
    if (!m) return false;
    const next = normalizeMilestone({ ...m, ...patch, id: m.id, type: m.type, at: m.at });
    // A date typed by hand is the user's, whatever produced the first one.
    if (patch && 'date' in patch && patch.date !== m.date) next.dateSource = 'manual';
    Object.assign(m, next);
    return true;
}

export function removeMilestone(person, id) {
    const before = person.history.length;
    person.history = person.history.filter(x => x.id !== id);
    return person.history.length !== before;
}

/**
 * The checkbox beside a preset: ticking records it today, unticking removes every entry of it.
 * @returns {boolean} Whether it is now ticked.
 */
export function toggleMilestone(person, presetId, presets, when) {
    if (hasMilestone(person, presetId)) {
        person.history = person.history.filter(m => m.type !== presetId);
        return false;
    }
    addMilestone(person, { type: presetId, ...(when || {}) }, presets);
    return true;
}

/* ---- the model's update -------------------------------------------------------------- */

/** The first balanced {...} in some text, or ''. */
function firstJsonObject(text) {
    const s = String(text ?? '');
    const start = s.indexOf('{');
    if (start === -1) return '';
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < s.length; i++) {
        const c = s[i];
        if (inStr) {
            if (esc) esc = false;
            else if (c === '\\') esc = true;
            else if (c === '"') inStr = false;
            continue;
        }
        if (c === '"') inStr = true;
        else if (c === '{') depth++;
        else if (c === '}' && --depth === 0) return s.slice(start, i + 1);
    }
    return '';
}

/**
 * The per-meter change one bond entry asks for. Accepts the current shape (affection, trust,
 * respect, flat or under `deltas`) and the version 1 shape, whose single `delta` counts as
 * affection and trust. Also used on updates remembered on old swipes. desire is read whenever
 * given; whether it counts is applyTurn's call (only on an edge whose romance is on).
 * @returns {{ affection: number, trust: number, respect: number, desire: number }}
 */
export function bondDeltas(b) {
    const src = isObj(b?.deltas) ? b.deltas : (b || {});
    const given = (v) => v !== undefined && v !== null && v !== '' && Number.isFinite(Number(v));
    const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    if (!ALL_METERS.some(k => given(src[k])) && given(b?.delta)) {
        const d = n(b.delta);
        return { affection: d, trust: d, respect: 0, desire: 0 };
    }
    return { affection: n(src.affection), trust: n(src.trust), respect: n(src.respect), desire: n(src.desire) };
}

/**
 * What a model said, as { bonds, milestones }. Tolerant of code fences, prose around the
 * JSON, the inline tag, and a reply that is nothing at all - that is "no change", not an error.
 */
export function parseUpdate(text) {
    const empty = { bonds: [], milestones: [], date: '' };
    let body = String(text ?? '');
    const tagged = new RegExp(`<${INLINE_TAG}>([\\s\\S]*?)(?:</${INLINE_TAG}>|$)`, 'i').exec(body);
    if (tagged) body = tagged[1];
    body = body.replace(/```(?:json)?/gi, '');
    const json = firstJsonObject(body);
    if (!json) return empty;
    let data;
    try { data = JSON.parse(json); } catch { return empty; }
    const bonds = (Array.isArray(data?.bonds) ? data.bonds : [])
        .filter(b => b && str(b.name))
        .map(b => ({ name: str(b.name, 80), ...bondDeltas(b), reason: str(b.reason, 300) }));
    const milestones = (Array.isArray(data?.milestones) ? data.milestones : [])
        .filter(m => m && str(m.name) && str(m.type))
        .map(m => ({ name: str(m.name, 80), type: slug(m.type), note: str(m.note, 600) }));
    const out = { bonds, milestones, date: str(data?.date, 80) };
    // Romance-unlock flags. Only present when the model gave some; whether any count is applyTurn's call.
    const catalysts = (Array.isArray(data?.catalysts) ? data.catalysts : [])
        .filter(c => c && typeof c === 'object' && str(c.name))
        .map(c => ({ name: str(c.name, 80), reason: str(c.reason, 300) }));
    if (catalysts.length) out.catalysts = catalysts;
    return out;
}

/**
 * Takes the inline block out of a reply, so the story text is clean.
 * @returns {{ text: string, block: string }} block is '' when there was none.
 */
export function stripInlineBlock(text) {
    const s = String(text ?? '');
    const re = new RegExp(`\\s*<${INLINE_TAG}>[\\s\\S]*?(?:</${INLINE_TAG}>|$)`, 'i');
    const m = re.exec(s);
    if (!m) return { text: s, block: '' };
    return { text: (s.slice(0, m.index) + s.slice(m.index + m[0].length)).replace(/\s+$/, ''), block: m[0].trim() };
}

/* ---- applying a turn ----------------------------------------------------------------- */

/**
 * Undoes what one recorded turn changed. Manual edits made since are kept; only the delta is taken back.
 * Each change names its edge (dir) and meter; a version 1 record has neither and is affection on toPlayer.
 */
export function revertTurn(store, key, growth = DEFAULT_GROWTH) {
    const at = store.turns.findIndex(t => t.key === key);
    if (at === -1) return false;
    const rec = store.turns[at];
    for (const ch of rec.changes || []) {
        const person = findPerson(store, ch.name);
        const delta = Number(ch?.delta);
        if (!person || !Number.isFinite(delta)) continue;
        const legacy = !ch.meter;
        const edge = person.edges?.[ch.dir === 'fromPlayer' ? 'fromPlayer' : 'toPlayer'];
        const meter = ALL_METERS.includes(ch.meter) ? ch.meter : 'affection';
        if (!edge) continue;
        edge[meter] = tenth(Math.max(meterFloor(meter, growth), Math.min(growth.max, (Number(edge[meter]) || 0) - delta)));
        // A version 1 gain was migrated into both affection and trust; it leaves both windows.
        for (const k of legacy ? ['affection', 'trust'] : [meter]) {
            edge.gains[k] = (edge.gains[k] || []).filter(g => !(g.turn === rec.turn && g.amount === delta));
        }
        syncValue(person);
    }
    for (const ms of rec.milestones || []) {
        const person = findPerson(store, ms.name);
        if (person) removeMilestone(person, ms.id);
    }
    // A suggestion this turn made, still waiting, goes with it. One already answered was the user's.
    for (const name of Array.isArray(rec.suggested) ? rec.suggested : []) {
        const person = findPerson(store, name);
        const s = person?.suggestion;
        if (s && s.turn === rec.turn && s.messageId === (rec.messageId ?? null)) person.suggestion = null;
    }
    // A romance this turn switched on by itself is switched off again.
    for (const name of Array.isArray(rec.unlocked) ? rec.unlocked : []) {
        const person = findPerson(store, name);
        if (person?.edges?.toPlayer) person.edges.toPlayer.romance = false;
    }
    store.turns.splice(at, 1);
    return true;
}

/**
 * Applies one proposed update to the store, clamped by the growth rules.
 *
 * Keyed by message, so the same reply is never counted twice: running it again for the same
 * swipe does nothing unless forced, and a different swipe of the same message replaces what the
 * old one did instead of adding to it.
 *
 * @param {object} store normalizeStore() output; changed in place.
 * @param {{ bonds: object[], milestones: object[] }} update parseUpdate() output
 * @param {object} settings normalizeBondSettings() output
 * @param {{ key: string, swipeId?: number, messageId?: number|null, force?: boolean,
 *           only?: string, known?: string[], player?: string, date?: object, now?: number }} ctx
 *   key identifies the reply; only limits the update to one person; known is who may be
 *   created (anyone already tracked is always accepted); date is milestoneDate() output.
 * @returns {{ applied: boolean, reason?: string, record?: object }}
 */
export function applyTurn(store, update, settings, ctx) {
    const growth = settings.growth;
    const key = String(ctx.key);
    const swipeId = ctx.swipeId ?? 0;
    const prior = store.turns.find(t => t.key === key);
    if (prior && prior.swipeId === swipeId && !ctx.force) return { applied: false, reason: 'already applied' };

    let turn;
    if (prior) {
        turn = prior.turn;
        revertTurn(store, key, growth);
    } else if (ctx.only) {
        // Updating one person by hand re-reads a reply that has already had its turn, so it
        // shares that turn - and with it the turn's caps - instead of opening a new one.
        store.turn = Math.max(1, store.turn);
        turn = store.turn;
    } else {
        store.turn += 1;
        turn = store.turn;
    }

    const known = (ctx.known || []).map(n => str(n).toLowerCase());
    const accepts = (name) => {
        if (!str(name)) return false;
        if (ctx.player && sameName(name, ctx.player)) return false;
        if (ctx.only && !sameName(name, ctx.only)) return false;
        // Only somebody you already track. A reply never starts tracking a character by itself.
        return Boolean(findPerson(store, name));
    };

    const record = { key, swipeId, turn, messageId: ctx.messageId ?? null, at: ctx.now ?? Date.now(), changes: [], milestones: [] };
    const seen = new Set();

    for (const b of update?.bonds || []) {
        if (!accepts(b.name) || seen.has(b.name.toLowerCase())) continue;
        const person = ensurePerson(store, findPerson(store, b.name)?.name || b.name, growth);
        if (!person.tracked) continue;
        seen.add(person.name.toLowerCase());
        person.lastSeen = turn;
        if (b.reason) person.lastReason = b.reason;
        // Only the character's own edge. The player's side is theirs to set by hand.
        const edge = person.edges.toPlayer;
        const want = bondDeltas(b);
        // Desire only moves while this edge's romance is on; otherwise it stays frozen.
        for (const meter of romanceActive(person, 'toPlayer') ? ALL_METERS : METERS) {
            const { delta, limited } = clampGrowth(edge, want[meter], growth, turn, meter);
            if (!delta) continue;
            edge[meter] = tenth(edge[meter] + delta);
            if (delta > 0) edge.gains[meter].push({ turn, amount: delta });
            record.changes.push({ name: person.name, dir: 'toPlayer', meter, delta, proposed: want[meter], limited, reason: b.reason || '' });
        }
        syncValue(person);
    }

    const presets = settings.milestones || [];
    // Which date a milestone gets: the story's own clock if the reply has one, then the date the
    // tracker worked out from the text, then the last one it knew, and only then the real date.
    let when = ctx.date || {};
    if (when.dateSource !== 'story') {
        const worked = str(update?.date, 80) || str(store.lastDate, 80);
        if (worked) when = { date: worked, dateSource: 'story' };
    }
    if (when.dateSource === 'story' && when.date) store.lastDate = when.date;

    for (const m of update?.milestones || []) {
        if (!accepts(m.name)) continue;
        const preset = presets.find(p => p.id === m.type);
        if (!preset || !preset.auto) continue;
        const person = ensurePerson(store, findPerson(store, m.name)?.name || m.name, growth);
        if (!person.tracked) continue;
        if (preset.once && hasMilestone(person, preset.id)) continue;
        person.lastSeen = turn;
        const added = addMilestone(person, {
            type: preset.id, note: m.note, auto: true, messageId: ctx.messageId ?? null,
            at: ctx.now ?? Date.now(), ...when,
        }, presets);
        record.milestones.push({ name: person.name, id: added.id, type: preset.id });
    }

    // Romance-unlock flags, after this turn's own changes. Never trusted: each is checked against
    // romanceEligibility, and anything that fails is dropped without a word. Only toPlayer.
    const mode = pick(settings.romanceUnlock, ROMANCE_UNLOCKS, 'manual');
    if (mode !== 'manual') {
        const flagged = new Set();
        for (const c of Array.isArray(update?.catalysts) ? update.catalysts : []) {
            if (!c || !accepts(c.name)) continue;
            const person = findPerson(store, c.name);
            if (!person || flagged.has(person.name.toLowerCase())) continue;
            flagged.add(person.name.toLowerCase());
            if (!romanceEligibility(person, settings, turn).ok) continue;
            if (mode === 'auto') {
                person.edges.toPlayer.romance = true;
                (record.unlocked ||= []).push(person.name);
            } else {
                person.suggestion = { reason: str(c.reason, 300), messageId: ctx.messageId ?? null, turn, at: ctx.now ?? Date.now() };
                (record.suggested ||= []).push(person.name);
            }
        }
    }

    // Fading, for the tracked people this reply did not involve. Only on a fresh turn: a forced
    // re-run of the same reply has already had its turn of fading.
    if (!prior && !ctx.only) {
        for (const person of store.people) {
            if (!person.tracked || seen.has(person.name.toLowerCase())) continue;
            // Warmth and trust fade with time apart; respect does not.
            for (const meter of ['affection', 'trust']) {
                const delta = decayFor(person, growth, turn, meter);
                if (!delta) continue;
                person.edges.toPlayer[meter] = tenth(person.edges.toPlayer[meter] + delta);
                record.changes.push({ name: person.name, dir: 'toPlayer', meter, delta, proposed: 0, limited: [], reason: 'faded with time apart' });
            }
            syncValue(person);
        }
    }

    store.turns.push(record);
    if (store.turns.length > MAX_TURNS) store.turns.splice(0, store.turns.length - MAX_TURNS);
    return { applied: true, record };
}

/* ---- migration from Internal States -------------------------------------------------- */

/**
 * Reads the BONDS lines the Internal States block used to carry:
 *   - <b>Mira</b> ↔ <b>Veta</b> | BOND: 7 | Sparks: 3 | Grudge: 0
 * from the HTML or from its plain-text form. Template placeholders are skipped.
 * @returns {{ name: string, bond: number, sparks: number, grudge: number }[]}
 */
export function parseLegacyBonds(text) {
    const plain = String(text ?? '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(summary|details|div|p|li)>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ');
    const out = [];
    const re = /^[\s\-•*]*([^\n|↔]+?)\s*(?:↔|<->|&harr;)\s*[^\n|]*\|\s*BOND:\s*(-?\d+(?:\.\d+)?)(?:\s*\|\s*Sparks:\s*(-?\d+))?(?:\s*\|\s*Grudge:\s*(-?\d+))?/gim;
    let m;
    while ((m = re.exec(plain))) {
        const name = str(m[1], 80);
        if (!name || /^\[.*\]$/.test(name)) continue;
        if (out.some(x => sameName(x.name, name))) continue;
        out.push({ name, bond: Number(m[2]), sparks: Number(m[3] ?? 0) || 0, grudge: Number(m[4] ?? 0) || 0 });
    }
    return out;
}

/**
 * The old BOND ran -5..20 with 0 as neutral. Below zero maps onto the bottom of the new scale and
 * above zero onto the top, so neutral stays neutral and a maxed-out bond stays maxed-out.
 */
export function legacyToValue(bond, growth = DEFAULT_GROWTH) {
    const b = Math.max(-5, Math.min(20, Number(bond) || 0));
    const v = b < 0 ? growth.start + (b / 5) * (growth.start - growth.min) : growth.start + (b / 20) * (growth.max - growth.start);
    return tenth(Math.max(growth.min, Math.min(growth.max, v)));
}

/**
 * Brings old bonds into a store, once. People already tracked keep their numbers: they were set
 * by this tracker, which is newer than anything the old block knew.
 * @returns {number} How many people were brought over.
 */
export function migrateLegacy(store, legacy, growth = DEFAULT_GROWTH) {
    if (store.migrated) return 0;
    let count = 0;
    for (const old of legacy || []) {
        if (findPerson(store, old.name)) continue;
        const person = normalizePerson({
            name: old.name,
            value: legacyToValue(old.bond, growth),
            lastSeen: store.turn,
            tracked: false,
            legacy: { bond: old.bond, sparks: old.sparks, grudge: old.grudge },
        }, growth);
        store.people.push(person);
        count++;
    }
    store.migrated = true;
    return count;
}

/* ---- prompt text --------------------------------------------------------------------- */

/** A milestone's id in the vector manifest: the person is part of it, since milestone ids are only unique per person. */
export function bondEntryId(person, milestone) {
    return `${String(person?.name ?? '').trim().toLowerCase()}:${milestone?.id ?? ''}`;
}

const lines = (text) => String(text || '').split('\n').map(x => x.trim()).filter(Boolean);
const fmt = (v) => { const n = Number(v) || 0; return Number.isInteger(n) ? String(n) : n.toFixed(1); };

/** A person's platonic value toward the player: from the edge when there is one, else the mirror. */
const bondValue = (person) => (person?.edges?.toPlayer ? platonicValue(person.edges.toPlayer) : Number(person?.value) || 0);

/** "affection 30, trust 25, respect 10" for one edge. */
export function meterText(edge) {
    return METERS.map(k => `${k} ${fmt(edge?.[k])}`).join(', ');
}

/** The level name of the player's hand-set side, or '' when there is no such edge. */
function playerSideLevel(person, levels) {
    const edge = person?.edges?.fromPlayer;
    return edge ? levelName(levelFor(platonicValue(edge), levels).level, person) : '';
}

const LOCK_TEXT = Object.freeze({
    platonic: (name, pl) => `${name} and ${pl} are platonic only: no romance between them.`,
    familial: (name, pl) => `${name} and ${pl} are family: no romance between them.`,
});

/**
 * The romance line for the story prompt, or '' when neither side's romance is on. Says plainly
 * when the feeling is one-sided, either way, and what that means for shared acts.
 */
export function romanceText(person, settings, playerName = 'the player') {
    const rl = settings.romanceLevels?.length ? settings.romanceLevels : DEFAULT_ROMANCE_LEVELS;
    const c = romanceState(person, 'toPlayer', rl);
    const p = romanceState(person, 'fromPlayer', rl);
    if (!c.active && !p.active) return '';
    const name = person.name;
    const feel = (s) => (s.level ? s.level.name : 'no romantic feelings yet');
    const parts = ['Romance:'];
    if (c.active) {
        parts.push(`${name} toward ${playerName}: ${feel(c)} (desire ${fmt(c.desire)})${c.level?.description ? ` - ${c.level.description}` : '.'}`);
    }
    if (c.active && p.active) {
        parts.push(`${playerName} toward ${name}: ${feel(p)} (desire ${fmt(p.desire)}).`);
        if (c.index > p.index) {
            parts.push(p.index < 0
                ? `${playerName} does not feel the same way: ${name} may pine, hint or confess, but mutual romantic acts do not happen.`
                : `${playerName} does not feel as strongly: ${name} may pine, hint or confess, but shared romantic acts go no further than ${p.level.name}.`);
        } else if (p.index > c.index) {
            parts.push(c.index < 0
                ? `${name} does not feel that way about ${playerName}: they may notice and respond kindly or awkwardly, but they do not return it.`
                : `${name} does not feel as strongly as ${playerName}: they return it only as far as ${c.level.name}.`);
        }
    } else if (c.active) {
        if (c.index >= 0) parts.push(`${playerName} does not feel the same way: ${name} may pine, hint or confess, but mutual romantic acts do not happen.`);
    } else {
        parts.push(p.index >= 0
            ? `${playerName} is drawn to ${name} (${p.level.name}), but ${name} does not feel that way about ${playerName}: they may notice and respond kindly, awkwardly or not at all, but they do not return it.`
            : `${playerName} has no romantic feelings for ${name} yet.`);
    }
    return parts.join(' ');
}

/** One person's block for the story prompt, honouring their own injection switches. '' if none apply. */
export function bondBlock(person, settings, playerName = 'the player', picks = null) {
    if (!person?.tracked) return '';
    const flags = person.inject || {};
    if (!flags.level && !flags.gates && !flags.history) return '';
    const { levels, growth, inject } = settings;
    const value = bondValue(person);
    const { level, next } = levelFor(value, levels);
    const out = [];
    if (flags.level) {
        const meters = person.edges?.toPlayer ? meterText(person.edges.toPlayer) : fmt(value);
        const side = playerSideLevel(person, levels);
        const lock = LOCK_TEXT[person.lock];
        out.push(`${person.name} toward ${playerName}: ${levelName(level, person)} (${meters}; of ${growth.max})`
            + `${level.description ? ` - ${level.description}` : ''}`
            + `${next ? ` Next level: ${levelName(next, person)} at ${next.min}.` : ''}`
            + `${side ? ` ${playerName} feels about them: ${side}.` : ''}`
            + `${lock ? ` ${lock(person.name, playerName)}` : ''}`);
        const romance = romanceText(person, settings, playerName);
        if (romance) out.push(romance);
    } else {
        out.push(`${person.name} toward ${playerName}:`);
    }
    if (flags.gates) {
        const g = personGateText(person, settings, { showLocked: inject.showLocked, playerName });
        if (g) out.push(g);
    }
    if (flags.history && inject.historyCount > 0 && person.history.length) {
        // Vectors only change which milestones fill the slots; without picks it is the newest, as always.
        const recent = chooseEntries(person.history, picks, inject.historyCount, { idOf: (m) => bondEntryId(person, m) }).reverse();
        out.push(`Milestones: ${recent.map(m => `${m.label}${m.date ? ` (${m.date})` : ''}${m.note ? ` - ${m.note}` : ''}`).join('; ')}.`);
    }
    return out.join('\n');
}

/**
 * Who goes into the story prompt this time.
 * @param {{ applies: (name: string) => boolean, rng: () => number }} ctx
 */
export function selectPeople(store, opts, ctx) {
    let chosen = store.people.filter(p => p.tracked && (p.inject.level || p.inject.gates || p.inject.history));
    chosen = chosen.filter(p => ctx.applies(p.name));
    // Left at 100, "random" would be "always"; treated as occasional so it means what it says.
    const chance = opts.trigger === 'random' && opts.chance === 100 ? 35 : opts.chance;
    chosen = chosen.filter(() => ctx.rng() * 100 < chance);
    if (opts.order === 'name') chosen.sort((a, b) => a.name.localeCompare(b.name));
    else if (opts.order === 'recent') chosen.sort((a, b) => b.lastSeen - a.lastSeen || a.name.localeCompare(b.name));
    else chosen.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
    return chosen.slice(0, opts.maxPeople).map(p => p.name);
}

/** The whole block for the story prompt, or '' when the tracker or its injection is off, or nobody qualifies. */
export function buildBondInjection(store, names, settings, playerName = 'the player', picks = null) {
    if (!settings?.enabled || !settings.inject?.enabled) return '';
    const blocks = (names || []).map(n => findPerson(store, n)).filter(Boolean)
        .map(p => bondBlock(p, settings, playerName, picks)).filter(Boolean);
    if (!blocks.length) return '';
    const instruction = String(settings.inject.instruction || '').replace(/\{\{user\}\}/gi, playerName);
    return ['[Bonds]', ...blocks, instruction, '[/Bonds]'].filter(Boolean).join('\n');
}

/** The rules and vocabulary the model needs to propose an update, shared by both timings. */
function rulesText(settings, people, playerName, lastDate = '', turn = undefined) {
    const g = settings.growth;
    const out = [];
    out.push('date: the in-story date of the latest message, written exactly as "Weekday, Month DD, Year" (for example "Friday, February 07, 1182"). '
        + 'Work it out from the text: a stated date or header, or days passing ("the next morning", "three days later") counted forward from the last known date'
        + `${lastDate ? ` (last known: ${lastDate})` : ''}. Use an empty string when it cannot be worked out. Never invent a date the story does not support.`);
    out.push(`Each character has three meters toward ${playerName}, each from ${g.min} to ${g.max}: affection (warmth, liking), `
        + 'trust (feeling safe with them, relying on them), respect (regard for their competence and character). '
        + `Propose a change per meter between -${g.maxLoss} and +${g.maxGain}; `
        + 'most turns change nothing or very little. Ordinary pleasant talk is +0 to +1 affection. Use 0 for a meter the exchange did not affect.');
    out.push(`Judge only how each character feels about ${playerName}. How ${playerName} feels about them is set by the user and is never yours to change.`);
    if (lines(g.raises).length) out.push(`Raises a bond: ${lines(g.raises).join('; ')}.`);
    if (lines(g.lowers).length) out.push(`Lowers a bond: ${lines(g.lowers).join('; ')}.`);
    out.push(`Levels (from the lower of affection and trust): ${settings.levels.map(l => `${l.name} (${l.min}+)`).join(', ')}.`);
    // Family bonds name the same levels differently; the model is told so it reads them alike.
    if (people.some(p => p.lock === 'familial' && settings.levels.some(l => l.familial))) {
        out.push(`For family bonds the same levels are called: ${settings.levels.map(l => levelName(l, { lock: 'familial' })).join(', ')}.`);
    }
    // Desire is only asked for where the user switched romance on; for everyone else it is ignored.
    const romantic = people.filter(p => romanceActive(p, 'toPlayer'));
    if (romantic.length) {
        const rl = settings.romanceLevels?.length ? settings.romanceLevels : DEFAULT_ROMANCE_LEVELS;
        const dg = meterGrowth(g, 'desire');
        out.push(`desire: romantic and physical attraction toward ${playerName}, from 0 to ${g.max}, separate from affection (a close friend can feel no desire at all). `
            + `Give desire ONLY for: ${romantic.map(p => p.name).join(', ')}, whose romance is switched on; never for anyone else. `
            + `Between -${fmt(g.maxLoss)} and +${fmt(dg.maxGain)}; it grows slowly, and 0 is the usual answer. `
            + `Romance levels (from desire): ${rl.map(l => `${l.name} (${l.min}+)`).join(', ')}.`);
    } else {
        out.push('Leave out desire: nobody\'s romance is switched on.');
    }
    // Romance-unlock flags: only outside Manual, and only when somebody qualifies. Otherwise the
    // prompt is exactly what it was before the setting existed.
    const eligible = catalystCandidates(settings, people, turn);
    if (eligible.length) out.push(catalystRule(eligible, playerName));
    const auto = settings.milestones.filter(m => m.auto);
    if (auto.length) {
        out.push('Milestones (type id: when to record it):');
        for (const m of auto) out.push(`- ${m.id}: ${m.label}${m.hint ? ` - ${m.hint}` : ''}${m.once ? ' (once)' : ''}`);
        out.push('Record a milestone only when it clearly happens in the LATEST message, never on a hint or a plan.');
    }
    if (people.length) {
        out.push(`Current bonds with ${playerName}:`);
        for (const p of people) {
            const { level } = levelFor(bondValue(p), settings.levels);
            const meters = p.edges?.toPlayer ? meterText(p.edges.toPlayer) : fmt(bondValue(p));
            const side = playerSideLevel(p, settings.levels);
            const done = settings.milestones.filter(m => m.once && hasMilestone(p, m.id)).map(m => m.id);
            const rl = settings.romanceLevels;
            const cr = romanceState(p, 'toPlayer', rl);
            const pr = romanceState(p, 'fromPlayer', rl);
            out.push(`- ${p.name}: ${meters} (${levelName(level, p)})`
                + `${cr.active ? `; desire ${fmt(cr.desire)} (${cr.level ? cr.level.name : 'no romance yet'})` : ''}`
                + `${side ? `; ${playerName} feels about them: ${side}` : ''}`
                + `${pr.active ? `; ${playerName}'s romance: ${pr.level ? pr.level.name : 'none yet'}` : ''}`
                + `${done.length ? `; already recorded: ${done.join(', ')}` : ''}`);
        }
    }
    return out.join('\n');
}

/** Who the model may flag as turning romantic: everyone in `people` romanceEligibility allows. */
export function catalystCandidates(settings, people, turn) {
    if (pick(settings?.romanceUnlock, ROMANCE_UNLOCKS, 'manual') === 'manual') return [];
    return (people || []).filter(p => romanceEligibility(p, settings, turn).ok);
}

const CATALYST_SHAPE = '"catalysts":[{"name":"Name","reason":"short reason"}]';

function catalystRule(eligible, playerName) {
    return `catalysts: optional. Add ${CATALYST_SHAPE} to the JSON object only when the LATEST message shows a character's feelings toward ${playerName} `
        + 'clearly turning romantic: a vulnerable moment, a charged confrontation, deepening intimacy. '
        + `Only for: ${eligible.map(p => p.name).join(', ')}. At most one per person. Never on a hint, a joke or ordinary warmth; when in doubt, leave it out.`;
}

const JSON_SHAPE = '{"date":"Friday, February 07, 1182","bonds":[{"name":"Name","affection":1,"trust":0,"respect":0,"desire":0,"reason":"short reason"}],"milestones":[{"name":"Name","type":"first_kiss","note":"one line"}]}';
/** JSON_SHAPE with the romance-unlock flags, for the inline block when somebody may be flagged. */
const JSON_SHAPE_CATALYSTS = `${JSON_SHAPE.slice(0, -1)},${CATALYST_SHAPE}}`;

export const BOND_SYSTEM = [
    'You track how the characters of a roleplay feel about the player, {{user}}: affection, trust and respect, and desire for those whose romance is switched on. You read the newest exchange and propose small, believable changes.',
    'Output ONLY one JSON object, no commentary, no code fences:',
    JSON_SHAPE,
    'List every named character (never {{user}}) who took part in the latest message, with 0 for every meter that did not change. Give desire only for the characters the rules name; leave it out or 0 for everyone else. Empty arrays are fine.',
].join('\n');

/* ---- the section under a reply ------------------------------------------------------- */

const signed = (n, plus = '') => `${n < 0 ? '-' : plus}${Math.abs(n)}`;

/**
 * The BOND TRACKER block for one reply: every tracked person, with what this reply changed. The
 * display regexes in regex/ dress it; DESIRE appears only while the character's romance is on:
 *
 *   - <b>Kaito</b> → <b>Mira</b> | AFFECTION: +34 | TRUST: 20 | RESPECT: 15 | DESIRE: 40 | LEVEL: Friend · Courting (+2 affection)
 */
export function trackerBlockHtml(store, record, settings, playerName) {
    const people = (store?.people || []).filter(p => p.tracked).slice(0, 12);
    if (!people.length) return '';
    const changes = record?.changes || [];
    const lines = people.map((person) => {
        const edge = person.edges?.toPlayer || {};
        const value = person.edges?.toPlayer ? platonicValue(edge) : Number(person.value) || 0;
        const romance = romanceState(person, 'toPlayer', settings.romanceLevels);
        const level = [levelName(levelFor(value, settings.levels)?.level, person), romance.level?.name || ''].filter(Boolean).join(' · ');
        const mine = changes.filter(c => c.name === person.name && c.dir !== 'fromPlayer' && Number(c.delta));
        const note = mine.length ? ` (${mine.map(c => `${Number(c.delta) > 0 ? '+' : ''}${c.delta} ${c.meter || 'affection'}`).join(', ')})` : '';
        const r = (k) => Math.round(Number(edge[k]) || 0);
        const desire = romance.active ? ` | DESIRE: ${Math.max(0, r('desire'))}` : '';
        return `- <b>${person.name}</b> → <b>${playerName}</b> | AFFECTION: ${signed(r('affection'), '+')} | TRUST: ${signed(r('trust'))} | RESPECT: ${signed(r('respect'))}${desire} | LEVEL: ${level}${note}`;
    });
    return `<details><summary>💞 BOND TRACKER</summary>\n${lines.join('\n')}\n</details>`;
}

/** The system and user text for the separate request. */
export function buildMonitorPrompt(settings, people, { playerName = 'the player', recent = '', latest = '', speaker = '', lastDate = '', turn = undefined } = {}) {
    const system = (String(settings.prompt || '').trim() || BOND_SYSTEM).replace(/\{\{user\}\}/gi, playerName);
    const user = [
        rulesText(settings, people, playerName, lastDate, turn),
        '',
        recent ? `RECENT MESSAGES:\n${recent}\n` : '',
        `LATEST MESSAGE${speaker ? ` (${speaker})` : ''}:`,
        latest,
    ].join('\n');
    return { system, user };
}

/** What the story model is told in the "with the reply" timing. */
export function buildInlineInstruction(settings, people, playerName = 'the player', lastDate = '', turn = undefined) {
    const shape = catalystCandidates(settings, people, turn).length ? JSON_SHAPE_CATALYSTS : JSON_SHAPE;
    return [
        '[Bond tracking]',
        `After your reply, on its own line at the very end, write a hidden block: <${INLINE_TAG}>${shape}</${INLINE_TAG}>`,
        `It records how the latest exchange changed each character's bond with ${playerName}. It is removed before anyone reads the reply, so never refer to it in the story.`,
        rulesText(settings, people, playerName, lastDate, turn),
        '[/Bond tracking]',
    ].join('\n');
}
