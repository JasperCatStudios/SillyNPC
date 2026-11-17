import { eventSource, event_types } from '../../../../events.js';
import { getContext } from '../../../../st-context.js';
import { extension_settings } from '../../../../extensions.js';
import { name1, setExtensionPrompt, extension_prompt_types, extension_prompt_roles } from '../../../../../script.js';
import { saveSettings, getSettings } from './settings.js';
import { LOG_PREFIX, debugLog } from './constants.js';
import {
    VECTOR_MODULES, MODULE_IDS, moduleActive, vectorBadge, TEMPLATES, chunkThread, buildQueryText,
    ensureManifest, planSync, markInserted, markFailed, setEntryFlags, clearManifest, entryState,
    manifestStatus, embedText, collectionId, phoneKey, hashString, retrievePicks, droppedNote,
    phoneThreadName, phoneRecallTargets, memoryVisibleIn, phoneMemoryText, buildPhoneRecall, shareHistory,
} from './vector-core.js';
import {
    vectorSettings, currentSource, insertItems, deleteHashes, purgeCollection, service,
    publishPicks, currentPicks, clearPicks, warnOnce, publishSentTalk, setRecallStats, getRecallStats, clearRecallStats,
    historyTotal, publishRivalryRoom,
} from './vector-service.js';
import { listRecords, removeRecord, RIVALRY_CHANGED_EVENT } from './rivalry.js';
import { sidesText, winnerText, sideNames } from './rivalry-core.js';
import { listTalk, removeTalk, TALK_CHANGED_EVENT } from './talk-store.js';
import { talkEmbedText, talkImportance, buildTalkInjectionReport, TALK_KINDS } from './talk-log.js';
import { charactersMentionedIn, mentionsName } from './mentions.js';
import { sceneNames, sceneSet } from './scene-cast.js';

/**
 * Vectors for SillyNPC's histories (fork): SillyTavern wiring.
 *
 * Only histories of what happened are vectorized: the rivalry record, phone threads, and the
 * table talk of games and fights. Bonds are current state and never vectorized.
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

/** The Phone module's own switch. Off: nothing of the phone is embedded, searched or sent. */
export function phoneModuleEnabled() {
    return phoneSettings().enabled === true;
}

const flags = () => ({ phoneEnabled: phoneModuleEnabled() });

/** Whether this module's vectors do anything right now (master, its own switch, and the phone's). */
export function moduleInUse(moduleId) {
    return moduleActive(vectorSettings(), moduleId, flags());
}

/** Phone contacts that have a thread, for the panel's picker. */
export function phoneContacts() {
    const threads = phoneSettings().threads || {};
    return Object.keys(threads).filter(k => Array.isArray(threads[k]) && threads[k].length);
}

/**
 * A phone message as text worth searching: inline images are dropped, they are only noise, and
 * a very long text is shortened for the search alone. What is recalled is always the full text
 * (phoneMemoryText), rebuilt from the thread.
 */
const phoneText = (t) => String(t ?? '').replace(/data:[^\s)\]]+/g, '[image]').slice(0, 1200);

/** Games or combat talk in the adapters' shape: one embeddable item per game or fight. */
export function talkAdapterEntries(kind, list) {
    return (list || []).map(e => ({
        id: e.id,
        text: talkEmbedText(e, kind),
        at: Number(e.at) || 0,
        importance: talkImportance(e),
        eligible: true,
        label: `${e.title}${e.with?.length ? ` with ${e.with.join(', ')}` : ''}`,
        sub: [e.date, e.result].filter(Boolean).join(' · '),
    }));
}

