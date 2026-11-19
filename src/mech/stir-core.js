/**
 * Stir (fork): circular motion, speed and consistency. A pot from above: draw circles inside it. Too slow and the bottom catches
 * (when `heat` is on); too fast and it splashes. Halfway through, the contents thicken and the same hand feels heavier.
 *
 *   pointer  the pointer's angle around the pot centre; its speed in revolutions per second (smoothed over 300 ms)
 *   button   each press adds speed that fades (about four presses a second keeps the band); holding the key stirs steadily
 *
 * perf = 0.60 x band + 0.20 x (1 - min(1, splashes / 5)) + 0.20 x obey - 0.30 x scorch (clamped).
 * A scorch past 1.0 is a ruin (the step's own rule decides what that costs). Pure: see contract.js.
 */

import { clamp, num, easeFactor, calmFactor, stepsOf, pressesOf, pathOf, wordsOf, GRACE_MS } from './contract.js';

export const meta = {
    id: 'stir',
    input: { pointer: 'rotary', button: 'taps' },
    events: ['silky', 'splash', 'scorch', 'reverse', 'ruin', 'done'],
    defaults: { speedBand: [0.9, 1.5], revs: 10, splashAbove: 2.2, heat: false, scorchBelow: 0.4, reverseCues: 0, thicken: 0.5, timeLimitMs: 20000 },
};

/** The pot: its centre and radius in stage units (the stage is 16:10, so x is stretched by ASPECT when measuring angles). */
export const POT = Object.freeze({ cx: 0.5, cy: 0.5, r: 0.34, aspect: 1.6 });

const TAU = Math.PI * 2;
/** The path length that counts as one revolution: a circle at 0.6 of the pot radius. */
const SCRUB_CIRCUMFERENCE = TAU * 0.6 * POT.r;

export function newRun(params = {}, rng = Math.random, ctx = {}) {
    const p = { ...meta.defaults, ...params };
    const ease = easeFactor(ctx);
    const calm = calmFactor(ctx);
    const [lo, hi] = Array.isArray(p.speedBand) ? p.speedBand.map(Number) : meta.defaults.speedBand;
    const mid = (lo + hi) / 2;
    const half = ((hi - lo) / 2) * ease;
    const cues = Math.max(0, Math.round(num(p.reverseCues, 0)));
    return {
        params: p, controls: ctx.controls === 'button' ? 'button' : 'pointer', ease, calm,
        band: [Math.max(0.1, mid - half), mid + half], splashAbove: p.splashAbove * ease,
        t: 0, over: false, ruined: false, events: [], progress: 0, speed: 0, v: 0, lastAngle: null, dir: 1,
        samples: [], bandMs: 0, activeMs: 0, splashes: 0, splashClock: 0, scorch: 0, silkyMs: 0,
        cues: Array.from({ length: cues }, (_, i) => ({ at: (i + 1) * (p.timeLimitMs * 0.7) / (cues + 1), needDir: 0, shownAt: 0, done: false, obeyed: false })),
        pressTimes: [], held: false,
    };
}

/** The angle of a stage point around the pot, and how far it is from the centre in pot radii. */
export function polar(x, y) {
    const ax = (x - POT.cx) * POT.aspect;
    const ay = y - POT.cy;
    return { angle: Math.atan2(ay, ax), radius: Math.hypot(ax, ay) / POT.r };
}

const inBand = (s) => s.speed >= s.band[0] && s.speed <= s.band[1];
const thick = (s) => s.progress >= s.params.revs / 2;

