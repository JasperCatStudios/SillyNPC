import { getRequestHeaders, saveSettingsDebounced } from '../../../../../script.js';
import { extension_settings } from '../../../../extensions.js';
import { importWorldInfo, deleteWorldInfo, world_names } from '../../../../world-info.js';
import { Popup } from '../../../../popup.js';
import { getSettings, saveSettings } from './settings.js';
import { LOG_PREFIX, PRODUCT_NAME } from './constants.js';
import { parseTransferFile, importCharacters } from './character-transfer.js';
import { deleteCharacter } from './characters.js';
import { mergeItemFile, normalizeItemDatabase } from './item-database.js';
import { parseLocationFile, mergeLocations, removeLocation } from './scene-locations.js';
import { sceneSettings, saveSceneSettings, notifyLocationsChanged } from './scene-state.js';
import { saveItemDatabase } from './inventory.js';
import { parseSoundMap } from './sound-core.js';
import { soundSettings, saveSoundSettings, loadSoundMap } from './sound-runtime.js';
import {
    DEFAULT_KIT_URL, isKitUrl, kitFolderName, kitFileUrl, normalizeCatalog, groupCatalog, scriptsFromFile, mergeRegexScripts,
    formatBytes, githubRepoOf,
} from './content-kit.js';

/**
 * The Content Kit screen: fetches the Worldkit-Content repository with git the way SillyTavern installs an extension
 * (its own /api/extensions/install and /update), then lists what the repository's catalog.json says is in it, with an
 * Import button for each thing. The address is saved in the settings and starts as the official repository.
 *
 * Installing needs the repository to carry a manifest.json, as any SillyTavern extension does; the kit has one that
 * loads nothing, so it shows in SillyTavern's extension list but does nothing there.
 */

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

/** 'unknown' until checked, then 'missing' (not installed), 'ready' (catalog read) or 'broken' (installed, no catalog). */
const state = { status: 'unknown', catalog: null, busy: '', message: '', open: new Set(['world']), remote: null, found: new Map(), scanned: false, scanning: false };

/**
 * What the kit weighs before it is downloaded: GitHub says how big the repository is, and the catalog file in it lists
 * every item with its size. Both are plain reads of public files; a failure only means no preview (Download still works).
 */
async function loadRemote() {
    const url = savedUrl();
    if (state.remote && state.remote.url === url) return;
    const repo = githubRepoOf(url);
    state.remote = { url, status: repo ? 'loading' : 'failed', bytes: 0, catalog: null };
    if (!repo) return;
    try {
        const info = await (await fetch(`https://api.github.com/repos/${repo.owner}/${repo.repo}`)).json();
        state.remote.bytes = Number(info?.size) > 0 ? Number(info.size) * 1024 : 0;
        const branch = String(info?.default_branch || 'main').replace(/[^A-Za-z0-9._/-]/g, '');
        const raw = await fetch(`https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${branch}/catalog.json`, { cache: 'no-store' });
        if (raw.ok) state.remote.catalog = normalizeCatalog(await raw.json());
        state.remote.status = 'ready';
    } catch (err) {
        console.warn(LOG_PREFIX, 'Content Kit size preview failed', err);
        state.remote.status = 'failed';
    }
}

/** The not-yet-downloaded preview: the download size and what is inside, by type, each with its size. */
function renderRemotePreview(view) {
    const r = state.remote;
    if (!r) return;
    if (r.status === 'loading') { view.append(el('p', 'notes', 'Checking how big the download is...')); return; }
    if (r.status !== 'ready') { view.append(el('p', 'notes', 'The download size could not be checked from here. Download still works.')); return; }
    const total = formatBytes(r.bytes);
    view.append(el('p', 'notes', total
        ? `Download size: about ${total}. Download fetches the whole repository with git; the sizes below are what each part weighs.`
        : 'Download fetches the whole repository with git.'));
    if (!r.catalog) return;
    const list = el('ul', 'notes');
    for (const section of groupCatalog(r.catalog)) {
        const count = section.groups.reduce((n, g) => n + g.items.length, 0);
        const size = formatBytes(section.bytes);
        list.append(el('li', '', `${section.label} (${count})${size ? `: ${size}` : ''}`));
    }
    view.append(list);
}

const savedUrl = () => {
    const url = String(getSettings().contentKitUrl || '').trim();
    return url || DEFAULT_KIT_URL;
};
const folder = () => kitFolderName(savedUrl());

