import { matchPref, normKey, isFavoriteMeal } from './likes-core.js';
import { GRADE_XP, seeded } from './activity-memory-core.js';

/**
 * Cooking, fishing and gardening (fork): the rules, without the screen. See docs/ACTIVITIES-PLAN.md section 3.
 *
 * All three are small and tap-based. Cooking and fishing share a timing idea (a marker sweeps, tap when it is in the zone), and
 * the zone gets narrower and the marker faster with the difficulty. Gardening is not timed: plots grow by visits (see tendPlot).
 * Every function that needs chance takes an injected `rng`.
 *
 * Pure: no DOM, no SillyTavern imports.
 */

export { seeded };

export const DIFFICULTIES = Object.freeze(['easy', 'normal', 'hard']);
const diff = (d) => (DIFFICULTIES.includes(d) ? d : 'normal');
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const whole = (v) => Math.max(0, Math.floor(Number(v)) || 0);

/* ------------------------------------------------------------------ the timing marker */

/** How wide the good zone is (0 to 1 of the bar), per difficulty. */
export const ZONE_WIDTH = Object.freeze({ easy: 0.34, normal: 0.24, hard: 0.15 });
/** How long the marker takes to cross the bar one way, in ms. */
export const SWEEP_MS = Object.freeze({ easy: 1900, normal: 1500, hard: 1100 });
/** The assist setting widens the zone by this much and slows the marker down. */
export const ASSIST_WIDER = 1.45;
export const ASSIST_SLOWER = 1.4;

/** The zone width for a difficulty, wider with assist. */
export function zoneWidth(difficulty, assist = false) {
    return Math.min(0.9, ZONE_WIDTH[diff(difficulty)] * (assist ? ASSIST_WIDER : 1));
}

/** How long one crossing takes, longer with assist. */
export function sweepMs(difficulty, assist = false) {
    return Math.round(SWEEP_MS[diff(difficulty)] * (assist ? ASSIST_SLOWER : 1));
}

/** The marker's place (0 to 1) `ms` after it started: it goes across and back. */
export function markerAt(ms, sweep) {
    const t = (Math.max(0, Number(ms) || 0) / Math.max(1, sweep)) % 2;
    return t <= 1 ? t : 2 - t;
}

/** A tap at `pos` against a zone centred at `center`: inside the middle third of the zone is perfect, inside the zone good, else a miss. */
export function hitQuality(pos, center, width) {
    const d = Math.abs(Number(pos) - Number(center));
    if (d <= width / 6) return 'perfect';
    if (d <= width / 2) return 'good';
    return 'miss';
}

/* ------------------------------------------------------------------ cooking */

export const COOK_STEPS = Object.freeze([
    { id: 'chop', label: 'Chop' },
    { id: 'heat', label: 'Heat' },
    { id: 'season', label: 'Season' },
]);
export const STEP_POINTS = Object.freeze({ perfect: 2, good: 1, miss: 0 });
export const FAILED_DISH = 'Burnt Mess';

/** Whether an inventory item's name satisfies a need (any of its words appears in the name). */
export function matchesNeed(need, itemName) {
    const n = String(itemName ?? '').toLowerCase();
    return (need?.any || []).some(w => n.includes(String(w).toLowerCase()));
}

/**
 * What a recipe still lacks. `pack` is the inventory as [{ name, qty }]. One item can only be counted once, so two needs never
 * share the same carrot.
 * @returns {{ label: string, qty: number, have: number }[]} empty when everything is there
 */
export function missingIngredients(recipe, pack) {
    const left = (pack || []).map(i => ({ name: i.name, qty: whole(i.qty) || 1 }));
    const out = [];
    for (const need of recipe?.needs || []) {
        let want = whole(need.qty) || 1;
        let have = 0;
        for (const item of left) {
            if (want <= 0) break;
            if (item.qty > 0 && matchesNeed(need, item.name)) {
                const take = Math.min(item.qty, want);
                item.qty -= take;
                want -= take;
                have += take;
            }
        }
        if (want > 0) out.push({ label: need.label || 'an ingredient', qty: whole(need.qty) || 1, have });
    }
    return out;
}

export const canCook = (recipe, pack) => missingIngredients(recipe, pack).length === 0;

