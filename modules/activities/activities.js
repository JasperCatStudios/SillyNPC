import { getContext } from '../../../../../extensions.js';
import { eventSource, event_types } from '../../../../../../script.js';
import { ensureButtonRow } from '../../src/floating-buttons.js';
import { registerModulePane } from '../../src/module-panes.js';
import { HUB_TABS } from '../../src/activity-config-core.js';
import { createRegistry, tilesForTab, CUSTOM_KIND } from '../../src/activity-registry.js';
import { buildCustomApi } from './activities-custom.js';
import { loadSavedScripts } from './activities-scripts.js';
import { term } from '../../src/activity-terms.js';
import { createActivityWindow } from './activity-window.js';
import { runStudy } from './games/memory-ui.js';
import { runPotion } from './games/potion-ui.js';
import { runTea } from './games/tea-ui.js';
import { runCook, runFish, runGarden } from './games/harvest-ui.js';
import { availableRecipes, recipeBook } from '../../src/activity-harvest-core.js';
import { cookedCounts } from '../../src/activity-progress-core.js';
import { unknownKindHelp } from '../../src/activity-customize-core.js';
import { renderActivitiesPane, ACTIVITIES_CHANGED_EVENT } from './activities-pane.js';
import { teaMenu, teaChoices, snackChoices, teaSprite, snackSprite } from '../../src/activity-tea-core.js';
import { tiredText } from '../../src/activity-energy-core.js';
import {
    activitySettings, saveActivitySettings, activePreset, partnerList, cardOf, studySubjects, subjectsOf, userName,
    inventoryActive, teaNames, snackNames, teaKnown, bringChoices, startMusic, stopMusic, preloadSounds, activityStreakInfo, loadArt, energyStatus, packItems, fishTable,
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

/** The value of "Play alone" in the partner picker. */
const ALONE = '__alone__';

let win = null;
let partnerName = '';
let currentTab = 'study';

/**
 * Drop-in activities: any script on the page can add an activity with window.WorldkitActivities.register({...}); see
 * src/activity-registry.js and docs/MAKE-AN-ACTIVITY.md. The hub reads this list each time it opens.
 */
const registry = createRegistry({ onChange: () => { try { window.dispatchEvent(new CustomEvent(ACTIVITIES_CHANGED_EVENT)); } catch { /* no window */ } } });
try { window.WorldkitActivities = Object.freeze({ register: registry.register, unregister: registry.unregister, list: registry.list }); } catch { /* no window */ }

/**
 * Opens an activity's setup screen by what it IS, not by its id: its kind, and for the harvest kind its mode (cook, fish or garden).
 * Returns false when nothing is built for it yet. A new kind is one entry here.
 */
function openActivity(a) {
    const harvest = { cook: showCookSetup, fish: showFishSetup, garden: showGardenScreen };
    const byKind = { memory: showStudySetup, mastermind: showPotionSetup, tea: showTeaSetup, harvest: harvest[a.mode], [CUSTOM_KIND]: showCustom };
    const open = byKind[a.kind];
    if (!open) return false;
    open(a);
    // Any activity can name a looping music tag; the setup screens above stop earlier music first, so this starts after them.
    if (a.music) startMusic(a.music);
    return true;
}

const chatOpen = () => {
    const c = getContext();
    return Boolean(c && (c.groupId || (c.characterId !== undefined && c.characterId !== null)));
};

function ensureWindow() {
    if (win) return win;
    win = createActivityWindow({ onClose: () => stopMusic() });
    return win;
}

/** Who the player is with: a partner, or { alone: true } (also when there is nobody yet, because the puzzles can be played alone). */
function pickedPartner() {
    const alone = { name: '', id: ALONE, avatar: '', alone: true };
    // Nobody is picked until the player picks someone: the default is to go alone.
    if (!partnerName || partnerName === ALONE) return alone;
    const list = partnerList();
    if (!list.length) return alone;
    return list.find(p => p.name === partnerName) || list[0];
}

/** Seats the partner (or the player alone) in the window's side panel. */
function seat(w, partner, sub) {
    const s = activitySettings();
    w.setPanels({ talk: s.showTalk, howTo: s.showHowTo });
    if (partner.alone) {
        w.setPartner(userName(), '', 'Playing alone');
        w.setSolo(true);
    } else {
        w.setPartner(partner.name, partner.avatar || cardOf(partner.name)?.imageUrl || '', sub);
        w.setSolo(false);
    }
}

/** Disables a Start button and says why when the player is too tired (only while the Vitals Tracker is on). */
function tiredGuard(activity, box, start) {
    const es = energyStatus(activity);
    if (es.ok) return;
    start.disabled = true;
    box.append(el('p', 'snpc-act-note is-small', `${tiredText(es.energy, es.cost)}. Rest first, or let the story pass some time.`));
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
    stopMusic();
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
    if (!partners.length) root.append(el('p', 'snpc-act-note', 'There is nobody to spend time with yet, but you can still play alone. Add a character in the Worldkit menu to share activities.'));

    // Who with.
    const select = el('select', 'snpc-act-select');
    select.setAttribute('aria-label', 'Spend time with');
    for (const p of partners) select.append(new Option(p.name, p.name));
    select.append(new Option('Play alone', ALONE));
    select.value = pickedPartner().alone ? ALONE : pickedPartner().name;
    partnerName = select.value;
    // Tiles depend on who it is with (some need a partner), so they are drawn again.
    select.addEventListener('change', () => { partnerName = select.value; draw(); });
    const who = el('div', 'snpc-act-who');
    who.append(field('With', select));
    const energy = energyStatus({});
    if (energy.active && energy.energy !== null) who.append(el('small', 'snpc-act-energy', `Energy ${Math.round(energy.energy)}`));
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
        const items = tilesForTab(preset.activities, registry.list(), currentTab);
        if (!items.length) grid.append(el('p', 'snpc-act-note', 'Nothing here yet.'));
        const alone = partnerName === ALONE;
        for (const a of items) {
            const needsPartner = alone && !a.solo && !a.soon;
            const es = energyStatus(a);
            const tired = !a.soon && !es.ok;
            const tile = el('button', `snpc-act-tile-card${a.soon ? ' is-soon' : ''}${needsPartner || tired ? ' is-locked' : ''}`);
            tile.type = 'button';
            if (a.soon || needsPartner || tired) tile.setAttribute('aria-disabled', 'true');
            tile.append(el('i', `fa-solid ${a.icon}`));
            tile.append(el('strong', '', a.label));
            tile.append(el('small', '', a.unsupported ? `Unknown kind: ${a.kind}` : a.soon ? 'Coming soon' : (a.blurb || '')));
            if (needsPartner) tile.append(el('small', 'snpc-act-lock', 'Needs a partner'));
            else if (tired) tile.append(el('small', 'snpc-act-lock', tiredText(es.energy, es.cost)));
            else if (!a.soon && es.active && es.cost > 0) tile.append(el('small', 'snpc-act-cost', `Costs ${es.cost} energy`));
            if (!a.soon) {
                const info = activityStreakInfo(a, alone ? '' : partnerName);
                if (info.text || info.bonus) {
                    const streak = el('small', 'snpc-act-streak');
                    streak.append(el('i', 'fa-solid fa-fire'));
                    const bits = [info.run > 0 ? `${info.text}` : info.text];
                    if (info.bonus) bits.push(`${info.doneToday ? 'Bonus today' : 'Bonus if you play today'}: +${info.bonus}% skill XP`);
                    streak.append(document.createTextNode(` ${bits.filter(Boolean).join(' · ')}`));
                    tile.append(streak);
                }
            }
            tile.addEventListener('click', () => {
                if (a.unsupported) { toast('info', unknownKindHelp(a.kind)); return; }
                if (a.soon) { toast('info', `${a.label} is coming soon.`); return; }
                if (needsPartner) { toast('info', `${a.label} needs someone to share it with. Pick a partner above.`); return; }
                if (tired) { toast('warning', `${tiredText(es.energy, es.cost)}. Rest first.`); return; }
                if (!openActivity(a)) toast('info', `${a.label} is coming soon.`);
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

/** The streak line on a setup screen: days in a row with this partner, and the skill XP bonus a play earns today. */
function streakNote(activity, partner) {
    const info = activityStreakInfo(activity, partner.name);
    const parts = [];
    if (info.withText) parts.push(`With ${partner.name}: ${info.withText}`);
    else if (info.text) parts.push(`Overall: ${info.text}`);
    if (info.bonus) parts.push(`skill XP bonus today: +${info.bonus}%`);
    if (!parts.length) return null;
    const note = el('p', 'snpc-act-streak-note');
    note.append(el('i', 'fa-solid fa-fire'), document.createTextNode(` ${parts.join(' · ')}`));
    return note;
}

function showStudySetup(activity) {
    stopMusic();
    const w = ensureWindow();
    const preset = activePreset();
    const s = activitySettings();
    const partner = pickedPartner();
    if (!partner) { showHub(); return; }
    w.setView('hub');
    w.setTitle(activity.label, activity.icon || 'fa-book-open');

    const box = el('div', 'snpc-act-setup');
    { const sn = streakNote(activity, partner); if (sn) box.append(sn); }
    box.append(el('p', 'snpc-act-note',
        `${activity.label}${partner.alone ? ', playing alone' : ` with ${partner.name}`}. Match the ${term(preset, 'tile')}s in pairs. A ${term(preset, 'cursedTile')} that turns up shuffles the board when you miss, `
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
    if (!subjects.length) box.append(el('p', 'snpc-act-note is-small', `No combat type with a matching skill is active, so this session earns ${term(preset, 'knowledge').toLowerCase()} but no skill XP.`));

    const row = el('div', 'snpc-act-row');
    const start = el('button', 'snpc-act-btn', 'Start');
    start.type = 'button';
    start.addEventListener('click', () => {
        s.pairs = Number(pairs.value);
        s.difficulty = difficulty.value;
        saveActivitySettings();
        seat(w, partner, 'Studying together');
        w.userName = userName();
        runStudy(w, {
            partner: partner.name, activityId: activity.id, label: activity.label, pairs: s.pairs, difficulty: s.difficulty,
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
    tiredGuard(activity, box, start);
    w.main.replaceChildren(box);
    start.focus();
}

/** Brewing: pick the difficulty (and a skill to train, when the preset names one), then start. */
function showPotionSetup(activity) {
    stopMusic();
    const w = ensureWindow();
    const preset = activePreset();
    const s = activitySettings();
    const partner = pickedPartner();
    if (!partner) { showHub(); return; }
    w.setView('hub');
    w.setTitle(activity.label, activity.icon || 'fa-flask');

    const box = el('div', 'snpc-act-setup');
    { const sn = streakNote(activity, partner); if (sn) box.append(sn); }
    box.append(el('p', 'snpc-act-note',
        `${activity.label}${partner.alone ? ', playing alone' : ` with ${partner.name}`}. A recipe of four ingredients is hidden. Try combinations and read the answers (how many are right, and how many are in the right place) to work it out before you run out of tries.`));

    const subjects = subjectsOf(preset.potion.profs);
    const subject = el('select', 'snpc-act-select');
    subject.setAttribute('aria-label', 'Skill');
    for (const p of subjects) subject.append(new Option(p.label, p.id));
    if (!subjects.length) subject.append(new Option('No skill set for brewing', ''));
    subject.disabled = !subjects.length;

    const difficulty = el('select', 'snpc-act-select');
    difficulty.setAttribute('aria-label', 'Difficulty');
    for (const [d, text] of [['easy', 'Easy (6 ingredients, no repeats, 10 tries)'], ['normal', 'Normal (6 ingredients, repeats, 8 tries)'], ['hard', 'Hard (8 ingredients, repeats, 6 tries)']]) difficulty.append(new Option(text, d));
    difficulty.value = s.difficulty;

    box.append(field('Skill', subject), field('Difficulty', difficulty));
    const row = el('div', 'snpc-act-row');
    const start = el('button', 'snpc-act-btn', 'Start');
    start.type = 'button';
    start.addEventListener('click', () => {
        s.difficulty = difficulty.value;
        saveActivitySettings();
        seat(w, partner, 'Brewing together');
        w.userName = userName();
        runPotion(w, {
            partner: partner.name, activityId: activity.id, label: activity.label, difficulty: s.difficulty, names: preset.potion.names,
            recipe: preset.potion.recipe, failed: preset.potion.failed, subject: subject.value || '',
            onLeave: () => showHub(), onAgain: () => showPotionSetup(activity),
        });
    });
    const back = el('button', 'snpc-act-btn is-quiet', 'Back');
    back.type = 'button';
    back.addEventListener('click', showHub);
    row.append(start, back);
    box.append(row);
    tiredGuard(activity, box, start);
    w.main.replaceChildren(box);
    start.focus();
}

/** Tea Time: pick a tea and, if you like, a snack from a random spread on a table (hover to highlight), then start. */
function showTeaSetup(activity) {
    stopMusic();
    preloadSounds();
    const w = ensureWindow();
    const preset = activePreset();
    const s = activitySettings();
    const partner = pickedPartner();
    if (partner.alone) { toast('info', `${activity.label} needs a guest. Pick a partner first.`); showHub(); return; }
    w.setView('hub');
    w.setTitle(activity.label, activity.icon || 'fa-mug-hot');
    const teaWord = term(preset, 'tea');

    const box = el('div', 'snpc-act-setup');
    { const sn = streakNote(activity, partner); if (sn) box.append(sn); }
    box.append(el('p', 'snpc-act-note',
        `${activity.label} with ${partner.name}. Choose a ${teaWord} to serve, and a snack if you like. A different spread is laid out each time. Their tastes are not shown: watch how they react, and what you learn is kept for next time.`));

    const teaPool = teaNames(preset);
    const foodPool = snackNames(preset);
    const known = teaKnown()[partner.name] || [];
    const prefs = cardOf(partner.name)?.prefs;
    const sameName = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
    const markOf = (cat, name) => {
        const hit = known.find(k => k.cat === cat && sameName(k.value, name));
        return hit ? (hit.side === 'likes' ? 'like' : 'dislike') : null;
    };

    let teas = [];
    let snacks = [];
    let chosenTea = '';
    let chosenSnack = '';
    const deal = () => {
        teas = teaMenu(teaChoices(teaPool, prefs, { count: 8 }), known);
        snacks = snackChoices(foodPool, prefs, { count: 4 }).map(name => ({ name, mark: markOf('food', name) }));
        chosenTea = teas[0]?.name || '';
        chosenSnack = '';
    };
    deal();

    // The table: the picture, with the items laid on it.
    const wrap = el('div', 'snpc-act-tablewrap');
    const tabletop = el('img', 'snpc-act-tabletop');
    tabletop.alt = '';
    tabletop.draggable = false;
    loadArt(tabletop, 'tea.tabletop', {}, () => { tabletop.remove(); wrap.classList.add('is-plain'); });
    wrap.append(tabletop);
    const overlay = el('div', 'snpc-act-tableoverlay');
    const teaBox = el('div', 'snpc-act-teas');
    teaBox.setAttribute('role', 'radiogroup');
    teaBox.setAttribute('aria-label', `Choose a ${teaWord}`);
    const snackBox = el('div', 'snpc-act-snacks');
    snackBox.setAttribute('role', 'group');
    snackBox.setAttribute('aria-label', 'Choose a snack (optional)');
    overlay.append(teaBox, snackBox);
    wrap.append(overlay);

    const item = ({ name, mark, chosen, kind, onPick }) => {
        const b = el('button', `snpc-act-tableitem${chosen ? ' is-chosen' : ''}`);
        b.type = 'button';
        if (kind === 'tea') { b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(chosen)); } else b.setAttribute('aria-pressed', String(chosen));
        const sprite = kind === 'tea' ? teaSprite(name) : snackSprite(name);
        const img = el('img', 'snpc-act-sprite');
        img.alt = '';
        img.draggable = false;
        loadArt(img, kind === 'tea' ? 'tea.cup' : 'tea.food', { sprite }, () => {
            const icon = el('i', `fa-solid ${kind === 'tea' ? 'fa-mug-hot' : 'fa-cookie-bite'} snpc-act-sprite-icon`);
            img.replaceWith(icon);
        });
        b.append(img, el('span', 'snpc-act-itemname', name));
        if (mark) {
            const badge = el('span', 'snpc-act-itemmark');
            badge.append(el('i', `fa-solid ${mark === 'like' ? 'fa-heart' : 'fa-heart-crack'}`));
            b.append(badge);
        }
        if (chosen) { const tick = el('span', 'snpc-act-itemcheck'); tick.append(el('i', 'fa-solid fa-check')); b.append(tick); }
        const words = [name];
        if (mark) words.push(`you know they ${mark === 'like' ? 'like' : 'dislike'} this`);
        if (chosen) words.push('chosen');
        b.setAttribute('aria-label', words.join(', '));
        b.title = name;
        b.addEventListener('click', onPick);
        return b;
    };

    // What to bring from the pack.
    const bring = el('select', 'snpc-act-select');
    bring.setAttribute('aria-label', 'Bring something from your pack');
    bring.append(new Option('Nothing from my pack', ''));
    for (const it of bringChoices()) bring.append(new Option(it.qty > 1 ? `${it.name} (x${it.qty})` : it.name, it.name));
    bring.addEventListener('change', () => { if (bring.value) { chosenSnack = ''; draw(); } });

    const draw = () => {
        teaBox.replaceChildren(...teas.map(t => item({
            name: t.name, mark: t.mark, chosen: t.name === chosenTea, kind: 'tea', onPick: () => { chosenTea = t.name; draw(); },
        })));
        snackBox.replaceChildren(...snacks.map(sn => item({
            name: sn.name, mark: sn.mark, chosen: sn.name === chosenSnack, kind: 'snack',
            onPick: () => { chosenSnack = chosenSnack === sn.name ? '' : sn.name; if (chosenSnack) bring.value = ''; draw(); },
        })));
        start.disabled = !teas.length || !energyStatus(activity).ok;
    };

    box.append(wrap);
    const reroll = el('button', 'snpc-act-btn is-quiet', 'Lay out a different spread');
    reroll.type = 'button';
    reroll.disabled = teaPool.length <= 8 && foodPool.length <= 4;
    reroll.addEventListener('click', () => { deal(); draw(); });
    box.append(reroll);

    const rounds = el('select', 'snpc-act-select');
    rounds.setAttribute('aria-label', 'Rounds');
    rounds.append(new Option('Short (3 rounds)', '3'), new Option('Long (5 rounds)', '5'));
    rounds.value = String(s.teaRounds);
    box.append(field('Or bring', bring), field('Length', rounds));
    if (!s.teaLlm) box.append(el('p', 'snpc-act-note is-small', 'The model is switched off for Tea Time, so the guest uses built-in lines and the best grade is Good.'));

    const row = el('div', 'snpc-act-row');
    const start = el('button', 'snpc-act-btn', 'Pour');
    start.type = 'button';
    start.addEventListener('click', () => {
        s.teaRounds = Number(rounds.value) === 5 ? 5 : 3;
        saveActivitySettings();
        seat(w, partner, `Sharing a ${teaWord}`);
        w.userName = userName();
        const brought = chosenSnack ? { kind: 'food', name: chosenSnack } : (bring.value ? { name: bring.value } : null);
        runTea(w, {
            partner: partner.name, activityId: activity.id, label: activity.label, preset, tea: chosenTea, bring: brought,
            onLeave: () => showHub(), onAgain: () => showTeaSetup(activity),
        });
    });
    const back = el('button', 'snpc-act-btn is-quiet', 'Back');
    back.type = 'button';
    back.addEventListener('click', showHub);
    row.append(start, back);
    box.append(row);
    draw();
    w.main.replaceChildren(box);
    start.focus();
}

/** Cooking: choose a recipe (the ones you can cook now first), then play the three steps. */
function showCookSetup(activity) {
    stopMusic();
    const w = ensureWindow();
    const preset = activePreset();
    const s = activitySettings();
    const partner = pickedPartner();
    w.setView('hub');
    w.setTitle(activity.label, activity.icon || 'fa-utensils');

    const box = el('div', 'snpc-act-setup');
    { const sn = streakNote(activity, partner); if (sn) box.append(sn); }
    box.append(el('p', 'snpc-act-note',
        `${activity.label}${partner.alone ? ', cooking alone' : ` with ${partner.name}`}. Choose a dish. Some need ingredients from your pack, which are used up; the simple ones need nothing. Then time three steps: chop, heat and season.`));

    const tracked = inventoryActive();
    const rows = tracked ? availableRecipes(preset.harvest.recipes, packItems()) : preset.harvest.recipes.map(recipe => ({ recipe, missing: [], ok: true }));
    let chosen = rows.find(r => r.ok)?.recipe.id || '';
    const list = el('div', 'snpc-act-recipes');
    list.setAttribute('role', 'radiogroup');
    list.setAttribute('aria-label', 'Choose a dish');
    const draw = () => {
        list.replaceChildren();
        for (const r of rows) {
            const b = el('button', `snpc-act-recipe${r.recipe.id === chosen ? ' is-chosen' : ''}${r.ok ? '' : ' is-missing'}`);
            b.type = 'button';
            b.setAttribute('role', 'radio');
            b.setAttribute('aria-checked', String(r.recipe.id === chosen));
            b.setAttribute('aria-disabled', String(!r.ok));
            b.append(el('strong', '', r.recipe.name), el('small', '', r.recipe.desc || ''));
            const needs = r.recipe.needs.length === 0 ? 'No ingredients needed'
                : !tracked ? `Ingredients: ${r.recipe.needs.map(n => n.label).join(' and ')} (not tracked, the Inventory is off)`
                : r.ok ? `Uses ${r.recipe.needs.map(n => n.label).join(' and ')}`
                    : `Needs ${r.missing.map(m => `${m.label}${m.have ? ` (you have ${m.have})` : ''}`).join(' and ')}`;
            b.append(el('small', 'snpc-act-recipe-needs', needs));
            b.addEventListener('click', () => {
                if (!r.ok) { toast('info', `${r.recipe.name}: ${needs}.`); return; }
                chosen = r.recipe.id;
                draw();
            });
            list.append(b);
        }
    };
    draw();
    box.append(list);

    // The recipe book: every dish, what it needs, how often you made it, and whose favourite it is.
    const book = el('details', 'snpc-act-book');
    book.append(el('summary', '', 'Recipe book'));
    const fillBook = () => {
        for (const old of [...book.querySelectorAll('.snpc-act-book-list')]) old.remove();
        const mine = cardOf(userName());
        const cards = partnerList().map(p => cardOf(p.name)).filter(Boolean);
        const entries = recipeBook(preset.harvest.recipes, { made: cookedCounts(mine?.actStats, activity.id), pack: tracked ? packItems() : [], tracked, cards });
        const ul = el('ul', 'snpc-act-book-list');
        for (const e of entries) {
            const li = el('li', e.known ? 'is-known' : '');
            li.append(el('strong', '', e.name));
            if (e.desc) li.append(el('small', '', e.desc));
            li.append(el('small', '', e.needs.length ? `Ingredients: ${e.needs.join(', ')}` : 'No ingredients needed'));
            li.append(el('small', '', e.known ? `Cooked ${e.made} time${e.made === 1 ? '' : 's'}` : 'Not cooked yet'));
            if (tracked && !e.ok) li.append(el('small', 'snpc-act-lock', `You lack: ${e.missing.join(', ')}`));
            if (e.favoriteOf.length) li.append(el('small', 'snpc-act-streak', `Favourite meal of ${e.favoriteOf.join(', ')}`));
            ul.append(li);
        }
        book.append(ul);
    };
    book.addEventListener('toggle', () => { if (book.open) fillBook(); });
    box.append(book);

    const difficulty = el('select', 'snpc-act-select');
    difficulty.setAttribute('aria-label', 'Difficulty');
    for (const d of ['easy', 'normal', 'hard']) difficulty.append(new Option(d[0].toUpperCase() + d.slice(1), d));
    difficulty.value = s.difficulty;
    box.append(field('Difficulty', difficulty));

    const row = el('div', 'snpc-act-row');
    const start = el('button', 'snpc-act-btn', 'Start cooking');
    start.type = 'button';
    start.addEventListener('click', () => {
        const recipe = rows.find(r => r.recipe.id === chosen)?.recipe;
        if (!recipe) return;
        s.difficulty = difficulty.value;
        saveActivitySettings();
        seat(w, partner, 'Cooking together');
        w.userName = userName();
        runCook(w, { partner: partner.name, activityId: activity.id, label: activity.label, recipe, difficulty: s.difficulty, onLeave: () => showHub(), onAgain: () => showCookSetup(activity) });
    });
    const back = el('button', 'snpc-act-btn is-quiet', 'Back');
    back.type = 'button';
    back.addEventListener('click', showHub);
    row.append(start, back);
    box.append(row);
    tiredGuard(activity, box, start);
    w.main.replaceChildren(box);
    start.focus();
}

/** Fishing: choose the difficulty, and a contest if there is a partner, then go. */
function showFishSetup(activity) {
    stopMusic();
    const w = ensureWindow();
    const preset = activePreset();
    const s = activitySettings();
    const partner = pickedPartner();
    w.setView('hub');
    w.setTitle(activity.label, activity.icon || 'fa-fish');

    const box = el('div', 'snpc-act-setup');
    { const sn = streakNote(activity, partner); if (sn) box.append(sn); }
    box.append(el('p', 'snpc-act-note',
        `${activity.label}${partner.alone ? ', fishing alone' : ` with ${partner.name}`}. Cast your line three times. Wait for a bite without tapping, hook it the moment it twitches, then keep the cursor on the fish while you reel. Every fish you land goes in your pack.`));

    const difficulty = el('select', 'snpc-act-select');
    difficulty.setAttribute('aria-label', 'Difficulty');
    for (const d of ['easy', 'normal', 'hard']) difficulty.append(new Option(d[0].toUpperCase() + d.slice(1), d));
    difficulty.value = s.difficulty;
    box.append(field('Difficulty', difficulty));

    const contestBox = el('input');
    contestBox.type = 'checkbox';
    contestBox.disabled = partner.alone;
    contestBox.setAttribute('aria-label', 'A contest with your partner');
    const contestRow = el('label', 'snpc-act-field-row');
    contestRow.append(el('span', '', 'Contest'), contestBox, el('small', 'snpc-act-note is-small', partner.alone ? 'Needs a partner.' : `Fish against ${partner.name}: the heavier catch wins.`));
    box.append(contestRow);

    const row = el('div', 'snpc-act-row');
    const start = el('button', 'snpc-act-btn', 'Go fishing');
    start.type = 'button';
    start.addEventListener('click', () => {
        s.difficulty = difficulty.value;
        saveActivitySettings();
        seat(w, partner, 'Fishing together');
        w.userName = userName();
        runFish(w, {
            partner: partner.name, activityId: activity.id, label: activity.label, difficulty: s.difficulty, contest: contestBox.checked, table: fishTable(preset),
            onLeave: () => showHub(), onAgain: () => showFishSetup(activity),
        });
    });
    const back = el('button', 'snpc-act-btn is-quiet', 'Back');
    back.type = 'button';
    back.addEventListener('click', showHub);
    row.append(start, back);
    box.append(row);
    tiredGuard(activity, box, start);
    w.main.replaceChildren(box);
    start.focus();
}

/** A drop-in activity: seats the partner, checks the energy and hands the registered run function its api. */
function showCustom(activity) {
    stopMusic();
    const w = ensureWindow();
    const preset = activePreset();
    const partner = pickedPartner();
    const es = energyStatus(activity);
    if (!es.ok) { toast('warning', `${tiredText(es.energy, es.cost)}. Rest first.`); showHub(); return; }
    const runner = registry.runnerOf(activity.id);
    if (!runner) { toast('info', `${activity.label} is no longer available.`); showHub(); return; }
    seat(w, partner, activity.label);
    w.userName = userName();
    const start = () => {
        w.resetTalk();
        w.setView('play');
        w.setTitle(activity.label, activity.icon);
        const api = buildCustomApi({ activity, win: w, partner, preset, leave: () => showHub(), restart: start });
        const fail = (err) => { console.error(`[Worldkit] activity "${activity.id}" failed`, err); toast('error', `${activity.label} ran into a problem and was closed.`); showHub(); };
        try {
            const out = runner(api);
            if (out && typeof out.catch === 'function') out.catch(fail);
        } catch (err) { fail(err); }
    };
    start();
}

/** Gardening: straight into the garden (the plots are the screen). */
function showGardenScreen(activity) {
    stopMusic();
    const w = ensureWindow();
    const preset = activePreset();
    const partner = pickedPartner();
    const es = energyStatus(activity);
    if (!es.ok) { toast('warning', `${tiredText(es.energy, es.cost)}. Rest first.`); showHub(); return; }
    seat(w, partner, `In ${term(preset, 'gardenPlace')}`);
    w.userName = userName();
    runGarden(w, { partner: partner.name, activityId: activity.id, label: activity.label, preset, onLeave: () => showHub() });
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
    // The activity files the player added run again at every start; each registers its own tile.
    loadSavedScripts().catch(err => console.warn('[Worldkit] could not load the saved activity files', err));
    eventSource.on(event_types.CHAT_CHANGED, () => {
        // A new chat has other people in it: the window closes and the partner pick starts over.
        partnerName = '';
        stopMusic();
        if (win?.isOpen()) win.close();
        renderActivitiesButton();
    });
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, () => renderActivitiesButton());
});