async function fetchKitText(file) {
    const response = await fetch(kitFileUrl(folder(), file), { cache: 'no-store' });
    if (!response.ok) throw new Error(`Could not read ${file} from the Content Kit (${response.status}).`);
    return response.text();
}

/** Looks for the installed kit's catalog and records what it found. */
async function check() {
    state.status = 'unknown';
    state.catalog = null;
    try {
        const response = await fetch(kitFileUrl(folder(), 'catalog.json'), { cache: 'no-store' });
        if (response.status === 404) {
            // Not there, or installed without a catalog: the manifest tells which.
            const manifest = await fetch(kitFileUrl(folder(), 'manifest.json'), { cache: 'no-store' });
            state.status = manifest.ok ? 'broken' : 'missing';
            return;
        }
        if (!response.ok) { state.status = 'missing'; return; }
        state.catalog = normalizeCatalog(await response.json());
        state.status = 'ready';
    } catch (err) {
        console.warn(LOG_PREFIX, 'Content Kit check failed', err);
        state.status = 'missing';
    }
}

async function post(path, body) {
    const response = await fetch(path, { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify(body) });
    const text = await response.text();
    return { ok: response.ok, status: response.status, text };
}

async function install() {
    const url = savedUrl();
    if (!isKitUrl(url)) throw new Error('That is not a web address SillyTavern can clone. It looks like https://github.com/owner/repository.git');
    const result = await post('/api/extensions/install', { url, global: false });
    if (result.status === 409) return 'It is already installed. Press Update to get the newest version.';
    if (!result.ok) throw new Error(`The download failed (${result.status}). ${result.text || 'Check the SillyTavern console for the reason.'}`);
    state.scanned = false;
    return 'Downloaded.';
}

async function update() {
    const result = await post('/api/extensions/update', { extensionName: folder(), global: false });
    if (!result.ok) throw new Error(`The update failed (${result.status}). ${result.text || 'Check the SillyTavern console for the reason.'}`);
    let upToDate = false;
    try { upToDate = Boolean(JSON.parse(result.text).isUpToDate); } catch { /* not JSON */ }
    // The pull is done, so SillyTavern's own list must stop saying there is something to pull.
    clearStUpdateBadge();
    state.scanned = false;
    return upToDate ? 'Already up to date.' : 'Updated.';
}

/* ---- importing one thing ------------------------------------------------------------- */

const baseName = (file) => file.split('/').pop();

async function importRegex(item) {
    const scripts = scriptsFromFile(JSON.parse(await fetchKitText(item.file)));
    if (!scripts.length) throw new Error(`${item.name} holds no regex scripts.`);
    const { merged, added, replaced } = mergeRegexScripts(extension_settings.regex, scripts);
    extension_settings.regex = merged;
    saveSettingsDebounced();
    return { added, replaced };
}

/** True when a regex catalog entry's script (matched by name, as the merge does) is already in SillyTavern's list. */
function isRegexInstalled(item) {
    if (item.type !== 'regex') return false;
    const name = String(item.name || '').trim().toLowerCase();
    const list = Array.isArray(extension_settings.regex) ? extension_settings.regex : [];
    return !!name && list.some(s => String(s?.scriptName ?? '').trim().toLowerCase() === name);
}

/** Imports one catalog entry. Returns a short sentence for the toast. */
async function importItem(item) {
    const text = item.type === 'regex' ? '' : await fetchKitText(item.file);
    switch (item.type) {
        case 'world': {
            const { importTypeText } = await import('../modules/combat/type-editor.js');
            await importTypeText(text);
            return '';   // it says what it did itself
        }
        case 'characters': {
            const result = await importCharacters(parseTransferFile(text), { onCollision: async () => 'rename' });
            return `Added ${result.added.length} character${result.added.length === 1 ? '' : 's'}${result.skipped.length ? `, skipped ${result.skipped.length}` : ''}.`;
        }
        case 'lorebook':
            await importWorldInfo(new File([text], baseName(item.file), { type: 'application/json' }));
            return '';   // World Info reports its own result
        case 'items': {
            // Items and presets go into your own part of the Item Database; importing again replaces them in place.
            const { database, added, replaced } = mergeItemFile(getSettings().itemDatabase, JSON.parse(text));
            getSettings().itemDatabase = database;
            saveItemDatabase();                       // saves and tells the Inventory screens to redraw
            return `${added} added, ${replaced} updated. Find them in the Inventory tab, under Item Database.`;
        }
        case 'scenes': {
            // Places go into the one global map; a place already there is kept, so importing twice never makes a copy.
            const places = parseLocationFile(text);
            if (!places) throw new Error(`${item.name} is not a Worldkit location map.`);
            const s = sceneSettings();
            const { added, skipped } = mergeLocations(s.locations, places);
            saveSceneSettings();
            notifyLocationsChanged();
            return `${added} added, ${skipped} already in the map. Find them on the Modules tab, under Scene.`;
        }
        case 'sounds': {
            // The audio stays in the downloaded kit and is played from there; this points the Sound Effects setting at its map.
            const parsed = parseSoundMap(text);
            if (!parsed) throw new Error(`${item.name} is not a Worldkit sound map.`);
            Object.assign(soundSettings(), { enabled: true, mapUrl: kitFileUrl(folder(), item.file) });
            saveSoundSettings();
            await loadSoundMap(true);
            return `${parsed.sounds.size} sounds ready. Sound Effects is switched on (Writing Rules, Sound Effects).`;
        }
        case 'workflow':
            await navigator.clipboard.writeText(text);
            return 'Copied. Paste it into the Phone\'s ComfyUI workflow box.';
        case 'regex': {
            const { added, replaced } = await importRegex(item);
            return `${added} added, ${replaced} updated. They work now; reload SillyTavern to see them in the Regex list.`;
        }
        default:
            return '';
    }
}