/** The items that would be used up: [{ name, qty }], taken in the order the pack holds them. Empty when something is missing. */
export function takeIngredients(recipe, pack) {
    if (!canCook(recipe, pack)) return [];
    const left = (pack || []).map(i => ({ name: i.name, qty: whole(i.qty) || 1 }));
    const used = new Map();
    for (const need of recipe?.needs || []) {
        let want = whole(need.qty) || 1;
        for (const item of left) {
            if (want <= 0) break;
            if (item.qty > 0 && matchesNeed(need, item.name)) {
                const take = Math.min(item.qty, want);
                item.qty -= take;
                want -= take;
                used.set(item.name, (used.get(item.name) || 0) + take);
            }
        }
    }
    return [...used].map(([name, qty]) => ({ name, qty }));
}

/** Every recipe with whether it can be cooked now and what it lacks, the cookable ones first. */
export function availableRecipes(recipes, pack) {
    const rows = (recipes || []).map(recipe => ({ recipe, missing: missingIngredients(recipe, pack) }));
    return rows.map(r => ({ ...r, ok: r.missing.length === 0 })).sort((a, b) => Number(b.ok) - Number(a.ok));
}

/**
 * The recipe book: every recipe of the preset with what it needs, how often it has been cooked, whether it can be cooked now
 * (only judged when `tracked`, the Inventory is on) and whose favourite meal it is. `cards` are character cards (their `prefs`).
 * @returns {{ id: string, name: string, desc: string, needs: string[], made: number, known: boolean, ok: boolean, missing: string[], favoriteOf: string[] }[]}
 */
export function recipeBook(recipes, { made = {}, pack = [], tracked = false, cards = [] } = {}) {
    return (recipes || []).map(recipe => {
        const missing = tracked ? missingIngredients(recipe, pack).map(m => m.label) : [];
        const count = whole(made?.[recipe.id], 0);
        return {
            id: recipe.id, name: recipe.name, desc: recipe.desc || '',
            needs: (recipe.needs || []).map(n => n.label),
            made: count, known: count > 0,
            ok: missing.length === 0, missing,
            favoriteOf: (cards || []).filter(c => c?.name && isFavoriteMeal(c.prefs, recipe.name)).map(c => c.name),
        };
    });
}

/** A new dish: three steps, each with a zone somewhere along the bar. */
export function newCook({ recipe, difficulty = 'normal', rng = Math.random } = {}) {
    return {
        recipe, difficulty: diff(difficulty),
        steps: COOK_STEPS.map(s => ({ ...s, center: 0.22 + rng() * 0.56, quality: null })),
        index: 0, over: false,
    };
}

/** A tap on the current step. Returns the quality, or null when the dish is already done. */
export function tapStep(state, pos, assist = false) {
    if (state.over) return null;
    const step = state.steps[state.index];
    step.quality = hitQuality(pos, step.center, zoneWidth(state.difficulty, assist));
    state.index += 1;
    if (state.index >= state.steps.length) state.over = true;
    return step.quality;
}

/** Points so far: 2 for a perfect step, 1 for a good one. */
export const cookPoints = (state) => state.steps.reduce((n, s) => n + (STEP_POINTS[s.quality] || 0), 0);

/** perfect (5 or 6 points), good (3 or 4), fair (2), poor (1), failed (0: burnt). */
export function cookGrade(state) {
    const p = cookPoints(state);
    return p >= 5 ? 'perfect' : p >= 3 ? 'good' : p >= 2 ? 'fair' : p >= 1 ? 'poor' : 'failed';
}

const DISH_NOTE = Object.freeze({ perfect: 'perfectly cooked', good: 'well cooked', fair: 'plain but fine', poor: 'a little overcooked', failed: 'burnt beyond saving' });

/**
 * What the dish is worth. A perfect dish is a double portion. A good or perfect dish served to a partner nudges a bond a little, and
 * more when it is a food they like. Played alone there is no partner to serve (pass `partner: false`).
 * @returns {{ grade: string, levelXp: number, item: object, consume: object[], bonds: object[], liked: boolean }}
 */
