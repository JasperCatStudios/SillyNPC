/**
 * Hosting (fork): the rules of Tea Time and Share a Meal, without the screen. You are the host: you choose a drink (a tea tin), make it,
 * choose what to put out to eat, and offer it. The guest reacts to how well it suits them and how well it was made, and you may talk
 * all the while. There are no conversation topics to score.
 *
 * The total is the drink's taste score (liked +2, disliked -1), the food's (liked +2, disliked -2, anything else +1, none 0), how well
 * the drink was made (the steeping: 0 to 2), one point for talking while hosting and one for setting the table nicely (a meal). It is graded perfect, good, fair or poor.
 * A good or perfect result nudges the bond a little (the caller applies the once-a-day rule); a poor one costs nothing.
 *
 * Pure: no DOM, no SillyTavern imports. Chance is injected.
 */

import { scoreTea, scoreBring, knownFrom, NEUTRAL_LINES } from './activity-tea-core.js';
import { GRADE_XP } from './activity-memory-core.js';

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export const HOST_THRESHOLDS = Object.freeze({ perfect: 6, good: 3, fair: 1 });
export const TALK_LINES_FOR_BONUS = 2;

/* ------------------------------------------------------------------ making the drink */

export const STEEP_DEFAULTS = Object.freeze({ seconds: 7, band: [0.55, 0.8] });

/**
 * A steeping run: the strength rises by itself over `seconds`; the player pours when it looks right. Pouring too early is weak, too late
 * is bitter. `ease` widens the good band (assist and easier levels).
 */
export function newSteep({ seconds = STEEP_DEFAULTS.seconds, band = STEEP_DEFAULTS.band, ease = 1 } = {}) {
    const [lo, hi] = band.map(Number);
    const mid = (lo + hi) / 2;
    const half = ((hi - lo) / 2) * clamp(Number(ease) || 1, 0.6, 1.8);
    return { ms: Math.max(1500, Number(seconds) * 1000), t: 0, level: 0, band: [Math.max(0, mid - half), Math.min(0.97, mid + half)], poured: false, over: false, pouredAt: null };
}

/** Moves the strength on; `pour` pours the pot. Returns the run. A pot left alone pours itself at full strength (bitter). */
export function stepSteep(s, dtMs, pour = false) {
    if (s.over) return s;
    s.t += Math.max(0, Number(dtMs) || 0);
    s.level = clamp(s.t / s.ms, 0, 1);
    if (pour || s.level >= 1) { s.poured = true; s.over = true; s.pouredAt = s.level; }
    return s;
}

/** 0 to 1: full inside the band, falling away outside it, nothing when never poured. */
export function steepPerformance(s) {
    if (!s?.poured) return 0;
    const [lo, hi] = s.band;
    const at = s.pouredAt;
    if (at >= lo && at <= hi) return 1;
    return at < lo ? clamp(1 - (lo - at) / 0.45, 0, 0.9) : clamp(1 - (at - hi) / 0.25, 0, 0.9);
}

/** The words for how the tea turned out. */
export function steepWord(perf, level) {
    return perf >= 0.9 ? 'perfectly steeped' : level < 0.5 ? 'weak' : perf >= 0.55 ? 'nicely steeped' : 'bitter';
}

/** 2 for a well made drink, 1 for an acceptable one, 0 for a poor one. */
export const brewPoints = (perf) => (perf >= 0.85 ? 2 : perf >= 0.55 ? 1 : 0);

/* ------------------------------------------------------------------ the result */

/**
 * The state of a hosted session after the offer.
 * @param {{ drink: string, food?: { name: string, kind?: string } | null, perf: number, said?: number, brewWord?: string, prefs?: object }} a
 */
export function hostSession({ guest = '', drink = '', food = null, perf = 0, said = 0, brewWord = '', extra = 0, prefs } = {}) {
    const bring = food && food.name ? { kind: food.kind === 'gift' ? 'gift' : 'food', name: food.name } : null;
    const teaScore = scoreTea(drink, prefs);
    const foodScore = scoreBring(bring, prefs);
    const brew = brewPoints(perf);
    const talk = said >= TALK_LINES_FOR_BONUS ? 1 : 0;
    const setting = extra ? 1 : 0;
    return { guest, drink, food: bring, brewWord: String(brewWord || ''), perf: clamp(Number(perf) || 0, 0, 1), teaScore, foodScore, brew, talk, setting, total: teaScore + foodScore + brew + talk + setting, known: knownFrom({ tea: drink, bring }, prefs) };
}

export function hostGradeOf(total) {
    const t = HOST_THRESHOLDS;
    return total >= t.perfect ? 'perfect' : total >= t.good ? 'good' : total >= t.fair ? 'fair' : 'poor';
}

/**
 * The guest's first reaction to the offer, by taste alone (the drink and the food, not how well it was made): a word for the face.
 * @returns {'delighted'|'pleased'|'neutral'|'uneasy'|'displeased'}
 */
export function offerReaction(session) {
    const taste = session.teaScore + Math.min(session.foodScore, 2);
    return taste >= 3 ? 'delighted' : taste >= 1 ? 'pleased' : taste === 0 ? 'neutral' : taste >= -1 ? 'uneasy' : 'displeased';
}

/** One canned line for a reaction. */
export function cannedReaction(reaction, rng = Math.random) {
    const pool = NEUTRAL_LINES[reaction] || NEUTRAL_LINES.neutral;
    return pool[Math.floor(rng() * pool.length) % pool.length];
}

/**
 * What a result is worth: the grade, small level XP, and a bond nudge for good or perfect (as Tea Time always did).
 * @returns {{ grade: string, levelXp: number, bonds: { meter: string, amount: number }[], milestone: string|null }}
 */
export function hostRewards(session, { affection = 0, highAffection = 60 } = {}) {
    const grade = hostGradeOf(session.total);
    const bonds = grade === 'perfect' ? [{ meter: 'affection', amount: 2 }, { meter: 'trust', amount: 1 }] : grade === 'good' ? [{ meter: 'affection', amount: 1 }] : [];
    return { grade, levelXp: Math.round(10 * (GRADE_XP[grade] ?? 0.3)), bonds, milestone: grade === 'perfect' && Number(affection) >= highAffection ? 'tea_perfect' : null };
}

/** Plain words about the session for the partner's talk. */
export function describeHost(session, { drinkWord = 'tea', stage = 'offered' } = {}) {
    const bits = [`${session.guest || 'The guest'} was offered ${session.drink || `some ${drinkWord}`}`];
    if (session.food) bits.push(`with ${session.food.name}`);
    if (stage !== 'before' && session.brewWord) bits.push(`(${session.brewWord})`);
    return bits.join(' ');
}
