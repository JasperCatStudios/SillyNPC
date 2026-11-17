import { saveSettingsDebounced } from '../../../../../script.js';
import { extension_settings } from '../../../../extensions.js';
import { CONTEXT_SAVERS, findSaver, isSaverOn, saverDepth, setSaverOn, setSaverDepth } from './context-savers.js';

/**
 * The context savers, with an on switch and a depth each. They are SillyTavern regex scripts (imported from the Content Kit),
 * so this edits them where they are: the same list the Regex menu shows, which will show the change after a reload.
 */

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

export function buildContextSaverControls() {
    const wrap = el('div');
    wrap.append(el('h3', 'sillynpc-section-title', 'Context Savers'));
    wrap.lastChild.style.marginTop = '20px';
    wrap.append(el('p', 'notes sillynpc-tab-intro',
        'A context saver takes a tracker\'s block out of older messages before the prompt goes to the story model, so the block does not '
        + 'cost tokens every turn. It only matters when that block is written inside the reply. Depth is how many messages back it starts: '
        + '2 keeps the block on the newest message and removes it from the older ones. Switch one off to keep that tracker\'s older blocks in the prompt.'));

    const scripts = Array.isArray(extension_settings.regex) ? extension_settings.regex : [];
    for (const saver of CONTEXT_SAVERS) {
        const script = findSaver(scripts, saver);
        const row = el('div', 'sillynpc-setting');
        row.dataset.setting = `contextSaver.${saver.key}`;
        const line = el('div', 'sillynpc-setting-row');
        const label = el('label', 'checkbox_label');
        label.style.cssText = 'display:flex; align-items:center; gap:8px; flex:1;';
        const box = el('input');
        box.type = 'checkbox';
        box.checked = isSaverOn(script);
        box.disabled = !script;
        box.addEventListener('change', () => { setSaverOn(script, box.checked); saveSettingsDebounced(); });
        label.append(box, el('span', '', saver.label));
        line.append(label);

        const depth = el('input', 'text_pole');
        depth.type = 'number';
        depth.min = '0';
        depth.style.width = '5em';
        depth.value = String(saverDepth(script));
        depth.disabled = !script;
        depth.title = 'How many messages back it starts removing the block';
        // Saved when the number is committed, so typing a two-digit depth is not interrupted.
        depth.addEventListener('change', () => {
            setSaverDepth(script, depth.value);
            depth.value = String(saverDepth(script));
            saveSettingsDebounced();
        });
        line.append(el('span', 'notes', 'Depth'), depth);
        row.append(line);
        if (!script) row.append(el('small', 'notes', `Not imported yet. Import "${saver.names[0]}" from the Content Kit tab, or SillyTavern's Regex menu.`));
        wrap.append(row);
    }
    return wrap;
}
