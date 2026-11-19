/**
 * Slice (fork): chop and slice along guide lines. An ingredient lies on a board with dotted guide lines across it; swipe down across
 * each line and it falls apart there. A hand-guard zone on the left (the holding hand) must not be cut.
 *
 *   pointer  a downward stroke along a guide line, judged by where it crosses and how straight it is (a short stroke is a half cut
 *            that a second stroke completes, at most "good")
 *   button   a conveyor slides the ingredient left under a fixed knife; press when a guide line is under it
 *
 * perf = 0.70 x mean(cut) + 0.15 x evenness + 0.15 x speed - 0.10 x guardHits (clamped). Uncut lines count 0. No ruin.
 * Pure: see contract.js.
 */

import { clamp, num, mean, stdev, easeFactor, calmFactor, windowGrade, stepsOf, pressesOf, pathOf, wordsOf, GRACE_MS } from './contract.js';

export const meta = {
    id: 'slice',
    input: { pointer: 'swipe', button: 'conveyor' },
    events: ['cut', 'half', 'guard', 'stray', 'done'],
    defaults: { lines: 4, tol: 0.05, angleTol: 18, parMs: 6000, timeLimitMs: 15000, guard: true, speed: 0.22, pattern: 'lines' },
};

/** The board: the ingredient's box and the guard zone, in stage units. */
export const BOARD = Object.freeze({ x0: 0.34, x1: 0.92, y0: 0.26, y1: 0.74, guardX: 0.24, knifeX: 0.55 });

/** The run for these params. ctx: { controls: 'pointer' | 'button', assist, scale }. */
export function newRun(params = {}, rng = Math.random, ctx = {}) {
    const p = { ...meta.defaults, ...params };
    const n = clamp(Math.round(num(p.lines, 4)), 2, 8);
    const width = BOARD.x1 - BOARD.x0;
    const ease = easeFactor(ctx);
    const controls = ctx.controls === 'button' ? 'button' : 'pointer';
    // In button mode the ingredient starts to the right of the knife and slides under it.
    const start = controls === 'button' ? BOARD.knifeX - BOARD.x0 + 0.08 : 0;
    const lines = Array.from({ length: n }, (_, i) => ({ id: i, base: BOARD.x0 + ((i + 1) * width) / (n + 1), cut: false, half: false, score: null, at: 0, x: 0 }));
    const s = {
        params: p, controls, ease, t: 0, over: false, lines, events: [], guardHits: 0, strays: 0, stroke: null,
        tol: p.tol * ease, angleTol: p.angleTol * ease, speed: p.speed / calmFactor(ctx), start, cutXs: [], doneAt: 0, flinch: 0,
    };
    for (const l of lines) l.x = l.base + start;
    return s;
}

/** Where a line is right now (it moves in button mode). */
export const lineX = (s, l) => (s.controls === 'button' ? l.base + s.start - s.speed * Math.max(0, (s.t - GRACE_MS) / 1000) : l.base);

const open = (s) => s.lines.filter(l => !l.cut);

function finishCut(s, l, score, x, grade) {
    l.cut = true;
    l.half = false;
    l.score = score;
    l.at = s.t;
    s.cutXs.push(x);
    s.events.push({ type: 'cut', grade, at: s.t, line: l.id, score });
}

/** Judges a finished stroke. */
function judgeStroke(s, pts) {
    if (pts.length < 2) return;
    const ys = pts.map(p => p[2]);
    const xs = pts.map(p => p[1]);
    const span = Math.max(...ys) - Math.min(...ys);
    if (span < 0.08) return;                                         // a tap, not a stroke
    const h = BOARD.y1 - BOARD.y0;
    const first = pts[0];
    const last = pts[pts.length - 1];
    const inBoard = first[2] >= BOARD.y0 - 0.1 && first[2] <= BOARD.y1 + 0.1;
    if (s.params.guard && first[1] < BOARD.guardX && inBoard) {       // a stroke that starts on the holding hand
        s.guardHits += 1;
        s.flinch = 600;
        s.events.push({ type: 'guard', at: s.t });
        return;
    }
    const meanX = mean(xs);
    const dx = Math.abs(last[1] - first[1]);
    const dy = Math.max(1e-6, Math.abs(last[2] - first[2]));
    const angle = (Math.atan2(dx, dy) * 180) / Math.PI;
    const spacing = (BOARD.x1 - BOARD.x0) / (s.lines.length + 1);
    const candidates = open(s).map(l => ({ l, o: Math.abs(meanX - l.base) })).filter(c => c.o <= spacing * 0.6).sort((a, b) => a.o - b.o);
    if (!candidates.length) { s.strays += 1; s.events.push({ type: 'stray', at: s.t }); return; }
    const { l, o } = candidates[0];
    const full = span >= 0.7 * h;
    let score = 0.2;
    let grade = 'miss';
    if (o <= s.tol / 3 && angle <= s.angleTol / 2) { score = 1; grade = 'perfect'; } else if (o <= s.tol && angle <= s.angleTol) { score = 0.6; grade = 'good'; }
    if (!full && !l.half) { l.half = true; s.events.push({ type: 'half', at: s.t, line: l.id }); return; }
    if (l.half) score = Math.min(score, 0.6);
    finishCut(s, l, score, meanX, grade === 'perfect' && l.half ? 'good' : grade);
}

