import { eventSource } from '../../../../events.js';
import { Popup } from '../../../../popup.js';
import { saveSettings } from './settings.js';
import { buildSettingToggle, buildSettingNumber, buildSettingSlider, buildSettingSelect } from './ui-shared.js';
import { VECTOR_MODULES, VECTOR_DEFAULTS, INJECT_ROLES } from './vector-core.js';
import { vectorSettings, currentSource, testConnection } from './vector-service.js';
import {
    panelData, syncModule, purgeModule, setEntry, deleteEntry, overview, phoneContacts, VECTORS_CHANGED_EVENT,
} from './vectors.js';

/**
 * Vectors panels (fork): one shared panel every module mounts under its own settings, and the
 * core Vectors tab with the global settings and an overview.
 *
 * Everything here is a view over vectors.js; nothing in it decides what is embedded or sent.
 */

const PAGE = 25;
/*
 * Every write says so: a switch flipped in one place (the Vectors tab, a module's panel) must
 * redraw the badges of the others, or a panel keeps saying "off" after it was switched on.
 */
const announce = () => { try { eventSource.emit(VECTORS_CHANGED_EVENT); } catch { /* not ready */ } };
const STORE = { get: () => vectorSettings(), save: () => { saveSettings(); announce(); }, defaults: VECTOR_DEFAULTS };

const STATE_LABELS = {
    done: ['Vectorized', 'fa-check'],
    pending: ['Pending', 'fa-hourglass-half'],
    stale: ['Stale', 'fa-rotate'],
    off: ['Off', 'fa-ban'],
    error: ['Error', 'fa-triangle-exclamation'],
    skip: ['Skipped', 'fa-forward'],
    deleted: ['Deleted', 'fa-trash'],
};

const HOW_DELETE = {
    rivalry: 'Deletes the record from the rivalry history too.',
    phone: 'Takes these texts out of the vectors only; the phone keeps them.',
    games: 'Deletes this game\'s table talk from the chat\'s log too.',
    combat: 'Deletes this fight\'s table talk from the chat\'s log too.',
};

const MODULE_HELP = {
    rivalry: 'Picks which records fill each opponent\'s history slots, instead of only the most recent.',
    phone: 'Adds older texts from the same thread that match what is being said, beyond the messages the phone already re-reads. Needs the Phone module itself to be on.',
    games: 'Keeps what was said at the games table, per chat, and puts the games that match the scene into the story prompt.',
    combat: 'Keeps what was said during fights, per chat, and puts the fights that match the scene into the story prompt.',
};

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

const button = (label, icon, title, onClick, extra = '') => {
    const b = el('button', `menu_button snpc-vec-btn ${extra}`.trim());
    b.type = 'button';
    if (icon) b.append(el('i', `fa-solid ${icon}`));
    if (label) b.append(el('span', '', label));
    if (title) b.title = title;
    b.addEventListener('click', (e) => { e.preventDefault(); onClick(e); });
    return b;
};

const iconButton = (icon, title, onClick, extra = '') => {
    const b = el('div', `menu_button menu_button_icon snpc-vec-icon fa-solid ${icon} ${extra}`.trim());
    b.title = title;
    b.tabIndex = 0;
    b.setAttribute('role', 'button');
    b.addEventListener('click', (e) => { e.preventDefault(); onClick(e); });
    b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(e); } });
    return b;
};

function loadStylesheet() {
    if (document.getElementById('sillynpc-vectors-css')) return;
    const link = document.createElement('link');
    link.id = 'sillynpc-vectors-css';
    link.rel = 'stylesheet';
    link.href = new URL('./vectors.css', import.meta.url).href;
    document.head.append(link);
}

