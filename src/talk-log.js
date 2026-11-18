/**
 * What was said at the games table and in fights (fork): the log, without the I/O.
 *
 * Games and combat keep their table talk in memory and throw it away when the game or the fight
 * is over. This keeps one entry per game or fight in the chat's metadata (talk-store.js does the
 * storing): who was there, what was said, how it ended. Vectors embed these entries so a later
 * scene can recall the game where something was said.
 *
 * Store shape (chat metadata `sillynpc_talk`):
 *   { games: [entry], combat: [entry], activities: [entry] }, oldest first, at most TALK_MAX_ENTRIES per kind.
 *   entry = { id, at, title, with: [name], date, lines: [{ who, text }], result, sideA?, sideB?, spectators? }
 *   with is everyone at the table but the player. sideA / sideB, when present, say who stood
 *   where (the player's side first); older entries have none and read exactly as before.
 *   spectators, when present, are people who watched without fighting (also listed in with).
 *
 * Pure: no DOM, no SillyTavern imports, so node can test it.
 */

import { fitWhole, estimateTokens } from './vector-core.js';

export const TALK_KEY = 'sillynpc_talk';
/** The kinds the vectors follow (see vectors.js, which keeps a setting row for each). */
export const TALK_KINDS = Object.freeze(['games', 'combat']);
/** Activities (tea, study, drills) are stored with the others; their vector row comes with the module. */
export const ACTIVITY_KIND = 'activities';
export const STORED_KINDS = Object.freeze([...TALK_KINDS, ACTIVITY_KIND]);
export const TALK_MAX_ENTRIES = 100;
/* Storage limits, generous on purpose: a line is kept as it was said, so recall never has less. */
export const TALK_MAX_LINES = 200;
export const TALK_LINE_CHARS = 2000;

const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const str = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export const isTalkKind = (kind) => STORED_KINDS.includes(kind);

/** A fresh entry id: time plus a little noise, so two entries in one millisecond still differ. */
export function newTalkId(at = Date.now(), rng = Math.random) {
    let tail = '';
    for (let i = 0; i < 4; i++) tail += Math.floor(rng() * 36).toString(36);
    return `t${Number(at).toString(36)}${tail}`;
}

function normalizeLine(raw) {
    const r = obj(raw);
    const text = str(r.text, TALK_LINE_CHARS);
    if (!text) return null;
    return { who: str(r.who, 80) || '?', text };
}

/**
 * One entry, repaired, or null when there is nothing in it worth keeping (no line and no result)
 * or it cannot be named (no id).
 */
export function normalizeTalkEntry(raw) {
    const r = obj(raw);
    const id = str(r.id, 60).replace(/[^A-Za-z0-9_-]/g, '');
    if (!id) return null;
    const lines = (Array.isArray(r.lines) ? r.lines : []).map(normalizeLine).filter(Boolean);
    // The first lines are the ones kept: a long fight's opening says who was there and why.
    const kept = lines.slice(0, TALK_MAX_LINES);
    const result = str(r.result, 300);
    if (!kept.length && !result) return null;
    const at = Number(r.at);
    const withList = [...new Set((Array.isArray(r.with) ? r.with : []).map(n => str(n, 80)).filter(Boolean))].slice(0, 14);
    const side = (v) => [...new Set((Array.isArray(v) ? v : []).map(n => str(n, 80)).filter(Boolean))].slice(0, 12);
    const sideA = side(r.sideA);
    const sideB = side(r.sideB);
    // Sides only when both are known: one side alone says nothing about who faced whom.
    const sides = sideA.length && sideB.length ? { sideA, sideB } : {};
    const spectators = side(r.spectators).filter(n => !sideA.includes(n) && !sideB.includes(n));
    const activity = str(r.activity, 40);
    const outcome = ['perfect', 'good', 'fair', 'poor'].includes(r.outcome) ? r.outcome : '';
    return {
        id,
        at: Number.isFinite(at) && at > 0 ? at : 0,
        title: str(r.title, 120) || 'Untitled',
        with: withList,
        date: str(r.date, 80),
        lines: kept,
        result,
        ...sides,
        ...(spectators.length ? { spectators } : {}),
        ...(activity ? { activity } : {}),
        ...(outcome ? { outcome } : {}),
    };
}

