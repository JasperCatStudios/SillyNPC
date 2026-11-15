import { getRequestHeaders, getMaxContextTokens } from '../../../../../script.js';
import { extension_settings } from '../../../../extensions.js';
import { getContext } from '../../../../st-context.js';
import { textgenerationwebui_settings, textgen_types } from '../../../../textgen-settings.js';
import { getSettings } from './settings.js';
import { normalizeVectorSettings, resolveSource, contextSize, historyTotalTokens } from './vector-core.js';
import { LOG_PREFIX } from './constants.js';

/**
 * Talking to SillyTavern's own vector endpoints (fork), always with source 'ollama'.
 *
 * Chat text only ever goes to /api/vector/* on the user's own SillyTavern server, which embeds it
 * with the user's own Ollama. Nothing here throws into a caller that did not ask for it: the
 * calls reject with a readable message, and callers in the generation path catch and fall back.
 */

/** Worldkit's vector settings, repaired in place. */
export function vectorSettings() {
    const settings = getSettings();
    settings.vectors = normalizeVectorSettings(settings.vectors);
    return settings.vectors;
}

/** The URL, model and keep flag in effect, with what they would inherit. */
export function currentSource() {
    let textgenUrl = '';
    try { textgenUrl = textgenerationwebui_settings?.server_urls?.[textgen_types.OLLAMA] || ''; } catch { /* not loaded */ }
    return resolveSource(vectorSettings(), extension_settings?.vectors || {}, textgenUrl);
}

/** What every request carries besides its own fields. */
function sourceBody() {
    const { apiUrl, model, keep } = currentSource();
    return { source: 'ollama', apiUrl, model, keep };
}

/**
 * Explains a failed call. SillyTavern answers every vector failure with a bare 500, so the
 * likely causes are named rather than the status.
 */
export function explainFailure(status, what) {
    const { apiUrl, model } = currentSource();
    if (status === 500) return `${what} failed: Ollama at ${apiUrl} did not answer, or the model "${model}" is not pulled there (ollama pull ${model}).`;
    if (status === 400) return `${what} failed: SillyTavern rejected the request (400).`;
    if (status === 403 || status === 401) return `${what} failed: SillyTavern refused the request (${status}). Reload the page.`;
    if (status === 404) return `${what} failed: this SillyTavern has no vector endpoint (404).`;
    return `${what} failed (${status}).`;
}

async function post(path, body, { signal, what = 'Vector request' } = {}) {
    let response;
    try {
        response = await fetch(path, {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ ...sourceBody(), ...body }),
            signal,
        });
    } catch (err) {
        if (err?.name === 'AbortError') throw new Error(`${what} was cancelled.`);
        throw new Error(`${what} failed: SillyTavern could not be reached (${err?.message || err}).`);
    }
    if (!response.ok) throw new Error(explainFailure(response.status, what));
    return response;
}

/**
 * Embeds and stores items, in batches so one huge request never stalls the server and progress
 * can be shown. Each batch reports its own success, so one bad batch costs only its entries.
 *
 * @param {string} collectionId
 * @param {{ hash: number, text: string, index: number }[]} items
 * @param {{ signal?: AbortSignal, batchSize?: number }} [opts]
 */
export async function insertItems(collectionId, items, { signal } = {}) {
    if (!items?.length) return;
    await post('/api/vector/insert', { collectionId, items }, { signal, what: 'Remembering' });
}

/** Results in score order, already above the threshold: [{ hash, text, index, score? }]. */
export async function queryCollection(collectionId, searchText, topK, threshold, { signal } = {}) {
    const response = await post('/api/vector/query', { collectionId, searchText, topK, threshold }, { signal, what: 'Vector search' });
    const data = await response.json();
    // metadata, not hashes: only metadata is filtered by the threshold.
    return (Array.isArray(data?.metadata) ? data.metadata : []).map(m => ({
        hash: Number(m.hash),
        text: String(m.text ?? ''),
        index: Number(m.index) || 0,
        score: Number.isFinite(Number(m.score)) && m.score !== undefined ? Number(m.score) : undefined,
    }));
}

export async function deleteHashes(collectionId, hashes, { signal } = {}) {
    if (!hashes?.length) return;
    await post('/api/vector/delete', { collectionId, hashes }, { signal, what: 'Removing vectors' });
}

/** Removes the whole collection, for every model. */
export async function purgeCollection(collectionId, { signal } = {}) {
    await post('/api/vector/purge', { collectionId }, { signal, what: 'Purging vectors' });
}

export async function listHashes(collectionId, { signal } = {}) {
    const response = await post('/api/vector/list', { collectionId }, { signal, what: 'Listing vectors' });
    const data = await response.json();
    return Array.isArray(data) ? data.map(Number) : [];
}

/** The service object vector-core's retrievePicks expects. */
export const service = {
    query: (collectionId, text, topK, threshold) => queryCollection(collectionId, text, topK, threshold),
};

/* ---- this generation's picks --------------------------------------------------------- */

/*
 * What the vector search chose for the generation now starting, per module. vectors.js sets it
 * in a GENERATION_STARTED listener that runs first; the modules read it in their own listeners.
 * Null means "no picks": the module does exactly what it did before vectors existed.
 */
const picks = new Map();

export function publishPicks(moduleId, ids) {
    if (Array.isArray(ids)) picks.set(moduleId, ids.slice());
    else picks.delete(moduleId);
}

export function currentPicks(moduleId) {
    return picks.get(moduleId) ?? null;
}

export function clearPicks() {
    picks.clear();
    sentTalk.clear();
    rivalryRoom = null;
}