/** Every mounted panel, redrawn when the vectors change unless the user is typing in it. */
const mounted = new Set();
let listening = false;
function listen() {
    if (listening) return;
    listening = true;
    eventSource.on(VECTORS_CHANGED_EVENT, () => {
        for (const p of [...mounted]) {
            if (!p.host.isConnected) { mounted.delete(p); continue; }
            if (p.busy || p.host.contains(document.activeElement) && document.activeElement?.tagName !== 'BUTTON') continue;
            p.render();
        }
    });
    // The Phone module's own switch changes what the phone panel's badge says.
    document.addEventListener('change', (e) => {
        if (e.target?.id !== 'rph-enabled') return;
        // After the phone's own handler has saved the new value.
        setTimeout(announce, 0);
    });
}

function statusText(status) {
    const parts = [`${status.vectorized} of ${status.total} vectorized`];
    if (status.stale) parts.push(`${status.stale} stale`);
    if (status.pending) parts.push(`${status.pending} pending`);
    if (status.disabled) parts.push(`${status.disabled} off`);
    if (status.skipped) parts.push(`${status.skipped} skipped`);
    if (status.errors) parts.push(`${status.errors} failed`);
    if (status.deleted) parts.push(`${status.deleted} deleted`);
    return parts.join(' · ');
}

/* ---- the per-module panel ------------------------------------------------------------ */

/** The badge's text: the status when on, and why when off. */
export function badgeText(data) {
    if (!data?.on) return data?.badge?.text || 'off';
    return data.scopeNeeded ? 'on' : statusText(data.status);
}

/**
 * Mounts the Vectors panel for one module into host. Safe to call again on the same host.
 *
 * @param {HTMLElement} host
 * @param {'rivalry'|'phone'|'games'|'combat'} moduleId
 */
export function mountVectorPanel(host, moduleId) {
    if (!host || !VECTOR_MODULES[moduleId]) return;
    loadStylesheet();
    listen();
    for (const p of mounted) if (p.host === host) mounted.delete(p);
    const panel = {
        host,
        moduleId,
        scope: moduleId === 'phone' ? (phoneContacts()[0] || '') : '',
        page: 0,
        filter: 'all',
        showDeleted: false,
        open: new Set(),
        busy: false,
        render: () => renderPanel(panel),
    };
    mounted.add(panel);
    panel.render();
}

