/**
 * Who can sit at which game (fork), and how a finished table is written into the history.
 *
 * Group games: up to MAX_TABLE_OPPONENTS characters besides the persona (so a table of four).
 * Chess, tic-tac-toe, battleship and rock-paper-scissors are two-player and stay that way.
 *
 * The history builders write the same two records a fight does (see combat-talk.js): the rivalry
 * record and the table-talk entry, naming everyone involved. A one-against-one game is written
 * exactly as it always was. A table where one person beat several others, or one of several
 * opponents won, is written as the winner(s) against the rest, so every player's win or loss comes
 * out right in their own history.
 *
 * Pure: no DOM, no SillyTavern imports, so node can test it.
 */

/** Characters at a table besides the persona: 3 makes a table of four. */
export const MAX_TABLE_OPPONENTS = 3;

/**
 * min/max: opponents besides the persona. ready: whether the game itself plays a table (the rest
 * are still against one opponent, see the review notes). dealer: the game has a dealer role.
 */
export const GAME_TABLES = Object.freeze({
    chess: { min: 1, max: 1, ready: true },
    ttt: { min: 1, max: 1, ready: true },
    bs: { min: 1, max: 1, ready: true },
    rps: { min: 1, max: 1, ready: true },
    pig: { min: 1, max: MAX_TABLE_OPPONENTS, ready: false },
    bj: { min: 1, max: MAX_TABLE_OPPONENTS, ready: false, dealer: true },
    poker: { min: 1, max: MAX_TABLE_OPPONENTS, ready: false, dealer: true },
    whist: { min: 1, max: MAX_TABLE_OPPONENTS, ready: false, exact: [1, MAX_TABLE_OPPONENTS] },
    bottle: { min: 1, max: MAX_TABLE_OPPONENTS, ready: true },
});

const table = (type) => GAME_TABLES[type] || { min: 1, max: 1, ready: true };

/** The most opponents this game seats. */
export const tableLimit = (type) => table(type).max;

/** Whether the game is meant for more than two players. */
export const allowsGroup = (type) => table(type).max > 1;

/** Whether the game can be played as a group right now (the rest are one opponent for the time being). */
export const groupReady = (type) => allowsGroup(type) && table(type).ready === true;

/** The opponents the game can seat, in order, nobody twice, never the persona. */
export function clampTable(type, names, persona = '') {
    const out = [];
    for (const raw of names || []) {
        const n = String(raw ?? '').trim();
        if (!n || n.toLowerCase() === String(persona).trim().toLowerCase()) continue;
        if (!out.some(x => x.toLowerCase() === n.toLowerCase())) out.push(n);
    }
    return out.slice(0, tableLimit(type));
}

/** Whether this many opponents is a table the game accepts (whist wants a partner and two foes, or one foe). */
export function tableOk(type, count) {
    const t = table(type);
    if (count < t.min || count > t.max) return false;
    return !t.exact || t.exact.includes(count);
}

const list = (names) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] || 'someone');
const uniq = (names) => [...new Set((names || []).map(n => String(n ?? '').trim()).filter(Boolean))];

/**
 * The rivalry record for a finished game. players: everyone at the table, the persona included;
 * winners: who won (empty for a draw).
 * @param {{ id: string, label: string, user: string, players: string[], winners?: string[], spectators?: string[], at?: number }} g
 */
export function gameRecord({ id, label, user, players, winners = [], spectators = [], at, summary = '', teams = null, versus = '' }) {
    const everyone = uniq(players);
    // versus: a game where each player faces one person, not each other (blackjack's dealer). Only that pair is the contest.
    const all = versus ? everyone.filter(n => n === user || n === versus) : everyone;
    const others = all.filter(n => n !== user);
    const won = uniq(winners).filter(n => all.includes(n));
    const watchers = uniq(spectators).filter(n => !all.includes(n));
    const userWon = won.includes(user);
    let sideA;
    let sideB;
    let winner;
    let userSide;
    let result;
    const teamA = teams ? uniq(teams.a) : [];
    const teamB = teams ? uniq(teams.b) : [];
    if (teamA.includes(user) && teamB.length) {
        // A real team game (whist): the persona's team against the other, and the team that won.
        sideA = teamA;
        sideB = teamB;
        userSide = 'A';
        winner = !won.length ? 'draw' : userWon ? 'A' : 'B';
        result = !won.length ? `${list(teamA)} drew with ${list(teamB)}`
            : userWon ? `${list(teamA)} beat ${list(teamB)}` : `${list(teamB)} beat ${list(teamA)}`;
    } else if (!won.length) {
        sideA = [user];
        sideB = others;
        winner = 'draw';
        userSide = 'A';
        result = `${user} drew with ${list(others)}`;
    } else if (userWon) {
        // Everyone plays for themselves: the persona beat the others, but not the ones who won alongside them.
        const beaten = others.filter(n => !won.includes(n));
        sideA = [user];
        sideB = beaten.length ? beaten : others;
        winner = beaten.length ? 'A' : 'draw';
        userSide = 'A';
        result = beaten.length ? `${user} beat ${list(beaten)}` : `${user} shared the win with ${list(others)}`;
    } else if (others.every(n => won.includes(n))) {
        // Everyone else won (a game for two, or a dealer who beat the persona): the persona against them, and they won.
        sideA = [user];
        sideB = others;
        winner = 'B';
        userSide = 'A';
        result = `${list(others)} beat ${user}`;
    } else {
        // Someone else won. Each loser lost to them in their own history; this is not a team (see the summary).
        const lost = all.filter(n => !won.includes(n));
        sideA = won;
        sideB = lost;
        winner = 'A';
        userSide = 'B';
        result = `${list(won)} beat ${list(lost)}`;
    }
    return {
        ...(id ? { event: id } : {}),
        ...(at ? { at } : {}),
        kind: 'game', game: label,
        sideA, sideB,
        ...(watchers.length ? { spectators: watchers } : {}),
        winner, userSide, player: user,
        summary: summary || `${result} at ${label}.`,
    };
}

/** The table-talk entry for a game: everyone who sat down, what was said, how it ended. */
export function gameTalkEntry({ id, at = Date.now(), label, user, players, spectators = [], date = '', lines = [], result = '', teams = null }) {
    const others = uniq(players).filter(n => n !== user);
    const watchers = uniq(spectators).filter(n => n !== user && !others.includes(n));
    // Sides only where there are sides: a game for two, or real teams. Everyone else at a table is just "with".
    const teamA = teams ? uniq(teams.a) : [];
    const teamB = teams ? uniq(teams.b) : [];
    const sides = teamA.includes(user) && teamB.length ? { sideA: teamA, sideB: teamB }
        : others.length === 1 ? { sideA: [user], sideB: others } : {};
    return {
        id, at, title: label,
        with: [...others, ...watchers],
        ...sides,
        ...(watchers.length ? { spectators: watchers } : {}),
        date, lines, result,
    };
}
