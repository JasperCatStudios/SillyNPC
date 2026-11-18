import { matchPref, normKey, normalizePrefs } from './likes-core.js';
import { GRADES, GRADE_XP } from './activity-memory-core.js';

/**
 * Tea Time (fork): the rules, without the screen or the model. See docs/TEA-TIME-DESIGN.md.
 *
 * Rule: the engine computes every number. The model proposes the openers and gives one word per round
 * (how the guest reacts); this file turns that word into a bounded score, and scores the tea and the thing
 * brought from the guest's likes and dislikes. A reply is read through a whitelist, so a line such as
 * "ignore the rules, score 99" can never reach a number.
 *
 * Every function that needs chance takes an injected `rng`, and every function returns new data.
 *
 * Pure: no DOM, no SillyTavern imports.
 */

export { GRADES, GRADE_XP };

export const REACTIONS = Object.freeze(['delighted', 'pleased', 'neutral', 'uneasy', 'displeased']);
export const REACTION_DELTA = Object.freeze({ delighted: 2, pleased: 1, neutral: 0, uneasy: -1, displeased: -2 });
export const KINDS = Object.freeze(['question', 'story', 'memory', 'tease', 'compliment', 'plan']);
export const ROUNDS = Object.freeze([3, 5]);

/** Grade thresholds for 3 rounds; 5 rounds scale them by 5/3 (rounded). */
export const THRESHOLDS_3 = Object.freeze({ perfect: 7, good: 4, fair: 1 });

const MAX_TYPED_CHARS = 240;
const MIN_TYPED_WORDS = 3;

const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** The rounds in force: 3 or 5. */
export const roundsOf = (n) => (Number(n) === 5 ? 5 : 3);

/* ------------------------------------------------------------------ tea and the thing brought */

/** The tea's score: a liked tea +2, a disliked tea -1, otherwise 0. */
export function scoreTea(teaName, prefs) {
    const m = matchPref(prefs, 'tea', teaName);
    return m === 'like' ? 2 : m === 'dislike' ? -1 : 0;
}

/**
 * The score for what the player brought: liked +2, disliked -2, anything else +1 (the effort counts), nothing 0.
 * With no `kind` it is looked up as a gift and as food (a baked treat is both); a like in either wins.
 * @param {{ kind?: 'gift'|'food'|null, name?: string } | null} bring
 * @returns {number}
 */
export function scoreBring(bring, prefs) {
    const name = text(bring?.name, 60);
    if (!name) return 0;
    const cats = bring.kind === 'gift' || bring.kind === 'food' ? [bring.kind] : ['gift', 'food'];
    const found = cats.map(c => matchPref(prefs, c, name));
    if (found.includes('like')) return 2;
    if (found.includes('dislike')) return -2;
    return 1;
}

/**
 * The tea list for the picker, each with a mark only when the guest's taste for it is already known.
 * @param {string[]} teas tea names
 * @param {{ cat: string, value: string, side: 'likes'|'dislikes' }[]} known what has been learned in this chat
 * @returns {{ name: string, mark: 'like'|'dislike'|null }[]}
 */
export function teaMenu(teas, known = []) {
    return (teas || []).map(name => {
        const hit = (known || []).find(k => k.cat === 'tea' && normKey(k.value) === normKey(name));
        return { name, mark: hit ? (hit.side === 'likes' ? 'like' : 'dislike') : null };
    });
}

/* ------------------------------------------------------------------ known so far */

const sideOf = (m) => (m === 'like' ? 'likes' : 'dislikes');

/**
 * What the choices already made reveal: the tea, and the thing brought (as a gift or as food).
 * @returns {{ cat: string, value: string, side: 'likes'|'dislikes' }[]}
 */
