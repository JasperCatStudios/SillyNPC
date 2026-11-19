/**
 * Sprinkle (fork): season evenly. A dish from above, divided into a grid. Move the shaker over it and shake: grains fall in a soft
 * blob around the shaker and the dish tints where it is seasoned. Cover the whole dish evenly; over-seasoned cells turn a warning tint.
 *
 *   pointer  the shaker follows the pointer; each back-and-forth shake (a reversal of sideways motion) drops seasoning
 *   button   the shaker sweeps the dish by itself in a zig-zag; a tap drops a pinch, holding drops a stream
 *
 * perf = share of cells in the good band - 0.5 x share of cells above `over` (clamped). No ruin. Pure: see contract.js.
 */

import { clamp, num, easeFactor, calmFactor, stepsOf, pressesOf, pathOf, wordsOf, GRACE_MS } from './contract.js';

export const meta = {
    id: 'sprinkle',
    input: { pointer: 'oscillate', button: 'sweep+tap' },
    events: ['shake', 'clump', 'even', 'done'],
    defaults: { grid: 5, band: [2, 4], over: 6, perShake: 1.5, clumpChance: 0, timeLimitMs: 12000, heatmap: false },
};

/** The dish: its box on the stage (the stage is 16:10, so the dish is a circle about 0.6 tall and 0.375 wide in x units). */
export const DISH = Object.freeze({ x0: 0.3125, x1: 0.6875, y0: 0.2, y1: 0.8 });

const BLOB = 1.2;
const SHAKE_TRAVEL = 0.04;
const STREAM_PER_SEC = 5;

export function newRun(params = {}, rng = Math.random, ctx = {}) {
    const p = { ...meta.defaults, ...params };
    const g = clamp(Math.round(num(p.grid, 5)), 3, 7);
    const ease = easeFactor(ctx);
    const [lo, hi] = Array.isArray(p.band) ? p.band.map(Number) : meta.defaults.band;
    const mid = (lo + hi) / 2;
    const half = ((hi - lo) / 2) * ease;
    const cells = [];
    for (let j = 0; j < g; j++) for (let i = 0; i < g; i++) {
        const nx = (i + 0.5) / g * 2 - 1;
        const ny = (j + 0.5) / g * 2 - 1;
        cells.push({ i, j, in: nx * nx + ny * ny <= 1.1, amount: 0 });
    }
    return {
        params: p, controls: ctx.controls === 'button' ? 'button' : 'pointer', ease, calm: calmFactor(ctx), grid: g,
        band: [Math.max(0, mid - half), mid + half], overAt: p.over, t: 0, over: false, ended: false, events: [], cells,
        pos: { x: 0.5, y: 0.5 }, lastX: null, dirX: 0, travel: 0, shakes: 0, clumps: 0, heatmap: Boolean(p.heatmap || ctx.assist),
    };
}

/** Which cell (fractional grid coordinates) a stage point is over. */
export function gridPoint(s, x, y) {
    return { gx: ((x - DISH.x0) / (DISH.x1 - DISH.x0)) * s.grid - 0.5, gy: ((y - DISH.y0) / (DISH.y1 - DISH.y0)) * s.grid - 0.5 };
}

/** Drops `amount` of seasoning in a soft blob at a stage point. */
export function drop(s, x, y, amount) {
    const { gx, gy } = gridPoint(s, x, y);
    const near = s.cells.filter(c => c.in).map(c => ({ c, w: Math.max(0, 1 - Math.hypot(c.i - gx, c.j - gy) / BLOB) })).filter(r => r.w > 0);
    const total = near.reduce((n, r) => n + r.w, 0);
    if (!total) return 0;
    for (const { c, w } of near) c.amount += (amount * w) / total;
    return amount;
}

const shakeOf = (s, x) => {
    // Counts a reversal of sideways motion after at least SHAKE_TRAVEL of travel.
    if (s.lastX === null) { s.lastX = x; return false; }
    const dx = x - s.lastX;
    s.lastX = x;
    if (dx === 0) return false;
    const dir = Math.sign(dx);
    if (s.dirX === 0 || dir === s.dirX) { s.dirX = dir; s.travel += Math.abs(dx); return false; }
    const enough = s.travel >= SHAKE_TRAVEL;
    s.dirX = dir;
    s.travel = Math.abs(dx);
    return enough;
};

