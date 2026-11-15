import { getSettings, saveSettings } from '../../src/settings.js';
import { getPlayerCard } from '../../src/status-logic.js';
import { STAT_ROLES, POOL_ROLES, project, roleLabel, capabilities, ladderOf } from '../../src/combat-roles.js';
import { setStat, setMeta, setRank, setStatus } from '../../src/combat-edit.js';
import { STATUS_RUNGS, STATUS_DEFAULT } from '../../src/combat-status.js';
import { getTypeData, hasTypeData, emptyTypeData } from '../../src/combat-store.js';
import { detectLegacy, legacyPreviewData } from '../../src/combat-migrate.js';
import {
    combatPrefs, allTypes, activeCombatType, setActiveCombatType, setCombatEnabled,
    personaRecordFor, isCombatDisabled, isCombatHidden,
} from '../../src/combat-access.js';
import { renderMigrationList, openLegacyMigration } from './migration-ui.js';
import { renderAbilityEditor } from '../../src/ui-abilities.js';
import { renderArmoury } from '../../src/ui-armoury.js';
import { renderHistoryView } from '../../src/ui-history-inject.js';
import { renderCombatButton } from './combat-window.js';
import { renderTypeEditor, startDraft, deleteCustomType, importTypeFile, exportTypeFile } from './type-editor.js';

import { PRODUCT_NAME } from '../../src/constants.js';
/**
 * The Combat tab (fork), base module: pick a world type, see how it maps roles to its own
 * stats, and read every character's numbers under it. Read-only: nothing here writes to a
 * character. Numbers found in the old places (the flat statusOverrides keys) are shown in
 * italics and marked legacy until a later step migrates them.
 *
 * Reads roles and the type's own labels; it never names a stat.
 */

/** How many old keys must match before a record is shown as having legacy combat data. */
const LEGACY_MIN_MATCHES = 3;

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

/**
 * Makes a roster cell editable on click: a number box, a text box, or a rank list, by what the
 * cell holds. Enter or leaving the box saves; Escape cancels. Rows still read from the old keys
 * cannot be edited until they are copied over, since the edit would have nowhere to go.
 */
function makeEditable(td, { record, type, kind, id, legacy, rerender }) {
    td.classList.add('is-editable');
    td.addEventListener('click', () => {
        if (td.querySelector('input, select')) return;
        if (legacy) { toastr.info('Copy this character over first, then the cells can be edited.', PRODUCT_NAME); return; }

        const data = getTypeData(record, type.dataKey);
        let input;
        if (kind === 'status') {
            input = el('select', 'text_pole');
            for (const g of [...STATUS_RUNGS].reverse()) input.append(new Option(g, g));
            input.value = data.status || STATUS_DEFAULT;
        } else if (kind === 'rank') {
            const prof = type.proficiencies.find(p => p.id === id);
            input = el('select', 'text_pole');
            input.append(new Option('-', ''));
            for (const rung of ladderOf(type, prof.ladder).rungs) input.append(new Option(rung, rung));
            input.value = data.profs[id]?.rank ?? '';
        } else {
            const metaDef = kind === 'meta' ? type.meta.find(m => m.id === id) : null;
            if (metaDef?.type === 'choice') {
                input = el('select', 'text_pole');
                input.append(new Option('-', ''));
                for (const o of metaDef.options || []) input.append(new Option(o, o));
                input.value = data.meta[id] ?? '';
            } else {
                input = el('input', 'text_pole');
                input.type = kind === 'stat' || metaDef?.type === 'number' ? 'number' : 'text';
                input.value = (kind === 'stat' ? data.stats[id] : data.meta[id]) ?? '';
            }
        }
        input.classList.add('sillynpc-combat-cell-input');
        td.replaceChildren(input);
        input.focus();

        let done = false;
        const finish = (save) => {
            if (done) return;
            done = true;
            if (save) {
                const result = kind === 'status' ? setStatus(record, type, input.value)
                    : kind === 'stat' ? setStat(record, type, id, input.value)
                    : kind === 'meta' ? setMeta(record, type, id, input.value)
                        : setRank(record, type, id, input.value);
                if (!result.ok) toastr.warning(result.reason, PRODUCT_NAME);
                else saveSettings();
            }
            rerender();
        };
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') finish(true);
            else if (e.key === 'Escape') finish(false);
        });
        input.addEventListener('blur', () => finish(true));
    });
}