export function cookRewards(state, { prefs, partner = true, pack = [] } = {}) {
    const grade = cookGrade(state);
    const failed = grade === 'failed';
    const mult = failed ? GRADE_XP.poor : GRADE_XP[grade];
    const favorite = Boolean(partner) && !failed && isFavoriteMeal(prefs, state.recipe?.name);
    const liked = Boolean(partner) && !failed && (favorite || matchPref(prefs, 'food', state.recipe?.name) === 'like');
    const bonds = [];
    if (partner && (grade === 'perfect' || grade === 'good')) bonds.push({ meter: 'trust', amount: grade === 'perfect' ? 1 : 0.5 });
    if (liked && (grade === 'perfect' || grade === 'good')) bonds.push({ meter: 'affection', amount: (grade === 'perfect' ? 2 : 1) * (favorite ? 2 : 1) });
    return {
        grade, liked, favorite, bonds,
        levelXp: Math.round(8 * mult),
        item: failed
            ? { name: FAILED_DISH, qty: 1, kind: 'food', note: DISH_NOTE.failed }
            : { name: text(state.recipe?.name, 60) || 'Meal', qty: grade === 'perfect' ? 2 : 1, kind: 'food', note: DISH_NOTE[grade] },
        // The ingredients are used up whatever happens: a burnt dish still cost them.
        consume: takeIngredients(state.recipe, pack),
    };
}

/* ------------------------------------------------------------------ fishing */

export const BITE_WINDOW_MS = 1400;
export const REEL_TIMEOUT_MS = 22000;

/** One fish from a table by weight. */
export function pickFish(table, rng = Math.random) {
    const list = (table || []).filter(f => Number(f.weight) > 0);
    if (!list.length) return null;
    const total = list.reduce((n, f) => n + f.weight, 0);
    let roll = rng() * total;
    for (const f of list) { roll -= f.weight; if (roll < 0) return f; }
    return list[list.length - 1];
}

/** How long the wait for a bite is, 2 to 6 seconds. */
export const biteDelayMs = (rng = Math.random) => 2000 + Math.floor(rng() * 4000);

/**
 * A new cast. Phases: 'wait' (the line is out), 'bite' (tap now to hook it), 'reel' (keep the cursor on the fish), 'done'.
 * The bite window gives the player BITE_WINDOW_MS to hook it.
 */
export function newCast({ fish, difficulty = 'normal', rng = Math.random } = {}) {
    return { fish, difficulty: diff(difficulty), phase: 'wait', waited: 0, delay: biteDelayMs(rng), windowLeft: BITE_WINDOW_MS, reel: null, result: null };
}

/** Time passes while waiting. Returns 'bite' when the fish takes, 'escaped' when the bite window runs out, else ''. */
export function advanceWait(cast, dtMs) {
    if (cast.phase === 'wait') {
        cast.waited += dtMs;
        if (cast.waited >= cast.delay) { cast.phase = 'bite'; cast.windowLeft = BITE_WINDOW_MS; return 'bite'; }
    } else if (cast.phase === 'bite') {
        cast.windowLeft -= dtMs;
        if (cast.windowLeft <= 0) { cast.phase = 'done'; cast.result = { caught: false, why: 'escaped', fish: cast.fish, quality: 0 }; return 'escaped'; }
    }
    return '';
}

/** How wide the band is for a fish (the harder the fish, the narrower) and a difficulty. */
export function reelBand(fishDifficulty, difficulty) {
    const base = [0.32, 0.25, 0.19][clamp(whole(fishDifficulty) || 1, 1, 3) - 1];
    return clamp(base + { easy: 0.06, normal: 0, hard: -0.04 }[diff(difficulty)], 0.1, 0.5);
}

/** The tap during the wait: too early scares the fish; in the bite window it hooks it and the reel begins. Returns what happened. */
export function tapCast(cast, rng = Math.random) {
    if (cast.phase === 'wait') {
        cast.phase = 'done';
        cast.result = { caught: false, why: 'scared', fish: cast.fish, quality: 0 };
        return 'scared';
    }
    if (cast.phase === 'bite') {
        cast.phase = 'reel';
        cast.reel = { fish: 0.5, target: rng(), retarget: 700, cursor: 0.5, vel: 0, progress: 0.35, inBandMs: 0, totalMs: 0, band: reelBand(cast.fish?.difficulty, cast.difficulty) };
        return 'hooked';
    }
    return '';
}

