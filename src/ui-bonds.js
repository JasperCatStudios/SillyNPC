import { eventSource } from '../../../../events.js';
import { Popup } from '../../../../popup.js';
import { getActiveCharacters } from './characters.js';
import { buildSettingToggle, buildSettingSelect, buildSettingNumber, buildSettingTextArea } from './ui-shared.js';
import { buildConnectionProfilePicker } from './ui-connection-profiles.js';
import { mountVectorPanel } from './ui-vectors.js';
import {
    bondSettings, saveBondSettings, chatStore, editPerson, removePerson, runBondUpdate,
    latestReplyId, currentBondInjection, todayForMilestone, playerName, BONDS_CHANGED_EVENT,
} from './bonds.js';
import {
    BOND_TIMINGS, GATE_KINDS, NEVER, INJECT_POSITIONS, INJECT_ROLES, INJECT_TRIGGERS, INJECT_ORDERS,
    BOND_DEFAULTS, BOND_SYSTEM, DEFAULT_LEVELS, DEFAULT_GATES, DEFAULT_MILESTONES,
    METERS, METER_LABELS, BOND_LOCKS,
    levelFor, gateText, normalizePerson, addMilestone, editMilestone, removeMilestone,
    toggleMilestone, hasMilestone, newId, platonicValue, setMeter,
} from './bonds-core.js';

/**
 * The Bonds tab (fork): the Bond Tracker's switches, its rules, and the bonds of the open chat.
 *
 * Ordered by how often each part is touched: what it does and when, then the people in this
 * story, then the rules that are set once (growth, levels and gates, milestones), then how it
 * reaches the story prompt.
 */

/** People whose history is open, by lowercased name. Survives redraws, not reopening the menu. */
const expanded = new Set();
/** People whose "your side" panel is open, the same way. */
const sideOpen = new Set();
let currentView = null;
let listening = false;

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

const button = (label, icon, title, onClick, extra = '') => {
    const b = el('button', `menu_button snpc-bond-btn ${extra}`.trim());
    b.type = 'button';
    if (icon) b.append(el('i', `fa-solid ${icon}`));
    if (label) b.append(el('span', '', label));
    if (title) b.title = title;
    b.addEventListener('click', (e) => { e.preventDefault(); onClick(e); });
    return b;
};

const iconButton = (icon, title, onClick, extra = '') => {
    const b = el('div', `menu_button menu_button_icon snpc-bond-icon fa-solid ${icon} ${extra}`.trim());
    b.title = title;
    b.tabIndex = 0;
    b.addEventListener('click', (e) => { e.preventDefault(); onClick(e); });
    return b;
};

function input(type, value, onCommit, { placeholder = '', min, max, step } = {}) {
    const i = el('input', 'text_pole');
    i.type = type;
    i.value = value ?? '';
    if (placeholder) i.placeholder = placeholder;
    if (min !== undefined) i.min = String(min);
    if (max !== undefined) i.max = String(max);
    if (step !== undefined) i.step = String(step);
    i.addEventListener('change', () => onCommit(type === 'number' ? Number(i.value) : i.value));
    return i;
}

function select(table, value, onChange) {
    const s = el('select', 'text_pole');
    for (const [k, v] of Object.entries(table)) s.append(new Option(v, k));
    s.value = value;
    s.addEventListener('change', () => onChange(s.value));
    return s;
}

/** A settings card holding one labelled control, laid out like every other setting. */
function card(label, control, help) {
    const wrap = el('div', 'sillynpc-setting');
    const row = el('div', 'sillynpc-setting-row');
    row.append(el('label', 'sillynpc-setting-label', label), control);
    wrap.append(row);
    if (help) wrap.append(el('small', 'notes', help));
    return wrap;
}

/** A toggle chip: one pressed state, readable at a glance in a row of them. */
function chip(label, on, title, onToggle) {
    const b = el('button', `snpc-bond-chip${on ? ' is-on' : ''}`);
    b.type = 'button';
    b.title = title;
    b.setAttribute('aria-pressed', String(on));
    b.append(el('i', `fa-solid ${on ? 'fa-check' : 'fa-xmark'}`), el('span', '', label));
    b.addEventListener('click', (e) => { e.preventDefault(); onToggle(!on); });
    return b;
}

/** The builders in ui-shared, aimed at settings.bonds instead of SillyNPC's root. */
const STORE = { get: () => bondSettings(), save: () => saveBondSettings(), defaults: BOND_DEFAULTS };
/** Search keys are namespaced so "enabled" here never answers for SillyNPC's own switch. */
function namespaced(node) {
    if (node?.dataset?.setting) node.dataset.setting = `bonds.${node.dataset.setting}`;
    return node;
}

/** Changes the settings through a fresh reference: normalising replaces the object. */
function updateSettings(change, redraw) {
    const s = bondSettings();
    change(s);
    saveBondSettings();
    if (redraw) redraw();
}

