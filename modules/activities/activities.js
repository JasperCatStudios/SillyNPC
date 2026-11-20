import { assistOn } from '../../src/touch-ease.js';
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
import { runCraft } from './games/craft-ui.js';
import { runDrill } from './games/drill-ui.js';
import { runExam } from './games/exam-ui.js';
import { examTarget, examPlan, credentialName } from '../../src/activity-exam-core.js';
import { runKitchen } from './games/mech/kitchen-ui.js';
import { runMeal } from './games/meal-ui.js';
import { normalizePrefs } from '../../src/likes-core.js';
import { availableRecipes, recipeBook } from '../../src/activity-harvest-core.js';
import { allRecipes } from '../../src/activity-recipe-creator-core.js';
import { renderRecipeCreator } from './activities-recipe-creator.js';
import { cookedCounts } from '../../src/activity-progress-core.js';
import { unknownKindHelp } from '../../src/activity-customize-core.js';
import { renderActivitiesPane, ACTIVITIES_CHANGED_EVENT } from './activities-pane.js';
import { teaMenu, teaChoices, snackChoices } from '../../src/activity-tea-core.js';
import { tiredText } from '../../src/activity-energy-core.js';
import {
    activitySettings, saveActivitySettings, activePreset, partnerList, cardOf, studySubjects, subjectsOf, userName,
    inventoryActive, craftTier, teaNames, snackNames, teaKnown, bringChoices, startMusic, stopMusic, preloadSounds, activityStreakInfo, energyStatus, allSubjects, skillStanding, mayExamine, packItems, fishTable,
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
    const byKind = { memory: showStudySetup, mastermind: showPotionSetup, tea: showTeaSetup, harvest: harvest[a.mode], craft: showCraft, drill: showDrill, exam: showExam, [CUSTOM_KIND]: showCustom };
    const open = byKind[a.kind];
    if (!open) return false;
    open(a);
    // Any activity can name a looping music tag; the setup screens above stop earlier music first, so this starts after them.
    const track = a.music || (a.kind === 'craft' ? activePreset().crafts?.[a.craft]?.music : '');
    if (track) startMusic(track);
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

/** Tea Time: straight to the table. The tea tins, the tea set and the plates are on it; the host chooses, makes, offers and talks. */
function showTeaSetup(activity) {
    stopMusic();
    preloadSounds();
    const w = ensureWindow();
    const preset = activePreset();
    const partner = pickedPartner();
    if (partner.alone) { toast('info', `${activity.label} needs a guest. Pick a partner first.`); showHub(); return; }
    const es = energyStatus(activity);
    if (!es.ok) { toast('info', `${tiredText(es.energy, es.cost)}. Rest first, or let the story pass some time.`); showHub(); return; }
    const teaWord = term(preset, 'tea');
    const teaPool = teaNames(preset);
    const foodPool = snackNames(preset);
    const known = teaKnown()[partner.name] || [];
    const prefs = cardOf(partner.name)?.prefs;
    const sameName = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
    const markOf = (cat, name) => {
        const hit = known.find(k => k.cat === cat && sameName(k.value, name));
        return hit ? (hit.side === 'likes' ? 'like' : 'dislike') : null;
    };
    /** A random spread: eight teas and four snacks (the likes of the guest are always among them). */
    const deal = () => ({
        teas: teaMenu(teaChoices(teaPool, prefs, { count: 8 }), known),
        snacks: snackChoices(foodPool, prefs, { count: 4 }).map(name => ({ name, mark: markOf('food', name) })),
    });
    const first = deal();
    seat(w, partner, `Sharing a ${teaWord}`);
    w.userName = userName();
    runTea(w, {
        partner: partner.name, activityId: activity.id, label: activity.label, preset, teas: first.teas, snacks: first.snacks, bringItems: bringChoices(),
        deal: (teaPool.length > 8 || foodPool.length > 4) ? deal : null, onLeave: () => showHub(), onAgain: () => showTeaSetup(activity),
    });
}

/** Share a Meal: the optional step after cooking. The table with the dish you made, a drink and things to lay the table with. */
function showMealSetup(activity, partner, recipe, grade) {
    stopMusic();
    preloadSounds();
    const w = ensureWindow();
    const preset = activePreset();
    seat(w, partner, 'Sharing a meal');
    w.userName = userName();
    runMeal(w, {
        partner: partner.name, activityId: 'meal', label: 'Share a meal', preset, recipe, grade,
        onLeave: () => showHub(), onAgain: () => showCookSetup(activity),
    });
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
    // The preset's dishes plus the ones the player made in the recipe creator.
    const dishes = allRecipes(preset.harvest.recipes, s.myRecipes);
    const rows = tracked ? availableRecipes(dishes, packItems()) : dishes.map(recipe => ({ recipe, missing: [], ok: true }));
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
        const entries = recipeBook(dishes, { made: cookedCounts(mine?.actStats, activity.id), pack: tracked ? packItems() : [], tracked, cards });
        const ul = el('ul', 'snpc-act-book-list');
        for (const e of entries) {
            const li = el('li', e.known ? 'is-known' : '');
            li.append(el('strong', '', e.name));
            if (e.desc) li.append(el('small', '', e.desc));
            li.append(el('small', '', e.needs.length ? `Ingredients: ${e.needs.join(', ')}` : 'No ingredients needed'));
            if (e.restore !== null) li.append(el('small', '', `Restores ${e.restore} hunger when eaten`));
            li.append(el('small', '', e.known ? `Cooked ${e.made} time${e.made === 1 ? '' : 's'}` : 'Not cooked yet'));
            if (tracked && !e.ok) li.append(el('small', 'snpc-act-lock', `You lack: ${e.missing.join(', ')}`));
            if (e.favoriteOf.length) li.append(el('small', 'snpc-act-streak', `Favourite meal of ${e.favoriteOf.join(', ')}`));
            ul.append(li);
        }
        book.append(ul);
    };
    book.addEventListener('toggle', () => { if (book.open) fillBook(); });
    box.append(book);
    box.append(renderRecipeCreator({ presetRecipes: preset.harvest.recipes, onChange: () => showCookSetup(activity) }));

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
        // The hands-on kitchen, unless the player chose the classic three-tap cooking (kept as a fallback).
        if (s.classicCooking) {
            runCook(w, { partner: partner.name, activityId: activity.id, label: activity.label, recipe, difficulty: s.difficulty, onLeave: () => showHub(), onAgain: () => showCookSetup(activity) });
        } else {
            runKitchen(w, {
                partner: partner.name, activityId: activity.id, label: activity.label, recipe, difficulty: s.difficulty, assist: assistOn(s), tier: craftTier('cooking'),
                pack: tracked ? packItems() : null, prefs: partner.alone ? undefined : cardOf(partner.name)?.prefs, onLeave: () => showHub(), onAgain: () => showCookSetup(activity),
                onShare: partner.alone ? null : ({ recipe: made, grade }) => showMealSetup(activity, partner, made, grade),
            });
        }
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

/** How a character takes feedback (their Likes tab): { praise, critique, empathize, silence } of 'like' or 'dislike'. */
function feedbackOf(name) {
    try { return normalizePrefs(cardOf(name)?.prefs).feedback; } catch { return {}; }
}

/** A craft: the craft type is the preset's (or the built-in) one named by the activity; the skill tier comes from the player's rank. */
function showCraft(activity) {
    stopMusic();
    const w = ensureWindow();
    const preset = activePreset();
    const s = activitySettings();
    const partner = pickedPartner();
    const es = energyStatus(activity);
    if (!es.ok) { toast('warning', `${tiredText(es.energy, es.cost)}. Rest first.`); showHub(); return; }
    const craft = preset.crafts?.[activity.craft];
    if (!craft) { toast('warning', `${activity.label} has no craft data.`); showHub(); return; }
    seat(w, partner, craft.terms?.workplace ? `In ${craft.terms.workplace}` : activity.label);
    w.userName = userName();
    const start = () => runCraft(w, {
        partner: partner.name, activityId: activity.id, label: activity.label, craft, difficulty: s.difficulty, assist: assistOn(s),
        tier: craftTier(craft.prof), partnerTier: partner.alone ? 0 : craftTier(craft.prof, partner.name), partnerFeedback: partner.alone ? {} : feedbackOf(partner.name), pack: inventoryActive() ? packItems() : null, onLeave: () => showHub(), onAgain: start,
    });
    start();
}

/** A skill drill: pick what it trains (when the drill does not say) and how hard, then drill. The drill itself is preset data. */
function showDrill(activity) {
    stopMusic();
    const w = ensureWindow();
    const preset = activePreset();
    const s = activitySettings();
    const partner = pickedPartner();
    const es = energyStatus(activity);
    if (!es.ok) { toast('warning', `${tiredText(es.energy, es.cost)}. Rest first.`); showHub(); return; }
    const drill = preset.drills?.[activity.drill];
    if (!drill) { toast('warning', `${activity.label} has no drill data.`); showHub(); return; }
    w.setView('hub');
    w.setTitle(activity.label, activity.icon || 'fa-bullseye');

    const box = el('div', 'snpc-act-setup');
    { const sn = streakNote(activity, partner); if (sn) box.append(sn); }
    box.append(el('p', 'snpc-act-note', `${drill.blurb || activity.blurb || ''} ${drill.rounds} rounds${partner.alone ? ', practising alone' : `, with ${partner.name}`}.`.trim()));

    // What it trains: the drill's own proficiency when it names one the combat type has, else any the player picks.
    const subjects = allSubjects();
    const fixed = subjects.find(p => p.id === drill.prof);
    const subject = el('select', 'snpc-act-select');
    subject.setAttribute('aria-label', 'Skill to train');
    if (fixed) subject.append(new Option(fixed.label, fixed.id));
    else for (const p of subjects) subject.append(new Option(p.label, p.id));
    if (!subjects.length) subject.append(new Option('No skill (just practice)', ''));
    subject.disabled = Boolean(fixed) || !subjects.length;
    box.append(field('Trains', subject));

    const difficulty = el('select', 'snpc-act-select');
    difficulty.setAttribute('aria-label', 'Difficulty');
    for (const d of ['easy', 'normal', 'hard']) difficulty.append(new Option(d[0].toUpperCase() + d.slice(1), d));
    difficulty.value = s.difficulty;
    box.append(field('Difficulty', difficulty));

    const row = el('div', 'snpc-act-row');
    const go = el('button', 'snpc-act-btn', 'Start the drill');
    go.type = 'button';
    go.addEventListener('click', () => {
        s.difficulty = difficulty.value;
        saveActivitySettings();
        seat(w, partner, drill.terms.place ? `At ${drill.terms.place}` : activity.label);
        w.userName = userName();
        const again = () => showDrill(activity);
        runDrill(w, {
            partner: partner.alone ? '' : partner.name, activityId: activity.id, label: activity.label, drill, difficulty: s.difficulty,
            subject: subject.value, subjectLabel: subject.selectedOptions[0]?.textContent || '', onLeave: () => showHub(), onAgain: again,
        });
    });
    const back = el('button', 'snpc-act-btn is-quiet', 'Back');
    back.type = 'button';
    back.addEventListener('click', showHub);
    row.append(go, back);
    box.append(row);
    w.main.replaceChildren(box);
}

/**
 * The certification exam: the examiner is the partner, the exam is for the next rank of a skill, and it is a graded set of drills.
 * Every word (exam, examiner, credential) comes from the preset's terms.
 */
function showExam(activity) {
    stopMusic();
    const w = ensureWindow();
    const preset = activePreset();
    const s = activitySettings();
    const partner = pickedPartner();
    const es = energyStatus(activity);
    if (!es.ok) { toast('warning', `${tiredText(es.energy, es.cost)}. Rest first.`); showHub(); return; }
    const exam = term(preset, 'exam');
    const examiner = term(preset, 'examiner');
    const credential = term(preset, 'credential');
    w.setView('hub');
    w.setTitle(activity.label, activity.icon || 'fa-certificate');
    const box = el('div', 'snpc-act-setup');
    const back = el('button', 'snpc-act-btn is-quiet', 'Back');
    back.type = 'button';
    back.addEventListener('click', showHub);
    const finishScreen = (row) => { box.append(row); w.main.replaceChildren(box); };

    if (partner.alone) {
        box.append(el('p', 'snpc-act-note', `The ${exam.toLowerCase()} needs a ${examiner.toLowerCase()} to set it. Pick a partner above.`));
        const row = el('div', 'snpc-act-row'); row.append(back); finishScreen(row); return;
    }
    const drills = preset.drills || {};
    if (!Object.keys(drills).length) {
        box.append(el('p', 'snpc-act-note', 'This preset has no drills to set the exam from.'));
        const row = el('div', 'snpc-act-row'); row.append(back); finishScreen(row); return;
    }

    // Skills that can still go up a rank, and that this partner may examine.
    const options = [];
    for (const p of allSubjects()) {
        const standing = skillStanding(p.id);
        if (!standing) continue;
        const target = examTarget(preset, { rungs: standing.rungs, rankIndex: standing.rankIndex });
        if (!target.ok || !mayExamine(preset, partner.name, p.id, target.targetIndex)) continue;
        options.push({ id: p.id, label: p.label, standing, target });
    }
    box.append(el('p', 'snpc-act-note',
        `${partner.name} will examine you. Pick a skill: the ${exam.toLowerCase()} is for its next rank. Pass every test to rise one rank and earn the ${credential.toLowerCase()}.`));
    if (!options.length) {
        box.append(el('p', 'snpc-act-note', `Nothing to take with ${partner.name}: no skill has a next rank, or ${partner.name} may not examine in it, or there is no combat sheet.`));
        const row = el('div', 'snpc-act-row'); row.append(back); finishScreen(row); return;
    }
    const subject = el('select', 'snpc-act-select');
    subject.setAttribute('aria-label', 'Skill to be examined in');
    for (const o of options) subject.append(new Option(o.label, o.id));
    box.append(field('Skill', subject));
    const info = el('p', 'snpc-act-note');
    const planFor = () => {
        const o = options.find(x => x.id === subject.value) || options[0];
        const ids = Object.keys(drills).filter(id => !drills[id].prof || drills[id].prof === o.id);
        const plan = examPlan(preset, o.target, ids.length ? ids : Object.keys(drills));
        return { o, plan, name: credentialName(o.target.tierName, credential) };
    };
    const drawInfo = () => {
        const { o, plan, name } = planFor();
        const top = plan.length ? Math.max(...plan.map(t => t.need)) : 0;
        info.textContent = `${o.label}: ${o.target.fromRung || 'no rank'} to ${o.target.targetRung}. Earns a ${name}. ${plan.length} test${plan.length === 1 ? '' : 's'}, up to ${Math.round(top * 100)}% of the points to pass each.`;
    };
    subject.addEventListener('change', drawInfo);
    drawInfo();
    box.append(info);

    const row = el('div', 'snpc-act-row');
    const go = el('button', 'snpc-act-btn', term(preset, 'examVerb'));
    go.type = 'button';
    go.addEventListener('click', () => {
        const { o, plan, name } = planFor();
        seat(w, partner, `${exam} with ${partner.name}`);
        w.userName = userName();
        runExam(w, {
            examiner: partner.name, label: activity.label, activityId: activity.id, subject: o.id, subjectLabel: o.label,
            fromRung: o.target.fromRung, toRung: o.target.targetRung, credentialName: name, plan, drills,
            words: { exam, examiner, credential }, onLeave: () => showHub(), onAgain: () => showExam(activity),
        });
    });
    row.append(go, back);
    finishScreen(row);
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