/**
 * One step of the reel. Holding lifts the cursor, letting go drops it; the fish drifts about; progress grows while the cursor is
 * on the fish and shrinks while it is not. Caught at 1, lost at 0 or when time runs out.
 * @param {object} cast
 * @param {number} dtMs
 * @param {boolean} holding
 * @param {() => number} [rng]
 * @param {boolean} [assist] a wider band
 * @returns {'caught'|'lost'|''}
 */
export function stepReel(cast, dtMs, holding, rng = Math.random, assist = false) {
    if (cast.phase !== 'reel' || !cast.reel) return '';
    const r = cast.reel;
    const dt = Math.max(0, dtMs) / 1000;
    const fd = clamp(whole(cast.fish?.difficulty) || 1, 1, 3);
    r.retarget -= dtMs;
    if (r.retarget <= 0) { r.target = rng(); r.retarget = 600 + rng() * 900; }
    const speed = 0.3 + 0.18 * fd;
    r.fish += clamp(r.target - r.fish, -speed * dt, speed * dt);
    r.vel = clamp(r.vel + (holding ? 2.4 : -1.9) * dt, -0.9, 0.9);
    r.cursor += r.vel * dt;
    if (r.cursor < 0) { r.cursor = 0; r.vel = 0; }
    if (r.cursor > 1) { r.cursor = 1; r.vel = 0; }
    const band = Math.min(0.7, r.band * (assist ? ASSIST_WIDER : 1));
    const inBand = Math.abs(r.cursor - r.fish) <= band / 2;
    r.progress += (inBand ? 0.30 : -0.17 - 0.03 * fd) * dt;
    r.totalMs += dtMs;
    if (inBand) r.inBandMs += dtMs;
    const quality = r.totalMs > 0 ? r.inBandMs / r.totalMs : 0;
    if (r.progress >= 1) {
        cast.phase = 'done';
        cast.result = { caught: true, why: '', fish: cast.fish, quality };
        return 'caught';
    }
    if (r.progress <= 0 || r.totalMs >= REEL_TIMEOUT_MS) {
        cast.phase = 'done';
        cast.result = { caught: false, why: 'lost', fish: cast.fish, quality };
        return 'lost';
    }
    return '';
}

/** A caught fish's size word by how well it was reeled in. */
export const sizeWord = (quality) => (quality >= 0.75 ? 'a fine one' : quality >= 0.55 ? 'a good size' : 'a small one');

/** The fish a cast gave, as an inventory item, or null when it got away. */
export function catchItem(result) {
    if (!result?.caught || !result.fish) return null;
    return { name: text(result.fish.name, 60), qty: 1, kind: 'food', note: sizeWord(result.quality) };
}

/**
 * The session grade from its casts: every fish landed with good reeling is perfect, at least two thirds landed is good, any is
 * fair, none is poor.
 * @param {{ caught: boolean, quality: number }[]} results
 */
export function fishGrade(results) {
    const list = results || [];
    if (!list.length) return 'poor';
    const caught = list.filter(r => r.caught);
    if (!caught.length) return 'poor';
    const avg = caught.reduce((n, r) => n + r.quality, 0) / caught.length;
    if (caught.length === list.length && avg >= 0.7) return 'perfect';
    return caught.length * 3 >= list.length * 2 ? 'good' : 'fair';
}

/** What a fishing session is worth. Items are the fish caught. */
export function fishRewards(results, { partner = true } = {}) {
    const grade = fishGrade(results);
    const items = (results || []).map(catchItem).filter(Boolean);
    return {
        grade, items,
        levelXp: Math.round(8 * GRADE_XP[grade]),
        bonds: partner && (grade === 'perfect' || grade === 'good') ? [{ meter: 'trust', amount: grade === 'perfect' ? 1 : 0.5 }] : [],
    };
}

/* ---- the contest: you and your partner fish, the heavier catch wins ---- */

/** Weight of a catch: its size scaled by how well it was landed (0.6 to 1.4 times). */
export const catchWeight = (fish, quality) => Math.round((Number(fish?.size) || 1) * (0.6 + 0.8 * clamp(quality, 0, 1)) * 10) / 10;

