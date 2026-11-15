/**
 * The group versions of four games (fork): pig, blackjack, five-card draw poker and short whist,
 * for the persona and up to three characters (see game-seats.js). The one-opponent versions in
 * modules/games/games.js are untouched; these run when more than one opponent sits down.
 *
 * Each engine is a plain state object and a few functions that change it, with no timers and no
 * screen, so the whole game can be played out in a test. The window decides who is a bot and
 * when to call the bot helpers. A bot's `disp` is its hidden attitude { mode: 'fair'|'cheat'|'throw', skill: 1..5 }.
 *
 * Pure: no DOM, no SillyTavern imports.
 */

import { buildDeck, rankValue, evalHand, cmpHand, handNameOf } from './table-cards.js';

const DEFAULT_DISP = Object.freeze({ mode: 'fair', skill: 3 });
const dispOf = (d) => ({ ...DEFAULT_DISP, ...(d || {}) });

/* ================================================================== PIG ===== */

/** Pig for any number of players: roll until you bank or roll a 1. First to the target wins. */
export function pigNew(names, target = 50) {
    return { players: names.map(name => ({ name, score: 0 })), turn: 0, turnTotal: 0, lastRoll: null, target, over: false, winner: null };
}

const pigAdvance = (s) => { s.turn = (s.turn + 1) % s.players.length; s.turnTotal = 0; s.lastRoll = null; };

/** Applies a die roll (the caller rolls, so a cheater's die can be loaded). */
export function pigRoll(s, roll) {
    if (s.over) return { ok: false };
    const who = s.players[s.turn].name;
    if (roll === 1) {
        s.lastRoll = 1;
        const lost = s.turnTotal;
        s.turnTotal = 0;
        pigAdvance(s);
        s.lastRoll = 1;
        return { ok: true, roll, bust: true, who, lost };
    }
    s.lastRoll = roll;
    s.turnTotal += roll;
    return { ok: true, roll, bust: false, who, total: s.turnTotal };
}

export function pigBank(s) {
    if (s.over || !(s.turnTotal > 0)) return { ok: false };
    const p = s.players[s.turn];
    const banked = s.turnTotal;
    p.score += banked;
    if (p.score >= s.target) {
        s.over = true;
        s.winner = p.name;
        s.turnTotal = 0;
        return { ok: true, banked, who: p.name, won: true };
    }
    pigAdvance(s);
    return { ok: true, banked, who: p.name, won: false };
}

/** What a bot rolls: a cheat never rolls a 1, a thrower often does. */
export function pigBotDie(disp, rng = Math.random) {
    const d = dispOf(disp);
    if (d.mode === 'cheat') return 2 + Math.floor(rng() * 5);
    if (d.mode === 'throw') return rng() < 0.55 ? 1 : 2 + Math.floor(rng() * 5);
    return 1 + Math.floor(rng() * 6);
}

export function pigBotShouldBank(s, disp) {
    const d = dispOf(disp);
    const me = s.players[s.turn];
    if (me.score + s.turnTotal >= s.target) return true;
    if (d.mode === 'throw') return false;
    if (d.mode === 'cheat') return s.turnTotal >= 24;
    return s.turnTotal >= 14 + d.skill * 2;
}

/* ============================================================= BLACKJACK ===== */

export function bjValue(cards) {
    let v = cards.reduce((a, c) => a + c.val, 0);
    let aces = cards.filter(c => c.rank === 'A').length;
    while (v > 21 && aces > 0) { v -= 10; aces--; }
    return v;
}

const bjDraw = (s, rng) => { if (!s.deck.length) s.deck = buildDeck(rng); return s.deck.pop(); };

/**
 * One dealer (a character who does not play) and the players, each against the dealer.
 * @param {string[]} players every player at the table, the persona included
 * @param {string} dealer the dealer's name
 */
