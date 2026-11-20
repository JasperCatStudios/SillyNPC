/**
 * Trace (fork): follow a guide line with the pointer. A faint shape is shown as one or more strokes; the player draws each stroke from
 * its start to its end, staying on the line. Used for calligraphy and for wiring, anything that is drawn along a path.
 *
 *   pointer  press near a stroke's start and drag along it; lift to stop (press near where you stopped to carry on)
 *   button   hold the action key and a bead moves along the stroke by itself; let go to pause it
 *
 * Ink (optional): the brush holds a load that runs down as the line is laid. Touch a well to dip it again. A dry brush lays a pale
 * line that counts for less, but it never ends the run. Held still on the paper the brush blots (a small penalty); drawn very fast
 * the line is thin. Leaving the line is a "stray" (a comic mark); it only stops the stroke until you come back to it.
 *
 * perf = 0.5 x accuracy + 0.3 x coverage + 0.2 x steadiness, less a little for blots and strays. Assist widens the line and pulls the
 * brush toward it. Pure: see contract.js. Distances are in square units (the stage height), see geometry.js.
 */

import { clamp, num, easeFactor, calmFactor, stepsOf, pathOf, wordsOf, windowGrade, GRACE_MS, GRADE_SCORE } from './contract.js';
import { toSquare, fromSquare, cumulative, nearestOnPath, pointAt, inCircle } from './geometry.js';
import { glyphStrokes } from './glyphs.js';

export const meta = {
    id: 'trace',
    input: { pointer: 'drag-along-the-line', button: 'hold' },
    events: ['stroke-done', 'stray', 'blot', 'dry', 'dip', 'done'],
    defaults: { glyph: 'cross', width: 0.06, inkPerUnit: 0.3, ink: true, timeLimitMs: 70000, beadSpeed: 0.5 },
};

const MAGNET = 0.35;
const START_REACH = 2.6;          // how many line widths from the stroke's start (or where it stopped) a press may begin
const ON_LINE = 2.2;              // within this many widths the pointer is on the line
const OFF_LINE = 3.2;             // beyond this many widths the pointer has strayed
const SLOW_SPEED = 0.12;          // square units per second: slower than this on the paper is a blot
const FAST_SPEED = 2.6;
const BLOT_MS = 450;
const DEFAULT_WELLS = [{ x: 0.1, y: 0.88, r: 0.075 }];

const wellsOf = (raw) => {
    const list = (Array.isArray(raw) ? raw : DEFAULT_WELLS).map(w => ({ x: clamp(num(w?.x, 0.1), 0, 1), y: clamp(num(w?.y, 0.88), 0, 1), r: clamp(num(w?.r, 0.075), 0.03, 0.2) }));
    return list.slice(0, 3);
};

export function newRun(params = {}, rng = Math.random, ctx = {}) {
    const p = { ...meta.defaults, ...params };
    const ease = easeFactor(ctx);
    const calm = calmFactor(ctx);
    const build = (given) => given.slice(0, 8)
        .map(pts => (Array.isArray(pts) ? pts.filter(q => Array.isArray(q) && q.length >= 2 && q.every(Number.isFinite)) : []))
        .filter(pts => pts.length >= 2)
        .map((pts) => {
            const sq = pts.map(toSquare);
            const cum = cumulative(sq);
            return { pts: sq, cum, len: cum[cum.length - 1], reach: 0, covered: 0, done: false, laid: [], accSum: 0, accN: 0, releases: 0 };
        })
        .filter(st => st.len > 0);
    // The paths given, else the named glyph, else a plain cross: a run always has something to draw.
    const strokes = [(Array.isArray(p.paths) && p.paths.length ? p.paths : null), glyphStrokes(p.glyph), glyphStrokes('cross')]
        .filter(Boolean).map(build).find(list => list.length) || [];
    const inkOn = p.ink !== false && p.ink !== 0 && p.ink !== 'off';
    return {
        params: p, controls: ctx.controls === 'button' ? 'button' : 'pointer', ease, calm, assist: Boolean(ctx.assist),
        strokes, current: 0, width: Math.max(0.01, num(p.width, 0.06)) * ease, magnet: ctx.assist ? MAGNET : 0,
        inkOn, ink: 1, inkPerUnit: Math.max(0, num(p.inkPerUnit, 0.3)), wells: inkOn ? wellsOf(p.wells) : [], inWell: false,
        t: 0, over: false, ended: false, events: [], ruined: false,
        down: false, drawing: false, strayHold: false, lastPt: null, lastT: 0, slowMs: 0, dryFlag: false, blots: 0, strays: 0, dips: 0,
        accSum: 0, accN: 0, speedGood: 0, speedN: 0, beadS: 0, beadPause: 0, held: false, wasHeld: false,
    };
}

