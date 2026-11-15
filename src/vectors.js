import { eventSource, event_types } from '../../../../events.js';
import { getContext } from '../../../../st-context.js';
import { extension_settings } from '../../../../extensions.js';
import { name1 } from '../../../../../script.js';
import { saveSettings } from './settings.js';
import { LOG_PREFIX, debugLog } from './constants.js';
import {
    VECTOR_MODULES, MODULE_IDS, moduleOn, TEMPLATES, chunkThread, buildQueryText,
    ensureManifest, planSync, markInserted, markFailed, setEntryFlags, clearManifest, entryState,
    manifestStatus, embedText, collectionId, phoneKey, hashString, retrievePicks, formatRecalled,
} from './vector-core.js';
import {
    vectorSettings, currentSource, insertItems, deleteHashes, purgeCollection, service,
    publishPicks, clearPicks, warnOnce,
} from './vector-service.js';
import { chatStore, editPerson, BONDS_CHANGED_EVENT } from './bonds.js';
import { bondEntryId, removeMilestone } from './bonds-core.js';
import { listRecords, removeRecord, RIVALRY_CHANGED_EVENT } from './rivalry.js';

/**
 * Vectors for SillyNPC's histories (fork): SillyTavern wiring.
 *
 * Each module gets an adapter that lists its entries in vector-core's plain shape. A sync embeds
 * what is new or edited and removes what was disabled, deleted or changed. Before a generation a
 * search picks the entries most related to the last few messages; the modules then put those in
 * the slots they already had, at the position, depth and role they already used. With vectors
 * off, or when the search fails or is slow, nothing is published and every module behaves
 * exactly as it did before.
 */

export const VECTORS_CHANGED_EVENT = 'sillynpc-vectors-changed';
const PHONE_CHANGED_EVENT = 'sillynpc-phone-changed';
const META_KEY = 'sillynpc_vectors';
const PHONE_MODULE = 'sillynpc_phone';

const player = () => String(name1 || getContext()?.name1 || 'the player');

/* ---- where manifests live ------------------------------------------------------------ */

function chatMeta() {
    const ctx = getContext();
    return ctx?.chatId && ctx.chatMetadata ? ctx.chatMetadata : null;
}

/**
 * Loads a manifest, repaired for the chat (or contact) and model in use. A reset (a copied
 * chat, a new model) is saved at once, so the new key is the one the next sync writes to.
 */
function loadManifest(moduleId, scope, { persist = true } = {}) {
    const model = currentSource().model;
    if (moduleId === 'phone') {
        if (!scope) return null;
        const all = vectorSettings().phoneManifests;
        const raw = all[phoneKey(scope)];
        const { manifest, reset } = ensureManifest(raw, { owner: String(scope), model });
        // Only looking (a panel, a search) never writes a manifest that was not there.
        if (!raw && !persist) return manifest;
        all[phoneKey(scope)] = manifest;
        if (reset) saveSettings();
        return manifest;
    }
    const meta = chatMeta();
    if (!meta) return null;
    const bag = meta[META_KEY] && typeof meta[META_KEY] === 'object' ? meta[META_KEY] : null;
    const raw = bag?.[moduleId];
    const { manifest, reset } = ensureManifest(raw, { owner: String(getContext().chatId), model });
    // Only looking never adds anything to a chat's metadata: with vectors unused, chats stay as they were.
    if (!raw && !persist) return manifest;
    meta[META_KEY] = bag || {};
    meta[META_KEY][moduleId] = manifest;
    if (reset) getContext().saveMetadataDebounced?.();
    return manifest;
}

function storeManifest(moduleId, scope, manifest) {
    if (moduleId === 'phone') {
        vectorSettings().phoneManifests[phoneKey(scope)] = manifest;
        saveSettings();
        return;
    }
    const meta = chatMeta();
    if (!meta) return;
    meta[META_KEY] = meta[META_KEY] || {};
    meta[META_KEY][moduleId] = manifest;
    getContext().saveMetadataDebounced?.();
}

function collectionFor(moduleId, scope, manifest) {
    // The phone's collection is per contact, whatever chat is open; the rest are per chat.
    return moduleId === 'phone' ? collectionId('phone', phoneKey(scope)) : collectionId(moduleId, manifest.key);
}

/* ---- adapters: each module's entries in one shape ------------------------------------ */