export function bjNew(players, dealer, rng = Math.random) {
    const s = {
        deck: buildDeck(rng), rng,
        dealer: { name: dealer, cards: [] },
        players: players.map(name => ({ name, cards: [], status: 'playing' })),
        turn: 0, phase: 'players', results: null, winners: null,
    };
    for (let round = 0; round < 2; round++) {
        for (const p of s.players) p.cards.push(bjDraw(s, rng));
        s.dealer.cards.push(bjDraw(s, rng));
    }
    for (const p of s.players) if (bjValue(p.cards) === 21) p.status = 'blackjack';
    s.turn = -1;
    bjAdvance(s);
    return s;
}

/** Moves to the next player still playing; when there is none it is the dealer's turn. */
function bjAdvance(s) {
    for (let i = s.turn + 1; i < s.players.length; i++) {
        if (s.players[i].status === 'playing') { s.turn = i; return; }
    }
    s.turn = -1;
    s.phase = 'dealer';
}

export function bjHit(s) {
    if (s.phase !== 'players') return { ok: false };
    const p = s.players[s.turn];
    p.cards.push(bjDraw(s, s.rng));
    const v = bjValue(p.cards);
    if (v > 21) { p.status = 'bust'; bjAdvance(s); return { ok: true, who: p.name, value: v, bust: true }; }
    if (v === 21) { p.status = 'stand'; bjAdvance(s); }
    return { ok: true, who: p.name, value: v, bust: false };
}

export function bjStand(s) {
    if (s.phase !== 'players') return { ok: false };
    const p = s.players[s.turn];
    p.status = 'stand';
    bjAdvance(s);
    return { ok: true, who: p.name, value: bjValue(p.cards) };
}

/** What a bot player does: hit or stand, by the dealer's up card and its own skill. */
export function bjBotWantsHit(cards, dealerUp, skill = 3) {
    const v = bjValue(cards);
    if (v >= 17) return false;
    if (v <= 11) return true;
    if (skill < 3) return v < 15;
    return dealerUp >= 7;
}

/** The dealer plays out. Fair draws to 17; a cheat takes the card it needs; a thrower draws on to bust. */
export function bjDealerPlay(s, disp) {
    const d = dispOf(disp);
    const live = s.players.filter(p => p.status !== 'bust').map(p => bjValue(p.cards));
    const best = live.length ? Math.max(...live) : 0;
    const dv = () => bjValue(s.dealer.cards);
    let safety = 0;
    if (!live.length) {
        // everyone busted: the dealer does not need to draw
    } else if (d.mode === 'throw') {
        while (dv() > best && dv() <= 21 && s.deck.length && safety++ < 12) s.dealer.cards.push(bjDraw(s, s.rng));
    } else if (d.mode === 'cheat') {
        while (dv() <= best && dv() < 21 && s.deck.length && safety++ < 14) {
            let idx = s.deck.findIndex(c => { const v = bjValue(s.dealer.cards.concat(c)); return v <= 21 && v > best; });
            if (idx < 0) idx = s.deck.findIndex(c => bjValue(s.dealer.cards.concat(c)) <= 21);
            if (idx < 0) break;
            s.dealer.cards.push(s.deck.splice(idx, 1)[0]);
        }
    } else {
        while (dv() < 17 && s.deck.length && safety++ < 12) s.dealer.cards.push(bjDraw(s, s.rng));
    }
    return bjSettle(s);
}

/** Each player against the dealer. winners: the players who beat the dealer, else the dealer, else nobody (all pushed). */
export function bjSettle(s) {
    s.phase = 'done';
    const dv = bjValue(s.dealer.cards);
    s.results = s.players.map((p) => {
        const v = bjValue(p.cards);
        let outcome;
        if (v > 21) outcome = 'lose';
        else if (dv > 21) outcome = 'win';
        else if (v > dv) outcome = 'win';
        else if (v < dv) outcome = 'lose';
        else outcome = 'push';
        return { name: p.name, value: v, outcome };
    });
    const wins = s.results.filter(r => r.outcome === 'win').map(r => r.name);
    const pushes = s.results.some(r => r.outcome === 'push');
    s.winners = wins.length ? wins : (pushes ? [] : [s.dealer.name]);
    return s.results;
}

/* ================================================================= POKER ===== */

