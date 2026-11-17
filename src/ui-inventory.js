import { redrawWhenIdle } from './ui-edit-guard.js';
import { eventSource } from '../../../../events.js';
import { buildSettingToggle, buildSettingSelect, buildSettingNumber } from './ui-shared.js';
import { buildThemePicker } from './ui-tracker-theme.js';
import { renderItemDatabase } from './ui-item-database.js';
import {
    inventorySettings, saveInventorySettings, inventoryStore, setGoldFor, removePersonFor, playerName, giveItemFor, takeItemFor, ensurePlayerInventory,
    runInventoryUpdate, latestReplyId, currentInventoryInjection, INVENTORY_CHANGED_EVENT,
} from './inventory.js';
import {
    INVENTORY_SETTINGS_DEFAULTS, INVENTORY_TIMINGS, INVENTORY_POSITIONS, INVENTORY_ROLES, INVENTORY_TRIGGERS,
} from './inventory-core.js';

/**
 * The Inventory Tracker's screen (fork): its settings in the Trackers tab, and the people it keeps
 * a pack for. Built like the Vitals view. Only the player is tracked until "Track other
 * characters" is switched on.
 */

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

const STORE = { get: () => inventorySettings(), save: () => saveInventorySettings(), defaults: INVENTORY_SETTINGS_DEFAULTS };
const INJECT = { get: () => inventorySettings().inject, save: () => saveInventorySettings(), defaults: INVENTORY_SETTINGS_DEFAULTS.inject };
const namespaced = (node) => { if (node?.dataset?.setting) node.dataset.setting = `inventory.${node.dataset.setting}`; return node; };
const options = (table) => Object.entries(table).map(([value, label]) => ({ value, label }));

let currentView = null;
let listening = false;

export function renderInventoryView(view) {
    if (!view) return;
    if (view.isConnected || !currentView?.isConnected) currentView = view;
    if (!listening) {
        listening = true;
        eventSource.on(INVENTORY_CHANGED_EVENT, () => {
            if (currentView?.isConnected) redrawWhenIdle(currentView, () => renderInventoryView(currentView));
        });
    }
    const scroll = view.closest('.sillynpc-tab-panel')?.scrollTop ?? 0;
    view.replaceChildren();
    view.classList.add('snpc-inventory');
    const rerender = () => renderInventoryView(view);

    view.append(el('h3', 'sillynpc-section-title', 'Inventory Tracker'));
    view.append(el('p', 'notes sillynpc-tab-intro',
        'What you carry, and your money. Items and money are kept per chat. The model only proposes what changed (something found, bought, '
        + 'used or lost); you can edit anything by hand below. Only you are tracked unless you turn on Track Other Characters.'));

    view.append(namespaced(buildSettingToggle({
        store: STORE, key: 'enabled', label: 'Track Inventory',
        help: 'The master switch. Off: no requests, no changes, nothing sent to the story. What is already recorded is kept.',
        onChange: rerender,
    })));
    view.append(buildThemePicker('inventory', { onChange: rerender }));
    if (!inventorySettings().enabled) {
        view.append(el('p', 'notes', 'The tracker is off. Everything below can still be set up.'));
    }

    view.append(namespaced(buildSettingSelect({
        store: STORE, key: 'timing', label: 'When Inventory Updates', options: options(INVENTORY_TIMINGS), onChange: rerender,
        help: 'After The Reply: a separate request on the Inventory connection reads each new reply. Only When I Press Update: nothing happens by itself.',
    })));
    // The connection that reads replies is chosen in Connections, under Trackers.

    view.append(el('h4', 'sillynpc-combat-heading', 'Who and what'));
    view.append(namespaced(buildSettingToggle({
        store: STORE, key: 'includeNpcs', label: 'Track Other Characters',
        help: 'Off (the default): only you. On: the reader also keeps a pack for characters it knows from the scene.',
        onChange: rerender,
    })));
    view.append(namespaced(buildSettingToggle({
        store: STORE, key: 'trackGold', label: 'Track Money',
        help: 'Keep a purse of gold or whatever currency this story uses.', onChange: rerender,
    })));
    if (inventorySettings().trackGold) view.append(currencyRow());

    renderPeople(view, rerender);

    view.append(el('h4', 'sillynpc-combat-heading', 'Reader and story prompt'));
    view.append(namespaced(buildSettingNumber({ store: STORE, key: 'maxTokens', label: 'Reply Budget', suffix: 'tokens', help: 'The answer is a small JSON object; 800 is plenty.', advanced: true })));
    view.append(namespaced(buildSettingNumber({ store: STORE, key: 'contextMessages', label: 'Earlier Messages Read', suffix: 'messages', advanced: true })));
    // The reader instructions are in the Prompts tab, under Tracker prompts.
    view.append(namespaced(buildSettingSelect({ store: INJECT, key: 'trigger', label: 'Send To The Story For', options: options(INVENTORY_TRIGGERS), advanced: true, help: 'Whose inventory goes into the story prompt each turn.' })));
    view.append(namespaced(buildSettingSelect({ store: INJECT, key: 'position', label: 'Prompt Position', options: options(INVENTORY_POSITIONS), advanced: true })));
    view.append(namespaced(buildSettingSelect({ store: INJECT, key: 'role', label: 'Prompt Role', options: options(INVENTORY_ROLES), advanced: true })));

    const preview = el('pre', 'snpc-vit-preview notes');
    const showPreview = el('button', 'menu_button', 'Preview what is sent');
    showPreview.type = 'button';
    showPreview.addEventListener('click', () => { preview.textContent = currentInventoryInjection({ everyone: true }) || '(nothing yet)'; });
    view.append(showPreview, preview);

    const panel = view.closest('.sillynpc-tab-panel');
    if (panel) panel.scrollTop = scroll;
}