/** A press in button mode: the line nearest the knife is cut, if one is near enough. */
function judgePress(s) {
    const spacing = (BOARD.x1 - BOARD.x0) / (s.lines.length + 1);
    const near = open(s).map(l => ({ l, x: lineX(s, l) })).map(c => ({ ...c, o: Math.abs(c.x - BOARD.knifeX) })).sort((a, b) => a.o - b.o)[0];
    if (!near || near.o > spacing * 0.6) { s.strays += 1; s.events.push({ type: 'stray', at: s.t }); return; }
    const grade = windowGrade(near.o, s.tol);
    finishCut(s, near.l, grade === 'perfect' ? 1 : grade === 'good' ? 0.6 : 0.2, BOARD.knifeX - (near.x - near.l.base - s.start), grade);
}

/** Moves the run on. Strokes are collected across frames and judged when the pointer lifts. */
export function step(s, dtMs, input = {}, rng = Math.random) {
    s.events = [];
    if (s.over) return s;
    const presses = pressesOf(input);
    const path = pathOf(input);
    for (const dt of stepsOf(dtMs)) {
        s.t += dt;
        s.flinch = Math.max(0, s.flinch - dt);
        if (s.t > s.params.timeLimitMs) { s.over = true; break; }
        // Lines that slid past the knife in button mode are lost.
        if (s.controls === 'button' && s.t > GRACE_MS) for (const l of open(s)) if (lineX(s, l) < BOARD.knifeX - Math.max(0.1, s.tol * 2)) { l.cut = true; l.score = 0; l.missed = true; }
    }
    if (s.over) { s.doneAt = s.t; s.events.push({ type: 'done', at: s.t }); return s; }
    if (s.t > GRACE_MS) {
        if (s.controls === 'pointer') {
            if (path.length) {
                if (!s.stroke && input.pointer?.down) s.stroke = [];
                if (s.stroke) for (const pt of path) s.stroke.push(pt);
            }
            if (s.stroke && !input.pointer?.down) { judgeStroke(s, s.stroke); s.stroke = null; }
        } else for (let i = 0; i < presses.length; i++) judgePress(s);
    }
    if (!open(s).length) { s.over = true; s.doneAt = s.t; s.events.push({ type: 'done', at: s.t }); }
    return s;
}

export const isOver = (s) => s.over;

/** 0 to 1. */
export function performance(s) {
    const scores = s.lines.map(l => (l.score ?? 0));
    const cut = mean(scores);
    const xs = [BOARD.x0, ...s.cutXs.slice().sort((a, b) => a - b), BOARD.x1];
    const widths = xs.slice(1).map((x, i) => x - xs[i]).filter(w => w > 0);
    const evenness = widths.length > 1 && s.cutXs.length ? 1 - Math.min(1, stdev(widths) / Math.max(1e-6, mean(widths))) : 0;
    const elapsed = s.over ? (s.doneAt || s.t) : s.t;
    const par = s.params.parMs;
    const speed = elapsed <= par ? 1 : clamp(1 - (elapsed - par) / Math.max(1, s.params.timeLimitMs - par), 0, 1);
    const finished = s.lines.filter(l => l.score !== null).length;
    return clamp(0.7 * cut + (finished ? 0.15 * evenness + 0.15 * speed : 0) - 0.1 * s.guardHits, 0, 1);
}

export function describeState(s, words = {}) {
    const w = wordsOf(words, { item: 'the ingredient' });
    const done = s.lines.filter(l => l.cut).length;
    const bits = [`${done} of ${s.lines.length} cuts made on ${w.item}`];
    if (s.guardHits) bits.push(`${s.guardHits} careless swipe${s.guardHits === 1 ? '' : 's'} near the holding hand`);
    if (s.over) bits.push(`${Math.round(performance(s) * 100)}% clean`);
    return bits.join(', ');
}

/** What the view draws. */
export function view(s) {
    return { lines: s.lines.map(l => ({ id: l.id, x: lineX(s, l), cut: l.cut, half: l.half, score: l.score })), board: BOARD, flinch: s.flinch > 0, controls: s.controls, over: s.over };
}
