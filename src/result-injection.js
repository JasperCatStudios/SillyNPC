/**
 * Putting the result of a fight or a game in front of the story model (fork), the way the phone puts its texts
 * there: a block in the prompt that is never shown in the chat. Before this, both modules posted their report
 * as a visible system message. This is the decision and the wording; result-runtime.js is the SillyTavern side.
 *
 * A finished fight or game leaves one report. What happens to it depends on the mode:
 *   off     - nothing is kept or sent, except a result you ask for with the button in the fight or game window.
 *   always  - the report goes into the next reply.
 *   random  - after that, each reply has a chance (with a cooldown) to carry it.
 *   manual  - it waits until you ask (a button, or the in-window button), then goes into the next reply.
 * Once a reply has carried it, it is cleared: a result is told to the story once.
 *
 * Pure: no DOM, no SillyTavern imports, so node can test it.
 */

import { DEFAULT_KNIVES_INSTRUCTION } from './knives-core.js';

export const RESULT_MODES = Object.freeze(['off', 'always', 'random', 'manual']);
export const RESULT_ROLES = Object.freeze(['system', 'user', 'assistant']);

export const DEFAULT_RESULT_INSTRUCTIONS = Object.freeze({
    combat: 'A fight has just ended between characters in this story. Let it matter if it fits: <<user>> and the others may remember it, react to it, tend to injuries, or deal with what it changed. Do not replay it blow by blow unless asked.',
    levelup: 'The characters named above have grown from what they have been through. Show it only through the story itself, if it fits: a new steadiness, skill, confidence or ease in how they move and fight, and they or the others may notice it or reflect on how far they have come. Never mention levels, ranks, points, experience numbers or game mechanics, and never say they "levelled up". <<user>> may notice it too.',
    knives: DEFAULT_KNIVES_INSTRUCTION,
    activities: 'The characters named above have just spent time together on an activity in this story. Let it colour the scene if it fits: they may mention it, share what they made or learned, or simply seem closer or more tired. Do not replay it move by move, and never mention scores, grades, points or game mechanics. If the report says how long it took, let that much story time pass.',
    games: 'A game has just been played at the table in this story. Let it colour the scene if it fits: <<user>> and the others may bring it up, tease about who won, or move on. Do not replay it move by move unless asked.',
});

export const RESULT_DEFAULTS = Object.freeze({
    mode: 'off',            // 'off' | 'always' | 'random' | 'manual'
    chance: 100,            // random mode: percent of replies that carry the waiting result. 100 = the next reply
    cooldown: 0,            // random mode: at least this many replies between two times (not used at 100%)
    depth: 0,               // how far back in the chat the block sits (0: with the latest message)
    role: 'system',
    order: 510,             // injection order in SillyTavern's prompt list (same-depth blocks go by it)
    inList: true,           // placed through the prompt list (Chat Completion), so it can be moved there
    notify: false,          // a small notice when it happens (the block itself is never shown)
    instruction: '',        // empty: the default for the module
});

const clamp = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d; };

/** The settings, repaired: unknown values fall back to the defaults. */
export function normalizeResultInjection(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const d = RESULT_DEFAULTS;
    return {
        mode: RESULT_MODES.includes(r.mode) ? r.mode : d.mode,
        chance: clamp(r.chance, 0, 100, d.chance),
        cooldown: clamp(r.cooldown, 0, 50, d.cooldown),
        depth: clamp(r.depth, 0, 20, d.depth),
        role: RESULT_ROLES.includes(r.role) ? r.role : d.role,
        order: clamp(r.order, 0, 1000, d.order),
        inList: r.inList === undefined ? d.inList : Boolean(r.inList),
        notify: Boolean(r.notify),
        instruction: typeof r.instruction === 'string' ? r.instruction.slice(0, 800) : d.instruction,
    };
}

/** What waits for delivery: the report, or null. */
export function normalizePending(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const text = String(raw.text ?? '').trim();
    if (!text) return null;
    return { text: text.slice(0, 6000), at: Number.isFinite(Number(raw.at)) ? Number(raw.at) : 0 };
}

/**
 * Whether this reply carries the waiting result.
 * @param {object} p
 * @param {object} p.cfg normalized settings
 * @param {{ text: string } | null} p.pending the report waiting, if any
 * @param {boolean} [p.armed] the player has asked for it this time
 * @param {number} [p.since] replies since it last went (random mode's cooldown)
 * @param {() => number} [p.rng]
 * @returns {{ fire: boolean, reason: string }}
 */
export function chooseResult({ cfg, pending, armed = false, since = Infinity, rng = Math.random }) {
    const c = normalizeResultInjection(cfg);
    if (!pending || !pending.text) return { fire: false, reason: c.mode === 'off' && !armed ? 'off' : 'no result is waiting' };
    // Asked for with a button: it goes with the next reply in every mode, even off (on the default placement).
    if (armed) return { fire: true, reason: 'asked for' };
    if (c.mode === 'off') return { fire: false, reason: 'off' };
    if (c.mode === 'manual') return { fire: false, reason: 'not asked for' };
    if (c.mode === 'always') return { fire: true, reason: 'always' };
    // random
    if (c.chance < 100 && since < c.cooldown) return { fire: false, reason: 'cooling down' };
    if (!(rng() * 100 < c.chance)) return { fire: false, reason: 'not this time' };
    return { fire: true, reason: 'random' };
}

/** The block that goes to the story model: the instruction (with <<user>>) and the report. */
export function resultBlockText({ id, report, user = 'the player', instruction = '' }) {
    const body = String(report ?? '').trim();
    if (!body) return '';
    const how = String(instruction || '').trim() || DEFAULT_RESULT_INSTRUCTIONS[id] || '';
    const filled = how.replace(/<<user>>/gi, user);
    return `${body}\n${filled}`.trim();
}
