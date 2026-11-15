import { tally, tallyText, asRecords, peopleIn, tookPart, knowsOf, recordLine } from './rivalry-core.js';
import { chooseEntries } from './vector-core.js';

/**
 * Putting the history into the main story prompt (fork), the way a lorebook entry gets in:
 * where it goes, in what role, when it applies, and how much of it.
 *
 * This file decides who is included and what the text says. The caller (history-inject.js)
 * supplies who is in the scene and sets the prompt.
 *
 * Pure: no DOM, no SillyTavern imports.
 */

export const INJECT_POSITIONS = Object.freeze({
    before: 'Before the story prompt',
    prompt: 'In the prompt',
    chat: 'In the chat, this many messages back',
});
export const INJECT_ROLES = Object.freeze({ system: 'System', user: 'User', assistant: 'Assistant' });
export const INJECT_TRIGGERS = Object.freeze({
    always: 'Always, for everyone with a history',
    scene: 'Only when they are in the scene',
    mentioned: 'Only when their name came up recently',
    random: 'Randomly, whoever has a history',
});
export const INJECT_ORDERS = Object.freeze({
    recent: 'Most recent encounter first',
    most: 'Most encounters first',
    name: 'Alphabetical',
});

export const INJECT_DEFAULTS = Object.freeze({
    enabled: false,
    position: 'chat',
    depth: 4,
    role: 'system',
    trigger: 'scene',
    scanDepth: 6,
    chance: 100,
    order: 'recent',
    maxPeople: 3,
    recent: 4,
    instruction: 'Past encounters like these may colour how someone behaves, and a character may bring one up when it '
        + 'feels natural. They are never obliged to, and should not recite it.',
});

const int = (v, lo, hi, d) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
};
const pick = (v, table, d) => (Object.prototype.hasOwnProperty.call(table, v) ? v : d);

export function normalizeInject(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const d = INJECT_DEFAULTS;
    return {
        enabled: Boolean(r.enabled),
        position: pick(r.position, INJECT_POSITIONS, d.position),
        depth: int(r.depth, 0, 100, d.depth),
        role: pick(r.role, INJECT_ROLES, d.role),
        trigger: pick(r.trigger, INJECT_TRIGGERS, d.trigger),
        scanDepth: int(r.scanDepth, 1, 50, d.scanDepth),
        chance: int(r.chance, 0, 100, d.chance),
        order: pick(r.order, INJECT_ORDERS, d.order),
        maxPeople: int(r.maxPeople, 1, 10, d.maxPeople),
        recent: int(r.recent, 1, 20, d.recent),
        instruction: typeof r.instruction === 'string' ? r.instruction.slice(0, 600) : d.instruction,
    };
}

/**
 * Who gets into the prompt this time: anyone (but the player) who took part in a record, on
 * either side, or watched it as a spectator, so allies, people in fights between others and
 * onlookers count too.
 *
 * @param {object[]} records Every record in the chat.
 * @param {object} opts normalizeInject() output
 * @param {{ applies: (name: string) => boolean, rng: () => number }} ctx
 *   applies says whether the trigger holds for a person (always true for 'always' and 'random').
 * @param {string} [playerName] Left out of the people, as well as each record's own player.
 * @returns {string[]} Names, in the order they are written.
 */
export function selectOpponents(records, opts, ctx, playerName = '') {
    const list = asRecords(records);
    const names = peopleIn(list, playerName);
    const theirs = (n) => list.filter(r => knowsOf(r, n));
    const lastAt = (n) => Math.max(...theirs(n).map(r => r.at));
    const count = (n) => theirs(n).length;

    let chosen = names.filter(n => ctx.applies(n));
    // The chance is rolled per person, so the same history is not always the one that comes up.
    const chance = opts.trigger === 'random' && opts.chance === 100 ? 35 : opts.chance;
    chosen = chosen.filter(() => ctx.rng() * 100 < chance);

    if (opts.order === 'most') chosen.sort((a, b) => count(b) - count(a) || a.localeCompare(b));
    else if (opts.order === 'name') chosen.sort((a, b) => a.localeCompare(b));
    else chosen.sort((a, b) => lastAt(b) - lastAt(a));
    return chosen.slice(0, opts.maxPeople);
}

/**
 * The text for one person: how it has gone for them, and the last few things that happened.
 * Only records they took part in (either side) or watched; fights between others they did not
 * see are left out, and a watched one is marked as such. Their tally counts only what they fought.
 *
 * mode.vectors with picks: the records written are the ones the vectors picked, and only those
 * (no newest-first filling), so the vectors are the one source of this history; a person with no
 * picked record is left out. Without picks (vectors off, the search failed or found nothing in
 * use) it is the newest, as always.
 * mode.skip: record ids already in the story prompt another way (the same game or fight recalled
 * with its table talk); they are never written twice. The tallies still count them.
 */
export function historyBlock(records, person, playerName, recent, picks = null, { vectors = false, skip = null } = {}) {
    const mine = asRecords(records).filter(r => knowsOf(r, person));
    if (!mine.length) return '';
    const fights = tally(mine, person, 'combat');
    const games = tally(mine, person, 'game');
    const head = [];
    if (fights.total) head.push(`${fights.total} fight${fights.total === 1 ? '' : 's'} (${tallyText(fights)})`);
    if (games.total) head.push(`${games.total} game${games.total === 1 ? '' : 's'} (${tallyText(games)})`);
    const looked = mine.filter(r => !tookPart(r, person)).length;
    if (looked) head.push(`watched ${looked} more from the side`);
    const pool = skip?.size ? mine.filter(r => !skip.has(r.id)) : mine;
    const only = vectors && Array.isArray(picks);
    const lines = chooseEntries(pool, picks, recent, { fill: !only }).map(r => `- ${tookPart(r, person) ? '' : '[watched] '}${recordLine(r, playerName)}`);
    if (only && !lines.length) return '';
    return `${person}: ${head.join('; ')}. Results are from ${person}'s side.${lines.length ? `\n${lines.join('\n')}` : ''}`;
}