/**
 * The partner's casts, played by chance: the harder the fish, the likelier it is lost. `skill` is 0 to 1 (0.5 is an average angler).
 * @returns {{ caught: boolean, fish: object, quality: number }[]}
 */
export function rivalCasts(table, count, rng = Math.random, skill = 0.5) {
    const out = [];
    for (let i = 0; i < count; i++) {
        const fish = pickFish(table, rng);
        if (!fish) continue;
        const p = clamp(0.8 - 0.17 * (fish.difficulty - 1) + (skill - 0.5) * 0.4, 0.15, 0.95);
        const caught = rng() < p;
        out.push({ caught, fish, quality: caught ? clamp(0.45 + rng() * 0.5, 0, 1) : 0 });
    }
    return out;
}

/** The total weight of a side's catches. */
export const totalWeight = (results) => Math.round((results || []).filter(r => r.caught).reduce((n, r) => n + catchWeight(r.fish, r.quality), 0) * 10) / 10;

/** Who won: 'A' (the player), 'B' (the partner) or 'draw'. */
export function contestWinner(mine, theirs) {
    const a = totalWeight(mine);
    const b = totalWeight(theirs);
    return { winner: a > b ? 'A' : b > a ? 'B' : 'draw', mine: a, theirs: b };
}

/* ------------------------------------------------------------------ gardening */

export const MAX_PLOTS = 6;
export const MAX_TENDED = 30;

/**
 * The garden, repaired: { plots: [{ id, seed, produce, kind, needs, yield, planted, tended: [dayKey], care }], next }.
 * A plot grows by being tended on different days: it is ready once it has been tended on `needs` of them (1 to 3).
 */
export function normalizeGarden(raw) {
    const r = obj(raw);
    const plots = [];
    for (const p of Array.isArray(r.plots) ? r.plots : []) {
        if (plots.length >= MAX_PLOTS) break;
        const q = obj(p);
        const seed = text(q.seed, 60);
        const produce = text(q.produce, 60);
        if (!seed || !produce) continue;
        const planted = text(q.planted, 90);
        const all = [...new Set((Array.isArray(q.tended) ? q.tended : []).map(d => text(d, 90)).filter(Boolean))];
        const tended = all.filter(d => d !== planted).slice(0, MAX_TENDED);
        const wateredFirst = q.wateredFirst === true || (planted !== '' && all.includes(planted));
        plots.push({
            id: text(q.id, 20) || `p${plots.length + 1}`, seed, produce,
            kind: text(q.kind, 24) || 'food',
            needs: clamp(whole(q.needs) || 1, 1, 3), yield: clamp(whole(q.yield) || 1, 1, 5),
            planted, tended, wateredFirst, care: clamp(Number(q.care) || 0, 0, 999),
        });
    }
    const used = new Set(plots.map(p => p.id));
    let next = whole(r.next) || 1;
    while (used.has(`p${next}`)) next += 1;
    return { plots, next };
}

/** A plot is ready after `needs` tending days, and never on the day it was planted (those days are counted after it). */
export const isReady = (plot) => plot.tended.length >= plot.needs;

/** What the screen shows for a plot on `day`: ready, how many tending days are left, and whether it was tended today. */
export function plotState(plot, day) {
    const plantedToday = plot.planted !== '' && plot.planted === day;
    return {
        ready: isReady(plot), left: Math.max(0, plot.needs - plot.tended.length), plantedToday,
        tendedToday: plot.tended.includes(day) || (plantedToday && Boolean(plot.wateredFirst)),
    };
}

/** Plants a seed in a new plot. A full garden refuses. */
export function plantSeed(garden, seed, day) {
    const g = normalizeGarden(garden);
    if (g.plots.length >= MAX_PLOTS) return { garden: g, ok: false, reason: `The garden has room for ${MAX_PLOTS} plots.` };
    const name = text(seed?.name, 60);
    const produce = text(seed?.produce, 60);
    if (!name || !produce) return { garden: g, ok: false, reason: 'That is not a seed.' };
    const plot = {
        id: `p${g.next}`, seed: name, produce, kind: text(seed.kind, 24) || 'food',
        needs: clamp(whole(seed.needs) || 1, 1, 3), yield: clamp(whole(seed.yield) || 1, 1, 5), planted: text(day, 90), tended: [], wateredFirst: false, care: 0,
    };
    g.plots.push(plot);
    g.next += 1;
    return { garden: g, ok: true, plot };
}

