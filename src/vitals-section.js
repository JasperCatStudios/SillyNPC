import { eventSource } from '../../../../events.js';
import { getContext } from '../../../../st-context.js';
import { MESSAGE_RENDERED_EVENT } from './beats.js';
import { DOMPurify } from '../../../../../lib.js';
import { getRegexedString, regex_placement } from '../../../regex/engine.js';
import { getSettings } from './settings.js';
import { debugLog } from './constants.js';
import { vitalsBlockHtml } from './vitals-core.js';
import { vitalsSettings, vitalsStore, latestReplyId, runVitalsUpdate, VITALS_CHANGED_EVENT } from './vitals.js';

/**
 * The Vitals section under a reply (fork), drawn right below the Bond Tracker's section. The
 * block is dressed by the display regexes (regex/Worldkit-Vitals-Bars.json) the same way the
 * bond block is, then made safe to insert. It is never part of the message text.
 */

const busy = new Set();

function dress(html) {
    let out = html;
    if (getSettings().internalStatesApplyRegex !== false) {
        try {
            out = getRegexedString(out, regex_placement.AI_OUTPUT, { isMarkdown: true });
        } catch (err) {
            debugLog('Preset regexes failed on the Vitals block', err);
        }
    }
    return DOMPurify.sanitize(out, { ADD_TAGS: ['details', 'summary'] });
}

/** Draws, or removes, the section under one message. */
export function drawVitalsSection(mesEl) {
    if (!mesEl) return;
    mesEl.querySelector(':scope .sillynpc-vitals-section')?.remove();
    const settings = vitalsSettings();
    if (!settings.enabled || !getSettings().enabled) return;
    const id = Number(mesEl.getAttribute('mesid'));
    const message = getContext()?.chat?.[id];
    const store = vitalsStore();
    if (!message || message.is_user || message.is_system || !store) return;

    const swipeId = message.swipe_id ?? 0;
    const record = store.turns.find(t => t.key === String(id) && t.swipeId === swipeId) || null;
    const latest = id === latestReplyId();
    if (!record && !latest) return;

    const section = document.createElement('div');
    section.className = 'sillynpc-vitals-section sillynpc-bond-section';
    const bar = document.createElement('div');
    bar.className = 'sillynpc-is-bar';
    const title = document.createElement('span');
    title.className = 'sillynpc-is-title';
    title.textContent = 'Vitals';
    const status = document.createElement('span');
    status.className = 'sillynpc-is-status notes';
    status.textContent = busy.has(id) ? 'updating…' : (record ? (record.before && Object.keys(record.before).length ? '' : 'no change') : 'not read yet');
    const again = document.createElement('div');
    again.className = 'mes_button fa-solid fa-arrows-rotate';
    again.title = 'Read this reply for vitals again';
    again.style.marginLeft = 'auto';
    again.addEventListener('click', (e) => {
        e.stopPropagation();
        busy.add(id);
        drawVitalsSection(mesEl);
        runVitalsUpdate(id, { force: true, button: true }).finally(() => { busy.delete(id); drawVitalsSection(mesEl); });
    });
    bar.append(title, status, again);
    section.append(bar);

    const html = vitalsBlockHtml(store, record ? { changes: record.changes || [] } : null, settings);
    if (html) {
        const body = document.createElement('div');
        body.className = 'sillynpc-is-body';
        body.innerHTML = dress(html);
        section.append(body);
    }

    // Under the bond section when there is one, so Status reads after Bonds.
    const anchor = mesEl.querySelector('.sillynpc-bond-section:not(.sillynpc-vitals-section)')
        || mesEl.querySelector('.sillynpc-internal-states')
        || mesEl.querySelector('.sillynpc-status-box')
        || mesEl.querySelector('.mes_text');
    anchor?.insertAdjacentElement('afterend', section);
}

export function redrawVitalsSection(messageId) {
    try { drawVitalsSection(document.querySelector(`#chat .mes[mesid="${messageId}"]`)); } catch (err) { debugLog('Vitals section failed', err); }
}

/** Draws the section on every message as it renders, and again when the vitals change. */
export function initVitalsSection() {
    eventSource.on(MESSAGE_RENDERED_EVENT, (mesEl) => {
        try { drawVitalsSection(mesEl); } catch (err) { debugLog('Vitals section failed', err); }
    });
    eventSource.on(VITALS_CHANGED_EVENT, () => {
        const id = latestReplyId();
        if (id >= 0) redrawVitalsSection(id);
    });
}
