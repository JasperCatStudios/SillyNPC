import { DOMPurify } from '../../../../../lib.js';
import { getRegexedString, regex_placement } from '../../../regex/engine.js';
import { getSettings } from './settings.js';
import { trackerBlockHtml } from './bonds-core.js';
import { debugLog } from './constants.js';
import { dressWithTheme } from './tracker-theme-setting.js';

/**
 * The Bond Tracker's section under a reply, like Internal States has (fork).
 *
 * It shows that the tracker ran (updating, failed and why, or what it changed) and writes the
 * result as a BOND TRACKER block of plain lines that the preset's display regexes can dress,
 * the way the Internal States block is. The lines look like:
 *
 *   - <b>Kaito</b> → <b>Mira</b> | AFFECTION: +34 | TRUST: 20 | RESPECT: 15 | LEVEL: Friend (+2 affection)
 *
 * with `| DESIRE: d` before LEVEL while the character's romance is on (regex/SillyNPC-Bond-Bars-*.json
 * match both shapes). With no regex the block still reads as a list.
 */

/** Why the last attempt on a reply failed, and which replies are being read, by "id:swipe". */
const failures = new Map();
const busy = new Set();

export const sectionKey = (messageId, swipeId = 0) => `${messageId}:${swipeId}`;
export function markBusy(key, on) { if (on) { busy.add(key); failures.delete(key); } else busy.delete(key); }
export function markFailure(key, text) { failures.set(key, String(text || 'failed')); }
export function clearFailure(key) { failures.delete(key); }

/** The BOND TRACKER block for one reply. Pure, so it lives in bonds-core.js where node can test it. */
export const bondBlockHtml = trackerBlockHtml;

/** Messages whose block is open for editing, by "id:swipe". */
const editing = new Set();

/** The block as plain lines, one person per line, for the editor. */
function blockToText(html) {
    return String(html || '')
        .replace(/<summary>[\s\S]*?<\/summary>/gi, '')
        .replace(/<\/?details>/gi, '')
        .replace(/<[^>]+>/g, '')
        .split('\n').map(l => l.trim()).filter(Boolean).join('\n');
}

/**
 * Reads the editor's lines back into meter values for the character's side. Lines that do not
 * parse are skipped, so a half-typed line never throws away the rest. LEVEL and notes are ignored:
 * the level follows from the numbers.
 * @returns {{ name: string, affection: number, trust: number, respect: number, desire: number|null }[]}
 */
export function parseTrackerLines(text) {
    const out = [];
    for (const line of String(text || '').split('\n')) {
        const m = /^\s*-?\s*(.+?)\s*(?:→|->)\s*.+?\s*\|\s*AFFECTION:\s*([+-]?\d+)\s*\|\s*TRUST:\s*([+-]?\d+)\s*\|\s*RESPECT:\s*([+-]?\d+)(?:\s*\|\s*DESIRE:\s*([+-]?\d+))?/i.exec(line);
        if (!m) continue;
        out.push({ name: m[1].trim(), affection: Number(m[2]), trust: Number(m[3]), respect: Number(m[4]), desire: m[5] === undefined ? null : Number(m[5]) });
    }
    return out;
}

/**
 * The people whose pending romance suggestion belongs under this reply: the ones it raised, and
 * on the newest reply every pending one, so nothing waiting is out of sight.
 */
export function pendingSuggestions(store, messageId, latest = false) {
    return (store?.people || []).filter(p => p?.suggestion && (latest || p.suggestion.messageId === messageId));
}

/** One compact card: who, why, and the two answers. Text only; nothing from the model becomes HTML. */
function suggestionCard(person, mesEl, ctx) {
    const card = document.createElement('div');
    card.className = 'sillynpc-bond-suggest';
    card.dataset.name = person.name;
    const text = document.createElement('span');
    text.className = 'sillynpc-bond-suggest-text';
    const reason = person.suggestion.reason;
    text.textContent = `${person.name} may be developing feelings${reason ? `: ${reason}` : '.'}`;
    const redraw = () => (ctx.refresh ? ctx.refresh() : drawBondSection(mesEl, ctx));
    const answer = (label, cls, title, fn) => {
        const b = document.createElement('div');
        b.className = `menu_button ${cls}`;
        b.textContent = label;
        b.title = title;
        b.addEventListener('click', (e) => { e.stopPropagation(); try { fn?.(person.name); } finally { redraw(); } });
        return b;
    };
    card.append(
        text,
        answer('Turn romance on', 'sillynpc-bond-suggest-accept', `Switch romance on for ${person.name}'s side. Your own side stays as you set it.`, ctx.onAccept),
        answer('Keep platonic', 'sillynpc-bond-suggest-decline', `Keep it a friendship. ${person.name} is not suggested again for a while (the cooldown in the Bonds tab).`, ctx.onDecline),
    );
    return card;
}

/** The block dressed by the preset's display regexes, then made safe to insert. */
function dress(html) {
    // The plain look is the preset's own regexes; a chosen look is applied by the extension itself.
    const out = dressWithTheme(html, 'bonds', (h) => {
        try {
            return getRegexedString(h, regex_placement.AI_OUTPUT, { isMarkdown: true });
        } catch (err) {
            debugLog('Preset regexes failed on the Bond Tracker block', err);
            return h;
        }
    });
    return DOMPurify.sanitize(out, { ADD_TAGS: ['details', 'summary'] });
}