export function knownFrom(state, prefs) {
    const out = [];
    const add = (cat, value, m) => {
        if (!m || !value) return;
        if (!out.some(k => k.cat === cat && normKey(k.value) === normKey(value))) out.push({ cat, value, side: sideOf(m) });
    };
    const tea = text(state?.tea, 60);
    if (tea) add('tea', tea, matchPref(prefs, 'tea', tea));
    const name = text(state?.bring?.name, 60);
    if (name) {
        const cats = state.bring.kind === 'gift' || state.bring.kind === 'food' ? [state.bring.kind] : ['gift', 'food'];
        for (const c of cats) add(c, name, matchPref(prefs, c, name));
    }
    return out;
}

/** The per-chat record of what has been learned, repaired: { [guest]: [{ cat, value, side }] }. */
export function normalizeKnownStore(raw) {
    const out = {};
    for (const [guest, list] of Object.entries(obj(raw))) {
        const name = text(guest, 80);
        if (!name) continue;
        const seen = new Set();
        const clean = [];
        for (const k of Array.isArray(list) ? list : []) {
            const cat = ['tea', 'food', 'gift', 'topic', 'activity'].includes(k?.cat) ? k.cat : '';
            const value = text(k?.value, 40);
            const side = k?.side === 'dislikes' ? 'dislikes' : k?.side === 'likes' ? 'likes' : '';
            const key = `${cat}:${normKey(value)}`;
            if (!cat || !value || !side || seen.has(key)) continue;
            seen.add(key);
            clean.push({ cat, value, side });
        }
        if (clean.length) out[name] = clean.slice(0, 200);
    }
    return out;
}

/** Adds entries to one guest's record without duplicates. Returns { store, added }. */
export function mergeKnown(store, guest, entries) {
    const next = normalizeKnownStore(store);
    const name = Object.keys(next).find(n => n.toLowerCase() === String(guest).trim().toLowerCase()) || text(guest, 80);
    const list = [...(next[name] || [])];
    const added = [];
    for (const e of normalizeKnownStore({ [name]: entries })[name] || []) {
        if (!list.some(k => k.cat === e.cat && normKey(k.value) === normKey(e.value))) { list.push(e); added.push(e); }
    }
    if (list.length) next[name] = list.slice(0, 200);
    return { store: next, added };
}

/** "likes jasmine, dislikes smoked fish", or '' when nothing is known. */
export function knownLine(entries) {
    const list = entries || [];
    const part = (side) => list.filter(k => k.side === side).map(k => k.value);
    const likes = part('likes');
    const dislikes = part('dislikes');
    return [likes.length ? `likes ${likes.join(', ')}` : '', dislikes.length ? `dislikes ${dislikes.join(', ')}` : ''].filter(Boolean).join(', ');
}

/* ------------------------------------------------------------------ the session */

/**
 * A new session. `llm` says whether a model will take part (off, or a failed start, plays offline: the best
 * grade is then good). `lowMood` halves the positive gains of every round.
 * @param {{ guest: string, tea: string, bring?: { kind?: string, name?: string } | null, rounds?: number,
 *           lowMood?: boolean, llm?: boolean, leaf?: boolean, prefs?: object }} a
 */
export function newSession({ guest, tea, bring = null, rounds = 3, lowMood = false, llm = true, leaf = false, prefs } = {}) {
    const state = {
        guest: text(guest, 80), tea: text(tea, 60),
        bring: bring && text(bring.name, 60) ? { kind: bring.kind === 'gift' || bring.kind === 'food' ? bring.kind : null, name: text(bring.name, 60) } : null,
        rounds: roundsOf(rounds), llm: Boolean(llm), lowMood: Boolean(lowMood),
        teaScore: 0, bringScore: 0, leaf: leaf ? 1 : 0,
        round: 0, delighted: 0, history: [], asked: [], known: [], over: false,
    };
    state.teaScore = scoreTea(state.tea, prefs);
    state.bringScore = scoreBring(state.bring, prefs);
    state.known = knownFrom(state, prefs);
    return state;
}

const stem = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9 ]+/g, '').trim().replace(/(ing|ed|es|s)$/, '');

