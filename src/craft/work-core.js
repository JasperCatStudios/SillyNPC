/**
 * The "work" stage of a craft (fork): heat and strike. Hold to heat the work until it is ready, then strike on the beat while it
 * cools, and heat it again when it goes cold. In smithing it is heating and hammering; in alchemy it could be simmer and stir; in a
 * talisman craft, channelling and stroking. The words and art are the craft's data; the rules are these.
 *
 *   heat phase   hold: the heat rises, let go: it falls. Stay inside the band for `readyMs` and the work is ready.
 *                Past the band is "scorching"; above `ruinAbove` for `ruinMs` the work is ruined.
 *   strike phase beats arrive on the pattern. Tap on a beat: perfect +1.0, good +0.6 progress. Each strike and the passing time
 *                drain the heat. When the heat falls below the band the work is cold: striking it cracks it (too many cracks
 *                shatter it), and skipping that beat sends you back to the heat phase.
 *
 * Time and randomness are injected, so a run is repeatable in tests. Pure: no DOM, no SillyTavern imports.
 */

export const WORK_DEFAULTS = Object.freeze({
    band: [0.55, 0.8], rise: 0.55, fall: 0.4, drift: 0.04, readyMs: 1200, drain: 0.04, perStrike: 0.02,
    bpm: 84, windowMs: 220, pattern: 'xxx.', progress: 8, cracksAllowed: 2, ruinAbove: 0.95, ruinMs: 1500, timeLimitMs: 120000,
});

const MAX_STEP_MS = 50;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const SCORE = Object.freeze({ perfect: 1, good: 0.6, miss: 0 });

/**
 * The parameters for one run: the defaults, a recipe-level scale (1 is normal, above is easier), the assist setting and the mixture's
 * effects ({ driftEffect, progressEffect } multiply the drift and the work needed, 1 for none).
 */
export function workParams({ base = {}, scale = 1, assist = false, driftEffect = 1, progressEffect = 1 } = {}) {
    const p = { ...WORK_DEFAULTS, ...base };
    const sc = clamp(scale, 0.6, 1.3);
    const wide = sc * (assist ? 1.45 : 1);
    const calm = sc * (assist ? 1.4 : 1);
    const [lo, hi] = p.band;
    const mid = (lo + hi) / 2;
    const half = Math.min(0.45, ((hi - lo) / 2) * wide);
    const pattern = /^[x.]+$/.test(String(p.pattern)) && String(p.pattern).includes('x') ? String(p.pattern) : WORK_DEFAULTS.pattern;
    return {
        ...p, band: [mid - half, mid + half], drift: (p.drift * clamp(driftEffect, 0.5, 2)) / calm,
        windowMs: Math.round(p.windowMs * wide), bpm: p.bpm / (assist ? 1.4 : 1), pattern,
        progress: Math.max(1, Math.round(p.progress * clamp(progressEffect, 0.5, 2))),
    };
}

/** The strike beats a run can expect in one heating, used to know the best number of cycles. */
export function expectedStrikesPerCycle(p) {
    const beatMs = 60000 / p.bpm;
    const strikesPerBeat = [...p.pattern].filter(c => c === 'x').length / p.pattern.length;
    const perStrike = (p.drain * beatMs) / 1000 / Math.max(0.01, strikesPerBeat) + p.perStrike;
    // Heating stops at about the middle of the band; the work is hot until it falls below the band.
    const start = (p.band[0] + p.band[1]) / 2 + (p.band[1] - p.band[0]) / 4;
    return Math.max(1, Math.floor((start - p.band[0]) / Math.max(0.001, perStrike)));
}

/** A new run, in the heat phase. */
export function newWork(params) {
    const p = { ...WORK_DEFAULTS, ...params };
    return {
        params: p, phase: 'heat', heat: 0.2, wander: 0, t: 0, readyAt: 0,
        heatMs: 0, inBandMs: 0, aboveMs: 0, progress: 0, cycles: 1, cracks: 0,
        beats: [], beatIndex: 0, strikeT: 0, nextBeat: 0, beatScores: [], hotStrikes: 0, coldPending: false,
        over: false, ruined: false, unfinished: false, scorchOn: false, events: [], lastBeat: null,
    };
}

const beatMs = (p) => 60000 / p.bpm;

/** Enters the strike phase: the first beat comes one beat after the switch. */
function startStrike(s) {
    s.phase = 'strike';
    s.strikeT = 0;
    s.beatIndex = 0;
    s.coldPending = false;
    s.nextBeat = beatMs(s.params);
    s.events.push('ready');
}

/** The pattern's character at the current beat. */
const isStrikeBeat = (s) => s.params.pattern[s.beatIndex % s.params.pattern.length] === 'x';

function backToHeat(s) {
    s.phase = 'heat';
    s.cycles += 1;
    s.readyAt = 0;
    s.coldPending = false;
    s.events.push('back-to-heat');
}

function ruin(s, why) {
    s.ruined = true;
    s.over = true;
    s.events.push(why);
}

/**
 * Moves the run forward. \`input.held\` is the hold control (heat phase), \`input.press\` is true on the frame a strike tap arrives.
 * Events (for sounds and talk): ready, strike-perfect, strike-good, strike-miss, cold, crack, back-to-heat, scorching, ruined,
 * shattered, done, unfinished.
 */
