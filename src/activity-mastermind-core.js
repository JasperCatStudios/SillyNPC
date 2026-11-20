import { GRADE_XP } from './activity-memory-core.js';

/**
 * Brewing: the potion recipe game (fork). The rules, without the screen.
 *
 * A hidden recipe of four ingredients. Each try is four ingredients; the answer says how many are right and in
 * the right place ("exact") and how many are right but in the wrong place ("present"). Solve it before the tries
 * run out. Easy has 6 ingredients, no repeats and 10 tries; Normal has 6, repeats allowed and 8 tries; Hard has 8,
 * repeats allowed and 6 tries.
 *
 * Every symbol has a shape and a letter as well as a colour, so colour is never the only cue. A function that needs chance
 * takes an injected `rng`.
 *
 * Pure: no DOM, no SillyTavern imports.
 */

export const CODE_LENGTH = 4;
export const DIFFICULTIES = Object.freeze(['easy', 'normal', 'hard']);
export const ATTEMPTS = Object.freeze({ easy: 10, normal: 8, hard: 6 });
export const SYMBOL_COUNT = Object.freeze({ easy: 6, normal: 6, hard: 8 });
export const ALLOW_REPEATS = Object.freeze({ easy: false, normal: true, hard: true });
/** What a harder brew is worth, as a multiplier on XP. */
export const DIFFICULTY_XP = Object.freeze({ easy: 0.8, normal: 1, hard: 1.3 });

/** Eight ingredients: an id, a name, a shape and a letter (so colour is never the only cue) and a colour. */
export const SYMBOLS = Object.freeze([
    { id: 'red', name: 'Red', shape: '●', letter: 'R', color: '#d9534f' },
    { id: 'blue', name: 'Blue', shape: '▲', letter: 'B', color: '#4a8fe0' },
    { id: 'green', name: 'Green', shape: '■', letter: 'G', color: '#4caf6a' },
    { id: 'yellow', name: 'Yellow', shape: '◆', letter: 'Y', color: '#e3c13b' },
    { id: 'purple', name: 'Purple', shape: '★', letter: 'P', color: '#a06bd6' },
    { id: 'orange', name: 'Orange', shape: '⬟', letter: 'O', color: '#e8893a' },
    { id: 'teal', name: 'Teal', shape: '⬢', letter: 'T', color: '#38b2ac' },
    { id: 'pink', name: 'Pink', shape: '♥', letter: 'K', color: '#e07aa8' },
]);

const clampDifficulty = (d) => (DIFFICULTIES.includes(d) ? d : 'normal');

/**
 * The ingredients in play for a difficulty: the first N of the list. `names` (optional, id -> name) renames
 * them, so a world can call the red one "Redroot".
 */
export function symbolsFor(difficulty, names = {}) {
    const n = SYMBOL_COUNT[clampDifficulty(difficulty)];
    return SYMBOLS.slice(0, n).map(s => ({ ...s, name: String(names?.[s.id] ?? '').trim().slice(0, 24) || s.name }));
}

/** A new game with a hidden recipe. */
export function newGame({ difficulty = 'normal', rng = Math.random, names } = {}) {
    const diff = clampDifficulty(difficulty);
    const symbols = symbolsFor(diff, names);
    const ids = symbols.map(s => s.id);
    const code = [];
    const pool = ids.slice();
    for (let i = 0; i < CODE_LENGTH; i++) {
        if (ALLOW_REPEATS[diff]) code.push(ids[Math.floor(rng() * ids.length)]);
        else code.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
    }
    return { difficulty: diff, symbols, code, max: ATTEMPTS[diff], guesses: [], solved: false, over: false };
}

/**
 * The answer to a try, by the usual rule: `exact` are the right ingredient in the right place, `present` are right
 * ingredients in the wrong place, each ingredient counted once (so a repeat is not counted twice).
 * @returns {{ exact: number, present: number }}
 */
