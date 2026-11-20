/**
 * Assemble (fork): put parts of a figure where they belong. A faint outline shows where each part goes, and the parts are taken one at
 * a time, in order, the next one lit. Used for building a body, a machine, anything made of pieces.
 *
 *   pointer  press anywhere to pick the next part up, drag it over its outline, let go to put it down (a big, forgiving drop)
 *   button   a marker sweeps across the stage: press to stop it across, press again to stop it down. Each part is two presses.
 *
 * Positions are stage units (16:10: x across, y down, both 0..1). Distances are measured in square units (the stage height).
 * Per part: 1 within a third of the tolerance of its outline, falling to 0.4 at 2 x tolerance and to 0 at 3 x. perf = the mean of the
 * parts (a part not put down scores 0). A part put in the wrong place is never a ruin: it just sits crooked. Pure: see contract.js.
 */

import { clamp, num, mean, easeFactor, calmFactor, stepsOf, pressesOf, pathOf, wordsOf, windowGrade, GRACE_MS } from './contract.js';
import { toSquare } from './geometry.js';

export const meta = {
    id: 'assemble',
    input: { pointer: 'drag-drop', button: 'sweep-lock' },
    events: ['place', 'done'],
    defaults: { count: 4, tol: 0.1, sweepMs: 1700, timeLimitMs: 40000 },
};

/** The parts of a plain figure, in the order they go on, and where each belongs. Any prefix of the list still looks like a figure. */
export const FIGURE = Object.freeze([
    { id: 'torso', x: 0.5, y: 0.5, w: 0.1, h: 0.2 },
    { id: 'head', x: 0.5, y: 0.22, w: 0.06, h: 0.07 },
    { id: 'arm-left', x: 0.38, y: 0.5, w: 0.035, h: 0.17 },
    { id: 'arm-right', x: 0.62, y: 0.5, w: 0.035, h: 0.17 },
    { id: 'leg-left', x: 0.45, y: 0.78, w: 0.04, h: 0.17 },
    { id: 'leg-right', x: 0.55, y: 0.78, w: 0.04, h: 0.17 },
]);

const slug = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
const MAX_PARTS = 8;
const sweep = (t, period) => -1 + 2 * (1 - Math.abs(((t / period) % 2 + 2) % 2 - 1));

/** The parts of a run: the ones given as `parts` ({ id, x, y, w?, h? }), else the first `count` of the plain figure. */
function partsOf(p) {
    const given = (Array.isArray(p.parts) ? p.parts : [])
        .map(q => ({ id: slug(q?.id), x: clamp(num(q?.x, 0.5), 0.05, 0.95), y: clamp(num(q?.y, 0.5), 0.05, 0.95), w: clamp(num(q?.w, 0.06), 0.02, 0.3), h: clamp(num(q?.h, 0.1), 0.02, 0.4) }))
        .filter(q => q.id).slice(0, MAX_PARTS);
    if (given.length) return given;
    return FIGURE.slice(0, clamp(Math.round(num(p.count, 4)), 1, FIGURE.length)).map(q => ({ ...q }));
}

export function newRun(params = {}, rng = Math.random, ctx = {}) {
    const p = { ...meta.defaults, ...params };
    const ease = easeFactor(ctx);
    return {
        params: p, controls: ctx.controls === 'button' ? 'button' : 'pointer', ease, calm: calmFactor(ctx),
        tol: Math.max(0.03, num(p.tol, 0.1)) * ease, t: 0, over: false, ended: false, events: [], ruined: false,
        parts: partsOf(p).map(q => ({ ...q, at: null, d: null, grade: null })),
        index: 0, carrying: false, pos: { x: 0.05, y: 0.5 }, phase: 'x', lockX: 0.5, sweepT: 0,
    };
}

function put(s, x, y) {
    const part = s.parts[s.index];
    if (!part) return;
    part.at = { x, y };
    const a = toSquare([x, y]);
    const b = toSquare([part.x, part.y]);
    part.d = Math.hypot(a[0] - b[0], a[1] - b[1]);
    part.grade = windowGrade(part.d, s.tol);
    s.events.push({ type: 'place', grade: part.grade, part: part.id, at: s.t });
    s.index += 1;
    s.carrying = false;
    s.phase = 'x';
    s.sweepT = 0;
    if (s.index >= s.parts.length) s.ended = true;
}

export function step(s, dtMs, input = {}, rng = Math.random) {
    s.events = [];
    if (s.over) return s;
    const path = pathOf(input);
    const picks = [input.pick].flat().filter(Boolean);
    if (s.controls === 'pointer' && s.t > GRACE_MS) {
        if (path.length) {
            const [, x, y] = path[path.length - 1];
            s.pos = { x, y };
            s.carrying = true;
        }
        // The part goes down where the pointer was let go.
        if (s.carrying && !input.pointer?.down && !s.over) put(s, s.pos.x, s.pos.y);
    }
    const presses = s.controls === 'button' && s.t > GRACE_MS ? pressesOf(input).length : 0;
    for (const dt of stepsOf(dtMs)) {
        if (s.ended) break;
        s.t += dt;
        if (s.controls === 'button') {
            s.sweepT += dt / s.calm;
            if (s.phase === 'x') s.pos = { x: 0.5 + 0.45 * sweep(s.sweepT, s.params.sweepMs), y: 0.04 };
            else s.pos = { x: s.lockX, y: 0.5 + 0.46 * sweep(s.sweepT, s.params.sweepMs * 1.15) };
        }
        if (s.t >= s.params.timeLimitMs) s.ended = true;
    }
    for (let i = 0; i < presses && !s.ended; i++) {
        if (s.phase === 'x') { s.lockX = s.pos.x; s.phase = 'y'; s.sweepT = 0; s.pos = { x: s.lockX, y: 0.04 }; } else put(s, s.lockX, s.pos.y);
    }
    if (picks.includes('done')) s.ended = true;
    if (s.ended && !s.over) {
        s.over = true;
        s.events.push({ type: 'done', at: s.t });
    }
    return s;
}

export const isOver = (s) => s.over;

/** One part's score: 1 within a third of the tolerance, 0.4 at twice the tolerance, 0 at three times; a missing part scores 0. */
export function partScore(d, tol) {
    if (d === null || d === undefined) return 0;
    if (d <= tol / 3) return 1;
    if (d <= 2 * tol) return 1 - (0.6 * (d - tol / 3)) / (tol * (2 - 1 / 3));
    return clamp(0.4 * (1 - (d - 2 * tol) / tol), 0, 0.4);
}

export const performance = (s) => clamp(mean(s.parts.map(q => partScore(q.d, s.tol))), 0, 1);

export function describeState(s, words = {}) {
    const w = wordsOf(words, { work: 'the figure' });
    const placed = s.parts.filter(q => q.at);
    if (!placed.length) return `no part of ${w.work} is in place yet`;
    const off = placed.filter(q => q.grade === 'miss').map(q => q.id.replace(/-/g, ' '));
    return `${placed.length} of ${s.parts.length} parts of ${w.work} are in place${off.length ? `, the ${off.join(' and the ')} a little off` : ', all neatly'}`;
}

export function view(s) {
    return {
        controls: s.controls, over: s.over, carrying: s.carrying, phase: s.phase, lockX: s.lockX, pos: s.pos, index: s.index, tol: s.tol,
        parts: s.parts.map(q => ({ id: q.id, x: q.x, y: q.y, w: q.w, h: q.h, at: q.at, grade: q.grade })),
    };
}
