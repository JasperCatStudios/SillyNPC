import { getSettings, saveSettings } from './settings.js';
import { factionOf, factionOrder, activeCharacterNames } from '../modules/shim.js';
import { sceneSet } from './scene-cast.js';
import { chatStore } from './bonds.js';
import { FIND_SORTS, cleanSort, findEntries, pushRecent, fold, nameFromLabel } from './character-find-core.js';

/**
 * Finding the character you want to join you (fork): a search box and a sort menu for every list of characters in combat, games and
 * activities. One bar works on whatever character lists are inside the container it is attached to, and keeps working when the screen
 * draws new ones (a team gets another slot), so a screen only has to mark its lists:
 *
 *   select[data-chars]       a dropdown of characters. An option with data-fixed (such as "Play alone") stays put and is never hidden;
 *                            data-name names the character when the option's text has more in it (" (defaults)" is ignored).
 *   [data-chars-list]        a list whose children carry data-name (the table picker's checkboxes).
 *
 * What is chosen is never lost: the selected option of a dropdown and a ticked box stay in the list whatever is typed. The sort is kept
 * as a setting; the words typed are kept for a minute, so a screen that redraws itself does not clear them.
 */

/** A list shorter than this has no use for a search, so the bar stays out of the way. */
export const FINDER_MIN = 4;
const KEEP_QUERY_MS = 60000;
const state = { query: '', at: 0 };

/** What the sorts need to know right now: who is in the scene, how close each bond is, who was picked lately, the faction order. */
export function findContext() {
    const scene = new Set();
    try { for (const n of activeCharacterNames()) scene.add(fold(n)); } catch { /* no chat */ }
    try { for (const n of sceneSet()) scene.add(fold(n)); } catch { /* no scene tracker */ }
    const bond = new Map();
    try { for (const p of chatStore()?.people || []) if (p?.tracked !== false) bond.set(fold(p.name), Number(p.value) || 0); } catch { /* no bonds */ }
    let order = [];
    try { order = factionOrder(); } catch { /* no factions */ }
    return { scene, bond, recent: getSettings().recentJoiners || [], factionOrder: order };
}

/** Notes who was picked, so "Picked lately first" has something to go on. Never throws. */
export function rememberJoiners(names) {
    try {
        const list = (Array.isArray(names) ? names : [names]).filter(Boolean);
        if (!list.length) return;
        const s = getSettings();
        let recent = Array.isArray(s.recentJoiners) ? s.recentJoiners : [];
        for (const n of [...list].reverse()) recent = pushRecent(recent, n);
        s.recentJoiners = recent;
        saveSettings();
    } catch { /* a remembered pick is a nicety */ }
}

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

const optionName = (o) => o.dataset.name || nameFromLabel(o.textContent);

/**
 * Puts the search and sort bar into a container and keeps every marked list in it in step.
 * @param {HTMLElement} container where the lists are (and will be)
 * @param {{ place?: (bar: HTMLElement) => void, min?: number }} [opts] place puts the bar in the page (default: first in the container)
 * @returns {{ bar: HTMLElement, refresh: () => void }}
 */