/* ---- the tab ------------------------------------------------------------------------- */

export function renderBondsView(view) {
    if (!view) return;
    // The search box draws every tab into a detached node; only a real tab is redrawn on change.
    if (view.isConnected || !currentView?.isConnected) currentView = view;
    if (!listening) {
        listening = true;
        eventSource.on(BONDS_CHANGED_EVENT, () => {
            if (currentView?.isConnected && !currentView.contains(document.activeElement)) renderBondsView(currentView);
        });
    }

    const scroll = view.closest('.sillynpc-tab-panel')?.scrollTop ?? 0;
    view.replaceChildren();
    view.classList.add('snpc-bonds');
    const rerender = () => renderBondsView(view);

    const title = el('h3', 'sillynpc-section-title', 'Bond Tracker');
    view.append(title);
    view.append(el('p', 'notes sillynpc-tab-intro',
        'Tracks how close each character is to you, how fast that may change, and what each level of closeness allows - '
        + 'with a dated history of the moments that marked it. Bonds are kept per chat. The model only proposes a change; '
        + 'the growth rules below decide how much of it happens.'));

    renderGeneral(view, rerender);
    if (!bondSettings().enabled) {
        view.append(el('p', 'notes snpc-bond-off', 'The tracker is off: nothing is read, changed or sent to the story. '
            + 'Everything below can still be set up, and the bonds already recorded are kept.'));
    }
    renderPeople(view, rerender);
    renderGrowth(view, rerender);
    renderLevels(view, rerender);
    renderGates(view, rerender);
    renderMilestonePresets(view, rerender);
    renderInjection(view, rerender);
    // Which milestones fill the history slots, and the list of what is vectorized. See ui-vectors.js.
    const vectors = el('div');
    view.append(vectors);
    mountVectorPanel(vectors, 'bonds');

    const panel = view.closest('.sillynpc-tab-panel');
    if (panel) panel.scrollTop = scroll;
}

/* ---- what it does and when ----------------------------------------------------------- */

function renderGeneral(view, rerender) {
    view.append(namespaced(buildSettingToggle({
        store: STORE,
        key: 'enabled',
        label: 'Track Bonds',
        help: 'The master switch. Off: no requests, no changes, nothing in the story prompt.',
        onChange: rerender,
    })));
    view.append(namespaced(buildSettingSelect({
        store: STORE,
        key: 'timing',
        label: 'When Bonds Update',
        help: 'After The Reply: a separate request on the Bonds connection reads each new reply. '
            + 'With The Reply: the story model is asked to add a hidden block, which is taken out of the text before you see it '
            + '(cheapest, but it spends story tokens and a weak model may forget it). '
            + 'Only When I Press Update: nothing happens on its own; use the Update buttons below.',
        options: Object.entries(BOND_TIMINGS).map(([value, label]) => ({ value, label })),
        onChange: rerender,
    })));
    const timing = bondSettings().timing;
    if (timing !== 'inline') {
        view.append(buildConnectionProfilePicker(null, {
            key: 'bondProfileId',
            scope: 'root',
            labelText: 'Bonds Connection',
            fallbackLabel: 'Main API (same as chat)',
            noteText: 'Which connection reads replies for bond changes. A small, fast model is enough.',
            unavailableText: 'Connection Manager is not available, so the main API is used.',
        }));
        view.append(namespaced(buildSettingNumber({
            store: STORE,
            key: 'maxTokens',
            label: 'Reply Budget',
            suffix: 'tokens',
            help: 'The reply is a small JSON object; 800 is plenty.',
        })));
        view.append(namespaced(buildSettingNumber({
            store: STORE,
            key: 'contextMessages',
            label: 'Earlier Messages Read',
            suffix: 'messages',
            advanced: true,
            help: 'How many messages before the new reply the reader is shown, for context.',
        })));
        view.append(namespaced(buildSettingTextArea({
            store: STORE,
            key: 'prompt',
            advanced: true,
            label: 'Reader Instructions',
            help: 'The system prompt of the separate request. Empty uses the built-in. The rules, levels and milestones are always added after it.',
            recommended: BOND_SYSTEM,
            emptyNote: 'The built-in instructions are sent.',
            showTokens: true,
        })));
    }
}

/* ---- the people in this chat --------------------------------------------------------- */

