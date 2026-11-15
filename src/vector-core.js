import { asRecords, sideNames, sidesText, winnerText } from './rivalry-core.js';
/**
 * Vectors for Worldkit's histories (fork): the decisions, without the I/O.
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
    rivalry: { label: 'Rivalry history', scope: 'chat', noun: 'record', nouns: 'records' },
    phone: { label: 'Phone conversations', scope: 'contact', noun: 'memory', nouns: 'memories' },
    games: { label: 'Games table talk', scope: 'chat', noun: 'game', nouns: 'games' },
    combat: { label: 'Fight table talk', scope: 'chat', noun: 'fight', nouns: 'fights' },
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
    /**
     * "History brought back, total": how much room every brought-back block in the main story
     * shares (rivalry, games, fights, phone), as tokens or as a % of the context. Approx tokens
     * (chars / 4). Whole memories only: what does not fit is left out, never cut. 6000 holds
     * three phone memories of 25 texts (about 2100) with room left for the rest.
     */
    historyUnit: 'tokens',
    historyAmount: 6000,
    /** Per module, `amountTokens`: 0 is "a share of the total"; more is its own fixed room. */
    modules: Object.freeze({
        rivalry: Object.freeze({ enabled: false, amountTokens: 0 }),
        phone: Object.freeze({ enabled: false, chunkSize: 25, recall: 3, amountTokens: 0 }),
        games: Object.freeze({ enabled: false, recall: 2, amountTokens: 0 }),
        combat: Object.freeze({ enabled: false, recall: 2, amountTokens: 0 }),
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
        ...normalizeHistoryAmount(r),
        // Only the modules listed are kept: an old `bonds` entry is dropped here.
        modules: {
            rivalry: { enabled: Boolean(mod('rivalry').enabled), amountTokens: ownAmount(mod('rivalry').amountTokens) },
            phone: {
                enabled: Boolean(mod('phone').enabled),
                chunkSize: int(mod('phone').chunkSize, 5, 60, 25),
                recall: int(mod('phone').recall, 1, 8, 3),
                amountTokens: ownAmount(mod('phone').amountTokens),
            },
            games: { enabled: Boolean(mod('games').enabled), recall: int(mod('games').recall, 1, 6, 2), amountTokens: ownAmount(mod('games').amountTokens) },
            combat: { enabled: Boolean(mod('combat').enabled), recall: int(mod('combat').recall, 1, 6, 2), amountTokens: ownAmount(mod('combat').amountTokens) },
        },
        // Kept by reference: the phone's manifests live here, see vectors.js.
        phoneManifests: obj(r.phoneManifests),
    };
}

/* ---- "History brought back, total" --------------------------------------------------- */

/** The allowed range of each unit; anything outside is pulled back in. */
export const HISTORY_RANGES = Object.freeze({
    percent: Object.freeze({ min: 1, max: 30, step: 1, label: '% of context' }),
    tokens: Object.freeze({ min: 200, max: 20000, step: 100, label: 'tokens' }),
});
export const HISTORY_UNITS = Object.freeze(['tokens', 'percent']);
/** The context size assumed while SillyTavern does not say (no model connected yet). */
export const ASSUMED_CONTEXT = 8192;

/** A number in a unit's range: rounded (tokens to whole, % to one decimal), or `fallback`. */
export function clampHistoryAmount(unit, value, fallback = null) {
    const range = HISTORY_RANGES[unit] || HISTORY_RANGES.tokens;
    const n = Number(value);
    if (value === '' || value === null || value === undefined || !Number.isFinite(n)) {
        return fallback === null ? (unit === 'percent' ? 5 : VECTOR_DEFAULTS.historyAmount) : fallback;
    }
    const v = Math.max(range.min, Math.min(range.max, n));
    return unit === 'percent' ? Math.round(v * 10) / 10 : Math.round(v);
}

/**
 * The amount from saved settings. Older settings had a per-kind room, `budgetTokens`, set by
 * the Little / Some / A lot choice (1500 / 3000 / 6000); the new amount is a total shared by all
 * kinds, so it becomes twice that (3000 / 6000 / 12000), which keeps the choice and its order.
 */
