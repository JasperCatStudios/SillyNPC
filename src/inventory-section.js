import { eventSource } from '../../../../events.js';
import { getContext } from '../../../../st-context.js';
import { MESSAGE_RENDERED_EVENT } from './beats.js';
import { DOMPurify } from '../../../../../lib.js';
import { getRegexedString, regex_placement } from '../../../regex/engine.js';
import { getSettings } from './settings.js';
import { debugLog } from './constants.js';
import { dressWithTheme } from './tracker-theme-setting.js';
import { inventoryBlockHtml, inventoryToText } from './inventory-core.js';
import { isEditingIn } from './ui-edit-guard.js';
import { inventorySettings, inventoryStore, latestReplyId, runInventoryUpdate, editInventoryText, INVENTORY_CHANGED_EVENT } from './inventory.js';

/**
 * The Inventory section under a reply (fork), drawn right below the Bond Tracker's section. The
 * block is dressed by the chosen look, or by the display regexes (regex/inventory/),
 * then made safe to insert. It is never part of the message text.
 */

const busy = new Set();
/** Replies whose block is open for editing, by "id:swipe". Kept here, not in the page, so a redraw cannot lose it. */
const editing = new Set();
/** What was typed in each open edit box, by "id:swipe", so a redraw puts it back instead of the saved numbers. */
const drafts = new Map();

/** Puts the section under the vitals section when there is one, so the three read Bonds, Vitals, Inventory. */
function place(mesEl, section) {
    const anchor = mesEl.querySelector('.sillynpc-vitals-section')
        || mesEl.querySelector('.sillynpc-bond-section:not(.sillynpc-vitals-section):not(.sillynpc-inventory-section)')
        || mesEl.querySelector('.sillynpc-internal-states')
        || mesEl.querySelector('.sillynpc-status-box')
        || mesEl.querySelector('.mes_text');
    anchor?.insertAdjacentElement('afterend', section);
}

function dress(html) {
    const out = dressWithTheme(html, 'inventory', (h) => {
        try {
            return getRegexedString(h, regex_placement.AI_OUTPUT, { isMarkdown: true });
        } catch (err) {
            debugLog('Preset regexes failed on the Inventory block', err);
            return h;
        }
    });
    return DOMPurify.sanitize(out, { ADD_TAGS: ['details', 'summary'] });
}