function renderPeople(view, rerender) {
    view.append(el('h3', 'sillynpc-section-title', 'Characters In This Chat'));
    const store = chatStore();
    if (!store) {
        view.append(el('p', 'notes', 'Open a chat to see and edit its bonds.'));
        return;
    }
    const settings = bondSettings();

    const bar = el('div', 'snpc-bond-toolbar');
    const updateAll = button('Update all now', 'fa-arrows-rotate', 'Read the newest reply again and apply what it changes (replaces what that reply did before)', async () => {
        const id = latestReplyId();
        if (id < 0) { toastr.info('There is no reply to read yet.', 'SillyNPC'); return; }
        updateAll.disabled = true;
        await runBondUpdate(id, { force: true, button: true });
        rerender();
    });
    updateAll.disabled = !settings.enabled;
    const name = input('text', '', () => {}, { placeholder: 'Add someone by name' });
    const add = button('Add', 'fa-plus', 'Start tracking this person', () => {
        const n = name.value.trim();
        if (!n) return;
        editPerson(n, () => {});
        expanded.add(n.toLowerCase());
        rerender();
    });
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') add.click(); });
    bar.append(updateAll, el('span', 'snpc-bond-spacer'), name, add);
    view.append(bar);

    // Everyone tracked, then this chat's characters who have no bond yet, shown at the start value.
    const people = [...store.people];
    for (const c of getActiveCharacters()) {
        if (c?.name && !people.some(p => p.name.toLowerCase() === c.name.toLowerCase())) {
            people.push({ ...normalizePerson({ name: c.name }, settings.growth), untracked: true });
        }
    }
    if (!people.length) {
        view.append(el('p', 'notes', 'Nobody yet. People are added as the tracker meets them, or by name above.'));
        return;
    }
    people.sort((a, b) => Number(Boolean(a.untracked)) - Number(Boolean(b.untracked)) || b.value - a.value || a.name.localeCompare(b.name));
    const list = el('div', 'snpc-bond-people');
    for (const p of people) list.append(personCard(p, settings, rerender));
    view.append(list);
}

function personCard(person, settings, rerender) {
    const key = person.name.toLowerCase();
    const open = expanded.has(key);
    const { level, next } = levelFor(person.value, settings.levels);
    const wrap = el('div', `snpc-bond-person${person.tracked ? '' : ' is-off'}${person.untracked ? ' is-new' : ''}`);

    const head = el('div', 'snpc-bond-head');
    const toggle = iconButton(open ? 'fa-chevron-down' : 'fa-chevron-right', open ? 'Hide history' : 'Show history and milestones', () => {
        if (open) expanded.delete(key); else expanded.add(key);
        rerender();
    }, 'snpc-bond-caret');
    const who = el('div', 'snpc-bond-who');
    who.append(el('span', 'snpc-bond-name', person.name));
    who.append(el('span', 'snpc-bond-level', person.untracked ? 'Not tracked yet' : level.name));

    // The character's own edge: three meters. The level comes from the lower of affection and trust.
    const meters = el('div', 'snpc-bond-meters');
    for (const k of METERS) meters.append(meterRow(person, 'toPlayer', k, settings, rerender));
    meters.title = next
        ? `${level.name} (the lower of affection and trust). ${next.name} at ${next.min}.`
        : `${level.name}, the top level.`;

    // Stored only for now: what this bond may become.
    const lock = select(BOND_LOCKS, person.lock || 'open', (v) => {
        editPerson(person.name, (p) => { p.lock = v; });
        rerender();
    });
    lock.classList.add('snpc-bond-lock');
    lock.title = 'What this bond may become: open, platonic only, or family';

    const chips = el('div', 'snpc-bond-chips');
    chips.append(
        chip('Track', person.tracked, 'Off: never updated automatically and never sent to the story. The bond is kept.', (on) => {
            editPerson(person.name, (p) => { p.tracked = on; }); rerender();
        }),
        chip('Send level', person.inject.level, 'Send their bond level to the story', (on) => {
            editPerson(person.name, (p) => { p.inject.level = on; }); rerender();
        }),
        chip('Send gates', person.inject.gates, 'Send what is and is not allowed at their level', (on) => {
            editPerson(person.name, (p) => { p.inject.gates = on; }); rerender();
        }),
        chip('Send history', person.inject.history, 'Send their milestones to the story. This does not open the history: use the History button.', (on) => {
            editPerson(person.name, (p) => { p.inject.history = on; }); rerender();
        }),
    );

    // The way in to the history: its own labelled button, and the name opens it too.
    const openHistory = () => { if (open) expanded.delete(key); else expanded.add(key); rerender(); };
    const histBtn = el('button', `menu_button snpc-bond-histbtn${open ? ' is-open' : ''}`, `${open ? 'Hide' : 'View'} history (${person.history.length})`);
    histBtn.type = 'button';
    histBtn.title = open ? 'Hide the history and milestones' : 'Show the history and milestones';
    histBtn.addEventListener('click', openHistory);
    who.querySelector('.snpc-bond-name').style.cursor = 'pointer';
    who.querySelector('.snpc-bond-name').addEventListener('click', openHistory);

    const actions = el('div', 'snpc-bond-actions');
    actions.append(histBtn);
    const update = iconButton('fa-arrows-rotate', `Update ${person.name} now from the newest reply`, async () => {
        const id = latestReplyId();
        if (id < 0) { toastr.info('There is no reply to read yet.', 'SillyNPC'); return; }
        update.classList.add('fa-spin');
        await runBondUpdate(id, { force: true, button: true, only: person.name });
        rerender();
    });
    if (!settings.enabled || !person.tracked) update.classList.add('disabled');
    actions.append(update);
    if (!person.untracked) {
        actions.append(iconButton('fa-trash-can', `Forget ${person.name}'s bond in this chat`, async () => {
            const ok = await Popup.show.confirm('Forget this bond?', `${person.name}'s bond and milestones in this chat will be deleted.`);
            if (!ok) return;
            removePerson(person.name);
            rerender();
        }, 'snpc-bond-danger'));
    }

    head.append(toggle, who, meters, lock, chips, actions);
    wrap.append(head);
    wrap.append(playerSide(person, settings, rerender));
    if (open) wrap.append(personBody(person, settings, rerender));
    return wrap;
}