function dropShake(s, rng, x, y) {
    const clump = s.params.clumpChance > 0 && rng() < s.params.clumpChance;
    if (clump) { drop(s, x, y, 3); s.clumps += 1; s.events.push({ type: 'clump', at: s.t }); } else drop(s, x, y, s.params.perShake);
    s.shakes += 1;
    s.events.push({ type: 'shake', at: s.t });
}

export function step(s, dtMs, input = {}, rng = Math.random) {
    s.events = [];
    if (s.over) return s;
    const presses = pressesOf(input);
    const path = pathOf(input);
    const picks = [input.pick].flat().filter(Boolean);
    if (s.controls === 'pointer') {
        if (s.t > GRACE_MS) for (const [, x, y] of path) { s.pos = { x, y }; if (shakeOf(s, x)) dropShake(s, rng, x, y); }
        else if (path.length) s.pos = { x: path[path.length - 1][1], y: path[path.length - 1][2] };
    }
    for (const dt of stepsOf(dtMs)) {
        s.t += dt;
        const sec = dt / 1000;
        if (s.controls === 'button') {
            // The shaker sweeps the dish in a zig-zag by itself.
            const speed = 0.5 / s.calm;
            const w = DISH.x1 - DISH.x0;
            const along = (s.t / 1000) * speed / w;
            const tri = Math.abs(((along % 2) + 2) % 2 - 1);
            s.pos = { x: DISH.x0 + w * tri, y: DISH.y0 + (DISH.y1 - DISH.y0) * (((s.t / 1000) / 10) % 1) };
            if (input.held && s.t > GRACE_MS) drop(s, s.pos.x, s.pos.y, STREAM_PER_SEC * sec);
        }
        if (s.t >= s.params.timeLimitMs) s.ended = true;
    }
    if (s.controls === 'button' && s.t > GRACE_MS) for (let i = 0; i < presses.length; i++) dropShake(s, rng, s.pos.x, s.pos.y);
    if (picks.includes('done') || picks.includes('plate')) s.ended = true;
    if (s.ended && !s.over) {
        s.over = true;
        s.events.push({ type: 'done', at: s.t });
        if (share(s).good >= 0.9) s.events.push({ type: 'even', at: s.t });
    }
    return s;
}

/** The share of the dish's cells in the good band, and above the limit. */
export function share(s) {
    const cells = s.cells.filter(c => c.in);
    if (!cells.length) return { good: 0, over: 0, bare: 1 };
    return {
        good: cells.filter(c => c.amount >= s.band[0] && c.amount <= s.band[1]).length / cells.length,
        over: cells.filter(c => c.amount > s.overAt).length / cells.length,
        bare: cells.filter(c => c.amount < s.band[0]).length / cells.length,
    };
}

export const isOver = (s) => s.over;

export function performance(s) {
    const r = share(s);
    return clamp(r.good - 0.5 * r.over, 0, 1);
}

export function describeState(s, words = {}) {
    const w = wordsOf(words, { dish: 'the dish' });
    const r = share(s);
    const bits = [`${Math.round(r.good * 100)}% of ${w.dish} is evenly seasoned`];
    if (r.over > 0.1) bits.push('some spots are too salty');
    if (r.bare > 0.3 && !s.over) bits.push('bare patches remain');
    return bits.join(', ');
}

export function view(s) {
    return {
        shaker: s.pos, controls: s.controls, over: s.over, heatmap: s.heatmap, grid: s.grid, band: s.band, overAt: s.overAt, dish: DISH,
        cells: s.cells.map(c => ({ i: c.i, j: c.j, in: c.in, amount: c.amount, state: c.amount > s.overAt ? 'over' : c.amount >= s.band[0] ? 'good' : c.amount > 0 ? 'some' : 'bare' })),
    };
}
