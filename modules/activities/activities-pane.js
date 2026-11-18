import { BUILT_IN_PRESETS } from '../../src/activity-presets.js';
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

export function renderActivitiesPane(pane, { makeSwitch } = {}) {
    const s = activitySettings();
    const changed = () => { saveActivitySettings(); window.dispatchEvent(new CustomEvent(ACTIVITIES_CHANGED_EVENT)); };

    const row = (label, control, hint) => {
        const wrap = el('div', 'sillynpc-setting-row');
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
        toggle('The partner talks', 'talkOn', 'Off means short built-in lines and no requests to a model.'),
        toggle('Tea Time uses the model', 'teaLlm', 'On: the guest voices the conversation and proposes things to say. Off: built-in lines, and the best grade is Good.'),
        toggle('Tea Time: type your own words', 'teaFreeText', 'Lets you type a line instead of tapping one of the three openers. Only when the model is on.'),
        toggle('Tea Time: the guest asks questions', 'teaGuestAsks', 'About one round in three the guest asks you something and your choices become answers.'),
        toggle('Tea Time: show what you have learned', 'teaShowKnown', 'A "Known so far" note about the guest on the Tea Time screen.'),
        toggle('Tea Time music', 'musicOn', 'Plays the music loop from the sound map while Tea Time is open (the tag is set by the world preset). Off means silence.'),
        toggle('Activities cost energy', 'vitalsOn', 'Each activity costs the player some energy, and one is refused when there is not enough. Only works while the Vitals Tracker is on and tracks energy.'),
        toggle('Skill XP and levels', 'xpOn', 'Finished activities add skill XP and a little level XP.'),
        toggle('Bond nudges', 'bondOn', 'A good session can warm a tracked bond a little, once a day per person and activity.'),
        toggle('XP for skills used in fights', 'combatProfXp', 'Each fight adds XP to the skills the fighters used, so ranks grow from fighting too.'),
    );
    pane.append(
        row('Study board', select('pairs', [[4, 'Small (4 pairs)'], [8, 'Medium (8 pairs)'], [12, 'Large (12 pairs)']], '', Number)),
        row('Difficulty', select('difficulty', [['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']])),
    );

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
    pane.append(row('Music volume', vol, 'How loud the Tea Time music is, on top of the sound-effects volume.'));

    const cost = el('input', 'text_pole');
    cost.type = 'number'; cost.min = '0'; cost.max = '100'; cost.style.width = '6em';
    cost.value = String(s.energyCost);
    cost.addEventListener('change', () => { const v = Number(cost.value); if (Number.isFinite(v)) { s.energyCost = Math.max(0, Math.min(100, Math.round(v))); changed(); } });
    pane.append(row('Energy per activity', cost, 'How much energy one activity takes, out of 100. A preset can give an activity its own cost. Only while the Vitals Tracker is on.'));

    const mapBox = el('input', 'text_pole');
    mapBox.type = 'text';
    mapBox.placeholder = 'Leave empty to use the world preset\'s';
    mapBox.style.cssText = 'width: 100%; min-width: 12em;';
    mapBox.value = s.soundMapUrl;
    mapBox.addEventListener('change', () => { s.soundMapUrl = mapBox.value.trim(); changed(); });
    pane.append(row('Sound map address', mapBox, 'A sound map just for activities: their music and effects. The Fire Emblem preset points at the fe-sounds folder in your own profile. A missing file is silent.'));

    // World preset.
    const presetSel = el('select', 'text_pole');
    presetSel.append(new Option('Pick by the active combat type', ''));
    presetSel.append(new Option('Generic', 'generic'));
    for (const p of Object.values(BUILT_IN_PRESETS)) presetSel.append(new Option(p.name, p.id));
    for (const p of Object.values(s.presets)) presetSel.append(new Option(p.name, p.id));
    presetSel.value = s.presetId;
    if (presetSel.value !== s.presetId) presetSel.value = '';
    presetSel.addEventListener('change', () => { s.presetId = presetSel.value; changed(); note.textContent = noteText(); });
    const note = el('small', 'notes');
    const noteText = () => `In use now: ${activePreset().name}.`;
    note.textContent = noteText();
    pane.append(row('World preset', presetSel, 'A preset says which activities a world has and what they are called. With none, Generic is used.'), note);
}
