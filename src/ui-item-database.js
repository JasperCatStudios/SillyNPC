import { PRODUCT_NAME } from './constants.js';
import {
    inventoryStore, playerName, itemDatabase, saveItemDatabase, databaseItems, databasePresets, giveDbItemFor, givePresetFor,
} from './inventory.js';
import { normalizeDbItem, normalizePreset } from './item-database.js';

/**
 * The Item Database screen (fork), under the Inventory tracker: the presets (bundles of items and money),
 * and every item the database knows, with a search box. The Fire Emblem items are built in and cannot be
 * deleted; your own can. "Give to me" writes to the open chat's inventory, the same store the tracker and
 * the slash commands use, so a chat has to be open.
 *
 * The preset form is drawn once and kept until it is saved, and the search only redraws its own list, so
 * typing is never interrupted.
 */

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

// Kept across redraws: giving an item redraws the Inventory screen, and the search and open groups must survive it.
const memory = { search: '', open: new Set() };

const NO_CHAT = 'Open a chat first: an inventory belongs to a chat.';

function button(label, onClick, { title = '', disabled = false } = {}) {
    const b = el('button', 'menu_button', label);
    b.type = 'button';
    b.title = title;
    b.disabled = disabled;
    b.addEventListener('click', onClick);
    return b;
}

function box(placeholder, value = '', type = 'text', width = '') {
    const i = el('input', 'text_pole');
    i.type = type;
    i.placeholder = placeholder;
    i.title = placeholder;
    i.value = value ?? '';
    if (width) i.style.width = width;
    return i;
}

const hasChat = () => Boolean(inventoryStore());

/** "Vulnerary x3" or "Vulnerary, 3" or just "Vulnerary", one per line. */
export function parsePresetLines(text) {
    return String(text ?? '').split('\n').map((l) => {
        const m = /^(.*?)(?:\s*(?:[x×,]|\bx\b)\s*(\d+))?\s*$/i.exec(l.trim());
        return m && m[1].trim() ? { ref: m[1].trim(), qty: m[2] ? Number(m[2]) : 1 } : null;
    }).filter(Boolean);
}

const presetLines = (preset) => preset.items.map(i => `${i.ref} x${i.qty}`).join('\n');

function presetForm(existing, { onSave, onCancel }) {
    const form = el('div', 'snpc-inv-add');
    form.style.cssText = 'display:flex; flex-direction:column; gap:4px; margin:6px 0; padding:6px; border:1px solid var(--SmartThemeBorderColor, #444); border-radius:6px;';
    const name = box('Preset name', existing?.name);
    const desc = box('A line about it (optional)', existing?.desc);
    const gold = box('Money it includes', existing?.gold || '', 'number', '10em');
    gold.min = '0';
    const items = el('textarea', 'text_pole');
    items.rows = 5;
    items.placeholder = 'One item per line, with a number: Vulnerary x3\nNames from the database are filled in with their kind and note.';
    items.value = existing ? presetLines(existing) : '';
    const row = el('div');
    row.style.cssText = 'display:flex; gap:6px;';
    row.append(button(existing ? 'Save preset' : 'Add preset', () => {
        const made = normalizePreset({ id: existing?.id, name: name.value, desc: desc.value, gold: gold.value, items: parsePresetLines(items.value) });
        if (!made) { toastr.info('Give the preset a name first.', PRODUCT_NAME); return; }
        onSave(made);
    }));
    if (onCancel) row.append(button('Cancel', onCancel));
    form.append(name, desc, gold, items, row);
    return form;
}

function itemForm(onAdd) {
    const form = el('div', 'snpc-inv-add');
    form.style.cssText = 'display:flex; flex-wrap:wrap; gap:4px; align-items:center; margin:6px 0;';
    const name = box('Item name'); name.style.cssText = 'flex:2; min-width:9em;';
    const category = box('Category (Weapon, Potion...)'); category.style.cssText = 'flex:1; min-width:8em;';
    const price = box('Price', '', 'number', '6em');
    const uses = box('Uses', '', 'number', '5em');
    const desc = box('Description'); desc.style.cssText = 'flex:3; min-width:10em;';
    price.min = '0'; uses.min = '1';
    const tick = (text, title) => {
        const label = el('label', 'checkbox_label');
        label.title = title;
        const input = document.createElement('input');
        input.type = 'checkbox';
        label.append(input, el('span', '', text));
        return { label, input };
    };
    const locked = tick('Locked', 'Awarded only by an activity (a certification exam). Cannot be given or taken by hand.');
    const illegal = tick('Illegal', 'Contraband in the story. The narrative sees the label; nothing stops you holding it.');
    const submit = () => {
        const made = normalizeDbItem({ name: name.value, category: category.value, price: price.value, uses: uses.value, desc: desc.value, locked: locked.input.checked, illegal: illegal.input.checked });
        if (!made) { toastr.info('Give the item a name first.', PRODUCT_NAME); return; }
        onAdd(made);
    };
    for (const b of [name, category, price, uses, desc]) b.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    form.append(name, category, price, uses, desc, locked.label, illegal.label, button('Add to the database', submit));
    return form;
}

function itemSummary(item) {
    const bits = [];
    if (item.locked) bits.push('🔒 awarded only (exam)');
    if (item.illegal) bits.push('⚠ illegal');
    if (item.stats) bits.push(item.stats);
    if (item.price !== undefined) bits.push(`${item.price} gold`);
    if (item.sell !== undefined) bits.push(`sells ${item.sell}`);
    if (item.uses !== undefined) bits.push(`${item.uses} uses`);
    if (item.grade) bits.push(`${'★'.repeat(Math.min(item.grade, 5))}`);
    if (item.owner) bits.push(`belongs to ${item.owner}`);
    if (item.desc) bits.push(item.desc);
    return bits.join(' · ');
}

