/**
 * Study: the tile memory game (fork). The rules, without the screen.
 *
 * A board of face-down tiles, two of each rune. Flip two; a match stays open, a miss flips back and
 * costs one point of concentration. A cursed tile, once seen, is a trap: missing while it is one of
 * the two flipped tiles shuffles every tile that is still unmatched. Matching a cursed pair lifts
 * the curse and gives a point of concentration back. The game ends when the board is cleared, or
 * concentration runs out (the session ends early, with credit for what was found).
 *
 * Every function takes an injected `rng` (a function returning [0, 1)), so a seeded one makes a
 * game repeatable in tests.
 *
 * Pure: no DOM, no SillyTavern imports.
 */

export const PAIR_OPTIONS = Object.freeze([4, 8, 12]);
export const DIFFICULTIES = Object.freeze(['easy', 'normal', 'hard']);

/** Concentration at the start for 8 pairs; other sizes scale from it (see startConcentration). */
export const BASE_CONCENTRATION = Object.freeze({ easy: 8, normal: 6, hard: 4 });

/** Used when a preset supplies no runes: twelve plain glyphs, no art needed. */
export const GENERIC_RUNES = Object.freeze(['ᚠ', 'ᚢ', 'ᚦ', 'ᚨ', 'ᚱ', 'ᚲ', 'ᚷ', 'ᚹ', 'ᚺ', 'ᚾ', 'ᛁ', 'ᛃ']);

export const GRADES = Object.freeze(['perfect', 'good', 'fair', 'poor']);
/** XP multiplier per grade. */
export const GRADE_XP = Object.freeze({ perfect: 1.5, good: 1.0, fair: 0.6, poor: 0.3 });

const clampPairs = (n) => (PAIR_OPTIONS.includes(Number(n)) ? Number(n) : 8);
const clampDifficulty = (d) => (DIFFICULTIES.includes(d) ? d : 'normal');

/** How many pairs are cursed: none on a small board, 1 on 8 pairs, 2 on 12. */
export const cursedCount = (pairs) => (pairs >= 12 ? 2 : pairs >= 8 ? 1 : 0);

/** Concentration at the start: the 8-pair number scaled by the pair count, never below 3. */
export function startConcentration(pairs, difficulty) {
    const base = BASE_CONCENTRATION[clampDifficulty(difficulty)];
    return Math.max(3, Math.round(base * clampPairs(pairs) / 8));
}

function shuffled(list, rng) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

/** The runes the board uses: the first `pairs` of the supplied list, padded from the generic set if short. */
function pickRunes(runes, pairs) {
    const own = (Array.isArray(runes) ? runes : []).map(r => String(r ?? '').trim()).filter(Boolean);
    const out = [...new Set(own)];
    for (const g of GENERIC_RUNES) {
        if (out.length >= pairs) break;
        if (!out.includes(g)) out.push(g);
    }
    return out.slice(0, pairs);
}

/**
 * A new game.
 * @param {{ pairs?: number, difficulty?: string, runes?: string[], rng?: () => number }} [opts]
 * Tiles: { symbol, state: 'down' | 'up' | 'matched' }. `cursed` lists the cursed symbols; `known` the ones seen so far.
 */
export function newGame({ pairs = 8, difficulty = 'normal', runes, rng = Math.random } = {}) {
    const n = clampPairs(pairs);
    const diff = clampDifficulty(difficulty);
    const symbols = pickRunes(runes, n);
    const tiles = shuffled([...symbols, ...symbols], rng).map(symbol => ({ symbol, state: 'down' }));
    const cursed = shuffled(symbols, rng).slice(0, cursedCount(n));
    const start = startConcentration(n, diff);
    return {
        pairs: n, difficulty: diff, tiles, cursed, known: [],
        concentration: start, startConcentration: start,
        pending: [],            // two face-up tiles that did not match, waiting to be hidden
        found: 0, moves: 0, shuffles: 0, over: false, cleared: false,
    };
}

/** Whether a tile can be flipped now. */
export function canFlip(state, index) {
    const t = state.tiles[index];
    return Boolean(t) && !state.over && t.state === 'down';
}

/** The tile indexes that are face up and not yet judged (zero or one). */
const waiting = (state) => state.tiles.map((t, i) => (t.state === 'up' && !state.pending.includes(i) ? i : -1)).filter(i => i >= 0);

/** Turns a missed pair back face down. */
export function hideMiss(state) {
    for (const i of state.pending) if (state.tiles[i].state === 'up') state.tiles[i].state = 'down';
    state.pending = [];
}

/** Shuffles every tile that is not matched among the positions they occupy. Matched tiles stay put. */
export function shuffleUnmatched(state, rng = Math.random) {
    const slots = state.tiles.map((t, i) => (t.state === 'matched' ? -1 : i)).filter(i => i >= 0);
    const symbols = shuffled(slots.map(i => state.tiles[i].symbol), rng);
    slots.forEach((slot, k) => { state.tiles[slot] = { symbol: symbols[k], state: 'down' }; });
    state.pending = [];
    state.shuffles += 1;
}