/** The whole store, repaired: both kinds present, entries valid, ids unique, oldest first, capped. */
export function normalizeTalkStore(raw) {
    const r = obj(raw);
    const out = {};
    // A kind this build does not know (a newer build wrote it) is kept as it came, so nothing is lost.
    for (const [kind, list] of Object.entries(r)) {
        if (!STORED_KINDS.includes(kind) && Array.isArray(list)) out[kind] = list;
    }
    for (const kind of STORED_KINDS) {
        const seen = new Map();
        for (const e of Array.isArray(r[kind]) ? r[kind] : []) {
            const entry = normalizeTalkEntry(e);
            // A repeated id keeps the later copy: it is the one written last.
            if (entry) seen.set(entry.id, entry);
        }
        const list = [...seen.values()];
        // Stable: entries with the same time keep the order they were written in.
        list.sort((a, b) => a.at - b.at);
        out[kind] = list.slice(-TALK_MAX_ENTRIES);
    }
    return out;
}

/**
 * Adds an entry, or replaces the one with the same id (a game that is recorded when it ends and
 * again when it is left, with the talk that came after). Keeps the newest TALK_MAX_ENTRIES.
 * Mutates the store; returns the entry as stored, or null when there was nothing to record.
 */
export function addTalkEntry(store, kind, raw) {
    if (!store || !isTalkKind(kind)) return null;
    const entry = normalizeTalkEntry(raw);
    if (!entry) return null;
    const list = Array.isArray(store[kind]) ? store[kind] : (store[kind] = []);
    const at = list.findIndex(e => e?.id === entry.id);
    if (at >= 0) {
        // The first time it was recorded stays its time, so it does not jump in the list.
        entry.at = list[at].at || entry.at;
        list[at] = entry;
    } else {
        list.push(entry);
    }
    if (list.length > TALK_MAX_ENTRIES) list.splice(0, list.length - TALK_MAX_ENTRIES);
    return { ...entry, lines: entry.lines.map(l => ({ ...l })) };
}

/** Removes one entry. Returns whether it was there. */
export function removeTalkEntry(store, kind, id) {
    if (!store || !isTalkKind(kind) || !Array.isArray(store[kind])) return false;
    const before = store[kind].length;
    store[kind] = store[kind].filter(e => e?.id !== id);
    return store[kind].length !== before;
}

const withText = (names) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] || '');

/** Who was there: "<joiner>A and B against C" with sides, "<joiner>A and B" (the others) without. */
const company = (e, joiner) => {
    const watched = e.spectators?.length ? `, watched by ${withText(e.spectators)}` : '';
    if (e.sideA && e.sideB) return `${joiner}${withText(e.sideA)} against ${withText(e.sideB)}${watched}`;
    return e.with.length ? `${joiner}${withText(e.with)}` : '';
};

/**
 * The text an entry is embedded as: what it was, who was there, when, how it ended, then the
 * lines as they were said. vector-core chunks it when it is long.
 */
export function talkEmbedText(entry, kind = 'games') {
    const e = normalizeTalkEntry(entry);
    if (!e) return '';
    const what = kind === 'combat' ? 'Fight' : kind === ACTIVITY_KIND ? 'Activity' : 'Game';
    const head = `${what}: ${e.title}${company(e, ', ')}${e.date ? ` (${e.date})` : ''}.`;
    const out = [head];
    if (e.result) out.push(`Result: ${e.result}`);
    for (const l of e.lines) out.push(`${l.who}: ${l.text}`);
    return out.join('\n');
}

const DECISIVE = /\b(won|wins|beat|beats|lost|loses|fell|falls|fled|flees|yield(?:s|ed)?|defeated|surrender(?:s|ed)?|checkmate)\b/i;

/** Decisive endings count a little more when two results are equally related. */
export function talkImportance(entry) {
    return DECISIVE.test(String(entry?.result || '')) ? 1 : 0;
}

export const TALK_HEADINGS = Object.freeze({
    games: '[EARLIER GAMES THAT MAY MATTER]',
    combat: '[EARLIER FIGHTS THAT MAY MATTER]',
    activities: '[TIME SPENT TOGETHER THAT MAY MATTER]',
});

