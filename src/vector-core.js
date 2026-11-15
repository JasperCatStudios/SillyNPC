/**
 * Vectors for SillyNPC's histories (fork): the decisions, without the I/O.
 *
 * Each module (rivalry, phone, games, combat) hands this file its entries as plain
 * objects. This file turns them into the text that is embedded, hashes that text, keeps a
 * manifest of what is in the vector collection, works out what a sync must insert and delete,
 * and turns a query's results into the entries a prompt should carry. vector-service.js does the
 * HTTP; vectors.js wires both into SillyTavern.
 *
 * Pure: no DOM, no SillyTavern imports, so node can test it.
 */

/* ---- vocabulary ---------------------------------------------------------------------- */

/*
 * Only histories of what happened are vectorized. Bond numbers are the current state, not a
 * history, so the Bond Tracker is never vectorized (an old `modules.bonds` setting is dropped).
 */
export const VECTOR_MODULES = Object.freeze({
    rivalry: { label: 'Rivalry history', scope: 'chat', noun: 'record' },
    phone: { label: 'Phone conversations', scope: 'contact', noun: 'message chunk' },
    games: { label: 'Games table talk', scope: 'chat', noun: 'game' },
    combat: { label: 'Fight table talk', scope: 'chat', noun: 'fight' },
});
export const MODULE_IDS = Object.freeze(Object.keys(VECTOR_MODULES));

/*
 * What SillyTavern's own Vector Storage falls back to when nothing is set. The user's profiles
 * all run qwen3-embedding:0.6b, so that is the model used when Vector Storage names none either.
 */
export const FALLBACK_URL = 'http://localhost:11434';
export const FALLBACK_MODEL = 'qwen3-embedding:0.6b';

export const VECTOR_DEFAULTS = Object.freeze({
    enabled: false,
    /** Empty: the URL SillyTavern's Vector Storage uses for Ollama. */
    url: '',
    /** Empty: Vector Storage's Ollama model. */
    model: '',
    keep: true,
    topK: 6,
    threshold: 0.25,
    queryMessages: 3,
    autoVectorize: true,
    timeoutMs: 2500,
    batchSize: 8,
    /** Where the recalled games and fights go in the story prompt: messages back, and role. */
    injectDepth: 2,
    injectRole: 'system',
    modules: Object.freeze({
        rivalry: Object.freeze({ enabled: false }),
        phone: Object.freeze({ enabled: false, chunkSize: 4, recall: 3 }),
        games: Object.freeze({ enabled: false, recall: 2 }),
        combat: Object.freeze({ enabled: false, recall: 2 }),
    }),
});

export const INJECT_ROLES = Object.freeze(['system', 'user', 'assistant']);

/* ---- small helpers ------------------------------------------------------------------- */

const str = (v, max = 4000) => String(v ?? '').trim().slice(0, max);
const int = (v, lo, hi, d) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
};
const num = (v, lo, hi, d) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
};
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

/* ---- settings ------------------------------------------------------------------------ */

export function normalizeVectorSettings(raw) {
    const r = obj(raw);
    const d = VECTOR_DEFAULTS;
    const m = obj(r.modules);
    const mod = (id) => obj(m[id]);
    return {
        enabled: Boolean(r.enabled),
        url: str(r.url, 300),
        model: str(r.model, 120),
        keep: r.keep !== false,
        topK: int(r.topK, 1, 30, d.topK),
        threshold: num(r.threshold, 0, 1, d.threshold),
        queryMessages: int(r.queryMessages, 1, 20, d.queryMessages),
        autoVectorize: r.autoVectorize !== false,
        timeoutMs: int(r.timeoutMs, 300, 20000, d.timeoutMs),
        batchSize: int(r.batchSize, 1, 50, d.batchSize),
        injectDepth: int(r.injectDepth, 0, 100, d.injectDepth),
        injectRole: INJECT_ROLES.includes(r.injectRole) ? r.injectRole : d.injectRole,
        // Only the modules listed are kept: an old `bonds` entry is dropped here.
        modules: {
            rivalry: { enabled: Boolean(mod('rivalry').enabled) },
            phone: {
                enabled: Boolean(mod('phone').enabled),
                chunkSize: int(mod('phone').chunkSize, 2, 12, 4),
                recall: int(mod('phone').recall, 1, 8, 3),
            },
            games: { enabled: Boolean(mod('games').enabled), recall: int(mod('games').recall, 1, 6, 2) },
            combat: { enabled: Boolean(mod('combat').enabled), recall: int(mod('combat').recall, 1, 6, 2) },
        },
        // Kept by reference: the phone's manifests live here, see vectors.js.
        phoneManifests: obj(r.phoneManifests),
    };
}