/* ---- removing what an import added ---------------------------------------------------- */

/**
 * What one kit item has put into your settings, found by reading its file again and looking for the same names or ids.
 * Null when none of it is there. `remove` takes it out again and returns a sentence for the toast.
 *
 * Matching is by name or id, so a thing of yours that happens to share one is found too; Remove always asks first and
 * lists what it will take.
 */
async function footprint(item) {
    if (item.type === 'regex') {
        if (!isRegexInstalled(item)) return null;
        const name = String(item.name || '').trim().toLowerCase();
        return {
            names: [item.name],
            remove: async () => {
                extension_settings.regex = (extension_settings.regex || []).filter(s => String(s?.scriptName ?? '').trim().toLowerCase() !== name);
                saveSettingsDebounced();
                return 'Removed. Reload SillyTavern to see the Regex list without it.';
            },
        };
    }
    if (item.type === 'sounds') {
        if (soundSettings().mapUrl !== kitFileUrl(folder(), item.file)) return null;
        return {
            names: ['Sound Effects map'],
            remove: async () => {
                Object.assign(soundSettings(), { enabled: false, mapUrl: '' });
                saveSoundSettings();
                await loadSoundMap(true);
                return 'Sound Effects is switched off and no longer points at the kit.';
            },
        };
    }
    if (item.type === 'lorebook') {
        const name = baseName(item.file).replace(/\.json$/i, '');
        if (!Array.isArray(world_names) || !world_names.includes(name)) return null;
        return { names: [name], remove: async () => { await deleteWorldInfo(name); return 'Lorebook deleted.'; } };
    }
    if (!['world', 'characters', 'items', 'scenes'].includes(item.type)) return null;
    const text = await fetchKitText(item.file);
    if (item.type === 'world') {
        const { parseTypeFile } = await import('./combat-types.js');
        const library = getSettings().combatTypes || {};
        const mine = parseTypeFile(text).types.filter(t => t.id in library);
        if (!mine.length) return null;
        return {
            names: mine.map(t => t.name),
            remove: async () => {
                const { deleteCustomType } = await import('../modules/combat/type-editor.js');
                for (const t of mine) deleteCustomType(t.id);
                return `Removed ${mine.length} world type${mine.length === 1 ? '' : 's'}. Characters keep their combat numbers in case you bring it back.`;
            },
        };
    }
    if (item.type === 'characters') {
        const wanted = new Set(parseTransferFile(text).characters.map(c => String(c?.name || '').trim().toLowerCase()).filter(Boolean));
        const mine = (getSettings().characters || []).filter(c => wanted.has(String(c.name || '').trim().toLowerCase()));
        if (!mine.length) return null;
        return {
            names: mine.map(c => c.name),
            remove: async () => {
                for (const c of mine) deleteCharacter(c.id);
                return `Removed ${mine.length} character${mine.length === 1 ? '' : 's'}. Their portrait files stay on disk until you clear portraits (Advanced).`;
            },
        };
    }
    if (item.type === 'items') {
        const file = normalizeItemDatabase(JSON.parse(text));
        const have = normalizeItemDatabase(getSettings().itemDatabase);
        const itemIds = new Set(file.items.map(i => i.id));
        const presetIds = new Set(file.presets.map(p => p.id));
        const items = have.items.filter(i => itemIds.has(i.id));
        const presets = have.presets.filter(p => presetIds.has(p.id));
        if (!items.length && !presets.length) return null;
        return {
            names: [`${items.length} items and ${presets.length} presets`],
            remove: async () => {
                getSettings().itemDatabase = { items: have.items.filter(i => !itemIds.has(i.id)), presets: have.presets.filter(p => !presetIds.has(p.id)) };
                saveItemDatabase();
                return `Removed ${items.length} items and ${presets.length} presets from the Item Database.`;
            },
        };
    }
    // scenes
    const places = parseLocationFile(text) || [];
    const ids = new Set(places.map(p => p.id));
    const s = sceneSettings();
    const mine = s.locations.filter(e => ids.has(e.id));
    if (!mine.length) return null;
    return {
        names: [`${mine.length} places`],
        remove: async () => {
            for (const e of mine) removeLocation(s.locations, e.id);
            saveSceneSettings();
            notifyLocationsChanged();
            return `Removed ${mine.length} places from the Scene map.`;
        },
    };
}

