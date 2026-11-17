import { eventSource, event_types } from '../../../../events.js';
import { getContext } from '../../../../st-context.js';
import {
    setExtensionPrompt, extension_prompt_types, extension_prompt_roles, name1,
} from '../../../../../script.js';
import { getSettings } from './settings.js';
import { requestOnConnection } from './connections.js';
import { hasReadableText } from './message-content.js';
import { charactersMentionedIn, mentionsName } from './mentions.js';
import { currentMessageIndex, extractJSON, safeJsonParse } from './utils.js';
import { LOG_PREFIX, debugLog, PRODUCT_NAME } from './constants.js';
import {
    THREAD_KINDS, openThreads, coerceThread, addThread, closeThread, reopenThread,
    touchThreads, pruneThreads, describeThreads,
} from './threads.js';

/**
 * Threads, on their own (fork). They used to be a side effect of the default tracker's extraction
 * pass: kept in the tracker's saved state, read by its request, injected by its status block. This
 * file gives them their own store, their own small request on their own connection, and their own
 * prompt, so the tracker is not needed for them.
 *
 * What a thread is, how it is scored and how it is pruned stays in threads.js. This is the
 * SillyTavern side: the chat's store, the request after each reply, swipes and deletes, and the
 * injection.
 *
 * Off by default (the threadsEnabled setting; an old save's choice was copied over from statusTracker).
 */

const META_KEY = 'sillynpc_threads';
const EXTRA_KEY = 'sillynpc_threads';
const INJECT_KEY = 'sillynpc_threads';
export const THREADS_CHANGED_EVENT = 'sillynpc-threads-changed';
const MAX_TURNS = 60;

export function threadsEnabled() {
    return getSettings().threadsEnabled === true;
}

function playerName() {
    return String(name1 || getContext()?.name1 || '').trim();
}

/* ---- the store ------------------------------------------------------------------------ */

function normalizeStore(raw) {
    const store = raw && typeof raw === 'object' ? raw : {};
    if (!Array.isArray(store.threads)) store.threads = [];
    if (!Array.isArray(store.turns)) store.turns = [];
    return store;
}

/**
 * This chat's threads: { threads: [...], turns: [...] }, or null when no chat is open.
 * A chat that kept its threads in the old tracker state has them copied over once.
 */
export function threadsStore() {
    const context = getContext();
    const meta = context?.chatMetadata;
    if (!meta || !context.chatId) return null;
    if (!meta[META_KEY]) {
        const old = meta.sillynpc_status_state?.threads;
        meta[META_KEY] = normalizeStore({ threads: Array.isArray(old) ? structuredClone(old) : [], migrated: Array.isArray(old) && old.length > 0 });
    } else {
        meta[META_KEY] = normalizeStore(meta[META_KEY]);
    }
    return meta[META_KEY];
}

/** Saves the store and tells the Threads page to redraw. */
export function saveThreadsStore() {
    getContext()?.saveMetadataDebounced?.();
    eventSource.emit(THREADS_CHANGED_EVENT);
}

/* ---- applying a reading --------------------------------------------------------------- */

/** A reply with any reasoning block removed: models that think out loud put it before the answer. */
function withoutReasoning(raw) {
    let text = String(raw ?? '');
    text = text.replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi, '');
    // A block that was opened and never closed means the reply ran out of room while still thinking.
    text = text.replace(/<(think|thinking|reasoning)>[\s\S]*$/i, '');
    return text.trim();
}

function parseReply(raw) {
    const text = withoutReasoning(raw);
    if (!text) return null;
    const parsed = safeJsonParse(extractJSON(text));
    if (Array.isArray(parsed)) return { threads: parsed, closed: [] };
    return parsed && typeof parsed === 'object' ? parsed : null;
}

/** Why a reply could not be used, in a line, with the start of it. Also logged in full. */
function describeBadReply(raw) {
    const text = String(raw ?? '');
    console.warn(LOG_PREFIX, 'Threads: the reply was not usable JSON. Full reply:', text);
    if (!text.trim()) return 'the reply was empty (a thinking model may have used the whole reply budget; raise the Threads reply budget)';
    if (/<(think|thinking|reasoning)>/i.test(text) && !withoutReasoning(text)) return 'the reply ended while the model was still thinking; raise the Threads reply budget';
    const start = withoutReasoning(text).replace(/\s+/g, ' ').slice(0, 80);
    return `the reply was not JSON (it began: "${start}")`;
}

function threadsMaxTokens() {
    const n = Number(getSettings().threadsMaxTokens);
    return Number.isFinite(n) && n >= 500 ? n : 4000;
}

