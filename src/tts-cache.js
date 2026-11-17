/**
 * Spoken lines kept so they can be replayed (fork): a line that has been generated once is played
 * from the saved audio, never requested again.
 *
 * Kept in this browser's IndexedDB (and in memory while the page is open), keyed by what was said and
 * who said it, so the same text in the same voice on the same engine and model is one file. Changing the
 * voice, the engine, the model or the text makes a new key. At most MAX_ENTRIES are kept; the oldest
 * go first. Everything is wrapped so a browser with storage blocked just generates every time.
 */

const DB_NAME = 'worldkit-tts';
const STORE = 'audio';
export const MAX_ENTRIES = 300;

const memory = new Map();
let dbPromise = null;

function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
        try {
            const request = indexedDB.open(DB_NAME, 1);
            request.onupgradeneeded = () => {
                const store = request.result.createObjectStore(STORE, { keyPath: 'key' });
                store.createIndex('at', 'at');
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => resolve(null);
            request.onblocked = () => resolve(null);
        } catch {
            resolve(null);
        }
    });
    return dbPromise;
}

const wrap = (request) => new Promise((resolve) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(undefined);
});

/** The saved audio for a key, or null. */
export async function getCached(key) {
    if (memory.has(key)) return memory.get(key);
    try {
        const db = await openDb();
        if (!db) return null;
        const row = await wrap(db.transaction(STORE, 'readonly').objectStore(STORE).get(key));
        if (row?.blob instanceof Blob) {
            memory.set(key, row.blob);
            return row.blob;
        }
    } catch { /* storage unavailable: generate instead */ }
    return null;
}

/** Saves audio under a key, then drops the oldest beyond the limit. */
export async function putCached(key, blob) {
    if (!(blob instanceof Blob) || !blob.size) return;
    memory.set(key, blob);
    try {
        const db = await openDb();
        if (!db) return;
        const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
        await wrap(store.put({ key, blob, at: Date.now() }));
        const count = await wrap(db.transaction(STORE, 'readonly').objectStore(STORE).count());
        if (Number(count) > MAX_ENTRIES) {
            let excess = Number(count) - MAX_ENTRIES;
            const writer = db.transaction(STORE, 'readwrite').objectStore(STORE);
            await new Promise((resolve) => {
                const cursor = writer.index('at').openCursor();
                cursor.onsuccess = () => {
                    const hit = cursor.result;
                    if (!hit || excess <= 0) { resolve(); return; }
                    memory.delete(hit.value.key);
                    hit.delete();
                    excess--;
                    hit.continue();
                };
                cursor.onerror = () => resolve();
            });
        }
    } catch { /* kept in memory only */ }
}

/** Whether a key is already saved (so a button can say "play" instead of "generate"). */
export async function hasCached(key) {
    return (await getCached(key)) !== null;
}
