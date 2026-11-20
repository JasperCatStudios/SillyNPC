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
            uses: text(q.uses, 40), words: Object.fromEntries(['title', 'hint', 'done', 'action'].map(k => [k, text(obj(q.words)[k], 120)]).filter(([, v]) => v)),
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
        { id: 'plate', mech: 'plate', weight: 1, params: { items: [{ id: 'fish', art: 'fish-fillet-cooked' }, { id: 'herbs', art: 'herbs-cut' }, { id: 'butter', art: 'butter' }] }, art: { tool: 'plate' }, words: { title: 'Plate it', hint: 'Put each item on its faint spot.', done: 'Nicely presented.' } },
    ],
});

/** The picture name of the main food of a recipe: its own `art.item`, else from what it is made of or called. */
export function mainItem(recipe) {
    const own = slug(obj(recipe?.art).item, 40);
    if (own) return own;
    const words = [String(recipe?.name || ''), ...(recipe?.needs || []).flatMap(n => [n?.label, ...(Array.isArray(n?.any) ? n.any : [])])].join(' ').toLowerCase();
    if (/fish|trout|carp|salmon|perch|pike|eel|herring|bass/.test(words)) return 'fish-fillet';
    if (/berr|fruit|plum|peach|apple|currant/.test(words)) return 'fruit';
    if (/carrot|cabbage|onion|turnip|tomato|potato|pumpkin|veg|radish|chickpea/.test(words)) return 'vegetables';
    if (/herb|salad|lettuce|basil|mint/.test(words)) return 'herbs';
    if (/toast|bread/.test(words)) return 'bread';
    if (/porridge|oat|grain|rice/.test(words)) return 'grain';
    return 'food';
}

/** What kind of dish a recipe is, for choosing its steps: a soup or stew (wet), something grilled or roasted, a salad, a bake, or plain. */
export function dishKind(recipe) {
    const name = String(recipe?.name || '').toLowerCase();
    if (/soup|stew|sauce|porridge|broth|chowder/.test(name)) return 'wet';
    if (/salad/.test(name)) return 'salad';
    if (/grill|roast|toast|bread|fried|seared|sear\b/.test(name)) return 'grill';
    if (/pie|tart|bake|pudding/.test(name)) return 'bake';
    return 'plain';
}

/** The picture name of the finished dish: a soup is a bowl of soup, a pie is a pie, anything else is its main food (add `-cooked`). */
export function dishArt(recipe) {
    const kind = dishKind(recipe);
    const item = mainItem(recipe);
    return kind === 'wet' ? 'soup' : kind === 'bake' && item !== 'fruit' ? 'pie' : item;
}

/** Steps for a dish with no script of its own, from its kind and what it is made of. Plain, neutral words. */
export function defaultScriptFor(recipe) {
    const needs = (recipe?.needs || []).length;
    const kind = dishKind(recipe);
    const item = mainItem(recipe);
    const wet = kind === 'wet';
    const art = { item };
    // What lies on the plate while it is seasoned: the cooked dish (a soup is a bowl of soup, a pie is a pie).
    const dish = dishArt(recipe);
    const steps = [];
    if (needs && kind !== 'plain') steps.push({ id: 'prep', mech: 'slice', weight: 1, params: { lines: needs > 1 ? 5 : 4 }, art, words: { title: 'Prepare the ingredients', hint: 'Swipe down across each dotted line.' } });
    if (kind === 'grill') steps.push({ id: 'cook', mech: 'sear', weight: 3, art: { ...art, vessel: 'pan', heat: 'stove' }, words: { title: 'Cook it', hint: 'Set the heat, tap the food to flip it, tap again to catch it. Golden, not black.' } });
    else if (kind !== 'salad') steps.push({ id: 'cook', mech: 'stir', weight: 2, params: { revs: wet ? 9 : 6, heat: wet }, art: { vessel: 'saucepan', tool: 'spoon' }, words: { title: wet ? 'Simmer and stir' : 'Mix and stir', hint: 'Stir in circles inside the pot. Keep it moving, but do not splash.' } });
    steps.push({ id: 'season', mech: 'sprinkle', weight: 1, art: { item: dish, tool: 'shaker' }, words: { title: 'Season it', hint: 'Shake evenly over the dish.' } });
    if (wet) steps.push({ id: 'serve', mech: 'pour', weight: 1, params: { target: 0.7 }, art: { vessel: 'bowl' }, words: { title: 'Ladle it into the bowl', hint: 'Drag down to tip the jug. Stop at the line: it keeps pouring a moment after you stop.', done: 'Just the right amount.' } });
    else steps.push({ id: 'plate', mech: 'plate', weight: 1, params: { items: [{ id: 'main', art: `${dish}-cooked` }, { id: 'garnish', art: 'herbs-cut' }, ...(needs > 1 ? [{ id: 'sauce', art: 'sauce' }] : [])] }, art: { tool: 'plate' }, words: { title: 'Plate it', hint: 'Put each item on its faint spot.' } });
    return { set: 'kitchen', steps };
}

/**
 * The script a recipe plays: its own `steps` when it has them, else the grilled-fish script for a grilled or roasted fish, else the
 * default for its kind. Always a valid script (the default is used when the recipe's own steps are unusable).
 */
export function scriptFor(recipe) {
    if (Array.isArray(recipe?.steps) && recipe.steps.length) {
        const own = normalizeScript({ set: recipe.set, steps: recipe.steps });
        if (own.script) return own.script;
    }
    const fishGrill = dishKind(recipe) === 'grill' && mainItem(recipe) === 'fish-fillet';
    return normalizeScript(fishGrill ? ROAST_FISH : defaultScriptFor(recipe)).script;
}
