# SillyNPC vectors plan (Ollama embeddings for the histories)

> **Revision (user decision):** Internal States is NOT vectorized. Its module, adapter, recall injection, panel, template and
> tests were removed. Wherever this plan mentions Internal States below, read it as dropped. Modules now: bonds, rivalry, phone.

Status: PLAN, written before any code. Section 11 is filled in after the build.

## 1. Goal

Let SillyNPC's histories (Bond Tracker milestones, the rivalry record, Internal States blocks,
phone threads) be embedded with the user's own Ollama through SillyTavern's own vector endpoints,
so each module's injection can pick the entries that are *relevant to the current scene* instead
of only the newest ones. Every piece can be switched off; with vectors off, nothing changes.

## 2. What the research found (read, not guessed)

SillyTavern server (`src/endpoints/vectors.js`, `src/vectors/ollama-vectors.js`):
- `POST /api/vector/insert` `{collectionId, source, items:[{hash:number, text, index}], apiUrl, model, keep}`
- `POST /api/vector/query` `{collectionId, source, searchText, topK, threshold, apiUrl, model, keep}`
  returns `{hashes, metadata:[{hash,text,index}]}`. `metadata` is already threshold-filtered and
  in score order; **no score is returned** (`hashes` is NOT threshold-filtered, so use `metadata`).
- `POST /api/vector/list` returns the hashes; `/delete` `{hashes}`; `/purge` `{collectionId}` removes
  the collection folder for every source and model.
- Ollama: `getSourceSettings('ollama')` reads `apiUrl`, `model`, `keep` from the body; embeddings go
  to `${apiUrl}/api/embed` (batch). The index lives at `data/<user>/vectors/ollama/<collectionId>/<model>`,
  so a model change means a different, empty index.
- Any server error is a bare `500` with no message (Ollama down, model missing, bad URL all look
  alike), so the client has to explain it.
- Hashes are numbers; SillyTavern's own `getStringHash` is a 53-bit cyrb53. Deleting by hash removes
  every item with that hash, so hashes must be unique per entry (include the entry id).
- `POST /api/backends/text-completions/status` `{api_server, api_type:'ollama'}` lists Ollama models
  (`/api/tags`) server-side: used by the connection test to say whether the model exists.
- `eventSource.emit` awaits async listeners, and `Generate()` awaits `GENERATION_STARTED`, so an
  async listener can set an extension prompt before the prompt is built (bounded by a timeout).

SillyTavern front end (`public/scripts/extensions/vectors/index.js`): Ollama URL is the Vector
Storage "alternative endpoint" when `use_alt_endpoint` is on, otherwise the Text Completion Ollama
server URL; model is `extension_settings.vectors.ollama_model`; `keep` is `ollama_keep`.

The user's setup (read from `data/*/settings.json`, secrets not printed): every profile uses
`source: ollama`, `ollama_model: qwen3-embedding:0.6b`, `ollama_keep: true`, alt endpoint on a LAN
Ollama (port 11434), `score_threshold 0.25`, `max_entries 5`, `query 2`. Backups also hold
`nomic-embed-text` collections (`file_<n>` folders, model sub-folders `qwen3-embedding0.6b`,
`nomic-embed-text`). So SillyNPC's defaults **inherit** URL, model and keep from Vector Storage
(fallbacks `http://localhost:11434`, `qwen3-embedding:0.6b`), threshold 0.25, top-K 6, query 3.
No IP address is hard-coded.

VectFox (`backends/standard.js`, `core/collection-ids.js`, `core/bounded-retrieval.js`): uses the same
native endpoints, scopes chat collections by `chat_metadata.integrity` (a UUID that survives
renames), sanitises ids to `[a-z0-9_]`, and wraps every retrieval in "timeout, never throw, never
fail silently". Patterns reused (not code): bounded retrieval, id sanitising, per-collection
serialisation. Summaryception / MemoryBooks inject through `setExtensionPrompt` like SillyNPC does.
Nothing in those extensions is modified.

SillyNPC: rivalry records (chat metadata `sillynpc_rivalry`), bond store (chat metadata
`sillynpc_bonds`, people `tracked:false` by default, milestones with ids/dates/notes), Internal
States records (per message `extra.sillynpc_internal_states[swipe]`, only the latest is injected),
phone threads (`extension_settings.sillynpc_phone.threads[contact]`, **global per contact, not per
chat**, capped at 200), games table talk (`gameState.chatLog`, in memory only, cleared each game).

## 3. Design in one paragraph