/**
 * Flips one tile. A pair left face up from a miss is turned back first.
 * @returns {{ ok: boolean, events: object[] }} events: { type: 'flip'|'match'|'miss'|'curse-seen'|'curse-lifted'|'shuffle'|'clear'|'exhausted', ... }
 */
export function flip(state, index, rng = Math.random) {
    const events = [];
    if (state.over) return { ok: false, events };
    if (state.pending.length) hideMiss(state);
    if (!canFlip(state, index)) return { ok: false, events };

    const tile = state.tiles[index];
    tile.state = 'up';
    events.push({ type: 'flip', index, symbol: tile.symbol });
    if (state.cursed.includes(tile.symbol) && !state.known.includes(tile.symbol)) {
        state.known.push(tile.symbol);
        events.push({ type: 'curse-seen', symbol: tile.symbol });
    }

    const open = waiting(state);
    if (open.length < 2) return { ok: true, events };

    state.moves += 1;
    const [a, b] = open;
    if (state.tiles[a].symbol === state.tiles[b].symbol) {
        state.tiles[a].state = 'matched';
        state.tiles[b].state = 'matched';
        state.found += 1;
        events.push({ type: 'match', indexes: [a, b], symbol: state.tiles[a].symbol });
        const at = state.cursed.indexOf(state.tiles[a].symbol);
        if (at >= 0) {
            state.cursed.splice(at, 1);
            state.concentration = Math.min(state.startConcentration, state.concentration + 1);
            events.push({ type: 'curse-lifted', symbol: state.tiles[a].symbol });
        }
        if (state.found >= state.pairs) {
            state.over = true;
            state.cleared = true;
            events.push({ type: 'clear' });
        }
        return { ok: true, events };
    }

    state.concentration -= 1;
    events.push({ type: 'miss', indexes: [a, b] });
    const trap = state.cursed.includes(state.tiles[a].symbol) || state.cursed.includes(state.tiles[b].symbol);
    if (trap) {
        // The shuffle leaves nothing face up, so there is no pair to hide afterwards.
        shuffleUnmatched(state, rng);
        events.push({ type: 'shuffle' });
    } else {
        state.pending = [a, b];
    }
    if (state.concentration <= 0) {
        state.over = true;
        events.push({ type: 'exhausted' });
    }
    return { ok: true, events };
}

/** Knowledge gained: 5 per pair found, 2 per point of concentration left, 10 for clearing the board. */
export function knowledgeOf(state) {
    return state.found * 5 + Math.max(0, state.concentration) * 2 + (state.cleared ? 10 : 0);
}

/**
 * The grade. perfect: cleared with at least 60% of the concentration left; good: cleared;
 * fair: not cleared but at least half the pairs found; poor: anything less.
 */
export function gradeOf(state) {
    if (state.cleared) {
        return Math.max(0, state.concentration) >= Math.ceil(state.startConcentration * 0.6) ? 'perfect' : 'good';
    }
    return state.found * 2 >= state.pairs ? 'fair' : 'poor';
}

/**
 * What the game is worth. profXp is for the studying player; partnerProfXp is half of it, for a partner
 * who studies together; levelXp is small on purpose (combat stays the main route to levels).
 * @returns {{ grade: string, knowledge: number, profXp: number, partnerProfXp: number, levelXp: number, bond: { meter: string, amount: number } | null }}
 */
export function rewardsOf(state) {
    const grade = gradeOf(state);
    const mult = GRADE_XP[grade];
    const profXp = Math.round(state.pairs * 2 * mult);
    const levelXp = Math.round((5 + state.pairs) * mult);
    // Only a good or perfect session earns a bond nudge, and only a small one.
    const bond = grade === 'perfect' ? { meter: 'trust', amount: 1.5 } : grade === 'good' ? { meter: 'trust', amount: 1 } : null;
    return { grade, knowledge: knowledgeOf(state), profXp, partnerProfXp: Math.floor(profXp / 2), levelXp, bond };
}

/**
 * The game in plain words, for the partner's talk: "3 of 8 pairs found, a cursed tile is loose". `words` is the world's wording
 * ({ cursedTile }, from the preset's terms); without it the neutral "cursed tile" is used.
 */
export function describeState(state, words = {}) {
    const cursed = String(words?.cursedTile || 'cursed tile');
    const parts = [`${state.found} of ${state.pairs} pairs found`, `${Math.max(0, state.concentration)} of ${state.startConcentration} concentration left`];
    const seen = state.cursed.filter(s => state.known.includes(s)).length;
    if (seen) parts.push(seen === 1 ? `a ${cursed} is loose` : `${seen} ${cursed}s are loose`);
    if (state.shuffles) parts.push(state.shuffles === 1 ? 'the tiles were shuffled once' : `the tiles were shuffled ${state.shuffles} times`);
    if (state.over) parts.push(state.cleared ? 'the board is cleared' : 'concentration ran out');
    return parts.join(', ');
}

/** A repeatable rng for tests and replays (mulberry32). */
export function seeded(seed) {
    let a = Number(seed) >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