/**
 * Five-card draw for 2 to 4 seats. Each hand: ante, deal five, everyone draws in turn, one round
 * of betting, then the best hand takes the pot (ties split it). Bets are sized so that every seat
 * can always call, so there are no side pots.
 *
 * The dealer is a rotating button (the dealer plays), or a fixed dealer who deals and hosts but does
 * not play (`fixedDealer`, a name outside the seats).
 *
 * @param {string[]} names the players, the persona included
 * @param {{ fixedDealer?: string|null, user?: string, chips?: number, ante?: number, bet?: number }} [opts]
 */
export function pkNew(names, { fixedDealer = null, user = '', chips = 100, ante = 5, bet = 10 } = {}, rng = Math.random) {
    const s = {
        seats: names.map(name => ({ name, chips, hand: [], folded: false, out: false, paid: 0, acted: false, drew: false })),
        fixedDealer: fixedDealer || null, user, rng,
        ante, bet, button: 0, handNo: 0, pot: 0, phase: 'idle', actor: -1, order: [],
        currentBet: 0, limit: 0, raises: 0, deck: [], lastResult: null, over: false, winners: null,
    };
    pkDeal(s);
    return s;
}

const live = (s) => s.seats.map((x, i) => i).filter(i => !s.seats[i].out);
const inHand = (s) => s.seats.map((x, i) => i).filter(i => !s.seats[i].out && !s.seats[i].folded);

/** Who deals this hand: the fixed dealer, or the seat on the button. */
export const pkDealerName = (s) => s.fixedDealer || s.seats[s.button]?.name || '';

/** Seats in the order they act: starting left of the button (or, with a fixed dealer, rotating by hand). */
function actingOrder(s) {
    const ids = live(s);
    const startAfter = s.fixedDealer ? (s.handNo - 1 + ids.length) % ids.length : ids.indexOf(s.button);
    return ids.map((_, k) => ids[(startAfter + (s.fixedDealer ? k : k + 1)) % ids.length]);
}

/** Starts a hand: antes, five cards each. */
export function pkDeal(s) {
    s.handNo++;
    s.deck = buildDeck(s.rng);
    const ids = live(s);
    const ante = Math.min(s.ante, ...ids.map(i => s.seats[i].chips));
    s.pot = 0;
    for (const i of ids) {
        const seat = s.seats[i];
        seat.hand = [0, 1, 2, 3, 4].map(() => s.deck.pop());
        seat.folded = false; seat.paid = 0; seat.acted = false; seat.drew = false;
        seat.chips -= ante;
        s.pot += ante;
    }
    s.currentBet = 0; s.raises = 0; s.limit = 0; s.lastResult = null;
    s.phase = 'draw';
    s.order = actingOrder(s);
    s.actor = s.order[0];
}

/** One seat exchanges cards (a list of positions in their hand), then the next seat's turn. */
export function pkDraw(s, seatIdx, discard = [], tweak = null) {
    if (s.phase !== 'draw' || s.actor !== seatIdx) return { ok: false };
    const seat = s.seats[seatIdx];
    const picks = [...new Set(discard)].filter(i => i >= 0 && i < 5);
    for (const i of picks) if (s.deck.length) seat.hand[i] = s.deck.pop();
    // a cheat's own hand is changed here, before the turn passes and before any pot is decided
    if (tweak) tweak(seat, s);
    seat.drew = true;
    const next = s.order.find(i => !s.seats[i].drew);
    if (next === undefined) pkStartBetting(s);
    else s.actor = next;
    return { ok: true, count: picks.length };
}

function pkStartBetting(s) {
    const ids = inHand(s);
    const minChips = Math.min(...ids.map(i => s.seats[i].chips));
    // a bet and one raise must both be callable by every seat
    s.limit = Math.min(s.bet, Math.floor(minChips / 2));
    s.currentBet = 0; s.raises = 0;
    for (const i of ids) { s.seats[i].paid = 0; s.seats[i].acted = false; }
    if (s.limit < 1) { pkShowdown(s); return; }
    s.phase = 'bet';
    s.actor = s.order.find(i => !s.seats[i].out && !s.seats[i].folded);
}