/** How warm the guest is, -2 to 2: the last three round deltas added up. */
export function moodOf(state) {
    const recent = (state?.history || []).slice(-3);
    return clamp(recent.reduce((n, h) => n + (h.delta || 0), 0), -2, 2);
}

/** The mood as the words the prompt uses. */
export const moodWord = (state) => (moodOf(state) >= 1 ? 'warming up' : moodOf(state) <= -1 ? 'cooling off' : 'steady');

/** The score so far: tea, thing brought, tea leaf, and every round. */
export function totalOf(state) {
    return (state?.teaScore || 0) + (state?.bringScore || 0) + (state?.leaf || 0) + (state?.history || []).reduce((n, h) => n + (h.delta || 0), 0);
}

/** Whether any part of the session ran without the model (off, or a round that failed). */
export const isOffline = (state) => !state?.llm || (state?.history || []).some(h => h.offline);

function thresholds(rounds) {
    const k = rounds === 5 ? 5 / 3 : 1;
    return { perfect: Math.round(THRESHOLDS_3.perfect * k), good: Math.round(THRESHOLDS_3.good * k), fair: Math.round(THRESHOLDS_3.fair * k) };
}

/** perfect, good, fair or poor. A session that was ever offline cannot be perfect. */
export function gradeOf(state) {
    const t = thresholds(state?.rounds === 5 ? 5 : 3);
    const total = totalOf(state);
    let grade = total >= t.perfect ? 'perfect' : total >= t.good ? 'good' : total >= t.fair ? 'fair' : 'poor';
    if (grade === 'perfect' && isOffline(state)) grade = 'good';
    return grade;
}

/**
 * What the session is worth. Only good and perfect nudge a bond (a poor result costs nothing). Level XP is small.
 * @returns {{ grade: string, levelXp: number, bonds: { meter: string, amount: number }[], milestone: string|null }}
 */
export function rewardsOf(state, { affection = 0, highAffection = 60 } = {}) {
    const grade = gradeOf(state);
    const bonds = grade === 'perfect' ? [{ meter: 'affection', amount: 2 }, { meter: 'trust', amount: 1 }]
        : grade === 'good' ? [{ meter: 'affection', amount: 1 }] : [];
    return {
        grade, levelXp: Math.round(10 * GRADE_XP[grade]), bonds,
        milestone: grade === 'perfect' && Number(affection) >= highAffection ? 'tea_perfect' : null,
    };
}

/* ------------------------------------------------------------------ one round */

const SPOKEN = /\*[^*]*\*|\([^)]*\)|\[[^\]]*\]|\{[^}]*\}/g;
/** Speech only: no *actions*, (asides), [directions], quotes. */
export function spokenOnly(s) {
    return String(s ?? '').replace(SPOKEN, ' ').replace(/\s+/g, ' ').trim().replace(/^["“«]+|["”»]+$/g, '').trim().slice(0, 300);
}

/**
 * Whether the guest should ask the player a question that opens round `nextRound` (never the last round, never two
 * rounds running, never offline). `state.asked` holds the rounds a question has already opened.
 */
export function askThisRound(state, nextRound, rng = Math.random, enabled = true) {
    if (!enabled || !state?.llm) return false;
    if (nextRound >= state.rounds) return false;
    if ((state.asked || []).includes(nextRound - 1)) return false;
    return rng() < 1 / 3;
}

/**
 * Judges one round. All the limits live here. `parsed` is the model's reply read by parseTeaReply, or null when
 * there was none (the round then plays offline: the reaction comes from the kind of opener).
 *
 * @param {object} state
 * @param {{ kind?: string, text?: string, typed?: boolean, parsed?: object|null, prefs?: object, guestAsks?: boolean }} turn
 * @returns {{ state: object, delta: number, reaction: string, revealed: { cat: string, value: string, side: string }[] }}
 */