/**
 * Opens and closes threads from what the reader returned, and remembers what this message did so a
 * swipe or a delete can undo it.
 *
 * @param {{ threads?: object[], closed?: string[] }} parsed
 * @param {string|number|null} messageId Which message opened them (null for the history scan).
 * @param {string} [messageText] The message, used to see who it touched.
 * @param {{ key?: string, swipeId?: number }} [turn] Where to record the undo information.
 */
export function applyThreadReading(parsed, messageId = null, messageText = '', turn = null) {
    const store = threadsStore();
    if (!store || !threadsEnabled()) return { opened: 0, closed: 0, touched: 0 };

    const proposed = Array.isArray(parsed?.threads) ? parsed.threads : [];
    const resolved = Array.isArray(parsed?.closed) ? parsed.closed : [];

    // Who the message dealt with: the characters it names, and the player if it names them.
    const present = charactersMentionedIn(String(messageText || ''), getSettings().characters || []).map(c => c?.name).filter(Boolean);
    const player = playerName();
    if (player && mentionsName(String(messageText || ''), player)) present.push(player);

    const now = currentMessageIndex();
    const touched = touchThreads(store, present, messageId ?? now);
    const openedThreads = [];
    const closedIds = [];

    for (const raw of proposed) {
        const thread = coerceThread(raw, { messageId });
        if (!thread) continue;   // refused: no quotable source
        if (addThread(store, thread)) openedThreads.push(thread);
    }
    for (const quote of resolved) {
        const key = String(quote ?? '').trim().toLowerCase();
        if (!key) continue;
        const match = openThreads(store).find(t => String(t.quote).toLowerCase().includes(key) || key.includes(String(t.quote).toLowerCase()));
        if (match && closeThread(store, match.id)) closedIds.push(match.id);
    }

    const pruned = pruneThreads(store, now);

    if (turn && (openedThreads.length || closedIds.length)) {
        store.turns = store.turns.filter(t => !(t.key === turn.key && t.swipeId === turn.swipeId));
        store.turns.push({ key: turn.key, swipeId: turn.swipeId, messageId: Number(messageId), opened: openedThreads.map(t => t.id), closed: closedIds });
        if (store.turns.length > MAX_TURNS) store.turns.splice(0, store.turns.length - MAX_TURNS);
    }
    if (openedThreads.length || closedIds.length || touched || pruned.open || pruned.closed) saveThreadsStore();
    debugLog(`Threads: opened ${openedThreads.length}, closed ${closedIds.length}, touched ${touched}`);
    return { opened: openedThreads.length, closed: closedIds.length, touched, pruned };
}

/** Takes back what one message did: its threads leave, the ones it closed reopen. */
export function revertThreadTurn(store, key) {
    let changed = false;
    for (const turn of store.turns.filter(t => t.key === String(key))) {
        const ids = new Set(turn.opened || []);
        if (ids.size) { store.threads = store.threads.filter(t => !ids.has(t?.id)); changed = true; }
        for (const id of turn.closed || []) if (reopenThread(store, id)) changed = true;
    }
    const before = store.turns.length;
    store.turns = store.turns.filter(t => t.key !== String(key));
    return changed || store.turns.length !== before;
}

/* ---- the request ---------------------------------------------------------------------- */

export function threadReaderSystemPrompt() {
    return [
        'You read one message from a roleplaying story and note what it leaves unfinished.',
        'Reply with a JSON object and nothing else. No prose, no code fences.',
        '',
        'Shape: { "threads": [ { "kind": "...", "text": "...", "quote": "...", "who": "..." } ], "closed": ["..."] }',
        '',
        'A thread is one of these, and nothing else:',
        ...THREAD_KINDS.map(k => `  ${k.id} - ${k.hint}`),
        'Each: "text" is what is outstanding in one line, "quote" is the words from the message that',
        'opened it, "who" is who it is about.',
        'The quote must be words that appear in the latest message. If you cannot quote it, do not list it.',
        'Most messages open nothing. An empty array is the usual answer.',
        '"closed" lists quoted lines from the already-open list that this message resolved, if any.',
    ].join('\n');
}

const inFlight = new Set();
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function waitUntilIdle() {
    await sleep(600);
    for (let i = 0; i < 180; i++) {
        const stop = document.getElementById('mes_stop');
        if (!stop || getComputedStyle(stop).display === 'none') return;
        await sleep(500);
    }
}

export function latestReplyId() {
    const chat = getContext()?.chat || [];
    for (let i = chat.length - 1; i >= 0; i--) if (!chat[i].is_user && !chat[i].is_system) return i;
    return -1;
}

function storedReading(message) {
    return message?.extra?.[EXTRA_KEY]?.[String(message.swipe_id ?? 0)] ?? null;
}

