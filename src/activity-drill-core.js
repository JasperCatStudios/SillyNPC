import { GRADE_XP } from './activity-memory-core.js';
import { zoneWidth, sweepMs, markerAt, hitQuality } from './activity-harvest-core.js';

/**
 * Skill drills (fork): short, repeatable practice for one proficiency, written as DATA so a world can add its own
 * (a bow drill, a spell-practice drill, a riding drill) without any new code. One reusable mechanic is built so far:
 * "target". A mark crosses a lane and the player taps when it is inside the ring. A drill only chooses how many rounds,
 * how fast, how wide the ring is, and how much the mark wobbles (wind, a nervous horse, an unsteady hand).
 *
 * The words (what the mark is called, what the tap does) are data on the drill, never code, so a drill can be renamed for
 * any world. Pure: no DOM, no SillyTavern imports. Chance is injected as `rng`.
 */

export const DRILL_MECHANICS = Object.freeze(['target']);
const DIFFICULTIES = ['easy', 'normal', 'hard'];
const diff = (d) => (DIFFICULTIES.includes(d) ? d : 'normal');
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const num = (v, lo, hi, dflt) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt; };
const slug = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 30);

/** Neutral built-in drills. A preset's own drills replace these by id and may add more. */
export const GENERIC_DRILLS = Object.freeze({
    target: Object.freeze({
        id: 'target', mechanic: 'target', label: 'Target Practice', rounds: 6, wobble: 0, speed: 1, ring: 1,
        blurb: 'A steady mark crosses the lane. Tap when it is inside the ring.',
        terms: Object.freeze({ mark: 'target', action: 'Tap', place: 'the range' }),
    }),
    moving: Object.freeze({
        id: 'moving', mechanic: 'target', label: 'Moving Targets', rounds: 8, wobble: 0.6, speed: 1.15, ring: 0.85,
        blurb: 'The mark speeds up and slows down as it crosses. Tap when it is inside the ring.',
        terms: Object.freeze({ mark: 'target', action: 'Tap', place: 'the range' }),
    }),
});

/** One drill from raw data, or null. Unknown fields are ignored; every number is clamped. */
export function normalizeDrill(raw, fallbackId = '') {
    const r = obj(raw);
    const id = slug(r.id) || slug(fallbackId);
    if (!id) return null;
    const terms = obj(r.terms);
    return {
        id,
        mechanic: DRILL_MECHANICS.includes(r.mechanic) ? r.mechanic : 'target',
        label: text(r.label, 40) || id,
        blurb: text(r.blurb, 120),
        // The proficiency this drill trains (an id of the active combat type); empty lets the player pick one at the start.
        prof: text(r.prof, 40),
        rounds: Math.round(num(r.rounds, 3, 15, 6)),
        // 0 is steady; up to 1 the speed swings strongly.
        wobble: num(r.wobble, 0, 1, 0),
        // Times the normal speed (above 1 is faster) and times the normal ring width (below 1 is a smaller ring).
        speed: num(r.speed, 0.5, 2, 1),
        ring: num(r.ring, 0.4, 1.6, 1),
        terms: {
            mark: text(terms.mark, 24) || 'target',
            action: text(terms.action, 20) || 'Tap',
            place: text(terms.place, 30) || 'the range',
        },
        ...(text(r.music, 60) ? { music: text(r.music, 60) } : {}),
        // A sound-map tag played each time the button is pressed (a sword swing, a spell, a step). Empty is silence.
        ...(text(r.sound, 60) ? { sound: text(r.sound, 60) } : {}),
    };
}

/** The drills of a preset: its own, plus any built-in one it does not replace. */
export function normalizeDrills(raw) {
    const out = {};
    for (const [id, d] of Object.entries(obj(raw))) {
        const drill = normalizeDrill(d, id);
        if (drill) out[drill.id] = drill;
    }
    for (const [id, d] of Object.entries(GENERIC_DRILLS)) if (!out[id]) out[id] = normalizeDrill(d, id);
    return out;
}