/** Draws, or removes, the section under one message. */
export function drawInventorySection(mesEl) {
    if (!mesEl) return;
    mesEl.querySelector(':scope .sillynpc-inventory-section')?.remove();
    const settings = inventorySettings();
    if (!settings.enabled || !getSettings().enabled) return;
    const id = Number(mesEl.getAttribute('mesid'));
    const message = getContext()?.chat?.[id];
    const store = inventoryStore();
    if (!message || message.is_user || message.is_system || !store) return;

    const swipeId = message.swipe_id ?? 0;
    const record = store.turns.find(t => t.key === String(id) && t.swipeId === swipeId) || null;
    const latest = id === latestReplyId();
    if (!record && !latest) return;

    const section = document.createElement('div');
    section.className = 'sillynpc-inventory-section sillynpc-bond-section';
    const bar = document.createElement('div');
    bar.className = 'sillynpc-is-bar';
    const title = document.createElement('span');
    title.className = 'sillynpc-is-title';
    title.textContent = 'Inventory';
    const status = document.createElement('span');
    status.className = 'sillynpc-is-status notes';
    status.textContent = busy.has(id) ? 'updating…' : (record ? (record.before && Object.keys(record.before).length ? '' : 'no change') : 'not read yet');
    const again = document.createElement('div');
    again.className = 'mes_button fa-solid fa-arrows-rotate';
    again.title = 'Read this reply for the inventory again';
    again.style.marginLeft = 'auto';
    again.addEventListener('click', (e) => {
        e.stopPropagation();
        busy.add(id);
        drawInventorySection(mesEl);
        runInventoryUpdate(id, { force: true, button: true }).finally(() => { busy.delete(id); drawInventorySection(mesEl); });
    });
    const key = `${id}:${swipeId}`;
    const tracked = (store.people || []).some(p => p.tracked);
    const pen = document.createElement('div');
    pen.className = 'mes_button fa-solid fa-pen-to-square';
    pen.title = 'Edit the inventory numbers by hand';
    pen.style.display = tracked ? '' : 'none';
    pen.style.marginLeft = 'auto';
    again.style.marginLeft = '0';
    pen.addEventListener('click', (e) => {
        e.stopPropagation();
        editing.add(key);
        drawInventorySection(mesEl);
    });
    bar.append(title, status, pen, again);
    section.append(bar);

    // Editing: a text box of the block's own lines. The editing state is kept in `editing`, not in the page,
    // so a redraw cannot lose it, and the box is not called mes_text (SillyTavern's own editor writes into
    // every .mes_text it finds, which is what once erased a message).
    if (tracked && editing.has(key)) {
        const box = document.createElement('textarea');
        box.className = 'text_pole sillynpc-is-edit';
        box.rows = Math.min(16, Math.max(4, box.value.split('\n').length + 1));
        box.value = drafts.has(key) ? drafts.get(key) : inventoryToText(store, settings);
        box.addEventListener('input', () => drafts.set(key, box.value));
        box.rows = Math.min(16, Math.max(4, box.value.split('\n').length + 1));
        const row = document.createElement('div');
        row.className = 'sillynpc-is-edit-row';
        const save = document.createElement('div');
        save.className = 'menu_button';
        save.textContent = 'Save';
        save.title = 'Sets the recorded numbers to these. Only people already tracked can be changed.';
        save.addEventListener('click', (e) => {
            e.stopPropagation();
            drafts.delete(key);
            try { editInventoryText(box.value); } catch (err) { debugLog('Inventory edit failed', err); } finally {
                editing.delete(key);
                drawInventorySection(mesEl);
            }
        });
        const cancel = document.createElement('div');
        cancel.className = 'menu_button';
        cancel.textContent = 'Cancel';
        cancel.addEventListener('click', (e) => { e.stopPropagation(); editing.delete(key); drafts.delete(key); drawInventorySection(mesEl); });
        row.append(save, cancel);
        section.append(box, row);
        place(mesEl, section);
        return;
    }

    const html = inventoryBlockHtml(store, record ? { changes: record.changes || [] } : null, settings);
    if (html) {
        const body = document.createElement('div');
        body.className = 'sillynpc-is-body';
        body.innerHTML = dress(html);
        section.append(body);
    }

    place(mesEl, section);
}

/** Draws the section again on every reply in the chat (the Look changed, so older ones change too). */
export function redrawAllInventorySections() {
    try { document.querySelectorAll('#chat .mes').forEach(drawInventorySection); } catch (err) { debugLog('Inventory sections failed', err); }
}

export function redrawInventorySection(messageId) {
    try { drawInventorySection(document.querySelector(`#chat .mes[mesid="${messageId}"]`)); } catch (err) { debugLog('Inventory section failed', err); }
}

/** Draws the section on every message as it renders, and again when the vitals change. */
export function initInventorySection() {
    eventSource.on(MESSAGE_RENDERED_EVENT, (mesEl) => {
        try { drawInventorySection(mesEl); } catch (err) { debugLog('Inventory section failed', err); }
    });
    eventSource.on(INVENTORY_CHANGED_EVENT, () => {
        const id = latestReplyId();
        if (id < 0) return;
        // Never redraw under somebody who is typing in the edit box.
        const mes = document.querySelector(`#chat .mes[mesid="${id}"]`);
        if (isEditingIn(mes?.querySelector('.sillynpc-inventory-section'))) return;
        redrawInventorySection(id);
    });
}