function phoneSettings() {
    return extension_settings?.[PHONE_MODULE] || {};
}

/** Phone contacts that have a thread, for the panel's picker. */
export function phoneContacts() {
    const threads = phoneSettings().threads || {};
    return Object.keys(threads).filter(k => Array.isArray(threads[k]) && threads[k].length);
}

/** A phone message as text worth embedding: inline images are dropped, they are only noise. */
const phoneText = (t) => String(t ?? '').replace(/data:[^\s)\]]+/g, '[image]').slice(0, 1200);

const ADAPTERS = {
    bonds: {
        entries() {
            const store = chatStore();
            const out = [];
            for (const person of store?.people || []) {
                for (const m of person.history || []) {
                    out.push({
                        id: bondEntryId(person, m),
                        text: TEMPLATES.bonds({ person: person.name, label: m.label, date: m.date, note: m.note }, player()),
                        at: Number(m.at) || 0,
                        // Milestones written by hand are the user's own emphasis.
                        importance: m.auto ? 0 : 1,
                        // Bond tracking is opt-in per person: untracked people stay out unless
                        // the user vectorizes their milestones by hand.
                        eligible: Boolean(person.tracked),
                        label: `${person.name}: ${m.label || 'Milestone'}`,
                        sub: [m.date, person.tracked ? '' : 'not tracked'].filter(Boolean).join(' · '),
                        ref: { person: person.name, milestone: m.id },
                    });
                }
            }
            return out;
        },
        remove(entry) {
            if (!entry?.ref) return false;
            editPerson(entry.ref.person, (p) => removeMilestone(p, entry.ref.milestone));
            return true;
        },
    },
    rivalry: {
        entries() {
            return listRecords().map(r => ({
                id: r.id,
                text: TEMPLATES.rivalry(r, player()),
                at: Number(r.at) || 0,
                importance: 0,
                eligible: true,
                label: `${r.opponent}: ${r.game || (r.kind === 'game' ? 'Game' : 'Fight')}`,
                sub: r.result,
            }));
        },
        remove(entry) {
            return removeRecord(entry.id);
        },
    },
    phone: {
        entries(scope) {
            if (!scope) return [];
            const thread = (phoneSettings().threads || {})[scope];
            if (!Array.isArray(thread) || !thread.length) return [];
            const size = vectorSettings().modules.phone.chunkSize;
            const manifest = loadManifest('phone', scope, { persist: false });
            const known = new Set(Object.keys(manifest?.entries || {}).map(id => Number(id.slice(1))).filter(Number.isFinite));
            return chunkThread(thread, size, known).map(c => ({
                id: `c${c.start}`,
                text: TEMPLATES.phone({ contact: scope, messages: c.messages.map(m => ({ ...m, text: phoneText(m.text) })) }, player()),
                at: c.end,
                start: c.start,
                end: c.end,
                importance: 0,
                // The chunk still being written is left until it is full, so it is embedded once.
                eligible: c.complete,
                label: new Date(c.start).toLocaleString(),
                sub: `${c.messages.length} message${c.messages.length === 1 ? '' : 's'}${c.complete ? '' : ' · still open'}`,
            }));
        },
        remove: null,
    },
};

function entriesOf(moduleId, scope) {
    try {
        return ADAPTERS[moduleId].entries(scope) || [];
    } catch (err) {
        debugLog(`Vectors: listing ${moduleId} failed`, err);
        return [];
    }
}

/* ---- one queue per collection -------------------------------------------------------- */

/*
 * Syncs, purges and per-entry changes all rewrite the manifest, so for one collection they run
 * one after another; otherwise a sync finishing late would put back an entry just disabled.
 */
const queues = new Map();
function queued(moduleId, scope, fn) {
    const key = `${moduleId}|${scope || ''}`;
    const prev = queues.get(key) || Promise.resolve();
    const next = prev.catch(() => { }).then(fn);
    queues.set(key, next.finally(() => { if (queues.get(key) === next) queues.delete(key); }));
    return next;
}

function changed() {
    eventSource.emit(VECTORS_CHANGED_EVENT);
}

/* ---- sync ---------------------------------------------------------------------------- */

