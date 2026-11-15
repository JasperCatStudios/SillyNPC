import { tally, tallyText } from './rivalry-core.js';
import { chooseEntries } from './vector-core.js';

/**
 * Putting the history into the main story prompt (fork), the way a lorebook entry gets in:
 * where it goes, in what role, when it applies, and how much of it.
 *
 * This file decides who is included and what the text says. The caller (history-inject.js)
 * supplies who is in the scene and sets the prompt.
 *
 * Pure: no DOM, no SillyTavern imports.
 */

export const INJECT_POSITIONS = Object.freeze({
    before: 'Before the story prompt',
    prompt: 'In the prompt',
    chat: 'In the chat, this many messages back',
});
export const INJECT_ROLES = Object.freeze({ system: 'System', user: 'User', assistant: 'Assistant' });
export const INJECT_TRIGGERS = Object.freeze({
    always: 'Always, for everyone with a history',
    scene: 'Only when they are in the scene',
    mentioned: 'Only when their name came up recently',
    random: 'Randomly, whoever has a history',
});
export const INJECT_ORDERS = Object.freeze({
    recent: 'Most recent encounter first',
    most: 'Most encounters first',
    name: 'Alphabetical',
});

export const INJECT_DEFAULTS = Object.freeze({
    enabled: false,
    position: 'chat',
    depth: 4,
    role: 'system',
    trigger: 'scene',
    scanDepth: 6,
    chance: 100,
    order: 'recent',
    maxPeople: 3,
    recent: 4,
    instruction: 'Past encounters like these may colour how someone behaves, and a character may bring one up when it '
        + 'feels natural. They are never obliged to, and should not recite it.',
});

const int = (v, lo, hi, d) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
};
const pick = (v, table, d) => (Object.prototype.hasOwnProperty.call(table, v) ? v : d);

export function normalizeInject(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const d = INJECT_DEFAULTS;
    return {
        enabled: Boolean(r.enabled),
        position: pick(r.position, INJECT_POSITIONS, d.position),
        depth: int(r.depth, 0, 100, d.depth),
        role: pick(r.role, INJECT_ROLES, d.role),
        trigger: pick(r.trigger, INJECT_TRIGGERS, d.trigger),
        scanDepth: int(r.scanDepth, 1, 50, d.scanDepth),
        chance: int(r.chance, 0, 100, d.chance),
        order: pick(r.order, INJECT_ORDERS, d.order),
        maxPeople: int(r.maxPeople, 1, 10, d.maxPeople),
        recent: int(r.recent, 1, 20, d.recent),
        instruction: typeof r.instruction === 'string' ? r.instruction.slice(0, 600) : d.instruction,
    };
}

const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

/**
 * Who gets into the prompt this time.
 *
 * @param {object[]} records Every record in the chat.
 * @param {object} opts normalizeInject() output
 * @param {{ applies: (name: string) => boolean, rng: () => number }} ctx
 *   applies says whether the trigger holds for a person (always true for 'always' and 'random').
 * @returns {string[]} Opponent names, in the order they are written.
 */
export function selectOpponents(records, opts, ctx) {
    const names = [];
    for (const r of records || []) if (r.opponent && !names.some(n => same(n, r.opponent))) names.push(r.opponent);
    const lastAt = (n) => Math.max(...records.filter(r => same(r.opponent, n)).map(r => r.at));
    const count = (n) => records.filter(r => same(r.opponent, n)).length;

    let chosen = names.filter(n => ctx.applies(n));
    // The chance is rolled per person, so the same history is not always the one that comes up.
    const chance = opts.trigger === 'random' && opts.chance === 100 ? 35 : opts.chance;
    chosen = chosen.filter(() => ctx.rng() * 100 < chance);

    if (opts.order === 'most') chosen.sort((a, b) => count(b) - count(a) || a.localeCompare(b));
    else if (opts.order === 'name') chosen.sort((a, b) => a.localeCompare(b));
    else chosen.sort((a, b) => lastAt(b) - lastAt(a));
    return chosen.slice(0, opts.maxPeople);
}

/** The text for one person: how it has gone, and the last few things that happened. */
export function historyBlock(records, opponent, playerName, recent, picks = null) {
    const mine = (records || []).filter(r => same(r.opponent, opponent));
    if (!mine.length) return '';
    const fights = tally(mine, null, 'combat');
    const games = tally(mine, null, 'game');
    const head = [];
    if (fights.total) head.push(`${fights.total} fight${fights.total === 1 ? '' : 's'} (${tallyText(fights)})`);
    if (games.total) head.push(`${games.total} game${games.total === 1 ? '' : 's'} (${tallyText(games)})`);
    // Vectors only change which records fill the slots; without picks it is the newest, as always.
    const lines = chooseEntries(mine, picks, recent).map(r => `- ${r.summary || `${r.kind === 'game' ? r.game || 'A game' : r.game || 'A fight'}: ${r.result}`}${r.note ? ` (${r.note})` : ''}`);
    return `${opponent} and ${playerName}: ${head.join('; ')}. Results are from ${playerName}'s side.\n${lines.join('\n')}`;
}

/** The whole injected block, or '' when nobody qualifies. */
export function buildInjection(records, names, opts, playerName = 'the player', picks = null) {
    const blocks = names.map(n => historyBlock(records, n, playerName, opts.recent, picks)).filter(Boolean);
    if (!blocks.length) return '';
    return ['[Shared history]', ...blocks, opts.instruction ? opts.instruction : '', '[/Shared history]'].filter(Boolean).join('\n');
}