export function judgeRound(state, { kind = 'question', text: said = '', typed = false, parsed = null, prefs, guestAsks = true } = {}) {
    const next = { ...state, history: [...state.history], asked: [...state.asked], known: [...state.known] };
    const roundNo = state.round + 1;
    const offline = !state.llm || !parsed;
    const theKind = KINDS.includes(kind) ? kind : (KINDS.includes(parsed?.kind) ? parsed.kind : 'question');

    let reaction = offline ? neutralReaction(state, { kind: theKind }) : (REACTIONS.includes(parsed.reaction) ? parsed.reaction : 'neutral');

    // A typed line that says too little, or too much, or that the model calls empty praise or beside the point, is neutral.
    const words = String(said).trim().split(/\s+/).filter(Boolean).length;
    if (typed && (words < MIN_TYPED_WORDS || String(said).length > MAX_TYPED_CHARS)) reaction = 'neutral';
    if (!offline && (parsed.flattery === true || parsed.offtopic === true)) reaction = 'neutral';

    // At most one delighted in 3 rounds (two in 5): the rest count as pleased.
    const cap = state.rounds === 5 ? 2 : 1;
    if (reaction === 'delighted') {
        if (state.delighted >= cap) reaction = 'pleased';
        else next.delighted = state.delighted + 1;
    }
    // Without the model a round gives at most +1.
    if (offline && REACTION_DELTA[reaction] > 1) reaction = 'pleased';

    let delta = REACTION_DELTA[reaction];
    if (state.lowMood && delta > 0) delta = Math.floor(delta / 2);

    // The same kind three rounds in a row, or the same theme twice, costs 1 (once).
    const theme = offline ? '' : text(parsed.theme, 30).toLowerCase();
    const lastTwo = state.history.slice(-2);
    const sameKindRun = lastTwo.length === 2 && lastTwo.every(h => h.kind === theKind);
    const sameTheme = Boolean(theme) && state.history.some(h => h.theme && stem(h.theme) === stem(theme));
    if (sameKindRun || sameTheme) delta -= 1;
    delta = clamp(delta, -2, 2);

    // What the guest let slip: a hint counts only when it matches a real like or dislike of theirs.
    const revealed = [];
    const hint = offline ? '' : text(parsed.hint, 30);
    if (hint) {
        const m = matchPref(prefs, 'topic', hint);
        if (m && !next.known.some(k => k.cat === 'topic' && normKey(k.value) === normKey(hint))) {
            const entry = { cat: 'topic', value: hint, side: sideOf(m) };
            next.known.push(entry);
            revealed.push(entry);
        }
    }

    // `asked` holds the rounds that a guest's question opened: the reply to round r opens round r + 1.
    if (!offline && guestAsks && parsed.guestAsks === true && roundNo < state.rounds) next.asked.push(roundNo + 1);

    next.history.push({ round: roundNo, kind: theKind, theme, reaction, delta, ...(offline ? { offline: true } : {}), text: text(said, 120) });
    next.round = roundNo;
    next.over = roundNo >= state.rounds;
    return { state: next, delta, reaction, revealed };
}

/* ------------------------------------------------------------------ reading the model's reply */

