/**
 * Stamp (fork): press a seal on a mark. A ring closes in on a mark; press when the ring meets it. Several marks can follow one another.
 *
 *   pointer  tap ON the mark at the moment the ring meets it (aim and timing both count)
 *   button   press the action key (or the big button) at the moment the ring meets the mark (the mark is aimed for you)
 *
 * Timing: the ring starts big and shrinks to the mark's size in `shrinkMs`, then carries on to nothing. A press within a third of the
 * tolerance of the mark's size is perfect, within the tolerance good, else a miss. An aimed press that lands outside the mark counts
 * for little. A ring that closes with no press is a miss. Assist widens the tolerance and the mark and slows the ring.
 * Pure: see contract.js.
 */

import { clamp, num, easeFactor, calmFactor, stepsOf, pathOf, pressesOf, wordsOf, windowGrade, GRACE_MS } from './contract.js';

export const meta = {
    id: 'stamp',
    input: { pointer: 'tap-on-the-mark', button: 'press' },
    events: ['stamp', 'done'],
    defaults: { rings: 1, shrinkMs: 1300, tol: 0.045, markR: 0.085, startR: 0.3, gapMs: 600, aimed: true },
};

const OFF_TARGET_SCORE = 0.35;       // an aimed press outside the mark keeps this share of its timing score
const AIM_FAT = 1.9;                 // the press may land this many mark radii from its centre

export function newRun(params = {}, rng = Math.random, ctx = {}) {
    const p = { ...meta.defaults, ...params };
    const ease = easeFactor(ctx);
    const calm = calmFactor(ctx);
    const count = clamp(Math.round(num(p.rings, 1)), 1, 3);
    const markR = clamp(num(p.markR, 0.085), 0.04, 0.2) * Math.min(1.4, ease);
    const marks = Array.from({ length: count }, () => ({ x: 0.3 + rng() * 0.4, y: 0.3 + rng() * 0.4, score: null, grade: null, aimOk: true }));
    return {
        params: p, controls: ctx.controls === 'button' ? 'button' : 'pointer', ease, calm, aimed: p.aimed !== false && ctx.controls !== 'button',
        marks, current: 0, markR, tol: Math.max(0.01, num(p.tol, 0.045)) * ease, startR: Math.max(markR * 1.5, num(p.startR, 0.3)),
        shrinkMs: Math.max(300, num(p.shrinkMs, 1300)) * calm, gapMs: Math.max(0, num(p.gapMs, 600)),
        t: 0, ringT: 0, gapLeft: 0, started: false, over: false, events: [], ruined: false, down: false,
    };
}

/** The ring's radius `ringMs` after it started: from startR down to the mark's size at shrinkMs, then on to nothing. */
export function ringRadius(s, ringMs) {
    const k = (s.startR - s.markR) / s.shrinkMs;
    return Math.max(0, s.startR - k * Math.max(0, ringMs));
}

function settleMark(s, grade, score, aimOk) {
    const m = s.marks[s.current];
    m.grade = grade;
    m.score = score;
    m.aimOk = aimOk;
    s.events.push({ type: 'stamp', grade, aim: aimOk, at: s.t });
    s.current += 1;
    s.ringT = 0;
    if (s.current >= s.marks.length) {
        s.over = true;
        s.events.push({ type: 'done', at: s.t });
    } else s.gapLeft = s.gapMs;
}

/** A press at run time `at` (ms) on the stage point (x, y), or with no point (button play). */
function press(s, at, x, y) {
    const m = s.marks[s.current];
    if (!m || s.gapLeft > 0) return;
    const ringMs = s.ringT + (at - s.t);
    const off = Math.abs(ringRadius(s, ringMs) - s.markR);
    const grade = windowGrade(off, s.tol);
    const timing = off <= s.tol / 3 ? 1 : clamp(1 - off / (2.5 * s.tol), 0, 1);
    let aimOk = true;
    if (s.aimed && Number.isFinite(x) && Number.isFinite(y)) {
        aimOk = Math.hypot((x - m.x) * 1.6, y - m.y) <= s.markR * AIM_FAT;
    }
    settleMark(s, aimOk ? grade : 'miss', aimOk ? timing : timing * OFF_TARGET_SCORE, aimOk);
}

export function step(s, dtMs, input = {}, rng = Math.random) {
    s.events = [];
    if (s.over) return s;
    const path = pathOf(input);
    const down = Boolean(input.pointer?.down);
    // A pointer press is the first sample after the pointer went down.
    const taps = [];
    if (s.controls === 'pointer') {
        if (down && !s.down && path.length) taps.push(path[0]);
        s.down = down;
    }
    const buttons = s.controls === 'button' ? pressesOf(input) : [];
    for (const dt of stepsOf(dtMs)) {
        s.t += dt;
        if (s.t <= GRACE_MS) continue;
        if (s.gapLeft > 0) { s.gapLeft -= dt; continue; }
        s.ringT += dt;
        // A ring that has closed with nothing pressed is a miss.
        if (ringRadius(s, s.ringT) <= 0) { settleMark(s, 'miss', 0, true); if (s.over) break; }
    }
    if (!s.over) {
        for (const [t, x, y] of taps) { if (s.t > GRACE_MS && !s.over) press(s, Math.min(t, s.t), x, y); }
        for (const t of buttons) { if (s.t > GRACE_MS && !s.over) press(s, Math.min(t, s.t), NaN, NaN); }
    }
    return s;
}

export const isOver = (s) => s.over;

export function performance(s) {
    const scored = s.marks.filter(m => m.score !== null);
    if (!scored.length) return 0;
    // A mark not reached yet counts as nothing.
    const v = scored.reduce((n, m) => n + m.score, 0) / s.marks.length;
    return Number.isFinite(v) ? clamp(v, 0, 1) : 0;
}

export function describeState(s, words = {}) {
    const w = wordsOf(words, { mark: 'the mark' });
    const done = s.marks.filter(m => m.grade).length;
    return `${done} of ${s.marks.length} pressed on ${w.mark}${s.over ? (performance(s) >= 0.8 ? ', cleanly' : ', not quite on target') : ''}`;
}

export function view(s) {
    const m = s.marks[Math.min(s.current, s.marks.length - 1)];
    return {
        marks: s.marks.map(q => ({ x: q.x, y: q.y, grade: q.grade, aimOk: q.aimOk })), current: s.current, markR: s.markR,
        ringR: s.gapLeft > 0 || s.over ? 0 : ringRadius(s, s.ringT), x: m.x, y: m.y, gap: s.gapLeft > 0, controls: s.controls, over: s.over, aimed: s.aimed,
    };
}
