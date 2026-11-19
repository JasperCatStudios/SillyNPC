/**
 * Recipe scripts (fork): a recipe is DATA, an ordered list of steps, each naming a mechanic with its parameters and words. Nothing here
 * names a world or a dish except the neutral built-in scripts below, which a preset can replace or extend.
 *
 * A step: { id, mech, weight, params, uses, words: { title, hint, done }, art, sounds, onRuin: 'cap' | 'fail', optional, partner }.
 * A script: { set, steps: [...] }. `set` picks the prop family ('kitchen', 'alchemy', 'forge', ...); the plain-shape views draw any set.
 *
 * Pure: no DOM, no SillyTavern imports.
 */

import { mechanicOf } from './registry.js';

export const MAX_STEPS = 8;

const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const slug = (v, max = 24) => text(v, max).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
const num = (v, d) => (Number.isFinite(Number(v)) && String(v ?? '').trim() !== '' ? Number(v) : d);

/**
 * A script repaired: unknown mechanics are dropped (and reported), ids are made unique, weights and words are cleaned.
 * @returns {{ script: { set: string, steps: object[] } | null, warnings: string[] }}
 */
export function normalizeScript(raw) {
    const r = obj(raw);
    const warnings = [];
    const steps = [];
    const seen = new Set();
    for (const item of Array.isArray(r.steps) ? r.steps : []) {
        const q = obj(item);
        const mech = slug(q.mech);
        if (!mechanicOf(mech)) { warnings.push(`unknown mechanic "${text(q.mech, 20)}"`); continue; }
        if (steps.length >= MAX_STEPS) { warnings.push(`more than ${MAX_STEPS} steps`); break; }
        let id = slug(q.id) || mech;
        for (let k = 2; seen.has(id); k++) id = `${slug(q.id) || mech}-${k}`;
        seen.add(id);
        steps.push({
            id, mech, weight: Math.max(0, num(q.weight, 1)), params: { ...obj(q.params) },
            uses: text(q.uses, 40), words: Object.fromEntries(['title', 'hint', 'done'].map(k => [k, text(obj(q.words)[k], 120)]).filter(([, v]) => v)),
            art: Object.fromEntries(Object.entries(obj(q.art)).map(([k, v]) => [slug(k, 20), slug(v, 40)]).filter(([k, v]) => k && v)),
            sounds: Object.fromEntries(Object.entries(obj(q.sounds)).map(([k, v]) => [slug(k, 20), text(v, 60)]).filter(([k, v]) => k && v)),
            onRuin: q.onRuin === 'fail' ? 'fail' : 'cap', optional: q.optional === true, partner: ['offer', 'duet', 'never'].includes(q.partner) ? q.partner : 'never',
        });
    }
    for (let i = 1; i < steps.length; i++) if (steps[i].mech === steps[i - 1].mech) warnings.push(`"${steps[i].id}" repeats the mechanic of the step before it`);
    if (!steps.length) return { script: null, warnings: [...warnings, 'no usable steps'] };
    return { script: { set: slug(r.set) || 'kitchen', steps }, warnings };
}

/** The Roast Fish script: chop herbs, melt the herb butter, sear and flip the fish (the hero step), season it. */
export const ROAST_FISH = Object.freeze({
    set: 'kitchen',
    steps: [
        { id: 'herbs', mech: 'slice', weight: 1, params: { lines: 4 }, art: { item: 'herbs' }, words: { title: 'Chop the herbs', hint: 'Swipe down across each dotted line.', done: 'Neatly chopped.' } },
        { id: 'butter', mech: 'stir', weight: 1, params: { revs: 6 }, art: { vessel: 'saucepan', tool: 'spoon' }, words: { title: 'Melt the herb butter', hint: 'Stir in circles inside the pot. Not too slow, not too fast.', done: 'Smooth and glossy.' } },
        { id: 'sear', mech: 'sear', weight: 3, uses: 'a fish', art: { item: 'fish-fillet', vessel: 'pan', heat: 'stove' }, words: { title: 'Sear the fish', hint: 'Set the heat, flick the fish up to flip it, tap to catch it. Golden, not black.', done: 'Golden on both sides.' } },
        { id: 'season', mech: 'sprinkle', weight: 1, art: { item: 'fish-fillet', tool: 'shaker' }, words: { title: 'Season it', hint: 'Shake over the whole fish, evenly.', done: 'Seasoned evenly.' } },
        { id: 'plate', mech: 'plate', weight: 1, params: { items: ['fish', 'herbs', 'butter'] }, art: { tool: 'plate' }, words: { title: 'Plate it', hint: 'Put each item on its faint spot.', done: 'Nicely presented.' } },
    ],
});

/** Steps for a dish with no script of its own, from what the recipe is made of. Plain, neutral words. */
export function defaultScriptFor(recipe) {
    const name = String(recipe?.name || '').toLowerCase();
    const needs = (recipe?.needs || []).length;
    const wet = /soup|stew|sauce|porridge|broth/.test(name);
    const steps = [];
    if (needs || /salad|tart|pie|roast/.test(name)) steps.push({ id: 'prep', mech: 'slice', weight: 1, params: { lines: needs > 1 ? 5 : 4 }, words: { title: 'Prepare the ingredients', hint: 'Swipe down across each dotted line.' } });
    steps.push({ id: 'cook', mech: 'stir', weight: 2, params: { revs: wet ? 9 : 6, heat: wet }, words: { title: wet ? 'Simmer and stir' : 'Mix and stir', hint: 'Stir in circles. Keep it moving, but do not splash.' } });
    steps.push({ id: 'season', mech: 'sprinkle', weight: 1, words: { title: 'Season it', hint: 'Shake evenly over the dish.' } });
    if (wet) steps.push({ id: 'serve', mech: 'pour', weight: 1, params: { target: 0.7 }, art: { vessel: 'bowl' }, words: { title: 'Ladle it into the bowl', hint: 'Drag down to tip the jug. Stop at the line: it keeps pouring a moment after you stop.', done: 'Just the right amount.' } });
    else steps.push({ id: 'plate', mech: 'plate', weight: 1, params: { items: needs > 1 ? ['main', 'garnish', 'sauce'] : ['main', 'garnish'] }, art: { tool: 'plate' }, words: { title: 'Plate it', hint: 'Put each item on its faint spot.' } });
    return { set: 'kitchen', steps };
}

/**
 * The script a recipe plays: its own `steps` when it has them, else a built-in script for fish dishes, else the default for its kind.
 * Always a valid script (the default is used when the recipe's own steps are unusable).
 */
export function scriptFor(recipe) {
    if (Array.isArray(recipe?.steps) && recipe.steps.length) {
        const own = normalizeScript({ set: recipe.set, steps: recipe.steps });
        if (own.script) return own.script;
    }
    const fish = /fish|trout|carp|salmon/.test(String(recipe?.name || '').toLowerCase());
    return normalizeScript(fish ? ROAST_FISH : defaultScriptFor(recipe)).script;
}
