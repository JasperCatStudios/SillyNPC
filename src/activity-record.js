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

/** 30 -> "30 minutes", 60 -> "an hour", 90 -> "an hour and a half", 120 -> "2 hours". */
export function timeWords(minutes) {
    const m = Math.max(0, Math.round(Number(minutes) || 0));
    if (m < 60) return `${m} minute${m === 1 ? '' : 's'}`;
    const h = Math.floor(m / 60);
    const rest = m % 60;
    const hours = h === 1 ? 'an hour' : `${h} hours`;
    if (rest === 0) return hours;
    if (rest === 30) return h === 1 ? 'an hour and a half' : `${h} and a half hours`;
    return `${hours} and ${rest} minutes`;
}

const GRADE_WORDS = Object.freeze({ perfect: 'went perfectly', good: 'went well', fair: 'went fairly', poor: 'did not go well' });

/**
 * The story report for a finished activity, one short paragraph with no numbers and no game words, so the story
 * model can mention it naturally. `extra` lines (a rank reached, something learned) are added as they are.
 */
export function activityReport({ label, user, partners, grade = 'fair', extra = [], minutes = 0 }) {
    const others = uniq(partners).filter(n => n !== user);
    const list = others.length > 1 ? `${others.slice(0, -1).join(', ')} and ${others[others.length - 1]}` : others[0];
    const head = `[Activity report: ${label}]`;
    const body = list
        ? `${user} and ${list} spent time on ${label.toLowerCase()} together, and it ${GRADE_WORDS[grade] || GRADE_WORDS.fair}.`
        : `${user} spent time on ${label.toLowerCase()} alone, and it ${GRADE_WORDS[grade] || GRADE_WORDS.fair}.`;
    const time = Number(minutes) > 0 ? `About ${timeWords(minutes)} of story time passed.` : '';
    return [head, body, time, ...(extra || []).map(s => String(s).trim())].filter(Boolean).join('\n');
}