function badge(text, kind) {
    return el('span', `sillynpc-combat-badge is-${kind}`, text);
}

/* --------------------------------------------------------------- settings view */

function renderSettings(host, rerender) {
    const prefs = combatPrefs();
    const types = allTypes();

    const row = el('div', 'sillynpc-setting-row');
    row.append(el('label', '', 'World type'));
    const select = el('select', 'text_pole');
    const none = el('option', '', '- pick a world type -');
    none.value = '';
    select.append(none);
    for (const { type, errors } of types) {
        const option = el('option', '', `${type.name}${type.builtin ? ' (built-in)' : ''}${errors.length ? ' - has errors' : ''}`);
        option.value = type.id;
        if (errors.length) option.disabled = true;
        select.append(option);
    }
    select.value = prefs.activeType;
    select.addEventListener('change', () => { setActiveCombatType(select.value); renderCombatButton(); rerender(); });
    row.append(select);
    host.append(row);

    const note = el('small', 'notes',
        'Each System remembers its own world type. A new System starts with none picked.');
    host.append(note);

    const type = activeCombatType();
    if (prefs.activeType && !type) {
        host.append(el('p', 'notes', 'The picked world type is missing or invalid, so nothing is shown. Pick another.'));
    }
    if (type) host.append(renderRoleTable(type));
    if (type) renderMigrationList(host, type, rerender);

    host.append(el('h4', 'sillynpc-combat-heading', 'World types'));
    host.append(renderTypeToolbar(host, types, rerender));
    const list = el('div', 'sillynpc-combat-types');
    for (const { type: t, errors, warnings } of types) {
        const item = el('div', 'sillynpc-combat-type');
        const head = el('div', 'sillynpc-combat-type-head');
        head.append(el('b', '', t.name));
        head.append(badge(t.builtin ? 'built-in' : 'custom', t.builtin ? 'muted' : 'info'));
        head.append(badge(errors.length ? `${errors.length} error${errors.length === 1 ? '' : 's'}` : 'valid',
            errors.length ? 'bad' : 'good'));
        item.append(head);
        if (t.description) item.append(el('small', 'notes', t.description));
        item.append(el('small', 'notes',
            `${t.stats.length} stats, ${t.proficiencies.length} proficiencies, ${t.channels.map(c => c.label).join(' / ')} damage.`));
        for (const message of [...errors, ...warnings]) {
            item.append(el('small', errors.includes(message) ? 'sillynpc-combat-problem' : 'notes', message));
        }
        item.append(renderTypeActions(host, t, rerender));
        list.append(item);
    }
    host.append(list);
}

/** Opens the world type editor in place of the settings view; Save or Cancel brings the view back. */
function openEditor(host, rerender, { start, editing }) {
    host.replaceChildren();
    renderTypeEditor(host, { start, editing, onDone: () => { host.replaceChildren(); rerender(); } });
}

/** Make your own world type: from a small starter, or from a copy of any existing one. */
function renderTypeToolbar(host, types, rerender) {
    const bar = el('div', 'sillynpc-te-toolbar');
    bar.append(el('small', 'notes',
        'Make your own world type with its own stats, roles and rules. Start from a small blank starter, or copy a world that is already here and change it. Each field in the editor explains itself.'));
    const row = el('div', 'sillynpc-actions');
    const pick = el('select', 'text_pole');
    pick.append(new Option('Blank starter', ''));
    for (const { type } of types) pick.append(new Option(`Copy of ${type.name}`, type.id));
    const make = el('button', 'menu_button', 'Create a world type');
    make.type = 'button';
    make.addEventListener('click', () => openEditor(host, rerender, { start: startDraft(pick.value), editing: false }));
    const load = el('button', 'menu_button', 'Import a world type file');
    load.type = 'button';
    load.title = 'Add a world type someone shared with you (a .json file)';
    load.addEventListener('click', () => importTypeFile(rerender));
    row.append(pick, make, load);
    bar.append(row);
    return bar;
}