const ADAPTERS = {
    rivalry: {
        entries() {
            const you = player();
            return listRecords().map(r => ({
                id: r.id,
                // Names everyone on both sides, so a search for any of them finds it.
                text: TEMPLATES.rivalry(r, you),
                at: Number(r.at) || 0,
                importance: 0,
                eligible: true,
                label: `${sidesText(r, you)}: ${r.game || (r.kind === 'game' ? 'Game' : 'Fight')}`,
                sub: winnerText(r, you),
                // Who took part; the history block only writes a person's own records.
                people: [...sideNames(r, 'A', you), ...sideNames(r, 'B', you), ...(r.spectators || [])],
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
                // The texts themselves, as they are now: a recalled memory is rebuilt from these,
                // whole, never from the (shortened) text that was stored for the search.
                messages: c.messages,
                label: new Date(c.start).toLocaleString(),
                sub: `${c.messages.length} text${c.messages.length === 1 ? '' : 's'}${c.complete ? '' : ' · still open'}`,
            }));
        },
        remove: null,
    },
    games: {
        entries: () => talkAdapterEntries('games', listTalk('games')),
        remove: (entry) => removeTalk('games', entry.id),
    },
    combat: {
        entries: () => talkAdapterEntries('combat', listTalk('combat')),
        remove: (entry) => removeTalk('combat', entry.id),
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
        // The Phone module switched off means nothing of the phone goes to the vector store.
        if (moduleId === 'phone' && !phoneModuleEnabled() && mode !== 'cleanup') {
            return { ...result, error: 'The Phone module is off, so its texts are not remembered. Switch it on under Modules > Phone.' };
        }
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
        if (!res.error && moduleActive(s, moduleId, flags()) && s.autoVectorize && ('text' in patch || patch.enabled === true)) {
            await syncModule(moduleId, { mode: 'auto', scope, quiet: true });
        }
        return res;
    });
}

/**
 * Deletes an entry. Rivalry records and games/fight talk are deleted from the history itself,
 * which the next sync follows. Phone messages belong to the phone,
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
    const badge = vectorBadge(s, moduleId, flags());
    const on = badge.on;
    if (moduleId === 'phone' && !scope) {
        return { on, master, badge, collection: '', status: manifestStatus(moduleId, null, []), rows: [], scopeNeeded: true };
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
        badge,
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
            const badge = vectorBadge(vectorSettings(), id, flags());
            return { id, label: VECTOR_MODULES[id].label, on: badge.on, badge, status: sum, scope: `${contacts.length} contact${contacts.length === 1 ? '' : 's'}` };
        }
        const d = panelData(id);
        return { id, label: VECTOR_MODULES[id].label, on: d.on, badge: d.badge, status: d.status, scope: 'this chat', collection: d.collection };
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
    if (cache.has(key)) return { ...cache.get(key), entries, manifest };
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
    // Quiet requests (the tracker's own, other extensions') are frequent and never a story reply;
    // a dry run only counts tokens. Both leave the last story reply's picks and blocks alone, so
    // what the shared history reads still matches the recalled block that stays in the prompt.
    if (dryRun || type === 'quiet') return;
    clearPicks();
    phoneRecall = null;
    try {
        await searchChatModules(type);
    } catch (err) {
        // Whatever went wrong, the generation goes ahead as if vectors were off.
        clearPicks();
        phoneRecall = null;
        debugLog('Vector retrieval failed', err);
    }
    // Set or cleared every time: with vectors off or no picks, the block is gone.
    applyTalkInjection();
}

async function searchChatModules(type) {
    const s = vectorSettings();
    if (!s.enabled) return;
    const active = ['rivalry', ...TALK_KINDS].filter(id => moduleActive(s, id, flags()));
    const phoneOn = moduleActive(s, 'phone', flags());
    if (!active.length && !phoneOn) return;
    const chat = getContext()?.chat || [];
    const text = buildQueryText(chat, {
        count: s.queryMessages,
        // The reply a regenerate or a swipe replaces must not steer the search for its replacement.
        skipLastReply: type === 'regenerate' || type === 'swipe',
    });
    if (!text) return;
    const jobs = active.map(async (id) => {
        const talk = TALK_KINDS.includes(id);
        // Games and fights are recalled whole, so only as many as their own recall setting.
        const r = await cachedPicks(id, '', text, talk ? { topK: s.modules[id].recall } : {});
        if (r.error) {
            warnOnce('search', `Could not search the ${VECTOR_MODULES[id].label.toLowerCase()}, ${talk ? 'so none are remembered this time' : 'so the newest records are used instead'}. ${r.error}`);
            return;
        }
        if (!Array.isArray(r.ids)) return;
        publishPicks(id, r.ids);
    });
    if (phoneOn) jobs.push(searchPhone(text, chat, s).then(r => { phoneRecall = r; }));
    await Promise.all(jobs);
}

/* ---- phone memories in the main story ------------------------------------------------ */

/*
 * The phone's texts come back in the MAIN story only, never in the phone's own request (that
 * request is exactly as it always was). The threads searched are those with someone the scene
 * is about: in the scene by the tracker, or named in the last few story messages.
 */
let phoneRecall = null;
/** At most this many threads are searched per reply: each is one more call to the embedder. */
const PHONE_MAX_THREADS = 4;

