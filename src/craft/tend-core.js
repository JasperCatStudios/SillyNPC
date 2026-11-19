/**
 * The "tend" stage of a craft (fork): keep a gauge inside a band while it drifts and gets pushed. Hold to raise it, let go to let it
 * fall. In alchemy it is the simmer, in smithing the forge fire, in a talisman craft the flow of spirit energy; the words and art
 * are the craft's data, the rules are these.
 *
 * Time is injected (`dtMs`), the random source is injected, so a run is repeatable in tests. Performance is the share of the time
 * spent inside the band; holding the gauge above `ruinAbove` for `ruinMs` ruins the work.
 *
 * Pure: no DOM, no SillyTavern imports.
 */

export const TEND_DEFAULTS = Object.freeze({
    band: [0.55, 0.78], rise: 0.55, fall: 0.4, drift: 0.05, pushEverySec: [2.5, 4], pushSize: 0.12, durationMs: 8000, ruinAbove: 0.95, ruinMs: 1500,
});

const MAX_STEP_MS = 50;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/**
 * The parameters for one run: the defaults, a recipe-level scale (1 is normal, above 1 is easier), the assist setting and the
 * mixture's effects (a number that multiplies the drift, 1 for none).
 */
export function tendParams({ base = {}, scale = 1, assist = false, driftEffect = 1, progressEffect = 1 } = {}) {
    const p = { ...TEND_DEFAULTS, ...base };
    const wide = clamp(scale, 0.6, 1.3) * (assist ? 1.45 : 1);
    const calm = clamp(scale, 0.6, 1.3) * (assist ? 1.4 : 1);
    const [lo, hi] = p.band;
    const mid = (lo + hi) / 2;
    const half = Math.min(0.45, ((hi - lo) / 2) * wide);
    return {
        band: [mid - half, mid + half], rise: p.rise, fall: p.fall,
        drift: (p.drift * clamp(driftEffect, 0.5, 2)) / calm, pushEverySec: p.pushEverySec, pushSize: p.pushSize / calm,
        durationMs: Math.round(p.durationMs * clamp(progressEffect, 0.5, 2)), ruinAbove: p.ruinAbove, ruinMs: p.ruinMs,
    };
}

/** A new run: the gauge starts low, the first push is scheduled. */
export function newTend(params, rng = Math.random) {
    const p = { ...TEND_DEFAULTS, ...params };
    return {
        params: p, gauge: 0.2, t: 0, inBandMs: 0, aboveMs: 0, nextPush: p.pushEverySec[0] * 1000 + rng() * (p.pushEverySec[1] - p.pushEverySec[0]) * 1000,
        over: false, ruined: false, events: [], wander: 0,
    };
}

/** Whether the gauge is inside the band right now. */
export const inBand = (state) => state.gauge >= state.params.band[0] && state.gauge <= state.params.band[1];

/**
 * Moves the run forward by `dtMs` (at most 50 ms at a time, so a hitch never skips the ruin check). `input.held` is whether the
 * hold control is down. Events ('scorching', 'ruined', 'push', 'done') are listed in `state.events` for sounds and talk.
 */
export function stepTend(state, dtMs, input = {}, rng = Math.random) {
    state.events = [];
    if (state.over) return state;
    let left = Math.max(0, Number(dtMs) || 0);
    while (left > 0 && !state.over) {
        const dt = Math.min(MAX_STEP_MS, left);
        left -= dt;
        const p = state.params;
        const s = dt / 1000;
        state.gauge += (input.held ? p.rise : -p.fall) * s;
        // A slow wandering of the gauge on its own (the drift), steered by a random walk.
        state.wander = clamp(state.wander + (rng() - 0.5) * 2 * s * 3, -1, 1);
        state.gauge += state.wander * p.drift * s * 4;
        state.t += dt;
        if (state.t >= state.nextPush) {
            const dir = rng() < 0.5 ? -1 : 1;
            state.gauge += dir * p.pushSize * (0.6 + rng() * 0.8);
            state.nextPush = state.t + (p.pushEverySec[0] + rng() * (p.pushEverySec[1] - p.pushEverySec[0])) * 1000;
            state.events.push('push');
        }
        state.gauge = clamp(state.gauge, 0, 1);
        if (inBand(state)) state.inBandMs += dt;
        if (state.gauge > p.ruinAbove) {
            state.aboveMs += dt;
            if (state.aboveMs === dt) state.events.push('scorching');
            if (state.aboveMs >= p.ruinMs) { state.ruined = true; state.over = true; state.events.push('ruined'); }
        } else state.aboveMs = Math.max(0, state.aboveMs - dt);
        if (!state.over && state.t >= p.durationMs) { state.over = true; state.events.push('done'); }
    }
    return state;
}

export const isOver = (state) => state.over;

/** 0 to 1: the share of the run spent inside the band (0.2 at most when the work was ruined). */
export function performance(state) {
    const share = clamp(state.inBandMs / Math.max(1, state.params.durationMs), 0, 1);
    return state.ruined ? Math.min(share, 0.2) : share;
}

/** The run in plain words for the partner's talk; `words` names the thing being tended ({ tended: 'the simmer' }). */
export function describeState(state, words = {}) {
    const what = String(words.tended || 'the work');
    if (state.ruined) return `${what} was ruined`;
    const pct = Math.round(performance(state) * 100);
    return state.over ? `${what} was held steady ${pct}% of the time` : `${what} is going, steady ${pct}% so far`;
}