/** Looks at every importable item once and remembers which ones are in your settings; redrawn when it is done. */
async function scanInstalled() {
    state.scanning = true;
    const found = new Map();
    for (const item of state.catalog?.items || []) {
        if (item.type === 'art' || item.type === 'workflow') continue;
        try {
            const f = await footprint(item);
            if (f) found.set(item.file, f);
        } catch (err) {
            console.warn(LOG_PREFIX, `Content Kit could not check ${item.file}`, err);
        }
    }
    state.found = found;
    state.scanned = true;
    state.scanning = false;
}

/** Takes one item's import back out, after saying exactly what goes. */
async function removeItem(item) {
    const f = state.found.get(item.file) || await footprint(item);
    if (!f) { toastr.info('Nothing from this is in your settings.', `${PRODUCT_NAME}: ${item.name}`); return ''; }
    const list = f.names.slice(0, 12).join(', ') + (f.names.length > 12 ? `, and ${f.names.length - 12} more` : '');
    const ok = await Popup.show.confirm(`Remove ${item.name}?`, `This takes out: ${list}. Anything of yours with the same name or id goes too, and edits you made to it are lost.`);
    if (!ok) return '';
    return f.remove();
}

/** Deletes the downloaded repository itself (the folder SillyTavern's own Extensions list shows). Imports stay where they are. */
async function uninstall() {
    const ok = await Popup.show.confirm('Delete the downloaded Content Kit?', 'The folder is removed from this computer. Whatever you imported from it stays in Worldkit; use Remove on each item first if you want that gone too.');
    if (!ok) return '';
    const result = await post('/api/extensions/delete', { extensionName: folder(), global: false });
    if (!result.ok) throw new Error(`The delete failed (${result.status}). ${result.text || 'Check the SillyTavern console for the reason.'}`);
    state.remote = null;
    state.found = new Map();
    state.scanned = false;
    dropStExtensionRow();
    return 'Deleted.';
}

/** SillyTavern's own extension list is not redrawn when we pull, so its "update available" marks are cleared here. */
function clearStUpdateBadge() {
    try {
        for (const block of document.querySelectorAll(`.extension_block[data-name="${CSS.escape(folder())}"]`)) {
            block.querySelector('.btn_update')?.classList.add('displayNone');
            block.querySelector('.extension_name')?.classList.remove('update_available');
        }
    } catch { /* the list is not open; it checks fresh when it is */ }
}

function dropStExtensionRow() {
    try {
        for (const block of document.querySelectorAll(`.extension_block[data-name="${CSS.escape(folder())}"]`)) block.remove();
    } catch { /* not open */ }
}

/* ---- the screen ----------------------------------------------------------------------- */

function button(label, icon, onClick, { title = '', disabled = false } = {}) {
    const b = el('button', 'menu_button');
    b.type = 'button';
    b.innerHTML = `<i class="fa-solid ${icon}"></i> `;
    b.append(document.createTextNode(label));
    b.title = title;
    b.disabled = disabled;
    b.addEventListener('click', onClick);
    return b;
}

