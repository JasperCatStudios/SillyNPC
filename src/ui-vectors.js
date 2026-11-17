import { eventSource } from '../../../../events.js';
import { Popup } from '../../../../popup.js';
import { saveSettings } from './settings.js';
import { buildSettingToggle, buildSettingNumber, buildSettingSlider, buildSettingSelect } from './ui-shared.js';
import {
    VECTOR_MODULES, VECTOR_DEFAULTS, INJECT_ROLES, VECTORIZE_CHOICES, vectorizeTargets, vectorizeDecision,
    vectorizeReport, moduleSwitchState, historySourceLine, HISTORY_UNITS, HISTORY_RANGES, clampHistoryAmount,
    convertHistoryAmount, historyAmountHint, contextSize,
} from './vector-core.js';
import { vectorSettings, currentSource, testConnection, currentContextSize } from './vector-service.js';
import {
    panelData, syncModule, purgeModule, setEntry, deleteEntry, overview, phoneContacts, phoneModuleEnabled,
    moduleInUse, recallNote, VECTORS_CHANGED_EVENT,
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
    done: ['Remembered', 'fa-check'],
    pending: ['Waiting', 'fa-hourglass-half'],
    stale: ['Changed', 'fa-rotate'],
    off: ['Off', 'fa-ban'],
    error: ['Failed', 'fa-triangle-exclamation'],
    skip: ['Not yet', 'fa-forward'],
    deleted: ['Deleted', 'fa-trash'],
};

const HOW_DELETE = {
    rivalry: 'Deletes the record from the rivalry history too.',
    phone: 'Forgets these texts here only; the phone keeps them.',
    games: 'Deletes this game\'s table talk from the chat\'s log too.',
    combat: 'Deletes this fight\'s table talk from the chat\'s log too.',
};

const MODULE_HELP = {
    rivalry: 'Sends the records that matter to the scene, instead of only the newest, in the shared-history block.',
    phone: 'Brings older texts with the people in the scene back into the main story when they matter. The phone\'s own replies are not affected. Needs the Phone module itself to be on.',
    games: 'Keeps what was said at the games table, per chat, and brings back the games that match the scene.',
    combat: 'Keeps what was said during fights, per chat, and brings back the fights that match the scene.',
};

/** One collapsed "Advanced" box, closed by default: the numbers most people never need. */
function advancedBox(...children) {
    const box = el('details', 'snpc-vec-advanced');
    box.append(el('summary', 'snpc-vec-advanced-summary', 'Advanced'));
    const inner = el('div', 'snpc-vec-advanced-body');
    inner.append(...children.filter(Boolean));
    box.append(inner);
    return box;
}

/**
 * The one "how much" control: "History brought back, total", a number and its unit (% of
 * context or tokens), with the same amount in the other unit beside it. Shared by every kind.
 */
function amountControl(onChange) {
    const wrap = el('div', 'sillynpc-setting snpc-vec-amount');
    wrap.dataset.setting = 'vectors.historyAmount';
    const row = el('div', 'sillynpc-setting-row');
    const field = el('input', 'text_pole sillynpc-number-input');
    field.type = 'number';
    const unit = el('select', 'text_pole snpc-vec-amount-unit');
    for (const u of HISTORY_UNITS) unit.append(new Option(HISTORY_RANGES[u].label, u));
    const hint = el('span', 'snpc-vec-muted snpc-vec-amount-hint');
    const range = el('small', 'notes');
    range.style.cssText = 'display:block;margin-top:4px';

    const ctx = () => { try { return currentContextSize(); } catch { return contextSize(null); } };
    const show = () => {
        const u = vectorSettings().historyUnit;
        const r = HISTORY_RANGES[u];
        unit.value = u;
        field.min = String(r.min);
        field.max = String(r.max);
        field.step = String(r.step);
        field.value = String(vectorSettings().historyAmount);
        hint.textContent = historyAmountHint(u, vectorSettings().historyAmount, ctx());
        range.textContent = `${r.min} to ${r.max.toLocaleString('en-US')} ${u === 'percent' ? '%' : 'tokens'}. Shared by every kind that is on (rivalry, games, fights, phone); `
            + 'what one does not need goes to the others. Only whole memories are used, never cut short; when there is not room for all, the least related are left out, and the most related always goes in.';
    };
    // Live hint while typing; saved, clamped, on commit.
    field.addEventListener('input', () => {
        hint.textContent = historyAmountHint(vectorSettings().historyUnit, field.value === '' ? vectorSettings().historyAmount : field.value, ctx());
    });
    field.addEventListener('change', () => {
        const v = vectorSettings();
        v.historyAmount = clampHistoryAmount(v.historyUnit, field.value, v.historyAmount);
        saveSettings();
        announce();
        show();
        onChange?.();
    });
    unit.addEventListener('change', () => {
        const v = vectorSettings();
        // The same amount, said the other way.
        v.historyAmount = convertHistoryAmount(v.historyUnit, v.historyAmount, unit.value, ctx());
        v.historyUnit = unit.value;
        saveSettings();
        announce();
        show();
        onChange?.();
    });
    row.append(el('label', 'sillynpc-setting-label', 'History brought back, total'), field, unit);
    wrap.append(row, hint, range);
    show();
    return wrap;
}

