import { getContext } from '../../../../../extensions.js';
import { eventSource, event_types } from '../../../../../../script.js';
import { ensureButtonRow } from '../../src/floating-buttons.js';
import { registerModulePane } from '../../src/module-panes.js';
import { activitiesOnTab, HUB_TABS } from '../../src/activity-config-core.js';
import { term } from '../../src/activity-terms.js';
import { createActivityWindow } from './activity-window.js';
import { runStudy } from './games/memory-ui.js';
import { renderActivitiesPane, ACTIVITIES_CHANGED_EVENT } from './activities-pane.js';
import {
    activitySettings, saveActivitySettings, activePreset, partnerList, cardOf, studySubjects, userName,
} from './activities-runtime.js';

/**
 * The Activities module (fork): a fourth floating button that opens a hub of things to do together with a
 * character: Study now, with Brewing, Tea Time, Cooking, Fishing, Gardening and training drills to come. The
 * button has its own colour (green) so the four are told apart at a glance; the window uses the same black
 * theme as Games and Combat. Loading is isolated by index.js, so a fault here takes nothing else with it.
 */

const BUTTON_ID = 'snpc-activities-btn';

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

let win = null;
let partnerName = '';
let currentTab = 'study';

const chatOpen = () => {
    const c = getContext();
    return Boolean(c && (c.groupId || (c.characterId !== undefined && c.characterId !== null)));
};

function ensureWindow() {
    if (win) return win;
    win = createActivityWindow({});
    return win;
}

function pickedPartner() {
    const list = partnerList();
    if (!list.length) return null;
    return list.find(p => p.name === partnerName) || list[0];
}

/** A labelled select. */
function field(label, select) {
    const wrap = el('label', 'snpc-act-field-row');
    wrap.append(el('span', '', label), select);
    return wrap;
}

function toast(kind, message) {
    try { toastr[kind](message, 'Worldkit', { preventDuplicates: true }); } catch { /* toastr not there */ }
}

/* ------------------------------------------------------------------ views */

function showHub() {
    const w = ensureWindow();
    const preset = activePreset();
    w.setView('hub');
    w.setTitle('Activities', 'fa-seedling');
    w.userName = userName();

    const root = el('div', 'snpc-act-hub');
    const partners = partnerList();

    if (!chatOpen()) {
        root.append(el('p', 'snpc-act-note', 'Open a chat first: activities are shared with the people in your story.'));
        w.main.replaceChildren(root);
        return;
    }
    if (!partners.length) {
        root.append(el('p', 'snpc-act-note', 'There is nobody to spend time with yet. Add a character in the Worldkit menu first.'));
        w.main.replaceChildren(root);
        return;
    }

    // Who with.
    const select = el('select', 'snpc-act-select');
    select.setAttribute('aria-label', 'Spend time with');
    for (const p of partners) select.append(new Option(p.name, p.name));
    select.value = pickedPartner()?.name || partners[0].name;
    partnerName = select.value;
    select.addEventListener('change', () => { partnerName = select.value; });
    const who = el('div', 'snpc-act-who');
    who.append(field('With', select));
    root.append(who);

    // Tabs.
    const tabs = el('div', 'snpc-act-hubtabs');
    tabs.setAttribute('role', 'tablist');
    const grid = el('div', 'snpc-act-tiles');
    const draw = () => {
        for (const b of tabs.children) {
            const on = b.dataset.tab === currentTab;
            b.classList.toggle('is-active', on);
            b.setAttribute('aria-selected', String(on));
        }
        grid.replaceChildren();
        const items = activitiesOnTab(preset, currentTab);
        if (!items.length) grid.append(el('p', 'snpc-act-note', 'Nothing here yet.'));
        for (const a of items) {
            const tile = el('button', `snpc-act-tile-card${a.soon ? ' is-soon' : ''}`);
            tile.type = 'button';
            if (a.soon) tile.setAttribute('aria-disabled', 'true');
            tile.append(el('i', `fa-solid ${a.icon}`));
            tile.append(el('strong', '', a.label));
            tile.append(el('small', '', a.soon ? 'Coming soon' : (a.blurb || '')));
            tile.addEventListener('click', () => {
                if (a.soon) { toast('info', `${a.label} is coming soon.`); return; }
                if (a.kind === 'memory') showStudySetup(a);
            });
            grid.append(tile);
        }
    };
    for (const [id, label] of HUB_TABS) {
        const b = el('button', 'snpc-act-hubtab', label);
        b.type = 'button';
        b.dataset.tab = id;
        b.setAttribute('role', 'tab');
        b.addEventListener('click', () => { currentTab = id; draw(); });
        tabs.append(b);
    }
    root.append(tabs, grid);
    w.main.replaceChildren(root);
    draw();
}