A pure core (`vector-core.js`) turns each module's entries into embeddable text, hashes it, keeps a
**manifest** (what is vectorized, stale, disabled, failed) and reconciles it against the live
entries into an insert/delete plan; it also ranks query results into the top-K entries. A thin
service (`vector-service.js`) does the HTTP to `/api/vector/*` with source `ollama`, batches,
aborts, times out and toasts. A small orchestrator (`vectors.js`) owns per-module adapters (how to
list entries, where the manifest lives), runs syncs (auto or manual), and on `GENERATION_STARTED`
queries each enabled module once per message (cached), publishing **picks** (entry ids in relevance
order). Each module's existing injection reads the picks: when present they decide WHICH entries
are written; position, depth, role, trigger, chance and order are untouched. When picks are absent
(off, failed, timed out) the module does exactly what it did before.

## 4. Data model

Settings (`settings.vectors`, repaired on read by `normalizeVectorSettings`):
```
enabled: false            master switch (off = SillyNPC behaves as before)
url: ''                   '' = inherit from Vector Storage / Text Completion Ollama URL
model: ''                 '' = inherit Vector Storage's ollama_model, else qwen3-embedding:0.6b
keep: true                keep the model loaded (Ollama keep_alive)
topK: 6, threshold: 0.25, queryMessages: 3, autoVectorize: true, timeoutMs: 2500, batchSize: 8
modules: {
  bonds:   { enabled: false },
  rivalry: { enabled: false },
  states:  { enabled: false, recall: 2 },          earlier blocks added to the prompt
  phone:   { enabled: false, chunkSize: 4, recall: 3 },
}
```

Manifest, one per module per scope:
```
{ v: 1, key: 'k8f3…', owner: '<chatId>', model: 'qwen3-embedding:0.6b',
  lastError: '', lastSync: 0,
  entries: { [entryId]: { hash, chunks:[hash…], vectorized, enabled, manual, text, error, at } } }
```
- `hash` = hash of the embed text actually sent (module + id + text); stale = `vectorized && hash !== current`.
- `text` = optional user override of the embed text (the "Edit" in the panel). It changes what the
  entry is matched on, not the history itself. Editing the history (a milestone note, a record)
  also changes the hash, so both kinds of edit mark the entry stale.
- `enabled:false` = never retrieved, and removed from the collection.
- `manual:true` = the user vectorized it by hand (used for untracked bond people).
- `deleted:true` = tombstone for entries whose source is a chat message (Internal States, phone).

Where the manifest lives (decision): **in chat metadata** (`chatMetadata.sillynpc_vectors[module]`)
for bonds, rivalry and Internal States, because their data is in the chat; the manifest then travels
with the chat file, cannot drift from another chat's, and is deleted with it. **In SillyNPC settings**
(`settings.vectors.phoneManifests[contactKey]`) for the phone, because phone threads are global per
contact in extension settings. Chat metadata is saved with `saveMetadataDebounced` like the stores.

Collection ids: `sillynpc_<module>_<key>` where `key` is a random id stored in the manifest.
`owner` remembers the chat id; if a chat is branched or renamed (metadata copied, id differs) the
manifest gets a new key and every entry is marked not vectorized, so two chats never share or delete
each other's vectors. Phone: `sillynpc_phone_<hash36(contact)>`, one per contact (the thread is
global by design, so the scope is the contact). A model change resets `vectorized` (the server
keeps one index per model).

## 5. Data flow

Sync (auto after a change, or "Vectorize now"):
1. adapter lists entries `{id, text, at, importance, eligible}` (bonds: eligible = person tracked).
2. `reconcile(manifest, entries, {auto|manual|all})` returns the new manifest plus
   `toDelete` (chunk hashes of stale, disabled, deleted entries) and `toInsert` (entries + chunks).
3. service deletes, then inserts in batches; per-entry success flips `vectorized`, failure records
   `error` and the manifest's `lastError`. Saved; query cache for that collection cleared.

