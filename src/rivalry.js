import { getContext } from '../../../../st-context.js';
import { eventSource } from '../../../../events.js';
import { normalizeStore, normalizeRecord, describeRivalry, tally, tallyVsPlayer, othersIn } from './rivalry-core.js';

/**
 * The rivalry record, stored in the chat's own metadata (fork), so each chat has its own
 * history and it goes wherever the chat goes.
 *
 * Records have two sides of any number of people (see rivalry-core.js). Older records (one
 * player against one opponent) are moved to that shape the first time the store is read; their
 * old fields are kept alongside, so nothing is lost.
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

const copy = (r) => ({ ...r, sideA: [...r.sideA], sideB: [...r.sideB] });

/** Every record in this chat, oldest first. Copies: edit through updateRecord. */
export function listRecords() {
    return (store()?.records || []).map(copy);
}

/**
 * Adds one record. Takes sides ({ sideA, sideB, winner, userSide, player }) or, as before, a
 * single { player, opponent, result } from the player's side. Null when nobody but the
 * player is in it.
 */
export function addRecord(entry) {
    const s = store();
    if (!s) return null;
    const rec = normalizeRecord({ ...entry, id: undefined, at: entry.at ?? Date.now() });
    if (!othersIn(rec).length) return null;
    s.records.push(rec);
    save();
    return copy(rec);
}

export function updateRecord(id, patch) {
    const s = store();
    const rec = s?.records.find(r => r.id === id);
    if (!rec) return false;
    const merged = { ...rec, ...patch, id: rec.id, at: rec.at };
    // An old-style patch that only sets the result: let it decide the winner.
    if (patch && 'result' in patch && !('winner' in patch)) delete merged.winner;
    const next = normalizeRecord(merged);
    if (!othersIn(next).length) return false;
    Object.assign(rec, next);
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

/** One person's results, from their own side, over the records they took part in. */
export function tallyFor(person, kind) {
    return tally(listRecords(), person, kind);
}

/** The player's results against one person: only where they were on opposite sides. */
export function tallyAgainst(opponent, kind) {
    return tallyVsPlayer(listRecords(), opponent, kind);
}

/** For prompts. Empty when this person took part in nothing. */
export function rivalryBlock(person, playerName) {
    try {
        return describeRivalry(listRecords(), person, playerName || 'the player');
    } catch {
        return '';
    }
}
