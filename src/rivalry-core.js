/**
 * The record of fights, spars and games between the people in a chat (fork).
 *
 * Kept per chat (the I/O is in rivalry.js), and every entry can be edited or removed, so a
 * rivalry is whatever the player wants it to be.
 *
 * A record has two sides, each a list of names, and a winner side:
 *   { id, at, kind, game, sideA: [name], sideB: [name], winner: 'A'|'B'|'draw',
 *     userSide: 'A'|'B'|'', player, opponent, result, summary, note,
*     spectators?: [name], fled?: [name] }  (spectators only when someone watched; they are not on a side)
 * fled (fork) names those who ran from the fight. The winner is still the side that held the field;
 * each one who ran counts the fight as fled, not won or lost (tally, tallyText).
 * userSide says which side the player (the user's persona) was on, '' when only other people
 * took part. player is the player's name as it was recorded. opponent and result are the old
 * single-opponent fields; they are kept, derived from the sides, so older readers still work:
 * opponent is the first person on the side facing the player (or side B), result is from the
 * player's side (or side A's when the player was not there).
 *
 * Records written before sides existed ({ player, opponent, result }, results from the
 * player's side) are turned into this shape when they are read: the player on side A, the
 * opponent on side B. Nothing they held is dropped.
 *
 * Pure: no DOM, no SillyTavern imports.
 */

export const RESULTS = Object.freeze(['won', 'lost', 'draw']);
export const KINDS = Object.freeze(['combat', 'game']);
export const SIDES = Object.freeze(['A', 'B']);
export const WINNERS = Object.freeze(['A', 'B', 'draw']);
const MAX_RECORDS = 500;
const MAX_SIDE = 12;

const str = (v, max = 400) => String(v ?? '').trim().slice(0, max);
const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const other = (side) => (side === 'A' ? 'B' : 'A');

