/**
 * The step engine (fork): plays a recipe script step by step and turns the steps into one result.
 *
 * Per step the mechanic gives a performance 0..1. The session averages them by weight into P, adds a small flow bonus (a combo meter
 * that rises with perfect and good moments and falls with misses; the bonus is at most +0.04), and reports a ruin when a step with
 * `onRuin: 'fail'` is ruined. Nothing here knows grades or rewards: the caller turns P into a grade and pays out as it always has.
 *
 * Pure: no DOM, no SillyTavern imports; the clock and the randomness are injected.
 */

import { mechanicOf } from './registry.js';
import { resolveParam } from './contract.js';

export const FLOW_BONUS_MAX = 0.04;
const FLOW_GAIN = Object.freeze({ perfect: 0.2, good: 0.08, miss: -0.4 });

/**
 * A new session.
 * @param {{ steps: object[] }} script a normalized script
 * @param {{ tier?: number, scale?: number, assist?: boolean, controls?: 'pointer'|'button' }} ctx
 */
export function createSession(script, ctx = {}) {
    return {
        script, ctx: { tier: 0, scale: 1, assist: false, controls: 'pointer', ...ctx }, index: -1, phase: 'idle', run: null, step: null,
        results: [], flow: 0, flowPeak: 0, flowMs: 0, flowSum: 0, t: 0, ruined: false, events: [],
    };
}

/** The params of a step for this crafter: numbers, `{ base, perTier }` and tier arrays resolved. */
export function paramsOf(step, tier = 0) {
    return Object.fromEntries(Object.entries(step.params || {}).map(([k, v]) => [k, resolveParam(v, tier)]));
}

/** Starts the next step (or finishes). Returns the session. */
export function beginNext(session, rng = Math.random) {
    session.index += 1;
    const step = session.script.steps[session.index];
    if (!step) { session.phase = 'done'; session.run = null; session.step = null; return session; }
    const core = mechanicOf(step.mech);
    session.step = step;
    session.run = core.newRun(paramsOf(step, session.ctx.tier), rng, { controls: session.ctx.controls, assist: session.ctx.assist, scale: session.ctx.scale });
    session.phase = 'play';
    return session;
}

/** Feeds a frame to the current step. The step's events move the flow meter; a finished step is recorded. */
export function stepSession(session, dtMs, input = {}, rng = Math.random) {
    session.events = [];
    if (session.phase !== 'play' || !session.run) return session;
    const core = mechanicOf(session.step.mech);
    core.step(session.run, dtMs, input, rng);
    session.t += dtMs;
    applyFlow(session, session.run.events || []);
    session.flowMs += dtMs;
    session.flowSum += session.flow * dtMs;
    if (core.isOver(session.run)) finishStep(session, core);
    return session;
}

/** Moves the flow meter by the graded events of a step and lists them (with a flow-up when the meter crosses half). */
export function applyFlow(session, events) {
    for (const e of events) {
        session.events.push({ ...e, step: session.step?.id, mech: session.step?.mech });
        if (e.grade && FLOW_GAIN[e.grade] !== undefined) {
            const before = session.flow;
            session.flow = Math.min(1, Math.max(0, session.flow + FLOW_GAIN[e.grade]));
            session.flowPeak = Math.max(session.flowPeak, session.flow);
            if (before < 0.5 && session.flow >= 0.5) session.events.push({ type: 'flow-up', at: session.t });
        }
    }
}

function finishStep(session, core) {
    const step = session.step;
    const ruined = Boolean(session.run.ruined);
    const performance = Math.min(core.performance(session.run), ruined ? 0.2 : 1);
    session.results.push({ id: step.id, mech: step.mech, weight: step.weight, performance, ruined, optional: step.optional });
    if (ruined && step.onRuin === 'fail') session.ruined = true;
    session.phase = 'between';
    session.events.push({ type: 'step-done', step: step.id, performance, ruined, at: session.t });
}

/** Skips the current (optional) step: it scores nothing and does not count. */
export function skipStep(session) {
    if (session.phase !== 'play' || !session.step?.optional) return false;
    session.results.push({ id: session.step.id, mech: session.step.mech, weight: 0, performance: 0, ruined: false, skipped: true });
    session.phase = 'between';
    return true;
}

/** The whole session in one number: P (the weighted performance of the steps), the flow bonus, and whether it was ruined. */
export function sessionResult(session) {
    const scored = session.results.filter(r => r.weight > 0);
    const total = scored.reduce((n, r) => n + r.weight, 0);
    const base = total > 0 ? scored.reduce((n, r) => n + r.weight * r.performance, 0) / total : 0;
    const flowAvg = session.flowMs > 0 ? session.flowSum / session.flowMs : 0;
    const bonus = Math.round(FLOW_BONUS_MAX * flowAvg * 1000) / 1000;
    return { P: Math.min(1, Math.max(0, base + (session.results.length ? bonus : 0))), base, bonus, flowPeak: session.flowPeak, ruined: session.ruined, results: session.results };
}

/** The grade for a session result: a ruined dish fails, else by P (0.9 perfect, 0.7 good, 0.4 fair, 0.2 poor). */
export function gradeOfP(P, ruined = false) {
    if (ruined) return 'failed';
    return P >= 0.9 ? 'perfect' : P >= 0.7 ? 'good' : P >= 0.4 ? 'fair' : P >= 0.2 ? 'poor' : 'failed';
}

/** Plain words for the current step, for the partner's talk. */
export function describeSession(session, words = {}) {
    if (!session.run) return 'the dish is finished';
    const core = mechanicOf(session.step.mech);
    return `${session.step.words?.title || session.step.id}: ${core.describeState(session.run, words)}`;
}
