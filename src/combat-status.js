/**
 * A character's condition as a grade (fork), the way a proficiency has a rank.
 *
 * E- is near death and S+ is perfectly healthy. A fight starts from the health the grade stands
 * for and, when it ends, the grade is set again from the health left. The grade is the only
 * thing kept between fights, and it can be edited by hand, so setting it to S+ is a full rest.
 *
 * The same ladder for every world type: it describes the body, not the rules.
 *
 * Pure: no DOM, no SillyTavern imports.
 */

const LETTERS = ['E', 'D', 'C', 'B', 'A', 'S'];

/** E-, E, E+, D-, ... S-, S, S+ : lowest to highest. */
export const STATUS_RUNGS = Object.freeze(LETTERS.flatMap(l => [`${l}-`, l, `${l}+`]));

/** What a character is taken to be when nothing has been recorded. */
export const STATUS_DEFAULT = 'S+';

export function isStatus(grade) {
    return STATUS_RUNGS.includes(grade);
}

/** The share of health a grade stands for: E- about 6%, S+ all of it. */
export function fractionFromStatus(grade) {
    const i = STATUS_RUNGS.indexOf(isStatus(grade) ? grade : STATUS_DEFAULT);
    return (i + 1) / STATUS_RUNGS.length;
}

/** The grade for a share of health. Anything standing is at least E-; only all of it is S+. */
export function statusFromFraction(fraction) {
    const f = Number(fraction);
    if (!Number.isFinite(f) || f >= 1) return STATUS_DEFAULT;
    if (f <= 0) return STATUS_RUNGS[0];
    const i = Math.ceil(f * STATUS_RUNGS.length) - 1;
    return STATUS_RUNGS[Math.max(0, Math.min(STATUS_RUNGS.length - 2, i))];
}
