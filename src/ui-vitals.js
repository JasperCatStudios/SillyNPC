import { eventSource } from '../../../../events.js';
import { buildSettingToggle, buildSettingSelect, buildSettingNumber, buildSettingTextArea } from './ui-shared.js';
import { buildConnectionProfilePicker } from './ui-connection-profiles.js';
import {
    vitalsSettings, saveVitalsSettings, vitalsStore, getVitals, resetVitalFor, runVitalsUpdate,
    latestReplyId, currentVitalsInjection, VITALS_CHANGED_EVENT,
} from './vitals.js';
import {
    VITALS_SETTINGS_DEFAULTS, VITALS_TIMINGS, VITALS_POSITIONS, VITALS_ROLES, VITALS_TRIGGERS, VITALS_SYSTEM,
    VITAL_DEFAULTS, healthWord, hungerWord, energyWord, moodText,
} from './vitals-core.js';

/**
 * The Vitals Tracker's screens (fork): its settings in the Tracker tab, and the Status card that
 * the character profile (and the player sheet) shows. The card is one function so every place
 * that wants it draws the same thing: Mood, Hunger, Health and Energy (all kept by the Vitals tracker), each with a reset button.
 */

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

const STORE = { get: () => vitalsSettings(), save: () => saveVitalsSettings(), defaults: VITALS_SETTINGS_DEFAULTS };
const TRACK = { get: () => vitalsSettings().track, save: () => saveVitalsSettings(), defaults: VITALS_SETTINGS_DEFAULTS.track };
const DRIFT = { get: () => vitalsSettings().drift, save: () => saveVitalsSettings(), defaults: VITALS_SETTINGS_DEFAULTS.drift };
const LIMITS = { get: () => vitalsSettings().limits, save: () => saveVitalsSettings(), defaults: VITALS_SETTINGS_DEFAULTS.limits };
const namespaced = (node) => { if (node?.dataset?.setting) node.dataset.setting = `vitals.${node.dataset.setting}`; return node; };
const options = (table) => Object.entries(table).map(([value, label]) => ({ value, label }));

/* ------------------------------------------------------------------ the Status card */

function meterRow({ key, label, icon, percent, text, resetTitle, onReset, off }) {
    const row = el('div', `snpc-vit-row snpc-vit-${key}${off ? ' is-off' : ''}`);
    row.dataset.vital = key;
    const head = el('div', 'snpc-vit-head');
    const name = el('span', 'snpc-vit-name');
    name.append(el('i', `fa-solid ${icon}`), document.createTextNode(` ${label}`));
    head.append(name, el('span', 'snpc-vit-text', text));
    row.append(head);
    const track = el('div', 'snpc-vit-track');
    const fill = el('div', 'snpc-vit-fill');
    fill.style.width = `${percent ?? 0}%`;
    track.append(fill);
    row.append(track);
    const reset = el('button', 'menu_button snpc-vit-reset');
    reset.type = 'button';
    reset.disabled = Boolean(off);
    reset.title = resetTitle;
    reset.append(el('i', 'fa-solid fa-rotate-left'), el('span', '', 'Reset'));
    reset.addEventListener('click', (e) => { e.preventDefault(); onReset(); });
    row.append(reset);
    return row;
}

/**
 * The Status card: Mood, Hunger, Health, Energy. Health, hunger and energy run 0 to 100 and a reset puts
 * them back to 100 (healthy, full, rested); mood is a word with a strength and resets to calm.
 *
 * @param {{ name: string, isPlayer?: boolean }} char
 * @param {{ onChange?: () => void }} [opts] called after a reset, so the caller can redraw
 * @returns {HTMLElement}
 */