/**
 * A new run. `assist` (always on for a touch screen) widens the ring and slows the mark, as in the other timing games.
 * Each round has its own ring centre, away from the very edges so a tap there is not a lucky guess.
 */
export function newDrill(drill, { difficulty = 'normal', assist = false, rng = Math.random } = {}) {
    const d = normalizeDrill(drill) || normalizeDrill(GENERIC_DRILLS.target);
    const width = Math.min(0.9, zoneWidth(diff(difficulty), assist) * d.ring);
    const sweep = Math.round(sweepMs(diff(difficulty), assist) / d.speed);
    const centers = Array.from({ length: d.rounds }, () => 0.2 + rng() * 0.6);
    return { drill: d, difficulty: diff(difficulty), assist: Boolean(assist), width, sweep, centers, round: 0, results: [], over: false, phase: rng() * Math.PI * 2 };
}

/**
 * Where the mark is `ms` after the round began (0 to 1 along the lane). A wobble bends time, so the mark seems to speed up and
 * slow down while still crossing the whole lane.
 */
export function markAt(state, ms) {
    const t = Math.max(0, Number(ms) || 0);
    const w = state.drill.wobble * 0.35;
    const bent = t + w * state.sweep * Math.sin((t / state.sweep) * Math.PI * 1.7 + state.phase);
    return markerAt(Math.max(0, bent), state.sweep);
}

/** The ring centre for the round now being played. */
export const centerOf = (state) => state.centers[Math.min(state.round, state.centers.length - 1)];

/** A tap `ms` into the round. Returns 'perfect', 'good' or 'miss' (and moves on), or '' when the run is already over. */
export function tapDrill(state, ms) {
    if (state.over) return '';
    const quality = hitQuality(markAt(state, ms), centerOf(state), state.width);
    state.results.push(quality);
    state.round += 1;
    if (state.round >= state.drill.rounds) state.over = true;
    return quality;
}

/** A round that ran out of time with no tap is a miss. */
export function missDrill(state) {
    if (state.over) return '';
    state.results.push('miss');
    state.round += 1;
    if (state.round >= state.drill.rounds) state.over = true;
    return 'miss';
}

/** Points: perfect 2, good 1, miss 0, as a share of the best possible (0 to 1). */
export function scoreOf(results) {
    const list = Array.isArray(results) ? results : [];
    if (!list.length) return 0;
    const points = list.reduce((n, q) => n + (q === 'perfect' ? 2 : q === 'good' ? 1 : 0), 0);
    return points / (list.length * 2);
}

/** perfect: 90% of the points or more; good: 65%; fair: 40%; otherwise poor. */
export function gradeOf(results) {
    const s = scoreOf(results);
    return s >= 0.9 ? 'perfect' : s >= 0.65 ? 'good' : s >= 0.4 ? 'fair' : 'poor';
}

/**
 * What the drill is worth. Harder settings pay a little more. A partner who drills along learns half as much.
 * @returns {{ grade: string, profXp: number, partnerProfXp: number, levelXp: number, bonds: { meter: string, amount: number }[] }}
 */
export function drillRewards(state, { partner = false } = {}) {
    const grade = gradeOf(state.results);
    const mult = GRADE_XP[grade] ?? 0;
    const hard = { easy: 0.85, normal: 1, hard: 1.2 }[state.difficulty] || 1;
    const profXp = Math.round(state.drill.rounds * 2 * mult * hard);
    return {
        grade, profXp,
        partnerProfXp: Math.floor(profXp / 2),
        levelXp: Math.round((4 + state.drill.rounds / 2) * mult),
        bonds: partner && (grade === 'perfect' || grade === 'good') ? [{ meter: 'trust', amount: grade === 'perfect' ? 1 : 0.5 }] : [],
    };
}

/** The run in plain words, for the partner's talk: "5 of 8 taps were good or better". */
export function describeDrill(state) {
    const total = state.results.length;
    const good = state.results.filter(q => q !== 'miss').length;
    return `${good} of ${total} ${state.drill.terms.mark} rounds were hit${state.results.includes('perfect') ? `, ${state.results.filter(q => q === 'perfect').length} dead centre` : ''}`;
}
