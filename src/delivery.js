import { saveSettingsDebounced } from '../../../../../script.js';
import { extension_settings } from '../../../../extensions.js';
import { placeWritingPrompt } from './prompt-slot.js';
import { getSettings } from './settings.js';
import { mergeRegexScripts } from './content-kit.js';
import { buildDeliveryPrompt, deliveryScripts, DELIVERY_SCRIPT_IDS } from './delivery-core.js';
import { toneTable } from './alltalk.js';
import { debugLog } from './constants.js';

/**
 * Delivery tags at run time (fork): the instruction sent to the story model, and the two regex scripts
 * kept in SillyTavern's Regex list to match the switch and the tag names. See delivery-core.js.
 * The saver's own switch and depth are settings here (deliverySaverOn, deliverySaverDepth), so
 * turning the feature off and on again does not forget them.
 */

export const DELIVERY_KEY = 'sillynpc-delivery-tags';

export function deliveryEnabled() {
    const settings = getSettings();
    return settings.enabled !== false && settings.deliveryTagsEnabled === true;
}

/** The instruction text: the owner's if they have written their own, else built from the tag names. */
export function deliveryPromptText() {
    return String(getSettings().deliveryTagsPrompt ?? '').trim() || buildDeliveryPrompt(toneTable());
}

/** Puts the instruction in front of the model, or takes it away. */
export function applyDeliveryPrompt() {
    placeWritingPrompt(DELIVERY_KEY, deliveryEnabled() ? deliveryPromptText() : '', {
        inList: false,
        depth: Number(getSettings().deliveryTagsDepth ?? 0),
        name: 'Worldkit - Delivery Tags',
        order: 110,
    });
}

/**
 * Writes the two regex scripts into SillyTavern's list for the current tag names and switch. The
 * context saver keeps whatever on/off and depth the owner gave it; it starts off.
 */
export function syncDeliveryScripts() {
    const list = Array.isArray(extension_settings.regex) ? extension_settings.regex : [];
    const settings = getSettings();
    const scripts = deliveryScripts(toneTable(), {
        enabled: deliveryEnabled(),
        saverOn: settings.deliverySaverOn === true,
        saverDepth: settings.deliverySaverDepth ?? 2,
    });
    // Nothing to write while the feature has never been on and the scripts are not there yet.
    if (!deliveryEnabled() && !list.some(s => s?.id === DELIVERY_SCRIPT_IDS.display)) return;
    extension_settings.regex = mergeRegexScripts(list, scripts).merged;
    saveSettingsDebounced();
    debugLog('Delivery tag regex scripts brought up to date');
}

/** Both at once: what the toggle and a change to the tag table call. */
export function applyDelivery() {
    applyDeliveryPrompt();
    syncDeliveryScripts();
}
