import { getSettings, saveSettings } from './settings.js';
import { getType, listTypes, normalizeCombatPrefs, validateType } from './combat-types.js';

/**
 * The combat module's view of the shared settings (fork).
 *
 * Preferences follow each System; the library of custom types is global. This is the only
 * combat file that touches settings, so the rest can be tested without them.
 */

export function combatPrefs() {
    const settings = getSettings();
    settings.combat = normalizeCombatPrefs(settings.combat);
    return settings.combat;
}

export function combatLibrary() {
    const settings = getSettings();
    if (!settings.combatTypes || typeof settings.combatTypes !== 'object') settings.combatTypes = {};
    return settings.combatTypes;
}

/** Every type, with its validation result: [{ type, errors, warnings }]. */
export function allTypes() {
    return listTypes(combatLibrary()).map(type => ({ type, ...validateType(type) }));
}

/** The type picked for this System, or null if none is picked, it is gone, or it is invalid. */
export function activeCombatType() {
    const id = combatPrefs().activeType;
    if (!id) return null;
    const type = getType(combatLibrary(), id);
    if (!type || validateType(type).errors.length) return null;
    return type;
}

export function setActiveCombatType(id) {
    combatPrefs().activeType = String(id || '');
    saveSettings();
}

export function setCombatEnabled(on) {
    combatPrefs().enabled = Boolean(on);
    saveSettings();
}