/**
 * Brings a module's collection in line with its entries.
 *
 * @param {string} moduleId
 * @param {{ mode?: 'auto'|'manual'|'all'|'cleanup', scope?: string, only?: string[],
 *           onProgress?: (done: number, total: number) => void, signal?: AbortSignal, quiet?: boolean }} [opts]
 * @returns {Promise<{ inserted: number, removed: number, failed: number, error: string }>}
 */
export function syncModule(moduleId, { mode = 'manual', scope = '', only = null, onProgress, signal, quiet = false } = {}) {
    return queued(moduleId, scope, async () => {
        const result = { inserted: 0, removed: 0, failed: 0, error: '' };
        const manifest0 = loadManifest(moduleId, scope);
        if (!manifest0) return { ...result, error: moduleId === 'phone' ? 'Choose a contact first.' : 'No chat is open.' };
        const entries = entriesOf(moduleId, scope);
        const { batchSize } = vectorSettings();
        const plan = planSync(moduleId, manifest0, entries, { mode, only });
        const manifest = plan.manifest;
        const collection = collectionFor(moduleId, scope, manifest);

        if (plan.toDelete.length) {
            try {
                await deleteHashes(collection, plan.toDelete, { signal });
                result.removed = plan.toDelete.length;
            } catch (err) {
                // Harmless for retrieval (unknown hashes are ignored there), but worth saying.
                manifest.lastError = String(err?.message || err);
                result.error = manifest.lastError;
            }
        }

        const total = plan.toInsert.length;
        onProgress?.(0, total);
        for (let i = 0; i < total; i += batchSize) {
            if (signal?.aborted) { result.error = 'Cancelled.'; break; }
            const batch = plan.toInsert.slice(i, i + batchSize);
            try {
                await insertItems(collection, batch.flatMap(item => item.chunks), { signal });
                for (const item of batch) markInserted(manifest, item);
                result.inserted += batch.length;
            } catch (err) {
                const msg = String(err?.message || err);
                markFailed(manifest, batch, msg);
                result.failed += total - i;
                result.error = msg;
                if (!quiet) warnOnce('insert', msg);
                // Ollama down or the model missing fails every batch the same way; stop asking.
                break;
            }
            storeManifest(moduleId, scope, manifest);
            onProgress?.(Math.min(total, i + batch.length), total);
        }

        if (!result.error) manifest.lastError = '';
        manifest.lastSync = Date.now();
        storeManifest(moduleId, scope, manifest);
        changed();
        return result;
    });
}

/** Removes the whole collection, and forgets what was in it. Entries stay, ready to vectorize again. */
export function purgeModule(moduleId, scope = '') {
    return queued(moduleId, scope, async () => {
        const manifest = loadManifest(moduleId, scope);
        if (!manifest) return { error: 'Nothing to purge.' };
        try {
            await purgeCollection(collectionFor(moduleId, scope, manifest));
        } catch (err) {
            manifest.lastError = String(err?.message || err);
            storeManifest(moduleId, scope, manifest);
            changed();
            return { error: manifest.lastError };
        }
        clearManifest(manifest);
        storeManifest(moduleId, scope, manifest);
        changed();
        return { error: '' };
    });
}

/**
 * The user's changes to one entry: { enabled }, { text } (an edit; '' restores the original),
 * { deleted } (a tombstone, for modules whose entries are not ours to delete).
 */
export function setEntry(moduleId, scope, id, patch) {
    return queued(moduleId, scope, async () => {
        const manifest = loadManifest(moduleId, scope);
        if (!manifest) return { error: 'No chat is open.' };
        const drop = setEntryFlags(manifest, id, patch);
        let error = '';
        if (drop.length) {
            try {
                await deleteHashes(collectionFor(moduleId, scope, manifest), drop);
            } catch (err) {
                // The manifest already forgets them, so the search ignores them either way.
                error = String(err?.message || err);
                manifest.lastError = error;
            }
        }
        storeManifest(moduleId, scope, manifest);
        changed();
        return { error };
    }).then(async (res) => {
        // An edit or a re-enable takes effect at once when auto-vectorize is on.
        const s = vectorSettings();
        if (!res.error && moduleOn(s, moduleId) && s.autoVectorize && ('text' in patch || patch.enabled === true)) {
            await syncModule(moduleId, { mode: 'auto', scope, quiet: true });
        }
        return res;
    });
}

/**
 * Deletes an entry. Bond milestones and rivalry records are deleted from the history itself,
 * which the next sync follows. State blocks and phone messages belong to the chat and the phone,
 * so there it is a tombstone: out of the collection and never retrieved, but the message stays.
 */