export function normalizeHistoryAmount(raw) {
    const r = obj(raw);
    const hasNew = r.historyAmount !== undefined && r.historyAmount !== null && r.historyAmount !== '';
    if (!hasNew && Number.isFinite(Number(r.budgetTokens)) && r.budgetTokens !== null && r.budgetTokens !== '') {
        return { historyUnit: 'tokens', historyAmount: clampHistoryAmount('tokens', Number(r.budgetTokens) * 2) };
    }
    const unit = HISTORY_UNITS.includes(r.historyUnit) ? r.historyUnit : VECTOR_DEFAULTS.historyUnit;
    const fallback = unit === VECTOR_DEFAULTS.historyUnit ? VECTOR_DEFAULTS.historyAmount : null;
    return { historyUnit: unit, historyAmount: clampHistoryAmount(unit, r.historyAmount, fallback) };
}

/** A module's own room: 0 (a share of the total), or 200 to 20000 tokens. */
function ownAmount(v) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return clampHistoryAmount('tokens', n);
}

/**
 * The context size, from what SillyTavern reports. Below 1024 or not a number counts as not
 * known (no model connected yet), and ASSUMED_CONTEXT stands in.
 * @returns {{ tokens: number, known: boolean }}
 */
export function contextSize(reported) {
    const n = Number(reported);
    if (Number.isFinite(n) && n >= 1024) return { tokens: Math.round(n), known: true };
    return { tokens: ASSUMED_CONTEXT, known: false };
}

/** An amount in tokens: a % is of the context, tokens are tokens. */
export function amountToTokens(unit, value, ctx) {
    const v = clampHistoryAmount(unit, value);
    if (unit !== 'percent') return v;
    return Math.max(1, Math.round((v / 100) * (ctx?.tokens || ASSUMED_CONTEXT)));
}

/** Tokens as a % of the context, one decimal. */
export function tokensToPercent(tokens, ctx) {
    const c = ctx?.tokens || ASSUMED_CONTEXT;
    return Math.round((Number(tokens) / c) * 1000) / 10;
}

/** The same amount in the other unit, pulled into that unit's range: for switching the unit. */
export function convertHistoryAmount(fromUnit, value, toUnit, ctx) {
    if (fromUnit === toUnit) return clampHistoryAmount(toUnit, value);
    const tokens = amountToTokens(fromUnit, value, ctx);
    return clampHistoryAmount(toUnit, toUnit === 'percent' ? tokensToPercent(tokens, ctx) : tokens);
}

const thousands = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');

/** The other unit, in words, for next to the box: "= about 2,400 tokens (3% of 80,000)". */
export function historyAmountHint(unit, value, ctx) {
    const c = ctx || contextSize(null);
    const of = c.known ? `your ${thousands(c.tokens)}-token context` : `a ${thousands(c.tokens)}-token context`;
    const unknown = c.known ? '' : ` (your context size is not known yet, so ${thousands(c.tokens)} is assumed)`;
    if (unit === 'percent') return `= about ${thousands(amountToTokens(unit, value, c))} tokens of ${of}${unknown}`;
    const pct = tokensToPercent(clampHistoryAmount('tokens', value), c);
    return `= about ${pct < 1 ? '<1' : Math.round(pct)}% of ${of}${unknown}`;
}

/** The total in tokens for these settings and this context. */
export function historyTotalTokens(settings, ctx) {
    const a = normalizeHistoryAmount(settings);
    return amountToTokens(a.historyUnit, a.historyAmount, ctx);
}

/**
 * How the total is shared by the modules that are on, in their order. A module with its own
 * amount takes that first (never more than is left); the rest is split evenly among the others.
 * @param {number} total
 * @param {string[]} active module ids that are on
 * @param {object} settings normalized vector settings (for each module's own amount)
 * @returns {Record<string, number>}
 */
export function splitHistoryAmount(total, active, settings) {
    const rooms = {};
    let left = Math.max(0, Math.floor(Number(total) || 0));
    const shared = [];
    for (const id of active || []) {
        const own = Number(settings?.modules?.[id]?.amountTokens) || 0;
        if (own > 0) {
            rooms[id] = Math.min(own, left);
            left -= rooms[id];
        } else shared.push(id);
    }
    const each = shared.length ? Math.floor(left / shared.length) : 0;
    for (const id of shared) rooms[id] = each;
    return rooms;
}