function renderPanel(p) {
    const { host, moduleId } = p;
    const meta = VECTOR_MODULES[moduleId];
    host.replaceChildren();
    host.classList.add('snpc-vec');

    const details = el('details', 'snpc-vec-box');
    details.open = Boolean(p.expanded);
    details.addEventListener('toggle', () => { p.expanded = details.open; });
    const summary = el('summary', 'snpc-vec-summary');
    summary.append(el('i', 'fa-solid fa-diagram-project'), el('span', 'snpc-vec-title', `Vectors: ${meta.label}`));
    const data = panelData(moduleId, p.scope);
    const badge = el('span', `snpc-vec-badge${data.on ? '' : ' is-off'}`, badgeText(data));
    if (!data.on) badge.title = data.badge?.reason === 'module switch is off'
        ? `Switch on "Use Vectors For ${meta.label}" inside this panel or in the Vectors tab.`
        : data.badge?.reason === 'the Phone module is off'
            ? 'Switch the Phone module on under Modules > Phone; while it is off nothing of it is vectorized.'
            : 'The master switch "Use Vectors" in the SillyNPC menu, Vectors tab, is off.';
    summary.append(badge);
    details.append(summary);
    host.append(details);
    if (!details.open) return;

    const body = el('div', 'snpc-vec-body');
    details.append(body);
    body.append(el('p', 'notes', `Finds the ${meta.noun}s most related to the last few messages, so the right ones reach the prompt instead of only the newest. `
        + 'Embedded by your own Ollama through SillyTavern; nothing leaves your machines.'));

    if (!data.master) {
        body.append(el('p', 'notes snpc-vec-warn', 'Vectors are off for SillyNPC. Turn them on in the SillyNPC menu, Vectors tab ("Use Vectors"). Until then this changes nothing.'));
    } else if (data.badge?.reason === 'the Phone module is off') {
        body.append(el('p', 'notes snpc-vec-warn', 'The Phone module is off, so nothing of the phone is vectorized, searched or sent. Switch it on under Modules > Phone.'));
    }

    body.append(buildSettingToggle({
        store: STORE,
        key: `modules.${moduleId}.enabled`,
        label: `Use Vectors For ${meta.label}`,
        help: MODULE_HELP[moduleId],
        onChange: p.render,
    }));
    if (moduleId === 'games' || moduleId === 'combat') {
        body.append(buildSettingNumber({
            store: STORE, key: `modules.${moduleId}.recall`, label: `${moduleId === 'games' ? 'Games' : 'Fights'} Recalled`, suffix: moduleId === 'games' ? 'games' : 'fights',
            help: '1 to 6. How many related ones go into the story prompt; depth and role are in the Vectors tab.', onChange: p.render,
        }));
    }
    if (moduleId === 'phone') {
        body.append(buildSettingNumber({ store: STORE, key: 'modules.phone.recall', label: 'Older Chunks Recalled', suffix: 'chunks', help: '1 to 8.', onChange: p.render }));
        body.append(buildSettingNumber({ store: STORE, key: 'modules.phone.chunkSize', label: 'Messages Per Chunk', suffix: 'messages', advanced: true, help: '2 to 12. Changing it re-chunks threads that are vectorized again.', onChange: p.render }));
        const contacts = phoneContacts();
        const row = el('div', 'snpc-vec-toolbar');
        row.append(el('label', 'snpc-vec-label', 'Contact'));
        const sel = el('select', 'text_pole');
        if (!contacts.length) sel.append(new Option('No threads yet', ''));
        for (const c of contacts) sel.append(new Option(c, c));
        sel.value = p.scope;
        sel.addEventListener('change', () => { p.scope = sel.value; p.page = 0; p.render(); });
        row.append(sel);
        body.append(row);
        if (!p.scope) return;
    }

    if (moduleId !== 'phone' && !data.collection) {
        body.append(el('p', 'notes', 'Open a chat to see its vectors.'));
        return;
    }

    // Status line.
    const status = el('div', 'snpc-vec-status');
    status.append(el('span', '', statusText(data.status)));
    if (data.lastSync) status.append(el('span', 'snpc-vec-muted', `last sync ${new Date(data.lastSync).toLocaleTimeString()}`));
    body.append(status);
    if (data.status.lastError) body.append(el('p', 'notes snpc-vec-error', `Last error: ${data.status.lastError}`));

    // Actions.
    const bar = el('div', 'snpc-vec-toolbar');
    const progress = el('span', 'snpc-vec-muted snpc-vec-progress');
    const run = (mode, label) => async () => {
        if (p.busy) return;
        p.busy = true;
        for (const b of bar.querySelectorAll('button')) b.disabled = true;
        progress.textContent = `${label}…`;
        let res;
        try {
            res = await syncModule(moduleId, {
                mode,
                scope: p.scope,
                onProgress: (done, total) => { progress.textContent = total ? `${label}: ${done} of ${total}` : 'Nothing to do.'; },
            });
        } catch (err) {
            res = { error: String(err?.message || err), inserted: 0, removed: 0 };
        } finally {
            // Never left set: a busy panel is skipped by every redraw, and would stay stale.
            p.busy = false;
        }
        if (res.error) toastr.warning(res.error, 'SillyNPC vectors');
        else toastr.success(`${res.inserted} vectorized${res.removed ? `, ${res.removed} removed` : ''}.`, 'SillyNPC vectors');
        p.render();
    };
    bar.append(
        button('Vectorize now', 'fa-play', 'Embed everything new, edited or failed', run('manual', 'Vectorizing')),
        button('Re-vectorize all', 'fa-arrows-rotate', 'Embed every entry again, replacing what is there', run('all', 'Re-vectorizing')),
        button(moduleId === 'phone' ? 'Purge this contact' : 'Purge for this chat', 'fa-trash-can', 'Delete this collection from the vector store. Entries stay and can be vectorized again.', async () => {
            const ok = await Popup.show.confirm('Purge these vectors?', `Everything SillyNPC stored for ${meta.label}${moduleId === 'phone' ? ` with ${p.scope}` : ' in this chat'} is deleted from the vector store. Your histories are not touched.`);
            if (!ok) return;
            const res = await purgeModule(moduleId, p.scope);
            if (res.error) toastr.warning(res.error, 'SillyNPC vectors');
            else toastr.success('Purged.', 'SillyNPC vectors');
        }, 'snpc-vec-danger'),
        progress,
    );
    if (!data.on) for (const b of bar.querySelectorAll('button')) if (!b.classList.contains('snpc-vec-danger')) b.disabled = true;
    body.append(bar);

    renderList(body, p, data);
    body.append(el('small', 'snpc-vec-muted snpc-vec-collection', `Collection: ${data.collection}`));
}

