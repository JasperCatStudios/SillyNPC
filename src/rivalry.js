import { getContext } from '../../../../st-context.js';
import { eventSource } from '../../../../events.js';
import { normalizeStore, normalizeRecord, describeRivalry, tally } from './rivalry-core.js';

/**
 * The rivalry record, stored in the chat's own metadata (fork), so each chat has its own
 * history and it goes wherever the chat goes.
 */

const KEY = 'sillynpc_rivalry';

function metadata() {
    return getContext()?.chatMetadata ?? null;
}

function store() {
    const meta = metadata();
    if (!meta) return null;
    meta[KEY] = normalizeStore(meta[KEY]);
    return meta[KEY];
}

/** Fired after any change to the record, so the vectors can follow it. */
export const RIVALRY_CHANGED_EVENT = 'sillynpc-rivalry-changed';

function save() {
    getContext()?.saveMetadataDebounced?.();
    // Not awaited: listeners only schedule work, and saving must never wait on them.
    eventSource.emit(RIVALRY_CHANGED_EVENT);
}

/** Every record in this chat, oldest first. A copy: edit through updateRecord. */
export function listRecords() {
    return (store()?.records || []).map(r => ({ ...r }));
}

export function addRecord(entry) {
    const s = store();
    if (!s) return null;
    const rec = normalizeRecord({ ...entry, id: undefined, at: entry.at ?? Date.now() });
    if (!rec.opponent) return null;
    s.records.push(rec);
    save();
    return { ...rec };
}

export function updateRecord(id, patch) {
    const s = store();
    const rec = s?.records.find(r => r.id === id);
    if (!rec) return false;
    Object.assign(rec, normalizeRecord({ ...rec, ...patch, id: rec.id, at: rec.at }));
    save();
    return true;
}

export function removeRecord(id) {
    const s = store();
    if (!s) return false;
    const before = s.records.length;
    s.records = s.records.filter(r => r.id !== id);
    if (s.records.length === before) return false;
    save();
    return true;
}

export function tallyFor(opponent, kind) {
    return tally(listRecords(), opponent, kind);
}

/** For prompts. Empty when there is no history with this person. */
export function rivalryBlock(opponent, playerName) {
    try {
        return describeRivalry(listRecords(), opponent, playerName || 'the player');
    } catch {
        return '';
    }
}