Retrieval (`GENERATION_STARTED`, not dry runs, registered before the modules' own listeners):
1. query text = last N messages (the reply being regenerated is skipped), capped at 2000 chars.
2. per enabled module: cache key = collection + hash(query); else `query()` under `timeoutMs`.
3. `selectTopK` maps hashes to entries, drops disabled/unknown, dedupes chunks, applies threshold,
   tie-breaks by importance then recency, keeps top-K; publishes `picks[module] = [ids]`.
4. the modules' listeners (bonds, history inject, internal states) run after and read the picks.
On any failure `picks[module] = null` (fallback) and the error is shown once per minute.

Phone retrieval runs inside the phone's own `generateReply` (it has no story-prompt injection):
older chunks of that contact's thread that are not already in the phone's recent window are added
as `[OLDER TEXTS THAT MAY MATTER]`. Same timeout and fallback.

## 6. How each module uses picks

- Bonds: `bondBlock` writes milestones via `chooseEntries(history, picks, historyCount)`: relevant
  ones first, the remaining slots filled with the newest, shown newest first as before. People
  selection, gates and levels are unchanged. Untracked people are never injected (as before) and
  never auto-vectorized; their milestones can be vectorized by hand from the panel.
- Rivalry: `historyBlock` does the same with `recent` per person.
- Internal States: the latest block is still injected as ground truth; with picks, up to `recall`
  earlier relevant blocks (compact form) are appended as "Earlier states that may matter now".
- Phone: described above. Text = a chunk of `chunkSize` messages, chunk boundaries anchored on
  known chunk starts so new messages and the 200-message cap do not re-chunk the whole thread.
  The trailing incomplete chunk is not embedded (it is in the phone's recent window anyway).
- Games / combat table talk: **not stored** (games keep `gameState.chatLog` in memory and clear it
  every game; combat stores no talk). Skipped. Their results already reach the rivalry record.

## 7. Modules / files

New:
- `src/vector-core.js` pure: settings normaliser, hash (cyrb53), templates per module, stripHtml +
  compact Internal States, chunking (text and phone threads), collection ids, manifest
  (ensure/reset/reconcile/status/mark), `selectTopK`, `chooseEntries`, `formatRecalled`, query text.
- `src/vector-service.js` I/O: source resolution, insert/query/delete/purge/list, batching, abort,
  timeout, error classification and throttled toasts, connection test.
- `src/vectors.js` orchestration: adapters per module, manifests, sync, retrieval and picks, events.
- `src/ui-vectors.js` the shared panel + the core "Vectors" tab.
- `src/vectors.css`.
- `tests/combat/vectors.test.mjs`, `tests/combat/vectors-retrieval.test.mjs`.
Changed (small, guarded): `settings.js` (default `vectors: {}`), `bonds-core.js` and
`rivalry-inject-core.js` (optional `picks` argument), `bonds.js`, `history-inject.js`,
`internal-states.js` (read picks), `rivalry.js` / `internal-states.js` (emit a change event),
`ui-bonds.js`, `ui-history-inject.js`, `ui-character-extras.js` (mount the panel), `phone.js`
(recall + panel mount + change event), `ui-manage.js` + `manage.html` (Vectors tab), `index.js` (init).

## 8. UI

Shared panel (`mountVectorPanel(host, moduleId)`), same in every module:
- header row: title, module switch (enable/disable this module's vectors).
- status line: "n of m vectorized · s stale · d disabled · last error".
- buttons: Vectorize now (progress "12/40"), Re-vectorize all, Purge vectors for this chat, Cancel.
- entry list (grid, aligned columns, collapses at phone width): state dot, label, date, actions
  (view/edit text, enable/disable, vectorize this one, delete). Edit opens an inline textarea with
  Save / Reset to generated. Delete, after a confirm: for bonds and rivalry it deletes the history
  entry itself (milestone / record) and its vectors; for Internal States and phone, whose history
  is chat messages, it removes the entry from vectors and hides it (a tombstone, `deleted:true`),
  keeping the message. "Show deleted" brings tombstones back for restoring.
- Paged (25 at a time) so a 200-message phone history does not draw 200 rows.
Core tab "Vectors": master switch, Ollama URL and model (placeholders show the inherited values),
keep loaded, top-K, threshold, query messages, timeout, auto-vectorize, Test connection (server
reachable, model present, embedding works through SillyTavern, dimension if Ollama answers the
browser directly), and an overview table of every module with its status and a link to its panel.
Styling uses SillyTavern theme variables and the bonds.css conventions (cards, chips, grid tables,
30px icon buttons, 700px breakpoint).

## 9. Failure handling

- Nothing in the generation path throws: every await is wrapped, bounded by `timeoutMs`, and falls
  back to the existing behavior (`picks = null`).
- Errors are classified: network failure, 500 from the vector endpoint (Ollama unreachable or model
  missing: "check the URL and run `ollama pull <model>`"), 400 (bad request), abort, timeout.
  Toasts are throttled (one per kind per minute) and the text is stored as `lastError`.
- Syncs are serialised per collection and cancellable; a failed batch marks only its entries.
- Missing chat → nothing happens. Master off → no listener does work.

## 10. Test plan

Node (`tests/combat/vectors*.test.mjs`, pure core with the service mocked):
templates per module; hash stability and change on edit; stale detection; manifest transitions
(new → pending, auto vs manual, edited → stale with old hashes deleted, disabled → deleted and never
reinserted, re-enabled → inserted, source deleted → removed, model change and chat change reset);
untracked bond entries skipped unless manual; collection ids per chat and module and phone contact;
chunking (text and stable phone chunks); `selectTopK` threshold + importance/recency tie-break +
disabled filter + chunk dedupe; `chooseEntries` fill; formatting; retrieval fallback (a mocked
service that throws or never resolves gives `null` picks within the timeout); bonds and rivalry
injection with picks vs without (without = identical to before).
Manual in SillyTavern (cannot be run here): connection test, vectorize/purge, a generation with
vectors on showing a relevant older milestone, Ollama stopped mid-chat (fallback + toast).

## 11. Risks

- No scores from the native endpoint: ranking within the top-K is the server's; the tie-break only
  matters when a score is present. Threshold is applied server-side.
- Latency: a query embeds the search text on every generation (cached per message). Default timeout
  2.5 s; a cold model load can exceed it (then fallback, next message works).
- Model change silently needs re-vectorizing: the panel shows it (manifest reset, all pending).
- Phone threads are global; their vectors are per contact, not per chat (by design of the phone).
- Privacy: chat text goes only to the user's Ollama through SillyTavern's endpoints and is stored on
  disk in `data/<user>/vectors/ollama/sillynpc_*`. Purge removes it.

## 12. Order of work

1. vector-core.js + tests. 2. vector-service.js. 3. vectors.js (adapters, sync, retrieval).
4. Module hooks (bonds, rivalry, states, phone). 5. ui-vectors.js + css + tab. 6. node --check,
full test run. 7. Update this file with what was done and what is left.

## 13. What was built / what is left

Built (all in this folder, nothing outside it touched):

- `src/vector-core.js` (pure): settings defaults/repair, source resolution (own URL/model, else
  Vector Storage's Ollama URL/model, else localhost / qwen3-embedding:0.6b), cyrb53 hashing,
  collection ids `sillynpc_<module>_<key>` (phone: per contact hash), templates per module,
  HTML/state compaction, text and phone-thread chunking (anchored boundaries), query text,
  manifest (ensure/reset on owner or model change, planSync, markInserted/markFailed,
  setEntryFlags, status), selectTopK (score or rank, threshold, importance then recency
  tie-break), chooseEntries (picks first, fill newest, null = old behavior), formatRecalled,
  withTimeout, retrievePicks (never throws).
- `src/vector-service.js`: `/api/vector/insert|query|delete|purge|list` with source `ollama`,
  readable errors for the bare 500s, throttled toasts, per-generation picks store,
  connection test (status endpoint model list, probe insert/query/purge with a fixed sentence,
  optional direct `/api/embed` for the dimension).
- `src/vectors.js`: adapters (bonds, rivalry, states, phone), per-collection queue, sync
  (batched, stops on first failed batch), purge, per-entry edit/enable/disable/delete,
  auto-sync on change events (debounced 2 s), retrieval as a `makeFirst` GENERATION_STARTED
  listener with timeout and cache, phone recall for the phone's own request.
- Hooks: `bonds-core.js` (bondBlock/buildBondInjection optional picks, bondEntryId),
  `bonds.js`, `rivalry-inject-core.js` (historyBlock/buildInjection optional picks),
  `history-inject.js`, `rivalry.js` (change event), `internal-states.js` (change event,
  listStateRecords, recalled-states block appended after the current one),
  `modules/phone/phone.js` (change event, recall before the request, panel in its drawer).
- UI: `src/ui-vectors.js` + `src/vectors.css`; panels in the Bonds tab, Combat > History,
  Internal States settings, Phone settings; core Vectors tab (manage.html + ui-manage.js).
- `settings.js`: `vectors: {}` default (off). `index.js`: initVectors after initBonds.
- Tests: `tests/combat/vectors.test.mjs`, `tests/combat/vectors-retrieval.test.mjs`
  (41 tests). Full suite 238/238.

Not verified (no live SillyTavern / Ollama run in this session): the real endpoints, the
panels' look in each theme, the `makeFirst` ordering in a running app, the phone drawer
mount, and the direct `/api/embed` dimension probe (may be blocked by CORS; reported as
unknown, not as a failure).

Left / decided against:

- Games and combat table talk: not stored (games keep chatLog in memory only, combat keeps
  none), so there is nothing to vectorize. Skipped.
- Internal States recall only goes in when Internal States is injected (after-reply mode).
- Untracked people's milestones can be vectorized by hand, but the Bond Tracker still never
  injects untracked people, so they are only searchable, not sent.
- The phone's "Next request" preview does not show recalled texts (they are fetched async).
- Orphaned collections (a renamed chat, a deleted chat) are not cleaned up automatically;
  Purge in the panel before deleting a chat, or delete `data/<user>/vectors/ollama/sillynpc_*`.