/**
 * Builds the blocks of the modules that are on within one shared total, whole memories only.
 * Each first gets its room (splitHistoryAmount); a module with nothing to send this time, or
 * that did not need all of its room, gives what it left over to the ones that had to leave
 * something out, and those are built again with the extra room. A module without a builder
 * (rivalry, built later by the shared history) keeps its room, plus whatever is left at the end.
 *
 * @param {{ total: number, active: string[], settings: object,
 *   build: Record<string, (room: number) => ({ tokens: number, dropped: any[] } | null)> }} args
 * @returns {{ rooms: Record<string, number>, results: Record<string, object>, used: number, left: number }}
 *   left: what the modules without a builder may use (total minus what the built ones used).
 */
export function shareHistory({ total, active, settings, build = {}, later = ['rivalry'] }) {
    const rooms = splitHistoryAmount(total, active, settings);
    const results = {};
    const run = (id, room) => {
        try { return build[id](room) || null; } catch { return null; }
    };
    const built = (active || []).filter(id => typeof build[id] === 'function');
    for (const id of built) results[id] = run(id, rooms[id]);
    // Leftovers: modules with their own amount keep it as set; the shared ones pass theirs on.
    const ownSet = (id) => (Number(settings?.modules?.[id]?.amountTokens) || 0) > 0;
    const usedBy = (id) => Number(results[id]?.tokens) || 0;
    let spare = 0;
    // On, but with nothing to send this time (and not built later): all of its room is spare.
    for (const id of active || []) {
        if (!built.includes(id) && !later.includes(id) && !ownSet(id)) spare += rooms[id] || 0;
    }
    for (const id of built) {
        if (ownSet(id) || results[id]?.dropped?.length) continue;
        spare += Math.max(0, rooms[id] - usedBy(id));
    }
    const needy = built.filter(id => !ownSet(id) && results[id]?.dropped?.length);
    if (spare > 0 && needy.length) {
        const extra = Math.floor(spare / needy.length);
        for (const id of needy) {
            rooms[id] += extra;
            results[id] = run(id, rooms[id]);
        }
    }
    const used = built.reduce((n, id) => n + usedBy(id), 0);
    return { rooms, results, used, left: Math.max(0, Math.floor(Number(total) || 0) - used) };
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
    if (!settings?.enabled) reason = 'switch on Vectors in the Worldkit menu';
    else if (!settings.modules?.[moduleId]?.enabled) reason = 'module switch is off';
    else if (moduleId === 'phone' && !phoneEnabled) reason = 'the Phone module is off';
    return { on: !reason, reason, text: reason ? `off: ${reason}` : 'on' };
}

/**
 * A module's switch state in words, for the Vectors menu: which switch, if any, keeps it off.
 * 'waiting' is its own switch ticked while the master switch is off, which otherwise looks on.
 *
 * @returns {{ state: 'on'|'off'|'waiting'|'phone-off', text: string }}
 */
export function moduleSwitchState(settings, moduleId, { phoneEnabled = false } = {}) {
    const own = Boolean(settings?.modules?.[moduleId]?.enabled);
    if (!own) return { state: 'off', text: 'off' };
    if (!settings?.enabled) return { state: 'waiting', text: 'on, waiting for the master switch' };
    if (moduleId === 'phone' && !phoneEnabled) return { state: 'phone-off', text: 'on, but the Phone module is off' };
    return { state: 'on', text: 'on' };
}

/**
 * One plain line per module: where its history reaches the story from right now. There is
 * always exactly one source: with the module's Vectors on, Vectors; otherwise its old way, or
 * nothing for those that never had one.
 *
 * @param {string} moduleId
 * @param {boolean} on moduleActive() for it
 */
export function historySourceLine(moduleId, on) {
    switch (moduleId) {
        case 'rivalry':
            return on
                ? 'Rivalry history reaches the story through: Vectors (the records that matter to the scene, in the shared-history block).'
                : 'Rivalry history reaches the story through: the shared-history block (the newest records).';
        case 'games':
            return on
                ? 'Games reach the story through: Vectors (whole games that match the scene).'
                : 'Games reach the story through: nothing. Their table talk is only sent by Vectors.';
        case 'combat':
            return on
                ? 'Fights reach the story through: Vectors (whole fights that match the scene).'
                : 'Fights reach the story through: nothing. Their table talk is only sent by Vectors.';
        case 'phone':
            return on
                ? 'Phone texts are sent to the story by: Vectors; the phone itself is not affected.'
                : 'Phone texts are not sent to the story; the phone itself is not affected.';
        default:
            return '';
    }
}

