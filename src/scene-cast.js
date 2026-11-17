import { eventSource } from '../../../../events.js';
import { getContext } from '../../../../st-context.js';
import { getSettings } from './settings.js';
import { mayJoinScene, resolveCanonicalName } from './status-logic.js';
import { debugLog } from './constants.js';

/**
 * Who is in the scene right now (fork). This used to be a side effect of the original SillyNPC tracker, which
 * kept a list of characters, with stats, inside its own saved state. Only the list was ever needed by the rest
 * of Worldkit (the Vitals and Bonds "scene" triggers, the phone's "away" status, the history and vector
 * injections), so it is kept here, on its own, as plain names.
 *
 * How it works: each message that names or shows a speaker puts them in the scene, and somebody who has not
 * appeared for a few messages (castGraceMessages, three by default) leaves it. Re-rendering a message does not
 * move the clock. A chat that had a list in the old tracker state starts from that list once.
 */

const META_KEY = 'sillynpc_scene';

function normalizeStore(raw) {
    const s = raw && typeof raw === 'object' ? raw : {};
    return {
        tick: Number.isFinite(s.tick) ? s.tick : 0,
        messageId: s.messageId ?? null,
        seen: Array.isArray(s.seen) ? s.seen.filter(n => typeof n === 'string') : [],
        present: Array.isArray(s.present)
            ? s.present.filter(p => p && typeof p.name === 'string').map(p => ({ name: p.name, lastSeenTick: Number.isFinite(p.lastSeenTick) ? p.lastSeenTick : 0 }))
            : [],
    };
}

function store() {
    const context = getContext();
    const meta = context?.chatMetadata;
    if (!meta || !context.chatId) return null;
    if (!meta[META_KEY]) {
        const old = Array.isArray(meta.sillynpc_status_state?.characters) ? meta.sillynpc_status_state.characters : [];
        meta[META_KEY] = normalizeStore({ present: old.filter(c => c?.name).map(c => ({ name: c.name, lastSeenTick: 0 })) });
    } else {
        meta[META_KEY] = normalizeStore(meta[META_KEY]);
    }
    return meta[META_KEY];
}

/** The names of everyone in the scene now, or an empty list when there is no chat or nobody yet. */
export function sceneNames() {
    try { return (store()?.present || []).map(p => p.name); } catch { return []; }
}

/** The same, lower-cased, for quick checks. */
export function sceneSet() {
    return new Set(sceneNames().map(n => String(n).trim().toLowerCase()));
}

/**
 * Records who appeared in a message. Call it for the latest message; calling it again for the same message
 * adds to the same moment instead of advancing the clock.
 *
 * @param {string[]} names
 * @param {string|number} messageId
 * @returns {boolean} Whether the scene changed.
 */
export function noteSpeakers(names, messageId) {
    const s = store();
    if (!s) return false;
    const incoming = [];
    for (const raw of names || []) {
        if (!mayJoinScene(raw)) continue;
        const name = resolveCanonicalName(raw);
        if (name && !incoming.some(n => n.toLowerCase() === name.toLowerCase())) incoming.push(name);
    }

    const key = String(messageId);
    let changed = false;
    if (s.messageId !== key) {
        s.tick += 1;
        s.messageId = key;
        s.seen = [];
        changed = true;
    }
    for (const name of incoming) {
        if (!s.seen.some(n => n.toLowerCase() === name.toLowerCase())) { s.seen.push(name); changed = true; }
    }

    const grace = Math.max(0, Number(getSettings().statusTracker?.castGraceMessages ?? 3));
    const seenLower = new Set(s.seen.map(n => n.toLowerCase()));
    for (const name of s.seen) {
        const have = s.present.find(p => p.name.toLowerCase() === name.toLowerCase());
        if (have) {
            if (have.lastSeenTick !== s.tick) { have.lastSeenTick = s.tick; changed = true; }
        } else {
            s.present.push({ name, lastSeenTick: s.tick });
            changed = true;
        }
    }
    const kept = s.present.filter(p => seenLower.has(p.name.toLowerCase()) || (s.tick - p.lastSeenTick) < grace);
    if (kept.length !== s.present.length) {
        debugLog('Scene cast: leaving', s.present.filter(p => !kept.includes(p)).map(p => p.name));
        s.present = kept;
        changed = true;
    }

    if (!changed) return false;
    getContext()?.saveMetadataDebounced?.();
    eventSource.emit('sillynpc-status-updated');
    return true;
}