export function attachCharacterFinder(container, { place, min = FINDER_MIN } = {}) {
    if (Date.now() - state.at > KEEP_QUERY_MS) state.query = '';
    const bar = el('div', 'snpc-find');
    bar.setAttribute('role', 'search');
    const search = el('input', 'text_pole snpc-find-search');
    search.type = 'search';
    search.placeholder = 'Search characters';
    search.setAttribute('aria-label', 'Search characters');
    search.autocomplete = 'off';
    search.value = state.query;
    const sort = el('select', 'text_pole snpc-find-sort');
    sort.setAttribute('aria-label', 'Sort characters');
    sort.title = 'How the characters are ordered';
    for (const [id, label] of FIND_SORTS) sort.append(new Option(label, id));
    sort.value = cleanSort(getSettings().findSort);
    const count = el('span', 'notes snpc-find-count');
    bar.append(search, sort, count);
    if (typeof place === 'function') place(bar); else container.prepend(bar);

    let observer = null;
    let queued = false;

    function applySelect(sel, query, mode, ctx) {
        if (!sel._wkAll) sel._wkAll = [...sel.options];
        const all = sel._wkAll;
        const current = sel.value;
        const entries = all.filter(o => !o.dataset.fixed).map(o => ({ o, name: optionName(o), faction: factionOf(optionName(o)) }));
        const shown = findEntries(entries, query, mode, ctx);
        const keep = entries.find(e => e.o.value === current);
        const list = keep && !shown.includes(keep) ? [keep, ...shown] : shown;
        sel.replaceChildren(...list.map(e => e.o), ...all.filter(o => o.dataset.fixed));
        sel.value = current;
        return { total: entries.length, shown: shown.length };
    }

    function applyList(list, query, mode, ctx) {
        const kids = [...list.children].filter(k => k.dataset?.name !== undefined);
        const entries = kids.map(k => ({ k, name: k.dataset.name, faction: factionOf(k.dataset.name) }));
        const shown = findEntries(entries, query, mode, ctx);
        const hidden = entries.filter(e => !shown.includes(e));
        // A ticked box stays where it can be seen, whatever is typed.
        for (const e of hidden) e.hidden = !e.k.querySelector?.('input:checked');
        const visible = new Set([...shown, ...hidden.filter(e => !e.hidden)]);
        const ordered = [...shown, ...hidden.filter(e => !e.hidden), ...hidden.filter(e => e.hidden)];
        for (const e of entries) e.k.style.display = visible.has(e) ? '' : 'none';
        list.append(...ordered.map(e => e.k));
        return { total: entries.length, shown: visible.size };
    }

    function refresh() {
        const query = search.value;
        const mode = cleanSort(sort.value);
        const ctx = findContext();
        let biggest = 0;
        let shown = 0;
        for (const sel of container.querySelectorAll('select[data-chars]')) {
            const r = applySelect(sel, query, mode, ctx);
            if (r.total > biggest) { biggest = r.total; shown = r.shown; }
        }
        for (const list of container.querySelectorAll('[data-chars-list]')) {
            const r = applyList(list, query, mode, ctx);
            if (r.total > biggest) { biggest = r.total; shown = r.shown; }
        }
        bar.hidden = biggest < min;
        count.textContent = query.trim() && biggest ? `${shown} of ${biggest}` : '';
        // What was just done here is not news to the observer.
        observer?.takeRecords();
    }

    search.addEventListener('input', () => { state.query = search.value; state.at = Date.now(); refresh(); });
    sort.addEventListener('change', () => { getSettings().findSort = cleanSort(sort.value); saveSettings(); refresh(); });

    // Lists the screen draws later (a team gets another slot) are put in order as they appear.
    const isMarked = (n) => n.nodeType === 1 && (n.matches?.('select[data-chars],[data-chars-list]') || n.querySelector?.('select[data-chars],[data-chars-list]'));
    observer = new MutationObserver((records) => {
        // The screen was redrawn and this bar went with it (a newer bar looks after the new lists): stop watching.
        if (!bar.isConnected) { observer.disconnect(); return; }
        let fresh = false;
        for (const r of records) {
            if (r.target?.matches?.('select[data-chars]')) {
                // An option added from outside joins the list the bar keeps for that dropdown.
                for (const n of r.addedNodes) if (n.tagName === 'OPTION' && r.target._wkAll && !r.target._wkAll.includes(n)) r.target._wkAll.push(n);
                fresh = true;
            } else if ([...r.addedNodes].some(isMarked)) fresh = true;
        }
        if (fresh && !queued) { queued = true; Promise.resolve().then(() => { queued = false; refresh(); }); }
    });
    observer.observe(container, { childList: true, subtree: true });

    refresh();
    return { bar, refresh };
}
