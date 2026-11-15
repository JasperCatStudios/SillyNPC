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
 * trust without warmth, does not make a friend. Respect is kept and shown, and desire is part
 * of the data model only (always 0 for now).
 */
export const METERS = Object.freeze(['affection', 'trust', 'respect']);
export const ALL_METERS = Object.freeze(['affection', 'trust', 'respect', 'desire']);
export const METER_LABELS = Object.freeze({ affection: 'Affection', trust: 'Trust', respect: 'Respect', desire: 'Desire' });
export const EDGE_DIRS = Object.freeze({ toPlayer: 'Toward you', fromPlayer: 'Your side' });
/** What a bond may become. Stored only for now. */
export const BOND_LOCKS = Object.freeze({ open: 'Open', platonic: 'Platonic only', familial: 'Family' });
export const STORE_VERSION = 2;

/* ---- defaults ------------------------------------------------------------------------ */

/*
 * Levels are thresholds on one scale: a person is at the highest level whose threshold their
 * value has reached. Below zero is for people who dislike the player; most stories start at 0.
 */
export const DEFAULT_LEVELS = Object.freeze([
    { id: 'hostile', name: 'Hostile', min: -50, description: 'Openly hostile. Refuses help, may work against them.' },
    { id: 'wary', name: 'Wary', min: -15, description: 'Distrustful and guarded. Short answers, keeps their distance.' },
    { id: 'stranger', name: 'Stranger', min: 0, description: 'Polite or indifferent. Treats them like anyone else.' },
    { id: 'acquaintance', name: 'Acquaintance', min: 10, description: 'Recognises them and is friendly in passing. Small talk.' },
    { id: 'friend', name: 'Friend', min: 25, description: 'Enjoys their company, seeks them out, jokes with them.' },
    { id: 'close_friend', name: 'Close friend', min: 40, description: 'Comfortable and warm. Opens up, worries about them.' },
    { id: 'trusted', name: 'Trusted', min: 55, description: 'Deep trust. Would take risks for them and keep their secrets.' },
    { id: 'romantic', name: 'Romantic interest', min: 70, description: 'Attracted to them and aware of it. Nervous, hopeful, tender.' },
    { id: 'partner', name: 'Partner', min: 85, description: 'Committed to each other. Open affection and shared plans.' },
]);

export const DEFAULT_GATES = Object.freeze([
    { id: 'personal_talk', label: 'Talks about personal matters', kind: 'social', level: 'acquaintance' },
    { id: 'first_name', label: 'Uses a nickname or pet name', kind: 'social', level: 'friend' },
    { id: 'favours', label: 'Asks for or offers favours unprompted', kind: 'social', level: 'friend' },
    { id: 'vulnerable', label: 'Shows fear, grief or weakness openly', kind: 'social', level: 'close_friend' },
    { id: 'secrets', label: 'Shares real secrets', kind: 'social', level: 'trusted' },
    { id: 'risk', label: 'Takes serious risks for them', kind: 'conduct', level: 'trusted' },
    { id: 'casual_touch', label: 'Casual touch (shoulder, arm)', kind: 'intimacy', level: 'friend' },
    { id: 'hug', label: 'Hugging', kind: 'intimacy', level: 'close_friend' },
    { id: 'flirting', label: 'Flirting', kind: 'intimacy', level: 'close_friend' },
    { id: 'hand_holding', label: 'Holding hands', kind: 'intimacy', level: 'romantic' },
    { id: 'kissing', label: 'Kissing', kind: 'intimacy', level: 'romantic' },
    { id: 'love_words', label: 'Says "I love you"', kind: 'intimacy', level: 'partner' },
    { id: 'intimacy', label: 'Sexual intimacy', kind: 'intimacy', level: 'partner' },
]);

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
    gates: DEFAULT_GATES,
    milestones: DEFAULT_MILESTONES,
    inject: DEFAULT_INJECT,
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
        decay: Boolean(r.decay),
        decayAfter: int(r.decayAfter, 1, 1000, d.decayAfter),
        decayEvery: int(r.decayEvery, 1, 1000, d.decayEvery),
        decayAmount: num(r.decayAmount, 0, 100, d.decayAmount),
        decayFloor: int(r.decayFloor, min, max, Math.max(min, Math.min(max, d.decayFloor))),
        raises: typeof r.raises === 'string' ? r.raises.slice(0, 2000) : d.raises,
        lowers: typeof r.lowers === 'string' ? r.lowers.slice(0, 2000) : d.lowers,
    };
}