/**
 * The whole injected block, or '' when nobody qualifies. mode: see historyBlock. One block, at
 * the user's position, role and with the user's instruction, whichever source chose the records.
 */
export function buildInjection(records, names, opts, playerName = 'the player', picks = null, mode = {}) {
    const blocks = names.map(n => historyBlock(records, n, playerName, opts.recent, picks, mode)).filter(Boolean);
    if (!blocks.length) return '';
    return ['[Shared history]', ...blocks, opts.instruction ? opts.instruction : '', '[/Shared history]'].filter(Boolean).join('\n');
}

/**
 * buildInjection within a room (approx tokens, chars / 4), for when the vectors chose the records:
 * the least related picks are left out, whole, until the block fits; the most related is always
 * kept. Without vector picks, or without a room, it is buildInjection exactly.
 *
 * @returns {{ text: string, kept: string[], dropped: string[], tokens: number }}
 */
export function buildInjectionWithin(records, names, opts, playerName = 'the player', picks = null, mode = {}, room = null) {
    const tokens = (t) => Math.ceil(String(t || '').length / 4);
    const limited = mode?.vectors && Array.isArray(picks) && room !== null && room !== undefined && Number.isFinite(Number(room));
    if (!limited) {
        const text = buildInjection(records, names, opts, playerName, picks, mode);
        return { text, kept: [], dropped: [], tokens: tokens(text) };
    }
    // Only the picks that would be written count: their record exists, is not skipped, and is
    // with someone this block is about.
    const wanted = new Set(names.map(low));
    const byId = new Map((records || []).map(r => [r?.id, r]));
    const usable = [...new Set(picks)].filter((id) => {
        const r = byId.get(id);
        if (!r || mode.skip?.has?.(id)) return false;
        return [...(r.sideA || []), ...(r.sideB || []), ...(r.spectators || [])].some(n => wanted.has(low(n)) && low(n) !== low(playerName));
    });
    let n = usable.length;
    let text = buildInjection(records, names, opts, playerName, usable.slice(0, n), mode);
    while (n > 1 && tokens(text) > Number(room)) {
        n--;
        text = buildInjection(records, names, opts, playerName, usable.slice(0, n), mode);
    }
    return { text, kept: usable.slice(0, n), dropped: usable.slice(n), tokens: tokens(text) };
}

/* ---- one event, one place in the prompt ---------------------------------------------- */

/** How far apart a record and a talk entry of the same game or fight can be, for old data. */
export const LINK_WINDOW_MS = 15 * 60 * 1000;

const low = (n) => String(n || '').trim().toLowerCase();

/**
 * Which rivalry record is the same game or fight as which table-talk entry.
 *
 * New records carry `event`, the id their talk is kept under: that is an exact link. Records
 * written before that have none, so they are matched by what both say: the same kind (a fight
 * with fight talk, a game with games talk), everyone in the record other than the player was at
 * that table, and both were written within LINK_WINDOW_MS. Of several such records the one
 * closest in time wins; a record is linked to one entry at most. Anything else is not linked,
 * which only means it may be sent the way it always was.
 *
 * @param {object[]} records
 * @param {{ games?: object[], combat?: object[] }} talk entries per kind
 * @param {string} [playerName]
 * @returns {Map<string, string>} talk entry id -> record id
 */
export function linkRecordsToTalk(records, talk = {}, playerName = '') {
    const list = asRecords(records);
    const links = new Map();
    const claimed = new Set();
    const byEvent = new Map(list.filter(r => r.event).map(r => [r.event, r]));
    const pending = [];
    for (const kind of ['games', 'combat']) {
        for (const t of talk[kind] || []) {
            if (!t?.id) continue;
            const exact = byEvent.get(t.id);
            if (exact && !claimed.has(exact.id)) {
                links.set(t.id, exact.id);
                claimed.add(exact.id);
            } else {
                pending.push({ kind, t });
            }
        }
    }
    const recKind = { games: 'game', combat: 'combat' };
    for (const { kind, t } of pending) {
        const at = Number(t.at) || 0;
        if (!at) continue;
        const table = new Set([...(t.with || []), ...(t.sideA || []), ...(t.sideB || [])].map(low).filter(Boolean));
        let best = null;
        let bestGap = Infinity;
        for (const r of list) {
            // A record with its own event id belongs to that event only.
            if (r.event || claimed.has(r.id) || r.kind !== recKind[kind]) continue;
            const gap = Math.abs((Number(r.at) || 0) - at);
            if (gap > LINK_WINDOW_MS || gap >= bestGap) continue;
            const people = [...r.sideA, ...r.sideB]
                .filter(n => !(r.player && low(n) === low(r.player)) && !(playerName && low(n) === low(playerName)))
                .map(low);
            if (!people.length || !people.every(n => table.has(n))) continue;
            best = r;
            bestGap = gap;
        }
        if (best) {
            links.set(t.id, best.id);
            claimed.add(best.id);
        }
    }
    return links;
}

/** The record ids that are the same events as these talk entry ids (see linkRecordsToTalk). */
export function recordsSentAsTalk(records, talk, sentIds, playerName = '') {
    const links = linkRecordsToTalk(records, talk, playerName);
    const out = new Set();
    for (const id of sentIds || []) if (links.has(id)) out.add(links.get(id));
    return out;
}