/** Whether a line names someone (as a whole word), ignoring case. */
const mentions = (line, names) => {
    // Compared word by word, so there is nothing to escape and "Ann" does not match "Annette".
    const words = String(line ?? '').toLowerCase().split(/[^\p{L}\p{N}']+/u).filter(Boolean);
    return (names || []).some(n => {
        const parts = String(n ?? '').toLowerCase().split(/[^\p{L}\p{N}']+/u).filter(Boolean);
        if (!parts.length || parts.join('').length < 2) return false;
        for (let i = 0; i + parts.length <= words.length; i++) {
            if (parts.every((p, k) => words[i + k] === p)) return true;
        }
        return false;
    });
};

function cleanOpener(raw, clean, avoid) {
    const t = clean(text(obj(raw).text ?? (typeof raw === 'string' ? raw : ''), 200));
    if (t.length < 3 || t.length > 120) return null;
    // An opener is what the player says to the guest. One that names the player was written from the guest's side.
    if (mentions(t, avoid)) return null;
    const kind = KINDS.includes(obj(raw).kind) ? raw.kind : 'question';
    return { kind, text: t };
}

const unescapeJson = (s) => String(s).replace(/\\n|\\t|\\r/g, ' ').replace(/\\(["\\/])/g, '$1');

/**
 * Pulls the fields out of a reply that is not valid JSON (cut off by the length limit, a line break inside a string,
 * curly quotes, a missing bracket), one field at a time. Returns null when not even a reaction or a line is there.
 */
function salvageFields(raw) {
    const str = (key) => {
        const m = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\[\\s\\S])*)"`, 'i').exec(raw);
        return m ? unescapeJson(m[1]) : undefined;
    };
    const flag = (key) => {
        const m = new RegExp(`"${key}"\\s*:\\s*(true|false)`, 'i').exec(raw);
        return m ? m[1].toLowerCase() === 'true' : undefined;
    };
    const reaction = str('reaction');
    const line = str('line');
    if (reaction === undefined && line === undefined) return null;
    const openers = [];
    const from = raw.search(/"openers"/i);
    const tail = from >= 0 ? raw.slice(from) : '';
    const pair = /"kind"\s*:\s*"([a-z]+)"\s*,\s*"text"\s*:\s*"((?:[^"\\]|\\[\s\S])*)"/gi;
    const flip = /"text"\s*:\s*"((?:[^"\\]|\\[\s\S])*)"\s*,\s*"kind"\s*:\s*"([a-z]+)"/gi;
    let m;
    while ((m = pair.exec(tail))) openers.push({ kind: m[1].toLowerCase(), text: unescapeJson(m[2]) });
    if (!openers.length) while ((m = flip.exec(tail))) openers.push({ kind: m[2].toLowerCase(), text: unescapeJson(m[1]) });
    return {
        reaction, line, theme: str('theme'), kind: str('kind'), hint: str('hint'), closing: str('closing'), recap: str('recap'),
        flattery: flag('flattery'), offtopic: flag('offtopic'), guest_asks: flag('guest_asks') ?? flag('guestAsks'), openers,
    };
}

/**
 * Reads the model's reply as an object. Three tries, so a weaker model still works: the text as it is; the text with line
 * breaks turned into spaces, curly quotes straightened and trailing commas removed; then the fields one by one.
 */
export function readReply(raw) {
    const start = raw.indexOf('{');
    // No bracket at all: the fields may still be there as quoted pairs.
    if (start < 0) return salvageFields(raw);
    const end = raw.lastIndexOf('}');
    const body = raw.slice(start, end > start ? end + 1 : raw.length);
    const attempts = [
        body,
        body.replace(/[\r\n\t]+/g, ' ').replace(/[“”„]/g, '"').replace(/,\s*([}\]])/g, '$1'),
    ];
    for (const a of attempts) {
        try {
            const j = JSON.parse(a);
            if (j && typeof j === 'object' && !Array.isArray(j)) return j;
        } catch { /* try the next way */ }
    }
    return salvageFields(raw.slice(start));
}

/**
 * Reads a reply into the fields the engine uses, or null when nothing could be read (see readReply for how much is forgiven). Only the whitelisted
 * fields are looked at; anything else (a "score", a "delta") is ignored. A missing or unknown reaction becomes
 * neutral and a missing line becomes ''.
 * @param {string} reply
 * @param {{ expectOpeners?: boolean, last?: boolean, clean?: (s: string) => string, avoidNames?: string[] }} [opts] avoidNames: an opener that names one of these (the player) is dropped
 */