/** Whether a module's vectors are switched on: the master switch and its own. */
export function moduleOn(settings, moduleId) {
    return Boolean(settings?.enabled && settings.modules?.[moduleId]?.enabled);
}

/**
 * Whether a module's vectors are in use right now. The phone also needs the Phone module itself
 * to be on: with the phone off, nothing of it is embedded, searched or sent.
 *
 * @param {object} settings normalizeVectorSettings() output
 * @param {string} moduleId
 * @param {{ phoneEnabled?: boolean }} [ctx]
 */
export function moduleActive(settings, moduleId, { phoneEnabled = false } = {}) {
    if (!moduleOn(settings, moduleId)) return false;
    return moduleId === 'phone' ? Boolean(phoneEnabled) : true;
}

/**
 * What a panel's badge says about the switches, and why it is off when it is.
 * @returns {{ on: boolean, reason: string, text: string }}
 */
export function vectorBadge(settings, moduleId, { phoneEnabled = false } = {}) {
    let reason = '';
    if (!settings?.enabled) reason = 'switch on Vectors in the SillyNPC menu';
    else if (!settings.modules?.[moduleId]?.enabled) reason = 'module switch is off';
    else if (moduleId === 'phone' && !phoneEnabled) reason = 'the Phone module is off';
    return { on: !reason, reason, text: reason ? `off: ${reason}` : 'on' };
}

/**
 * The Ollama URL, model and keep flag to send. SillyNPC's own fields win; empty ones inherit what
 * SillyTavern's Vector Storage already uses, so the user's existing setup works untouched.
 *
 * @param {object} settings normalizeVectorSettings() output
 * @param {object} stVectors extension_settings.vectors (may be empty)
 * @param {string} textgenOllamaUrl the Text Completion Ollama server URL (may be empty)
 */
export function resolveSource(settings, stVectors = {}, textgenOllamaUrl = '') {
    const v = obj(stVectors);
    const inheritedUrl = (v.use_alt_endpoint && str(v.alt_endpoint_url, 300)) || str(textgenOllamaUrl, 300);
    const inheritedModel = str(v.ollama_model, 120);
    return {
        apiUrl: settings.url || inheritedUrl || FALLBACK_URL,
        model: settings.model || inheritedModel || FALLBACK_MODEL,
        keep: settings.keep !== false,
        inherited: { url: !settings.url, model: !settings.model },
        inheritedUrl: inheritedUrl || FALLBACK_URL,
        inheritedModel: inheritedModel || FALLBACK_MODEL,
    };
}

/* ---- hashing ------------------------------------------------------------------------- */

/**
 * A 53-bit string hash (cyrb53, public domain), the same family SillyTavern's getStringHash uses,
 * so hashes fit the vector store's numeric hash field exactly.
 */