/**
 * @param {HTMLElement} host
 * @param {() => void} rerender redraws the whole screen after a change
 */
export function renderItemDatabase(host, rerender) {
    const wrap = el('div', 'snpc-itemdb');
    host.append(wrap);
    wrap.append(el('h4', 'sillynpc-combat-heading', 'Item Database'));
    wrap.append(el('p', 'notes', 'Named items to give from a character\'s Inventory tab or with /inventory-add, and presets: bundles of items and money handed over in one go with /inventory-preset (list them with /inventory-presets). The Fire Emblem items are built in; add your own beside them.'));

    /* ---- presets ---- */
    wrap.append(el('div', 'sillynpc-combat-group', 'Presets'));
    const presetHost = el('div');
    wrap.append(presetHost);
    let editing = '';
    const drawPresets = () => {
        presetHost.replaceChildren();
        for (const preset of databasePresets()) {
            if (editing === preset.id) {
                presetHost.append(presetForm(preset, {
                    onSave: (made) => {
                        const db = itemDatabase();
                        db.presets = [...db.presets.filter(p => p.id !== preset.id), made];
                        editing = '';
                        saveItemDatabase();
                        rerender();
                    },
                    onCancel: () => { editing = ''; drawPresets(); },
                }));
                continue;
            }
            const row = el('div', 'snpc-armoury-row');
            row.append(el('strong', '', preset.name));
            const what = preset.items.map(i => `${i.ref}${i.qty > 1 ? ` x${i.qty}` : ''}`).join(', ');
            row.append(el('small', 'notes', `${what || 'no items'}${preset.gold ? `; ${preset.gold} gold` : ''}${preset.desc ? `. ${preset.desc}` : ''}`));
            row.append(button('Give to me', () => {
                const result = givePresetFor(playerName(), preset, 1);
                if (result) toastr.success(`${preset.name}: ${result.count} item${result.count === 1 ? '' : 's'} added.`, PRODUCT_NAME);
            }, { title: hasChat() ? `Gives ${preset.name} to ${playerName()} in this chat.` : NO_CHAT, disabled: !hasChat() }));
            if (preset.builtIn) {
                row.append(el('small', 'notes', 'built in'));
            } else {
                row.append(button('Edit', () => { editing = preset.id; drawPresets(); }));
                row.append(button('Delete', () => {
                    const db = itemDatabase();
                    db.presets = db.presets.filter(p => p.id !== preset.id);
                    saveItemDatabase();
                    rerender();
                }));
            }
            presetHost.append(row);
        }
        if (!editing) {
            const newForm = presetForm(null, {
                onSave: (made) => {
                    const db = itemDatabase();
                    db.presets = [...db.presets, made];
                    saveItemDatabase();
                    rerender();
                },
            });
            const details = el('details', 'snpc-gear-more');
            details.append(el('summary', '', '+ Make a preset'), newForm);
            presetHost.append(details);
        }
    };
    drawPresets();

    /* ---- items ---- */
    wrap.append(el('div', 'sillynpc-combat-group', 'Items'));
    const search = box('Search the items', memory.search);
    search.type = 'search';
    wrap.append(search);
    const listHost = el('div');
    wrap.append(listHost);
    const drawItems = () => {
        listHost.replaceChildren();
        const want = search.value.trim().toLowerCase();
        const all = databaseItems().filter(i => !want || i.name.toLowerCase().includes(want) || i.category.toLowerCase().includes(want) || String(i.desc).toLowerCase().includes(want));
        const groups = new Map();
        for (const item of all) {
            const key = item.builtIn ? item.category : `Yours: ${item.category}`;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(item);
        }
        if (!all.length) listHost.append(el('p', 'notes', 'Nothing matches.'));
        for (const [name, list] of [...groups.entries()].sort((a, b) => (a[0].startsWith('Yours') ? -1 : 0) - (b[0].startsWith('Yours') ? -1 : 0))) {
            const details = el('details', 'snpc-gear-more');
            details.open = memory.open.has(name) || (Boolean(want) && list.length <= 30);
            details.addEventListener('toggle', () => { if (details.open) memory.open.add(name); else memory.open.delete(name); });
            details.append(el('summary', '', `${name} (${list.length})`));
            for (const item of list.slice(0, 200)) {
                const row = el('div', 'snpc-armoury-row');
                row.append(el('strong', '', item.name), el('small', 'notes', itemSummary(item)));
                row.append(button('Give to me', () => {
                    if (giveDbItemFor(playerName(), item, 1)) toastr.success(`${item.name} added.`, PRODUCT_NAME);
                }, { title: item.locked ? 'Awarded by a professor for passing a certification exam: it cannot be given by hand.' : (hasChat() ? `Gives one ${item.name} to ${playerName()} in this chat.` : NO_CHAT), disabled: !hasChat() || item.locked === true }));
                if (!item.builtIn) {
                    row.append(button('Delete', () => {
                        const db = itemDatabase();
                        db.items = db.items.filter(i => i.id !== item.id);
                        saveItemDatabase();
                        rerender();
                    }));
                }
                details.append(row);
            }
            listHost.append(details);
        }
    };
    search.addEventListener('input', () => { memory.search = search.value; drawItems(); });
    drawItems();

    wrap.append(el('div', 'sillynpc-combat-group', 'Add your own item'));
    wrap.append(itemForm((made) => {
        const db = itemDatabase();
        db.items = [...db.items, made];
        saveItemDatabase();
        rerender();
    }));
}
