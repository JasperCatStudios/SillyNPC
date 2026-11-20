import { redrawWhenIdle } from './ui-edit-guard.js';
import { eventSource } from '../../../../events.js';
import { Popup } from '../../../../popup.js';
import { getActiveCharacters } from './characters.js';
import { buildSettingToggle, buildSettingSelect, buildSettingNumber, buildSettingTextArea } from './ui-shared.js';
import { buildThemePicker } from './ui-tracker-theme.js';
import {
    bondSettings, saveBondSettings, chatStore, editPerson, removePerson, runBondUpdate,
    latestReplyId, currentBondInjection, todayForMilestone, playerName, BONDS_CHANGED_EVENT,
    acceptSuggestion, declineSuggestion,
} from './bonds.js';
import {
    ROMANCE_UNLOCKS, BOND_TIMINGS, GATE_KINDS, NEVER, INJECT_POSITIONS, INJECT_ROLES, INJECT_TRIGGERS, INJECT_ORDERS,
    BOND_DEFAULTS, BOND_SYSTEM, DEFAULT_LEVELS, DEFAULT_ROMANCE_LEVELS, DEFAULT_GATES, DEFAULT_MILESTONES,
    METERS, METER_LABELS, BOND_LOCKS, GATE_TRACKS, GATE_SCOPES,
    levelFor, personGateText, normalizePerson, addMilestone, editMilestone, removeMilestone,
    toggleMilestone, hasMilestone, newId, platonicValue, setMeter, romanceState, meterFloor,
    gateOverridden, setGateOverride, setGateOverridePart, clearGateOverride, levelName, meterTicks,
    missingMilestoneDefaults, personLevels, setLevelOverride,
} from './bonds-core.js';

import { PRODUCT_NAME } from './constants.js';
/**
 * The Bonds tab (fork): the Bond Tracker's switches, its rules, and the bonds of the open chat.
 *
 * Ordered by how often each part is touched: what it does and when, then the people in this
 * story, then the rules that are set once (growth, levels and gates, milestones), then how it
 * reaches the story prompt.
 */

/** People whose history is open, by lowercased name. Survives redraws, not reopening the menu. */
const expanded = new Set();
/** People ticked for Update selected / Track / Untrack, by lowercased name. Survives redraws, not reopening the menu. */
const picked = new Set();
/** The text in the people search box. */
let peopleFilter = '';
/** How many cards the list draws, a page at a time. */
const PAGE = 25;
let shownCount = PAGE;
/** People whose "your side" panel is open, the same way. */
const sideOpen = new Set();
/** People whose "Gates for" panel is open, the same way. */
const gatesOpen = new Set();
let currentView = null;
/** When the user last edited inside the people list, so the tab's change event does not redraw everything again. */
let localEditAt = 0;
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

/** The builders in ui-shared, aimed at settings.bonds instead of Worldkit's root. */
const STORE = { get: () => bondSettings(), save: () => saveBondSettings(), defaults: BOND_DEFAULTS };
/** Search keys are namespaced so "enabled" here never answers for Worldkit's own switch. */
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

/* ---- folding sections ---------------------------------------------------------------- */

const FOLD_KEY = 'worldkit.bondFolds';
/** Which sections and groups the owner opened or closed, by id. Kept in the browser so the tab comes back as it was left. */
const foldState = (() => {
    try { return new Map(Object.entries(JSON.parse(localStorage.getItem(FOLD_KEY) || '{}'))); } catch { return new Map(); }
})();
const rememberFold = (id, open) => {
    foldState.set(id, open);
    try { localStorage.setItem(FOLD_KEY, JSON.stringify(Object.fromEntries(foldState))); } catch { /* private window: just not remembered */ }
};

/**
 * Draws a section into a folding <details>. The section's own heading becomes the summary; a sub-group (a block that starts
 * with a small heading, like "Friendship" or "Pace over several turns") folds the same way inside it.
 */
function folded(view, id, render, rerender, defaultOpen = false) {
    const tmp = el('div');
    render(tmp, rerender);
    const heading = tmp.querySelector(':scope > h3.sillynpc-section-title');
    const det = el('details', 'snpc-bond-fold');
    det.dataset.fold = id;
    det.open = foldState.has(id) ? foldState.get(id) : defaultOpen;
    det.addEventListener('toggle', (e) => { if (e.target === det) rememberFold(id, det.open); });
    det.append(el('summary', 'snpc-bond-fold-summary', heading?.textContent || id));
    heading?.remove();
    for (const group of [...tmp.children]) foldGroup(group, id);
    det.append(...tmp.childNodes);
    view.append(det);
}

/**
 * Inside a block, every small heading (snpc-bond-subhead) starts a folding group that runs to the next one, open unless
 * the owner closed it. A block without such headings is left as it is.
 */
function foldGroup(group, sectionId) {
    if (!group.querySelector?.(':scope > .snpc-bond-subhead')) return;
    const nodes = [...group.childNodes];
    group.replaceChildren();
    let det = null;
    for (const node of nodes) {
        if (node.classList?.contains('snpc-bond-subhead')) {
            const id = `${sectionId}.${node.textContent}`;
            det = el('details', 'snpc-bond-subfold');
            det.open = foldState.has(id) ? foldState.get(id) : true;
            const mine = det;
            mine.addEventListener('toggle', (e) => { if (e.target === mine) rememberFold(id, mine.open); });
            mine.append(el('summary', 'snpc-bond-subfold-summary', node.textContent));
            group.append(mine);
        } else if (det) det.append(node);
        else group.append(node);
    }
}

/* ---- the tab ------------------------------------------------------------------------- */