/** One meter of one edge: a bar (with level ticks for affection and trust) and a number to set it by hand. */
function meterRow(person, dir, meter, settings, rerender) {
    const g = settings.growth;
    const v = Number(person.edges?.[dir]?.[meter]) || 0;
    const row = el('div', 'snpc-bond-meterrow');
    const bar = el('div', `snpc-bond-meter snpc-bond-meter-${meter}`);
    const fill = el('div', 'snpc-bond-fill');
    fill.style.width = `${Math.max(0, Math.min(100, ((v - g.min) / (g.max - g.min)) * 100))}%`;
    bar.append(fill);
    // Thresholds as ticks on the two meters the level is read from.
    if (meter !== 'respect') {
        for (const l of settings.levels) {
            if (l.min <= g.min || l.min >= g.max) continue;
            const tick = el('span', 'snpc-bond-tick');
            tick.style.left = `${((l.min - g.min) / (g.max - g.min)) * 100}%`;
            tick.title = `${l.name} at ${l.min}`;
            bar.append(tick);
        }
    }
    const box = input('number', v, (nv) => {
        if (!Number.isFinite(nv)) return;
        editPerson(person.name, (p) => { setMeter(p, dir, meter, Math.round(nv * 10) / 10, g); });
        rerender();
    }, { min: g.min, max: g.max, step: 1 });
    box.classList.add('snpc-bond-value');
    box.title = `Set ${METER_LABELS[meter].toLowerCase()} by hand (${g.min} to ${g.max})`;
    row.append(el('span', 'snpc-bond-meterlabel', METER_LABELS[meter]), bar, box);
    return row;
}

/** The player's side of the bond: collapsed, set by hand only, read by the model as context. */
function playerSide(person, settings, rerender) {
    const key = person.name.toLowerCase();
    const you = playerName();
    const side = el('details', 'snpc-bond-side');
    side.open = sideOpen.has(key);
    side.addEventListener('toggle', () => { if (side.open) sideOpen.add(key); else sideOpen.delete(key); });
    const level = levelFor(platonicValue(person.edges?.fromPlayer), settings.levels).level;
    side.append(el('summary', 'snpc-bond-side-summary', `${you}'s side: ${level.name}`));
    side.append(el('small', 'notes', `How ${you} feels about ${person.name}. Set by hand only: the model is told it, but never changes it.`));
    const rows = el('div', 'snpc-bond-meters');
    for (const k of METERS) rows.append(meterRow(person, 'fromPlayer', k, settings, rerender));
    side.append(rows);
    return side;
}