/** Copy, and for custom types edit and delete. */
function renderTypeActions(host, type, rerender) {
    const row = el('div', 'sillynpc-actions');
    const button = (label, title, onClick) => {
        const b = el('button', 'menu_button', label);
        b.type = 'button';
        b.title = title;
        b.addEventListener('click', onClick);
        row.append(b);
    };
    if (!type.builtin) {
        button('Edit', 'Change this world type', () => openEditor(host, rerender, { start: startDraft(type.id), editing: true }));
    }
    if (!type.builtin) button('Export', 'Save this world type as a file to share', () => exportTypeFile(type));
    button('Copy', 'Make an editable copy', () => openEditor(host, rerender, { start: startDraft(type.id), editing: false }));
    if (!type.builtin) {
        button('Delete', 'Remove this world type. Characters keep their numbers for it.', () => {
            if (!window.confirm(`Delete ${type.name}? Characters keep their saved numbers for it.`)) return;
            deleteCustomType(type.id);
            if (combatPrefs().activeType === type.id) setActiveCombatType('');
            renderCombatButton();
            rerender();
        });
    }
    return row;
}

/** Which stat or formula fills each role, in the world's own words. */
function renderRoleTable(type) {
    const wrap = el('div', 'sillynpc-combat-roles');
    wrap.append(el('h4', 'sillynpc-combat-heading', `How ${type.name} fills each role`));

    const table = el('table', 'sillynpc-combat-table');
    const head = el('tr');
    for (const text of ['Role', 'Called here', 'Comes from']) head.append(el('th', '', text));
    table.append(head);

    const add = (role, called, source) => {
        const tr = el('tr');
        tr.append(el('td', '', role), el('td', '', called), el('td', 'sillynpc-combat-formula', source));
        table.append(tr);
    };

    for (const pool of type.pools) {
        add(POOL_ROLES[pool.role]?.label || pool.role, pool.label, pool.max);
    }
    for (const [id, def] of Object.entries(STAT_ROLES)) {
        const binding = type.roles[id];
        if (!binding) continue;
        if (def.channeled) {
            for (const channel of type.channels) {
                if (binding[channel.id]) {
                    add(`${def.label} (${channel.label})`, roleLabel(type, id, channel.id), binding[channel.id]);
                }
            }
        } else {
            add(def.label, roleLabel(type, id), binding);
        }
    }
    wrap.append(table);

    const caps = capabilities(type);
    const missing = [];
    if (!caps.followUps) missing.push('no Speed: initiative is a plain roll and there are no follow-ups');
    if (!caps.guardPool) missing.push('no guard pool: sparring damages health');
    if (!caps.resourcePool) missing.push('no resource pool: techniques cost nothing');
    if (missing.length) wrap.append(el('small', 'notes', `Not bound in this type: ${missing.join('; ')}.`));
    return wrap;
}

/* ----------------------------------------------------------------- roster view */

/** The data to show for a record: stored combat data, else legacy values, else nothing. */
function dataFor(record, type) {
    if (hasTypeData(record, type.dataKey)) return { data: getTypeData(record, type.dataKey), legacy: false };
    const found = detectLegacy(record, type);
    if (found.matches.length >= LEGACY_MIN_MATCHES) {
        return { data: legacyPreviewData(record, type), legacy: true };
    }
    return { data: null, legacy: false };
}

let showHidden = false;