/**
 * Tends a plot (waters it). It counts toward growth once per day: a second visit the same day does nothing more. `quality` is
 * the watering tap ('perfect', 'good' or 'miss') and adds to the plot's care.
 * @returns {{ garden: object, ok: boolean, counted: boolean, ready: boolean, reason?: string }}
 */
export function tendPlot(garden, plotId, day, quality = 'good') {
    const g = normalizeGarden(garden);
    const plot = g.plots.find(p => p.id === plotId);
    if (!plot) return { garden: g, ok: false, counted: false, ready: false, reason: 'No such plot.' };
    if (isReady(plot)) return { garden: g, ok: false, counted: false, ready: true, reason: 'It is ready to harvest.' };
    const dayKey = text(day, 90);
    // The planting day: watering it is care, but growth only starts the next day, so nothing can be planted and harvested at once.
    if (plot.planted !== '' && plot.planted === dayKey) {
        if (plot.wateredFirst) return { garden: g, ok: true, counted: false, ready: false, reason: 'Already watered today.' };
        plot.wateredFirst = true;
        plot.care += STEP_POINTS[quality] ?? 1;
        return { garden: g, ok: true, counted: true, grew: false, ready: false };
    }
    if (plot.tended.includes(dayKey)) return { garden: g, ok: true, counted: false, ready: false, reason: 'Already tended today.' };
    plot.tended.push(dayKey);
    plot.care += STEP_POINTS[quality] ?? 1;
    return { garden: g, ok: true, counted: true, grew: true, ready: isReady(plot) };
}

/** Takes the harvest: the produce, more when the plot was well cared for, and the plot is cleared. */
export function harvestPlot(garden, plotId) {
    const g = normalizeGarden(garden);
    const at = g.plots.findIndex(p => p.id === plotId);
    if (at < 0) return { garden: g, ok: false, reason: 'No such plot.' };
    const plot = g.plots[at];
    if (!isReady(plot)) return { garden: g, ok: false, reason: 'It is not ready yet.' };
    // Care is 0 to 2 per visit; an average of 1.5 or more is a careful grower.
    const avg = plot.care / Math.max(1, plot.tended.length + (plot.wateredFirst ? 1 : 0));
    const qty = plot.yield + (avg >= 1.5 ? 1 : 0);
    g.plots.splice(at, 1);
    return {
        garden: g, ok: true, qty,
        item: { name: plot.produce, qty, kind: plot.kind, note: avg >= 1.5 ? 'carefully grown' : 'home grown' },
    };
}

/** Gardening session grade: by how many plots were tended or harvested this visit and how well. */
export function gardenGrade(acts) {
    const list = acts || [];
    if (!list.length) return 'poor';
    const pts = list.reduce((n, a) => n + (STEP_POINTS[a.quality] ?? 1), 0);
    const avg = pts / list.length;
    return avg >= 1.7 ? 'perfect' : avg >= 1.2 ? 'good' : avg >= 0.5 ? 'fair' : 'poor';
}

/** What a garden visit is worth: a little XP by how it went. The harvest itself is the reward items. */
export function gardenRewards(acts, items = [], { partner = true } = {}) {
    const grade = gardenGrade(acts);
    return {
        grade, items,
        levelXp: Math.round(6 * GRADE_XP[grade]),
        bonds: partner && (grade === 'perfect' || grade === 'good') ? [{ meter: 'trust', amount: 0.5 }] : [],
    };
}

/** How the soon-to-be-ready plots read: "ready", "needs 2 more days", "tended today". */
export function plotText(plot, day) {
    const s = plotState(plot, day);
    if (s.ready) return 'ready to harvest';
    if (s.plantedToday) return `planted today, ${s.left} more day${s.left === 1 ? '' : 's'} of tending from tomorrow${s.tendedToday ? ' (watered today)' : ''}`;
    return `${s.left} more day${s.left === 1 ? '' : 's'} of tending${s.tendedToday ? ' (tended today)' : ''}`;
}

/** Whether two names mean the same item (used to find a seed in the pack). */
export const sameItem = (a, b) => normKey(a) === normKey(b);
