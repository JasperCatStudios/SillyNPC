/**
 * The hands-on mechanics contract (fork): what every mechanic (slice, stir, sear, sprinkle, ...) shares. A mechanic is a pure core:
 * no screen, no clock of its own, no randomness of its own. The screen feeds it an input frame and a time step, and reads back a
 * state, events and a 0..1 performance. Because of that a simulated player can play any mechanic in a test.
 *
 * The input frame (the one shape for every mechanic):
 *   { held: boolean,                         the action key / big button is down (a level)
 *     presses: number[],                     press edges inside this frame, as times in ms on the run's clock
 *     pointer: { down: boolean, x, y,        stage units 0..1 (the stage is 16:10, x across, y down)
 *                path: [[t, x, y], ...] },   pointer samples since the last frame
 *     pick: string | null,                   a named control ('plate', 'done', a target id)
 *     controls: 'pointer' | 'button' }       which way the player is playing
 * Every mechanic accepts a frame with only some of these (a missing field is "nothing happened").
 *
 * The contract of a mechanic core (see docs/MECHANICS-DESIGN.md, private):
 *   meta       { id, input: { pointer, button }, events, defaults }
 *   newRun(params, rng, ctx)           ctx: { controls, assist, scale }
 *   step(state, dtMs, input, rng)      mutates and returns the state; never moves a finished run
 *   isOver(state)  performance(state)  0..1, never NaN
 *   describeState(state, words)        plain words for the partner's talk
 * Events are listed in `state.events` (cleared at the start of each step): { type, grade?, at }.
 *
 * Pure: no DOM, no SillyTavern imports.
 */

export const GRADE_SCORE = Object.freeze({ perfect: 1, good: 0.6, miss: 0 });
export const GRACE_MS = 800;
export const MAX_STEP_MS = 50;
export const ASSIST_WIDER = 1.45;
export const ASSIST_SLOWER = 1.4;

export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
export const num = (v, d) => (Number.isFinite(Number(v)) && String(v ?? '').trim() !== '' ? Number(v) : d);
export const mean = (list) => (list.length ? list.reduce((n, v) => n + v, 0) / list.length : 0);
export const stdev = (list) => {
    if (list.length < 2) return 0;
    const m = mean(list);
    return Math.sqrt(mean(list.map(v => (v - m) ** 2)));
};

/**
 * A param that may be a number, `{ base, perTier }` or a 5-entry array by tier, as a number for a tier (0 to 4).
 * @param {number|{base:number,perTier?:number}|number[]} v
 */
export function resolveParam(v, tier = 0) {
    const t = clamp(Math.floor(Number(tier) || 0), 0, 4);
    if (Array.isArray(v) && v.length && v.every(x => Number.isFinite(Number(x))) && v.length >= 5) return Number(v[t]);
    if (v && typeof v === 'object' && !Array.isArray(v) && Number.isFinite(Number(v.base))) return Number(v.base) + (Number(v.perTier) || 0) * t;
    return v;
}

/** How far a value is from its target against a tolerance: perfect within a third of it, good within it, else miss. */
export function windowGrade(offset, tol) {
    const o = Math.abs(Number(offset));
    if (!Number.isFinite(o) || !(tol > 0)) return 'miss';
    return o <= tol / 3 ? 'perfect' : o <= tol ? 'good' : 'miss';
}

/**
 * The tolerance scale for a run: a recipe-level `scale` (0.6 to 1.3, above is easier) and assist (wider). Multiply tolerances and windows
 * by it; divide speeds and drift by it.
 */
export function easeFactor({ scale = 1, assist = false } = {}) {
    return clamp(Number(scale) || 1, 0.6, 1.3) * (assist ? ASSIST_WIDER : 1);
}

/** The slow-down factor for speeds, rates and drift. */
export function calmFactor({ scale = 1, assist = false } = {}) {
    return clamp(Number(scale) || 1, 0.6, 1.3) * (assist ? ASSIST_SLOWER : 1);
}

/** Advances a run's clock in steps of at most 50 ms, calling `each(dt)` for every slice, so a hitch never skips a check. */
export function stepsOf(dtMs) {
    const out = [];
    let left = Math.max(0, Number(dtMs) || 0);
    while (left > 0) { const dt = Math.min(MAX_STEP_MS, left); out.push(dt); left -= dt; }
    return out;
}

/** Presses of a frame as times, never undefined. */
export const pressesOf = (input) => (Array.isArray(input?.presses) ? input.presses.map(Number).filter(Number.isFinite) : []);

/** The pointer samples of a frame as [t, x, y] arrays. */
export const pathOf = (input) => (Array.isArray(input?.pointer?.path) ? input.pointer.path.filter(p => Array.isArray(p) && p.length >= 3 && p.every(Number.isFinite)) : []);

/** The words a mechanic uses for its own things, with neutral defaults. */
export const wordsOf = (words, defaults) => ({ ...defaults, ...Object.fromEntries(Object.entries(words || {}).filter(([, v]) => typeof v === 'string' && v.trim())) });