/** The stroke being drawn, or null when every stroke is done. */
const currentStroke = (s) => s.strokes[s.current] || null;

function finishStroke(s, st) {
    st.done = true;
    s.drawing = false;
    // Carrying the finger on to the next stroke's start is not a stray.
    s.strayHold = true;
    const avg = st.accN ? st.accSum / st.accN : (s.controls === 'button' ? (st.releases === 0 ? 1 : st.releases <= 2 ? 0.7 : 0.4) : 0);
    const grade = avg >= 0.8 ? 'perfect' : avg >= 0.5 ? 'good' : 'miss';
    s.events.push({ type: 'stroke-done', grade, at: s.t });
    s.current += 1;
    s.beadS = 0;
    if (s.current >= s.strokes.length) s.ended = true;
}

/** Ink used by laying `adv` units of line; returns whether the brush is dry afterwards. */
function spendInk(s, adv) {
    if (!s.inkOn) return false;
    s.ink = Math.max(0, s.ink - adv * s.inkPerUnit);
    const dry = s.ink <= 0;
    if (dry && !s.dryFlag) { s.dryFlag = true; s.events.push({ type: 'dry', at: s.t }); }
    return dry;
}

function dip(s) {
    s.ink = 1;
    s.dryFlag = false;
    s.dips += 1;
    s.events.push({ type: 'dip', at: s.t });
}

/** One pointer sample. */
function sample(s, t, x, y) {
    const st = currentStroke(s);
    if (!st) return;
    const p = toSquare([x, y]);
    // The well: touching it dips the brush (and lifts it from the paper).
    if (s.inkOn && s.wells.some(w => inCircle(p, w))) {
        if (!s.inWell) { s.inWell = true; s.drawing = false; if (s.ink < 1) dip(s); }
        s.lastPt = null;
        return;
    }
    s.inWell = false;
    const near = nearestOnPath(st.pts, p[0], p[1], st.cum);
    const d = near.dist * (1 - s.magnet);
    if (!s.drawing) {
        // Starting, or carrying on: the press has to be near where the line has got to.
        const at = pointAt(st.pts, st.reach, st.cum);
        const dr = Math.hypot(p[0] - at[0], p[1] - at[1]) * (1 - s.magnet);
        if (dr > s.width * START_REACH) {
            if (!s.strayHold && s.down) { s.strayHold = true; s.strays += 1; s.events.push({ type: 'stray', grade: 'miss', at: s.t }); }
            return;
        }
        s.drawing = true;
        s.strayHold = false;
        s.lastPt = p;
        s.lastT = t;
        return;
    }
    const dtS = Math.max(1, t - s.lastT) / 1000;
    const speed = s.lastPt ? Math.hypot(p[0] - s.lastPt[0], p[1] - s.lastPt[1]) / dtS : 0;
    s.lastPt = p;
    s.lastT = t;
    if (d > s.width * OFF_LINE) {
        s.drawing = false;
        if (!s.strayHold) { s.strayHold = true; s.strays += 1; s.events.push({ type: 'stray', grade: 'miss', at: s.t }); }
        return;
    }
    if (d > s.width * ON_LINE) return;
    // On the line: it counts if it is at, or a sensible step ahead of, where the line has got to.
    if (near.s < st.reach - s.width || near.s > st.reach + Math.max(0.25, st.len * 0.3)) return;
    const adv = Math.max(0, near.s - st.reach);
    st.reach = Math.max(st.reach, near.s);
    const grade = windowGrade(d, s.width);
    st.accSum += GRADE_SCORE[grade];
    st.accN += 1;
    s.accSum += GRADE_SCORE[grade];
    s.accN += 1;
    const dry = spendInk(s, adv);
    st.covered += adv * (dry ? 0.4 : 1);
    const [fx, fy] = fromSquare(p);
    st.laid.push([fx, fy, clamp(1.35 - speed / 2.2, 0.45, 1.6) * (dry ? 0.5 : 1), dry ? 1 : 0]);
    if (st.laid.length > 600) st.laid.shift();
    s.speedN += 1;
    if (speed >= SLOW_SPEED && speed <= FAST_SPEED) s.speedGood += 1;
    // Held still on the paper: a blot.
    if (adv <= 0 && speed < SLOW_SPEED) {
        s.slowMs += dtS * 1000;
        if (s.slowMs >= BLOT_MS) { s.slowMs = 0; s.blots += 1; s.events.push({ type: 'blot', at: s.t }); }
    } else s.slowMs = 0;
    if (st.reach >= st.len * 0.95) finishStroke(s, st);
}