function personBody(person, settings, rerender) {
    const body = el('div', 'snpc-bond-body');
    if (person.lastReason) body.append(el('p', 'notes snpc-bond-reason', `Last change: ${person.lastReason}`));
    if (person.legacy) {
        body.append(el('p', 'notes', `Brought over from Internal States (BOND ${person.legacy.bond}, Sparks ${person.legacy.sparks}, Grudge ${person.legacy.grudge}).`));
    }
    const gates = gateText(person.value, settings.gates, settings.levels, { showLocked: true });
    if (gates) body.append(el('p', 'notes snpc-bond-gates', gates));

    // Presets as a checklist: ticking records it with today's date, unticking removes it.
    body.append(el('div', 'snpc-bond-subhead', 'Milestones'));
    const checklist = el('div', 'snpc-bond-checklist');
    for (const preset of settings.milestones) {
        const has = hasMilestone(person, preset.id);
        checklist.append(chip(preset.label, has, has ? 'Recorded. Click to remove it.' : `Record it now${preset.hint ? `: ${preset.hint}` : ''}`, () => {
            editPerson(person.name, (p) => { toggleMilestone(p, preset.id, settings.milestones, { ...todayForMilestone() }); });
            rerender();
        }));
    }
    body.append(checklist);

    body.append(el('div', 'snpc-bond-subhead', 'History'));
    const table = el('div', 'snpc-bond-table snpc-bond-history');
    const header = el('div', 'snpc-bond-tr snpc-bond-th');
    header.append(el('span', '', 'Date'), el('span', '', 'Milestone'), el('span', '', 'Note'), el('span', '', ''));
    table.append(header);
    const history = [...person.history].reverse();
    if (!history.length) {
        const empty = el('div', 'snpc-bond-tr snpc-bond-empty');
        empty.append(el('span', 'notes', 'Nothing recorded yet.'));
        table.append(empty);
    }
    for (const m of history) {
        const tr = el('div', 'snpc-bond-tr');
        const date = input('text', m.date, (v) => { editPerson(person.name, (p) => editMilestone(p, m.id, { date: v })); rerender(); }, { placeholder: 'Date' });
        date.title = { story: 'Story date', real: 'Real date (the story had no clock)', manual: 'Typed by hand' }[m.dateSource] || '';
        const label = input('text', m.label, (v) => { editPerson(person.name, (p) => editMilestone(p, m.id, { label: v })); rerender(); });
        if (m.auto) label.title = 'Recorded automatically';
        const note = input('text', m.note, (v) => { editPerson(person.name, (p) => editMilestone(p, m.id, { note: v })); }, { placeholder: 'Note' });
        const del = iconButton('fa-trash-can', 'Delete this milestone', () => {
            editPerson(person.name, (p) => removeMilestone(p, m.id));
            rerender();
        }, 'snpc-bond-danger');
        const labelCell = el('div', 'snpc-bond-cell');
        labelCell.append(label);
        if (m.auto) labelCell.append(el('i', 'fa-solid fa-wand-magic-sparkles snpc-bond-auto'));
        tr.append(date, labelCell, note, del);
        table.append(tr);
    }

    // Adding by hand: a preset or anything you like, dated today unless you say otherwise.
    const addRow = el('div', 'snpc-bond-tr snpc-bond-add');
    const type = el('select', 'text_pole');
    type.append(new Option('Custom milestone…', 'custom'));
    for (const p of settings.milestones) type.append(new Option(p.label, p.id));
    const today = todayForMilestone();
    const date = input('text', today.date, () => {}, { placeholder: 'Date' });
    const label = input('text', '', () => {}, { placeholder: 'What happened' });
    const note = input('text', '', () => {}, { placeholder: 'Note' });
    type.addEventListener('change', () => { label.style.display = type.value === 'custom' ? '' : 'none'; });
    const typeCell = el('div', 'snpc-bond-cell');
    typeCell.append(type, label);
    const add = iconButton('fa-plus', 'Add this milestone', () => {
        if (type.value === 'custom' && !label.value.trim()) { label.focus(); return; }
        editPerson(person.name, (p) => addMilestone(p, {
            type: type.value,
            label: type.value === 'custom' ? label.value : '',
            date: date.value,
            dateSource: date.value === today.date ? today.dateSource : 'manual',
            note: note.value,
        }, settings.milestones));
        rerender();
    });
    addRow.append(date, typeCell, note, add);
    table.append(addRow);
    body.append(table);
    return body;
}

/* ---- growth rules -------------------------------------------------------------------- */

function numberCell(label, path, hint, opts = {}) {
    const s = bondSettings();
    const [group, key] = path.split('.');
    const cell = el('label', 'snpc-bond-field');
    cell.title = hint;
    cell.append(el('span', 'snpc-bond-field-label', label));
    const box = el('div', 'snpc-bond-field-input');
    box.append(input('number', s[group][key], (v) => updateSettings(x => { x[group][key] = v; }), opts));
    if (opts.suffix) box.append(el('span', 'snpc-bond-suffix', opts.suffix));
    cell.append(box);
    return cell;
}

