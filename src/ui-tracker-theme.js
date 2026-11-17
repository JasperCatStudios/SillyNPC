import { eventSource } from '../../../../events.js';
import { TRACKER_THEMES, THEME_PLAIN } from './tracker-themes.js';
import { getTrackerTheme, setAllTrackerThemes } from './tracker-theme-setting.js';
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
    help.textContent = select.value === THEME_PLAIN
        ? 'How the block under a reply looks. Default - Freaky Frankenstein leaves it to the regexes you have imported in SillyTavern (the Freaky Frankenstein preset\'s, plus the Worldkit bars from the Content Kit), the way it always was. '
          + 'Picking a look here picks it for Internal States, Bonds, Vitals and Inventory together.'
        : 'Picked for Internal States, Bonds, Vitals and Inventory together, so they match. The model always writes the same plain block; '
          + 'the look is drawn over it afterwards, so it can be changed on blocks already written. The same looks are in the Worldkit-Content regex folder for use outside the extension.';
    wrap.append(row, help);
    return wrap;
}