export function step(s, dtMs, input = {}, rng = Math.random) {
    s.events = [];
    if (s.over) return s;
    const picks = [input.pick].flat().filter(Boolean);
    if (s.controls === 'pointer') {
        const down = Boolean(input.pointer?.down);
        if (!down && s.down) { s.drawing = false; s.strayHold = false; s.lastPt = null; const st = currentStroke(s); if (st && st.reach > 0) st.releases += 1; }
        s.down = down;
        for (const [t, x, y] of pathOf(input)) { if (s.t > GRACE_MS) sample(s, t, x, y); if (s.ended) break; }
    } else {
        s.held = Boolean(input.held);
        if (picks.includes('dip') && s.inkOn && s.beadPause <= 0) { dip(s); s.beadPause = 350; }
        if (!s.held && s.wasHeld) { const st0 = currentStroke(s); if (st0 && st0.reach > 0) st0.releases += 1; }
        s.wasHeld = s.held;
    }
    for (const dt of stepsOf(dtMs)) {
        s.t += dt;
        if (s.t <= GRACE_MS) continue;
        if (s.beadPause > 0) s.beadPause -= dt;
        if (s.controls === 'button' && s.held && s.beadPause <= 0 && !s.ended) {
            const st = currentStroke(s);
            if (st) {
                const adv = (num(s.params.beadSpeed, 0.5) / s.calm) * (dt / 1000);
                st.reach = Math.min(st.len, st.reach + adv);
                s.beadS = st.reach;
                const dry = spendInk(s, adv);
                st.covered += adv * (dry ? 0.4 : 1);
                const [bx, by] = fromSquare(pointAt(st.pts, st.reach, st.cum));
                st.laid.push([bx, by, dry ? 0.5 : 1, dry ? 1 : 0]);
                if (st.laid.length > 600) st.laid.shift();
                if (st.reach >= st.len * 0.995) finishStroke(s, st);
            }
        }
        if (s.t >= s.params.timeLimitMs) s.ended = true;
        if (s.ended) break;
    }
    if (picks.includes('done')) s.ended = true;
    if (s.ended && !s.over) {
        s.over = true;
        s.drawing = false;
        if (coverage(s) < 0.15) s.ruined = true;
        s.events.push({ type: 'done', at: s.t });
    }
    return s;
}

export const isOver = (s) => s.over;

/** The share of the guide's length that has been laid (a dry stretch counts for a little less). */
export function coverage(s) {
    const total = s.strokes.reduce((n, st) => n + st.len, 0);
    if (!total) return 0;
    return clamp(s.strokes.reduce((n, st) => n + Math.min(st.covered, st.len), 0) / total, 0, 1);
}

export function performance(s) {
    const cov = coverage(s);
    const acc = s.controls === 'button'
        ? (s.strokes.some(st => st.done) ? clamp(s.strokes.filter(st => st.done).reduce((n, st) => n + (st.releases === 0 ? 1 : st.releases <= 2 ? 0.75 : 0.5), 0) / s.strokes.filter(st => st.done).length, 0, 1) : 0)
        : (s.accN ? s.accSum / s.accN : 0);
    const steady = s.controls === 'button' ? 1 : (s.speedN ? s.speedGood / s.speedN : 1);
    const raw = 0.5 * acc + 0.3 * cov + 0.2 * steady - Math.min(0.2, s.blots * 0.04) - Math.min(0.2, s.strays * 0.03);
    const capped = cov < 0.1 ? Math.min(raw, 0.1) : raw;
    const value = clamp(capped, 0, 1);
    return Number.isFinite(value) ? value : 0;
}

export function describeState(s, words = {}) {
    const w = wordsOf(words, { glyph: 'the drawing', ink: 'ink' });
    const done = s.strokes.filter(st => st.done).length;
    const inkText = s.inkOn ? `, ${w.ink} ${s.ink <= 0 ? 'has run dry' : `at ${Math.round(s.ink * 100)}%`}` : '';
    return `${w.glyph}: ${done} of ${s.strokes.length} strokes drawn${inkText}${s.blots ? `, ${s.blots} blot${s.blots === 1 ? '' : 's'}` : ''}`;
}

export function view(s) {
    const st = currentStroke(s);
    return {
        strokes: s.strokes.map((q, i) => ({ pts: q.pts.map(fromSquare), done: q.done, active: i === s.current, reach: q.len ? q.reach / q.len : 0, laid: q.laid })),
        current: s.current, width: s.width, ink: s.ink, inkOn: s.inkOn, dry: s.dryFlag, wells: s.wells,
        bead: s.controls === 'button' && st ? fromSquare(pointAt(st.pts, st.reach, st.cum)) : null,
        controls: s.controls, over: s.over, drawing: s.drawing, blots: s.blots, strays: s.strays,
    };
}
