import { eventSource } from '../../../../events.js';
import {
    inventorySettings, getInventory, giveItemFor, takeItemFor, setGoldFor, INVENTORY_CHANGED_EVENT,
} from './inventory.js';

/**
 * The Inventory card on a profile (fork): what this person carries and how much money they have,
 * the way the Status card shows mood and health. Reads this chat's inventory; the add, remove and
 * money controls write to the same store the tracker and the /inventory-add commands use, so
 * every route ends up in one place. Needs a chat open, because an inventory belongs to a chat.
 */

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

/**
 * @param {{ name: string }} char
 * @returns {HTMLElement}
 */
export function buildInventoryCard(char) {
    const card = el('div', 'snpc-inv-card');
    const host = el('div', 'snpc-inv-body');
    card.append(host);

    const draw = () => {
        host.replaceChildren();
        const settings = inventorySettings();
        const name = char?.name || '';
        if (!settings.enabled) {
            host.append(el('small', 'notes snpc-inv-note', 'The Inventory Tracker is off. Turn it on in the Tracker tab.'));
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
            input.addEventListener('change', () => { setGoldFor(name, input.value); });
            row.append(input);
            host.append(row);
        }

        const list = el('div', 'snpc-inv-items');
        const items = person?.items || [];
        if (!items.length) list.append(el('small', 'notes snpc-inv-note', 'Carrying nothing.'));
        for (const item of items) {
            const row = el('div', 'snpc-inv-item');
            const text = el('span', 'snpc-inv-item-name', item.qty > 1 ? `${item.name} x${item.qty}` : item.name);
            if (item.note) text.title = item.note;
            row.append(text);
            if (item.kind) row.append(el('small', 'snpc-inv-item-kind', item.kind));
            row.append(iconButton('fa-minus', 'Remove one', () => { takeItemFor(name, item.name, 1); }));
            list.append(row);
        }
        host.append(list);

        const add = el('div', 'snpc-inv-add');
        const nameBox = el('input', 'text_pole snpc-inv-add-name');
        nameBox.type = 'text';
        nameBox.placeholder = 'Add an item';
        const submit = () => {
            const value = nameBox.value.trim();
            if (!value) return;
            giveItemFor(name, { name: value, qty: 1 });
        };
        nameBox.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
        add.append(nameBox, iconButton('fa-plus', 'Add', submit));
        host.append(add);
    };

    draw();
    // Redraw when the inventory changes from anywhere (a reply, a command, this card), until the card leaves the page.
    const onChange = () => {
        if (!card.isConnected) { eventSource.removeListener?.(INVENTORY_CHANGED_EVENT, onChange); return; }
        draw();
    };
    eventSource.on(INVENTORY_CHANGED_EVENT, onChange);
    return card;
}
