import { DOMPurify } from '../../../../../lib.js';
import { getRegexedString, regex_placement } from '../../../regex/engine.js';
import { getSettings } from './settings.js';
import { levelFor } from './bonds-core.js';
import { debugLog } from './constants.js';

/**
 * The Bond Tracker's section under a reply, like Internal States has (fork).
 *
 * It shows that the tracker ran (updating, failed and why, or what it changed) and writes the
 * result as a BOND TRACKER block of plain lines that the preset's display regexes can dress,
 * the way the Internal States block is. The lines look like:
 *
 *   - <b>Kaito</b> → <b>Mira</b> | AFFECTION: +34 | TRUST: 20 | RESPECT: 15 | LEVEL: Friend (+2 affection)
 *
 * (regex/SillyNPC-Bond-Bars-*.json match that shape.) With no regex the block still reads as a list.
 */

/** Why the last attempt on a reply failed, and which replies are being read, by "id:swipe". */
const failures = new Map();
const busy = new Set();

export const sectionKey = (messageId, swipeId = 0) => `${messageId}:${swipeId}`;
export function markBusy(key, on) { if (on) { busy.add(key); failures.delete(key); } else busy.delete(key); }
export function markFailure(key, text) { failures.set(key, String(text || 'failed')); }
export function clearFailure(key) { failures.delete(key); }

/** The BOND TRACKER block for one reply: every tracked person, with what this reply changed. */
export function bondBlockHtml(store, record, settings, playerName) {
    const people = (store?.people || []).filter(p => p.tracked).slice(0, 12);
    if (!people.length) return '';
    const changes = record?.changes || [];
    const lines = people.map((person) => {
        const edge = person.edges?.toPlayer || {};
        const level = levelFor(person.value, settings.levels)?.name || '';
        const mine = changes.filter(c => c.name === person.name && c.dir !== 'fromPlayer' && Number(c.delta));
        const note = mine.length ? ` (${mine.map(c => `${Number(c.delta) > 0 ? '+' : ''}${c.delta} ${c.meter}`).join(', ')})` : '';
        const a = Math.round(Number(edge.affection) || 0);
        const t = Math.round(Number(edge.trust) || 0);
        const r = Math.round(Number(edge.respect) || 0);
        return `- <b>${person.name}</b> → <b>${playerName}</b> | AFFECTION: ${a < 0 ? '-' : '+'}${Math.abs(a)} | TRUST: ${t < 0 ? '-' : ''}${Math.abs(t)} | RESPECT: ${r < 0 ? '-' : ''}${Math.abs(r)} | LEVEL: ${level}${note}`;
    });
    return `<details><summary>💞 BOND TRACKER</summary>\n${lines.join('\n')}\n</details>`;
}

/** The block dressed by the preset's display regexes, then made safe to insert. */
function dress(html) {
    let out = html;
    if (getSettings().internalStatesApplyRegex !== false) {
        try {
            out = getRegexedString(out, regex_placement.AI_OUTPUT, { isMarkdown: true });
        } catch (err) {
            debugLog('Preset regexes failed on the Bond Tracker block', err);
        }
    }
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
    mesEl.querySelector(':scope .sillynpc-bond-section')?.remove();
    const { message, id, store, settings, playerName, latest, redo } = ctx;
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
    bar.append(title, status, again);
    section.append(bar);

    if (tracked && (record || latest)) {
        const html = bondBlockHtml(store, record, settings, playerName);
        if (html) {
            const body = document.createElement('div');
            body.className = 'sillynpc-is-body mes_text';
            body.innerHTML = dress(html);
            section.append(body);
        }
    }

    const anchor = mesEl.querySelector('.sillynpc-internal-states') || mesEl.querySelector('.sillynpc-status-box') || mesEl.querySelector('.mes_text');
    anchor?.insertAdjacentElement('afterend', section);
}
