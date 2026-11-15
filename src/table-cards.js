/**
 * Playing cards for the table games (fork): a deck, and what a five-card hand is worth. The same
 * cards and the same hand ranking the one-opponent games use (modules/games/games.js), here so the
 * group versions can be tested without a screen.
 *
 * A card is { rank, suit, val, red }: val is the blackjack value, rankValue(rank) the poker one.
 *
 * Pure: no DOM, no SillyTavern imports.
 */

export const RANK_VALUE = Object.freeze({ A: 14, K: 13, Q: 12, J: 11, 10: 10, 9: 9, 8: 8, 7: 7, 6: 6, 5: 5, 4: 4, 3: 3, 2: 2 });
export const rankValue = (rank) => RANK_VALUE[rank];

const SUITS = [['♠', false], ['♣', false], ['♥', true], ['♦', true]];
const BJ_RANKS = [['A', 11], ['2', 2], ['3', 3], ['4', 4], ['5', 5], ['6', 6], ['7', 7], ['8', 8], ['9', 9], ['10', 10], ['J', 10], ['Q', 10], ['K', 10]];

/** A shuffled deck. `ranks` limits it to some ranks (short whist uses 8 up to ace). */
export function buildDeck(rng = Math.random, ranks = null) {
    const deck = [];
    for (const [suit, red] of SUITS) {
        for (const [rank, val] of BJ_RANKS) {
            if (!ranks || ranks.includes(rank)) deck.push({ rank, suit, val, red });
        }
    }
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

export const HAND_NAMES = Object.freeze(['High card', 'Pair', 'Two pair', 'Three of a kind', 'Straight', 'Flush', 'Full house', 'Four of a kind', 'Straight flush', 'Royal flush']);

/** [category, ...tie-breakers] for five cards: higher is better, compared left to right. */
export function evalHand(cards) {
    const vals = cards.map(c => rankValue(c.rank)).sort((a, b) => b - a);
    const isFlush = cards.every(c => c.suit === cards[0].suit);
    const uniq = [...new Set(vals)].sort((a, b) => b - a);
    let isStraight = false;
    let straightHigh = 0;
    if (uniq.length === 5) {
        if (uniq[0] - uniq[4] === 4) { isStraight = true; straightHigh = uniq[0]; }
        else if (uniq[0] === 14 && uniq[1] === 5 && uniq[2] === 4 && uniq[3] === 3 && uniq[4] === 2) { isStraight = true; straightHigh = 5; }
    }
    const counts = {};
    vals.forEach(v => { counts[v] = (counts[v] || 0) + 1; });
    const groups = Object.entries(counts).map(([v, c]) => [c, parseInt(v, 10)]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
    const countsArr = groups.map(g => g[0]);
    const orderedVals = groups.map(g => g[1]);
    let cat;
    if (isStraight && isFlush) cat = straightHigh === 14 ? 9 : 8;
    else if (countsArr[0] === 4) cat = 7;
    else if (countsArr[0] === 3 && countsArr[1] === 2) cat = 6;
    else if (isFlush) cat = 5;
    else if (isStraight) cat = 4;
    else if (countsArr[0] === 3) cat = 3;
    else if (countsArr[0] === 2 && countsArr[1] === 2) cat = 2;
    else if (countsArr[0] === 2) cat = 1;
    else cat = 0;
    let tb;
    if (cat === 4 || cat === 8) tb = [straightHigh];
    else if (cat === 5 || cat === 0) tb = vals;
    else tb = orderedVals;
    return [cat, ...tb];
}

/** Positive when hand a beats hand b, negative when b beats a, 0 for a tie. */
export function cmpHand(a, b) {
    const x = evalHand(a);
    const y = evalHand(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
        const d = (x[i] || 0) - (y[i] || 0);
        if (d) return d;
    }
    return 0;
}

export const handNameOf = (cards) => HAND_NAMES[evalHand(cards)[0]];