export function newId() {
    return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** A side as a clean list: names trimmed, blanks and repeats (ignoring case) dropped. */
export function sideList(v) {
    const raw = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [];
    const out = [];
    for (const n of raw) {
        const name = str(n, 80);
        if (name && !out.some(x => same(x, name))) out.push(name);
    }
    return out.slice(0, MAX_SIDE);
}

const resultOf = (winner, side) => (winner === 'draw' || !side ? 'draw' : winner === side ? 'won' : 'lost');
const winnerFrom = (result, side) => (result === 'won' ? side : result === 'lost' ? other(side) : 'draw');

/** A record with every field present and sane. Old single-opponent records are migrated. */
export function normalizeRecord(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const player = str(r.player, 80);
    let sideA;
    let sideB;
    let winner;
    let userSide;
    if (Array.isArray(r.sideA) || Array.isArray(r.sideB)) {
        sideA = sideList(r.sideA);
        sideB = sideList(r.sideB);
        userSide = SIDES.includes(r.userSide) ? r.userSide : '';
        if (WINNERS.includes(r.winner)) winner = r.winner;
        // A result alone (an older writer, or a patch that only set it) still counts.
        else winner = RESULTS.includes(r.result) ? winnerFrom(r.result, userSide || 'A') : 'draw';
    } else {
        // Before sides: the player against one opponent, the result from the player's side.
        sideA = sideList(player ? [player] : []);
        sideB = sideList([r.opponent]);
        userSide = 'A';
        winner = winnerFrom(RESULTS.includes(r.result) ? r.result : 'draw', 'A');
    }
    // The player is on one side only.
    if (userSide && player) {
        const off = userSide === 'A' ? sideB : sideA;
        const i = off.findIndex(n => same(n, player));
        if (i >= 0) off.splice(i, 1);
    }
    const facing = userSide ? (userSide === 'A' ? sideB : sideA) : sideB;
    // The game or fight this record came from: the same id its table talk is kept under, so the
    // two are known to be one event. Older records have none (see rivalry-inject-core.js).
    const event = str(r.event, 60).replace(/[^A-Za-z0-9_-]/g, '');
    // People who watched but did not fight: named in the history, never counted in a result.
    const spectators = sideList(r.spectators).filter(n => !sideA.some(x => same(x, n)) && !sideB.some(x => same(x, n)) && !same(n, player));
    // Those who ran: only people who were in it.
    const fled = sideList(r.fled).filter(n => sideA.some(x => same(x, n)) || sideB.some(x => same(x, n)) || (userSide && same(n, player)));
    const playerRan = Boolean(userSide && player && fled.some(n => same(n, player)));
    return {
        ...(event ? { event } : {}),
        ...(spectators.length ? { spectators } : {}),
        ...(fled.length ? { fled } : {}),
        id: str(r.id, 40) || newId(),
        at: Number.isFinite(Number(r.at)) ? Number(r.at) : Date.now(),
        kind: KINDS.includes(r.kind) ? r.kind : 'combat',
        game: str(r.game, 60),
        sideA,
        sideB,
        winner,
        userSide,
        player,
        opponent: facing.find(n => !same(n, player)) || '',
        result: playerRan ? 'fled' : resultOf(winner, userSide || 'A'),
        summary: str(r.summary, 600),
        note: str(r.note, 600),
    };
}

/** Everyone in a record other than the player, side A first. */
export function othersIn(record) {
    const r = record?.sideA ? record : normalizeRecord(record);
    return [...r.sideA, ...r.sideB].filter(n => !(r.userSide && same(n, r.player)));
}

/** Kept only when someone other than the player took part. */
export function normalizeStore(raw) {
    const list = Array.isArray(raw?.records) ? raw.records : [];
    return { records: list.map(normalizeRecord).filter(r => othersIn(r).length).slice(-MAX_RECORDS) };
}

/** Records as normalized ones; already normalized ones are used as they are. */
export const asRecords = (records) => (records || []).map(r => (r && Array.isArray(r.sideA) && Array.isArray(r.sideB) && WINNERS.includes(r.winner) && typeof r.userSide === 'string' ? r : normalizeRecord(r)));

/**
 * The names on one side, as they should be shown. The player's slot is filled with playerName
 * when the record has the player on that side but no name for them.
 */
export function sideNames(record, side, playerName = '') {
    const list = (side === 'A' ? record.sideA : record.sideB) || [];
    if (record.userSide === side && playerName && !list.some(n => same(n, record.player) || same(n, playerName))) {
        return [playerName, ...list];
    }
    return list.slice();
}

/** Which side a person was on, or '' when they were not in it. The player matches by name too. */
export function sideOf(record, person) {
    if (!person) return '';
    if (record.sideA.some(n => same(n, person))) return 'A';
    if (record.sideB.some(n => same(n, person))) return 'B';
    if (record.userSide && record.player && same(record.player, person)) return record.userSide;
    return '';
}

/** Whether a person ran from this fight (fork). */
export const ranFrom = (record, person) => Boolean(person) && (record.fled || []).some(n => same(n, person));

/** Whether a person took part, on either side. */
export const tookPart = (record, person) => Boolean(sideOf(record, person));

/** Whether a person looked on (a spectator) without fighting. */
export const watched = (record, person) => Boolean(person) && (record.spectators || []).some(n => same(n, person));

/**
 * Whether a person knows of this fight: they fought in it or they watched it. Anyone else does
 * not, so it never reaches what they know or how they talk. Wins and losses still count only
 * what they took part in.
 */
export const knowsOf = (record, person) => tookPart(record, person) || watched(record, person);

/** Every person (not the player) with at least one record, in the order they first appear. */
export function peopleIn(records, playerName = '') {
    const names = [];
    for (const r of asRecords(records)) {
        for (const n of [...othersIn(r), ...(r.spectators || [])]) {
            if (playerName && same(n, playerName)) continue;
            if (!names.some(x => same(x, n))) names.push(n);
        }
    }
    return names;
}

const emptyTally = () => ({ won: 0, lost: 0, draw: 0, others: 0, total: 0 });
/** Counts one result. `fled` (fork) is only there once someone has run, so older tallies look the same. */
const count = (out, key) => { out[key] = (out[key] || 0) + 1; };

/**
 * Wins, losses and draws, by kind.
 *
 * With a person: only the records they took part in, each counted from their own side.
 * Without one: every record, from the player's side; records the player was not in are
 * counted under `others`.
 */
export function tally(records, person, kind) {
    const out = emptyTally();
    for (const r of asRecords(records)) {
        if (kind && r.kind !== kind) continue;
        if (person) {
            const side = sideOf(r, person);
            if (!side) continue;
            count(out, ranFrom(r, person) ? 'fled' : resultOf(r.winner, side));
        } else if (r.userSide) {
            count(out, ranFrom(r, r.player) ? 'fled' : resultOf(r.winner, r.userSide));
        } else {
            out.others++;
        }
        out.total++;
    }
    return out;
}

/** The player's record against one person: only where the two were on opposite sides. */
export function tallyVsPlayer(records, opponent, kind) {
    const out = emptyTally();
    for (const r of asRecords(records)) {
        if (kind && r.kind !== kind) continue;
        if (!r.userSide) continue;
        const side = sideOf(r, opponent);
        if (!side || side === r.userSide) continue;
        count(out, ranFrom(r, r.player) ? 'fled' : resultOf(r.winner, r.userSide));
        out.total++;
    }
    return out;
}

/** "2 won, 1 lost" for display. */
export function tallyText(t) {
    if (!t.total) return 'no history yet';
    const bits = [];
    if (t.won) bits.push(`${t.won} won`);
    if (t.lost) bits.push(`${t.lost} lost`);
    if (t.draw) bits.push(`${t.draw} drawn`);
    if (t.fled) bits.push(`${t.fled} fled`);
    if (t.others) bits.push(`${t.others} between others`);
    return bits.join(', ');
}

const joinNames = (names) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] || 'someone');