export function buildStatusCard(char, { onChange } = {}) {
    const card = el('div', 'snpc-vit-card');
    card.append(el('div', 'snpc-vit-title', 'Status'));
    const settings = vitalsSettings();
    const name = char?.name || '';
    const person = settings.enabled ? getVitals(name) : null;
    const redraw = () => { onChange?.(); };

    const vital = (key, label, icon, read, resetTitle) => {
        const tracked = settings.enabled && settings.track[key];
        const p = person || { health: VITAL_DEFAULTS.health, hunger: VITAL_DEFAULTS.hunger, energy: VITAL_DEFAULTS.energy, mood: VITAL_DEFAULTS.mood };
        const { percent, text } = read(p);
        return meterRow({
            key, label, icon, percent, text: tracked ? text : 'not tracked', off: !tracked, resetTitle,
            onReset: () => { resetVitalFor(name, key); redraw(); },
        });
    };

    card.append(
        vital('mood', 'Mood', 'fa-face-meh', p => ({ percent: p.mood.level, text: moodText(p.mood) }), 'Back to calm'),
        vital('hunger', 'Hunger', 'fa-utensils', p => ({ percent: p.hunger, text: `${hungerWord(p.hunger)} · ${p.hunger}%` }), 'Back to full (100%)'),
        vital('health', 'Health', 'fa-heart', p => ({ percent: p.health, text: `${healthWord(p.health)} · ${p.health}%` }), 'Back to healthy (100%)'),
        vital('energy', 'Energy', 'fa-bolt', p => ({ percent: p.energy, text: `${energyWord(p.energy)} · ${p.energy}%` }), 'Back to rested (100%)'),
    );

    if (!settings.enabled) {
        card.append(el('small', 'notes snpc-vit-note', 'Mood, hunger, health and energy are off. Turn on the Vitals Tracker in the Tracker tab.'));
    }
    return card;
}

/* ------------------------------------------------------------------ the settings view */

let currentView = null;
let listening = false;

export function renderVitalsView(view) {
    if (!view) return;
    if (view.isConnected || !currentView?.isConnected) currentView = view;
    if (!listening) {
        listening = true;
        eventSource.on(VITALS_CHANGED_EVENT, () => {
            if (currentView?.isConnected && !currentView.contains(document.activeElement)) renderVitalsView(currentView);
        });
    }
    const scroll = view.closest('.sillynpc-tab-panel')?.scrollTop ?? 0;
    view.replaceChildren();
    view.classList.add('snpc-vitals');
    const rerender = () => renderVitalsView(view);

    view.append(el('h3', 'sillynpc-section-title', 'Vitals Tracker'));
    view.append(el('p', 'notes sillynpc-tab-intro',
        'Health, hunger, energy and mood for the people in the story. Health, hunger and energy run from 0 to 100 (0 is dead, starving or exhausted; 100 is healthy, full or rested). '
        + 'Mood is a word for how someone feels and a number for how strongly. Vitals are kept per chat. The model only proposes values; '
        + 'the limits below decide how far each one may move in a single reply. These replace the default status tracker HP and Energy stats, so those can be deleted there.'));

    view.append(namespaced(buildSettingToggle({
        store: STORE, key: 'enabled', label: 'Track Vitals',
        help: 'The master switch. Off: no requests, no changes, nothing sent to the story. What is already recorded is kept.',
        onChange: rerender,
    })));
    if (!vitalsSettings().enabled) {
        view.append(el('p', 'notes snpc-vit-off', 'The tracker is off. Everything below can still be set up.'));
    }

    view.append(namespaced(buildSettingSelect({
        store: STORE, key: 'timing', label: 'When Vitals Update', options: options(VITALS_TIMINGS), onChange: rerender,
        help: 'After The Reply: a separate request on the Vitals connection reads each new reply. Only When I Press Update: nothing happens by itself.',
    })));
    view.append(buildConnectionProfilePicker(null, {
        key: 'vitalsProfileId', scope: 'root', labelText: 'Vitals Connection', fallbackLabel: 'Main API (same as chat)',
        noteText: 'Which connection reads replies for vitals. A small, fast model is enough.',
        unavailableText: 'Connection Manager is not available, so the main API is used.',
    }));

    view.append(el('h4', 'sillynpc-combat-heading', 'What to track'));
    for (const [key, label, help] of [
        ['health', 'Health', '0 is dead, 100 is healthy.'],
        ['hunger', 'Hunger', '0 is starving, 100 is full.'],
        ['energy', 'Energy', '0 is exhausted, 100 is rested.'],
        ['mood', 'Mood / stress', 'A word for how they feel, with how strongly it holds. Use stress-style words if you want a stress meter.'],
    ]) {
        view.append(namespaced(buildSettingToggle({ store: TRACK, key, label, help, onChange: rerender })));
    }
    view.append(namespaced(buildSettingToggle({
        store: STORE, key: 'includePlayer', label: 'Include Your Persona',
        help: 'Track the player\'s own health, hunger, energy and mood too.',
    })));

    view.append(el('h4', 'sillynpc-combat-heading', 'How fast things may change'));
    view.append(el('p', 'notes', 'The most one reply can move each value, in points. A story can hurt someone a lot at once but should not heal or feed them from nothing.'));
    for (const [key, label] of [['health', 'Health per reply'], ['hunger', 'Hunger per reply'], ['energy', 'Energy per reply'], ['mood', 'Mood strength per reply']]) {
        view.append(namespaced(buildSettingNumber({ store: LIMITS, key, label, suffix: 'points' })));
    }

    view.append(el('h4', 'sillynpc-combat-heading', 'Wearing down with time'));
    view.append(el('p', 'notes', 'Each reply costs a little hunger and energy for the people it is about, unless the story says something happened (a meal, a rest). '
        + 'Health never wears down: it changes only for an injury, illness or healing. Mood is entirely up to the scene. 0 turns a drift off.'));
    for (const [key, label] of [['hunger', 'Hunger lost per reply'], ['energy', 'Energy lost per reply']]) {
        view.append(namespaced(buildSettingNumber({ store: DRIFT, key, label, suffix: 'points' })));
    }

    renderPeople(view, rerender);

    view.append(el('h4', 'sillynpc-combat-heading', 'Reader and story prompt'));
    view.append(namespaced(buildSettingNumber({ store: STORE, key: 'maxTokens', label: 'Reply Budget', suffix: 'tokens', help: 'The answer is a small JSON object; 600 is plenty.', advanced: true })));
    view.append(namespaced(buildSettingNumber({ store: STORE, key: 'contextMessages', label: 'Earlier Messages Read', suffix: 'messages', advanced: true })));
    // The reader instructions moved to the Prompts tab, under Tracker prompts.
    view.append(namespaced(buildSettingSelect({ store: { get: () => vitalsSettings().inject, save: () => saveVitalsSettings(), defaults: VITALS_SETTINGS_DEFAULTS.inject }, key: 'trigger', label: 'Send To The Story For', options: options(VITALS_TRIGGERS), advanced: true, help: 'Whose vitals go into the story prompt each turn.' })));
    view.append(namespaced(buildSettingSelect({ store: { get: () => vitalsSettings().inject, save: () => saveVitalsSettings(), defaults: VITALS_SETTINGS_DEFAULTS.inject }, key: 'position', label: 'Prompt Position', options: options(VITALS_POSITIONS), advanced: true })));
    view.append(namespaced(buildSettingSelect({ store: { get: () => vitalsSettings().inject, save: () => saveVitalsSettings(), defaults: VITALS_SETTINGS_DEFAULTS.inject }, key: 'role', label: 'Prompt Role', options: options(VITALS_ROLES), advanced: true })));

    const preview = el('pre', 'snpc-vit-preview notes');
    const showPreview = el('button', 'menu_button', 'Preview what is sent');
    showPreview.type = 'button';
    showPreview.addEventListener('click', () => { preview.textContent = currentVitalsInjection({ everyone: true }) || '(nothing yet)'; });
    view.append(showPreview, preview);

    const panel = view.closest('.sillynpc-tab-panel');
    if (panel) panel.scrollTop = scroll;
}