function renderList(body, p, data) {
    const { moduleId } = p;
    const head = el('div', 'snpc-vec-toolbar');
    const filter = el('select', 'text_pole');
    filter.append(new Option('All', 'all'));
    for (const [k, [label]] of Object.entries(STATE_LABELS)) if (k !== 'deleted') filter.append(new Option(label, k));
    filter.value = p.filter;
    filter.addEventListener('change', () => { p.filter = filter.value; p.page = 0; p.render(); });
    head.append(el('label', 'snpc-vec-label', 'Show'), filter);
    if (moduleId === 'phone') {
        const lab = el('label', 'checkbox_label snpc-vec-check');
        const box = el('input');
        box.type = 'checkbox';
        box.checked = p.showDeleted;
        box.addEventListener('change', () => { p.showDeleted = box.checked; p.page = 0; p.render(); });
        lab.append(box, el('span', '', 'Show deleted'));
        head.append(lab);
    }
    body.append(head);

    // Newest first: that is what people look for.
    let rows = data.rows.slice().reverse();
    rows = rows.filter(r => (r.state === 'deleted' ? p.showDeleted : (p.filter === 'all' || r.state === p.filter)));
    if (!rows.length) {
        body.append(el('p', 'notes', data.rows.length ? 'Nothing matches.' : `No ${VECTOR_MODULES[moduleId].noun}s yet.`));
        return;
    }
    const pages = Math.ceil(rows.length / PAGE);
    p.page = Math.min(p.page, pages - 1);
    const list = el('div', 'snpc-vec-list');
    for (const row of rows.slice(p.page * PAGE, (p.page + 1) * PAGE)) list.append(renderRow(p, row));
    body.append(list);

    if (pages > 1) {
        const nav = el('div', 'snpc-vec-toolbar snpc-vec-pager');
        const prev = iconButton('fa-chevron-left', 'Newer', () => { p.page--; p.render(); }, p.page === 0 ? 'disabled' : '');
        const next = iconButton('fa-chevron-right', 'Older', () => { p.page++; p.render(); }, p.page >= pages - 1 ? 'disabled' : '');
        nav.append(prev, el('span', 'snpc-vec-muted', `Page ${p.page + 1} of ${pages}`), next);
        body.append(nav);
    }
}