export function step(s, dtMs, input = {}, rng = Math.random) {
    s.events = [];
    if (s.over) return s;
    const path = pathOf(input);
    const presses = pressesOf(input);
    const dirs = [];
    // Pointer: the distance the pointer travels inside the pot is the stirring. Circles are the natural way, but any steady
    // movement stirs (back and forth works too), so a mouse does not have to draw perfect circles. The sign of the turning is read
    // from the angle, for the 'other way' cue.
    let revs = 0;
    if (s.controls === 'pointer') {
        for (const [t, x, y] of path) {
            const { angle, radius } = polar(x, y);
            if (radius > 1.1) { s.lastAngle = null; s.lastPt = null; continue; }      // outside the pot: not stirring
            if (s.lastPt) {
                const d = Math.min(0.15, Math.hypot((x - s.lastPt[0]) * POT.aspect, y - s.lastPt[1]));
                revs += d / SCRUB_CIRCUMFERENCE;
            }
            if (s.lastAngle !== null && radius > 0.2) {
                let d = angle - s.lastAngle;
                if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU;
                if (d !== 0) dirs.push(Math.sign(d));
            }
            s.lastAngle = radius > 0.2 ? angle : null;
            s.lastPt = [x, y];
        }
        if (dirs.length) s.dir = Math.sign(dirs.reduce((n, v) => n + v, 0)) || s.dir;
        if (!input.pointer?.down) { s.lastAngle = null; s.lastPt = null; }
    } else {
        for (let i = 0; i < presses.length; i++) { s.v = Math.min(2.8, s.v + 0.33); s.pressTimes.push(s.t); }
        s.held = Boolean(input.held);
    }
    const slices = stepsOf(dtMs);
    const share = slices.length ? 1 / slices.length : 0;
    for (const dt of slices) {
        s.t += dt;
        const sec = dt / 1000;
        const active = s.t > GRACE_MS;
        let dRev = 0;
        if (s.controls === 'pointer') {
            const part = Math.abs(revs) * share;             // the frame's stirring, spread over its slices
            dRev = part;
            s.samples.push([s.t, part]);
            while (s.samples.length && s.samples[0][0] < s.t - 300) s.samples.shift();
            const turned = s.samples.reduce((n, p) => n + Math.abs(p[1]), 0);
            const window = Math.max(100, Math.min(300, s.t));
            s.speed = (turned / window) * 1000 * (thick(s) ? 1 - 0.35 * s.params.thicken : 1);
        } else {
            const recent = s.pressTimes.some(pt => s.t - pt < 400);
            if (s.held && !recent) s.v += (1.2 - s.v) * Math.min(1, sec * 2.5);
            else s.v = Math.max(0, s.v * Math.exp(-(1.4 * (1 + (thick(s) ? 0.5 * s.params.thicken : 0))) * sec));
            while (s.pressTimes.length && s.pressTimes[0] < s.t - 400) s.pressTimes.shift();
            s.speed = s.v;
            dRev = s.v * sec;
        }
        if (!active) continue;
        s.activeMs += dt;
        const good = inBand(s);
        if (good) { s.bandMs += dt; s.silkyMs += dt; if (s.silkyMs > 2000 && !s.silkyShown) { s.silkyShown = true; s.events.push({ type: 'silky', at: s.t }); } } else { s.silkyMs = 0; s.silkyShown = false; }
        s.progress += dRev * (good ? 1 : 0.5);
        if (s.speed > s.splashAbove) { s.splashClock += dt; if (s.splashClock >= 700) { s.splashClock = 0; s.splashes += 1; s.events.push({ type: 'splash', at: s.t }); } } else s.splashClock = 0;
        if (s.params.heat) {
            if (s.speed < s.params.scorchBelow) { s.scorch = clamp(s.scorch + 0.12 * sec, 0, 1.2); if (s.scorch > 0.3 && !s.scorchWarned) { s.scorchWarned = true; s.events.push({ type: 'scorch', at: s.t }); } } else s.scorch = Math.max(0, s.scorch - 0.2 * sec);
            if (s.scorch >= 1) { s.ruined = true; s.over = true; s.events.push({ type: 'ruin', at: s.t }); break; }
        }
        for (const c of s.cues) {
            if (!c.done && !c.shownAt && s.t >= c.at) { c.shownAt = s.t; c.needDir = -s.dir; s.events.push({ type: 'reverse', at: s.t }); }
            if (c.shownAt && !c.done) {
                if (s.dir === c.needDir && s.speed > 0.3) { c.done = true; c.obeyed = true; } else if (s.t - c.shownAt > 1500) c.done = true;
            }
        }
        if (s.progress >= s.params.revs || s.t >= s.params.timeLimitMs) { s.over = true; s.events.push({ type: 'done', at: s.t }); break; }
    }
    return s;
}

export const isOver = (s) => s.over;

export function performance(s) {
    const band = s.activeMs > 0 ? s.bandMs / s.activeMs : 0;
    const cues = s.cues.length;
    const obey = cues ? s.cues.filter(c => c.obeyed).length / cues : 1;
    const perf = 0.6 * band + 0.2 * (1 - Math.min(1, s.splashes / 5)) + 0.2 * obey - 0.3 * Math.min(1, s.scorch);
    const done = clamp(s.progress / s.params.revs, 0, 1);
    // A stir that was not finished is worth only what was stirred.
    const out = clamp(perf * Math.max(0.35, done), 0, 1);
    return s.ruined ? Math.min(out, 0.2) : out;
}

export function describeState(s, words = {}) {
    const w = wordsOf(words, { pot: 'the pot', stuff: 'it' });
    if (s.ruined) return `${w.stuff} caught on the bottom of ${w.pot}`;
    const pct = Math.round(clamp(s.progress / s.params.revs, 0, 1) * 100);
    const feel = s.activeMs ? (s.bandMs / s.activeMs > 0.7 ? 'smooth and even' : s.bandMs / s.activeMs > 0.4 ? 'a little uneven' : 'uneven') : 'just started';
    return `${w.stuff} in ${w.pot} is ${pct}% stirred, ${feel}${s.splashes ? `, ${s.splashes} splash${s.splashes === 1 ? '' : 'es'}` : ''}`;
}

/** What the view draws: the swirl turns at the stirred speed, the scorch patch grows. */
export function view(s) {
    return { speed: s.speed, band: s.band, progress: clamp(s.progress / s.params.revs, 0, 1), scorch: clamp(s.scorch, 0, 1), thick: thick(s), dir: s.dir, cue: s.cues.find(c => c.shownAt && !c.done) ? true : false, controls: s.controls, over: s.over };
}
