/**
 * The recipe creator (fork): the rules behind "make your own recipe" inside the Cooking activity, without the screen.
 *
 * A player builds a recipe by choosing items from the item database. The database counts as active when it holds items of the
 * player's own (imported from a Content Kit list or added by hand); the ten built-in example items alone do not count, because
 * they are a placeholder set. With no database the creator says so and offers nothing to choose.
 *
 * Pure: no DOM, no SillyTavern imports, so node can test it.
 */

export const MAX_INGREDIENTS = 4;
export const MAX_QTY = 9;
export const MAX_MY_RECIPES = 40;

const text = (v, max) => String(v ?? '').replace(/[\r\n|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const key = (v) => String(v ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const whole = (v, lo, hi, d) => (Number.isFinite(Number(v)) && String(v ?? '').trim() !== '' ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : d);

/** The items the player can build from: the database items minus the built-in examples. */
export const usableItems = (items) => (items || []).filter(i => i?.name && !i.builtIn);

/**
 * Whether the creator can be used, and what to tell the player when it cannot.
 * @param {object[]} items the database items as the inventory module lists them ({ name, category, builtIn })
 * @returns {{ ok: boolean, count: number, categories: string[], message: string }}
 */
export function creatorAvailability(items) {
    const list = usableItems(items);
    if (!list.length) {
        return {
            ok: false, count: 0, categories: [],
            message: 'No item database is active, so there is nothing to build a recipe from. Import an item list (Worldkit menu, Items, Content Kit) or add items of your own, then come back.',
        };
    }
    return { ok: true, count: list.length, categories: categoriesOf(list), message: '' };
}

/** The categories in a list of items, sorted, without repeats. */
export const categoriesOf = (items) => [...new Set((items || []).map(i => text(i?.category, 24)).filter(Boolean))].sort((a, b) => a.localeCompare(b));

/** The items matching a search word (in the name) and a category ('' for all), in name order. */
export function filterItems(items, { query = '', category = '' } = {}) {
    const q = String(query || '').toLowerCase().trim();
    return usableItems(items)
        .filter(i => (!category || i.category === category) && (!q || String(i.name).toLowerCase().includes(q)))
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

/** One ingredient need for a recipe: the item's own name, so the dish asks for exactly that item. */
export const ingredientNeed = (item, qty = 1) => ({ label: text(item?.name, 40) || 'an ingredient', any: [text(item?.name, 30).toLowerCase()].filter(Boolean), qty: whole(qty, 1, MAX_QTY, 1) });

/** A sensible hunger value to start from: a little for each ingredient used. */
export const suggestRestore = (picks) => Math.min(60, 12 + 8 * (picks || []).reduce((n, p) => n + whole(p?.qty, 1, MAX_QTY, 1), 0));

/**
 * Makes a recipe from a name and the chosen items, or says why not.
 * @param {{ name: string, desc?: string, picks: { name: string, qty?: number }[], restore?: number|string, taken?: { id?: string, name?: string }[], items: object[] }} input
 *   `taken` are the recipes that already exist (their names and ids may not be reused); `items` the database items to choose from.
 * @returns {{ ok: true, recipe: object } | { ok: false, reason: string }}
 */
export function buildCustomRecipe({ name, desc = '', picks = [], restore, taken = [], items = [] } = {}) {
    const title = text(name, 50);
    if (!title) return { ok: false, reason: 'Give the recipe a name.' };
    if (key(title) === '') return { ok: false, reason: 'The name needs letters or numbers.' };
    if ((taken || []).some(r => key(r?.name) === key(title))) return { ok: false, reason: `A recipe called "${title}" already exists.` };
    const usable = usableItems(items);
    const seen = new Set();
    const needs = [];
    for (const p of Array.isArray(picks) ? picks : []) {
        const item = usable.find(i => key(i.name) === key(p?.name));
        if (!item) return { ok: false, reason: `"${text(p?.name, 40)}" is not in the item database.` };
        if (seen.has(key(item.name))) continue;
        seen.add(key(item.name));
        needs.push(ingredientNeed(item, p.qty));
    }
    if (!needs.length) return { ok: false, reason: 'Choose at least one item from the database.' };
    if (needs.length > MAX_INGREDIENTS) return { ok: false, reason: `A recipe can use at most ${MAX_INGREDIENTS} different items.` };
    const ids = new Set((taken || []).map(r => String(r?.id ?? '')));
    let id = `my-${key(title).slice(0, 24) || 'dish'}`;
    for (let n = 2; ids.has(id); n += 1) id = `my-${key(title).slice(0, 20)}-${n}`;
    const value = whole(restore, 0, 100, null);
    return {
        ok: true,
        recipe: {
            id, name: title, desc: text(desc, 90), needs, custom: true,
            restore: value === null ? suggestRestore(picks) : value,
        },
    };
}

/** The saved recipes repaired: valid names and needs, no repeats of name, at most MAX_MY_RECIPES. `normalizeRecipe` is the preset's. */
export function normalizeMyRecipes(list, normalizeRecipe) {
    const out = [];
    const seen = new Set();
    for (const raw of Array.isArray(list) ? list : []) {
        const r = normalizeRecipe(raw);
        if (!r || !r.needs.length || seen.has(key(r.name))) continue;
        seen.add(key(r.name));
        out.push({ ...r, custom: true });
        if (out.length >= MAX_MY_RECIPES) break;
    }
    return out;
}

/** The recipes the cook screen offers: the preset's, then the player's own (a name already in the preset is not added twice). */
export function allRecipes(presetRecipes, myRecipes) {
    const base = presetRecipes || [];
    const names = new Set(base.map(r => key(r?.name)));
    return base.concat((myRecipes || []).filter(r => !names.has(key(r?.name))));
}
