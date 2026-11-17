import { eventSource } from '../../../../events.js';
import {
    inventorySettings, inventoryStore, getInventory, giveItemFor, takeItemFor, editItemFor, setGoldFor, INVENTORY_CHANGED_EVENT,
    databaseItems, databasePresets, giveDbItemFor, givePresetFor,
} from './inventory.js';
import { findDbItem } from './item-database.js';

/**
 * The Inventory card on a profile (fork): what this person carries and how much money they have,
 * the way the Status card shows mood and health. Reads this chat's inventory; the add, edit, remove and
 * money controls write to the same store the tracker and the /inventory-add commands use, so
 * every route ends up in one place. Needs a chat open, because an inventory belongs to a chat.
 * An item has four fields: name, quantity, kind and note.
 */

export const NO_CHAT_HINT = 'An inventory belongs to a chat. Open a chat to see or change what this person carries.';

/** True when a chat is open, so there is an inventory to show. */
export const inventoryAvailable = () => Boolean(inventoryStore());

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

function iconButton(icon, title, onClick) {
    const b = el('button', 'menu_button snpc-inv-btn');
    b.type = 'button';
    b.title = title;
    b.append(el('i', `fa-solid ${icon}`));
    b.addEventListener('click', (e) => { e.preventDefault(); onClick(); });
    return b;
}

function field(placeholder, type, value, className) {
    const input = el('input', `text_pole ${className}`);
    input.type = type;
    input.placeholder = placeholder;
    input.title = placeholder;
    if (type === 'number') input.min = '1';
    input.value = value ?? '';
    return input;
}

/**
 * The four boxes for one item, with their own buttons.
 * @param {{ name?: string, qty?: number, kind?: string, note?: string }} item
 * @param {{ save: (v: object) => void, cancel?: () => void, saveIcon: string, saveTitle: string }} actions
 */
function itemForm(item, { save, cancel, saveIcon, saveTitle }) {
    const form = el('div', 'snpc-inv-add');
    form.style.cssText = 'display:flex; flex-wrap:wrap; gap:4px; align-items:center; margin:4px 0;';
    const name = field('Item name', 'text', item.name, 'snpc-inv-add-name');
    const qty = field('Quantity', 'number', item.qty ?? 1, 'snpc-inv-add-qty');
    const kind = field('Kind (weapon, food, key...)', 'text', item.kind, 'snpc-inv-add-kind');
    const note = field('Note', 'text', item.note, 'snpc-inv-add-note');
    name.style.cssText = 'flex:2; min-width:8em;';
    qty.style.cssText = 'width:5em;';
    kind.style.cssText = 'flex:1; min-width:6em;';
    note.style.cssText = 'flex:2; min-width:8em;';
    const submit = () => {
        const value = name.value.trim();
        if (!value) { name.focus(); return; }
        save({ name: value, qty: Math.max(1, Math.round(Number(qty.value) || 1)), kind: kind.value.trim(), note: note.value.trim() });
    };
    for (const box of [name, qty, kind, note]) {
        box.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    }
    form.append(name, qty, kind, note, iconButton(saveIcon, saveTitle, submit));
    if (cancel) form.append(iconButton('fa-xmark', 'Cancel', cancel));
    return form;
}

/** "From the Item Database": type a name to give a known item (kind and note filled in), or pick a preset to give a whole bundle. */
function databasePicker(name, write) {
    const row = el('div', 'snpc-inv-db');
    row.style.cssText = 'display:flex; flex-wrap:wrap; gap:4px; align-items:center; margin:4px 0;';
    const listId = `snpc-inv-db-${Math.random().toString(36).slice(2, 8)}`;
    const items = databaseItems();
    const input = field('From the item database: type a name', 'text', '', 'snpc-inv-db-name');
    input.style.cssText = 'flex:2; min-width:10em;';
    input.setAttribute('list', listId);
    const datalist = el('datalist');
    datalist.id = listId;
    for (const i of items) datalist.append(new Option(i.name, i.name));
    const give = () => {
        const found = findDbItem(items, input.value);
        if (!found) { toastr.info(input.value.trim() ? 'No single item matches that. Type more of the name.' : 'Type an item name first.', 'Worldkit'); return; }
        write(() => giveDbItemFor(name, found, 1));
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); give(); } });
    row.append(input, datalist, iconButton('fa-book', 'Add this item from the database', give));

    const presets = databasePresets();
    const pick = el('select', 'text_pole');
    pick.style.cssText = 'flex:1; min-width:9em;';
    pick.append(new Option('Give a preset...', ''));
    for (const p of presets) pick.append(new Option(p.name, p.id));
    pick.addEventListener('change', () => {
        const preset = presets.find(p => p.id === pick.value);
        if (!preset) return;
        write(() => givePresetFor(name, preset, 1));
    });
    row.append(pick);
    return row;
}

