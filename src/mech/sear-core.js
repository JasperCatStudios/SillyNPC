/**
 * Sear (fork): grill or fry with heat control and flip timing. A fillet cooks on the side facing the pan; its colour (and the smoke)
 * tells how done it is. When the underside is golden, flip it: it arcs through the air and you catch it in the pan, then cook the
 * second side and plate it.
 *
 *   pointer  a heat knob you drag; a flick up on the fillet flips it; a tap where it lands catches it
 *   button   hold the action key to raise the heat (let go to let it fall); a double tap flips; one tap on landing catches
 *
 * Doneness per side d (0..1) rises at rate x (0.3 + 1.4 x heat) per second. Golden is inside `window`; above `burnAt` it is burnt.
 * perf = 0.75 x mean(side fit) + 0.25 x mean(flip score); a burnt fillet is capped at 0.2; every fillet burnt is a ruin.
 * Pure: see contract.js.
 */

import { clamp, num, mean, easeFactor, calmFactor, windowGrade, stepsOf, pressesOf, wordsOf, GRACE_MS } from './contract.js';

export const meta = {
    id: 'sear',
    input: { pointer: 'knob+flick', button: 'hold+double-tap' },
    events: ['golden', 'smoke', 'burnt', 'flip', 'land', 'ruin', 'done'],
    defaults: { items: 1, sides: 2, rate: 0.09, window: [0.62, 0.82], burnAt: 0.95, heatStart: 0.5, flipArcMs: 700, catchMs: 150, timeLimitMs: 45000 },
};

const FLIP_SCORE = Object.freeze({ perfect: 1, good: 0.7, miss: 0.4 });
const DOUBLE_TAP_MS = 350;

export function newRun(params = {}, rng = Math.random, ctx = {}) {
    const p = { ...meta.defaults, ...params };
    const ease = easeFactor(ctx);
    const items = clamp(Math.round(num(p.items, 1)), 1, 2);
    const [lo, hi] = Array.isArray(p.window) ? p.window.map(Number) : meta.defaults.window;
    const mid = (lo + hi) / 2;
    const half = ((hi - lo) / 2) * clamp(ease, 0.7, 1.5);
    return {
        params: p, controls: ctx.controls === 'button' ? 'button' : 'pointer', ease, calm: calmFactor(ctx),
        window: [mid - half, Math.min(p.burnAt - 0.02, mid + half)], catchMs: p.catchMs * ease,
        t: 0, over: false, ruined: false, ended: false, events: [], heat: clamp(num(p.heatStart, 0.5), 0, 1),
        fillets: Array.from({ length: items }, (_, i) => ({ id: i, d: Array(p.sides).fill(i === 1 ? 0.25 : 0), side: 0, burnt: Array(p.sides).fill(false), golden: Array(p.sides).fill(false), flight: null, flips: [], smoke: 0 })),
        pending: [], lastPress: -9999, selected: 0,
    };
}

/** How good a side's doneness is: 1 inside the golden window, falling to 0 below it and again towards burnt. */
export function sideFit(s, d) {
    const [lo, hi] = s.window;
    if (d >= s.params.burnAt) return 0;
    if (d >= lo && d <= hi) return 1;
    if (d < lo) return clamp(1 - (lo - d) / 0.3, 0, 1);
    return clamp(1 - (d - hi) / Math.max(0.01, s.params.burnAt - hi), 0, 1);
}

function startFlip(s, f) {
    if (f.flight) return;
    if (f.flips.length >= s.params.sides - 1) return;           // a fillet is flipped once for each side after the first
    f.flight = { start: s.t, end: s.t + s.params.flipArcMs, caught: null };
    s.events.push({ type: 'flip', at: s.t, item: f.id });
}

function land(s, f) {
    const fl = f.flight;
    const grade = fl.caught || 'miss';
    f.flips.push(FLIP_SCORE[grade]);
    f.side = Math.min(s.params.sides - 1, f.side + 1);
    f.flight = null;
    s.events.push({ type: 'land', grade, at: s.t, item: f.id });
}