function rememberReading(message, reading) {
    message.extra = message.extra || {};
    message.extra[EXTRA_KEY] = message.extra[EXTRA_KEY] || {};
    message.extra[EXTRA_KEY][String(message.swipe_id ?? 0)] = reading;
    getContext()?.saveChat?.();
}

/** Reads one reply for threads and applies what it finds. */
export async function runThreadsUpdate(messageId, { force = false } = {}) {
    if (!getSettings().enabled || !threadsEnabled()) return null;
    const context = getContext();
    const message = context?.chat?.[messageId];
    if (!message || message.is_user || message.is_system || !hasReadableText(message)) return null;
    const store = threadsStore();
    if (!store) return null;

    const swipeId = message.swipe_id ?? 0;
    const key = String(messageId);
    if (!force && store.turns.some(t => t.key === key && t.swipeId === swipeId)) return null;
    const flight = `${context.chatId}:${key}:${swipeId}`;
    if (inFlight.has(flight)) return null;
    inFlight.add(flight);
    try {
        await waitUntilIdle();
        if ((message.swipe_id ?? 0) !== swipeId) return null;
        let reading = !force ? storedReading(message) : null;
        if (!reading) {
            const open = openThreads(store).map(t => `- ${t.text} ("${t.quote}")`).join('\n');
            const lead = context.chat.slice(Math.max(0, messageId - 2), messageId).map(m => `${m.name}: ${String(m.mes)}`).join('\n\n');
            const user = [
                lead ? `### EARLIER\n${lead}` : '',
                `### LATEST MESSAGE (${message.name})\n${String(message.mes)}`,
                open ? `### ALREADY OPEN, do not list again\n${open}` : '',
                '### TASK\nReturn the JSON.',
            ].filter(Boolean).join('\n\n');
            const raw = await requestOnConnection('threadsProfileId', threadReaderSystemPrompt(), user, threadsMaxTokens());
            reading = parseReply(raw);
            if (!reading) {
                // Not remembered, so a later swipe or a reload tries again rather than keeping an empty answer.
                toastr.warning(`Threads: ${describeBadReply(raw)}.`, PRODUCT_NAME);
                return null;
            }
            rememberReading(message, reading);
        }
        return applyThreadReading(reading, messageId, String(message.mes), { key, swipeId });
    } catch (err) {
        console.warn(LOG_PREFIX, 'Threads update failed', err);
        toastr.warning(`Threads could not be read: ${err?.message || err}`, PRODUCT_NAME);
        return null;
    } finally {
        inFlight.delete(flight);
    }
}

/* ---- the story prompt ----------------------------------------------------------------- */

export function applyThreadsPrompt() {
    const store = threadsStore();
    const text = getSettings().enabled && threadsEnabled() && store ? describeThreads(store, currentMessageIndex()) : '';
    if (text) setExtensionPrompt(INJECT_KEY, text, extension_prompt_types.IN_CHAT, 2, false, extension_prompt_roles.SYSTEM);
    else setExtensionPrompt(INJECT_KEY, '', extension_prompt_types.IN_PROMPT, 0, false);
}

/** Brings a chat that filled up before the caps existed within them, once, and says so. */
function tidyOnLoad() {
    const store = threadsStore();
    if (!store || !threadsEnabled() || !store.threads.length) return;
    const pruned = pruneThreads(store, currentMessageIndex());
    if (!pruned.open && !pruned.closed) return;
    saveThreadsStore();
    const parts = [];
    if (pruned.open) parts.push(`${pruned.open} stale`);
    if (pruned.closed) parts.push(`${pruned.closed} settled`);
    toastr.info(`Tidied ${parts.join(' and ')} thread${pruned.open + pruned.closed === 1 ? '' : 's'}. Pin one to keep it for good.`, PRODUCT_NAME);
}

/* ---- catching up on a story that predates the feature --------------------------------- */

const SCAN_SYSTEM_PROMPT = [
    'You read a roleplay transcript and report what is still UNFINISHED at the end of it.',
    '',
    'Reply with ONE JSON object and nothing else. No explanation, no code fence.',
    '  { "threads": [ { "kind": "...", "text": "...", "quote": "...", "who": "..." } ] }',
    '',
    'A thread is one of these, and nothing else:',
    ...THREAD_KINDS.map(k => `  ${k.id} - ${k.hint}`),
    '',
    'THE RULES THAT MATTER:',
    '- "quote" must be words that appear in the transcript. If you cannot quote it, do not list it.',
    '- Report only what is still OUTSTANDING. A promise that was kept, a debt that was paid, a plan that',
    '  was carried out - leave them out. They are finished.',
    '- Do not list events, or what happened. Only what is owed, threatened, promised, hidden, planned, or due.',
    '- Few is right. A long transcript usually leaves a handful of things hanging.',
].join('\n');