/** What a seat may do right now. */
export function pkOptions(s, seatIdx) {
    if (s.phase !== 'bet' || s.actor !== seatIdx) return [];
    const seat = s.seats[seatIdx];
    if (s.currentBet === 0) return ['check', 'bet'];
    const out = ['call', 'fold'];
    if (s.raises < 1 && seat.chips >= s.currentBet + s.limit - seat.paid) out.splice(1, 0, 'raise');
    return out;
}

/** The chips an action puts in. */
export function pkCost(s, seatIdx, action) {
    const seat = s.seats[seatIdx];
    if (action === 'bet') return s.limit;
    if (action === 'call') return s.currentBet - seat.paid;
    if (action === 'raise') return s.currentBet + s.limit - seat.paid;
    return 0;
}

export function pkAct(s, seatIdx, action) {
    if (!pkOptions(s, seatIdx).includes(action)) return { ok: false };
    const seat = s.seats[seatIdx];
    const cost = pkCost(s, seatIdx, action);
    seat.chips -= cost; seat.paid += cost; s.pot += cost;
    seat.acted = true;
    if (action === 'fold') seat.folded = true;
    if (action === 'bet') s.currentBet = s.limit;
    if (action === 'raise') {
        s.currentBet += s.limit; s.raises++;
        for (const i of inHand(s)) if (i !== seatIdx) s.seats[i].acted = false;
    }
    const left = inHand(s);
    if (left.length === 1) { pkAward(s, left, false); return { ok: true, action, cost, who: seat.name }; }
    const pending = s.order.filter(i => inHand(s).includes(i) && (!s.seats[i].acted || s.seats[i].paid < s.currentBet));
    if (!pending.length) { pkShowdown(s); return { ok: true, action, cost, who: seat.name }; }
    // the next one after this seat, in order
    const at = s.order.indexOf(seatIdx);
    const after = [...s.order.slice(at + 1), ...s.order.slice(0, at + 1)];
    s.actor = after.find(i => pending.includes(i));
    return { ok: true, action, cost, who: seat.name };
}

export function pkShowdown(s) {
    const ids = inHand(s);
    let best = [ids[0]];
    for (const i of ids.slice(1)) {
        const c = cmpHand(s.seats[i].hand, s.seats[best[0]].hand);
        if (c > 0) best = [i]; else if (c === 0) best.push(i);
    }
    pkAward(s, best, true);
}

function pkAward(s, winnerIdx, showdown) {
    const pot = s.pot;
    const share = Math.floor(pot / winnerIdx.length);
    winnerIdx.forEach((i, k) => { s.seats[i].chips += share + (k === 0 ? pot - share * winnerIdx.length : 0); });
    s.pot = 0;
    s.phase = 'result';
    s.lastResult = {
        winners: winnerIdx.map(i => s.seats[i].name), pot, showdown,
        hands: Object.fromEntries(inHand(s).map(i => [s.seats[i].name, handNameOf(s.seats[i].hand)])),
    };
    for (const seat of s.seats) if (!seat.out && seat.chips <= 0) { seat.out = true; seat.folded = true; }
    const alive = live(s);
    const userOut = s.user && s.seats.find(x => x.name === s.user)?.out;
    if (alive.length === 1) { s.over = true; s.winners = [s.seats[alive[0]].name]; }
    else if (userOut) {
        // the persona is out: the game ends with whoever holds the most chips
        const top = Math.max(...alive.map(i => s.seats[i].chips));
        s.over = true;
        s.winners = alive.filter(i => s.seats[i].chips === top).map(i => s.seats[i].name);
    }
}

/** The next hand: the button moves on, anyone out of chips sits out. */
export function pkNextHand(s) {
    if (s.over || s.phase !== 'result') return false;
    const ids = live(s);
    s.button = ids[(ids.indexOf(s.button) + 1) % ids.length] ?? ids[0];
    pkDeal(s);
    return true;
}