/* ---- vectorize all ------------------------------------------------------------------- */

/** What the "Vectorize" dropdown can choose, in the menu's order. */
export const VECTORIZE_CHOICES = Object.freeze([
    { value: 'all', label: 'All' },
    { value: 'rivalry', label: 'Rivalry' },
    { value: 'combat', label: 'Combat (fight talk)' },
    { value: 'games', label: 'Games' },
    { value: 'phone', label: 'Phone' },
]);

/**
 * The (module, scope) pairs a "Vectorize" run covers. The phone is per contact: one contact, or
 * every contact with texts when none is chosen (or for All). No contacts at all still gives one
 * phone target with no scope, so the run can say there is nothing to vectorize.
 *
 * @param {string} choice a VECTORIZE_CHOICES value
 * @param {{ contact?: string, contacts?: string[] }} [opts]
 * @returns {{ id: string, scope: string }[]}
 */
export function vectorizeTargets(choice, { contact = '', contacts = [] } = {}) {
    const ids = choice === 'all' ? ['rivalry', 'combat', 'games', 'phone'] : (VECTOR_MODULES[choice] ? [choice] : []);
    const out = [];
    for (const id of ids) {
        if (id !== 'phone') { out.push({ id, scope: '' }); continue; }
        const list = choice === 'phone' && contact ? [contact] : (contacts || []).filter(Boolean);
        if (!list.length) out.push({ id, scope: '' });
        for (const c of list) out.push({ id, scope: String(c) });
    }
    return out;
}

/**
 * Counts over a panel's rows (panelData().rows): how many there are, how many a sync would
 * embed at all, and how many still need it.
 */
export function vectorizeCounts(rows) {
    const out = { total: 0, wanted: 0, todo: 0, done: 0, skipped: 0, off: 0 };
    for (const r of rows || []) {
        if (r?.state === 'deleted') continue;
        out.total++;
        if (r.state === 'off') { out.off++; continue; }
        if (r.state === 'skip') { out.skipped++; continue; }
        out.wanted++;
        if (r.state === 'done') out.done++;
        else out.todo++;
    }
    return out;
}

const EMPTY_WHAT = {
    rivalry: 'No rivalry history in this chat yet',
    combat: 'No fight table talk in this chat yet',
    games: 'No games table talk in this chat yet',
};

/** The name a report line uses: the module, and the contact for the phone. */
export function vectorizeWhere(moduleId, scope = '') {
    const label = VECTOR_MODULES[moduleId]?.label || moduleId;
    return moduleId === 'phone' && scope ? `${label} with ${scope}` : label;
}

/**
 * Whether a "Vectorize" run should embed this target, and if not, why.
 *
 * Content is checked before the switches: offering to switch a module on only to then say it has
 * nothing to embed is a wasted question. Actions:
 *   'run'      there is something to embed (or redo is on and there is anything at all)
 *   'empty'    nothing to embed; the message says so
 *   'current'  everything is already vectorized
 *   'off'      something to embed, but a switch is off; `fix` names the switches that would turn it
 *              on ('master', 'module'), and is empty when only the Phone module's own switch is off
 *
 * @param {string} moduleId
 * @param {{ settings: object, phoneEnabled?: boolean, rows?: object[], scope?: string,
 *           chatOpen?: boolean, redo?: boolean }} info
 */