/** A module's own amount, for Advanced: 0 shares the total. */
function ownAmountNumber(moduleId, onChange) {
    const label = VECTOR_MODULES[moduleId]?.label || moduleId;
    return buildSettingNumber({
        store: STORE, key: `modules.${moduleId}.amountTokens`, label: `Own amount for ${label}`, suffix: 'tokens (approx.)',
        help: '0 (the usual): a share of "History brought back, total". Otherwise 200 to 20000: this much is set aside for it, out of the total, never more than the total.',
        onChange,
    });
}

/** Where this module's history reaches the story from right now, in one plain line. */
function sourceLine(moduleId) {
    let on = false;
    try { on = moduleInUse(moduleId); } catch { /* not ready */ }
    return el('p', `notes snpc-vec-source${on ? ' is-on' : ''}`, historySourceLine(moduleId, on));
}

/** "Left out N older memories to save space", only after a reply that left something out. */
function droppedLine(moduleId) {
    const note = recallNote(moduleId);
    return note ? el('p', 'notes snpc-vec-dropped', note) : null;
}

/** "How many texts make one memory", the phone's one visible number. */
function phoneMemorySize(onChange) {
    return buildSettingNumber({
        store: STORE, key: 'modules.phone.chunkSize', label: 'How many texts make one memory', suffix: 'texts',
        help: '5 to 60; 20 to 30 suits old history. A memory is remembered once it is full. Changing it regroups the texts the next time they are remembered.',
        onChange,
    });
}

/** How many of one module come back at most, for Advanced. */
function recallNumber(moduleId, onChange) {
    const what = { phone: ['Phone memories brought back', 'memories', '1 to 8.'], games: ['Games brought back', 'games', '1 to 6.'], combat: ['Fights brought back', 'fights', '1 to 6.'] }[moduleId];
    if (!what) return null;
    return buildSettingNumber({ store: STORE, key: `modules.${moduleId}.recall`, label: what[0], suffix: what[1], help: `${what[2]} At most this many, and only while they fit the room.`, onChange });
}

/** Placement of the games, fights and phone block, for Advanced. */
function placementSettings() {
    return [
        el('p', 'notes', 'Where the brought-back games, fights and phone texts go in the story ("[EARLIER GAMES THAT MAY MATTER]", "[EARLIER FIGHTS THAT MAY MATTER]", "[EARLIER TEXTS WITH ... THAT MAY MATTER]"):'),
        buildSettingNumber({ store: STORE, key: 'injectDepth', label: 'Messages Back', suffix: 'messages', help: '0 is right after the newest message. 0 to 100.' }),
        buildSettingSelect({
            store: STORE, key: 'injectRole', label: 'Role',
            options: INJECT_ROLES.map(r => ({ value: r, label: r[0].toUpperCase() + r.slice(1) })),
            help: 'Who the block is said by.',
        }),
    ];
}

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

/**
 * Whether the user is typing inside host. A redraw then would take the field from under the
 * cursor; a checkbox, select or button that was just used is no reason to wait.
 */
function typingIn(host) {
    const a = document.activeElement;
    if (!host || !a || !host.contains(a)) return false;
    if (a.tagName === 'TEXTAREA') return true;
    return a.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit'].includes(String(a.type).toLowerCase());
}

/** Flips the master switch on, from wherever the user found out it was off. */
function turnMasterOn() {
    vectorSettings().enabled = true;
    saveSettings();
    announce();
    try { toastr.success('Vectors are on. Each kind of history still has its own switch.', 'Worldkit vectors'); } catch { /* no toastr */ }
}

/** A "Turn Vectors on" button; safe inside a <summary> (it does not open or close the box). */
function masterOnButton(compact = false) {
    const b = button(compact ? 'Turn on' : 'Turn Vectors on', 'fa-power-off', 'Switch on the master switch "Use Vectors" (Vectors menu)', (e) => {
        e.stopPropagation();
        turnMasterOn();
    }, 'snpc-vec-master-btn');
    // A click inside a <summary> would also toggle the <details>.
    b.addEventListener('click', (e) => e.stopPropagation());
    return b;
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
            if (p.busy || typingIn(p.host)) continue;
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
    const parts = [`${status.vectorized} of ${status.total} remembered`];
    if (status.stale) parts.push(`${status.stale} changed`);
    if (status.pending) parts.push(`${status.pending} waiting`);
    if (status.disabled) parts.push(`${status.disabled} off`);
    if (status.skipped) parts.push(`${status.skipped} not yet`);
    if (status.errors) parts.push(`${status.errors} failed`);
    if (status.deleted) parts.push(`${status.deleted} deleted`);
    return parts.join(' · ');
}