/** Which of a hand's cards a bot throws back. */
export function pkBotDiscard(hand, disp) {
    const d = dispOf(disp);
    if (d.mode === 'throw') {
        let lo = 0;
        hand.forEach((c, i) => { if (rankValue(c.rank) < rankValue(hand[lo].rank)) lo = i; });
        return [0, 1, 2, 3, 4].filter(i => i !== lo);
    }
    const counts = {};
    hand.forEach(c => { counts[c.rank] = (counts[c.rank] || 0) + 1; });
    const suits = {};
    hand.forEach(c => { suits[c.suit] = (suits[c.suit] || 0) + 1; });
    const flushSuit = Object.keys(suits).find(k => suits[k] >= 4) || null;
    const keep = hand.map(c => (flushSuit ? c.suit === flushSuit : counts[c.rank] >= 2));
    if (keep.every(k => !k)) {
        let hi = 0;
        hand.forEach((c, i) => { if (rankValue(c.rank) > rankValue(hand[hi].rank)) hi = i; });
        keep[hi] = true;
    }
    return keep.map((k, i) => (k ? -1 : i)).filter(i => i >= 0);
}

/** A bot's whole draw. A cheat then swaps in the best cards it can find in the deck. */
export function pkBotDraw(s, seatIdx, disp) {
    const d = dispOf(disp);
    const seat = s.seats[seatIdx];
    const cheat = (me, game) => {
        for (let n = 0; n < 2; n++) {
            let wi = 0;
            me.hand.forEach((c, i) => { if (rankValue(c.rank) < rankValue(me.hand[wi].rank)) wi = i; });
            let bestK = -1;
            let bestCmp = 0;
            for (let k = 0; k < game.deck.length; k++) {
                const saved = me.hand[wi];
                const rest = me.hand.filter((_, i) => i !== wi);
                const c = cmpHand([game.deck[k], ...rest], [saved, ...rest]);
                if (c > bestCmp) { bestCmp = c; bestK = k; }
            }
            if (bestK < 0) break;
            me.hand[wi] = game.deck.splice(bestK, 1)[0];
        }
    };
    return pkDraw(s, seatIdx, pkBotDiscard(seat.hand, d), d.mode === 'cheat' ? cheat : null);
}

/** A bot's betting action. A cheat knows whether it is best; a thrower never wants the pot. */
export function pkBotAct(s, seatIdx, disp, rng = Math.random) {
    const d = dispOf(disp);
    const options = pkOptions(s, seatIdx);
    if (!options.length) return null;
    const hand = s.seats[seatIdx].hand;
    const cat = evalHand(hand)[0];
    const facing = options.includes('call');
    if (d.mode === 'throw') return facing ? 'fold' : 'check';
    const best = d.mode === 'cheat' && inHand(s).every(i => i === seatIdx || cmpHand(hand, s.seats[i].hand) > 0);
    if (!facing) {
        const bet = d.mode === 'cheat' ? best : (cat >= 2 || (cat >= 1 && rng() < d.skill / 6));
        return bet ? 'bet' : 'check';
    }
    if (d.mode === 'cheat') return best ? (options.includes('raise') ? 'raise' : 'call') : 'fold';
    if (cat >= 4 && options.includes('raise')) return 'raise';
    if (cat >= 1 || rng() < d.skill / 8) return 'call';
    return 'fold';
}

/* ================================================================= WHIST ===== */

const WHIST_RANKS = ['8', '9', '10', 'J', 'Q', 'K', 'A'];
export const WHIST_TRICKS = 7;

/**
 * Short whist for four: seats go round the table, the persona at 0 and their partner opposite
 * (seat 2) against seats 1 and 3. Seven cards each (8 up to ace); the last card dealt names trumps.
 * @param {string[]} names the four players in seat order
 */
export function wNew(names, rng = Math.random) {
    const deck = buildDeck(rng, WHIST_RANKS);
    const hands = [0, 1, 2, 3].map(() => []);
    for (let i = 0; i < WHIST_TRICKS * 4; i++) hands[i % 4].push(deck[i]);
    const trump = deck[deck.length - 1].suit;
    for (const h of hands) wSort(h, trump);
    return { names, hands, trump, trick: [], led: null, lead: 0, turn: 0, tricks: [0, 0, 0, 0], pending: null, over: false, winners: null, winnerTeam: null, played: 0 };
}

