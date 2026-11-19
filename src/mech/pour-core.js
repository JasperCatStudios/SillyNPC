/**
 * Pour (fork): pour to a line. A jug tips over a vessel with a target line. The more it tips the faster it pours, and it keeps
 * pouring for a moment after you stop (the lag), so a good pourer stops a little early.
 *
 *   pointer  press and drag DOWN to tip the jug (further down is more tilt); let go to stand it upright again
 *   button   hold the action key to tip the jug (full tilt in about 0.6 s); let go to stand it upright
 *
 * Model: flow = maxFlow x tilt^2; after the jug is stood up the flow dies away over lagMs.
 * perf = 1 within a third of the tolerance of the line, then falling to 0 at 2.5 x tolerance. A spill (above the rim) ends the pour,
 * ruins it (the session caps a ruined step) and gives 0 to 0.3 at most. Pure: see contract.js.
 */

import { clamp, num, easeFactor, calmFactor, stepsOf, pathOf, wordsOf, windowGrade, GRACE_MS } from './contract.js';

export const meta = {
    id: 'pour',
    input: { pointer: 'drag-down', button: 'hold' },
    events: ['pour', 'bullseye', 'spill', 'done'],
    defaults: { target: 0.65, tol: 0.06, maxFlow: 0.25, lagMs: 450, timeLimitMs: 15000, idleEndMs: 1600 },
};

const TILT_UP_PER_SEC = 1.6;
const TILT_DOWN_PER_SEC = 2.5;
const DRAG_RANGE = 0.3;                        // a drag of this much of the stage height is full tilt

export function newRun(params = {}, rng = Math.random, ctx = {}) {
    const p = { ...meta.defaults, ...params };
    const ease = easeFactor(ctx);
    const calm = calmFactor(ctx);
    return {
        params: p, controls: ctx.controls === 'button' ? 'button' : 'pointer', ease, calm,
        target: clamp(num(p.target, 0.65), 0.2, 0.95), tol: Math.max(0.01, num(p.tol, 0.06)) * ease, maxFlow: num(p.maxFlow, 0.25) / calm,
        lagMs: Math.max(50, num(p.lagMs, 450)), t: 0, over: false, ended: false, events: [], ruined: false,
        level: 0, tilt: 0, flow: 0, poured: false, idleMs: 0, spilled: false, downY: null, dragTo: 0, grade: null,
    };
}

export function step(s, dtMs, input = {}, rng = Math.random) {
    s.events = [];
    if (s.over) return s;
    const picks = [input.pick].flat().filter(Boolean);
    const path = pathOf(input);
    // Pointer: where the press began, and how far down it has been dragged since.
    if (s.controls === 'pointer') {
        if (input.pointer?.down || path.length) {
            const last = path.length ? path[path.length - 1][2] : null;
            if (s.downY === null && path.length) s.downY = path[0][2];
            if (last !== null && s.downY !== null) s.dragTo = clamp((last - s.downY) / DRAG_RANGE, 0, 1);
        }
        if (!input.pointer?.down && !path.length) { s.downY = null; s.dragTo = 0; }
    }
    const holding = s.t > GRACE_MS && (s.controls === 'button' ? Boolean(input.held) : false);
    for (const dt of stepsOf(dtMs)) {
        s.t += dt;
        const sec = dt / 1000;
        if (s.t <= GRACE_MS) continue;
        if (s.controls === 'button') s.tilt = clamp(s.tilt + (holding ? TILT_UP_PER_SEC : -TILT_DOWN_PER_SEC) * sec, 0, 1);
        else {
            const rate = (s.dragTo > s.tilt ? 5 : TILT_DOWN_PER_SEC) * sec;
            s.tilt = s.dragTo > s.tilt ? Math.min(s.dragTo, s.tilt + rate) : Math.max(s.dragTo, s.tilt - rate);
        }
        const want = s.maxFlow * s.tilt * s.tilt;
        s.flow = want >= s.flow ? want : Math.max(want, s.flow - (s.maxFlow * dt) / s.lagMs);
        if (s.flow > 0.001) {
            if (!s.poured) s.poured = true;
            s.level += s.flow * sec;
            s.idleMs = 0;
        } else if (s.poured) s.idleMs += dt;
        if (s.level > 1) { s.level = 1; s.spilled = true; s.ended = true; break; }
        if (s.poured && s.idleMs >= s.params.idleEndMs && s.tilt <= 0.01) { s.ended = true; break; }
        if (s.t >= s.params.timeLimitMs) { s.ended = true; break; }
    }
    if (picks.includes('done') || picks.includes('plate')) s.ended = true;
    if (s.ended && !s.over) {
        s.over = true;
        s.tilt = 0;
        s.flow = 0;
        if (s.spilled) { s.ruined = true; s.events.push({ type: 'spill', grade: 'miss', at: s.t }); }
        else {
            s.grade = windowGrade(Math.abs(s.level - s.target), s.tol);
            s.events.push({ type: 'pour', grade: s.grade, at: s.t });
            if (s.grade === 'perfect') s.events.push({ type: 'bullseye', at: s.t });
        }
        s.events.push({ type: 'done', at: s.t });
    }
    return s;
}

export const isOver = (s) => s.over;

export function performance(s) {
    const off = Math.abs(s.level - s.target);
    const raw = off <= s.tol / 3 ? 1 : clamp(1 - off / (2.5 * s.tol), 0, 1);
    return clamp(s.spilled ? Math.min(0.3, raw) : raw, 0, 1);
}

export function describeState(s, words = {}) {
    const w = wordsOf(words, { vessel: 'the vessel' });
    const pct = Math.round(s.level * 100);
    const aim = Math.round(s.target * 100);
    if (s.spilled) return `${w.vessel} overflowed`;
    if (!s.poured) return `nothing poured yet, aiming for about ${aim}% full`;
    return `${w.vessel} is ${pct}% full, aiming for ${aim}%${s.over ? (Math.abs(s.level - s.target) <= s.tol ? ', just right' : ', not quite right') : ''}`;
}

export function view(s) {
    return { level: s.level, target: s.target, tol: s.tol, tilt: s.tilt, flow: s.flow, pouring: s.flow > 0.001, spilled: s.spilled, controls: s.controls, over: s.over, grade: s.grade, held: s.dragTo > 0.02 };
}
