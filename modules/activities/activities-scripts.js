import { getRequestHeaders } from '../../../../../script.js';
import { toBase64 } from '../../src/character-store-core.js';
import { storedNameFor, urlForStored, isLocalScriptUrl, addScript, removeScript, normalizeScripts } from '../../src/activity-scripts-core.js';
import { activitySettings } from './activities-runtime.js';

/**
 * Your own activities (fork): loads the activity scripts a person has added and draws the section where they add them.
 *
 * Adding a script is one click: choose the file, and Worldkit stores a copy in the user's files folder, remembers its address and
 * runs it. The script registers its activity with window.WorldkitActivities.register (see docs/MAKE-AN-ACTIVITY.md). At every
 * start-up the saved scripts are run again. A script that fails is reported next to its name and never stops the others.
 */

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

/** What happened to each script this session: url -> { ok, message }. */
const status = new Map();
const loaded = new Set();

/** Fetches a script's text and runs it as an ordinary page script. Never throws; the outcome is kept in `status`. */
async function runScript(entry) {
    if (loaded.has(entry.url)) return;
    try {
        const response = await fetch(entry.url, { cache: 'no-store' });
        if (!response.ok) throw new Error(`could not be read (HTTP ${response.status})`);
        const code = await response.text();
        await new Promise((resolve, reject) => {
            const blob = new Blob([`${code}\n//# sourceURL=${entry.url}`], { type: 'text/javascript' });
            const tag = document.createElement('script');
            const address = URL.createObjectURL(blob);
            tag.src = address;
            tag.onload = () => { URL.revokeObjectURL(address); tag.remove(); resolve(); };
            tag.onerror = () => { URL.revokeObjectURL(address); tag.remove(); reject(new Error('has a mistake in it and did not run')); };
            document.head.append(tag);
        });
        loaded.add(entry.url);
        status.set(entry.url, { ok: true, message: 'Loaded.' });
    } catch (err) {
        console.warn(`[Worldkit] activity script ${entry.url} failed`, err);
        status.set(entry.url, { ok: false, message: String(err?.message || err) });
    }
}

/** Runs every saved script. Call once the activities module is ready (window.WorldkitActivities exists). */
export async function loadSavedScripts() {
    const list = normalizeScripts(activitySettings().scripts);
    for (const entry of list) await runScript(entry);
}

async function storeFile(name, text) {
    const response = await fetch('/api/files/upload', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({ name, data: toBase64(text) }) });
    if (!response.ok) throw new Error(`the file could not be saved (HTTP ${response.status})`);
}

/** The example activity that ships with Worldkit, as text. */
async function exampleText() {
    const url = new URL('../../docs/examples/quick-cast-activity.js', import.meta.url);
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error('the example file could not be read');
    return response.text();
}

/**
 * Draws the "Your own activities" section into `host`.
 * @param {HTMLElement} host
 * @param {{ changed: () => void }} hooks `changed` saves the settings
 */
export function renderScriptsSection(host, { changed }) {
    const s = activitySettings();
    const box = el('div', 'sillynpc-setting');
    box.append(el('h3', 'sillynpc-section-title', 'Your own activities'));
    box.append(el('p', 'notes', 'What it is for: adding an activity somebody made (or you wrote) as a single .js file. It then appears as a tile on the Activities hub, in the tab the file chose, with the same partner choice, energy and streaks as the built-in ones.'));
    box.append(el('p', 'notes', 'How to use it: press "Add an activity file" and choose the .js file. That is all: Worldkit saves a copy, runs it now, and runs it again every time the page starts. Open the Activities hub afterwards to find the tile. Only add files you trust: an activity file runs like an extension and can do anything one can.'));
    box.append(el('p', 'notes', 'Want to write one? See docs/MAKE-AN-ACTIVITY.md. "Try the example" adds a small ready-made game (Quick Cast) so you can see the whole thing working first.'));

    const list = el('div');
    list.style.cssText = 'display:flex; flex-direction:column; gap:6px; margin:6px 0;';
    const message = el('small', 'notes');
    const say = (t) => { message.textContent = t; };

    const draw = () => {
        list.replaceChildren();
        const scripts = normalizeScripts(s.scripts);
        if (!scripts.length) list.append(el('p', 'notes', 'No activity files added yet.'));
        for (const entry of scripts) {
            const row = el('div', 'sillynpc-setting-row');
            const st = status.get(entry.url);
            const label = el('span', 'sillynpc-setting-label', `${entry.name}${st ? (st.ok ? '  ✓ loaded' : `  ✗ ${st.message}`) : '  (loading...)'}`);
            label.title = entry.url;
            const remove = el('button', 'menu_button', 'Remove');
            remove.type = 'button';
            remove.addEventListener('click', () => {
                s.scripts = removeScript(s.scripts, entry.url);
                loaded.delete(entry.url);
                changed();
                say(`${entry.name} removed. Refresh the page to take its tile off the hub.`);
                draw();
            });
            row.append(label, remove);
            list.append(row);
        }
    };

    const add = async (fileName, text, nameForList) => {
        const stored = storedNameFor(fileName);
        await storeFile(stored, text);
        const entry = { name: nameForList || fileName, url: urlForStored(stored) };
        s.scripts = addScript(s.scripts, entry);
        loaded.delete(entry.url);
        changed();
        await runScript(entry);
        const st = status.get(entry.url);
        say(st?.ok ? `${entry.name} added. Open the Activities hub to see it.` : `${entry.name} was saved but did not run: ${st?.message}`);
        draw();
    };

    const picker = el('input');
    picker.type = 'file';
    picker.accept = '.js,.txt,text/javascript';
    picker.style.display = 'none';
    picker.addEventListener('change', async () => {
        const file = picker.files?.[0];
        picker.value = '';
        if (!file) return;
        say('Adding...');
        try { await add(file.name, await file.text(), file.name); } catch (err) { console.warn('[Worldkit] could not add the activity file', err); say(`Could not add it: ${err?.message || err}`); }
    });
    const addBtn = el('button', 'menu_button', 'Add an activity file');
    addBtn.type = 'button';
    addBtn.addEventListener('click', () => picker.click());
    const exampleBtn = el('button', 'menu_button', 'Try the example');
    exampleBtn.type = 'button';
    exampleBtn.addEventListener('click', async () => {
        say('Adding the example...');
        try { await add('quick-cast-activity.js', await exampleText(), 'Quick Cast (example)'); } catch (err) { console.warn('[Worldkit] could not add the example', err); say(`Could not add the example: ${err?.message || err}`); }
    });

    const row = el('div');
    row.style.cssText = 'display:flex; gap:8px; flex-wrap:wrap; align-items:center;';
    row.append(addBtn, exampleBtn, picker);
    box.append(row, message, list);
    host.append(box);
    draw();
}

export { isLocalScriptUrl };
