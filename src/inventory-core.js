/**
 * The Inventory Tracker's rules (fork): what each person carries, and their money.
 *
 * Pure: no DOM, no SillyTavern imports, so it is tested in node. inventory.js is the SillyTavern
 * side, built the way vitals.js is: kept per chat, a separate request reads each reply and only
 * PROPOSES changes, and what applies is decided here.
 *
 * By default only the player is tracked. Turning on "Track other characters" lets the reader
 * keep a pack for anyone in the scene as well.
 */

export const INVENTORY_TIMINGS = Object.freeze({ request: 'After The Reply', manual: 'Only When I Press Update' });
export const INVENTORY_POSITIONS = Object.freeze({ chat: 'In the chat', prompt: 'In the prompt', before: 'Before the prompt' });
export const INVENTORY_ROLES = Object.freeze({ system: 'System', user: 'User', assistant: 'Assistant' });
export const INVENTORY_TRIGGERS = Object.freeze({
    scene: 'People in the scene', mentioned: 'People mentioned lately', always: 'Everyone tracked',
});

export const INVENTORY_SETTINGS_DEFAULTS = Object.freeze({
    enabled: false,
    timing: 'request',
    contextMessages: 4,
    maxTokens: 800,
    prompt: '',
    // Only the player by default; the reader is told to leave everyone else alone.
    includeNpcs: false,
    trackGold: true,
    currencyName: 'Gold',
    inject: Object.freeze({ position: 'chat', depth: 1, role: 'system', trigger: 'scene', scanDepth: 6 }),
});

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const int = (v, d, lo, hi) => (Number.isFinite(Number(v)) ? clamp(Math.round(Number(v)), lo, hi) : d);
const pick = (v, table, d) => (Object.prototype.hasOwnProperty.call(table, v) ? v : d);
const text = (v, d = '') => (typeof v === 'string' ? v : d);
const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