export function vectorizeDecision(moduleId, { settings, phoneEnabled = false, rows = [], scope = '', chatOpen = true, redo = false } = {}) {
    const where = vectorizeWhere(moduleId, scope);
    const counts = vectorizeCounts(rows);
    const base = { id: moduleId, scope, where, counts, fix: [], message: '' };
    const sw = moduleSwitchState(settings, moduleId, { phoneEnabled });
    const alsoOff = sw.state === 'on' ? '' : ' Its memory switch is also off.';
    const empty = (message) => ({ ...base, action: 'empty', message: `${message}${alsoOff}` });

    if (moduleId === 'phone') {
        if (!scope) return empty('No phone conversations yet - nothing to remember.');
        if (!counts.total) return empty(`No phone texts with ${scope} yet - nothing to remember.`);
    } else {
        if (!chatOpen) return empty(`No chat is open - no ${VECTOR_MODULES[moduleId]?.label.toLowerCase() || moduleId} to remember.`);
        if (!counts.total) return empty(`${EMPTY_WHAT[moduleId] || `No ${moduleId} yet`} - nothing to remember.`);
    }
    if (!counts.wanted) {
        return empty(counts.skipped
            ? (moduleId === 'phone'
                ? `The texts with ${scope} are not one full memory yet (fewer texts than a memory holds) - nothing to remember yet. The list in the Phone tab can remember them by hand.`
                : `${where}: everything is still open or skipped - nothing to remember yet.`)
            : `${where}: everything is turned off or deleted - nothing to remember.`);
    }

    if (sw.state !== 'on') {
        const fix = [];
        if (!settings?.enabled) fix.push('master');
        if (!settings?.modules?.[moduleId]?.enabled) fix.push('module');
        const reason = sw.state === 'phone-off'
            ? 'the Phone module itself is off (switch it on under Modules > Phone)'
            : sw.state === 'waiting' ? 'the master switch "Use Vectors" is off' : 'its switch is off';
        return { ...base, action: 'off', fix, message: `${where}: not remembered - ${reason}.` };
    }
    if (!redo && !counts.todo) {
        return { ...base, action: 'current', message: `${where}: already up to date (${counts.done} remembered).` };
    }
    return { ...base, action: 'run', message: '' };
}

/**
 * One report line per target after a run.
 *
 * @param {(object & { result?: { inserted?: number, removed?: number, error?: string } })[]} decisions
 * @returns {{ level: 'ok'|'warn'|'error'|'muted', text: string }[]}
 */
export function vectorizeReport(decisions) {
    return (decisions || []).map(d => {
        if (d.action === 'run') {
            const r = d.result || {};
            if (r.error) return { level: 'error', text: `${d.where}: failed - ${r.error}` };
            const n = Number(r.inserted) || 0;
            const removed = Number(r.removed) ? `, ${r.removed} removed` : '';
            return { level: 'ok', text: `${d.where}: remembered ${n}${removed}.` };
        }
        if (d.action === 'current') return { level: 'muted', text: d.message };
        if (d.action === 'off') return { level: 'warn', text: `${d.message} Skipped (switched off).` };
        return { level: 'warn', text: d.message };
    });
}

/**
 * The Ollama URL, model and keep flag to send. Worldkit's own fields win; empty ones inherit what
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

const RESULT_WORDS = { won: (p) => `${p} won`, lost: (p) => `${p} lost`, draw: () => 'it was a draw', fled: (p) => `${p} fled` };

/**
 * The embeddable text of one entry, per module. Plain sentences: that is what embedders match
 * best. Games and combat talk use talk-log.js's talkEmbedText.
 */