export function scoreGuess(code, guess) {
    let exact = 0;
    const codeLeft = {};
    const guessLeft = {};
    for (let i = 0; i < code.length; i++) {
        if (guess[i] === code[i]) exact += 1;
        else {
            codeLeft[code[i]] = (codeLeft[code[i]] || 0) + 1;
            guessLeft[guess[i]] = (guessLeft[guess[i]] || 0) + 1;
        }
    }
    let present = 0;
    for (const [id, n] of Object.entries(guessLeft)) present += Math.min(n, codeLeft[id] || 0);
    return { exact, present };
}

/** Whether a try is allowed: four known ingredients, and no repeats on Easy. */
export function validGuess(state, guess) {
    if (!Array.isArray(guess) || guess.length !== CODE_LENGTH) return 'Pick four ingredients.';
    const known = new Set(state.symbols.map(s => s.id));
    if (!guess.every(id => known.has(id))) return 'Pick from the ingredients shown.';
    if (!ALLOW_REPEATS[state.difficulty] && new Set(guess).size !== guess.length) return 'Each ingredient can be used once on Easy.';
    return '';
}

/**
 * Makes one try. Returns { ok, reason?, result? } and changes the game. The game ends when the recipe is found or
 * the tries run out.
 */
export function submit(state, guess) {
    if (state.over) return { ok: false, reason: 'The brew is finished.' };
    const why = validGuess(state, guess);
    if (why) return { ok: false, reason: why };
    const result = scoreGuess(state.code, guess);
    state.guesses.push({ guess: guess.slice(), ...result });
    if (result.exact === CODE_LENGTH) { state.solved = true; state.over = true; }
    else if (state.guesses.length >= state.max) state.over = true;
    return { ok: true, result };
}

/** The answer in words: "2 in place, 1 right ingredient". */
export function feedbackText({ exact, present }) {
    const parts = [];
    if (exact) parts.push(`${exact} in place`);
    if (present) parts.push(`${present} right ingredient${present === 1 ? '' : 's'}, wrong place`);
    return parts.length ? parts.join(', ') : 'none right';
}

/**
 * The grade by tries used: 3 or fewer perfect, 5 or fewer good, any other solve before the last try fair, a solve on
 * the very last try poor, and 'failed' when it was not solved.
 */
export function gradeOf(state) {
    if (!state.solved) return 'failed';
    const used = state.guesses.length;
    if (used <= 3) return 'perfect';
    if (used <= 5) return 'good';
    if (used < state.max) return 'fair';
    return 'poor';
}

/**
 * What the brew is worth. A failed brew gives the failed item and the lowest XP. profXp is for the player;
 * the partner gets half. Only a good or perfect brew nudges a bond.
 * @param {object} state
 * @param {{ recipe?: string, failed?: string }} [names] the potion's and the failed brew's names (a preset can rename them)
 */
export function rewardsOf(state, { recipe = 'Herbal Tonic', failed = 'Murky Brew' } = {}) {
    const grade = gradeOf(state);
    const mult = (grade === 'failed' ? GRADE_XP.poor : GRADE_XP[grade]) * DIFFICULTY_XP[state.difficulty];
    const profXp = Math.round(16 * mult);
    const item = grade === 'failed'
        ? { name: failed, qty: 1, kind: 'potion', note: 'a failed brew' }
        : { name: recipe, qty: 1, kind: 'potion', note: { perfect: 'excellent quality', good: 'good quality', fair: 'weak', poor: 'barely holds together' }[grade] };
    const bond = grade === 'perfect' ? { meter: 'respect', amount: 1.5 } : grade === 'good' ? { meter: 'respect', amount: 1 } : null;
    return { grade, brewed: grade !== 'failed', profXp, partnerProfXp: Math.floor(profXp / 2), levelXp: Math.round(8 * mult), item, bond };
}

/** The brew in plain words, for the partner's talk. */
export function describeState(state) {
    const last = state.guesses[state.guesses.length - 1];
    const parts = [`${state.guesses.length} of ${state.max} tries used`];
    if (last) parts.push(`the last try had ${feedbackText(last)}`);
    if (state.over) parts.push(state.solved ? 'the recipe was found' : 'the tries ran out');
    return parts.join(', ');
}

export { seeded } from './activity-memory-core.js';