export function hashString(input, seed = 0) {
    const s = String(input ?? '');
    let h1 = 0xdeadbeef ^ seed;
    let h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < s.length; i++) {
        const ch = s.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

export const hash36 = (v) => hashString(v).toString(36);

/** The hash an entry's text is recorded under. The id is part of it so two identical notes never share one. */
export function entryHash(moduleId, id, text) {
    return hashString(`${moduleId}|${id}|${text}`);
}

/** One hash per chunk. Deleting by hash deletes every item carrying it, so each must be unique. */
export function chunkHash(moduleId, id, index, text) {
    return hashString(`${moduleId}|${id}|${index}|${text}`);
}

/* ---- collection ids ------------------------------------------------------------------ */

const safe = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

/** sillynpc_<module>_<key>: only [a-z0-9_], so it is the same folder name on every OS. */
export function collectionId(moduleId, key) {
    return `sillynpc_${safe(moduleId)}_${safe(key) || 'none'}`;
}

/** The phone's scope: one collection per contact, since its threads are global, not per chat. */
export function phoneKey(contact) {
    return hash36(String(contact ?? '').trim().toLowerCase());
}

export function randomKey(rng = Math.random) {
    let out = '';
    for (let i = 0; i < 10; i++) out += Math.floor(rng() * 36).toString(36);
    return out;
}

/* ---- text ---------------------------------------------------------------------------- */

/** HTML to plain text: tags out, line breaks kept where the markup had them. */
export function stripHtml(html) {
    return String(html ?? '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(summary|details|div|p|li)>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/[ \t]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

const RESULT_WORDS = { won: (p) => `${p} won`, lost: (p) => `${p} lost`, draw: () => 'it was a draw' };

/**
 * The embeddable text of one entry, per module. Plain sentences: that is what embedders match
 * best. Games and combat talk use talk-log.js's talkEmbedText.
 */
export const TEMPLATES = Object.freeze({
    rivalry(r, player = 'the player') {
        const kind = r.kind === 'game' ? 'Game' : 'Fight';
        const result = (RESULT_WORDS[r.result] || RESULT_WORDS.draw)(player);
        const bits = [`${kind} between ${player} and ${r.opponent}${r.game ? ` (${r.game})` : ''}: ${result}.`];
        if (r.summary) bits.push(r.summary);
        if (r.note) bits.push(r.note);
        return bits.join(' ');
    },
    phone(c, player = 'the player') {
        const lines = (c.messages || []).map(m => `${m.who === 'user' ? player : (m.name || c.contact)}: ${m.text}`);
        return `Text messages between ${player} and ${c.contact}:\n${lines.join('\n')}`;
    },
});

/**
 * Splits text into pieces no longer than maxChars, on line breaks where it can. Short entries
 * stay whole; only long ones (a long note, a long thread chunk) are cut.
 */
export function chunkText(text, maxChars = 1000) {
    const t = String(text ?? '').trim();
    if (!t) return [];
    if (t.length <= maxChars) return [t];
    const out = [];
    let cur = '';
    const push = () => { if (cur.trim()) out.push(cur.trim()); cur = ''; };
    for (const line of t.split('\n')) {
        if (line.length > maxChars) {
            push();
            for (let i = 0; i < line.length; i += maxChars) out.push(line.slice(i, i + maxChars).trim());
            continue;
        }
        if (cur && cur.length + 1 + line.length > maxChars) push();
        cur = cur ? `${cur}\n${line}` : line;
    }
    push();
    return out.filter(Boolean);
}

/**
 * Groups a phone thread into chunks of `size` messages.
 *
 * Boundaries are anchored on chunk starts already known (from the manifest), so a new message or
 * the thread's 200-message cap only changes the chunk it touches instead of shifting every
 * boundary and making the whole thread stale.
 *
 * @param {{ts:number}[]} messages oldest first
 * @param {number} size
 * @param {Set<number>} knownStarts
 * @returns {{ start: number, end: number, messages: object[], complete: boolean }[]}
 */
export function chunkThread(messages, size, knownStarts = new Set()) {
    const chunks = [];
    let cur = null;
    for (const m of messages || []) {
        if (!m || !Number.isFinite(Number(m.ts))) continue;
        const ts = Number(m.ts);
        if (!cur || cur.messages.length >= size || (cur.messages.length && knownStarts.has(ts))) {
            cur = { start: ts, end: ts, messages: [] };
            chunks.push(cur);
        }
        cur.messages.push(m);
        cur.end = ts;
    }
    return chunks.map((c, i) => ({ ...c, complete: i < chunks.length - 1 || c.messages.length >= size }));
}

/**
 * The search text: the last few messages, newest last, capped from the front so the newest
 * words always survive. A regenerate skips the reply it is about to replace.
 */
export function buildQueryText(messages, { count = 3, skipLastReply = false, maxChars = 2000 } = {}) {
    let list = (messages || []).filter(m => m && !m.is_system && String(m.mes ?? '').trim());
    if (skipLastReply && list.length && !list[list.length - 1].is_user) list = list.slice(0, -1);
    const text = list.slice(-count).map(m => `${m.name ? `${m.name}: ` : ''}${stripHtml(m.mes)}`).join('\n');
    return text.length > maxChars ? text.slice(text.length - maxChars) : text;
}

/* ---- the manifest -------------------------------------------------------------------- */

function normalizeRecord(raw) {
    const r = obj(raw);
    return {
        hash: Number.isFinite(Number(r.hash)) ? Number(r.hash) : 0,
        chunks: (Array.isArray(r.chunks) ? r.chunks : []).map(Number).filter(Number.isFinite),
        vectorized: Boolean(r.vectorized),
        enabled: r.enabled !== false,
        manual: Boolean(r.manual),
        deleted: Boolean(r.deleted),
        text: typeof r.text === 'string' ? r.text.slice(0, 4000) : '',
        error: str(r.error, 300),
        at: Number.isFinite(Number(r.at)) ? Number(r.at) : 0,
    };
}

export function normalizeManifest(raw) {
    const r = obj(raw);
    const entries = {};
    for (const [id, rec] of Object.entries(obj(r.entries))) entries[id] = normalizeRecord(rec);
    return {
        v: 1,
        key: safe(r.key),
        owner: str(r.owner, 300),
        model: str(r.model, 120),
        lastError: str(r.lastError, 300),
        lastSync: Number.isFinite(Number(r.lastSync)) ? Number(r.lastSync) : 0,
        entries,
    };
}

/** Forgets what is in the collection, keeping what the user chose (enabled, edits, by-hand, deleted). */
function forgetVectorized(manifest) {
    for (const rec of Object.values(manifest.entries)) {
        rec.vectorized = false;
        rec.chunks = [];
        rec.hash = 0;
        rec.error = '';
    }
}

/**
 * The manifest for this chat (or contact) and model, repaired.
 *
 * A different owner means the chat was branched or renamed and its metadata copied: it gets a
 * collection of its own, so two chats never share or delete each other's vectors. A different
 * model means a different index on the server (one per model), so nothing is in it yet.
 *
 * @returns {{ manifest: object, reset: boolean }}
 */
export function ensureManifest(raw, { owner = '', model = '', rng = Math.random } = {}) {
    const manifest = normalizeManifest(raw);
    let reset = false;
    if (!manifest.key) manifest.key = randomKey(rng);
    if (owner && manifest.owner && manifest.owner !== owner) {
        manifest.key = randomKey(rng);
        forgetVectorized(manifest);
        reset = true;
    }
    if (owner) manifest.owner = owner;
    if (model && manifest.model && manifest.model !== model) {
        forgetVectorized(manifest);
        reset = true;
    }
    if (model) manifest.model = model;
    return { manifest, reset };
}

/** The text an entry is embedded as: the user's edit when there is one. */
export function embedText(entry, rec) {
    return rec?.text ? rec.text : String(entry?.text ?? '');
}

/**
 * One entry's state, for the panel.
 * @returns {'deleted'|'off'|'error'|'stale'|'done'|'pending'|'skip'}
 */
export function entryState(moduleId, entry, rec) {
    if (!rec) return entry?.eligible === false ? 'skip' : 'pending';
    if (rec.deleted) return 'deleted';
    if (!rec.enabled) return 'off';
    if (rec.vectorized && rec.hash !== entryHash(moduleId, entry.id, embedText(entry, rec))) return 'stale';
    if (rec.vectorized) return 'done';
    if (rec.error) return 'error';
    if (entry?.eligible === false && !rec.manual) return 'skip';
    return 'pending';
}

/** Counts for the status line. Entries not in the manifest yet count as pending (or skipped). */
export function manifestStatus(moduleId, manifest, entries) {
    const out = { total: 0, vectorized: 0, stale: 0, disabled: 0, pending: 0, errors: 0, skipped: 0, deleted: 0, lastError: manifest?.lastError || '' };
    for (const e of entries || []) {
        const state = entryState(moduleId, e, manifest?.entries?.[e.id]);
        if (state === 'deleted') { out.deleted++; continue; }
        out.total++;
        if (state === 'done') out.vectorized++;
        else if (state === 'stale') out.stale++;
        else if (state === 'off') out.disabled++;
        else if (state === 'error') out.errors++;
        else if (state === 'skip') out.skipped++;
        else out.pending++;
    }
    return out;
}

/**
 * What a sync has to do, and the manifest as it will be once it is done.
 *
 * Modes:
 *   'auto' / 'manual'  insert what is new, edited or failed (eligible entries, plus by-hand ones)
 *   'all'              re-vectorize every wanted entry, even those already in
 *   'cleanup'          only delete (disabled, deleted, stale and vanished entries); insert nothing
 * `only` restricts inserting to those ids and marks them by hand, so an entry the module would
 * skip (a phone chunk still being written) can still be vectorized when the user asks for it.
 *
 * The returned manifest is a copy. Inserted entries are not marked vectorized here: the caller
 * does that per batch with markInserted, so a failed batch leaves its entries pending.
 *
 * @param {string} moduleId
 * @param {object} manifest normalizeManifest() output
 * @param {{id:string, text:string, at?:number, importance?:number, eligible?:boolean}[]} entries
 * @param {{ mode?: string, only?: string[], maxChars?: number }} [opts]
 */
export function planSync(moduleId, manifest, entries, { mode = 'manual', only = null, maxChars = 1000 } = {}) {
    const next = normalizeManifest(manifest);
    const toDelete = [];
    const toInsert = [];
    const live = new Set();
    const onlySet = Array.isArray(only) ? new Set(only.map(String)) : null;

    for (const e of entries || []) {
        const id = String(e.id);
        live.add(id);
        const rec = next.entries[id] || (next.entries[id] = normalizeRecord({}));
        rec.at = Number.isFinite(Number(e.at)) ? Number(e.at) : rec.at;
        if (onlySet?.has(id)) rec.manual = true;

        if (!rec.enabled || rec.deleted) {
            if (rec.chunks.length) toDelete.push(...rec.chunks);
            rec.vectorized = false;
            rec.chunks = [];
            rec.hash = 0;
            continue;
        }

        const text = embedText(e, rec);
        const hash = entryHash(moduleId, id, text);
        const stale = rec.vectorized && rec.hash !== hash;
        if (stale) {
            // An edited entry's old vectors would answer for text it no longer has.
            toDelete.push(...rec.chunks);
            rec.vectorized = false;
            rec.chunks = [];
            rec.hash = 0;
        }
        if (mode === 'cleanup') continue;

        const wanted = (e.eligible !== false || rec.manual) && (!onlySet || onlySet.has(id));
        if (!wanted) continue;
        if (rec.vectorized && mode !== 'all') continue;
        if (rec.vectorized && mode === 'all') {
            toDelete.push(...rec.chunks);
            rec.vectorized = false;
            rec.chunks = [];
        }
        const pieces = chunkText(text, maxChars);
        if (!pieces.length) continue;
        toInsert.push({
            id,
            hash,
            chunks: pieces.map((t, i) => ({ hash: chunkHash(moduleId, id, i, t), text: t, index: i })),
        });
    }

    // Entries whose history is gone (a deleted milestone, a trimmed phone message).
    for (const [id, rec] of Object.entries(next.entries)) {
        if (live.has(id)) continue;
        if (rec.chunks.length) toDelete.push(...rec.chunks);
        delete next.entries[id];
    }
    return { manifest: next, toDelete: [...new Set(toDelete)], toInsert };
}

/** Records a successful insert. */
export function markInserted(manifest, item) {
    const rec = manifest.entries[item.id] || (manifest.entries[item.id] = normalizeRecord({}));
    rec.vectorized = true;
    rec.hash = item.hash;
    rec.chunks = item.chunks.map(c => c.hash);
    rec.error = '';
}

/** Records a failed insert on every entry of the batch, and on the manifest. */
export function markFailed(manifest, items, message) {
    const msg = str(message, 300) || 'Failed';
    for (const item of items || []) {
        const rec = manifest.entries[item.id] || (manifest.entries[item.id] = normalizeRecord({}));
        rec.vectorized = false;
        rec.error = msg;
    }
    manifest.lastError = msg;
}

/** Changes the user can make to one entry. Returns the chunk hashes that must leave the collection. */
export function setEntryFlags(manifest, id, patch) {
    const rec = manifest.entries[id] || (manifest.entries[id] = normalizeRecord({}));
    const drop = [];
    const leaving = ('enabled' in patch && !patch.enabled) || ('deleted' in patch && patch.deleted);
    const edited = 'text' in patch && String(patch.text ?? '') !== rec.text;
    if ('enabled' in patch) rec.enabled = Boolean(patch.enabled);
    if ('deleted' in patch) rec.deleted = Boolean(patch.deleted);
    if ('manual' in patch) rec.manual = Boolean(patch.manual);
    if (edited) rec.text = String(patch.text ?? '').slice(0, 4000);
    if (leaving && rec.chunks.length) {
        drop.push(...rec.chunks);
        rec.chunks = [];
        rec.vectorized = false;
        rec.hash = 0;
    }
    // An edit leaves the old vectors in place until the next sync replaces them: the entry
    // shows as stale, and the next sync (or Vectorize now) swaps them out.
    return drop;
}

/** Every chunk hash the manifest believes is in the collection, for a purge's bookkeeping. */
export function clearManifest(manifest) {
    forgetVectorized(manifest);
    manifest.lastError = '';
}

/* ---- retrieval ----------------------------------------------------------------------- */

/**
 * The entries a query's results point at, best first.
 *
 * SillyTavern's native query returns results in score order, already above the threshold, but
 * without the scores. A score that is present (a plugin, a later version) is used and the
 * threshold applied here too; otherwise the rank stands in for it. Scores are compared at two
 * decimals, so near-equal ones fall to the tie-break: more important first, then more recent.
 *
 * @param {{hash:number, score?:number}[]} results in the order the server gave
 * @param {object} manifest
 * @param {{ topK?: number, threshold?: number, entries?: Map<string, object>, exclude?: Set<string> }} opts
 * @returns {string[]} entry ids
 */
export function selectTopK(results, manifest, { topK = 6, threshold = 0, entries = null, exclude = null } = {}) {
    const byHash = new Map();
    for (const [id, rec] of Object.entries(manifest?.entries || {})) {
        if (!rec.enabled || rec.deleted || !rec.vectorized) continue;
        for (const h of rec.chunks) byHash.set(Number(h), id);
    }
    const best = new Map();
    (results || []).forEach((r, rank) => {
        const id = byHash.get(Number(r?.hash));
        if (!id || exclude?.has(id)) return;
        if (entries && !entries.has(id)) return;
        const hasScore = Number.isFinite(Number(r.score)) && r.score !== null && r.score !== undefined;
        // A whole rounding step per rank: without scores the server's order is all we know, so
        // the tie-break must never reorder it.
        const score = hasScore ? Number(r.score) : 1 - rank * 0.01;
        if (hasScore && score < threshold) return;
        if (!best.has(id) || best.get(id) < score) best.set(id, score);
    });
    const meta = (id) => {
        const e = entries?.get(id);
        return {
            importance: Number(e?.importance) || 0,
            at: Number(e?.at ?? manifest.entries[id]?.at) || 0,
        };
    };
    const round = (s) => Math.round(s * 100) / 100;
    return [...best.entries()]
        .sort((a, b) => round(b[1]) - round(a[1])
            || meta(b[0]).importance - meta(a[0]).importance
            || meta(b[0]).at - meta(a[0]).at)
        .slice(0, topK)
        .map(([id]) => id);
}

/**
 * Which entries a module writes out, given the picks.
 *
 * No picks (vectors off, or retrieval failed): the newest `count`, exactly as before. With picks:
 * the relevant ones first, and with `fill` the remaining slots go to the newest, so a short
 * history reads the same either way. Returned in the list's own order.
 */
export function chooseEntries(list, picks, count, { fill = true, idOf = (e) => e.id } = {}) {
    const all = Array.isArray(list) ? list : [];
    if (count <= 0) return [];
    if (!Array.isArray(picks)) return all.slice(-count);
    const ids = new Set(all.map(e => String(idOf(e))));
    const chosen = new Set();
    for (const p of picks) {
        if (chosen.size >= count) break;
        if (ids.has(String(p))) chosen.add(String(p));
    }
    if (fill) {
        for (let i = all.length - 1; i >= 0 && chosen.size < count; i--) chosen.add(String(idOf(all[i])));
    }
    return all.filter(e => chosen.has(String(idOf(e))));
}

/** Recalled entries as a prompt block, or '' when there are none. Capped so it never crowds the prompt. */
export function formatRecalled(items, { heading = 'Recalled', footer = '', maxChars = 2400 } = {}) {
    const lines = [];
    let used = heading.length + footer.length;
    for (const item of items || []) {
        const text = String(item?.text ?? '').trim();
        if (!text) continue;
        const line = `- ${item.label ? `${item.label}: ` : ''}${text.replace(/\n+/g, ' / ')}`;
        if (used + line.length > maxChars) {
            const room = maxChars - used - 2;
            if (room > 80) lines.push(`${line.slice(0, room)}…`);
            break;
        }
        lines.push(line);
        used += line.length + 1;
    }
    if (!lines.length) return '';
    return [heading, ...lines, footer].filter(Boolean).join('\n');
}

/** A promise that settles within ms, or rejects with a timeout. */
export function withTimeout(promise, ms, label = 'Vector search') {
    let timer;
    return Promise.race([
        Promise.resolve(promise).finally(() => clearTimeout(timer)),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms); }),
    ]);
}

/**
 * Runs one query and turns it into picks. Never throws: a failure or a timeout gives
 * `{ ids: null, error }`, which every module reads as "do what you did before vectors".
 *
 * @param {{ query: (collectionId: string, text: string, topK: number, threshold: number) => Promise<object[]> }} service
 */
export async function retrievePicks(service, { collection, text, manifest, entries = null, topK = 6, threshold = 0, timeoutMs = 2500, exclude = null } = {}) {
    if (!text || !collection || !manifest) return { ids: null, error: '' };
    const anything = Object.values(manifest.entries || {}).some(r => r.vectorized && r.enabled && !r.deleted);
    if (!anything) return { ids: null, error: '' };
    try {
        // Asked for more than topK: several chunks of one entry count once.
        const results = await withTimeout(service.query(collection, text, topK * 3, threshold), timeoutMs);
        return { ids: selectTopK(results, manifest, { topK, threshold, entries, exclude }), error: '' };
    } catch (err) {
        return { ids: null, error: String(err?.message || err) };
    }
}