/** Whether a person matters to the scene now, for the phone recall. */
function sceneRelevance(chat, scanDepth) {
    let here = new Set();
    try { here = sceneSet(); } catch { /* no chat open */ }
    const text = (chat || []).filter(m => m && !m.is_system).slice(-scanDepth).map(m => String(m?.mes || '')).join('\n');
    const known = getSettings().characters || [];
    return (name) => {
        const n = String(name || '').trim();
        if (!n) return false;
        if (here.has(n.toLowerCase())) return true;
        const rec = known.find(c => String(c.name).toLowerCase() === n.toLowerCase());
        // A known character's aliases count too, the way the rest of SillyNPC finds names.
        if (rec) return charactersMentionedIn(text, [rec]).length > 0;
        return mentionsName(text, n, true);
    };
}

/**
 * Searches the relevant threads with the story's last messages. Never throws. The block itself
 * is built later, with the room the shared total gives it (currentTalkInjection).
 * @returns {Promise<null | { key: string, name: string, items: object[] }[]>} best first per contact
 */
async function searchPhone(text, chat, s) {
    try {
        const threads = phoneSettings().threads || {};
        const chats = phoneSettings().chats || {};
        const keys = phoneRecallTargets({
            settings: s, phoneEnabled: phoneModuleEnabled(), threads, chats,
            isRelevant: sceneRelevance(chat, Math.max(6, s.queryMessages)), max: PHONE_MAX_THREADS,
        });
        if (!keys.length) return null;
        // What the story already shows is not recalled again: only a memory whose every text is
        // in the visible chat (pasted, or posted there by the phone) is left out.
        const visible = chat.filter(m => m && !m.is_system).slice(-300).map(m => String(m?.mes || '')).join('\n');
        const you = player();
        const groups = await Promise.all(keys.map(async (key) => {
            const entries = entriesOf('phone', key);
            const exclude = new Set(entries.filter(e => memoryVisibleIn(e.messages, visible)).map(e => e.id));
            const r = await cachedPicks('phone', key, text, {
                topK: s.modules.phone.recall, exclude, excludeKey: hashString([...exclude].sort().join(',')),
            });
            if (r.error) {
                warnOnce('search', `Could not search the phone texts with ${phoneThreadName(key, chats)}, so none are remembered this time. ${r.error}`);
                return null;
            }
            if (!Array.isArray(r.ids) || !r.ids.length) return null;
            const byId = r.entries || new Map(entries.map(e => [e.id, e]));
            const name = phoneThreadName(key, chats);
            const items = r.ids.map(id => byId.get(id)).filter(Boolean).map(e => ({
                id: e.id,
                start: e.start,
                label: new Date(e.start).toLocaleDateString(),
                // Rebuilt from the live thread: every text, at full length.
                text: phoneMemoryText(e.messages, { player: you, contact: name }),
            }));
            return { key, name, items };
        }));
        const found = groups.filter(Boolean);
        return found.length ? found : null;
    } catch (err) {
        debugLog('Phone memory recall failed', err);
        return null;
    }
}

/* ---- recalled games, fights and texts in the story prompt ---------------------------- */

const TALK_INJECT_KEY = 'sillynpc_talk_recall';

/** Remembers what the last recall left out, for the panels' plain note; logs any drop. */
export function noteRecall(moduleId, r, room = null) {
    const before = droppedNote(getRecallStats(moduleId) || {});
    const kept = r ? r.kept.length : 0;
    const dropped = r ? r.dropped.length : 0;
    setRecallStats(moduleId, r ? { kept, dropped } : null);
    if (dropped) {
        debugLog(`Vectors: ${VECTOR_MODULES[moduleId].label}: ${kept} whole kept, ${dropped} left out to fit ${room ?? '?'} tokens of the total ${historyTotal()}`,
            r.dropped.map(d => d?.id ?? d));
    }
    if (droppedNote(getRecallStats(moduleId) || {}) !== before) changed();
}

/** The modules whose brought-back history is in the main story now, in the order they share it. */
const SHARE_ORDER = Object.freeze(['rivalry', 'games', 'combat', 'phone']);

/**
 * The block this generation's picks make, or ''. Games, fights and phone texts have no injection
 * of their own without vectors, so with vectors this block is their only way into the story.
 * Also says which talk entries it carries, so the shared history does not repeat those events,
 * and what is left of "History brought back, total" for the shared-history block.
 */
