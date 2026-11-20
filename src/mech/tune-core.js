/**
 * Tune (fork): keep a ring on a drifting target. A blob wanders about the stage on a smooth, unpredictable path, now and then surging
 * away, and the player keeps a ring on it. Time inside the ring is the score. Used for tuning, calibrating, steadying anything.
 *
 *   pointer  press and drag: the ring moves by how far you drag (a relative drag, so a finger never hides the target)
 *   button   hold the action key: the ring chases the target, slowly and with a lag; let go and it stops. Worth a bit less.
 *
 * Time on target: 1 inside the ring, 0.4 within twice its size, else 0, averaged over the run (a short grace at the start does not count).
 * Slipping is never a ruin: the finished tune is just rougher. Assist widens the ring and slows the target. Pure: see contract.js.
 */

import { clamp, num, easeFactor, calmFactor, stepsOf, pathOf, wordsOf, GRACE_MS } from './contract.js';
import { toSquare } from './geometry.js';

export const meta = {
    id: 'tune',
    input: { pointer: 'relative-drag', button: 'hold-to-chase' },
    events: ['lock', 'slip', 'surge', 'done'],
    defaults: { durationMs: 12000, drift: 0.28, band: 0.085, surges: 0 },
};

const GAIN = 1.15;                    // how far the ring moves for a drag of the pointer
const CHASE_SPEED = 0.34;             // stage heights per second, button play
const BUTTON_CAP = 0.88;              // button play is worth a little less
const LOW = 0.18;
const HIGH = 0.82;
const SURGE_MS = 520;
const MIN_LOCK_MS = 700;              // inside this long, then out: a slip; out this long, then in: a lock

export function newRun(params = {}, rng = Math.random, ctx = {}) {
    const p = { ...meta.defaults, ...params };
    const ease = easeFactor(ctx);
    const calm = calmFactor(ctx);
    const duration = Math.max(2000, num(p.durationMs, 12000));
    const surges = clamp(Math.round(num(p.surges, 0)), 0, 5);
    const maxSpeed = Math.max(0.05, num(p.drift, 0.28)) / calm;
    const angle = rng() * Math.PI * 2;
    return {
        params: p, controls: ctx.controls === 'button' ? 'button' : 'pointer', ease, calm, duration, maxSpeed,
        band: Math.max(0.03, num(p.band, 0.085)) * ease,
        blob: { x: 0.5, y: 0.5 }, vel: { x: Math.cos(angle) * maxSpeed * 0.6, y: Math.sin(angle) * maxSpeed * 0.6 },
        ring: { x: 0.5, y: 0.72 }, lastPtr: null,
        surgeAt: Array.from({ length: surges }, (_, i) => Math.round(((i + 1) / (surges + 1)) * duration + (rng() - 0.5) * 800)), surgeLeft: 0,
        t: 0, scoreMs: 0, scored: 0, inside: false, insideMs: 0, outsideMs: 0, lastSlipAt: -1e9, over: false, events: [], ruined: false,
    };
}

const dist = (a, b) => {
    const p = toSquare([a.x, a.y]);
    const q = toSquare([b.x, b.y]);
    return Math.hypot(p[0] - q[0], p[1] - q[1]);
};