function renderGrowth(view, rerender) {
    view.append(el('h3', 'sillynpc-section-title', 'Growth Rules'));
    const g = bondSettings().growth;

    const scale = el('div', 'sillynpc-setting');
    scale.append(el('div', 'snpc-bond-subhead', 'Scale and limits per turn'));
    const grid = el('div', 'snpc-bond-grid');
    grid.append(
        numberCell('Lowest', 'growth.min', 'The bottom of the scale (0 or below).', { max: 0 }),
        numberCell('Highest', 'growth.max', 'The top of the scale.', { min: 1 }),
        numberCell('New people start at', 'growth.start', 'Where a bond starts the first time someone is tracked.'),
        numberCell('Most rise per turn', 'growth.maxGain', 'However warm a reply, a bond rises at most this much from it.', { min: 0, step: 0.5 }),
        numberCell('Most fall per turn', 'growth.maxLoss', 'Falls may be sharper than rises: trust breaks faster than it builds.', { min: 0, step: 0.5 }),
        numberCell('Slow down near the top', 'growth.slowdown', 'Rises shrink by up to this much as the bond nears the top, so the last levels take longest.', { min: 0, max: 95, suffix: '%' }),
    );
    scale.append(grid);
    scale.append(el('small', 'notes', 'The model proposes a change for each person after every reply; these limits decide how much of it happens.'));
    view.append(scale);

    const pace = el('div', 'sillynpc-setting');
    pace.append(el('div', 'snpc-bond-subhead', 'Pace over several turns'));
    const paceGrid = el('div', 'snpc-bond-grid');
    paceGrid.append(
        numberCell('Window', 'growth.windowTurns', 'How many turns the rolling limit looks back over. 0 turns it off.', { min: 0, suffix: 'turns' }),
        numberCell('Most rise in the window', 'growth.windowGain', 'However many good turns in a row, a bond rises at most this much within the window.', { min: 0 }),
    );
    pace.append(paceGrid);
    pace.append(el('small', 'notes', `Right now: at most +${g.windowGain} over any ${g.windowTurns || '∞'} turns${g.windowTurns ? '' : ' (off)'}.`));
    view.append(pace);

    view.append(namespaced(buildSettingToggle({
        store: STORE,
        key: 'growth.decay',
        label: 'Bonds Fade With Time Apart',
        help: 'People who go unseen for a while slowly drift back toward the floor. Off by default.',
        onChange: rerender,
    })));
    if (g.decay) {
        const decay = el('div', 'sillynpc-setting');
        const decayGrid = el('div', 'snpc-bond-grid');
        decayGrid.append(
            numberCell('Starts after', 'growth.decayAfter', 'Turns unseen before fading starts.', { min: 1, suffix: 'turns' }),
            numberCell('Then every', 'growth.decayEvery', 'How often it fades once it has started.', { min: 1, suffix: 'turns' }),
            numberCell('By', 'growth.decayAmount', 'How much each step takes.', { min: 0, step: 0.5 }),
            numberCell('Never below', 'growth.decayFloor', 'Fading stops here.'),
        );
        decay.append(decayGrid);
        view.append(decay);
    }

    view.append(namespaced(buildSettingTextArea({
        store: STORE,
        key: 'growth.raises',
        label: 'What Raises A Bond',
        help: 'One per line. Told to the model that proposes changes.',
    })));
    view.append(namespaced(buildSettingTextArea({
        store: STORE,
        key: 'growth.lowers',
        label: 'What Lowers A Bond',
        help: 'One per line. The model is told the biggest drops are for what you list last.',
    })));
}

/* ---- levels and gates ---------------------------------------------------------------- */

function renderLevels(view, rerender) {
    view.append(el('h3', 'sillynpc-section-title', 'Levels'));
    const s = bondSettings();
    const wrap = el('div', 'sillynpc-setting');
    wrap.append(el('small', 'notes', 'A person is at the highest level whose threshold their bond has reached. '
        + 'The description is what the story model is told about how they behave at that level.'));
    const table = el('div', 'snpc-bond-table snpc-bond-levels');
    const header = el('div', 'snpc-bond-tr snpc-bond-th');
    header.append(el('span', '', 'Level'), el('span', '', 'From'), el('span', '', 'How they behave'), el('span', '', ''));
    table.append(header);
    for (const level of s.levels) {
        const tr = el('div', 'snpc-bond-tr');
        const name = input('text', level.name, (v) => updateSettings(x => { const l = x.levels.find(y => y.id === level.id); if (l && v.trim()) l.name = v; }, rerender));
        const min = input('number', level.min, (v) => updateSettings(x => { const l = x.levels.find(y => y.id === level.id); if (l && Number.isFinite(v)) l.min = v; }, rerender));
        min.classList.add('snpc-bond-num');
        const desc = input('text', level.description, (v) => updateSettings(x => { const l = x.levels.find(y => y.id === level.id); if (l) l.description = v; }), { placeholder: 'How they act at this level' });
        const del = iconButton('fa-trash-can', 'Delete this level (gates on it move to the top level)', () => {
            if (s.levels.length <= 1) { toastr.info('There has to be at least one level.', 'SillyNPC'); return; }
            updateSettings(x => { x.levels = x.levels.filter(y => y.id !== level.id); }, rerender);
        }, 'snpc-bond-danger');
        tr.append(name, min, desc, del);
        table.append(tr);
    }
    wrap.append(table);

    const bar = el('div', 'snpc-bond-toolbar');
    bar.append(
        button('Add level', 'fa-plus', 'Add a level above the highest one', () => updateSettings(x => {
            const top = x.levels[x.levels.length - 1];
            x.levels.push({ id: newId('l'), name: 'New level', min: (top?.min ?? 0) + 10, description: '' });
        }, rerender)),
        el('span', 'snpc-bond-spacer'),
        button('Restore defaults', 'fa-rotate-left', 'Put back the built-in levels and gates', async () => {
            const ok = await Popup.show.confirm('Restore the default levels and gates?', 'Your levels and gates will be replaced. Bonds and milestones are not touched.');
            if (!ok) return;
            updateSettings(x => { x.levels = structuredClone(DEFAULT_LEVELS); x.gates = structuredClone(DEFAULT_GATES); }, rerender);
        }),
    );
    wrap.append(bar);
    view.append(wrap);
}

