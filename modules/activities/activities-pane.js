import { BUILT_IN_PRESETS } from '../../src/activity-presets.js';
import { normalizeActionKey, actionKeyLabel } from '../../src/activity-config-core.js';
import { renderCustomize } from './activities-customize.js';
import { renderScriptsSection } from './activities-scripts.js';
import { activitySettings, saveActivitySettings, activePreset, stopMusic, refreshMusicVolume } from './activities-runtime.js';

/**
 * The Activities tab in Modules (fork): the module's switches and the world preset. Written as the other
 * module panes are: a row per setting, saved as it changes, nothing redrawn while typing. The connection the
 * partner talks on is chosen under Connections, and what a finished activity sends to the story is the panel
 * below this one.
 */

export const ACTIVITIES_CHANGED_EVENT = 'worldkit-activities-changed';

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

/** Which group of the pane each setting belongs to, by its label. Anything not listed lands in General. */
const CATEGORIES = [
    ['general', 'General'],
    ['talk', 'Table talk and the model'],
    ['play', 'How the games play'],
    ['progress', 'Skills, energy and story'],
    ['sound', 'Music and sound'],
];
const CATEGORY_OF = {
    'Activities on': 'general', 'Show the button': 'general', 'Show How to play': 'general',
    'Show the table talk': 'talk', 'Built-in lines when the model is off': 'talk', 'The partner talks': 'talk',
    'Story messages sent': 'talk', 'Seconds between partner requests': 'talk', 'Seconds between spoken lines': 'talk',
    'Classic cooking': 'play', 'Easier timing (assist)': 'play', 'Study board': 'play', 'Difficulty': 'play', 'Controls': 'play',
    'Action key': 'play', 'Second action key': 'play',
    'Skill XP and levels': 'progress', 'Bond nudges': 'progress', 'XP for skills used in fights': 'progress', 'Activities cost energy': 'progress',
    'Energy per activity': 'progress', 'Story minutes per activity': 'progress',
    'Activity music': 'sound', 'Music volume': 'sound', 'Sound map address': 'sound',
};

