import { eventSource } from '../../../../events.js';
import { TRACKER_THEMES, THEME_PLAIN, THEME_CUSTOM, CUSTOM_REGEX_PREFIX_DEFAULT } from './tracker-themes.js';
import { getTrackerTheme, setAllTrackerThemes, customRegexScripts } from './tracker-theme-setting.js';
import { getSettings, saveSettings } from './settings.js';
import { drawSection } from './internal-states.js';
import { redrawAllBondSections } from './bonds.js';
import { redrawAllVitalsSections } from './vitals-section.js';
import { redrawAllInventorySections } from './inventory-section.js';

/**
 * The "Look" choice shown at the top of each tracker's menu.
 *
 * It is one choice for all four trackers: picking Cozy Parchment in Vitals picks it for Bonds,
 * Inventory and Internal States too, so what appears under a reply always matches. Each menu
 * shows the same current value, and changing it anywhere changes it everywhere.
 *
 * @param {'states'|'bonds'|'vitals'|'inventory'} tracker Whose menu this is.
 * @param {{ onChange?: () => void }} [options] Called after the choice, to redraw the menu.
 */
export function buildThemePicker(tracker, { onChange } = {}) {
    const wrap = document.createElement('div');
    wrap.className = 'sillynpc-setting';
    wrap.dataset.setting = `trackerThemes.${tracker}`;

    const row = document.createElement('div');
    row.className = 'sillynpc-setting-row';
    const label = document.createElement('label');
    label.className = 'sillynpc-setting-label';
    label.textContent = 'Look';
    const select = document.createElement('select');
    select.className = 'text_pole';
    for (const [value, name] of Object.entries(TRACKER_THEMES)) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = name;
        select.append(option);
    }
    select.value = getTrackerTheme(tracker);
    select.addEventListener('change', () => {
        setAllTrackerThemes(select.value);
        // What is already under the replies is drawn again in the new look.
        redrawAllBondSections();
        redrawAllVitalsSections();
        redrawAllInventorySections();
        for (const name of ['sillynpc-bonds-changed', 'sillynpc-vitals-changed', 'sillynpc-inventory-changed']) eventSource.emit(name);
        try { document.querySelectorAll('#chat .mes').forEach(drawSection); } catch { /* chat not open */ }
        onChange?.();
    });
    row.append(label, select);

    const help = document.createElement('small');
    help.className = 'notes';
    help.textContent = select.value === THEME_CUSTOM
        ? 'Your own regexes, and nothing else: no Freaky Frankenstein set and no built-in look. Worldkit runs every regex script in '
          + 'SillyTavern\'s Regex menu whose name starts with the text below, even if it is switched off there. Keep them switched off '
          + 'and they cannot touch the Default look or your chats. Each script runs on every tracker\'s block, so write it to match only '
          + 'the block you mean. The line formats are in the Worldkit-Content regex README.'
        : select.value === THEME_PLAIN
        ? 'How the block under a reply looks. Default - Freaky Frankenstein leaves it to the regexes you have imported in SillyTavern (the Freaky Frankenstein preset\'s, plus the Worldkit bars from the Content Kit), the way it always was. '
          + 'Picking a look here picks it for Internal States, Bonds, Vitals and Inventory together.'
        : 'Picked for Internal States, Bonds, Vitals and Inventory together, so they match. The model always writes the same plain block; '
          + 'the look is drawn over it afterwards, so it can be changed on blocks already written. The same looks are in the Worldkit-Content regex folder for use outside the extension.';
    wrap.append(row, help);
    if (select.value === THEME_CUSTOM) wrap.append(customControls());
    return wrap;
}

/** The name prefix that picks the custom look's scripts, and how many are found now. */
function customControls() {
    const box = document.createElement('div');
    box.className = 'sillynpc-setting-row';
    const label = document.createElement('label');
    label.className = 'sillynpc-setting-label';
    label.textContent = 'Scripts named';
    const field = document.createElement('input');
    field.type = 'text';
    field.className = 'text_pole';
    field.value = getSettings().customRegexPrefix || CUSTOM_REGEX_PREFIX_DEFAULT;
    const found = document.createElement('small');
    found.className = 'notes';
    const count = () => {
        const n = customRegexScripts().length;
        found.textContent = n ? `${n} script${n === 1 ? '' : 's'} found.` : 'No scripts found with that name yet.';
    };
    count();
    // Saved as it is typed; the count follows without redrawing the box, so typing is not interrupted.
    field.addEventListener('input', () => { getSettings().customRegexPrefix = field.value; saveSettings(); count(); });
    box.append(label, field, found);
    return box;
}