/** Levels sorted by threshold, every id unique, never empty. */
export function normalizeLevels(raw) {
    const list = Array.isArray(raw) ? raw : clone(DEFAULT_LEVELS);
    const seen = new Set();
    const out = [];
    for (const l of list) {
        if (!l || typeof l !== 'object') continue;
        const name = str(l.name, 60);
        if (!name) continue;
        let id = slug(l.id) || slug(name) || newId('l');
        while (seen.has(id) || id === NEVER) id = `${id}_2`;
        seen.add(id);
        out.push({ id, name, min: int(l.min, -1000, 1000, 0), description: str(l.description, 400) });
    }
    if (!out.length) return clone(DEFAULT_LEVELS);
    return out.sort((a, b) => a.min - b.min);
}

/** Gates pointing at a level that no longer exists unlock at the top level rather than at once. */
export function normalizeGates(raw, levels) {
    const list = Array.isArray(raw) ? raw : clone(DEFAULT_GATES);
    const ids = new Set(levels.map(l => l.id));
    const top = levels[levels.length - 1]?.id || NEVER;
    const seen = new Set();
    const out = [];
    for (const g of list) {
        if (!g || typeof g !== 'object') continue;
        const label = str(g.label, 120);
        if (!label) continue;
        let id = slug(g.id) || slug(label) || newId('g');
        while (seen.has(id)) id = `${id}_2`;
        seen.add(id);
        const level = g.level === NEVER ? NEVER : (ids.has(g.level) ? g.level : top);
        out.push({ id, label, kind: pick(g.kind, GATE_KINDS, 'social'), level });
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
    const levels = normalizeLevels(r.levels);
    return {
        enabled: r.enabled === undefined ? BOND_DEFAULTS.enabled : Boolean(r.enabled),
        timing: pick(r.timing, BOND_TIMINGS, BOND_DEFAULTS.timing),
        maxTokens: int(r.maxTokens, 100, 32000, BOND_DEFAULTS.maxTokens),
        contextMessages: int(r.contextMessages, 0, 20, BOND_DEFAULTS.contextMessages),
        prompt: typeof r.prompt === 'string' ? r.prompt : '',
        growth: normalizeGrowth(r.growth),
        levels,
        gates: normalizeGates(r.gates, levels),
        milestones: normalizeMilestonePresets(r.milestones),
        inject: normalizeBondInject(r.inject),
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

/**
 * Which gates are open at a value, and for each closed one, the level that opens it.
 * @returns {{ allowed: object[], locked: { gate: object, needs: object|null }[] }}
 */
export function gateStatus(value, gates, levels) {
    const { index } = levelFor(value, levels);
    const allowed = [];
    const locked = [];
    for (const gate of gates || []) {
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
export function gateText(value, gates, levels, { kind = '', showLocked = true } = {}) {
    const chosen = kind ? (gates || []).filter(g => g.kind === kind) : (gates || []);
    if (!chosen.length) return '';
    const { allowed, locked } = gateStatus(value, chosen, levels);
    const lines = [];
    lines.push(`Allowed now: ${allowed.length ? allowed.map(g => g.label).join('; ') : 'nothing beyond ordinary courtesy'}.`);
    if (showLocked && locked.length) {
        // Grouped by what unlocks them, lowest first, so the model sees the next step clearly.
        const groups = new Map();
        for (const { gate, needs } of locked) {
            const key = needs ? needs.name : 'never';
            if (!groups.has(key)) groups.set(key, { needs, labels: [] });
            groups.get(key).labels.push(gate.label);
        }
        const ordered = [...groups.values()].sort((a, b) => (a.needs ? a.needs.min : Infinity) - (b.needs ? b.needs.min : Infinity));
        for (const g of ordered) {
            lines.push(g.needs
                ? `Not yet (needs ${g.needs.name}): ${g.labels.join('; ')}.`
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
        // Data model only for now: nothing proposes or shows it.
        desire: tenth(num(e.desire, growth.min, growth.max, 0)),
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

/** Sets one meter by hand, clamped to the scale, and keeps the mirror in step. */
export function setMeter(person, dir, meter, value, growth = DEFAULT_GROWTH) {
    const edge = person?.edges?.[dir];
    const v = Number(value);
    if (!edge || !ALL_METERS.includes(meter) || !Number.isFinite(v)) return false;
    edge[meter] = tenth(Math.max(growth.min, Math.min(growth.max, v)));
    syncValue(person);
    return true;
}

export function normalizePerson(raw, growth = DEFAULT_GROWTH) {
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
    };
}

export function normalizeStore(raw, growth = DEFAULT_GROWTH) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const people = [];
    for (const p of Array.isArray(r.people) ? r.people : []) {
        const person = normalizePerson(p, growth);
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

/* ---- growth -------------------------------------------------------------------------- */

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
    const g = growth || DEFAULT_GROWTH;
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
 * affection and trust. Also used on updates remembered on old swipes.
 * @returns {{ affection: number, trust: number, respect: number }}
 */
export function bondDeltas(b) {
    const src = isObj(b?.deltas) ? b.deltas : (b || {});
    const given = (v) => v !== undefined && v !== null && v !== '' && Number.isFinite(Number(v));
    const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    if (!METERS.some(k => given(src[k])) && given(b?.delta)) {
        const d = n(b.delta);
        return { affection: d, trust: d, respect: 0 };
    }
    return { affection: n(src.affection), trust: n(src.trust), respect: n(src.respect) };
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
    return { bonds, milestones, date: str(data?.date, 80) };
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
        edge[meter] = tenth(Math.max(growth.min, Math.min(growth.max, (Number(edge[meter]) || 0) - delta)));
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
        for (const meter of METERS) {
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
    return edge ? levelFor(platonicValue(edge), levels).level.name : '';
}

/** One person's block for the story prompt, honouring their own injection switches. '' if none apply. */
export function bondBlock(person, settings, playerName = 'the player', picks = null) {
    if (!person?.tracked) return '';
    const flags = person.inject || {};
    if (!flags.level && !flags.gates && !flags.history) return '';
    const { levels, gates, growth, inject } = settings;
    const value = bondValue(person);
    const { level, next } = levelFor(value, levels);
    const out = [];
    if (flags.level) {
        const meters = person.edges?.toPlayer ? meterText(person.edges.toPlayer) : fmt(value);
        const side = playerSideLevel(person, levels);
        out.push(`${person.name} toward ${playerName}: ${level.name} (${meters}; of ${growth.max})`
            + `${level.description ? ` - ${level.description}` : ''}`
            + `${next ? ` Next level: ${next.name} at ${next.min}.` : ''}`
            + `${side ? ` ${playerName} feels about them: ${side}.` : ''}`);
    } else {
        out.push(`${person.name} toward ${playerName}:`);
    }
    if (flags.gates) {
        const g = gateText(value, gates, levels, { showLocked: inject.showLocked });
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
function rulesText(settings, people, playerName, lastDate = '') {
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
            out.push(`- ${p.name}: ${meters} (${level.name})`
                + `${side ? `; ${playerName} feels about them: ${side}` : ''}`
                + `${done.length ? `; already recorded: ${done.join(', ')}` : ''}`);
        }
    }
    return out.join('\n');
}

const JSON_SHAPE = '{"date":"Friday, February 07, 1182","bonds":[{"name":"Name","affection":1,"trust":0,"respect":0,"reason":"short reason"}],"milestones":[{"name":"Name","type":"first_kiss","note":"one line"}]}';

export const BOND_SYSTEM = [
    'You track how the characters of a roleplay feel about the player, {{user}}: affection, trust and respect. You read the newest exchange and propose small, believable changes.',
    'Output ONLY one JSON object, no commentary, no code fences:',
    JSON_SHAPE,
    'List every named character (never {{user}}) who took part in the latest message, with 0 for every meter that did not change. Empty arrays are fine.',
].join('\n');

/** The system and user text for the separate request. */
export function buildMonitorPrompt(settings, people, { playerName = 'the player', recent = '', latest = '', speaker = '', lastDate = '' } = {}) {
    const system = (String(settings.prompt || '').trim() || BOND_SYSTEM).replace(/\{\{user\}\}/gi, playerName);
    const user = [
        rulesText(settings, people, playerName, lastDate),
        '',
        recent ? `RECENT MESSAGES:\n${recent}\n` : '',
        `LATEST MESSAGE${speaker ? ` (${speaker})` : ''}:`,
        latest,
    ].join('\n');
    return { system, user };
}

/** What the story model is told in the "with the reply" timing. */
export function buildInlineInstruction(settings, people, playerName = 'the player', lastDate = '') {
    return [
        '[Bond tracking]',
        `After your reply, on its own line at the very end, write a hidden block: <${INLINE_TAG}>${JSON_SHAPE}</${INLINE_TAG}>`,
        `It records how the latest exchange changed each character's bond with ${playerName}. It is removed before anyone reads the reply, so never refer to it in the story.`,
        rulesText(settings, people, playerName, lastDate),
        '[/Bond tracking]',
    ].join('\n');
}