export function parseTeaReply(reply, { expectOpeners = true, last = false, clean = spokenOnly, avoidNames = [] } = {}) {
    const j = readReply(String(reply ?? ''));
    if (!j) return null;
    const out = {
        reaction: REACTIONS.includes(j.reaction) ? j.reaction : 'neutral',
        line: clean(text(j.line, 400)),
        theme: text(j.theme, 30),
        kind: KINDS.includes(j.kind) ? j.kind : '',
        flattery: j.flattery === true,
        offtopic: j.offtopic === true,
        hint: text(j.hint, 30),
        guestAsks: (j.guest_asks ?? j.guestAsks) === true,
        openers: [], closing: '', recap: '',
    };
    if (expectOpeners && !last) out.openers = (Array.isArray(j.openers) ? j.openers : []).map(o => cleanOpener(o, clean, avoidNames)).filter(Boolean).slice(0, 3);
    if (last) { out.closing = clean(text(j.closing, 400)); out.recap = clean(text(j.recap, 300)); }
    return out;
}

/* ------------------------------------------------------------------ the offline fallback */

/** Nine neutral openers, three per kind. {tea} is filled with the preset's word. No character topics. */
export const NEUTRAL_BANK = Object.freeze([
    { kind: 'question', text: 'How has your week been?' },
    { kind: 'question', text: 'What do you enjoy most about {tea}?' },
    { kind: 'question', text: 'Is there something you have been meaning to say?' },
    { kind: 'memory', text: 'This {tea} reminds me of something.' },
    { kind: 'memory', text: 'Do you remember the first time we sat like this?' },
    { kind: 'memory', text: 'I was thinking of an old story earlier.' },
    { kind: 'compliment', text: 'It is good to sit down with you.' },
    { kind: 'compliment', text: 'You always make the room feel calmer.' },
    { kind: 'compliment', text: 'Thank you for making the time.' },
]);

/** Canned reaction lines per reaction word. */
export const NEUTRAL_LINES = Object.freeze({
    delighted: ['That made my day.', 'I could listen to that all afternoon.', 'Now that is just what I hoped to hear.'],
    pleased: ['That is kind of you.', 'I like that.', 'Mm, that is nice to hear.'],
    neutral: ['I see.', 'Is that so.', 'Hm. Go on.'],
    uneasy: ['Ah. That is a little awkward.', 'Perhaps we can talk of something else.', 'Hm. I am not sure what to say to that.'],
    displeased: ['That was not kind.', 'I would rather not hear that.', 'Let us leave it there.'],
});

/** One canned line for a reaction, chosen by rng. */
export function neutralLine(reaction, rng = Math.random) {
    const pool = NEUTRAL_LINES[reaction] || NEUTRAL_LINES.neutral;
    return pool[Math.floor(rng() * pool.length) % pool.length];
}

const shuffle = (list, rng) => {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
};

/**
 * Three openers from the neutral bank: three different lines, not ones already used, and not the same kind a
 * third time running. `teaWord` is the preset's word for tea.
 * @returns {{ kind: string, text: string }[]}
 */
export function neutralOpeners(state, { teaWord = 'tea' } = {}, rng = Math.random) {
    const used = new Set((state?.history || []).map(h => h.text));
    const lastTwo = (state?.history || []).slice(-2);
    const banned = lastTwo.length === 2 && lastTwo[0].kind === lastTwo[1].kind ? lastTwo[0].kind : '';
    const fill = (o) => ({ kind: o.kind, text: o.text.replace(/\{tea\}/g, teaWord) });
    const bank = NEUTRAL_BANK.map(fill);
    const fresh = shuffle(bank.filter(o => !used.has(o.text) && o.kind !== banned), rng);
    // Make sure two kinds at least are offered when there is the choice.
    const picked = fresh.slice(0, 3);
    if (picked.length < 3) for (const o of shuffle(bank, rng)) { if (picked.length >= 3) break; if (!picked.some(p => p.text === o.text)) picked.push(o); }
    return picked;
}