function showStudySetup(activity) {
    const w = ensureWindow();
    const preset = activePreset();
    const s = activitySettings();
    const partner = pickedPartner();
    if (!partner) { showHub(); return; }
    w.setView('hub');
    w.setTitle(activity.label, activity.icon || 'fa-book-open');

    const box = el('div', 'snpc-act-setup');
    box.append(el('p', 'snpc-act-note',
        `${activity.label} with ${partner.name}. Match the runes in pairs. A cursed rune that turns up shuffles the board when you miss, `
        + `and every miss costs concentration. What you learn counts as ${term(preset, 'knowledge').toLowerCase()} toward a ${term(preset, 'classWord').toLowerCase()} change.`));

    const subjects = studySubjects(preset);
    const subject = el('select', 'snpc-act-select');
    subject.setAttribute('aria-label', 'Subject');
    for (const p of subjects) subject.append(new Option(p.label, p.id));
    if (!subjects.length) subject.append(new Option('General study', ''));
    subject.disabled = !subjects.length;

    const pairs = el('select', 'snpc-act-select');
    pairs.setAttribute('aria-label', 'Board size');
    for (const [n, text] of [[4, 'Small (4 pairs)'], [8, 'Medium (8 pairs)'], [12, 'Large (12 pairs)']]) pairs.append(new Option(text, String(n)));
    pairs.value = String(s.pairs);

    const difficulty = el('select', 'snpc-act-select');
    difficulty.setAttribute('aria-label', 'Difficulty');
    for (const d of ['easy', 'normal', 'hard']) difficulty.append(new Option(d[0].toUpperCase() + d.slice(1), d));
    difficulty.value = s.difficulty;

    box.append(field('Subject', subject), field('Board', pairs), field('Difficulty', difficulty));
    if (!subjects.length) box.append(el('p', 'snpc-act-note is-small', 'No combat type with a matching skill is active, so this session earns knowledge but no skill XP.'));

    const row = el('div', 'snpc-act-row');
    const start = el('button', 'snpc-act-btn', 'Start');
    start.type = 'button';
    start.addEventListener('click', () => {
        s.pairs = Number(pairs.value);
        s.difficulty = difficulty.value;
        saveActivitySettings();
        w.setPartner(partner.name, partner.avatar || cardOf(partner.name)?.imageUrl || '', 'Studying together');
        w.userName = userName();
        runStudy(w, {
            partner: partner.name, label: activity.label, pairs: s.pairs, difficulty: s.difficulty,
            runes: preset.study.runes, subject: subject.value || '',
            onLeave: () => showHub(),
            onAgain: () => showStudySetup(activity),
        });
    });
    const back = el('button', 'snpc-act-btn is-quiet', 'Back');
    back.type = 'button';
    back.addEventListener('click', showHub);
    row.append(start, back);
    box.append(row);
    w.main.replaceChildren(box);
    start.focus();
}

function openHub(from) {
    const w = ensureWindow();
    if (w.isOpen()) { w.close(); return; }
    w.open(from);
    showHub();
}

/* ------------------------------------------------------------------ the button */

/** Shows or hides the corner button. Called when a chat opens and when the settings change. */
export function renderActivitiesButton() {
    const row = ensureButtonRow();
    let btn = document.getElementById(BUTTON_ID);
    if (!btn) {
        btn = el('div', 'rpg-floating-btn');
        btn.id = BUTTON_ID;
        btn.title = 'Activities';
        btn.setAttribute('role', 'button');
        btn.setAttribute('tabindex', '0');
        btn.setAttribute('aria-label', 'Activities');
        btn.append(el('i', 'fa-solid fa-seedling'));
        btn.addEventListener('click', () => openHub(btn));
        btn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openHub(btn); } });
        row.prepend(btn);
    }
    const s = activitySettings();
    const show = s.enabled && s.buttonShown && chatOpen();
    btn.style.display = show ? 'flex' : 'none';
    if (!show && win?.isOpen()) win.close();
}

registerModulePane('activities', renderActivitiesPane);

jQuery(() => {
    renderActivitiesButton();
    window.addEventListener(ACTIVITIES_CHANGED_EVENT, () => renderActivitiesButton());
    eventSource.on(event_types.CHAT_CHANGED, () => {
        // A new chat has other people in it: the window closes and the partner pick starts over.
        partnerName = '';
        if (win?.isOpen()) win.close();
        renderActivitiesButton();
    });
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, () => renderActivitiesButton());
});
