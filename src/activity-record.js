/**
 * How a finished activity is written into the history (fork).
 *
 * The same two records a game or a fight writes (see game-seats.js, combat-talk.js): the rivalry
 * record (kind 'game', the activity's name in `game`, so no new rivalry kind) and the talk entry
 * (kind 'activities'). One shared id joins them. Cooperative activities are written as a draw;
 * contests name a winner.
 *
 * Pure: no DOM, no SillyTavern imports, so node can test it.
 */

import { gameRecord } from './game-seats.js';

export const OUTCOMES = Object.freeze(['perfect', 'good', 'fair', 'poor']);

const uniq = (names) => [...new Set((names || []).map(n => String(n ?? '').trim()).filter(Boolean))];

/**
 * The rivalry record. winners empty means a draw (every cooperative activity).
 * @param {{ id: string, label: string, user: string, partners: string[], winners?: string[], at?: number, summary?: string }} a
 */
export function activityRecord({ id, label, user, partners, winners = [], at, summary = '' }) {
    return gameRecord({ id, label, user, players: [user, ...uniq(partners)], winners, at, summary });
}

/**
 * The talk entry: who spent the time together, what was said, how it went.
 * `activity` is the activity id ('tea', 'study', ...), `outcome` one of OUTCOMES (anything else is dropped).
 */
export function activityTalkEntry({ id, at = Date.now(), label, activity = '', outcome = '', user, partners, date = '', lines = [], result = '' }) {
    const others = uniq(partners).filter(n => n !== user);
    return {
        id, at, title: label,
        with: others,
        sideA: [user], sideB: others,
        date, lines, result,
        ...(activity ? { activity: String(activity).slice(0, 40) } : {}),
        ...(OUTCOMES.includes(outcome) ? { outcome } : {}),
    };
}
