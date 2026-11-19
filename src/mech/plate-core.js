/**
 * Plate (fork): arrange the food on a plate. A plate seen from above with a faint ghost outline for each item. Take the items one at
 * a time and put each on its ghost spot.
 *
 *   pointer  press anywhere to pick the next item up, drag it over its spot, let go to put it down
 *   button   a marker sweeps across the plate: press to stop it across, press again to stop it down. Each item is two presses.
 *
 * Positions are in plate units: the middle of the plate is (0, 0), its rim is at distance 1.
 * Per item: 1 within a third of the tolerance of its spot, falling to 0.4 at 2 x tolerance and to 0 at 3 x. perf = the mean of the
 * items (an item not put down scores 0). No ruin. Pure: see contract.js.
 */

import { clamp, num, mean, easeFactor, calmFactor, stepsOf, pressesOf, pathOf, wordsOf, windowGrade, GRACE_MS } from './contract.js';

export const meta = {
    id: 'plate',
    input: { pointer: 'drag-drop', button: 'sweep-lock' },
    events: ['place', 'done'],
    defaults: { items: ['main', 'garnish', 'sauce'], tol: 0.3, sweepMs: 1800, timeLimitMs: 25000 },
};

/** The plate on the stage (the same dish box the sprinkle mechanic uses: 16:10 stage, so a circle 60 x 60 on a 160 x 100 view). */
export const PLATE = Object.freeze({ cx: 0.5, cy: 0.5, rx: 0.1875, ry: 0.3 });

/** Where items go by position in the list. */
export const SPOTS = Object.freeze([{ u: 0, v: 0.05 }, { u: 0.5, v: -0.4 }, { u: -0.45, v: 0.38 }, { u: 0.42, v: 0.45 }, { u: -0.5, v: -0.35 }]);

const MAX_ITEMS = 5;
const slug = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);

export const toStage = (u, v) => ({ x: PLATE.cx + u * PLATE.rx, y: PLATE.cy + v * PLATE.ry });
export const toPlate = (x, y) => ({ u: (x - PLATE.cx) / PLATE.rx, v: (y - PLATE.cy) / PLATE.ry });

export function newRun(params = {}, rng = Math.random, ctx = {}) {
    const p = { ...meta.defaults, ...params };
    const ease = easeFactor(ctx);
    const raw = (Array.isArray(p.items) ? p.items : meta.defaults.items).map(i => ({ id: slug(typeof i === 'string' ? i : i?.id), art: typeof i === 'object' && i ? slug(i.art) : '' })).filter(i => i.id).slice(0, MAX_ITEMS);
    const list = raw.length ? raw : meta.defaults.items.map(id => ({ id, art: '' }));
    return {
        params: p, controls: ctx.controls === 'button' ? 'button' : 'pointer', ease, calm: calmFactor(ctx),
        tol: Math.max(0.05, num(p.tol, 0.3)) * ease, t: 0, over: false, ended: false, events: [], ruined: false,
        items: list.map((it, i) => ({ id: it.id, art: it.art, spot: SPOTS[i % SPOTS.length], at: null, d: null, grade: null })),
        index: 0, carrying: false, pos: { u: -1.4, v: 0 }, phase: 'x', lockU: 0, sweepT: 0,
    };
}

const sweep = (t, period) => -1 + 2 * (1 - Math.abs(((t / period) % 2 + 2) % 2 - 1));

function put(s, u, v) {
    const it = s.items[s.index];
    if (!it) return;
    it.at = { u, v };
    it.d = Math.hypot(u - it.spot.u, v - it.spot.v);
    it.grade = windowGrade(it.d, s.tol);
    s.events.push({ type: 'place', grade: it.grade, item: it.id, at: s.t });
    s.index += 1;
    s.carrying = false;
    s.phase = 'x';
    s.sweepT = 0;
    if (s.index >= s.items.length) s.ended = true;
}

export function step(s, dtMs, input = {}, rng = Math.random) {
    s.events = [];
    if (s.over) return s;
    const path = pathOf(input);
    const picks = [input.pick].flat().filter(Boolean);
    if (s.controls === 'pointer' && s.t > GRACE_MS) {
        if (path.length) {
            const [, x, y] = path[path.length - 1];
            s.pos = toPlate(x, y);
            s.carrying = true;
        }
        // The item goes down where the pointer was let go.
        if (s.carrying && !input.pointer?.down && !s.over) put(s, s.pos.u, s.pos.v);
    }
    const presses = s.controls === 'button' && s.t > GRACE_MS ? pressesOf(input).length : 0;
    for (const dt of stepsOf(dtMs)) {
        if (s.ended) break;
        s.t += dt;
        if (s.controls === 'button') {
            s.sweepT += dt / s.calm;
            if (s.phase === 'x') s.pos = { u: sweep(s.sweepT, s.params.sweepMs), v: -1.1 };
            else s.pos = { u: s.lockU, v: sweep(s.sweepT, s.params.sweepMs * 1.15) };
        }
        if (s.t >= s.params.timeLimitMs) s.ended = true;
    }
    for (let i = 0; i < presses && !s.ended; i++) {
        if (s.phase === 'x') { s.lockU = s.pos.u; s.phase = 'y'; s.sweepT = 0; s.pos = { u: s.lockU, v: -1 }; } else put(s, s.lockU, s.pos.v);
    }
    if (picks.includes('done') || picks.includes('plate')) s.ended = true;
    if (s.ended && !s.over) {
        s.over = true;
        s.events.push({ type: 'done', at: s.t });
    }
    return s;
}

export const isOver = (s) => s.over;

/** One item's score: 1 within a third of the tolerance, 0.4 at twice the tolerance, 0 at three times; a missing item scores 0. */
export function itemScore(d, tol) {
    if (d === null || d === undefined) return 0;
    if (d <= tol / 3) return 1;
    if (d <= 2 * tol) return 1 - (0.6 * (d - tol / 3)) / (tol * (2 - 1 / 3));
    return clamp(0.4 * (1 - (d - 2 * tol) / tol), 0, 0.4);
}

export const performance = (s) => clamp(mean(s.items.map(i => itemScore(i.d, s.tol))), 0, 1);

export function describeState(s, words = {}) {
    const w = wordsOf(words, { dish: 'the plate' });
    const placed = s.items.filter(i => i.at);
    if (!placed.length) return `nothing is on ${w.dish} yet`;
    const off = placed.filter(i => i.grade === 'miss').map(i => i.id);
    return `${placed.length} of ${s.items.length} items are on ${w.dish}${off.length ? `, ${off.join(' and ')} slightly off its spot` : ', neatly placed'}`;
}

export function view(s) {
    return {
        controls: s.controls, over: s.over, carrying: s.carrying, phase: s.phase, lockU: s.lockU, pos: s.pos, index: s.index, plate: PLATE,
        items: s.items.map(i => ({ id: i.id, art: i.art, spot: i.spot, at: i.at, grade: i.grade })),
    };
}