export function step(s, dtMs, input = {}, rng = Math.random) {
    s.events = [];
    if (s.over) return s;
    // The ring: moved by a relative drag, or chasing the blob while the button is held.
    if (s.controls === 'pointer') {
        const down = Boolean(input.pointer?.down);
        if (!down) s.lastPtr = null;
        for (const [, x, y] of pathOf(input)) {
            if (s.t <= GRACE_MS) { s.lastPtr = null; continue; }
            if (s.lastPtr) {
                s.ring.x = clamp(s.ring.x + (x - s.lastPtr[0]) * GAIN, 0, 1);
                s.ring.y = clamp(s.ring.y + (y - s.lastPtr[1]) * GAIN, 0, 1);
            }
            s.lastPtr = [x, y];
        }
    }
    const held = s.controls === 'button' && Boolean(input.held);
    for (const dt of stepsOf(dtMs)) {
        s.t += dt;
        const sec = dt / 1000;
        // The blob: a damped random walk that keeps moving, bounces off the edges of its area, and surges now and then.
        const surging = s.surgeLeft > 0;
        if (surging) s.surgeLeft -= dt;
        else if (s.surgeAt.length && s.t >= s.surgeAt[0]) {
            s.surgeAt.shift();
            s.surgeLeft = SURGE_MS;
            const tx = LOW + rng() * (HIGH - LOW);
            const ty = LOW + rng() * (HIGH - LOW);
            const d = Math.hypot((tx - s.blob.x) * 1.6, ty - s.blob.y) || 1;
            s.vel = { x: ((tx - s.blob.x) / d) * s.maxSpeed * 2.4 / 1.6, y: ((ty - s.blob.y) / d) * s.maxSpeed * 2.4 };
            s.events.push({ type: 'surge', at: s.t });
        }
        if (!surging) {
            s.vel.x += (rng() - 0.5) * s.maxSpeed * 6 * sec;
            s.vel.y += (rng() - 0.5) * s.maxSpeed * 6 * sec;
            s.vel.x *= 1 - 0.4 * sec;
            s.vel.y *= 1 - 0.4 * sec;
            const speed = Math.hypot(s.vel.x * 1.6, s.vel.y);
            if (speed > s.maxSpeed) { s.vel.x *= s.maxSpeed / speed; s.vel.y *= s.maxSpeed / speed; }
            else if (speed < s.maxSpeed * 0.3) { const a = rng() * Math.PI * 2; s.vel.x = Math.cos(a) * s.maxSpeed * 0.4 / 1.6; s.vel.y = Math.sin(a) * s.maxSpeed * 0.4; }
        }
        s.blob.x += s.vel.x * sec;
        s.blob.y += s.vel.y * sec;
        if (s.blob.x < LOW) { s.blob.x = LOW; s.vel.x = Math.abs(s.vel.x); }
        if (s.blob.x > HIGH) { s.blob.x = HIGH; s.vel.x = -Math.abs(s.vel.x); }
        if (s.blob.y < LOW) { s.blob.y = LOW; s.vel.y = Math.abs(s.vel.y); }
        if (s.blob.y > HIGH) { s.blob.y = HIGH; s.vel.y = -Math.abs(s.vel.y); }
        if (held && s.t > GRACE_MS) {
            const dx = (s.blob.x - s.ring.x) * 1.6;
            const dy = s.blob.y - s.ring.y;
            const d = Math.hypot(dx, dy);
            if (d > 0.001) {
                const move = Math.min(d, (CHASE_SPEED / s.calm) * sec);
                s.ring.x += (dx / d) * move / 1.6;
                s.ring.y += (dy / d) * move;
            }
        }
        if (s.t > GRACE_MS) {
            const d = dist(s.ring, s.blob);
            const isIn = d <= s.band;
            s.scoreMs += dt;
            s.scored += isIn ? dt : d <= s.band * 2 ? dt * 0.4 : 0;
            if (isIn) {
                // Back on target after a good while off it: a lock.
                if (!s.inside) { if (s.outsideMs >= MIN_LOCK_MS) s.events.push({ type: 'lock', grade: 'good', at: s.t }); s.inside = true; s.insideMs = 0; }
                s.insideMs += dt;
            } else {
                // Off target after a good while on it: a slip (at most one every second and a half).
                if (s.inside) { if (s.insideMs >= MIN_LOCK_MS && s.t - s.lastSlipAt > 1500) { s.lastSlipAt = s.t; s.events.push({ type: 'slip', grade: 'miss', at: s.t }); } s.inside = false; s.outsideMs = 0; }
                s.outsideMs += dt;
            }
        }
        if (s.t >= s.duration) break;
    }
    if (s.t >= s.duration) {
        s.over = true;
        s.events.push({ type: 'done', at: s.t });
    }
    return s;
}

export const isOver = (s) => s.over;

export function performance(s) {
    if (s.scoreMs <= 0) return 0;
    const raw = s.scored / s.scoreMs;
    const v = clamp(s.controls === 'button' ? raw * BUTTON_CAP : raw, 0, 1);
    return Number.isFinite(v) ? v : 0;
}

export function describeState(s, words = {}) {
    const w = wordsOf(words, { work: 'the tuning' });
    const pct = Math.round(performance(s) * 100);
    const now = dist(s.ring, s.blob) <= s.band ? 'locked on right now' : 'drifting off target';
    return `${w.work}: ${pct}% steady so far, ${now}${s.over ? ' (finished)' : ''}`;
}

export function view(s) {
    return {
        blob: { ...s.blob }, ring: { ...s.ring }, band: s.band, inBand: dist(s.ring, s.blob) <= s.band, surge: s.surgeLeft > 0,
        progress: clamp(s.t / s.duration, 0, 1), controls: s.controls, over: s.over, score: performance(s),
    };
}