function itemRow(item, rerender) {
    const row = el('div', 'sillynpc-setting-row');
    row.style.cssText = 'align-items:flex-start; gap:8px; margin:4px 0;';
    const text = el('div');
    text.style.flex = '1';
    text.append(el('b', '', item.name));
    if (item.size) text.append(el('small', 'notes', ` (${formatBytes(item.size)})`));
    if (item.description) text.append(document.createElement('br'), el('small', 'notes', item.description));
    row.append(text);
    if (item.type === 'art') return row;   // copied by hand; the description says where
    const copies = item.type === 'workflow';
    const mark = state.found.get(item.file) || (isRegexInstalled(item) ? {} : null);
    const installed = Boolean(mark);
    if (installed) text.append(document.createElement('br'), el('small', 'notes', 'Installed. Pressing Update refreshes it in place; it is never added twice.'));
    const verb = copies ? 'Copy' : (installed ? 'Update' : 'Import');
    const buttons = el('div');
    buttons.style.cssText = 'display:flex; gap:6px; flex-wrap:wrap;';
    buttons.append(button(verb, copies ? 'fa-copy' : (installed ? 'fa-rotate' : 'fa-file-import'), async () => {
        state.busy = item.file;
        try {
            const sentence = await importItem(item);
            // Said out loud on purpose: it is the only proof that the import went through.
            if (sentence) toastr.success(sentence, `${PRODUCT_NAME}: ${item.name}`);
        } catch (err) {
            console.error(LOG_PREFIX, 'Content Kit import failed', err);
            toastr.error(String(err.message || err), `${PRODUCT_NAME}: ${item.name}`);
        } finally {
            state.busy = '';
            state.scanned = false;
            rerender();
        }
    }, { disabled: state.busy === item.file }));
    if (installed) {
        buttons.append(button('Remove', 'fa-trash', async () => {
            state.busy = item.file;
            try {
                const sentence = await removeItem(item);
                if (sentence) toastr.success(sentence, `${PRODUCT_NAME}: ${item.name}`);
            } catch (err) {
                console.error(LOG_PREFIX, 'Content Kit remove failed', err);
                toastr.error(String(err.message || err), `${PRODUCT_NAME}: ${item.name}`);
            } finally {
                state.busy = '';
                state.scanned = false;
                rerender();
            }
        }, { title: 'Take what this import added back out of Worldkit', disabled: state.busy === item.file }));
    }
    row.append(buttons);
    return row;
}

function renderCatalog(view, rerender) {
    const sections = groupCatalog(state.catalog);
    if (!sections.length) { view.append(el('p', 'notes', 'The catalog is empty.')); return; }
    for (const section of sections) {
        const details = el('details', 'sillynpc-prompt-group');
        // Kept across redraws: an import redraws the screen, and a section you had opened must not fold shut under you.
        details.open = state.open.has(section.type);
        details.addEventListener('toggle', () => { if (details.open) state.open.add(section.type); else state.open.delete(section.type); });
        const count = section.groups.reduce((n, g) => n + g.items.length, 0);
        details.append(el('summary', '', `${section.label} (${count})${section.bytes ? ' - ' + formatBytes(section.bytes) : ''}`));
        for (const group of section.groups) {
            if (group.name) {
                const head = el('div', 'sillynpc-setting-row');
                head.style.cssText = 'margin-top:8px; align-items:center;';
                head.append(el('b', '', group.name));
                if (group.bytes) head.append(el('small', 'notes', ` (${formatBytes(group.bytes)})`));
                if (section.type === 'regex' && group.items.length > 1) {
                    const allIn = group.items.every(isRegexInstalled);
                    head.append(button(allIn ? `Update all ${group.items.length}` : `Import all ${group.items.length}`, allIn ? 'fa-rotate' : 'fa-file-import', async () => {
                        let added = 0; let replaced = 0;
                        try {
                            for (const item of group.items) { const r = await importRegex(item); added += r.added; replaced += r.replaced; }
                            toastr.success(`${added} added, ${replaced} updated. They work now; reload SillyTavern to see them in the Regex list.`, `${PRODUCT_NAME}: ${group.name}`);
                        } catch (err) {
                            toastr.error(String(err.message || err), `${PRODUCT_NAME}: ${group.name}`);
                        } finally {
                            rerender();
                        }
                    }, { title: 'Import every script in this group' }));
                }
                details.append(head);
            }
            for (const item of group.items) details.append(itemRow(item, rerender));
        }
        view.append(details);
    }
}