function renderPeople(view, rerender) {
    view.append(el('h4', 'sillynpc-combat-heading', 'People in this chat'));
    const store = vitalsStore();
    if (!store) { view.append(el('p', 'notes', 'Open a chat to see its vitals.')); return; }
    if (!store.people.length) { view.append(el('p', 'notes', 'Nobody is tracked yet. They appear after the first reply is read.')); }
    const list = el('div', 'snpc-vit-people');
    for (const p of store.people) {
        const row = el('div', 'snpc-vit-person');
        row.append(el('b', '', `${p.name}${p.player ? ' (you)' : ''}`),
            el('span', 'notes', `Health ${p.health}% · Hunger ${p.hunger}% · Energy ${p.energy}% · Mood ${moodText(p.mood)}`));
        for (const key of ['health', 'hunger', 'energy', 'mood']) {
            const b = el('button', 'menu_button', `Reset ${key}`);
            b.type = 'button';
            b.addEventListener('click', () => { resetVitalFor(p.name, key); rerender(); });
            row.append(b);
        }
        list.append(row);
    }
    view.append(list);
    const update = el('button', 'menu_button', 'Read the latest reply now');
    update.type = 'button';
    update.addEventListener('click', () => {
        const id = latestReplyId();
        if (id >= 0) runVitalsUpdate(id, { force: true, button: true }).then(rerender);
    });
    view.append(update);
}