export const TEMPLATES = Object.freeze({
    rivalry(raw, player = 'the player') {
        const r = asRecords([raw])[0];
        const kind = r.kind === 'game' ? 'Game' : 'Fight';
        const game = r.game ? ` (${r.game})` : '';
        const a = sideNames(r, 'A', player);
        const b = sideNames(r, 'B', player);
        let head;
        if (r.userSide && a.length <= 1 && b.length <= 1) {
            // The player against one person: worded as it always was, so these do not re-embed.
            const result = (RESULT_WORDS[r.result] || RESULT_WORDS.draw)(player);
            // Fork: when the other one ran, say so (records without anyone fleeing read as before).
            const ran = r.result !== 'fled' && r.fled?.length ? `, ${r.fled.join(' and ')} fled` : '';
            head = `${kind} between ${player} and ${r.opponent}${game}: ${result}${ran}.`;
        } else {
            head = `${kind}${game}: ${sidesText(r, player)}, ${winnerText(r, player)}.`;
        }
        const bits = [head];
        if (r.spectators?.length) bits.push(`Watched by ${r.spectators.length > 1 ? `${r.spectators.slice(0, -1).join(', ')} and ${r.spectators[r.spectators.length - 1]}` : r.spectators[0]}.`);
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

/* ---- whole memories, never cut ------------------------------------------------------- */

/** Approx tokens of a text: characters / 4, the usual rule of thumb. */
export function estimateTokens(text) {
    return Math.ceil(String(text ?? '').length / 4);
}

/**
 * Which whole items fit the room, lorebook style: an item goes in whole or not at all.
 *
 * Items come best first. They are taken in that order while they fit; the first one that does
 * not, and everything less relevant after it, is left out, so a less relevant memory never takes
 * the place of a more relevant one. The best item always goes in, whole, even when it alone is
 * larger than the room: a single memory is never cut.
 *
 * @template T
 * @param {T[]} items best first
 * @param {number} budgetTokens room, in approx tokens
 * @param {{ cost?: (item: T) => number, overhead?: number }} [opts] cost: tokens of one item as
 *   written; overhead: tokens of the heading and anything else around the items.
 * @returns {{ kept: T[], dropped: T[], tokens: number, over: boolean }} over: the best item alone
 *   is larger than the room (it is still kept).
 */
export function fitWhole(items, budgetTokens, { cost = (i) => estimateTokens(i?.text), overhead = 0 } = {}) {
    const list = (items || []).filter(Boolean);
    // No number: no limit. 0 is a real room of nothing: the best item still goes in, alone.
    const given = budgetTokens !== null && budgetTokens !== undefined && budgetTokens !== '' && Number.isFinite(Number(budgetTokens));
    const room = given ? Math.max(0, Number(budgetTokens)) : Infinity;
    const kept = [];
    let used = Math.max(0, Number(overhead) || 0);
    let i = 0;
    for (; i < list.length; i++) {
        const c = Math.max(0, Number(cost(list[i])) || 0);
        if (kept.length && used + c > room) break;
        kept.push(list[i]);
        used += c;
    }
    return { kept, dropped: list.slice(i), tokens: used, over: used > room };
}

/** One recalled item as written: "- label:" then its lines, every one of them, as they were. */
export function formatRecalledItem(item) {
    const text = String(item?.text ?? '').trim();
    if (!text) return '';
    const label = item?.label ? `${item.label}: ` : '';
    const lines = text.split('\n').map(l => l.trimEnd()).filter(l => l.trim());
    if (lines.length === 1) return `- ${label}${lines[0]}`;
    return [`- ${label.trimEnd() || 'Earlier:'}`, ...lines.map(l => `  ${l}`)].join('\n');
}

/**
 * Recalled items as a prompt block, whole. Items come best first; what does not fit the room is
 * left out whole (fitWhole), and the block is written in `order` (e.g. oldest first).
 *
 * @param {{ label?: string, text: string }[]} items best first
 * @param {{ heading?: string, footer?: string, budgetTokens?: number, order?: (a, b) => number }} [opts]
 * @returns {{ text: string, kept: object[], dropped: object[], tokens: number, over: boolean }}
 */
export function buildRecalled(items, { heading = 'Recalled', footer = '', budgetTokens = Infinity, order = null } = {}) {
    const usable = (items || []).filter(i => String(i?.text ?? '').trim());
    const overhead = estimateTokens(heading) + estimateTokens(footer) + 1;
    const fit = fitWhole(usable, budgetTokens, { cost: (i) => estimateTokens(formatRecalledItem(i)) + 1, overhead });
    if (!fit.kept.length) return { text: '', kept: [], dropped: fit.dropped, tokens: 0, over: false };
    const shown = order ? fit.kept.slice().sort(order) : fit.kept;
    const text = [heading, ...shown.map(formatRecalledItem), footer].filter(Boolean).join('\n');
    return { text, kept: fit.kept, dropped: fit.dropped, tokens: estimateTokens(text), over: fit.over };
}

/** Recalled entries as a prompt block (whole items), or '' when there are none. */
export function formatRecalled(items, { heading = 'Recalled', footer = '', budgetTokens = Infinity } = {}) {
    return buildRecalled(items, { heading, footer, budgetTokens }).text;
}

/**
 * The plain-words note for a module's panel after a recall that left something out, or ''.
 * @param {{ kept?: number, dropped?: number }} r
 * @param {string} [noun] singular, e.g. 'memory'
 * @param {string} [nouns] plural
 */
export function droppedNote(r, noun = 'memory', nouns = 'memories') {
    const n = Number(r?.dropped) || 0;
    if (!n) return '';
    return `Left out ${n} older ${n === 1 ? noun : nouns} to save space (only whole ones are used, nothing is cut).`;
}

/* ---- phone memories, for the main story ---------------------------------------------- */

/*
 * The phone's texts are remembered for the MAIN story only: the phone's own request never
 * carries them. Before a story reply, the threads of the people the scene is about are searched
 * with the story's last messages, and whole older memories come back in one block per person.
 */

const GROUP_PREFIX = '#group:';
const CHAT_PREFIX = '#chat:';

/** The name a phone thread goes by: the person, the group, or the person of an extra chat. */
export function phoneThreadName(key, chats = {}) {
    const k = String(key ?? '');
    if (k.startsWith(GROUP_PREFIX)) return k.slice(GROUP_PREFIX.length) || k;
    if (k.startsWith(CHAT_PREFIX)) return String(chats?.[k]?.name || k.slice(CHAT_PREFIX.length).replace(/:\d+$/, '')) || k;
    return k;
}

/** Everyone a phone thread is with: its own name, and everyone who wrote in it (not the player). */
export function phoneThreadPeople(key, thread = [], chats = {}) {
    const out = [];
    const add = (n) => {
        const name = String(n ?? '').trim();
        if (name && !out.some(x => x.toLowerCase() === name.toLowerCase())) out.push(name);
    };
    if (!String(key ?? '').startsWith(GROUP_PREFIX)) add(phoneThreadName(key, chats));
    for (const m of thread || []) if (m && m.who !== 'user') add(m.name);
    return out;
}

/**
 * The phone threads that matter to the scene now: those with someone who is in the scene or
 * whose name came up. `isRelevant(name)` answers for one person (the caller knows the tracker
 * and the aliases). Keeps the threads' order.
 *
 * @param {{ key: string, people: string[] }[]} threads
 * @param {(name: string) => boolean} isRelevant
 * @returns {string[]} thread keys
 */
export function relevantContacts(threads, isRelevant) {
    return (threads || []).filter(t => (t?.people || []).some(n => { try { return Boolean(isRelevant(n)); } catch { return false; } }))
        .map(t => t.key);
}

/**
 * Which phone threads the main story searches this time: none unless the Phone's Vectors are in
 * use (master, its own switch, and the Phone module); then the threads with someone the scene is
 * about, most recently texted first, at most `max`.
 *
 * @param {{ settings: object, phoneEnabled?: boolean, threads?: Record<string, object[]>,
 *           chats?: object, isRelevant: (name: string) => boolean, max?: number }} args
 * @returns {string[]} thread keys
 */
export function phoneRecallTargets({ settings, phoneEnabled = false, threads = {}, chats = {}, isRelevant, max = 4 } = {}) {
    if (!moduleActive(settings, 'phone', { phoneEnabled })) return [];
    const list = Object.keys(threads || {})
        .filter(k => Array.isArray(threads[k]) && threads[k].length)
        .map(key => ({ key, people: phoneThreadPeople(key, threads[key], chats), last: Number(threads[key][threads[key].length - 1]?.ts) || 0 }))
        .sort((a, b) => b.last - a.last);
    return relevantContacts(list, isRelevant || (() => false)).slice(0, Math.max(0, max));
}

const squash = (t) => String(t ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Whether every text of a memory is already in the story as it stands (the player pasted them,
 * or the phone posted them into the chat), so recalling it would only say it twice. Images and
 * empty texts do not count either way; a memory with nothing else is never "visible".
 *
 * @param {{ text: string }[]} messages the memory's texts
 * @param {string} visible the story's messages, joined
 */
export function memoryVisibleIn(messages, visible) {
    const hay = squash(visible);
    if (!hay) return false;
    const texts = (messages || []).map(m => squash(String(m?.text ?? '').replace(/data:[^\s)\]]+/g, ''))).filter(t => t.length >= 2);
    return texts.length > 0 && texts.every(t => hay.includes(t));
}

/** One memory as recalled: every text in it, whole, "Name: text" per line. Inline images read [image]. */
export function phoneMemoryText(messages, { player = 'the player', contact = '' } = {}) {
    return (messages || [])
        .map(m => {
            const text = String(m?.text ?? '').replace(/data:[^\s)\]]+/g, '[image]').trim();
            if (!text) return '';
            return `${m.who === 'user' ? player : (m.name || contact)}: ${text}`;
        })
        .filter(Boolean)
        .join('\n');
}