export function stepWork(s, dtMs, input = {}, rng = Math.random) {
    s.events = [];
    if (s.over) return s;
    let left = Math.max(0, Number(dtMs) || 0);
    let press = Boolean(input.press);
    while (left > 0 && !s.over) {
        const dt = Math.min(MAX_STEP_MS, left);
        left -= dt;
        const p = s.params;
        const sec = dt / 1000;
        s.t += dt;
        if (s.phase === 'heat') {
            s.heat += (input.held ? p.rise : -p.fall) * sec;
            s.wander = clamp(s.wander + (rng() - 0.5) * 2 * sec * 3, -1, 1);
            s.heat += s.wander * p.drift * sec * 4;
            s.heat = clamp(s.heat, 0, 1);
            s.heatMs += dt;
            const inBand = s.heat >= p.band[0] && s.heat <= p.band[1];
            if (inBand) { s.inBandMs += dt; s.readyAt += dt; } else s.readyAt = Math.max(0, s.readyAt - dt * 2);
            if (s.heat > p.band[1]) { if (!s.scorchOn) { s.scorchOn = true; s.events.push('scorching'); } } else s.scorchOn = false;
            if (s.heat > p.ruinAbove) {
                s.aboveMs += dt;
                if (s.aboveMs >= p.ruinMs) { ruin(s, 'ruined'); break; }
            } else s.aboveMs = Math.max(0, s.aboveMs - dt);
            if (s.readyAt >= p.readyMs) startStrike(s);
        } else {
            s.strikeT += dt;
            s.heat = clamp(s.heat - p.drain * sec, 0, 1);
            const cold = s.heat < p.band[0];
            if (cold && !s.coldPending) { s.coldPending = true; s.events.push('cold'); }
            // A tap is judged against the beat it is closest to (this one, or the one just passed).
            if (press) {
                press = false;
                const timeTo = s.nextBeat - s.strikeT;
                if (isStrikeBeat(s) && Math.abs(timeTo) <= p.windowMs) {
                    const grade = Math.abs(timeTo) <= p.windowMs / 2 ? 'perfect' : 'good';
                    resolveBeat(s, grade);
                }
                // A tap far from any strike beat does nothing (no penalty for an extra tap).
            }
            // The beat passes: an unstruck strike beat is a miss (when the work was hot), and the next beat is scheduled.
            if (!s.over && s.phase === 'strike' && s.strikeT > s.nextBeat + p.windowMs) {
                if (isStrikeBeat(s)) {
                    if (s.coldPending) { backToHeat(s); continue; }       // skipped the cold beat: heat it again
                    s.beatScores.push(0);
                    s.events.push('strike-miss');
                }
                s.beatIndex += 1;
                s.nextBeat += beatMs(p);
            }
        }
        if (!s.over && s.t >= p.timeLimitMs) { s.unfinished = true; s.over = true; s.events.push('unfinished'); }
    }
    return s;
}

/** A strike lands on a beat: cold work cracks, hot work makes progress and loses a little heat. */
function resolveBeat(s, grade) {
    const p = s.params;
    s.lastBeat = { index: s.beatIndex, grade };
    if (s.coldPending) {
        s.cracks += 1;
        s.events.push('crack');
        if (s.cracks > p.cracksAllowed) { ruin(s, 'shattered'); return; }
        backToHeat(s);
        return;
    }
    s.beatScores.push(SCORE[grade]);
    s.hotStrikes += 1;
    s.progress += grade === 'perfect' ? 1 : 0.6;
    s.heat = clamp(s.heat - p.perStrike, 0, 1);
    s.events.push(`strike-${grade}`);
    s.beatIndex += 1;
    s.nextBeat += beatMs(p);
    if (s.progress >= p.progress) { s.over = true; s.events.push('done'); }
}

export const isOver = (s) => s.over;

/**
 * 0 to 1: half the strike accuracy, a fifth the heat control, three tenths the efficiency (fewer heatings than needed is best), minus
 * a little per crack; scaled down when the work was not finished; at most 0.2 when it was ruined.
 */
export function performance(s) {
    const p = s.params;
    const accuracy = s.beatScores.length ? s.beatScores.reduce((n, v) => n + v, 0) / s.beatScores.length : 0;
    const control = s.heatMs > 0 ? clamp(s.inBandMs / s.heatMs, 0, 1) : 0;
    const best = Math.max(1, Math.ceil(p.progress / expectedStrikesPerCycle(p)));
    const efficiency = Math.max(0, 1 - 0.15 * Math.max(0, s.cycles - best));
    let perf = 0.5 * accuracy + 0.2 * control + 0.3 * efficiency - 0.15 * s.cracks;
    perf *= clamp(s.progress / p.progress, 0, 1);
    perf = clamp(perf, 0, 1);
    return s.ruined ? Math.min(perf, 0.2) : perf;
}

/** The run in plain words for the partner's talk; `words` names the work ({ worked: 'the metal' }). */
export function describeState(s, words = {}) {
    const what = String(words.worked || 'the work');
    if (s.ruined) return `${what} was ruined${s.cracks > s.params.cracksAllowed ? ' (it shattered)' : ''}`;
    const pct = Math.round(clamp(s.progress / s.params.progress, 0, 1) * 100);
    const cracks = s.cracks ? `, ${s.cracks} crack${s.cracks === 1 ? '' : 's'}` : '';
    return s.over ? `${what} was ${s.unfinished ? `only ${pct}% finished` : 'finished'}${cracks}` : `${what} is ${pct}% done${cracks}`;
}

/** Where the next beat is, as 0 (just after the last one) to 1 (on the beat), for drawing the beat bar. Null outside the strike phase. */
export function beatProgress(s) {
    if (s.phase !== 'strike' || s.over) return null;
    const ms = beatMs(s.params);
    return clamp(1 - (s.nextBeat - s.strikeT) / ms, 0, 1.2);
}