/** One recalled game or fight as written: its head line, then every line said, whole. */
export function talkRecallItem(raw) {
    const e = normalizeTalkEntry(raw);
    if (!e) return '';
    const head = `- ${e.title}${e.sideA ? ` (${company(e, '').trim()})` : company(e, ' with ')}${e.date ? ` (${e.date})` : ''}${e.result ? `: ${e.result}` : ''}`;
    return [head, ...e.lines.map(l => `  ${l.who}: ${l.text}`)].join('\n');
}

/**
 * The prompt block for picked entries, lorebook style: every entry whole (all its lines, none
 * clipped) or not at all.
 *
 * Entries come best first. They are taken in that order while they fit the room; the first that
 * does not, and every less relevant one after it, is left out. The best one always goes in whole,
 * even alone larger than the room. What goes in is written oldest first, as a story reads.
 *
 * @param {'games'|'combat'} kind
 * @param {object[]} entries best first
 * @param {{ budgetTokens?: number }} [opts]
 * @returns {{ text: string, kept: object[], dropped: object[], tokens: number }}
 */
export function talkRecall(kind, entries, { budgetTokens = Infinity } = {}) {
    const heading = TALK_HEADINGS[kind];
    const none = { text: '', kept: [], dropped: [], tokens: 0 };
    if (!heading) return none;
    const items = (entries || []).map(raw => ({ raw, text: talkRecallItem(raw) })).filter(i => i.text);
    const fit = fitWhole(items, budgetTokens, { cost: (i) => estimateTokens(i.text) + 1, overhead: estimateTokens(heading) + 1 });
    if (!fit.kept.length) return { ...none, dropped: fit.dropped.map(i => i.raw) };
    const shown = fit.kept.slice().sort((a, b) => (Number(a.raw.at) || 0) - (Number(b.raw.at) || 0));
    const text = [heading, ...shown.map(i => i.text)].join('\n');
    return { text, kept: fit.kept.map(i => i.raw), dropped: fit.dropped.map(i => i.raw), tokens: estimateTokens(text) };
}

/** The block alone (see talkRecall), or '' when there is nothing. Entries best first. */
export function buildTalkRecallBlock(kind, entries, { budgetTokens = Infinity } = {}) {
    return talkRecall(kind, entries, { budgetTokens }).text;
}

/** How many entries one kind recalls: 1 to 6, 2 when unset. */
export function clampRecall(v) {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.max(1, Math.min(6, n)) : 2;
}

/**
 * The story-prompt text for this generation and what went into it: one block per kind that has
 * picks, games first. A kind without picks (vectors off, the search failed, nothing related) adds
 * nothing: these entries have no injection of their own without vectors.
 *
 * @param {{ picks?: object, lists?: object, recall?: object, budgetTokens?: number }} args
 *   picks[kind]: entry ids in relevance order, or null; lists[kind]: that kind's entries;
 *   recall[kind]: how many at most; budgetTokens: room per kind, whole entries only.
 * @returns {{ text: string, report: Record<string, { kept: object[], dropped: object[], tokens: number }> }}
 *   report has a key for every kind that had picks.
 */
export function buildTalkInjectionReport({ picks = {}, lists = {}, recall = {}, budgetTokens = Infinity } = {}) {
    const blocks = [];
    const report = {};
    for (const kind of TALK_KINDS) {
        const ids = picks[kind];
        if (!Array.isArray(ids) || !ids.length) continue;
        const byId = new Map((lists[kind] || []).map(e => [e?.id, e]));
        // Best first: the room decides from the most relevant down.
        const chosen = [...new Set(ids)].map(id => byId.get(id)).filter(Boolean).slice(0, clampRecall(recall[kind]));
        const r = talkRecall(kind, chosen, { budgetTokens });
        report[kind] = { kept: r.kept, dropped: r.dropped, tokens: r.tokens };
        if (r.text) blocks.push(r.text);
    }
    return { text: blocks.join('\n\n'), report };
}

/** The story-prompt text alone (see buildTalkInjectionReport). */
export function buildTalkInjection(args = {}) {
    return buildTalkInjectionReport(args).text;
}