export function renderActivitiesPane(pane, { makeSwitch } = {}) {
    const s = activitySettings();
    const changed = () => { saveActivitySettings(); window.dispatchEvent(new CustomEvent(ACTIVITIES_CHANGED_EVENT)); };

    const row = (label, control, hint) => {
        const wrap = el('div', 'sillynpc-setting-row');
        wrap.dataset.cat = CATEGORY_OF[label] || 'general';
        const l = el('label', 'sillynpc-setting-label', hint ? `${label} ⓘ` : label);
        if (hint) l.title = hint;
        // The control sits in its own box. The settings CSS stretches any label that is a direct child of a row, which
        // made the switches as wide as the pane; inside a box they keep their size, and selects get a sensible width.
        const box = el('div', 'snpc-act-ctl');
        box.style.cssText = 'flex: 0 0 auto; display: flex; justify-content: flex-end; max-width: 60%;';
        if (control.tagName === 'SELECT') control.style.minWidth = '13em';
        box.append(control);
        wrap.append(l, box);
        return wrap;
    };
    const toggle = (label, key, hint) => {
        const sw = makeSwitch ? makeSwitch(Boolean(s[key]), (on) => { s[key] = on; changed(); if (key === 'musicOn' && !on) stopMusic(); }) : (() => {
            const box = el('input');
            box.type = 'checkbox';
            box.checked = Boolean(s[key]);
            box.addEventListener('change', () => { s[key] = box.checked; changed(); });
            return box;
        })();
        return row(label, sw, hint);
    };
    const select = (key, options, hint, parse = (v) => v) => {
        const sel = el('select', 'text_pole');
        for (const [value, text] of options) sel.append(new Option(text, String(value)));
        sel.value = String(s[key]);
        sel.addEventListener('change', () => { s[key] = parse(sel.value); changed(); });
        return sel;
    };

    pane.append(
        toggle('Activities on', 'enabled', 'Turns the whole module off, including its button.'),
        toggle('Show the button', 'buttonShown', 'Hides the green floating button but keeps the module on.'),
        toggle('Show the table talk', 'showTalk', 'The Chat and Log tabs beside each activity. Off hides them (and nothing is asked of the model for them).'),
        toggle('Show How to play', 'showHowTo', 'The How to play tab beside each activity.'),
        toggle('Built-in lines when the model is off', 'cannedLines', 'Short ready-made lines for the partner at the start, the end and a few turning points when the partner\'s talk is off or a request fails. Off means silence instead. Moments (a fish bites, a harvest) never use built-in lines.'),
        toggle('The partner talks', 'talkOn', 'Off means short built-in lines and no requests to a model.'),
        toggle('Activity music', 'musicOn', 'Plays an activity\'s looping music from the sound map while it is open (each activity names its tag under Customize an activity; Tea Time uses its preset tag). Off means silence.'),
        toggle('Activities cost energy', 'vitalsOn', 'Each activity costs the player some energy, and one is refused when there is not enough. Only works while the Vitals Tracker is on and tracks energy.'),
        toggle('Classic cooking', 'classicCooking', 'Cooking uses the old three timing taps instead of the hands-on kitchen (chopping, stirring, searing, seasoning). Off is the new kitchen.'),
        toggle('Easier timing (assist)', 'assist', 'Cooking, fishing and gardening: a wider zone and a slower marker.'),
        toggle('Skill XP and levels', 'xpOn', 'Finished activities add skill XP and a little level XP.'),
        toggle('Bond nudges', 'bondOn', 'A good session can warm a tracked bond a little, once a day per person and activity.'),
        toggle('XP for skills used in fights', 'combatProfXp', 'Each fight adds XP to the skills the fighters used, so ranks grow from fighting too.'),
    );
    pane.append(
        row('Study board', select('pairs', [[4, 'Small (4 pairs)'], [8, 'Medium (8 pairs)'], [12, 'Large (12 pairs)']], '', Number)),
        row('Difficulty', select('difficulty', [['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']]), 'Harder difficulties give more skill XP.'),
        row('Controls', select('controls', [['auto', 'Automatic'], ['pointer', 'Mouse or touch'], ['button', 'Action button or key']]), 'How the hands-on games are played. The action button (the action key, Space or the on-screen button) works for every step and scores about the same.'),
    );

    // Action key: the key or mouse button that presses the big button in cooking and fishing (the button itself always works by click or tap).
    const keyBtn = el('button', 'menu_button');
    keyBtn.type = 'button';
    keyBtn.style.minWidth = '9em';
    const keyReset = el('button', 'menu_button', 'Reset');
    keyReset.type = 'button';
    const showKey = () => { keyBtn.textContent = actionKeyLabel(s.actionKey); keyReset.disabled = s.actionKey === 'KeyA'; };
    keyBtn.addEventListener('click', () => {
        keyBtn.textContent = 'Press a key or mouse button... (Esc cancels)';
        const stop = () => { document.removeEventListener('keydown', onKey, true); document.removeEventListener('mousedown', onMouse, true); setTimeout(showKey, 0); };
        const take = (code) => { s.actionKey = normalizeActionKey(code); changed(); stop(); };
        const onKey = (e) => { e.preventDefault(); e.stopPropagation(); if (e.code === 'Escape') { stop(); return; } take(e.code); };
        const onMouse = (e) => { e.preventDefault(); e.stopPropagation(); if (e.target === keyBtn) return; take(`Mouse${e.button}`); };
        document.addEventListener('keydown', onKey, true);
        setTimeout(() => document.addEventListener('mousedown', onMouse, true), 150);
    });
    keyReset.addEventListener('click', () => { s.actionKey = 'KeyA'; changed(); showKey(); });
    showKey();
    const keyBox = el('div');
    keyBox.style.cssText = 'display: flex; gap: 6px; align-items: center;';
    keyBox.append(keyBtn, keyReset);
    const flipBtn = el('button', 'menu_button');
    flipBtn.type = 'button';
    flipBtn.style.minWidth = '9em';
    const flipReset = el('button', 'menu_button', 'Reset');
    flipReset.type = 'button';
    const showFlip = () => { flipBtn.textContent = actionKeyLabel(s.flipKey); flipReset.disabled = s.flipKey === 'KeyF'; };
    flipBtn.addEventListener('click', () => {
        flipBtn.textContent = 'Press a key or mouse button... (Esc cancels)';
        const stop = () => { document.removeEventListener('keydown', onKey, true); document.removeEventListener('mousedown', onMouse, true); setTimeout(showFlip, 0); };
        const take = (code) => { s.flipKey = normalizeActionKey(code); changed(); stop(); };
        const onKey = (e) => { e.preventDefault(); e.stopPropagation(); if (e.code === 'Escape') { stop(); return; } take(e.code); };
        const onMouse = (e) => { e.preventDefault(); e.stopPropagation(); if (e.target === flipBtn) return; take(`Mouse${e.button}`); };
        document.addEventListener('keydown', onKey, true);
        setTimeout(() => document.addEventListener('mousedown', onMouse, true), 150);
    });
    flipReset.addEventListener('click', () => { s.flipKey = 'KeyF'; changed(); showFlip(); });
    showFlip();
    const flipBox = el('div');
    flipBox.style.cssText = 'display: flex; gap: 6px; align-items: center;';
    flipBox.append(flipBtn, flipReset);
    pane.append(row('Action key', keyBox, 'The key (or mouse button) that presses the big button in cooking and fishing; Space always works too. Click the button, then press the key or mouse button you want. The on-screen button still works by click or tap.'));
    pane.append(row('Second action key', flipBox, 'Flips the fish while cooking (and serves it on the second side). Tapping the main action key only keeps the heat up. Click the button, then press the key or mouse button you want.'));

    const messages = el('input', 'text_pole');
    messages.type = 'number'; messages.min = '0'; messages.max = '30'; messages.style.width = '6em';
    messages.value = String(s.contextMessages);
    messages.addEventListener('change', () => { const v = Number(messages.value); if (Number.isFinite(v)) { s.contextMessages = Math.max(0, Math.min(30, Math.round(v))); changed(); } });
    pane.append(row('Story messages sent', messages, 'How many recent chat messages the partner is shown when they talk.'));

    const vol = el('input');
    vol.type = 'range'; vol.min = '0'; vol.max = '100'; vol.step = '5';
    vol.value = String(Math.round(s.musicVolume * 100));
    vol.setAttribute('aria-label', 'Music volume');
    vol.style.cssText = 'width: 9em;';
    vol.addEventListener('input', () => { s.musicVolume = Number(vol.value) / 100; changed(); refreshMusicVolume(activePreset().tea?.music); });
    pane.append(row('Music volume', vol, 'How loud the activity music is, on top of the sound-effects volume.'));

    const cost = el('input', 'text_pole');
    cost.type = 'number'; cost.min = '0'; cost.max = '100'; cost.style.width = '6em';
    cost.value = String(s.energyCost);
    cost.addEventListener('change', () => { const v = Number(cost.value); if (Number.isFinite(v)) { s.energyCost = Math.max(0, Math.min(100, Math.round(v))); changed(); } });
    pane.append(row('Energy per activity', cost, 'How much energy one activity takes, out of 100. A preset can give an activity its own cost. Only while the Vitals Tracker is on.'));

    const minutes = el('input', 'text_pole');
    minutes.type = 'number'; minutes.min = '0'; minutes.max = '600'; minutes.style.width = '6em';
    minutes.value = String(s.activityMinutes);
    minutes.addEventListener('change', () => { const v = Number(minutes.value); if (Number.isFinite(v)) { s.activityMinutes = Math.max(0, Math.min(600, Math.round(v))); changed(); } });
    pane.append(row('Story minutes per activity', minutes, 'How much story time an activity takes. It is added to the report the story model gets, with an instruction to let that time pass. 0 says nothing about time.'));

    const numberField = (key, label, hint, max = 300) => {
        const input = el('input', 'text_pole');
        input.type = 'number'; input.min = '0'; input.max = String(max); input.style.width = '6em';
        input.value = String(s[key]);
        input.addEventListener('change', () => { const v = Number(input.value); if (Number.isFinite(v)) { s[key] = Math.max(0, Math.min(max, Math.round(v))); changed(); } });
        pane.append(row(label, input, hint));
    };
    numberField('talkCooldownSec', 'Seconds between partner requests', 'The least time between two table-talk requests to the model, so a busy moment does not send one after another. The start, the end and your own typed messages are never held back. 0 means no limit.');
    numberField('speakCooldownSec', 'Seconds between spoken lines', 'The least time between two lines the partner speaks aloud (text-to-speech). The text still appears; only the voice waits. 0 means no limit.');

    const mapBox = el('input', 'text_pole');
    mapBox.type = 'text';
    mapBox.placeholder = 'Leave empty to use the world preset\'s';
    mapBox.style.cssText = 'width: 100%; min-width: 12em;';
    mapBox.value = s.soundMapUrl;
    mapBox.addEventListener('change', () => { s.soundMapUrl = mapBox.value.trim(); changed(); });
    pane.append(row('Sound map address', mapBox, 'A sound map just for activities: their music and effects. A world preset can point at its own sound folder. A missing file is silent.'));

    // Group the rows above under headings, in a fixed order.
    const rows = [...pane.children].filter((n) => n.dataset?.cat);
    for (const [cat, title] of CATEGORIES) {
        const inCat = rows.filter((n) => n.dataset.cat === cat);
        if (!inCat.length) continue;
        const h = el('h4', 'sillynpc-section-title', title);
        h.style.marginTop = '14px';
        pane.append(h, ...inCat);
    }

    // World preset.
    const presetSel = el('select', 'text_pole');
    presetSel.append(new Option('Pick by the active combat type', ''));
    presetSel.append(new Option('Generic', 'generic'));
    for (const p of Object.values(BUILT_IN_PRESETS)) presetSel.append(new Option(p.name, p.id));
    for (const [pid, p] of Object.entries(s.presets)) presetSel.append(new Option(String(p?.name || pid), String(p?.id || pid)));
    presetSel.value = s.presetId;
    if (presetSel.value !== s.presetId) presetSel.value = '';
    presetSel.addEventListener('change', () => { s.presetId = presetSel.value; changed(); note.textContent = noteText(); redrawCustomize?.(); });
    const note = el('small', 'notes');
    const noteText = () => `In use now: ${activePreset().name}.`;
    note.textContent = noteText();
    let redrawCustomize = null;
    pane.append(row('World preset', presetSel, 'A preset says which activities a world has and what they are called. With none, Generic is used.'), note);

    // Your own activities: add an activity file and it is registered for you.
    const scriptsHost = el('div');
    pane.append(scriptsHost);
    renderScriptsSection(scriptsHost, { changed });

    // Customize an activity: content only (names, words, lists), never the rules.
    const customizeHost = el('div');
    pane.append(customizeHost);
    redrawCustomize = renderCustomize(customizeHost, { changed: () => { changed(); note.textContent = noteText(); } });
}