/** Fills a model's openers up to three from the fallback bank when it gave fewer than two usable ones. */
export function fillOpeners(openers, state, terms, rng = Math.random) {
    const mine = (openers || []).slice(0, 3);
    if (mine.length >= 2) return mine;
    const extra = neutralOpeners(state, terms, rng).filter(o => !mine.some(m => m.text === o.text));
    return [...mine, ...extra].slice(0, 3);
}

/** The reaction without a model: questions and memories please, a compliment is neutral, repeating a kind is uneasy. */
export function neutralReaction(state, { kind = 'question' } = {}) {
    const prev = (state?.history || []).slice(-1)[0];
    if (prev && prev.kind === kind) return 'uneasy';
    return kind === 'question' || kind === 'memory' ? 'pleased' : 'neutral';
}

/* ------------------------------------------------------------------ for the prompt */

/** The session in plain words, for the next request. */
export function describeState(state) {
    const parts = [`round ${Math.min(state.rounds, state.round + 1)} of ${state.rounds}`, `${state.guest} is ${moodWord(state)}`];
    if (state.tea) parts.push(`${state.tea} was served`);
    if (state.bring) parts.push(`the guest was brought ${state.bring.name}`);
    return parts.join(', ');
}

/** A short history for the prompt: "r1 question, pleased, harbour". */
export function historyLine(state) {
    return (state?.history || []).map(h => `r${h.round} ${h.kind}, ${h.reaction}${h.theme ? `, ${h.theme}` : ''}`).join('; ');
}

/** A repeatable rng for tests (mulberry32). */
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

/* ------------------------------------------------------------------ the tea list */

/**
 * The teas to choose from: the item database's teas, plus every tea any character in the cast likes or dislikes, so
 * nobody's favourite is missing. It is the same list for every guest (it does not show whom a tea suits). Only when
 * there are none at all does the preset's short built-in list stand in.
 * @param {string[]} dbNames teas from the item database
 * @param {object[]} prefsList every card's prefs
 * @param {string[]} [fallback]
 * @returns {string[]} sorted, no duplicates (case, spaces and punctuation ignored)
 */
