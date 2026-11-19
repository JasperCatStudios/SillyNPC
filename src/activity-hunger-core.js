/**
 * Hunger from eating (fork): how much a drink, a snack or a dish restores, and what is left after. The rules, without the I/O.
 *
 * Hunger is the Vitals Tracker's hunger (0 starving to 100 full), so this only applies while that tracker is on and tracks
 * hunger; the runtime checks that and calls these. A recipe may carry its own `restore` (0 to 100); anything without one uses the
 * defaults below, which a preset's `tea.restore` can change.
 *
 * Pure: no DOM, no SillyTavern imports.
 */

export const HUNGER_MAX = 100;

/** Used when a recipe or a preset gives no value. */
export const DEFAULT_RESTORE = Object.freeze({ drink: 4, snack: 8, dish: 20 });

/** How well it was made changes what it gives: a perfect dish feeds more, a poor one less. */
export const GRADE_FEED = Object.freeze({ perfect: 1.25, good: 1, fair: 0.8, poor: 0.5, failed: 0.25 });

const whole = (v) => Math.floor(Number(v));
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const key = (v) => String(v ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/** A restore value from a recipe or a setting: a whole number from 0 to 100, or null when it is not a usable number. */
export function restoreValue(v) {
    if (v === null || v === undefined || String(v).trim() === '') return null;
    const n = whole(v);
    return Number.isFinite(n) ? clamp(n, 0, HUNGER_MAX) : null;
}

/** The recipe with this name (same words, any case or punctuation), or null. */
export function recipeNamed(recipes, name) {
    const want = key(name);
    return want ? (recipes || []).find(r => key(r?.name) === want) || null : null;
}

/** What eating a dish restores: its recipe's own value, else the default for a dish. */
export function dishRestore(recipes, name, defaults = DEFAULT_RESTORE) {
    const own = restoreValue(recipeNamed(recipes, name)?.restore);
    return own !== null ? own : (restoreValue(defaults?.dish) ?? DEFAULT_RESTORE.dish);
}

/**
 * What a shared drink and food restore together, before the grade: the drink's value, plus the food's (a recipe of that name, else
 * the snack default). \`defaults\` is the preset's { drink, snack, dish }.
 */
export function mealRestore({ drink = '', food = '', recipes = [], defaults = DEFAULT_RESTORE } = {}) {
    const d = { ...DEFAULT_RESTORE, ...Object.fromEntries(Object.entries(defaults || {}).map(([k, v]) => [k, restoreValue(v)]).filter(([, v]) => v !== null)) };
    let total = 0;
    if (String(drink).trim()) total += d.drink;
    if (String(food).trim()) total += recipeNamed(recipes, food) ? dishRestore(recipes, food, d) : d.snack;
    return clamp(total, 0, HUNGER_MAX);
}

/** The amount after the grade's multiplier, a whole number. */
export const gradedRestore = (amount, grade) => clamp(Math.round((restoreValue(amount) ?? 0) * (GRADE_FEED[grade] ?? 1)), 0, HUNGER_MAX);

/** The hunger after eating, never above 100. */
export const hungerAfter = (before, amount) => clamp(Math.round(Number(before) + (restoreValue(amount) ?? 0)), 0, HUNGER_MAX);

/** "Hunger 40 to 62" for the result lines. */
export const hungerText = (before, after) => `Hunger ${Math.round(before)} to ${Math.round(after)}`;
