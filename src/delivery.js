import { saveSettingsDebounced } from '../../../../../script.js';
import { extension_settings } from '../../../../extensions.js';
import { placeWritingPrompt } from './prompt-slot.js';
import { getSettings } from './settings.js';
import { mergeRegexScripts } from './content-kit.js';
import { buildDeliveryPrompt, deliveryScripts, deliveryNames, DELIVERY_SCRIPT_IDS } from './delivery-core.js';
import { deliveryCss, fontsUrl } from './delivery-style.js';
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
    return String(getSettings().deliveryTagsPrompt ?? '').trim() || buildDeliveryPrompt(toneTable(), getSettings().deliveryMeanings);
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

/** Puts the current styles on the page: one <style> for the looks and, when a font needs loading, one <link>. */
export function applyDeliveryStyle() {
    if (typeof document === 'undefined') return;
    const settings = getSettings();
    const names = deliveryNames(toneTable());
    let style = document.getElementById('wk-delivery-style');
    if (!style) {
        style = document.createElement('style');
        style.id = 'wk-delivery-style';
        document.head.append(style);
    }
    style.textContent = deliveryCss(settings.deliveryStyles, names);

    const url = fontsUrl(settings.deliveryStyles, names);
    let link = document.getElementById('wk-delivery-fonts');
    if (!url) { link?.remove(); return; }
    if (!link) {
        link = document.createElement('link');
        link.id = 'wk-delivery-fonts';
        link.rel = 'stylesheet';
        document.head.append(link);
    }
    if (link.getAttribute('href') !== url) link.setAttribute('href', url);
}

/** Both at once: what the toggle and a change to the tag table call. */
export function applyDelivery() {
    applyDeliveryPrompt();
    syncDeliveryScripts();
}
