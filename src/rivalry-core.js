/**
 * The record of fights, spars and games between the player and the people in a chat (fork).
 *
 * Kept per chat (the I/O is in rivalry.js), and every entry can be edited or removed, so a
 * rivalry is whatever the player wants it to be. Results are always from the player's side.
 *
 * Pure: no DOM, no SillyTavern imports.
 */

export const RESULTS = Object.freeze(['won', 'lost', 'draw']);
export const KINDS = Object.freeze(['combat', 'game']);
const MAX_RECORDS = 500;

const str = (v, max = 400) => String(v ?? '').trim().slice(0, max);

export function newId() {
    return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** A record with every field present and sane. */
export function normalizeRecord(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    return {
        id: str(r.id, 40) || newId(),
        at: Number.isFinite(Number(r.at)) ? Number(r.at) : Date.now(),
        kind: KINDS.includes(r.kind) ? r.kind : 'combat',
        game: str(r.game, 60),
        opponent: str(r.opponent, 80),
        player: str(r.player, 80),
        result: RESULTS.includes(r.result) ? r.result : 'draw',
        summary: str(r.summary, 600),
        note: str(r.note, 600),
    };
}

export function normalizeStore(raw) {
    const list = Array.isArray(raw?.records) ? raw.records : [];
    return { records: list.map(normalizeRecord).filter(r => r.opponent).slice(-MAX_RECORDS) };
}

const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

/** Wins, losses and draws against one opponent (or everyone when none is named), by kind. */
export function tally(records, opponent, kind) {
    const out = { won: 0, lost: 0, draw: 0, total: 0 };
    for (const r of records || []) {
        if (opponent && !same(r.opponent, opponent)) continue;
        if (kind && r.kind !== kind) continue;
        out[r.result]++;
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
    return bits.join(', ');
}

/**
 * A short paragraph for a prompt: how it has gone between the player and this person, so a
 * rivalry shows up in how they talk. Empty when there is nothing to say.
 */
export function describeRivalry(records, opponent, playerName = 'the player') {
    const mine = (records || []).filter(r => same(r.opponent, opponent));
    if (!mine.length) return '';
    const fights = tally(mine, null, 'combat');
    const games = tally(mine, null, 'game');
    const parts = [];
    if (fights.total) parts.push(`${fights.total} fight${fights.total === 1 ? '' : 's'} (${tallyText(fights)})`);
    if (games.total) parts.push(`${games.total} game${games.total === 1 ? '' : 's'} (${tallyText(games)})`);
    const recent = mine.slice(-4).map(r => `${r.summary || `${r.kind === 'game' ? r.game || 'a game' : 'a fight'}: ${r.result}`}${r.note ? ` (${r.note})` : ''}`);
    return `[HISTORY BETWEEN ${opponent.toUpperCase()} AND ${playerName.toUpperCase()}: ${parts.join('; ')}. Results are from ${playerName}'s side. Most recent: ${recent.join(' | ')}. Let it colour how ${opponent} behaves; do not recite it.]`;
}
