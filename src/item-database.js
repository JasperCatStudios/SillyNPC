/**
 * The Item Database (fork): named items anyone can be given from the Inventory, the way the Armoury
 * holds named weapons. Only a small example set is built in; big lists (such as the Fire Emblem: Three
 * Houses items) come from the Content Kit and are imported into your own items, which are kept in the
 * settings and can be added or deleted. Presets are named bundles of items (and money) that a slash
 * command or a button hands to a character in one go.
 *
 * Pure, so it is tested without SillyTavern. Nothing here touches a chat; inventory.js does that.
 */

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const whole = (v, lo, hi) => (Number.isFinite(Number(v)) && String(v ?? '').trim() !== '' ? clamp(Math.round(Number(v)), lo, hi) : null);
const line = (v, max) => String(v ?? '').replace(/[|<>\n\r]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

const slug = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

/** One database item with every field in range. Returns null when it has no name. */
export function normalizeDbItem(raw) {
    const name = line(raw?.name, 60);
    if (!name) return null;
    const item = { id: line(raw?.id, 60) || `my_${slug(name) || 'item'}`, name, category: line(raw?.category, 24) || 'Item' };
    const price = whole(raw?.price, 0, 99999999); if (price !== null) item.price = price;
    const sell = whole(raw?.sell, 0, 99999999); if (sell !== null) item.sell = sell;
    const uses = whole(raw?.uses, 1, 9999); if (uses !== null) item.uses = uses;
    const grade = whole(raw?.grade, 0, 9); if (grade !== null) item.grade = grade;
    const stats = line(raw?.stats, 80); if (stats) item.stats = stats;
    const owner = line(raw?.owner, 40); if (owner) item.owner = owner;
    item.desc = line(raw?.desc, 400);
    return item;
}

/** One preset: a name, an optional gold amount, and items by id or by name. */
export function normalizePreset(raw) {
    const name = line(raw?.name, 40);
    if (!name) return null;
    const items = [];
    for (const entry of Array.isArray(raw?.items) ? raw.items : []) {
        const ref = line(entry?.ref ?? entry?.name, 60);
        if (!ref) continue;
        items.push({ ref, qty: whole(entry?.qty, 1, 999999) ?? 1 });
    }
    return { id: line(raw?.id, 60) || `preset_${slug(name) || 'new'}`, name, desc: line(raw?.desc, 200), gold: whole(raw?.gold, 0, 999999999) ?? 0, items };
}

/** The saved database block with only well-formed items and presets, ids made unique. */
export function normalizeItemDatabase(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const unique = (list, pick) => {
        const seen = new Set();
        const out = [];
        for (const entry of list) {
            const n = pick(entry);
            if (!n) continue;
            let id = n.id;
            for (let k = 2; seen.has(id); k++) id = `${n.id}_${k}`;
            seen.add(id);
            out.push({ ...n, id });
        }
        return out;
    };
    return {
        items: unique(Array.isArray(r.items) ? r.items : [], normalizeDbItem),
        presets: unique(Array.isArray(r.presets) ? r.presets : [], normalizePreset),
    };
}

/** A light example set that ships with the extension. It cannot be deleted; add your own, or import a list from the Content Kit. */
export const EXAMPLE_ITEMS = Object.freeze([
    { id: 'ex_healing_potion', name: 'Healing Potion', category: 'Potion', price: 50, sell: 15, uses: 1, desc: 'A red draught that closes small wounds.' },
    { id: 'ex_antidote', name: 'Antidote', category: 'Potion', price: 30, sell: 10, uses: 1, desc: 'Clears most common poisons.' },
    { id: 'ex_torch', name: 'Torch', category: 'Tool', price: 2, sell: 1, desc: 'Burns for a few hours.' },
    { id: 'ex_rope', name: 'Rope', category: 'Tool', price: 8, sell: 3, desc: 'Fifty feet of hemp rope.' },
    { id: 'ex_lockpick', name: 'Lockpick', category: 'Tool', price: 12, sell: 4, desc: 'A thin steel pick. Breaks if forced.' },
    { id: 'ex_waterskin', name: 'Waterskin', category: 'Supplies', price: 3, sell: 1, desc: 'Holds a day of water.' },
    { id: 'ex_bread', name: 'Bread Loaf', category: 'Food', price: 1, sell: 0, desc: 'Plain and filling.' },
    { id: 'ex_iron_key', name: 'Iron Key', category: 'Key', desc: 'Opens something nearby.' },
    { id: 'ex_silver_ring', name: 'Silver Ring', category: 'Trinket', price: 40, sell: 20, desc: 'A plain band with a worn inscription.' },
    { id: 'ex_old_map', name: 'Old Map', category: 'Trinket', desc: 'Faded, with one place circled in ink.' },
]);

/** Example presets that ship with the extension: bundles of the example items. They cannot be deleted. */
export const BUILTIN_PRESETS = Object.freeze([
    { id: 'preset_travellers_pack', name: 'Traveller\'s Pack', desc: 'The basics for a journey.', gold: 20,
        items: [{ ref: 'Bread Loaf', qty: 2 }, { ref: 'Waterskin', qty: 1 }, { ref: 'Torch', qty: 2 }, { ref: 'Rope', qty: 1 }] },
    { id: 'preset_healers_satchel', name: 'Healer\'s Satchel', desc: 'Remedies for the road.', gold: 0,
        items: [{ ref: 'Healing Potion', qty: 3 }, { ref: 'Antidote', qty: 2 }] },
    { id: 'preset_thief_tools', name: 'Thief\'s Tools', desc: 'For doors that are not yours.', gold: 5,
        items: [{ ref: 'Lockpick', qty: 3 }, { ref: 'Rope', qty: 1 }, { ref: 'Torch', qty: 1 }] },
]);

/** The example items first, then yours; an item of yours with an example's id replaces it. */
export function allDbItems(database) {
    const own = normalizeItemDatabase(database).items;
    const ownIds = new Set(own.map(i => i.id));
    return [...EXAMPLE_ITEMS.filter(i => !ownIds.has(i.id)).map(i => ({ ...normalizeDbItem(i), builtIn: true })), ...own.map(i => ({ ...i, builtIn: false }))];
}

/**
 * Reads an imported file ({ items, presets }) and adds it to the saved database. An item or preset with an id
 * already there is replaced in place, so importing twice never makes a copy.
 *
 * @returns {{ database: { items: object[], presets: object[] }, added: number, replaced: number }}
 */
export function mergeItemFile(database, file) {
    const have = normalizeItemDatabase(database);
    const incoming = normalizeItemDatabase(file);
    let added = 0;
    let replaced = 0;
    const merge = (list, news) => {
        const out = list.slice();
        for (const n of news) {
            const at = out.findIndex(x => x.id === n.id);
            if (at >= 0) { out[at] = n; replaced++; } else { out.push(n); added++; }
        }
        return out;
    };
    return { database: { items: merge(have.items, incoming.items), presets: merge(have.presets, incoming.presets) }, added, replaced };
}

/** Built-in presets first, then yours. */
export function allPresets(database) {
    const own = normalizeItemDatabase(database).presets;
    const ownIds = new Set(own.map(p => p.id));
    return [...BUILTIN_PRESETS.filter(p => !ownIds.has(p.id)).map(p => ({ ...normalizePreset(p), builtIn: true })), ...own.map(p => ({ ...p, builtIn: false }))];
}

const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

/** The item a typed id or name means: an exact id or name, else the only item whose name contains it. Null when unsure. */
export function findDbItem(items, typed) {
    const want = String(typed ?? '').trim().toLowerCase();
    if (!want) return null;
    const exact = items.find(i => same(i.id, want) || same(i.name, want));
    if (exact) return exact;
    const near = items.filter(i => i.name.toLowerCase().includes(want));
    return near.length === 1 ? near[0] : null;
}

/** The preset a typed id or name means, with the same rule. */
export function findPreset(presets, typed) {
    const want = String(typed ?? '').trim().toLowerCase();
    if (!want) return null;
    const exact = presets.find(p => same(p.id, want) || same(p.name, want));
    if (exact) return exact;
    const near = presets.filter(p => p.name.toLowerCase().includes(want));
    return near.length === 1 ? near[0] : null;
}

/** The inventory item (name, qty, kind, note) a database item becomes. The note carries its stats and description. */
export function toInventoryItem(dbItem, qty = 1) {
    const bits = [];
    if (dbItem.stats) bits.push(dbItem.stats);
    if (dbItem.desc) bits.push(dbItem.desc);
    return { name: dbItem.name, qty, kind: dbItem.category || '', note: line(bits.join('. '), 120) };
}

/**
 * What handing out a preset means: the items (looked up in the database, else just the name) and the gold.
 *
 * @returns {{ items: { name: string, qty: number, kind: string, note: string }[], gold: number }}
 */
export function resolvePreset(preset, dbItems) {
    const items = (preset?.items || []).map((entry) => {
        const found = findDbItem(dbItems, entry.ref);
        return found ? toInventoryItem(found, entry.qty) : { name: line(entry.ref, 60), qty: entry.qty, kind: '', note: '' };
    });
    return { items, gold: Number(preset?.gold) || 0 };
}

export { slug as itemSlug };
