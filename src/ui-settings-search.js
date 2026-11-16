import { getSettings } from './settings.js';

/**
 * Finding a setting without knowing which page it is on.
 *
 * Eighty-one of them across ten pages. Knowing what you want to change is the easy part;
 * remembering whether it lives under Tracker or Writing Rules is not, and reorganising the
 * menu - however much better the new arrangement is - moved every one of them at least
 * once.
 *
 * The index is built by drawing each page into a container that is never shown and reading
 * back what appeared, rather than from a list written by hand beside the real one. A hand
 * list is the same setting described twice, and the two disagree the first time anybody
 * adds a control without noticing there was a second place to add it.
 */

/** A control's own label, taken from the wrap that carries its key. */
function labelWithin(wrap) {
    for (const el of walk(wrap)) {
        const cls = String(el?.className || '');
        // Most controls name themselves on a label; a text area does it on the row.
        if (cls.includes('sillynpc-setting-label') || cls === 'sillynpc-setting-row') {
            const text = String(el.textContent || '').trim();
            if (text) return text;
        }
    }
    return '';
}

/** Every element under one, itself included. */
function* walk(node) {
    if (!node || typeof node !== 'object') return;
    yield node;
    for (const kid of node.children || []) yield* walk(kid);
}

/** The explanatory note under a control, so a search can match what a setting does and not only its name. */
function helpWithin(wrap) {
    for (const el of walk(wrap)) {
        const cls = String(el?.className || '');
        if (typeof el.tagName === 'string' && /^small$/i.test(el.tagName) && cls.includes('notes')) {
            const text = String(el.textContent || '').trim();
            if (text) return text.slice(0, 400);
        }
    }
    return '';
}

/**
 * What is on each page, as a flat list.
 *
 * @param {Array<{ id: string, label: string, render: (view: HTMLElement) => void }>} tabs
 * @returns {Array<{ key: string, label: string, tab: string, tabLabel: string, advanced: boolean }>}
 */
/** What counts as the name of something: a control's label, a heading, a sub-tab. */
export const LABEL_SELECTOR = '.sillynpc-setting-label, label, h3, h4, h5, summary, legend, .sillynpc-section-title, .sillynpc-combat-heading, .sillynpc-subtab, .sillynpc-charview-tab';
const NAV_SELECTOR = '.sillynpc-subtab, .sillynpc-charview-tab';

/** An element's own words: no option lists, no inputs, no notes, no icons. */
export function ownText(el) {
    const copy = el.cloneNode(true);
    copy.querySelectorAll('select, input, textarea, option, small, button, i, svg').forEach(n => n.remove());
    return String(copy.textContent || '').replace(/\s+/g, ' ').trim();
}

/** The sub-tab a pane's content belongs to ("Phone", "Combat", "Bonds"), from where it sits. */
function subOf(root, el) {
    const pane = el.closest?.('.sillynpc-subpane');
    if (!pane) return '';
    const panes = [...root.querySelectorAll('.sillynpc-subpane')];
    const tabs = [...root.querySelectorAll('.sillynpc-subtab')];
    const at = panes.indexOf(pane);
    return at >= 0 && tabs[at] ? ownText(tabs[at]) : '';
}

/**
 * Every named thing under a root: not only controls that carry a data-setting key but every label,
 * heading and sub-tab, so a setting built by hand, a section or a module is found as well.
 *
 * @param {Element} root
 * @param {{ tab: string, tabLabel: string, sub?: string }} where
 * @param {Array<object>} found
 * @param {Set<string>} seen
 */