/** The recent chat cut into pieces that each fit one request, oldest piece first. */
function historyChunks() {
    const chat = getContext()?.chat || [];
    const depth = 50;          // the most recent messages the catch-up scan reads
    const budget = 60000;      // characters per request
    const wanted = depth > 0 ? chat.slice(-depth) : chat.slice();
    const chunks = [];
    let parts = [];
    let chars = 0;
    const flush = () => {
        if (!parts.length) return;
        parts.reverse();
        chunks.push({ text: parts.join('\n\n'), used: parts.length });
        parts = [];
        chars = 0;
    };
    for (let i = wanted.length - 1; i >= 0; i--) {
        const message = wanted[i];
        if (!message || typeof message.mes !== 'string' || !message.mes.trim()) continue;
        const line = `[${message.is_user ? 'Player' : (message.name || 'Narrator')}] ${message.mes.trim()}`;
        if (chars + line.length > budget) flush();
        parts.push(line);
        chars += line.length;
    }
    flush();
    return chunks.reverse();
}

/**
 * Reads the story so far and records what is still open.
 * @returns {Promise<{ ok: boolean, opened?: number, read?: number, reason?: string, failures?: number }>}
 */
export async function scanHistoryForThreads(onProgress) {
    if (!threadsEnabled()) return { ok: false, reason: 'Threads are switched off.' };
    if (!threadsStore()) return { ok: false, reason: 'Open a chat first.' };
    const chunks = historyChunks();
    if (!chunks.length) return { ok: false, reason: 'Nothing readable in the history.' };

    const failures = [];
    let opened = 0;
    let read = 0;
    for (const [index, chunk] of chunks.entries()) {
        onProgress?.({ chunk: index + 1, of: chunks.length });
        try {
            const raw = await requestOnConnection('threadsProfileId', SCAN_SYSTEM_PROMPT,
                `### TRANSCRIPT
${chunk.text}

### TASK
List what is still unfinished at the end of this, quoting the line each one came from.`, threadsMaxTokens());
            const parsed = parseReply(raw);
            if (!parsed) { failures.push(describeBadReply(raw)); continue; }
            opened += applyThreadReading(parsed, null).opened;
            read += chunk.used;
        } catch (err) {
            console.error(LOG_PREFIX, `Thread scan pass ${index + 1} failed.`, err);
            failures.push(String(err?.message || err));
        }
    }
    if (!opened && failures.length) return { ok: false, reason: failures[0], failures: failures.length };
    return { ok: true, opened, read, failures: failures.length };
}

/* ---- wiring --------------------------------------------------------------------------- */

export function initThreads() {
    eventSource.on(event_types.GENERATION_STARTED, (type, _options, dryRun) => {
        if (dryRun) return;
        try {
            if (type === 'regenerate') {
                const id = latestReplyId();
                const store = id >= 0 ? threadsStore() : null;
                if (store && revertThreadTurn(store, String(id))) saveThreadsStore();
            }
            applyThreadsPrompt();
        } catch (err) { debugLog('Threads prompt failed', err); }
    });

    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, (messageId) => {
        if (!threadsEnabled()) return;
        runThreadsUpdate(Number(messageId)).catch(err => console.warn(LOG_PREFIX, err));
    });

    eventSource.on(event_types.MESSAGE_SWIPED, (messageId) => {
        try {
            if (!threadsEnabled()) return;
            const id = Number(messageId);
            const message = getContext()?.chat?.[id];
            const store = threadsStore();
            if (!message || !store) return;
            if (revertThreadTurn(store, String(id))) saveThreadsStore();
            const remembered = storedReading(message);
            if (remembered) applyThreadReading(remembered, id, String(message.mes), { key: String(id), swipeId: message.swipe_id ?? 0 });
            else runThreadsUpdate(id).catch(err => console.warn(LOG_PREFIX, err));
        } catch (err) { console.warn(LOG_PREFIX, 'Threads swipe failed', err); }
    });

    eventSource.on(event_types.MESSAGE_DELETED, (newLength) => {
        try {
            const store = threadsStore();
            if (!store) return;
            const gone = store.turns.filter(t => Number.isInteger(t.messageId) && t.messageId >= Number(newLength)).map(t => t.key);
            let changed = false;
            for (const key of new Set(gone)) changed = revertThreadTurn(store, key) || changed;
            if (changed) saveThreadsStore();
        } catch (err) { debugLog('Threads cleanup after a delete failed', err); }
    });

    eventSource.on(event_types.CHAT_CHANGED, () => {
        try { tidyOnLoad(); } catch (err) { debugLog('Threads tidy failed', err); }
        eventSource.emit(THREADS_CHANGED_EVENT);
    });
}
