/**
 * Energy for activities (fork): what an activity costs the player and whether they can afford it. The rules, without the I/O.
 *
 * Energy is the Vitals Tracker's energy (0 to 100), so this only applies while that tracker is on and tracks energy; the runtime
 * checks that and calls these. A cost is a whole number: the activity's own `energy` when its preset gives one, else the Activities
 * setting. An energy that is not known (no vitals record for the player yet) never blocks anything.
 *
 * Pure: no DOM, no SillyTavern imports.
 */

export const ENERGY_MAX = 100;

const whole = (v) => Math.floor(Number(v));

/** The energy an activity costs: its own `energy` (0 to 100) when it has one, else the setting's `energyCost`. */
export function energyCostOf(activity, settings) {
    const own = whole(activity?.energy);
    if (Number.isFinite(own) && own >= 0) return Math.min(ENERGY_MAX, own);
    const fallback = whole(settings?.energyCost);
    return Number.isFinite(fallback) && fallback > 0 ? Math.min(ENERGY_MAX, fallback) : 0;
}

/** Whether there is enough energy. An unknown energy (null, undefined, not a number) counts as enough. */
export function canAfford(energy, cost) {
    const have = Number(energy);
    if (energy === null || energy === undefined || energy === '' || !Number.isFinite(have)) return true;
    return have >= Math.max(0, whole(cost) || 0);
}

/** The energy left after paying, never below 0 or above 100. */
export function afterSpend(energy, cost) {
    if (energy === null || energy === undefined || energy === '') return null;
    const have = Number(energy);
    if (!Number.isFinite(have)) return null;
    return Math.max(0, Math.min(ENERGY_MAX, Math.round(have) - Math.max(0, whole(cost) || 0)));
}

/** "Too tired (energy 8, needs 10)". */
export function tiredText(energy, cost) {
    return `Too tired (energy ${Math.round(Number(energy) || 0)}, needs ${Math.max(0, whole(cost) || 0)})`;
}

/** "Energy 80 -> 70" for the result lines. */
export function spentText(before, after) {
    return `Energy ${Math.round(before)} to ${Math.round(after)}`;
}