export function currentTalkInjection({ record = false } = {}) {
    const s = vectorSettings();
    // Rivalry takes a share only when its block is sent at all ("Put the history in the story prompt").
    let historyOn = false;
    try { historyOn = Boolean(getSettings().enabled && getSettings().historyInject?.enabled); } catch { /* not loaded */ }
    const active = SHARE_ORDER.filter(id => moduleActive(s, id, flags()) && (id !== 'rivalry' || historyOn));
    const build = {};
    for (const kind of TALK_KINDS) {
        if (!active.includes(kind)) continue;
        const ids = currentPicks(kind);
        if (!Array.isArray(ids) || !ids.length) continue;
        build[kind] = (room) => {
            const { text, report } = buildTalkInjectionReport({
                picks: { [kind]: ids }, lists: { [kind]: listTalk(kind) }, recall: { [kind]: s.modules[kind].recall }, budgetTokens: room,
            });
            return report[kind] ? { ...report[kind], text } : null;
        };
    }
    const phoneGroups = active.includes('phone') ? phoneRecall : null;
    if (Array.isArray(phoneGroups) && phoneGroups.length) {
        build.phone = (room) => buildPhoneRecall(phoneGroups, { budgetTokens: room, recall: s.modules.phone.recall });
    }
    const total = historyTotal();
    const share = shareHistory({ total, active, settings: s, build });
    if (record) {
        for (const kind of TALK_KINDS) {
            const r = share.results[kind];
            publishSentTalk(kind, (r?.kept || []).map(e => e.id));
            if (r) noteRecall(kind, r, share.rooms[kind]);
        }
        if (share.results.phone) noteRecall('phone', share.results.phone, share.rooms.phone);
        // The shared-history block, built next, gets its own amount or what the others left.
        if (active.includes('rivalry')) {
            const own = Number(s.modules.rivalry.amountTokens) || 0;
            publishRivalryRoom(own > 0 ? share.rooms.rivalry : share.left);
        } else publishRivalryRoom(null);
    }
    return ['games', 'combat', 'phone'].map(id => share.results[id]?.text || '').filter(Boolean).join('\n\n');
}

function applyTalkInjection() {
    try {
        const s = vectorSettings();
        const text = currentTalkInjection({ record: true });
        if (!text) {
            setExtensionPrompt(TALK_INJECT_KEY, '', extension_prompt_types.IN_CHAT, 0, false);
            return;
        }
        const roles = {
            system: extension_prompt_roles.SYSTEM,
            user: extension_prompt_roles.USER,
            assistant: extension_prompt_roles.ASSISTANT,
        };
        setExtensionPrompt(TALK_INJECT_KEY, text, extension_prompt_types.IN_CHAT, s.injectDepth, false, roles[s.injectRole]);
    } catch (err) {
        // Never half a block: on any failure nothing of it is sent, and no event counts as sent.
        try { setExtensionPrompt(TALK_INJECT_KEY, '', extension_prompt_types.IN_CHAT, 0, false); } catch { /* ignore */ }
        for (const kind of TALK_KINDS) publishSentTalk(kind, null);
        debugLog('Could not set the remembered games, fights and texts', err);
    }
}

/** What the last story reply left out to save space, in plain words, per module, or ''. */
export function recallNote(moduleId) {
    const m = VECTOR_MODULES[moduleId];
    return m ? droppedNote(getRecallStats(moduleId) || {}, m.noun, m.nouns) : '';
}

/* ---- automatic sync ------------------------------------------------------------------ */

const timers = new Map();

/** Schedules a quiet sync after the changes settle, when the module and auto-vectorize are on. */
function scheduleSync(moduleId, scope = '') {
    const s = vectorSettings();
    if (!moduleActive(s, moduleId, flags()) || !s.autoVectorize) return;
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

    eventSource.on(RIVALRY_CHANGED_EVENT, () => scheduleSync('rivalry'));
    eventSource.on(TALK_CHANGED_EVENT, (kind) => { if (TALK_KINDS.includes(kind)) scheduleSync(kind); });
    eventSource.on(PHONE_CHANGED_EVENT, (contact) => { if (contact) scheduleSync('phone', String(contact)); });
    eventSource.on(event_types.CHAT_CHANGED, () => {
        clearPicks();
        phoneRecall = null;
        cache.clear();
        clearRecallStats();
        // The last chat's remembered games, fights and texts must not reach the next one.
        applyTalkInjection();
        // Catch up on anything written while vectors were off or Ollama was down.
        for (const id of ['rivalry', ...TALK_KINDS]) scheduleSync(id);
    });
}