/** "Ana and Cleo vs Ben" */
export function sidesText(record, playerName = '') {
    return `${joinNames(sideNames(record, 'A', playerName))} vs ${joinNames(sideNames(record, 'B', playerName))}`;
}

/** "Ana and Cleo won", or "a draw"; with who ran, when someone did: "Ana won, Ben fled". */
export function winnerText(record, playerName = '') {
    const base = record.winner === 'draw' ? 'a draw' : `${joinNames(sideNames(record, record.winner, playerName))} won`;
    return record.fled?.length ? `${base}, ${joinNames(record.fled)} fled` : base;
}

/** One record as a line: its summary, or who faced whom and who won. Plus the note. */
export function recordLine(record, playerName = '') {
    const r = asRecords([record])[0];
    const what = r.game || (r.kind === 'game' ? 'A game' : 'A fight');
    const text = r.summary || `${what}: ${sidesText(r, playerName)}, ${winnerText(r, playerName)}`;
    return `${text}${r.note ? ` (${r.note})` : ''}`;
}

/** "Ben and Dan fought alongside Ana against Eve" style text for a summary. */
export function companyText(record, person, playerName = '') {
    const side = sideOf(record, person);
    if (!side) return '';
    const mates = sideNames(record, side, playerName).filter(n => !same(n, person));
    const foes = sideNames(record, other(side), playerName);
    return `${person}${mates.length ? ` alongside ${joinNames(mates)}` : ''} against ${joinNames(foes)}`;
}

/**
 * A short paragraph for a prompt: how this person's fights and games have gone, so a rivalry
 * shows up in how they talk. Only records they took part in. Empty when there is nothing.
 */
export function describeRivalry(records, person, playerName = 'the player') {
    const mine = asRecords(records).filter(r => knowsOf(r, person));
    if (!mine.length) return '';
    const fights = tally(mine, person, 'combat');
    const games = tally(mine, person, 'game');
    const parts = [];
    if (fights.total) parts.push(`${fights.total} fight${fights.total === 1 ? '' : 's'} (${tallyText(fights)})`);
    if (games.total) parts.push(`${games.total} game${games.total === 1 ? '' : 's'} (${tallyText(games)})`);
    const looked = mine.filter(r => !tookPart(r, person)).length;
    if (looked) parts.push(`watched ${looked} more`);
    const recent = mine.slice(-4).map(r => `${tookPart(r, person) ? '' : '[watched] '}${recordLine(r, playerName)}`);
    return `[HISTORY OF ${person.toUpperCase()} (WITH ${playerName.toUpperCase()} AND OTHERS): ${parts.join('; ')}. Results are from ${person}'s side. Most recent: ${recent.join(' | ')}. Let it colour how ${person} behaves; do not recite it.]`;
}