export async function deleteEntry(moduleId, scope, entry) {
    const remove = ADAPTERS[moduleId]?.remove;
    if (remove) {
        remove(entry);
        return syncModule(moduleId, { mode: 'cleanup', scope, quiet: true });
    }
    return setEntry(moduleId, scope, entry.id, { deleted: true });
}

/* ---- what the panels show ------------------------------------------------------------ */

/**
 * Everything a panel needs for one module.
 * @returns {{ on: boolean, master: boolean, collection: string, status: object, rows: object[], scopeNeeded: boolean }}
 */
export function panelData(moduleId, scope = '') {
    const s = vectorSettings();
    const master = s.enabled;
    const on = moduleOn(s, moduleId);
    if (moduleId === 'phone' && !scope) {
        return { on, master, collection: '', status: manifestStatus(moduleId, null, []), rows: [], scopeNeeded: true };
    }
    const manifest = loadManifest(moduleId, scope, { persist: false });
    const entries = entriesOf(moduleId, scope);
    const rows = entries.map(e => {
        const rec = manifest?.entries?.[e.id] || null;
        return {
            ...e,
            state: entryState(moduleId, e, rec),
            enabled: rec ? rec.enabled : true,
            edited: Boolean(rec?.text),
            embedText: embedText(e, rec),
            error: rec?.error || '',
        };
    });
    return {
        on,
        master,
        collection: manifest ? collectionFor(moduleId, scope, manifest) : '',
        status: manifestStatus(moduleId, manifest, entries),
        rows,
        scopeNeeded: false,
        lastSync: manifest?.lastSync || 0,
    };
}

/** One line per module for the core tab. */
export function overview() {
    return MODULE_IDS.map(id => {
        if (id === 'phone') {
            const contacts = phoneContacts();
            const sum = { total: 0, vectorized: 0, stale: 0, errors: 0 };
            for (const c of contacts) {
                const d = panelData('phone', c).status;
                sum.total += d.total; sum.vectorized += d.vectorized; sum.stale += d.stale; sum.errors += d.errors;
            }
            return { id, label: VECTOR_MODULES[id].label, on: moduleOn(vectorSettings(), id), status: sum, scope: `${contacts.length} contact${contacts.length === 1 ? '' : 's'}` };
        }
        const d = panelData(id);
        return { id, label: VECTOR_MODULES[id].label, on: d.on, status: d.status, scope: 'this chat', collection: d.collection };
    });
}

/* ---- retrieval ----------------------------------------------------------------------- */

/*
 * The last search per collection and query. A swipe or a second listener asking again for the
 * same messages gets the same answer without another round trip to Ollama.
 */
const cache = new Map();
const CACHE_MAX = 30;

async function cachedPicks(moduleId, scope, text, extra = {}) {
    const s = vectorSettings();
    const manifest = loadManifest(moduleId, scope, { persist: false });
    if (!manifest) return { ids: null, error: '' };
    const collection = collectionFor(moduleId, scope, manifest);
    const entries = new Map(entriesOf(moduleId, scope).map(e => [e.id, e]));
    const topK = extra.topK ?? s.topK;
    const key = `${collection}|${manifest.lastSync}|${hashString(text)}|${topK}|${s.threshold}|${extra.excludeKey || ''}`;
    if (cache.has(key)) return cache.get(key);
    const result = await retrievePicks(service, {
        collection, text, manifest, entries, topK, threshold: s.threshold, timeoutMs: s.timeoutMs, exclude: extra.exclude || null,
    });
    // Failures are not cached: the next turn should try again.
    if (Array.isArray(result.ids)) {
        cache.set(key, result);
        if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
    }
    return { ...result, entries, manifest };
}

/**
 * Before each generation: search every chat module that is on, publish the picks, and get out
 * of the way. Never throws and never waits longer than the timeout; any failure leaves no picks,
 * which is the old behavior.
 */