function renderGates(view, rerender) {
    view.append(el('h3', 'sillynpc-section-title', 'Gates: What Each Level Allows'));
    const s = bondSettings();
    const wrap = el('div', 'sillynpc-setting');
    wrap.append(el('small', 'notes', 'Each gate opens at a level and stays open above it. Intimacy gates are the physical and romantic steps; '
        + 'the story model is told what is allowed now and what is not yet, and is asked to keep to it.'));

    const levelOptions = { ...Object.fromEntries(s.levels.map(l => [l.id, `${l.name} (${l.min}+)`])), [NEVER]: 'Never' };
    for (const [kind, kindLabel] of Object.entries(GATE_KINDS)) {
        const mine = s.gates.filter(g => g.kind === kind);
        wrap.append(el('div', 'snpc-bond-subhead', kindLabel));
        const table = el('div', 'snpc-bond-table snpc-bond-gates-table');
        const header = el('div', 'snpc-bond-tr snpc-bond-th');
        header.append(el('span', '', 'What'), el('span', '', 'Kind'), el('span', '', 'Unlocks at'), el('span', '', ''));
        table.append(header);
        if (!mine.length) {
            const empty = el('div', 'snpc-bond-tr snpc-bond-empty');
            empty.append(el('span', 'notes', 'None.'));
            table.append(empty);
        }
        for (const gate of mine) {
            const tr = el('div', 'snpc-bond-tr');
            const label = input('text', gate.label, (v) => updateSettings(x => { const g = x.gates.find(y => y.id === gate.id); if (g && v.trim()) g.label = v; }));
            const kindSel = select(GATE_KINDS, gate.kind, (v) => updateSettings(x => { const g = x.gates.find(y => y.id === gate.id); if (g) g.kind = v; }, rerender));
            const levelSel = select(levelOptions, gate.level, (v) => updateSettings(x => { const g = x.gates.find(y => y.id === gate.id); if (g) g.level = v; }));
            const del = iconButton('fa-trash-can', 'Delete this gate', () => updateSettings(x => { x.gates = x.gates.filter(y => y.id !== gate.id); }, rerender), 'snpc-bond-danger');
            tr.append(label, kindSel, levelSel, del);
            table.append(tr);
        }
        wrap.append(table);
    }
    const bar = el('div', 'snpc-bond-toolbar');
    bar.append(button('Add gate', 'fa-plus', 'Add a rule about what a level allows', () => updateSettings(x => {
        x.gates.push({ id: newId('g'), label: 'New gate', kind: 'social', level: x.levels[x.levels.length - 1]?.id || NEVER });
    }, rerender)));
    wrap.append(bar);
    view.append(wrap);
}

/* ---- milestone presets --------------------------------------------------------------- */

function renderMilestonePresets(view, rerender) {
    view.append(el('h3', 'sillynpc-section-title', 'Milestones'));
    const s = bondSettings();
    const wrap = el('div', 'sillynpc-setting');
    wrap.append(el('small', 'notes', 'The moments worth remembering. Auto lets the per-turn update record one when it clearly happens; '
        + 'Once means it can only happen once per person. Any of them can be ticked or added by hand on a character above, '
        + 'dated by the story clock when the story has one, or today\'s date otherwise.'));
    const table = el('div', 'snpc-bond-table snpc-bond-presets');
    const header = el('div', 'snpc-bond-tr snpc-bond-th');
    header.append(el('span', '', 'Milestone'), el('span', '', 'When to record it'), el('span', 'snpc-bond-center', 'Auto'), el('span', 'snpc-bond-center', 'Once'), el('span', '', ''));
    table.append(header);
    for (const preset of s.milestones) {
        const tr = el('div', 'snpc-bond-tr');
        const set = (patch, redraw) => updateSettings(x => { const p = x.milestones.find(y => y.id === preset.id); if (p) Object.assign(p, patch); }, redraw);
        const label = input('text', preset.label, (v) => { if (v.trim()) set({ label: v }); });
        const hint = input('text', preset.hint, (v) => set({ hint: v }), { placeholder: 'What counts' });
        const auto = chip('', preset.auto, 'Recorded automatically when it happens', (on) => set({ auto: on }, rerender));
        const once = chip('', preset.once, 'Only once per person', (on) => set({ once: on }, rerender));
        auto.classList.add('snpc-bond-chip-solo');
        once.classList.add('snpc-bond-chip-solo');
        const del = iconButton('fa-trash-can', 'Delete this milestone type (recorded ones are kept)', () => updateSettings(x => { x.milestones = x.milestones.filter(y => y.id !== preset.id); }, rerender), 'snpc-bond-danger');
        tr.append(label, hint, auto, once, del);
        table.append(tr);
    }
    wrap.append(table);
    const bar = el('div', 'snpc-bond-toolbar');
    bar.append(
        button('Add milestone', 'fa-plus', 'Add your own milestone type', () => updateSettings(x => {
            x.milestones.push({ id: newId('p'), label: 'New milestone', hint: '', auto: true, once: true });
        }, rerender)),
        el('span', 'snpc-bond-spacer'),
        button('Restore defaults', 'fa-rotate-left', 'Put back the built-in milestone types', async () => {
            const ok = await Popup.show.confirm('Restore the default milestones?', 'Your milestone types will be replaced. Milestones already recorded are kept.');
            if (!ok) return;
            updateSettings(x => { x.milestones = structuredClone(DEFAULT_MILESTONES); }, rerender);
        }),
    );
    wrap.append(bar);
    view.append(wrap);
}

