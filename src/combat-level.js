/**
 * Experience and levels (fork), kept simple and adjustable.
 *
 * By default every level takes the same 200 XP, and a fight gives 15 XP for each enemy fought, whoever
 * wins and whether it was a spar or a real fight. XP is the progress toward the next level; filling it
 * spends it and raises the level by one. Three numbers can be changed (see LEVELING_DEFAULTS): the XP the
 * first level takes, how much more each later level takes, and a highest level (0 for none). At the highest
 * level XP stops filling.
 *
 * The level itself lives in the character's "level" detail when the world type has one, and in
 * the sheet's own level otherwise, so a type with no level detail still works.
 *
 * Pure: no DOM, no SillyTavern imports.
 */

export const XP_PER_LEVEL = 200;
export const XP_PER_ENEMY = 15;

/** The starting rules: 200 XP a level, no extra per level, 15 XP per enemy, no highest level. */
export const LEVELING_DEFAULTS = Object.freeze({ xpBase: XP_PER_LEVEL, xpStep: 0, xpPerEnemy: XP_PER_ENEMY, maxLevel: 0 });

const whole = (v, min) => Math.max(min, Math.floor(Number(v)) || min);
const within = (v, lo, hi, d) => (Number.isFinite(Number(v)) && String(v ?? '').trim() !== '' ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : d);

/** The leveling settings with every number in range; anything missing is the default. */
export function normalizeLeveling(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const d = LEVELING_DEFAULTS;
    return {
        xpBase: within(r.xpBase, 1, 1000000, d.xpBase),
        xpStep: within(r.xpStep, 0, 1000000, d.xpStep),
        xpPerEnemy: within(r.xpPerEnemy, 0, 1000000, d.xpPerEnemy),
        maxLevel: within(r.maxLevel, 0, 999, d.maxLevel),
    };
}

/** The XP it takes to go from this level to the next. */
export function xpToNext(level, cfg) {
    const c = normalizeLeveling(cfg);
    return c.xpBase + c.xpStep * (whole(level, 1) - 1);
}

/** Whether this level is the highest allowed (0 means there is none). */
export function isMaxLevel(level, cfg) {
    const c = normalizeLeveling(cfg);
    return c.maxLevel > 0 && whole(level, 1) >= c.maxLevel;
}

/** The level after gaining XP: { level, xp, levelsGained }. */
export function applyXp(level, xp, gain, cfg) {
    const c = normalizeLeveling(cfg);
    let l = whole(level, 1);
    let x = whole(xp, 0) + whole(gain, 0);
    let levelsGained = 0;
    while (c.maxLevel === 0 || l < c.maxLevel) {
        const need = xpToNext(l, c);
        if (x < need) break;
        x -= need;
        l++;
        levelsGained++;
    }
    // At the highest level there is nothing to fill.
    if (c.maxLevel > 0 && l >= c.maxLevel) x = 0;
    return { level: l, xp: x, levelsGained };
}

/** XP for a fight against this many enemies. */
export const xpForFight = (enemies = 1, cfg) => normalizeLeveling(cfg).xpPerEnemy * whole(enemies, 0);

/** Whether the type keeps a level among its details. */
export const hasLevelMeta = (type) => (type?.meta || []).some(m => m.id === 'level');

/** A character's level under a type. */
export function readLevel(type, data) {
    const def = (type?.meta || []).find(m => m.id === 'level');
    if (def) return whole(data?.meta?.level ?? def.default, 1);
    return whole(data?.level, 1);
}

/**
 * The report that goes to the story when characters level up after a fight, one line each.
 * Text only: the wording around it is the owner's instruction (see result-injection.js).
 *
 * @param {{ name: string, from: number, level: number }[]} ups
 */
export function levelUpReport(ups) {
    const lines = (Array.isArray(ups) ? ups : []).filter(u => u && u.name && u.level > u.from).map(u => (
        u.level - u.from === 1
            ? `${u.name} reached level ${u.level}.`
            : `${u.name} rose from level ${u.from} to level ${u.level}.`));
    return lines.length ? `Level up: ${lines.join(' ')}` : '';
}
