import { getContext } from '../../../../st-context.js';
import { eventSource } from '../../../../events.js';
import { TALK_KEY, normalizeTalkStore, addTalkEntry, removeTalkEntry, isTalkKind } from './talk-log.js';

/**
 * Where the games' and fights' table talk is kept (fork): the open chat's metadata, saved like
 * the rivalry record and the bonds, so it goes wherever the chat goes. See talk-log.js.
 */

/** Fired with the kind ('games' or 'combat') after any change, so the vectors can follow. */
export const TALK_CHANGED_EVENT = 'sillynpc-talk-changed';

function store() {
    const ctx = getContext();
    const meta = ctx?.chatMetadata;
    if (!meta || !ctx.chatId) return null;
    meta[TALK_KEY] = normalizeTalkStore(meta[TALK_KEY]);
    return meta[TALK_KEY];
}

function save(kind) {
    getContext()?.saveMetadataDebounced?.();
    // Not awaited: listeners only schedule work.
    eventSource.emit(TALK_CHANGED_EVENT, kind);
}

/** This chat's entries of one kind, oldest first. Copies. Reading never writes to a chat that has none. */
export function listTalk(kind) {
    if (!isTalkKind(kind)) return [];
    const ctx = getContext();
    const raw = ctx?.chatMetadata?.[TALK_KEY];
    if (!raw || !ctx.chatId) return [];
    return normalizeTalkStore(raw)[kind].map(e => ({ ...e, lines: e.lines.map(l => ({ ...l })) }));
}

/**
 * Records (or updates, by id) one game's or fight's talk. Nothing is written when there is
 * nothing to record. Never throws: a game must not break because its talk could not be kept.
 */
export function recordTalk(kind, entry) {
    try {
        const s = store();
        if (!s) return null;
        const saved = addTalkEntry(s, kind, entry);
        if (saved) save(kind);
        return saved;
    } catch (err) {
        console.warn('[SillyNPC] could not keep the table talk', err);
        return null;
    }
}

export function removeTalk(kind, id) {
    const s = store();
    if (!s) return false;
    const gone = removeTalkEntry(s, kind, id);
    if (gone) save(kind);
    return gone;
}