/* ---- the per-module panel ------------------------------------------------------------ */

/**
 * A module's own switch. It writes `modules.<id>.enabled`, the setting moduleActive() and
 * vectorBadge() read, and says so when it is ticked but still waits on another switch.
 */
function moduleToggle(moduleId, onChange, label) {
    const wrap = el('div', 'snpc-vec-modtoggle');
    wrap.append(buildSettingToggle({
        store: STORE,
        key: `modules.${moduleId}.enabled`,
        label: label || `Use Vectors for ${VECTOR_MODULES[moduleId].label}`,
        help: MODULE_HELP[moduleId],
        onChange,
    }));
    const sw = moduleSwitchState(vectorSettings(), moduleId, { phoneEnabled: phoneModuleEnabled() });
    if (sw.state === 'waiting') {
        wrap.classList.add('is-waiting');
        const note = el('div', 'snpc-vec-waiting');
        note.append(el('span', '', 'Ticked, but waiting for the master switch: nothing happens until Vectors are turned on.'), masterOnButton());
        wrap.append(note);
    } else if (sw.state === 'phone-off') {
        wrap.classList.add('is-waiting');
        wrap.append(el('div', 'snpc-vec-waiting', 'Ticked, but waiting for the Phone module itself (Modules > Phone).'));
    }
    return wrap;
}

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
 * @param {{ embedded?: boolean }} [opts] embedded: inside the Vectors menu's own module tab, which
 *   already shows the switch and settings, so the panel is only the entry list (open by default).
 * @returns {object|undefined} the panel
 */
