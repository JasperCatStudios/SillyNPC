import { getContext } from '../../../../st-context.js';
import { getSettings } from './settings.js';
import { buildConnectionProfilePicker } from './ui-connection-profiles.js';

/**
 * Which connection profile each part of Worldkit runs on (fork).
 *
 * One list for the whole extension, drawn as the Connections tab. Most rows are ordinary
 * settings that already existed (combat, internal states, bonds, vitals) and are simply gathered here;
 * Phone and Games keep their own settings objects, so those rows drive the picker each of them
 * already has rather than writing behind their backs.
 */

/** @type {{ id: string, label: string, help: string, scope?: 'root'|'tracker', key?: string, dom?: string }[]} */
/** The connections that belong to the Trackers group. */
const TRACKER_CONNECTIONS = ['internal', 'bonds', 'vitals', 'inventory'];
/** The connections that belong to the Modules group: the three windows with a connection of their own. */
const MODULE_CONNECTIONS = ['combat', 'phone', 'games'];

export const CONNECTION_USES = [
    { id: 'combat', label: 'Combat', scope: 'root', key: 'combatProfileId',
      help: 'Generating combat stats from lore, and the table talk during a fight.' },
    { id: 'internal', label: 'Internal states', scope: 'root', key: 'internalStatesProfileId',
      help: 'What characters think and feel.' },
    { id: 'bonds', label: 'Bonds', scope: 'root', key: 'bondProfileId',
      help: 'Reading each reply to propose bond changes and milestones (Bond Tracker, after-the-reply timing).' },
    { id: 'vitals', label: 'Vitals', scope: 'root', key: 'vitalsProfileId',
      help: 'Reading each reply to update health, hunger and mood (Vitals Tracker).' },
    { id: 'inventory', label: 'Inventory', scope: 'root', key: 'inventoryProfileId',
      help: 'Reading each reply to update items and money (Inventory Tracker).' },
    { id: 'threads', label: 'Threads', scope: 'root', key: 'threadsProfileId',
      help: 'Reading each reply for promises, debts, secrets and plans left open, and the catch-up scan. Empty means your main API.' },
    { id: 'banscan', label: 'Ban scan', scope: 'root', key: 'banScanProfileId',
      help: 'Reading the chat for phrases to ban (Writing Rules, Ban List). Empty means your main API.' },
    { id: 'phone', label: 'Phone', dom: '#rph-drawer .rph-profile-row select',
      help: 'The messages your characters text you.' },
    { id: 'games', label: 'Games', dom: '#rpg-game-profile',
      help: 'Chess, cards, dice and the table talk.' },
];

function supportedProfiles() {
    try {
        return getContext().ConnectionManagerRequestService.getSupportedProfiles() || null;
    } catch {
        return null;
    }
}

/** A picker for a module that keeps its own setting: it moves that module's own dropdown. */
function domPicker(use) {
    const wrap = document.createElement('div');
    wrap.className = 'sillynpc-setting';
    const row = document.createElement('div');
    row.className = 'sillynpc-setting-row';
    const label = document.createElement('label');
    label.className = 'sillynpc-setting-label';
    label.textContent = use.label;
    const note = document.createElement('small');
    note.className = 'notes';
    note.style.cssText = 'margin-top:4px; display:block;';
    note.textContent = use.help;

    const theirs = document.querySelector(use.dom);
    const profiles = supportedProfiles();
    if (!theirs || !profiles) {
        note.textContent = `${use.help} ${!profiles ? 'Connection Manager is not available.' : 'Turn this module on first.'}`;
        row.append(label);
        wrap.append(row, note);
        return wrap;
    }
    const select = document.createElement('select');
    select.className = 'text_pole';
    select.append(new Option('Main API (same as chat)', ''));
    for (const p of profiles) select.append(new Option(p.name || p.id, p.id));
    select.value = theirs.value || '';
    select.addEventListener('change', () => {
        theirs.value = select.value;
        theirs.dispatchEvent(new Event('change', { bubbles: true }));
        if (window.jQuery) window.jQuery(theirs).trigger('change');
    });
    row.append(label, select);
    wrap.append(row, note);
    return wrap;
}

/** The Connections tab. */
export function renderConnectionsView(view) {
    if (!view) return;
    view.replaceChildren();

    const title = document.createElement('h3');
    title.className = 'sillynpc-section-title';
    title.textContent = 'Connections';
    view.append(title);

    const intro = document.createElement('p');
    intro.className = 'notes sillynpc-tab-intro';
    intro.textContent = 'Choose which connection profile each part of Worldkit uses. Anything left on '
        + '"Main API" uses the connection you are chatting with. Needs the Connection Manager extension.';
    view.append(intro);

    // The trackers' connections sit together in a collapsible group.
    const trackers = document.createElement('details');
    trackers.className = 'sillynpc-prompt-group';
    trackers.open = true;
    const trackersTitle = document.createElement('summary');
    trackersTitle.textContent = 'Trackers';
    trackers.append(trackersTitle);
    view.append(trackers);

    const modules = document.createElement('details');
    modules.className = 'sillynpc-prompt-group';
    modules.open = true;
    const modulesTitle = document.createElement('summary');
    modulesTitle.textContent = 'Modules';
    modules.append(modulesTitle);
    view.append(modules);

    const groupFor = (use) => (TRACKER_CONNECTIONS.includes(use.id) ? trackers : MODULE_CONNECTIONS.includes(use.id) ? modules : view);

    for (const use of CONNECTION_USES) {
        if (use.dom) { groupFor(use).append(domPicker(use)); continue; }
        groupFor(use).append(buildConnectionProfilePicker(null, {
            key: use.key,
            scope: use.scope,
            labelText: use.label,
            fallbackLabel: 'Main API (same as chat)',
            noteText: use.help,
            unavailableText: `${use.help} Connection Manager is not available, so the main API is used.`,
        }));
    }
}

/**
 * One plain request on the connection chosen for a use, falling back to the main API.
 * @param {string} settingKey Root setting holding the profile id, e.g. 'combatProfileId'.
 * @returns {Promise<string>}
 */
export async function requestOnConnection(settingKey, system, user, maxTokens = 1200) {
    const context = getContext();
    const profileId = getSettings()[settingKey];
    if (profileId) {
        try {
            const result = await context.ConnectionManagerRequestService.sendRequest(
                profileId,
                [{ role: 'system', content: system }, { role: 'user', content: user }],
                maxTokens,
                { extractData: true, includePreset: false },
            );
            return (typeof result === 'string' ? result : (result?.content ?? '')) || '';
        } catch (err) {
            console.warn('[Worldkit] Connection unavailable, using the main API:', err);
        }
    }
    const raw = await context.generateRawData({ prompt: user, systemPrompt: system, responseLength: maxTokens });
    return (typeof raw === 'string' ? raw : (raw?.content ?? '')) || '';
}
