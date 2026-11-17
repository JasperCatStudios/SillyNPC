import { renderCombatSection } from './ui-combat-section.js';
import { renderCharacterExtras } from './ui-character-extras.js';
import { pickLorebookInto } from './ui-lorebook-section.js';
import { buildInventoryCard, inventoryAvailable, NO_CHAT_HINT } from './ui-inventory-card.js';
import { buildIdentityCard } from './ui-identity.js';

/**
 * The profile page's tab row (fork): Combat, Equipment, Voice and Visual Prompt, and above it
 * the lorebook link. One tab shows at a time, and every tab edits in place, so the profile no
 * longer needs a trip to the Edit tab for the things people change most.
 *
 * Each tab draws with the same builders the editor uses, so what is saved is identical:
 *   Combat         the sheet: details, level, condition, abilities, stats and ranks
 *   Equipment      weapons and tools
 *   Voice          the character's voice and phone skin
 *   Visual Prompt  the positive and negative picture prompts
 */

export const PROFILE_TABS = Object.freeze([
    ['combat', 'Combat', 'fa-khanda', 'Stats, ranks, abilities and condition.'],
    ['equipment', 'Equipment', 'fa-shield-halved', 'Weapons and tools.'],
    ['inventory', 'Inventory', 'fa-bag-shopping', 'What they carry, and their money.'],
    ['identity', 'Identity', 'fa-mask', 'A secret identity: link this card to another one they secretly are.'],
    ['visual', 'Visual Prompt', 'fa-image', 'Picture prompts for this character.'],
]);

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

/** Which tab each character was last on, for the session. */
const lastTab = new Map();

/**
 * The lorebook link as one line: where it points, and a button to pick or change it. The picker
 * opens right under the line.
 */
export function buildLoreLinkBar(char, { onChange } = {}) {
    const wrap = el('div', 'sillynpc-cv-lorelink');
    const line = el('div', 'sillynpc-cv-lorelink-line');
    line.append(el('span', 'sillynpc-cv-label', 'Lore link'));
    const where = char.lorebook?.world;
    line.append(el('span', 'sillynpc-cv-lorelink-where', where ? `${where}${char.lorebook.uid !== undefined && char.lorebook.uid !== null ? ` · entry ${char.lorebook.uid}` : ''}` : 'Not linked'));
    const host = el('div', 'sillynpc-combat-linkpicker');
    const button = el('button', 'menu_button', where ? 'Change' : 'Link a lorebook entry');
    button.type = 'button';
    button.title = 'Choose a lorebook, then the entry in it that describes this character.';
    button.addEventListener('click', async () => {
        button.disabled = true;
        try {
            await pickLorebookInto(host, char, () => { onChange?.(); });
        } catch (err) {
            console.error('[Worldkit] could not open the lorebook picker', err);
            toastr.error('Could not open the lorebook picker.', 'Worldkit');
            button.disabled = false;
        }
    });
    line.append(button);
    wrap.append(line, host);
    return wrap;
}

/** The character's voice, as a line of its own under the lorebook link (it used to be a tab). */
export function buildVoiceLine(char) {
    const wrap = el('div', 'sillynpc-cv-voiceline');
    renderCharacterExtras(char, wrap, { part: 'voice' });
    return wrap;
}

/**
 * The tab row and the open tab's contents.
 * @param {object} char
 * @param {{ onChange?: () => void }} [options] called after something that other parts of the
 *   page show changes (the lorebook link, the combat sheet)
 * @returns {HTMLElement}
 */
export function buildProfileTabs(char, options = {}) {
    const root = el('div', 'sillynpc-cv-tabs');
    const bar = el('div', 'sillynpc-cv-tabrow');
    const body = el('div', 'sillynpc-cv-tabbody');
    root.append(bar, body);

    const key = char.id || char.name || 'player';
    let current = lastTab.get(key) || 'combat';
    if (current === 'inventory' && !inventoryAvailable()) current = 'combat';

    const draw = () => {
        bar.replaceChildren();
        for (const [id, label, icon, hint] of PROFILE_TABS) {
            const tab = el('button', `sillynpc-charview-tab sillynpc-cv-tab${id === current ? ' active' : ''}`);
            tab.type = 'button';
            tab.dataset.tab = id;
            tab.title = hint;
            tab.append(el('i', `fa-solid ${icon}`), document.createTextNode(` ${label}`));
            if (id === 'inventory' && !inventoryAvailable()) {
                // An inventory belongs to a chat: with none open the tab is greyed out and says why on hover.
                tab.disabled = true;
                tab.title = NO_CHAT_HINT;
                tab.style.opacity = '0.5';
                tab.style.cursor = 'not-allowed';
            }
            tab.addEventListener('click', () => { if (tab.disabled) return; current = id; lastTab.set(key, id); draw(); });
            bar.append(tab);
        }
        body.replaceChildren();
        const host = el('div', 'sillynpc-cv-tabpane');
        host.dataset.pane = current;
        body.append(host);
        const redraw = () => { draw(); options.onChange?.(); };
        try {
            if (current === 'combat') renderCombatSection(char, host, { parts: 'sheet', noPersona: true, onChange: redraw });
            else if (current === 'equipment') renderCombatSection(char, host, { parts: 'gear', onChange: redraw });
            else if (current === 'inventory') host.append(buildInventoryCard(char));
            else if (current === 'identity') host.append(buildIdentityCard(char));
            else renderCharacterExtras(char, host, { part: 'visual' });
        } catch (err) {
            console.error('[Worldkit] profile tab failed', current, err);
            host.append(el('p', 'notes', 'This tab could not be drawn. The Edit tab still has everything.'));
        }
    };
    draw();
    return root;
}