export function renderBondsView(view) {
    if (!view) return;
    // The search box draws every tab into a detached node; only a real tab is redrawn on change.
    if (view.isConnected || !currentView?.isConnected) currentView = view;
    if (!listening) {
        listening = true;
        eventSource.on(BONDS_CHANGED_EVENT, () => {
            if (Date.now() - localEditAt < 800) return;
            if (currentView?.isConnected) redrawWhenIdle(currentView, () => renderBondsView(currentView));
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
    // Each section folds, so the tab is short enough to find things on a phone. The people open, the rule sections closed.
    folded(view, 'people', renderPeople, rerender, true);
    folded(view, 'growth', renderGrowth, rerender);
    folded(view, 'levels', renderLevels, rerender);
    folded(view, 'gates', renderGates, rerender);
    folded(view, 'milestones', renderMilestonePresets, rerender);
    folded(view, 'inject', renderInjection, rerender);

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
    view.append(buildThemePicker('bonds', { onChange: rerender }));
    view.append(namespaced(buildSettingSelect({
        store: STORE,
        key: 'timing',
        label: 'When Bonds Update',
        help: 'After The Reply: a separate request on the Bonds connection reads each new reply. '
            + 'With The Reply: the story model writes the BOND TRACKER block at the end of its reply; the growth rules check it and it is rewritten with the real values '
            + '(cheapest, but it spends story tokens and a weak model may forget it). '
            + 'Only When I Press Update: nothing happens on its own; use the Update buttons below.',
        options: Object.entries(BOND_TIMINGS).map(([value, label]) => ({ value, label })),
        onChange: rerender,
    })));
    const timing = bondSettings().timing;
    if (timing !== 'inline') {
        // The connection that reads replies is chosen in Connections, under Trackers.
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
        // The reader instructions moved to the Prompts tab, under Tracker prompts.
    }
    renderRomanceUnlock(view, rerender);
}

/** How a character's romance gets switched on: by hand, by suggestion, or automatically. */
function renderRomanceUnlock(view, rerender) {
    const s = bondSettings();
    const wrap = el('div', 'snpc-bond-unlock');
    wrap.dataset.setting = 'bonds.romanceUnlock';
    const mode = select(ROMANCE_UNLOCKS, s.romanceUnlock, (v) => updateSettings(x => { x.romanceUnlock = v; }, rerender));
    mode.classList.add('snpc-bond-unlock-mode');
    mode.title = 'How a character\'s romance (their side) gets switched on. '
        + 'Manual: only by you, with the Romance switch on their card; the model is never asked. '
        + 'Suggest: the reader may notice their feelings turning romantic and asks you first. '
        + 'Automatic: it switches their romance on by itself and tells you. Your own side is always yours to set.';
    wrap.append(card('Romance unlock', mode, 'Who switches a character\'s romance on. Only ever their side, never yours.'));
    if (s.romanceUnlock !== 'manual') {
        const min = input('number', s.romanceMinBond, (v) => updateSettings(x => { x.romanceMinBond = v; }, rerender), { min: 0, max: 100, step: 1 });
        min.classList.add('snpc-bond-unlock-min');
        min.title = 'A character is only suggested once the lower of their affection and trust has reached this (0 to 100).';
        wrap.append(card('Minimum friendship', min, 'Below this, any romantic turn the reader notices is ignored.'));
        const cool = input('number', s.romanceCooldown, (v) => updateSettings(x => { x.romanceCooldown = v; }, rerender), { min: 0, max: 200, step: 1 });
        cool.classList.add('snpc-bond-unlock-cooldown');
        cool.title = 'After "Keep platonic", the same character is not suggested again for this many turns (0 to 200). 0: no wait.';
        wrap.append(card('Cooldown', cool, 'Turns after "Keep platonic" before they may be suggested again.'));
    }
    if (s.romanceUnlock === 'auto') {
        wrap.append(el('p', 'notes snpc-bond-unlock-warn', 'Automatic switches a character\'s romance on without asking you. You can switch it off again on their card.'));
    }
    view.append(wrap);
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

    // Everyone tracked, then this chat's characters who have no bond yet, shown untracked.
    const people = [...store.people];
    for (const c of getActiveCharacters()) {
        if (c?.name && !people.some(p => p.name.toLowerCase() === c.name.toLowerCase())) {
            people.push({ ...normalizePerson({ name: c.name, tracked: false }, settings.growth), untracked: true });
        }
    }
    // Drop picks of people who are no longer in the list (a different chat, a forgotten bond).
    const present = new Set(people.map(p => p.name.toLowerCase()));
    for (const k of [...picked]) if (!present.has(k)) picked.delete(k);

    const bar = el('div', 'snpc-bond-toolbar');
    const search = el('input', 'text_pole snpc-bond-search');
    search.type = 'search';
    search.placeholder = 'Search characters';
    search.value = peopleFilter;
    search.title = 'Show only characters whose name contains this';
    const count = el('span', 'notes snpc-bond-count');
    const updateSel = button('', 'fa-arrows-rotate', 'Read the newest reply again for the ticked characters (only those with Track on)', async () => {
        const id = latestReplyId();
        if (id < 0) { toastr.info('There is no reply to read yet.', PRODUCT_NAME); return; }
        const tracked = new Set((chatStore()?.people || []).filter(p => p.tracked).map(p => p.name.toLowerCase()));
        const names = people.filter(p => picked.has(p.name.toLowerCase()) && tracked.has(p.name.toLowerCase())).map(p => p.name);
        if (!names.length) { toastr.info('Tick characters that have Track switched on.', PRODUCT_NAME); return; }
        updateSel.disabled = true;
        await runBondUpdate(id, { force: true, button: true, only: names });
        rerender();
    });
    const trackSel = button('Track', 'fa-check', 'Switch tracking on for the ticked characters', () => {
        for (const p of people) if (picked.has(p.name.toLowerCase())) editPerson(p.name, (x) => { x.tracked = true; });
        rerender();
    });
    const untrackSel = button('Untrack', 'fa-xmark', 'Switch tracking off for the ticked characters (their bonds are kept)', () => {
        for (const p of people) if (picked.has(p.name.toLowerCase())) editPerson(p.name, (x) => { x.tracked = false; });
        rerender();
    });
    const untrackAll = button('Untrack everyone', 'fa-eraser', 'Switch tracking off for every character in this chat (bonds are kept), so you can pick just the ones you want', async () => {
        const ok = await Popup.show.confirm('Untrack everyone?', 'Tracking goes off for every character in this chat. Their bonds and history are kept; tick the ones you want and press Track.');
        if (!ok) return;
        for (const p of chatStore()?.people || []) if (p.tracked) editPerson(p.name, (x) => { x.tracked = false; });
        rerender();
    });
    let matchingNames = () => [];
    const pickShown = button('Select matching', 'fa-square-check', 'Tick every character the search matches, including ones on pages not shown yet', () => {
        for (const k of matchingNames()) picked.add(k);
        syncPicks();
    });
    const clearPicks = button('Clear', 'fa-square', 'Untick everyone', () => { picked.clear(); syncPicks(); });
    const name = input('text', '', () => {}, { placeholder: 'Add someone by name' });
    const add = button('Add', 'fa-plus', 'Add this person to the list (not tracked until you switch Track on)', () => {
        const n = name.value.trim();
        if (!n) return;
        editPerson(n, () => {});
        expanded.add(n.toLowerCase());
        rerender();
    });
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') add.click(); });

    const searchRow = el('div', 'snpc-bond-toolbar');
    searchRow.append(search, count);
    const pickRow = el('div', 'snpc-bond-toolbar');
    pickRow.append(pickShown, clearPicks, untrackAll, el('span', 'snpc-bond-spacer'), trackSel, untrackSel, updateSel);
    bar.append(name, add);
    view.append(searchRow, pickRow, bar);
    view.append(namespaced(buildSettingToggle({
        store: STORE,
        key: 'hideAbsent',
        label: 'Hide Characters Who Are Not In The Scene From The Tracker',
        help: 'Tracked characters who are not in the scene right now are left out of the tracker block under each reply. '
            + 'Their bonds are kept and still change when they appear. A character whose bond this reply changed is always shown.',
    })));

    if (!people.length) {
        view.append(el('p', 'notes', 'Nobody yet. People are added as the tracker meets them, or by name above.'));
        return;
    }
    people.sort((a, b) => Number(Boolean(a.untracked)) - Number(Boolean(b.untracked)) || b.value - a.value || a.name.localeCompare(b.name));
    const list = el('div', 'snpc-bond-people');
    const more = el('div', 'snpc-bond-toolbar snpc-bond-more');
    /** Everyone the search matches, in list order. */
    const matching = () => {
        const q = peopleFilter.trim().toLowerCase();
        return q ? people.filter(p => p.name.toLowerCase().includes(q)) : people;
    };
    const redrawOne = (who) => {
        const key = who.toLowerCase();
        const old = [...list.children].find(c => c.dataset.key === key);
        const fresh = chatStore()?.people.find(p => p.name.toLowerCase() === key);
        if (!old || !fresh) { rerender(); return; }
        old.replaceWith(personCard(fresh, bondSettings(), redrawOne, () => syncPicks()));
    };
    // Edits made in the list save the bonds, which would redraw the whole tab through the change event; the card has already redrawn itself.
    const mute = () => { localEditAt = Date.now(); };
    list.addEventListener('click', mute, true);
    list.addEventListener('change', mute, true);
    view.append(list, more);

    /** Draws the first `shownCount` matching cards, a page at a time. A hundred cards at once is what made this tab slow. */
    function drawList() {
        const all = matching();
        const slice = all.slice(0, shownCount);
        list.replaceChildren(...slice.map(p => personCard(p, settings, redrawOne, () => syncPicks())));
        more.replaceChildren();
        if (all.length > slice.length) {
            const left = all.length - slice.length;
            more.append(
                button(`Show ${Math.min(PAGE, left)} more`, 'fa-chevron-down', `${left} more match`, () => { shownCount += PAGE; drawList(); }),
                button(`Show all ${all.length}`, 'fa-list', 'Draw every match (slower with many characters)', () => { shownCount = all.length; drawList(); }),
            );
        }
        syncPicks();
    }

    /** Keeps the count, ticks and buttons true. Nothing is redrawn. */
    function syncPicks() {
        const all = matching();
        const q = peopleFilter.trim();
        for (const box of list.querySelectorAll('.snpc-bond-pick')) box.checked = picked.has(box.closest('[data-key]').dataset.key);
        const n = picked.size;
        count.textContent = q ? `${all.length} of ${people.length} match` : `${people.length} characters`;
        updateSel.replaceChildren(el('i', 'fa-solid fa-arrows-rotate'), el('span', '', n ? `Update selected (${n})` : 'Update selected'));
        updateSel.disabled = !settings.enabled || !n;
        trackSel.disabled = untrackSel.disabled = clearPicks.disabled = !n;
        pickShown.disabled = !all.length;
    }
    search.addEventListener('input', () => { peopleFilter = search.value; shownCount = PAGE; drawList(); });
    matchingNames = () => matching().map(p => p.name.toLowerCase());
    drawList();
}

function personCard(person, settings, redrawOne, onPick = () => {}) {
    const key = person.name.toLowerCase();
    // An edit redraws this card only. Redrawing the whole tab for every click was the lag with 100+ people.
    const rerender = () => redrawOne(person.name);
    const open = expanded.has(key);
    const { level, next } = levelFor(person.value, personLevels(person, settings));
    const wrap = el('div', `snpc-bond-person${person.tracked ? '' : ' is-off'}${person.untracked ? ' is-new' : ''}`);

    wrap.dataset.key = key;
    const head = el('div', 'snpc-bond-head');
    const pick = el('input', 'snpc-bond-pick');
    pick.type = 'checkbox';
    pick.checked = picked.has(key);
    pick.title = `Select ${person.name} for the buttons above`;
    pick.addEventListener('change', () => { if (pick.checked) picked.add(key); else picked.delete(key); onPick(); });
    const toggle = iconButton(open ? 'fa-chevron-down' : 'fa-chevron-right', open ? 'Hide history' : 'Show history and milestones', () => {
        if (open) expanded.delete(key); else expanded.add(key);
        rerender();
    }, 'snpc-bond-caret');
    const who = el('div', 'snpc-bond-who');
    who.append(el('span', 'snpc-bond-name', person.name));
    who.append(el('span', 'snpc-bond-level', person.untracked ? 'Not tracked yet' : levelName(level, person)));

    // The character's own edge: three meters. The level comes from the lower of affection and trust.
    const meters = el('div', 'snpc-bond-meters');
    for (const k of METERS) meters.append(meterRow(person, 'toPlayer', k, settings, rerender));
    meters.title = next
        ? `${levelName(level, person)} (the lower of affection and trust). ${levelName(next, person)} at ${next.min}.`
        : `${levelName(level, person)}, the top level.`;
    // Romance is its own track: a switch per side, desire shown only while it is on.
    meters.append(romanceRow(person, 'toPlayer', settings, rerender));

    // What this bond may become. Anything but Open keeps romance off on both sides.
    const lock = select(BOND_LOCKS, person.lock || 'open', (v) => {
        editPerson(person.name, (p) => { p.lock = v; });
        rerender();
    });
    lock.classList.add('snpc-bond-lock');
    lock.title = 'What this bond may become. Open: romance can be switched on for either side. '
        + 'Platonic only or Family: romance stays off whatever the switches say - desire is frozen, no romance level is shown '
        + 'and every romance gate reads Never. Family also shows the friendship levels by their familial names '
        + '(set in the Familial name column under Levels).';

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
        if (id < 0) { toastr.info('There is no reply to read yet.', PRODUCT_NAME); return; }
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

    head.append(pick, toggle, who, meters, lock, chips, actions);
    wrap.append(head);
    if (person.suggestion && !person.untracked) wrap.append(suggestionBanner(person, rerender));
    wrap.append(playerSide(person, settings, rerender));
    wrap.append(personGates(person, settings, rerender));
    wrap.append(personRules(person, settings, rerender));
    if (open) wrap.append(personBody(person, settings, rerender));
    return wrap;
}

/** A pending romance suggestion on a person's card, with the same two answers as under the reply. */
function suggestionBanner(person, rerender) {
    const banner = el('div', 'snpc-bond-suggest');
    banner.append(el('i', 'fa-solid fa-heart snpc-bond-suggest-icon'));
    const reason = person.suggestion.reason;
    banner.append(el('span', 'snpc-bond-suggest-text', `${person.name} may be developing feelings${reason ? `: ${reason}` : '.'}`));
    banner.append(
        button('Turn romance on', '', `Switch romance on for ${person.name}'s side. Your own side stays as you set it.`, () => {
            acceptSuggestion(person.name); rerender();
        }, 'snpc-bond-suggest-accept'),
        button('Keep platonic', '', `Keep it a friendship. ${person.name} is not suggested again until the cooldown has passed.`, () => {
            declineSuggestion(person.name); rerender();
        }, 'snpc-bond-suggest-decline'),
    );
    return banner;
}

/**
 * One meter of one edge: a bar and a number to set it by hand. Affection, trust and respect carry
 * the platonic level ticks, desire the romance ones (on its own 0-to-top scale). See meterTicks.
 */
function meterRow(person, dir, meter, settings, rerender) {
    const g = settings.growth;
    const lo = meterFloor(meter, g);
    const span = Math.max(1, g.max - lo);
    const v = Number(person.edges?.[dir]?.[meter]) || 0;
    const row = el('div', 'snpc-bond-meterrow');
    const bar = el('div', `snpc-bond-meter snpc-bond-meter-${meter}`);
    const fill = el('div', 'snpc-bond-fill');
    fill.style.width = `${Math.max(0, Math.min(100, ((v - lo) / span) * 100))}%`;
    bar.append(fill);
    for (const t of meterTicks(meter, settings, person)) {
        const tick = el('span', 'snpc-bond-tick');
        tick.style.left = `${t.left}%`;
        tick.title = `${t.name} at ${t.min}`;
        bar.append(tick);
    }
    const box = input('number', v, (nv) => {
        if (!Number.isFinite(nv)) return;
        editPerson(person.name, (p) => { setMeter(p, dir, meter, Math.round(nv * 10) / 10, g); });
        rerender();
    }, { min: lo, max: g.max, step: 1 });
    box.classList.add('snpc-bond-value');
    box.title = `Set ${METER_LABELS[meter].toLowerCase()} by hand (${lo} to ${g.max})`;
    row.append(el('span', 'snpc-bond-meterlabel', METER_LABELS[meter]), bar, box);
    return row;
}

/**
 * One side's romance: the switch (off by default), the romance level, and - only while it is on -
 * the desire bar. A lock other than Open disables the switch.
 */
function romanceRow(person, dir, settings, rerender) {
    const wrap = el('div', 'snpc-bond-romance');
    const lockKey = person.lock || 'open';
    const locked = lockKey !== 'open';
    const on = person.edges?.[dir]?.romance === true;
    const state = romanceState(person, dir, settings.romanceLevels);
    const who = dir === 'toPlayer' ? person.name : playerName();
    const title = locked
        ? `Romance is off: this bond is set to ${BOND_LOCKS[lockKey]}. Set it to Open to allow romance.`
        : on
            ? `Romance is on for ${who}'s side. Click to switch it off (desire is kept, but frozen).`
            : `Switch romance on for ${who}'s side. Off by default: while off, desire never changes and romance gates stay closed.`;
    const sw = chip('Romance', on && !locked, title, (v) => {
        if (locked) return;
        editPerson(person.name, (p) => { p.edges[dir].romance = v; });
        rerender();
    });
    sw.classList.add('snpc-bond-romance-switch');
    if (locked) { sw.disabled = true; sw.classList.add('is-locked'); }
    const label = state.active
        ? (state.level ? state.level.name : 'No romance yet')
        : (locked ? BOND_LOCKS[lockKey] : 'Off');
    const name = el('span', 'snpc-bond-romance-level', label);
    if (state.active) {
        name.title = state.level?.description || '';
        if (state.next) name.title = `${name.title}${name.title ? ' ' : ''}${state.next.name} at ${state.next.min} desire.`;
    }
    const head = el('div', 'snpc-bond-romance-head');
    head.append(sw, name);
    wrap.append(head);
    if (state.active) wrap.append(meterRow(person, dir, 'desire', settings, rerender));
    return wrap;
}

/** The player's side of the bond: collapsed, set by hand only, read by the model as context. */
function playerSide(person, settings, rerender) {
    const key = person.name.toLowerCase();
    const you = playerName();
    const side = el('details', 'snpc-bond-side');
    side.open = sideOpen.has(key);
    side.addEventListener('toggle', () => { if (side.open) sideOpen.add(key); else sideOpen.delete(key); });
    const level = levelFor(platonicValue(person.edges?.fromPlayer), personLevels(person, settings)).level;
    const romance = romanceState(person, 'fromPlayer', settings.romanceLevels);
    const romanceNote = romance.active ? ` · Romance: ${romance.level ? romance.level.name : 'none yet'}` : '';
    side.append(el('summary', 'snpc-bond-side-summary', `${you}'s side: ${levelName(level, person)}${romanceNote}`));
    // Built when opened: 100 closed panels were 100 sets of meters nobody was looking at.
    buildWhenOpened(side, () => {
        side.append(el('small', 'notes', `How ${you} feels about ${person.name}. Set by hand only: the model is told it, but never changes it. `
            + 'Romance can be one-sided either way: acts both must feel need both sides switched on and high enough.'));
        const rows = el('div', 'snpc-bond-meters');
        for (const k of METERS) rows.append(meterRow(person, 'fromPlayer', k, settings, rerender));
        rows.append(romanceRow(person, 'fromPlayer', settings, rerender));
        side.append(rows);
    });
    return side;
}

/** People whose "Rules for" panel is open. */
const rulesOpen = new Set();

/**
 * This person's own growth rules and level names: what raises and lowers their bond, and how they read each level. Empty
 * or equal to the global text means "use the global one". Collapsed; the summary says when something differs.
 */
function personRules(person, settings, rerender) {
    const key = person.name.toLowerCase();
    const details = el('details', 'snpc-bond-side snpc-bond-gov');
    details.open = rulesOpen.has(key);
    details.addEventListener('toggle', () => { if (details.open) rulesOpen.add(key); else rulesOpen.delete(key); });
    const levelsChanged = Object.keys(person.levelOverrides || {}).length;
    const own = [person.raises?.trim() ? 'raises' : '', person.lowers?.trim() ? 'lowers' : '', levelsChanged ? `${levelsChanged} level${levelsChanged === 1 ? '' : 's'}` : ''].filter(Boolean);
    details.append(el('summary', 'snpc-bond-side-summary', `Rules for ${person.name}${own.length ? ` · own: ${own.join(', ')}` : ''}`));
    buildWhenOpened(details, () => {
        details.append(el('small', 'notes', `What moves ${person.name}'s bond and what each level means for them. Empty uses the general rules under Growth Rules and Levels.`));
        const area = (label, field, globalText) => {
            const wrap = el('label', 'snpc-bond-field');
            wrap.append(el('span', 'snpc-bond-field-label', label));
            const box = el('textarea', 'text_pole');
            box.rows = 4;
            box.value = person[field] || '';
            box.placeholder = `General: ${String(globalText || '').split('\n').filter(Boolean).join('; ')}`;
            box.addEventListener('change', () => { editPerson(person.name, (p) => { p[field] = box.value.slice(0, 1500); }); rerender(); });
            wrap.append(box);
            return wrap;
        };
        details.append(
            area(`What raises ${person.name}'s bond (one per line)`, 'raises', settings.growth.raises),
            area(`What lowers ${person.name}'s bond (one per line)`, 'lowers', settings.growth.lowers),
        );

        details.append(el('div', 'snpc-bond-subhead', 'Levels for this character'));
        const rows = el('div', 'snpc-bond-gov-rows');
        for (const base of settings.levels) {
            const mine = person.levelOverrides?.[base.id] || {};
            const row = el('div', `snpc-bond-gov-row snpc-bond-lvl-row${Object.keys(mine).length ? ' is-changed' : ''}`);
            const name = input('text', mine.name ?? '', (v) => { editPerson(person.name, (p) => setLevelOverride(p, base.id, { name: v }, settings)); rerender(); }, { placeholder: base.name });
            name.title = `What ${person.name} calls this level (general: ${base.name})`;
            const min = input('number', mine.min ?? '', (v) => { editPerson(person.name, (p) => setLevelOverride(p, base.id, { min: Number.isFinite(v) && min.value !== '' ? v : '' }, settings)); rerender(); }, { placeholder: String(base.min) });
            min.title = `Bond value where this level starts for ${person.name} (general: ${base.min})`;
            const desc = input('text', mine.description ?? '', (v) => { editPerson(person.name, (p) => setLevelOverride(p, base.id, { description: v }, settings)); rerender(); }, { placeholder: base.description || 'How they act at this level' });
            const reset = iconButton('fa-rotate-left', 'Back to the general level', () => {
                editPerson(person.name, (p) => { const o = { ...(p.levelOverrides || {}) }; delete o[base.id]; p.levelOverrides = o; });
                rerender();
            }, `snpc-bond-gov-reset${Object.keys(mine).length ? '' : ' disabled'}`);
            const label = el('div', 'snpc-bond-gov-label');
            label.append(el('span', 'snpc-bond-gov-name', base.name), el('span', 'snpc-bond-gov-global', `General: ${base.min}+`));
            row.append(label, name, min, desc, reset);
            rows.append(row);
        }
        details.append(rows);
        const reset = button('Reset this character\'s rules', 'fa-rotate-left', `Use the general rules and levels for ${person.name} again`, () => {
            editPerson(person.name, (p) => { p.raises = ''; p.lowers = ''; p.levelOverrides = {}; });
            rerender();
        }, 'snpc-bond-gov-resetall');
        reset.disabled = !own.length;
        const bar = el('div', 'snpc-bond-toolbar');
        bar.append(reset);
        details.append(bar);
    });
    return details;
}

/**
 * This person's own gates: one row per global gate, a level chosen for them alone, or Global.
 * Collapsed; the summary counts what differs. Romance rows are greyed while the bond is locked.
 */
function personGates(person, settings, rerender) {
    const key = person.name.toLowerCase();
    const details = el('details', 'snpc-bond-side snpc-bond-gov');
    details.open = gatesOpen.has(key);
    details.addEventListener('toggle', () => { if (details.open) gatesOpen.add(key); else gatesOpen.delete(key); });
    const gates = settings.gates || [];
    const changed = gates.filter(g => gateOverridden(g, person, settings)).length;
    details.append(el('summary', 'snpc-bond-side-summary', `Gates for ${person.name}${changed ? ` · ${changed} changed` : ''}`));
    // Built when opened, like the player's side: the rows are the heaviest part of a card.
    buildWhenOpened(details, () => {
        if (!gates.length) {
            details.append(el('small', 'notes', 'There are no gates yet. Add them under Gates below.'));
            return;
        }
        details.append(el('small', 'notes', `What ${person.name} allows, where it differs from the gates below. Global follows the gate as set there.`));

        const lockKey = person.lock || 'open';
        const nameOf = (list, id) => {
            if (id === NEVER) return 'Never';
            const l = list.find(x => x.id === id);
            return l ? (list === settings.levels ? levelName(l, person) : l.name) : id;
        };
        const rows = el('div', 'snpc-bond-gov-rows');
        for (const gate of gates) {
            const list = gate.track === 'romance' ? settings.romanceLevels : settings.levels;
            const locked = gate.track === 'romance' && lockKey !== 'open';
            const differs = gateOverridden(gate, person, settings);
            const o = person.gateOverrides?.[gate.id];
            const row = el('div', `snpc-bond-gov-row${differs ? ' is-changed' : ''}${locked ? ' is-locked' : ''}`);
            row.dataset.gate = gate.id;

            const globalLevel = nameOf(list, gate.level);
            const extras = [];
            if (gate.track === 'romance' && gate.level !== NEVER) extras.push(gate.scope === 'mutual' ? 'both' : 'they start');
            if (gate.minBond) extras.push(`+ ${nameOf(settings.levels, gate.minBond)} both ways`);
            const label = el('div', 'snpc-bond-gov-label');
            label.append(el('span', 'snpc-bond-gov-name', gate.label), el('span', `snpc-bond-gov-track is-${gate.track}`, GATE_TRACKS[gate.track] || gate.track));
            const global = el('span', 'snpc-bond-gov-global', `Global: ${globalLevel}${extras.length ? ` (${extras.join(', ')})` : ''}`);
            label.append(global);
            if (locked) {
                const reason = el('span', 'snpc-bond-gov-reason', `Never: ${BOND_LOCKS[lockKey]}`);
                label.append(reason);
                row.title = `Romance gates read Never while this bond is set to ${BOND_LOCKS[lockKey]}.`;
            }

            const sel = el('select', 'text_pole snpc-bond-gov-select');
            sel.append(new Option(`Global (${globalLevel})`, ''));
            for (const l of list) sel.append(new Option(nameOf(list, l.id), l.id));
            sel.append(new Option('Never', NEVER));
            sel.value = o?.off ? NEVER : (o?.level || '');
            sel.title = `The level ${person.name} needs for this, instead of the global one`;
            sel.disabled = locked;
            sel.addEventListener('change', () => {
                editPerson(person.name, (p) => { setGateOverride(p, gate, sel.value, settings); });
                rerender();
            });

            const reset = iconButton('fa-rotate-left', 'Back to the global gate', () => {
                editPerson(person.name, (p) => { clearGateOverride(p, gate.id); });
                rerender();
            }, `snpc-bond-gov-reset${o ? '' : ' disabled'}`);
            reset.title = 'Back to the global gate (clears every choice on this row)';
            row.append(label, sel, reset);
            if (gate.track === 'romance') row.append(personGateExtras(person, gate, o, settings, { locked, nameOf, rerender }));
            rows.append(row);
        }
        details.append(rows);

        const bar = el('div', 'snpc-bond-toolbar');
        const resetAll = button('Reset all gates for this person', 'fa-rotate-left', `Use the global gates for ${person.name} again`, () => {
            editPerson(person.name, (p) => { clearGateOverride(p); });
            rerender();
        }, 'snpc-bond-gov-resetall');
        resetAll.disabled = !Object.keys(person.gateOverrides || {}).length;
        bar.append(resetAll);
        details.append(bar);
    });
    return details;
}

/** Runs build once, the first time the panel is open (now if it already is). */
function buildWhenOpened(details, build) {
    let built = false;
    const ensure = () => { if (built || !details.open) return; built = true; build(); };
    details.addEventListener('toggle', ensure);
    ensure();
}

/** The value of the "Minimum friendship" select that means "nothing more" (minBond ''). */
const NO_MIN = '__none';

/**
 * A romance gate's extra choices for one person, on a line under its level: who must feel it,
 * and the friendship both sides must also have. Each starts at Global; one that differs from
 * the global gate is highlighted like the level select.
 */
function personGateExtras(person, gate, o, settings, { locked, nameOf, rerender }) {
    const wrap = el('div', 'snpc-bond-gov-extra');
    const has = (k) => Boolean(o) && Object.prototype.hasOwnProperty.call(o, k);
    const field = (labelText, control) => {
        const f = el('label', 'snpc-bond-gov-field');
        f.append(el('span', 'snpc-bond-gov-fieldlabel', labelText), control);
        return f;
    };
    const mini = (differs) => {
        const s = el('select', `text_pole snpc-bond-gov-select snpc-bond-gov-mini${differs ? ' is-diff' : ''}`);
        s.disabled = locked;
        return s;
    };

    const scopeName = (v) => (v === 'mutual' ? 'Both sides' : 'Their side only');
    const scope = mini(has('scope') && o.scope !== gate.scope);
    scope.classList.add('snpc-bond-gov-scope');
    scope.append(new Option(`Global (${scopeName(gate.scope)})`, ''), new Option('Their side only', 'initiates'), new Option('Both sides', 'mutual'));
    scope.value = has('scope') ? o.scope : '';
    scope.title = `Who must feel it for ${person.name}: their side only (they may start it), or both sides at that romance level`;
    scope.addEventListener('change', () => {
        editPerson(person.name, (p) => { setGateOverridePart(p, gate, 'scope', scope.value || null, settings); });
        rerender();
    });

    const globalMin = gate.minBond ? nameOf(settings.levels, gate.minBond) : 'None';
    const min = mini(has('minBond') && o.minBond !== (gate.minBond || ''));
    min.classList.add('snpc-bond-gov-min');
    min.append(new Option(`Global (${globalMin})`, ''), new Option('None', NO_MIN));
    for (const l of settings.levels) min.append(new Option(nameOf(settings.levels, l.id), l.id));
    min.value = has('minBond') ? (o.minBond === '' ? NO_MIN : o.minBond) : '';
    min.title = `A friendship level both sides must also have reached, for ${person.name} alone`;
    min.addEventListener('change', () => {
        const v = min.value === NO_MIN ? '' : (min.value || null);
        editPerson(person.name, (p) => { setGateOverridePart(p, gate, 'minBond', v, settings); });
        rerender();
    });

    wrap.append(field('Scope', scope), field('Min. friendship', min));
    return wrap;
}

function personBody(person, settings, rerender) {
    const body = el('div', 'snpc-bond-body');
    if (person.lastReason) body.append(el('p', 'notes snpc-bond-reason', `Last change: ${person.lastReason}`));
    if (person.legacy) {
        body.append(el('p', 'notes', `Brought over from Internal States (BOND ${person.legacy.bond}, Sparks ${person.legacy.sparks}, Grudge ${person.legacy.grudge}).`));
    }
    const gates = personGateText(person, settings, { showLocked: true, playerName: playerName() });
    if (gates) body.append(el('p', 'notes snpc-bond-gates', gates));

    // Presets as a checklist: ticking records it with today's date, unticking removes it.
    body.append(el('div', 'snpc-bond-subhead', 'Milestones'));
    const checklist = el('div', 'snpc-bond-checklist');
    for (const preset of settings.milestones) {
        const has = hasMilestone(person, preset.id);
        const c = chip(preset.label, has, has ? 'Recorded. Click to remove it.' : `Record it now${preset.hint ? `: ${preset.hint}` : ''}`, () => {
            editPerson(person.name, (p) => { toggleMilestone(p, preset.id, settings.milestones, { ...todayForMilestone() }); });
            rerender();
        });
        if (preset.tone === 'negative') c.classList.add('is-negative');
        checklist.append(c);
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
        if (m.tone === 'negative') tr.classList.add('is-negative');
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
        numberCell('Desire pace', 'growth.desireRate', 'Desire may rise only this share of the per-turn and window limits, so romance builds slower than friendship.', { min: 5, max: 100, suffix: '%' }),
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

function levelsTable(key, rerender, { what, unit, familial = false }) {
    const s = bondSettings();
    const table = el('div', `snpc-bond-table snpc-bond-levels${familial ? ' has-familial' : ''}`);
    const header = el('div', 'snpc-bond-tr snpc-bond-th');
    header.append(el('span', '', 'Level'));
    if (familial) header.append(el('span', '', 'Familial name'));
    header.append(el('span', '', unit), el('span', '', 'How they behave'), el('span', '', ''));
    table.append(header);
    const find = (x, id) => x[key].find(y => y.id === id);
    for (const level of s[key]) {
        const tr = el('div', 'snpc-bond-tr');
        const name = input('text', level.name, (v) => updateSettings(x => { const l = find(x, level.id); if (l && v.trim()) l.name = v; }, rerender));
        tr.append(name);
        if (familial) {
            // Shown instead of the name for a person whose bond is set to Family. Empty: the name is used.
            const fam = input('text', level.familial || '', (v) => updateSettings(x => { const l = find(x, level.id); if (l) l.familial = v; }, rerender), { placeholder: level.name });
            fam.classList.add('snpc-bond-familial');
            fam.maxLength = 40;
            fam.title = 'What this level is called between family (a bond set to Family). Describes the bond, not a role. Empty uses the level name.';
            tr.append(fam);
        }
        const min = input('number', level.min, (v) => updateSettings(x => { const l = find(x, level.id); if (l && Number.isFinite(v)) l.min = v; }, rerender));
        min.classList.add('snpc-bond-num');
        const desc = input('text', level.description, (v) => updateSettings(x => { const l = find(x, level.id); if (l) l.description = v; }), { placeholder: 'How they act at this level' });
        const del = iconButton('fa-trash-can', `Delete this ${what} level (gates on it move to the top ${what} level)`, () => {
            if (s[key].length <= 1) { toastr.info('There has to be at least one level.', PRODUCT_NAME); return; }
            updateSettings(x => { x[key] = x[key].filter(y => y.id !== level.id); }, rerender);
        }, 'snpc-bond-danger');
        tr.append(min, desc, del);
        table.append(tr);
    }
    return table;
}

function renderLevels(view, rerender) {
    view.append(el('h3', 'sillynpc-section-title', 'Levels'));
    const wrap = el('div', 'sillynpc-setting');
    wrap.append(el('div', 'snpc-bond-subhead', 'Friendship'));
    wrap.append(el('small', 'notes', 'Read from the lower of affection and trust. A person is at the highest level whose threshold they have reached. '
        + 'The description is what the story model is told about how they behave at that level. '
        + 'The familial name is what the level is called for a bond set to Family; left empty, the level name is used.'));
    wrap.append(levelsTable('levels', rerender, { what: 'friendship', unit: 'From', familial: true }));
    const bar = el('div', 'snpc-bond-toolbar');
    bar.append(button('Add level', 'fa-plus', 'Add a friendship level above the highest one', () => updateSettings(x => {
        const top = x.levels[x.levels.length - 1];
        x.levels.push({ id: newId('l'), name: 'New level', min: (top?.min ?? 0) + 10, description: '' });
    }, rerender)));
    wrap.append(bar);

    wrap.append(el('div', 'snpc-bond-subhead', 'Romance'));
    wrap.append(el('small', 'notes', 'A separate track, read from desire (0 and up), and only for a side whose Romance switch is on and whose bond is Open. '
        + 'Below the first threshold there is no romance yet.'));
    wrap.append(levelsTable('romanceLevels', rerender, { what: 'romance', unit: 'Desire' }));
    const rbar = el('div', 'snpc-bond-toolbar');
    rbar.append(
        button('Add romance level', 'fa-plus', 'Add a romance level above the highest one', () => updateSettings(x => {
            const top = x.romanceLevels[x.romanceLevels.length - 1];
            x.romanceLevels.push({ id: newId('r'), name: 'New level', min: Math.min(100, (top?.min ?? 0) + 5), description: '' });
        }, rerender)),
        el('span', 'snpc-bond-spacer'),
        button('Reset to defaults', 'fa-rotate-left', 'Put back the built-in friendship levels, romance levels and gates', async () => {
            const ok = await Popup.show.confirm('Reset levels and gates to the defaults?', 'Both level lists and every gate will be replaced. Bonds and milestones are not touched.');
            if (!ok) return;
            updateSettings(x => {
                x.levels = structuredClone(DEFAULT_LEVELS);
                x.romanceLevels = structuredClone(DEFAULT_ROMANCE_LEVELS);
                x.gates = structuredClone(DEFAULT_GATES);
            }, rerender);
        }),
    );
    wrap.append(rbar);
    view.append(wrap);
}

function renderGates(view, rerender) {
    view.append(el('h3', 'sillynpc-section-title', 'Gates: What Each Level Allows'));
    const s = bondSettings();
    const wrap = el('div', 'sillynpc-setting');
    wrap.append(el('small', 'notes', 'Each gate opens at a level of its track and stays open above it. Friendship gates read the character\'s friendship level. '
        + 'Romance gates read the romance levels and are closed (Never) while the character\'s romance is off or the bond is not Open: '
        + '"They may start it" needs only the character\'s feeling, "Both must feel it" needs both sides switched on and at that level. '
        + '"Also needs" is a friendship level both sides must have reached as well. The story model is told what is allowed now and what is not yet.'));

    const platonicOptions = { ...Object.fromEntries(s.levels.map(l => [l.id, `${l.name} (${l.min}+)`])), [NEVER]: 'Never' };
    const romanceOptions = { ...Object.fromEntries(s.romanceLevels.map(l => [l.id, `${l.name} (desire ${l.min}+)`])), [NEVER]: 'Never' };
    const bondOptions = { '': 'Nothing more', ...Object.fromEntries(s.levels.map(l => [l.id, `${l.name} both ways`])) };
    const topOf = (x, track) => (track === 'romance' ? x.romanceLevels : x.levels).slice(-1)[0]?.id || NEVER;
    for (const [kind, kindLabel] of Object.entries(GATE_KINDS)) {
        const mine = s.gates.filter(g => g.kind === kind);
        wrap.append(el('div', 'snpc-bond-subhead', kindLabel));
        const table = el('div', 'snpc-bond-table snpc-bond-gates-table');
        const header = el('div', 'snpc-bond-tr snpc-bond-th');
        header.append(el('span', '', 'What'), el('span', '', 'Kind'), el('span', '', 'Track'), el('span', '', 'Unlocks at'),
            el('span', '', 'Who must feel it'), el('span', '', 'Also needs'), el('span', '', ''));
        table.append(header);
        if (!mine.length) {
            const empty = el('div', 'snpc-bond-tr snpc-bond-empty');
            empty.append(el('span', 'notes', 'None.'));
            table.append(empty);
        }
        for (const gate of mine) {
            const tr = el('div', 'snpc-bond-tr');
            const set = (change, redraw) => updateSettings(x => { const g = x.gates.find(y => y.id === gate.id); if (g) change(g, x); }, redraw);
            const label = input('text', gate.label, (v) => set((g) => { if (v.trim()) g.label = v; }));
            const kindSel = select(GATE_KINDS, gate.kind, (v) => set((g) => { g.kind = v; }, rerender));
            const trackSel = select(GATE_TRACKS, gate.track, (v) => set((g, x) => { g.track = v; g.level = topOf(x, v); }, rerender));
            trackSel.title = 'Friendship: read from the friendship level. Romance: read from desire, only while romance is on.';
            const levelSel = select(gate.track === 'romance' ? romanceOptions : platonicOptions, gate.level, (v) => set((g) => { g.level = v; }));
            let scope;
            if (gate.track === 'romance') {
                scope = select(GATE_SCOPES, gate.scope, (v) => set((g) => { g.scope = v; }));
                scope.title = 'They may start it: the character alone may do it, whatever you feel. Both must feel it: your side must be switched on and at the same romance level too.';
            } else {
                scope = el('span', 'notes snpc-bond-na', '-');
                scope.title = 'Only romance gates have this';
            }
            const bondSel = select(bondOptions, gate.minBond || '', (v) => set((g) => { g.minBond = v; }));
            bondSel.title = 'A friendship level both sides must also have reached';
            const del = iconButton('fa-trash-can', 'Delete this gate', () => updateSettings(x => { x.gates = x.gates.filter(y => y.id !== gate.id); }, rerender), 'snpc-bond-danger');
            tr.append(label, kindSel, trackSel, levelSel, scope, bondSel, del);
            table.append(tr);
        }
        wrap.append(table);
    }
    const bar = el('div', 'snpc-bond-toolbar');
    bar.append(button('Add gate', 'fa-plus', 'Add a rule about what a level allows', () => updateSettings(x => {
        x.gates.push({ id: newId('g'), label: 'New gate', kind: 'social', track: 'platonic', level: x.levels[x.levels.length - 1]?.id || NEVER, scope: 'initiates', minBond: '' });
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
    header.append(el('span', '', 'Milestone'), el('span', '', 'When to record it'), el('span', 'snpc-bond-center', 'Auto'), el('span', 'snpc-bond-center', 'Once'), el('span', 'snpc-bond-center', 'Bad'), el('span', '', ''));
    table.append(header);
    for (const preset of s.milestones) {
        const tr = el('div', `snpc-bond-tr${preset.tone === 'negative' ? ' is-negative' : ''}`);
        const set = (patch, redraw) => updateSettings(x => { const p = x.milestones.find(y => y.id === preset.id); if (p) Object.assign(p, patch); }, redraw);
        const label = input('text', preset.label, (v) => { if (v.trim()) set({ label: v }); });
        const hint = input('text', preset.hint, (v) => set({ hint: v }), { placeholder: 'What counts' });
        const auto = chip('', preset.auto, 'Recorded automatically when it happens', (on) => set({ auto: on }, rerender));
        const once = chip('', preset.once, 'Only once per person', (on) => set({ once: on }, rerender));
        const bad = chip('', preset.tone === 'negative', 'A bad moment (betrayal, a lie exposed): shown in red and sent to the story as hurtful', (on) => set({ tone: on ? 'negative' : 'positive' }, rerender));
        auto.classList.add('snpc-bond-chip-solo');
        once.classList.add('snpc-bond-chip-solo');
        bad.classList.add('snpc-bond-chip-solo');
        const del = iconButton('fa-trash-can', 'Delete this milestone type (recorded ones are kept)', () => updateSettings(x => { x.milestones = x.milestones.filter(y => y.id !== preset.id); }, rerender), 'snpc-bond-danger');
        tr.append(label, hint, auto, once, bad, del);
        table.append(tr);
    }
    wrap.append(table);
    const bar = el('div', 'snpc-bond-toolbar');
    bar.append(
        button('Add milestone', 'fa-plus', 'Add your own milestone type', () => updateSettings(x => {
            x.milestones.push({ id: newId('p'), label: 'New milestone', hint: '', auto: true, once: true, tone: 'positive' });
        }, rerender)),
        button('Add new examples', 'fa-circle-plus', 'Add the built-in milestone types this list does not have yet (betrayal, a lie exposed and other bad moments). Yours are kept as they are.', () => {
            const more = missingMilestoneDefaults(bondSettings().milestones);
            if (!more.length) { toastr.info('You already have every built-in milestone.', PRODUCT_NAME); return; }
            updateSettings(x => { x.milestones.push(...more); }, rerender);
            toastr.success(`${more.length} added.`, PRODUCT_NAME);
        }),
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