function renderRow(p, row) {
    const { moduleId, scope } = p;
    const wrap = el('div', `snpc-vec-row is-${row.state}`);
    const [label, icon] = STATE_LABELS[row.state] || ['?', 'fa-question'];
    const chip = el('span', `snpc-vec-state is-${row.state}`);
    chip.append(el('i', `fa-solid ${icon}`), el('span', '', label));
    if (row.error) chip.title = row.error;

    const who = el('div', 'snpc-vec-who');
    who.append(el('span', 'snpc-vec-name', row.label + (row.edited ? ' (edited)' : '')));
    if (row.sub) who.append(el('span', 'snpc-vec-sub', row.sub));

    const actions = el('div', 'snpc-vec-actions');
    const isOpen = p.open.has(row.id);
    actions.append(iconButton(isOpen ? 'fa-eye-slash' : 'fa-eye', isOpen ? 'Hide the text' : 'Show the text that is embedded', () => {
        if (isOpen) p.open.delete(row.id); else p.open.add(row.id);
        p.render();
    }));
    if (row.state !== 'deleted') {
        actions.append(iconButton('fa-pen', 'Edit the text that is embedded (marks it stale until vectorized again)', async () => {
            const typed = await Popup.show.input('Edit the vector text',
                'This is what is embedded and searched. Leave it empty to go back to the text from the history.', row.embedText);
            if (typed === null || typed === undefined) return;
            const text = String(typed).trim();
            const original = String(row.text ?? '').trim();
            const res = await setEntry(moduleId, scope, row.id, { text: text === original ? '' : text });
            if (res.error) toastr.warning(res.error, 'SillyNPC vectors');
        }));
        if (row.state === 'skip') {
            actions.append(iconButton('fa-hand-pointer', 'Vectorize this one by hand', async () => {
                const res = await syncModule(moduleId, { mode: 'manual', scope, only: [row.id] });
                if (res.error) toastr.warning(res.error, 'SillyNPC vectors');
            }));
        }
        actions.append(iconButton(row.enabled ? 'fa-toggle-on' : 'fa-toggle-off', row.enabled
            ? 'Turn off: removed from the vectors and never recalled'
            : 'Turn on again', async () => {
            const res = await setEntry(moduleId, scope, row.id, { enabled: !row.enabled });
            if (res.error) toastr.warning(res.error, 'SillyNPC vectors');
        }, row.enabled ? 'is-on' : ''));
        actions.append(iconButton('fa-trash', `Delete. ${HOW_DELETE[moduleId]}`, async () => {
            const ok = await Popup.show.confirm('Delete this entry?', HOW_DELETE[moduleId]);
            if (!ok) return;
            const res = await deleteEntry(moduleId, scope, row);
            if (res?.error) toastr.warning(res.error, 'SillyNPC vectors');
        }, 'snpc-vec-danger'));
    } else {
        actions.append(iconButton('fa-rotate-left', 'Restore: vectorize it again', async () => {
            const res = await setEntry(moduleId, scope, row.id, { deleted: false });
            if (res.error) toastr.warning(res.error, 'SillyNPC vectors');
        }));
    }

    const line = el('div', 'snpc-vec-line');
    line.append(chip, who, actions);
    wrap.append(line);
    if (isOpen) wrap.append(el('pre', 'snpc-vec-text', row.embedText || '(empty)'));
    return wrap;
}

/* ---- the core Vectors tab ------------------------------------------------------------ */

function textSetting(key, label, placeholder, help, onChange) {
    const wrap = el('div', 'sillynpc-setting');
    wrap.dataset.setting = `vectors.${key}`;
    const row = el('div', 'sillynpc-setting-row');
    const input = el('input', 'text_pole');
    input.type = 'text';
    input.value = vectorSettings()[key] || '';
    input.placeholder = placeholder;
    input.addEventListener('change', () => {
        vectorSettings()[key] = input.value.trim();
        saveSettings();
        onChange?.();
    });
    row.append(el('label', 'sillynpc-setting-label', label), input);
    wrap.append(row);
    if (help) wrap.append(Object.assign(el('small', 'notes'), { textContent: help, style: 'display:block;margin-top:4px' }));
    return wrap;
}

let tabListening = false;
let tabView = null;