export function renderContentKitView(view) {
    if (!view) return;
    // The page stays where it was: an import redraws it, and it must not jump back to the top.
    const scroll = view.closest('.sillynpc-tab-panel')?.scrollTop ?? 0;
    view.replaceChildren();
    view.classList.add('snpc-content-kit');
    const rerender = () => renderContentKitView(view);

    view.append(el('h3', 'sillynpc-section-title', 'Content Kit'));
    view.append(el('p', 'notes sillynpc-tab-intro',
        'Optional extras made for Worldkit: a sample world, character packs, a lorebook, regex scripts that dress the trackers, '
        + 'and workflows for the Phone\'s pictures. Press Download and SillyTavern fetches them with git, the same way Extensions, '
        + 'Install extension does. Nothing is imported until you press Import on it, and nothing is removed until you press Remove on it.'));

    // The address, saved as it is typed.
    const wrap = el('div', 'sillynpc-setting');
    const row = el('div', 'sillynpc-setting-row');
    row.append(el('label', 'sillynpc-setting-label', 'Git address'));
    const field = el('input', 'text_pole');
    field.type = 'text';
    field.value = savedUrl();
    field.spellcheck = false;
    field.addEventListener('input', () => { getSettings().contentKitUrl = field.value.trim(); saveSettings(); });
    // A changed address means a different folder, so look again once the box is left.
    field.addEventListener('change', async () => { await check(); rerender(); });
    row.append(field);
    row.append(button('Reset', 'fa-rotate-left', async () => {
        getSettings().contentKitUrl = DEFAULT_KIT_URL;
        saveSettings();
        await check();
        rerender();
    }, { title: 'Use the official Worldkit-Content address again' }));
    wrap.append(row, el('small', 'notes', `Saved for you: ${DEFAULT_KIT_URL}`));
    view.append(wrap);

    const statusLine = el('p', 'notes');
    const actions = el('div');
    actions.style.cssText = 'display:flex; gap:8px; flex-wrap:wrap; margin:8px 0;';
    const run = (label, fn) => async () => {
        state.busy = label;
        state.message = '';
        rerender();
        try {
            state.message = await fn();
            await check();
            if (state.message) toastr.success(state.message, PRODUCT_NAME);
        } catch (err) {
            console.error(LOG_PREFIX, `Content Kit ${label} failed`, err);
            state.message = String(err.message || err);
            toastr.error(state.message, PRODUCT_NAME);
        } finally {
            state.busy = '';
            rerender();
        }
    };
    const working = Boolean(state.busy) && ['download', 'update'].includes(state.busy);
    if (state.status === 'unknown') statusLine.textContent = 'Checking...';
    else if (state.status === 'ready') statusLine.textContent = 'Downloaded. Choose what to import below.';
    else if (state.status === 'broken') statusLine.textContent = 'It is downloaded but has no catalog.json, so there is nothing to list. Press Update to get the newest version.';
    else statusLine.textContent = 'Not downloaded yet.';
    if (working) statusLine.textContent = state.busy === 'download' ? 'Downloading...' : 'Updating...';
    if (state.message) statusLine.textContent += ` ${state.message}`;
    view.append(statusLine);

    if (state.status === 'missing' || state.status === 'unknown') {
        actions.append(button('Download', 'fa-cloud-arrow-down', run('download', install), { disabled: working, title: 'Clone the repository with git' }));
    }
    if (state.status === 'ready' || state.status === 'broken') {
        actions.append(button('Update', 'fa-rotate', run('update', update), { disabled: working, title: 'Pull the newest version' }));
    }
    actions.append(button('Check again', 'fa-magnifying-glass', async () => { state.scanned = false; await check(); rerender(); }, { disabled: working }));
    if (state.status === 'ready' || state.status === 'broken') {
        actions.append(button('Delete download', 'fa-trash', run('delete', uninstall), { disabled: working, title: 'Remove the downloaded folder from this computer. Imports stay until you Remove them.' }));
    }
    view.append(actions);

    if (state.status === 'missing') {
        if (!state.remote || state.remote.url !== savedUrl()) loadRemote().finally(() => { if (view.isConnected) rerender(); });
        renderRemotePreview(view);
    }
    if (state.status === 'ready' && state.catalog) {
        renderCatalog(view, rerender);
        // Which items are already in your settings is read in the background, then the list is drawn again with Remove buttons.
        if (!state.scanned && !state.scanning) scanInstalled().finally(() => { if (view.isConnected) rerender(); });
    }

    const panel = view.closest('.sillynpc-tab-panel');
    if (panel) panel.scrollTop = scroll;

    // The first time the screen opens it looks for the kit by itself.
    if (state.status === 'unknown' && !state.busy && view.isConnected) {
        state.busy = 'check';
        check().finally(() => { state.busy = ''; if (view.isConnected) rerender(); });
    }
}