async function onGenerationStarted(type, _options, dryRun) {
    clearPicks();
    if (dryRun) return;
    // Quiet requests (the tracker's own, other extensions') are frequent and never a story reply.
    if (type === 'quiet') return;
    try {
        const s = vectorSettings();
        if (!s.enabled) return;
        const active = ['bonds', 'rivalry'].filter(id => moduleOn(s, id));
        if (!active.length) return;
        const text = buildQueryText(getContext()?.chat || [], {
            count: s.queryMessages,
            // The reply a regenerate or a swipe replaces must not steer the search for its replacement.
            skipLastReply: type === 'regenerate' || type === 'swipe',
        });
        if (!text) return;
        await Promise.all(active.map(async (id) => {
            const r = await cachedPicks(id, '', text, {});
            if (r.error) { warnOnce('search', `Vector search for ${VECTOR_MODULES[id].label} failed, using the newest entries instead. ${r.error}`); return; }
            if (!Array.isArray(r.ids)) return;
            publishPicks(id, r.ids);
        }));
    } catch (err) {
        // Whatever went wrong, the generation goes ahead as if vectors were off.
        clearPicks();
        debugLog('Vector retrieval failed', err);
    }
}

/**
 * Older text chunks from a phone thread that relate to what is being said now, as a block for
 * the phone's request, or ''. Chunks inside the recent window the phone already sends are left
 * out. Never throws; a failure or timeout gives ''.
 *
 * @param {string} contact the thread's key
 * @param {{ recentFromTs?: number }} [opts] the first timestamp the request already carries
 */
export async function recallPhone(contact, { recentFromTs = Infinity } = {}) {
    try {
        const s = vectorSettings();
        if (!moduleOn(s, 'phone') || !contact) return '';
        const thread = (phoneSettings().threads || {})[contact];
        if (!Array.isArray(thread) || !thread.length) return '';
        const you = player();
        const text = thread.slice(-s.queryMessages).map(m => `${m.who === 'user' ? you : m.name}: ${phoneText(m.text)}`).join('\n');
        const entries = entriesOf('phone', contact);
        const exclude = new Set(entries.filter(e => e.end >= recentFromTs).map(e => e.id));
        const r = await cachedPicks('phone', contact, text, { topK: s.modules.phone.recall, exclude, excludeKey: String(recentFromTs) });
        if (r.error) { warnOnce('search', `Vector search for phone texts failed; sending the recent texts only. ${r.error}`); return ''; }
        if (!Array.isArray(r.ids) || !r.ids.length) return '';
        const byId = r.entries || new Map(entries.map(e => [e.id, e]));
        const items = r.ids.map(id => byId.get(id)).filter(Boolean).sort((a, b) => a.start - b.start).map(e => ({
            label: new Date(e.start).toLocaleDateString(),
            text: embedText(e, (r.manifest || loadManifest('phone', contact)).entries[e.id]).replace(/^Text messages between [^\n]*\n/, ''),
        }));
        return formatRecalled(items, { heading: '[OLDER TEXTS THAT MAY MATTER]', maxChars: 2400 });
    } catch (err) {
        debugLog('Phone vector recall failed', err);
        return '';
    }
}

/* ---- automatic sync ------------------------------------------------------------------ */

const timers = new Map();

/** Schedules a quiet sync after the changes settle, when the module and auto-vectorize are on. */
function scheduleSync(moduleId, scope = '') {
    const s = vectorSettings();
    if (!moduleOn(s, moduleId) || !s.autoVectorize) return;
    const key = `${moduleId}|${scope}`;
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => {
        timers.delete(key);
        syncModule(moduleId, { mode: 'auto', scope, quiet: false })
            .catch(err => console.warn(LOG_PREFIX, 'Vector sync failed', err));
    }, 2000));
}

export function initVectors() {
    // makeFirst: the search must finish before the modules' own GENERATION_STARTED listeners
    // read the picks. SillyTavern awaits each listener in turn, so awaiting here is enough.
    eventSource.makeFirst(event_types.GENERATION_STARTED, onGenerationStarted);

    eventSource.on(BONDS_CHANGED_EVENT, () => scheduleSync('bonds'));
    eventSource.on(RIVALRY_CHANGED_EVENT, () => scheduleSync('rivalry'));
    eventSource.on(PHONE_CHANGED_EVENT, (contact) => { if (contact) scheduleSync('phone', String(contact)); });
    eventSource.on(event_types.CHAT_CHANGED, () => {
        clearPicks();
        cache.clear();
        // Catch up on anything written while vectors were off or Ollama was down.
        for (const id of ['bonds', 'rivalry']) scheduleSync(id);
    });
}