/** The name of the money, such as Gold, Credits or Crowns. */
function currencyRow() {
    const wrap = el('div', 'sillynpc-setting');
    wrap.dataset.setting = 'inventory.currencyName';
    const row = el('div', 'sillynpc-setting-row');
    const label = el('label', 'sillynpc-setting-label', 'Currency Name');
    const field = el('input', 'text_pole');
    field.type = 'text';
    field.maxLength = 24;
    field.value = inventorySettings().currencyName;
    // Saved as it is typed; the box is not redrawn, so typing is not interrupted.
    field.addEventListener('input', () => {
        inventorySettings().currencyName = field.value;
        saveInventorySettings();
    });
    field.addEventListener('change', () => { field.value = inventorySettings().currencyName; });
    row.append(label, field);
    wrap.append(row, el('small', 'notes', 'What the money is called in the block, the story prompt and the reader. Gold, Credits, Crowns, Caps.'));
    return wrap;
}

function numberBox(value, onCommit, { min = 0, width = '6em' } = {}) {
    const field = el('input', 'text_pole');
    field.type = 'number';
    field.min = String(min);
    field.value = String(value);
    field.style.width = width;
    field.addEventListener('change', () => {
        // Emptying the box is not "zero": it keeps what it had.
        if (field.value.trim() === '') { field.value = String(value); return; }
        onCommit(Number(field.value));
    });
    return field;
}

function renderPeople(view, rerender) {
    view.append(el('h4', 'sillynpc-combat-heading', 'Packs in this chat'));
    const store = inventoryStore();
    if (!store) { view.append(el('p', 'notes', 'Open a chat to see its inventory.')); return; }
    const settings = inventorySettings();
    // Your own pack is always there to fill in, even before anything has been read.
    if (!store.people.some(p => p.player)) {
        const mine = el('button', 'menu_button', 'Start your own pack');
        mine.type = 'button';
        mine.addEventListener('click', () => { ensurePlayerInventory(); rerender(); });
        view.append(mine);
    }
    const list = el('div', 'snpc-inv-people');
    for (const p of store.people) {
        if (!settings.includeNpcs && !p.player) continue;
        const card = el('div', 'snpc-inv-person');
        card.style.cssText = 'margin:8px 0; padding:8px; border:1px solid var(--SmartThemeBorderColor, #444); border-radius:6px;';
        const head = el('div', 'sillynpc-setting-row');
        head.append(el('b', '', `${p.name}${p.name.toLowerCase() === playerName().toLowerCase() ? ' (you)' : (p.player ? ' (an earlier persona)' : '')}`));
        if (p.name.toLowerCase() !== playerName().toLowerCase()) {
            const gone = el('button', 'menu_button', 'Remove');
            gone.type = 'button';
            gone.title = 'Delete this whole inventory record from this chat';
            gone.style.marginLeft = 'auto';
            gone.addEventListener('click', () => { removePersonFor(p.name); });
            head.append(gone);
        }
        card.append(head);
        if (settings.trackGold) {
            const purse = el('div', 'sillynpc-setting-row');
            purse.append(el('span', 'notes', settings.currencyName), numberBox(p.gold, (n) => { setGoldFor(p.name, n); }));
            card.append(purse);
        }
        for (const item of p.items) {
            const line = el('div', 'sillynpc-setting-row');
            line.append(
                el('span', '', `${item.name} x${item.qty}${item.kind ? ` [${item.kind}]` : ''}${item.note ? ` - ${item.note}` : ''}`),
            );
            const drop = el('button', 'menu_button', 'Drop');
            drop.type = 'button';
            drop.title = 'Take away the whole stack';
            drop.addEventListener('click', () => { takeItemFor(p.name, item.name, null); });
            line.append(drop);
            card.append(line);
        }
        if (!p.items.length) card.append(el('small', 'notes', 'Carrying nothing.'));
        card.append(addItemRow(p.name));
        list.append(card);
    }
    view.append(list);
    const update = el('button', 'menu_button', 'Read the latest reply now');
    update.type = 'button';
    update.addEventListener('click', () => {
        const id = latestReplyId();
        if (id >= 0) runInventoryUpdate(id, { force: true, button: true }).then(rerender);
    });
    view.append(update);
    renderItemDatabase(view, rerender);
}

function addItemRow(name) {
    const row = el('div', 'sillynpc-setting-row');
    const item = el('input', 'text_pole');
    item.type = 'text';
    item.placeholder = 'Item';
    const qty = numberBox(1, () => {}, { min: 1, width: '4em' });
    const kind = el('input', 'text_pole');
    kind.type = 'text';
    kind.placeholder = 'Kind (Weapon, Tool...)';
    const add = el('button', 'menu_button', 'Add');
    add.type = 'button';
    add.addEventListener('click', () => {
        if (!item.value.trim()) return;
        giveItemFor(name, { name: item.value, qty: Number(qty.value) || 1, kind: kind.value });
    });
    row.append(item, qty, kind, add);
    return row;
}