export function collectNames(root, where, found, seen) {
    for (const el of root.querySelectorAll(LABEL_SELECTOR)) {
        const text = ownText(el);
        if (text.length < 3 || text.length > 90) continue;
        const sub = where.sub || subOf(root, el);
        const id = `${where.tab}|${sub}|${text.toLowerCase()}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const nav = el.matches?.(NAV_SELECTOR);
        const wrap = el.closest?.('.sillynpc-setting, .sillynpc-setting-row') || el.parentElement;
        const note = wrap?.querySelector?.('small.notes');
        found.push({
            key: '',
            label: text,
            tab: where.tab,
            tabLabel: nav ? (where.tab === 'modules' ? 'Module' : 'Section') : where.tabLabel,
            sub: nav ? text : sub,
            advanced: Boolean(el.closest?.('[data-advanced="true"]')),
            help: note ? String(note.textContent || '').trim().slice(0, 400) : '',
            nav,
        });
    }
}

export function buildSettingsIndex(tabs, extraRoots = () => []) {
    const found = [];
    const seen = new Set();

    for (const tab of tabs) {
        // Some controls are only drawn while another is on (the HUD's size while the HUD is on).
        // They are still settings someone may be looking for, so the page is drawn once with those
        // switches on, in memory only, and put back straight afterwards.
        const gates = [];
        for (const path of tab.forceOn || []) {
            const parts = path.split('.');
            let holder = getSettings();
            for (const part of parts.slice(0, -1)) holder = holder?.[part];
            if (holder && typeof holder === 'object') { gates.push([holder, parts[parts.length - 1], holder[parts[parts.length - 1]]]); holder[parts[parts.length - 1]] = true; }
        }
        try {
        // The page itself, so "connection" finds the Connections page and not only controls on it.
        found.push({ key: '', label: tab.label, tab: tab.id, tabLabel: 'Page', advanced: false, page: true, help: '' });
        const view = document.createElement('div');
        try {
            tab.render(view);
        } catch {
            // A page that cannot be drawn offscreen is one the search cannot list. Better
            // a shorter list than no search at all.
            continue;
        }

        for (const el of walk(view)) {
            const key = el?.dataset?.setting;
            if (!key || seen.has(key)) continue;
            seen.add(key);
            const label = labelWithin(el) || key;
            // Own words only: a row's text also carries its option list.
            const own = (() => { for (const n of walk(el)) if (String(n?.className || '').includes('sillynpc-setting-label')) return ownText(n); return ''; })();
            const name = own || label;
            seen.add(`${tab.id}||${name.toLowerCase()}`);
            found.push({
                key,
                label: name.length > 90 ? key : name,
                tab: tab.id,
                tabLabel: tab.label,
                sub: subOf(view, el),
                advanced: el.dataset?.advanced === 'true',
                help: helpWithin(el),
            });
        }
        collectNames(view, { tab: tab.id, tabLabel: tab.label }, found, seen);

        // Other views of the same page (the Tracker page also holds Bonds and Vitals).
        for (const extra of tab.extras || []) {
            const sub = document.createElement('div');
            try { extra.render(sub); } catch { continue; }
            collectNames(sub, { tab: tab.id, tabLabel: tab.label, sub: extra.sub }, found, seen);
            found.push({ key: '', label: extra.sub, tab: tab.id, tabLabel: 'Section', sub: extra.sub, advanced: false, help: extra.hint || '', nav: true });
        }
        } finally {
            for (const [holder, name, was] of gates) holder[name] = was;
        }
    }

    // Panels that are not drawn with the page: a module's own settings (Phone, Games, Combat).
    for (const extra of extraRoots()) {
        collectNames(extra.root, { tab: extra.tab, tabLabel: extra.tabLabel, sub: extra.sub }, found, seen);
    }

    return found;
}

/**
 * The entries worth offering for what has been typed.
 *
 * Matched on the label first and the key second: you search for what the control is
 * called, but the key is what a bug report or a comment names it by.
 *
 * A setting hidden behind dev mode is left out while dev mode is off. Offering to jump to
 * a control that is not on the page would be worse than not finding it.
 *
 * @param {Array<object>} index From buildSettingsIndex.
 * @param {string} query
 * @param {{ limit?: number, devMode?: boolean }} [options]
 */
export function searchSettings(index, query, { limit = 14, devMode } = {}) {
    const needle = String(query ?? '').trim().toLowerCase();
    if (needle.length < 2) return [];

    void devMode;   // advanced settings are offered too, marked, and picking one switches "Show Every Setting" on

    // Every typed word has to appear somewhere in the label, the page name, the key or the note
    // under the control, so "hud scale" and "connection profile" find what they mean.
    const words = needle.split(/\s+/).filter(Boolean);
    const scored = [];
    for (const entry of index) {
        const label = entry.label.toLowerCase();
        const key = String(entry.key || '').toLowerCase();
        const page = `${entry.tabLabel || ''} ${entry.sub || ''}`.toLowerCase();
        const help = String(entry.help || '').toLowerCase();
        // A label starting with what you typed is what you meant more often than one
        // merely containing it, so it goes first.
        if (entry.nav && (label === needle || label.startsWith(needle))) scored.push([-1, entry]);
        else if (label.startsWith(needle)) scored.push([0, entry]);
        else if (label.includes(needle)) scored.push([1, entry]);
        else if (key.includes(needle)) scored.push([2, entry]);
        else if (words.every(w => label.includes(w) || key.includes(w) || page.includes(w))) scored.push([3, entry]);
        else if (words.every(w => label.includes(w) || key.includes(w) || page.includes(w) || help.includes(w))) scored.push([4, entry]);
    }

    const shown = new Set();
    return scored
        .sort((a, b) => a[0] - b[0] || a[1].label.localeCompare(b[1].label))
        .filter(([, entry]) => {
            const id = `${entry.tab}|${entry.sub || ''}|${String(entry.label).toLowerCase()}`;
            if (shown.has(id)) return false;
            shown.add(id);
            return true;
        })
        .slice(0, limit)
        .map(([, entry]) => entry);
}

/**
 * The box, and the list of answers under it.
 *
 * @param {object} options
 * @param {() => Array<object>} options.index Built lazily: drawing ten pages to answer a
 *   search nobody has typed yet is work for nothing.
 * @param {(entry: object) => void} options.onPick
 * @returns {HTMLElement}
 */
export function buildSettingsSearch({ index, onPick }) {
    const wrap = document.createElement('div');
    wrap.className = 'sillynpc-settings-search';

    const input = document.createElement('input');
    input.type = 'search';
    input.className = 'text_pole sillynpc-settings-search-input';
    input.placeholder = 'Search all settings…';
    input.title = 'Searches every page and setting by name and by what the setting does.';

    const results = document.createElement('div');
    results.className = 'sillynpc-settings-search-results';
    results.style.display = 'none';

    let cached = null;

    const close = () => { results.replaceChildren(); results.style.display = 'none'; };

    const run = () => {
        const query = input.value;
        if (String(query ?? '').trim().length < 2) { close(); return; }

        if (!cached) cached = index();
        const hits = searchSettings(cached, query);

        results.replaceChildren();
        if (!hits.length) {
            const none = document.createElement('div');
            none.className = 'sillynpc-settings-search-none notes';
            none.textContent = 'No setting or page by that name.';
            results.append(none);
        }

        for (const entry of hits) {
            const hit = document.createElement('button');
            hit.type = 'button';
            hit.className = 'sillynpc-settings-search-hit';

            const label = document.createElement('span');
            label.className = 'sillynpc-settings-search-label';
            label.textContent = entry.label;

            // Which page, because half of what makes this useful is learning where things
            // are rather than being taken there blind every time.
            const where = document.createElement('span');
            where.className = 'sillynpc-settings-search-where';
            const place = entry.sub && !entry.nav ? `${entry.tabLabel} › ${entry.sub}` : entry.tabLabel;
            where.textContent = entry.advanced && !getSettings().devMode ? `${place} · advanced` : place;

            hit.append(label, where);
            hit.addEventListener('click', () => { close(); input.value = ''; onPick(entry); });
            results.append(hit);
        }
        results.style.display = '';
    };

    input.addEventListener('input', run);
    input.addEventListener('search', run);
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { input.value = ''; close(); } });

    wrap.append(input, results);
    return wrap;
}