export function teaPool(dbNames, prefsList, fallback = []) {
    const seen = new Map();
    const add = (name) => {
        const n = text(name, 40);
        const key = normKey(n);
        if (n && key && !seen.has(key)) seen.set(key, n);
    };
    for (const n of dbNames || []) add(n);
    for (const raw of prefsList || []) {
        const p = normalizePrefs(raw);
        for (const side of ['likes', 'dislikes']) for (const n of p[side].tea) add(n);
    }
    if (!seen.size) for (const n of fallback || []) add(n);
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/**
 * A random handful from a pool, for the tea table. One entry the guest likes (in this category) is always among them when
 * they like any in the pool, so a good choice is always possible; nothing says which one it is, and the rest are drawn from
 * the whole pool, disliked ones included. A pool no bigger than `count` is shown whole, shuffled.
 * @param {string[]} pool
 * @param {object} prefs the guest's prefs
 * @param {'tea'|'food'|'gift'} category which of their lists decides "liked"
 * @param {{ count?: number, rng?: () => number }} [opts]
 * @returns {string[]}
 */
export function choicesFrom(pool, prefs, category, { count = 8, rng = Math.random } = {}) {
    const all = [...new Set((pool || []).map(n => text(n, 40)).filter(Boolean))];
    const n = Math.max(1, Math.floor(Number(count)) || 8);
    if (all.length <= n) return shuffle(all, rng);
    const liked = all.filter(name => matchPref(prefs, category, name) === 'like');
    const must = liked.length ? [liked[Math.floor(rng() * liked.length) % liked.length]] : [];
    const rest = shuffle(all.filter(name => !must.includes(name)), rng);
    return shuffle([...must, ...rest.slice(0, n - must.length)], rng);
}

/** A random handful of teas (see choicesFrom). */
export const teaChoices = (pool, prefs, opts) => choicesFrom(pool, prefs, 'tea', opts);

/** A random handful of snacks (see choicesFrom); the default is 4. */
export const snackChoices = (pool, prefs, { count = 4, rng = Math.random } = {}) => choicesFrom(pool, prefs, 'food', { count, rng });

/**
 * The snacks to choose from: the preset's own tea-time snacks, plus every food any character in the cast likes or dislikes,
 * so nobody's favourite is missing. The same pool for every guest.
 * @param {object[]} prefsList every card's prefs
 * @param {string[]} [builtIn] the preset's snacks
 * @returns {string[]} sorted, no duplicates
 */
export function snackPool(prefsList, builtIn = []) {
    const seen = new Map();
    const add = (name) => {
        const n = text(name, 40);
        const key = normKey(n);
        if (n && key && !seen.has(key)) seen.set(key, n);
    };
    for (const n of builtIn || []) add(n);
    for (const raw of prefsList || []) {
        const p = normalizePrefs(raw);
        for (const side of ['likes', 'dislikes']) for (const n of p[side].food) add(n);
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/* ------------------------------------------------------------------ what each one looks like on the table */

/** The pictures there are: eight cups of tea and ten snacks (art/activities/tea in the Content pack). */
export const TEA_SPRITES = Object.freeze(['berry', 'citrus', 'flower', 'herb', 'spice', 'apple', 'black', 'leaf']);
export const SNACK_SPRITES = Object.freeze(['shortcake', 'macarons', 'cookies', 'tart', 'scone', 'honeycake', 'sandwiches', 'cheese', 'pastry', 'skewer']);

// The first rule that matches wins, so the more particular words come first.
const TEA_RULES = [
    ['apple', /apple|pear|quince/], ['berry', /berr|cherry|currant|pomegranate|plum/], ['citrus', /lemon|orange|citrus|lime|fruit|peach|mango|honey/],
    ['flower', /rose|lavender|flower|floral|blossom|violet|petal|jasmine|chamomile|lily|moon/], ['herb', /mint|herb|basil|sage|thyme|pine|needle|green/],
    ['spice', /ginger|cinnamon|spice|chai|clove|pepper|cardamom|almond|nut|vanilla/], ['black', /black|dark|bitter|strong|smok|coffee|cocoa|roast|malt/],
    ['leaf', /leaf|leaves|plain|tea of/],
];
const SNACK_RULES = [
    ['honeycake', /honey/], ['macarons', /macaron|candy|sweets|sugar|confection|chocolate/], ['shortcake', /shortcake|strawberr|cake|sponge|gateau/],
    ['cookies', /cookie|biscuit|cracker|shortbread|wafer/], ['tart', /tart|pie|berry|berries|fruit/], ['scone', /scone|jam|cream|muffin|crumpet/],
    ['sandwiches', /sandwich|salad|vegetable|produce|cucumber|toast/], ['cheese', /cheese|dairy|grape|butter/],
    ['pastry', /pastry|baked|bun|roll|bread|dough|croissant|danish|treat/], ['skewer', /meat|jerky|smok|sausage|skewer|fish|ham|bacon/],
];

/** A steady pick from a list for a name no rule knows (the same name always looks the same). */
function steady(list, name) {
    let h = 0;
    for (const ch of normKey(name)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
    return list[h % list.length];
}

const pick = (rules, list, name) => {
    const n = String(name ?? '').toLowerCase();
    const hit = rules.find(([, re]) => re.test(n));
    return hit ? hit[0] : steady(list, name);
};

/** The picture for a tea, by what it is called. Always one of TEA_SPRITES. */
export const teaSprite = (name) => pick(TEA_RULES, TEA_SPRITES, name);

/** The picture for a snack, by what it is called. Always one of SNACK_SPRITES. */
export const snackSprite = (name) => pick(SNACK_RULES, SNACK_SPRITES, name);