/**
 * @param {{ name: string }} char
 * @returns {HTMLElement}
 */
export function buildInventoryCard(char) {
    const card = el('div', 'snpc-inv-card');
    const host = el('div', 'snpc-inv-body');
    card.append(host);
    let editing = '';   // the item being edited, by name
    let mine = false;   // true while this card is writing, so its own change redraws at once
    const write = (fn) => { mine = true; try { fn(); } finally { mine = false; } };

    const draw = () => {
        host.replaceChildren();
        const settings = inventorySettings();
        const name = char?.name || '';
        if (!settings.enabled) {
            host.append(el('small', 'notes snpc-inv-note', 'The Inventory Tracker is off. Turn it on in the Tracker tab.'));
            return;
        }
        if (!inventoryAvailable()) {
            host.append(el('small', 'notes snpc-inv-note', NO_CHAT_HINT));
            return;
        }
        const person = getInventory(name);
        const unit = settings.currencyName || 'Gold';

        if (settings.trackGold) {
            const row = el('div', 'snpc-inv-money');
            row.append(el('span', 'snpc-inv-label', unit));
            const input = el('input', 'text_pole snpc-inv-money-input');
            input.type = 'number';
            input.min = '0';
            input.value = String(person?.gold ?? 0);
            input.addEventListener('change', () => { write(() => setGoldFor(name, input.value)); });
            row.append(input);
            host.append(row);
        }

        const list = el('div', 'snpc-inv-items');
        const items = person?.items || [];
        if (!items.length) list.append(el('small', 'notes snpc-inv-note', 'Carrying nothing.'));
        for (const item of items) {
            if (editing && editing.toLowerCase() === item.name.toLowerCase()) {
                list.append(itemForm(item, {
                    saveIcon: 'fa-check',
                    saveTitle: 'Save',
                    save: (v) => { const old = editing; editing = ''; write(() => editItemFor(name, old, v)); },
                    cancel: () => { editing = ''; draw(); },
                }));
                continue;
            }
            const row = el('div', 'snpc-inv-item');
            const text = el('span', 'snpc-inv-item-name', item.qty > 1 ? `${item.name} x${item.qty}` : item.name);
            if (item.note) text.title = item.note;
            row.append(text);
            if (item.kind) row.append(el('small', 'snpc-inv-item-kind', item.kind));
            if (item.note) row.append(el('small', 'snpc-inv-item-note notes', item.note));
            row.append(iconButton('fa-pen', 'Edit this item', () => { editing = item.name; draw(); }));
            row.append(iconButton('fa-minus', 'Remove one', () => { write(() => takeItemFor(name, item.name, 1)); }));
            list.append(row);
        }
        host.append(list);

        host.append(itemForm({ qty: 1 }, {
            saveIcon: 'fa-plus',
            saveTitle: 'Add this item',
            save: (v) => { write(() => giveItemFor(name, v)); },
        }));
        host.append(databasePicker(name, write));
    };

    draw();
    // Redraw when the inventory changes from anywhere (a reply, a command, this card), until the card leaves the page.
    // Not while a box is being typed in: the redraw waits until the cursor leaves the card.
    let pending = false;
    const onChange = () => {
        if (!card.isConnected) { eventSource.removeListener?.(INVENTORY_CHANGED_EVENT, onChange); return; }
        const active = document.activeElement;
        if (!mine && active && card.contains(active) && active.tagName === 'INPUT' && active.value !== '') { pending = true; return; }
        draw();
    };
    card.addEventListener('focusout', () => {
        if (!pending) return;
        setTimeout(() => { if (pending && !card.contains(document.activeElement)) { pending = false; draw(); } }, 0);
    });
    eventSource.on(INVENTORY_CHANGED_EVENT, onChange);
    return card;
}