/** Text safe to put in a block line, where `|` separates fields and `<` starts markup. */
export const clean = (v, max = 60) => String(v ?? '').replace(/[|<>\n\r]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

export function normalizeInventorySettings(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const d = INVENTORY_SETTINGS_DEFAULTS;
    return {
        enabled: Boolean(r.enabled),
        timing: pick(r.timing, INVENTORY_TIMINGS, d.timing),
        contextMessages: int(r.contextMessages, d.contextMessages, 0, 20),
        maxTokens: int(r.maxTokens, d.maxTokens, 100, 4000),
        prompt: text(r.prompt),
        includeNpcs: r.includeNpcs === undefined ? d.includeNpcs : Boolean(r.includeNpcs),
        trackGold: r.trackGold === undefined ? d.trackGold : Boolean(r.trackGold),
        currencyName: clean(r.currencyName, 24) || d.currencyName,
        inject: {
            position: pick(r.inject?.position, INVENTORY_POSITIONS, d.inject.position),
            depth: int(r.inject?.depth, d.inject.depth, 0, 50),
            role: pick(r.inject?.role, INVENTORY_ROLES, d.inject.role),
            trigger: pick(r.inject?.trigger, INVENTORY_TRIGGERS, d.inject.trigger),
            scanDepth: int(r.inject?.scanDepth, d.inject.scanDepth, 1, 50),
        },
    };
}

/* ------------------------------------------------------------------------ store */

export function normalizeItem(raw) {
    const name = clean(raw?.name);
    if (!name) return null;
    return { name, qty: int(raw?.qty, 1, 1, 999999), kind: clean(raw?.kind, 24), note: clean(raw?.note, 120) };
}

export function newPerson(name, { player = false } = {}) {
    return { name: String(name).trim(), player: Boolean(player), tracked: true, gold: 0, items: [], history: [], updated: 0 };
}

export function normalizePerson(raw) {
    const p = newPerson(text(raw?.name) || 'Unknown', { player: raw?.player });
    p.tracked = raw?.tracked === undefined ? true : Boolean(raw.tracked);
    p.gold = int(raw?.gold, 0, 0, 999999999);
    p.items = (Array.isArray(raw?.items) ? raw.items : []).map(normalizeItem).filter(Boolean);
    p.history = (Array.isArray(raw?.history) ? raw.history : []).filter(h => h && typeof h === 'object').slice(-40);
    p.updated = Number(raw?.updated) || 0;
    return p;
}

export function normalizeStore(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    return {
        version: 1,
        people: (Array.isArray(r.people) ? r.people : []).filter(p => p && p.name).map(normalizePerson),
        turns: (Array.isArray(r.turns) ? r.turns : []).filter(t => t && typeof t === 'object').slice(-60),
    };
}

export const findPerson = (store, name) => store.people.find(p => same(p.name, name)) || null;

export function ensurePerson(store, name, opts) {
    let p = findPerson(store, name);
    if (!p) { p = newPerson(name, opts); store.people.push(p); }
    return p;
}

const findItem = (person, name) => person.items.find(i => same(i.name, name)) || null;

/* ---------------------------------------------------------------- hand edits */

const HISTORY_CAP = 40;
function note(person, what, why, now) {
    person.history.push({ at: now, what, why });
    if (person.history.length > HISTORY_CAP) person.history.splice(0, person.history.length - HISTORY_CAP);
    person.updated = now;
}

export function setGold(person, value, { now = Date.now(), why = 'edited' } = {}) {
    if (!Number.isFinite(Number(value))) return false;
    const next = int(value, 0, 0, 999999999);
    note(person, `money ${person.gold} -> ${next}`, why, now);
    person.gold = next;
    return true;
}

/** Adds to a stack, or starts one. Returns the item. */
export function giveItem(person, raw, { now = Date.now(), why = 'edited' } = {}) {
    const item = normalizeItem(raw);
    if (!item) return null;
    const have = findItem(person, item.name);
    if (have) {
        have.qty = clamp(have.qty + item.qty, 1, 999999);
        if (item.kind) have.kind = item.kind;
        if (item.note) have.note = item.note;
        note(person, `+${item.qty} ${item.name}`, why, now);
        return have;
    }
    person.items.push(item);
    note(person, `+${item.qty} ${item.name}`, why, now);
    return item;
}

/**
 * Replaces one stack's name, quantity, kind and note. Renaming onto another stack merges the two.
 * Returns the stack, or null when the old one is not there or the new one is not valid.
 */
export function editItem(person, oldName, raw, { now = Date.now(), why = 'edited' } = {}) {
    const have = findItem(person, oldName);
    const next = normalizeItem(raw);
    if (!have || !next) return null;
    const other = findItem(person, next.name);
    if (other && other !== have) {
        other.qty = clamp(other.qty + next.qty, 1, 999999);
        if (next.kind) other.kind = next.kind;
        if (next.note) other.note = next.note;
        person.items.splice(person.items.indexOf(have), 1);
        note(person, `merged ${have.name} into ${other.name}`, why, now);
        return other;
    }
    Object.assign(have, next);
    note(person, `edited ${next.name}`, why, now);
    return have;
}

/** Takes some or all of a stack away. `qty` of null or Infinity removes the whole stack. */
export function takeItem(person, name, qty = 1, { now = Date.now(), why = 'edited' } = {}) {
    const have = findItem(person, name);
    if (!have) return false;
    const n = qty == null || !Number.isFinite(Number(qty)) ? Infinity : Math.max(1, Math.round(Number(qty)));
    const removed = Math.min(n, have.qty);
    have.qty -= removed;
    if (have.qty <= 0) person.items.splice(person.items.indexOf(have), 1);
    note(person, `-${removed} ${have.name}`, why, now);
    return true;
}

/* ------------------------------------------------------------------ applying a read */

const snapshot = (person) => ({ gold: person.gold, items: person.items.map(i => ({ ...i })), existed: true });

/**
 * Applies what one reply produced. Reading the same reply again replaces what it did before.
 * Unknown people are only added when they are the player, or when other characters are tracked
 * and they are in `known`. The prior state is kept in a turn record so a swipe or delete can undo it.
 *
 * @returns {{ applied: boolean, record: { changes: object[] } }}
 */
export function applyTurn(store, update, settings, ctx = {}) {
    const now = ctx.now ?? Date.now();
    if (ctx.key !== undefined) revertTurn(store, String(ctx.key));
    const known = new Set((ctx.known || []).map(n => String(n).toLowerCase()));
    const changes = [];
    const before = {};
    for (const row of update?.people || []) {
        const name = clean(row?.name, 80);
        if (!name) continue;
        const isPlayer = Boolean(ctx.player && same(name, ctx.player));
        let person = findPerson(store, name);
        if (!person) {
            const allowed = isPlayer || (settings.includeNpcs && known.has(name.toLowerCase()));
            if (!allowed) continue;
            person = newPerson(name, { player: isPlayer });
            store.people.push(person);
        }
        if (!person.tracked || (!isPlayer && !person.player && !settings.includeNpcs)) continue;

        const snap = snapshot(person);
        let touched = false;
        const why = text(row.reason).trim();

        if (settings.trackGold) {
            let target = null;
            if (row.gold != null && row.gold !== '' && Number.isFinite(Number(row.gold))) target = int(row.gold, person.gold, 0, 999999999);
            else if (row.goldChange != null && Number.isFinite(Number(row.goldChange))) target = clamp(person.gold + Math.round(Number(row.goldChange)), 0, 999999999);
            if (target !== null && target !== person.gold) {
                changes.push({ name: person.name, stat: 'gold', from: person.gold, to: target, why });
                note(person, `money ${person.gold} -> ${target}`, why || 'story', now);
                person.gold = target;
                touched = true;
            }
        }
        for (const it of Array.isArray(row.remove) ? row.remove : []) {
            const itemName = clean(it?.name);
            const qty = String(it?.qty).toLowerCase() === 'all' ? null : (it?.qty ?? 1);
            if (itemName && takeItem(person, itemName, qty, { now, why: why || 'story' })) {
                changes.push({ name: person.name, stat: 'item', text: `-${itemName}`, why });
                touched = true;
            }
        }
        for (const it of Array.isArray(row.add) ? row.add : []) {
            const given = giveItem(person, it, { now, why: why || 'story' });
            if (given) {
                changes.push({ name: person.name, stat: 'item', text: `+${clean(it?.name)}`, why });
                touched = true;
            }
        }
        if (touched) before[person.name] = snap;
    }
    if (ctx.key !== undefined) {
        store.turns = store.turns.filter(t => t.key !== String(ctx.key));
        store.turns.push({ key: String(ctx.key), swipeId: ctx.swipeId ?? 0, messageId: ctx.messageId, before, changes, at: now });
        if (store.turns.length > 60) store.turns.splice(0, store.turns.length - 60);
    }
    return { applied: changes.length > 0, record: { changes } };
}

/** Takes back everything one reply did. Returns whether anything was undone. */
export function revertTurn(store, key) {
    const turn = store.turns.find(t => t.key === String(key));
    if (!turn) return false;
    let any = false;
    for (const [name, snap] of Object.entries(turn.before || {})) {
        const person = findPerson(store, name);
        if (!person) continue;
        person.gold = snap.gold;
        person.items = (snap.items || []).map(i => ({ ...i }));
        any = true;
    }
    store.turns = store.turns.filter(t => t !== turn);
    return any;
}

/* --------------------------------------------------------------------- the reader */

export function parseUpdate(raw) {
    const src = String(raw ?? '');
    const start = src.indexOf('{');
    const end = src.lastIndexOf('}');
    if (start < 0 || end <= start) return { people: [] };
    try {
        const data = JSON.parse(src.slice(start, end + 1));
        const people = (Array.isArray(data.people) ? data.people : []).filter(p => p && typeof p === 'object' && p.name);
        return { people: people.map(p => ({ ...p, name: String(p.name).trim() })) };
    } catch {
        return { people: [] };
    }
}

export const INVENTORY_SYSTEM = [
    'You read one reply of a story and report what the people in it now carry and how much money they have.',
    'Report only changes the reply states or clearly shows: something picked up, bought, found, given, received, used up, dropped, stolen, sold or broken, and money gained or spent.',
    'For each person who changed, give "add" (items gained: name, qty, a short kind such as Weapon, Consumable, Tool, Key, Gear, Misc, and an optional short note),',
    '"remove" (items lost: name and qty, or "all"), and money as "goldChange" (a signed number) or, when the reply states a total, "gold" (the new total).',
    'Use the same item name the current inventory uses when it is the same thing. Do not invent items or prices, and leave a person out when nothing changed for them.',
    'Answer with one JSON object and nothing else:',
    '{"people":[{"name":"Name","add":[{"name":"Healing Potion","qty":2,"kind":"Consumable","note":"+35 HP"}],"remove":[{"name":"Rope","qty":1}],"goldChange":-15,"reason":"one short sentence"}]}',
].join(' ');

const itemText = (i) => `${i.name}${i.qty > 1 ? ` x${i.qty}` : ''}${i.kind ? ` [${i.kind}]` : ''}`;

/** The two prompts for the separate request. */
export function buildMonitorPrompt(settings, people, ctx = {}) {
    const who = settings.includeNpcs ? 'the player and anyone else named in the reply' : `only ${ctx.playerName || 'the player'}; ignore everyone else`;
    const money = settings.trackGold ? ` Money is called ${settings.currencyName}.` : ' Do not report money.';
    const system = `${settings.prompt?.trim() || INVENTORY_SYSTEM}\n\nTrack ${who}.${money}`;
    const lines = people.map(p => `- ${p.name}: ${settings.trackGold ? `${p.gold} ${settings.currencyName}; ` : ''}${p.items.length ? p.items.map(itemText).join(', ') : 'nothing carried'}`);
    const user = [
        lines.length ? `Current inventory:\n${lines.join('\n')}` : 'Nothing is recorded yet.',
        ctx.recent ? `Earlier in the story:\n${ctx.recent}` : '',
        `The player is ${ctx.playerName || 'the player'}. Latest reply (from ${ctx.speaker || 'the narrator'}):\n${ctx.latest || ''}`,
    ].filter(Boolean).join('\n\n');
    return { system, user };
}

export function selectPeople(store, opts, { applies = () => true } = {}) {
    void opts;
    return store.people.filter(p => p.tracked).filter(p => applies(p.name)).map(p => p.name);
}

/** The text sent with the story: what each chosen person carries. */
export function buildInjection(store, names, settings, playerName = '') {
    const parts = [];
    for (const name of names) {
        const p = findPerson(store, name);
        if (!p || !p.tracked) continue;
        const bits = [];
        if (settings.trackGold) bits.push(`${p.gold} ${settings.currencyName}`);
        bits.push(p.items.length ? `carrying ${p.items.map(itemText).join(', ')}` : 'carrying nothing');
        parts.push(`- ${p.name}${p.player || same(p.name, playerName) ? ' (the player)' : ''}: ${bits.join('; ')}`);
    }
    if (!parts.length) return '';
    return `[Inventory: what each person has on them right now. Keep to it; do not give them things they do not have.\n${parts.join('\n')}]`;
}

/* -------------------------------------------------------------- the block under a reply */

export const INVENTORY_SUMMARY = '🎒 INVENTORY';

/** One person's header line and their item lines, as the Worldkit Inventory regexes expect. */
export function inventoryLines(person, settings, changeNote = '') {
    const money = settings?.trackGold === false ? '--' : String(person.gold);
    const unit = clean(settings?.currencyName, 24) || 'Gold';
    const head = `- <b>${clean(person.name, 80)}</b> | MONEY: ${money} | UNIT: ${unit} | ITEMS: ${person.items.length}${changeNote ? ` | NOTE: ${clean(changeNote, 160)}` : ''}`;
    const items = person.items.map(i => `- ITEM: ${clean(i.name)} | QTY: ${i.qty} | KIND: ${clean(i.kind, 24)} | NOTE: ${clean(i.note, 120)}`);
    return [head, ...items];
}

/** The INVENTORY block shown under a reply: a <details> with a header and item lines per tracked person. */
export function inventoryBlockHtml(store, record, settings) {
    const people = (store?.people || []).filter(p => p.tracked).slice(0, 12);
    if (!people.length) return '';
    const changes = record?.changes || [];
    const lines = people.flatMap((person) => {
        const mine = changes.filter(c => c.name === person.name);
        const bits = mine.map(c => (c.stat === 'gold' ? `${c.to - c.from > 0 ? '+' : ''}${c.to - c.from} ${settings?.currencyName || 'Gold'}` : c.text));
        return inventoryLines(person, settings, bits.join(', '));
    });
    return `<details><summary>${INVENTORY_SUMMARY}</summary>\n${lines.join('\n')}\n</details>`;
}

/* ---------------------------------------------------------- editing a block by hand */

const plain = (html) => String(html ?? '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ');

/**
 * The tracked people as editable plain lines, the same lines the block under a reply is made from
 * (minus the markup): a header per person, then one line per item.
 */
export function inventoryToText(store, settings) {
    const people = (store?.people || []).filter(p => p.tracked).slice(0, 12);
    return people.flatMap(p => inventoryLines(p, settings, '')).map(plain).join('\n');
}

/**
 * Reads the editable lines back. A header line starts a person; item lines belong to the header above.
 * Lines that fit neither are skipped, so a half-typed line never throws away the rest.
 *
 * @returns {{ name: string, gold: number|null, items: object[] }[]}
 */
export function parseInventoryText(text) {
    const out = [];
    let current = null;
    for (const line of String(text || '').split('\n')) {
        const head = /^\s*-?\s*(.+?)\s*\|\s*MONEY:\s*(\d+|--)\s*(?:\|.*)?$/i.exec(line);
        if (head) {
            current = { name: clean(head[1], 80), gold: head[2] === '--' ? null : Number(head[2]), items: [] };
            out.push(current);
            continue;
        }
        const item = /^\s*-?\s*ITEM:\s*(.+?)\s*(?:\|\s*QTY:\s*(\d+)\s*)?(?:\|\s*KIND:\s*([^|]*?)\s*)?(?:\|\s*NOTE:\s*(.*?)\s*)?$/i.exec(line);
        if (item && current) {
            const it = normalizeItem({ name: item[1], qty: item[2] === undefined ? 1 : Number(item[2]), kind: item[3], note: item[4] });
            if (it) current.items.push(it);
        }
    }
    return out.filter(p => p.name);
}

/**
 * Sets what was edited: each named person who is already in the store gets that money and exactly
 * that list of items. People not mentioned are left as they are, and nobody new is created from
 * the edit, so a mistyped name cannot add a stranger. Returns how many people changed.
 */
export function applyInventoryEdit(store, parsed, settings, { now = Date.now() } = {}) {
    let changed = 0;
    for (const row of parsed || []) {
        const person = findPerson(store, row.name);
        if (!person) continue;
        let touched = false;
        if (settings?.trackGold !== false && row.gold !== null && row.gold !== person.gold) {
            setGold(person, row.gold, { now, why: 'edited' });
            touched = true;
        }
        const items = row.items.map(normalizeItem).filter(Boolean);
        if (JSON.stringify(items) !== JSON.stringify(person.items)) {
            person.items = items;
            note(person, 'items edited', 'edited', now);
            touched = true;
        }
        if (touched) changed++;
    }
    return changed;
}