/* ---- the story prompt ---------------------------------------------------------------- */

function renderInjection(view, rerender) {
    view.append(el('h3', 'sillynpc-section-title', 'In The Story Prompt'));
    const o = bondSettings().inject;
    const set = (patch, redraw = false) => updateSettings(x => { Object.assign(x.inject, patch); }, redraw ? rerender : null);

    view.append(namespaced(buildSettingToggle({
        store: STORE,
        key: 'inject.enabled',
        label: 'Send Bonds To The Story',
        help: 'Adds each chosen character\'s level, gates and milestones to the prompt the main model sees, placed like a lorebook entry. '
            + 'What is sent about each person follows their own Level / Gates / History switches above.',
        onChange: rerender,
    })));
    if (!o.enabled) return;

    view.append(card('Where', select(INJECT_POSITIONS, o.position, v => set({ position: v }, true))));
    if (o.position === 'chat') view.append(card('Messages back', input('number', o.depth, v => set({ depth: v }), { min: 0, max: 100 }), '0 is right after the newest message.'));
    view.append(card('Role', select(INJECT_ROLES, o.role, v => set({ role: v }))));
    view.append(card('When', select(INJECT_TRIGGERS, o.trigger, v => set({ trigger: v }, true)),
        o.trigger === 'scene' ? 'Uses the tracker\'s scene cast; with the tracker off, whoever was named recently.' : ''));
    if (o.trigger === 'mentioned' || o.trigger === 'scene') view.append(card('Look back', input('number', o.scanDepth, v => set({ scanDepth: v }), { min: 1, max: 50 }), 'How many recent messages are read for names.'));
    view.append(card('Chance for each person', input('number', o.chance, v => set({ chance: v }), { min: 0, max: 100 }),
        o.trigger === 'random' ? 'Percent. Left at 100 this is treated as 35, so it really is occasional.' : 'Percent, rolled on every message on top of the trigger.'));
    view.append(card('Order', select(INJECT_ORDERS, o.order, v => set({ order: v })), 'Who comes first, and who is dropped past the limit.'));
    view.append(card('Most people at once', input('number', o.maxPeople, v => set({ maxPeople: v }), { min: 1, max: 20 })));
    view.append(card('Milestones per person', input('number', o.historyCount, v => set({ historyCount: v }), { min: 0, max: 50 }), 'The newest ones are sent.'));
    view.append(card('Also say what is not allowed yet', chip(o.showLocked ? 'On' : 'Off', o.showLocked, 'List the locked gates and what unlocks them', (on) => set({ showLocked: on }, true))));

    const text = el('textarea', 'text_pole sillynpc-setting-textarea');
    text.rows = 3;
    text.value = o.instruction;
    text.addEventListener('change', () => set({ instruction: text.value }));
    const instruction = el('div', 'sillynpc-setting');
    instruction.append(el('label', 'sillynpc-setting-row', 'Instruction'), text, el('small', 'notes', 'Sent after the bonds. {{user}} is replaced with your name.'));
    view.append(instruction);

    const previewWrap = el('div', 'sillynpc-setting');
    const preview = el('pre', 'snpc-bond-preview');
    previewWrap.append(button('Preview', 'fa-eye', 'What would be sent, ignoring the trigger and the dice', () => {
        preview.textContent = currentBondInjection({ everyone: true }) || 'Nothing: the tracker is off, injection is off, or nobody in this chat is tracked with anything switched on.';
    }), preview);
    view.append(previewWrap);
}