export function step(s, dtMs, input = {}, rng = Math.random) {
    s.events = [];
    if (s.over) return s;
    const presses = pressesOf(input);
    const picks = [input.pick].flat().filter(Boolean);
    const [f0] = s.fillets;
    // The player's taps and picks are judged before the clock moves on, so a tap on the landing is not lost to the landing itself.
    if (s.t > GRACE_MS) {
        for (const pick of picks) {
            if (pick === 'plate' || pick === 'done') s.ended = true;
            else if (/^flip(:\d)?$/.test(pick)) { const f = s.fillets[Number(pick.split(':')[1] || 0)] || f0; if (f && !f.flight) startFlip(s, f); }
            else if (/^select:\d$/.test(pick)) s.selected = clamp(Number(pick.split(':')[1]), 0, s.fillets.length - 1);
        }
        for (const at of presses) {
            const flying = s.fillets.find(f => f.flight);
            if (flying) {
                // A tap near the landing catches it.
                const off = Math.abs(at - flying.flight.end);
                const grade = windowGrade(off, s.catchMs);
                if (grade !== 'miss' && !flying.flight.caught) flying.flight.caught = grade;
                continue;
            }
            // Button mode: two taps close together flip the selected fillet.
            if (s.controls === 'button') {
                if (at - s.lastPress <= DOUBLE_TAP_MS) { startFlip(s, s.fillets[s.selected]); s.lastPress = -9999; } else s.lastPress = at;
            }
        }
    }
    for (const dt of stepsOf(dtMs)) {
        s.t += dt;
        const sec = dt / 1000;
        // The heat: a knob sets it directly, or the key raises and releases it.
        if (s.controls === 'pointer' && Number.isFinite(Number(input.knob))) s.heat += clamp(Number(input.knob) - s.heat, -1.6 * sec, 1.6 * sec);
        else if (s.controls === 'button') s.heat += (input.held ? 0.55 : -0.4) * sec;
        s.heat = clamp(s.heat, 0, 1);
        for (const f of s.fillets) {
            if (f.flight && s.t >= f.flight.end) land(s, f);
            if (f.flight) continue;
            const side = f.side;
            f.d[side] = clamp(f.d[side] + (s.params.rate / s.calm) * (0.3 + 1.4 * s.heat) * sec, 0, 1.2);
            const d = f.d[side];
            if (!f.golden[side] && d >= s.window[0]) { f.golden[side] = true; s.events.push({ type: 'golden', at: s.t, item: f.id }); }
            f.smoke = clamp((d - s.window[1]) / Math.max(0.01, s.params.burnAt - s.window[1]), 0, 1);
            if (d > s.params.burnAt - 0.08 && !f.burnWarn?.[side]) { f.burnWarn = f.burnWarn || []; f.burnWarn[side] = true; s.events.push({ type: 'smoke', at: s.t, item: f.id }); }
            if (d >= s.params.burnAt && !f.burnt[side]) { f.burnt[side] = true; s.events.push({ type: 'burnt', at: s.t, item: f.id }); }
        }
        if (s.t >= s.params.timeLimitMs) { s.ended = true; break; }
    }
    if (s.fillets.every(f => f.burnt.some(Boolean))) { s.ruined = true; s.ended = true; s.events.push({ type: 'ruin', at: s.t }); }
    if (s.ended && !s.over) { s.over = true; s.events.push({ type: 'done', at: s.t }); }
    return s;
}

export const isOver = (s) => s.over;

export function performance(s) {
    const per = s.fillets.map(f => {
        const fits = f.d.map(d => sideFit(s, d));
        const flips = f.flips.length ? mean(f.flips) : 0;
        const value = 0.75 * mean(fits) + 0.25 * flips;
        return f.burnt.some(Boolean) ? Math.min(value, 0.2) : value;
    });
    const out = clamp(mean(per), 0, 1);
    return s.ruined ? Math.min(out, 0.2) : out;
}

/** The word for how cooked a side looks. */
export const doneWord = (s, d) => (d < s.window[0] - 0.15 ? 'pale' : d < s.window[0] ? 'almost golden' : d <= s.window[1] ? 'golden' : d < s.params.burnAt ? 'dark' : 'burnt');

export function describeState(s, words = {}) {
    const w = wordsOf(words, { item: 'the food' });
    if (s.ruined) return `${w.item} burnt to a crisp`;
    const f = s.fillets[0];
    const bits = [`${w.item}: side ${f.side + 1} is ${doneWord(s, f.d[f.side])}`];
    if (f.flips.length) bits.push(`flipped ${f.flips.length} time${f.flips.length === 1 ? '' : 's'}`);
    return bits.join(', ');
}

export function view(s) {
    return {
        heat: s.heat, window: s.window, controls: s.controls, over: s.over,
        fillets: s.fillets.map(f => ({ id: f.id, side: f.side, d: f.d.slice(), word: doneWord(s, f.d[f.side]), smoke: f.smoke, flight: f.flight ? { progress: clamp((s.t - f.flight.start) / s.params.flipArcMs, 0, 1) } : null, burnt: f.burnt.slice() })),
    };
}