export const phoneHeading = (name) => `[EARLIER TEXTS WITH ${name} THAT MAY MATTER]`;

/**
 * The main-story block of phone memories: one heading per person, their memories under it in the
 * order they happened, each one whole (every text, none clipped) or not at all.
 *
 * Each thread's memories come best first. The threads are taken in turns (the best of each, then
 * the second best of each, ...), at most `recall` in all, and fitted to the room with fitWhole:
 * the first that does not fit and everything after it is left out, the very best always goes in.
 * A memory is in the block once, however many of its pieces matched.
 *
 * @param {{ key: string, name: string, items: { id: string, start?: number, label?: string, text: string }[] }[]} groups
 * @param {{ budgetTokens?: number, recall?: number }} [opts]
 * @returns {{ text: string, kept: object[], dropped: object[], tokens: number, over: boolean }}
 */
export function buildPhoneRecall(groups, { budgetTokens = Infinity, recall = 3 } = {}) {
    const lists = (groups || []).map(g => {
        const seen = new Set();
        const items = (g?.items || []).filter(i => String(i?.text ?? '').trim() && !seen.has(i.id) && seen.add(i.id));
        return { key: g.key, name: g.name || g.key, items };
    }).filter(g => g.items.length);
    const merged = [];
    for (let rank = 0; lists.some(g => rank < g.items.length); rank++) {
        for (const g of lists) if (rank < g.items.length) merged.push({ ...g.items[rank], group: g });
    }
    const max = Math.max(1, Math.round(Number(recall)) || 1);
    const ranked = merged.slice(0, max);
    const overflow = merged.slice(max);
    // A person's heading is paid for by their best memory, which always comes first of theirs.
    const headed = new Set();
    const costs = new Map();
    for (const item of ranked) {
        let c = estimateTokens(formatRecalledItem(item)) + 1;
        if (!headed.has(item.group.key)) {
            headed.add(item.group.key);
            c += estimateTokens(phoneHeading(item.group.name)) + 2;
        }
        costs.set(item, c);
    }
    const fit = fitWhole(ranked, budgetTokens, { cost: (i) => costs.get(i) });
    const order = [];
    for (const item of fit.kept) if (!order.includes(item.group)) order.push(item.group);
    const blocks = order.map(g => {
        const mine = fit.kept.filter(i => i.group === g).sort((a, b) => (Number(a.start) || 0) - (Number(b.start) || 0));
        return [phoneHeading(g.name), ...mine.map(formatRecalledItem)].join('\n');
    });
    const strip = ({ group, ...rest }) => ({ ...rest, contact: group.key });
    const text = blocks.join('\n\n');
    return {
        text,
        kept: fit.kept.map(strip),
        // Past `recall` is not "left out to save space": only the room's drops are reported.
        dropped: fit.dropped.map(strip),
        beyondRecall: overflow.length,
        tokens: estimateTokens(text),
        over: fit.over,
    };
}

/**
 * How many results to ask the server for, so that after several pieces of one memory count once
 * and the memories that are not wanted this time are dropped, `topK` distinct ones can remain.
 */
export function overFetch(manifest, topK, exclude = null) {
    let most = 1;
    let excluded = 0;
    for (const [id, rec] of Object.entries(manifest?.entries || {})) {
        if (!rec?.vectorized || !rec.enabled || rec.deleted) continue;
        const n = Array.isArray(rec.chunks) ? rec.chunks.length : 1;
        most = Math.max(most, n);
        if (exclude?.has(id)) excluded += n;
    }
    const k = Math.max(1, Math.round(Number(topK)) || 1);
    return Math.min(100, Math.max(k * 3, k * most + excluded));
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
        // Asked for more than topK: several pieces of one entry count once (see overFetch).
        const results = await withTimeout(service.query(collection, text, overFetch(manifest, topK, exclude), threshold), timeoutMs);
        return { ids: selectTopK(results, manifest, { topK, threshold, entries, exclude }), error: '' };
    } catch (err) {
        return { ids: null, error: String(err?.message || err) };
    }
}