/**
 * Draws, or removes, the section under one message.
 *
 * @param {Element|null} mesEl
 * @param {{ message: object, id: number, store: object, settings: object, playerName: string,
 *           latest: boolean, redo: () => void }} ctx
 */
export function drawBondSection(mesEl, ctx) {
    if (!mesEl) return;
    mesEl.querySelector(':scope .sillynpc-bond-section:not(.sillynpc-vitals-section):not(.sillynpc-inventory-section)')?.remove();
    const { message, id, store, settings, playerName, latest, redo, onEdit } = ctx;
    if (!settings?.enabled || !getSettings().enabled || settings.timing === 'inline') return;
    if (!message || message.is_user || message.is_system || !store) return;

    const swipeId = message.swipe_id ?? 0;
    const key = sectionKey(id, swipeId);
    const record = store.turns.find(t => t.key === String(id) && t.swipeId === swipeId) || null;
    const isBusy = busy.has(key);
    const failure = failures.get(key) || '';
    const tracked = store.people.some(p => p.tracked);
    // Always on the newest reply, so you can see the tracker is alive; on older ones only when it has something to say.
    if (!record && !isBusy && !failure && !latest) return;

    const section = document.createElement('div');
    section.className = 'sillynpc-bond-section';

    const bar = document.createElement('div');
    bar.className = 'sillynpc-is-bar';
    const title = document.createElement('span');
    title.className = 'sillynpc-is-title';
    title.textContent = 'Bond Tracker';
    const status = document.createElement('span');
    status.className = 'sillynpc-is-status notes';
    if (isBusy) status.textContent = 'updating…';
    else if (failure) status.textContent = `failed: ${failure}`;
    else if (!tracked) status.textContent = 'no one is tracked: switch Track on for a character in the Bonds tab';
    else if (!record) status.textContent = settings.timing === 'manual' ? 'press the refresh button to update' : 'not read yet';
    else status.textContent = record.changes?.length ? '' : 'no change';
    const again = document.createElement('div');
    again.className = 'mes_button fa-solid fa-arrows-rotate';
    again.title = 'Read this reply for bonds again';
    again.addEventListener('click', (e) => { e.stopPropagation(); redo(); });
    const pen = document.createElement('div');
    pen.className = 'mes_button fa-solid fa-pen-to-square';
    pen.title = 'Edit the bond numbers';
    pen.style.display = tracked ? '' : 'none';
    pen.style.marginLeft = 'auto';
    again.style.marginLeft = '0';
    pen.addEventListener('click', (e) => {
        e.stopPropagation();
        editing.add(key);
        (ctx.refresh ? ctx.refresh() : drawBondSection(mesEl, ctx));
    });
    bar.append(title, status, pen, again);
    section.append(bar);

    if (tracked && editing.has(key)) {
        const box = document.createElement('textarea');
        box.className = 'text_pole sillynpc-is-edit';
        box.rows = Math.min(14, Math.max(4, store.people.filter(p => p.tracked).length + 2));
        box.value = blockToText(bondBlockHtml(store, record, settings, playerName));
        const row = document.createElement('div');
        row.className = 'sillynpc-is-edit-row';
        const save = document.createElement('div');
        save.className = 'menu_button';
        save.textContent = 'Save';
        save.title = "Sets the character's Affection, Trust, Respect (and Desire when romance is on) to these numbers";
        save.addEventListener('click', () => {
            try { onEdit?.(parseTrackerLines(box.value)); } finally {
                editing.delete(key);
                (ctx.refresh ? ctx.refresh() : drawBondSection(mesEl, ctx));
            }
        });
        const cancel = document.createElement('div');
        cancel.className = 'menu_button';
        cancel.textContent = 'Cancel';
        cancel.addEventListener('click', () => { editing.delete(key); (ctx.refresh ? ctx.refresh() : drawBondSection(mesEl, ctx)); });
        row.append(save, cancel);
        section.append(box, row);
        const anchorEdit = mesEl.querySelector('.sillynpc-internal-states') || mesEl.querySelector('.sillynpc-status-box') || mesEl.querySelector('.mes_text');
        anchorEdit?.insertAdjacentElement('afterend', section);
        return;
    }

    if (tracked && (record || latest)) {
        const html = bondBlockHtml(store, record, settings, playerName);
        if (html) {
            const body = document.createElement('div');
            // Not "mes_text": SillyTavern's editor does find('.mes_text') and puts its edit box in every match, which
            // left empty copies of it and erased the message when Done was pressed.
            body.className = 'sillynpc-is-body';
            body.innerHTML = dress(html);
            section.append(body);
        }
    }

    for (const person of pendingSuggestions(store, id, latest)) section.append(suggestionCard(person, mesEl, ctx));

    const anchor = mesEl.querySelector('.sillynpc-internal-states') || mesEl.querySelector('.sillynpc-status-box') || mesEl.querySelector('.mes_text');
    anchor?.insertAdjacentElement('afterend', section);
}