const SUIT_ORDER = { '♠': 0, '♥': 1, '♣': 2, '♦': 3 };
function wSort(hand, trump) {
    hand.sort((a, b) => (a.suit === trump ? -1 : 0) - (b.suit === trump ? -1 : 0) || SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit] || rankValue(b.rank) - rankValue(a.rank));
}

export const wTeamOf = (seat) => seat % 2;

/** The cards a seat may play now: they must follow the suit led if they can. */
export function wLegal(hand, led) {
    if (!led) return [...hand];
    const follow = hand.filter(c => c.suit === led);
    return follow.length ? follow : [...hand];
}

export function wStrength(card, led, trump) {
    if (card.suit === trump) return 200 + rankValue(card.rank);
    if (card.suit === led) return 100 + rankValue(card.rank);
    return rankValue(card.rank);
}

export function wPlay(s, seat, card) {
    if (s.over || s.pending || s.turn !== seat) return { ok: false, reason: 'Not your turn.' };
    const hand = s.hands[seat];
    if (!hand.includes(card)) return { ok: false, reason: 'You do not hold that card.' };
    if (!wLegal(hand, s.led).includes(card)) return { ok: false, reason: `Follow ${s.led}.` };
    if (!s.led) s.led = card.suit;
    hand.splice(hand.indexOf(card), 1);
    s.trick.push({ seat, card });
    s.played++;
    if (s.trick.length < 4) { s.turn = (seat + 1) % 4; return { ok: true }; }
    // the trick is complete; it stays on the table until wClear
    let win = s.trick[0];
    for (const t of s.trick.slice(1)) if (wStrength(t.card, s.led, s.trump) > wStrength(win.card, s.led, s.trump)) win = t;
    s.tricks[win.seat]++;
    s.pending = { winner: win.seat, trick: [...s.trick] };
    return { ok: true, trickWinner: win.seat };
}

/** Takes the finished trick off the table: the winner leads, or the game ends. */
export function wClear(s) {
    if (!s.pending) return false;
    const { winner } = s.pending;
    s.pending = null; s.trick = []; s.led = null;
    s.lead = s.turn = winner;
    if (s.hands.every(h => !h.length)) {
        const team = [s.tricks[0] + s.tricks[2], s.tricks[1] + s.tricks[3]];
        s.over = true;
        s.winnerTeam = team[0] > team[1] ? 0 : 1;
        s.winners = [0, 1, 2, 3].filter(i => wTeamOf(i) === s.winnerTeam).map(i => s.names[i]);
    }
    return true;
}

/** A bot's card: partner winning, play low; otherwise win as cheaply as it can; leading, play high (a cheat leads trumps; a thrower plays low). */
export function wBotChoose(s, seat, disp) {
    const d = dispOf(disp);
    const hand = s.hands[seat];
    const legal = wLegal(hand, s.led);
    const byLow = [...legal].sort((a, b) => wStrength(a, s.led, s.trump) - wStrength(b, s.led, s.trump));
    if (!s.led) {
        const byHigh = [...legal].sort((a, b) => rankValue(b.rank) - rankValue(a.rank));
        if (d.mode === 'throw') return byHigh[byHigh.length - 1];
        if (d.mode === 'cheat') return byHigh.find(c => c.suit === s.trump) || byHigh[0];
        return byHigh.find(c => c.suit !== s.trump) || byHigh[0];
    }
    let top = s.trick[0];
    for (const t of s.trick.slice(1)) if (wStrength(t.card, s.led, s.trump) > wStrength(top.card, s.led, s.trump)) top = t;
    const partnerWinning = wTeamOf(top.seat) === wTeamOf(seat);
    const topStrength = wStrength(top.card, s.led, s.trump);
    const winners = byLow.filter(c => wStrength(c, s.led, s.trump) > topStrength);
    if (d.mode === 'throw') return byLow.filter(c => wStrength(c, s.led, s.trump) <= topStrength).pop() || byLow[0];
    if (partnerWinning) return byLow[0];
    return winners[0] || byLow[0];
}
