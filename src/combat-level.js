/**
 * Experience and levels (fork), kept deliberately simple.
 *
 * Every level takes the same 200 XP, and a fight gives 15 XP for each enemy fought, whoever
 * wins and whether it was a spar or a real fight. XP is the progress toward the next level
 * (0 to 199); filling it spends it and raises the level by one.
 *
 * The level itself lives in the character's "level" detail when the world type has one, and in
 * the sheet's own level otherwise, so a type with no level detail still works.
 *
 * Pure: no DOM, no SillyTavern imports.
 */

export const XP_PER_LEVEL = 200;
export const XP_PER_ENEMY = 15;

const whole = (v, min) => Math.max(min, Math.floor(Number(v)) || min);

/** The level after gaining XP: { level, xp, levelsGained }. */
export function applyXp(level, xp, gain) {
    let l = whole(level, 1);
    let x = whole(xp, 0) + whole(gain, 0);
    let levelsGained = 0;
    while (x >= XP_PER_LEVEL) { x -= XP_PER_LEVEL; l++; levelsGained++; }
    return { level: l, xp: x, levelsGained };
}

/** XP for a fight against this many enemies. */
export const xpForFight = (enemies = 1) => XP_PER_ENEMY * whole(enemies, 0);

/** Whether the type keeps a level among its details. */
export const hasLevelMeta = (type) => (type?.meta || []).some(m => m.id === 'level');

/** A character's level under a type. */
export function readLevel(type, data) {
    const def = (type?.meta || []).find(m => m.id === 'level');
    if (def) return whole(data?.meta?.level ?? def.default, 1);
    return whole(data?.level, 1);
}