function rosterRecords() {
    const list = [];
    let playerRecord = null;
    try {
        const card = getPlayerCard();
        if (card?.name) {
            // A persona character with the player's name stands in for the card: same stats.
            playerRecord = personaRecordFor(card.name) || card;
            list.push({ record: playerRecord, player: true });
        }
    } catch { /* no persona yet */ }
    for (const record of getSettings().characters || []) {
        if (!record?.name || record === playerRecord) continue;
        if (isCombatHidden(record) && !showHidden) continue;
        list.push({ record, player: false });
    }
    return list;
}

function renderRoster(host, rerender) {
    const type = activeCombatType();
    if (!type) {
        host.append(el('p', 'notes', 'Pick a world type in Settings to see the roster.'));
        return;
    }

    const rows = rosterRecords().map(item => ({ ...item, ...dataFor(item.record, type) }));
    if (!rows.length) {
        host.append(el('p', 'notes', 'There are no characters yet.'));
        return;
    }

    const channel = type.channels[0]?.id;
    const caps = capabilities(type);
    const pinned = [
        { label: roleLabel(type, 'health'), value: c => c.pools.health?.max },
        { label: roleLabel(type, 'attack', channel), value: c => Math.round(c.role('attack', channel)) },
        { label: roleLabel(type, 'defense', channel), value: c => Math.round(c.role('defense', channel)) },
    ];
    if (caps.initiative) pinned.push({ label: roleLabel(type, 'speed'), value: c => Math.round(c.role('speed')) });

    // Only proficiencies somebody actually holds, so a type with thirty of them stays readable.
    const held = new Set();
    for (const row of rows) {
        for (const [id, p] of Object.entries(row.data?.profs || {})) if (p?.rank) held.add(id);
    }
    const profs = type.proficiencies.filter(p => held.has(p.id));

    const scroller = el('div', 'sillynpc-combat-scroll');
    const table = el('table', 'sillynpc-combat-table sillynpc-combat-roster');

    const head = el('tr');
    head.append(el('th', '', 'Name'));
    head.append(el('th', '', 'On'));
    for (const col of pinned) head.append(el('th', 'is-pinned', col.label));
    for (const s of type.stats) {
        const th = el('th', '', s.abbr || s.label);
        th.title = s.label;
        head.append(th);
    }
    head.append(el('th', '', 'Status'));
    for (const m of type.meta) head.append(el('th', '', m.label));
    for (const p of profs) {
        const th = el('th', 'is-prof', p.abbr || p.label);
        th.title = p.label;
        head.append(th);
    }
    table.append(head);

    for (const { record, player, data: rowData, legacy } of rows) {
        const tr = el('tr', legacy ? 'is-legacy' : '');
        const name = el('td', 'sillynpc-combat-name', record.name);
        if (player) name.append(badge('you', 'info'));
        if (legacy) name.append(badge('legacy, not migrated', 'muted'));
        tr.append(name);
        if (isCombatDisabled(record)) tr.classList.add('is-disabled');
        if (isCombatHidden(record)) name.append(badge('hidden', 'muted'));

        const ctl = el('td', 'sillynpc-combat-ctl');
        if (!player) {
            const box = el('input');
            box.type = 'checkbox';
            box.checked = !isCombatDisabled(record);
            box.title = 'Off: not offered as an opponent';
            box.addEventListener('change', () => { record.combatDisabled = !box.checked; saveSettings(); rerender(); });
            ctl.append(box);
            const hide = el('button', 'menu_button', isCombatHidden(record) ? 'Restore' : '✕');
            hide.type = 'button';
            hide.title = isCombatHidden(record) ? 'Show in the roster again' : 'Remove from the roster (the character is kept)';
            hide.addEventListener('click', () => { record.combatHidden = !isCombatHidden(record); saveSettings(); rerender(); });
            ctl.append(hide);
        }
        tr.insertBefore(ctl, tr.children[1] || null);

        // No data yet: show blank, editable cells. The first edit creates the block.
        const data = rowData || emptyTypeData();

        const c = project(data, type);
        for (const col of pinned) tr.append(el('td', 'is-pinned', String(col.value(c) ?? '-')));
        for (const s of type.stats) {
            const has = data.stats[s.id] !== undefined;
            const td = el('td', has ? '' : 'is-blank', has ? String(data.stats[s.id]) : '-');
            makeEditable(td, { record, type, kind: 'stat', id: s.id, legacy, rerender });
            tr.append(td);
        }
        {
            const td = el('td', '', data.status || STATUS_DEFAULT);
            makeEditable(td, { record, type, kind: 'status', id: 'status', legacy, rerender });
            tr.append(td);
        }
        for (const m of type.meta) {
            const v = data.meta[m.id];
            const td = el('td', v === undefined ? 'is-blank' : '', v === undefined ? '-' : String(v));
            makeEditable(td, { record, type, kind: 'meta', id: m.id, legacy, rerender });
            tr.append(td);
        }
        for (const p of profs) {
            const rank = data.profs[p.id]?.rank;
            const td = el('td', rank ? '' : 'is-blank', rank || '-');
            makeEditable(td, { record, type, kind: 'rank', id: p.id, legacy, rerender });
            tr.append(td);
        }
        table.append(tr);
    }
    scroller.append(table);
    host.append(scroller);

    const hiddenCount = (getSettings().characters || []).filter(isCombatHidden).length;
    if (hiddenCount) {
        const toggle = el('button', 'menu_button', showHidden ? 'Hide removed characters' : `Show ${hiddenCount} removed`);
        toggle.type = 'button';
        toggle.addEventListener('click', () => { showHidden = !showHidden; rerender(); });
        host.append(toggle);
    }

    const legacyCount = rows.filter(r => r.legacy).length;
    if (legacyCount) {
        const note = el('div', 'sillynpc-combat-banner');
        note.append(el('span', '', `${legacyCount} character${legacyCount === 1 ? ' has' : 's have'} combat data in the old keys (italic rows). `
            + 'Nothing has been moved yet.'));
        const button = el('button', 'menu_button', 'Copy it over...');
        button.type = 'button';
        button.addEventListener('click', () => openLegacyMigration(type, rerender));
        note.append(button);
        host.prepend(note);
    }
}