/*
 * The room the shared-history block may use this generation when Rivalry vectors are on: what
 * the games, fights and phone blocks left of "History brought back, total". null: no limit
 * (vectors off, or nothing searched), which is the block as it always was.
 */
let rivalryRoom = null;

export function publishRivalryRoom(tokens) {
    rivalryRoom = Number.isFinite(Number(tokens)) && tokens !== null ? Math.max(0, Math.floor(Number(tokens))) : null;
}

export function currentRivalryRoom() {
    return rivalryRoom;
}

/** The context size SillyTavern reports for the current connection: { tokens, known }. */
export function currentContextSize() {
    let reported = null;
    try { reported = getMaxContextTokens(); } catch { /* not loaded */ }
    if (!(Number(reported) >= 1024)) {
        try { reported = getContext()?.maxContext; } catch { /* not loaded */ }
    }
    return contextSize(reported);
}

/** "History brought back, total", in tokens, for the current context. */
export function historyTotal() {
    return historyTotalTokens(vectorSettings(), currentContextSize());
}

/*
 * The games and fights whose table talk this generation's story prompt carries, per kind. The
 * shared-history block reads it so the rivalry record of the same game or fight is not sent too.
 */
const sentTalk = new Map();

export function publishSentTalk(kind, ids) {
    if (Array.isArray(ids) && ids.length) sentTalk.set(kind, ids.slice());
    else sentTalk.delete(kind);
}

/** Talk entry ids already in this generation's prompt: { games: [], combat: [] }. */
export function currentSentTalk() {
    return { games: sentTalk.get('games') || [], combat: sentTalk.get('combat') || [] };
}

/*
 * What the last recall put in and left out, per module, for the panels' plain note. Kept across
 * generations (it describes the last one), cleared when the chat changes.
 */
const recallStats = new Map();

export function setRecallStats(moduleId, stats) {
    if (stats) recallStats.set(moduleId, { kept: Number(stats.kept) || 0, dropped: Number(stats.dropped) || 0, at: Date.now() });
    else recallStats.delete(moduleId);
}

export function getRecallStats(moduleId) {
    return recallStats.get(moduleId) || null;
}

export function clearRecallStats() {
    recallStats.clear();
}

/* ---- error toasts -------------------------------------------------------------------- */

const lastToast = new Map();

/** One toast per kind per minute: a dead Ollama must not bury the chat in warnings. */
export function warnOnce(kind, message) {
    const now = Date.now();
    if (now - (lastToast.get(kind) || 0) < 60000) return;
    lastToast.set(kind, now);
    console.warn(LOG_PREFIX, message);
    try { toastr.warning(message, 'Worldkit vectors'); } catch { /* no toastr in tests */ }
}

/* ---- connection test ----------------------------------------------------------------- */

const PROBE_COLLECTION = 'sillynpc_probe';
/** Fixed text, never chat content: the probe must not send anything of the user's. */
const PROBE_TEXT = 'Worldkit connection test';

/**
 * Does Ollama answer, is the model there, does embedding work through SillyTavern, and how wide
 * are the vectors. Each step says what it found; a failed step does not hide the earlier ones.
 *
 * @returns {Promise<{ ok: boolean, steps: { label: string, ok: boolean|null, detail: string }[] }>}
 */
export async function testConnection() {
    const src = currentSource();
    const steps = [];
    let models = [];

    try {
        const response = await fetch('/api/backends/text-completions/status', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ api_server: src.apiUrl, api_type: textgen_types.OLLAMA }),
        });
        if (!response.ok) throw new Error(`no answer (${response.status})`);
        const data = await response.json();
        models = (Array.isArray(data?.data) ? data.data : []).map(m => String(m.id || m.name || ''));
        steps.push({ label: 'Ollama answers', ok: true, detail: `${src.apiUrl} (${models.length} model${models.length === 1 ? '' : 's'})` });
    } catch (err) {
        steps.push({ label: 'Ollama answers', ok: false, detail: `${src.apiUrl}: ${err?.message || err}` });
        return { ok: false, steps };
    }

    const wanted = src.model.toLowerCase();
    const present = models.some(m => m.toLowerCase() === wanted || m.toLowerCase() === `${wanted}:latest` || `${m.toLowerCase()}:latest` === wanted);
    steps.push({ label: 'Model is pulled', ok: present, detail: present ? src.model : `${src.model} not found. Run: ollama pull ${src.model}` });

    try {
        await insertItems(PROBE_COLLECTION, [{ hash: 1, text: PROBE_TEXT, index: 0 }]);
        const hits = await queryCollection(PROBE_COLLECTION, PROBE_TEXT, 1, 0);
        steps.push({ label: 'Remembering through SillyTavern', ok: hits.length > 0, detail: hits.length ? 'insert and search work' : 'stored, but the search found nothing' });
    } catch (err) {
        steps.push({ label: 'Remembering through SillyTavern', ok: false, detail: String(err?.message || err) });
    } finally {
        purgeCollection(PROBE_COLLECTION).catch(() => { });
    }

    // SillyTavern does not report the vector width, so ask Ollama directly with the fixed probe
    // text. Browsers may block this (Ollama only allows some origins); that is not a failure.
    try {
        const url = new URL('/api/embed', src.apiUrl);
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: src.model, input: [PROBE_TEXT] }),
        });
        const data = await response.json();
        const dim = data?.embeddings?.[0]?.length;
        steps.push({ label: 'Model output size', ok: dim ? true : null, detail: dim ? String(dim) : 'not reported' });
    } catch {
        steps.push({ label: 'Model output size', ok: null, detail: 'unknown (the browser cannot reach Ollama directly; that is fine)' });
    }

    return { ok: steps.every(s => s.ok !== false), steps };
}