export function mountVectorPanel(host, moduleId, { embedded = false } = {}) {
    if (!host || !VECTOR_MODULES[moduleId]) return undefined;
    loadStylesheet();
    listen();
    for (const p of mounted) if (p.host === host) mounted.delete(p);
    const panel = {
        host,
        moduleId,
        embedded,
        expanded: embedded,
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
    return panel;
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
    summary.append(el('i', 'fa-solid fa-diagram-project'), el('span', 'snpc-vec-title', p.embedded ? `Entries: ${meta.label}` : `Vectors: ${meta.label}`));
    const data = panelData(moduleId, p.scope);
    const badge = el('span', `snpc-vec-badge${data.on ? '' : ' is-off'}`, badgeText(data));
    if (!data.on) badge.title = data.badge?.reason === 'module switch is off'
        ? `Switch on "Use Vectors for ${meta.label}" inside this panel or in the Vectors tab.`
        : data.badge?.reason === 'the Phone module is off'
            ? 'Switch the Phone module on under Modules > Phone; while it is off nothing of it is remembered.'
            : 'The master switch "Use Vectors" in the Worldkit menu, Vectors tab, is off.';
    summary.append(badge);
    // The master switch is the one people cannot find: it can be flipped right here.
    if (!data.master && !p.embedded) summary.append(masterOnButton(true));
    details.append(summary);
    host.append(details);
    if (!details.open) return;

    const body = el('div', 'snpc-vec-body');
    details.append(body);
    if (!p.embedded) {
        body.append(el('p', 'notes', `Remembers the ${meta.nouns} that matter to what is happening now and brings them back to the story, instead of only the newest. `
            + 'Done by your own Ollama through SillyTavern; nothing leaves your machines.'));
    }

    // Embedded in the Vectors menu's module tab, the switch, its status and the settings are
    // drawn by the tab above; here they would only repeat.
    if (!p.embedded) {
        if (!data.master) {
            const warn = el('div', 'snpc-vec-warn');
            warn.append(el('span', '', 'The master switch "Use Vectors" is off, so nothing here is remembered or sent, even with the switch below ticked.'), masterOnButton());
            body.append(warn);
        } else if (data.badge?.reason === 'the Phone module is off') {
            body.append(el('p', 'snpc-vec-warn', 'The Phone module is off, so nothing of the phone is remembered or sent. Switch it on under Modules > Phone.'));
        }
        body.append(moduleToggle(moduleId, p.render));
        body.append(sourceLine(moduleId));
        const dropped = droppedLine(moduleId);
        if (dropped) body.append(dropped);
        body.append(amountControl(p.render));
        if (moduleId === 'phone') body.append(phoneMemorySize(p.render));
        body.append(advancedBox(recallNumber(moduleId, p.render), ownAmountNumber(moduleId, p.render),
            el('p', 'notes', moduleId === 'rivalry' ? 'Where the block goes in the story is set with the shared history (Combat > History).' : 'Where it goes in the story is set in the Vectors tab, under Advanced.')));
    }
    if (moduleId === 'phone') {
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
        body.append(el('p', 'notes', 'Open a chat to see what it remembers.'));
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
        if (res.error) toastr.warning(res.error, 'Worldkit vectors');
        else toastr.success(`${res.inserted} remembered${res.removed ? `, ${res.removed} removed` : ''}.`, 'Worldkit vectors');
        p.render();
    };
    bar.append(
        button('Remember now', 'fa-play', 'Remember everything new, changed or failed', run('manual', 'Remembering')),
        button('Remember all again', 'fa-arrows-rotate', 'Remember every one again, replacing what is there', run('all', 'Remembering again')),
        button(moduleId === 'phone' ? 'Forget this contact' : 'Forget for this chat', 'fa-trash-can', 'Deletes what was remembered. The histories themselves stay and can be remembered again.', async () => {
            const ok = await Popup.show.confirm('Forget what was remembered?', `Everything Worldkit remembered for ${meta.label}${moduleId === 'phone' ? ` with ${p.scope}` : ' in this chat'} is deleted from SillyTavern's vector storage. Your histories are not touched.`);
            if (!ok) return;
            const res = await purgeModule(moduleId, p.scope);
            if (res.error) toastr.warning(res.error, 'Worldkit vectors');
            else toastr.success('Forgotten.', 'Worldkit vectors');
        }, 'snpc-vec-danger'),
        progress,
    );
    if (!data.on) for (const b of bar.querySelectorAll('button')) if (!b.classList.contains('snpc-vec-danger')) b.disabled = true;
    body.append(bar);

    renderList(body, p, data);
    body.append(el('small', 'snpc-vec-muted snpc-vec-collection', `Stored as: ${data.collection}`));
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
        body.append(el('p', 'notes', data.rows.length ? 'Nothing matches.' : `No ${VECTOR_MODULES[moduleId].nouns} yet.`));
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
    actions.append(iconButton(isOpen ? 'fa-eye-slash' : 'fa-eye', isOpen ? 'Hide the text' : 'Show the text it is found by', () => {
        if (isOpen) p.open.delete(row.id); else p.open.add(row.id);
        p.render();
    }));
    if (row.state !== 'deleted') {
        actions.append(iconButton('fa-pen', 'Edit the text it is found by (it shows as changed until remembered again)', async () => {
            const typed = await Popup.show.input('Edit the search text',
                'This is only what it is found by; what comes back to the story is always the history itself, whole. Leave it empty to go back to the text from the history.', row.embedText);
            if (typed === null || typed === undefined) return;
            const text = String(typed).trim();
            const original = String(row.text ?? '').trim();
            const res = await setEntry(moduleId, scope, row.id, { text: text === original ? '' : text });
            if (res.error) toastr.warning(res.error, 'Worldkit vectors');
        }));
        if (row.state === 'skip') {
            actions.append(iconButton('fa-hand-pointer', 'Remember this one now, by hand', async () => {
                const res = await syncModule(moduleId, { mode: 'manual', scope, only: [row.id] });
                if (res.error) toastr.warning(res.error, 'Worldkit vectors');
            }));
        }
        actions.append(iconButton(row.enabled ? 'fa-toggle-on' : 'fa-toggle-off', row.enabled
            ? 'Turn off: forgotten, and never brought back'
            : 'Turn on again', async () => {
            const res = await setEntry(moduleId, scope, row.id, { enabled: !row.enabled });
            if (res.error) toastr.warning(res.error, 'Worldkit vectors');
        }, row.enabled ? 'is-on' : ''));
        actions.append(iconButton('fa-trash', `Delete. ${HOW_DELETE[moduleId]}`, async () => {
            const ok = await Popup.show.confirm('Delete this entry?', HOW_DELETE[moduleId]);
            if (!ok) return;
            const res = await deleteEntry(moduleId, scope, row);
            if (res?.error) toastr.warning(res.error, 'Worldkit vectors');
        }, 'snpc-vec-danger'));
    } else {
        actions.append(iconButton('fa-rotate-left', 'Restore: remember it again', async () => {
            const res = await setEntry(moduleId, scope, row.id, { deleted: false });
            if (res.error) toastr.warning(res.error, 'Worldkit vectors');
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

/** The module tabs of the Vectors menu, in the menu's order, and the shared settings last. */
const MODULE_TABS = Object.freeze([
    { id: 'rivalry', label: 'Rivalry' },
    { id: 'combat', label: 'Combat' },
    { id: 'games', label: 'Games' },
    { id: 'phone', label: 'Phone' },
]);
const GENERAL_TAB = { id: 'general', label: 'Ollama & Search' };
let vecTab = 'rivalry';

/** The entry list of each module tab, kept across redraws so its page, filter and contact stay put. */
const tabPanels = new Map();

/** The "Vectorize" box's choices and its last run, kept across redraws. */
const va = { choice: 'all', contact: '', redo: false, busy: false, progress: '', lines: [] };

const switchFlags = () => ({ phoneEnabled: phoneModuleEnabled() });

/** Redraws only the "Vectorize" box, so a run's progress does not rebuild the whole menu. */
function refreshVectorizeBox() {
    const old = tabView?.querySelector?.('.snpc-vec-all');
    if (old) old.replaceWith(buildVectorizeBox());
}

function setProgress(text) {
    va.progress = text;
    const node = tabView?.querySelector?.('.snpc-vec-all-progress');
    if (node) node.textContent = text;
}

/** What each target of the chosen run would do, from what is in the chat and the phone now. */
function decideTargets() {
    const settings = vectorSettings();
    const { phoneEnabled } = switchFlags();
    return vectorizeTargets(va.choice, { contact: va.contact, contacts: phoneContacts() }).map((t) => {
        const d = panelData(t.id, t.scope);
        return vectorizeDecision(t.id, {
            settings, phoneEnabled, rows: d.rows, scope: t.scope, redo: va.redo,
            chatOpen: t.id === 'phone' || Boolean(d.collection),
        });
    });
}

async function runVectorize() {
    if (va.busy) return;
    let decisions;
    try {
        decisions = decideTargets();
    } catch (err) {
        va.lines = [{ level: 'error', text: `Could not check what there is to remember: ${String(err?.message || err)}` }];
        refreshVectorizeBox();
        return;
    }

    // Off modules with something to embed: say so, and offer to switch them on.
    const fixable = decisions.filter(d => d.action === 'off' && d.fix.length);
    if (fixable.length) {
        const needMaster = fixable.some(d => d.fix.includes('master'));
        const mods = [...new Set(fixable.filter(d => d.fix.includes('module')).map(d => VECTOR_MODULES[d.id].label))];
        const parts = [];
        if (needMaster) parts.push('the master switch "Use Vectors"');
        if (mods.length) parts.push(`the switch for ${mods.join(', ')}`);
        const names = [...new Set(fixable.map(d => VECTOR_MODULES[d.id].label))].join(', ');
        const ok = await Popup.show.confirm('Vectors are off for this',
            `${names}: there is something to remember, but ${parts.join(' and ')} ${parts.length > 1 ? 'are' : 'is'} off. `
            + 'Turn them on and remember it? (No skips them.)');
        if (ok) {
            const s = vectorSettings();
            if (needMaster) s.enabled = true;
            for (const d of fixable) if (d.fix.includes('module')) s.modules[d.id].enabled = true;
            saveSettings();
            announce();
            try { decisions = decideTargets(); } catch (err) {
                va.lines = [{ level: 'error', text: `Could not check what there is to remember: ${String(err?.message || err)}` }];
                refreshVectorizeBox();
                return;
            }
        }
    }

    const runs = decisions.filter(d => d.action === 'run');
    va.busy = true;
    va.lines = [];
    va.progress = runs.length ? 'Starting…' : '';
    refreshVectorizeBox();
    try {
        for (const d of runs) {
            setProgress(`${d.where}…`);
            try {
                d.result = await syncModule(d.id, {
                    mode: va.redo ? 'all' : 'manual',
                    scope: d.scope,
                    onProgress: (done, total) => setProgress(total ? `${d.where}: ${done} of ${total}` : `${d.where}: nothing new`),
                });
            } catch (err) {
                d.result = { inserted: 0, removed: 0, error: String(err?.message || err) };
            }
        }
    } finally {
        va.busy = false;
        va.progress = '';
    }

    va.lines = vectorizeReport(decisions);
    const errors = va.lines.filter(l => l.level === 'error');
    const inserted = runs.reduce((n, d) => n + (Number(d.result?.inserted) || 0), 0);
    if (errors.length) toastr.error(errors.map(l => l.text).join('\n'), 'Worldkit vectors');
    else if (!runs.length) {
        const warned = va.lines.filter(l => l.level === 'warn');
        if (warned.length) toastr.warning(warned.map(l => l.text).join('\n'), 'Worldkit vectors: nothing remembered');
        else toastr.info(va.lines.map(l => l.text).join('\n') || 'Nothing to remember.', 'Worldkit vectors');
    } else toastr.success(`Remembered ${inserted}.`, 'Worldkit vectors');
    refreshVectorizeBox();
}

/** "Remember now": what (All or one module, and for the phone which character), and a button. */
function buildVectorizeBox() {
    const box = el('div', 'snpc-vec-all');
    box.append(el('div', 'snpc-vec-all-title', 'Remember now'));
    const row = el('div', 'snpc-vec-toolbar');

    const what = el('select', 'text_pole');
    what.title = 'What to remember';
    for (const c of VECTORIZE_CHOICES) what.append(new Option(c.label, c.value));
    what.value = va.choice;
    what.disabled = va.busy;
    what.addEventListener('change', () => { va.choice = what.value; va.lines = []; refreshVectorizeBox(); });
    row.append(el('label', 'snpc-vec-label', 'What'), what);

    if (va.choice === 'phone') {
        const contacts = phoneContacts();
        if (va.contact && !contacts.includes(va.contact)) va.contact = '';
        const who = el('select', 'text_pole');
        who.title = 'Which character\'s texts';
        if (!contacts.length) who.append(new Option('No phone texts yet', ''));
        else who.append(new Option(`All characters (${contacts.length})`, ''));
        for (const c of contacts) who.append(new Option(c, c));
        who.value = va.contact;
        who.disabled = va.busy || !contacts.length;
        who.addEventListener('change', () => { va.contact = who.value; va.lines = []; refreshVectorizeBox(); });
        row.append(el('label', 'snpc-vec-label', 'Character'), who);
    }

    const redoLab = el('label', 'checkbox_label snpc-vec-check');
    const redo = el('input');
    redo.type = 'checkbox';
    redo.checked = va.redo;
    redo.disabled = va.busy;
    redo.addEventListener('change', () => { va.redo = redo.checked; });
    redoLab.title = 'Remember again what is already remembered too, replacing it';
    redoLab.append(redo, el('span', '', 'Redo what is already remembered'));
    row.append(redoLab);

    const go = button(va.busy ? 'Remembering…' : 'Remember', 'fa-play', 'Checks there is something to remember first, then remembers it', () => { runVectorize(); });
    go.disabled = va.busy;
    row.append(go);
    box.append(row);

    box.append(el('div', 'snpc-vec-muted snpc-vec-all-progress', va.progress));
    if (va.lines.length) {
        const list = el('ul', 'snpc-vec-report');
        for (const l of va.lines) list.append(el('li', `is-${l.level}`, l.text));
        box.append(list);
    }
    return box;
}

/** The master switch, above everything, with what it means right now. */
function buildMasterBox(rerender) {
    const s = vectorSettings();
    const box = el('div', `snpc-vec-master${s.enabled ? ' is-on' : ' is-off'}`);
    box.append(buildSettingToggle({
        store: STORE,
        key: 'enabled',
        label: 'Use Vectors (master switch)',
        help: 'Off: nothing is remembered or sent, whatever the switches below say, and everything works as before. On: each kind of history whose own switch is on is remembered.',
        onChange: rerender,
    }));
    const waiting = MODULE_TABS.filter(t => s.modules[t.id]?.enabled).map(t => t.label);
    let text;
    if (s.enabled) text = 'Vectors are on.';
    else if (waiting.length) text = `Vectors are off. ${waiting.join(', ')} ${waiting.length === 1 ? 'is' : 'are'} ticked and waiting for this switch.`;
    else text = 'Vectors are off: nothing is remembered or sent.';
    const line = el('div', 'snpc-vec-master-state');
    line.append(el('span', '', text));
    if (!s.enabled) line.append(masterOnButton());
    box.append(line);
    return box;
}

/** One row per module: its switch, its state (and which switch keeps it off), its counts. */
function buildOverview(rerender) {
    const s = vectorSettings();
    const byId = new Map(overview().map(r => [r.id, r]));
    const table = el('div', 'snpc-vec-overview');
    for (const t of MODULE_TABS) {
        const row = byId.get(t.id);
        const sw = moduleSwitchState(s, t.id, switchFlags());
        const line = el('div', `snpc-vec-ov-row is-${sw.state}`);
        const lab = el('label', 'checkbox_label snpc-vec-ov-name');
        const box = el('input');
        box.type = 'checkbox';
        box.checked = Boolean(s.modules[t.id]?.enabled);
        box.title = `Use Vectors for ${VECTOR_MODULES[t.id].label}`;
        box.addEventListener('change', () => { vectorSettings().modules[t.id].enabled = box.checked; saveSettings(); announce(); rerender(); });
        lab.append(box, el('span', '', VECTOR_MODULES[t.id].label));
        const state = el('span', `snpc-vec-ov-state is-${sw.state}`,
            sw.state === 'waiting' ? 'waiting: master off' : sw.state === 'phone-off' ? 'waiting: Phone module off' : sw.text);
        const st = row?.status || { vectorized: 0, total: 0 };
        const count = `${st.vectorized} of ${st.total} remembered${st.stale ? ` · ${st.stale} changed` : ''}${st.errors ? ` · ${st.errors} failed` : ''} (${row?.scope || ''})`;
        const open = iconButton('fa-arrow-right', `Open the ${t.label} tab`, () => { vecTab = t.id; rerender(); });
        line.append(lab, state, el('span', 'snpc-vec-muted', count), open);
        table.append(line);
        // Where this history reaches the story from, one line under its row.
        const src = sourceLine(t.id);
        src.classList.add('snpc-vec-ov-source');
        table.append(src);
    }
    return table;
}

/** The tab bar, same pattern as the Systems and Tracker tabs. Each module tab says on or off. */
function buildTabs(rerender) {
    const s = vectorSettings();
    const tabs = el('div', 'sillynpc-charview-tabs snpc-vec-tabs');
    for (const t of [...MODULE_TABS, GENERAL_TAB]) {
        const tab = el('button', `sillynpc-charview-tab${vecTab === t.id ? ' active' : ''}`);
        tab.type = 'button';
        tab.dataset.view = t.id;
        if (t.id !== 'general') {
            const sw = moduleSwitchState(s, t.id, switchFlags());
            tab.append(el('span', `snpc-vec-dot is-${sw.state}`));
            tab.title = `${VECTOR_MODULES[t.id].label}: ${sw.text}`;
        } else {
            tab.title = 'Ollama connection and search settings, shared by every module';
        }
        tab.append(el('span', '', t.label));
        tab.addEventListener('click', () => { if (vecTab !== t.id) { vecTab = t.id; rerender(); } });
        tabs.append(tab);
    }
    return tabs;
}

/** A module's tab: its switch on top, why it is off, its settings, then its entries. */
function renderModuleTab(body, moduleId, rerender) {
    const meta = VECTOR_MODULES[moduleId];
    const head = el('div', 'snpc-vec-modhead');
    head.append(moduleToggle(moduleId, rerender, `Use Vectors for ${meta.label}`));
    const data = panelData(moduleId, moduleId === 'phone' ? (tabPanels.get('phone')?.scope || phoneContacts()[0] || '') : '');
    const status = el('div', `snpc-vec-modstatus${data.on ? ' is-on' : ' is-off'}`);
    status.append(el('span', 'snpc-vec-modstatus-label', 'Status:'), el('span', '', data.on ? `on · ${badgeText(data)}` : badgeText(data)));
    if (!data.master) status.append(masterOnButton());
    head.append(status);
    head.append(sourceLine(moduleId));
    const dropped = droppedLine(moduleId);
    if (dropped) head.append(dropped);
    body.append(head);

    // Visible: the switch above, and for the phone its memory size. "How much" is shared, at the
    // top of the menu.
    body.append(el('p', 'notes', `How much comes back is "History brought back, total", at the top of this menu, shared by every kind that is on.${moduleId === 'rivalry' ? ' How many records each person gets, and where the block goes, are set with the shared history (Combat > History).' : ''}`));
    if (moduleId === 'phone') body.append(phoneMemorySize(rerender));

    // Everything else, closed by default.
    const adv = [];
    if (moduleId === 'rivalry') {
        adv.push(buildSettingNumber({ store: STORE, key: 'topK', label: 'Matches Per Search', suffix: 'records', help: 'Shared with every kind (also in Ollama & Search). How many related records one search brings back, 1 to 30; each person still gets only their own slots.' }));
        adv.push(ownAmountNumber(moduleId, rerender));
    } else {
        adv.push(recallNumber(moduleId, rerender), ownAmountNumber(moduleId, rerender), ...placementSettings());
    }
    adv.push(buildSettingToggle({ store: STORE, key: 'autoVectorize', label: 'Remember Automatically', help: 'Shared with every kind. Remembers new and changed history a moment after it is written. Off: only when you press Remember.' }));
    body.append(advancedBox(...adv));

    // The entry list, kept across redraws (and listening for changes like every other panel).
    let p = tabPanels.get(moduleId);
    if (!p) {
        p = mountVectorPanel(el('div', 'snpc-vec-tabpanel'), moduleId, { embedded: true });
        tabPanels.set(moduleId, p);
    } else {
        mounted.add(p);
        if (!p.busy) p.render();
    }
    body.append(p.host);
}

function renderGeneralTab(body, rerender) {
    const src = currentSource();
    body.append(el('h3', 'sillynpc-section-title', 'Ollama'));
    body.append(el('p', 'notes', `In use: ${src.apiUrl} · ${src.model}`));

    const testBox = el('div', 'snpc-vec-test');
    const testBtn = button('Test connection', 'fa-plug', 'Check Ollama and its model through SillyTavern. Sends only a fixed test sentence.', async () => {
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
    body.append(tbar, testBox);

    body.append(advancedBox(
        textSetting('url', 'Ollama URL', `Inherited: ${src.inheritedUrl}`,
            'Empty uses the URL SillyTavern\'s Vector Storage uses for Ollama (or the Text Completion one). The call goes through your SillyTavern server.', rerender),
        textSetting('model', 'Ollama Model', `Inherited: ${src.inheritedModel}`,
            'Empty uses Vector Storage\'s Ollama model. Must be pulled in Ollama. Changing it starts everything over: each model remembers separately.', rerender),
        buildSettingToggle({ store: STORE, key: 'keep', label: 'Keep Model Loaded', help: 'Asks Ollama to keep the model in memory between calls.' }),
        recallNumber('phone', rerender),
        recallNumber('games', rerender),
        recallNumber('combat', rerender),
        ...placementSettings(),
        buildSettingNumber({ store: STORE, key: 'topK', label: 'Matches Per Search', suffix: 'entries', help: 'How many related entries one search brings back, 1 to 30. Each kind still sends only as many as its own number allows.' }),
        buildSettingSlider({ store: STORE, key: 'threshold', label: 'How Close A Match Must Be', min: 0, max: 1, step: 0.05, help: 'Weaker matches are ignored. 0.25 is a good start for qwen3-embedding.' }),
        buildSettingNumber({ store: STORE, key: 'queryMessages', label: 'Messages Searched With', suffix: 'messages', help: 'The last few messages are what is searched with, 1 to 20.' }),
        buildSettingNumber({ store: STORE, key: 'timeoutMs', label: 'Search Time Limit', suffix: 'ms', help: 'A search slower than this is dropped (the newest records are used, nothing else is brought back), so a slow Ollama never holds up a reply.' }),
        buildSettingToggle({ store: STORE, key: 'autoVectorize', label: 'Remember Automatically', help: 'Remembers new and changed history a moment after it is written. Off: only when you press Remember.' }),
        buildSettingNumber({ store: STORE, key: 'batchSize', label: 'Entries Per Request', suffix: 'entries', help: 'How many entries go to Ollama in one call while remembering, 1 to 50.' }),
    ));
    body.append(el('p', 'notes', 'Rivalry, games and fights are remembered per chat; phone texts per contact, like the phone\'s threads, and only while the Phone module is on. '
        + 'The same lists are also under Combat > History (rivalry record, fight talk), Modules > Games and the Phone settings. Stored by SillyTavern under data/<user>/vectors/ollama/sillynpc_*.'));
}

/** The Vectors tab in the Worldkit menu. */
export function renderVectorsView(view) {
    if (!view) return;
    loadStylesheet();
    listen();
    if (view.isConnected || !tabView?.isConnected) tabView = view;
    if (!tabListening) {
        tabListening = true;
        eventSource.on(VECTORS_CHANGED_EVENT, () => {
            if (tabView?.isConnected && !typingIn(tabView)) renderVectorsView(tabView);
        });
    }
    const rerender = () => renderVectorsView(view);
    view.replaceChildren();
    view.classList.add('snpc-vec', 'snpc-vec-tab');

    view.append(el('h3', 'sillynpc-section-title', 'Vectors'));
    view.append(el('p', 'notes sillynpc-tab-intro',
        'Remembers the histories of what happened (the rivalry record, phone texts, and what was said at games and in fights) with your own Ollama, '
        + 'through SillyTavern\'s own vector storage, and brings back to the story the ones that matter to the scene, whole, instead of only the newest. '
        + 'Each history then reaches the story one way only. Bonds are the current state, not a history, and are not part of this. '
        + 'Off, or when Ollama does not answer in time, everything works exactly as before.'));

    view.append(buildMasterBox(rerender));
    view.append(amountControl(rerender));
    view.append(buildOverview(rerender));
    view.append(buildVectorizeBox());
    view.append(buildTabs(rerender));

    const body = el('div', 'snpc-vec-tabbody');
    view.append(body);
    try {
        if (vecTab === 'general') renderGeneralTab(body, rerender);
        else renderModuleTab(body, vecTab, rerender);
    } catch (err) {
        console.error('[Worldkit] Vectors tab failed', err);
        body.append(el('p', 'snpc-vec-error', `This tab failed to draw: ${String(err?.message || err)}`));
    }
}