/* ------------------------------------------------------------------------ pane */

const VIEWS = [
    { id: 'settings', label: 'Settings', render: renderSettings },
    { id: 'roster', label: 'Roster', render: renderRoster },
    { id: 'abilities', label: 'Abilities', render: renderAbilityEditor },
    { id: 'armoury', label: 'Armoury', render: renderArmoury },
    { id: 'history', label: 'History', render: renderHistoryView },
];
let activeView = 'settings';

/**
 * @param {HTMLElement} pane
 * @param {{ live: boolean, head: HTMLElement, makeSwitch: Function }} ctx
 *   live is false while the search index draws every tab offscreen; only headings then.
 */
export function renderCombatPane(pane, { live, head, makeSwitch }) {
    if (typeof makeSwitch === 'function') {
        head.append(makeSwitch(combatPrefs().enabled, (on) => { setCombatEnabled(on); renderCombatButton(); }));
    }

    const bar = el('div', 'sillynpc-combat-views');
    const body = el('div', 'sillynpc-combat-body');
    pane.append(bar, body);

    if (!live) {
        for (const view of VIEWS) bar.append(el('span', 'sillynpc-combat-view', view.label));
        return;
    }

    const draw = () => {
        bar.replaceChildren();
        body.replaceChildren();
        for (const view of VIEWS) {
            const button = el('button', `menu_button sillynpc-combat-view${view.id === activeView ? ' is-active' : ''}`, view.label);
            button.type = 'button';
            button.addEventListener('click', () => { activeView = view.id; draw(); });
            bar.append(button);
        }
        VIEWS.find(v => v.id === activeView).render(body, draw);
    };
    draw();
}
