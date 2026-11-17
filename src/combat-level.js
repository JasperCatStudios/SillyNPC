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

/** Percent of a fight's XP by the difficulty chosen for it (1 easy to 5 hard). The even level, 2, gives the plain amount. */
export const DIFFICULTY_XP_DEFAULTS = Object.freeze({ 1: 50, 2: 100, 3: 125, 4: 150, 5: 200 });

/** The starting rules: 200 XP a level, no extra per level, 15 XP per enemy, no highest level, more XP for harder fights. */
export const LEVELING_DEFAULTS = Object.freeze({ xpBase: XP_PER_LEVEL, xpStep: 0, xpPerEnemy: XP_PER_ENEMY, maxLevel: 0, difficultyXp: DIFFICULTY_XP_DEFAULTS });

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
        difficultyXp: Object.fromEntries([1, 2, 3, 4, 5].map(n => [n, within(r.difficultyXp?.[n], 0, 1000, d.difficultyXp[n])])),
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

/** The percent of a fight's XP a difficulty gives. A difficulty with no setting (a world with other levels, or none chosen) gives 100. */
export function difficultyShare(difficulty, cfg) {
    const share = normalizeLeveling(cfg).difficultyXp[Math.round(Number(difficulty))];
    return share === undefined ? 100 : share;
}

/** XP for a fight against this many enemies, at the difficulty the fight was set to (none: the plain amount). */
export const xpForFight = (enemies = 1, cfg, difficulty) => Math.round(normalizeLeveling(cfg).xpPerEnemy * whole(enemies, 0) * difficultyShare(difficulty, cfg) / 100);

/** Whether the type keeps a level among its details. */
export const hasLevelMeta = (type) => (type?.meta || []).some(m => m.id === 'level');

/** A character's level under a type. */
export function readLevel(type, data) {
    const def = (type?.meta || []).find(m => m.id === 'level');
    if (def) return whole(data?.meta?.level ?? def.default, 1);
    return whole(data?.level, 1);
}

/**
 * The report that goes to the story when characters level up after a fight, one sentence each. It never names a
 * level or a number: the story model is told in plain words that someone grew stronger and more experienced (more
 * so when several levels came at once), so the narrative cannot repeat "level 5". The wording around it is the
 * owner's instruction (see result-injection.js).
 *
 * @param {{ name: string, from: number, level: number }[]} ups
 */
export function levelUpReport(ups) {
    const list = (Array.isArray(ups) ? ups : []).filter(u => u && u.name && u.level > u.from);
    // Everyone who grew is LISTED in one sentence ("Ana, Bo and Cy have grown..."), not one sentence each, so three people
    // levelling together do not repeat the line three times. Those who rose by several levels at once get a stronger line.
    const names = (people) => {
        const n = [...new Set(people.map(u => u.name))];
        return n.length <= 1 ? (n[0] || '') : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
    };
    const verb = (people) => (new Set(people.map(u => u.name)).size === 1 ? 'has' : 'have');
    const one = list.filter(u => u.level - u.from === 1);
    const many = list.filter(u => u.level - u.from > 1);
    const parts = [];
    if (one.length) parts.push(`${names(one)} ${verb(one)} grown stronger and more experienced.`);
    if (many.length) parts.push(`${names(many)} ${verb(many)} grown a great deal stronger and more experienced.`);
    return parts.join(' ');
}