/** The Vectors tab in the SillyNPC menu. */
export function renderVectorsView(view) {
    if (!view) return;
    loadStylesheet();
    if (view.isConnected || !tabView?.isConnected) tabView = view;
    if (!tabListening) {
        tabListening = true;
        eventSource.on(VECTORS_CHANGED_EVENT, () => {
            if (tabView?.isConnected && !tabView.contains(document.activeElement)) renderVectorsView(tabView);
        });
    }
    const rerender = () => renderVectorsView(view);
    view.replaceChildren();
    view.classList.add('snpc-vec', 'snpc-vec-tab');

    view.append(el('h3', 'sillynpc-section-title', 'Vectors'));
    view.append(el('p', 'notes sillynpc-tab-intro',
        'Embeds the histories of what happened (the rivalry record, phone threads, and what was said at games and in fights) with your own Ollama, '
        + 'through SillyTavern\'s own vector storage, so each prompt carries the entries that matter to the scene instead of only the newest. '
        + 'Bonds are the current state, not a history, and are never vectorized. '
        + 'Off, or when Ollama does not answer in time, everything works exactly as before.'));

    view.append(buildSettingToggle({
        store: STORE,
        key: 'enabled',
        label: 'Use Vectors',
        help: 'The master switch. Off: nothing is embedded, searched or changed. Each module also has its own switch, in its panel and below.',
        onChange: rerender,
    }));

    const src = currentSource();
    view.append(el('h3', 'sillynpc-section-title', 'Ollama'));
    view.append(textSetting('url', 'Ollama URL', `Inherited: ${src.inheritedUrl}`,
        'Empty uses the URL SillyTavern\'s Vector Storage uses for Ollama (or the Text Completion one). The call goes through your SillyTavern server.', rerender));
    view.append(textSetting('model', 'Embedding Model', `Inherited: ${src.inheritedModel}`,
        'Empty uses Vector Storage\'s Ollama model. Must be pulled in Ollama. Changing it starts every collection over, since each model has its own index.', rerender));
    view.append(el('p', 'notes', `In use: ${src.apiUrl} · ${src.model}`));
    view.append(buildSettingToggle({ store: STORE, key: 'keep', label: 'Keep Model Loaded', help: 'Asks Ollama to keep the embedding model in memory between calls.', advanced: true }));

    const testBox = el('div', 'snpc-vec-test');
    const testBtn = button('Test connection', 'fa-plug', 'Check Ollama, the model and embedding through SillyTavern. Sends only a fixed test sentence.', async () => {
        testBtn.disabled = true;
        testBox.replaceChildren(el('span', 'snpc-vec-muted', 'Testing…'));
        let res;
        try { res = await testConnection(); } catch (err) { res = { ok: false, steps: [{ label: 'Test', ok: false, detail: String(err?.message || err) }] }; }
        testBtn.disabled = false;
        testBox.replaceChildren();
        for (const s of res.steps) {
            const line = el('div', `snpc-vec-step ${s.ok === true ? 'is-ok' : s.ok === false ? 'is-bad' : 'is-unknown'}`);
            line.append(el('i', `fa-solid ${s.ok === true ? 'fa-circle-check' : s.ok === false ? 'fa-circle-xmark' : 'fa-circle-question'}`),
                el('span', 'snpc-vec-step-label', s.label), el('span', 'snpc-vec-muted', s.detail));
            testBox.append(line);
        }
    });
    const tbar = el('div', 'snpc-vec-toolbar');
    tbar.append(testBtn);
    view.append(tbar, testBox);

    view.append(el('h3', 'sillynpc-section-title', 'Search'));
    view.append(buildSettingNumber({ store: STORE, key: 'topK', label: 'Entries Per Search', suffix: 'entries', help: 'How many related entries a search returns, 1 to 30. Each module still writes only as many as its own slots allow.' }));
    view.append(buildSettingSlider({ store: STORE, key: 'threshold', label: 'Minimum Similarity', min: 0, max: 1, step: 0.05, help: 'Results below this score are ignored. 0.25 is a good start for qwen3-embedding.' }));
    view.append(buildSettingNumber({ store: STORE, key: 'queryMessages', label: 'Messages Searched With', suffix: 'messages', help: 'The last few messages are the search text, 1 to 20.' }));
    view.append(buildSettingNumber({ store: STORE, key: 'timeoutMs', label: 'Search Time Limit', suffix: 'ms', advanced: true, help: 'A search slower than this is dropped and the newest entries are used, so a slow Ollama never holds up a reply.' }));
    view.append(buildSettingToggle({ store: STORE, key: 'autoVectorize', label: 'Vectorize Automatically', help: 'Embeds new and edited entries a moment after they are written. Off: only when you press Vectorize now.' }));
    view.append(buildSettingNumber({ store: STORE, key: 'batchSize', label: 'Entries Per Request', suffix: 'entries', advanced: true, help: 'How many entries go to Ollama in one call while vectorizing, 1 to 50.' }));

    view.append(el('h3', 'sillynpc-section-title', 'Recalled games and fights'));
    view.append(el('p', 'notes', 'When Games or Fight table talk vectors are on, the games and fights that match the scene go into the story prompt '
        + 'as one short block each ("[EARLIER GAMES THAT MAY MATTER]", "[EARLIER FIGHTS THAT MAY MATTER]"). Nothing is added without vectors.'));
    view.append(buildSettingNumber({ store: STORE, key: 'injectDepth', label: 'Messages Back', suffix: 'messages', help: '0 is right after the newest message. 0 to 100.' }));
    view.append(buildSettingSelect({
        store: STORE, key: 'injectRole', label: 'Role',
        options: INJECT_ROLES.map(r => ({ value: r, label: r[0].toUpperCase() + r.slice(1) })),
        help: 'Who the block is said by.',
    }));

    view.append(el('h3', 'sillynpc-section-title', 'Overview'));
    const s = vectorSettings();
    const table = el('div', 'snpc-vec-overview');
    for (const row of overview()) {
        const line = el('div', 'snpc-vec-ov-row');
        const lab = el('label', 'checkbox_label snpc-vec-ov-name');
        const box = el('input');
        box.type = 'checkbox';
        box.checked = Boolean(s.modules[row.id]?.enabled);
        box.addEventListener('change', () => { vectorSettings().modules[row.id].enabled = box.checked; saveSettings(); announce(); rerender(); });
        lab.append(box, el('span', '', row.label));
        const st = row.status;
        const count = `${st.vectorized} of ${st.total}${st.stale ? ` · ${st.stale} stale` : ''}${st.errors ? ` · ${st.errors} failed` : ''}`;
        line.append(lab, el('span', 'snpc-vec-muted', row.scope),
            el('span', row.on ? '' : 'snpc-vec-muted', row.on ? count : `${count} · ${row.badge?.text || 'off'}`));
        const actions = el('div', 'snpc-vec-actions');
        if (row.id !== 'phone') {
            actions.append(iconButton('fa-play', 'Vectorize now', async () => {
                const res = await syncModule(row.id, { mode: 'manual' });
                if (res.error) toastr.warning(res.error, 'SillyNPC vectors');
                else toastr.success(`${row.label}: ${res.inserted} vectorized.`, 'SillyNPC vectors');
            }, row.on ? '' : 'disabled'));
            actions.append(iconButton('fa-trash-can', 'Purge for this chat', async () => {
                const ok = await Popup.show.confirm('Purge these vectors?', `${row.label}: everything stored for this chat is deleted from the vector store. Histories are not touched.`);
                if (ok) await purgeModule(row.id);
            }, 'snpc-vec-danger'));
        } else {
            actions.append(el('span', 'snpc-vec-muted', 'per contact, in the Phone settings'));
        }
        line.append(actions);
        table.append(line);
    }
    view.append(table);
    view.append(el('p', 'notes', 'Each module\'s panel (Combat > History for the rivalry record and fight talk, Modules > Games, Phone settings) lists its entries, '
        + 'where each can be viewed, edited, turned off or deleted. Rivalry, games and fight vectors are kept per chat; '
        + 'phone vectors per contact, like the phone\'s threads, and only while the Phone module is on. Stored by SillyTavern under data/<user>/vectors/ollama/sillynpc_*.'));
}
